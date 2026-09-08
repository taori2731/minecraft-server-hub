use std::{
    collections::HashSet,
    ffi::OsStr,
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    process::Command,
    sync::LazyLock,
    time::Duration,
};

use futures_util::StreamExt;
use regex::Regex;
use reqwest::{Client, Url, header};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zip::ZipArchive;

use crate::error::{AppError, AppResult};

/// This is the first-party endpoint used by minecraft.net's Bedrock server
/// download page. The returned artifact URL is still validated independently.
pub const BEDROCK_DOWNLOAD_LINKS_API: &str =
    "https://net-secondary.web.minecraft-services.net/api/v1.0/download/links";
pub const BEDROCK_DOWNLOAD_PAGE: &str = "https://www.minecraft.net/en-us/download/server/bedrock";

const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 20_000;
const METADATA_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const DOWNLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BedrockDownloadPlan {
    pub version: String,
    pub download_url: String,
    pub source_page: String,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BedrockInstallInfo {
    pub version: Option<String>,
    pub archive_sha256: String,
    pub executable_path: String,
    pub extracted_files: u32,
    pub extracted_size_bytes: u64,
    pub signature_subject: String,
}

/// Holds a read-only Windows handle that denies concurrent writes and deletes
/// while the verified executable is handed to CreateProcess. Dropping this
/// value releases the lock.
#[derive(Debug)]
pub(crate) struct VerifiedBedrockExecutable {
    path: PathBuf,
    sha256: String,
    signature_subject: String,
    _lock: File,
}

impl VerifiedBedrockExecutable {
    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn sha256(&self) -> &str {
        &self.sha256
    }

    pub(crate) fn signature_subject(&self) -> &str {
        &self.signature_subject
    }
}

#[derive(Debug, Deserialize)]
struct DownloadLinksResponse {
    result: DownloadLinksResult,
}

#[derive(Debug, Deserialize)]
struct DownloadLinksResult {
    links: Vec<DownloadLink>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadLink {
    download_type: String,
    download_url: String,
}

#[derive(Debug, Deserialize)]
struct SignatureResult {
    status: String,
    subject: String,
}

#[derive(Debug)]
struct ExtractedArchive {
    file_count: u32,
    size_bytes: u64,
}

/// Fetches the current stable Windows BDS artifact from the same first-party
/// endpoint used by the official minecraft.net download page.
pub async fn fetch_download_plan(client: &Client) -> AppResult<BedrockDownloadPlan> {
    let response = client
        .get(BEDROCK_DOWNLOAD_LINKS_API)
        .timeout(METADATA_TIMEOUT)
        .send()
        .await?
        .error_for_status()?;
    if response.url().as_str() != BEDROCK_DOWNLOAD_LINKS_API {
        return Err(AppError::Other(
            "Minecraft公式BDS配布情報が別の接続先へ転送されたため拒否しました".into(),
        ));
    }
    let response: DownloadLinksResponse = response.json().await?;
    let link = response
        .result
        .links
        .into_iter()
        .find(|link| link.download_type == "serverBedrockWindows")
        .ok_or_else(|| AppError::Other("Minecraft公式配布情報にWindows版BDSがありません".into()))?;
    let url = validate_official_download_url(&link.download_url)?;
    let version = version_from_download_url(&url).ok_or_else(|| {
        AppError::Other("Minecraft公式BDSのバージョンをURLから確認できません".into())
    })?;

    // A failed HEAD request must not silently switch providers. It only means
    // the size is unknown; the streaming hard limit still protects the download.
    let size_bytes = match client
        .head(url.clone())
        .timeout(METADATA_TIMEOUT)
        .send()
        .await
    {
        Ok(response)
            if response.status().is_success()
                && validate_official_download_url(response.url().as_str()).is_ok() =>
        {
            response.content_length()
        }
        _ => None,
    };
    if size_bytes.is_some_and(|size| size > MAX_ARCHIVE_BYTES) {
        return Err(AppError::Other(
            "Minecraft公式BDS ZIPが安全上限（512 MiB）を超えています".into(),
        ));
    }

    Ok(BedrockDownloadPlan {
        version,
        download_url: url.to_string(),
        source_page: BEDROCK_DOWNLOAD_PAGE.into(),
        size_bytes,
    })
}

/// Downloads the official package to a private temporary file, then validates
/// and atomically installs it into an empty server directory.
pub async fn download_and_install(
    client: &Client,
    plan: &BedrockDownloadPlan,
    root: &Path,
) -> AppResult<BedrockInstallInfo> {
    let requested_url = validate_official_download_url(&plan.download_url)?;
    let expected_version = version_from_download_url(&requested_url).ok_or_else(|| {
        AppError::Validation("BDSダウンロードURLに有効なバージョンがありません".into())
    })?;
    if expected_version != plan.version {
        return Err(AppError::Validation(
            "BDSダウンロード計画のバージョンとURLが一致しません".into(),
        ));
    }
    ensure_empty_target(root)?;
    let parent = root
        .parent()
        .ok_or_else(|| AppError::Validation("BDSの保存先に親フォルダーがありません".into()))?;
    std::fs::create_dir_all(parent)?;
    let archive_path = parent.join(format!(".bedrock-download-{}.zip", Uuid::new_v4()));

    let result = async {
        download_official_archive(client, requested_url, &archive_path).await?;
        install_from_archive_with_version(&archive_path, root, Some(&plan.version))
    }
    .await;
    let _ = std::fs::remove_file(&archive_path);
    result
}

/// Installs a ZIP the user selected manually. Structural checks, bounded
/// extraction, SHA-256 recording and the official executable signature check
/// are mandatory. The caller should still explain that a manually selected ZIP
/// does not prove where every bundled data file came from.
pub fn install_from_archive(source: &Path, root: &Path) -> AppResult<BedrockInstallInfo> {
    let version = version_from_archive_name(source);
    install_from_archive_with_version(source, root, version.as_deref())
}

/// Verifies an already installed/imported BDS executable and keeps it locked
/// against replacement until the returned guard is dropped. Callers that will
/// execute the file must keep the guard alive through `Command::spawn`.
pub(crate) fn verify_installed_executable(root: &Path) -> AppResult<VerifiedBedrockExecutable> {
    if !root.is_dir() {
        return Err(AppError::Validation(
            "統合版サーバーフォルダーが見つかりません".into(),
        ));
    }
    if std::fs::symlink_metadata(root)?.file_type().is_symlink() {
        return Err(AppError::Validation(
            "シンボリックリンクの統合版サーバーフォルダーは安全のため実行できません".into(),
        ));
    }
    let canonical_root = root.canonicalize()?;
    let requested = root.join("bedrock_server.exe");
    let metadata = std::fs::symlink_metadata(&requested)
        .map_err(|_| AppError::Validation("bedrock_server.exeが見つかりません".into()))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(AppError::Validation(
            "bedrock_server.exeは通常ファイルである必要があります".into(),
        ));
    }
    let executable = requested.canonicalize()?;
    if executable.parent() != Some(canonical_root.as_path())
        || executable.file_name().and_then(OsStr::to_str) != Some("bedrock_server.exe")
    {
        return Err(AppError::Validation(
            "サーバーフォルダー直下以外のbedrock_server.exeは実行できません".into(),
        ));
    }

    let mut lock = open_executable_read_locked(&executable)?;
    let sha256 = sha256_reader(&mut lock)?;
    lock.seek(SeekFrom::Start(0))?;
    let signature_subject = verify_windows_authenticode(&executable)?;
    lock.seek(SeekFrom::Start(0))?;
    let verified_sha256 = sha256_reader(&mut lock)?;
    if verified_sha256 != sha256 {
        return Err(AppError::Validation(
            "署名検証中にbedrock_server.exeが変更されたため実行しません".into(),
        ));
    }
    lock.seek(SeekFrom::Start(0))?;
    Ok(VerifiedBedrockExecutable {
        path: executable,
        sha256,
        signature_subject,
        _lock: lock,
    })
}

fn install_from_archive_with_version(
    source: &Path,
    root: &Path,
    version: Option<&str>,
) -> AppResult<BedrockInstallInfo> {
    if !source.is_file() {
        return Err(AppError::Validation(
            "選択したBDS ZIPが見つかりません".into(),
        ));
    }
    let archive_size = source.metadata()?.len();
    if archive_size == 0 || archive_size > MAX_ARCHIVE_BYTES {
        return Err(AppError::Validation(
            "BDS ZIPは1バイト以上512 MiB以下である必要があります".into(),
        ));
    }
    ensure_empty_target(root)?;
    let archive_sha256 = sha256_file(source)?;
    let parent = root
        .parent()
        .ok_or_else(|| AppError::Validation("BDSの保存先に親フォルダーがありません".into()))?;
    std::fs::create_dir_all(parent)?;
    let staging = parent.join(format!(".bedrock-install-{}", Uuid::new_v4()));
    std::fs::create_dir(&staging)?;

    let extracted = match extract_archive(source, &staging) {
        Ok(value) => value,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    let executable = staging.join("bedrock_server.exe");
    if !executable.is_file() || !staging.join("server.properties").is_file() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(AppError::Validation(
            "公式BDSに必要なbedrock_server.exeまたはserver.propertiesがありません".into(),
        ));
    }
    let signature_subject = match verify_windows_authenticode(&executable) {
        Ok(subject) => subject,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error);
        }
    };

    let target_existed = root.exists();
    if target_existed {
        std::fs::remove_dir(root)?;
    }
    if let Err(error) = std::fs::rename(&staging, root) {
        if target_existed {
            let _ = std::fs::create_dir(root);
        }
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error.into());
    }

    Ok(BedrockInstallInfo {
        version: version.map(str::to_string),
        archive_sha256,
        executable_path: root.join("bedrock_server.exe").display().to_string(),
        extracted_files: extracted.file_count,
        extracted_size_bytes: extracted.size_bytes,
        signature_subject,
    })
}

async fn download_official_archive(client: &Client, url: Url, destination: &Path) -> AppResult<()> {
    let request = client
        .get(url)
        .timeout(DOWNLOAD_TIMEOUT)
        .header(
            header::ACCEPT,
            "application/zip,application/x-zip-compressed,application/octet-stream",
        )
        .send();
    let response = tokio::time::timeout(DOWNLOAD_IDLE_TIMEOUT, request)
        .await
        .map_err(|_| {
            AppError::Other(
                "Minecraft公式BDSの応答が45秒以内に始まりませんでした。通信を確認して再試行してください"
                    .into(),
            )
        })??
        .error_for_status()?;
    validate_official_download_url(response.url().as_str())?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_ARCHIVE_BYTES)
    {
        return Err(AppError::Other(
            "Minecraft公式BDS ZIPが安全上限（512 MiB）を超えています".into(),
        ));
    }

    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?;
    let mut received = 0u64;
    let mut stream = response.bytes_stream();
    loop {
        let next = tokio::time::timeout(DOWNLOAD_IDLE_TIMEOUT, stream.next())
            .await
            .map_err(|_| {
                AppError::Other(
                    "Minecraft公式BDSの受信が45秒間進みませんでした。通信を確認して再試行してください"
                        .into(),
                )
            })?;
        let Some(chunk) = next else { break };
        let chunk = chunk?;
        received = received.saturating_add(chunk.len() as u64);
        if received > MAX_ARCHIVE_BYTES {
            drop(output);
            let _ = std::fs::remove_file(destination);
            return Err(AppError::Other(
                "Minecraft公式BDS ZIPが安全上限（512 MiB）を超えました".into(),
            ));
        }
        output.write_all(&chunk)?;
    }
    if received == 0 {
        drop(output);
        let _ = std::fs::remove_file(destination);
        return Err(AppError::Other("Minecraft公式BDS ZIPが空です".into()));
    }
    output.sync_all()?;
    Ok(())
}

pub fn validate_official_download_url(value: &str) -> AppResult<Url> {
    let url = Url::parse(value)
        .map_err(|_| AppError::Validation("BDSダウンロードURLが正しくありません".into()))?;
    if url.scheme() != "https"
        || url.host_str() != Some("www.minecraft.net")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.path().starts_with("/bedrockdedicatedserver/bin-win/")
        || version_from_download_url(&url).is_none()
    {
        return Err(AppError::Validation(
            "Minecraft公式Windows BDS以外の配布URLを拒否しました".into(),
        ));
    }
    Ok(url)
}

fn version_from_download_url(url: &Url) -> Option<String> {
    static FILE_NAME: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^bedrock-server-([0-9]+(?:\.[0-9]+){2,3})\.zip$").unwrap());
    let name = url.path_segments()?.next_back()?;
    FILE_NAME
        .captures(name)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_string())
}

fn version_from_archive_name(source: &Path) -> Option<String> {
    static FILE_NAME: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^bedrock-server-([0-9]+(?:\.[0-9]+){2,3})\.zip$").unwrap()
    });
    let name = source.file_name()?.to_str()?;
    FILE_NAME
        .captures(name)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_string())
}

fn ensure_empty_target(root: &Path) -> AppResult<()> {
    if !root.exists() {
        return Ok(());
    }
    if std::fs::symlink_metadata(root)?.file_type().is_symlink() {
        return Err(AppError::Validation(
            "BDSの保存先にシンボリックリンクは使用できません".into(),
        ));
    }
    if !root.is_dir() {
        return Err(AppError::Validation(
            "BDSの保存先がフォルダーではありません".into(),
        ));
    }
    if root.read_dir()?.next().is_some() {
        return Err(AppError::Validation(
            "既存ファイルを保護するため、空ではないフォルダーへのBDS展開を拒否しました".into(),
        ));
    }
    Ok(())
}

fn extract_archive(source: &Path, destination: &Path) -> AppResult<ExtractedArchive> {
    let file = File::open(source)?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| AppError::Validation(format!("BDS ZIPを開けません: {error}")))?;
    if archive.len() == 0 || archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(AppError::Validation(format!(
            "BDS ZIPの項目数は1～{MAX_ARCHIVE_ENTRIES}件である必要があります"
        )));
    }

    let mut seen = HashSet::new();
    let mut total_size = 0u64;
    let mut file_count = 0u32;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| AppError::Validation(format!("BDS ZIPを読めません: {error}")))?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(AppError::Validation(
                "BDS ZIP内のシンボリックリンクを拒否しました".into(),
            ));
        }
        let relative = entry.enclosed_name().ok_or_else(|| {
            AppError::Validation("BDS ZIP内に保存先外を指すパスがあります".into())
        })?;
        validate_relative_windows_path(&relative)?;
        let duplicate_key = relative.to_string_lossy().replace('\\', "/").to_lowercase();
        if !seen.insert(duplicate_key) {
            return Err(AppError::Validation(
                "BDS ZIP内に大文字小文字だけが異なる重複パスがあります".into(),
            ));
        }

        let output_path = destination.join(&relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&output_path)?;
            continue;
        }
        let declared_size = entry.size();
        if declared_size > MAX_ENTRY_BYTES {
            return Err(AppError::Validation(
                "BDS ZIP内の単一ファイルが安全上限（1 GiB）を超えています".into(),
            ));
        }
        total_size = total_size
            .checked_add(declared_size)
            .ok_or_else(|| AppError::Validation("BDS ZIPの展開容量が大きすぎます".into()))?;
        if total_size > MAX_EXTRACTED_BYTES {
            return Err(AppError::Validation(
                "BDS ZIPの展開容量が安全上限（2 GiB）を超えています".into(),
            ));
        }
        if let Some(parent) = output_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output_path)?;
        let mut limited = (&mut entry).take(declared_size.saturating_add(1));
        let written = std::io::copy(&mut limited, &mut output)?;
        if written != declared_size || written > MAX_ENTRY_BYTES {
            return Err(AppError::Validation(
                "BDS ZIP内ファイルの実サイズが宣言値と一致しません".into(),
            ));
        }
        output.sync_all()?;
        file_count = file_count.saturating_add(1);
    }

    Ok(ExtractedArchive {
        file_count,
        size_bytes: total_size,
    })
}

fn validate_relative_windows_path(path: &Path) -> AppResult<()> {
    if path.as_os_str().is_empty() {
        return Err(AppError::Validation("BDS ZIP内に空のパスがあります".into()));
    }
    for component in path.components() {
        let Component::Normal(value) = component else {
            return Err(AppError::Validation(
                "BDS ZIP内に絶対パスまたは親フォルダー参照があります".into(),
            ));
        };
        validate_windows_component(value)?;
    }
    Ok(())
}

fn validate_windows_component(value: &OsStr) -> AppResult<()> {
    let value = value.to_str().ok_or_else(|| {
        AppError::Validation("BDS ZIP内にUTF-8ではないファイル名があります".into())
    })?;
    if value.is_empty()
        || value.ends_with([' ', '.'])
        || value
            .chars()
            .any(|character| character.is_control() || r#"<>:\"/\|?*"#.contains(character))
    {
        return Err(AppError::Validation(
            "BDS ZIP内にWindowsで安全に扱えないファイル名があります".into(),
        ));
    }
    let stem = value
        .split('.')
        .next()
        .unwrap_or(value)
        .to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem
            .strip_prefix("COM")
            .or_else(|| stem.strip_prefix("LPT"))
            .is_some_and(|number| {
                matches!(number, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            });
    if reserved {
        return Err(AppError::Validation(
            "BDS ZIP内にWindowsの予約済みファイル名があります".into(),
        ));
    }
    Ok(())
}

fn sha256_file(path: &Path) -> AppResult<String> {
    let mut input = File::open(path)?;
    sha256_reader(&mut input)
}

fn sha256_reader(input: &mut File) -> AppResult<String> {
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = input.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(hex::encode(digest.finalize()))
}

#[cfg(windows)]
fn open_executable_read_locked(path: &Path) -> AppResult<File> {
    use std::os::windows::fs::OpenOptionsExt;

    // FILE_SHARE_READ permits the Authenticode verifier and CreateProcess to
    // read the image, while denying writers and replacement/deletion until the
    // guard is dropped.
    const FILE_SHARE_READ: u32 = 0x0000_0001;
    OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .open(path)
        .map_err(|error| {
            AppError::Other(format!(
                "bedrock_server.exeを安全に固定できません。別のアプリが変更中でないか確認してください: {error}"
            ))
        })
}

#[cfg(not(windows))]
fn open_executable_read_locked(_path: &Path) -> AppResult<File> {
    Err(AppError::Validation(
        "Bedrock Dedicated Serverの初期対応はWindowsのみです".into(),
    ))
}

#[cfg(windows)]
fn verify_windows_authenticode(executable: &Path) -> AppResult<String> {
    let system_root = std::env::var_os("SystemRoot")
        .ok_or_else(|| AppError::Other("WindowsのSystemRootを確認できません".into()))?;
    let powershell = PathBuf::from(system_root)
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    if !powershell.is_file() {
        return Err(AppError::Other(
            "Windows署名検証用のPowerShellが見つかりません".into(),
        ));
    }
    // Codex/dev shells can supply a PowerShell 7 PSModulePath that is invalid
    // for Windows PowerShell 5.1. Import the inbox security module by its fixed
    // System32 path rather than trusting the inherited module search path.
    let script = r#"$ErrorActionPreference='Stop'; $module=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'; Import-Module -Name $module -Force; $target=[Environment]::GetEnvironmentVariable('MSH_BEDROCK_SIGNATURE_TARGET','Process'); $signature=Get-AuthenticodeSignature -LiteralPath $target; [pscustomobject]@{status=$signature.Status.ToString();subject=if($signature.SignerCertificate){$signature.SignerCertificate.Subject}else{''}} | ConvertTo-Json -Compress"#;
    let mut command = Command::new(powershell);
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env("MSH_BEDROCK_SIGNATURE_TARGET", executable.as_os_str());
    crate::windows_process::hide_console_window(&mut command);
    let output = command.output()?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr);
        let detail = detail.trim();
        return Err(AppError::Other(if detail.is_empty() {
            "bedrock_server.exeのWindows署名を検証できません".into()
        } else {
            format!("bedrock_server.exeのWindows署名を検証できません: {detail}")
        }));
    }
    let value: SignatureResult = serde_json::from_slice(&output.stdout)
        .map_err(|_| AppError::Other("bedrock_server.exeの署名結果を解釈できません".into()))?;
    let microsoft_signer = value.subject.contains("O=Microsoft Corporation")
        || value.subject.contains("CN=Microsoft Corporation");
    if value.status != "Valid" || !microsoft_signer {
        return Err(AppError::Validation(
            "bedrock_server.exeのMicrosoft署名を確認できないため実行しません".into(),
        ));
    }
    Ok(value.subject)
}

#[cfg(not(windows))]
fn verify_windows_authenticode(_executable: &Path) -> AppResult<String> {
    Err(AppError::Validation(
        "Bedrock Dedicated Serverの初期対応はWindowsのみです".into(),
    ))
}

#[cfg(test)]
mod tests {
    use std::{fs::File, io::Write};

    use zip::{ZipWriter, write::SimpleFileOptions};

    use super::{
        download_and_install, extract_archive, fetch_download_plan, validate_official_download_url,
        verify_installed_executable, version_from_archive_name, version_from_download_url,
    };

    fn write_zip(path: &std::path::Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        for (name, contents) in entries {
            zip.start_file(*name, SimpleFileOptions::default()).unwrap();
            zip.write_all(contents).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn accepts_only_official_stable_windows_bds_urls() {
        let url = validate_official_download_url(
            "https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-1.26.44.3.zip",
        )
        .unwrap();
        assert_eq!(
            version_from_download_url(&url).as_deref(),
            Some("1.26.44.3")
        );
        for unsafe_url in [
            "http://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-1.26.44.3.zip",
            "https://minecraft.net.evil.example/bedrockdedicatedserver/bin-win/bedrock-server-1.26.44.3.zip",
            "https://www.minecraft.net/bedrockdedicatedserver/bin-win-preview/bedrock-server-1.26.50.27.zip",
            "https://www.minecraft.net/bedrockdedicatedserver/bin-win/../bedrock-server-1.26.44.3.zip",
            "https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-latest.zip",
        ] {
            assert!(
                validate_official_download_url(unsafe_url).is_err(),
                "{unsafe_url}"
            );
        }
    }

    #[test]
    fn parses_manual_archive_version_without_trusting_other_names() {
        assert_eq!(
            version_from_archive_name(std::path::Path::new("bedrock-server-1.26.44.3.zip"))
                .as_deref(),
            Some("1.26.44.3")
        );
        assert_eq!(
            version_from_archive_name(std::path::Path::new("renamed.zip")),
            None
        );
    }

    #[test]
    fn safely_extracts_a_bounded_archive() {
        let base = std::env::temp_dir().join(format!("msh-bedrock-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&base).unwrap();
        let source = base.join("server.zip");
        let output = base.join("output");
        std::fs::create_dir(&output).unwrap();
        write_zip(
            &source,
            &[
                ("bedrock_server.exe", b"test"),
                ("server.properties", b"server-port=19132\n"),
                ("worlds/template/db/000001.ldb", b"leveldb"),
            ],
        );
        let result = extract_archive(&source, &output).unwrap();
        assert_eq!(result.file_count, 3);
        assert!(output.join("worlds/template/db/000001.ldb").is_file());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn rejects_zip_slip_windows_ads_and_case_collisions() {
        for entries in [
            vec![("../escape.txt", b"bad".as_slice())],
            vec![("worlds/good.txt:evil", b"bad".as_slice())],
            vec![("A.txt", b"one".as_slice()), ("a.TXT", b"two".as_slice())],
            vec![("CON.txt", b"bad".as_slice())],
        ] {
            let base = std::env::temp_dir().join(format!("msh-bedrock-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&base).unwrap();
            let source = base.join("unsafe.zip");
            let output = base.join("output");
            std::fs::create_dir(&output).unwrap();
            write_zip(&source, &entries);
            assert!(extract_archive(&source, &output).is_err());
            std::fs::remove_dir_all(base).unwrap();
        }
    }

    #[cfg(windows)]
    #[test]
    fn verifies_a_microsoft_signed_windows_binary_with_inbox_powershell() {
        let system_root = std::env::var_os("SystemRoot").unwrap();
        let notepad = std::path::PathBuf::from(system_root)
            .join("System32")
            .join("notepad.exe");
        let subject = super::verify_windows_authenticode(&notepad).unwrap();
        assert!(subject.contains("Microsoft Corporation"));
    }

    #[cfg(windows)]
    #[test]
    fn locks_an_imported_signed_executable_through_the_spawn_boundary() {
        let base =
            std::env::temp_dir().join(format!("msh-bedrock-verified-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&base).unwrap();
        let system_root = std::env::var_os("SystemRoot").unwrap();
        let notepad = std::path::PathBuf::from(system_root)
            .join("System32")
            .join("notepad.exe");
        let executable = base.join("bedrock_server.exe");
        std::fs::copy(notepad, &executable).unwrap();

        let verified = verify_installed_executable(&base).unwrap();
        assert_eq!(verified.path(), executable.canonicalize().unwrap());
        assert_eq!(verified.sha256().len(), 64);
        assert!(
            verified
                .signature_subject()
                .contains("Microsoft Corporation")
        );
        assert!(
            std::fs::OpenOptions::new()
                .write(true)
                .open(&executable)
                .is_err(),
            "verified executable must reject concurrent writes"
        );
        assert!(std::fs::remove_file(&executable).is_err());
        drop(verified);
        std::fs::remove_file(&executable).unwrap();
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    #[ignore = "Minecraft公式BDS（約100 MiB）を取得・署名検証・展開する明示実行用テスト"]
    fn installs_current_official_windows_bds() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let client = crate::downloads::http_client().unwrap();
            let base =
                std::env::temp_dir().join(format!("msh-bedrock-live-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&base).unwrap();
            let root = base.join("server");
            let plan = fetch_download_plan(&client).await.unwrap();
            let result = download_and_install(&client, &plan, &root).await;
            if let Ok(installed) = &result {
                assert_eq!(installed.version.as_deref(), Some(plan.version.as_str()));
                assert!(root.join("bedrock_server.exe").is_file());
                assert!(root.join("server.properties").is_file());
                assert_eq!(installed.archive_sha256.len(), 64);
            }
            std::fs::remove_dir_all(base).unwrap();
            result.unwrap();
        });
    }
}
