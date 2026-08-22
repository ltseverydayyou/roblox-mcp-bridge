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
import java.nio.charset.StandardCharsets;
import java.time.Instant;

public final class TunnelService extends Service {
    static final String STATUS_FILE = "tunnel-service-status.txt";
    static final String LOG_FILE = "tunnel-client.log";
    private static final String ACTION_START = "com.ltseverydayyou.robloxmcpmanager.START_TUNNEL";
    private static final String ACTION_STOP = "com.ltseverydayyou.robloxmcpmanager.STOP_TUNNEL";
    private static final String EXTRA_PROFILE = "profile";
    private static final String EXTRA_RUNTIME_KEY = "runtimeKey";
    private static final String CHANNEL = "openai_tunnel";
    private static final int NOTIFICATION_ID = 16385;
    private volatile Process tunnelProcess;
    private volatile boolean stopping;
    private boolean started;

    static void start(Context context, String profile, String runtimeKey) {
        Intent intent = new Intent(context, TunnelService.class).setAction(ACTION_START)
            .putExtra(EXTRA_PROFILE, profile).putExtra(EXTRA_RUNTIME_KEY, runtimeKey);
        context.startForegroundService(intent);
    }

    static void stop(Context context) {
        context.startService(new Intent(context, TunnelService.class).setAction(ACTION_STOP));
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
            writeState("STOPPING");
            Process process = tunnelProcess;
            if (process != null) process.destroy();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (intent == null || !ACTION_START.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (started) return START_NOT_STICKY;

        String profile = intent.getStringExtra(EXTRA_PROFILE);
        String runtimeKey = intent.getStringExtra(EXTRA_RUNTIME_KEY);
        intent.removeExtra(EXTRA_RUNTIME_KEY);
        if (profile == null || runtimeKey == null || runtimeKey.isEmpty()) {
            writeState("ERROR Profile or memory-only runtime API key was missing.");
            stopSelf();
            return START_NOT_STICKY;
        }
        started = true;
        startForeground(NOTIFICATION_ID, notification(profile));
        String keyForProcess = runtimeKey;
        new Thread(() -> runTunnel(profile, keyForProcess), "openai-tunnel-client").start();
        return START_NOT_STICKY;
    }

    private void runTunnel(String profile, String runtimeKey) {
        File logFile = new File(getFilesDir(), LOG_FILE);
        try {
            writeState("STARTING tunnel-client v" + TunnelClient.VERSION);
            tunnelProcess = TunnelClient.processBuilder(this, profile, runtimeKey).start();
            writeState("RUNNING tunnel-client v" + TunnelClient.VERSION);
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(tunnelProcess.getInputStream(), StandardCharsets.UTF_8));
                 FileWriter log = new FileWriter(logFile, true)) {
                String line;
                while ((line = reader.readLine()) != null) {
                    log.write("[" + Instant.now() + "] " + line + "\n");
                    log.flush();
                }
            }
            int code = tunnelProcess.waitFor();
            writeState((stopping ? "STOPPED" : "EXITED") + " tunnel-client returned code " + code);
        } catch (Throwable error) {
            Log.e("RobloxMcpTunnel", "Tunnel client failed", error);
            writeState("ERROR " + error.getClass().getName() + ": " + error.getMessage());
        } finally {
            tunnelProcess = null;
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
    }

    private void writeState(String state) {
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
            .setContentTitle("ChatGPT MCP tunnel is running")
            .setContentText("OpenAI tunnel-client v" + TunnelClient.VERSION + " · " + profile)
            .setContentIntent(pending)
            .setOngoing(true)
            .build();
    }

    @Override public void onDestroy() {
        stopping = true;
        Process process = tunnelProcess;
        if (process != null) process.destroy();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
