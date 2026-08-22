param(
    [string]$Source = (Join-Path (Split-Path -Parent $PSScriptRoot) "artwork\roblox-mcp-icon-source.png")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$managerRoot = Split-Path -Parent $PSScriptRoot
$resourceRoot = Join-Path $managerRoot "app\src\main\res"
$sizes = [ordered]@{
    "mipmap-mdpi" = 48
    "mipmap-hdpi" = 72
    "mipmap-xhdpi" = 96
    "mipmap-xxhdpi" = 144
    "mipmap-xxxhdpi" = 192
}

$sourceImage = [System.Drawing.Bitmap]::FromFile((Resolve-Path -LiteralPath $Source))
try {
    $cropSize = [Math]::Min($sourceImage.Width, $sourceImage.Height)
    $cropX = [int](($sourceImage.Width - $cropSize) / 2)
    $cropY = [int](($sourceImage.Height - $cropSize) / 2)

    foreach ($entry in $sizes.GetEnumerator()) {
        $directory = Join-Path $resourceRoot $entry.Key
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
        $bitmap = New-Object System.Drawing.Bitmap($entry.Value, $entry.Value, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $destination = New-Object System.Drawing.Rectangle(0, 0, $entry.Value, $entry.Value)
                $sourceRectangle = New-Object System.Drawing.Rectangle($cropX, $cropY, $cropSize, $cropSize)
                $graphics.DrawImage($sourceImage, $destination, $sourceRectangle, [System.Drawing.GraphicsUnit]::Pixel)
            } finally {
                $graphics.Dispose()
            }
            $bitmap.Save((Join-Path $directory "ic_launcher.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $bitmap.Dispose()
        }
    }
} finally {
    $sourceImage.Dispose()
}

Write-Host "Generated Android launcher icons from $Source"
