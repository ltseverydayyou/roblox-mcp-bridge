package com.ltseverydayyou.robloxmcpmanager;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Environment;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;

final class ExternalSettings {
    static final String DIRECTORY_NAME = "Android MCP";
    static final String FILE_NAME = "settings.json";
    private static final String LEGACY_PREFS = "manager_settings";

    private final Context context;
    private JSONObject data = new JSONObject();

    ExternalSettings(Context context) {
        this.context = context.getApplicationContext();
        reload();
    }

    static File directory() {
        return new File(Environment.getExternalStorageDirectory(), DIRECTORY_NAME);
    }

    static File file() {
        return new File(directory(), FILE_NAME);
    }

    static boolean hasStorageAccess(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) return Environment.isExternalStorageManager();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return context.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    synchronized void reload() {
        data = new JSONObject();
        if (!hasStorageAccess(context)) return;
        File target = file();
        if (!target.isFile()) {
            migrateLegacySettings();
            return;
        }
        try (FileInputStream input = new FileInputStream(target); ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int read;
            while ((read = input.read(chunk)) >= 0) buffer.write(chunk, 0, read);
            byte[] bytes = buffer.toByteArray();
            if (bytes.length > 0) data = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
        } catch (Exception ignored) {
            data = new JSONObject();
        }
    }

    synchronized String getString(String key, String fallback) {
        Object value = data.opt(key);
        return value instanceof String ? (String) value : fallback;
    }

    synchronized boolean getBoolean(String key, boolean fallback) {
        Object value = data.opt(key);
        return value instanceof Boolean ? (Boolean) value : fallback;
    }

    synchronized int getInt(String key, int fallback) {
        Object value = data.opt(key);
        return value instanceof Number ? ((Number) value).intValue() : fallback;
    }

    synchronized Editor edit() {
        return new Editor(this);
    }

    synchronized String exportJson() {
        return data.toString();
    }

    private synchronized boolean persist() {
        if (!hasStorageAccess(context)) return false;
        try {
            File directory = directory();
            if (!directory.isDirectory() && !directory.mkdirs()) return false;
            File target = file();
            File temporary = new File(directory, FILE_NAME + ".tmp");
            try (FileOutputStream output = new FileOutputStream(temporary, false)) {
                output.write(data.toString(2).getBytes(StandardCharsets.UTF_8));
                output.getFD().sync();
            }
            if (target.exists() && !target.delete()) return false;
            return temporary.renameTo(target);
        } catch (Exception ignored) {
            return false;
        }
    }

    private synchronized void migrateLegacySettings() {
        SharedPreferences legacy = context.getSharedPreferences(LEGACY_PREFS, Context.MODE_PRIVATE);
        Map<String, ?> values = legacy.getAll();
        if (values.isEmpty()) {
            persist();
            return;
        }
        try {
            for (Map.Entry<String, ?> entry : values.entrySet()) {
                Object value = entry.getValue();
                if (value instanceof String || value instanceof Boolean || value instanceof Number) {
                    data.put(entry.getKey(), value);
                }
            }
            if (persist()) legacy.edit().clear().apply();
        } catch (Exception ignored) {
        }
    }

    static final class Editor {
        private final ExternalSettings owner;
        private final JSONObject pending = new JSONObject();
        private final java.util.HashSet<String> removals = new java.util.HashSet<>();

        Editor(ExternalSettings owner) {
            this.owner = owner;
        }

        Editor putString(String key, String value) {
            try { pending.put(key, value == null ? "" : value); } catch (Exception ignored) {}
            removals.remove(key);
            return this;
        }

        Editor putBoolean(String key, boolean value) {
            try { pending.put(key, value); } catch (Exception ignored) {}
            removals.remove(key);
            return this;
        }

        Editor putInt(String key, int value) {
            try { pending.put(key, value); } catch (Exception ignored) {}
            removals.remove(key);
            return this;
        }

        Editor remove(String key) {
            removals.add(key);
            pending.remove(key);
            return this;
        }

        void apply() {
            commit();
        }

        boolean commit() {
            synchronized (owner) {
                try {
                    for (String key : removals) owner.data.remove(key);
                    java.util.Iterator<String> keys = pending.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        owner.data.put(key, pending.get(key));
                    }
                } catch (Exception ignored) {
                    return false;
                }
                return owner.persist();
            }
        }
    }
}
