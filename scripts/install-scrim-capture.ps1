[CmdletBinding()]
param(
  [string]$Destination = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Moe Tracker\Tools\Scrim Capture')
)

$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
[void][System.IO.Directory]::CreateDirectory($Destination)
Copy-Item -LiteralPath (Join-Path $source 'scrim-capture.ps1') -Destination $Destination -Force
Copy-Item -LiteralPath (Join-Path $source 'start-scrim-capture.cmd') -Destination $Destination -Force
Copy-Item -LiteralPath (Join-Path (Split-Path $source -Parent) 'docs\SCRIM-CAPTURE.md') -Destination $Destination -Force
Write-Host "Installed MoeTracker Scrim Capture to: $Destination"
