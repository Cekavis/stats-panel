param(
  [string]$Version = "2.2.0"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$binariesDir = Join-Path $repoRoot "src-tauri\binaries"
$installerPath = Join-Path $binariesDir "PawnIO_setup.exe"
$downloadUrl = "https://github.com/namazso/PawnIO.Setup/releases/download/$Version/PawnIO_setup.exe"

New-Item -ItemType Directory -Force -Path $binariesDir | Out-Null

if (Test-Path $installerPath) {
  Write-Host "PawnIO installer already cached: $installerPath"
  exit 0
}

Write-Host "Downloading PawnIO installer $Version..."
Invoke-WebRequest $downloadUrl -OutFile $installerPath
Write-Host "Cached PawnIO installer: $installerPath"
