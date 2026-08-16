#requires -Version 5.1

[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) "release"),

    [string]$BridgeAddress = "localhost:16384",

    [string]$TunnelClientExecutable = "",

    [string]$ProfileName = "roblox-executor",

    [string]$TunnelId = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repositoryDirectory = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$manifestPath = Join-Path $repositoryDirectory "package.json"
$launcherPath = Join-Path $PSScriptRoot "create-windows-launcher.ps1"

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "package.json was not found at $manifestPath"
}
if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
    throw "create-windows-launcher.ps1 was not found at $launcherPath"
}

$version = [string](Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).version
if ([string]::IsNullOrWhiteSpace($version)) {
    throw "package.json does not contain a version."
}

$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $outputPath -PathType Container)) {
    New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
}

& $launcherPath `
    -RepositoryDirectory $repositoryDirectory `
    -TunnelClientExecutable $TunnelClientExecutable `
    -BridgeAddress $BridgeAddress `
    -ProfileName $ProfileName `
    -TunnelId $TunnelId `
    -OutputDirectory $outputPath

$plainExe = Join-Path $outputPath "RobloxMcpManager.exe"
$releaseExe = Join-Path $outputPath "RobloxMcpManager-v$version.exe"

if (-not (Test-Path -LiteralPath $plainExe -PathType Leaf)) {
    throw "The launcher build did not produce $plainExe"
}

Move-Item -LiteralPath $plainExe -Destination $releaseExe -Force
$hash = (Get-FileHash -LiteralPath $releaseExe -Algorithm SHA256).Hash.ToLowerInvariant()
$size = (Get-Item -LiteralPath $releaseExe).Length

Write-Host "" 
Write-Host "Release manager built:" -ForegroundColor Green
Write-Host "  $releaseExe"
Write-Host "Version: v$version"
Write-Host "Size: $size bytes"
Write-Host "SHA-256: $hash"
Write-Host ""
Write-Host "Upload this exact EXE as the v$version GitHub release asset." -ForegroundColor Cyan
Write-Host "Replacing the same-version release asset is supported: installed managers compare their own SHA-256 with GitHub's published asset digest."
