package com.ltseverydayyou.robloxmcpmanager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileWriter;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

public final class TunnelService extends Service {
    static final String STATUS_FILE = "tunnel-service-status.txt";
    static final String LOG_FILE = "tunnel-client.log";
    private static final String ACTION_START = "com.ltseverydayyou.robloxmcpmanager.START_TUNNEL";
    private static final String ACTION_STOP = "com.ltseverydayyou.robloxmcpmanager.STOP_TUNNEL";
    private static final String ACTION_RESTART = "com.ltseverydayyou.robloxmcpmanager.RESTART_TUNNEL";
    private static final String EXTRA_PROFILE = "profile";
    private static final String EXTRA_RUNTIME_KEY = "runtimeKey";
    private static final String EXTRA_HEALTH_PORT = "healthPort";
    private static final String CHANNEL = "openai_tunnel";
    private static final int NOTIFICATION_ID = 16385;
    private volatile Process tunnelProcess;
    private volatile boolean stopping;
    private volatile boolean restartRequested;
    private volatile String activeProfile;
    private volatile String activeRuntimeKey;
    private volatile int activeHealthPort;
    private volatile AndroidConnectProxy controlPlaneProxy;
    private boolean started;

    static void start(Context context, String profile, String runtimeKey, int healthPort) {
        Intent intent = new Intent(context, TunnelService.class).setAction(ACTION_START)
            .putExtra(EXTRA_PROFILE, profile).putExtra(EXTRA_RUNTIME_KEY, runtimeKey)
            .putExtra(EXTRA_HEALTH_PORT, healthPort);
        context.startForegroundService(intent);
    }

    static void stop(Context context) {
        context.startService(new Intent(context, TunnelService.class).setAction(ACTION_STOP));
    }

    static void restart(Context context) {
        context.startService(new Intent(context, TunnelService.class).setAction(ACTION_RESTART));
    }

    @Override public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "ChatGPT MCP tunnel", NotificationManager.IMPORTANCE_LOW));
        writeState("SERVICE_CREATED");
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopping = true;
            restartRequested = false;
            activeRuntimeKey = null;
            writeState("STOPPING");
            Process process = tunnelProcess;
            if (process != null) process.destroy();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent != null && ACTION_RESTART.equals(intent.getAction())) {
            Process process = tunnelProcess;
            if (!started || activeRuntimeKey == null || process == null || !process.isAlive()) {
                writeState("ERROR Tunnel is not currently running. Paste the runtime key and tap Start tunnel.");
                if (!started) stopSelf();
                return START_NOT_STICKY;
            }
            restartRequested = true;
            writeState("RESTARTING tunnel-client v" + TunnelClient.VERSION + " — reusing memory-only key");
            appendTunnelLog("[APK control] One-tap tunnel restart requested.");
            process.destroy();
            return START_NOT_STICKY;
        }
        if (intent == null || !ACTION_START.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (started) return START_NOT_STICKY;

        String profile = intent.getStringExtra(EXTRA_PROFILE);
        String runtimeKey = intent.getStringExtra(EXTRA_RUNTIME_KEY);
        int healthPort = intent.getIntExtra(EXTRA_HEALTH_PORT, -1);
        intent.removeExtra(EXTRA_RUNTIME_KEY);
        if (profile == null || runtimeKey == null || runtimeKey.isEmpty() || healthPort < 1 || healthPort > 65535) {
            writeState("ERROR Profile, health port, or memory-only runtime API key was missing.");
            stopSelf();
            return START_NOT_STICKY;
        }
        started = true;
        activeProfile = profile;
        activeRuntimeKey = runtimeKey;
        activeHealthPort = healthPort;
        startForeground(NOTIFICATION_ID, notification(profile));
        String keyForProcess = runtimeKey;
        new Thread(() -> runTunnel(profile, keyForProcess, healthPort), "openai-tunnel-client").start();
        return START_NOT_STICKY;
    }

    private void runTunnel(String profile, String runtimeKey, int healthPort) {
        File logFile = new File(getFilesDir(), LOG_FILE);
        try {
            writeState("STARTING tunnel-client v" + TunnelClient.VERSION);
            AndroidConnectProxy proxy = ensureControlPlaneProxy();
            appendTunnelLog("[APK network] Android DNS proxy ready at " + proxy.url()
                + " for OpenAI control-plane HTTPS.");
            Process process = TunnelClient.processBuilder(this, profile, runtimeKey, proxy.url()).start();
            tunnelProcess = process;
            writeState("CONNECTING tunnel-client v" + TunnelClient.VERSION + " to OpenAI control plane…");
            new Thread(() -> monitorReadiness(process, healthPort), "openai-tunnel-readiness").start();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8));
                 FileWriter log = new FileWriter(logFile, true)) {
                String line;
                while ((line = reader.readLine()) != null) {
                    log.write("[" + Instant.now() + "] " + line + "\n");
                    log.flush();
                }
            }
            int code = process.waitFor();
            writeState(restartRequested && !stopping
                ? "RESTARTING tunnel-client v" + TunnelClient.VERSION
                : (stopping ? "STOPPED" : "EXITED") + " tunnel-client returned code " + code);
        } catch (Throwable error) {
            Log.e("RobloxMcpTunnel", "Tunnel client failed", error);
            if (!restartRequested || stopping) {
                writeState("ERROR " + error.getClass().getName() + ": " + error.getMessage());
            }
        } finally {
            tunnelProcess = null;
            if (restartRequested && !stopping && activeRuntimeKey != null) {
                restartRequested = false;
                String profileForRestart = activeProfile;
                String keyForRestart = activeRuntimeKey;
                int healthPortForRestart = activeHealthPort;
                new Thread(() -> runTunnel(profileForRestart, keyForRestart, healthPortForRestart),
                    "openai-tunnel-client-restart").start();
                return;
            }
            activeRuntimeKey = null;
            closeControlPlaneProxy();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
    }

    private synchronized AndroidConnectProxy ensureControlPlaneProxy() throws Exception {
        if (controlPlaneProxy == null) controlPlaneProxy = AndroidConnectProxy.start();
        return controlPlaneProxy;
    }

    private synchronized void closeControlPlaneProxy() {
        AndroidConnectProxy proxy = controlPlaneProxy;
        controlPlaneProxy = null;
        if (proxy != null) proxy.close();
    }

    private void monitorReadiness(Process process, int healthPort) {
        long failingSince = System.currentTimeMillis();
        boolean ready = false;
        String lastState = "";
        while (!stopping && tunnelProcess == process && process.isAlive()) {
            String failure = readinessFailure(healthPort);
            long now = System.currentTimeMillis();
            String state;
            if (failure == null) {
                state = "READY tunnel-client v" + TunnelClient.VERSION + " — OpenAI control plane connected";
                ready = true;
                failingSince = 0;
            } else {
                if (ready || failingSince == 0) failingSince = now;
                String phase = now - failingSince >= 20_000 ? "NOT READY" : (ready ? "RECONNECTING" : "CONNECTING");
                state = phase + " — " + failure;
                ready = false;
            }
            if (!state.equals(lastState) && !stopping && tunnelProcess == process && process.isAlive()) {
                writeState(state);
                appendTunnelLog("[APK readiness] " + state);
                lastState = state;
            }
            try {
                Thread.sleep(ready ? 5_000 : 1_000);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private String readinessFailure(int healthPort) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("http://127.0.0.1:" + healthPort + "/readyz").openConnection();
            connection.setConnectTimeout(900);
            connection.setReadTimeout(1200);
            int code = connection.getResponseCode();
            return code == 200 ? null : "/readyz returned HTTP " + code;
        } catch (Exception error) {
            String message = error.getMessage();
            return "/readyz unavailable" + (message == null || message.isEmpty() ? "" : ": " + message);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private synchronized void appendTunnelLog(String line) {
        try (FileWriter writer = new FileWriter(new File(getFilesDir(), LOG_FILE), true)) {
            writer.write("[" + Instant.now() + "] " + line + "\n");
        } catch (Exception error) {
            Log.e("RobloxMcpTunnel", "Could not append tunnel readiness log", error);
        }
    }

    private synchronized void writeState(String state) {
        try (FileWriter writer = new FileWriter(new File(getFilesDir(), STATUS_FILE), false)) {
            writer.write(state);
        } catch (Exception error) {
            Log.e("RobloxMcpTunnel", "Could not persist tunnel state", error);
        }
    }

    private Notification notification(String profile) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("ChatGPT MCP tunnel service")
            .setContentText("Connecting and monitoring tunnel-client v" + TunnelClient.VERSION + " · " + profile)
            .setContentIntent(pending)
            .setOngoing(true)
            .build();
    }

    @Override public void onDestroy() {
        stopping = true;
        restartRequested = false;
        activeRuntimeKey = null;
        Process process = tunnelProcess;
        if (process != null) process.destroy();
        closeControlPlaneProxy();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
