use std::{
    collections::BTreeSet,
    env,
    fs::File,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};

use reqwest::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zip::ZipArchive;

use crate::{
    error::{AppError, AppResult},
    models::{JavaDownloadPlan, JavaRuntime},
};

const ADOPTIUM_API: &str = "https://api.adoptium.net/v3";
const ADOPTIUM_LICENSE: &str = "https://adoptium.net/docs/faq/#is-eclipse-temurin-free-to-use";
const MAX_ARCHIVE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_EXTRACTED_BYTES: u64 = 1_500 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 50_000;

#[derive(Debug, Deserialize)]
struct AdoptiumAsset {
    binary: AdoptiumBinary,
    release_name: String,
}

#[derive(Debug, Deserialize)]
struct AdoptiumBinary {
    architecture: String,
    image_type: String,
    os: String,
    package: AdoptiumPackage,
}

#[derive(Debug, Deserialize)]
struct AdoptiumPackage {
    checksum: String,
    link: String,
    name: String,
    size: u64,
}

pub fn detect_java_runtimes(server_type: &str, minecraft_version: &str) -> Vec<JavaRuntime> {
    let mut candidates = BTreeSet::new();

    if let Some(java_home) = env::var_os("JAVA_HOME") {
        candidates.insert(PathBuf::from(java_home).join("bin").join("java.exe"));
    }
    let mut where_java = Command::new("where.exe");
    where_java.arg("java.exe");
    crate::windows_process::hide_console_window(&mut where_java);
    if let Ok(output) = where_java.output() {
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            candidates.insert(PathBuf::from(line.trim()));
        }
    }

    for base in known_java_roots() {
        collect_java_executables(&base, 3, &mut candidates);
    }

    let required = required_java_major(server_type, minecraft_version);
    candidates
        .into_iter()
        .filter(|path| path.is_file())
        .filter_map(|path| inspect_java(&path, required))
        .collect()
}

fn known_java_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(value) = env::var_os(variable) {
            let base = PathBuf::from(value);
            roots.push(base.join("Eclipse Adoptium"));
            roots.push(base.join("Microsoft"));
            roots.push(base.join("Java"));
        }
    }
    for variable in ["APPDATA", "LOCALAPPDATA"] {
        if let Some(value) = env::var_os(variable) {
            roots.push(
                PathBuf::from(value)
                    .join("local.minecraft-server-hub.desktop")
                    .join("java"),
            );
        }
    }
    roots
}

fn collect_java_executables(base: &Path, depth: u8, output: &mut BTreeSet<PathBuf>) {
    if depth == 0 || !base.is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(base) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            let direct = path.join("bin").join("java.exe");
            if direct.is_file() {
                output.insert(direct);
            }
            collect_java_executables(&path, depth - 1, output);
        }
    }
}

pub fn inspect_java(path: &Path, required: u16) -> Option<JavaRuntime> {
    let mut command = Command::new(path);
    command.args(["-XshowSettings:properties", "-version"]);
    crate::windows_process::hide_console_window(&mut command);
    let output = command.output().ok()?;
    let text = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let version = property(&text, "java.version")
        .or_else(|| quoted_version(&text))
        .unwrap_or_else(|| "unknown".into());
    let major = java_major(&version)?;
    let home = property(&text, "java.home").unwrap_or_else(|| {
        path.parent()
            .and_then(Path::parent)
            .unwrap_or(path)
            .display()
            .to_string()
    });
    let vendor = property(&text, "java.vendor").unwrap_or_else(|| "不明".into());
    let architecture = property(&text, "os.arch").unwrap_or_else(|| "unknown".into());
    let compatible = major >= required && !architecture.contains("x86");
    let compatibility_message = if compatible {
        format!("Java {major} — この構成の必要条件 Java {required}+ を満たしています")
    } else if architecture.contains("x86") {
        "32bit Javaは対応していません。64bit版を選択してください".into()
    } else {
        format!("Java {required}以上が必要です。現在はJava {major}です")
    };
    Some(JavaRuntime {
        executable_path: path.display().to_string(),
        home_path: home,
        vendor,
        version,
        major_version: major,
        architecture,
        compatible,
        compatibility_message,
    })
}

pub async fn download_plan(
    client: &Client,
    java_dir: &Path,
    server_type: &str,
    minecraft_version: &str,
) -> AppResult<JavaDownloadPlan> {
    let major = required_java_major(server_type, minecraft_version);
    download_plan_for_major(client, java_dir, major).await
}

async fn download_plan_for_major(
    client: &Client,
    java_dir: &Path,
    major: u16,
) -> AppResult<JavaDownloadPlan> {
    if !(8..=30).contains(&major) {
        return Err(AppError::Validation(
            "自動取得に対応していないJava世代です".into(),
        ));
    }
    let url = format!("{ADOPTIUM_API}/assets/latest/{major}/hotspot");
    let assets: Vec<AdoptiumAsset> = client
        .get(url)
        .query(&[
            ("architecture", "x64"),
            ("heap_size", "normal"),
            ("image_type", "jre"),
            ("jvm_impl", "hotspot"),
            ("os", "windows"),
            ("page", "0"),
            ("page_size", "1"),
            ("project", "jdk"),
            ("sort_method", "DEFAULT"),
            ("sort_order", "DESC"),
            ("vendor", "eclipse"),
        ])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let asset = assets.into_iter().next().ok_or_else(|| {
        AppError::Validation(format!(
            "Java {major} のWindows 64bit版を公式配布元で見つけられませんでした"
        ))
    })?;
    validate_asset(&asset, major)?;
    let checksum_prefix = &asset.binary.package.checksum[..12];
    let destination = java_dir.join(format!("temurin-{major}-{checksum_prefix}"));
    Ok(JavaDownloadPlan {
        provider: "Eclipse Adoptium".into(),
        distribution: "Eclipse Temurin JRE (HotSpot / Windows x64)".into(),
        major_version: major,
        release_name: asset.release_name,
        package_name: asset.binary.package.name,
        size_bytes: asset.binary.package.size,
        checksum_sha256: asset.binary.package.checksum.to_ascii_lowercase(),
        destination_path: destination.display().to_string(),
        license_name: "GNU GPL v2 with the Classpath Exception".into(),
        license_url: ADOPTIUM_LICENSE.into(),
        source_url: asset.binary.package.link,
    })
}

pub async fn install_managed_java(
    client: &Client,
    java_dir: &Path,
    confirmed: JavaDownloadPlan,
) -> AppResult<JavaRuntime> {
    let current = download_plan_for_major(client, java_dir, confirmed.major_version).await?;
    if current.release_name != confirmed.release_name
        || current.package_name != confirmed.package_name
        || current.checksum_sha256 != confirmed.checksum_sha256
        || current.size_bytes != confirmed.size_bytes
        || current.destination_path != confirmed.destination_path
    {
        return Err(AppError::Validation(
            "確認後に公式配布内容が更新されました。安全のため内容をもう一度確認してください".into(),
        ));
    }

    let destination = PathBuf::from(&current.destination_path);
    if destination.exists() {
        let java = destination.join("bin").join("java.exe");
        return inspect_java(&java, current.major_version).filter(|runtime| runtime.compatible).ok_or_else(|| {
            AppError::Validation("アプリ用Javaの保存先に不完全なファイルがあります。削除せずにサポートへ確認してください".into())
        });
    }

    std::fs::create_dir_all(java_dir)?;
    ensure_free_space(java_dir, current.size_bytes)?;
    let staging = java_dir.join(format!(".java-download-{}", Uuid::new_v4()));
    std::fs::create_dir(&staging)?;
    let archive_path = staging.join("temurin.zip.part");

    let result = async {
        download_verified_archive(client, &current, &archive_path).await?;
        let archive_for_extract = archive_path.clone();
        let extracted = staging.join("extracted");
        let extracted_for_task = extracted.clone();
        tauri::async_runtime::spawn_blocking(move || {
            extract_archive(&archive_for_extract, &extracted_for_task)
        })
        .await
        .map_err(|error| {
            AppError::Other(format!("Java展開処理を完了できませんでした: {error}"))
        })??;
        let java = find_java_executable(&extracted)?;
        inspect_java(&java, current.major_version)
            .filter(|runtime| runtime.compatible)
            .ok_or_else(|| {
                AppError::Validation("取得したJavaを64bit互換環境として確認できませんでした".into())
            })?;
        let distribution_root = java.parent().and_then(Path::parent).ok_or_else(|| {
            AppError::Validation("取得したJavaのフォルダー構造が正しくありません".into())
        })?;
        std::fs::rename(distribution_root, &destination)?;
        let installed_java = destination.join("bin").join("java.exe");
        inspect_java(&installed_java, current.major_version)
            .filter(|item| item.compatible)
            .ok_or_else(|| AppError::Validation("保存後のJavaを再確認できませんでした".into()))
    }
    .await;

    let _ = std::fs::remove_dir_all(&staging);
    result
}

fn validate_asset(asset: &AdoptiumAsset, major: u16) -> AppResult<()> {
    let package = &asset.binary.package;
    let official_path = format!("/adoptium/temurin{major}-binaries/");
    let source = reqwest::Url::parse(&package.link)
        .map_err(|_| AppError::Validation("Java配布URLを確認できませんでした".into()))?;
    if source.scheme() != "https"
        || source.host_str() != Some("github.com")
        || !source.path().starts_with(&official_path)
        || asset.binary.architecture != "x64"
        || asset.binary.os != "windows"
        || asset.binary.image_type != "jre"
        || !package.name.ends_with(".zip")
        || package.name.contains(['/', '\\'])
        || package.size == 0
        || package.size > MAX_ARCHIVE_BYTES
        || package.checksum.len() != 64
        || !package
            .checksum
            .chars()
            .all(|value| value.is_ascii_hexdigit())
    {
        return Err(AppError::Validation(
            "公式Java配布情報が安全条件を満たしていません".into(),
        ));
    }
    Ok(())
}

async fn download_verified_archive(
    client: &Client,
    plan: &JavaDownloadPlan,
    destination: &Path,
) -> AppResult<()> {
    let mut response = client
        .get(&plan.source_url)
        .send()
        .await?
        .error_for_status()?;
    if response
        .content_length()
        .is_some_and(|size| size != plan.size_bytes || size > MAX_ARCHIVE_BYTES)
    {
        return Err(AppError::Validation(
            "Java配布ファイルの容量が確認内容と一致しません".into(),
        ));
    }
    let mut file = File::create(destination)?;
    let mut digest = Sha256::new();
    let mut written = 0_u64;
    while let Some(chunk) = response.chunk().await? {
        written = written.saturating_add(chunk.len() as u64);
        if written > MAX_ARCHIVE_BYTES || written > plan.size_bytes {
            return Err(AppError::Validation(
                "Java配布ファイルが確認した容量を超えたため中止しました".into(),
            ));
        }
        digest.update(&chunk);
        file.write_all(&chunk)?;
    }
    file.flush()?;
    if written != plan.size_bytes {
        return Err(AppError::Validation(
            "Java配布ファイルの受信が途中で終了しました".into(),
        ));
    }
    let actual = hex::encode(digest.finalize());
    if actual != plan.checksum_sha256 {
        return Err(AppError::Validation(
            "Java配布ファイルのSHA-256検証に失敗しました。保存先へ反映していません".into(),
        ));
    }
    Ok(())
}

fn extract_archive(archive_path: &Path, destination: &Path) -> AppResult<()> {
    let mut archive = ZipArchive::new(File::open(archive_path)?)
        .map_err(|error| AppError::Validation(format!("Java配布ZIPを開けませんでした: {error}")))?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(AppError::Validation(
            "Java配布ZIPの項目数が安全上限を超えています".into(),
        ));
    }
    std::fs::create_dir(destination)?;
    let mut extracted_bytes = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| {
            AppError::Validation(format!("Java配布ZIPを読み取れませんでした: {error}"))
        })?;
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(AppError::Validation(
                "Java配布ZIPにリンク項目があるため展開を中止しました".into(),
            ));
        }
        let relative = entry.enclosed_name().ok_or_else(|| {
            AppError::Validation("Java配布ZIPに保存先外を指す項目があります".into())
        })?;
        let output = destination.join(relative);
        if entry.is_dir() {
            std::fs::create_dir_all(&output)?;
            continue;
        }
        extracted_bytes = extracted_bytes.saturating_add(entry.size());
        if extracted_bytes > MAX_EXTRACTED_BYTES {
            return Err(AppError::Validation(
                "Java展開後の容量が安全上限を超えています".into(),
            ));
        }
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut output_file = File::create(&output)?;
        std::io::copy(&mut entry, &mut output_file)?;
    }
    Ok(())
}

fn find_java_executable(root: &Path) -> AppResult<PathBuf> {
    walkdir::WalkDir::new(root)
        .min_depth(2)
        .max_depth(4)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .map(|entry| entry.into_path())
        .find(|path| {
            path.is_file()
                && path
                    .file_name()
                    .is_some_and(|name| name.eq_ignore_ascii_case("java.exe"))
                && path
                    .parent()
                    .and_then(Path::file_name)
                    .is_some_and(|name| name.eq_ignore_ascii_case("bin"))
        })
        .ok_or_else(|| AppError::Validation("Java配布ZIP内にbin\\java.exeが見つかりません".into()))
}

fn ensure_free_space(root: &Path, archive_size: u64) -> AppResult<()> {
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let available = disks
        .list()
        .iter()
        .filter(|disk| root.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().as_os_str().len())
        .map(|disk| disk.available_space());
    let required = archive_size
        .saturating_mul(4)
        .saturating_add(256 * 1024 * 1024);
    if available.is_some_and(|bytes| bytes < required) {
        return Err(AppError::Validation(format!(
            "Javaの取得と展開には約{} MiBの空き容量が必要です",
            required / 1024 / 1024
        )));
    }
    Ok(())
}

fn property(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (left, right) = line.trim().split_once('=')?;
        (left.trim() == key).then(|| right.trim().to_string())
    })
}

fn quoted_version(text: &str) -> Option<String> {
    let line = text.lines().find(|line| line.contains(" version \""))?;
    line.split('"').nth(1).map(str::to_string)
}

fn java_major(version: &str) -> Option<u16> {
    let clean = version.trim_start_matches("1.");
    clean.split(['.', '-', '_']).next()?.parse().ok()
}

pub fn required_java_major(server_type: &str, version: &str) -> u16 {
    if calendar_version_at_least(version, 26, 1) {
        return 25;
    }
    let parts = numeric_parts(version);
    let minor = parts.get(1).copied().unwrap_or_default();
    let patch = parts.get(2).copied().unwrap_or_default();

    if server_type == "paper" {
        return match (minor, patch) {
            (0..=11, _) => 8,
            (12..=15, _) => 11,
            (16, 0..=4) => 11,
            (16, _) => 16,
            (17..=19, _) => 17,
            _ => 21,
        };
    }

    match (minor, patch) {
        (0..=16, _) => 8,
        (17, _) => 16,
        (18..=19, _) => 17,
        (20, 0..=4) => 17,
        _ => 21,
    }
}

fn numeric_parts(version: &str) -> Vec<u16> {
    version
        .split('.')
        .map(|value| value.parse().unwrap_or_default())
        .collect()
}

fn calendar_version_at_least(version: &str, major: u16, minor: u16) -> bool {
    let parts = numeric_parts(version);
    let first = parts.first().copied().unwrap_or_default();
    let second = parts.get(1).copied().unwrap_or_default();
    first > major || (first == major && second >= minor)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use uuid::Uuid;

    use crate::error::AppError;

    use super::{
        AdoptiumAsset, AdoptiumBinary, AdoptiumPackage, download_plan_for_major,
        install_managed_java, required_java_major, validate_asset,
    };

    #[test]
    fn maps_modern_java_requirements() {
        assert_eq!(required_java_major("vanilla", "1.20.4"), 17);
        assert_eq!(required_java_major("vanilla", "1.20.5"), 21);
        assert_eq!(required_java_major("paper", "1.16.5"), 16);
        assert_eq!(required_java_major("paper", "26.1"), 25);
    }

    #[test]
    fn accepts_only_the_expected_official_windows_archive() {
        let asset = AdoptiumAsset {
            release_name: "jdk-21.0.12+7".into(),
            binary: AdoptiumBinary {
                architecture: "x64".into(), image_type: "jre".into(), os: "windows".into(),
                package: AdoptiumPackage {
                    checksum: "a".repeat(64),
                    link: "https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21/test.zip".into(),
                    name: "OpenJDK21U-jre_x64_windows_hotspot.zip".into(), size: 50_000_000,
                },
            },
        };
        assert!(validate_asset(&asset, 21).is_ok());
        let mut untrusted = asset;
        untrusted.binary.package.link = "https://example.com/java.zip".into();
        assert!(validate_asset(&untrusted, 21).is_err());
    }

    #[test]
    #[ignore = "Eclipse Adoptium公式APIから実際のJavaを取得・検証・展開・起動する明示実行用テスト"]
    fn installs_and_runs_a_live_managed_java() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let client = crate::downloads::http_client().unwrap();
            let root = std::env::temp_dir().join(format!("msh-java-live-{}", Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap();
            let result = async {
                let plan = download_plan_for_major(&client, &root, 21).await?;
                let installed = install_managed_java(&client, &root, plan).await?;
                if !Path::new(&installed.executable_path).is_file() || installed.major_version != 21
                {
                    return Err(AppError::Other(
                        "取得したJavaを起動確認できませんでした".into(),
                    ));
                }
                Ok::<(), AppError>(())
            }
            .await;
            let _ = std::fs::remove_dir_all(&root);
            result.unwrap();
        });
    }
}
