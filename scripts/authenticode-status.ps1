param([Parameter(Mandatory = $true)][string]$FilesJson)
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 passes a parsed JSON array down the pipeline as one
# object, so iterate with foreach and serialize with -InputObject to keep one
# record per file and an array even for a single file.
$result = foreach ($file in ($FilesJson | ConvertFrom-Json)) {
  $signature = Get-AuthenticodeSignature -LiteralPath ([string]$file)
  [pscustomobject]@{
    path = [string]$file
    status = $signature.Status.ToString()
    subject = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { $null }
  }
}
ConvertTo-Json -InputObject @($result) -Compress -Depth 4
