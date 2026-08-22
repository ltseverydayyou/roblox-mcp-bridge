package com.ltseverydayyou.robloxmcpmanager;

import android.content.Context;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

final class TunnelClient {
    static final String VERSION = "0.0.12";
    private static final Pattern PROFILE = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,63}");
    private static final Pattern TUNNEL_ID = Pattern.compile("tunnel_[0-9a-f]{32}");

    static final class Result {
        final int exitCode;
        final String output;

        Result(int exitCode, String output) {
            this.exitCode = exitCode;
            this.output = output;
        }
    }

    private TunnelClient() {}

    static File binary(Context context) {
        return new File(context.getApplicationInfo().nativeLibraryDir, "libtunnel-client.so");
    }

    static File profilesDirectory(Context context) {
        return new File(context.getNoBackupFilesDir(), "tunnel-profiles");
    }

    static File profileFile(Context context, String profile) {
        return new File(profilesDirectory(context), profile + ".yaml");
    }

    static int healthPort(int bridgePort) {
        return bridgePort < 65535 ? bridgePort + 1 : 16385;
    }

    static String validate(String profile, String tunnelId) {
        if (!PROFILE.matcher(profile).matches()) {
            return "Profile must be 1–64 letters, numbers, dots, underscores, or hyphens.";
        }
        if (!TUNNEL_ID.matcher(tunnelId).matches()) {
            return "Tunnel ID must be tunnel_ followed by 32 lowercase hexadecimal characters.";
        }
        return null;
    }

    static Result configure(Context context, String profile, String tunnelId, int bridgePort) throws Exception {
        File profiles = profilesDirectory(context);
        if (!profiles.isDirectory() && !profiles.mkdirs()) {
            throw new IllegalStateException("Could not create " + profiles.getAbsolutePath());
        }
        return run(context, "", Arrays.asList(
            "init",
            "--sample", "sample_mcp_remote_no_auth",
            "--profile", profile,
            "--profile-dir", profiles.getAbsolutePath(),
            "--tunnel-id", tunnelId,
            "--mcp-server-url", "http://127.0.0.1:" + bridgePort + "/mcp",
            "--health-listen-addr", "127.0.0.1:" + healthPort(bridgePort),
            "--force"
        ));
    }

    static Result doctor(Context context, String profile, String runtimeKey) throws Exception {
        return run(context, runtimeKey, Arrays.asList(
            "doctor", "--profile-file", profileFile(context, profile).getAbsolutePath(), "--explain"
        ));
    }

    static ProcessBuilder processBuilder(Context context, String profile, String runtimeKey, String controlPlaneProxy) {
        File executable = binary(context);
        if (!executable.isFile()) {
            throw new IllegalStateException("Bundled tunnel-client " + VERSION + " is missing from the APK.");
        }
        List<String> command = new ArrayList<>();
        command.add(executable.getAbsolutePath());
        command.add("run");
        command.add("--profile-file");
        command.add(profileFile(context, profile).getAbsolutePath());
        ProcessBuilder builder = prepare(context, runtimeKey, command);
        builder.environment().put("CONTROL_PLANE_HTTP_PROXY", controlPlaneProxy);
        return builder;
    }

    private static Result run(Context context, String runtimeKey, List<String> arguments) throws Exception {
        File executable = binary(context);
        if (!executable.isFile()) {
            throw new IllegalStateException("Bundled tunnel-client " + VERSION + " is missing from the APK.");
        }
        List<String> command = new ArrayList<>();
        command.add(executable.getAbsolutePath());
        command.addAll(arguments);
        Process process = prepare(context, runtimeKey, command).start();
        StringBuilder output = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append('\n');
                if (output.length() > 60_000) output.delete(0, output.length() - 45_000);
            }
        }
        return new Result(process.waitFor(), output.toString().trim());
    }

    private static ProcessBuilder prepare(Context context, String runtimeKey, List<String> command) {
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.directory(context.getFilesDir());
        builder.redirectErrorStream(true);
        builder.environment().put("HOME", context.getFilesDir().getAbsolutePath());
        builder.environment().put("TMPDIR", context.getCacheDir().getAbsolutePath());
        builder.environment().remove("OPENAI_API_KEY");
        if (runtimeKey == null || runtimeKey.isEmpty()) {
            builder.environment().remove("CONTROL_PLANE_API_KEY");
        } else {
            builder.environment().put("CONTROL_PLANE_API_KEY", runtimeKey);
        }
        return builder;
    }

    static String readState(File file, String fallback) {
        if (!file.isFile()) return fallback;
        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            StringBuilder value = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null && value.length() < 4000) value.append(line).append('\n');
            return value.toString().trim();
        } catch (Exception error) {
            return String.format(Locale.US, "Could not read state: %s", error.getMessage());
        }
    }
}
