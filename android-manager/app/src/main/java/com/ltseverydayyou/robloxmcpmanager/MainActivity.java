package com.ltseverydayyou.robloxmcpmanager;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.BroadcastReceiver;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.text.method.ScrollingMovementMethod;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final int TERMUX_PERMISSION_REQUEST = 41;
    private static final String PREFS = "manager_settings";
    private static final String DEFAULT_REPOSITORY = "https://github.com/ltseverydayyou/roblox-mcp-bridge.git";

    private final List<Button> commandButtons = new ArrayList<>();
    private SharedPreferences preferences;
    private TextView termuxStatus;
    private TextView healthSummary;
    private TextView outputView;
    private EditText repositoryField;
    private EditText branchField;
    private EditText portField;
    private EditText profileField;
    private EditText tunnelIdField;
    private EditText runtimeKeyField;
    private boolean receiverRegistered;

    private final BroadcastReceiver resultReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            handleCommandResult(intent);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        bindViews();
        loadSettings();
        wireActions();
        outputView.setMovementMethod(new ScrollingMovementMethod());
        updateTermuxStatus();
    }

    @Override
    protected void onStart() {
        super.onStart();
        IntentFilter filter = new IntentFilter(TermuxRunner.RESULT_ACTION);
        registerReceiver(resultReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        receiverRegistered = true;
        updateTermuxStatus();
    }

    @Override
    protected void onStop() {
        if (receiverRegistered) {
            unregisterReceiver(resultReceiver);
            receiverRegistered = false;
        }
        saveSettings();
        super.onStop();
    }

    private void bindViews() {
        termuxStatus = findViewById(R.id.termuxStatus);
        healthSummary = findViewById(R.id.healthSummary);
        outputView = findViewById(R.id.outputView);
        repositoryField = findViewById(R.id.repositoryField);
        branchField = findViewById(R.id.branchField);
        portField = findViewById(R.id.portField);
        profileField = findViewById(R.id.profileField);
        tunnelIdField = findViewById(R.id.tunnelIdField);
        runtimeKeyField = findViewById(R.id.runtimeKeyField);

        int[] ids = {
            R.id.connectTermuxButton, R.id.refreshButton, R.id.installAllButton,
            R.id.updateBridgeButton, R.id.startBridgeButton, R.id.stopBridgeButton,
            R.id.installTunnelButton, R.id.configureTunnelButton, R.id.doctorTunnelButton,
            R.id.startTunnelButton, R.id.stopTunnelButton, R.id.bridgeLogsButton,
            R.id.tunnelLogsButton
        };
        for (int id : ids) commandButtons.add(findViewById(id));
    }

    private void loadSettings() {
        repositoryField.setText(preferences.getString("repository", DEFAULT_REPOSITORY));
        branchField.setText(preferences.getString("branch", "main"));
        portField.setText(preferences.getString("port", "16384"));
        profileField.setText(preferences.getString("profile", "roblox-executor"));
        tunnelIdField.setText(preferences.getString("tunnelId", ""));
    }

    private void saveSettings() {
        preferences.edit()
            .putString("repository", value(repositoryField))
            .putString("branch", value(branchField))
            .putString("port", value(portField))
            .putString("profile", value(profileField))
            .putString("tunnelId", value(tunnelIdField))
            .apply();
    }

    private void wireActions() {
        findViewById(R.id.openTermuxButton).setOnClickListener(v -> openOrInstallTermux());
        findViewById(R.id.copyPermissionButton).setOnClickListener(v -> copyPermissionCommand());
        findViewById(R.id.connectTermuxButton).setOnClickListener(v -> connectTermux());
        findViewById(R.id.refreshButton).setOnClickListener(v -> runManager("status", new String[]{port()}, null));
        findViewById(R.id.installAllButton).setOnClickListener(v -> {
            saveSettings();
            runManager("install", new String[]{value(repositoryField), branch()}, null);
        });
        findViewById(R.id.updateBridgeButton).setOnClickListener(v -> runManager("update", new String[]{branch()}, null));
        findViewById(R.id.startBridgeButton).setOnClickListener(v -> runManager("bridge-start", new String[]{port()}, null));
        findViewById(R.id.stopBridgeButton).setOnClickListener(v -> runManager("bridge-stop", new String[0], null));
        findViewById(R.id.dashboardButton).setOnClickListener(v -> openUrl("http://127.0.0.1:" + port() + "/"));
        findViewById(R.id.copyLoaderButton).setOnClickListener(v -> copyLoader());
        findViewById(R.id.installTunnelButton).setOnClickListener(v -> runManager("tunnel-install", new String[0], null));
        findViewById(R.id.configureTunnelButton).setOnClickListener(v -> {
            saveSettings();
            String tunnelId = tunnelId();
            if (tunnelId == null) return;
            runManager("tunnel-configure", new String[]{profile(), tunnelId, port()}, null);
        });
        findViewById(R.id.doctorTunnelButton).setOnClickListener(v -> {
            String key = runtimeKey();
            if (key != null) runManager("tunnel-doctor", new String[]{profile()}, key);
        });
        findViewById(R.id.startTunnelButton).setOnClickListener(v -> {
            String key = runtimeKey();
            if (key != null) runManager("tunnel-start", new String[]{profile()}, key);
        });
        findViewById(R.id.stopTunnelButton).setOnClickListener(v -> runManager("tunnel-stop", new String[0], null));
        findViewById(R.id.bridgeLogsButton).setOnClickListener(v -> runManager("bridge-logs", new String[0], null));
        findViewById(R.id.tunnelLogsButton).setOnClickListener(v -> runManager("tunnel-logs", new String[0], null));
        findViewById(R.id.managerUpdateButton).setOnClickListener(v -> checkManagerUpdate());
    }

    private void connectTermux() {
        if (!TermuxRunner.isInstalled(this)) {
            showMessage("Termux required", "Install and open the official Termux app first.");
            return;
        }
        if (!TermuxRunner.hasPermission(this)) {
            requestPermissions(new String[]{TermuxRunner.RUN_PERMISSION}, TERMUX_PERMISSION_REQUEST);
            return;
        }
        try {
            StringBuilder script = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                getAssets().open("manager.sh"), StandardCharsets.UTF_8))) {
                String line;
                while ((line = reader.readLine()) != null) script.append(line).append('\n');
            }
            setBusy(true, "Installing the manager command in Termux...");
            TermuxRunner.installManagerScript(this, script.toString());
        } catch (Exception error) {
            setBusy(false, null);
            showMessage("Could not connect Termux", error.getMessage());
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == TERMUX_PERMISSION_REQUEST) {
            updateTermuxStatus();
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) connectTermux();
            else showMessage("Permission needed", "Grant “Run commands in Termux environment” from this app's permissions, then tap Connect again.");
        }
    }

    private void runManager(String operation, String[] arguments, String stdin) {
        if (!ensureTermuxReady()) return;
        try {
            saveSettings();
            setBusy(true, "Running " + operation + "...");
            String protectedInput = stdin == null ? null : stdin + "\n";
            TermuxRunner.runManager(this, operation, arguments, protectedInput);
        } catch (Exception error) {
            setBusy(false, null);
            showMessage("Operation could not start", error.getMessage());
        }
    }

    private boolean ensureTermuxReady() {
        if (!TermuxRunner.isInstalled(this)) {
            showMessage("Termux required", "Install the official Termux app first.");
            return false;
        }
        if (!TermuxRunner.hasPermission(this)) {
            requestPermissions(new String[]{TermuxRunner.RUN_PERMISSION}, TERMUX_PERMISSION_REQUEST);
            return false;
        }
        if (!preferences.getBoolean("managerConnected", false)) {
            showMessage("Connect Termux first", "Run the copied one-time permission command, then tap Connect manager to Termux.");
            return false;
        }
        return true;
    }

    private void handleCommandResult(Intent intent) {
        String operation = intent.getStringExtra("operation");
        int exitCode = intent.getIntExtra("exitCode", -1);
        String stdout = intent.getStringExtra("stdout");
        String stderr = intent.getStringExtra("stderr");
        String internalError = intent.getStringExtra("error");
        StringBuilder combined = new StringBuilder();
        if (stdout != null && !stdout.trim().isEmpty()) combined.append(stdout.trim());
        if (stderr != null && !stderr.trim().isEmpty()) {
            if (combined.length() > 0) combined.append("\n");
            combined.append(stderr.trim());
        }
        if (internalError != null && !internalError.trim().isEmpty()) {
            if (combined.length() > 0) combined.append("\n");
            combined.append(internalError.trim());
        }
        appendOutput("\n[" + operation + ", exit " + exitCode + "]\n" + combined);
        setBusy(false, null);

        if ("bootstrap".equals(operation) && exitCode == 0) {
            preferences.edit().putBoolean("managerConnected", true).apply();
            updateTermuxStatus();
            toast("Manager connected to Termux");
            runManager("status", new String[]{port()}, null);
            return;
        }
        if ("bootstrap".equals(operation) && exitCode != 0
            && combined.toString().contains("allow-external-apps")) {
            preferences.edit().putBoolean("managerConnected", false).apply();
            updateTermuxStatus();
            new AlertDialog.Builder(this)
                .setTitle("One Termux command still required")
                .setMessage("Android granted the Run commands permission, but Termux has not enabled external apps yet. Tap Copy & open Termux, paste and run the command there, then return and tap Connect again.")
                .setNegativeButton("Later", null)
                .setPositiveButton("Copy & open Termux", (dialog, which) -> copyPermissionCommand())
                .show();
            return;
        }
        if (operation != null && (operation.startsWith("tunnel-doctor") || operation.startsWith("tunnel-start"))) {
            runtimeKeyField.setText("");
        }
        if ("status".equals(operation) && exitCode == 0) parseStatus(combined.toString());
        else if (exitCode == 0 && operation != null && !operation.endsWith("logs")) {
            toast(operation + " completed");
            runManager("status", new String[]{port()}, null);
        } else if (exitCode != 0) {
            showMessage("Operation failed", combined.length() == 0 ? "Termux exited with code " + exitCode : combined.toString());
        }
    }

    private void parseStatus(String text) {
        int start = text.indexOf("MANAGER_STATUS_BEGIN");
        int end = text.indexOf("MANAGER_STATUS_END");
        if (start < 0 || end <= start) return;
        Map<String, String> values = new HashMap<>();
        String[] lines = text.substring(start, end).split("\\r?\\n");
        for (String line : lines) {
            int separator = line.indexOf('=');
            if (separator > 0) values.put(line.substring(0, separator), line.substring(separator + 1));
        }
        boolean bridge = "true".equals(values.get("bridgeHealthy"));
        boolean tunnel = "true".equals(values.get("tunnelRunning"));
        boolean update = "true".equals(values.get("updateAvailable"));
        String summary = "Node " + values.getOrDefault("node", "missing")
            + "  •  Git " + values.getOrDefault("git", "missing")
            + "\nMCP " + values.getOrDefault("localVersion", "not installed")
            + (update ? " → " + values.getOrDefault("remoteVersion", "update available") : " (current)")
            + "\nBridge: " + (bridge ? "RUNNING" : "stopped")
            + "  •  Tunnel: " + (tunnel ? "RUNNING" : ("true".equals(values.get("tunnelInstalled")) ? "client ready" : "not installed"));
        healthSummary.setText(summary);
        healthSummary.setTextColor(getColor(bridge ? R.color.success : R.color.warning));
    }

    private void setBusy(boolean busy, String message) {
        for (Button button : commandButtons) button.setEnabled(!busy);
        if (message != null) appendOutput("\n" + message);
    }

    private void appendOutput(String text) {
        String current = outputView.getText().toString();
        String next = current + text;
        if (next.length() > 50_000) next = next.substring(next.length() - 50_000);
        outputView.setText(next);
        outputView.post(() -> {
            if (outputView.getLayout() != null) {
                int scroll = outputView.getLayout().getLineTop(outputView.getLineCount()) - outputView.getHeight();
                outputView.scrollTo(0, Math.max(scroll, 0));
            }
        });
    }

    private void updateTermuxStatus() {
        boolean installed = TermuxRunner.isInstalled(this);
        boolean permission = installed && TermuxRunner.hasPermission(this);
        boolean connected = permission && preferences.getBoolean("managerConnected", false);
        boolean commandCopied = preferences.getBoolean("permissionCommandCopied", false);
        String status = !installed ? "TERMUX: NOT INSTALLED"
            : !permission ? "TERMUX: GRANT RUN COMMAND PERMISSION"
            : connected ? "TERMUX: CONNECTED"
            : commandCopied ? "TERMUX: RUN COPIED COMMAND, THEN CONNECT"
            : "TERMUX: COPY AND RUN PERMISSION COMMAND";
        termuxStatus.setText(status);
        termuxStatus.setTextColor(getColor(connected ? R.color.success : R.color.warning));
    }

    private void openOrInstallTermux() {
        if (TermuxRunner.isInstalled(this)) {
            Intent launch = getPackageManager().getLaunchIntentForPackage(TermuxRunner.TERMUX_PACKAGE);
            if (launch != null) startActivity(launch);
        } else {
            openUrl("https://github.com/termux/termux-app/releases/latest");
        }
    }

    private void copyPermissionCommand() {
        String command = "mkdir -p ~/.termux && touch ~/.termux/termux.properties && "
            + "sed -i '/^[[:space:]]*allow-external-apps[[:space:]]*=/d' ~/.termux/termux.properties && "
            + "printf '\\nallow-external-apps=true\\n' >> ~/.termux/termux.properties && "
            + "termux-reload-settings";
        copy("Termux permission setup", command);
        preferences.edit().putBoolean("permissionCommandCopied", true).putBoolean("managerConnected", false).apply();
        updateTermuxStatus();
        toast("One-time Termux command copied");
        openOrInstallTermux();
    }

    private void copyLoader() {
        String loader = "getgenv().BridgeURL = \"127.0.0.1:" + port() + "\"\n"
            + "loadstring(game:HttpGet(\"https://raw.githubusercontent.com/ltseverydayyou/roblox-mcp-bridge/main/connector.luau\"))()";
        copy("Roblox MCP executor loader", loader);
        toast("Executor connection code copied");
    }

    private void copy(String label, String text) {
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText(label, text));
    }

    private void checkManagerUpdate() {
        appendOutput("\nChecking GitHub for an Android manager update...");
        ManagerUpdateChecker.check((result, error) -> runOnUiThread(() -> {
            if (error != null) {
                showMessage("Manager update", error.getMessage());
                return;
            }
            String message = "Published Android manager: v" + result.version
                + "\nInstalled: v" + BuildConfig.VERSION_NAME
                + (result.digest.isEmpty() ? "" : "\nVerified release digest: " + result.digest);
            new AlertDialog.Builder(this)
                .setTitle("Android manager release")
                .setMessage(message)
                .setNegativeButton("Later", null)
                .setPositiveButton("Download", (dialog, which) -> ManagerUpdateChecker.openDownload(this, result.downloadUrl))
                .show();
        }));
    }

    private String port() {
        String port = value(portField);
        try {
            int number = Integer.parseInt(port);
            if (number < 1 || number > 65535) throw new NumberFormatException();
            return port;
        } catch (NumberFormatException error) {
            portField.setText("16384");
            return "16384";
        }
    }

    private String branch() {
        String branch = value(branchField);
        return branch.isEmpty() ? "main" : branch;
    }

    private String profile() {
        String profile = value(profileField);
        if (!profile.matches("[A-Za-z0-9._-]+")) {
            profileField.setText("roblox-executor");
            return "roblox-executor";
        }
        return profile;
    }

    private String tunnelId() {
        String id = value(tunnelIdField);
        if (!id.matches("tunnel_[A-Za-z0-9]+")) {
            showMessage("Invalid tunnel ID", "Enter a tunnel ID such as tunnel_ followed by letters and numbers.");
            return null;
        }
        return id;
    }

    private String runtimeKey() {
        String key = value(runtimeKeyField);
        if (key.isEmpty()) {
            showMessage("Runtime key required", "Paste the OpenAI Platform runtime API key. It will not be saved.");
            return null;
        }
        return key;
    }

    private static String value(EditText field) {
        return field.getText().toString().trim();
    }

    private void openUrl(String url) {
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
    }

    private void showMessage(String title, String message) {
        new AlertDialog.Builder(this).setTitle(title).setMessage(message == null ? "Unknown error" : message).setPositiveButton("OK", null).show();
    }

    private void toast(String message) {
        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
    }
}
