#requires -Version 5.1

[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot "RobloxMcpManager.config.json")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:RepositoryUrl = "https://github.com/ltseverydayyou/roblox-mcp-bridge.git"
$script:RemoteManifestUrl = "https://raw.githubusercontent.com/ltseverydayyou/roblox-mcp-bridge/main/package.json"
$script:ChatGptPluginsUrl = "https://chatgpt.com/plugins"
$script:ConfigFile = [System.IO.Path]::GetFullPath($ConfigPath)
$script:PromptedForUpdate = $false
$script:Busy = $false

function Add-Log {
    param([string]$Message, [string]$Level = "INFO")
    $line = "[$((Get-Date).ToString('HH:mm:ss'))] [$Level] $Message"
    if ($null -ne $script:LogBox) {
        $script:LogBox.AppendText($line + [Environment]::NewLine)
        $script:LogBox.SelectionStart = $script:LogBox.TextLength
        $script:LogBox.ScrollToCaret()
        [System.Windows.Forms.Application]::DoEvents()
    }
}

function Show-FriendlyError {
    param([System.Exception]$Exception, [string]$Title = "Roblox MCP Manager")
    $message = $Exception.Message
    $adminHint = $message -match '(?i)access.*denied|administrator|elevation|0x80070005|unauthorized'
    $networkHint = $message -match '(?i)fetch|download|network|internet|resolve host|timed out|winget source'
    if ($adminHint) {
        $message += "`r`n`r`nWindows denied access. Click 'Restart as administrator', then try again."
    }
    elseif ($networkHint) {
        $message += "`r`n`r`nCheck your internet connection, proxy/firewall, GitHub access, and winget sources, then click Refresh."
    }
    Add-Log $message "ERROR"
    [System.Windows.Forms.MessageBox]::Show($message, $Title, 0, 16) | Out-Null
}

function Set-Busy {
    param([bool]$Value, [string]$Text = "")
    $script:Busy = $Value
    $script:ProgressBar.Style = if ($Value) { "Marquee" } else { "Blocks" }
    $script:ProgressBar.MarqueeAnimationSpeed = if ($Value) { 25 } else { 0 }
    if ($Text) { $script:ActionStatus.Text = $Text }
    [System.Windows.Forms.Application]::DoEvents()
}

function Read-ManagerConfig {
    $defaults = [ordered]@{
        RepositoryDirectory = ""
        TunnelClientExecutable = ""
        BridgeAddress = "localhost:16384"
        BindHost = "127.0.0.1"
        ProfileName = "roblox-executor"
        TunnelId = ""
    }
    if (Test-Path -LiteralPath $script:ConfigFile -PathType Leaf) {
        try {
            $saved = Get-Content -LiteralPath $script:ConfigFile -Raw | ConvertFrom-Json
            foreach ($name in @($defaults.Keys)) {
                if ($null -ne $saved.PSObject.Properties[$name]) { $defaults[$name] = [string]$saved.$name }
            }
        }
        catch { Add-Log "The saved configuration is invalid: $($_.Exception.Message)" "WARN" }
    }
    return $defaults
}

function Save-ManagerConfig {
    param($Config)
    $parent = Split-Path -Parent $script:ConfigFile
    try {
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        $Config | ConvertTo-Json | Set-Content -LiteralPath $script:ConfigFile -Encoding UTF8
    }
    catch [System.UnauthorizedAccessException] {
        $fallbackDirectory = Join-Path $env:LOCALAPPDATA "RobloxMcpManager"
        if (-not (Test-Path -LiteralPath $fallbackDirectory -PathType Container)) {
            New-Item -ItemType Directory -Path $fallbackDirectory -Force | Out-Null
        }
        $script:ConfigFile = Join-Path $fallbackDirectory "config.json"
        $Config | ConvertTo-Json | Set-Content -LiteralPath $script:ConfigFile -Encoding UTF8
        Add-Log "The EXE folder is read-only; settings will be stored at $script:ConfigFile" "WARN"
    }
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

function Find-Executable {
    param([string]$Name, [string[]]$Candidates = @())
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) { return $candidate }
    }
    return $null
}

function Find-Git {
    return Find-Executable "git.exe" @(
        (Join-Path $env:ProgramFiles "Git\cmd\git.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Git\cmd\git.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Git\cmd\git.exe")
    )
}

function Find-Node {
    return Find-Executable "node.exe" @(
        (Join-Path $env:ProgramFiles "nodejs\node.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
    )
}

function Find-Npm {
    $npm = Find-Executable "npm.cmd"
    if ($npm) { return $npm }
    $node = Find-Node
    if ($node) {
        $candidate = Join-Path (Split-Path -Parent $node) "npm.cmd"
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    return $null
}

function Find-Winget {
    return Find-Executable "winget.exe" @(
        (Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\winget.exe")
    )
}

function Test-RepositoryDirectory {
    param([string]$Directory)
    if ([string]::IsNullOrWhiteSpace($Directory)) { return $false }
    $manifest = Join-Path $Directory "package.json"
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { return $false }
    try { return (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).name -eq "roblox-mcp-server" } catch { return $false }
}

function Get-LocalVersion {
    param([string]$Directory)
    if (-not (Test-RepositoryDirectory $Directory)) { return $null }
    try { return [string](Get-Content -LiteralPath (Join-Path $Directory "package.json") -Raw | ConvertFrom-Json).version } catch { return $null }
}

function Get-RemoteVersion {
    try {
        $manifest = Invoke-RestMethod -Uri $script:RemoteManifestUrl -TimeoutSec 5 -Headers @{ "User-Agent" = "roblox-mcp-manager" }
        return [string]$manifest.version
    }
    catch {
        Add-Log "Update check could not fetch the release manifest: $($_.Exception.Message)" "WARN"
        return $null
    }
}

function Compare-VersionText {
    param([string]$Local, [string]$Remote)
    try { return ([version]$Remote).CompareTo([version]$Local) } catch { return 0 }
}

function Get-NodeVersion {
    $node = Find-Node
    if (-not $node) { return $null }
    try {
        $text = (& $node --version 2>$null).Trim().TrimStart("v")
        return [version]$text
    }
    catch { return $null }
}

function Normalize-BridgeAddress {
    param([string]$Value)
    $candidate = ([string]$Value).Trim().TrimEnd("/")
    if (-not $candidate) { $candidate = "localhost:16384" }
    if ($candidate -notmatch '^[a-z][a-z0-9+.-]*://') { $candidate = "http://$candidate" }
    try { $uri = [Uri]$candidate } catch { throw "Enter an address like localhost:16384 or 192.168.1.25:16384." }
    if ($uri.Scheme -notin @("http", "https") -or -not $uri.Host -or $uri.AbsolutePath -ne "/" -or $uri.Query -or $uri.Fragment) {
        throw "Enter only a host/IP and port, such as 192.168.1.25:16384."
    }
    $authority = $candidate -replace '^[a-z][a-z0-9+.-]*://', ''
    $explicitPort = [regex]::Match($authority, ':(?<port>[0-9]+)$')
    $port = if ($explicitPort.Success) { [int]$explicitPort.Groups['port'].Value } else { 16384 }
    if ($port -lt 1 -or $port -gt 65535) { throw "The bridge port must be between 1 and 65535." }
    return "$($uri.Host):$port"
}

function Get-BridgePort {
    param([string]$Address)
    try { return ([Uri]("http://" + (Normalize-BridgeAddress $Address))).Port } catch { return 16384 }
}

function Test-BridgeRunning {
    param([string]$Address)
    $port = Get-BridgePort $Address
    try { $null = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/server-info" -UseBasicParsing -TimeoutSec 2; return $true } catch { return $false }
}

function Select-Folder {
    param([string]$InitialDirectory, [string]$Description)
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = $Description
    $dialog.ShowNewFolderButton = $true
    if (Test-Path -LiteralPath $InitialDirectory -PathType Container) { $dialog.SelectedPath = [IO.Path]::GetFullPath($InitialDirectory) }
    try {
        if ($dialog.ShowDialog() -eq [Windows.Forms.DialogResult]::OK) { return $dialog.SelectedPath }
        return $null
    }
    finally { $dialog.Dispose() }
}

function Select-TunnelExecutable {
    param([string]$InitialPath)
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = "Select OpenAI tunnel-client.exe"
    $dialog.Filter = "OpenAI tunnel client (tunnel-client.exe)|tunnel-client.exe|Executable files (*.exe)|*.exe"
    $dialog.CheckFileExists = $true
    if (Test-Path -LiteralPath $InitialPath -PathType Leaf) { $dialog.FileName = [IO.Path]::GetFullPath($InitialPath) }
    try {
        if ($dialog.ShowDialog() -eq [Windows.Forms.DialogResult]::OK) { return $dialog.FileName }
        return $null
    }
    finally { $dialog.Dispose() }
}

function Quote-ProcessArgument {
    param([string]$Value)
    if ($null -eq $Value) { return '""' }
    return '"' + ([string]$Value).Replace('\', '\').Replace('"', '\"') + '"'
}

function Invoke-ManagedProcess {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory = "",
        [hashtable]$Environment = @{}
    )
    Add-Log ("Running: " + $FilePath + " " + (($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join " "))
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $FilePath
    $start.Arguments = ($Arguments | ForEach-Object { Quote-ProcessArgument $_ }) -join " "
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    if ($WorkingDirectory) { $start.WorkingDirectory = $WorkingDirectory }
    foreach ($name in $Environment.Keys) { $start.EnvironmentVariables[$name] = [string]$Environment[$name] }
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $start
    if (-not $process.Start()) { throw "Windows could not start $FilePath." }
    $stdoutTask = $process.StandardOutput.ReadToEndAsync()
    $stderrTask = $process.StandardError.ReadToEndAsync()
    while (-not $process.WaitForExit(100)) { [Windows.Forms.Application]::DoEvents() }
    $stdout = $stdoutTask.Result.Trim()
    $stderr = $stderrTask.Result.Trim()
    if ($stdout) { Add-Log $stdout }
    if ($stderr) { Add-Log $stderr $(if ($process.ExitCode -eq 0) { "INFO" } else { "ERROR" }) }
    if ($process.ExitCode -ne 0) {
        $detail = if ($stderr) { $stderr } elseif ($stdout) { $stdout } else { "No output was returned." }
        throw "$FilePath exited with code $($process.ExitCode). $detail"
    }
    return $stdout
}

function Update-ConfigFromFields {
    $normalized = Normalize-BridgeAddress $script:AddressBox.Text
    $hostName = ([Uri]("http://$normalized")).Host
    $bindHost = if ($hostName -in @("localhost", "127.0.0.1", "::1")) { "127.0.0.1" } else { "0.0.0.0" }
    if ($script:ProfileBox.Text -notmatch '^[A-Za-z0-9._-]+$') { throw "The tunnel profile may only contain letters, numbers, periods, underscores, and hyphens." }
    $tunnelId = $script:TunnelIdBox.Text.Trim()
    if ($tunnelId -and $tunnelId -notmatch '^tunnel_[A-Za-z0-9]+$') { throw "The tunnel ID must look like tunnel_ followed by letters/numbers." }
    $repo = $script:RepoBox.Text.Trim()
    $tunnel = $script:TunnelBox.Text.Trim()
    $script:Config = [ordered]@{
        RepositoryDirectory = if ($repo) { [IO.Path]::GetFullPath($repo) } else { "" }
        TunnelClientExecutable = if ($tunnel) { [IO.Path]::GetFullPath($tunnel) } else { "" }
        BridgeAddress = $normalized
        BindHost = $bindHost
        ProfileName = $script:ProfileBox.Text.Trim()
        TunnelId = $tunnelId
    }
    $script:AddressBox.Text = $normalized
    Save-ManagerConfig $script:Config
}

function Install-WingetPackage {
    param([string]$Id, [string]$DisplayName)
    $winget = Find-Winget
    if (-not $winget) {
        throw "Windows Package Manager (winget) is missing. Install Microsoft's App Installer, then reopen the manager."
    }
    Set-Busy $true "Installing $DisplayName..."
    try {
        Invoke-ManagedProcess $winget @("install", "--id", $Id, "--exact", "--source", "winget", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity")
        Refresh-ProcessPath
        Add-Log "$DisplayName installation completed." "OK"
    }
    finally { Set-Busy $false "Ready" }
}

function Install-Git {
    if (Find-Git) { Add-Log "Git is already installed." "OK"; return }
    Install-WingetPackage "Git.Git" "Git"
    if (-not (Find-Git)) { throw "Git installer completed, but git.exe is still unavailable. Restart Windows or the manager and check again." }
}

function Install-Node {
    $version = Get-NodeVersion
    if ($version -and $version.Major -ge 18 -and (Find-Npm)) { Add-Log "Node.js $version and npm are already installed." "OK"; return }
    Install-WingetPackage "OpenJS.NodeJS.LTS" "Node.js LTS"
    if (-not (Find-Node) -or -not (Find-Npm)) { throw "Node.js installed, but node/npm are still unavailable. Restart Windows or the manager and check again." }
}

function Install-OrSelectRepository {
    if (Test-RepositoryDirectory $script:RepoBox.Text) { Add-Log "MCP repository is already valid." "OK"; return }
    Install-Git
    $defaultParent = Join-Path $env:USERPROFILE "Documents\GitHub"
    if (-not (Test-Path -LiteralPath $defaultParent -PathType Container)) { $defaultParent = $env:USERPROFILE }
    $parent = Select-Folder $defaultParent "Choose a parent folder for roblox-mcp-bridge"
    if (-not $parent) { throw "Repository installation was cancelled." }
    $target = Join-Path $parent "roblox-mcp-bridge"
    if (Test-Path -LiteralPath $target) {
        if (-not (Test-RepositoryDirectory $target)) { throw "$target already exists but is not a valid Roblox MCP checkout. Choose another parent folder." }
    }
    else {
        Set-Busy $true "Cloning Roblox MCP Bridge..."
        try { Invoke-ManagedProcess (Find-Git) @("clone", $script:RepositoryUrl, $target) $parent }
        finally { Set-Busy $false "Ready" }
    }
    $script:RepoBox.Text = $target
    Update-ConfigFromFields
    Add-Log "MCP repository ready at $target" "OK"
}

function Build-Repository {
    Install-Node
    if (-not (Test-RepositoryDirectory $script:RepoBox.Text)) { Install-OrSelectRepository }
    $npm = Find-Npm
    $repo = [IO.Path]::GetFullPath($script:RepoBox.Text)
    Set-Busy $true "Installing dependencies and building..."
    try {
        Invoke-ManagedProcess $npm @("install", "--ignore-scripts") $repo
        Invoke-ManagedProcess $npm @("run", "build") $repo
        if (-not (Test-Path -LiteralPath (Join-Path $repo "dist\index.js") -PathType Leaf)) { throw "The build finished without creating dist\index.js." }
        Add-Log "MCP dependencies and build are ready." "OK"
    }
    finally { Set-Busy $false "Ready" }
}

function Install-TunnelClient {
    if (-not (Test-RepositoryDirectory $script:RepoBox.Text)) { Install-OrSelectRepository }
    $installer = Join-Path $script:RepoBox.Text "scripts\install-tunnel-client.ps1"
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "The tunnel installer is missing. Update the MCP repository first." }
    $defaultDirectory = Join-Path $env:LOCALAPPDATA "OpenAI\tunnel-client"
    if ($script:TunnelBox.Text) { $defaultDirectory = Split-Path -Parent $script:TunnelBox.Text }
    $directory = Select-Folder $defaultDirectory "Choose where to install OpenAI tunnel-client"
    if (-not $directory) { throw "Tunnel installation was cancelled." }
    Set-Busy $true "Downloading and verifying OpenAI tunnel-client..."
    try {
        Invoke-ManagedProcess "powershell.exe" @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $installer, "-InstallDirectory", $directory)
        $exe = Join-Path $directory "tunnel-client.exe"
        if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "The installer finished but tunnel-client.exe was not found." }
        $script:TunnelBox.Text = $exe
        Update-ConfigFromFields
        Add-Log "OpenAI tunnel-client ready at $exe" "OK"
    }
    finally { Set-Busy $false "Ready" }
}

function Install-AllRequired {
    Install-Git
    Install-Node
    Install-OrSelectRepository
    Build-Repository
    if ($script:TunnelIdBox.Text.Trim() -or $script:RuntimeKeyBox.Text) {
        if (-not (Test-Path -LiteralPath $script:TunnelBox.Text -PathType Leaf)) { Install-TunnelClient }
    }
    Add-Log "All required MCP components are ready." "OK"
}

function Start-Bridge {
    Update-ConfigFromFields
    if (Test-BridgeRunning $script:Config.BridgeAddress) { Add-Log "The bridge is already running." "OK"; return }
    if (-not (Test-Path -LiteralPath (Join-Path $script:Config.RepositoryDirectory "dist\index.js") -PathType Leaf)) { Build-Repository }
    $node = Find-Node
    if (-not $node) { throw "Node.js is missing. Click Install Node.js first." }
    $entry = Join-Path $script:Config.RepositoryDirectory "dist\index.js"
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $node
    $start.Arguments = Quote-ProcessArgument $entry
    $start.WorkingDirectory = $script:Config.RepositoryDirectory
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.EnvironmentVariables["ROBLOX_MCP_HOST"] = $script:Config.BindHost
    $start.EnvironmentVariables["ROBLOX_MCP_PORT"] = [string](Get-BridgePort $script:Config.BridgeAddress)
    [Diagnostics.Process]::Start($start) | Out-Null
    Start-Sleep -Milliseconds 1000
    if (-not (Test-BridgeRunning $script:Config.BridgeAddress)) { throw "The bridge process started but its dashboard did not respond. Check the log or whether the port is already in use." }
    Add-Log "Bridge started at http://$($script:Config.BridgeAddress)/" "OK"
}

function Start-InteractiveUpdate {
    Update-ConfigFromFields
    if (-not (Test-RepositoryDirectory $script:Config.RepositoryDirectory)) { throw "Choose or install the MCP repository first." }
    $repoLiteral = $script:Config.RepositoryDirectory.Replace("'", "''")
    $command = "Set-Location -LiteralPath '$repoLiteral'; npm run update"
    Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command)
}

function Configure-Tunnel {
    Update-ConfigFromFields
    if (-not $script:Config.TunnelId) { throw "Enter the optional tunnel ID first (tunnel_...)." }
    $runtimeKey = $script:RuntimeKeyBox.Text
    if (-not $runtimeKey) { throw "Enter the OpenAI Platform runtime API key. It is used only in memory and is never saved." }
    if (-not (Test-Path -LiteralPath $script:Config.TunnelClientExecutable -PathType Leaf)) { Install-TunnelClient; Update-ConfigFromFields }
    if (-not (Test-Path -LiteralPath (Join-Path $script:Config.RepositoryDirectory "dist\index.js") -PathType Leaf)) { Build-Repository }
    $setup = Join-Path $script:Config.RepositoryDirectory "scripts\setup-chatgpt-tunnel.ps1"
    $arguments = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $setup,
        "-SkipProjectSetup", "-NoPathPrompts", "-NoStartPrompt",
        "-RepositoryDirectory", $script:Config.RepositoryDirectory,
        "-TunnelClientExecutable", $script:Config.TunnelClientExecutable,
        "-BridgeAddress", $script:Config.BridgeAddress,
        "-ProfileName", $script:Config.ProfileName,
        "-TunnelId", $script:Config.TunnelId
    )
    Set-Busy $true "Configuring and validating the ChatGPT tunnel..."
    try {
        Invoke-ManagedProcess "powershell.exe" $arguments $script:Config.RepositoryDirectory @{ CONTROL_PLANE_API_KEY = $runtimeKey }
        Add-Log "ChatGPT tunnel profile '$($script:Config.ProfileName)' is ready." "OK"
    }
    finally {
        $runtimeKey = $null
        $script:RuntimeKeyBox.Clear()
        Set-Busy $false "Ready"
    }
}

function Start-Tunnel {
    Update-ConfigFromFields
    if (-not (Test-Path -LiteralPath $script:Config.TunnelClientExecutable -PathType Leaf)) { throw "Install or browse to tunnel-client.exe first." }
    $startup = Join-Path $script:Config.RepositoryDirectory "scripts\start-chatgpt-tunnel.ps1"
    if (-not (Test-Path -LiteralPath $startup -PathType Leaf)) { throw "The tunnel startup script is missing." }
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File " + (Quote-ProcessArgument $startup) +
        " -TunnelClientExecutable " + (Quote-ProcessArgument $script:Config.TunnelClientExecutable) +
        " -ProfileName " + (Quote-ProcessArgument $script:Config.ProfileName)
    $runtimeKey = $script:RuntimeKeyBox.Text
    $previous = [Environment]::GetEnvironmentVariable("CONTROL_PLANE_API_KEY", "Process")
    try {
        if ($runtimeKey) { $env:CONTROL_PLANE_API_KEY = $runtimeKey }
        Start-Process -FilePath "powershell.exe" -ArgumentList $arguments
        Add-Log "Tunnel startup window opened. Keep that window running." "OK"
    }
    finally {
        if ($null -eq $previous) { Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue } else { $env:CONTROL_PLANE_API_KEY = $previous }
        $runtimeKey = $null
        $script:RuntimeKeyBox.Clear()
    }
}

function Copy-RobloxLoader {
    Update-ConfigFromFields
    $address = $script:Config.BridgeAddress
    $loader = "getgenv().BridgeURL = `"$address`"`r`nlocal bridgeUrl = getgenv().BridgeURL or `"localhost:16384`"`r`nloadstring(game:HttpGet(`"http://`" .. bridgeUrl .. `"/script.luau`"))()"
    [Windows.Forms.Clipboard]::SetText($loader)
    Add-Log "Roblox loader copied to the clipboard." "OK"
}

function Restart-AsAdministrator {
    Update-ConfigFromFields
    $exe = Join-Path (Split-Path -Parent $script:ConfigFile) "RobloxMcpManager.exe"
    if (Test-Path -LiteralPath $exe -PathType Leaf) {
        Start-Process -FilePath $exe -Verb RunAs
    }
    else {
        Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath, "-ConfigPath", $script:ConfigFile)
    }
    $script:Form.Close()
}

function Refresh-Status {
    Refresh-ProcessPath
    $git = Find-Git
    $nodeVersion = Get-NodeVersion
    $npm = Find-Npm
    $repoReady = Test-RepositoryDirectory $script:RepoBox.Text
    $buildReady = $repoReady -and (Test-Path -LiteralPath (Join-Path $script:RepoBox.Text "dist\index.js") -PathType Leaf)
    $tunnelReady = $script:TunnelBox.Text -and (Test-Path -LiteralPath $script:TunnelBox.Text -PathType Leaf)
    $bridgeRunning = Test-BridgeRunning $script:AddressBox.Text
    $localVersion = if ($repoReady) { Get-LocalVersion $script:RepoBox.Text } else { $null }
    $remoteVersion = if ($localVersion) { Get-RemoteVersion } else { $null }
    $updateText = if (-not $localVersion) { "not installed" } elseif (-not $remoteVersion) { "fetch failed" } elseif ((Compare-VersionText $localVersion $remoteVersion) -lt 0) { "v$remoteVersion available" } else { "current" }
    $adminText = if (Test-IsAdministrator) { "Elevated" } else { "Normal user" }
    $lines = @(
        "Git: " + $(if ($git) { "installed" } else { "MISSING" }),
        "Node.js/npm: " + $(if ($nodeVersion -and $nodeVersion.Major -ge 18 -and $npm) { "v$nodeVersion / installed" } else { "MISSING or too old" }),
        "MCP repository/build: " + $(if ($repoReady -and $buildReady) { "ready (v$localVersion)" } elseif ($repoReady) { "build needed" } else { "MISSING" }),
        "Update: $updateText",
        "Bridge: " + $(if ($bridgeRunning) { "RUNNING" } else { "stopped" }),
        "ChatGPT tunnel: " + $(if ($tunnelReady) { "client selected" } else { "optional / not installed" }),
        "Windows access: $adminText"
    )
    $script:StatusBox.Text = $lines -join "`r`n"
    $script:ActionStatus.Text = if ($repoReady -and $buildReady -and $git -and $nodeVersion) { "Ready" } else { "Setup needed - click Install all required" }

    if (-not $script:PromptedForUpdate -and $localVersion -and $remoteVersion -and (Compare-VersionText $localVersion $remoteVersion) -lt 0) {
        $script:PromptedForUpdate = $true
        if ([Windows.Forms.MessageBox]::Show("Version $remoteVersion is available (installed: $localVersion). Open the updater?", "Update available", 4, 64) -eq "Yes") { Start-InteractiveUpdate }
    }
}

function Invoke-UiAction {
    param([scriptblock]$Action, [string]$Title)
    if ($script:Busy) { return }
    try { & $Action; Refresh-Status } catch { Show-FriendlyError $_.Exception $Title } finally { if ($script:Busy) { Set-Busy $false "Ready" } }
}

$script:LogBox = $null
$script:Config = Read-ManagerConfig

$script:Form = New-Object Windows.Forms.Form
$script:Form.Text = "Roblox MCP Manager - Easy Setup"
$script:Form.Size = New-Object Drawing.Size(980, 850)
$script:Form.MinimumSize = New-Object Drawing.Size(980, 850)
$script:Form.StartPosition = "CenterScreen"
$script:Form.Font = New-Object Drawing.Font("Segoe UI", 9)
$script:Form.AutoScroll = $true

$title = New-Object Windows.Forms.Label
$title.Text = "Roblox MCP Bridge - Easy Setup"
$title.Font = New-Object Drawing.Font("Segoe UI Semibold", 18)
$title.Location = New-Object Drawing.Point(18, 12)
$title.Size = New-Object Drawing.Size(600, 36)
$script:Form.Controls.Add($title)

$adminButton = New-Object Windows.Forms.Button
$adminButton.Text = "Restart as administrator"
$adminButton.Location = New-Object Drawing.Point(745, 15)
$adminButton.Size = New-Object Drawing.Size(190, 30)
$adminButton.Add_Click({ Invoke-UiAction { Restart-AsAdministrator } "Administrator restart failed" })
$script:Form.Controls.Add($adminButton)

$script:StatusBox = New-Object Windows.Forms.TextBox
$script:StatusBox.Multiline = $true
$script:StatusBox.ReadOnly = $true
$script:StatusBox.Location = New-Object Drawing.Point(20, 54)
$script:StatusBox.Size = New-Object Drawing.Size(450, 140)
$script:StatusBox.BackColor = [Drawing.Color]::White
$script:Form.Controls.Add($script:StatusBox)

$prereq = New-Object Windows.Forms.GroupBox
$prereq.Text = "1. Install/check requirements"
$prereq.Location = New-Object Drawing.Point(485, 50)
$prereq.Size = New-Object Drawing.Size(450, 145)
$script:Form.Controls.Add($prereq)

function Add-SmallButton {
    param($Parent, [string]$Text, [int]$Left, [int]$Top, [int]$Width, [scriptblock]$Action, [string]$ErrorTitle)
    $button = New-Object Windows.Forms.Button
    $button.Text = $Text
    $button.Location = New-Object Drawing.Point($Left, $Top)
    $button.Size = New-Object Drawing.Size($Width, 32)
    $button.Add_Click({ Invoke-UiAction $Action $ErrorTitle }.GetNewClosure())
    $Parent.Controls.Add($button)
    return $button
}

Add-SmallButton $prereq "Install Git" 12 25 130 { Install-Git } "Git installation failed" | Out-Null
Add-SmallButton $prereq "Install Node.js" 154 25 130 { Install-Node } "Node.js installation failed" | Out-Null
Add-SmallButton $prereq "Install/choose MCP" 296 25 140 { Install-OrSelectRepository } "MCP installation failed" | Out-Null
Add-SmallButton $prereq "Install tunnel client" 12 67 160 { Install-TunnelClient } "Tunnel installation failed" | Out-Null
Add-SmallButton $prereq "Build/repair MCP" 184 67 140 { Build-Repository } "MCP build failed" | Out-Null
Add-SmallButton $prereq "INSTALL ALL REQUIRED" 12 105 424 { Install-AllRequired } "Automatic setup failed" | Out-Null

$paths = New-Object Windows.Forms.GroupBox
$paths.Text = "2. Paths and local bridge address"
$paths.Location = New-Object Drawing.Point(20, 207)
$paths.Size = New-Object Drawing.Size(915, 180)
$script:Form.Controls.Add($paths)

function Add-PathRow {
    param([string]$Label, [int]$Top, [string]$Value, [string]$ButtonText, [scriptblock]$Click)
    $labelControl = New-Object Windows.Forms.Label
    $labelControl.Text = $Label
    $labelControl.Location = New-Object Drawing.Point(12, $Top)
    $labelControl.Size = New-Object Drawing.Size(870, 18)
    $paths.Controls.Add($labelControl)
    $box = New-Object Windows.Forms.TextBox
    $box.Text = $Value
    $box.Location = New-Object Drawing.Point(12, ($Top + 20))
    $box.Size = New-Object Drawing.Size(755, 25)
    $paths.Controls.Add($box)
    $button = New-Object Windows.Forms.Button
    $button.Text = $ButtonText
    $button.Location = New-Object Drawing.Point(780, ($Top + 18))
    $button.Size = New-Object Drawing.Size(110, 28)
    $button.Add_Click($Click)
    $paths.Controls.Add($button)
    return $box
}

$script:RepoBox = Add-PathRow "MCP repository folder" 22 $script:Config.RepositoryDirectory "Browse..." {
    $selected = Select-Folder $script:RepoBox.Text "Select the folder containing roblox-mcp-server package.json"
    if ($selected) { $script:RepoBox.Text = $selected }
}
$script:TunnelBox = Add-PathRow "OpenAI tunnel-client.exe (optional - only for ChatGPT Tunnel)" 78 $script:Config.TunnelClientExecutable "Browse..." {
    $selected = Select-TunnelExecutable $script:TunnelBox.Text
    if ($selected) { $script:TunnelBox.Text = $selected }
}
$script:AddressBox = Add-PathRow "Dashboard/Roblox address (localhost:16384 or trusted LAN/VPN IP:port)" 134 $script:Config.BridgeAddress "Use LAN IP" {
    $candidate = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Sort-Object InterfaceMetric | Select-Object -First 1
    if ($candidate) { $script:AddressBox.Text = "$($candidate.IPAddress):16384" }
}

$chat = New-Object Windows.Forms.GroupBox
$chat.Text = "3. Optional ChatGPT Tunnel setup"
$chat.Location = New-Object Drawing.Point(20, 400)
$chat.Size = New-Object Drawing.Size(915, 170)
$script:Form.Controls.Add($chat)

$chatNotice = New-Object Windows.Forms.Label
$chatNotice.Text = "Official route: ChatGPT Settings > Security and login > Developer mode, then ChatGPT Plugins (+) > Tunnel. If Codex/Worker is confusing, switch to the normal Chat/Plugins surface. Tunnel fields are optional for local MCP use."
$chatNotice.Location = New-Object Drawing.Point(12, 20)
$chatNotice.Size = New-Object Drawing.Size(875, 38)
$chat.Controls.Add($chatNotice)

function Add-ChatField {
    param([string]$Label, [int]$Left, [int]$Top, [int]$Width, [string]$Value, [bool]$Secret)
    $labelControl = New-Object Windows.Forms.Label
    $labelControl.Text = $Label
    $labelControl.Location = New-Object Drawing.Point($Left, $Top)
    $labelControl.Size = New-Object Drawing.Size($Width, 18)
    $chat.Controls.Add($labelControl)
    $box = New-Object Windows.Forms.TextBox
    $box.Text = $Value
    $box.Location = New-Object Drawing.Point($Left, ($Top + 19))
    $box.Size = New-Object Drawing.Size($Width, 25)
    if ($Secret) { $box.UseSystemPasswordChar = $true }
    $chat.Controls.Add($box)
    return $box
}

$script:TunnelIdBox = Add-ChatField "Tunnel ID (tunnel_...)" 12 61 270 $script:Config.TunnelId $false
$script:RuntimeKeyBox = Add-ChatField "OpenAI Platform runtime API key (memory-only; never saved)" 295 61 390 "" $true
$script:ProfileBox = Add-ChatField "Profile name" 698 61 190 $script:Config.ProfileName $false
Add-SmallButton $chat "Configure/validate tunnel" 12 119 210 { Configure-Tunnel } "Tunnel configuration failed" | Out-Null
Add-SmallButton $chat "Start tunnel" 234 119 150 { Start-Tunnel } "Tunnel startup failed" | Out-Null
Add-SmallButton $chat "Open ChatGPT Plugins" 396 119 190 { Start-Process $script:ChatGptPluginsUrl } "Could not open ChatGPT" | Out-Null

$actions = New-Object Windows.Forms.GroupBox
$actions.Text = "4. Run and use the bridge"
$actions.Location = New-Object Drawing.Point(20, 582)
$actions.Size = New-Object Drawing.Size(915, 78)
$script:Form.Controls.Add($actions)
Add-SmallButton $actions "Start bridge" 12 27 155 { Start-Bridge } "Bridge startup failed" | Out-Null
Add-SmallButton $actions "Open dashboard" 179 27 155 { Start-Process ("http://" + (Normalize-BridgeAddress $script:AddressBox.Text) + "/") } "Dashboard failed" | Out-Null
Add-SmallButton $actions "Update MCP" 346 27 155 { Start-InteractiveUpdate } "Updater failed" | Out-Null
Add-SmallButton $actions "Copy Roblox loader" 513 27 175 { Copy-RobloxLoader } "Clipboard failed" | Out-Null
Add-SmallButton $actions "Save + Refresh" 700 27 190 { Update-ConfigFromFields } "Invalid settings" | Out-Null

$script:ActionStatus = New-Object Windows.Forms.Label
$script:ActionStatus.Text = "Checking..."
$script:ActionStatus.Location = New-Object Drawing.Point(22, 674)
$script:ActionStatus.Size = New-Object Drawing.Size(600, 20)
$script:Form.Controls.Add($script:ActionStatus)

$script:ProgressBar = New-Object Windows.Forms.ProgressBar
$script:ProgressBar.Location = New-Object Drawing.Point(650, 674)
$script:ProgressBar.Size = New-Object Drawing.Size(285, 18)
$script:Form.Controls.Add($script:ProgressBar)

$script:LogBox = New-Object Windows.Forms.RichTextBox
$script:LogBox.ReadOnly = $true
$script:LogBox.Location = New-Object Drawing.Point(20, 701)
$script:LogBox.Size = New-Object Drawing.Size(915, 90)
$script:LogBox.BackColor = [Drawing.Color]::FromArgb(25, 25, 25)
$script:LogBox.ForeColor = [Drawing.Color]::Gainsboro
$script:LogBox.Font = New-Object Drawing.Font("Consolas", 8)
$script:Form.Controls.Add($script:LogBox)

Add-Log "Manager started. The OpenAI runtime key field is never written to disk."
$script:Form.Add_Shown({ Refresh-Status })
[void]$script:Form.ShowDialog()
