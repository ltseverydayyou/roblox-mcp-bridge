using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace RobloxMcpWebManager
{
    internal sealed class ProcResult
    {
        public int Code;
        public string Out = "";
        public string Error = "";
    }

    internal sealed class ManagerForm : Form
    {
        private readonly WebView2 web = new WebView2();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer();
        private readonly string appDir;
        private readonly string htmlPath;
        private readonly string configDir;
        private readonly string configPath;
        private Dictionary<string, object> config = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        private Process tunnelProcess;
        private Process bridgeProcess;
        private IntPtr bridgeJob = IntPtr.Zero;
        private System.Windows.Forms.Timer sourceUpdateTimer;
        private System.Windows.Forms.Timer managerUpdateTimer;
        private bool managerUpdateChecked;
        private string lastSourceNotificationKey = "";
        private string lastManagerNotificationKey = "";
        private string latestManagerVersion = "";
        private string latestManagerDownloadUrl = "";
        private string latestManagerSha256 = "";
        private long latestManagerSize;
        private bool closing;

        [DllImport("user32.dll")]
        private static extern IntPtr GetForegroundWindow();

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);

        [DllImport("kernel32.dll")]
        private static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);

        [DllImport("kernel32.dll")]
        private static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);

        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr hObject);

        [StructLayout(LayoutKind.Sequential)]
        private struct IO_COUNTERS
        {
            public ulong ReadOperationCount;
            public ulong WriteOperationCount;
            public ulong OtherOperationCount;
            public ulong ReadTransferCount;
            public ulong WriteTransferCount;
            public ulong OtherTransferCount;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
        {
            public long PerProcessUserTimeLimit;
            public long PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize;
            public UIntPtr MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass;
            public uint SchedulingClass;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
        {
            public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
            public IO_COUNTERS IoInfo;
            public UIntPtr ProcessMemoryLimit;
            public UIntPtr JobMemoryLimit;
            public UIntPtr PeakProcessMemoryUsed;
            public UIntPtr PeakJobMemoryUsed;
        }

        private const int JobObjectExtendedLimitInformation = 9;
        private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;

        public ManagerForm()
        {
            appDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
            htmlPath = Path.Combine(appDir, "manager.html");
            configDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RobloxMcpManager");
            configPath = Path.Combine(configDir, "web-manager-config.json");
            LoadConfig();

            Text = "Roblox MCP Manager";
            Width = 1080;
            Height = 740;
            MinimumSize = new System.Drawing.Size(900, 600);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = System.Drawing.Color.FromArgb(10, 10, 10);
            try { Icon = new System.Drawing.Icon(Path.Combine(appDir, "RobloxMcpManager.ico")); } catch { }

            web.Dock = DockStyle.Fill;
            Controls.Add(web);
            Shown += async (_, __) => await InitWebView();
            FormClosing += (_, __) => {
                closing = true;
                try { if (sourceUpdateTimer != null) { sourceUpdateTimer.Stop(); sourceUpdateTimer.Dispose(); } } catch { }
                try { if (managerUpdateTimer != null) { managerUpdateTimer.Stop(); managerUpdateTimer.Dispose(); } } catch { }
                TryStopTunnel();
                StopBridgeProcessTree();
                CloseBridgeJob();
            };
        }

        private async Task InitWebView()
        {
            try
            {
                var userData = Path.Combine(configDir, "WebView2");
                Directory.CreateDirectory(userData);
                var env = await CoreWebView2Environment.CreateAsync(null, userData);
                await web.EnsureCoreWebView2Async(env);
                web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                web.CoreWebView2.Settings.AreDevToolsEnabled = true;
                web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                web.CoreWebView2.Settings.IsZoomControlEnabled = false;
                web.CoreWebView2.WebMessageReceived += WebMessageReceived;
                web.CoreWebView2.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
                web.CoreWebView2.SetVirtualHostNameToFolderMapping("manager.local", appDir, CoreWebView2HostResourceAccessKind.Allow);
                web.CoreWebView2.Navigate("https://manager.local/manager.html");
            }
            catch (Exception ex)
            {
                MessageBox.Show(ex.ToString(), "Roblox MCP Manager", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void LoadConfig()
        {
            string repo = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "GitHub", "roblox-mcp-bridge");
            config["repository"] = repo;
            config["address"] = "localhost:16384";
            config["tunnelClient"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenAI", "TunnelClient", "tunnel-client.exe");
            config["profile"] = "roblox-executor";
            config["tunnelId"] = "";

            try
            {
                if (File.Exists(configPath))
                {
                    var saved = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(configPath, Encoding.UTF8));
                    foreach (var kv in saved) config[kv.Key] = kv.Value;
                    return;
                }

                string bundled = Environment.GetEnvironmentVariable("ROBLOX_MCP_MANAGER_CONFIG");
                var legacy = !String.IsNullOrWhiteSpace(bundled) && File.Exists(bundled)
                    ? bundled
                    : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "tidal wave", "RobloxMcpManager.config.json");
                if (File.Exists(legacy))
                {
                    var text = File.ReadAllText(legacy, Encoding.UTF8).TrimStart('\uFEFF');
                    var saved = json.Deserialize<Dictionary<string, object>>(text);
                    object v;
                    if (saved.TryGetValue("RepositoryDirectory", out v) && Directory.Exists(Convert.ToString(v))) config["repository"] = Convert.ToString(v);
                    if (saved.TryGetValue("TunnelClientExecutable", out v)) config["tunnelClient"] = Convert.ToString(v);
                    if (saved.TryGetValue("BridgeAddress", out v)) config["address"] = Convert.ToString(v);
                    if (saved.TryGetValue("ProfileName", out v)) config["profile"] = Convert.ToString(v);
                    if (saved.TryGetValue("TunnelId", out v)) config["tunnelId"] = Convert.ToString(v);
                }
            }
            catch { }

            if (Directory.Exists(repo) && File.Exists(Path.Combine(repo, "package.json"))) config["repository"] = repo;
            else if (!Directory.Exists(GetConfig("repository"))) config["repository"] = repo;
        }

        private string GetConfig(string key)
        {
            object v;
            return config.TryGetValue(key, out v) ? Convert.ToString(v) ?? "" : "";
        }

        private void SaveConfig()
        {
            Directory.CreateDirectory(configDir);
            File.WriteAllText(configPath, json.Serialize(config), new UTF8Encoding(false));
        }

        private void WebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                var msg = json.Deserialize<Dictionary<string, object>>(e.TryGetWebMessageAsString());
                string action = msg.ContainsKey("action") ? Convert.ToString(msg["action"]) : "";
                switch (action)
                {
                    case "ready":
                        SendConfig();
                        SendStatus();
                        _ = CheckManagerUpdateAsync();
                        EnsureUpdatePolling();
                        break;
                    case "status": SendStatus(); break;
                    case "checkSource": _ = CheckSourceAsync(true); break;
                    case "updateSource": _ = UpdateSourceAsync(); break;
                    case "startBridge": _ = StartBridgeAsync(); break;
                    case "stopBridge": _ = StopBridgeAsync(false); break;
                    case "reloadBridge": _ = ReloadBridgeAsync(); break;
                    case "copyLoader": CopyLoader(); break;
                    case "openDashboard": OpenDashboard(); break;
                    case "openGithub": OpenExternal("https://github.com/ltseverydayyou/roblox-mcp-bridge"); break;
                    case "openRelease": OpenExternal("https://github.com/ltseverydayyou/roblox-mcp-bridge/releases/latest"); break;
                    case "updateManager": _ = InstallManagerUpdateAsync(); break;
                    case "browseRepository": BrowseRepository(); break;
                    case "browseTunnel": BrowseTunnel(); break;
                    case "saveConfig": SaveConfigFromMessage(msg); break;
                    case "installEverything": _ = InstallRepairAsync(); break;
                    case "installTunnelClient": _ = InstallTunnelClientAsync(); break;
                    case "restartAdmin": RestartAsAdministrator(); break;
                    case "startTunnel": _ = StartTunnelAsync(msg); break;
                    case "stopTunnel": TryStopTunnel(); break;
                    case "configureTunnel": _ = ConfigureTunnelAsync(msg); break;
                }
            }
            catch (Exception ex) { Toast(ex.Message, "error", "error"); }
        }

        private void Send(object payload)
        {
            if (closing || IsDisposed) return;
            if (InvokeRequired)
            {
                try { BeginInvoke(new Action(() => Send(payload))); } catch { }
                return;
            }
            if (web.CoreWebView2 == null) return;
            string data = json.Serialize(payload);
            try { web.CoreWebView2.ExecuteScriptAsync("window.managerReceive(" + data + ");"); }
            catch { }
        }

        private void Toast(string message, string level = "info", string logLevel = "info", string actionText = "", string action = "")
        {
            Send(new Dictionary<string, object> {
                ["type"] = "toast", ["message"] = message, ["level"] = level,
                ["logLevel"] = logLevel, ["actionText"] = actionText, ["action"] = action
            });
        }

        private void EnsureUpdatePolling()
        {
            if (sourceUpdateTimer == null)
            {
                sourceUpdateTimer = new System.Windows.Forms.Timer { Interval = 5 * 60 * 1000 };
                sourceUpdateTimer.Tick += (_, __) => _ = CheckSourceAsync(true);
                sourceUpdateTimer.Start();
            }
            if (managerUpdateTimer == null)
            {
                managerUpdateTimer = new System.Windows.Forms.Timer { Interval = 15 * 60 * 1000 };
                managerUpdateTimer.Tick += (_, __) => {
                    managerUpdateChecked = false;
                    _ = CheckManagerUpdateAsync();
                };
                managerUpdateTimer.Start();
            }
        }

        private void DeliverUpdateNotification(string title, string message, string actionText = "", string action = "")
        {
            if (closing || IsDisposed) return;
            if (InvokeRequired)
            {
                try { BeginInvoke(new Action(() => DeliverUpdateNotification(title, message, actionText, action))); } catch { }
                return;
            }

            IntPtr foregroundHwnd = GetForegroundWindow();
            bool focused = Visible && !IsIconic(Handle) && foregroundHwnd == Handle;
            if (focused)
            {
                Toast(message, "info", "warn", actionText, action);
                return;
            }

            try
            {
                ShowWindowsToast(title, message);
            }
            catch
            {
                Toast(message, "info", "warn", actionText, action);
            }
        }

        private void ShowWindowsToast(string title, string message)
        {
            Task.Run(() => {
                try
                {
                    string safeTitle = (title ?? "Roblox MCP Manager").Replace("'", "''").Replace("\r", " ").Replace("\n", " ");
                    string safeMessage = (message ?? "").Replace("'", "''").Replace("\r", " ").Replace("\n", " ");
                    string script =
                        "$ErrorActionPreference='SilentlyContinue';" +
                        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null;" +
                        "$template=[Windows.UI.Notifications.ToastTemplateType]::ToastText02;" +
                        "$xml=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent($template);" +
                        "$nodes=$xml.GetElementsByTagName('text');" +
                        "$null=$nodes.Item(0).AppendChild($xml.CreateTextNode('" + safeTitle + "'));" +
                        "$null=$nodes.Item(1).AppendChild($xml.CreateTextNode('" + safeMessage + "'));" +
                        "$toast=[Windows.UI.Notifications.ToastNotification]::new($xml);" +
                        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Roblox MCP Manager').Show($toast);";
                    string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
                    Run("powershell.exe", "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand " + encoded, appDir, 10000);
                }
                catch { }
            });
        }

        private void SendConfig()
        {
            Send(new Dictionary<string, object> {
                ["type"]="config", ["repository"]=GetConfig("repository"), ["address"]=GetConfig("address"),
                ["tunnelClient"]=GetConfig("tunnelClient"), ["profile"]=GetConfig("profile"), ["tunnelId"]=GetConfig("tunnelId")
            });
        }

        private void SendStatus()
        {
            Task.Run(() => {
                string repo = GetConfig("repository");
                string version = "v?";
                try
                {
                    string package = File.ReadAllText(Path.Combine(repo, "package.json"));
                    var p = json.Deserialize<Dictionary<string, object>>(package);
                    if (p.ContainsKey("version")) version = "v" + Convert.ToString(p["version"]);
                }
                catch { }
                string git = Run("git.exe", "--version", repo, 5000).Out.Replace("git version ", "").Trim();
                string node = Run("node.exe", "--version", repo, 5000).Out.Trim();
                string branch = Run("git.exe", "branch --show-current", repo, 5000).Out.Trim();
                string commit = Run("git.exe", "rev-parse --short=8 HEAD", repo, 5000).Out.Trim();
                bool buildReady = File.Exists(Path.Combine(repo, "dist", "index.js"));
                bool bridgeRunning = IsPortOpen(GetPort(), 180);
                Send(new Dictionary<string, object> {
                    ["type"]="status", ["version"]=version, ["git"]=git, ["node"]=node, ["branch"]=branch,
                    ["commit"]=commit, ["buildReady"]=buildReady, ["bridgeRunning"]=bridgeRunning, ["address"]=GetConfig("address")
                });
                Send(new Dictionary<string, object> { ["type"]="bridge", ["running"]=bridgeRunning });
            });
        }

        private async Task CheckManagerUpdateAsync()
        {
            if (managerUpdateChecked) return;
            managerUpdateChecked = true;

            await Task.Run(() => {
                try
                {
                    ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                    using (var client = new WebClient())
                    {
                        string installed = GetInstalledVersion();
                        client.Headers[HttpRequestHeader.UserAgent] = "RobloxMcpManager/" + installed;
                        client.Headers[HttpRequestHeader.Accept] = "application/vnd.github+json";
                        string releaseJson = client.DownloadString("https://api.github.com/repos/ltseverydayyou/roblox-mcp-bridge/releases/latest");
                        var release = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(releaseJson);
                        string tag = release.ContainsKey("tag_name") ? Convert.ToString(release["tag_name"]) : "";
                        string latest = tag.TrimStart('v', 'V');
                        bool newerVersion = IsVersionNewer(latest, installed);
                        bool sameVersionAssetRefresh = false;
                        latestManagerVersion = latest;
                        latestManagerDownloadUrl = "";
                        latestManagerSha256 = "";
                        latestManagerSize = 0;

                        if (release.ContainsKey("assets"))
                        {
                            object[] assets = release["assets"] as object[];
                            Dictionary<string, object> chosen = null;
                            string expectedName = "RobloxMcpManager-v" + latest + ".exe";
                            if (assets != null)
                            {
                                foreach (object raw in assets)
                                {
                                    var asset = raw as Dictionary<string, object>;
                                    if (asset == null) continue;
                                    string name = asset.ContainsKey("name") ? Convert.ToString(asset["name"]) : "";
                                    if (String.Equals(name, expectedName, StringComparison.OrdinalIgnoreCase)) { chosen = asset; break; }
                                    if (chosen == null && name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && name.IndexOf("RobloxMcpManager", StringComparison.OrdinalIgnoreCase) >= 0) chosen = asset;
                                }
                            }
                            if (chosen != null)
                            {
                                string digest = chosen.ContainsKey("digest") ? Convert.ToString(chosen["digest"]) : "";
                                latestManagerDownloadUrl = chosen.ContainsKey("browser_download_url") ? Convert.ToString(chosen["browser_download_url"]) : "";
                                latestManagerSize = chosen.ContainsKey("size") ? Convert.ToInt64(chosen["size"]) : 0;
                                if (digest.StartsWith("sha256:", StringComparison.OrdinalIgnoreCase)) latestManagerSha256 = digest.Substring(7).Trim().ToLowerInvariant();
                                if (String.Equals(latest, installed, StringComparison.OrdinalIgnoreCase) && latestManagerSha256.Length == 64)
                                {
                                    string localHash = Sha256File(GetManagerExecutablePath());
                                    if (!String.IsNullOrWhiteSpace(localHash) && !String.Equals(latestManagerSha256, localHash, StringComparison.OrdinalIgnoreCase)) sameVersionAssetRefresh = true;
                                }
                            }
                        }

                        if (newerVersion || sameVersionAssetRefresh)
                        {
                            string notificationKey = latest + ":" + latestManagerSha256;
                            if (!String.Equals(lastManagerNotificationKey, notificationKey, StringComparison.OrdinalIgnoreCase))
                            {
                                lastManagerNotificationKey = notificationKey;
                                string title = "Roblox MCP Manager update available";
                                string message = newerVersion ? "Manager v" + latest + " is available." : "A refreshed v" + installed + " manager build is available.";
                                DeliverUpdateNotification(title, message, "Update app", "updateManager");
                            }
                        }
                        else lastManagerNotificationKey = "";
                    }
                }
                catch { }
            });
        }

        private async Task InstallManagerUpdateAsync()
        {
            string target = GetManagerExecutablePath();
            if (String.IsNullOrWhiteSpace(latestManagerDownloadUrl) || latestManagerSha256.Length != 64 || !File.Exists(target))
            {
                managerUpdateChecked = false;
                Toast("No verified manager update is ready to install yet. Checking again...", "info", "info");
                await CheckManagerUpdateAsync();
                return;
            }

            Toast("Downloading and verifying Roblox MCP Manager v" + latestManagerVersion + "...", "info", "info");
            await Task.Run(() => {
                string download = Path.Combine(configDir, ".manager-update-" + Guid.NewGuid().ToString("N") + ".exe");
                try
                {
                    Directory.CreateDirectory(configDir);
                    ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
                    using (var client = new WebClient())
                    {
                        client.Headers[HttpRequestHeader.UserAgent] = "RobloxMcpManager/" + GetInstalledVersion();
                        client.DownloadFile(latestManagerDownloadUrl, download);
                    }
                    var info = new FileInfo(download);
                    if (!info.Exists || info.Length < 50000) throw new InvalidOperationException("The downloaded manager is unexpectedly small.");
                    if (latestManagerSize > 0 && info.Length != latestManagerSize) throw new InvalidOperationException("The manager download size does not match GitHub release metadata.");
                    string hash = Sha256File(download);
                    if (!String.Equals(hash, latestManagerSha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("The manager SHA-256 verification failed.");
                    byte[] header = File.ReadAllBytes(download);
                    if (header.Length < 2 || header[0] != 0x4D || header[1] != 0x5A) throw new InvalidOperationException("The verified download is not a Windows executable.");

                    int parentPid = 0;
                    Int32.TryParse(Environment.GetEnvironmentVariable("ROBLOX_MCP_MANAGER_PARENT_PID"), out parentPid);
                    int hostPid = Process.GetCurrentProcess().Id;
                    string backup = target + ".previous-v" + GetInstalledVersion() + "-" + Guid.NewGuid().ToString("N") + ".exe";
                    string updater =
                        "$ErrorActionPreference='Stop';" +
                        "$hostPid=" + hostPid + ";$parentPid=" + parentPid + ";" +
                        "foreach($pid in @($hostPid,$parentPid)){if($pid -gt 0){try{Wait-Process -Id $pid -Timeout 30 -ErrorAction SilentlyContinue}catch{}}};" +
                        "$target=" + PsQuote(target) + ";$download=" + PsQuote(download) + ";$backup=" + PsQuote(backup) + ";" +
                        "if(Test-Path -LiteralPath $target){Move-Item -LiteralPath $target -Destination $backup -Force};" +
                        "Move-Item -LiteralPath $download -Destination $target -Force;Start-Process -FilePath $target";
                    var psi = new ProcessStartInfo("powershell.exe", "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command " + Quote(updater)) { UseShellExecute=false, CreateNoWindow=true };
                    Process.Start(psi);
                    BeginInvoke(new Action(() => Close()));
                }
                catch (Exception ex)
                {
                    try { if (File.Exists(download)) File.Delete(download); } catch { }
                    Toast("Manager update failed: " + ex.Message, "error", "error");
                }
            });
        }

        private string GetManagerExecutablePath()
        {
            string p = Environment.GetEnvironmentVariable("ROBLOX_MCP_MANAGER_EXE");
            return !String.IsNullOrWhiteSpace(p) ? p : Application.ExecutablePath;
        }

        private static string PsQuote(string value)
        {
            return "'" + (value ?? "").Replace("'", "''") + "'";
        }

        private string GetInstalledVersion()
        {
            string env = Environment.GetEnvironmentVariable("ROBLOX_MCP_MANAGER_VERSION");
            if (!String.IsNullOrWhiteSpace(env)) return env.TrimStart('v', 'V');
            try
            {
                string package = File.ReadAllText(Path.Combine(GetConfig("repository"), "package.json"));
                var parsed = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(package);
                if (parsed.ContainsKey("version")) return Convert.ToString(parsed["version"]).TrimStart('v', 'V');
            }
            catch { }
            return "0.0.0";
        }

        private static bool IsVersionNewer(string candidate, string current)
        {
            Version a, b;
            if (!Version.TryParse(candidate, out a) || !Version.TryParse(current, out b)) return false;
            return a > b;
        }

        private static string Sha256File(string path)
        {
            try
            {
                using (var sha = SHA256.Create())
                using (var stream = File.OpenRead(path))
                {
                    byte[] hash = sha.ComputeHash(stream);
                    var sb = new StringBuilder(hash.Length * 2);
                    foreach (byte b in hash) sb.Append(b.ToString("x2"));
                    return sb.ToString();
                }
            }
            catch { return ""; }
        }

        private async Task CheckSourceAsync(bool notify)
        {
            string repo = GetConfig("repository");
            SendSource("Checking origin/main...", "Contacting GitHub and comparing revisions", "busy", "CHECKING", 0.08, true, "Checking...", "checkSource");
            await Task.Run(() => {
                var fetch = Run("git.exe", "fetch --quiet origin main", repo, 30000);
                if (fetch.Code != 0)
                {
                    SendSource("Could not verify the MCP source.", CleanError(fetch), "bad", "CHECK FAILED", 0, false, "Retry", "checkSource");
                    if (notify) Toast("MCP source check failed", "error", "error");
                    return;
                }
                string local = Run("git.exe", "rev-parse --short=8 HEAD", repo, 5000).Out.Trim();
                string remote = Run("git.exe", "rev-parse --short=8 FETCH_HEAD", repo, 5000).Out.Trim();
                string countsText = Run("git.exe", "rev-list --left-right --count HEAD...FETCH_HEAD", repo, 5000).Out.Trim();
                string[] counts = countsText.Split(new[] {' ', '\t'}, StringSplitOptions.RemoveEmptyEntries);
                int ahead = counts.Length > 0 ? ParseInt(counts[0]) : 0;
                int behind = counts.Length > 1 ? ParseInt(counts[1]) : 0;
                string tree = String.IsNullOrWhiteSpace(Run("git.exe", "status --porcelain", repo, 5000).Out) ? "Clean" : "Modified";
                if (behind > 0)
                {
                    string detail = behind + " remote commit" + (behind == 1 ? "" : "s") + " available" + (ahead > 0 ? "; " + ahead + " local-only" : "");
                    SendSource("A newer MCP source is available.", detail, "warn", "UPDATE AVAILABLE", .18, false, "Update MCP", "updateSource", local, remote, tree);
                    if (notify && !String.Equals(lastSourceNotificationKey, remote, StringComparison.OrdinalIgnoreCase))
                    {
                        lastSourceNotificationKey = remote;
                        DeliverUpdateNotification(
                            "MCP source update available",
                            behind + " new commit" + (behind == 1 ? "" : "s") + " available on origin/main.",
                            "Update MCP",
                            "updateSource");
                    }
                }
                else
                {
                    lastSourceNotificationKey = "";
                    string detail = ahead > 0 ? "No remote update; " + ahead + " local-only commit" + (ahead == 1 ? "" : "s") : "origin/main matches your installed checkout";
                    SendSource("MCP source is already up to date.", detail, "good", "UP TO DATE", 1, false, "Check again", "checkSource", local, remote, tree);
                }
            });
        }

        private async Task UpdateSourceAsync()
        {
            string repo = GetConfig("repository");
            SendSource("Updating MCP source...", "Downloading source from origin/main", "busy", "UPDATING", .18, true, "Updating...", "updateSource");
            await Task.Run(() => {
                var pull = Run("git.exe", "pull --ff-only", repo, 60000);
                if (pull.Code != 0) { SendSource("MCP update failed.", CleanError(pull), "bad", "UPDATE FAILED", 0, false, "Retry", "checkSource"); Toast("MCP source update failed", "error", "error"); return; }
                SendSource("Updating MCP source...", "Source downloaded; rebuilding bridge", "busy", "BUILDING", .62, true, "Building...", "updateSource");
                string updater = Path.Combine(repo, "scripts", "install-harnesses.mjs");
                var build = Run("node.exe", Quote(updater) + " --update --yes --plain --server-root " + Quote(repo), repo, 180000);
                if (build.Code != 0) { SendSource("MCP rebuild failed.", CleanError(build), "bad", "BUILD FAILED", .62, false, "Retry", "checkSource"); Toast("MCP rebuild failed", "error", "error"); return; }
                SendSource("MCP update complete.", "Source downloaded and bridge build refreshed", "good", "UPDATED", 1, false, "Check again", "checkSource");
                Toast("MCP source updated successfully", "success", "ok");
                SendStatus();
                _ = CheckSourceAsync(false);
            });
        }

        private void SendSource(string title, string detail, string state, string badge, double progress, bool disabled, string actionText, string action, string local = null, string remote = null, string tree = null)
        {
            var d = new Dictionary<string, object> { ["type"]="source", ["title"]=title, ["detail"]=detail, ["state"]=state, ["badge"]=badge, ["progress"]=progress, ["disabled"]=disabled, ["actionText"]=actionText, ["action"]=action };
            if (local != null) d["local"] = local; if (remote != null) d["remote"] = remote; if (tree != null) d["tree"] = tree;
            Send(d);
        }

        private async Task StartBridgeAsync()
        {
            if (IsPortOpen(GetPort(), 180)) { Toast("Bridge is already running", "success", "ok"); SendStatus(); return; }
            string repo = GetConfig("repository");
            string entry = Path.Combine(repo, "dist", "index.js");
            if (!File.Exists(entry)) { Toast("Bridge build is missing. Run Install / repair first.", "error", "error"); return; }
            await Task.Run(() => {
                try
                {
                    var psi = new ProcessStartInfo("node.exe", Quote(entry)) { WorkingDirectory=repo, UseShellExecute=false, CreateNoWindow=true };
                    psi.EnvironmentVariables["ROBLOX_MCP_HOST"] = GetConfig("address").StartsWith("localhost", StringComparison.OrdinalIgnoreCase) ? "127.0.0.1" : "0.0.0.0";
                    psi.EnvironmentVariables["ROBLOX_MCP_PORT"] = GetPort().ToString();
                    bridgeProcess = Process.Start(psi);
                    AttachBridgeToKillOnCloseJob(bridgeProcess);
                    Thread.Sleep(1000);
                    bool running = IsPortOpen(GetPort(), 300);
                    Send(new Dictionary<string, object> { ["type"]="bridge", ["running"]=running });
                    Toast(running ? "Bridge started" : "Bridge process started but the dashboard did not respond", running ? "success" : "error", running ? "ok" : "error");
                }
                catch (Exception ex) { Toast(ex.Message, "error", "error"); }
            });
        }

        private async Task ReloadBridgeAsync()
        {
            await StopBridgeAsync(true);
            await StartBridgeAsync();
        }

        private async Task StopBridgeAsync(bool quiet)
        {
            await Task.Run(() => {
                try
                {
                    StopBridgeProcessTree();
                    Send(new Dictionary<string, object> { ["type"]="bridge", ["running"]=false });
                    if (!quiet) Toast("Bridge stopped", "success", "ok");
                }
                catch (Exception ex) { if (!quiet) Toast(ex.Message, "error", "error"); }
            });
        }

        private void AttachBridgeToKillOnCloseJob(Process process)
        {
            if (process == null) return;
            CloseBridgeJob();
            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return;

            int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr infoPtr = Marshal.AllocHGlobal(size);
            try
            {
                var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                Marshal.StructureToPtr(info, infoPtr, false);
                if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, infoPtr, (uint)size) ||
                    !AssignProcessToJobObject(job, process.Handle))
                {
                    CloseHandle(job);
                    return;
                }
                bridgeJob = job;
            }
            finally
            {
                Marshal.FreeHGlobal(infoPtr);
            }
        }

        private void CloseBridgeJob()
        {
            IntPtr job = bridgeJob;
            bridgeJob = IntPtr.Zero;
            if (job != IntPtr.Zero)
            {
                try { CloseHandle(job); } catch { }
            }
        }

        private void StopBridgeProcessTree()
        {
            int port = GetPort();
            int pid = 0;
            try
            {
                if (bridgeProcess != null && !bridgeProcess.HasExited) pid = bridgeProcess.Id;
            }
            catch { }

            if (pid > 0)
                Run("taskkill.exe", "/PID " + pid + " /T /F", GetConfig("repository"), 10000);

            CloseBridgeJob();

            try
            {
                if (bridgeProcess != null)
                {
                    if (!bridgeProcess.HasExited) bridgeProcess.WaitForExit(3000);
                    bridgeProcess.Dispose();
                }
            }
            catch { }
            bridgeProcess = null;

            string script = "$c=Get-NetTCPConnection -State Listen -LocalPort " + port + " -ErrorAction SilentlyContinue; foreach($x in $c){$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$x.OwningProcess) -ErrorAction SilentlyContinue; if($p -and $p.Name -eq 'node.exe' -and $p.CommandLine -match 'dist[\\/]index\\.js'){Stop-Process -Id $x.OwningProcess -Force -ErrorAction SilentlyContinue}}";
            Run("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -Command " + Quote(script), GetConfig("repository"), 10000);
        }

        private void CopyLoader()
        {
            string address = GetConfig("address"); if (address == "localhost:16384") address = "127.0.0.1:16384";
            string loader = "getgenv().BridgeURL = \"" + address + "\"\r\n\r\nif getgenv().MCP_AutoReconnect then\r\n    return\r\nend\r\n\r\ngetgenv().MCP_AutoReconnect = true\r\n\r\nwhile getgenv().MCP_AutoReconnect do\r\n    local Success, Source = pcall(function()\r\n        return game:HttpGet(\"http://\" .. getgenv().BridgeURL .. \"/script.luau\")\r\n    end)\r\n\r\n    if not Success or type(Source) ~= \"string\" or Source == \"\" then\r\n        task.wait(2)\r\n        continue\r\n    end\r\n\r\n    local Bridge = loadstring(Source)\r\n    if not Bridge then\r\n        task.wait(2)\r\n        continue\r\n    end\r\n\r\n    getgenv().MCP_Loaded = false\r\n    pcall(Bridge)\r\n    getgenv().MCP_Loaded = false\r\n    task.wait(2)\r\nend";
            Clipboard.SetText(loader);
            Toast("Roblox loader copied to clipboard", "success", "ok");
        }

        private void OpenDashboard() { OpenExternal("http://" + GetConfig("address") + "/"); }
        private void OpenExternal(string url) { try { Process.Start(url); } catch { } }

        private void BrowseRepository()
        {
            using (var d = new FolderBrowserDialog()) { d.SelectedPath = Directory.Exists(GetConfig("repository")) ? GetConfig("repository") : Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments); if (d.ShowDialog(this) == DialogResult.OK) Send(new Dictionary<string, object>{{"type","path"},{"target","repository"},{"value",d.SelectedPath}}); }
        }
        private void BrowseTunnel()
        {
            using (var d = new OpenFileDialog()) { d.Filter="Tunnel client (tunnel-client.exe)|tunnel-client.exe|Executables (*.exe)|*.exe"; if (File.Exists(GetConfig("tunnelClient"))) d.FileName=GetConfig("tunnelClient"); if (d.ShowDialog(this)==DialogResult.OK) Send(new Dictionary<string, object>{{"type","path"},{"target","tunnel"},{"value",d.FileName}}); }
        }

        private void SaveConfigFromMessage(Dictionary<string, object> msg)
        {
            foreach (string k in new[] {"repository","address","tunnelClient","profile","tunnelId"}) if (msg.ContainsKey(k)) config[k] = Convert.ToString(msg[k]);
            SaveConfig(); SendConfig(); SendStatus(); Toast("Manager configuration saved", "success", "ok");
        }

        private async Task InstallRepairAsync()
        {
            Toast("Checking Windows prerequisites and repairing the MCP...", "info", "info");
            await Task.Run(() => {
                try
                {
                    RefreshProcessPath();
                    if (Run("git.exe", "--version", Environment.CurrentDirectory, 5000).Code != 0)
                    {
                        Toast("Git is missing. Installing Git with Windows Package Manager...", "info", "info");
                        var gitInstall = Run("winget.exe", "install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements --silent", Environment.CurrentDirectory, 180000);
                        if (gitInstall.Code != 0) { Toast("Git installation failed: " + CleanError(gitInstall), "error", "error"); return; }
                        RefreshProcessPath();
                    }
                    if (Run("node.exe", "--version", Environment.CurrentDirectory, 5000).Code != 0)
                    {
                        Toast("Node.js LTS is missing. Installing it with Windows Package Manager...", "info", "info");
                        var nodeInstall = Run("winget.exe", "install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements --silent", Environment.CurrentDirectory, 180000);
                        if (nodeInstall.Code != 0) { Toast("Node.js installation failed: " + CleanError(nodeInstall), "error", "error"); return; }
                        RefreshProcessPath();
                    }

                    string repo = GetConfig("repository");
                    if (!File.Exists(Path.Combine(repo, "package.json")))
                    {
                        string parent = Path.GetDirectoryName(repo);
                        if (String.IsNullOrWhiteSpace(parent)) throw new InvalidOperationException("The repository path is invalid.");
                        Directory.CreateDirectory(parent);
                        if (Directory.Exists(repo) && Directory.GetFileSystemEntries(repo).Length > 0) throw new InvalidOperationException("The selected repository folder is not empty and is not a Roblox MCP checkout.");
                        if (Directory.Exists(repo)) Directory.Delete(repo, true);
                        Toast("Cloning the Roblox MCP repository...", "info", "info");
                        var clone = Run("git.exe", "clone https://github.com/ltseverydayyou/roblox-mcp-bridge.git " + Quote(repo), parent, 180000);
                        if (clone.Code != 0) { Toast("Repository clone failed: " + CleanError(clone), "error", "error"); return; }
                    }

                    Toast("Installing dependencies...", "info", "info");
                    var install = Run("npm.cmd", "install --ignore-scripts", repo, 180000);
                    if (install.Code != 0) { Toast("npm install failed: " + CleanError(install), "error", "error"); return; }
                    Toast("Building the MCP...", "info", "info");
                    var build = Run("npm.cmd", "run build", repo, 180000);
                    if (build.Code != 0) { Toast("MCP build failed: " + CleanError(build), "error", "error"); return; }
                    Toast("MCP dependencies and build are ready", "success", "ok");
                    SendStatus();
                }
                catch (Exception ex) { Toast(ex.Message, "error", "error"); }
            });
        }

        private async Task InstallTunnelClientAsync()
        {
            string repo = GetConfig("repository");
            string script = Path.Combine(repo, "scripts", "install-tunnel-client.ps1");
            if (!File.Exists(script)) { Toast("Install or repair the MCP repository first.", "error", "warn"); return; }
            Toast("Downloading and verifying OpenAI tunnel-client...", "info", "info");
            await Task.Run(() => {
                string installDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "OpenAI", "TunnelClient");
                var result = Run("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File " + Quote(script) + " -InstallDirectory " + Quote(installDir), repo, 180000);
                if (result.Code != 0) { Toast("Tunnel client installation failed: " + CleanError(result), "error", "error"); return; }
                string exe = Path.Combine(installDir, "tunnel-client.exe");
                if (!File.Exists(exe)) { Toast("Tunnel installer completed but tunnel-client.exe was not found.", "error", "error"); return; }
                config["tunnelClient"] = exe;
                SaveConfig();
                SendConfig();
                Toast("OpenAI tunnel client is ready", "success", "ok");
            });
        }

        private void RestartAsAdministrator()
        {
            try
            {
                var psi = new ProcessStartInfo(GetManagerExecutablePath()) { UseShellExecute = true, Verb = "runas" };
                Process.Start(psi);
                Close();
            }
            catch (Exception ex) { Toast("Could not restart as administrator: " + ex.Message, "error", "error"); }
        }

        private static void RefreshProcessPath()
        {
            string machine = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.Machine) ?? "";
            string user = Environment.GetEnvironmentVariable("Path", EnvironmentVariableTarget.User) ?? "";
            Environment.SetEnvironmentVariable("Path", machine + ";" + user, EnvironmentVariableTarget.Process);
        }

        private async Task StartTunnelAsync(Dictionary<string, object> msg)
        {
            if (tunnelProcess != null && !tunnelProcess.HasExited) { Toast("Tunnel is already running", "success", "ok"); return; }
            string exe=GetConfig("tunnelClient"); if(!File.Exists(exe)){Toast("tunnel-client.exe was not found","error","error");return;}
            string key=msg.ContainsKey("runtimeKey")?Convert.ToString(msg["runtimeKey"]):""; string profile=GetConfig("profile");
            await Task.Run(()=>{
                try {
                    var psi=new ProcessStartInfo(exe,"run --profile "+Quote(profile)){WorkingDirectory=GetConfig("repository"),UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true};
                    if(!String.IsNullOrWhiteSpace(key)) psi.EnvironmentVariables["CONTROL_PLANE_API_KEY"]=key;
                    tunnelProcess=new Process{StartInfo=psi,EnableRaisingEvents=true};
                    tunnelProcess.OutputDataReceived+=(s,e)=>{if(!String.IsNullOrWhiteSpace(e.Data))Send(new Dictionary<string,object>{{"type","tunnelLog"},{"line",e.Data}});};
                    tunnelProcess.ErrorDataReceived+=(s,e)=>{if(!String.IsNullOrWhiteSpace(e.Data))Send(new Dictionary<string,object>{{"type","tunnelLog"},{"line","ERROR: "+e.Data}});};
                    tunnelProcess.Exited+=(s,e)=>{Send(new Dictionary<string,object>{{"type","tunnel"},{"running",false}});Send(new Dictionary<string,object>{{"type","tunnelLog"},{"line","Tunnel exited with code "+tunnelProcess.ExitCode}});};
                    tunnelProcess.Start(); tunnelProcess.BeginOutputReadLine(); tunnelProcess.BeginErrorReadLine();
                    Send(new Dictionary<string,object>{{"type","tunnel"},{"running",true}}); Toast("ChatGPT tunnel started","success","ok");
                } catch(Exception ex){Toast(ex.Message,"error","error");}
            });
        }

        private void TryStopTunnel()
        {
            try { if(tunnelProcess!=null&&!tunnelProcess.HasExited){tunnelProcess.Kill();tunnelProcess.WaitForExit(3000);} } catch { }
            Send(new Dictionary<string,object>{{"type","tunnel"},{"running",false}}); if(!closing)Toast("ChatGPT tunnel stopped","success","ok");
        }

        private async Task ConfigureTunnelAsync(Dictionary<string, object> msg)
        {
            string repo=GetConfig("repository"), script=Path.Combine(repo,"scripts","setup-chatgpt-tunnel.ps1");
            if(!File.Exists(script)){Toast("Tunnel setup script is missing","error","error");return;}
            if(String.IsNullOrWhiteSpace(GetConfig("tunnelId"))){Toast("Enter a tunnel ID in Setup first","error","warn");return;}
            string key=msg.ContainsKey("runtimeKey")?Convert.ToString(msg["runtimeKey"]):"";
            if(String.IsNullOrWhiteSpace(key)){Toast("Enter the runtime API key in Setup first","error","warn");return;}
            Toast("Configuring ChatGPT tunnel profile...","info","info");
            await Task.Run(()=>{
                string args="-NoProfile -ExecutionPolicy Bypass -File "+Quote(script)+" -SkipProjectSetup -NoPathPrompts -NoStartPrompt -RepositoryDirectory "+Quote(repo)+" -TunnelClientExecutable "+Quote(GetConfig("tunnelClient"))+" -BridgeAddress "+Quote(GetConfig("address"))+" -ProfileName "+Quote(GetConfig("profile"))+" -TunnelId "+Quote(GetConfig("tunnelId"));
                var env=new Dictionary<string,string>{{"CONTROL_PLANE_API_KEY",key}}; var r=Run("powershell.exe",args,repo,120000,env); if(r.Code!=0)Toast("Tunnel configuration failed: "+CleanError(r),"error","error");else Toast("ChatGPT tunnel profile configured","success","ok");
            });
        }

        private int GetPort()
        {
            string a=GetConfig("address"); int i=a.LastIndexOf(':'); int p; return i>=0&&Int32.TryParse(a.Substring(i+1),out p)?p:16384;
        }
        private static bool IsPortOpen(int port,int timeout)
        {
            try { using(var c=new TcpClient()){var ar=c.BeginConnect("127.0.0.1",port,null,null);bool ok=ar.AsyncWaitHandle.WaitOne(timeout);if(!ok)return false;c.EndConnect(ar);return true;} } catch{return false;}
        }
        private static int ParseInt(string s){int x;return Int32.TryParse(s,out x)?x:0;}
        private static string Quote(string s){return "\""+(s??"").Replace("\"","\\\"")+"\"";}
        private static string CleanError(ProcResult r){string s=String.IsNullOrWhiteSpace(r.Error)?r.Out:r.Error;return String.IsNullOrWhiteSpace(s)?"No output returned":s.Trim();}

        private static ProcResult Run(string file,string args,string cwd,int timeout,Dictionary<string,string> env=null)
        {
            var r=new ProcResult(); try { var psi=new ProcessStartInfo(file,args){WorkingDirectory=String.IsNullOrWhiteSpace(cwd)?Environment.CurrentDirectory:cwd,UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true}; if(env!=null)foreach(var kv in env)psi.EnvironmentVariables[kv.Key]=kv.Value; using(var p=new Process{StartInfo=psi}){p.Start();string o=p.StandardOutput.ReadToEnd(),e=p.StandardError.ReadToEnd();if(!p.WaitForExit(timeout)){try{p.Kill();}catch{}r.Code=-1;r.Error="Operation timed out";}else{r.Code=p.ExitCode;r.Out=o;r.Error=e;}} } catch(Exception ex){r.Code=-1;r.Error=ex.Message;} return r;
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ManagerForm());
        }
    }
}
