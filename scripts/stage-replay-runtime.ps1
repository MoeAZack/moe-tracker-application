[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$runtimeRoot = Join-Path $PSScriptRoot '..\replay-runtime'
$vrfkitRoot = Join-Path $runtimeRoot 'vrfkit'
$pythonRoot = Join-Path $runtimeRoot 'python'

if (Test-Path -LiteralPath $runtimeRoot) { Remove-Item -LiteralPath $runtimeRoot -Recurse -Force }
New-Item -ItemType Directory -Force $vrfkitRoot, $pythonRoot | Out-Null
$downloadRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("moe-tracker-runtime-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $downloadRoot | Out-Null

try {
  $vrfkitZip = Join-Path $downloadRoot 'vrfkit.zip'
  Invoke-WebRequest 'https://github.com/yakisoba0728/vrfkit/releases/download/v0.2.5/vrfkit-v0.2.5-windows-x64.zip' -OutFile $vrfkitZip
  $zipHash = (Get-FileHash $vrfkitZip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($zipHash -ne '2cf8375191f7de8b8199f84a69e91a02e5e4d5b541c242e466c9d9aa24ef7494') { throw "vrfkit release ZIP hash mismatch: $zipHash" }
  $extractRoot = Join-Path $downloadRoot 'vrfkit'
  Expand-Archive $vrfkitZip -DestinationPath $extractRoot
  $vrfkitExe = Get-ChildItem $extractRoot -Recurse -Filter 'vrfkit.exe' | Select-Object -First 1
  if (-not $vrfkitExe) { throw 'vrfkit.exe was not present in the verified release archive.' }
  $exeHash = (Get-FileHash $vrfkitExe.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($exeHash -ne 'aa55fc410f1596a6ffedc7ab579341da6edb262197c64902e74b4eed485dc23f') { throw "vrfkit.exe hash mismatch: $exeHash" }
  Copy-Item (Join-Path $vrfkitExe.DirectoryName '*') $vrfkitRoot -Recurse

  $pythonVersion = '3.12.10'
  $pythonZip = Join-Path $downloadRoot 'python-embed.zip'
  Invoke-WebRequest "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip" -OutFile $pythonZip
  Expand-Archive $pythonZip -DestinationPath $pythonRoot
  $pth = Get-ChildItem $pythonRoot -Filter 'python*._pth' | Select-Object -First 1
  if (-not $pth) { throw 'Embedded Python path configuration was not found.' }
  Add-Content $pth.FullName "Lib\site-packages`nimport site"
  python -m pip install --only-binary=:all: --no-deps --target (Join-Path $pythonRoot 'Lib\site-packages') 'pyarrow==18.1.0'
  if ($LASTEXITCODE -ne 0) { throw 'Failed to stage pyarrow for embedded Python.' }
  & (Join-Path $pythonRoot 'python.exe') -c "import pyarrow.parquet; print('pyarrow', pyarrow.__version__)"
  if ($LASTEXITCODE -ne 0) { throw 'Embedded Python cannot import pyarrow.' }
  if (-not (Test-Path -LiteralPath (Join-Path $vrfkitRoot 'build-info.json'))) { throw 'Verified vrfkit archive is missing build-info.json.' }
  Write-Host "Replay runtime ready: vrfkit $exeHash; Python $pythonVersion; pyarrow 18.1.0"
}
finally {
  if (Test-Path -LiteralPath $downloadRoot) { Remove-Item -LiteralPath $downloadRoot -Recurse -Force }
}
