package com.ltseverydayyou.robloxmcpmanager;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

final class ManagerUpdateChecker {
    interface Callback {
        void complete(Result result, Exception error);
    }

    static final class Result {
        final String version;
        final String downloadUrl;
        final String digest;

        Result(String version, String downloadUrl, String digest) {
            this.version = version;
            this.downloadUrl = downloadUrl;
            this.digest = digest;
        }
    }

    private ManagerUpdateChecker() {}

    static void check(Callback callback) {
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(
                    "https://api.github.com/repos/ltseverydayyou/roblox-mcp-bridge/releases/latest"
                ).openConnection();
                connection.setConnectTimeout(10_000);
                connection.setReadTimeout(10_000);
                connection.setRequestProperty("Accept", "application/vnd.github+json");
                connection.setRequestProperty("User-Agent", "roblox-mcp-manager-android");
                if (connection.getResponseCode() != 200) {
                    throw new IllegalStateException("GitHub returned HTTP " + connection.getResponseCode());
                }
                StringBuilder json = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                    connection.getInputStream(), StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) json.append(line);
                }
                JSONObject release = new JSONObject(json.toString());
                String version = release.optString("tag_name", "").replaceFirst("^[vV]", "");
                JSONArray assets = release.optJSONArray("assets");
                if (assets == null) throw new IllegalStateException("Latest release has no assets.");
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject asset = assets.getJSONObject(i);
                    String name = asset.optString("name", "");
                    if (name.matches("(?i)RobloxMcpManager(?:-v[^/]+)?\\.apk")) {
                        callback.complete(new Result(
                            version,
                            asset.getString("browser_download_url"),
                            asset.optString("digest", "")
                        ), null);
                        return;
                    }
                }
                throw new IllegalStateException("The latest release does not contain an Android manager APK yet.");
            } catch (Exception error) {
                callback.complete(null, error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "manager-update-check").start();
    }

    static void openDownload(Context context, String url) {
        context.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
    }
}
