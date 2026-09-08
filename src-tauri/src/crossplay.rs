use std::{
    io::Write,
    path::{Path, PathBuf},
};

use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    backup,
    error::{AppError, AppResult},
    models::{BackupInfo, ServerProfile},
};

const API_ROOT: &str = "https://download.geysermc.org/v2/projects";
const MAX_COMPONENT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_METADATA_BYTES: u64 = 64 * 1024;
const MAX_CONFIG_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCrossplayMetadata {
    bedrock_port: u16,
    #[serde(default)]
    include_floodgate: bool,
    #[serde(default)]
    installed_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossplayStatus {
    pub eligible: bool,
    pub installed: bool,
    pub bedrock_port: Option<u16>,
    pub floodgate_installed: bool,
    pub configuration_generated: bool,
    pub configuration_ready: bool,
}

pub fn status(profile: &ServerProfile) -> CrossplayStatus {
    let bedrock_port = registered_bedrock_port(profile);
    let config_path = Path::new(&profile.root_path)
        .join("plugins")
        .join("Geyser-Spigot")
        .join("config.yml");
    let configuration_generated = config_path.is_file();
    let configuration_ready = bedrock_port.is_some_and(|port| {
        config_matches(&config_path, port, floodgate_installed(profile)).unwrap_or(false)
    });
    CrossplayStatus {
        eligible: profile.server_type == "paper",
        installed: bedrock_port.is_some(),
        bedrock_port,
        floodgate_installed: floodgate_installed(profile),
        configuration_generated,
        configuration_ready,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossplayConfigurationResult {
    pub backup: BackupInfo,
    pub bedrock_port: u16,
    pub floodgate_enabled: bool,
    pub message: String,
}

pub fn configure(
    backups_root: &Path,
    profile: &ServerProfile,
) -> AppResult<CrossplayConfigurationResult> {
    let bedrock_port = registered_bedrock_port(profile)
        .ok_or_else(|| AppError::Validation("クロスプレイ構成が登録されていません".into()))?;
    let floodgate = floodgate_installed(profile);
    let config_path = Path::new(&profile.root_path)
        .join("plugins")
        .join("Geyser-Spigot")
        .join("config.yml");
    let canonical_root = std::fs::canonicalize(&profile.root_path)?;
    let canonical_config = std::fs::canonicalize(&config_path).map_err(|_| {
        AppError::Validation(
            "Geyserのconfig.ymlがまだありません。Paperを一度起動して設定を生成してください".into(),
        )
    })?;
    if !canonical_config.starts_with(&canonical_root) {
        return Err(AppError::Validation(
            "Geyser設定がサーバーフォルダーの外を参照しているため変更できません".into(),
        ));
    }
    let metadata = std::fs::symlink_metadata(&config_path).map_err(|_| {
        AppError::Validation(
            "Geyserのconfig.ymlがまだありません。Paperを一度起動して設定を生成してください".into(),
        )
    })?;
    if metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > MAX_CONFIG_BYTES
    {
        return Err(AppError::Validation(
            "Geyserのconfig.ymlが安全な通常ファイルではありません".into(),
        ));
    }
    let original = std::fs::read_to_string(&config_path)?;
    let newline = if original.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut section = String::new();
    let mut found_port = false;
    let mut found_clone = false;
    let mut found_auth = !floodgate;
    let mut rendered = Vec::new();
    for line in original.lines() {
        let trimmed = line.trim();
        if !line.chars().next().is_some_and(char::is_whitespace)
            && trimmed.ends_with(':')
            && !trimmed.starts_with('#')
        {
            section = trimmed.trim_end_matches(':').to_ascii_lowercase();
        }
        let indent = &line[..line.len().saturating_sub(line.trim_start().len())];
        if section == "bedrock" && trimmed.starts_with("port:") {
            rendered.push(format!("{indent}port: {bedrock_port}"));
            found_port = true;
        } else if section == "bedrock" && trimmed.starts_with("clone-remote-port:") {
            rendered.push(format!("{indent}clone-remote-port: false"));
            found_clone = true;
        } else if floodgate && trimmed.starts_with("auth-type:") {
            rendered.push(format!("{indent}auth-type: floodgate"));
            found_auth = true;
        } else {
            rendered.push(line.to_string());
        }
    }
    if !found_port || !found_auth {
        return Err(AppError::Validation(
            "Geyser設定のbedrock.portまたはauth-typeを安全に特定できませんでした。公式手順でconfig.ymlを確認してください"
                .into(),
        ));
    }
    if !found_clone {
        return Err(AppError::Validation(
            "Geyser設定のclone-remote-portを安全に特定できませんでした".into(),
        ));
    }
    let rendered = rendered.join(newline) + newline;
    let backup = backup::create(backups_root, profile, "before-settings")?;
    let staging = config_path.with_extension(format!("yml.{}.part", uuid::Uuid::new_v4()));
    let previous = config_path.with_extension(format!("yml.{}.previous", uuid::Uuid::new_v4()));
    let result = (|| -> AppResult<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staging)?;
        file.write_all(rendered.as_bytes())?;
        file.sync_all()?;
        std::fs::rename(&config_path, &previous)?;
        if let Err(error) = std::fs::rename(&staging, &config_path) {
            let _ = std::fs::rename(&previous, &config_path);
            return Err(error.into());
        }
        let _ = std::fs::remove_file(&previous);
        Ok(())
    })();
    if let Err(error) = result {
        let _ = std::fs::remove_file(&staging);
        return Err(error);
    }
    Ok(CrossplayConfigurationResult {
        backup,
        bedrock_port,
        floodgate_enabled: floodgate,
        message: if floodgate {
            "GeyserのUDPポートとFloodgate認証を安全に設定しました".into()
        } else {
            "GeyserのUDPポートを安全に設定しました".into()
        },
    })
}

fn config_matches(path: &Path, bedrock_port: u16, require_floodgate: bool) -> AppResult<bool> {
    let metadata = std::fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > MAX_CONFIG_BYTES
    {
        return Ok(false);
    }
    let text = std::fs::read_to_string(path)?;
    let mut section = String::new();
    let mut port_matches = false;
    let mut clone_disabled = false;
    let mut auth_matches = !require_floodgate;
    for line in text.lines() {
        let trimmed = line.trim();
        if !line.chars().next().is_some_and(char::is_whitespace)
            && trimmed.ends_with(':')
            && !trimmed.starts_with('#')
        {
            section = trimmed.trim_end_matches(':').to_ascii_lowercase();
        }
        if section == "bedrock" && trimmed == format!("port: {bedrock_port}") {
            port_matches = true;
        }
        if section == "bedrock" && trimmed == "clone-remote-port: false" {
            clone_disabled = true;
        }
        if require_floodgate && trimmed.eq_ignore_ascii_case("auth-type: floodgate") {
            auth_matches = true;
        }
    }
    Ok(port_matches && clone_disabled && auth_matches)
}

pub fn registered_bedrock_port(profile: &ServerProfile) -> Option<u16> {
    if profile.server_type != "paper" {
        return None;
    }
    let root = Path::new(&profile.root_path);
    let management = root.join(".server-hub");
    let metadata_path = management.join("crossplay.json");
    let management_metadata = std::fs::symlink_metadata(&management).ok()?;
    let metadata = std::fs::symlink_metadata(&metadata_path).ok()?;
    if management_metadata.file_type().is_symlink()
        || metadata.file_type().is_symlink()
        || !metadata.is_file()
        || metadata.len() == 0
        || metadata.len() > MAX_METADATA_BYTES
    {
        return None;
    }
    let stored: StoredCrossplayMetadata =
        serde_json::from_slice(&std::fs::read(metadata_path).ok()?).ok()?;
    if !(1024..=u16::MAX).contains(&stored.bedrock_port) || stored.bedrock_port == profile.port {
        return None;
    }
    Some(stored.bedrock_port)
}

pub fn floodgate_installed(profile: &ServerProfile) -> bool {
    if profile.server_type != "paper" {
        return false;
    }
    let root = Path::new(&profile.root_path);
    let metadata_path = root.join(".server-hub").join("crossplay.json");
    if let Ok(bytes) = std::fs::read(&metadata_path)
        && let Ok(stored) = serde_json::from_slice::<StoredCrossplayMetadata>(&bytes)
        && stored.include_floodgate
        && stored
            .installed_files
            .iter()
            .any(|file| file.to_ascii_lowercase().contains("floodgate"))
    {
        return true;
    }
    std::fs::read_dir(root.join("plugins"))
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .any(|entry| {
            entry.file_type().is_ok_and(|kind| kind.is_file())
                && entry
                    .file_name()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .starts_with("floodgate")
                && entry.path().extension().is_some_and(|value| value == "jar")
        })
}

#[derive(Debug, Clone, Deserialize)]
pub struct CrossplayInstallInput {
    #[serde(rename = "serverId")]
    pub server_id: String,
    #[serde(rename = "includeFloodgate")]
    pub include_floodgate: bool,
    #[serde(rename = "bedrockPort")]
    pub bedrock_port: u16,
    #[serde(rename = "acceptWarnings")]
    pub accept_warnings: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossplayComponent {
    pub project: String,
    pub version: String,
    pub build: u64,
    pub file_name: String,
    pub sha256: String,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossplayPlan {
    pub eligible: bool,
    pub bedrock_port: u16,
    pub geyser: Option<CrossplayComponent>,
    pub floodgate: Option<CrossplayComponent>,
    pub warnings: Vec<String>,
    pub next_steps: Vec<String>,
    pub source_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossplayInstallResult {
    pub backup: BackupInfo,
    pub installed_files: Vec<String>,
    pub bedrock_port: u16,
    pub restart_required: bool,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
struct BuildResponse {
    version: String,
    build: u64,
    downloads: std::collections::HashMap<String, DownloadInfo>,
}

#[derive(Debug, Clone, Deserialize)]
struct DownloadInfo {
    name: String,
    sha256: String,
}

pub async fn plan(
    client: &Client,
    profile: &ServerProfile,
    bedrock_port: u16,
) -> AppResult<CrossplayPlan> {
    validate_port(profile, bedrock_port)?;
    let root = Path::new(&profile.root_path);
    let mut warnings = Vec::new();
    let eligible = profile.server_type == "paper"
        && profile.java_major >= 21
        && version_at_least(&profile.minecraft_version, 1, 20, 5);
    if profile.server_type != "paper" {
        warnings.push("クロスプレイ自動導入はPaperサーバーだけに対応しています".into());
    }
    if profile.java_major < 21 {
        warnings.push("現在のGeyser-SpigotにはJava 21以上が必要です".into());
    }
    if !version_at_least(&profile.minecraft_version, 1, 20, 5) {
        warnings.push("Paper 1.20.5未満はアプリ内Geyser導入の対象外です".into());
    }
    let geyser = fetch_component(
        client,
        "geyser",
        "spigot",
        root.join("plugins/Geyser-Spigot.jar"),
    )
    .await
    .ok();
    let floodgate = fetch_component(
        client,
        "floodgate",
        "spigot",
        root.join("plugins/floodgate-spigot.jar"),
    )
    .await
    .ok();
    if geyser.is_none() {
        warnings.push("GeyserMC公式Downloads APIから配布情報を取得できませんでした".into());
    }
    Ok(CrossplayPlan {
        eligible: eligible && geyser.is_some(),
        bedrock_port,
        geyser,
        floodgate,
        warnings,
        next_steps: vec![
            "導入前バックアップを作成してGeyser-Spigotをpluginsへ追加します".into(),
            "サーバーを起動してGeyser設定を生成し、Bedrock UDPポートを確認します".into(),
            "Floodgateを選んだ場合はGeyserのauth-typeをfloodgateへ変更します".into(),
            "別回線の統合版Minecraftから実際に参加して確認します".into(),
        ],
        source_url: "https://geysermc.org/wiki/geyser/setup/self/paper-spigot/".into(),
    })
}

pub async fn install(
    client: &Client,
    backups_root: &Path,
    profile: &ServerProfile,
    input: &CrossplayInstallInput,
) -> AppResult<CrossplayInstallResult> {
    if !input.accept_warnings {
        return Err(AppError::Validation(
            "互換性、UDP公開、参加制限の説明を確認してください".into(),
        ));
    }
    let plan = plan(client, profile, input.bedrock_port).await?;
    if !plan.eligible {
        return Err(AppError::Validation(plan.warnings.join(" / ")));
    }
    let geyser = plan
        .geyser
        .ok_or_else(|| AppError::Other("Geyser配布情報を取得できません".into()))?;
    let mut selected = vec![(geyser, "spigot")];
    if input.include_floodgate {
        selected.push((
            plan.floodgate
                .ok_or_else(|| AppError::Other("Floodgate配布情報を取得できません".into()))?,
            "spigot",
        ));
    }
    let plugins = Path::new(&profile.root_path).join("plugins");
    std::fs::create_dir_all(&plugins)?;
    let management = Path::new(&profile.root_path).join(".server-hub");
    std::fs::create_dir_all(&management)?;
    if management.join("crossplay.json").is_file() {
        return Err(AppError::Validation(
            "クロスプレイ構成はすでに登録されています。既存構成を確認してから更新してください"
                .into(),
        ));
    }
    for (component, _) in &selected {
        if plugins.join(&component.file_name).exists() {
            return Err(AppError::Validation(format!(
                "{} はすでにあります。更新は安全ツールから行ってください",
                component.file_name
            )));
        }
    }
    let staging = Path::new(&profile.root_path)
        .join(".server-hub")
        .join(format!("crossplay-staging-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&staging)?;
    let mut staged = Vec::new();
    for (component, download) in &selected {
        let target = staging.join(&component.file_name);
        if let Err(error) = download_component(
            client,
            &component.project,
            component.build,
            download,
            &component.sha256,
            &target,
        )
        .await
        {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error);
        }
        staged.push((component.file_name.clone(), target));
    }
    let backup = match backup::create(backups_root, profile, "before-crossplay-install") {
        Ok(backup) => backup,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    let mut installed = Vec::new();
    for (file_name, source) in staged {
        let target = plugins.join(&file_name);
        if let Err(error) = std::fs::rename(&source, &target) {
            for previous in &installed {
                let _ = std::fs::remove_file(plugins.join(previous));
            }
            let _ = std::fs::remove_dir_all(&staging);
            return Err(error.into());
        }
        installed.push(file_name);
    }
    let _ = std::fs::remove_dir_all(&staging);
    let installed_files = installed.clone();
    let metadata = serde_json::json!({
        "bedrockPort": input.bedrock_port,
        "includeFloodgate": input.include_floodgate,
        "installedFiles": installed,
        "source": "download.geysermc.org",
        "installedAt": chrono::Utc::now().to_rfc3339(),
        "configurationStatus": "restart-required"
    });
    let metadata_path = management.join("crossplay.json");
    let metadata_staging = management.join(format!("crossplay-{}.json.part", uuid::Uuid::new_v4()));
    let metadata_result = (|| -> AppResult<()> {
        let mut metadata_file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&metadata_staging)?;
        metadata_file.write_all(&serde_json::to_vec_pretty(&metadata)?)?;
        metadata_file.sync_all()?;
        std::fs::rename(&metadata_staging, &metadata_path)?;
        Ok(())
    })();
    if let Err(error) = metadata_result {
        let _ = std::fs::remove_file(&metadata_staging);
        for file in &installed_files {
            let _ = std::fs::remove_file(plugins.join(file));
        }
        return Err(error);
    }
    Ok(CrossplayInstallResult {
        backup,
        installed_files,
        bedrock_port: input.bedrock_port,
        restart_required: true,
        message: "GeyserMC公式配布物をハッシュ検証して追加しました。再起動後に生成される設定とUDP接続を確認してください".into(),
    })
}

async fn fetch_component(
    client: &Client,
    project: &str,
    download: &str,
    installed_path: PathBuf,
) -> AppResult<CrossplayComponent> {
    let response: BuildResponse = client
        .get(format!(
            "{API_ROOT}/{project}/versions/latest/builds/latest"
        ))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let info = response
        .downloads
        .get(download)
        .ok_or_else(|| AppError::Other(format!("{project}に{download}配布物がありません")))?;
    if info.name.is_empty()
        || !info.name.ends_with(".jar")
        || !info
            .name
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_' | '.'))
        || info.sha256.len() != 64
    {
        return Err(AppError::Validation(
            "GeyserMC公式APIの配布情報が安全条件を満たしません".into(),
        ));
    }
    Ok(CrossplayComponent {
        project: project.into(),
        version: response.version,
        build: response.build,
        file_name: info.name.clone(),
        sha256: info.sha256.to_ascii_lowercase(),
        installed: installed_path.is_file(),
    })
}

async fn download_component(
    client: &Client,
    project: &str,
    build: u64,
    download: &str,
    expected: &str,
    destination: &Path,
) -> AppResult<()> {
    let url = format!("{API_ROOT}/{project}/versions/latest/builds/{build}/downloads/{download}");
    let response = client.get(&url).send().await?.error_for_status()?;
    if response.url().scheme() != "https"
        || response.url().host_str() != Some("download.geysermc.org")
    {
        return Err(AppError::Validation(
            "GeyserMC公式配布元以外への転送を拒否しました".into(),
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_COMPONENT_BYTES)
    {
        return Err(AppError::Validation(
            "クロスプレイ構成ファイルが64 MiBを超えています".into(),
        ));
    }
    let bytes = response.bytes().await?;
    if bytes.is_empty()
        || bytes.len() as u64 > MAX_COMPONENT_BYTES
        || hex::encode(Sha256::digest(&bytes)) != expected
    {
        return Err(AppError::Validation(
            "GeyserMC配布ファイルのSHA-256を確認できませんでした".into(),
        ));
    }
    std::fs::write(destination, bytes)?;
    Ok(())
}

fn validate_port(profile: &ServerProfile, bedrock_port: u16) -> AppResult<()> {
    if !(1024..=65535).contains(&bedrock_port) || bedrock_port == profile.port {
        return Err(AppError::Validation(
            "Bedrock用UDPポートはJava/管理ポートと異なる1024～65535を指定してください".into(),
        ));
    }
    Ok(())
}

fn version_at_least(value: &str, major: u32, minor: u32, patch: u32) -> bool {
    let values = value
        .split('.')
        .take(3)
        .map(|part| part.parse::<u32>().unwrap_or_default())
        .collect::<Vec<_>>();
    if values.first().copied().unwrap_or_default() >= 26 {
        return true;
    }
    (
        values.first().copied().unwrap_or_default(),
        values.get(1).copied().unwrap_or_default(),
        values.get(2).copied().unwrap_or_default(),
    ) >= (major, minor, patch)
}

#[cfg(test)]
mod tests {
    use super::{configure, registered_bedrock_port, status, validate_port, version_at_least};
    use crate::models::{BasicSettings, ServerProfile};

    fn profile() -> ServerProfile {
        ServerProfile {
            id: "x".into(),
            name: "x".into(),
            root_path: "C:\\x".into(),
            game_kind: "minecraft".into(),
            server_type: "paper".into(),
            minecraft_version: "1.21.11".into(),
            distribution_build: None,
            launch_target: "server.jar".into(),
            java_path: "java.exe".into(),
            java_major: 21,
            min_memory_mib: 1024,
            max_memory_mib: 2048,
            port: 25565,
            eula_accepted_at: "x".into(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: None,
            created_at: "x".into(),
            updated_at: "x".into(),
        }
    }

    #[test]
    fn checks_supported_versions_and_port_conflicts() {
        assert!(version_at_least("1.20.5", 1, 20, 5));
        assert!(version_at_least("26.2", 1, 20, 5));
        assert!(!version_at_least("1.20.4", 1, 20, 5));
        assert!(validate_port(&profile(), 19132).is_ok());
        assert!(validate_port(&profile(), 25565).is_err());
        assert!(validate_port(&profile(), 32145).is_ok());
    }

    #[test]
    fn reads_only_a_bounded_valid_registered_crossplay_port() {
        let base =
            std::env::temp_dir().join(format!("msh-crossplay-port-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(base.join(".server-hub")).unwrap();
        std::fs::write(
            base.join(".server-hub/crossplay.json"),
            br#"{"bedrockPort":19132,"configurationStatus":"restart-required"}"#,
        )
        .unwrap();
        let mut current = profile();
        current.root_path = base.display().to_string();
        assert_eq!(registered_bedrock_port(&current), Some(19132));
        std::fs::write(
            base.join(".server-hub/crossplay.json"),
            br#"{"bedrockPort":25565}"#,
        )
        .unwrap();
        assert_eq!(registered_bedrock_port(&current), None);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn safely_configures_the_registered_geyser_port_and_floodgate_auth() {
        let base =
            std::env::temp_dir().join(format!("msh-crossplay-config-{}", uuid::Uuid::new_v4()));
        let backups = base.join("backups");
        let server = base.join("server");
        std::fs::create_dir_all(server.join(".server-hub")).unwrap();
        std::fs::create_dir_all(server.join("plugins/Geyser-Spigot")).unwrap();
        std::fs::create_dir_all(&backups).unwrap();
        std::fs::write(server.join("server.properties"), "online-mode=true\n").unwrap();
        std::fs::write(server.join("plugins/floodgate-spigot.jar"), b"test").unwrap();
        std::fs::write(
            server.join(".server-hub/crossplay.json"),
            br#"{"bedrockPort":19142,"includeFloodgate":true,"installedFiles":["floodgate-spigot.jar"]}"#,
        ).unwrap();
        std::fs::write(
            server.join("plugins/Geyser-Spigot/config.yml"),
            "bedrock:\n  address: 0.0.0.0\n  port: 19132\n  clone-remote-port: true\nremote:\n  auth-type: online\n",
        ).unwrap();
        let mut current = profile();
        current.root_path = server.display().to_string();
        let result = configure(&backups, &current).unwrap();
        assert_eq!(result.bedrock_port, 19142);
        assert!(result.floodgate_enabled);
        let configured =
            std::fs::read_to_string(server.join("plugins/Geyser-Spigot/config.yml")).unwrap();
        assert!(configured.contains("port: 19142"));
        assert!(configured.contains("clone-remote-port: false"));
        assert!(configured.contains("auth-type: floodgate"));
        assert!(status(&current).configuration_ready);
        std::fs::remove_dir_all(base).unwrap();
    }
}
