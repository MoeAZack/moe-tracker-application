param(
  [Parameter(Mandatory = $true)][string]$Config,
  [Parameter(Mandatory = $true)][string]$Database,
  [Parameter(Mandatory = $true)][string]$Backups,
  [string]$LocalState = "$env:APPDATA\moe-tracker-application\Local State"
)

$ErrorActionPreference = 'Stop'
$configValue = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
$localStateValue = Get-Content -LiteralPath $LocalState -Raw | ConvertFrom-Json
if (-not $configValue.backupKeyCredential -or -not $localStateValue.os_crypt.encrypted_key) { throw 'The installed app has no device-protected recovery credential.' }

$wrappedKey = [Convert]::FromBase64String([string]$localStateValue.os_crypt.encrypted_key)
$dpapiPrefix = [Text.Encoding]::ASCII.GetString($wrappedKey, 0, 5)
if ($dpapiPrefix -ne 'DPAPI') { throw 'The Windows recovery-key format is unsupported.' }
$protectedKey = [byte[]]$wrappedKey[5..($wrappedKey.Length - 1)]
$masterKey = [System.Security.Cryptography.ProtectedData]::Unprotect($protectedKey, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)

$credential = [Convert]::FromBase64String([string]$configValue.backupKeyCredential)
if ([Text.Encoding]::ASCII.GetString($credential, 0, 3) -ne 'v10') { throw 'The installed recovery credential format is unsupported.' }
$nonce = [byte[]]$credential[3..14]
$cipherLength = $credential.Length - 3 - 12 - 16
$ciphertext = New-Object byte[] $cipherLength
$tag = New-Object byte[] 16
[Array]::Copy($credential, 15, $ciphertext, 0, $cipherLength)
[Array]::Copy($credential, 15 + $cipherLength, $tag, 0, 16)
$plaintext = New-Object byte[] $cipherLength
$aes = [System.Security.Cryptography.AesGcm]::new($masterKey, 16)
try { $aes.Decrypt($nonce, $ciphertext, $tag, $plaintext, $null) } finally { $aes.Dispose(); [Array]::Clear($masterKey, 0, $masterKey.Length) }
$backupKey = [Text.Encoding]::UTF8.GetString($plaintext)
[Array]::Clear($plaintext, 0, $plaintext.Length)

$previous = $env:PRIVATE_BACKUP_KEY
try {
  $env:PRIVATE_BACKUP_KEY = $backupKey
  $tsx = Join-Path $PSScriptRoot '..\node_modules\tsx\dist\cli.mjs'
  $helper = Join-Path $PSScriptRoot 'stage0-create-recovery.mts'
  & node $tsx $helper --db $Database --backups $Backups
  if ($LASTEXITCODE -ne 0) { throw "Recovery dry-run failed with exit code $LASTEXITCODE." }
} finally {
  $backupKey = $null
  $env:PRIVATE_BACKUP_KEY = $previous
}
