#requires -Version 5.1

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePath,

    [string]$OutputPath = (Join-Path ([IO.Path]::GetTempPath()) "RobloxMcpManager.ico"),

    [string]$PreviewPngPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

function Convert-ImageToSquarePngBytes {
    param(
        [System.Drawing.Image]$SourceImage,
        [int]$Size
    )

    $cropSize = [Math]::Min($SourceImage.Width, $SourceImage.Height)
    $cropX = [int](($SourceImage.Width - $cropSize) / 2)
    $cropY = [int](($SourceImage.Height - $cropSize) / 2)
    $bitmap = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.Clear([System.Drawing.Color]::Transparent)
            $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $destination = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
            $sourceRectangle = New-Object System.Drawing.Rectangle($cropX, $cropY, $cropSize, $cropSize)
            $graphics.DrawImage($SourceImage, $destination, $sourceRectangle, [System.Drawing.GraphicsUnit]::Pixel)
        }
        finally {
            $graphics.Dispose()
        }

        $stream = New-Object IO.MemoryStream
        try {
            $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
            return $stream.ToArray()
        }
        finally {
            $stream.Dispose()
        }
    }
    finally {
        $bitmap.Dispose()
    }
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
        foreach ($size in $orderedSizes) {
            $writer.Write([byte[]]$Images[$size])
        }
        $writer.Flush()

        $resolvedOutput = [IO.Path]::GetFullPath($Path)
        $parent = Split-Path -Parent $resolvedOutput
        if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        [IO.File]::WriteAllBytes($resolvedOutput, $stream.ToArray())
    }
    finally {
        $writer.Dispose()
        $stream.Dispose()
    }
}

$resolvedSource = (Resolve-Path -LiteralPath $SourcePath).Path
$sourceImage = [System.Drawing.Image]::FromFile($resolvedSource)
try {
    $images = @{}
    foreach ($size in @(16, 24, 32, 48, 64, 128, 256)) {
        $images[$size] = Convert-ImageToSquarePngBytes -SourceImage $sourceImage -Size $size
    }
    Write-MultiResolutionIcon -Images $images -Path $OutputPath

    if ($PreviewPngPath) {
        $resolvedPreview = [IO.Path]::GetFullPath($PreviewPngPath)
        $previewParent = Split-Path -Parent $resolvedPreview
        if (-not (Test-Path -LiteralPath $previewParent -PathType Container)) {
            New-Item -ItemType Directory -Path $previewParent -Force | Out-Null
        }
        [IO.File]::WriteAllBytes($resolvedPreview, [byte[]]$images[256])
    }
}
finally {
    $sourceImage.Dispose()
}

Write-Output ([IO.Path]::GetFullPath($OutputPath))
