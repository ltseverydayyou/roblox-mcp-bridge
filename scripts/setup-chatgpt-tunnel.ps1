#requires -Version 5.1

[CmdletBinding()]
param(
    [string]$ProfileName = "roblox-executor",

    [string]$TunnelId = "",

    [string]$TunnelClientDirectory = (Join-Path $env:LOCALAPPDATA "OpenAI\tunnel-client"),

    [string]$TunnelClientExecutable = "",

    [string]$RepositoryDirectory = (Split-Path -Parent $PSScriptRoot),

    [string]$BridgeAddress = "localhost:16384",

    [string]$ManagerOutputDirectory = ([Environment]::GetFolderPath("Desktop")),

    [switch]$SkipProjectSetup,

    [switch]$UpdateTunnelClient,

    [switch]$NoPathPrompts,

    [switch]$CreateManager,

    [switch]$NoStartPrompt,

    [switch]$ConfigureOnly,

    [switch]$Start
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-CheckedCommand {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$FailureMessage
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)."
    }
}



function Get-TunnelProfileDirectory {
    $explicit = [Environment]::GetEnvironmentVariable("TUNNEL_CLIENT_PROFILE_DIR", "Process")
    if (-not [string]::IsNullOrWhiteSpace($explicit)) { return [IO.Path]::GetFullPath($explicit) }
    $xdg = [Environment]::GetEnvironmentVariable("XDG_CONFIG_HOME", "Process")
    if (-not [string]::IsNullOrWhiteSpace($xdg)) { return [IO.Path]::GetFullPath((Join-Path $xdg "tunnel-client")) }
    return [IO.Path]::GetFullPath((Join-Path $HOME ".config\tunnel-client"))
}

function Get-TunnelProfileFile {
    param([string]$Name)
    $directory = Get-TunnelProfileDirectory
    $yaml = Join-Path $directory "$Name.yaml"
    $yml = Join-Path $directory "$Name.yml"
    if (Test-Path -LiteralPath $yaml -PathType Leaf) { return $yaml }
    if (Test-Path -LiteralPath $yml -PathType Leaf) { return $yml }
    return $yaml
}

function Invoke-TunnelProfileInit {
    param(
        [string]$TunnelExecutable,
        [string]$Name,
        [string]$TunnelId,
        [string]$McpCommand
    )
    $arguments = @(
        "init",
        "--force",
        "--sample", "sample_mcp_stdio_local",
        "--profile", $Name,
        "--tunnel-id", $TunnelId,
        "--mcp-command", $McpCommand
    )
    Invoke-CheckedCommand -FilePath $TunnelExecutable -Arguments $arguments -FailureMessage "Could not configure tunnel profile '$Name'"
}

function Read-RuntimeApiKey {
    $existingKey = [Environment]::GetEnvironmentVariable("CONTROL_PLANE_API_KEY", "Process")
    if (-not [string]::IsNullOrWhiteSpace($existingKey)) {
        return $existingKey
    }
    $secureKey = Read-Host "Paste the OpenAI Platform Runtime API key (input is hidden)" -AsSecureString
    try {
        $plainKey = [System.Net.NetworkCredential]::new("", $secureKey).Password
        if ([string]::IsNullOrWhiteSpace($plainKey)) {
            throw "The runtime API key cannot be empty."
        }
        return $plainKey
    }
    finally {
        if ($secureKey -is [System.IDisposable]) {
            $secureKey.Dispose()
        }
    }
}

function Select-Directory {
    param([string]$InitialDirectory, [string]$Description)

    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = $Description
    $dialog.ShowNewFolderButton = $true
    if (Test-Path -LiteralPath $InitialDirectory -PathType Container) {
        $dialog.SelectedPath = [System.IO.Path]::GetFullPath($InitialDirectory)
    }
    try {
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $dialog.SelectedPath }
        return $null
    }
    finally {
        $dialog.Dispose()
    }
}

function Select-Executable {
    param([string]$InitialPath)

    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = "Select OpenAI tunnel-client.exe"
    $dialog.Filter = "OpenAI tunnel client (tunnel-client.exe)|tunnel-client.exe|Executable files (*.exe)|*.exe"
    $dialog.CheckFileExists = $true
    if (Test-Path -LiteralPath $InitialPath -PathType Leaf) { $dialog.FileName = [System.IO.Path]::GetFullPath($InitialPath) }
    try {
        if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { return $dialog.FileName }
        return $null
    }
    finally {
        $dialog.Dispose()
    }
}

function Test-McpRepository {
    param([string]$Directory)
    $manifest = Join-Path $Directory "package.json"
    if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { return $false }
    try { return (Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).name -eq "roblox-mcp-server" } catch { return $false }
}

function Normalize-BridgeAddress {
    param([string]$Value)
    $candidate = ([string]$Value).Trim().TrimEnd("/")
    if (-not $candidate) { $candidate = "localhost:16384" }
    if ($candidate -notmatch '^[a-z][a-z0-9+.-]*://') { $candidate = "http://$candidate" }
    try { $uri = [Uri]$candidate } catch { throw "Enter a bridge address like localhost:16384 or 192.168.1.25:16384." }
    if ($uri.Scheme -notin @("http", "https") -or -not $uri.Host -or $uri.AbsolutePath -ne "/" -or $uri.Query -or $uri.Fragment) {
        throw "Enter only a host/IP and port, such as 192.168.1.25:16384."
    }
    $authority = $candidate -replace '^[a-z][a-z0-9+.-]*://', ''
    $explicitPort = [regex]::Match($authority, ':(?<port>[0-9]+)$')
    $port = if ($explicitPort.Success) { [int]$explicitPort.Groups['port'].Value } else { 16384 }
    if ($port -lt 1 -or $port -gt 65535) { throw "The bridge port must be between 1 and 65535." }
    return "$($uri.Host):$port"
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "This setup script is for Windows."
}

if ($ProfileName -notmatch '^[A-Za-z0-9._-]+$') {
    throw "ProfileName may only contain letters, numbers, periods, underscores, and hyphens."
}

if (-not $NoPathPrompts) {
    $useDetectedRepository = (Read-Host "Use detected MCP folder '$RepositoryDirectory'? [Y/n]").Trim()
    if ($useDetectedRepository -match '^(n|no)$') {
        $selectedRepository = Select-Directory $RepositoryDirectory "Select the Roblox MCP Bridge folder"
        if ($selectedRepository) { $RepositoryDirectory = $selectedRepository }
    }
}

$repositoryPath = [System.IO.Path]::GetFullPath($RepositoryDirectory)
if (-not (Test-McpRepository $repositoryPath)) {
    throw "$repositoryPath is not a Roblox MCP Bridge folder. Select the folder containing the roblox-mcp-server package.json."
}

if (-not $NoPathPrompts -and -not $PSBoundParameters.ContainsKey("BridgeAddress")) {
    $selectedBridgeAddress = (Read-Host "Roblox/dashboard address [localhost:16384]").Trim()
    if ($selectedBridgeAddress) { $BridgeAddress = $selectedBridgeAddress }
}
$BridgeAddress = Normalize-BridgeAddress $BridgeAddress

$entryPoint = Join-Path $repositoryPath "dist\index.js"
$runWithBun = Join-Path $repositoryPath "scripts\run-with-bun.mjs"
$harnessInstaller = Join-Path $repositoryPath "scripts\install-harnesses.mjs"
$tunnelInstaller = Join-Path $PSScriptRoot "install-tunnel-client.ps1"
$tunnelDirectory = [System.IO.Path]::GetFullPath($TunnelClientDirectory)
$tunnelExecutable = if ($TunnelClientExecutable) {
    [System.IO.Path]::GetFullPath($TunnelClientExecutable)
}
else {
    Join-Path $tunnelDirectory "tunnel-client.exe"
}

if (-not $NoPathPrompts -and -not $PSBoundParameters.ContainsKey("TunnelClientExecutable")) {
    if (Test-Path -LiteralPath $tunnelExecutable -PathType Leaf) {
        $tunnelChoice = (Read-Host "Use tunnel client '$tunnelExecutable'? [Y/b browse]").Trim()
        if ($tunnelChoice -match '^(b|browse)$') {
            $selectedTunnel = Select-Executable $tunnelExecutable
            if ($selectedTunnel) { $tunnelExecutable = $selectedTunnel }
        }
    }
    else {
        $browseExisting = (Read-Host "No tunnel client was found at '$tunnelExecutable'. Browse for an existing tunnel-client.exe? [y/N]").Trim()
        if ($browseExisting -match '^(y|yes)$') {
            $selectedTunnel = Select-Executable ""
            if ($selectedTunnel) { $tunnelExecutable = $selectedTunnel }
        }
        else {
            $selectedTunnelDirectory = Select-Directory $tunnelDirectory "Choose where to install OpenAI tunnel-client"
            if ($selectedTunnelDirectory) {
                $tunnelDirectory = [System.IO.Path]::GetFullPath($selectedTunnelDirectory)
                $tunnelExecutable = Join-Path $tunnelDirectory "tunnel-client.exe"
            }
        }
    }
}

foreach ($requiredFile in @($runWithBun, $harnessInstaller, $tunnelInstaller)) {
    if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
        throw "Required repository file not found: $requiredFile"
    }
}

$node = Get-Command "node.exe" -ErrorAction SilentlyContinue
if (-not $node) {
    throw "Node.js 18 or newer is required. Install Node.js, reopen PowerShell, and run this script again."
}

$nodeVersionText = (& $node.Source --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersionText -notmatch '^v(?<major>[0-9]+)') {
    throw "Could not determine the installed Node.js version."
}
if ([int]$Matches.major -lt 18) {
    throw "Node.js 18 or newer is required; found $nodeVersionText."
}

if (-not $SkipProjectSetup) {
    Write-Step "Running the Roblox MCP installer"
    Write-Host "Use its prompts to select clients, build the server, and install the executor autoexec loader."
    $projectSetupCommand = @{
        FilePath = $node.Source
        Arguments = @($runWithBun, $harnessInstaller, "--plain", "--server-root", $repositoryPath, "--no-manager")
        FailureMessage = "The Roblox MCP installer failed"
    }
    Invoke-CheckedCommand @projectSetupCommand
}

if (-not (Test-Path -LiteralPath $entryPoint -PathType Leaf)) {
    throw "The MCP build was not found at $entryPoint. Run this script without -SkipProjectSetup."
}

if ($UpdateTunnelClient -or -not (Test-Path -LiteralPath $tunnelExecutable -PathType Leaf)) {
    Write-Step "Installing the latest official OpenAI tunnel-client"
    $tunnelDirectory = Split-Path -Parent $tunnelExecutable
    & $tunnelInstaller -InstallDirectory $tunnelDirectory
    if (-not $?) {
        throw "The tunnel-client installer failed."
    }
}
else {
    Write-Step "Using tunnel-client at $tunnelExecutable"
}

if (-not (Test-Path -LiteralPath $tunnelExecutable -PathType Leaf)) {
    throw "tunnel-client.exe was not found at $tunnelExecutable."
}

if ($TunnelId -and $TunnelId -notmatch '^tunnel_[A-Za-z0-9]+$') {
    throw "TunnelId must look like tunnel_ followed by letters and numbers."
}
while (-not $TunnelId) {
    $TunnelId = (Read-Host "Paste the OpenAI tunnel ID (tunnel_...)").Trim()
    if ($TunnelId -notmatch '^tunnel_[A-Za-z0-9]+$') { $TunnelId = "" }
}

$portableEntryPoint = $entryPoint.Replace("\", "/")
$mcpCommand = 'node "' + $portableEntryPoint + '"'
$bridgeUri = [Uri]("http://" + $BridgeAddress)
if ($bridgeUri.Host -notin @("localhost", "127.0.0.1", "::1")) {
    $mcpCommand += ' --host 0.0.0.0'
}
if ($bridgeUri.Port -ne 16384) {
    $mcpCommand += ' --port ' + $bridgeUri.Port
}

Write-Step "Configuring tunnel profile '$ProfileName'"
Invoke-TunnelProfileInit -TunnelExecutable $tunnelExecutable -Name $ProfileName -TunnelId $TunnelId -McpCommand $mcpCommand

if ($ConfigureOnly) {
    Write-Host "Tunnel profile '$ProfileName' was updated for bridge address $BridgeAddress." -ForegroundColor Green
    return
}

$shouldCreateManager = $CreateManager
if (-not $NoPathPrompts -and -not $CreateManager) {
    $managerAnswer = (Read-Host "Create a Roblox MCP Manager .exe for updates, startup, paths, and status? [y/N]").Trim()
    $shouldCreateManager = $managerAnswer -match '^(y|yes)$'
}
if ($shouldCreateManager) {
    if (-not $NoPathPrompts -and -not $PSBoundParameters.ContainsKey("ManagerOutputDirectory")) {
        $selectedManagerDirectory = Select-Directory $ManagerOutputDirectory "Choose where to create Roblox MCP Manager"
        if ($selectedManagerDirectory) { $ManagerOutputDirectory = $selectedManagerDirectory }
    }
    $managerGenerator = Join-Path $PSScriptRoot "create-windows-launcher.ps1"
    Write-Step "Creating Roblox MCP Manager"
    & $managerGenerator `
        -RepositoryDirectory $repositoryPath `
        -TunnelClientExecutable $tunnelExecutable `
        -BridgeAddress $BridgeAddress `
        -ProfileName $ProfileName `
        -OutputDirectory $ManagerOutputDirectory
    if (-not $?) { throw "The Roblox MCP Manager generator failed." }
}

$previousRuntimeKey = [Environment]::GetEnvironmentVariable("CONTROL_PLANE_API_KEY", "Process")
$runtimeKey = Read-RuntimeApiKey

try {
    $env:CONTROL_PLANE_API_KEY = $runtimeKey
    $runtimeKey = $null

    Write-Step "Validating the tunnel profile"
    $doctorCommand = @{
        FilePath = $tunnelExecutable
        Arguments = @("doctor", "--profile", $ProfileName, "--explain")
        FailureMessage = "tunnel-client doctor failed"
    }
    Invoke-CheckedCommand @doctorCommand

    Write-Host ""
    Write-Host "Profile is ready." -ForegroundColor Green
    Write-Host "Keep tunnel-client running while ChatGPT uses the MCP tools."
    Write-Host "In ChatGPT, select Connection: Tunnel and choose the same tunnel ID."
    Write-Host "If MCP authentication is requested for this stdio profile, choose None."
    Write-Host "After Roblox connects, verify the bridge at http://$BridgeAddress/."
    Write-Host ""

    $shouldStart = $Start
    if (-not $Start -and -not $NoStartPrompt) {
        $answer = (Read-Host "Start the tunnel now? [Y/n]").Trim()
        $shouldStart = $answer -notmatch '^(n|no)$'
    }

    if ($shouldStart) {
        Write-Step "Starting tunnel profile '$ProfileName'"
        $runCommand = @{
            FilePath = $tunnelExecutable
            Arguments = @("run", "--profile", $ProfileName)
            FailureMessage = "The tunnel runtime stopped with an error"
        }
        Invoke-CheckedCommand @runCommand
    }
}
finally {
    $runtimeKey = $null
    if ($null -eq $previousRuntimeKey) {
        Remove-Item Env:CONTROL_PLANE_API_KEY -ErrorAction SilentlyContinue
    }
    else {
        $env:CONTROL_PLANE_API_KEY = $previousRuntimeKey
    }
    $previousRuntimeKey = $null
}
