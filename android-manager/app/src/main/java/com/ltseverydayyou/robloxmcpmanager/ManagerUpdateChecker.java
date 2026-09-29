package com.ltseverydayyou.robloxmcpmanager;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
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
import java.io.FileInputStream;
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
    private static final String NOTIFICATION_CHANNEL = "manager_updates";
    private static final int NOTIFICATION_ID = 16387;
    interface Callback {
        void complete(Result result, Exception error);
    }

    interface DownloadCallback {
        void complete(VerifiedDownload download, Exception error);
    }

    static final class VerifiedDownload {
        final File apk;
        final boolean signerMatches;
        final String installedSignerSha256;
        final String downloadedSignerSha256;

        VerifiedDownload(File apk, boolean signerMatches, String installedSignerSha256, String downloadedSignerSha256) {
            this.apk = apk;
            this.signerMatches = signerMatches;
            this.installedSignerSha256 = installedSignerSha256;
            this.downloadedSignerSha256 = downloadedSignerSha256;
        }
    }

    private static final class PackageVerification {
        final boolean signerMatches;
        final String installedSignerSha256;
        final String downloadedSignerSha256;

        PackageVerification(boolean signerMatches, String installedSignerSha256, String downloadedSignerSha256) {
            this.signerMatches = signerMatches;
            this.installedSignerSha256 = installedSignerSha256;
            this.downloadedSignerSha256 = downloadedSignerSha256;
        }
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

    static boolean isNewer(Result result) {
        return compareVersions(result.version, BuildConfig.VERSION_NAME) > 0;
    }

    static void notifyAvailable(Context context, Result result) {
        try {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            manager.createNotificationChannel(new NotificationChannel(
                NOTIFICATION_CHANNEL,
                "Roblox MCP Manager updates",
                NotificationManager.IMPORTANCE_DEFAULT
            ));
            Intent open = new Intent(context, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent pending = PendingIntent.getActivity(
                context,
                NOTIFICATION_ID,
                open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
            );
            manager.notify(NOTIFICATION_ID, new Notification.Builder(context, NOTIFICATION_CHANNEL)
                .setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle("Roblox MCP Manager update available")
                .setContentText("Android manager v" + result.version + " is ready. Open the manager and tap App update.")
                .setContentIntent(pending)
                .setAutoCancel(true)
                .build());
        } catch (SecurityException ignored) {
            // Manual update checks still work if Android notification permission is denied.
        }
    }

    static void clearNotification(Context context) {
        context.getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
    }

    static void check(Callback callback) {
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(
                    "https://api.github.com/repos/ltseverydayyou/roblox-mcp-bridge/releases?per_page=20"
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
                JSONArray releases = new JSONArray(json.toString());
                for (int releaseIndex = 0; releaseIndex < releases.length(); releaseIndex++) {
                    JSONObject release = releases.getJSONObject(releaseIndex);
                    if (release.optBoolean("draft", false) || release.optBoolean("prerelease", false)) continue;
                    JSONArray assets = release.optJSONArray("assets");
                    if (assets == null) continue;
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
                }
                throw new IllegalStateException("No published release contains an Android manager APK yet.");
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
                PackageVerification verification = verifyPackage(appContext, target, result.version);
                callback.complete(new VerifiedDownload(
                    target,
                    verification.signerMatches,
                    verification.installedSignerSha256,
                    verification.downloadedSignerSha256
                ), null);
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

    static File stageForcedUpdate(Context context, VerifiedDownload download, Result result) throws Exception {
        if (download == null || download.apk == null || !download.apk.isFile()) {
            throw new IllegalStateException("The verified update APK is unavailable.");
        }
        if (download.signerMatches) {
            throw new IllegalStateException("Force update is only needed when the signing certificate differs.");
        }
        if (!ExternalSettings.hasStorageAccess(context)) {
            throw new SecurityException("Storage access is required so the replacement APK survives uninstall. Enable Android MCP storage access, then retry Force update.");
        }
        File updates = new File(ExternalSettings.directory(), "updates");
        if (!updates.isDirectory() && !updates.mkdirs()) {
            throw new IllegalStateException("Could not create " + updates.getAbsolutePath());
        }
        File target = new File(updates, "RobloxMcpManager-Android-v" + result.version + ".apk");
        File temporary = new File(updates, target.getName() + ".partial");
        if (temporary.exists() && !temporary.delete()) throw new IllegalStateException("Could not replace the staged force-update file.");
        try (FileInputStream input = new FileInputStream(download.apk); FileOutputStream output = new FileOutputStream(temporary, false)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
            output.getFD().sync();
        }
        if (target.exists() && !target.delete()) throw new IllegalStateException("Could not replace " + target.getAbsolutePath());
        if (!temporary.renameTo(target)) throw new IllegalStateException("Could not activate the staged replacement APK.");
        File note = new File(updates, "FORCE-UPDATE-README.txt");
        try (FileOutputStream output = new FileOutputStream(note, false)) {
            String message = "Roblox MCP Manager replacement APK staged here because the new build uses a different Android signing certificate.\n"
                + "After Android uninstalls the old manager, install: " + target.getName() + "\n"
                + "Your manager settings remain in " + ExternalSettings.file().getAbsolutePath() + "\n";
            output.write(message.getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
        return target;
    }

    static void beginForcedReinstall(Activity activity, File stagedApk) {
        File updates = new File(ExternalSettings.directory(), "updates");
        try {
            String staged = stagedApk.getCanonicalPath();
            String root = updates.getCanonicalPath() + File.separator;
            if (!staged.startsWith(root) || !stagedApk.isFile()) {
                throw new SecurityException("Force update APK must be staged under the Android MCP updates folder.");
            }
        } catch (java.io.IOException error) {
            throw new IllegalStateException("Could not validate the staged force-update path.", error);
        }
        Intent uninstall = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + activity.getPackageName()))
            .putExtra(Intent.EXTRA_RETURN_RESULT, false);
        activity.startActivity(uninstall);
    }

    @SuppressWarnings("deprecation")
    private static PackageVerification verifyPackage(Context context, File apk, String expectedVersion) throws Exception {
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
        boolean signerMatches = sameSigners(installed, archive);
        return new PackageVerification(
            signerMatches,
            signerDigest(installed),
            signerDigest(archive)
        );
    }

    @SuppressWarnings("deprecation")
    private static String signerDigest(PackageInfo info) throws Exception {
        Signature[] signatures;
        if (Build.VERSION.SDK_INT >= 28) {
            signatures = info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
        } else {
            signatures = info.signatures;
        }
        if (signatures == null || signatures.length == 0) return "unknown";
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        return toHex(digest.digest(signatures[0].toByteArray()));
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

    private static int compareVersions(String left, String right) {
        String[] a = left.split("[-+]", 2)[0].split("\\.");
        String[] b = right.split("[-+]", 2)[0].split("\\.");
        for (int index = 0; index < Math.max(a.length, b.length); index++) {
            int av = index < a.length ? parseVersionPart(a[index]) : 0;
            int bv = index < b.length ? parseVersionPart(b[index]) : 0;
            if (av != bv) return Integer.compare(av, bv);
        }
        return 0;
    }

    private static int parseVersionPart(String value) {
        try { return Integer.parseInt(value); }
        catch (NumberFormatException ignored) { return 0; }
    }
}
