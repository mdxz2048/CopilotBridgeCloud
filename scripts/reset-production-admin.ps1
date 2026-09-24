param(
  [string]$AdminEmail = 'zhipeng2048@gmail.com',
  [string]$Server = 'linuxuser@66.245.221.236',
  [string]$CredentialPath = "$env:USERPROFILE\.codex\bridge-cloud-admin.dpapi"
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$bytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(24)
$password = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
[Array]::Clear($bytes, 0, $bytes.Length)
$psi = [Diagnostics.ProcessStartInfo]::new()
$psi.FileName = 'ssh.exe'
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
foreach ($arg in @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', $Server,
  "cd /home/linuxuser/copilot-bridge-cloud/src && sudo -n docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.shared-host.yml exec -T api node /workspace/apps/api/dist/cli/reset-admin-password.js $AdminEmail")) {
  [void]$psi.ArgumentList.Add($arg)
}
$process = [Diagnostics.Process]::Start($psi)
try {
  $process.StandardInput.WriteLine($password)
  $process.StandardInput.Close()
  $output = $process.StandardOutput.ReadToEnd()
  $errors = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw "Admin reset failed: $errors" }
  $result = $output | ConvertFrom-Json
  if ($result.passwordReset -ne 'PASS') { throw 'Admin reset did not report success' }
  $login = Invoke-RestMethod -Uri 'https://ai.mddxz.top/api/v1/auth/login' -Method Post -ContentType 'application/json' -Headers @{ Origin = 'https://ai.mddxz.top' } -Body (@{
    email = $AdminEmail; password = $password
  } | ConvertTo-Json -Compress)
  if ($login.user.role -ne 'ADMIN') { throw 'Admin login validation failed' }
  $secure = ConvertTo-SecureString $password -AsPlainText -Force
  $parent = Split-Path -Parent $CredentialPath
  if (-not (Test-Path -LiteralPath $parent)) { [void](New-Item -ItemType Directory -Path $parent -Force) }
  $secure | ConvertFrom-SecureString | Set-Content -LiteralPath $CredentialPath -Encoding utf8
  Write-Output "Admin login PASS; email=$AdminEmail; password stored with Windows DPAPI at $CredentialPath"
} finally { $process.Dispose(); $password = $null }
