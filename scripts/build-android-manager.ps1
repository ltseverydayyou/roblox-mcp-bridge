#requires -Version 5.1

[CmdletBinding()]
param(
    [string]$JavaHome = $env:JAVA_HOME,
    [string]$AndroidSdk = $env:ANDROID_HOME
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repository = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$project = Join-Path $repository "android-manager"
$gradle = Join-Path $project "gradlew.bat"
$prepareRuntime = Join-Path $project "scripts\prepare-embedded-runtime.ps1"
$generateIcons = Join-Path $project "scripts\generate-launcher-icons.ps1"

if ([string]::IsNullOrWhiteSpace($JavaHome)) {
    $javaCandidates = @(Get-ChildItem "C:\Program Files\Eclipse Adoptium" -Directory -Filter "jdk-21*" -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
    if ($javaCandidates.Count -gt 0) { $JavaHome = $javaCandidates[0].FullName }
}
if ([string]::IsNullOrWhiteSpace($AndroidSdk)) {
    $AndroidSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
}
if (-not (Test-Path -LiteralPath (Join-Path $JavaHome "bin\java.exe") -PathType Leaf)) {
    throw "JDK 21 was not found. Pass -JavaHome or set JAVA_HOME."
}
if (-not (Test-Path -LiteralPath (Join-Path $AndroidSdk "platforms\android-35") -PathType Container)) {
    throw "Android SDK platform 35 was not found. Pass -AndroidSdk or set ANDROID_HOME."
}
if (-not (Test-Path -LiteralPath (Join-Path $AndroidSdk "ndk\27.0.12077973") -PathType Container)) {
    throw "Android NDK 27.0.12077973 was not found. Install it from Android Studio's SDK Tools screen."
}
if (-not (Test-Path -LiteralPath (Join-Path $AndroidSdk "cmake\3.22.1") -PathType Container)) {
    throw "CMake 3.22.1 was not found. Install it from Android Studio's SDK Tools screen."
}
if (-not (Test-Path -LiteralPath $gradle -PathType Leaf)) {
    throw "Gradle wrapper is missing: $gradle"
}

$env:JAVA_HOME = [IO.Path]::GetFullPath($JavaHome)
$env:ANDROID_HOME = [IO.Path]::GetFullPath($AndroidSdk)

& $generateIcons
& $prepareRuntime
if ($LASTEXITCODE -ne 0) { throw "Embedded runtime preparation failed with exit code $LASTEXITCODE." }

Push-Location $project
try {
    & $gradle clean lintDebug packageManagerDebug
    if ($LASTEXITCODE -ne 0) { throw "Android manager build failed with exit code $LASTEXITCODE." }
}
finally {
    Pop-Location
}

$version = [string](Select-String -LiteralPath (Join-Path $project "app\build.gradle") -Pattern 'versionName\s+"([^"]+)"').Matches[0].Groups[1].Value
$apk = Join-Path $project "app\build\distributions\RobloxMcpManager-Android-v$version-debug.apk"
if (-not (Test-Path -LiteralPath $apk -PathType Leaf)) { throw "Expected APK was not produced: $apk" }
[System.Reflection.Assembly]::LoadWithPartialName("System.IO.Compression.FileSystem") | Out-Null
$archive = [System.IO.Compression.ZipFile]::OpenRead($apk)
try {
    $entries = @($archive.Entries | ForEach-Object { $_.FullName })
    foreach ($requiredLibrary in @(
        "lib/arm64-v8a/libnode.so",
        "lib/arm64-v8a/libnative-node.so",
        "lib/arm64-v8a/libc++_shared.so"
    )) {
        if ($entries -notcontains $requiredLibrary) {
            throw "APK is missing required native library: $requiredLibrary"
        }
    }
}
finally {
    $archive.Dispose()
}
$hash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "Android manager APK built:" -ForegroundColor Green
Write-Host "  $apk"
Write-Host "SHA-256: $hash"
Write-Host "Upload this file as an asset on the repository's GitHub Release; do not commit the APK to the repository." -ForegroundColor Cyan
Write-Host "This debug-signed APK is installable for testing. Use a private release keystore before public distribution." -ForegroundColor Yellow
