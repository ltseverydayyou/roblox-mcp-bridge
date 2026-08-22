package com.ltseverydayyou.robloxmcpmanager;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

public final class CommandResultReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Bundle result = intent.getBundleExtra("result");
        Intent update = new Intent(TermuxRunner.RESULT_ACTION).setPackage(context.getPackageName());
        update.putExtra("operation", intent.getStringExtra("operation"));
        update.putExtra("requestId", intent.getIntExtra("requestId", -1));
        if (result == null) {
            update.putExtra("exitCode", -1);
            update.putExtra("error", "Termux returned no result. Confirm allow-external-apps=true and grant Run commands permission.");
        } else {
            update.putExtra("stdout", result.getString("stdout", ""));
            update.putExtra("stderr", result.getString("stderr", ""));
            update.putExtra("exitCode", result.getInt("exitCode", -1));
            update.putExtra("error", result.getString("errmsg", ""));
        }
        context.sendBroadcast(update);
    }
}
