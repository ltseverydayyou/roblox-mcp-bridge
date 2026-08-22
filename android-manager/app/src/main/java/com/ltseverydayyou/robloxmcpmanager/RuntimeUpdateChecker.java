package com.ltseverydayyou.robloxmcpmanager;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

final class RuntimeUpdateChecker {
    private static final String RELEASE_API =
        "https://api.github.com/repos/ltseverydayyou/roblox-mcp-bridge/releases/tags/runtime-latest";
    private static final Pattern ASSET_NAME = Pattern.compile(
        "(?i)^RobloxMcpRuntime-v([0-9]+(?:\\.[0-9]+){1,3})-([0-9a-f]{7,40})\\.zip$"
    );
    private static final Pattern SHA256_DIGEST = Pattern.compile("(?i)^sha256:([0-9a-f]{64})$");
    private static final long MAX_ARCHIVE_BYTES = 64L * 1024L * 1024L;
    private static final long MAX_EXTRACTED_BYTES = 128L * 1024L * 1024L;
    private static final int MAX_FILES = 8_000;
    static final String UPDATE_ID_MARKER = ".runtime-update-id";
    static final String UPDATE_DIGEST_MARKER = ".runtime-release-digest";
    private static final String NOTIFICATION_CHANNEL = "mcp_source_updates";
    private static final int NOTIFICATION_ID = 16386;

    interface CheckCallback { void complete(Result result, Exception error); }
    interface PrepareCallback { void complete(Prepared prepared, Exception error); }

    static final class Result {
        final String version;
        final String revision;
        final String updateId;
        final String downloadUrl;
        final String digest;
        final long size;

        Result(String version, String revision, String downloadUrl, String digest, long size) {
            this.version = version;
            this.revision = revision.toLowerCase(Locale.ROOT);
            this.updateId = "v" + version + "-" + this.revision;
            this.downloadUrl = downloadUrl;
            this.digest = digest;
            this.size = size;
        }
    }

    static final class Prepared {
        final Result result;
        final File directory;
        final File archive;

        Prepared(Result result, File directory, File archive) {
            this.result = result;
            this.directory = directory;
            this.archive = archive;
        }
    }

    private RuntimeUpdateChecker() {}

    static void check(CheckCallback callback) {
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(RELEASE_API).openConnection();
                connection.setConnectTimeout(10_000);
                connection.setReadTimeout(10_000);
                connection.setRequestProperty("Accept", "application/vnd.github+json");
                connection.setRequestProperty("User-Agent", "roblox-mcp-manager-android");
                int responseCode = connection.getResponseCode();
                if (responseCode != 200) {
                    throw new IllegalStateException("GitHub returned HTTP " + responseCode + " for the MCP runtime channel.");
                }

                JSONObject release = new JSONObject(readUtf8(connection.getInputStream(), 4L * 1024L * 1024L));
                JSONArray assets = release.optJSONArray("assets");
                if (assets == null) throw new IllegalStateException("The MCP runtime release has no assets.");
                for (int i = 0; i < assets.length(); i++) {
                    JSONObject asset = assets.getJSONObject(i);
                    Matcher match = ASSET_NAME.matcher(asset.optString("name", ""));
                    if (!match.matches()) continue;
                    Result result = new Result(
                        match.group(1),
                        match.group(2),
                        asset.getString("browser_download_url"),
                        asset.optString("digest", ""),
                        asset.optLong("size", -1)
                    );
                    callback.complete(result, null);
                    return;
                }
                throw new IllegalStateException("The MCP runtime release does not contain a compatible source bundle yet.");
            } catch (Exception error) {
                callback.complete(null, error);
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "runtime-update-check").start();
    }

    static String currentUpdateId(Context context) {
        File marker = new File(new File(context.getFilesDir(), "embedded-runtime"), UPDATE_ID_MARKER);
        try {
            if (marker.isFile()) return readUtf8(new FileInputStream(marker), 4096).trim();
            return AssetInstaller.bundledUpdateId(context);
        } catch (Exception ignored) {
            return "unknown";
        }
    }

    static boolean isCurrent(Context context, Result result) {
        return result.updateId.equals(currentUpdateId(context));
    }

    static void notifyAvailable(Context context, Result result) {
        try {
            NotificationManager manager = context.getSystemService(NotificationManager.class);
            manager.createNotificationChannel(new NotificationChannel(
                NOTIFICATION_CHANNEL,
                "MCP source updates",
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
                .setContentTitle("MCP source update available")
                .setContentText(result.updateId + " is ready. Open the manager to review and install it.")
                .setContentIntent(pending)
                .setAutoCancel(true)
                .build());
        } catch (SecurityException ignored) {
            // The in-app prompt and manual update button still work when notifications are denied.
        }
    }

    static void clearNotification(Context context) {
        try {
            context.getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID);
        } catch (SecurityException ignored) {}
    }

    static void downloadAndPrepare(Context context, Result result, PrepareCallback callback) {
        Context appContext = context.getApplicationContext();
        new Thread(() -> {
            File archive = new File(appContext.getFilesDir(), "mcp-runtime-update.zip.partial");
            File staging = new File(appContext.getFilesDir(), "embedded-runtime-update-staging");
            try {
                Matcher digestMatch = SHA256_DIGEST.matcher(result.digest);
                if (!digestMatch.matches()) {
                    throw new SecurityException("The MCP runtime release has no usable SHA-256 digest.");
                }
                URL url = new URL(result.downloadUrl);
                if (!"https".equalsIgnoreCase(url.getProtocol()) || !"github.com".equalsIgnoreCase(url.getHost())) {
                    throw new SecurityException("The MCP runtime download must start from GitHub over HTTPS.");
                }
                if (result.size <= 0 || result.size > MAX_ARCHIVE_BYTES) {
                    throw new SecurityException("The published MCP runtime bundle has an invalid size.");
                }

                deleteRecursively(archive);
                download(url, archive, result.size, digestMatch.group(1));

                File runtime = AssetInstaller.install(appContext);
                deleteRecursively(staging);
                copyRecursively(runtime, staging);
                deleteRecursively(new File(staging, "dist"));
                deleteRecursively(new File(staging, "connector.luau"));
                deleteRecursively(new File(staging, "runtime-update.json"));
                extractBundle(archive, staging);
                validateBundle(staging, result);
                writeUtf8(new File(staging, UPDATE_ID_MARKER), result.updateId);
                writeUtf8(new File(staging, UPDATE_DIGEST_MARKER), result.digest.toLowerCase(Locale.ROOT));
                callback.complete(new Prepared(result, staging, archive), null);
            } catch (Exception error) {
                try { deleteRecursively(staging); } catch (Exception ignored) {}
                try { deleteRecursively(archive); } catch (Exception ignored) {}
                callback.complete(null, error);
            }
        }, "runtime-update-download").start();
    }

    static void activate(Context context, Prepared prepared) throws Exception {
        File runtime = new File(context.getFilesDir(), "embedded-runtime");
        File previous = new File(context.getFilesDir(), "embedded-runtime-before-source-update");
        validateBundle(prepared.directory, prepared.result);
        deleteRecursively(previous);
        if (runtime.exists() && !runtime.renameTo(previous)) {
            throw new IllegalStateException("Could not preserve the current MCP runtime.");
        }
        if (!prepared.directory.renameTo(runtime)) {
            if (previous.exists()) previous.renameTo(runtime);
            throw new IllegalStateException("Could not activate the downloaded MCP runtime.");
        }
        deleteRecursively(previous);
        deleteRecursively(prepared.archive);
        clearNotification(context);
    }

    private static void download(URL url, File destination, long expectedSize, String expectedHash) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        try {
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            connection.setRequestProperty("Accept", "application/zip, application/octet-stream");
            connection.setRequestProperty("User-Agent", "roblox-mcp-manager-android");
            if (connection.getResponseCode() != 200) {
                throw new IllegalStateException("GitHub runtime download returned HTTP " + connection.getResponseCode());
            }
            long declaredLength = connection.getContentLengthLong();
            if (declaredLength > MAX_ARCHIVE_BYTES || (declaredLength > 0 && declaredLength != expectedSize)) {
                throw new SecurityException("The downloaded MCP runtime size does not match its release metadata.");
            }

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0;
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 FileOutputStream fileOutput = new FileOutputStream(destination);
                 BufferedOutputStream output = new BufferedOutputStream(fileOutput)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    total += read;
                    if (total > MAX_ARCHIVE_BYTES) throw new SecurityException("The MCP runtime download is too large.");
                    digest.update(buffer, 0, read);
                    output.write(buffer, 0, read);
                }
            }
            if (total != expectedSize) throw new SecurityException("The downloaded MCP runtime size is incomplete.");
            String actualHash = hex(digest.digest());
            if (!actualHash.equalsIgnoreCase(expectedHash)) {
                throw new SecurityException("The downloaded MCP runtime failed SHA-256 verification.");
            }
        } finally {
            connection.disconnect();
        }
    }

    private static void extractBundle(File archive, File staging) throws Exception {
        String stagingRoot = staging.getCanonicalPath() + File.separator;
        long extracted = 0;
        int files = 0;
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(new FileInputStream(archive)))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = entry.getName();
                if (name.contains("\\") || name.startsWith("/") || name.contains("../")) {
                    throw new SecurityException("The MCP runtime archive contains an unsafe path.");
                }
                boolean allowed = name.equals("connector.luau") || name.equals("runtime-update.json")
                    || name.equals("dist/") || name.startsWith("dist/");
                if (!allowed) throw new SecurityException("Unexpected file in MCP runtime archive: " + name);

                File target = new File(staging, name).getCanonicalFile();
                if (!target.getPath().startsWith(stagingRoot)) {
                    throw new SecurityException("The MCP runtime archive tried to escape its staging directory.");
                }
                if (entry.isDirectory()) {
                    if (!target.mkdirs() && !target.isDirectory()) throw new IllegalStateException("Cannot create " + target);
                    continue;
                }
                if (++files > MAX_FILES) throw new SecurityException("The MCP runtime archive contains too many files.");
                File parent = target.getParentFile();
                if (parent != null && !parent.mkdirs() && !parent.isDirectory()) throw new IllegalStateException("Cannot create " + parent);
                try (FileOutputStream output = new FileOutputStream(target)) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    while ((read = zip.read(buffer)) >= 0) {
                        extracted += read;
                        if (extracted > MAX_EXTRACTED_BYTES) throw new SecurityException("The extracted MCP runtime is too large.");
                        output.write(buffer, 0, read);
                    }
                }
                zip.closeEntry();
            }
        }
    }

    private static void validateBundle(File directory, Result result) throws Exception {
        if (!new File(directory, "dist/android.js").isFile()) throw new IllegalStateException("Runtime bundle is missing dist/android.js.");
        if (!new File(directory, "connector.luau").isFile()) throw new IllegalStateException("Runtime bundle is missing connector.luau.");
        File manifestFile = new File(directory, "runtime-update.json");
        if (!manifestFile.isFile()) throw new IllegalStateException("Runtime bundle is missing runtime-update.json.");
        JSONObject manifest = new JSONObject(readUtf8(new FileInputStream(manifestFile), 64 * 1024));
        if (manifest.optInt("schema", -1) != 1 || manifest.optInt("runtimeApi", -1) != 1) {
            throw new SecurityException("This MCP runtime bundle is not compatible with the installed APK.");
        }
        if (!result.updateId.equals(manifest.optString("updateId", ""))) {
            throw new SecurityException("The MCP runtime manifest does not match the published release asset.");
        }
        File runtimePackage = new File(directory, "package.json");
        if (!runtimePackage.isFile()) throw new IllegalStateException("The installed Android runtime package manifest is missing.");
        String dependencyFingerprint = manifest.optString("dependencyFingerprint", "");
        String installedFingerprint = sha256(runtimePackage);
        if (!installedFingerprint.equalsIgnoreCase(dependencyFingerprint)) {
            throw new SecurityException("This MCP source update requires newer runtime dependencies. Install the latest APK first.");
        }
    }

    private static void copyRecursively(File source, File destination) throws Exception {
        if (source.isDirectory()) {
            if (!destination.mkdirs() && !destination.isDirectory()) throw new IllegalStateException("Cannot create " + destination);
            File[] children = source.listFiles();
            if (children != null) for (File child : children) copyRecursively(child, new File(destination, child.getName()));
            return;
        }
        File parent = destination.getParentFile();
        if (parent != null && !parent.mkdirs() && !parent.isDirectory()) throw new IllegalStateException("Cannot create " + parent);
        try (InputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
        }
    }

    private static void deleteRecursively(File target) throws Exception {
        if (!target.exists()) return;
        File canonical = target.getCanonicalFile();
        File[] children = canonical.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        if (!canonical.delete()) throw new IllegalStateException("Cannot remove " + canonical);
    }

    private static String readUtf8(InputStream input, long limit) throws Exception {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            long total = 0;
            int read;
            while ((read = source.read(buffer)) >= 0) {
                total += read;
                if (total > limit) throw new SecurityException("Text payload exceeded its size limit.");
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static void writeUtf8(File file, String value) throws Exception {
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write((value + "\n").getBytes(StandardCharsets.UTF_8));
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder value = new StringBuilder(bytes.length * 2);
        for (byte item : bytes) value.append(String.format(Locale.ROOT, "%02x", item & 0xff));
        return value.toString();
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) digest.update(buffer, 0, read);
        }
        return hex(digest.digest());
    }
}
