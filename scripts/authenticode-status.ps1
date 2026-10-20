param([Parameter(Mandatory = $true)][string]$FilesJson)
$ErrorActionPreference = 'Stop'
$Files = @($FilesJson | ConvertFrom-Json)
$result = $Files | ForEach-Object {
  $signature = Get-AuthenticodeSignature -LiteralPath $_
  [pscustomobject]@{
    path = $_
    status = $signature.Status.ToString()
    subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { $null }
  }
}
$result | ConvertTo-Json -Compress
