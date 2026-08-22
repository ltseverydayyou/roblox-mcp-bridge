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
import android.os.PowerManager;
import android.provider.Settings;
import android.text.method.ScrollingMovementMethod;
import android.util.Base64;
import android.view.MotionEvent;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileReader;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Enumeration;

public final class MainActivity extends Activity {
    private static final String PREFS = "manager_settings";
    private static final String API_KEYS_URL = "https://platform.openai.com/settings/organization/api-keys";
    private static final String TUNNELS_URL = "https://platform.openai.com/settings/organization/tunnels";
    private static final String CHATGPT_PLUGINS_URL = "https://chatgpt.com/plugins";
    private SharedPreferences preferences;
    private TextView runtimeStatus;
    private TextView healthSummary;
    private TextView outputView;
    private EditText portField;
    private EditText profileField;
    private EditText tunnelIdField;
    private EditText runtimeKeyField;
    private CheckBox lanModeCheckbox;
    private TextView lanAddressText;
    private TextView backgroundStatus;
    private TextView tunnelStatus;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);
        bindViews();
        loadSettings();
        wireActions();
        updateLanAddress();
        outputView.setMovementMethod(new ScrollingMovementMethod());
        outputView.setOnTouchListener((view, event) -> {
            boolean scrollable = view.canScrollVertically(-1) || view.canScrollVertically(1);
            int action = event.getActionMasked();
            if (scrollable && (action == MotionEvent.ACTION_DOWN || action == MotionEvent.ACTION_MOVE)) {
                view.getParent().requestDisallowInterceptTouchEvent(true);
            } else if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
                view.getParent().requestDisallowInterceptTouchEvent(false);
            }
            return false;
        });
        updateRuntimeStatus();
        updateBackgroundStatus();
        updateTunnelStatus();
        if (Build.VERSION.SDK_INT >= 33) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 42);
    }

    @Override protected void onResume() {
        super.onResume();
        updateRuntimeStatus();
        updateLanAddress();
        updateBackgroundStatus();
        updateTunnelStatus();
        refreshStatus(false);
        try {
            ManagerUpdateChecker.resumePendingInstall(this);
        } catch (Exception error) {
            appendOutput("\nCould not resume the pending update installer: " + error.getMessage());
        }
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
        lanModeCheckbox = findViewById(R.id.lanModeCheckbox);
        lanAddressText = findViewById(R.id.lanAddressText);
        backgroundStatus = findViewById(R.id.backgroundStatus);
        tunnelStatus = findViewById(R.id.tunnelStatus);
    }

    private void loadSettings() {
        portField.setText(preferences.getString("port", "16384"));
        profileField.setText(preferences.getString("profile", "roblox-executor"));
        tunnelIdField.setText(preferences.getString("tunnelId", ""));
        lanModeCheckbox.setChecked(preferences.getBoolean("lanMode", false));
    }

    private void saveSettings() {
        preferences.edit().putString("port", value(portField))
            .putString("profile", value(profileField)).putString("tunnelId", value(tunnelIdField))
            .putBoolean("lanMode", lanModeCheckbox.isChecked()).apply();
    }

    private void wireActions() {
        findViewById(R.id.prepareRuntimeButton).setOnClickListener(v -> prepareRuntime());
        findViewById(R.id.refreshButton).setOnClickListener(v -> refreshStatus(true));
        findViewById(R.id.startBridgeButton).setOnClickListener(v -> startBridge());
        findViewById(R.id.stopBridgeButton).setOnClickListener(v -> {
            BridgeService.stop(this);
            appendOutput("\nStopped the isolated bridge process.");
            healthSummary.postDelayed(() -> refreshStatus(false), 800);
        });
        findViewById(R.id.dashboardButton).setOnClickListener(v -> openUrl("http://127.0.0.1:" + port() + "/"));
        findViewById(R.id.copyLoaderButton).setOnClickListener(v -> copyLoader());
        findViewById(R.id.copyPcRelayButton).setOnClickListener(v -> copyPcRelayArguments());
        findViewById(R.id.bridgeLogsButton).setOnClickListener(v -> readLogs());
        findViewById(R.id.managerUpdateButton).setOnClickListener(v -> checkManagerUpdate());
        findViewById(R.id.batteryOptimizationButton).setOnClickListener(v -> requestUnrestrictedBattery());
        findViewById(R.id.appSettingsButton).setOnClickListener(v -> openAppSettings());
        findViewById(R.id.openApiKeysButton).setOnClickListener(v -> openUrl(API_KEYS_URL));
        findViewById(R.id.openTunnelsButton).setOnClickListener(v -> openUrl(TUNNELS_URL));
        findViewById(R.id.openChatGptPluginsButton).setOnClickListener(v -> openChatGptPlugins());
        findViewById(R.id.copyChatGptChecklistButton).setOnClickListener(v -> copyChatGptChecklist());

        findViewById(R.id.configureTunnelButton).setOnClickListener(v -> configureTunnel());
        findViewById(R.id.doctorTunnelButton).setOnClickListener(v -> doctorTunnel());
        findViewById(R.id.startTunnelButton).setOnClickListener(v -> startTunnel());
        findViewById(R.id.stopTunnelButton).setOnClickListener(v -> stopTunnel());
        lanModeCheckbox.setOnCheckedChangeListener((button, checked) -> {
            saveSettings();
            updateLanAddress();
        });
    }

    private void startBridge() {
        if (lanModeCheckbox.isChecked() && !preferences.getBoolean("lanWarningAccepted", false)) {
            new AlertDialog.Builder(this)
                .setTitle("Enable trusted LAN relay?")
                .setMessage("This lets a PC on the same trusted network reach the phone bridge. A generated relay token protects the connection, but you must not port-forward this port or use it on untrusted public Wi-Fi. Stop and restart the bridge after changing this option.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Enable LAN", (dialog, which) -> {
                    preferences.edit().putBoolean("lanWarningAccepted", true).apply();
                    startBridgeConfirmed();
                }).show();
            return;
        }
        startBridgeConfirmed();
    }

    private void startBridgeConfirmed() {
        saveSettings();
        new File(getFilesDir(), BridgeService.STATUS_FILE).delete();
        boolean lanMode = lanModeCheckbox.isChecked();
        BridgeService.start(this, port(), lanMode ? "0.0.0.0" : "127.0.0.1", lanMode ? lanToken() : "");
        appendOutput("\nStarting the embedded Node bridge" + (lanMode ? " with authenticated LAN relay..." : " on localhost..."));
        runtimeStatus.setText("EMBEDDED NODE: STARTING");
        runtimeStatus.setTextColor(getColor(R.color.warning));
        healthSummary.postDelayed(() -> refreshStatus(true, 30), 1000);
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
                    healthSummary.setText(healthBase() + "\nBridge: RUNNING on 127.0.0.1:" + requestedPort + lanExposure()
                        + "\nTunnel: " + readTunnelState());
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
                        healthSummary.setText(healthBase() + "\nBridge: starting…\n" + serviceState + "\nTunnel: " + readTunnelState());
                        healthSummary.setTextColor(getColor(R.color.warning));
                        healthSummary.postDelayed(() -> refreshStatus(reportFailure, retriesRemaining - 1), 1000);
                        return;
                    }
                    updateRuntimeStatus();
                    healthSummary.setText(healthBase() + "\nBridge: stopped\n" + serviceState + "\nTunnel: " + readTunnelState());
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
        boolean tunnelBundled = TunnelClient.binary(this).isFile();
        runtimeStatus.setText((runtime.isFile() ? "EMBEDDED NODE: READY" : "EMBEDDED NODE: BUNDLED — TAP PREPARE")
            + "\nOPENAI TUNNEL-CLIENT " + TunnelClient.VERSION + ": " + (tunnelBundled ? "READY" : "MISSING"));
        runtimeStatus.setTextColor(getColor(runtime.isFile() && tunnelBundled ? R.color.success : R.color.warning));
    }

    private void readLogs() {
        File serviceLog = new File(getFilesDir(), BridgeService.SERVICE_LOG_FILE);
        File bridgeLog = new File(getFilesDir(), "bridge.log");
        File tunnelLog = new File(getFilesDir(), TunnelService.LOG_FILE);
        if (!serviceLog.isFile() && !bridgeLog.isFile() && !tunnelLog.isFile()) {
            appendOutput("\nNo bridge or tunnel log exists yet. Bridge: " + readServiceState() + "\nTunnel: " + readTunnelState());
            return;
        }
        new Thread(() -> {
            StringBuilder lines = new StringBuilder();
            try {
                appendLogFile(lines, "Android service", serviceLog);
                appendLogFile(lines, "Embedded Node", bridgeLog);
                appendLogFile(lines, "OpenAI tunnel-client", tunnelLog);
                runOnUiThread(() -> appendOutput("\n--- bridge and tunnel logs ---\n" + lines));
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

    private String readTunnelState() {
        return TunnelClient.readState(new File(getFilesDir(), TunnelService.STATUS_FILE), "not started");
    }

    private void updateTunnelStatus() {
        String state = readTunnelState();
        tunnelStatus.setText("TUNNEL-CLIENT " + TunnelClient.VERSION + ": " + state);
        tunnelStatus.setTextColor(getColor(state.startsWith("RUNNING") ? R.color.success : R.color.warning));
    }

    private String validateTunnelInput(boolean requireKey) {
        String validation = TunnelClient.validate(value(profileField), value(tunnelIdField));
        if (validation != null) return validation;
        if (!TunnelClient.binary(this).isFile()) return "The official ARM64 tunnel-client is missing from this APK.";
        if (requireKey && value(runtimeKeyField).isEmpty()) return "Paste the OpenAI Platform runtime API key. It is used from memory and is not saved.";
        return null;
    }

    private void configureTunnel() {
        String validation = validateTunnelInput(false);
        if (validation != null) { showMessage("Tunnel configuration", validation); return; }
        saveSettings();
        String profile = value(profileField);
        String tunnelId = value(tunnelIdField);
        int bridgePort = port();
        appendOutput("\nConfiguring tunnel profile " + profile + " for localhost:" + bridgePort + "/mcp...");
        new Thread(() -> {
            try {
                TunnelClient.Result result = TunnelClient.configure(this, profile, tunnelId, bridgePort);
                runOnUiThread(() -> {
                    appendOutput("\n" + result.output);
                    if (result.exitCode == 0) toast("Tunnel profile configured");
                    else showMessage("Tunnel configuration failed", result.output);
                });
            } catch (Exception error) {
                runOnUiThread(() -> showMessage("Tunnel configuration failed", error.getMessage()));
            }
        }, "tunnel-configure").start();
    }

    private void doctorTunnel() {
        String validation = validateTunnelInput(true);
        if (validation != null) { showMessage("Tunnel doctor", validation); return; }
        if (!TunnelClient.profileFile(this, value(profileField)).isFile()) {
            showMessage("Tunnel doctor", "Tap Configure first to create this profile.");
            return;
        }
        String profile = value(profileField);
        String runtimeKey = value(runtimeKeyField);
        int bridgePort = port();
        runtimeKeyField.setText("");
        appendOutput("\nRunning tunnel doctor (runtime key cleared from the screen)...");
        new Thread(() -> {
            try {
                if (!isLocalBridgeReady(bridgePort)) throw new IllegalStateException("Start the localhost bridge before running Doctor.");
                TunnelClient.Result result = TunnelClient.doctor(this, profile, runtimeKey);
                runOnUiThread(() -> {
                    appendOutput("\n--- tunnel doctor ---\n" + result.output);
                    if (result.exitCode == 0) toast("Tunnel doctor passed");
                    else showMessage("Tunnel doctor failed", result.output);
                });
            } catch (Exception error) {
                runOnUiThread(() -> showMessage("Tunnel doctor failed", error.getMessage()));
            }
        }, "tunnel-doctor").start();
    }

    private void startTunnel() {
        String validation = validateTunnelInput(true);
        if (validation != null) { showMessage("Start tunnel", validation); return; }
        String profile = value(profileField);
        if (!TunnelClient.profileFile(this, profile).isFile()) {
            showMessage("Start tunnel", "Tap Configure first to create this profile.");
            return;
        }
        String runtimeKey = value(runtimeKeyField);
        int bridgePort = port();
        runtimeKeyField.setText("");
        new File(getFilesDir(), TunnelService.STATUS_FILE).delete();
        appendOutput("\nChecking the localhost MCP endpoint before starting the tunnel...");
        new Thread(() -> {
            try {
                if (!isLocalBridgeReady(bridgePort)) throw new IllegalStateException("Start the localhost bridge first and wait for its health check to pass.");
                runOnUiThread(() -> {
                    TunnelService.start(this, profile, runtimeKey);
                    appendOutput("\nStarting official OpenAI tunnel-client " + TunnelClient.VERSION + ". The runtime key was cleared and was not saved.");
                    tunnelStatus.postDelayed(this::updateTunnelStatus, 1200);
                });
            } catch (Exception error) {
                runOnUiThread(() -> showMessage("Start tunnel", error.getMessage()));
            }
        }, "tunnel-preflight").start();
    }

    private void stopTunnel() {
        TunnelService.stop(this);
        runtimeKeyField.setText("");
        appendOutput("\nStopping OpenAI tunnel-client...");
        tunnelStatus.postDelayed(this::updateTunnelStatus, 800);
    }

    private boolean isLocalBridgeReady(int bridgePort) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL("http://127.0.0.1:" + bridgePort + "/api/status").openConnection();
            connection.setConnectTimeout(1200);
            connection.setReadTimeout(1800);
            int code = connection.getResponseCode();
            return code >= 200 && code < 300;
        } catch (Exception ignored) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void updateBackgroundStatus() {
        PowerManager power = getSystemService(PowerManager.class);
        boolean unrestricted = power != null && power.isIgnoringBatteryOptimizations(getPackageName());
        backgroundStatus.setText(unrestricted
            ? "BATTERY: UNRESTRICTED ✓ — bridge and tunnel can stay active"
            : "BATTERY: OPTIMIZED — Android or the phone vendor may stop the bridge or tunnel");
        backgroundStatus.setTextColor(getColor(unrestricted ? R.color.success : R.color.warning));
    }

    private void requestUnrestrictedBattery() {
        PowerManager power = getSystemService(PowerManager.class);
        if (power != null && power.isIgnoringBatteryOptimizations(getPackageName())) {
            toast("Unrestricted battery use is already allowed");
            return;
        }
        new AlertDialog.Builder(this)
            .setTitle("Allow background bridge?")
            .setMessage("The localhost bridge must remain active for Roblox, ChatGPT, Codex, or Claude to stay connected. Android warns that unrestricted apps can use more battery. You can revoke this later in system settings.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Continue", (dialog, which) -> {
                Intent request = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getPackageName()));
                try {
                    startActivity(request);
                } catch (Exception ignored) {
                    startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                }
            }).show();
    }

    private void openAppSettings() {
        Intent settings = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.parse("package:" + getPackageName()));
        startActivity(settings);
    }

    private void openChatGptPlugins() {
        new AlertDialog.Builder(this)
            .setTitle("Keep the bridge and tunnel running")
            .setMessage("ChatGPT validates the plugin through the selected tunnel ID. Start the localhost bridge and its matching tunnel before tapping + in Plugins. Choose Tunnel, select that ID, use No Auth, acknowledge the custom-MCP warning, then Create. If Android stops this app or the tunnel, the plugin disconnects.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Open Plugins", (dialog, which) -> openUrl(CHATGPT_PLUGINS_URL))
            .show();
    }

    private void copyChatGptChecklist() {
        String checklist = "Roblox MCP → ChatGPT plugin setup\n\n"
            + "1. Create an OpenAI Platform runtime API key:\n" + API_KEYS_URL + "\n\n"
            + "2. Create a tunnel and copy its tunnel_... ID:\n" + TUNNELS_URL + "\n\n"
            + "3. Start Roblox MCP Manager's localhost bridge and start the tunnel with the same ID. Keep both running.\n\n"
            + "4. Open ChatGPT Plugins, tap +, choose Connection: Tunnel, select the same tunnel ID, and choose Authentication: No Auth:\n"
            + CHATGPT_PLUGINS_URL + "\n\n"
            + "5. Review and acknowledge the custom MCP warning, then tap Create.\n\n"
            + "Closing the manager screen is safe while its ongoing notification remains. Stop, Force stop, battery restriction, or clearing the service disconnects the plugin.";
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("Roblox MCP ChatGPT plugin setup", checklist));
        toast("ChatGPT plugin setup steps copied");
    }

    private void copyLoader() {
        String loader = "getgenv().BridgeURL = \"127.0.0.1:" + port() + "\"\n"
            + "getgenv().DisableWebSocket = true\n"
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
            + "\t\twarn(\"[Roblox MCP] Connector download failed: \" .. tostring(Source))\n"
            + "\t\ttask.wait(2)\n"
            + "\t\tcontinue\n"
            + "\tend\n"
            + "\n"
            + "\tlocal Bridge, CompileError = loadstring(Source)\n"
            + "\n"
            + "\tif not Bridge then\n"
            + "\t\twarn(\"[Roblox MCP] Connector compile failed: \" .. tostring(CompileError))\n"
            + "\t\ttask.wait(2)\n"
            + "\t\tcontinue\n"
            + "\tend\n"
            + "\n"
            + "\tgetgenv().MCP_Loaded = false\n"
            + "\n"
            + "\tlocal Ran, RuntimeError = pcall(Bridge)\n"
            + "\tif not Ran then\n"
            + "\t\twarn(\"[Roblox MCP] Connector stopped: \" .. tostring(RuntimeError))\n"
            + "\tend\n"
            + "\n"
            + "\tgetgenv().MCP_Loaded = false\n"
            + "\n"
            + "\ttask.wait(2)\n"
            + "end";
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("Roblox MCP executor loader", loader));
        toast("Executor connection code copied");
    }

    private void copyPcRelayArguments() {
        if (!lanModeCheckbox.isChecked()) {
            showMessage("Enable LAN relay first", "Select “Allow trusted LAN relay,” stop/start the bridge, then copy the PC arguments.");
            return;
        }
        String ip = findLanIpv4Address();
        if (ip == null) {
            showMessage("LAN address unavailable", "Connect the phone and PC to the same Wi-Fi or private VPN, then try again.");
            return;
        }
        String arguments = "\"--baseurl\",\n\"http://" + ip + ":" + port() + "\",\n"
            + "\"--relay-token\",\n\"" + lanToken() + "\"";
        ClipboardManager clipboard = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("Roblox MCP PC relay arguments", arguments));
        toast("PC MCP relay arguments copied");
    }

    private void updateLanAddress() {
        if (!lanModeCheckbox.isChecked()) {
            lanAddressText.setText("LAN access disabled. The executor still uses 127.0.0.1.");
            return;
        }
        String ip = findLanIpv4Address();
        lanAddressText.setText(ip == null
            ? "No LAN IPv4 address found. Connect Wi-Fi or a private VPN."
            : "PC relay: http://" + ip + ":" + port() + "\nTrusted networks only. Never port-forward this address.");
    }

    private String lanExposure() {
        if (!lanModeCheckbox.isChecked()) return "";
        String ip = findLanIpv4Address();
        return ip == null ? "\nLAN relay: enabled; address unavailable" : "\nLAN relay: http://" + ip + ":" + port() + " (token required)";
    }

    private String lanToken() {
        String existing = preferences.getString("lanRelayToken", "");
        if (!existing.isEmpty()) return existing;
        byte[] bytes = new byte[24];
        new SecureRandom().nextBytes(bytes);
        String created = Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        preferences.edit().putString("lanRelayToken", created).apply();
        return created;
    }

    private static String findLanIpv4Address() {
        String fallback = null;
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface network = interfaces.nextElement();
                if (!network.isUp() || network.isLoopback()) continue;
                Enumeration<InetAddress> addresses = network.getInetAddresses();
                while (addresses.hasMoreElements()) {
                    InetAddress address = addresses.nextElement();
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress() || address.isLinkLocalAddress()) continue;
                    String value = address.getHostAddress();
                    String name = network.getName().toLowerCase();
                    if (name.startsWith("wlan") || name.startsWith("eth")) return value;
                    if (address.isSiteLocalAddress() && fallback == null) fallback = value;
                }
            }
        } catch (Exception ignored) {
            return null;
        }
        return fallback;
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
                .setPositiveButton("Download & install", (ignored, which) -> downloadManagerUpdate(result));
            else dialog.setPositiveButton("OK", null);
            dialog.show();
        }));
    }

    private void downloadManagerUpdate(ManagerUpdateChecker.Result result) {
        appendOutput("\nDownloading manager v" + result.version + " inside the app...");
        toast("Downloading and verifying update");
        ManagerUpdateChecker.download(this, result, (apk, error) -> runOnUiThread(() -> {
            if (error != null) {
                showMessage("Update download failed", error.getMessage());
                appendOutput("\nUpdate failed: " + error.getMessage());
                return;
            }
            appendOutput("\nUpdate downloaded and verified: " + result.digest);
            try {
                boolean installerOpened = ManagerUpdateChecker.beginInstall(this, apk);
                if (!installerOpened) {
                    appendOutput("\nAndroid opened “Install unknown apps.” Enable “Allow from this source,” then return; the verified update will open automatically.");
                    toast("Allow installs, then return to the manager");
                }
            } catch (Exception installError) {
                showMessage("Could not open Android installer", installError.getMessage());
            }
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

    private static String healthBase() {
        return "Node.js: EMBEDDED 18.17.1 ✓\n"
            + "Git: NOT REQUIRED — APK-managed updates\n"
            + "Repository: BUNDLED MCP v2.4.4\n"
            + "Tunnel: OFFICIAL OPENAI " + TunnelClient.VERSION + " ARM64 ✓";
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
