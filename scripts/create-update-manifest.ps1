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
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Output "Created signed update manifest: $OutputPath"
