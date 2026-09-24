param(
  [string]$BaseUrl = 'https://ai.mddxz.top',
  [string]$CredentialPath = "$env:USERPROFILE\.codex\bridge-cloud-production-test.dpapi",
  [string]$ExistingDeviceId = 'e6478afb-4719-4359-b57f-e446b3861629'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($BaseUrl -ne 'https://ai.mddxz.top') { throw 'Unexpected production origin' }
$secure = Get-Content -LiteralPath $CredentialPath | ConvertTo-SecureString
$credential = [pscredential]::new('production-integration@example.test', $secure)
$deviceId = [guid]::Parse($ExistingDeviceId).ToString()
$login = Invoke-RestMethod -Uri "$BaseUrl/api/v1/auth/login" -Method Post -ContentType 'application/json' -Body (@{
  email = 'production-integration@example.test'; password = $credential.GetNetworkCredential().Password
  device = @{ deviceId = $deviceId; deviceName = 'DESKTOP-OTG683T'; platform = 'win32'; osVersion = '10.0.19045'; appVersion = '0.1.0' }
} | ConvertTo-Json -Depth 8 -Compress)
$credential = $null
if (-not $login.accessToken) { throw 'Production test account login failed' }
$headers = @{ Authorization = "Bearer $($login.accessToken)"; 'X-Device-Id' = $deviceId; 'X-Client-Thread-Id' = [guid]::NewGuid().ToString() }
$before = Invoke-RestMethod -Uri "$BaseUrl/api/v1/me/wallet" -Headers $headers
$reply = Invoke-RestMethod -Uri "$BaseUrl/v1/responses" -Method Post -ContentType 'application/json' -Headers $headers -Body (@{
  model = 'mock/mock-chat'; input = 'Production Shadow billing integration check'
} | ConvertTo-Json -Compress)
if ($reply.usage.billing_mode -ne 'SHADOW' -or [int]$reply.usage.points_rated -le 0 -or [int]$reply.usage.points_charged -ne 0 -or [int]$reply.usage.points -ne 0) {
  throw 'Shadow response metadata failed'
}
$lookup = Invoke-RestMethod -Uri "$BaseUrl/api/v1/usage/responses/$($reply.id)" -Headers $headers
$after = Invoke-RestMethod -Uri "$BaseUrl/api/v1/me/wallet" -Headers $headers
if ($lookup.request.id -ne $reply.usage.request_id -or $lookup.usage.billingStatus -ne 'SHADOW' -or
    [int]$lookup.usage.pointsRated -ne [int]$reply.usage.points_rated -or [int]$lookup.usage.pointsCharged -ne 0 -or
    -not $lookup.usage.rateCardVersionId -or [int]$before.balance -ne [int]$after.balance -or
    [int]$reply.usage.remaining_points -ne [int]$after.balance) {
  throw 'Shadow settlement or wallet reconciliation failed'
}
$transactions = Invoke-RestMethod -Uri "$BaseUrl/api/v1/me/wallet/transactions" -Headers $headers
if (-not (@($transactions.data | Where-Object { $_.type -eq 'TEST_GRANT' -and [int]$_.points -eq 10000 }).Count -ge 1)) {
  throw 'Audited test grant missing'
}
if (@($transactions.data | Where-Object { $_.referenceId -eq $reply.usage.request_id -and $_.type -eq 'USAGE' }).Count -ne 0) {
  throw 'Shadow request unexpectedly debited wallet'
}
[pscustomobject]@{
  ShadowE2E = 'PASS'; BillingMode = 'SHADOW'; PointsRated = [int]$reply.usage.points_rated
  PointsCharged = [int]$reply.usage.points_charged; WalletBefore = [int]$before.balance
  WalletAfter = [int]$after.balance; Settlement = $lookup.usage.billingStatus
  RequestId = $reply.usage.request_id; ResponseId = $reply.id
}
