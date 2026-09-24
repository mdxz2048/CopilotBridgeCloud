param(
  [ValidateSet('Inspect', 'Probe', 'Import')][string]$Mode = 'Inspect',
  [string]$CredentialTarget = 'https://github.com:lzpzzqc.copilot-cli',
  [string]$Server = 'linuxuser@66.245.221.236'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not ('BridgeCredentialNative' -as [type])) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct BridgeCredential {
  public uint Flags, Type;
  public IntPtr TargetName, Comment;
  public uint LastWrittenLow, LastWrittenHigh;
  public uint CredentialBlobSize;
  public IntPtr CredentialBlob;
  public uint Persist, AttributeCount;
  public IntPtr Attributes, TargetAlias, UserName;
}
public static class BridgeCredentialNative {
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll", EntryPoint="CredFree")]
  public static extern void CredFree(IntPtr credential);
}
'@
}
$pointer = [IntPtr]::Zero
if (-not [BridgeCredentialNative]::CredRead($CredentialTarget, 1, 0, [ref]$pointer)) {
  throw "Copilot credential not found in Windows Credential Manager (error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))"
}
try {
  $entry = [Runtime.InteropServices.Marshal]::PtrToStructure[BridgeCredential]($pointer)
  $bytes = New-Object byte[] $entry.CredentialBlobSize
  [Runtime.InteropServices.Marshal]::Copy($entry.CredentialBlob, $bytes, 0, $bytes.Length)
  $token = [Text.Encoding]::UTF8.GetString($bytes).Trim([char]0).Trim()
  if ($token -notmatch '^(gho_|ghu_|github_pat_)') {
    $alternate = [Text.Encoding]::Unicode.GetString($bytes).Trim([char]0).Trim()
    if ($alternate -match '^(gho_|ghu_|github_pat_)') { $token = $alternate }
    elseif ($token.StartsWith('{') -or $alternate.StartsWith('{')) {
      $payload = if ($token.StartsWith('{')) { $token } else { $alternate }
      $parsed = $payload | ConvertFrom-Json
      $keys = @($parsed.PSObject.Properties.Name) -join ','
      throw "Stored credential is a structured payload with keys: $keys; importer requires a token field"
    } else { throw "Stored credential format is unsupported (byte count $($bytes.Length))" }
  }
  $kind = if ($token.StartsWith('gho_')) { 'OAuth' } elseif ($token.StartsWith('ghu_')) { 'GitHubAppUser' } else { 'FineGrainedPAT' }
  if ($Mode -eq 'Inspect') { Write-Output "Credential found in Windows Credential Manager; kind=$kind"; return }

  $psi = [Diagnostics.ProcessStartInfo]::new()
  $psi.UseShellExecute = $false
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  if ($Mode -eq 'Probe') {
    $psi.FileName = 'cmd.exe'
    $psi.WorkingDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
    foreach ($arg in @('/d', '/c', 'pnpm --filter @bridge/api exec tsx src/cli/probe-copilot.ts --token-stdin')) { [void]$psi.ArgumentList.Add($arg) }
  } else {
    $psi.FileName = 'ssh.exe'
    foreach ($arg in @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', $Server,
      'cd /home/linuxuser/copilot-bridge-cloud/src && sudo -n docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.shared-host.yml exec -T api node /workspace/apps/api/dist/cli/import-copilot-credential.js')) {
      [void]$psi.ArgumentList.Add($arg)
    }
  }
  $process = [Diagnostics.Process]::Start($psi)
  try {
    $process.StandardInput.WriteLine($token)
    $process.StandardInput.Close()
    $output = $process.StandardOutput.ReadToEnd()
    $errors = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "Copilot $Mode failed: $errors" }
    Write-Output $output.Trim()
  } finally { $process.Dispose() }
} finally {
  [BridgeCredentialNative]::CredFree($pointer)
  if ($bytes) { [Array]::Clear($bytes, 0, $bytes.Length) }
  $token = $null
}
