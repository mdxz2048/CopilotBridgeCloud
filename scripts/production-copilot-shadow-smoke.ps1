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
$headers = @{ Authorization = "Bearer $($login.accessToken)"; 'X-Device-Id' = $deviceId }
$models = Invoke-RestMethod -Uri "$BaseUrl/v1/models" -Headers $headers
if (@($models.data | Where-Object id -EQ 'copilot/gpt-5.4-mini').Count -ne 1) { throw 'Verified Copilot model missing from catalog' }
$providers = Invoke-RestMethod -Uri "$BaseUrl/api/v1/providers" -Headers $headers
if (@($providers.data | Where-Object code -EQ 'COPILOT').Count -ne 1) { throw 'Copilot provider missing from catalog' }
$before = Invoke-RestMethod -Uri "$BaseUrl/api/v1/me/wallet" -Headers $headers

function Test-Settlement([object]$response) {
  if ($response.id -notmatch '^resp_[0-9a-f]{32}$' -or $response.usage.billing_mode -ne 'SHADOW' -or
      [int]$response.usage.points_rated -le 0 -or [int]$response.usage.points_charged -ne 0 -or
      -not $response.usage.request_id) { throw 'Invalid Copilot response or Shadow billing metadata' }
  $lookup = Invoke-RestMethod -Uri "$BaseUrl/api/v1/usage/responses/$($response.id)" -Headers $headers
  if ($lookup.request.id -ne $response.usage.request_id -or $lookup.request.status -ne 'COMPLETED' -or
      $lookup.usage.billingStatus -ne 'SHADOW' -or [int]$lookup.usage.pointsRated -ne [int]$response.usage.points_rated -or
      [int]$lookup.usage.pointsCharged -ne 0 -or -not $lookup.usage.rateCardVersionId -or
      [int]$lookup.usage.inputTokens -le 0 -or [int]$lookup.usage.outputTokens -le 0) {
    throw 'Copilot usage, rating or settlement lookup failed'
  }
  return $lookup
}

$jsonHeaders = $headers.Clone()
$jsonHeaders['X-Client-Thread-Id'] = [guid]::NewGuid().ToString()
$json = Invoke-RestMethod -Uri "$BaseUrl/v1/responses" -Method Post -ContentType 'application/json' -Headers $jsonHeaders -Body (@{
  model = 'copilot/gpt-5.4-mini'; input = 'Reply with exactly REAL_COPILOT_JSON_OK and nothing else.'
} | ConvertTo-Json -Compress)
if ([string]::IsNullOrWhiteSpace([string]$json.output[0].content[0].text)) { throw 'Copilot JSON response empty' }
$jsonSettlement = Test-Settlement $json

$client = [Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds(120)
$request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, "$BaseUrl/v1/responses")
$request.Headers.TryAddWithoutValidation('Authorization', $headers.Authorization) | Out-Null
$request.Headers.TryAddWithoutValidation('X-Device-Id', $deviceId) | Out-Null
$request.Headers.TryAddWithoutValidation('X-Client-Thread-Id', [guid]::NewGuid().ToString()) | Out-Null
$request.Content = [Net.Http.StringContent]::new((@{ model = 'copilot/gpt-5.4-mini'; stream = $true
  input = 'Reply with exactly REAL_COPILOT_SSE_OK and nothing else.' } | ConvertTo-Json -Compress), [Text.Encoding]::UTF8, 'application/json')
$eventType = ''
$deltas = [Collections.Generic.List[string]]::new()
$sseCompleted = $null
$done = $false
try {
  $http = $client.SendAsync($request, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
  if (-not $http.IsSuccessStatusCode) { throw "Copilot SSE returned HTTP $([int]$http.StatusCode)" }
  $reader = [IO.StreamReader]::new($http.Content.ReadAsStream())
  while (-not $reader.EndOfStream) {
    $line = $reader.ReadLine()
    if ($line.StartsWith('event: ')) { $eventType = $line.Substring(7); continue }
    if (-not $line.StartsWith('data: ')) { continue }
    $data = $line.Substring(6)
    if ($data -eq '[DONE]') { $done = $true; break }
    $payload = $data | ConvertFrom-Json
    if ($eventType -eq 'response.output_text.delta') {
      if ($sseCompleted) { throw 'Text delta arrived after completion' }
      $deltas.Add([string]$payload.delta)
    }
    if ($eventType -eq 'response.completed') { $sseCompleted = $payload.response }
  }
} finally { $request.Dispose(); $client.Dispose() }
if (-not $done -or -not $sseCompleted -or $deltas.Count -lt 1 -or
    [string]::IsNullOrWhiteSpace(($deltas -join ''))) { throw 'Copilot SSE frames incomplete' }
$sseSettlement = Test-Settlement $sseCompleted
$after = Invoke-RestMethod -Uri "$BaseUrl/api/v1/me/wallet" -Headers $headers
if ([int]$before.balance -ne [int]$after.balance) { throw 'Shadow billing changed wallet balance' }
[pscustomobject]@{
  RealJson = 'PASS'; RealSse = 'PASS'; DeltaCount = $deltas.Count
  JsonResponseId = $json.id; SseResponseId = $sseCompleted.id
  JsonInputTokens = [int]$jsonSettlement.usage.inputTokens; JsonOutputTokens = [int]$jsonSettlement.usage.outputTokens
  SseInputTokens = [int]$sseSettlement.usage.inputTokens; SseOutputTokens = [int]$sseSettlement.usage.outputTokens
  JsonPointsRated = [int]$jsonSettlement.usage.pointsRated; SsePointsRated = [int]$sseSettlement.usage.pointsRated
  PointsCharged = 0; WalletBefore = [int]$before.balance; WalletAfter = [int]$after.balance; BillingMode = 'SHADOW'
}
