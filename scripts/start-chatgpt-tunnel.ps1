#requires -Version 5.1

[CmdletBinding()]
param(
    [string]$ProfileName = "roblox-executor",

    [string]$TunnelClientDirectory = (Join-Path $env:LOCALAPPDATA "OpenAI\tunnel-client"),

    [string]$TunnelClientExecutable = "",

    [switch]$Doctor
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"


function Test-RepositoryBuildFresh {
    param([string]$Repository)
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

function Update-StaleBuild {
    $repository = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
    if (Test-RepositoryBuildFresh $repository) { return }

    $npm = Get-Command "npm.cmd" -ErrorAction SilentlyContinue
    if (-not $npm) { $npm = Get-Command "npm" -ErrorAction SilentlyContinue }
    if (-not $npm) {
        throw "The MCP source is newer than dist, but npm was not found. Install Node.js/npm and rebuild the repository."
    }

    Write-Host "MCP source changed since the last build. Rebuilding before tunnel startup..." -ForegroundColor Yellow
    Push-Location $repository
    try {
        & $npm.Source run build
        if ($LASTEXITCODE -ne 0) { throw "MCP rebuild failed with exit code $LASTEXITCODE." }
    }
    finally {
        Pop-Location
    }

    if (-not (Test-RepositoryBuildFresh $repository)) {
        throw "MCP rebuild completed, but dist still appears stale."
    }
    Write-Host "MCP build refreshed." -ForegroundColor Green
}

function Invoke-CheckedTunnelCommand {
    param([string[]]$Arguments)

    & $script:TunnelExecutable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "tunnel-client exited with code $LASTEXITCODE."
    }
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "This startup script is for Windows."
}

if ($ProfileName -notmatch '^[A-Za-z0-9._-]+$') {
    throw "ProfileName may only contain letters, numbers, periods, underscores, and hyphens."
}

$script:TunnelExecutable = if ($TunnelClientExecutable) {
    [System.IO.Path]::GetFullPath($TunnelClientExecutable)
}
else {
    Join-Path ([System.IO.Path]::GetFullPath($TunnelClientDirectory)) "tunnel-client.exe"
}
if (-not (Test-Path -LiteralPath $script:TunnelExecutable -PathType Leaf)) {
    throw "tunnel-client.exe was not found. Run scripts\setup-chatgpt-tunnel.ps1 first."
}

Update-StaleBuild

$runtimeKey = [Environment]::GetEnvironmentVariable("CONTROL_PLANE_API_KEY", "Process")
if ([string]::IsNullOrWhiteSpace($runtimeKey)) {
    $secureKey = Read-Host "Paste the OpenAI Platform Runtime API key (input is hidden)" -AsSecureString
    try {
        $runtimeKey = [System.Net.NetworkCredential]::new("", $secureKey).Password
    }
    finally {
        if ($secureKey -is [System.IDisposable]) {
            $secureKey.Dispose()
        }
    }
}

if ([string]::IsNullOrWhiteSpace($runtimeKey)) {
    throw "The runtime API key cannot be empty."
}

$previousRuntimeKey = [Environment]::GetEnvironmentVariable("CONTROL_PLANE_API_KEY", "Process")

try {
    $env:CONTROL_PLANE_API_KEY = $runtimeKey
    $runtimeKey = $null

    if ($Doctor) {
        Write-Host "Validating tunnel profile '$ProfileName'..." -ForegroundColor Cyan
        Invoke-CheckedTunnelCommand -Arguments @("doctor", "--profile", $ProfileName, "--explain")
    }

    Write-Host "Starting tunnel profile '$ProfileName'. Keep this window open." -ForegroundColor Cyan
    Invoke-CheckedTunnelCommand -Arguments @("run", "--profile", $ProfileName)
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
