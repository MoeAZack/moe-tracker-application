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

  # The game may initially center the strip on the player's best round. Always
  # normalize to the far-left edge before capturing numbered rounds.
  Invoke-TimelineScroll $window 120
  $firstPassEnd = [Math]::Min($RoundCount, 24)
  for ($round = 1; $round -le $firstPassEnd; $round++) {
    Invoke-ValorantClick $window (Get-RoundTargetX $round 1) $roundY
    Start-Sleep -Milliseconds $RoundDelayMs
    $fileName = "round-$('{0:d2}' -f $round).png"
    Save-ValorantCapture $window (Join-Path $captureFolder $fileName)
    $manifest.captures += @{ kind = 'round'; round = $round; file = $fileName }
  }

  if ($RoundCount -gt 24) {
    Invoke-TimelineScroll $window -120
    $tailFirstVisibleRound = $RoundCount - 23
    for ($round = 25; $round -le $RoundCount; $round++) {
      Invoke-ValorantClick $window (Get-RoundTargetX $round $tailFirstVisibleRound) $roundY
      Start-Sleep -Milliseconds $RoundDelayMs
      $fileName = "round-$('{0:d2}' -f $round).png"
      Save-ValorantCapture $window (Join-Path $captureFolder $fileName)
      $manifest.captures += @{ kind = 'round'; round = $round; file = $fileName }
    }
    $manifest.timelineTailStatus = 'captured-after-scroll'
  }

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
