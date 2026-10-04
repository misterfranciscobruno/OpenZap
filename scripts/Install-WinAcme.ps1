# Descarrega win-acme (cliente ACME para Windows) para tools/win-acme.
# Depois execute wacs.exe como administrador e escolha validacao HTTP-01 (porta 80)
# ou DNS; exporte PEM ou aponte o IIS/store para SSL_KEY_PATH / SSL_CERT_PATH.
$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $repoRoot "tools\win-acme"
$zipUrl = "https://github.com/win-acme/win-acme/releases/download/v2.2.9.1701/win-acme.v2.2.9.1701.x64.pluggable.zip"
$zipFile = Join-Path $env:TEMP "win-acme-openzap.zip"

Write-Host "A descarregar win-acme..."
Invoke-WebRequest -Uri $zipUrl -OutFile $zipFile -UseBasicParsing
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Expand-Archive -Path $zipFile -DestinationPath $dest -Force
Remove-Item $zipFile -Force
Write-Host "Instalado em: $dest"
Write-Host "Execute como admin: $dest\wacs.exe"
