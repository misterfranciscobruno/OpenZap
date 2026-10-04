$ErrorActionPreference = 'Continue'
$f = 'C:\Users\Administrator\.cursor\projects\c-Users-Administrator-Desktop-OpenZap\terminals\256541.txt'
Write-Host 'Aguardando eventos de chamada WebRTC...'
$last = 0
while ($true) {
  Start-Sleep -Seconds 2
  if (-not (Test-Path $f)) { continue }
  $lines = @(Get-Content -LiteralPath $f -ErrorAction SilentlyContinue)
  if ($lines.Count -le $last) { continue }
  $new = $lines[$last..($lines.Count - 1)]
  $last = $lines.Count
  foreach ($line in $new) {
    if ($line -match '\[webrtc\]') {
      Write-Host $line
    }
  }
}
