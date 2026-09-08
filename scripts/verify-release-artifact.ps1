[CmdletBinding()]
param(
    [string]$InstallerPath,
    [string]$ManifestPath,
    [string]$ExpectedVersion,
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop
$workspaceRoot = Split-Path -Parent $PSScriptRoot

function Get-WorkspaceRelativePath([string]$Path) {
    $rootPrefix = ([System.IO.Path]::GetFullPath($workspaceRoot)).TrimEnd('\') + '\'
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if ($fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $fullPath.Substring($rootPrefix.Length).Replace('\', '/')
    }
    return $fullPath.Replace('\', '/')
}

function Read-RequiredText([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required file was not found: $Path"
    }
    return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8).Trim()
}

function Resolve-RequiredPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "A required path was empty."
    }
    return (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
}

if ([string]::IsNullOrWhiteSpace($ExpectedVersion)) {
    $package = Get-Content -LiteralPath (Join-Path $workspaceRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    $ExpectedVersion = [string]$package.version
}

if ([string]::IsNullOrWhiteSpace($InstallerPath)) {
    $InstallerPath = Join-Path $workspaceRoot "artifacts\updates\$ExpectedVersion\Minecraft.Server.Hub_${ExpectedVersion}_x64-setup.exe"
}

$installer = Resolve-RequiredPath $InstallerPath
$signature = Resolve-RequiredPath "$installer.sig"
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path (Split-Path -Parent $installer) "latest.json"
}
$manifestFile = Resolve-RequiredPath $ManifestPath

$manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
$platform = $manifest.platforms.'windows-x86_64'
$installerName = [System.IO.Path]::GetFileName($installer)
$manifestUrlName = [System.IO.Path]::GetFileName(([Uri]$platform.url).AbsolutePath)
$signatureText = Read-RequiredText $signature
$manifestSignature = [string]$platform.signature
$manifestVersion = [string]$manifest.version
$filenameVersion = if ($installerName -match '^Minecraft\.Server\.Hub_(?<version>\d+\.\d+\.\d+)_x64-setup\.exe$') { $Matches.version } else { "" }

$packageJson = Get-Content -LiteralPath (Join-Path $workspaceRoot "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$packageLockText = Get-Content -LiteralPath (Join-Path $workspaceRoot "package-lock.json") -Raw -Encoding UTF8
$packageLockVersion = if ($packageLockText -match '(?m)^\s*"version"\s*:\s*"([^"]+)"\s*,') { $Matches[1] } else { "" }
$packageLockRootVersion = if ($packageLockText -match '(?s)"packages"\s*:\s*\{\s*""\s*:\s*\{.*?"version"\s*:\s*"([^"]+)"') { $Matches[1] } else { "" }
$cargoToml = Get-Content -LiteralPath (Join-Path $workspaceRoot "src-tauri\Cargo.toml") -Raw -Encoding UTF8
$cargoVersion = if ($cargoToml -match '(?m)^version\s*=\s*"([^"]+)"$') { $Matches[1] } else { "" }
$tauriJson = Get-Content -LiteralPath (Join-Path $workspaceRoot "src-tauri\tauri.conf.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$versionSources = [ordered]@{
    package = [string]$packageJson.version
    packageLock = [string]$packageLockVersion
    packageLockRoot = [string]$packageLockRootVersion
    cargo = [string]$cargoVersion
    tauri = [string]$tauriJson.version
}

$publicKey = Read-RequiredText (Join-Path $workspaceRoot "src-tauri\updater-public.key")
$tauriConfig = Get-Content -LiteralPath (Join-Path $workspaceRoot "src-tauri\tauri.conf.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$configuredPublicKey = [string]$tauriConfig.plugins.updater.pubkey
$installerHash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToUpperInvariant()

if ($manifestVersion -ne $ExpectedVersion -or $filenameVersion -ne $ExpectedVersion) {
    throw "Artifact version mismatch: expected $ExpectedVersion, manifest $manifestVersion, filename $filenameVersion"
}
if ($manifestUrlName -ne $installerName) {
    throw "Manifest URL does not point to the selected installer: $manifestUrlName"
}
if ($signatureText -ne $manifestSignature) {
    throw "The adjacent .sig and manifest signature differ."
}
if ($versionSources.Values | Where-Object { $_ -ne $ExpectedVersion }) {
    throw "Source version files do not all match $ExpectedVersion."
}
if ($publicKey -ne $configuredPublicKey) {
    throw "Embedded updater public key and Tauri configuration public key differ."
}

$previousArtifact = $env:MSH_UPDATER_ARTIFACT
try {
    $env:MSH_UPDATER_ARTIFACT = $installer
    & cargo test --locked --manifest-path (Join-Path $workspaceRoot "src-tauri\Cargo.toml") --lib app_update::tests::verifies_a_built_updater_with_the_embedded_public_key -- --ignored
    if ($LASTEXITCODE -ne 0) {
        throw "The embedded public key rejected the selected artifact (cargo exit code $LASTEXITCODE)."
    }
}
finally {
    if ($null -eq $previousArtifact) {
        Remove-Item Env:MSH_UPDATER_ARTIFACT -ErrorAction SilentlyContinue
    }
    else {
        $env:MSH_UPDATER_ARTIFACT = $previousArtifact
    }
}

$report = [ordered]@{
    schemaVersion = 1
    verifiedAt = (Get-Date).ToUniversalTime().ToString("o")
    expectedVersion = $ExpectedVersion
    installerPath = Get-WorkspaceRelativePath $installer
    signaturePath = Get-WorkspaceRelativePath $signature
    manifestPath = Get-WorkspaceRelativePath $manifestFile
    installerSizeBytes = (Get-Item -LiteralPath $installer).Length
    installerSha256 = $installerHash
    signatureVerified = $true
    authenticodeStatus = "not-checked (Tauri minisign is the release signature)"
    sourceVersions = $versionSources
    manifest = [ordered]@{
        version = $manifestVersion
        url = [string]$platform.url
        signatureMatchesAdjacentFile = $true
    }
    publicKeyMatchesConfiguration = $true
}

$json = $report | ConvertTo-Json -Depth 8
if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
    $resolvedOutput = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
    $outputDirectory = Split-Path -Parent $resolvedOutput
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
    Set-Content -LiteralPath $resolvedOutput -Value $json -Encoding UTF8
    Write-Output "Release artifact verification report: $resolvedOutput"
}
else {
    Write-Output $json
}
