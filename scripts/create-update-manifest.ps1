param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$')]
    [string]$Version,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^https://')]
    [string]$DownloadUrl,

    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,

    [string]$Notes = "",
    [string]$OutputPath = "latest.json"
)

$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath -ErrorAction Stop).Path
$signaturePath = "$resolvedInstaller.sig"
if (-not (Test-Path -LiteralPath $signaturePath -PathType Leaf)) {
    throw "Updater signature was not found: $signaturePath"
}

$downloadUri = $null
if (-not [Uri]::TryCreate($DownloadUrl, [UriKind]::Absolute, [ref]$downloadUri) -or
    $downloadUri.Scheme -ne "https" -or
    [string]::IsNullOrWhiteSpace($downloadUri.Host) -or
    -not [string]::IsNullOrWhiteSpace($downloadUri.UserInfo) -or
    -not [string]::IsNullOrWhiteSpace($downloadUri.Query) -or
    -not [string]::IsNullOrWhiteSpace($downloadUri.Fragment)) {
    throw "DownloadUrl must be an authentication-free absolute HTTPS URL without a query or fragment."
}

$installerName = [System.IO.Path]::GetFileName($resolvedInstaller)
$urlInstallerName = [System.IO.Path]::GetFileName($downloadUri.AbsolutePath)
if ([string]::IsNullOrWhiteSpace($urlInstallerName) -or $urlInstallerName -ne $installerName) {
    throw "DownloadUrl must point to the selected installer filename: $installerName"
}

$signature = (Get-Content -LiteralPath $signaturePath -Raw -ErrorAction Stop).Trim()
if ([string]::IsNullOrWhiteSpace($signature)) {
    throw "Updater signature is empty: $signaturePath"
}

$manifest = [ordered]@{
    version = $Version
    notes = $Notes
    pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $signature
            url = $DownloadUrl
        }
    }
}

$outputDirectory = Split-Path -Parent $OutputPath
if ($outputDirectory -and -not (Test-Path -LiteralPath $outputDirectory)) {
    New-Item -ItemType Directory -Path $outputDirectory | Out-Null
}
$manifestJson = $manifest | ConvertTo-Json -Depth 5
$resolvedOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
[System.IO.File]::WriteAllText($resolvedOutputPath, $manifestJson, [System.Text.UTF8Encoding]::new($false))
Write-Output "Created signed update manifest: $OutputPath"
