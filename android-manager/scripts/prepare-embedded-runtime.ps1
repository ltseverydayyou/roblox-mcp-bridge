$ErrorActionPreference = "Stop"

$managerRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $managerRoot
$cacheRoot = Join-Path $managerRoot ".cache"
$archive = Join-Path $cacheRoot "nodejs-mobile-v18.17.3-android.zip"
$extracted = Join-Path $cacheRoot "nodejs-mobile-v18.17.3"
$nodeRoot = Join-Path $extracted "nodejs-mobile-v18.17.3-android"
$downloadUrl = "https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v18.17.3/nodejs-mobile-v18.17.3-android.zip"
$expectedSha256 = "d0d1a85314272bd13a16aeb08a88be2a456f323ed80bcbe8ca31bfb83e6d26fc"

function Remove-GeneratedDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $longPath = if ($fullPath.StartsWith("\\")) {
        "\\?\UNC\" + $fullPath.Substring(2)
    } else {
        "\\?\" + $fullPath
    }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        if (-not [System.IO.Directory]::Exists($longPath)) { return }
        try {
            [System.IO.Directory]::Delete($longPath, $true)
            return
        } catch {
            if ($attempt -eq 3) { throw }
            Start-Sleep -Milliseconds 150
        }
    }
}

New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $archive
}
$actualSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $expectedSha256) { throw "Node.js Mobile archive digest mismatch: $actualSha256" }
if (-not (Test-Path -LiteralPath $nodeRoot)) {
    New-Item -ItemType Directory -Force -Path $extracted | Out-Null
    Expand-Archive -LiteralPath $archive -DestinationPath $extracted -Force
}

Push-Location $repoRoot
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "The MCP TypeScript build failed with exit code $LASTEXITCODE." }
} finally { Pop-Location }

$runtimeRoot = Join-Path $managerRoot "runtime"
Remove-GeneratedDirectory -Path (Join-Path $runtimeRoot "node_modules")
Push-Location $runtimeRoot
try {
    # A hoisted production install avoids pnpm junction targets exceeding the
    # legacy Windows path ceiling when Gradle stages APK assets.
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        pnpm install --prod --ignore-scripts --config.node-linker=hoisted
    } else {
        npm install --omit=dev --ignore-scripts --no-audit --no-fund --package-lock=false
    }
    if ($LASTEXITCODE -ne 0) { throw "The Android runtime dependency install failed with exit code $LASTEXITCODE." }
} finally { Pop-Location }

$jniTarget = Join-Path $managerRoot "app\src\main\jniLibs\arm64-v8a"
$includeTarget = Join-Path $managerRoot "app\src\main\cpp\node-include"
$assetTarget = Join-Path $managerRoot "app\src\main\assets\nodejs-project"
New-Item -ItemType Directory -Force -Path $jniTarget | Out-Null
New-Item -ItemType Directory -Force -Path $includeTarget | Out-Null
Remove-GeneratedDirectory -Path $assetTarget
New-Item -ItemType Directory -Force -Path $assetTarget | Out-Null

Copy-Item -LiteralPath (Join-Path $nodeRoot "bin\arm64-v8a\libnode.so") -Destination $jniTarget -Force
Copy-Item -Path (Join-Path $nodeRoot "include\node\*") -Destination $includeTarget -Recurse -Force
Copy-Item -LiteralPath (Join-Path $managerRoot "runtime\main.mjs") -Destination $assetTarget
Copy-Item -LiteralPath (Join-Path $managerRoot "runtime\package.json") -Destination $assetTarget
Copy-Item -LiteralPath (Join-Path $repoRoot "dist") -Destination $assetTarget -Recurse
Copy-Item -LiteralPath (Join-Path $managerRoot "runtime\node_modules") -Destination $assetTarget -Recurse
[System.IO.File]::WriteAllText(
    (Join-Path $assetTarget "runtime-version.txt"),
    "2.4.4-node18.17.1-arm64-r3`n",
    [System.Text.UTF8Encoding]::new($false)
)

Write-Host "Embedded runtime prepared for arm64-v8a."
