[CmdletBinding()]
param(
  [ValidateRange(1, 32)]
  [int]$RoundCount = 22,

  [ValidateSet('without-performance', 'with-performance')]
  [string]$Template = 'without-performance',

  [ValidateRange(250, 5000)]
  [int]$PageDelayMs = 900,

  [ValidateRange(250, 5000)]
  [int]$RoundDelayMs = 650,

  [ValidateRange(0, 30)]
  [int]$StartDelaySeconds = 5,

  [string]$OutputRoot = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Moe Tracker\Scoreboards'),

  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# Safety cap on timeline images (regulation + long overtime); the typed round
# count is only a hint now that tiles are detected on screen.
$RoundCap = 48

# Moe Tracker launches this bundled helper from the post-match capture card. It
# uses ordinary Windows screen capture and mouse input on the completed match
# summary; it does not inspect VALORANT memory or automate gameplay.

$referenceWidth = 1920
$referenceHeight = 1080

$tabTargets = if ($Template -eq 'with-performance') {
  [ordered]@{
    scoreboard = @{ x = 112; y = 300 }
    performance = @{ x = 112; y = 350 }
    headToHead = @{ x = 112; y = 395 }
    timeline = @{ x = 112; y = 445 }
  }
} else {
  [ordered]@{
    scoreboard = @{ x = 112; y = 300 }
    headToHead = @{ x = 112; y = 350 }
    timeline = @{ x = 112; y = 395 }
  }
}

# Measured centers of the round tiles at 1920 x 1080. The strip inserts a
# 36-pixel non-clickable separator after round 12 and again after round 24.
$roundBaseX = 386
$roundStepX = 54
$roundSeparatorWidth = 36
$roundY = 337

function Get-RoundTargetX([int]$round, [int]$firstVisibleRound) {
  $x = $roundBaseX + (($round - $firstVisibleRound) * $roundStepX)
  if ($firstVisibleRound -le 12 -and $round -gt 12) { $x += $roundSeparatorWidth }
  if ($firstVisibleRound -le 24 -and $round -gt 24) { $x += $roundSeparatorWidth }
  return $x
}

if ($DryRun) {
  $plan = [ordered]@{
    referenceResolution = "$referenceWidth x $referenceHeight (coordinates scale to the detected 16:9 render area)"
    template = $Template
    roundCount = $RoundCount
    outputRoot = $OutputRoot
    captures = @('scoreboard') + $(if ($Template -eq 'with-performance') { @('performance') }) + @('head-to-head') + (1..$RoundCount | ForEach-Object { "round-$('{0:d2}' -f $_)" })
    roundTargets = 1..$RoundCount | ForEach-Object {
      $firstVisibleRound = if ($_ -le 24) { 1 } else { $RoundCount - 23 }
      @{ round = $_; firstVisibleRound = $firstVisibleRound; x = (Get-RoundTargetX $_ $firstVisibleRound); y = $roundY }
    }
  }
  $plan | ConvertTo-Json -Depth 5
  exit 0
}

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class MoeScrimNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int command);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll", SetLastError = true)]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);

  public const uint MouseLeftDown = 0x0002;
  public const uint MouseLeftUp = 0x0004;
  public const uint MouseWheel = 0x0800;
}
'@

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

// Finds the round tiles currently visible in the TIMELINE strip by their
// white round-number labels (reference band y=289..307, x=340..1740 at
// 1920x1080). Works whatever way the strip is scrolled, including overtime.
public static class MoeTimelineTiles {
  public static int[] DetectLabelCenters(Bitmap bitmap) {
    double sx = bitmap.Width / 1920.0, sy = bitmap.Height / 1080.0;
    int x0 = (int)Math.Round(340 * sx), x1 = (int)Math.Round(1740 * sx);
    int y0 = (int)Math.Round(289 * sy), y1 = (int)Math.Round(307 * sy);
    Rectangle area = new Rectangle(x0, y0, x1 - x0, y1 - y0);
    BitmapData data = bitmap.LockBits(area, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    byte[] pixels = new byte[data.Stride * area.Height];
    try { Marshal.Copy(data.Scan0, pixels, 0, pixels.Length); }
    finally { bitmap.UnlockBits(data); }
    List<int> centers = new List<int>();
    int gap = Math.Max(6, (int)Math.Round(12 * sx));
    int start = -1, previous = -1;
    for (int x = 0; x < area.Width; x++) {
      int white = 0;
      for (int y = 0; y < area.Height; y++) {
        int i = y * data.Stride + x * 4;
        if (pixels[i] > 185 && pixels[i + 1] > 185 && pixels[i + 2] > 185) white++;
      }
      if (white < 2) continue;
      if (start < 0) { start = previous = x; continue; }
      if (x - previous > gap) { centers.Add((int)Math.Round(((start + previous) / 2.0 + x0) / sx)); start = x; }
      previous = x;
    }
    if (start >= 0) centers.Add((int)Math.Round(((start + previous) / 2.0 + x0) / sx));
    return centers.ToArray();
  }
}
'@

function Get-ValorantFrame([hashtable]$window) {
  Confirm-ValorantForeground $window
  $bitmap = New-Object System.Drawing.Bitmap($window.ViewWidth, $window.ViewHeight, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try { $graphics.CopyFromScreen($window.Left + $window.ViewLeft, $window.Top + $window.ViewTop, 0, 0, $bitmap.Size) }
  finally { $graphics.Dispose() }
  return $bitmap
}

function Get-VisibleTimelineTiles([hashtable]$window) {
  $frame = Get-ValorantFrame $window
  try { return ,[MoeTimelineTiles]::DetectLabelCenters($frame) }
  finally { $frame.Dispose() }
}

function Get-ValorantWindow {
  $process = Get-Process -Name 'VALORANT-Win64-Shipping' -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
    Select-Object -First 1
  if (-not $process) { throw 'A visible VALORANT window was not found.' }
  $handle = $process.MainWindowHandle
  [void][MoeScrimNative]::ShowWindowAsync($handle, 9)
  [void][MoeScrimNative]::SetForegroundWindow($handle)
  Start-Sleep -Milliseconds 700
  if ([MoeScrimNative]::GetForegroundWindow() -ne $handle) {
    throw 'Windows did not allow the helper to bring VALORANT to the foreground.'
  }

  $rect = New-Object MoeScrimNative+RECT
  if (-not [MoeScrimNative]::GetWindowRect($handle, [ref]$rect)) {
    throw 'Could not read the VALORANT window bounds.'
  }

  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -lt 1280 -or $height -lt 720) {
    throw "The VALORANT window is too small for calibrated capture. Detected window: $width x $height."
  }

  return @{ Handle = $handle; Left = $rect.Left; Top = $rect.Top; Width = $width; Height = $height; ViewLeft = 0; ViewTop = 0; ViewWidth = $width; ViewHeight = $height }
}

function Find-ValorantRenderArea([hashtable]$window) {
  $bitmap = New-Object System.Drawing.Bitmap($window.Width, $window.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($window.Left, $window.Top, 0, 0, $bitmap.Size)
    function Test-RegionIsBlack([int]$left, [int]$top, [int]$right, [int]$bottom) {
      if ($right -le $left -or $bottom -le $top) { return $true }
      $samples = 0
      $lit = 0
      $stepX = [Math]::Max(4, [Math]::Floor(($right - $left) / 48))
      $stepY = [Math]::Max(4, [Math]::Floor(($bottom - $top) / 32))
      for ($sampleY = $top; $sampleY -lt $bottom; $sampleY += $stepY) {
        for ($sampleX = $left; $sampleX -lt $right; $sampleX += $stepX) {
          $sample = $bitmap.GetPixel($sampleX, $sampleY)
          $samples++
          if (($sample.R + $sample.G + $sample.B) -gt 24) { $lit++ }
        }
      }
      return $samples -gt 0 -and ($lit / $samples) -lt 0.015
    }

    $knownSizes = @(
      @{ Width = 1280; Height = 720 },
      @{ Width = 1600; Height = 900 },
      @{ Width = 1920; Height = 1080 },
      @{ Width = 2560; Height = 1440 }
    )
    $best = $null
    foreach ($size in $knownSizes) {
      if ($size.Width -gt $window.Width -or $size.Height -gt $window.Height) { continue }
      $rightIsBlack = Test-RegionIsBlack $size.Width 0 $window.Width $window.Height
      $bottomIsBlack = Test-RegionIsBlack 0 $size.Height $size.Width $window.Height
      if ($rightIsBlack -and $bottomIsBlack) {
        $best = $size
        break
      }
    }
  }
  finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }

  if (-not $best) {
    $best = @{ Width = $window.Width; Height = $window.Height }
  }
  $aspect = $best.Width / $best.Height
  if ([Math]::Abs($aspect - (16 / 9)) -gt 0.03) {
    throw "Unsupported non-16:9 render area: $($best.Width) x $($best.Height)."
  }

  $window.ViewWidth = $best.Width
  $window.ViewHeight = $best.Height
  return $window
}

function Confirm-ValorantForeground([hashtable]$window) {
  if ([MoeScrimNative]::GetForegroundWindow() -eq $window.Handle) { return }

  [void][MoeScrimNative]::ShowWindowAsync($window.Handle, 9)
  [void][MoeScrimNative]::SetForegroundWindow($window.Handle)
  Start-Sleep -Milliseconds 350
  if ([MoeScrimNative]::GetForegroundWindow() -ne $window.Handle) {
    throw 'Capture stopped because VALORANT could not be safely restored to the foreground.'
  }
}

function Invoke-ValorantClick([hashtable]$window, [int]$x, [int]$y) {
  Confirm-ValorantForeground $window
  $scaledX = $window.ViewLeft + [Math]::Round($x * $window.ViewWidth / $referenceWidth)
  $scaledY = $window.ViewTop + [Math]::Round($y * $window.ViewHeight / $referenceHeight)
  if (-not [MoeScrimNative]::SetCursorPos($window.Left + $scaledX, $window.Top + $scaledY)) {
    throw 'Capture stopped because Windows rejected cursor positioning.'
  }
  Start-Sleep -Milliseconds 80
  [MoeScrimNative]::mouse_event([MoeScrimNative]::MouseLeftDown, 0, 0, 0, [UIntPtr]::Zero)
  [MoeScrimNative]::mouse_event([MoeScrimNative]::MouseLeftUp, 0, 0, 0, [UIntPtr]::Zero)
}

function Invoke-TimelineScroll([hashtable]$window, [int]$wheelDelta) {
  Confirm-ValorantForeground $window
  $scaledX = $window.ViewLeft + [Math]::Round(1000 * $window.ViewWidth / $referenceWidth)
  $scaledY = $window.ViewTop + [Math]::Round($roundY * $window.ViewHeight / $referenceHeight)
  if (-not [MoeScrimNative]::SetCursorPos($window.Left + $scaledX, $window.Top + $scaledY)) {
    throw 'Capture stopped because Windows rejected cursor positioning.'
  }
  $nativeDelta = [BitConverter]::ToUInt32([BitConverter]::GetBytes([int32]$wheelDelta), 0)
  1..32 | ForEach-Object {
    [MoeScrimNative]::mouse_event([MoeScrimNative]::MouseWheel, 0, 0, $nativeDelta, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 25
  }
  Start-Sleep -Milliseconds $PageDelayMs
}

function Save-ValorantCapture([hashtable]$window, [string]$path) {
  Confirm-ValorantForeground $window
  $bitmap = New-Object System.Drawing.Bitmap($window.ViewWidth, $window.ViewHeight)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.CopyFromScreen($window.Left + $window.ViewLeft, $window.Top + $window.ViewTop, 0, 0, $bitmap.Size)
    $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}

function Get-RoundHeaderFingerprint([hashtable]$window, [string]$path) {
  $bitmap = [System.Drawing.Bitmap]::FromFile($path)
  try {
    $left = [Math]::Round(1200 * $window.ViewWidth / $referenceWidth)
    $top = [Math]::Round(405 * $window.ViewHeight / $referenceHeight)
    $width = [Math]::Round(540 * $window.ViewWidth / $referenceWidth)
    $height = [Math]::Round(60 * $window.ViewHeight / $referenceHeight)
    $crop = $bitmap.Clone((New-Object System.Drawing.Rectangle($left, $top, $width, $height)), $bitmap.PixelFormat)
    try {
      $stream = New-Object System.IO.MemoryStream
      try {
        $crop.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $sha = [System.Security.Cryptography.SHA256]::Create()
        # Windows PowerShell 5.1 runs on .NET Framework, which has no
        # Convert.ToHexString; BitConverter works on every runtime.
        try { return ([BitConverter]::ToString($sha.ComputeHash($stream.ToArray()))).Replace('-', '') }
        finally { $sha.Dispose() }
      }
      finally { $stream.Dispose() }
    }
    finally { $crop.Dispose() }
  }
  finally { $bitmap.Dispose() }
}

$diagnosticLog = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'MoeTracker\scrim-capture-last-run.log'
[void][System.IO.Directory]::CreateDirectory((Split-Path $diagnosticLog -Parent))
Start-Transcript -LiteralPath $diagnosticLog -Force | Out-Null
$captureFolder = $null
$manifest = $null

try {
  if ($StartDelaySeconds -gt 0) {
    Write-Host "Capture starts in $StartDelaySeconds seconds. Keep the post-match Summary open."
    Start-Sleep -Seconds $StartDelaySeconds
  }

  $window = Find-ValorantRenderArea (Get-ValorantWindow)
  $captureId = Get-Date -Format 'yyyyMMdd-HHmmss'
  $captureFolder = Join-Path $OutputRoot "Scrim-$captureId"
  try {
    [void][System.IO.Directory]::CreateDirectory($captureFolder)
  }
  catch {
    $fallbackRoot = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'MoeTracker\Scoreboards'
    $captureFolder = Join-Path $fallbackRoot "Scrim-$captureId"
    [void][System.IO.Directory]::CreateDirectory($captureFolder)
    Write-Host "Documents is not writable; using fallback capture folder: $captureFolder" -ForegroundColor Yellow
  }

  $manifest = [ordered]@{
    schemaVersion = 1
    captureId = $captureId
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    resolution = @{ width = $window.ViewWidth; height = $window.ViewHeight }
    requestedRounds = $RoundCount
    template = $Template
    outputFolder = $captureFolder
    status = 'capturing'
    captures = @()
    timelinePasses = @()
  }

  Invoke-ValorantClick $window $tabTargets.scoreboard.x $tabTargets.scoreboard.y
  Start-Sleep -Milliseconds $PageDelayMs
  $scoreboardPath = Join-Path $captureFolder 'scoreboard.png'
  Save-ValorantCapture $window $scoreboardPath
  $manifest.captures += @{ kind = 'scoreboard'; file = 'scoreboard.png' }

  if ($Template -eq 'with-performance') {
    Invoke-ValorantClick $window $tabTargets.performance.x $tabTargets.performance.y
    Start-Sleep -Milliseconds $PageDelayMs
    $performancePath = Join-Path $captureFolder 'performance.png'
    Save-ValorantCapture $window $performancePath
    $manifest.captures += @{ kind = 'performance'; file = 'performance.png' }
  }

  Invoke-ValorantClick $window $tabTargets.headToHead.x $tabTargets.headToHead.y
  Start-Sleep -Milliseconds $PageDelayMs
  $headToHeadPath = Join-Path $captureFolder 'head-to-head.png'
  Save-ValorantCapture $window $headToHeadPath
  $manifest.captures += @{ kind = 'head-to-head'; file = 'head-to-head.png' }

  Invoke-ValorantClick $window $tabTargets.timeline.x $tabTargets.timeline.y
  Start-Sleep -Milliseconds $PageDelayMs

  # The strip may open centred on the player's best round, and matches over
  # 24 rounds (overtime, play-all-rounds customs) never fit in one view.
  # Instead of clicking fixed slot positions, detect the visible tiles by
  # their round-number labels, click each one, then scroll right and repeat.
  # Images are numbered in capture order; the importer files each one under
  # the "ROUND N" header printed on it, so scroll offsets can't mislabel data.
  $seenFingerprints = New-Object 'System.Collections.Generic.HashSet[string]'
  $captureIndex = 0
  $passes = @(120, -120)
  $previousTiles = $null
  foreach ($wheel in $passes) {
    Invoke-TimelineScroll $window $wheel
    $tiles = Get-VisibleTimelineTiles $window
    $manifest.timelinePasses += @{ wheel = $wheel; tiles = $tiles.Count }
    if ($previousTiles -and (($tiles -join ',') -eq ($previousTiles -join ','))) { continue }
    $previousTiles = $tiles
    foreach ($tileX in $tiles) {
      if ($captureIndex -ge $RoundCap) { break }
      Invoke-ValorantClick $window $tileX $roundY
      Start-Sleep -Milliseconds $RoundDelayMs
      $candidate = Join-Path $captureFolder "pending-$($captureIndex + 1).png"
      Save-ValorantCapture $window $candidate
      $fingerprint = Get-RoundHeaderFingerprint $window $candidate
      if ($seenFingerprints.Contains($fingerprint)) {
        # A late UI response can leave the previous round on screen: retry once.
        Invoke-ValorantClick $window $tileX $roundY
        Start-Sleep -Milliseconds ([Math]::Max($RoundDelayMs, 1000))
        Save-ValorantCapture $window $candidate
        $fingerprint = Get-RoundHeaderFingerprint $window $candidate
      }
      if ($seenFingerprints.Contains($fingerprint)) {
        Remove-Item -LiteralPath $candidate -Force
        continue
      }
      [void]$seenFingerprints.Add($fingerprint)
      $captureIndex++
      $fileName = "round-$('{0:d2}' -f $captureIndex).png"
      Move-Item -LiteralPath $candidate -Destination (Join-Path $captureFolder $fileName) -Force
      $manifest.captures += @{ kind = 'round'; round = $captureIndex; file = $fileName }
    }
  }
  $detectedRoundCount = $captureIndex
  if ($detectedRoundCount -eq 0) { throw 'No timeline round tiles were detected. Open the TIMELINE tab of the post-match Summary and try again.' }
  # Rounds are numbered by capture order; the importer re-keys them by header.
  $manifest.requestedRounds = $detectedRoundCount
  $manifest.roundNumbering = 'capture-order'
  $manifest.detectedRounds = $detectedRoundCount

  $manifest.status = 'complete'
  $manifest.completedAt = (Get-Date).ToUniversalTime().ToString('o')
  [console]::Beep(880, 180)
  Start-Sleep -Milliseconds 80
  [console]::Beep(1175, 240)
}
catch {
  if ($manifest) {
    $manifest.status = 'stopped'
    $manifest.error = $_.Exception.Message
  }
  Write-Host "Capture failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Diagnostic log: $diagnosticLog" -ForegroundColor Yellow
  Read-Host 'Press Enter to close this window'
  exit 1
}
finally {
  if ($manifest -and $captureFolder) {
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $captureFolder 'capture-manifest.json') -Encoding UTF8
  }
  Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
}

Write-Host "Scrim capture completed: $captureFolder"
