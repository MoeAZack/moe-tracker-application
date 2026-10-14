# Windows-only check run in CI under Windows PowerShell 5.1 (the runtime the
# capture helper uses). Compiles the timeline tile detector embedded in
# scripts/scrim-capture.ps1 and runs it on strip-only fixtures.
$ErrorActionPreference = 'Stop'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$script = Get-Content -Raw (Join-Path $root 'scripts\scrim-capture.ps1')
$match = [regex]::Match($script, "(?s)Add-Type -ReferencedAssemblies System\.Drawing -TypeDefinition @'\r?\n(.*?MoeTimelineTiles.*?)\r?\n'@")
if (-not $match.Success) { throw 'Tile detector source not found in scrim-capture.ps1' }
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $match.Groups[1].Value
$expected = Get-Content -Raw (Join-Path $root 'tests\fixtures\timeline\expected.json') | ConvertFrom-Json
$failed = 0
foreach ($name in $expected.PSObject.Properties.Name) {
  $source = [System.Drawing.Bitmap]::FromFile((Join-Path $root "tests\fixtures\timeline\$name.png"))
  $bitmap = New-Object System.Drawing.Bitmap($source.Width, $source.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.DrawImage($source, 0, 0, $source.Width, $source.Height); $graphics.Dispose(); $source.Dispose()
  $tiles = [MoeTimelineTiles]::DetectLabelCenters($bitmap); $bitmap.Dispose()
  $want = [int]$expected.$name
  $status = if ($tiles.Count -eq $want) { 'ok' } else { $failed++; 'FAIL' }
  Write-Host "$status $name : $($tiles.Count) tiles (expected $want) -> $($tiles -join ',')"
}
# The round-header fingerprint must use APIs available on .NET Framework.
$hex = ([BitConverter]::ToString([byte[]](1, 171, 255))).Replace('-', '')
if ($hex -ne '01ABFF') { throw "Hex fingerprint helper broken: $hex" }
if ($script -match '\[Convert\]::ToHexString') { throw 'scrim-capture.ps1 uses Convert.ToHexString, which Windows PowerShell 5.1 lacks.' }
if ($failed) { throw "$failed timeline fixture(s) failed." }
Write-Host 'Timeline tile detector OK on Windows PowerShell' $PSVersionTable.PSVersion
