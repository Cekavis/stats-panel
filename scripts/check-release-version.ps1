param(
  [string]$Tag
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

function Read-RegexVersion {
  param(
    [string]$Path,
    [string]$Pattern,
    [string]$Label
  )

  $content = Get-Content -LiteralPath $Path -Raw
  $match = [regex]::Match($content, $Pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)
  if (-not $match.Success) {
    throw "Could not read version from $Label."
  }

  $match.Groups[1].Value
}

$packageJsonPath = Join-Path $repoRoot "package.json"
$packageLockPath = Join-Path $repoRoot "package-lock.json"
$tauriConfigPath = Join-Path $repoRoot "src-tauri\tauri.conf.json"
$cargoTomlPath = Join-Path $repoRoot "src-tauri\Cargo.toml"
$cargoLockPath = Join-Path $repoRoot "src-tauri\Cargo.lock"

$versions = [ordered]@{
  "package.json" = Read-RegexVersion $packageJsonPath '^\s*"version"\s*:\s*"([^"]+)"' "package.json"
  "package-lock.json" = Read-RegexVersion $packageLockPath '^\s*"version"\s*:\s*"([^"]+)"' "package-lock.json"
  "package-lock.json root package" = Read-RegexVersion $packageLockPath '(?s)"packages"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*"stats-panel"\s*,\s*"version"\s*:\s*"([^"]+)"' "package-lock.json root package"
  "src-tauri/tauri.conf.json" = Read-RegexVersion $tauriConfigPath '^\s*"version"\s*:\s*"([^"]+)"' "src-tauri/tauri.conf.json"
  "src-tauri/Cargo.toml" = Read-RegexVersion $cargoTomlPath '^version\s*=\s*"([^"]+)"' "src-tauri/Cargo.toml"
  "src-tauri/Cargo.lock" = Read-RegexVersion $cargoLockPath '(?s)\[\[package\]\]\s+name\s*=\s*"stats-panel"\s+version\s*=\s*"([^"]+)"' "src-tauri/Cargo.lock"
}

$expected = $versions["package.json"]
foreach ($entry in $versions.GetEnumerator()) {
  if ($entry.Value -ne $expected) {
    throw "Version mismatch: $($entry.Key) is $($entry.Value), expected $expected."
  }
}

if ($Tag) {
  $normalizedTag = $Tag.Trim()
  if ($normalizedTag.StartsWith("refs/tags/")) {
    $normalizedTag = $normalizedTag.Substring("refs/tags/".Length)
  }
  if ($normalizedTag.StartsWith("v")) {
    $normalizedTag = $normalizedTag.Substring(1)
  }
  if ($normalizedTag -ne $expected) {
    throw "Release tag $Tag does not match project version $expected."
  }
}

Write-Host "Release version check passed: $expected"
