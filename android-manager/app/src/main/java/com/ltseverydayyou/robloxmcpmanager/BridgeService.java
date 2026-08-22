package com.ltseverydayyou.robloxmcpmanager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.IBinder;
import android.os.Process;
import android.util.Log;

import java.io.File;

public final class BridgeService extends Service {
    static final String ACTION_START = "com.ltseverydayyou.robloxmcpmanager.START_BRIDGE";
    static final String ACTION_STOP = "com.ltseverydayyou.robloxmcpmanager.STOP_BRIDGE";
    static final String EXTRA_PORT = "port";
    private static final String CHANNEL = "embedded_bridge";
    private static final int NOTIFICATION_ID = 16384;
    private boolean started;

    static void start(Context context, int port) {
        Intent intent = new Intent(context, BridgeService.class).setAction(ACTION_START).putExtra(EXTRA_PORT, port);
        context.startForegroundService(intent);
    }

    static void stop(Context context) {
        Intent intent = new Intent(context, BridgeService.class).setAction(ACTION_STOP);
        context.startService(intent);
    }

    @Override public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Embedded MCP bridge", NotificationManager.IMPORTANCE_LOW));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            Process.killProcess(Process.myPid());
            return START_NOT_STICKY;
        }

        int port = intent == null ? 16384 : intent.getIntExtra(EXTRA_PORT, 16384);
        startForeground(NOTIFICATION_ID, notification(port));
        if (!started) {
            started = true;
            Thread nodeThread = new Thread(() -> runNode(port), "embedded-node");
            nodeThread.start();
        }
        return START_NOT_STICKY;
    }

    private void runNode(int port) {
        try {
            File runtime = AssetInstaller.install(this);
            File log = new File(getFilesDir(), "bridge.log");
            int result = NativeNode.start(new String[]{
                "node", new File(runtime, "main.mjs").getAbsolutePath(),
                Integer.toString(port), log.getAbsolutePath()
            });
            Log.i("RobloxMcpBridge", "Embedded Node exited with " + result);
        } catch (Throwable error) {
            Log.e("RobloxMcpBridge", "Embedded runtime failed", error);
        } finally {
            stopSelf();
        }
    }

    private Notification notification(int port) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle("Roblox MCP bridge is running")
            .setContentText("Local bridge on 127.0.0.1:" + port)
            .setContentIntent(pending)
            .setOngoing(true)
            .build();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
