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
$script:LatestReleaseApiUrl = "https://api.github.com/repos/ltseverydayyou/roblox-mcp-bridge/releases/latest"
$script:ChatGptPluginsUrl = "https://chatgpt.com/plugins"
$script:ConfigFile = [System.IO.Path]::GetFullPath($ConfigPath)
$script:ManagerExecutable = [string]$env:ROBLOX_MCP_MANAGER_EXE
$script:ManagerVersion = if ($env:ROBLOX_MCP_MANAGER_VERSION) { [string]$env:ROBLOX_MCP_MANAGER_VERSION } else { "source" }
$script:PromptedForUpdate = $false
$script:PromptedForManagerUpdate = $false
$script:LatestManagerRelease = $null
$script:Busy = $false
$script:TunnelProcess = $null
$script:TunnelWindow = $null
$script:TunnelLogBox = $null
$script:TunnelStatus = $null
$script:TunnelTimer = $null
$script:TunnelOutputSource = "RobloxMcpManager.Tunnel.Output"
$script:TunnelErrorSource = "RobloxMcpManager.Tunnel.Error"
$script:ClosingManager = $false
$script:RepositoryUpdatePanel = $null
$script:RepositoryUpdateText = $null

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
    $node = Find-Node
    if ($node) {
        $bundledCli = Join-Path (Split-Path -Parent $node) "node_modules\npm\bin\npm-cli.js"
        if (Test-Path -LiteralPath $bundledCli -PathType Leaf) { return $bundledCli }
    }
    return Find-Executable "npm.cmd"
}

function Get-NpmRunner {
    $node = Find-Node
    if ($node) {
        $bundledCli = Join-Path (Split-Path -Parent $node) "node_modules\npm\bin\npm-cli.js"
        if (Test-ExistingFile $bundledCli) {
            return [pscustomobject]@{
                FilePath = $node
                PrefixArguments = @($bundledCli)
                DisplayName = "Node-bundled npm"
            }
        }
    }
    $npm = Find-Executable "npm.cmd"
    if ($npm) {
        return [pscustomobject]@{
            FilePath = $npm
            PrefixArguments = @()
            DisplayName = "npm"
        }
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
    try { return ([version]$Local).CompareTo([version]$Remote) } catch { return 0 }
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

function Invoke-NpmManaged {
    param([string[]]$Arguments, [string]$WorkingDirectory)
    $runner = Get-NpmRunner
    if (-not $runner) { throw "npm is missing. Install or repair Node.js, then try again." }
    Add-Log "Using $($runner.DisplayName) for this operation."
    $allArguments = @($runner.PrefixArguments) + @($Arguments)
    return Invoke-ManagedProcess $runner.FilePath $allArguments $WorkingDirectory
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

function Update-RepositoryCheckout {
    param([string]$RepositoryDirectory)
    if (-not (Test-RepositoryDirectory $RepositoryDirectory)) { throw "The selected MCP folder is not a valid Roblox MCP checkout." }
    $git = Find-Git
    if (-not $git) { throw "Git is missing. Install Git first." }
    $repo = [IO.Path]::GetFullPath($RepositoryDirectory)
    if (-not (Test-Path -LiteralPath (Join-Path $repo ".git"))) {
        throw "$repo contains Roblox MCP files but is not a Git checkout. Re-clone it once so future INSTALL EVERYTHING runs can update it safely."
    }
    Set-Busy $true "Updating Roblox MCP Bridge..."
    try {
        Invoke-ManagedProcess $git @("-C", $repo, "pull", "--ff-only") $repo
        Add-Log "MCP repository updated from GitHub." "OK"
    }
    finally { Set-Busy $false "Ready" }
}

function Install-OrSelectRepository {
    Install-Git
    if (Test-RepositoryDirectory $script:RepoBox.Text) {
        Update-RepositoryCheckout $script:RepoBox.Text
        Update-ConfigFromFields
        return
    }
    $defaultParent = Join-Path $env:USERPROFILE "Documents\GitHub"
    if (-not (Test-Path -LiteralPath $defaultParent -PathType Container)) { $defaultParent = $env:USERPROFILE }
    $parent = Select-Folder $defaultParent "Choose a parent folder for roblox-mcp-bridge"
    if (-not $parent) { throw "Repository installation was cancelled." }
    $target = Join-Path $parent "roblox-mcp-bridge"
    $targetAlreadyExisted = Test-Path -LiteralPath $target
    if ($targetAlreadyExisted) {
        if (-not (Test-RepositoryDirectory $target)) { throw "$target already exists but is not a valid Roblox MCP checkout. Choose another parent folder." }
    }
    else {
        Set-Busy $true "Cloning Roblox MCP Bridge..."
        try { Invoke-ManagedProcess (Find-Git) @("clone", $script:RepositoryUrl, $target) $parent }
        finally { Set-Busy $false "Ready" }
    }
    $script:RepoBox.Text = $target
    Update-ConfigFromFields
    if ($targetAlreadyExisted) { Update-RepositoryCheckout $target }
    Add-Log "MCP repository ready at $target" "OK"
}

function Test-RepositoryBuildFresh {
    param([string]$Repository)
    if (-not (Test-RepositoryDirectory $Repository)) { return $false }

    $entry = Join-Path $Repository "dist\index.js"
    if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { return $false }

    try {
        $builtAt = (Get-Item -LiteralPath $entry -ErrorAction Stop).LastWriteTimeUtc
        $inputs = @()
        $src = Join-Path $Repository "src"
        if (Test-Path -LiteralPath $src -PathType Container) {
            $inputs += @(Get-ChildItem -LiteralPath $src -Recurse -File -ErrorAction Stop)
        }
        foreach ($name in @("package.json", "tsconfig.json")) {
            $candidate = Join-Path $Repository $name
            if (Test-Path -LiteralPath $candidate -PathType Leaf) {
                $inputs += Get-Item -LiteralPath $candidate -ErrorAction Stop
            }
        }

        foreach ($input in $inputs) {
            if ($input.LastWriteTimeUtc -gt $builtAt) { return $false }
        }
        return $true
    }
    catch {
        return $false
    }
}

function Build-Repository {
    Install-Node
    if (-not (Test-RepositoryDirectory $script:RepoBox.Text)) { Install-OrSelectRepository }
    $repo = [IO.Path]::GetFullPath($script:RepoBox.Text)
    Set-Busy $true "Installing dependencies and building..."
    try {
        Invoke-NpmManaged @("install", "--ignore-scripts") $repo
        Invoke-NpmManaged @("run", "build") $repo
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
    if (-not (Test-RepositoryBuildFresh $script:Config.RepositoryDirectory)) { Build-Repository }
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

function Get-ListeningBridgeProcess {
    param([string]$Address)
    if (-not (Test-BridgeRunning $Address)) { return $null }
    $port = Get-BridgePort $Address
    try {
        $connections = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop)
        foreach ($connection in $connections) {
            $processId = [int]$connection.OwningProcess
            $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
            if ($processInfo -and $processInfo.Name -eq "node.exe" -and $processInfo.CommandLine -match '(?i)dist[\\/]index\.js') {
                return $processInfo
            }
        }
    }
    catch { Add-Log "Could not inspect the bridge port owner: $($_.Exception.Message)" "WARN" }
    return $null
}

function Stop-Bridge {
    param([bool]$ForReload = $false, [string]$Address = "")
    $targetAddress = if ([string]::IsNullOrWhiteSpace($Address)) { $script:Config.BridgeAddress } else { Normalize-BridgeAddress $Address }
    if (-not (Test-BridgeRunning $targetAddress)) {
        if (-not $ForReload) { Add-Log "Bridge is already disconnected." "OK" }
        return
    }

    $bridgeProcess = Get-ListeningBridgeProcess $targetAddress
    if (-not $bridgeProcess) {
        throw "Port $(Get-BridgePort $targetAddress) is serving the MCP dashboard, but its process could not be safely identified. Stop it manually rather than risking another Node process."
    }
    Add-Log "Stopping bridge process $($bridgeProcess.ProcessId)..."
    Stop-Process -Id ([int]$bridgeProcess.ProcessId) -Force -ErrorAction Stop
    for ($attempt = 0; $attempt -lt 30 -and (Test-BridgeRunning $targetAddress); $attempt++) {
        Start-Sleep -Milliseconds 100
        [Windows.Forms.Application]::DoEvents()
    }
    if (Test-BridgeRunning $targetAddress) { throw "The old bridge process did not release port $(Get-BridgePort $targetAddress)." }
    if (-not $ForReload) { Add-Log "Bridge disconnected successfully." "OK" }
}

function Disconnect-Bridge {
    Update-ConfigFromFields
    Stop-Bridge
}

function Reload-Bridge {
    Update-ConfigFromFields
    if (-not (Test-RepositoryDirectory $script:Config.RepositoryDirectory)) { throw "Choose or install the MCP repository first." }
    $entry = Join-Path $script:Config.RepositoryDirectory "dist\index.js"
    if (-not (Test-RepositoryBuildFresh $script:Config.RepositoryDirectory)) { Build-Repository; Update-ConfigFromFields }

    Stop-Bridge $true

    Start-Bridge
    Add-Log "Bridge reloaded successfully." "OK"
}

function Get-PreferredLanAddress {
    $interfaceMetrics = @{}
    Get-NetIPInterface -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object {
        $interfaceMetrics[[int]$_.InterfaceIndex] = [int]$_.InterfaceMetric
    }

    $configuration = Get-NetIPConfiguration -ErrorAction SilentlyContinue |
        Where-Object { $_.NetAdapter.Status -eq "Up" -and $_.IPv4DefaultGateway -and $_.IPv4Address } |
        Sort-Object {
            $ipv4InterfaceProperty = $_.PSObject.Properties["NetIPv4Interface"]
            $metricProperty = if ($ipv4InterfaceProperty -and $ipv4InterfaceProperty.Value) {
                $ipv4InterfaceProperty.Value.PSObject.Properties["InterfaceMetric"]
            } else { $null }
            if ($metricProperty) { return [int]$metricProperty.Value }
            if ($interfaceMetrics.ContainsKey([int]$_.InterfaceIndex)) { return $interfaceMetrics[[int]$_.InterfaceIndex] }
            return [int]::MaxValue
        } |
        Select-Object -First 1
    if ($configuration) { return [string]$configuration.IPv4Address.IPAddress }

    $fallback = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
        Sort-Object InterfaceMetric |
        Select-Object -First 1
    if ($fallback) { return [string]$fallback.IPAddress }
    throw "No usable LAN IPv4 address was found. Connect this PC to the network, then try again."
}

function Sync-TunnelProfileDefinition {
    if (-not $script:Config.TunnelId) { return }
    if (-not (Test-ExistingFile $script:Config.TunnelClientExecutable)) { return }
    if (-not (Test-RepositoryDirectory $script:Config.RepositoryDirectory)) { return }
    if (-not (Test-ExistingFile (Join-Path $script:Config.RepositoryDirectory "dist\index.js"))) { return }
    $setup = Join-Path $script:Config.RepositoryDirectory "scripts\setup-chatgpt-tunnel.ps1"
    if (-not (Test-ExistingFile $setup)) { return }
    $arguments = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $setup,
        "-SkipProjectSetup", "-NoPathPrompts", "-NoStartPrompt", "-ConfigureOnly",
        "-RepositoryDirectory", $script:Config.RepositoryDirectory,
        "-TunnelClientExecutable", $script:Config.TunnelClientExecutable,
        "-BridgeAddress", $script:Config.BridgeAddress,
        "-ProfileName", $script:Config.ProfileName,
        "-TunnelId", $script:Config.TunnelId
    )
    Set-Busy $true "Updating tunnel profile..."
    try {
        Invoke-ManagedProcess "powershell.exe" $arguments $script:Config.RepositoryDirectory
        Add-Log "Tunnel profile '$($script:Config.ProfileName)' now uses $($script:Config.BridgeAddress)." "OK"
    }
    finally { Set-Busy $false "Ready" }
}

function Apply-BridgeAddressChange {
    param([string]$NewAddress, [string]$StoppedMessage, [string]$RunningMessage)
    $previousAddress = Normalize-BridgeAddress $script:Config.BridgeAddress
    $normalizedNewAddress = Normalize-BridgeAddress $NewAddress
    $addressChanged = $previousAddress -ne $normalizedNewAddress
    $wasRunning = Test-BridgeRunning $previousAddress
    $script:AddressBox.Text = $normalizedNewAddress
    Update-ConfigFromFields
    if ($addressChanged -and $wasRunning) {
        Stop-Bridge -ForReload $true -Address $previousAddress
        Start-Bridge
        Add-Log $RunningMessage "OK"
    }
    elseif ($addressChanged) {
        Add-Log $StoppedMessage "OK"
    }
    elseif ($wasRunning) {
        Add-Log "Bridge address is already $normalizedNewAddress; the running bridge was left untouched." "OK"
    }
    else {
        Add-Log "Bridge address is already $normalizedNewAddress; the bridge remains stopped." "OK"
    }
    if ($addressChanged) { Sync-TunnelProfileDefinition }
}

function Apply-LanBridgeAddress {
    $port = Get-BridgePort $script:AddressBox.Text
    $address = "$(Get-PreferredLanAddress):$port"
    Apply-BridgeAddressChange $address "LAN address saved as http://$address/. The bridge was stopped, so it was not started." "Bridge is listening on the LAN at http://$address/."
}

function Apply-LocalBridgeAddress {
    $port = Get-BridgePort $script:AddressBox.Text
    $address = "localhost:$port"
    Apply-BridgeAddressChange $address "Local address saved as http://$address/. The bridge was stopped, so it was not started." "Bridge returned to local-only access at http://$address/."
}

function Save-And-Refresh {
    $previousAddress = Normalize-BridgeAddress $script:Config.BridgeAddress
    $newAddress = Normalize-BridgeAddress $script:AddressBox.Text
    $addressChanged = $previousAddress -ne $newAddress
    $wasRunning = $addressChanged -and (Test-BridgeRunning $previousAddress)
    Update-ConfigFromFields
    if ($addressChanged -and $wasRunning) {
        Stop-Bridge -ForReload $true -Address $previousAddress
        Start-Bridge
        Add-Log "Bridge reloaded from $previousAddress to $($script:Config.BridgeAddress)." "OK"
    }
    elseif ($addressChanged) {
        Add-Log "Bridge address saved as $($script:Config.BridgeAddress). The bridge was stopped, so it was not started." "OK"
    }
    if ($addressChanged) { Sync-TunnelProfileDefinition }
}

function Start-InteractiveUpdate {
    Update-ConfigFromFields
    if (-not (Test-RepositoryDirectory $script:Config.RepositoryDirectory)) { throw "Choose or install the MCP repository first." }
    $git = Find-Git
    if (-not $git) { throw "Git is missing. Click Install Git first." }
    $node = Find-Node
    if (-not $node) { throw "Node.js is missing. Click Install Node.js first." }
    $updater = Join-Path $script:Config.RepositoryDirectory "scripts\install-harnesses.mjs"
    if (-not (Test-ExistingFile $updater)) { throw "The MCP updater script is missing. Choose a valid repository or reinstall the MCP." }

    if ($null -ne $script:RepositoryUpdatePanel) { $script:RepositoryUpdatePanel.Visible = $false }
    Set-Busy $true "Updating the MCP repository..."
    try {
        Add-Log "Pulling the latest Roblox MCP Bridge..."
        Invoke-ManagedProcess $git @("-C", $script:Config.RepositoryDirectory, "pull", "--ff-only") $script:Config.RepositoryDirectory | Out-Null
        Add-Log "Rebuilding the updated MCP with Node.js..."
        Invoke-ManagedProcess $node @($updater, "--update", "--yes", "--plain", "--server-root", $script:Config.RepositoryDirectory) $script:Config.RepositoryDirectory | Out-Null
        Add-Log "MCP update completed. Reload the bridge to use the new build." "OK"
    }
    finally { Set-Busy $false "Ready" }
}

function Configure-Tunnel {
    Update-ConfigFromFields
    if (-not $script:Config.TunnelId) { throw "Enter the optional tunnel ID first (tunnel_...)." }
    $runtimeKey = $script:RuntimeKeyBox.Text
    if (-not $runtimeKey) { throw "Enter the OpenAI Platform runtime API key. It is used only in memory and is never saved." }
    if (-not (Test-ExistingFile $script:Config.TunnelClientExecutable)) { Install-TunnelClient; Update-ConfigFromFields }
    if (-not (Test-RepositoryBuildFresh $script:Config.RepositoryDirectory)) { Build-Repository }
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
    Show-TunnelWindow
    if ($null -ne $script:TunnelProcess -and -not $script:TunnelProcess.HasExited) {
        $script:TunnelWindow.Show()
        $script:TunnelWindow.Activate()
        Add-Log "The tunnel is already running." "OK"
        return
    }
    if (-not (Test-RepositoryBuildFresh $script:Config.RepositoryDirectory)) {
        Add-Log "Source files are newer than dist; rebuilding before tunnel startup..." "WARN"
        Build-Repository
        Update-ConfigFromFields
    }
    $runtimeKey = $script:RuntimeKeyBox.Text
    if ([string]::IsNullOrWhiteSpace($runtimeKey)) { $runtimeKey = [Environment]::GetEnvironmentVariable("CONTROL_PLANE_API_KEY", "Process") }
    if ([string]::IsNullOrWhiteSpace($runtimeKey)) { throw "Enter the OpenAI Platform runtime API key before starting the tunnel. It stays in memory and is never saved." }
    Unregister-TunnelEvents
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $script:Config.TunnelClientExecutable
    $start.Arguments = "run --profile " + (Quote-ProcessArgument $script:Config.ProfileName)
    $start.WorkingDirectory = $script:Config.RepositoryDirectory
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.EnvironmentVariables["CONTROL_PLANE_API_KEY"] = $runtimeKey
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw "Windows could not start tunnel-client.exe." }
        $script:TunnelProcess = $process
        Register-ObjectEvent -InputObject $process -EventName OutputDataReceived -SourceIdentifier $script:TunnelOutputSource | Out-Null
        Register-ObjectEvent -InputObject $process -EventName ErrorDataReceived -SourceIdentifier $script:TunnelErrorSource | Out-Null
        $process.BeginOutputReadLine()
        $process.BeginErrorReadLine()
        $script:TunnelTimer.Start()
        Set-TunnelStatus "RUNNING" $script:Colors.Success
        Append-TunnelOutput "Tunnel profile '$($script:Config.ProfileName)' started. Live output appears here."
        Add-Log "Tunnel started inside the manager. Open the tunnel window to view live output or stop it." "OK"
    }
    finally {
        if ($null -ne $start -and $start.EnvironmentVariables.ContainsKey("CONTROL_PLANE_API_KEY")) { $start.EnvironmentVariables["CONTROL_PLANE_API_KEY"] = "" }
        $runtimeKey = $null
        $script:RuntimeKeyBox.Clear()
    }
}

function Append-TunnelOutput {
    param([string]$Text, [bool]$ErrorText = $false)
    if ([string]::IsNullOrWhiteSpace($Text) -or $null -eq $script:TunnelLogBox) { return }
    $script:TunnelLogBox.SelectionStart = $script:TunnelLogBox.TextLength
    $script:TunnelLogBox.SelectionColor = if ($ErrorText) { $script:Colors.Danger } else { $script:Colors.Text }
    $script:TunnelLogBox.AppendText("[$((Get-Date).ToString('HH:mm:ss'))] $Text" + [Environment]::NewLine)
    $script:TunnelLogBox.SelectionStart = $script:TunnelLogBox.TextLength
    $script:TunnelLogBox.ScrollToCaret()
}

function Set-TunnelStatus {
    param([string]$Text, $Color)
    if ($null -ne $script:TunnelStatus) {
        $script:TunnelStatus.Text = $Text
        $script:TunnelStatus.ForeColor = $Color
    }
}

function Unregister-TunnelEvents {
    foreach ($source in @($script:TunnelOutputSource, $script:TunnelErrorSource)) {
        Unregister-Event -SourceIdentifier $source -ErrorAction SilentlyContinue
        Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue | Remove-Event -ErrorAction SilentlyContinue
    }
}

function Drain-TunnelOutput {
    foreach ($item in @(
        [pscustomobject]@{ Source = $script:TunnelOutputSource; ErrorText = $false },
        [pscustomobject]@{ Source = $script:TunnelErrorSource; ErrorText = $true }
    )) {
        $events = @(Get-Event -SourceIdentifier $item.Source -ErrorAction SilentlyContinue)
        foreach ($event in $events) {
            $line = [string]$event.SourceEventArgs.Data
            if (-not [string]::IsNullOrWhiteSpace($line)) { Append-TunnelOutput $line $item.ErrorText }
            Remove-Event -EventIdentifier $event.EventIdentifier -ErrorAction SilentlyContinue
        }
    }
}

function Update-TunnelProcessState {
    Drain-TunnelOutput
    if ($null -eq $script:TunnelProcess -or -not $script:TunnelProcess.HasExited) { return }
    $exitCode = $script:TunnelProcess.ExitCode
    $script:TunnelProcess.WaitForExit()
    Drain-TunnelOutput
    Unregister-TunnelEvents
    $script:TunnelProcess.Dispose()
    $script:TunnelProcess = $null
    $script:TunnelTimer.Stop()
    if ($exitCode -eq 0) {
        Set-TunnelStatus "STOPPED" $script:Colors.Muted
        Append-TunnelOutput "Tunnel stopped."
    }
    else {
        Set-TunnelStatus "EXITED $exitCode" $script:Colors.Danger
        Append-TunnelOutput "Tunnel exited with code $exitCode." $true
    }
    if (-not $script:ClosingManager) { Refresh-Status }
}

function Stop-Tunnel {
    param([bool]$Quiet = $false)
    if ($null -eq $script:TunnelProcess -or $script:TunnelProcess.HasExited) {
        Update-TunnelProcessState
        if (-not $Quiet) { Append-TunnelOutput "The tunnel is not running." }
        return
    }
    try { $script:TunnelProcess.Kill() } catch { }
    $script:TunnelProcess.WaitForExit(5000) | Out-Null
    Update-TunnelProcessState
    if (-not $Quiet) { Add-Log "Tunnel stopped from the manager." "OK" }
}

function Show-TunnelWindow {
    if ($null -ne $script:TunnelWindow -and -not $script:TunnelWindow.IsDisposed) {
        $script:TunnelWindow.Show()
        $script:TunnelWindow.Activate()
        return
    }
    $window = New-Object Windows.Forms.Form
    $window.Text = "ChatGPT Tunnel"
    $window.ClientSize = New-Object Drawing.Size(850, 520)
    $window.MinimumSize = New-Object Drawing.Size(720, 460)
    $window.StartPosition = "CenterParent"
    $window.BackColor = $script:Colors.Background
    $window.ForeColor = $script:Colors.Text
    $window.Font = New-Object Drawing.Font("Segoe UI", 9)
    if (Test-ExistingFile $IconPath) { try { $window.Icon = New-Object Drawing.Icon($IconPath) } catch { } }
    New-UiLabel $window "TUNNEL CONSOLE" 24 18 240 24 9 $true $script:Colors.Muted | Out-Null
    New-UiLabel $window "Live tunnel output stays inside the manager. No terminal window is opened." 24 44 650 24 11 $true | Out-Null
    $script:TunnelStatus = New-UiLabel $window "STOPPED" 690 20 130 24 9 $true $script:Colors.Muted
    $script:TunnelStatus.TextAlign = [Drawing.ContentAlignment]::MiddleRight
    $logCard = New-Card $window 24 82 802 352
    $script:TunnelLogBox = New-Object Windows.Forms.RichTextBox
    $script:TunnelLogBox.ReadOnly = $true
    $script:TunnelLogBox.BorderStyle = [Windows.Forms.BorderStyle]::None
    $script:TunnelLogBox.Dock = [Windows.Forms.DockStyle]::Fill
    $script:TunnelLogBox.BackColor = $script:Colors.Surface
    $script:TunnelLogBox.ForeColor = $script:Colors.Text
    $script:TunnelLogBox.Font = New-Object Drawing.Font("Cascadia Mono", 9)
    $script:TunnelLogBox.DetectUrls = $false
    $logCard.Padding = New-Object Windows.Forms.Padding(12)
    $logCard.Controls.Add($script:TunnelLogBox)
    New-UiButton $window "Start" 24 454 112 38 { Start-Tunnel } "Tunnel startup failed" $true | Out-Null
    New-UiButton $window "Stop" 148 454 112 38 { Stop-Tunnel } "Tunnel stop failed" | Out-Null
    New-UiButton $window "Clear output" 272 454 132 38 { $script:TunnelLogBox.Clear() } "Could not clear output" | Out-Null
    New-UiButton $window "Hide" 714 454 112 38 { $script:TunnelWindow.Hide() } "Could not hide tunnel window" | Out-Null
    $window.Add_FormClosing({
        param($sender, $eventArgs)
        if (-not $script:ClosingManager) {
            $eventArgs.Cancel = $true
            $sender.Hide()
        }
    })
    $script:TunnelWindow = $window
    if ($null -ne $script:TunnelProcess -and -not $script:TunnelProcess.HasExited) { Set-TunnelStatus "RUNNING" $script:Colors.Success }
    $window.Show($script:Form)
}

function Copy-RobloxLoader {
    Update-ConfigFromFields
    $address = $script:Config.BridgeAddress
    $loaderAddress = if ($address -eq "localhost:16384") { "127.0.0.1:16384" } else { $address }
    $loader = @(
        "getgenv().BridgeURL = `"$loaderAddress`""
        ""
        "if getgenv().MCP_AutoReconnect then"
        "    return"
        "end"
        ""
        "getgenv().MCP_AutoReconnect = true"
        ""
        "while getgenv().MCP_AutoReconnect do"
        "    local Success, Source = pcall(function()"
        "        return game:HttpGet(`"http://`" .. getgenv().BridgeURL .. `"/script.luau`")"
        "    end)"
        ""
        "    if not Success or type(Source) ~= `"string`" or Source == `"`" then"
        "        task.wait(2)"
        "        continue"
        "    end"
        ""
        "    local Bridge = loadstring(Source)"
        ""
        "    if not Bridge then"
        "        task.wait(2)"
        "        continue"
        "    end"
        ""
        "    getgenv().MCP_Loaded = false"
        ""
        "    pcall(Bridge)"
        ""
        "    getgenv().MCP_Loaded = false"
        ""
        "    task.wait(2)"
        "end"
    ) -join "`r`n"
    [Windows.Forms.Clipboard]::SetText($loader)
    Add-Log "Roblox loader copied to the clipboard." "OK"
}

function Get-LatestManagerRelease {
    param([bool]$Refresh = $false)
    if ($script:LatestManagerRelease -and -not $Refresh) { return $script:LatestManagerRelease }

    $release = Invoke-RestMethod -Uri $script:LatestReleaseApiUrl -TimeoutSec 10 -Headers @{
        "User-Agent" = "roblox-mcp-manager/$($script:ManagerVersion)"
        "Accept" = "application/vnd.github+json"
    }
    $version = ([string]$release.tag_name).Trim().TrimStart("v")
    if (-not $version) { throw "The latest GitHub release did not include a version tag." }
    $expectedName = "RobloxMcpManager-v$version.exe"
    $asset = $release.assets | Where-Object { $_.name -eq $expectedName } | Select-Object -First 1
    if (-not $asset) {
        $asset = $release.assets | Where-Object { $_.name -like "RobloxMcpManager*.exe" } | Select-Object -First 1
    }
    if (-not $asset -or -not $asset.browser_download_url) { throw "Release v$version does not contain a Windows manager executable." }
    $digest = [string]$asset.digest
    if ($digest -notmatch '^sha256:(?<hash>[a-fA-F0-9]{64})$') {
        throw "Release v$version is missing its GitHub SHA-256 digest; the manager will not install an unverified executable."
    }
    $script:LatestManagerRelease = [pscustomobject]@{
        Version = $version
        DownloadUrl = [string]$asset.browser_download_url
        Sha256 = $Matches['hash'].ToLowerInvariant()
        Size = [long]$asset.size
        PageUrl = [string]$release.html_url
    }
    return $script:LatestManagerRelease
}

function Install-ManagerRelease {
    param($Release)
    if ([string]::IsNullOrWhiteSpace($script:ManagerExecutable) -or -not (Test-ExistingFile $script:ManagerExecutable)) {
        throw "This manager was started from its PowerShell source, so there is no launcher EXE to replace. Generate or download RobloxMcpManager.exe first."
    }

    $target = [IO.Path]::GetFullPath($script:ManagerExecutable)
    $directory = Split-Path -Parent $target
    $download = Join-Path $directory ("." + [IO.Path]::GetFileName($target) + ".download-" + [Guid]::NewGuid().ToString("N") + ".exe")
    $backup = $target + ".previous-v" + $script:ManagerVersion + "-" + [Guid]::NewGuid().ToString("N") + ".exe"
    $restartAfterInstall = $false
    Set-Busy $true "Downloading manager v$($Release.Version)..."
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $Release.DownloadUrl -OutFile $download -TimeoutSec 60 -Headers @{ "User-Agent" = "roblox-mcp-manager/$($script:ManagerVersion)" }
        if (-not (Test-ExistingFile $download)) { throw "The manager download did not create a file." }
        $downloadInfo = Get-Item -LiteralPath $download
        if ($downloadInfo.Length -lt 50000) { throw "The downloaded manager is unexpectedly small ($($downloadInfo.Length) bytes)." }
        if ($Release.Size -gt 0 -and $downloadInfo.Length -ne $Release.Size) { throw "The manager download size does not match GitHub's release metadata." }
        $actualHash = (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualHash -ne $Release.Sha256) { throw "The manager SHA-256 verification failed. Expected $($Release.Sha256), received $actualHash." }
        $header = [IO.File]::ReadAllBytes($download)[0..1]
        if ($header[0] -ne 0x4D -or $header[1] -ne 0x5A) { throw "The verified download is not a Windows executable." }

        [IO.File]::Replace($download, $target, $backup, $true)
        Add-Log "Manager updated to v$($Release.Version). Backup: $backup" "OK"
        if ([Windows.Forms.MessageBox]::Show("Roblox MCP Manager v$($Release.Version) was installed and verified.`r`n`r`nRestart the manager now?", "Manager updated", 4, 64) -eq "Yes") {
            $restartAfterInstall = $true
        }
    }
    finally {
        if (Test-Path -LiteralPath $download -PathType Leaf) { Remove-Item -LiteralPath $download -Force -ErrorAction SilentlyContinue }
        Set-Busy $false "Ready"
    }
    if ($restartAfterInstall) {
        Start-Process -FilePath $target
        $script:Form.Close()
    }
}

function Get-InstalledManagerSha256 {
    if ([string]::IsNullOrWhiteSpace($script:ManagerExecutable) -or -not (Test-ExistingFile $script:ManagerExecutable)) {
        return $null
    }
    try {
        return (Get-FileHash -LiteralPath $script:ManagerExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    catch {
        Add-Log "Could not hash the installed manager executable: $($_.Exception.Message)" "WARN"
        return $null
    }
}

function Check-ManagerUpdate {
    param([bool]$Manual = $false)
    if ($script:ManagerVersion -eq "source") {
        if ($Manual) { throw "Self-update is available in the generated/downloaded manager EXE, not when running windows-mcp-manager.ps1 directly." }
        return
    }

    $release = Get-LatestManagerRelease $Manual
    $comparison = Compare-VersionText $script:ManagerVersion $release.Version
    $sameVersionRefresh = $false
    $installedHash = $null

    if ($comparison -gt 0) {
        if ($Manual) {
            [Windows.Forms.MessageBox]::Show("Roblox MCP Manager v$($script:ManagerVersion) is newer than the latest published release (v$($release.Version)).", "Manager is up to date", 0, 64) | Out-Null
        }
        return
    }

    if ($comparison -eq 0) {
        $installedHash = Get-InstalledManagerSha256
        if (-not $installedHash) {
            if ($Manual) { throw "The installed manager executable could not be hashed, so same-version release freshness could not be verified." }
            return
        }
        if ($installedHash -eq $release.Sha256) {
            if ($Manual) {
                [Windows.Forms.MessageBox]::Show("Roblox MCP Manager v$($script:ManagerVersion) is current and matches the published SHA-256.", "Manager is up to date", 0, 64) | Out-Null
            }
            return
        }
        $sameVersionRefresh = $true
    }

    $script:PromptedForManagerUpdate = $true
    if ($sameVersionRefresh) {
        $installedShort = $installedHash.Substring(0, 12)
        $publishedShort = $release.Sha256.Substring(0, 12)
        $message = "A refreshed build of Roblox MCP Manager v$($release.Version) is available even though the version number is unchanged.`r`n`r`nInstalled SHA-256: $installedShort...`r`nPublished SHA-256: $publishedShort...`r`n`r`nDownload, verify, and install the refreshed build now?"
        $title = "Manager build update available"
    }
    else {
        $message = "Roblox MCP Manager v$($release.Version) is available (installed: v$($script:ManagerVersion)).`r`n`r`nDownload, verify, and install it now?"
        $title = "Manager update available"
    }

    if ([Windows.Forms.MessageBox]::Show($message, $title, 4, 64) -eq "Yes") {
        Install-ManagerRelease $release
    }
}

function Restart-AsAdministrator {
    Update-ConfigFromFields
    $exe = $script:ManagerExecutable
    if (-not (Test-ExistingFile $exe)) { $exe = Join-Path (Split-Path -Parent $script:ConfigFile) "RobloxMcpManager.exe" }
    if (Test-Path -LiteralPath $exe -PathType Leaf) {
        Start-Process -FilePath $exe -Verb RunAs
    }
    else {
        Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $PSCommandPath, "-ConfigPath", $script:ConfigFile)
    }
    $script:Form.Close()
}

function Show-RepositoryUpdateNotice {
    param([string]$LocalVersion, [string]$RemoteVersion)
    $script:PromptedForUpdate = $true
    if ($null -eq $script:RepositoryUpdatePanel) { return }
    $script:RepositoryUpdateText.Text = "MCP v$RemoteVersion is available. You have v$LocalVersion."
    $script:RepositoryUpdatePanel.Visible = $true
    $script:RepositoryUpdatePanel.BringToFront()
}

function Refresh-Status {
    Refresh-ProcessPath
    $git = Find-Git
    $nodeVersion = Get-NodeVersion
    $npm = Find-Npm
    $repoReady = Test-RepositoryDirectory $script:RepoBox.Text
    $buildReady = $repoReady -and (Test-RepositoryBuildFresh $script:RepoBox.Text)
    $tunnelReady = Test-ExistingFile $script:TunnelBox.Text
    $tunnelRunning = $null -ne $script:TunnelProcess -and -not $script:TunnelProcess.HasExited
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
    Set-StatusValue "Tunnel" $(if ($tunnelRunning) { "Running" } elseif ($tunnelReady) { "Client ready" } else { "Optional" }) $(if ($tunnelRunning -or $tunnelReady) { "Good" } else { "Muted" })
    Set-StatusValue "Access" $(if (Test-IsAdministrator) { "Administrator" } else { "Standard user" }) $(if (Test-IsAdministrator) { "Good" } else { "Muted" })

    $ready = $repoReady -and $buildReady -and $git -and $nodeReady
    $script:ActionStatus.Text = if ($ready) { "SYSTEM READY" } else { "SETUP NEEDED" }
    $script:ActionStatus.BackColor = if ($ready) { $script:Colors.SuccessDark } else { $script:Colors.WarningDark }
    $script:ActionStatus.ForeColor = if ($ready) { $script:Colors.Success } else { $script:Colors.Warning }
    $script:HealthTitle.Text = if ($ready) { "Everything looks good" } else { "A few things need attention" }
    $script:HealthSubtitle.Text = if ($ready) { "Start the bridge when you are ready." } else { "Use Quick setup below to finish installation." }

    if (-not $script:PromptedForUpdate -and $localVersion -and $remoteVersion -and (Compare-VersionText $localVersion $remoteVersion) -lt 0) {
        Show-RepositoryUpdateNotice $localVersion $remoteVersion
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

function New-RoundedPath {
    param([Drawing.Rectangle]$Rectangle, [int]$Radius)
    $path = New-Object Drawing.Drawing2D.GraphicsPath
    $diameter = [Math]::Min(($Radius * 2), [Math]::Min($Rectangle.Width, $Rectangle.Height))
    if ($diameter -le 1) {
        $path.AddRectangle($Rectangle)
        return $path
    }
    $arc = New-Object Drawing.Rectangle($Rectangle.X, $Rectangle.Y, $diameter, $diameter)
    $path.AddArc($arc, 180, 90)
    $arc.X = $Rectangle.Right - $diameter
    $path.AddArc($arc, 270, 90)
    $arc.Y = $Rectangle.Bottom - $diameter
    $path.AddArc($arc, 0, 90)
    $arc.X = $Rectangle.Left
    $path.AddArc($arc, 90, 90)
    $path.CloseFigure()
    return $path
}

function Set-RoundedRegion {
    param($Control, [int]$Radius)
    $applyRegion = {
        param($Target)
        if ($Target.Width -le 1 -or $Target.Height -le 1) { return }
        $path = New-RoundedPath (New-Object Drawing.Rectangle(0, 0, $Target.Width, $Target.Height)) $Radius
        try {
            $oldRegion = $Target.Region
            $Target.Region = New-Object Drawing.Region($path)
            if ($oldRegion) { $oldRegion.Dispose() }
        }
        finally { $path.Dispose() }
    }.GetNewClosure()
    & $applyRegion $Control
    $Control.Add_SizeChanged({ & $applyRegion $this }.GetNewClosure())
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
    Set-RoundedRegion $panel 12
    $panel.Add_Paint({
        param($sender, $eventArgs)
        $pen = New-Object Drawing.Pen($borderColor)
        $eventArgs.Graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $path = New-RoundedPath (New-Object Drawing.Rectangle(0, 0, ($sender.Width - 1), ($sender.Height - 1))) 12
        try { $eventArgs.Graphics.DrawPath($pen, $path) } finally { $path.Dispose(); $pen.Dispose() }
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
    $button.FlatAppearance.BorderSize = 0
    $button.BackColor = if ($Primary) { $script:Colors.Accent } else { $script:Colors.SurfaceAlt }
    $button.ForeColor = $script:Colors.Text
    $button.Cursor = [Windows.Forms.Cursors]::Hand
    $button.Font = New-Object Drawing.Font("Segoe UI Semibold", 9)
    $hover = if ($Primary) { $script:Colors.AccentHover } else { [Drawing.Color]::FromArgb(31, 42, 61) }
    $normal = $button.BackColor
    $buttonBorder = $script:Colors.Border
    Set-RoundedRegion $button 8
    if (-not $Primary) {
        $button.Add_Paint({
            param($sender, $eventArgs)
            $eventArgs.Graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $pen = New-Object Drawing.Pen($buttonBorder)
            $path = New-RoundedPath (New-Object Drawing.Rectangle(0, 0, ($sender.Width - 1), ($sender.Height - 1))) 8
            try { $eventArgs.Graphics.DrawPath($pen, $path) } finally { $path.Dispose(); $pen.Dispose() }
        }.GetNewClosure())
    }
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
    Set-RoundedRegion $box 5
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
    param(
        $Parent,
        [string]$Label,
        [int]$Top,
        [string]$Value,
        [string]$ButtonText,
        [scriptblock]$Click,
        [string]$SecondButtonText = "",
        [scriptblock]$SecondClick = $null
    )
    New-UiLabel $Parent $Label 22 $Top 730 19 8.5 $false $script:Colors.Muted | Out-Null
    $hasSecondButton = -not [string]::IsNullOrWhiteSpace($SecondButtonText) -and $null -ne $SecondClick
    $boxWidth = if ($hasSecondButton) { 584 } else { 632 }
    $box = New-UiTextBox $Parent $Value 22 ($Top + 22) $boxWidth
    if ($hasSecondButton) {
        New-UiButton $Parent $ButtonText 618 ($Top + 20) 76 30 ({ & $Click }.GetNewClosure()) "Address change failed" | Out-Null
        New-UiButton $Parent $SecondButtonText 702 ($Top + 20) 72 30 ({ & $SecondClick }.GetNewClosure()) "Address change failed" | Out-Null
    }
    else {
        New-UiButton $Parent $ButtonText 666 ($Top + 20) 108 30 ({ & $Click }.GetNewClosure()) "Selection failed" | Out-Null
    }
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

$script:TunnelTimer = New-Object Windows.Forms.Timer
$script:TunnelTimer.Interval = 150
$script:TunnelTimer.Add_Tick({ Update-TunnelProcessState })

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
New-UiLabel $header $(if ($script:ManagerVersion -eq "source") { "SOURCE MODE" } else { "MANAGER v$($script:ManagerVersion)" }) 638 55 120 22 8 $true $script:Colors.Muted | Out-Null
New-UiButton $header "Update manager" 760 31 150 36 { Check-ManagerUpdate $true } "Manager update failed" | Out-Null
New-UiButton $header "Restart as administrator" 920 31 212 36 { Restart-AsAdministrator } "Administrator restart failed" | Out-Null

$health = New-Card $script:Form 20 112 300 688
New-UiLabel $health "SYSTEM HEALTH" 22 18 150 20 8.5 $true $script:Colors.Muted | Out-Null
$script:ActionStatus = New-UiLabel $health "CHECKING" 178 16 100 25 8 $true $script:Colors.Warning
$script:ActionStatus.TextAlign = [Drawing.ContentAlignment]::MiddleCenter
Set-RoundedRegion $script:ActionStatus 6
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
$script:AddressBox = Add-PathField $paths "Dashboard / Roblox address (changes apply immediately)" 208 $script:Config.BridgeAddress "Use LAN" {
    Apply-LanBridgeAddress
} "Use local" {
    Apply-LocalBridgeAddress
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
New-UiButton $actions "Start" 22 37 92 32 { Start-Bridge } "Bridge startup failed" $true | Out-Null
New-UiButton $actions "Reload" 124 37 92 32 { Reload-Bridge } "Bridge reload failed" | Out-Null
New-UiButton $actions "Disconnect" 226 37 100 32 { Disconnect-Bridge } "Bridge disconnect failed" | Out-Null
New-UiButton $actions "Dashboard" 336 37 100 32 { Start-Process ("http://" + (Normalize-BridgeAddress $script:AddressBox.Text) + "/") } "Dashboard failed" | Out-Null
New-UiButton $actions "Update" 446 37 92 32 { Start-InteractiveUpdate } "Updater failed" | Out-Null
New-UiButton $actions "Copy loader" 548 37 100 32 { Copy-RobloxLoader } "Clipboard failed" | Out-Null
New-UiButton $actions "Save + refresh" 658 37 116 32 { Save-And-Refresh } "Invalid settings" | Out-Null

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

$script:RepositoryUpdatePanel = New-Card $script:Form 576 102 564 86
$script:RepositoryUpdatePanel.BackColor = $script:Colors.WarningDark
$script:RepositoryUpdatePanel.Visible = $false
New-UiLabel $script:RepositoryUpdatePanel "MCP UPDATE AVAILABLE" 18 12 190 18 8 $true $script:Colors.Warning | Out-Null
$script:RepositoryUpdateText = New-UiLabel $script:RepositoryUpdatePanel "A newer MCP version is ready." 18 34 300 34 9.5 $true $script:Colors.Text
New-UiButton $script:RepositoryUpdatePanel "Update now" 330 25 112 36 {
    $script:RepositoryUpdatePanel.Visible = $false
    Start-InteractiveUpdate
} "MCP update failed" $true | Out-Null
New-UiButton $script:RepositoryUpdatePanel "Later" 452 25 92 36 {
    $script:PromptedForUpdate = $true
    $script:RepositoryUpdatePanel.Visible = $false
} "Could not dismiss update" | Out-Null

Add-Log "Manager started. Your OpenAI runtime key is memory-only and is never written to disk."
$script:Form.Add_FormClosing({
    $script:ClosingManager = $true
    if ($null -ne $script:TunnelTimer) { $script:TunnelTimer.Stop() }
    Stop-Tunnel $true
    Unregister-TunnelEvents
    if ($null -ne $script:TunnelWindow -and -not $script:TunnelWindow.IsDisposed) { $script:TunnelWindow.Dispose() }
})
$script:Form.Add_Shown({
    if ($PreviewPath) { $script:PromptedForUpdate = $true; $script:PromptedForManagerUpdate = $true }
    Refresh-Status
    if (-not $PreviewPath -and -not $script:PromptedForManagerUpdate) {
        try { Check-ManagerUpdate $false } catch { Add-Log "Manager update check failed: $($_.Exception.Message)" "WARN" }
    }
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
