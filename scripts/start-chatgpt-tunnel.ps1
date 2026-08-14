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
