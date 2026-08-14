#requires -Version 5.1

[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot "RobloxMcpManager.config.json"),

    [string]$IconPath = $env:ROBLOX_MCP_MANAGER_ICON,

    [string]$PreviewPath = ""
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

function Test-ExistingFile {
    param([AllowEmptyString()][string]$Path)
    return -not [string]::IsNullOrWhiteSpace($Path) -and (Test-Path -LiteralPath $Path -PathType Leaf)
}

function Test-ExistingDirectory {
    param([AllowEmptyString()][string]$Path)
    return -not [string]::IsNullOrWhiteSpace($Path) -and (Test-Path -LiteralPath $Path -PathType Container)
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
    if (Test-ExistingDirectory $InitialDirectory) { $dialog.SelectedPath = [IO.Path]::GetFullPath($InitialDirectory) }
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
    if (Test-ExistingFile $InitialPath) { $dialog.FileName = [IO.Path]::GetFullPath($InitialPath) }
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
        if (-not (Test-ExistingFile $script:TunnelBox.Text)) { Install-TunnelClient }
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
    if (-not (Test-ExistingFile $script:Config.TunnelClientExecutable)) { Install-TunnelClient; Update-ConfigFromFields }
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
    if (-not (Test-ExistingFile $script:Config.TunnelClientExecutable)) { throw "Install or browse to tunnel-client.exe first." }
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
    $tunnelReady = Test-ExistingFile $script:TunnelBox.Text
    $bridgeRunning = Test-BridgeRunning $script:AddressBox.Text
    $localVersion = if ($repoReady) { Get-LocalVersion $script:RepoBox.Text } else { $null }
    $remoteVersion = if ($localVersion) { Get-RemoteVersion } else { $null }
    $updateText = if (-not $localVersion) { "not installed" } elseif (-not $remoteVersion) { "fetch failed" } elseif ((Compare-VersionText $localVersion $remoteVersion) -lt 0) { "v$remoteVersion available" } else { "current" }
    $nodeReady = $nodeVersion -and $nodeVersion.Major -ge 18 -and $npm
    Set-StatusValue "Git" $(if ($git) { "Installed" } else { "Missing" }) $(if ($git) { "Good" } else { "Bad" })
    Set-StatusValue "Node" $(if ($nodeReady) { "v$nodeVersion" } else { "Missing / old" }) $(if ($nodeReady) { "Good" } else { "Bad" })
    Set-StatusValue "MCP" $(if ($repoReady -and $buildReady) { "Ready v$localVersion" } elseif ($repoReady) { "Build needed" } else { "Not installed" }) $(if ($repoReady -and $buildReady) { "Good" } elseif ($repoReady) { "Warn" } else { "Bad" })
    Set-StatusValue "Update" $updateText $(if ($updateText -eq "current") { "Good" } elseif ($updateText -match "available|failed") { "Warn" } else { "Muted" })
    Set-StatusValue "Bridge" $(if ($bridgeRunning) { "Running" } else { "Stopped" }) $(if ($bridgeRunning) { "Good" } else { "Muted" })
    Set-StatusValue "Tunnel" $(if ($tunnelReady) { "Client ready" } else { "Optional" }) $(if ($tunnelReady) { "Good" } else { "Muted" })
    Set-StatusValue "Access" $(if (Test-IsAdministrator) { "Administrator" } else { "Standard user" }) $(if (Test-IsAdministrator) { "Good" } else { "Muted" })

    $ready = $repoReady -and $buildReady -and $git -and $nodeReady
    $script:ActionStatus.Text = if ($ready) { "SYSTEM READY" } else { "SETUP NEEDED" }
    $script:ActionStatus.BackColor = if ($ready) { $script:Colors.SuccessDark } else { $script:Colors.WarningDark }
    $script:ActionStatus.ForeColor = if ($ready) { $script:Colors.Success } else { $script:Colors.Warning }
    $script:HealthTitle.Text = if ($ready) { "Everything looks good" } else { "A few things need attention" }
    $script:HealthSubtitle.Text = if ($ready) { "Start the bridge when you are ready." } else { "Use Quick setup below to finish installation." }

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

$script:Colors = @{
    Background  = [Drawing.Color]::FromArgb(10, 14, 22)
    Surface     = [Drawing.Color]::FromArgb(18, 24, 36)
    SurfaceAlt  = [Drawing.Color]::FromArgb(23, 31, 46)
    Border      = [Drawing.Color]::FromArgb(42, 54, 75)
    Text        = [Drawing.Color]::FromArgb(241, 245, 249)
    Muted       = [Drawing.Color]::FromArgb(148, 163, 184)
    Accent      = [Drawing.Color]::FromArgb(80, 113, 234)
    AccentHover = [Drawing.Color]::FromArgb(99, 128, 239)
    Success     = [Drawing.Color]::FromArgb(52, 211, 153)
    SuccessDark = [Drawing.Color]::FromArgb(13, 55, 48)
    Warning     = [Drawing.Color]::FromArgb(251, 191, 36)
    WarningDark = [Drawing.Color]::FromArgb(61, 45, 13)
    Danger      = [Drawing.Color]::FromArgb(251, 113, 133)
}

function New-UiLabel {
    param($Parent, [string]$Text, [int]$Left, [int]$Top, [int]$Width, [int]$Height = 22, [float]$Size = 9, [bool]$Bold = $false, $Color = $null)
    $label = New-Object Windows.Forms.Label
    $label.Text = $Text
    $label.Location = New-Object Drawing.Point($Left, $Top)
    $label.Size = New-Object Drawing.Size($Width, $Height)
    $style = if ($Bold) { [Drawing.FontStyle]::Bold } else { [Drawing.FontStyle]::Regular }
    $label.Font = New-Object Drawing.Font("Segoe UI", $Size, $style)
    $label.ForeColor = if ($null -ne $Color) { $Color } else { $script:Colors.Text }
    $label.BackColor = [Drawing.Color]::Transparent
    $Parent.Controls.Add($label)
    return $label
}

function New-Card {
    param($Parent, [int]$Left, [int]$Top, [int]$Width, [int]$Height)
    $panel = New-Object Windows.Forms.Panel
    $panel.Location = New-Object Drawing.Point($Left, $Top)
    $panel.Size = New-Object Drawing.Size($Width, $Height)
    $panel.BackColor = $script:Colors.Surface
    $borderColor = $script:Colors.Border
    $panel.Add_Paint({
        param($sender, $eventArgs)
        $pen = New-Object Drawing.Pen($borderColor)
        try { $eventArgs.Graphics.DrawRectangle($pen, 0, 0, ($sender.Width - 1), ($sender.Height - 1)) } finally { $pen.Dispose() }
    }.GetNewClosure())
    $Parent.Controls.Add($panel)
    return $panel
}

function New-UiButton {
    param($Parent, [string]$Text, [int]$Left, [int]$Top, [int]$Width, [int]$Height, [scriptblock]$Action, [string]$ErrorTitle, [bool]$Primary = $false)
    $button = New-Object Windows.Forms.Button
    $button.Text = $Text
    $button.Location = New-Object Drawing.Point($Left, $Top)
    $button.Size = New-Object Drawing.Size($Width, $Height)
    $button.FlatStyle = [Windows.Forms.FlatStyle]::Flat
    $button.FlatAppearance.BorderSize = if ($Primary) { 0 } else { 1 }
    $button.FlatAppearance.BorderColor = $script:Colors.Border
    $button.BackColor = if ($Primary) { $script:Colors.Accent } else { $script:Colors.SurfaceAlt }
    $button.ForeColor = $script:Colors.Text
    $button.Cursor = [Windows.Forms.Cursors]::Hand
    $button.Font = New-Object Drawing.Font("Segoe UI Semibold", 9)
    $hover = if ($Primary) { $script:Colors.AccentHover } else { [Drawing.Color]::FromArgb(31, 42, 61) }
    $normal = $button.BackColor
    $button.Add_MouseEnter({ $this.BackColor = $hover }.GetNewClosure())
    $button.Add_MouseLeave({ $this.BackColor = $normal }.GetNewClosure())
    $button.Add_Click({ Invoke-UiAction $Action $ErrorTitle }.GetNewClosure())
    $Parent.Controls.Add($button)
    return $button
}

function New-UiTextBox {
    param($Parent, [string]$Value, [int]$Left, [int]$Top, [int]$Width, [bool]$Secret = $false)
    $box = New-Object Windows.Forms.TextBox
    $box.Text = $Value
    $box.Location = New-Object Drawing.Point($Left, $Top)
    $box.Size = New-Object Drawing.Size($Width, 27)
    $box.BorderStyle = [Windows.Forms.BorderStyle]::FixedSingle
    $box.BackColor = $script:Colors.SurfaceAlt
    $box.ForeColor = $script:Colors.Text
    $box.Font = New-Object Drawing.Font("Segoe UI", 9.5)
    if ($Secret) { $box.UseSystemPasswordChar = $true }
    $Parent.Controls.Add($box)
    return $box
}

function Add-StatusRow {
    param($Parent, [string]$Name, [string]$Caption, [int]$Top)
    $indicator = New-Object Windows.Forms.Panel
    $indicator.Location = New-Object Drawing.Point(22, ($Top + 6))
    $indicator.Size = New-Object Drawing.Size(4, 20)
    $indicator.BackColor = $script:Colors.Muted
    $Parent.Controls.Add($indicator)
    New-UiLabel $Parent $Caption 38 $Top 112 28 9 $false $script:Colors.Muted | Out-Null
    $value = New-UiLabel $Parent "Checking" 145 $Top 125 28 9 $true $script:Colors.Text
    $value.TextAlign = [Drawing.ContentAlignment]::MiddleRight
    $script:StatusRows[$Name] = [pscustomobject]@{ Indicator = $indicator; Value = $value }
}

function Set-StatusValue {
    param([string]$Name, [string]$Text, [string]$Kind)
    if (-not $script:StatusRows.ContainsKey($Name)) { return }
    $color = switch ($Kind) {
        "Good" { $script:Colors.Success }
        "Warn" { $script:Colors.Warning }
        "Bad" { $script:Colors.Danger }
        default { $script:Colors.Muted }
    }
    $script:StatusRows[$Name].Indicator.BackColor = $color
    $script:StatusRows[$Name].Value.ForeColor = $color
    $script:StatusRows[$Name].Value.Text = $Text
}

function Add-PathField {
    param($Parent, [string]$Label, [int]$Top, [string]$Value, [string]$ButtonText, [scriptblock]$Click)
    New-UiLabel $Parent $Label 22 $Top 730 19 8.5 $false $script:Colors.Muted | Out-Null
    $box = New-UiTextBox $Parent $Value 22 ($Top + 22) 632
    $button = New-UiButton $Parent $ButtonText 666 ($Top + 20) 108 30 ({ & $Click }.GetNewClosure()) "Selection failed"
    return $box
}

function Add-ChatField {
    param($Parent, [string]$Label, [int]$Left, [int]$Width, [string]$Value, [bool]$Secret)
    New-UiLabel $Parent $Label $Left 66 $Width 18 8.2 $false $script:Colors.Muted | Out-Null
    return New-UiTextBox $Parent $Value $Left 86 $Width $Secret
}

$script:LogBox = $null
$script:StatusRows = @{}
$script:Config = Read-ManagerConfig

$script:Form = New-Object Windows.Forms.Form
$script:Form.Text = "Roblox MCP Manager"
$script:Form.ClientSize = New-Object Drawing.Size(1160, 820)
$script:Form.MinimumSize = New-Object Drawing.Size(1176, 859)
$script:Form.StartPosition = "CenterScreen"
$script:Form.Font = New-Object Drawing.Font("Segoe UI", 9)
$script:Form.BackColor = $script:Colors.Background
$script:Form.ForeColor = $script:Colors.Text
$script:Form.AutoScaleMode = [Windows.Forms.AutoScaleMode]::Dpi
$script:Form.MaximizeBox = $false

if (Test-ExistingFile $IconPath) {
    try { $script:Form.Icon = New-Object Drawing.Icon($IconPath) } catch { Add-Log "Window icon could not be loaded: $($_.Exception.Message)" "WARN" }
}

$header = New-Object Windows.Forms.Panel
$header.Location = New-Object Drawing.Point(0, 0)
$header.Size = New-Object Drawing.Size(1160, 96)
$header.BackColor = $script:Colors.Surface
$script:Form.Controls.Add($header)

if (Test-ExistingFile $IconPath) {
    try {
        $logo = New-Object Windows.Forms.Panel
        $logo.Location = New-Object Drawing.Point(22, 19)
        $logo.Size = New-Object Drawing.Size(58, 58)
        $logo.BackColor = [Drawing.Color]::Transparent
        $script:LogoIcon = New-Object Drawing.Icon($IconPath, 64, 64)
        $logo.Add_Paint({
            param($sender, $eventArgs)
            $eventArgs.Graphics.DrawIcon($script:LogoIcon, (New-Object Drawing.Rectangle(1, 1, 56, 56)))
        })
        $header.Controls.Add($logo)
    } catch { }
}

New-UiLabel $header "ROBLOX MCP MANAGER" 96 19 500 34 19 $true | Out-Null
New-UiLabel $header "Install, update, connect, and run your bridge from one place." 98 55 570 24 9.5 $false $script:Colors.Muted | Out-Null
New-UiButton $header "Restart as administrator" 922 31 210 36 { Restart-AsAdministrator } "Administrator restart failed" | Out-Null

$health = New-Card $script:Form 20 112 300 688
New-UiLabel $health "SYSTEM HEALTH" 22 18 150 20 8.5 $true $script:Colors.Muted | Out-Null
$script:ActionStatus = New-UiLabel $health "CHECKING" 178 16 100 25 8 $true $script:Colors.Warning
$script:ActionStatus.TextAlign = [Drawing.ContentAlignment]::MiddleCenter
$script:HealthTitle = New-UiLabel $health "Checking your setup" 22 50 255 25 12 $true
$script:HealthSubtitle = New-UiLabel $health "This only takes a moment." 22 76 255 35 8.5 $false $script:Colors.Muted

Add-StatusRow $health "Git" "Git" 122
Add-StatusRow $health "Node" "Node.js / npm" 158
Add-StatusRow $health "MCP" "MCP build" 194
Add-StatusRow $health "Update" "Updates" 230
Add-StatusRow $health "Bridge" "Local bridge" 266
Add-StatusRow $health "Tunnel" "ChatGPT tunnel" 302
Add-StatusRow $health "Access" "Windows access" 338

$divider = New-Object Windows.Forms.Panel
$divider.Location = New-Object Drawing.Point(22, 382)
$divider.Size = New-Object Drawing.Size(256, 1)
$divider.BackColor = $script:Colors.Border
$health.Controls.Add($divider)
New-UiLabel $health "QUICK SETUP" 22 400 180 20 8.5 $true $script:Colors.Muted | Out-Null
New-UiButton $health "Install Git" 22 430 123 34 { Install-Git } "Git installation failed" | Out-Null
New-UiButton $health "Install Node.js" 155 430 123 34 { Install-Node } "Node.js installation failed" | Out-Null
New-UiButton $health "Choose MCP" 22 474 123 34 { Install-OrSelectRepository } "MCP installation failed" | Out-Null
New-UiButton $health "Repair build" 155 474 123 34 { Build-Repository } "MCP build failed" | Out-Null
New-UiButton $health "Install tunnel" 22 518 123 34 { Install-TunnelClient } "Tunnel installation failed" | Out-Null
New-UiButton $health "Refresh" 155 518 123 34 { Update-ConfigFromFields } "Refresh failed" | Out-Null
New-UiButton $health "INSTALL EVERYTHING" 22 568 256 44 { Install-AllRequired } "Automatic setup failed" $true | Out-Null
New-UiLabel $health "Installs only missing requirements." 22 620 256 18 8 $false $script:Colors.Muted | Out-Null
$script:ProgressBar = New-Object Windows.Forms.ProgressBar
$script:ProgressBar.Location = New-Object Drawing.Point(22, 651)
$script:ProgressBar.Size = New-Object Drawing.Size(256, 8)
$script:ProgressBar.Style = "Blocks"
$health.Controls.Add($script:ProgressBar)

$paths = New-Card $script:Form 340 112 800 282
New-UiLabel $paths "CONFIGURATION" 22 17 240 20 8.5 $true $script:Colors.Muted | Out-Null
New-UiLabel $paths "Paths and local bridge" 22 39 400 26 13 $true | Out-Null
$script:RepoBox = Add-PathField $paths "MCP repository folder" 72 $script:Config.RepositoryDirectory "Browse" {
    $selected = Select-Folder $script:RepoBox.Text "Select the folder containing roblox-mcp-server package.json"
    if ($selected) { $script:RepoBox.Text = $selected }
}
$script:TunnelBox = Add-PathField $paths "OpenAI tunnel-client.exe (optional)" 140 $script:Config.TunnelClientExecutable "Browse" {
    $selected = Select-TunnelExecutable $script:TunnelBox.Text
    if ($selected) { $script:TunnelBox.Text = $selected }
}
$script:AddressBox = Add-PathField $paths "Dashboard / Roblox address" 208 $script:Config.BridgeAddress "Use LAN IP" {
    $candidate = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } | Sort-Object InterfaceMetric | Select-Object -First 1
    if ($candidate) { $script:AddressBox.Text = "$($candidate.IPAddress):16384" }
}

$chat = New-Card $script:Form 340 410 800 202
New-UiLabel $chat "OPTIONAL CHATGPT TUNNEL" 22 16 260 20 8.5 $true $script:Colors.Muted | Out-Null
New-UiLabel $chat "Use ChatGPT Plugins in the normal Chat interface. These fields are not needed for local MCP use." 22 38 750 22 8.5 $false $script:Colors.Muted | Out-Null
$script:TunnelIdBox = Add-ChatField $chat "Tunnel ID" 22 190 $script:Config.TunnelId $false
$script:RuntimeKeyBox = Add-ChatField $chat "Runtime API key (memory-only; never saved)" 224 330 "" $true
$script:ProfileBox = Add-ChatField $chat "Profile name" 566 208 $script:Config.ProfileName $false
New-UiButton $chat "Configure + validate" 22 137 190 36 { Configure-Tunnel } "Tunnel configuration failed" $true | Out-Null
New-UiButton $chat "Start tunnel" 224 137 145 36 { Start-Tunnel } "Tunnel startup failed" | Out-Null
New-UiButton $chat "Open ChatGPT Plugins" 381 137 190 36 { Start-Process $script:ChatGptPluginsUrl } "Could not open ChatGPT" | Out-Null

$actions = New-Card $script:Form 340 628 800 82
New-UiLabel $actions "RUN THE BRIDGE" 22 13 145 18 8.5 $true $script:Colors.Muted | Out-Null
New-UiButton $actions "Start bridge" 22 37 138 32 { Start-Bridge } "Bridge startup failed" $true | Out-Null
New-UiButton $actions "Open dashboard" 170 37 138 32 { Start-Process ("http://" + (Normalize-BridgeAddress $script:AddressBox.Text) + "/") } "Dashboard failed" | Out-Null
New-UiButton $actions "Update MCP" 318 37 130 32 { Start-InteractiveUpdate } "Updater failed" | Out-Null
New-UiButton $actions "Copy loader" 458 37 130 32 { Copy-RobloxLoader } "Clipboard failed" | Out-Null
New-UiButton $actions "Save + refresh" 598 37 176 32 { Update-ConfigFromFields } "Invalid settings" | Out-Null

$logCard = New-Card $script:Form 340 726 800 74
$script:LogBox = New-Object Windows.Forms.RichTextBox
$script:LogBox.ReadOnly = $true
$script:LogBox.BorderStyle = [Windows.Forms.BorderStyle]::None
$script:LogBox.Location = New-Object Drawing.Point(10, 8)
$script:LogBox.Size = New-Object Drawing.Size(780, 58)
$script:LogBox.BackColor = $script:Colors.Surface
$script:LogBox.ForeColor = $script:Colors.Muted
$script:LogBox.Font = New-Object Drawing.Font("Cascadia Mono", 8)
$script:LogBox.DetectUrls = $false
$logCard.Controls.Add($script:LogBox)

Add-Log "Manager started. Your OpenAI runtime key is memory-only and is never written to disk."
$script:Form.Add_Shown({
    if ($PreviewPath) { $script:PromptedForUpdate = $true }
    Refresh-Status
    if ($PreviewPath) {
        [Windows.Forms.Application]::DoEvents()
        $target = [IO.Path]::GetFullPath($PreviewPath)
        $parent = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        $bitmap = New-Object Drawing.Bitmap($script:Form.ClientSize.Width, $script:Form.ClientSize.Height)
        try {
            $script:Form.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $bitmap.Width, $bitmap.Height)))
            $bitmap.Save($target, [Drawing.Imaging.ImageFormat]::Png)
        }
        finally { $bitmap.Dispose() }
        $script:Form.Close()
    }
})
[void]$script:Form.ShowDialog()
