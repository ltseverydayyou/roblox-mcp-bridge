#requires -Version 5.1

[CmdletBinding()]
param(
    [string]$ProfileName = "roblox-executor",

    [string]$TunnelClientDirectory = (Join-Path $env:LOCALAPPDATA "OpenAI\tunnel-client"),

    [string]$RepositoryDirectory = (Split-Path -Parent $PSScriptRoot),

    [switch]$SkipProjectSetup,

    [switch]$UpdateTunnelClient,

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

function Read-RuntimeApiKey {
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

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "This setup script is for Windows."
}

if ($ProfileName -notmatch '^[A-Za-z0-9._-]+$') {
    throw "ProfileName may only contain letters, numbers, periods, underscores, and hyphens."
}

$repositoryPath = [System.IO.Path]::GetFullPath($RepositoryDirectory)
$entryPoint = Join-Path $repositoryPath "dist\index.js"
$runWithBun = Join-Path $repositoryPath "scripts\run-with-bun.mjs"
$harnessInstaller = Join-Path $repositoryPath "scripts\install-harnesses.mjs"
$tunnelInstaller = Join-Path $PSScriptRoot "install-tunnel-client.ps1"
$tunnelDirectory = [System.IO.Path]::GetFullPath($TunnelClientDirectory)
$tunnelExecutable = Join-Path $tunnelDirectory "tunnel-client.exe"

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
        Arguments = @($runWithBun, $harnessInstaller, "--plain")
        FailureMessage = "The Roblox MCP installer failed"
    }
    Invoke-CheckedCommand @projectSetupCommand
}

if (-not (Test-Path -LiteralPath $entryPoint -PathType Leaf)) {
    throw "The MCP build was not found at $entryPoint. Run this script without -SkipProjectSetup."
}

if ($UpdateTunnelClient -or -not (Test-Path -LiteralPath $tunnelExecutable -PathType Leaf)) {
    Write-Step "Installing the latest official OpenAI tunnel-client"
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

do {
    $tunnelId = (Read-Host "Paste the OpenAI tunnel ID (tunnel_...)").Trim()
} while ($tunnelId -notmatch '^tunnel_[A-Za-z0-9]+$')

$portableEntryPoint = $entryPoint.Replace("\", "/")
$mcpCommand = 'node "' + $portableEntryPoint + '"'

Write-Step "Creating tunnel profile '$ProfileName'"
$profileInitCommand = @{
    FilePath = $tunnelExecutable
    Arguments = @(
        "init",
        "--sample", "sample_mcp_stdio_local",
        "--profile", $ProfileName,
        "--tunnel-id", $tunnelId,
        "--mcp-command", $mcpCommand
    )
    FailureMessage = "Could not create the tunnel profile. If it already exists, use start-chatgpt-tunnel.ps1 or choose another -ProfileName"
}
Invoke-CheckedCommand @profileInitCommand

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
    Write-Host "After Roblox connects, verify the bridge at http://localhost:16384/."
    Write-Host ""

    $shouldStart = $Start
    if (-not $Start) {
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
