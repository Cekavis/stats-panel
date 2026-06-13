param(
  [string]$Configuration = "Release",
  [string]$DotnetChannel = "8.0"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$helperProject = Join-Path $repoRoot "sensor-helper\stats-sensor-helper.csproj"
$dotnetDir = Join-Path $repoRoot ".dotnet"
$binariesDir = Join-Path $repoRoot "src-tauri\binaries"
$publishDir = Join-Path $binariesDir "publish"
$sidecarPath = Join-Path $binariesDir "stats-sensor-helper-x86_64-pc-windows-msvc.exe"

function Get-DotnetWithSdk {
  $systemDotnet = Get-Command dotnet -ErrorAction SilentlyContinue
  if ($systemDotnet) {
    $sdks = & $systemDotnet.Source --list-sdks
    if ($LASTEXITCODE -eq 0 -and $sdks) {
      return $systemDotnet.Source
    }
  }

  $localDotnet = Join-Path $dotnetDir "dotnet.exe"
  if (-not (Test-Path $localDotnet)) {
    New-Item -ItemType Directory -Force -Path $dotnetDir | Out-Null
    $installer = Join-Path $env:TEMP "dotnet-install.ps1"
    Invoke-WebRequest "https://dot.net/v1/dotnet-install.ps1" -OutFile $installer
    $installOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $installer -Channel $DotnetChannel -InstallDir $dotnetDir -NoPath
    $installOutput | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
      exit $LASTEXITCODE
    }
  }

  return $localDotnet
}

$dotnet = Get-DotnetWithSdk
New-Item -ItemType Directory -Force -Path $binariesDir | Out-Null

& $dotnet restore $helperProject
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

& $dotnet publish $helperProject `
  --configuration $Configuration `
  --runtime win-x64 `
  --self-contained true `
  --output $publishDir `
  -p:PublishSingleFile=true `
  -p:EnableCompressionInSingleFile=true `
  -p:IncludeNativeLibrariesForSelfExtract=true `
  -p:PublishTrimmed=false `
  -p:DebugType=None `
  -p:DebugSymbols=false
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Copy-Item -Force (Join-Path $publishDir "stats-sensor-helper.exe") $sidecarPath
Write-Host "Built sensor helper sidecar: $sidecarPath"
