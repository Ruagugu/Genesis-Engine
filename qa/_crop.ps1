param(
    [Parameter(Mandatory=$true)][string]$src,
    [Parameter(Mandatory=$true)][string]$dst,
    [Parameter(Mandatory=$true)][int]$x,
    [Parameter(Mandatory=$true)][int]$y,
    [Parameter(Mandatory=$true)][int]$w,
    [Parameter(Mandatory=$true)][int]$h,
    [int]$scale = 2
)
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($src)
$ow = [Math]::Min($w, $img.Width - $x)
$oh = [Math]::Min($h, $img.Height - $y)
$rect = New-Object System.Drawing.Rectangle($x, $y, $ow, $oh)
$crop = New-Object System.Drawing.Bitmap([int]($ow*$scale), [int]($oh*$scale))
$g = [System.Drawing.Graphics]::FromImage($crop)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($img, (New-Object System.Drawing.Rectangle(0,0,[int]($ow*$scale),[int]($oh*$scale))), $rect, [System.Drawing.GraphicsUnit]::Pixel)
$crop.Save($dst, [System.Drawing.Imaging.ImageFormat]::Png)
Write-Output ("{0} -> {1} ({2}x{3} crop scaled x{4})" -f $src, $dst, $ow, $oh, $scale)
$g.Dispose(); $crop.Dispose(); $img.Dispose()
