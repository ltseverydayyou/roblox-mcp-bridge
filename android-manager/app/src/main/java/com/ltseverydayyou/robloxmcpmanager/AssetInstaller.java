package com.ltseverydayyou.robloxmcpmanager;

import android.content.Context;
import android.content.res.AssetManager;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

final class AssetInstaller {
    private static final String ASSET_ROOT = "nodejs-project";

    private AssetInstaller() {}

    static File install(Context context) throws IOException {
        File runtime = new File(context.getFilesDir(), "embedded-runtime");
        String bundledVersion = readAsset(context.getAssets(), ASSET_ROOT + "/runtime-version.txt").trim();
        File marker = new File(runtime, ".installed-version");
        if (new File(runtime, "main.mjs").isFile() && marker.isFile()
            && readFile(marker).trim().equals(bundledVersion)) {
            return runtime;
        }

        File staging = new File(context.getFilesDir(), "embedded-runtime-staging");
        deleteRecursively(staging);
        if (!staging.mkdirs() && !staging.isDirectory()) throw new IOException("Cannot create runtime staging directory");
        copyTree(context.getAssets(), ASSET_ROOT, staging);
        try (FileOutputStream output = new FileOutputStream(new File(staging, ".installed-version"))) {
            output.write(bundledVersion.getBytes(StandardCharsets.UTF_8));
        }

        File previous = new File(context.getFilesDir(), "embedded-runtime-previous");
        deleteRecursively(previous);
        if (runtime.exists() && !runtime.renameTo(previous)) throw new IOException("Cannot preserve previous runtime");
        if (!staging.renameTo(runtime)) {
            if (previous.exists()) previous.renameTo(runtime);
            throw new IOException("Cannot activate embedded runtime");
        }
        deleteRecursively(previous);
        return runtime;
    }

    private static void copyTree(AssetManager assets, String assetPath, File destination) throws IOException {
        String[] children = assets.list(assetPath);
        if (children != null && children.length > 0) {
            if (!destination.mkdirs() && !destination.isDirectory()) throw new IOException("Cannot create " + destination);
            for (String child : children) copyTree(assets, assetPath + "/" + child, new File(destination, child));
            return;
        }
        File parent = destination.getParentFile();
        if (parent != null && !parent.mkdirs() && !parent.isDirectory()) throw new IOException("Cannot create " + parent);
        try (InputStream input = assets.open(assetPath); FileOutputStream output = new FileOutputStream(destination)) {
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
        }
    }

    private static String readAsset(AssetManager assets, String path) throws IOException {
        try (InputStream input = assets.open(path)) {
            return readUtf8(input);
        }
    }

    private static String readFile(File file) throws IOException {
        try (InputStream input = new java.io.FileInputStream(file)) {
            return readUtf8(input);
        }
    }

    private static String readUtf8(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = input.read(buffer)) >= 0) output.write(buffer, 0, read);
        return output.toString(StandardCharsets.UTF_8.name());
    }

    private static void deleteRecursively(File target) throws IOException {
        if (!target.exists()) return;
        File canonicalRoot = target.getCanonicalFile();
        File[] children = canonicalRoot.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        if (!canonicalRoot.delete()) throw new IOException("Cannot remove " + canonicalRoot);
    }
}
