package com.ltseverydayyou.robloxmcpmanager;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import java.util.concurrent.atomic.AtomicInteger;

@SuppressLint("SdCardPath") // These are Termux's documented cross-app paths, not this app's storage paths.
final class TermuxRunner {
    static final String TERMUX_PACKAGE = "com.termux";
    static final String RUN_PERMISSION = "com.termux.permission.RUN_COMMAND";
    static final String RESULT_ACTION = "com.ltseverydayyou.robloxmcpmanager.COMMAND_RESULT";
    static final String MANAGER_SCRIPT = "/data/data/com.termux/files/home/.roblox-mcp-manager/manager.sh";
    static final String TERMUX_HOME = "/data/data/com.termux/files/home";
    private static final String BASH = "/data/data/com.termux/files/usr/bin/bash";
    private static final AtomicInteger NEXT_ID = new AtomicInteger(1000);

    private TermuxRunner() {}

    static boolean isInstalled(Context context) {
        try {
            context.getPackageManager().getPackageInfo(TERMUX_PACKAGE, 0);
            return true;
        } catch (PackageManager.NameNotFoundException ignored) {
            return false;
        }
    }

    static boolean hasPermission(Context context) {
        return context.checkSelfPermission(RUN_PERMISSION) == PackageManager.PERMISSION_GRANTED;
    }

    static void installManagerScript(Context context, String script) {
        String install = "set -eu; mkdir -p \"$HOME/.roblox-mcp-manager\"; "
            + "umask 077; tee \"$HOME/.roblox-mcp-manager/manager.sh\" >/dev/null; "
            + "chmod 700 \"$HOME/.roblox-mcp-manager/manager.sh\"";
        run(context, "bootstrap", BASH, new String[]{"-c", install}, script);
    }

    static void runManager(Context context, String operation, String[] arguments, String stdin) {
        String[] all = new String[arguments.length + 1];
        all[0] = operation;
        System.arraycopy(arguments, 0, all, 1, arguments.length);
        run(context, operation, MANAGER_SCRIPT, all, stdin);
    }

    private static void run(Context context, String operation, String path, String[] arguments, String stdin) {
        int requestId = NEXT_ID.incrementAndGet();
        Intent callback = new Intent(context, CommandResultReceiver.class)
            .putExtra("operation", operation)
            .putExtra("requestId", requestId);
        int flags = PendingIntent.FLAG_ONE_SHOT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        PendingIntent pendingIntent = PendingIntent.getBroadcast(context, requestId, callback, flags);

        Intent intent = new Intent("com.termux.RUN_COMMAND");
        intent.setComponent(new ComponentName(TERMUX_PACKAGE, "com.termux.app.RunCommandService"));
        intent.putExtra("com.termux.RUN_COMMAND_PATH", path);
        intent.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", arguments);
        intent.putExtra("com.termux.RUN_COMMAND_WORKDIR", TERMUX_HOME);
        intent.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
        intent.putExtra("com.termux.RUN_COMMAND_COMMAND_LABEL", "Roblox MCP Manager: " + operation);
        intent.putExtra("com.termux.RUN_COMMAND_COMMAND_DESCRIPTION", "Runs a user-requested Roblox MCP Manager operation.");
        intent.putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pendingIntent);
        if (stdin != null) intent.putExtra("com.termux.RUN_COMMAND_STDIN", stdin);
        context.startService(intent);
    }
}
