#requires -Version 5.1

[CmdletBinding()]
param(
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA "OpenAI\tunnel-client"),

    [ValidateSet("Auto", "amd64", "arm64")]
    [string]$Architecture = "Auto",

    [switch]$AddToPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repository = "openai/tunnel-client"
$apiHeaders = @{
    Accept = "application/vnd.github+json"
    "User-Agent" = "roblox-mcp-bridge-tunnel-installer"
    "X-GitHub-Api-Version" = "2022-11-28"
}

function Write-Step {
    param([string]$Message)
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-TargetArchitecture {
    if ($Architecture -ne "Auto") {
        return $Architecture
    }

    try {
        $osArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
        switch ($osArchitecture) {
            "X64" { return "amd64" }
            "Arm64" { return "arm64" }
        }
    }
    catch {
        # Fall through to environment-based detection on older .NET installations.
    }

    $reportedArchitecture = if ($env:PROCESSOR_ARCHITEW6432) {
        $env:PROCESSOR_ARCHITEW6432
    }
    else {
        $env:PROCESSOR_ARCHITECTURE
    }

    switch -Regex ($reportedArchitecture) {
        "^(AMD64|x86_64)$" { return "amd64" }
        "^(ARM64|aarch64)$" { return "arm64" }
        default { throw "Unsupported Windows architecture: $reportedArchitecture" }
    }
}

function Add-DirectoryToUserPath {
    param([string]$Directory)

    $resolvedDirectory = [System.IO.Path]::GetFullPath($Directory).TrimEnd("\")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $pathEntries = @($userPath -split ";" | Where-Object { $_ })
    $alreadyPresent = $false
    foreach ($entry in $pathEntries) {
        try {
            $expandedEntry = [Environment]::ExpandEnvironmentVariables($entry)
            $resolvedEntry = [System.IO.Path]::GetFullPath($expandedEntry).TrimEnd("\")
            if ([string]::Equals($resolvedEntry, $resolvedDirectory, [System.StringComparison]::OrdinalIgnoreCase)) {
                $alreadyPresent = $true
                break
            }
        }
        catch {
            # Preserve malformed or provider-specific PATH entries without treating them as a match.
        }
    }

    if (-not $alreadyPresent) {
        $newUserPath = (@($pathEntries) + $resolvedDirectory) -join ";"
        [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
        Write-Host "Added to your user PATH: $resolvedDirectory" -ForegroundColor Green
    }

    $processEntries = @($env:Path -split ";" | Where-Object { $_ })
    if ($processEntries -notcontains $resolvedDirectory) {
        $env:Path = "$resolvedDirectory;$env:Path"
    }
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "This installer downloads the Windows tunnel-client build and must run on Windows."
}

# GitHub requires TLS 1.2 on Windows PowerShell 5.1.
[Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$targetArchitecture = Get-TargetArchitecture
$installPath = [System.IO.Path]::GetFullPath($InstallDirectory)
$tempPath = Join-Path ([System.IO.Path]::GetTempPath()) ("tunnel-client-install-" + [Guid]::NewGuid().ToString("N"))
$archivePath = Join-Path $tempPath "tunnel-client.zip"
$checksumsPath = Join-Path $tempPath "SHA256SUMS.txt"
$extractPath = Join-Path $tempPath "extracted"

try {
    Write-Step "Finding the latest official tunnel-client release"
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repository/releases/latest" -Headers $apiHeaders

    $assetPattern = "^tunnel-client-.*-windows-$([regex]::Escape($targetArchitecture))\.zip$"
    $matchingAssets = @($release.assets | Where-Object { $_.name -match $assetPattern })
    if ($matchingAssets.Count -ne 1) {
        throw "Expected one Windows $targetArchitecture release asset, found $($matchingAssets.Count)."
    }

    $checksumAssets = @($release.assets | Where-Object { $_.name -eq "SHA256SUMS.txt" })
    if ($checksumAssets.Count -ne 1) {
        throw "The release does not contain exactly one SHA256SUMS.txt asset. Refusing an unverified download."
    }

    $asset = $matchingAssets[0]
    $checksumAsset = $checksumAssets[0]

    New-Item -ItemType Directory -Path $tempPath -Force | Out-Null

    Write-Step "Downloading $($asset.name) from $($release.tag_name)"
    Invoke-WebRequest -Uri $asset.browser_download_url -Headers $apiHeaders -OutFile $archivePath
    Invoke-WebRequest -Uri $checksumAsset.browser_download_url -Headers $apiHeaders -OutFile $checksumsPath

    Write-Step "Verifying the SHA-256 checksum"
    $checksumPattern = "^(?<hash>[A-Fa-f0-9]{64})\s+\*?" + [regex]::Escape($asset.name) + '$'
    $checksumMatch = Get-Content -LiteralPath $checksumsPath |
        ForEach-Object { [regex]::Match($_, $checksumPattern) } |
        Where-Object { $_.Success } |
        Select-Object -First 1

    if (-not $checksumMatch) {
        throw "No checksum entry was found for $($asset.name)."
    }

    $expectedHash = $checksumMatch.Groups["hash"].Value.ToLowerInvariant()
    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        throw "Checksum verification failed for $($asset.name)."
    }

    Write-Step "Extracting tunnel-client"
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractPath -Force
    $executables = @(Get-ChildItem -LiteralPath $extractPath -Filter "tunnel-client.exe" -File -Recurse)
    if ($executables.Count -ne 1) {
        throw "Expected one tunnel-client.exe in the archive, found $($executables.Count)."
    }

    New-Item -ItemType Directory -Path $installPath -Force | Out-Null
    $destination = Join-Path $installPath "tunnel-client.exe"
    Copy-Item -LiteralPath $executables[0].FullName -Destination $destination -Force
    Copy-Item -LiteralPath $checksumsPath -Destination (Join-Path $installPath "SHA256SUMS.txt") -Force
    Set-Content -LiteralPath (Join-Path $installPath "VERSION.txt") -Value $release.tag_name -Encoding Ascii

    if ($AddToPath) {
        Add-DirectoryToUserPath -Directory $installPath
    }

    Write-Host ""
    Write-Host "Installed tunnel-client $($release.tag_name):" -ForegroundColor Green
    Write-Host "  $destination"
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  Set-Location '$installPath'"
    Write-Host "  .\tunnel-client.exe help quickstart"
    Write-Host ""
    Write-Host "The runtime API key is configured later as CONTROL_PLANE_API_KEY; this installer never asks for or stores it."
}
finally {
    $resolvedTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
    $resolvedTempPath = [System.IO.Path]::GetFullPath($tempPath)
    if (
        (Test-Path -LiteralPath $resolvedTempPath) -and
        $resolvedTempPath.StartsWith($resolvedTempRoot, [System.StringComparison]::OrdinalIgnoreCase)
    ) {
        Remove-Item -LiteralPath $resolvedTempPath -Recurse -Force
    }
}
