param(
  [string]$BaseUrl = 'https://ai.mddxz.top',
  [string]$CredentialPath = "$env:USERPROFILE\.codex\bridge-cloud-production-test.dpapi",
  [string]$ExistingDeviceId = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($BaseUrl -ne 'https://ai.mddxz.top') { throw 'Unexpected production origin' }
$secure = Get-Content -LiteralPath $CredentialPath | ConvertTo-SecureString
$credential = [pscredential]::new('production-integration@example.test', $secure)
$reuseDevice = [bool]$ExistingDeviceId
$deviceId = if ($reuseDevice) { [guid]::Parse($ExistingDeviceId).ToString() } else { [guid]::NewGuid().ToString() }
$threadId = [guid]::NewGuid().ToString()
$accessToken = $null
$registeredDeviceId = $null
function SendJson([string]$Path, [object]$Body, [hashtable]$Headers = @{}) {
  Invoke-RestMethod -Uri "$BaseUrl$Path" -Method Post -ContentType 'application/json' -Headers $Headers -Body ($Body | ConvertTo-Json -Depth 20 -Compress)
}
try {
  $login = SendJson '/api/v1/auth/login' @{
    email = 'production-integration@example.test'
    password = $credential.GetNetworkCredential().Password
    device = if ($reuseDevice) { @{ deviceId = $deviceId; deviceName = 'DESKTOP-OTG683T'; platform = 'win32'; osVersion = '10.0.19045'; appVersion = '0.1.0' } }
      else { @{ deviceId = $deviceId; deviceName = 'Server V2 smoke'; platform = 'windows'; osVersion = '11'; appVersion = '2.0.0-test' } }
  }
  $accessToken = $login.accessToken
  $registeredDeviceId = $login.device.id
  if (-not $accessToken) { throw 'Production auth failed' }
  Write-Output 'AUTH PASS'
  $headers = @{ Authorization = "Bearer $accessToken"; 'X-Device-Id' = $deviceId; 'X-Client-Thread-Id' = $threadId }
  $account = Invoke-RestMethod -Uri "$BaseUrl/api/v1/account" -Headers $headers
  if ($account.plan.code -ne 'PRO') { throw 'Subscription fixture unavailable' }
  Write-Output 'SUBSCRIPTION PASS'
  $models = Invoke-RestMethod -Uri "$BaseUrl/v1/models" -Headers $headers
  if (-not ($models.data.id -contains 'mock/mock-chat')) { throw 'Mock model unavailable' }
  Write-Output 'MODELS PASS'
  $reply = SendJson '/v1/responses' @{ model = 'mock/mock-chat'; input = 'Server V2 production smoke' } $headers
  if ($reply.output[0].type -ne 'message') { throw 'JSON response failed' }
  Write-Output 'RESPONSES PASS'
  $sse = Invoke-WebRequest -Uri "$BaseUrl/v1/responses" -Method Post -ContentType 'application/json' -Headers $headers -Body (@{ model = 'mock/mock-chat'; input = 'SSE smoke'; stream = $true } | ConvertTo-Json -Compress)
  if ([string]$sse.Headers['Content-Type'] -notlike 'text/event-stream*' -or -not $sse.Content.Contains('event: response.completed') -or -not $sse.Content.Contains('data: [DONE]')) { throw 'SSE completion failed' }
  Write-Output 'SSE PASS'
  $toolList = @(@{ name = 'read'; parameters = @{} }, @{ name = 'write'; parameters = @{} })
  $first = SendJson '/v1/responses' @{ model = 'mock/mock-chat'; input = 'Use local tools'; tools = $toolList } $headers
  if ($first.output[0].type -ne 'function_call') { throw 'First tool call missing' }
  $readOutput = @{ type = 'function_call_output'; call_id = $first.output[0].call_id; output = 'CLOUD-TOOL-731' }
  $second = SendJson '/v1/responses' @{ model = 'mock/mock-chat'; input = @($readOutput); tools = $toolList } $headers
  if ($second.output[0].type -ne 'function_call') { throw 'Second tool call missing' }
  $writeOutput = @{ type = 'function_call_output'; call_id = $second.output[0].call_id; output = 'write completed' }
  $final = SendJson '/v1/responses' @{ model = 'mock/mock-chat'; input = @($readOutput, $writeOutput); tools = $toolList } $headers
  if ($final.output[0].type -ne 'message' -or ($final.output | ConvertTo-Json -Depth 20) -notlike '*CLOUD-TOOL-731*') { throw 'Tool continuation failed' }
  Write-Output 'TOOL_CONTINUATION PASS'
  $wallet = Invoke-RestMethod -Uri "$BaseUrl/api/v1/me/wallet" -Headers $headers
  if ($wallet.unit -ne 'AI_POINT') { throw 'V2 wallet endpoint failed' }
  Write-Output 'V2_WALLET_READ PASS'
} finally {
  if (-not $reuseDevice -and $accessToken -and $registeredDeviceId) {
    try { Invoke-RestMethod -Uri "$BaseUrl/api/v1/devices/$registeredDeviceId" -Method Delete -Headers @{ Authorization = "Bearer $accessToken" } | Out-Null }
    catch { Write-Warning 'Smoke device could not be revoked; check it in Admin' }
  }
  $credential = $null
}
