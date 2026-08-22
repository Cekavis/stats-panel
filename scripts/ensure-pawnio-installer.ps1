param(
  [string]$Version = "2.2.0"
)

$ErrorActionPreference = "Stop"

$knownSha256 = @{
  "2.2.0" = "1F519A22E47187F70A1379A48CA604981C4FCF694F4E65B734AAA74A9FBA3032"
}

if (-not $knownSha256.ContainsKey($Version)) {
  throw "PawnIO version $Version is not pinned. Add its SHA-256 before bundling it."
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$binariesDir = Join-Path $repoRoot "src-tauri\binaries"
$installerPath = Join-Path $binariesDir "PawnIO_setup.exe"
$downloadPath = "$installerPath.download"
$downloadUrl = "https://github.com/namazso/PawnIO.Setup/releases/download/$Version/PawnIO_setup.exe"
$expectedSha256 = $knownSha256[$Version]

function Test-PawnIoInstaller {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $false
  }

  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
      $actualSha256 = ([System.BitConverter]::ToString($sha256.ComputeHash($stream)) -replace "-", "").ToUpperInvariant()
    } finally {
      $stream.Dispose()
    }
  } finally {
    $sha256.Dispose()
  }
  if ($actualSha256 -ne $expectedSha256) {
    Write-Warning "Ignoring PawnIO payload with unexpected SHA-256: $actualSha256"
    return $false
  }

  # Windows PowerShell's Authenticode cmdlet is not present in every build
  # environment. The pinned hash is the primary integrity check; this fallback
  # still requires an embedded Authenticode certificate from the expected signer.
  try {
    $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate]::CreateFromSignedFile($Path)
    if ($certificate.Subject -notmatch "namazso") {
      Write-Warning "Ignoring PawnIO payload signed by an unexpected certificate: $($certificate.Subject)"
      return $false
    }
  } catch {
    Write-Warning "Ignoring PawnIO payload without a usable Authenticode certificate."
    return $false
  }

  return $true
}

New-Item -ItemType Directory -Force -Path $binariesDir | Out-Null

if (Test-PawnIoInstaller $installerPath) {
  Write-Host "PawnIO installer already cached: $installerPath"
  exit 0
}

Remove-Item -LiteralPath $installerPath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $downloadPath -Force -ErrorAction SilentlyContinue
Write-Host "Downloading PawnIO installer $Version..."
Invoke-WebRequest $downloadUrl -OutFile $downloadPath
if (-not (Test-PawnIoInstaller $downloadPath)) {
  Remove-Item -LiteralPath $downloadPath -Force -ErrorAction SilentlyContinue
  throw "Downloaded PawnIO payload failed SHA-256 or Authenticode verification."
}

Move-Item -LiteralPath $downloadPath -Destination $installerPath -Force
Write-Host "Cached PawnIO installer: $installerPath"
