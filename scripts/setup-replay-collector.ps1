param(
  [string]$Server = "https://moetracker-site.pages.dev",
  [string]$DeviceId = ""
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

Write-Host "MoeTracker Replay Collector setup" -ForegroundColor Cyan
if (-not $DeviceId) { $DeviceId = (Read-Host "Paste the Device ID shown in MoeTracker").Trim() }
if ($DeviceId -notmatch '^d_[A-Za-z0-9_-]{20,80}$') { throw "That Device ID is not valid." }

if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) { throw "Windows App Installer (winget) is required." }
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  Write-Host "Installing Node.js for the current PC..."
  winget install --id OpenJS.NodeJS.LTS --exact --silent --accept-package-agreements --accept-source-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}
$python = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
  Write-Host "Installing the free local parser runtime..."
  winget install --id Python.Python.3.12 --exact --silent --accept-package-agreements --accept-source-agreements
}
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw "Python 3.12 installation did not complete." }
& $python -c "import pyarrow" 2>$null
if ($LASTEXITCODE -ne 0) { & $python -m pip install --user --only-binary=:all: pyarrow==21.0.0 }

$root = Join-Path $env:LOCALAPPDATA "MoeTracker\ReplayCollector"
$setup = Join-Path $root "setup"
$runtime = Join-Path $root "runtime"
New-Item -ItemType Directory -Path $setup -Force | Out-Null
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
foreach ($file in @("replay-collector.mjs", "replay-runtime-pin.json", "normalize-vrfkit-export.py", "replay-collector-launch.ps1", "install-replay-collector.ps1")) {
  Invoke-WebRequest -Uri "$Server/collector/$file" -OutFile (Join-Path $setup $file)
}
$pin = Get-Content -LiteralPath (Join-Path $setup 'replay-runtime-pin.json') -Raw | ConvertFrom-Json

$archiveName = "vrfkit-$($pin.tag)-windows-x64.zip"
$zip = Join-Path $runtime $archiveName
$extract = Join-Path $runtime "vrfkit-$($pin.version)"
if (-not (Test-Path -LiteralPath (Join-Path $extract "vrfkit.exe") -PathType Leaf)) {
  Invoke-WebRequest -Uri "https://github.com/$($pin.repository)/releases/download/$($pin.tag)/$archiveName" -OutFile $zip
  $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $pin.windowsX64ZipSha256) { throw "The replay parser download failed verification." }
  if (Test-Path -LiteralPath $extract) { Remove-Item -LiteralPath $extract -Recurse -Force }
  Expand-Archive -LiteralPath $zip -DestinationPath $extract
}
$binary = Join-Path $extract "vrfkit.exe"
$binaryHash = (Get-FileHash -LiteralPath $binary -Algorithm SHA256).Hash.ToLowerInvariant()
if ($binaryHash -ne $pin.windowsX64ExeSha256) { throw "The replay parser executable failed verification." }
$buildInfo = Get-Content -LiteralPath (Join-Path $extract 'build-info.json') -Raw | ConvertFrom-Json
if ($buildInfo.tag -ne $pin.tag -or $buildInfo.commit -ne $pin.commit -or $buildInfo.executable_sha256 -ne $pin.windowsX64ExeSha256) { throw 'The replay parser build metadata failed verification.' }

& (Join-Path $setup "install-replay-collector.ps1") -Server $Server -DeviceId $DeviceId -VrfkitBinary $binary -PythonPath $python
Write-Host "Setup complete. New replays will appear automatically after VALORANT finishes writing them." -ForegroundColor Green
Read-Host "Press Enter to close"
