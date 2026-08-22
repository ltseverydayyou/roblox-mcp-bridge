$ErrorActionPreference = "Stop"

$managerRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $managerRoot
$cacheRoot = Join-Path $managerRoot ".cache"
$archive = Join-Path $cacheRoot "nodejs-mobile-v18.17.3-android.zip"
$extracted = Join-Path $cacheRoot "nodejs-mobile-v18.17.3"
$nodeRoot = Join-Path $extracted "nodejs-mobile-v18.17.3-android"
$downloadUrl = "https://github.com/nodejs-mobile/nodejs-mobile/releases/download/v18.17.3/nodejs-mobile-v18.17.3-android.zip"
$expectedSha256 = "d0d1a85314272bd13a16aeb08a88be2a456f323ed80bcbe8ca31bfb83e6d26fc"

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
try { npm run build } finally { Pop-Location }

Push-Location (Join-Path $managerRoot "runtime")
try {
    if (Get-Command pnpm -ErrorAction SilentlyContinue) {
        pnpm install --prod --ignore-scripts
    } else {
        npm install --omit=dev --ignore-scripts --no-audit --no-fund
    }
} finally { Pop-Location }

$jniTarget = Join-Path $managerRoot "app\src\main\jniLibs\arm64-v8a"
$includeTarget = Join-Path $managerRoot "app\src\main\cpp\node-include"
$assetTarget = Join-Path $managerRoot "app\src\main\assets\nodejs-project"
New-Item -ItemType Directory -Force -Path $jniTarget | Out-Null
New-Item -ItemType Directory -Force -Path $includeTarget | Out-Null
if (Test-Path -LiteralPath $assetTarget) { Remove-Item -LiteralPath $assetTarget -Recurse -Force }
New-Item -ItemType Directory -Force -Path $assetTarget | Out-Null

Copy-Item -LiteralPath (Join-Path $nodeRoot "bin\arm64-v8a\libnode.so") -Destination $jniTarget -Force
Copy-Item -Path (Join-Path $nodeRoot "include\node\*") -Destination $includeTarget -Recurse -Force
Copy-Item -LiteralPath (Join-Path $managerRoot "runtime\main.mjs") -Destination $assetTarget
Copy-Item -LiteralPath (Join-Path $managerRoot "runtime\package.json") -Destination $assetTarget
Copy-Item -LiteralPath (Join-Path $repoRoot "dist") -Destination $assetTarget -Recurse
Copy-Item -LiteralPath (Join-Path $managerRoot "runtime\node_modules") -Destination $assetTarget -Recurse
Set-Content -LiteralPath (Join-Path $assetTarget "runtime-version.txt") -Value "2.4.4-node18.17.1-arm64-r3" -Encoding utf8NoBOM

Write-Host "Embedded runtime prepared for arm64-v8a."
