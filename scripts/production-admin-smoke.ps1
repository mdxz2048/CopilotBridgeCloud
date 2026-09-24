param([string]$CredentialPath = "$env:USERPROFILE\.codex\bridge-cloud-admin.dpapi")
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$origin = 'https://ai.mddxz.top'
$secure = Get-Content -LiteralPath $CredentialPath | ConvertTo-SecureString
$credential = [pscredential]::new('zhipeng2048@gmail.com', $secure)
$session = $null
try {
  $login = Invoke-RestMethod -Uri "$origin/api/v1/auth/login" -Method Post -ContentType 'application/json' -Headers @{ Origin = $origin } -SessionVariable session -Body (@{
    email = 'zhipeng2048@gmail.com'; password = $credential.GetNetworkCredential().Password
  } | ConvertTo-Json -Compress)
  if ($login.user.role -ne 'ADMIN') { throw 'Production Admin role unavailable' }
  Write-Output 'ADMIN_AUTH PASS'
  foreach ($path in @('dashboard', 'wallets', 'rate-cards', 'referrals', 'referral-policy', 'cost-analytics?groupBy=day')) {
    $null = Invoke-RestMethod -Uri "$origin/api/v1/admin/$path" -WebSession $session
    Write-Output "ADMIN_$($path.Split('?')[0].ToUpperInvariant()) PASS"
  }
} finally {
  if ($session) {
    try { $null = Invoke-RestMethod -Uri "$origin/api/v1/auth/logout" -Method Post -ContentType 'application/json' -Headers @{ Origin = $origin } -WebSession $session -Body '{}' }
    catch { Write-Warning 'Admin smoke session logout failed' }
  }
  $credential = $null
}
