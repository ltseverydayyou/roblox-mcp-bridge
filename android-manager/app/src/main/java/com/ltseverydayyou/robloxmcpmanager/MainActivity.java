package com.ltseverydayyou.robloxmcpmanager;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.method.ScrollingMovementMethod;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileReader;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private static final String PREFS = "manager_settings";
    private SharedPreferences preferences;
    private TextView runtimeStatus;
    private TextView healthSummary;
    private TextView outputView;
    private EditText portField;
    private EditText profileField;
    private EditText tunnelIdField;
    private EditText runtimeKeyField;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        bindViews();
        loadSettings();
        wireActions();
        outputView.setMovementMethod(new ScrollingMovementMethod());
        updateRuntimeStatus();
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 42);
    }

    @Override protected void onResume() {
        super.onResume();
        updateRuntimeStatus();
        refreshStatus(false);
    }

    @Override protected void onStop() {
        saveSettings();
        super.onStop();
    }

    private void bindViews() {
        runtimeStatus = findViewById(R.id.runtimeStatus);
        healthSummary = findViewById(R.id.healthSummary);
        outputView = findViewById(R.id.outputView);
        portField = findViewById(R.id.portField);
        profileField = findViewById(R.id.profileField);
        tunnelIdField = findViewById(R.id.tunnelIdField);
        runtimeKeyField = findViewById(R.id.runtimeKeyField);
    }

    private void loadSettings() {
        portField.setText(preferences.getString("port", "16384"));
        profileField.setText(preferences.getString("profile", "roblox-executor"));
        tunnelIdField.setText(preferences.getString("tunnelId", ""));
    }

    private void saveSettings() {
        preferences.edit().putString("port", value(portField))
            .putString("profile", value(profileField)).putString("tunnelId", value(tunnelIdField)).apply();
    }

    private void wireActions() {
        findViewById(R.id.prepareRuntimeButton).setOnClickListener(v -> prepareRuntime());
        findViewById(R.id.refreshButton).setOnClickListener(v -> refreshStatus(true));
        findViewById(R.id.startBridgeButton).setOnClickListener(v -> {
            saveSettings();
            new File(getFilesDir(), BridgeService.STATUS_FILE).delete();
            BridgeService.start(this, port());
            appendOutput("\nStarting the embedded Node bridge...");
            runtimeStatus.setText("EMBEDDED NODE: STARTING");
            runtimeStatus.setTextColor(getColor(R.color.warning));
            healthSummary.postDelayed(() -> refreshStatus(true, 30), 1000);
        });
        findViewById(R.id.stopBridgeButton).setOnClickListener(v -> {
            BridgeService.stop(this);
            appendOutput("\nStopped the isolated bridge process.");
            healthSummary.postDelayed(() -> refreshStatus(false), 800);
        });
        findViewById(R.id.dashboardButton).setOnClickListener(v -> openUrl("http://127.0.0.1:" + port() + "/"));
        findViewById(R.id.copyLoaderButton).setOnClickListener(v -> copyLoader());
        findViewById(R.id.bridgeLogsButton).setOnClickListener(v -> readLogs());
        findViewById(R.id.managerUpdateButton).setOnClickListener(v -> checkManagerUpdate());

        int[] tunnelButtons = { R.id.configureTunnelButton, R.id.doctorTunnelButton, R.id.startTunnelButton, R.id.stopTunnelButton };
        for (int id : tunnelButtons) findViewById(id).setOnClickListener(v -> tunnelPrototypeNotice());
    }

    private void prepareRuntime() {
        runtimeStatus.setText("EMBEDDED NODE: EXTRACTING");
        new Thread(() -> {
            try {
                File runtime = AssetInstaller.install(this);
                runOnUiThread(() -> {
                    updateRuntimeStatus();
                    appendOutput("\nRuntime ready at " + runtime.getAbsolutePath());
                    toast("Embedded runtime ready");
                });
            } catch (Exception error) {
                runOnUiThread(() -> showMessage("Runtime preparation failed", error.getMessage()));
            }
        }, "runtime-installer").start();
    }

    private void refreshStatus(boolean reportFailure) {
        refreshStatus(reportFailure, 0);
    }

    private void refreshStatus(boolean reportFailure, int retriesRemaining) {
        int requestedPort = port();
        new Thread(() -> {
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL("http://127.0.0.1:" + requestedPort + "/api/status").openConnection();
                connection.setConnectTimeout(900);
                connection.setReadTimeout(1400);
                connection.setRequestProperty("Accept", "application/json");
                int code = connection.getResponseCode();
                if (code < 200 || code >= 300) throw new IllegalStateException("HTTP " + code);
                ByteArrayOutputStream responseBytes = new ByteArrayOutputStream();
                byte[] buffer = new byte[8192];
                int read;
                try (InputStream input = connection.getInputStream()) {
                    while ((read = input.read(buffer)) >= 0) responseBytes.write(buffer, 0, read);
                }
                String response = responseBytes.toString(StandardCharsets.UTF_8.name());
                runOnUiThread(() -> {
                    runtimeStatus.setText("EMBEDDED NODE: RUNNING");
                    runtimeStatus.setTextColor(getColor(R.color.success));
                    healthSummary.setText("Node 18.17.1 (embedded)\nMCP 2.4.4 (bundled)\nBridge: RUNNING on 127.0.0.1:" + requestedPort);
                    healthSummary.setTextColor(getColor(R.color.success));
                    if (reportFailure) appendOutput("\nBridge health check passed. " + compact(response));
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    String serviceState = readServiceState();
                    boolean fatal = serviceState.startsWith("ERROR") || serviceState.startsWith("EXITED");
                    if (retriesRemaining > 0 && !fatal) {
                        runtimeStatus.setText("EMBEDDED NODE: STARTING");
                        runtimeStatus.setTextColor(getColor(R.color.warning));
                        healthSummary.setText("Node 18.17.1 (embedded)\nMCP 2.4.4 (bundled)\nBridge: starting…\n" + serviceState);
                        healthSummary.setTextColor(getColor(R.color.warning));
                        healthSummary.postDelayed(() -> refreshStatus(reportFailure, retriesRemaining - 1), 1000);
                        return;
                    }
                    updateRuntimeStatus();
                    healthSummary.setText("Node 18.17.1 (embedded)\nMCP 2.4.4 (bundled)\nBridge: stopped\n" + serviceState);
                    healthSummary.setTextColor(getColor(R.color.warning));
                    if (reportFailure) appendOutput("\nBridge failed to become ready: " + error.getMessage() + "\nService: " + serviceState);
                });
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "bridge-health").start();
    }

    private void updateRuntimeStatus() {
        File runtime = new File(getFilesDir(), "embedded-runtime/main.mjs");
        runtimeStatus.setText(runtime.isFile() ? "EMBEDDED NODE: READY" : "EMBEDDED NODE: BUNDLED — TAP PREPARE");
        runtimeStatus.setTextColor(getColor(runtime.isFile() ? R.color.success : R.color.warning));
    }

    private void readLogs() {
        File serviceLog = new File(getFilesDir(), BridgeService.SERVICE_LOG_FILE);
        File bridgeLog = new File(getFilesDir(), "bridge.log");
        if (!serviceLog.isFile() && !bridgeLog.isFile()) { appendOutput("\nNo embedded bridge log exists yet. Service: " + readServiceState()); return; }
        new Thread(() -> {
            StringBuilder lines = new StringBuilder();
            try {
                appendLogFile(lines, "Android service", serviceLog);
                appendLogFile(lines, "Embedded Node", bridgeLog);
                runOnUiThread(() -> appendOutput("\n--- embedded bridge log ---\n" + lines));
            } catch (Exception error) {
                runOnUiThread(() -> showMessage("Could not read bridge logs", error.getMessage()));
            }
        }, "log-reader").start();
    }

    private static void appendLogFile(StringBuilder output, String label, File file) throws Exception {
        if (!file.isFile()) return;
        output.append("--- ").append(label).append(" ---\n");
        try (BufferedReader reader = new BufferedReader(new FileReader(file))) {
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append('\n');
                if (output.length() > 45_000) output.delete(0, output.length() - 35_000);
            }
        }
    }

    private String readServiceState() {
        File status = new File(getFilesDir(), BridgeService.STATUS_FILE);
        if (!status.isFile()) return "Waiting for the Android service…";
        try (BufferedReader reader = new BufferedReader(new FileReader(status))) {
            StringBuilder value = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null && value.length() < 4000) value.append(line).append('\n');
            return value.toString().trim();
        } catch (Exception error) {
            return "Could not read service state: " + error.getMessage();
        }
    }

    private void tunnelPrototypeNotice() {
        runtimeKeyField.setText("");
        showMessage("Tunnel transport is not embedded yet",
            "The local Roblox bridge now runs without Termux. The official GPT tunnel client does not ship an Android binary, so this build leaves tunnel start disabled until its transport is ported and verified. Your runtime key was not stored.");
    }

    private void copyLoader() {
        String loader = "getgenv().BridgeURL = \"127.0.0.1:" + port() + "\"\n"
            + "\n"
            + "if getgenv().MCP_AutoReconnect then\n"
            + "\treturn\n"
            + "end\n"
            + "\n"
            + "getgenv().MCP_AutoReconnect = true\n"
            + "\n"
            + "while getgenv().MCP_AutoReconnect do\n"
            + "\tlocal Success, Source = pcall(function()\n"
            + "\t\treturn game:HttpGet(\"http://\" .. getgenv().BridgeURL .. \"/script.luau\")\n"
            + "\tend)\n"
            + "\n"
            + "\tif not Success or type(Source) ~= \"string\" or Source == \"\" then\n"
            + "\t\ttask.wait(2)\n"
            + "\t\tcontinue\n"
            + "\tend\n"
            + "\n"
            + "\tlocal Bridge = loadstring(Source)\n"
            + "\n"
            + "\tif not Bridge then\n"
            + "\t\ttask.wait(2)\n"
            + "\t\tcontinue\n"
            + "\tend\n"
            + "\n"
            + "\tgetgenv().MCP_Loaded = false\n"
            + "\n"
            + "\tpcall(Bridge)\n"
            + "\n"
            + "\tgetgenv().MCP_Loaded = false\n"
            + "\n"
            + "\ttask.wait(2)\n"
            + "end";
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("Roblox MCP executor loader", loader));
        toast("Executor connection code copied");
    }

    private void checkManagerUpdate() {
        appendOutput("\nChecking GitHub for an Android manager update...");
        ManagerUpdateChecker.check((result, error) -> runOnUiThread(() -> {
            if (error != null) { showMessage("Manager update", error.getMessage()); return; }
            boolean newer = compareVersions(result.version, BuildConfig.VERSION_NAME) > 0;
            String message = "Published Android manager: v" + result.version + "\nInstalled: v" + BuildConfig.VERSION_NAME
                + "\n" + (newer ? "An update is available." : "This app is current.")
                + (result.digest.isEmpty() ? "" : "\nVerified release digest: " + result.digest);
            AlertDialog.Builder dialog = new AlertDialog.Builder(this).setTitle("Android manager release").setMessage(message);
            if (newer) dialog.setNegativeButton("Later", null)
                .setPositiveButton("Download", (ignored, which) -> ManagerUpdateChecker.openDownload(this, result.downloadUrl));
            else dialog.setPositiveButton("OK", null);
            dialog.show();
        }));
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

    private int port() {
        try {
            int port = Integer.parseInt(value(portField));
            if (port < 1 || port > 65535) throw new NumberFormatException();
            return port;
        } catch (NumberFormatException error) {
            portField.setText("16384");
            return 16384;
        }
    }

    private static String value(EditText field) { return field.getText().toString().trim(); }
    private static String compact(String value) { return value.length() > 300 ? value.substring(0, 300) + "…" : value; }
    private void openUrl(String url) { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
    private void showMessage(String title, String message) { new AlertDialog.Builder(this).setTitle(title).setMessage(message == null ? "Unknown error" : message).setPositiveButton("OK", null).show(); }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_SHORT).show(); }

    private void appendOutput(String text) {
        String next = outputView.getText() + text;
        if (next.length() > 50_000) next = next.substring(next.length() - 50_000);
        outputView.setText(next);
        outputView.post(() -> {
            if (outputView.getLayout() != null) {
                int scroll = outputView.getLayout().getLineTop(outputView.getLineCount()) - outputView.getHeight();
                outputView.scrollTo(0, Math.max(scroll, 0));
            }
        });
    }
}
