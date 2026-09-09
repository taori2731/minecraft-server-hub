[CmdletBinding()]
param(
    [Parameter(ParameterSetName = "Build", Mandatory = $true)]
    [string]$SigningKeyPath,

    [Parameter(ParameterSetName = "Verify", Mandatory = $true)]
    [string]$InstallerPath,

    [Parameter(ParameterSetName = "Build")]
    [string]$TargetDir,
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
$workspaceRoot = Split-Path -Parent $PSScriptRoot

function Get-WorkspaceRelativePath([string]$Path) {
    $rootPrefix = ([System.IO.Path]::GetFullPath($workspaceRoot)).TrimEnd('\') + '\'
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    if ($fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $fullPath.Substring($rootPrefix.Length).Replace('\', '/')
    }
    return $fullPath.Replace('\', '/')
}

function Set-ProcessEnvironmentValue([string]$Name, [AllowNull()][string]$Value) {
    [Environment]::SetEnvironmentVariable($Name, $Value, [EnvironmentVariableTarget]::Process)
}

$packagePath = Join-Path $workspaceRoot "package.json"
$tauriConfigPath = Join-Path $workspaceRoot "src-tauri\tauri.conf.json"
$package = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 | ConvertFrom-Json
$tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$version = [string]$package.version
$productName = [string]$tauriConfig.productName
if ([string]::IsNullOrWhiteSpace($version) -or [string]::IsNullOrWhiteSpace($productName)) {
    throw "package.json version and tauri productName are required."
}

$isBuild = $PSCmdlet.ParameterSetName -eq "Build"
$signingKey = $null
$target = $null
$key = $null
if ($isBuild) {
    $key = (Resolve-Path -LiteralPath $SigningKeyPath -ErrorAction Stop).Path
    if (-not (Test-Path -LiteralPath $key -PathType Leaf)) {
        throw "Signing key must be a file: $key"
    }
    $rootPrefix = ([System.IO.Path]::GetFullPath($workspaceRoot)).TrimEnd('\') + '\'
    if ($key.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to read a signing key from inside the workspace. Keep it outside source control."
    }
    $signingKey = Get-Content -LiteralPath $key -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($signingKey)) {
        throw "Signing key is empty: $key"
    }

    if ([string]::IsNullOrWhiteSpace($TargetDir)) {
        $stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd-HHmmss-fff")
        $TargetDir = Join-Path ([System.IO.Path]::GetTempPath()) "msh-tauri-signed-$stamp"
    }
    $target = [System.IO.Path]::GetFullPath($TargetDir)
    if (Test-Path -LiteralPath $target) {
        if ((Get-ChildItem -LiteralPath $target -Force | Select-Object -First 1) -ne $null) {
            throw "TargetDir must be new or empty; refusing to overwrite existing files: $target"
        }
    }
    else {
        New-Item -ItemType Directory -Force -Path $target | Out-Null
    }
}
else {
    $InstallerPath = (Resolve-Path -LiteralPath $InstallerPath -ErrorAction Stop).Path
    if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
        throw "Installer must be a file: $InstallerPath"
    }
}

$environmentNames = @(
    "CARGO_TARGET_DIR",
    "TAURI_SIGNING_PRIVATE_KEY",
    "MSH_UPDATER_ARTIFACT",
    "MSH_AUTHENTICODE_TARGET"
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, [EnvironmentVariableTarget]::Process)
}
$locationPushed = $false

try {
    if ($isBuild) {
        Set-ProcessEnvironmentValue "CARGO_TARGET_DIR" $target
        Set-ProcessEnvironmentValue "TAURI_SIGNING_PRIVATE_KEY" $signingKey
    }
    Push-Location $workspaceRoot
    $locationPushed = $true

    if ($isBuild) {
        Write-Output "Building signed Tauri NSIS package for version $version..."
        & npm run tauri -- build --bundles nsis --ci
        if ($LASTEXITCODE -ne 0) {
            throw "Tauri build failed with exit code $LASTEXITCODE."
        }
        $installer = Join-Path $target ("release\bundle\nsis\{0}_{1}_x64-setup.exe" -f $productName, $version)
    }
    else {
        $installer = $InstallerPath
        Write-Output "Verifying existing signed Tauri NSIS package for version $version..."
    }
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
        throw "Tauri did not produce the expected NSIS installer: $installer"
    }
    $signaturePath = "$installer.sig"
    if (-not (Test-Path -LiteralPath $signaturePath -PathType Leaf)) {
        throw "Tauri did not produce the adjacent updater signature: $signaturePath"
    }
    $signatureText = (Get-Content -LiteralPath $signaturePath -Raw -Encoding UTF8).Trim()
    if ([string]::IsNullOrWhiteSpace($signatureText)) {
        throw "The generated updater signature is empty: $signaturePath"
    }

    Write-Output "Verifying the generated updater artifact with the embedded public key..."
    Set-ProcessEnvironmentValue "MSH_UPDATER_ARTIFACT" $installer
    & cargo test --locked --manifest-path (Join-Path $workspaceRoot "src-tauri\Cargo.toml") --lib app_update::tests::verifies_a_built_updater_with_the_embedded_public_key -- --ignored
    if ($LASTEXITCODE -ne 0) {
        throw "The embedded public key rejected the generated updater artifact (cargo exit code $LASTEXITCODE)."
    }

    $authenticodeStatus = "NotChecked"
    $authenticodeSubject = ""
    $authenticodeError = ""
    try {
        Set-ProcessEnvironmentValue "MSH_AUTHENTICODE_TARGET" $installer
        $authenticodeCommand = '$env:PSModulePath=(Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\Modules"); $target=[Environment]::GetEnvironmentVariable("MSH_AUTHENTICODE_TARGET","Process"); $signature=Get-AuthenticodeSignature -LiteralPath $target; [pscustomobject]@{status=[string]$signature.Status;subject=if($signature.SignerCertificate){[string]$signature.SignerCertificate.Subject}else{""}} | ConvertTo-Json -Compress'
        $authenticodeEncodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($authenticodeCommand))
        $authenticodeOutput = & powershell -NoProfile -EncodedCommand $authenticodeEncodedCommand 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Authenticode subprocess failed with exit code $LASTEXITCODE."
        }
        $authenticode = ($authenticodeOutput -join "`n") | ConvertFrom-Json
        $authenticodeStatus = [string]$authenticode.status
        $authenticodeSubject = [string]$authenticode.subject
        if ([string]::IsNullOrWhiteSpace($authenticodeStatus)) {
            throw "Authenticode subprocess returned no status."
        }
    }
    catch {
        $authenticodeError = $_.Exception.Message
        Write-Warning "Authenticode status could not be inspected; Tauri updater verification already passed."
    }
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $installerHash = ([System.BitConverter]::ToString($sha256.ComputeHash([System.IO.File]::ReadAllBytes($installer)))).Replace("-", "")
    }
    finally {
        $sha256.Dispose()
    }
    $report = [ordered]@{
        schemaVersion = 1
        verifiedAt = (Get-Date).ToUniversalTime().ToString("o")
        version = $version
        installerPath = Get-WorkspaceRelativePath $installer
        signaturePath = Get-WorkspaceRelativePath $signaturePath
        targetDir = if ($target) { Get-WorkspaceRelativePath $target } else { "" }
        verificationMode = if ($isBuild) { "build-and-verify" } else { "verify-existing" }
        installerSizeBytes = (Get-Item -LiteralPath $installer).Length
        installerSha256 = $installerHash.ToUpperInvariant()
        signatureBytes = (Get-Item -LiteralPath $signaturePath).Length
        updaterSignatureVerified = $true
        authenticodeStatus = $authenticodeStatus
        authenticodeSubject = $authenticodeSubject
        authenticodeError = $authenticodeError
    }
    $json = $report | ConvertTo-Json -Depth 5
    if (-not [string]::IsNullOrWhiteSpace($OutputPath)) {
        $outputCandidate = if ([System.IO.Path]::IsPathRooted($OutputPath)) {
            $OutputPath
        }
        else {
            Join-Path (Get-Location).Path $OutputPath
        }
        $resolvedOutput = [System.IO.Path]::GetFullPath($outputCandidate)
        $outputDirectory = Split-Path -Parent $resolvedOutput
        New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
        Set-Content -LiteralPath $resolvedOutput -Value $json -Encoding UTF8
        Write-Output "Signed package verification report: $resolvedOutput"
    }
    Write-Output $json
}
finally {
    if ($locationPushed) {
        Pop-Location
    }
    foreach ($name in $environmentNames) {
        Set-ProcessEnvironmentValue $name $previousEnvironment[$name]
    }
    $signingKey = $null
}
