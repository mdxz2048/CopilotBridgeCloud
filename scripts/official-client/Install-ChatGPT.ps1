$ErrorActionPreference = 'Stop'
$packagePath = Join-Path $PSScriptRoot 'ChatGPT-x64.msix'
$licensePath = Join-Path $PSScriptRoot 'ChatGPT-License.xml'
if (-not (Test-Path -LiteralPath $packagePath) -or -not (Test-Path -LiteralPath $licensePath)) { throw 'Extract the entire ZIP before installing.' }
# Provision the original signed package and its offline license, as documented by OpenAI.
$taskElevated = @'
$ErrorActionPreference = 'Stop'
try {
  Add-AppxProvisionedPackage -Online -PackagePath '__PACKAGE__' -LicensePath '__LICENSE__' -Regions all | Out-Null
  exit 0
} catch { Write-Error $_; exit 1 }
'@
$taskElevated = $taskElevated.Replace('__PACKAGE__', $packagePath.Replace("'", "''")).Replace('__LICENSE__', $licensePath.Replace("'", "''"))
$taskEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($taskElevated))
$taskProcess = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand',$taskEncoded -Wait -PassThru -WindowStyle Hidden
if ($taskProcess.ExitCode -ne 0) { throw 'Offline package provisioning failed. Check administrator rights and Windows package installation policy.' }
# Register for the requesting user now, without requiring Windows to restart.
Add-AppxPackage -Path $packagePath -ErrorAction Stop
$taskPackage = Get-AppxPackage -Name 'OpenAI.Codex' | Select-Object -First 1
if (-not $taskPackage) { throw 'Package provisioned, but registration failed for this user.' }
Write-Host ('ChatGPT installed: ' + $taskPackage.Version)
