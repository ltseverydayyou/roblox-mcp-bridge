#requires -Version 5.1

[CmdletBinding()]
param(
    [string]$RepositoryDirectory = "",

    [string]$TunnelClientExecutable = "",

    [string]$BridgeAddress = "localhost:16384",

    [string]$ProfileName = "roblox-executor",

    [string]$TunnelId = "",

    [string]$OutputDirectory = ([Environment]::GetFolderPath("Desktop")),

    [string]$LuauIconUrl = "https://raw.githubusercontent.com/luau-lang/site/master/logo.svg"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw "The .exe launcher generator is only supported on Windows."
}

$repositoryPath = ""
if ($RepositoryDirectory) {
    $repositoryPath = [System.IO.Path]::GetFullPath($RepositoryDirectory)
    $manifestPath = Join-Path $repositoryPath "package.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "package.json was not found in $repositoryPath."
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($manifest.name -ne "roblox-mcp-server") {
        throw "$repositoryPath is not a Roblox MCP Bridge checkout."
    }
}

if ($TunnelClientExecutable) {
    $TunnelClientExecutable = [System.IO.Path]::GetFullPath($TunnelClientExecutable)
    if (-not (Test-Path -LiteralPath $TunnelClientExecutable -PathType Leaf)) {
        throw "The selected tunnel-client executable does not exist: $TunnelClientExecutable"
    }
}

if ($ProfileName -notmatch '^[A-Za-z0-9._-]+$') {
    throw "ProfileName may only contain letters, numbers, periods, underscores, and hyphens."
}
if ($TunnelId -and $TunnelId -notmatch '^tunnel_[A-Za-z0-9]+$') {
    throw "TunnelId must look like tunnel_ followed by letters and numbers."
}

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

$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $outputPath -PathType Container)) {
    New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
}

$managerSource = Join-Path $PSScriptRoot "windows-mcp-manager.ps1"
if (-not (Test-Path -LiteralPath $managerSource -PathType Leaf)) {
    throw "Manager source was not found: $managerSource"
}

$iconBuilder = Join-Path $PSScriptRoot "get-luau-icon.ps1"
if (-not (Test-Path -LiteralPath $iconBuilder -PathType Leaf)) {
    throw "Luau icon builder was not found: $iconBuilder"
}

$manifestSource = Join-Path (Split-Path -Parent $PSScriptRoot) "package.json"
$managerVersion = "0.0.0"
if (Test-Path -LiteralPath $manifestSource -PathType Leaf) {
    $managerVersion = [string](Get-Content -LiteralPath $manifestSource -Raw | ConvertFrom-Json).version
}

$configTarget = Join-Path $outputPath "RobloxMcpManager.config.json"
$exeTarget = Join-Path $outputPath "RobloxMcpManager.exe"
$temporaryExe = Join-Path ([System.IO.Path]::GetTempPath()) ("RobloxMcpManager-" + [Guid]::NewGuid().ToString("N") + ".exe")
$temporaryIcon = Join-Path ([System.IO.Path]::GetTempPath()) ("RobloxMcpManager-" + [Guid]::NewGuid().ToString("N") + ".ico")

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $iconBuilder -OutputPath $temporaryIcon -SourceUrl $LuauIconUrl | Out-Null
if (-not (Test-Path -LiteralPath $temporaryIcon -PathType Leaf)) {
    throw "The Luau icon could not be generated."
}

$managerContent = [System.IO.File]::ReadAllText($managerSource)
$managerBytes = [System.Text.Encoding]::UTF8.GetPreamble() + [System.Text.Encoding]::UTF8.GetBytes($managerContent)
$managerBase64 = [Convert]::ToBase64String($managerBytes)
$iconBase64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($temporaryIcon))

$hostName = ([Uri]("http://" + $BridgeAddress)).Host
$bindHost = if ($hostName -in @("localhost", "127.0.0.1", "::1")) { "127.0.0.1" } else { "0.0.0.0" }
[ordered]@{
    RepositoryDirectory = $repositoryPath
    TunnelClientExecutable = $TunnelClientExecutable
    BridgeAddress = $BridgeAddress
    BindHost = $bindHost
    ProfileName = $ProfileName
    TunnelId = $TunnelId
} | ConvertTo-Json | Set-Content -LiteralPath $configTarget -Encoding UTF8

$source = @"
using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class RobloxMcpManagerLauncher
{
    [STAThread]
    private static void Main()
    {
        try
        {
            string directory = AppDomain.CurrentDomain.BaseDirectory;
            string script = Path.Combine(Path.GetTempPath(), "RobloxMcpManager-$managerVersion.ps1");
            string icon = Path.Combine(Path.GetTempPath(), "RobloxMcpManager-$managerVersion.ico");
            string config = Path.Combine(directory, "RobloxMcpManager.config.json");
            File.WriteAllBytes(script, Convert.FromBase64String("$managerBase64"));
            File.WriteAllBytes(icon, Convert.FromBase64String("$iconBase64"));

            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = "powershell.exe";
            start.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\" -ConfigPath \"" + config + "\"";
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            start.EnvironmentVariables["ROBLOX_MCP_MANAGER_ICON"] = icon;
            Process.Start(start);
        }
        catch (Exception error)
        {
            MessageBox.Show(error.Message, "Roblox MCP Manager", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
"@

$provider = $null
try {
    Add-Type -AssemblyName Microsoft.CSharp
    $provider = New-Object Microsoft.CSharp.CSharpCodeProvider
    $parameters = New-Object CodeDom.Compiler.CompilerParameters
    $parameters.GenerateExecutable = $true
    $parameters.GenerateInMemory = $false
    $parameters.OutputAssembly = $temporaryExe
    $parameters.CompilerOptions = "/target:winexe /optimize+ /win32icon:`"$temporaryIcon`""
    $parameters.ReferencedAssemblies.Add("System.dll") | Out-Null
    $parameters.ReferencedAssemblies.Add("System.Windows.Forms.dll") | Out-Null
    $result = $provider.CompileAssemblyFromSource($parameters, $source)
    if ($result.Errors.HasErrors) {
        $messages = @($result.Errors | ForEach-Object { "line $($_.Line): $($_.ErrorText)" }) -join [Environment]::NewLine
        throw "Windows launcher compilation failed:$([Environment]::NewLine)$messages"
    }
    Move-Item -LiteralPath $temporaryExe -Destination $exeTarget -Force
}
finally {
    if ($null -ne $provider) { $provider.Dispose() }
    if (Test-Path -LiteralPath $temporaryExe -PathType Leaf) {
        Remove-Item -LiteralPath $temporaryExe -Force
    }
    if (Test-Path -LiteralPath $temporaryIcon -PathType Leaf) {
        Remove-Item -LiteralPath $temporaryIcon -Force
    }
}

Write-Host "Created Roblox MCP Manager:" -ForegroundColor Green
Write-Host "  $exeTarget"
Write-Host "The .exe contains its manager UI. Keep the optional .config.json beside it to preserve prefilled paths."
