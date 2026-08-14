#requires -Version 5.1

[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path ([IO.Path]::GetTempPath()) "RobloxMcpManager-Luau.ico"),

    [string]$PreviewPngPath = "",

    [string]$SourceUrl = "https://raw.githubusercontent.com/luau-lang/site/master/logo.svg"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

function Get-OfficialLuauSvg {
    param([string]$Url)

    $cacheDirectory = Join-Path $env:LOCALAPPDATA "RobloxMcpManager\assets"
    $cachePath = Join-Path $cacheDirectory "luau-logo.svg"
    try {
        if (-not (Test-Path -LiteralPath $cacheDirectory -PathType Container)) {
            New-Item -ItemType Directory -Path $cacheDirectory -Force | Out-Null
        }
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 20 -Headers @{ "User-Agent" = "roblox-mcp-manager" }
        $svg = [string]$response.Content
        if ($svg -notmatch '<svg' -or $svg -notmatch 'viewBox="0 0 52 52"') {
            throw "The downloaded Luau logo was not the expected SVG."
        }
        [IO.File]::WriteAllText($cachePath, $svg, (New-Object Text.UTF8Encoding($false)))
        return $svg
    }
    catch {
        if (Test-Path -LiteralPath $cachePath -PathType Leaf) {
            Write-Warning "Could not refresh the Luau logo; using the cached official copy. $($_.Exception.Message)"
            return [IO.File]::ReadAllText($cachePath)
        }
        throw "Could not fetch the official Luau logo from $Url. $($_.Exception.Message)"
    }
}

function Convert-LuauSvgToPngBytes {
    param([xml]$Svg, [int]$Size)

    $drawing = New-Object Windows.Media.DrawingVisual
    $context = $drawing.RenderOpen()
    try {
        $scale = $Size / 52.0
        $context.PushTransform((New-Object Windows.Media.ScaleTransform($scale, $scale)))

        $gradient = New-Object Windows.Media.LinearGradientBrush
        $gradient.StartPoint = New-Object Windows.Point(0, 1)
        $gradient.EndPoint = New-Object Windows.Point(1, 0)
        $gradient.GradientStops.Add((New-Object Windows.Media.GradientStop(([Windows.Media.Color]::FromRgb(80, 113, 234)), 0)))
        $gradient.GradientStops.Add((New-Object Windows.Media.GradientStop(([Windows.Media.Color]::FromRgb(0, 35, 159)), 1)))

        $context.PushTransform((New-Object Windows.Media.RotateTransform(15, 11.8579, 1.5051)))
        $context.DrawRoundedRectangle($gradient, $null, (New-Object Windows.Rect(11.8579, 1.5051, 40, 40)), 2, 2)
        $context.Pop()

        $context.PushTransform((New-Object Windows.Media.RotateTransform(15, 36.6438, 13.3228)))
        $context.DrawRoundedRectangle([Windows.Media.Brushes]::White, $null, (New-Object Windows.Rect(36.6438, 13.3228, 8, 8)), 0.5, 0.5)
        $context.Pop()

        $pathNode = @($Svg.svg.path)[0]
        if ($null -eq $pathNode -or -not $pathNode.d) { throw "The official Luau SVG path was not found." }
        $geometry = [Windows.Media.Geometry]::Parse([string]$pathNode.d)
        $context.DrawGeometry([Windows.Media.Brushes]::White, $null, $geometry)
        $context.Pop()
    }
    finally { $context.Close() }

    $bitmap = New-Object Windows.Media.Imaging.RenderTargetBitmap($Size, $Size, 96, 96, [Windows.Media.PixelFormats]::Pbgra32)
    $bitmap.Render($drawing)
    $encoder = New-Object Windows.Media.Imaging.PngBitmapEncoder
    $encoder.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
    $stream = New-Object IO.MemoryStream
    try {
        $encoder.Save($stream)
        return $stream.ToArray()
    }
    finally { $stream.Dispose() }
}

function Write-MultiResolutionIcon {
    param([hashtable]$Images, [string]$Path)

    $orderedSizes = @(16, 24, 32, 48, 64, 128, 256)
    $stream = New-Object IO.MemoryStream
    $writer = New-Object IO.BinaryWriter($stream)
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]$orderedSizes.Count)
        $offset = 6 + (16 * $orderedSizes.Count)
        foreach ($size in $orderedSizes) {
            $bytes = [byte[]]$Images[$size]
            $dimension = if ($size -eq 256) { 0 } else { $size }
            $writer.Write([byte]$dimension)
            $writer.Write([byte]$dimension)
            $writer.Write([byte]0)
            $writer.Write([byte]0)
            $writer.Write([uint16]1)
            $writer.Write([uint16]32)
            $writer.Write([uint32]$bytes.Length)
            $writer.Write([uint32]$offset)
            $offset += $bytes.Length
        }
        foreach ($size in $orderedSizes) { $writer.Write([byte[]]$Images[$size]) }
        $writer.Flush()
        $parent = Split-Path -Parent ([IO.Path]::GetFullPath($Path))
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
        [IO.File]::WriteAllBytes([IO.Path]::GetFullPath($Path), $stream.ToArray())
    }
    finally {
        $writer.Dispose()
        $stream.Dispose()
    }
}

$svgText = Get-OfficialLuauSvg $SourceUrl
$svg = [xml]$svgText
$images = @{}
foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
    $images[$size] = Convert-LuauSvgToPngBytes $svg $size
}
Write-MultiResolutionIcon $images $OutputPath

if ($PreviewPngPath) {
    $previewParent = Split-Path -Parent ([IO.Path]::GetFullPath($PreviewPngPath))
    if (-not (Test-Path -LiteralPath $previewParent -PathType Container)) { New-Item -ItemType Directory -Path $previewParent -Force | Out-Null }
    [IO.File]::WriteAllBytes([IO.Path]::GetFullPath($PreviewPngPath), [byte[]]$images[256])
}

Write-Output ([IO.Path]::GetFullPath($OutputPath))
