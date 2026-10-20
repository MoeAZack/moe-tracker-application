[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$runtimeRoot = Join-Path $PSScriptRoot '..\replay-runtime'
$vrfkitRoot = Join-Path $runtimeRoot 'vrfkit'
$pythonRoot = Join-Path $runtimeRoot 'python'
$pin = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'replay-runtime-pin.json') -Raw | ConvertFrom-Json

if (Test-Path -LiteralPath $runtimeRoot) { Remove-Item -LiteralPath $runtimeRoot -Recurse -Force }
New-Item -ItemType Directory -Force $vrfkitRoot, $pythonRoot | Out-Null
$downloadRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("moe-tracker-runtime-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $downloadRoot | Out-Null

try {
  $vrfkitZip = Join-Path $downloadRoot 'vrfkit.zip'
  $archiveName = "vrfkit-$($pin.tag)-windows-x64.zip"
  Invoke-WebRequest "https://github.com/$($pin.repository)/releases/download/$($pin.tag)/$archiveName" -OutFile $vrfkitZip
  $zipHash = (Get-FileHash $vrfkitZip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($zipHash -ne $pin.windowsX64ZipSha256) { throw "vrfkit release ZIP hash mismatch: $zipHash" }
  $extractRoot = Join-Path $downloadRoot 'vrfkit'
  Expand-Archive $vrfkitZip -DestinationPath $extractRoot
  $vrfkitExe = Get-ChildItem $extractRoot -Recurse -Filter 'vrfkit.exe' | Select-Object -First 1
  if (-not $vrfkitExe) { throw 'vrfkit.exe was not present in the verified release archive.' }
  $exeHash = (Get-FileHash $vrfkitExe.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($exeHash -ne $pin.windowsX64ExeSha256) { throw "vrfkit.exe hash mismatch: $exeHash" }
  Copy-Item (Join-Path $vrfkitExe.DirectoryName '*') $vrfkitRoot -Recurse

  $pythonVersion = $pin.python.version
  $pythonZip = Join-Path $downloadRoot 'python-embed.zip'
  Invoke-WebRequest "https://www.python.org/ftp/python/$pythonVersion/python-$pythonVersion-embed-amd64.zip" -OutFile $pythonZip
  $pythonZipHash = (Get-FileHash $pythonZip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($pythonZipHash -ne $pin.python.windowsX64EmbedZipSha256) { throw "Embedded Python ZIP hash mismatch: $pythonZipHash" }
  Expand-Archive $pythonZip -DestinationPath $pythonRoot
  $pth = Get-ChildItem $pythonRoot -Filter 'python*._pth' | Select-Object -First 1
  if (-not $pth) { throw 'Embedded Python path configuration was not found.' }
  Add-Content $pth.FullName "Lib\site-packages`nimport site"
  python -m pip download --only-binary=:all: --no-deps --python-version 3.12 --platform win_amd64 --implementation cp --abi cp312 --dest $downloadRoot "pyarrow==$($pin.pyarrow.version)"
  if ($LASTEXITCODE -ne 0) { throw 'Failed to download the pinned pyarrow wheel.' }
  $pyarrowWheel = Join-Path $downloadRoot $pin.pyarrow.windowsCp312X64Wheel
  if (-not (Test-Path -LiteralPath $pyarrowWheel -PathType Leaf)) { throw 'The expected pinned pyarrow wheel was not downloaded.' }
  $pyarrowHash = (Get-FileHash $pyarrowWheel -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($pyarrowHash -ne $pin.pyarrow.windowsCp312X64WheelSha256) { throw "pyarrow wheel hash mismatch: $pyarrowHash" }
  python -m pip install --no-deps --target (Join-Path $pythonRoot 'Lib\site-packages') $pyarrowWheel
  if ($LASTEXITCODE -ne 0) { throw 'Failed to stage pyarrow for embedded Python.' }
  $pythonExe = Join-Path $pythonRoot 'python.exe'
  $pythonExeHash = (Get-FileHash $pythonExe -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($pythonExeHash -ne $pin.python.windowsX64ExeSha256) { throw "Embedded Python executable hash mismatch: $pythonExeHash" }
  & $pythonExe -c "import pyarrow.parquet; assert pyarrow.__version__ == '$($pin.pyarrow.version)'; print('pyarrow', pyarrow.__version__)"
  if ($LASTEXITCODE -ne 0) { throw 'Embedded Python cannot import pyarrow.' }
  $buildInfoPath = Join-Path $vrfkitRoot 'build-info.json'
  if (-not (Test-Path -LiteralPath $buildInfoPath)) { throw 'Verified vrfkit archive is missing build-info.json.' }
  $buildInfo = Get-Content -LiteralPath $buildInfoPath -Raw | ConvertFrom-Json
  if ($buildInfo.tag -ne $pin.tag -or $buildInfo.commit -ne $pin.commit -or $buildInfo.executable_sha256 -ne $pin.windowsX64ExeSha256) { throw 'Verified vrfkit build metadata does not match the owned runtime pin.' }
  $manifest = [ordered]@{
    schemaVersion = 1
    vrfkit = [ordered]@{ version = $pin.version; commit = $pin.commit; sha256 = $exeHash }
    python = [ordered]@{ version = $pythonVersion; sha256 = $pythonExeHash; archiveSha256 = $pythonZipHash }
    pyarrow = [ordered]@{ version = $pin.pyarrow.version; wheel = $pin.pyarrow.windowsCp312X64Wheel; wheelSha256 = $pyarrowHash }
  }
  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $runtimeRoot 'runtime-manifest.json') -Encoding utf8
  Write-Host "Replay runtime ready: vrfkit $exeHash; Python $pythonVersion; pyarrow $($pin.pyarrow.version)"
}
finally {
  if (Test-Path -LiteralPath $downloadRoot) { Remove-Item -LiteralPath $downloadRoot -Recurse -Force }
}
