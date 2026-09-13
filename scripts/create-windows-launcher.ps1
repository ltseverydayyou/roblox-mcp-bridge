#requires -Version 5.1

[CmdletBinding()]
param(
    [string]$RepositoryDirectory = "",
    [string]$TunnelClientExecutable = "",
    [string]$BridgeAddress = "localhost:16384",
    [string]$ProfileName = "roblox-executor",
    [string]$TunnelId = "",
    [string]$OutputDirectory = ([Environment]::GetFolderPath("Desktop")),
    [string]$IconSourcePath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "The .exe launcher generator is only supported on Windows."
}

$repositoryPath = ""
if ($RepositoryDirectory) {
    $repositoryPath = [IO.Path]::GetFullPath($RepositoryDirectory)
    $manifestPath = Join-Path $repositoryPath "package.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "package.json was not found in $repositoryPath." }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.name -ne "roblox-mcp-server") { throw "$repositoryPath is not a Roblox MCP Bridge checkout." }
}

if ($TunnelClientExecutable) {
    $TunnelClientExecutable = [IO.Path]::GetFullPath($TunnelClientExecutable)
    if (-not (Test-Path -LiteralPath $TunnelClientExecutable -PathType Leaf)) { throw "The selected tunnel-client executable does not exist: $TunnelClientExecutable" }
}
if ($ProfileName -notmatch '^[A-Za-z0-9._-]+$') { throw "ProfileName may only contain letters, numbers, periods, underscores, and hyphens." }
if ($TunnelId -and $TunnelId -notmatch '^tunnel_[A-Za-z0-9]+$') { throw "TunnelId must look like tunnel_ followed by letters and numbers." }

$bridgeCandidate = ([string]$BridgeAddress).Trim().TrimEnd("/")
if (-not $bridgeCandidate) { $bridgeCandidate = "localhost:16384" }
if ($bridgeCandidate -notmatch '^[a-z][a-z0-9+.-]*://') { $bridgeCandidate = "http://$bridgeCandidate" }
try { $bridgeUri = [Uri]$bridgeCandidate } catch { throw "Enter a bridge address like localhost:16384 or 192.168.1.25:16384." }
if ($bridgeUri.Scheme -notin @("http", "https") -or -not $bridgeUri.Host -or $bridgeUri.AbsolutePath -ne "/" -or $bridgeUri.Query -or $bridgeUri.Fragment) {
    throw "Enter only a host/IP and port, such as 192.168.1.25:16384."
}
$bridgeAuthority = $bridgeCandidate -replace '^[a-z][a-z0-9+.-]*://', ''
$explicitPort = [regex]::Match($bridgeAuthority, ':(?<port>[0-9]+)$')
$bridgePort = if ($explicitPort.Success) { [int]$explicitPort.Groups['port'].Value } else { 16384 }
if ($bridgePort -lt 1 -or $bridgePort -gt 65535) { throw "The bridge port must be between 1 and 65535." }
$BridgeAddress = "$($bridgeUri.Host):$bridgePort"

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$manifestSource = Join-Path $repoRoot "package.json"
$managerVersion = [string](Get-Content -LiteralPath $manifestSource -Raw | ConvertFrom-Json).version
if ([string]::IsNullOrWhiteSpace($managerVersion)) { throw "package.json does not contain a version." }

$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $outputPath -PathType Container)) { New-Item -ItemType Directory -Path $outputPath -Force | Out-Null }

$managerRoot = Join-Path $PSScriptRoot "windows-manager"
$hostSource = Join-Path $managerRoot "ManagerHost.cs"
$managerHtml = Join-Path $managerRoot "manager.html"
$dashboardCss = Join-Path $repoRoot "src\http\assets\dashboard\dashboard.css"
$iconBuilder = Join-Path $PSScriptRoot "get-mcp-icon.ps1"
foreach ($required in @($hostSource, $managerHtml, $dashboardCss, $iconBuilder)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required manager source was not found: $required" }
}

if ([string]::IsNullOrWhiteSpace($IconSourcePath)) { $IconSourcePath = Join-Path $repoRoot "android-manager\artwork\roblox-mcp-icon-source.png" }
if (-not (Test-Path -LiteralPath $IconSourcePath -PathType Leaf)) { throw "Roblox MCP icon source was not found: $IconSourcePath" }

function Find-RoslynCompiler {
    $candidates = @()
    if ($env:ProgramFiles) {
        $vsRoot = Join-Path $env:ProgramFiles "Microsoft Visual Studio"
        if (Test-Path -LiteralPath $vsRoot) {
            $candidates += Get-ChildItem -LiteralPath $vsRoot -Filter csc.exe -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match '\\MSBuild\\Current\\Bin\\Roslyn\\csc\.exe$' } |
                Sort-Object FullName -Descending | Select-Object -ExpandProperty FullName
        }
        $sdkRoot = Join-Path $env:ProgramFiles "dotnet\sdk"
        if (Test-Path -LiteralPath $sdkRoot) {
            $candidates += Get-ChildItem -LiteralPath $sdkRoot -Filter csc.exe -Recurse -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match '\\Roslyn\\bincore\\csc\.exe$' } |
                Sort-Object FullName -Descending | Select-Object -ExpandProperty FullName
        }
    }
    $command = Get-Command csc.exe -ErrorAction SilentlyContinue
    if ($command) { $candidates += $command.Source }
    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    throw "A modern Roslyn C# compiler was not found. Install Visual Studio Build Tools or the .NET SDK."
}

function Resolve-WebView2Package {
    param([string]$Version = "1.0.3650.58")
    $cache = Join-Path $env:USERPROFILE ".nuget\packages\microsoft.web.webview2\$Version"
    if (Test-Path -LiteralPath (Join-Path $cache "lib\net462\Microsoft.Web.WebView2.Core.dll") -PathType Leaf) { return $cache }

    $downloadRoot = Join-Path ([IO.Path]::GetTempPath()) ("RobloxMcp-WebView2-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
    $zip = Join-Path $downloadRoot "webview2.zip"
    $extract = Join-Path $downloadRoot "package"
    $lower = $Version.ToLowerInvariant()
    $uri = "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$lower/microsoft.web.webview2.$lower.nupkg"
    Write-Host "Downloading Microsoft.Web.WebView2 $Version build dependency..." -ForegroundColor Cyan
    Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $zip -TimeoutSec 60
    Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force
    return $extract
}

$csc = Find-RoslynCompiler
$webViewPackage = Resolve-WebView2Package
$coreDll = Join-Path $webViewPackage "lib\net462\Microsoft.Web.WebView2.Core.dll"
$formsDll = Join-Path $webViewPackage "lib\net462\Microsoft.Web.WebView2.WinForms.dll"
$loaderDll = Join-Path $webViewPackage "runtimes\win-x64\native\WebView2Loader.dll"
if (-not (Test-Path -LiteralPath $loaderDll -PathType Leaf)) { $loaderDll = Join-Path $webViewPackage "build\native\x64\WebView2Loader.dll" }
foreach ($required in @($coreDll, $formsDll, $loaderDll)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "WebView2 build dependency was not found: $required" }
}

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("RobloxMcpManagerBuild-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
try {
    $iconIco = Join-Path $tempRoot "RobloxMcpManager.ico"
    $iconPng = Join-Path $tempRoot "mcp-icon.png"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $iconBuilder -SourcePath $IconSourcePath -OutputPath $iconIco -PreviewPngPath $iconPng | Out-Null

    $hostExe = Join-Path $tempRoot "RobloxMcpManager.Host.exe"
    $hostArgs = @(
        "/nologo", "/target:winexe", "/optimize+", "/win32icon:`"$iconIco`"", "/out:`"$hostExe`"",
        "/reference:System.dll", "/reference:System.Core.dll", "/reference:System.Drawing.dll", "/reference:System.Windows.Forms.dll", "/reference:System.Web.Extensions.dll",
        "/reference:`"$coreDll`"", "/reference:`"$formsDll`"", "`"$hostSource`""
    )
    & $csc $hostArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $hostExe -PathType Leaf)) { throw "The WebView manager host failed to compile." }

    $payload = [ordered]@{
        "RobloxMcpManager.Host.exe" = $hostExe
        "Microsoft.Web.WebView2.Core.dll" = $coreDll
        "Microsoft.Web.WebView2.WinForms.dll" = $formsDll
        "WebView2Loader.dll" = $loaderDll
        "manager.html" = $managerHtml
        "dashboard.css" = $dashboardCss
        "mcp-icon.png" = $iconPng
        "RobloxMcpManager.ico" = $iconIco
    }

    $payloadAssignments = New-Object Text.StringBuilder
    foreach ($entry in $payload.GetEnumerator()) {
        $base64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($entry.Value))
        [void]$payloadAssignments.AppendLine("        WritePayload(Path.Combine(runtime, `"$($entry.Key)`"), `"$base64`");")
    }

    $bootstrapSource = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Roblox MCP Manager")]
[assembly: AssemblyDescription("Windows manager for Roblox MCP Bridge")]
[assembly: AssemblyProduct("Roblox MCP Bridge")]
[assembly: AssemblyCompany("ltseverydayyou")]
[assembly: AssemblyVersion("$managerVersion")]
[assembly: AssemblyFileVersion("$managerVersion")]

internal static class RobloxMcpManagerBootstrap
{
    [STAThread]
    private static void Main()
    {
        try
        {
            string runtime = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RobloxMcpManager", "Runtime", "v$managerVersion");
            Directory.CreateDirectory(runtime);
$($payloadAssignments.ToString())
            string host = Path.Combine(runtime, "RobloxMcpManager.Host.exe");
            string sidecar = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "RobloxMcpManager.config.json");
            ProcessStartInfo psi = new ProcessStartInfo(host);
            psi.WorkingDirectory = runtime;
            psi.UseShellExecute = false;
            psi.EnvironmentVariables["ROBLOX_MCP_MANAGER_EXE"] = Application.ExecutablePath;
            psi.EnvironmentVariables["ROBLOX_MCP_MANAGER_VERSION"] = "$managerVersion";
            psi.EnvironmentVariables["ROBLOX_MCP_MANAGER_PARENT_PID"] = Process.GetCurrentProcess().Id.ToString();
            if (File.Exists(sidecar)) psi.EnvironmentVariables["ROBLOX_MCP_MANAGER_CONFIG"] = sidecar;
            using (Process child = Process.Start(psi))
            {
                if (child == null) throw new InvalidOperationException("The manager host could not be started.");
                child.WaitForExit();
            }
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Roblox MCP Manager", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static void WritePayload(string path, string base64)
    {
        byte[] data = Convert.FromBase64String(base64);
        if (File.Exists(path))
        {
            FileInfo info = new FileInfo(path);
            if (info.Length == data.Length) return;
        }
        File.WriteAllBytes(path, data);
    }
}
"@

    $bootstrapCs = Join-Path $tempRoot "Bootstrap.cs"
    [IO.File]::WriteAllText($bootstrapCs, $bootstrapSource, (New-Object Text.UTF8Encoding($false)))
    $exeTarget = Join-Path $outputPath "RobloxMcpManager.exe"
    $bootstrapArgs = @(
        "/nologo", "/target:winexe", "/optimize+", "/win32icon:`"$iconIco`"", "/out:`"$exeTarget`"",
        "/reference:System.dll", "/reference:System.Core.dll", "/reference:System.Windows.Forms.dll", "`"$bootstrapCs`""
    )
    & $csc $bootstrapArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $exeTarget -PathType Leaf)) { throw "The single-file Roblox MCP Manager launcher failed to compile." }

    $hostName = ([Uri]("http://" + $BridgeAddress)).Host
    $bindHost = if ($hostName -in @("localhost", "127.0.0.1", "::1")) { "127.0.0.1" } else { "0.0.0.0" }
    $configTarget = Join-Path $outputPath "RobloxMcpManager.config.json"
    [ordered]@{
        RepositoryDirectory = $repositoryPath
        TunnelClientExecutable = $TunnelClientExecutable
        BridgeAddress = $BridgeAddress
        BindHost = $bindHost
        ProfileName = $ProfileName
        TunnelId = $TunnelId
    } | ConvertTo-Json | Set-Content -LiteralPath $configTarget -Encoding UTF8

    Write-Host "Created Roblox MCP Manager:" -ForegroundColor Green
    Write-Host "  $exeTarget"
    Write-Host "WebView2 dashboard UI, native actions, source updates, self-update, tunnel controls, and background Windows notifications are embedded in the launcher."
}
finally {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
