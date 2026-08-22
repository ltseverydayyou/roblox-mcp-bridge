package com.ltseverydayyou.robloxmcpmanager;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class ManagerUpdateChecker {
    private static final Pattern APK_NAME = Pattern.compile(
        // Keep a trailing build-flavor "-debug" out of the manifest version group.
        "(?i)^RobloxMcpManager-Android-v([0-9]+(?:\\.[0-9]+){1,3}(?:[-+](?!debug\\.apk$)[A-Za-z0-9._-]+?)?)(-debug)?\\.apk$"
    );
    private static final Pattern SHA256_DIGEST = Pattern.compile("(?i)^sha256:([0-9a-f]{64})$");
    private static final long MAX_APK_BYTES = 200L * 1024L * 1024L;
    private static final String INSTALL_PREFS = "manager_update_install";
    private static final String PENDING_INSTALL = "pendingInstall";
    interface Callback {
        void complete(Result result, Exception error);
    }

    interface DownloadCallback {
        void complete(File apk, Exception error);
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
                JSONArray assets = release.optJSONArray("assets");
                if (assets == null) throw new IllegalStateException("Latest release has no assets.");
                Result debugFallback = null;
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject asset = assets.getJSONObject(i);
                    String name = asset.optString("name", "");
                    Matcher match = APK_NAME.matcher(name);
                    if (match.matches()) {
                        Result result = new Result(
                            match.group(1),
                            asset.getString("browser_download_url"),
                            asset.optString("digest", "")
                        );
                        if (match.group(2) == null) {
                            callback.complete(result, null);
                            return;
                        }
                        debugFallback = result;
                    }
                }
                if (debugFallback != null) {
                    callback.complete(debugFallback, null);
                    return;
                }
                throw new IllegalStateException("The latest release does not contain an Android manager APK yet.");
            } catch (Exception error) {
                callback.complete(null, error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "manager-update-check").start();
    }

    static void download(Context context, Result result, DownloadCallback callback) {
        Context appContext = context.getApplicationContext();
        new Thread(() -> {
            HttpURLConnection connection = null;
            File partial = null;
            File activated = null;
            try {
                Matcher digestMatch = SHA256_DIGEST.matcher(result.digest);
                if (!digestMatch.matches()) throw new SecurityException("The GitHub release has no usable SHA-256 digest.");
                URL url = new URL(result.downloadUrl);
                if (!"https".equalsIgnoreCase(url.getProtocol()) || !"github.com".equalsIgnoreCase(url.getHost())) {
                    throw new SecurityException("Update download must start from GitHub over HTTPS.");
                }
                File directory = UpdateFileProvider.updateDirectory(appContext);
                if (!directory.isDirectory() && !directory.mkdirs()) {
                    throw new IllegalStateException("Could not create the private update cache.");
                }
                partial = new File(directory, UpdateFileProvider.FILE_NAME + ".partial");
                if (partial.exists() && !partial.delete()) throw new IllegalStateException("Could not replace the partial update.");

                connection = (HttpURLConnection) url.openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(30_000);
                connection.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream");
                connection.setRequestProperty("User-Agent", "roblox-mcp-manager-android");
                int responseCode = connection.getResponseCode();
                if (responseCode != 200) throw new IllegalStateException("GitHub download returned HTTP " + responseCode);
                long declaredLength = connection.getContentLengthLong();
                if (declaredLength > MAX_APK_BYTES) throw new SecurityException("Update APK exceeds the 200 MB limit.");

                MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
                long total = 0;
                byte[] buffer = new byte[64 * 1024];
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                    int read;
                    while ((read = input.read(buffer)) >= 0) {
                        total += read;
                        if (total > MAX_APK_BYTES) throw new SecurityException("Update APK exceeds the 200 MB limit.");
                        sha256.update(buffer, 0, read);
                        output.write(buffer, 0, read);
                    }
                }
                String actualDigest = toHex(sha256.digest());
                String expectedDigest = digestMatch.group(1).toLowerCase(Locale.US);
                if (!actualDigest.equals(expectedDigest)) {
                    throw new SecurityException("Downloaded APK digest mismatch. Expected " + expectedDigest + " but received " + actualDigest + ".");
                }

                File target = UpdateFileProvider.updateFile(appContext);
                if (target.exists() && !target.delete()) throw new IllegalStateException("Could not replace the previous update APK.");
                if (!partial.renameTo(target)) throw new IllegalStateException("Could not activate the verified update APK.");
                partial = null;
                activated = target;
                verifyPackage(appContext, target, result.version);
                callback.complete(target, null);
            } catch (Exception error) {
                if (partial != null && partial.exists()) partial.delete();
                if (activated != null && activated.exists()) activated.delete();
                callback.complete(null, error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "manager-update-download").start();
    }

    static boolean beginInstall(Activity activity, File apk) {
        if (!apk.equals(UpdateFileProvider.updateFile(activity)) || !apk.isFile()) {
            throw new SecurityException("Only the verified private update APK can be installed.");
        }
        activity.getSharedPreferences(INSTALL_PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(PENDING_INSTALL, true).apply();
        if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) {
            Intent permission = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + activity.getPackageName()));
            activity.startActivity(permission);
            return false;
        }
        launchInstaller(activity);
        return true;
    }

    static boolean resumePendingInstall(Activity activity) {
        boolean pending = activity.getSharedPreferences(INSTALL_PREFS, Context.MODE_PRIVATE)
            .getBoolean(PENDING_INSTALL, false);
        if (!pending || !UpdateFileProvider.updateFile(activity).isFile()) return false;
        if (Build.VERSION.SDK_INT >= 26 && !activity.getPackageManager().canRequestPackageInstalls()) return false;
        launchInstaller(activity);
        return true;
    }

    private static void launchInstaller(Activity activity) {
        activity.getSharedPreferences(INSTALL_PREFS, Context.MODE_PRIVATE)
            .edit().remove(PENDING_INSTALL).apply();
        Intent install = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(UpdateFileProvider.contentUri(activity), "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        activity.startActivity(install);
    }

    @SuppressWarnings("deprecation")
    private static void verifyPackage(Context context, File apk, String expectedVersion) throws Exception {
        PackageManager manager = context.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28
            ? PackageManager.GET_SIGNING_CERTIFICATES
            : PackageManager.GET_SIGNATURES;
        PackageInfo archive = manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        PackageInfo installed = manager.getPackageInfo(context.getPackageName(), flags);
        if (archive == null || !context.getPackageName().equals(archive.packageName)) {
            throw new SecurityException("Downloaded APK is not Roblox MCP Manager.");
        }
        if (!expectedVersion.equals(archive.versionName)) {
            throw new SecurityException("Downloaded APK version does not match GitHub release metadata.");
        }
        long archiveCode = Build.VERSION.SDK_INT >= 28 ? archive.getLongVersionCode() : archive.versionCode;
        long installedCode = Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode;
        if (archiveCode <= installedCode) {
            throw new SecurityException("Downloaded APK is not newer than the installed manager.");
        }
        if (!sameSigners(installed, archive)) {
            throw new SecurityException("Downloaded APK is not signed by the installed manager's certificate.");
        }
    }

    @SuppressWarnings("deprecation")
    private static boolean sameSigners(PackageInfo installed, PackageInfo archive) {
        Signature[] left;
        Signature[] right;
        if (Build.VERSION.SDK_INT >= 28) {
            left = installed.signingInfo == null ? null : installed.signingInfo.getApkContentsSigners();
            right = archive.signingInfo == null ? null : archive.signingInfo.getApkContentsSigners();
        } else {
            left = installed.signatures;
            right = archive.signatures;
        }
        if (left == null || right == null || left.length != right.length || left.length == 0) return false;
        for (Signature signature : left) {
            boolean found = false;
            for (Signature candidate : right) {
                if (signature.equals(candidate)) { found = true; break; }
            }
            if (!found) return false;
        }
        return true;
    }

    private static String toHex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte current : bytes) value.append(String.format(Locale.US, "%02x", current & 0xff));
        return value.toString();
    }
}
