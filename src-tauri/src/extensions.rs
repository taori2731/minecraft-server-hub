use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs::File,
    io::Read,
    path::{Component, Path, PathBuf},
};

use serde::Deserialize;
use sha2::{Digest, Sha256, Sha512};
use walkdir::WalkDir;
use zip::ZipArchive;

use crate::{
    backup,
    error::{AppError, AppResult},
    models::{
        ExtensionInfo, ExtensionInstallItem, ExtensionInstallPlan, ExtensionVersionOption,
        ServerProfile, UpdateCenterItem,
    },
};

const MODRINTH_API: &str = "https://api.modrinth.com/v2";
const MAX_INSTALL_ITEMS: usize = 32;
const MAX_SINGLE_FILE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
const MAX_BEDROCK_ARCHIVE_FILES: usize = 4_096;

#[derive(Debug, Deserialize)]
struct SearchResponse {
    hits: Vec<SearchHit>,
}

#[derive(Debug, Deserialize, serde::Serialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct SearchHit {
    pub project_id: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub versions: Vec<String>,
    pub all_project_types: Vec<String>,
    pub categories: Vec<String>,
    pub environment: Vec<String>,
    pub icon_url: Option<String>,
    #[serde(default)]
    pub downloads: u64,
    #[serde(default = "modrinth_provider")]
    pub provider: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
}

fn modrinth_provider() -> String {
    "modrinth".into()
}

#[derive(Debug, Clone, Deserialize)]
struct ModrinthVersion {
    id: String,
    project_id: String,
    name: String,
    version_number: String,
    version_type: String,
    date_published: String,
    #[serde(default)]
    dependencies: Vec<ModrinthDependency>,
    #[serde(default)]
    game_versions: Vec<String>,
    #[serde(default)]
    loaders: Vec<String>,
    environment: String,
    #[serde(default)]
    files: Vec<ModrinthFile>,
}

#[derive(Debug, Clone, Deserialize)]
struct ModrinthDependency {
    version_id: Option<String>,
    project_id: Option<String>,
    file_name: Option<String>,
    dependency_type: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ModrinthFile {
    hashes: HashMap<String, String>,
    url: String,
    filename: String,
    primary: bool,
    size: u64,
    file_type: Option<String>,
}

#[derive(Debug, Clone)]
struct ResolvedInstallItem {
    public: ExtensionInstallItem,
    url: String,
    sha512: String,
    sha1: String,
}

#[derive(Debug, Clone)]
struct ResolvedInstallPlan {
    public: ExtensionInstallPlan,
    files: Vec<ResolvedInstallItem>,
}

pub async fn search_modrinth(
    client: &reqwest::Client,
    profile: &ServerProfile,
    query: &str,
    kind: &str,
) -> AppResult<Vec<SearchHit>> {
    reject_bedrock_catalog(profile)?;
    validate_kind(profile, kind)?;
    let project_type = project_type(kind);
    let loader = loader_for(profile, kind);
    let facets = serde_json::json!([
        [format!("versions:{}", profile.minecraft_version)],
        [format!("project_type:{project_type}")],
        [format!("categories:{loader}")]
    ])
    .to_string();
    let query = query.trim();
    let index = catalog_index(query);
    let response: SearchResponse = client
        .get(format!("{MODRINTH_API}/search"))
        .query(&[
            ("query", query),
            ("facets", facets.as_str()),
            ("index", index),
            ("limit", "20"),
        ])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(response.hits)
}

fn catalog_index(query: &str) -> &'static str {
    if query.trim().is_empty() {
        "downloads"
    } else {
        "relevance"
    }
}

pub async fn list_modrinth_versions(
    client: &reqwest::Client,
    profile: &ServerProfile,
    project_id: &str,
    kind: &str,
) -> AppResult<Vec<ExtensionVersionOption>> {
    reject_bedrock_catalog(profile)?;
    validate_kind(profile, kind)?;
    validate_remote_id(project_id)?;
    let versions = fetch_project_versions(client, profile, project_id, kind).await?;
    let mut options = Vec::new();
    for version in versions {
        let file = select_primary_file(&version, kind)?;
        options.push(ExtensionVersionOption {
            id: version.id.clone(),
            name: version.name.clone(),
            version_number: version.version_number.clone(),
            release_channel: version.version_type.clone(),
            published_at: version.date_published.clone(),
            file_name: file.filename.clone(),
            size_bytes: file.size,
            required_dependency_count: version
                .dependencies
                .iter()
                .filter(|item| item.dependency_type == "required")
                .count(),
            client_requirement: client_requirement(&version.environment, kind),
        });
    }
    Ok(options)
}

pub async fn plan_modrinth_install(
    client: &reqwest::Client,
    profile: &ServerProfile,
    version_id: &str,
    kind: &str,
) -> AppResult<ExtensionInstallPlan> {
    reject_bedrock_catalog(profile)?;
    Ok(resolve_modrinth_install(client, profile, version_id, kind)
        .await?
        .public)
}

pub async fn install_modrinth(
    client: &reqwest::Client,
    backups_root: &Path,
    profile: &ServerProfile,
    version_id: &str,
    kind: &str,
) -> AppResult<ExtensionInstallPlan> {
    reject_bedrock_catalog(profile)?;
    let resolved = resolve_modrinth_install(client, profile, version_id, kind).await?;
    let staging_parent = backups_root
        .parent()
        .unwrap_or(backups_root)
        .join("extension-staging");
    std::fs::create_dir_all(&staging_parent)?;
    let staging = staging_parent.join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&staging)?;
    let result = install_resolved(client, backups_root, profile, kind, &resolved, &staging).await;
    let _ = std::fs::remove_dir_all(&staging);
    result.map(|_| resolved.public)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ManagedManifest {
    file_name: String,
    kind: String,
    provider: Option<String>,
    project_id: Option<String>,
    version_id: Option<String>,
    version_number: Option<String>,
    #[serde(default)]
    dependency: bool,
}

pub async fn scan_managed_updates(
    client: &reqwest::Client,
    profile: &ServerProfile,
) -> AppResult<(Vec<UpdateCenterItem>, Vec<String>)> {
    if profile.server_type == "bedrock" {
        return Ok((Vec::new(), Vec::new()));
    }
    let manifests = read_managed_manifests(profile)?;
    let mut items = Vec::new();
    let mut managed_names = HashSet::new();
    for (_, manifest) in &manifests {
        managed_names.insert(manifest.file_name.to_ascii_lowercase());
        if manifest.dependency {
            continue;
        }
        let (Some(project_id), Some(current_id)) = (
            manifest.project_id.as_deref(),
            manifest.version_id.as_deref(),
        ) else {
            continue;
        };
        if manifest.provider.as_deref() != Some("modrinth") {
            continue;
        }
        let versions = list_modrinth_versions(client, profile, project_id, &manifest.kind).await?;
        let source = "Modrinth";
        let Some(latest) = versions.first() else {
            continue;
        };
        if latest.id == current_id {
            continue;
        }
        items.push(UpdateCenterItem {
            id: format!(
                "extension:{}:{project_id}",
                manifest.provider.as_deref().unwrap_or("unknown")
            ),
            kind: manifest.kind.clone(),
            name: manifest.file_name.clone(),
            current_version: manifest
                .version_number
                .clone()
                .unwrap_or_else(|| "不明".into()),
            available_version: latest.version_number.clone(),
            source: source.into(),
            managed: true,
            selectable: true,
            requires_client_update: latest.client_requirement.contains("参加者側")
                || latest.client_requirement.contains("クライアント"),
            note: latest.client_requirement.clone(),
            project_id: Some(project_id.into()),
            version_id: Some(latest.id.clone()),
            extension_kind: Some(manifest.kind.clone()),
        });
    }
    let unmanaged = list(profile)?
        .into_iter()
        .filter(|item| {
            item.enabled && !managed_names.contains(&item.file_name.to_ascii_lowercase())
        })
        .map(|item| item.file_name)
        .collect();
    Ok((items, unmanaged))
}

pub async fn update_managed_modrinth(
    client: &reqwest::Client,
    backups_root: &Path,
    profile: &ServerProfile,
    project_id: &str,
    version_id: &str,
    kind: &str,
) -> AppResult<ExtensionInstallPlan> {
    validate_remote_id(project_id)?;
    let resolved = resolve_modrinth_install(client, profile, version_id, kind).await?;
    if resolved
        .public
        .items
        .first()
        .is_none_or(|item| item.project_id != project_id)
    {
        return Err(AppError::Validation(
            "選択した更新候補と配布元の応答が一致しません".into(),
        ));
    }
    let existing = read_managed_manifests(profile)?;
    if !existing
        .iter()
        .any(|(_, item)| item.project_id.as_deref() == Some(project_id) && item.kind == kind)
    {
        return Err(AppError::Validation(
            "この項目はModrinthから管理導入されたファイルではありません".into(),
        ));
    }
    let backup_info = backup::create(backups_root, profile, "before-extension-update")?;
    let staging_parent = backups_root
        .parent()
        .unwrap_or(backups_root)
        .join("extension-staging");
    std::fs::create_dir_all(&staging_parent)?;
    let staging = staging_parent.join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&staging)?;
    for item in &resolved.files {
        download_verified(client, item, &staging.join(&item.public.file_name)).await?;
    }
    let affected_projects = resolved
        .files
        .iter()
        .map(|item| item.public.project_id.as_str())
        .collect::<HashSet<_>>();
    for (manifest_path, manifest) in existing {
        if !affected_projects.contains(manifest.project_id.as_deref().unwrap_or_default()) {
            continue;
        }
        let folder = target_folder(profile, &manifest.kind)?;
        let file = folder.join(&manifest.file_name);
        if file.is_file() {
            std::fs::remove_file(file)?;
        }
        let _ = std::fs::remove_file(manifest_path);
    }
    let result = install_resolved(client, backups_root, profile, kind, &resolved, &staging).await;
    let _ = std::fs::remove_dir_all(&staging);
    if let Err(error) = result {
        let _ = backup::restore(backups_root, profile, &backup_info.id);
        return Err(error);
    }
    Ok(resolved.public)
}

fn read_managed_manifests(profile: &ServerProfile) -> AppResult<Vec<(PathBuf, ManagedManifest)>> {
    let folder = Path::new(&profile.root_path).join(".server-hub/extension-manifests");
    if !folder.is_dir() {
        return Ok(Vec::new());
    }
    let mut values = Vec::new();
    for entry in std::fs::read_dir(folder)?.flatten() {
        if !entry.file_type().is_ok_and(|value| value.is_file()) {
            continue;
        }
        let Ok(bytes) = std::fs::read(entry.path()) else {
            continue;
        };
        if let Ok(value) = serde_json::from_slice::<ManagedManifest>(&bytes) {
            values.push((entry.path(), value));
        }
    }
    Ok(values)
}

async fn install_resolved(
    client: &reqwest::Client,
    backups_root: &Path,
    profile: &ServerProfile,
    kind: &str,
    resolved: &ResolvedInstallPlan,
    staging: &Path,
) -> AppResult<()> {
    let destination_folder = target_folder(profile, kind)?;
    std::fs::create_dir_all(&destination_folder)?;
    for item in &resolved.files {
        validate_file_name(&item.public.file_name)?;
        if destination_folder.join(&item.public.file_name).exists() {
            return Err(AppError::Validation(format!(
                "{} はすでに存在します。更新は更新フローから行ってください",
                item.public.file_name
            )));
        }
        download_verified(client, item, &staging.join(&item.public.file_name)).await?;
    }

    let _backup = backup::create(backups_root, profile, "before-catalog-install")?;
    let manifest_dir = Path::new(&profile.root_path)
        .join(".server-hub")
        .join("extension-manifests");
    std::fs::create_dir_all(&manifest_dir)?;
    let mut created: Vec<PathBuf> = Vec::new();
    let mut created_manifests: Vec<PathBuf> = Vec::new();
    for item in &resolved.files {
        let source = staging.join(&item.public.file_name);
        let temporary = destination_folder.join(format!("{}.download", item.public.file_name));
        let destination = destination_folder.join(&item.public.file_name);
        if let Err(error) = std::fs::copy(&source, &temporary)
            .and_then(|_| std::fs::rename(&temporary, &destination))
        {
            let _ = std::fs::remove_file(&temporary);
            for path in &created {
                let _ = std::fs::remove_file(path);
            }
            for path in &created_manifests {
                let _ = std::fs::remove_file(path);
            }
            return Err(error.into());
        }
        created.push(destination.clone());
        let manifest = serde_json::json!({
            "fileName": item.public.file_name, "kind": kind, "provider": "modrinth",
            "projectId": item.public.project_id, "versionId": item.public.version_id,
            "versionNumber": item.public.version_number, "sha512": item.sha512,
            "sha1": item.sha1, "dependency": item.public.dependency,
        });
        let manifest_path = manifest_dir.join(format!("{}.json", item.sha512));
        if let Err(error) = std::fs::write(&manifest_path, serde_json::to_vec_pretty(&manifest)?) {
            for path in &created {
                let _ = std::fs::remove_file(path);
            }
            for path in &created_manifests {
                let _ = std::fs::remove_file(path);
            }
            return Err(error.into());
        }
        created_manifests.push(manifest_path);
    }
    Ok(())
}

async fn download_verified(
    client: &reqwest::Client,
    item: &ResolvedInstallItem,
    destination: &Path,
) -> AppResult<()> {
    let url = reqwest::Url::parse(&item.url)
        .map_err(|_| AppError::Validation("配布元のダウンロードURLが正しくありません".into()))?;
    if url.scheme() != "https" || url.host_str() != Some("cdn.modrinth.com") {
        return Err(AppError::Validation(
            "Modrinth公式CDN以外のダウンロードURLは安全のため拒否しました".into(),
        ));
    }
    let mut response = client.get(url).send().await?.error_for_status()?;
    if response.url().scheme() != "https" || response.url().host_str() != Some("cdn.modrinth.com") {
        return Err(AppError::Validation(
            "ダウンロードが公式CDN以外へ転送されたため拒否しました".into(),
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_SINGLE_FILE_BYTES || length != item.public.size_bytes)
    {
        return Err(AppError::Validation(
            "配布元が示したファイル容量と実際の応答が一致しません".into(),
        ));
    }
    let mut bytes = Vec::with_capacity(item.public.size_bytes.min(MAX_SINGLE_FILE_BYTES) as usize);
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() as u64 + chunk.len() as u64 > item.public.size_bytes
            || bytes.len() as u64 + chunk.len() as u64 > MAX_SINGLE_FILE_BYTES
        {
            return Err(AppError::Validation(
                "ダウンロード容量が配布元情報を超えたため中止しました".into(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    if bytes.len() as u64 != item.public.size_bytes {
        return Err(AppError::Validation(
            "ダウンロードしたファイル容量を検証できませんでした".into(),
        ));
    }
    let actual_sha512 = hex::encode(Sha512::digest(&bytes));
    let actual_sha1 = hex::encode(sha1::Sha1::digest(&bytes));
    if !actual_sha512.eq_ignore_ascii_case(&item.sha512)
        || (!item.sha1.is_empty() && !actual_sha1.eq_ignore_ascii_case(&item.sha1))
    {
        return Err(AppError::Validation(
            "ダウンロードしたファイルのハッシュが配布元情報と一致しません".into(),
        ));
    }
    std::fs::write(destination, bytes)?;
    Ok(())
}

async fn resolve_modrinth_install(
    client: &reqwest::Client,
    profile: &ServerProfile,
    version_id: &str,
    kind: &str,
) -> AppResult<ResolvedInstallPlan> {
    validate_kind(profile, kind)?;
    validate_remote_id(version_id)?;
    let first = fetch_version(client, version_id).await?;
    validate_version(profile, &first, kind)?;
    let mut queue = VecDeque::from([(first, false)]);
    let mut visited_versions = HashSet::new();
    let mut selected_projects = HashMap::<String, String>::new();
    let mut files = Vec::new();
    let mut warnings = Vec::new();
    let mut root_client_requirement = String::new();

    while let Some((version, dependency)) = queue.pop_front() {
        if !visited_versions.insert(version.id.clone()) {
            continue;
        }
        if visited_versions.len() > MAX_INSTALL_ITEMS {
            return Err(AppError::Validation(
                "必須依存が32件を超えるため、自動導入を中止しました".into(),
            ));
        }
        validate_version(profile, &version, kind)?;
        if let Some(previous) =
            selected_projects.insert(version.project_id.clone(), version.id.clone())
        {
            if previous != version.id {
                return Err(AppError::Validation(format!(
                    "同じ依存Modに異なるバージョンが要求されています: {}",
                    version.project_id
                )));
            }
        }
        let selected = select_primary_file(&version, kind)?;
        let sha512 = selected
            .hashes
            .get("sha512")
            .cloned()
            .ok_or_else(|| AppError::Validation("配布ファイルにSHA-512がありません".into()))?;
        let sha1 = selected.hashes.get("sha1").cloned().unwrap_or_default();
        if selected.size > MAX_SINGLE_FILE_BYTES {
            return Err(AppError::Validation(format!(
                "{} は安全上限256 MiBを超えています",
                selected.filename
            )));
        }
        if !dependency {
            root_client_requirement = client_requirement(&version.environment, kind);
        }
        files.push(ResolvedInstallItem {
            public: ExtensionInstallItem {
                project_id: version.project_id.clone(),
                version_id: version.id.clone(),
                file_name: selected.filename.clone(),
                version_number: version.version_number.clone(),
                size_bytes: selected.size,
                dependency,
            },
            url: selected.url.clone(),
            sha512,
            sha1,
        });

        for relation in &version.dependencies {
            match relation.dependency_type.as_str() {
                "required" => {
                    let required = if let Some(id) = relation.version_id.as_deref() {
                        validate_remote_id(id)?;
                        fetch_version(client, id).await?
                    } else if let Some(project_id) = relation.project_id.as_deref() {
                        validate_remote_id(project_id)?;
                        fetch_project_versions(client, profile, project_id, kind)
                            .await?
                            .into_iter()
                            .next()
                            .ok_or_else(|| {
                                AppError::Validation(format!(
                                    "必須依存 {} に対応版がありません",
                                    project_id
                                ))
                            })?
                    } else {
                        warnings.push(format!(
                            "外部依存 {} は自動取得できません。配布元で確認してください",
                            relation.file_name.as_deref().unwrap_or("不明")
                        ));
                        continue;
                    };
                    queue.push_back((required, true));
                }
                "optional" => warnings.push(format!(
                    "任意依存があります: {}",
                    relation
                        .project_id
                        .as_deref()
                        .or(relation.file_name.as_deref())
                        .unwrap_or("不明")
                )),
                "incompatible" => warnings.push(format!(
                    "競合指定があります: {}。導入済み構成を確認してください",
                    relation
                        .project_id
                        .as_deref()
                        .or(relation.file_name.as_deref())
                        .unwrap_or("不明")
                )),
                _ => {}
            }
        }
    }

    let total_size_bytes = files.iter().map(|item| item.public.size_bytes).sum::<u64>();
    if total_size_bytes > MAX_TOTAL_BYTES {
        return Err(AppError::Validation(
            "導入合計が安全上限512 MiBを超えています".into(),
        ));
    }
    let mut file_names = HashSet::new();
    if files
        .iter()
        .any(|item| !file_names.insert(item.public.file_name.to_ascii_lowercase()))
    {
        return Err(AppError::Validation(
            "導入予定に同名ファイルが複数あるため自動導入を中止しました".into(),
        ));
    }
    let items = files.iter().map(|item| item.public.clone()).collect();
    Ok(ResolvedInstallPlan {
        public: ExtensionInstallPlan {
            provider: "modrinth".into(),
            minecraft_version: profile.minecraft_version.clone(),
            loader: loader_for(profile, kind).into(),
            kind: kind.into(),
            items,
            total_size_bytes,
            warnings,
            client_requirement: root_client_requirement,
        },
        files,
    })
}

async fn fetch_project_versions(
    client: &reqwest::Client,
    profile: &ServerProfile,
    project_id: &str,
    kind: &str,
) -> AppResult<Vec<ModrinthVersion>> {
    let loaders = serde_json::json!([loader_for(profile, kind)]).to_string();
    let game_versions = serde_json::json!([profile.minecraft_version]).to_string();
    let versions: Vec<ModrinthVersion> = client
        .get(format!("{MODRINTH_API}/project/{project_id}/version"))
        .query(&[("loaders", loaders), ("game_versions", game_versions)])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(versions
        .into_iter()
        .filter(|version| validate_version(profile, version, kind).is_ok())
        .collect())
}

async fn fetch_version(client: &reqwest::Client, version_id: &str) -> AppResult<ModrinthVersion> {
    Ok(client
        .get(format!("{MODRINTH_API}/version/{version_id}"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?)
}

fn validate_version(
    profile: &ServerProfile,
    version: &ModrinthVersion,
    kind: &str,
) -> AppResult<()> {
    let loader = loader_for(profile, kind);
    if !version
        .game_versions
        .iter()
        .any(|item| item == &profile.minecraft_version)
        || !version.loaders.iter().any(|item| item == loader)
    {
        return Err(AppError::Validation(format!(
            "{} / {} に一致しない配布ファイルです",
            profile.minecraft_version, loader
        )));
    }
    if matches!(
        version.environment.as_str(),
        "client_only" | "singleplayer_only"
    ) {
        return Err(AppError::Validation(
            "クライアント専用のためサーバーには導入できません".into(),
        ));
    }
    select_primary_file(version, kind)?;
    Ok(())
}

fn select_primary_file<'a>(
    version: &'a ModrinthVersion,
    kind: &str,
) -> AppResult<&'a ModrinthFile> {
    let expected = if kind == "datapack" { "zip" } else { "jar" };
    version
        .files
        .iter()
        .filter(|file| {
            file.file_type
                .as_deref()
                .is_none_or(|value| value == "unknown")
                && Path::new(&file.filename)
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case(expected))
        })
        .max_by_key(|file| file.primary)
        .ok_or_else(|| AppError::Validation(format!("導入可能な{expected}ファイルがありません")))
}

fn client_requirement(environment: &str, kind: &str) -> String {
    if kind != "mod" {
        return "通常はサーバー側だけで利用できます。".into();
    }
    match environment {
        "client_and_server" | "client_or_server_prefers_both" => {
            "参加者側にも同じModが必要です。".into()
        }
        "server_only" | "dedicated_server_only" | "server_only_client_optional" => {
            "サーバー側のみで利用できます。".into()
        }
        _ => "参加者側にも必要な可能性があります。配布元の説明を確認してください。".into(),
    }
}

fn project_type(kind: &str) -> &'static str {
    match kind {
        "plugin" => "plugin",
        "datapack" => "datapack",
        _ => "mod",
    }
}
fn loader_for<'a>(profile: &'a ServerProfile, kind: &str) -> &'a str {
    match kind {
        "plugin" => "paper",
        "datapack" => "datapack",
        _ => profile.server_type.as_str(),
    }
}

fn validate_remote_id(value: &str) -> AppResult<()> {
    if (3..=64).contains(&value.len())
        && value
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-' || value == '_')
    {
        Ok(())
    } else {
        Err(AppError::Validation("配布元IDが正しくありません".into()))
    }
}

fn reject_bedrock_catalog(profile: &ServerProfile) -> AppResult<()> {
    if profile.game_kind == "palworld" || profile.server_type == "palworld" {
        return Err(AppError::Validation(
            "PW0～PW2ではPalworldのMod管理に対応していません".into(),
        ));
    }
    if profile.server_type == "bedrock" {
        Err(AppError::Validation("ModrinthのJava版Modは統合版専用サーバーへ導入できません。公式に入手したBehavior Pack／Resource Pack／Add-onをファイルから追加してください".into()))
    } else {
        Ok(())
    }
}

pub fn list(profile: &ServerProfile) -> AppResult<Vec<ExtensionInfo>> {
    let mut items = Vec::new();
    if profile.server_type == "bedrock" {
        let managed = managed_bedrock_pack_uuids(Path::new(&profile.root_path))?;
        for kind in allowed_kinds(profile) {
            let active_references = active_bedrock_pack_uuids(profile, kind)?;
            collect_bedrock_folder(
                &target_folder(profile, kind)?,
                kind,
                true,
                profile,
                &managed,
                &active_references,
                &mut items,
            )?;
            let disabled = safe_server_directory(
                Path::new(&profile.root_path),
                &Path::new(".server-hub").join("disabled").join(kind),
                false,
            )?;
            collect_bedrock_folder(
                &disabled,
                kind,
                false,
                profile,
                &managed,
                &HashSet::new(),
                &mut items,
            )?;
        }
        items.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.file_name.cmp(&b.file_name)));
        return Ok(items);
    }
    for kind in allowed_kinds(profile) {
        collect_folder(
            &target_folder(profile, kind)?,
            kind,
            true,
            profile,
            &mut items,
        )?;
        let disabled = if profile.server_type == "bedrock" {
            safe_server_directory(
                Path::new(&profile.root_path),
                &Path::new(".server-hub").join("disabled").join(kind),
                false,
            )?
        } else {
            Path::new(&profile.root_path)
                .join(".server-hub")
                .join("disabled")
                .join(kind)
        };
        collect_folder(&disabled, kind, false, profile, &mut items)?;
    }
    items.sort_by(|a, b| a.kind.cmp(&b.kind).then(a.file_name.cmp(&b.file_name)));
    Ok(items)
}

pub fn install_local(
    profile: &ServerProfile,
    source: &str,
    kind: &str,
) -> AppResult<ExtensionInfo> {
    validate_kind(profile, kind)?;
    let source = PathBuf::from(source);
    if !source.is_absolute() || !source.is_file() {
        return Err(AppError::Validation(
            "追加するファイルが見つかりません".into(),
        ));
    }
    if profile.server_type == "bedrock" {
        return install_bedrock_local(profile, &source, kind);
    }
    let extension = source
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if (kind == "datapack" && extension != "zip") || (kind != "datapack" && extension != "jar") {
        return Err(AppError::Validation(if kind == "datapack" {
            "データパックはZIPファイルを選択してください".into()
        } else {
            "Mod／プラグインはJARファイルを選択してください".into()
        }));
    }
    let file_name = source
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(|| AppError::Validation("ファイル名が正しくありません".into()))?;
    validate_file_name(file_name)?;
    let destination_folder = target_folder(profile, kind)?;
    std::fs::create_dir_all(&destination_folder)?;
    let destination = destination_folder.join(file_name);
    if destination.exists() {
        return Err(AppError::Validation(
            "同名の拡張機能がすでにあります".into(),
        ));
    }
    let bytes = std::fs::read(&source)?;
    let hash = hex::encode(Sha256::digest(&bytes));
    let temporary = destination.with_extension(format!("{}.part", extension));
    std::fs::write(&temporary, &bytes)?;
    std::fs::rename(&temporary, &destination)?;
    let manifest_dir = Path::new(&profile.root_path)
        .join(".server-hub")
        .join("extension-manifests");
    std::fs::create_dir_all(&manifest_dir)?;
    std::fs::write(
        manifest_dir.join(format!("{hash}.json")),
        serde_json::to_vec_pretty(
            &serde_json::json!({"fileName": file_name, "kind": kind, "sha256": hash, "source": "local-file"}),
        )?,
    )?;
    describe_file(profile, &destination, kind, true, true)
}

pub fn set_enabled(
    profile: &ServerProfile,
    file_name: &str,
    kind: &str,
    enabled: bool,
) -> AppResult<()> {
    validate_kind(profile, kind)?;
    validate_file_name(file_name)?;
    let active = target_folder(profile, kind)?.join(file_name);
    let disabled_folder = safe_server_directory(
        Path::new(&profile.root_path),
        &Path::new(".server-hub").join("disabled").join(kind),
        true,
    )?;
    let disabled = disabled_folder.join(file_name);
    let (source, destination) = if enabled {
        (disabled, active)
    } else {
        (active, disabled)
    };
    if !(source.is_file() || (profile.server_type == "bedrock" && source.is_dir())) {
        return Err(AppError::NotFound);
    }
    if destination.exists() {
        return Err(AppError::Validation(
            "移動先に同名ファイルがあります".into(),
        ));
    }
    if profile.server_type == "bedrock" {
        ensure_bedrock_pack_manageable(profile, &source)?;
        set_bedrock_pack_reference(profile, &source, kind, enabled)?;
        if let Err(error) = std::fs::rename(&source, &destination) {
            let _ = set_bedrock_pack_reference(profile, &source, kind, !enabled);
            return Err(error.into());
        }
    } else {
        std::fs::rename(source, destination)?;
    }
    Ok(())
}

pub fn remove(profile: &ServerProfile, file_name: &str, kind: &str) -> AppResult<()> {
    validate_kind(profile, kind)?;
    validate_file_name(file_name)?;
    let active = target_folder(profile, kind)?.join(file_name);
    let disabled = safe_server_directory(
        Path::new(&profile.root_path),
        &Path::new(".server-hub").join("disabled").join(kind),
        true,
    )?
    .join(file_name);
    let target = if active.exists() { active } else { disabled };
    if profile.server_type == "bedrock" && target.exists() {
        ensure_bedrock_pack_manageable(profile, &target)?;
    }
    if target.is_file() {
        std::fs::remove_file(target)?;
    } else if profile.server_type == "bedrock" && target.is_dir() {
        let active_pack = target.starts_with(target_folder(profile, kind)?);
        if active_pack {
            set_bedrock_pack_reference(profile, &target, kind, false)?;
        }
        if let Err(error) = std::fs::remove_dir_all(&target) {
            if active_pack {
                let _ = set_bedrock_pack_reference(profile, &target, kind, true);
            }
            return Err(error.into());
        }
    } else {
        return Err(AppError::NotFound);
    }
    Ok(())
}

fn collect_folder(
    folder: &Path,
    kind: &str,
    enabled: bool,
    profile: &ServerProfile,
    items: &mut Vec<ExtensionInfo>,
) -> AppResult<()> {
    if !folder.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(folder)?.flatten() {
        let supported = entry.file_type().is_ok_and(|entry_type| {
            entry_type.is_file()
                || (profile.server_type == "bedrock"
                    && entry_type.is_dir()
                    && entry.path().join("manifest.json").is_file())
        });
        if supported {
            items.push(describe_file(profile, &entry.path(), kind, enabled, true)?);
        }
    }
    Ok(())
}

fn describe_file(
    profile: &ServerProfile,
    path: &Path,
    kind: &str,
    enabled: bool,
    manageable: bool,
) -> AppResult<ExtensionInfo> {
    let size_bytes = if path.is_dir() {
        directory_size(path)?
    } else {
        path.metadata()?.len()
    };
    Ok(ExtensionInfo {
        file_name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        kind: kind.into(),
        enabled,
        size_bytes,
        compatibility: if profile.server_type == "bedrock" {
            "manifest.jsonのUUID・バージョン・種別を検証済み".into()
        } else {
            format!(
                "{} / {} として追加。内部メタデータの厳密検証は未実施",
                profile.minecraft_version, profile.server_type
            )
        },
        client_requirement: if matches!(kind, "resource_pack" | "behavior_pack") {
            "ワールド参加時にクライアントへ配布または適用が必要な場合があります。"
        } else if kind == "mod" {
            "Modにより参加者側にも必要です。配布元の説明を確認してください。"
        } else {
            "通常はサーバー側のみです。"
        }
        .into(),
        manageable,
    })
}

fn collect_bedrock_folder(
    folder: &Path,
    kind: &str,
    enabled: bool,
    profile: &ServerProfile,
    managed: &HashSet<String>,
    active_references: &HashSet<String>,
    items: &mut Vec<ExtensionInfo>,
) -> AppResult<()> {
    if !folder.is_dir() {
        return Ok(());
    }
    for entry in std::fs::read_dir(folder)?.flatten() {
        if !entry
            .file_type()
            .is_ok_and(|entry_type| entry_type.is_dir())
            || !entry.path().join("manifest.json").is_file()
        {
            continue;
        }
        let pack = match parse_bedrock_manifest(&entry.path().join("manifest.json")) {
            Ok(pack) if pack.kind == kind => pack,
            _ => continue,
        };
        let manageable = managed.contains(&pack.uuid);
        if !manageable && !active_references.contains(&pack.uuid) {
            continue;
        }
        items.push(describe_file(
            profile,
            &entry.path(),
            kind,
            enabled,
            manageable,
        )?);
    }
    Ok(())
}

fn managed_bedrock_pack_uuids(root: &Path) -> AppResult<HashSet<String>> {
    let manifests = root.join(".server-hub").join("extension-manifests");
    if !manifests.is_dir() {
        return Ok(HashSet::new());
    }
    let mut uuids = HashSet::new();
    for entry in std::fs::read_dir(manifests)?.flatten() {
        if !entry
            .file_type()
            .is_ok_and(|entry_type| entry_type.is_file())
        {
            continue;
        }
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(&std::fs::read(entry.path())?)
        else {
            continue;
        };
        for pack in value
            .get("packs")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(uuid) = pack
                .get("uuid")
                .and_then(serde_json::Value::as_str)
                .filter(|uuid| uuid::Uuid::parse_str(uuid).is_ok())
            {
                uuids.insert(uuid.to_ascii_lowercase());
            }
        }
    }
    Ok(uuids)
}

fn active_bedrock_pack_uuids(profile: &ServerProfile, kind: &str) -> AppResult<HashSet<String>> {
    let file_name = match kind {
        "behavior_pack" => "world_behavior_packs.json",
        "resource_pack" => "world_resource_packs.json",
        _ => return Ok(HashSet::new()),
    };
    let world_name = profile.settings.world_name.trim();
    let mut components = Path::new(world_name).components();
    if world_name.is_empty()
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
    {
        return Ok(HashSet::new());
    }
    let path = Path::new(&profile.root_path)
        .join("worlds")
        .join(world_name)
        .join(file_name);
    if !path.is_file() {
        return Ok(HashSet::new());
    }
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(path)?)?;
    Ok(value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get("pack_id").and_then(serde_json::Value::as_str))
        .filter(|uuid| uuid::Uuid::parse_str(uuid).is_ok())
        .map(str::to_ascii_lowercase)
        .collect())
}

fn ensure_bedrock_pack_manageable(profile: &ServerProfile, pack_root: &Path) -> AppResult<()> {
    let pack = parse_bedrock_manifest(&pack_root.join("manifest.json"))?;
    if managed_bedrock_pack_uuids(Path::new(&profile.root_path))?.contains(&pack.uuid) {
        Ok(())
    } else {
        Err(AppError::Validation(
            "公式BDS同梱または外部追加のパックは保護されています。アプリから追加したパックだけを無効化・削除できます".into(),
        ))
    }
}

fn allowed_kinds(profile: &ServerProfile) -> Vec<&'static str> {
    if profile.game_kind == "palworld" || profile.server_type == "palworld" {
        return Vec::new();
    }
    if profile.server_type == "bedrock" {
        return vec!["behavior_pack", "resource_pack"];
    }
    let mut kinds = vec!["datapack"];
    if profile.server_type == "paper" {
        kinds.push("plugin");
    }
    if matches!(
        profile.server_type.as_str(),
        "fabric" | "forge" | "neoforge"
    ) {
        kinds.push("mod");
    }
    kinds
}
fn validate_kind(profile: &ServerProfile, kind: &str) -> AppResult<()> {
    if allowed_kinds(profile).contains(&kind)
        || (profile.server_type == "bedrock" && kind == "addon")
    {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "{}では{}を追加できません",
            profile.server_type, kind
        )))
    }
}
fn target_folder(profile: &ServerProfile, kind: &str) -> AppResult<PathBuf> {
    validate_kind(profile, kind)?;
    let root = Path::new(&profile.root_path);
    Ok(match kind {
        "plugin" => root.join("plugins"),
        "mod" => root.join("mods"),
        "datapack" => root.join(&profile.settings.world_name).join("datapacks"),
        "behavior_pack" => safe_server_directory(root, Path::new("behavior_packs"), false)?,
        "resource_pack" => safe_server_directory(root, Path::new("resource_packs"), false)?,
        _ => {
            return Err(AppError::Validation(
                "Add-onはBehavior PackまたはResource Packへ展開して追加してください".into(),
            ));
        }
    })
}
fn safe_server_directory(root: &Path, relative: &Path, create: bool) -> AppResult<PathBuf> {
    let canonical_root = root.canonicalize()?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(AppError::Validation(
                "サーバーフォルダー内の保存先が正しくありません".into(),
            ));
        };
        current.push(name);
        if current.exists() {
            if std::fs::symlink_metadata(&current)?
                .file_type()
                .is_symlink()
            {
                return Err(AppError::Validation(
                    "シンボリックリンクの保存先は安全のため操作できません".into(),
                ));
            }
            if !current.canonicalize()?.starts_with(&canonical_root) {
                return Err(AppError::Validation(
                    "サーバーフォルダー外の保存先は操作できません".into(),
                ));
            }
        }
    }
    if create && !current.exists() {
        std::fs::create_dir_all(&current)?;
    }
    if current.exists() {
        if !std::fs::metadata(&current)?.is_dir() {
            return Err(AppError::Validation(
                "拡張機能の保存先がフォルダーではありません".into(),
            ));
        }
        if !current.canonicalize()?.starts_with(&canonical_root) {
            return Err(AppError::Validation(
                "サーバーフォルダー外の保存先は操作できません".into(),
            ));
        }
    }
    Ok(current)
}
fn validate_file_name(value: &str) -> AppResult<()> {
    let path = Path::new(value);
    if value.is_empty()
        || path.components().count() != 1
        || !matches!(path.components().next(), Some(Component::Normal(_)))
    {
        Err(AppError::Validation("ファイル名が正しくありません".into()))
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone)]
struct BedrockPack {
    root: PathBuf,
    name: String,
    uuid: String,
    version: [u64; 3],
    kind: &'static str,
}

fn install_bedrock_local(
    profile: &ServerProfile,
    source: &Path,
    requested_kind: &str,
) -> AppResult<ExtensionInfo> {
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "zip" | "mcpack" | "mcaddon") {
        return Err(AppError::Validation(
            "統合版パックはZIP、MCPACK、MCADDONファイルを選択してください".into(),
        ));
    }
    if source.metadata()?.len() > MAX_TOTAL_BYTES {
        return Err(AppError::Validation(
            "統合版パックは安全上限512 MiBを超えています".into(),
        ));
    }

    let root = Path::new(&profile.root_path);
    let staging = safe_server_directory(root, Path::new(".server-hub/pack-staging"), true)?
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&staging)?;
    let result = (|| {
        let extracted_bytes = extract_bedrock_archive(source, &staging, MAX_TOTAL_BYTES)?;
        extract_nested_mcpacks(&staging, MAX_TOTAL_BYTES.saturating_sub(extracted_bytes))?;
        let mut packs = discover_bedrock_packs(&staging)?;
        if requested_kind != "addon" {
            packs.retain(|pack| pack.kind == requested_kind);
        }
        if packs.is_empty() {
            return Err(AppError::Validation(match requested_kind {
                "behavior_pack" => "Behavior Packのmanifest.jsonを確認できませんでした".into(),
                "resource_pack" => "Resource Packのmanifest.jsonを確認できませんでした".into(),
                _ => "Behavior PackまたはResource Packのmanifest.jsonを確認できませんでした".into(),
            }));
        }

        let existing = installed_bedrock_uuids(root)?;
        let mut archive_uuids = HashSet::new();
        for pack in &packs {
            if !archive_uuids.insert(pack.uuid.to_ascii_lowercase()) {
                return Err(AppError::Validation(format!(
                    "Add-on内で同じUUIDが重複しています: {}",
                    pack.uuid
                )));
            }
            if existing.contains(&pack.uuid.to_ascii_lowercase()) {
                return Err(AppError::Validation(format!(
                    "同じUUIDの統合版パックがすでに導入されています: {}",
                    pack.uuid
                )));
            }
        }

        let mut created = Vec::new();
        for pack in &packs {
            let destination_folder = target_folder(profile, pack.kind)?;
            std::fs::create_dir_all(&destination_folder)?;
            let folder_name = bedrock_pack_folder_name(&pack.name, &pack.uuid);
            let destination = destination_folder.join(&folder_name);
            if destination.exists() {
                rollback_bedrock_packs(&created);
                return Err(AppError::Validation(format!(
                    "同名の統合版パックがすでにあります: {folder_name}"
                )));
            }
            if let Err(error) = copy_pack_directory(&pack.root, &destination) {
                rollback_bedrock_packs(&created);
                return Err(error);
            }
            created.push(destination);
        }
        if let Err(error) = activate_bedrock_packs(profile, &packs) {
            rollback_bedrock_packs(&created);
            return Err(error);
        }

        let source_hash = file_sha256(source)?;
        let manifest_dir =
            safe_server_directory(root, Path::new(".server-hub/extension-manifests"), true)?;
        let manifest = serde_json::json!({
            "fileName": source.file_name().and_then(|value| value.to_str()).unwrap_or("bedrock-addon"),
            "kind": requested_kind,
            "sha256": source_hash,
            "source": "local-file",
            "packs": packs.iter().map(|pack| serde_json::json!({
                "name": pack.name,
                "uuid": pack.uuid,
                "version": pack.version,
                "kind": pack.kind,
            })).collect::<Vec<_>>(),
        });
        if let Err(error) = std::fs::write(
            manifest_dir.join(format!("{source_hash}.json")),
            serde_json::to_vec_pretty(&manifest)?,
        ) {
            rollback_bedrock_packs(&created);
            return Err(error.into());
        }
        describe_file(profile, &created[0], packs[0].kind, true, true)
    })();
    let _ = std::fs::remove_dir_all(&staging);
    result
}

fn extract_bedrock_archive(
    source: &Path,
    destination: &Path,
    remaining_bytes: u64,
) -> AppResult<u64> {
    let mut archive = ZipArchive::new(File::open(source)?)
        .map_err(|_| AppError::Validation("統合版パックのZIP形式を読み取れませんでした".into()))?;
    if archive.len() > MAX_BEDROCK_ARCHIVE_FILES {
        return Err(AppError::Validation(
            "統合版パック内のファイル数が安全上限4096件を超えています".into(),
        ));
    }
    let total = (0..archive.len()).try_fold(0_u64, |total, index| {
        let file = archive
            .by_index(index)
            .map_err(|error| AppError::Other(error.to_string()))?;
        total
            .checked_add(file.size())
            .ok_or_else(|| AppError::Validation("統合版パックの展開容量が不正です".into()))
    })?;
    if total > remaining_bytes {
        return Err(AppError::Validation(
            "統合版パックの展開容量が安全上限512 MiBを超えています".into(),
        ));
    }
    let mut extracted_names = HashSet::new();
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| AppError::Other(error.to_string()))?;
        if file
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(AppError::Validation(
                "シンボリックリンクを含む統合版パックは安全のため追加できません".into(),
            ));
        }
        let relative = safe_bedrock_archive_path(file.name())?;
        let normalized = relative
            .to_string_lossy()
            .replace('\\', "/")
            .to_ascii_lowercase();
        if !extracted_names.insert(normalized) {
            return Err(AppError::Validation(
                "大文字小文字だけが異なる重複パスを含む統合版パックは安全のため拒否しました".into(),
            ));
        }
        let target = destination.join(relative);
        if file.is_dir() {
            std::fs::create_dir_all(&target)?;
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut output = File::create(&target)?;
            std::io::copy(&mut file, &mut output)?;
        }
    }
    Ok(total)
}

fn safe_bedrock_archive_path(value: &str) -> AppResult<PathBuf> {
    let normalized = value.trim_end_matches(&['/', '\\'][..]);
    if normalized.is_empty()
        || normalized.len() > 1_024
        || normalized.contains(':')
        || normalized.chars().any(char::is_control)
    {
        return Err(AppError::Validation(
            "統合版パック内のファイル名が安全ではありません".into(),
        ));
    }
    let path = Path::new(normalized);
    let components = path.components().collect::<Vec<_>>();
    if components.is_empty()
        || components
            .iter()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AppError::Validation(
            "サーバーフォルダー外へ展開するパスを含むため拒否しました".into(),
        ));
    }
    for component in &components {
        let Component::Normal(name) = component else {
            unreachable!()
        };
        let name = name.to_string_lossy();
        let stem = name
            .trim_end_matches(&[' ', '.'][..])
            .split('.')
            .next()
            .unwrap_or("")
            .to_ascii_uppercase();
        let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || stem.strip_prefix("COM").is_some_and(|suffix| {
                suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9')
            })
            || stem.strip_prefix("LPT").is_some_and(|suffix| {
                suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9')
            });
        if name.ends_with(' ') || name.ends_with('.') || reserved {
            return Err(AppError::Validation(
                "Windowsで安全に展開できないファイル名を含むため拒否しました".into(),
            ));
        }
    }
    Ok(path.to_path_buf())
}

fn extract_nested_mcpacks(staging: &Path, mut remaining_bytes: u64) -> AppResult<()> {
    let nested = WalkDir::new(staging)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.file_type().is_file()
                && entry
                    .path()
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("mcpack"))
        })
        .map(|entry| entry.path().to_path_buf())
        .take(33)
        .collect::<Vec<_>>();
    if nested.len() > 32 {
        return Err(AppError::Validation(
            "MCADDON内のMCPACKが安全上限32件を超えています".into(),
        ));
    }
    for (index, archive) in nested.iter().enumerate() {
        let extracted = extract_bedrock_archive(
            archive,
            &staging.join(format!("nested-pack-{index}")),
            remaining_bytes,
        )?;
        remaining_bytes = remaining_bytes.saturating_sub(extracted);
    }
    Ok(())
}

fn discover_bedrock_packs(staging: &Path) -> AppResult<Vec<BedrockPack>> {
    let mut packs = Vec::new();
    for entry in WalkDir::new(staging)
        .follow_links(false)
        .max_depth(8)
        .into_iter()
    {
        let entry = entry.map_err(|error| AppError::Other(error.to_string()))?;
        if entry.file_type().is_symlink() {
            return Err(AppError::Validation(
                "シンボリックリンクを含む統合版パックは安全のため追加できません".into(),
            ));
        }
        if entry.file_type().is_file()
            && entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case("manifest.json")
        {
            packs.push(parse_bedrock_manifest(entry.path())?);
        }
    }
    Ok(packs)
}

fn parse_bedrock_manifest(path: &Path) -> AppResult<BedrockPack> {
    let bytes = std::fs::read(path)?;
    if bytes.len() > 1024 * 1024 {
        return Err(AppError::Validation(
            "manifest.jsonが1 MiBを超えるため拒否しました".into(),
        ));
    }
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| {
        AppError::Validation("manifest.jsonをJSONとして読み取れませんでした".into())
    })?;
    let header = value
        .get("header")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| AppError::Validation("manifest.jsonにheaderがありません".into()))?;
    let name = header
        .get("name")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|name| {
            !name.is_empty() && name.chars().count() <= 128 && !name.chars().any(char::is_control)
        })
        .ok_or_else(|| AppError::Validation("manifest.jsonのパック名が正しくありません".into()))?
        .to_string();
    let uuid = header
        .get("uuid")
        .and_then(serde_json::Value::as_str)
        .filter(|value| uuid::Uuid::parse_str(value).is_ok())
        .ok_or_else(|| AppError::Validation("manifest.jsonのheader UUIDが正しくありません".into()))?
        .to_ascii_lowercase();
    let version = manifest_version(header.get("version")).ok_or_else(|| {
        AppError::Validation(
            "manifest.jsonのheader versionは3つの非負整数で指定してください".into(),
        )
    })?;
    let modules = value
        .get("modules")
        .and_then(serde_json::Value::as_array)
        .filter(|modules| !modules.is_empty())
        .ok_or_else(|| AppError::Validation("manifest.jsonにmodulesがありません".into()))?;
    for module in modules {
        let module_uuid = module
            .get("uuid")
            .and_then(serde_json::Value::as_str)
            .filter(|value| uuid::Uuid::parse_str(value).is_ok())
            .ok_or_else(|| {
                AppError::Validation("manifest.jsonのmodule UUIDが正しくありません".into())
            })?;
        if module_uuid.eq_ignore_ascii_case(&uuid) {
            return Err(AppError::Validation(
                "headerとmoduleのUUIDは別の値にしてください".into(),
            ));
        }
        if manifest_version(module.get("version")).is_none() {
            return Err(AppError::Validation(
                "manifest.jsonのmodule versionが正しくありません".into(),
            ));
        }
    }
    if let Some(dependencies) = value.get("dependencies") {
        let dependencies = dependencies.as_array().ok_or_else(|| {
            AppError::Validation("manifest.jsonのdependenciesは配列で指定してください".into())
        })?;
        for dependency in dependencies {
            if let Some(dependency_uuid) =
                dependency.get("uuid").and_then(serde_json::Value::as_str)
            {
                if uuid::Uuid::parse_str(dependency_uuid).is_err() {
                    return Err(AppError::Validation(
                        "manifest.jsonのdependency UUIDが正しくありません".into(),
                    ));
                }
                if dependency_uuid.eq_ignore_ascii_case(&uuid) {
                    return Err(AppError::Validation(
                        "パック自身をdependencyへ指定することはできません".into(),
                    ));
                }
                if manifest_version(dependency.get("version")).is_none() {
                    return Err(AppError::Validation(
                        "manifest.jsonのdependency versionが正しくありません".into(),
                    ));
                }
            } else {
                let module_name = dependency
                    .get("module_name")
                    .and_then(serde_json::Value::as_str)
                    .filter(|value| {
                        value.starts_with("@minecraft/")
                            && value.len() <= 128
                            && !value.chars().any(char::is_control)
                    })
                    .ok_or_else(|| {
                        AppError::Validation(
                            "manifest.jsonのdependency指定が正しくありません".into(),
                        )
                    })?;
                let module_version = dependency
                    .get("version")
                    .and_then(serde_json::Value::as_str)
                    .filter(|value| {
                        value.len() <= 32
                            && value.split('.').all(|part| {
                                !part.is_empty()
                                    && part.chars().all(|character| character.is_ascii_digit())
                            })
                    })
                    .ok_or_else(|| {
                        AppError::Validation(
                            "manifest.jsonのmodule dependency versionが正しくありません".into(),
                        )
                    })?;
                let _ = (module_name, module_version);
            }
        }
    }
    let resource = modules
        .iter()
        .any(|module| module.get("type").and_then(serde_json::Value::as_str) == Some("resources"));
    let behavior = modules.iter().any(|module| {
        matches!(
            module.get("type").and_then(serde_json::Value::as_str),
            Some("data" | "script")
        )
    });
    let kind =
        match (behavior, resource) {
            (true, false) => "behavior_pack",
            (false, true) => "resource_pack",
            _ => return Err(AppError::Validation(
                "manifest.jsonのmodule typeをBehavior PackまたはResource Packとして判定できません"
                    .into(),
            )),
        };
    Ok(BedrockPack {
        root: path
            .parent()
            .ok_or_else(|| AppError::Validation("manifest.jsonの配置が正しくありません".into()))?
            .to_path_buf(),
        name,
        uuid,
        version,
        kind,
    })
}

fn manifest_version(value: Option<&serde_json::Value>) -> Option<[u64; 3]> {
    let values = value?.as_array()?;
    if values.len() != 3 {
        return None;
    }
    Some([
        values[0].as_u64()?,
        values[1].as_u64()?,
        values[2].as_u64()?,
    ])
}

fn installed_bedrock_uuids(root: &Path) -> AppResult<HashSet<String>> {
    let mut uuids = HashSet::new();
    for folder in [
        root.join("behavior_packs"),
        root.join("resource_packs"),
        root.join(".server-hub/disabled/behavior_pack"),
        root.join(".server-hub/disabled/resource_pack"),
    ] {
        if !folder.is_dir() {
            continue;
        }
        if std::fs::symlink_metadata(&folder)?.file_type().is_symlink() {
            return Err(AppError::Validation(
                "シンボリックリンクの統合版パック保存先は安全のため操作できません".into(),
            ));
        }
        for entry in std::fs::read_dir(folder)?.flatten() {
            if entry
                .file_type()
                .is_ok_and(|entry_type| entry_type.is_symlink())
            {
                return Err(AppError::Validation(
                    "シンボリックリンクの統合版パックは安全のため操作できません".into(),
                ));
            }
            let manifest = entry.path().join("manifest.json");
            if !manifest.is_file() {
                continue;
            }
            if let Ok(value) =
                serde_json::from_slice::<serde_json::Value>(&std::fs::read(manifest)?)
            {
                if let Some(uuid) = value
                    .pointer("/header/uuid")
                    .and_then(serde_json::Value::as_str)
                {
                    uuids.insert(uuid.to_ascii_lowercase());
                }
            }
        }
    }
    Ok(uuids)
}

fn bedrock_pack_folder_name(name: &str, uuid: &str) -> String {
    let mut safe = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>();
    safe = safe.trim_matches('_').chars().take(48).collect();
    if safe.is_empty() {
        safe = "pack".into();
    }
    format!("{safe}-{}", &uuid[..8])
}

fn copy_pack_directory(source: &Path, destination: &Path) -> AppResult<()> {
    for entry in WalkDir::new(source).follow_links(false) {
        let entry = entry.map_err(|error| AppError::Other(error.to_string()))?;
        if entry.file_type().is_symlink() {
            return Err(AppError::Validation(
                "シンボリックリンクを含む統合版パックは安全のため追加できません".into(),
            ));
        }
        let relative = entry
            .path()
            .strip_prefix(source)
            .map_err(|error| AppError::Other(error.to_string()))?;
        let target = destination.join(relative);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target)?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

fn rollback_bedrock_packs(created: &[PathBuf]) {
    for path in created {
        let _ = std::fs::remove_dir_all(path);
    }
}

fn directory_size(path: &Path) -> AppResult<u64> {
    WalkDir::new(path)
        .follow_links(false)
        .into_iter()
        .try_fold(0_u64, |total, entry| {
            let entry = entry.map_err(|error| AppError::Other(error.to_string()))?;
            if entry.file_type().is_symlink() {
                return Err(AppError::Validation(
                    "シンボリックリンクを含むパックは安全のため操作できません".into(),
                ));
            }
            if entry.file_type().is_file() {
                Ok(total.saturating_add(
                    entry
                        .metadata()
                        .map_err(|error| AppError::Other(error.to_string()))?
                        .len(),
                ))
            } else {
                Ok(total)
            }
        })
}

fn file_sha256(path: &Path) -> AppResult<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(hex::encode(digest.finalize()))
}

fn activate_bedrock_packs(profile: &ServerProfile, packs: &[BedrockPack]) -> AppResult<()> {
    let mut activated = Vec::new();
    for pack in packs {
        if let Err(error) =
            set_bedrock_reference(profile, pack.kind, &pack.uuid, pack.version, true)
        {
            for previous in activated.into_iter().rev() {
                let previous: &BedrockPack = previous;
                let _ = set_bedrock_reference(
                    profile,
                    previous.kind,
                    &previous.uuid,
                    previous.version,
                    false,
                );
            }
            return Err(error);
        }
        activated.push(pack);
    }
    Ok(())
}

fn set_bedrock_pack_reference(
    profile: &ServerProfile,
    pack_root: &Path,
    kind: &str,
    enabled: bool,
) -> AppResult<()> {
    let pack = parse_bedrock_manifest(&pack_root.join("manifest.json"))?;
    if pack.kind != kind {
        return Err(AppError::Validation(
            "統合版パックの種類と保存先が一致しません".into(),
        ));
    }
    set_bedrock_reference(profile, kind, &pack.uuid, pack.version, enabled)
}

fn set_bedrock_reference(
    profile: &ServerProfile,
    kind: &str,
    uuid: &str,
    version: [u64; 3],
    enabled: bool,
) -> AppResult<()> {
    let world_name = profile.settings.world_name.trim();
    let mut components = Path::new(world_name).components();
    if world_name.is_empty()
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
        || world_name.contains(['/', '\\', '\0'])
    {
        return Err(AppError::Validation(
            "統合版ワールド名が安全なフォルダー名ではありません".into(),
        ));
    }
    let root = Path::new(&profile.root_path);
    let worlds = root.join("worlds");
    if worlds.exists() && std::fs::symlink_metadata(&worlds)?.file_type().is_symlink() {
        return Err(AppError::Validation(
            "シンボリックリンクのworldsフォルダーは安全のため操作できません".into(),
        ));
    }
    let world = worlds.join(world_name);
    if !world.is_dir() {
        return Ok(());
    }
    if std::fs::symlink_metadata(&world)?.file_type().is_symlink() {
        return Err(AppError::Validation(
            "シンボリックリンクの統合版ワールドは安全のため操作できません".into(),
        ));
    }
    let canonical_worlds = worlds.canonicalize()?;
    if world.canonicalize()?.parent() != Some(canonical_worlds.as_path()) {
        return Err(AppError::Validation(
            "サーバーフォルダー外の統合版ワールドは操作できません".into(),
        ));
    }
    let file_name = match kind {
        "behavior_pack" => "world_behavior_packs.json",
        "resource_pack" => "world_resource_packs.json",
        _ => {
            return Err(AppError::Validation(
                "統合版パックの種類が正しくありません".into(),
            ));
        }
    };
    let path = world.join(file_name);
    if path.exists() && std::fs::symlink_metadata(&path)?.file_type().is_symlink() {
        return Err(AppError::Validation(format!(
            "シンボリックリンクの{file_name}は安全のため操作できません"
        )));
    }
    let original = if path.is_file() {
        std::fs::read(&path)?
    } else {
        b"[]".to_vec()
    };
    let mut value: serde_json::Value = serde_json::from_slice(&original).map_err(|_| {
        AppError::Validation(format!("{file_name}をJSONとして読み取れませんでした"))
    })?;
    let entries = value.as_array_mut().ok_or_else(|| {
        AppError::Validation(format!("{file_name}はJSON配列である必要があります"))
    })?;
    entries.retain(|entry| {
        entry
            .get("pack_id")
            .and_then(serde_json::Value::as_str)
            .is_none_or(|pack_id| !pack_id.eq_ignore_ascii_case(uuid))
    });
    if enabled {
        entries.push(serde_json::json!({ "pack_id": uuid, "version": version }));
    }
    let temporary = path.with_extension("json.tmp");
    let previous = path.with_extension("json.previous");
    std::fs::write(&temporary, serde_json::to_vec_pretty(&value)?)?;
    let had_original = path.is_file();
    if previous.exists() {
        std::fs::remove_file(&previous)?;
    }
    if had_original {
        std::fs::rename(&path, &previous)?;
    }
    if let Err(error) = std::fs::rename(&temporary, &path) {
        if had_original {
            let _ = std::fs::rename(&previous, &path);
        }
        let _ = std::fs::remove_file(&temporary);
        return Err(error.into());
    }
    if had_original {
        std::fs::remove_file(previous)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        ModrinthVersion, catalog_index, client_requirement, install_local, install_modrinth, list,
        list_modrinth_versions, plan_modrinth_install, remove, search_modrinth,
        select_primary_file, set_enabled,
    };
    use crate::models::{BasicSettings, ServerProfile};
    use std::{io::Write, path::Path};
    use zip::{ZipWriter, write::SimpleFileOptions};

    fn profile(root: &Path) -> ServerProfile {
        ServerProfile {
            id: "extension-test".into(),
            name: "Extension Test".into(),
            root_path: root.display().to_string(),
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
            eula_accepted_at: "test".into(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: None,
            created_at: "test".into(),
            updated_at: "test".into(),
        }
    }

    #[test]
    fn manages_plugin_lifecycle_and_keeps_kinds_separate() {
        let base =
            std::env::temp_dir().join(format!("msh-extension-test-{}", uuid::Uuid::new_v4()));
        let root = base.join("server");
        std::fs::create_dir_all(root.join(".server-hub")).unwrap();
        let source = base.join("example.jar");
        std::fs::write(&source, b"test-plugin").unwrap();
        let profile = profile(&root);
        assert!(install_local(&profile, &source.display().to_string(), "mod").is_err());
        install_local(&profile, &source.display().to_string(), "plugin").unwrap();
        assert!(
            list(&profile)
                .unwrap()
                .iter()
                .any(|item| item.kind == "plugin" && item.enabled)
        );
        set_enabled(&profile, "example.jar", "plugin", false).unwrap();
        assert!(
            list(&profile)
                .unwrap()
                .iter()
                .any(|item| item.kind == "plugin" && !item.enabled)
        );
        remove(&profile, "example.jar", "plugin").unwrap();
        assert!(list(&profile).unwrap().is_empty());
        std::fs::remove_dir_all(base).unwrap();
    }

    fn write_pack(path: &Path, entry_name: &str) {
        let file = std::fs::File::create(path).unwrap();
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        zip.start_file(entry_name, options).unwrap();
        zip.write_all(
            serde_json::to_string(&serde_json::json!({
                "format_version": 2,
                "header": {
                    "name": "Safe Behavior",
                    "description": "fixture",
                    "uuid": "11111111-1111-4111-8111-111111111111",
                    "version": [1, 0, 0],
                    "min_engine_version": [1, 20, 0]
                },
                "modules": [{
                    "type": "data",
                    "uuid": "22222222-2222-4222-8222-222222222222",
                    "version": [1, 0, 0]
                }]
            }))
            .unwrap()
            .as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn validates_and_manages_bedrock_behavior_pack() {
        let base =
            std::env::temp_dir().join(format!("msh-bedrock-extension-{}", uuid::Uuid::new_v4()));
        let root = base.join("server");
        std::fs::create_dir_all(root.join(".server-hub")).unwrap();
        std::fs::create_dir_all(root.join("worlds/world")).unwrap();
        let source = base.join("safe.mcpack");
        write_pack(&source, "manifest.json");
        let mut profile = profile(&root);
        profile.server_type = "bedrock".into();
        profile.launch_target = "bedrock_server.exe".into();
        profile.java_path.clear();
        profile.java_major = 0;
        profile.port = 19132;

        let installed =
            install_local(&profile, &source.display().to_string(), "behavior_pack").unwrap();
        assert_eq!(installed.kind, "behavior_pack");
        assert!(installed.compatibility.contains("manifest.json"));
        assert!(
            root.join("behavior_packs")
                .join(&installed.file_name)
                .join("manifest.json")
                .is_file()
        );
        let references: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.join("worlds/world/world_behavior_packs.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(
            references[0]["pack_id"],
            "11111111-1111-4111-8111-111111111111"
        );
        assert!(
            install_local(&profile, &source.display().to_string(), "behavior_pack").is_err(),
            "duplicate UUID must be rejected"
        );
        set_enabled(&profile, &installed.file_name, "behavior_pack", false).unwrap();
        assert!(
            list(&profile)
                .unwrap()
                .iter()
                .any(|item| item.kind == "behavior_pack" && !item.enabled)
        );
        assert!(
            install_local(&profile, &source.display().to_string(), "behavior_pack").is_err(),
            "disabled packs must continue reserving their manifest UUID"
        );
        let disabled_references: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.join("worlds/world/world_behavior_packs.json")).unwrap(),
        )
        .unwrap();
        assert!(disabled_references.as_array().unwrap().is_empty());
        set_enabled(&profile, &installed.file_name, "behavior_pack", true).unwrap();
        remove(&profile, &installed.file_name, "behavior_pack").unwrap();
        assert!(list(&profile).unwrap().is_empty());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn hides_unapplied_bds_bundled_packs_and_protects_external_references() {
        let base = std::env::temp_dir().join(format!(
            "msh-bedrock-bundled-extension-{}",
            uuid::Uuid::new_v4()
        ));
        let root = base.join("server");
        let bundled = root.join("behavior_packs").join("chemistry");
        std::fs::create_dir_all(&bundled).unwrap();
        std::fs::create_dir_all(root.join("worlds/world")).unwrap();
        std::fs::write(
            bundled.join("manifest.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "format_version": 2,
                "header": {
                    "name": "Bundled Chemistry",
                    "description": "fixture",
                    "uuid": "aaaaaaaa-1111-4111-8111-111111111111",
                    "version": [1, 0, 0],
                    "min_engine_version": [1, 20, 0]
                },
                "modules": [{
                    "type": "data",
                    "uuid": "bbbbbbbb-2222-4222-8222-222222222222",
                    "version": [1, 0, 0]
                }]
            }))
            .unwrap(),
        )
        .unwrap();
        let mut profile = profile(&root);
        profile.server_type = "bedrock".into();
        profile.launch_target = "bedrock_server.exe".into();
        profile.java_path.clear();
        profile.java_major = 0;
        profile.port = 19132;

        assert!(list(&profile).unwrap().is_empty());
        assert!(set_enabled(&profile, "chemistry", "behavior_pack", false).is_err());

        std::fs::write(
            root.join("worlds/world/world_behavior_packs.json"),
            serde_json::to_vec_pretty(&serde_json::json!([{
                "pack_id": "aaaaaaaa-1111-4111-8111-111111111111",
                "version": [1, 0, 0]
            }]))
            .unwrap(),
        )
        .unwrap();
        let listed = list(&profile).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].file_name, "chemistry");
        assert!(!listed[0].manageable);
        assert!(remove(&profile, "chemistry", "behavior_pack").is_err());
        assert!(bundled.is_dir());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn rejects_bedrock_archive_path_traversal() {
        let base = std::env::temp_dir().join(format!(
            "msh-bedrock-extension-traversal-{}",
            uuid::Uuid::new_v4()
        ));
        let root = base.join("server");
        std::fs::create_dir_all(&root).unwrap();
        let source = base.join("unsafe.mcpack");
        write_pack(&source, "../manifest.json");
        let mut profile = profile(&root);
        profile.server_type = "bedrock".into();
        profile.launch_target = "bedrock_server.exe".into();
        profile.java_path.clear();
        profile.java_major = 0;
        profile.port = 19132;
        assert!(install_local(&profile, &source.display().to_string(), "behavior_pack").is_err());
        assert!(!base.join("manifest.json").exists());

        let ads_source = base.join("unsafe-ads.mcpack");
        write_pack(&ads_source, "manifest.json:payload");
        assert!(
            install_local(&profile, &ads_source.display().to_string(), "behavior_pack").is_err()
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn selects_only_the_runtime_file_and_describes_client_need() {
        let version: ModrinthVersion = serde_json::from_value(serde_json::json!({
            "id":"version1", "project_id":"project1", "name":"Release", "version_number":"1.0.0", "version_type":"release",
            "date_published":"2026-08-25T00:00:00Z", "dependencies":[], "game_versions":["1.21.1"], "loaders":["fabric"], "environment":"client_and_server",
            "files":[
                {"hashes":{"sha1":"a","sha512":"b"},"url":"https://cdn.modrinth.com/source.jar","filename":"source.jar","primary":false,"size":1,"file_type":"sources-jar"},
                {"hashes":{"sha1":"c","sha512":"d"},"url":"https://cdn.modrinth.com/mod.jar","filename":"mod.jar","primary":true,"size":2,"file_type":null}
            ]
        })).unwrap();
        assert_eq!(
            select_primary_file(&version, "mod").unwrap().filename,
            "mod.jar"
        );
        assert!(client_requirement(&version.environment, "mod").contains("参加者側"));
    }

    #[test]
    fn sorts_the_empty_catalog_by_downloads_and_queries_by_relevance() {
        assert_eq!(catalog_index(""), "downloads");
        assert_eq!(catalog_index("   "), "downloads");
        assert_eq!(catalog_index("sodium"), "relevance");
    }

    #[test]
    #[ignore = "公式Modrinth APIへ接続し、空検索の人気順を確認する明示実行用テスト"]
    fn lists_a_live_popular_catalog_in_download_order() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let mut catalog_profile = profile(&std::env::temp_dir());
            catalog_profile.server_type = "fabric".into();
            catalog_profile.minecraft_version = "1.21.1".into();
            let client = crate::downloads::http_client().unwrap();
            let results = search_modrinth(&client, &catalog_profile, "", "mod")
                .await
                .unwrap();
            assert!(!results.is_empty());
            assert!(
                results
                    .windows(2)
                    .all(|pair| pair[0].downloads >= pair[1].downloads)
            );
        });
    }

    #[test]
    #[ignore = "公式Modrinth APIへ接続し、対応版と必須依存を確認する明示実行用テスト"]
    fn resolves_and_installs_a_live_modrinth_plan_in_an_isolated_server() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let root = std::env::temp_dir();
            let mut catalog_profile = profile(&root);
            catalog_profile.server_type = "fabric".into();
            catalog_profile.minecraft_version = "1.21.1".into();
            let client = crate::downloads::http_client().unwrap();
            let results = search_modrinth(&client, &catalog_profile, "Fabric API", "mod")
                .await
                .unwrap();
            let project = results.first().expect("Fabric API search result");
            let versions =
                list_modrinth_versions(&client, &catalog_profile, &project.project_id, "mod")
                    .await
                    .unwrap();
            let version = versions.first().expect("compatible Fabric API version");
            let plan = plan_modrinth_install(&client, &catalog_profile, &version.id, "mod")
                .await
                .unwrap();
            assert!(!plan.items.is_empty());
            assert!(plan.total_size_bytes > 0);

            let base =
                std::env::temp_dir().join(format!("msh-modrinth-live-{}", uuid::Uuid::new_v4()));
            let server_root = base.join("server");
            let backups = base.join("backups");
            std::fs::create_dir_all(&server_root).unwrap();
            std::fs::write(server_root.join("server.properties"), "online-mode=true\n").unwrap();
            let mut isolated_profile = profile(&server_root);
            isolated_profile.server_type = "fabric".into();
            isolated_profile.minecraft_version = "1.21.1".into();
            let installed =
                install_modrinth(&client, &backups, &isolated_profile, &version.id, "mod")
                    .await
                    .unwrap();
            assert!(
                installed
                    .items
                    .iter()
                    .all(|item| server_root.join("mods").join(&item.file_name).is_file())
            );
            assert!(
                !crate::backup::list(&backups, &isolated_profile.id)
                    .unwrap()
                    .is_empty()
            );
            std::fs::remove_dir_all(base).unwrap();
        });
    }
}
