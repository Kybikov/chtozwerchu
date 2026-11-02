Add-Type -AssemblyName System.Drawing
$projectDir = Split-Path -Parent $PSScriptRoot
foreach ($size in @(192, 512)) {
  $bmp = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bmp)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#111118'))
  $rect = [System.Drawing.Rectangle]::new(0, 0, $size, $size)
  $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new($rect, [System.Drawing.ColorTranslator]::FromHtml('#f291ad'), [System.Drawing.ColorTranslator]::FromHtml('#b29cef'), 45)
  $points = @(@(30,80),@(57,35),@(73,35),@(57,66),@(96,66),@(69,103),@(52,103),@(67,80)) | ForEach-Object { [System.Drawing.PointF]::new($_[0] * $size / 128, $_[1] * $size / 128) }
  $graphics.FillPolygon($brush, [System.Drawing.PointF[]]$points)
  $bmp.Save((Join-Path $projectDir "public/icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose(); $brush.Dispose(); $bmp.Dispose()
}
