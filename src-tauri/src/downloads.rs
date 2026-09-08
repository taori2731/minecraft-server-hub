use std::{collections::HashMap, path::Path, process::Command};

use reqwest::{Client, header};
use serde::Deserialize;
use sha1::{Digest as Sha1Digest, Sha1};
use sha2::Sha256;

use crate::{
    error::{AppError, AppResult},
    models::VersionOption,
};

const MOJANG_MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const PAPER_PROJECT: &str = "https://fill.papermc.io/v3/projects/paper";
const FABRIC_META: &str = "https://meta.fabricmc.net/v2/versions";
const FORGE_PROMOTIONS: &str =
    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";
const NEOFORGE_METADATA: &str =
    "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml";
const USER_AGENT: &str = "minecraft-server-hub/0.1.0 (local desktop prototype)";

#[derive(Debug, Deserialize)]
struct MojangManifest {
    versions: Vec<MojangVersion>,
}

#[derive(Debug, Deserialize)]
struct MojangVersion {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    url: String,
}

#[derive(Debug, Deserialize)]
struct MojangVersionDetail {
    downloads: MojangDownloads,
}

#[derive(Debug, Deserialize)]
struct MojangDownloads {
    server: MojangDownload,
}

#[derive(Debug, Deserialize)]
struct MojangDownload {
    url: String,
    sha1: String,
}

#[derive(Debug, Deserialize)]
struct PaperProject {
    versions: HashMap<String, Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct PaperBuild {
    id: i64,
    channel: String,
    downloads: HashMap<String, PaperDownload>,
}

#[derive(Debug, Deserialize)]
struct PaperDownload {
    url: String,
    checksums: PaperChecksums,
}

#[derive(Debug, Deserialize)]
struct PaperChecksums {
    sha256: String,
}

#[derive(Debug, Deserialize)]
struct FabricGameVersion {
    version: String,
    stable: bool,
}

#[derive(Debug, Deserialize)]
struct FabricLoaderEntry {
    loader: FabricLoader,
}

#[derive(Debug, Deserialize)]
struct FabricLoader {
    version: String,
    stable: bool,
}

#[derive(Debug, Deserialize)]
struct FabricInstaller {
    version: String,
    stable: bool,
}

#[derive(Debug, Deserialize)]
struct ForgePromotions {
    promos: HashMap<String, String>,
}

pub fn http_client() -> AppResult<Client> {
    Client::builder()
        .user_agent(USER_AGENT)
        .https_only(true)
        .build()
        .map_err(Into::into)
}

pub async fn list_versions(client: &Client, server_type: &str) -> AppResult<Vec<VersionOption>> {
    match server_type {
        "vanilla" => {
            let manifest: MojangManifest = client
                .get(MOJANG_MANIFEST)
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            Ok(manifest
                .versions
                .into_iter()
                .filter(|version| version.kind == "release")
                .take(40)
                .map(|version| VersionOption {
                    id: version.id,
                    channel: "stable".into(),
                })
                .collect())
        }
        "paper" => {
            let project: PaperProject = client
                .get(PAPER_PROJECT)
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            let mut versions: Vec<String> = project.versions.into_values().flatten().collect();
            versions.sort_by(|a, b| version_key(b).cmp(&version_key(a)));
            versions.dedup();
            Ok(versions
                .into_iter()
                .map(|id| VersionOption {
                    id,
                    channel: "stable".into(),
                })
                .collect())
        }
        "fabric" => {
            let versions: Vec<FabricGameVersion> = client
                .get(format!("{FABRIC_META}/game"))
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            Ok(versions
                .into_iter()
                .filter(|item| item.stable)
                .take(40)
                .map(|item| VersionOption {
                    id: item.version,
                    channel: "stable".into(),
                })
                .collect())
        }
        "forge" => {
            let promotions: ForgePromotions = client
                .get(FORGE_PROMOTIONS)
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            let mut versions = promotions
                .promos
                .keys()
                .filter_map(|key| {
                    key.strip_suffix("-recommended")
                        .or_else(|| key.strip_suffix("-latest"))
                })
                .map(str::to_string)
                .collect::<Vec<_>>();
            versions.sort_by(|a, b| version_key(b).cmp(&version_key(a)));
            versions.dedup();
            Ok(versions
                .into_iter()
                .take(40)
                .map(|id| VersionOption {
                    id,
                    channel: "stable".into(),
                })
                .collect())
        }
        "neoforge" => {
            let text = client
                .get(NEOFORGE_METADATA)
                .send()
                .await?
                .error_for_status()?
                .text()
                .await?;
            let mut versions = xml_versions(&text)
                .into_iter()
                .map(|version| neoforge_mc_version(&version))
                .collect::<Vec<_>>();
            versions.sort_by(|a, b| version_key(b).cmp(&version_key(a)));
            versions.dedup();
            Ok(versions
                .into_iter()
                .take(40)
                .map(|id| VersionOption {
                    id,
                    channel: "stable".into(),
                })
                .collect())
        }
        _ => Err(AppError::Validation(
            "対応していないサーバー種類です".into(),
        )),
    }
}

pub async fn download_server(
    client: &Client,
    server_type: &str,
    version: &str,
    destination: &Path,
    java_path: &str,
    root: &Path,
) -> AppResult<Option<String>> {
    match server_type {
        "vanilla" => {
            let manifest: MojangManifest = client
                .get(MOJANG_MANIFEST)
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            let selected = manifest
                .versions
                .into_iter()
                .find(|item| item.id == version && item.kind == "release")
                .ok_or_else(|| {
                    AppError::Validation("指定されたVanilla版が見つかりません".into())
                })?;
            let detail: MojangVersionDetail = client
                .get(selected.url)
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            let bytes = download_bytes(client, &detail.downloads.server.url).await?;
            let actual = hex::encode(Sha1::digest(&bytes));
            if actual != detail.downloads.server.sha1.to_lowercase() {
                return Err(AppError::Other(
                    "Vanilla Server JARのSHA-1が一致しません".into(),
                ));
            }
            atomic_write(destination, &bytes)?;
            Ok(None)
        }
        "paper" => {
            let url = format!("{PAPER_PROJECT}/versions/{version}/builds");
            let builds: Vec<PaperBuild> = client
                .get(url)
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            let build = builds
                .into_iter()
                .find(|build| build.channel.eq_ignore_ascii_case("stable"))
                .ok_or_else(|| {
                    AppError::Validation("この版にはPaperの安定ビルドがありません".into())
                })?;
            let download = build
                .downloads
                .get("server:default")
                .ok_or_else(|| AppError::Other("Paper Server JARの配布情報がありません".into()))?;
            let bytes = download_bytes(client, &download.url).await?;
            let actual = hex::encode(Sha256::digest(&bytes));
            if actual != download.checksums.sha256.to_lowercase() {
                return Err(AppError::Other(
                    "Paper Server JARのSHA-256が一致しません".into(),
                ));
            }
            atomic_write(destination, &bytes)?;
            Ok(Some(build.id.to_string()))
        }
        "fabric" => {
            let loaders: Vec<FabricLoaderEntry> = client
                .get(format!("{FABRIC_META}/loader/{version}"))
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            let loader = loaders
                .into_iter()
                .map(|entry| entry.loader)
                .find(|loader| loader.stable)
                .ok_or_else(|| {
                    AppError::Validation("このMinecraft版に対応するFabric安定版がありません".into())
                })?;
            let installers: Vec<FabricInstaller> = client
                .get(format!("{FABRIC_META}/installer"))
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            let installer = installers
                .into_iter()
                .find(|item| item.stable)
                .ok_or_else(|| AppError::Other("Fabric Installer安定版が見つかりません".into()))?;
            let url = format!(
                "{FABRIC_META}/loader/{version}/{}/{}/server/jar",
                loader.version, installer.version
            );
            let bytes = download_bytes(client, &url).await?;
            atomic_write(destination, &bytes)?;
            Ok(Some(format!(
                "loader:{};installer:{}",
                loader.version, installer.version
            )))
        }
        "forge" => {
            let promotions: ForgePromotions = client
                .get(FORGE_PROMOTIONS)
                .send()
                .await?
                .error_for_status()?
                .json()
                .await?;
            let build = promotions
                .promos
                .get(&format!("{version}-recommended"))
                .or_else(|| promotions.promos.get(&format!("{version}-latest")))
                .ok_or_else(|| {
                    AppError::Validation("このMinecraft版のForgeビルドが見つかりません".into())
                })?
                .clone();
            let coordinate = format!("{version}-{build}");
            let url = format!(
                "https://maven.minecraftforge.net/net/minecraftforge/forge/{coordinate}/forge-{coordinate}-installer.jar"
            );
            install_loader(
                client,
                &url,
                java_path,
                root,
                "forge-installer.jar",
                &coordinate,
            )
            .await?;
            Ok(Some(coordinate))
        }
        "neoforge" => {
            let metadata = client
                .get(NEOFORGE_METADATA)
                .send()
                .await?
                .error_for_status()?
                .text()
                .await?;
            let prefix = neoforge_prefix(version);
            let build = xml_versions(&metadata)
                .into_iter()
                .filter(|candidate| candidate.starts_with(&prefix))
                .max_by(|a, b| version_key(a).cmp(&version_key(b)))
                .ok_or_else(|| {
                    AppError::Validation("このMinecraft版のNeoForgeビルドが見つかりません".into())
                })?;
            let url = format!(
                "https://maven.neoforged.net/releases/net/neoforged/neoforge/{build}/neoforge-{build}-installer.jar"
            );
            install_loader(
                client,
                &url,
                java_path,
                root,
                "neoforge-installer.jar",
                &build,
            )
            .await?;
            Ok(Some(build))
        }
        _ => Err(AppError::Validation(
            "対応していないサーバー種類です".into(),
        )),
    }
}

async fn install_loader(
    client: &Client,
    url: &str,
    java_path: &str,
    root: &Path,
    file_name: &str,
    expected_build: &str,
) -> AppResult<()> {
    let bytes = download_bytes(client, url).await?;
    let installer = root.join(file_name);
    atomic_write_named(&installer, &bytes)?;
    let mut command = Command::new(java_path);
    command
        .current_dir(root)
        .args(["-jar", file_name, "--installServer"]);
    crate::windows_process::hide_console_window(&mut command);
    let output = command.output()?;
    if !output.status.success() {
        return Err(AppError::Other(format!(
            "{} のサーバー導入に失敗しました: {}",
            expected_build,
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    std::fs::remove_file(installer)?;
    Ok(())
}

async fn download_bytes(client: &Client, url: &str) -> AppResult<Vec<u8>> {
    if !url.starts_with("https://") {
        return Err(AppError::Validation(
            "HTTPS以外の配布URLを拒否しました".into(),
        ));
    }
    let response = client
        .get(url)
        .header(
            header::ACCEPT,
            "application/java-archive,application/octet-stream",
        )
        .send()
        .await?
        .error_for_status()?;
    Ok(response.bytes().await?.to_vec())
}

fn atomic_write(destination: &Path, bytes: &[u8]) -> AppResult<()> {
    let temporary = destination.with_extension("jar.download");
    std::fs::write(&temporary, bytes)?;
    std::fs::rename(temporary, destination)?;
    Ok(())
}

fn atomic_write_named(destination: &Path, bytes: &[u8]) -> AppResult<()> {
    let temporary = destination.with_extension("download");
    std::fs::write(&temporary, bytes)?;
    std::fs::rename(temporary, destination)?;
    Ok(())
}

fn version_key(value: &str) -> Vec<u32> {
    value
        .split('.')
        .map(|part| part.parse::<u32>().unwrap_or_default())
        .collect()
}

fn xml_versions(text: &str) -> Vec<String> {
    let mut rest = text;
    let mut output = Vec::new();
    while let Some(start) = rest.find("<version>") {
        rest = &rest[start + 9..];
        let Some(end) = rest.find("</version>") else {
            break;
        };
        output.push(rest[..end].trim().to_string());
        rest = &rest[end + 10..];
    }
    output
}

fn neoforge_mc_version(build: &str) -> String {
    let base = build.split('-').next().unwrap_or(build);
    let mut parts = base.split('.');
    let major = parts.next().unwrap_or("0");
    let minor = parts.next().unwrap_or("0");
    if major.parse::<u32>().unwrap_or_default() >= 26 {
        format!("{major}.{minor}")
    } else {
        format!("1.{major}.{minor}")
    }
}

fn neoforge_prefix(version: &str) -> String {
    if let Some(rest) = version.strip_prefix("1.") {
        format!("{rest}.")
    } else {
        format!("{version}.")
    }
}

#[cfg(test)]
mod tests {
    use super::{
        download_server, http_client, list_versions, neoforge_mc_version, neoforge_prefix,
        xml_versions,
    };
    #[test]
    fn maps_neoforge_versions() {
        assert_eq!(neoforge_mc_version("21.1.219"), "1.21.1");
        assert_eq!(neoforge_mc_version("26.1.0-beta"), "26.1");
        assert_eq!(neoforge_prefix("1.20.6"), "20.6.");
        assert_eq!(
            xml_versions("<versions><version>21.1.1</version></versions>"),
            vec!["21.1.1"]
        );
    }

    #[test]
    #[ignore = "公式配布APIへ接続して実ファイルを取得する明示実行用テスト"]
    fn downloads_current_vanilla_and_fabric_artifacts() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let client = http_client().unwrap();
            let root =
                std::env::temp_dir().join(format!("msh-network-smoke-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&root).unwrap();
            for server_type in ["vanilla", "fabric"] {
                let version = list_versions(&client, server_type)
                    .await
                    .unwrap()
                    .first()
                    .unwrap()
                    .id
                    .clone();
                let destination = root.join(format!("{server_type}.jar"));
                download_server(&client, server_type, &version, &destination, "", &root)
                    .await
                    .unwrap();
                assert!(destination.metadata().unwrap().len() > 100_000);
                std::fs::remove_file(destination).unwrap();
            }
            std::fs::remove_dir(&root).unwrap();
        });
    }

    #[test]
    #[ignore = "公式配布APIへ接続する明示実行用テスト"]
    fn lists_versions_from_all_official_providers() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let client = http_client().unwrap();
            for server_type in ["vanilla", "paper", "fabric", "forge", "neoforge"] {
                let versions = list_versions(&client, server_type).await.unwrap();
                assert!(!versions.is_empty(), "{server_type} returned no versions");
            }
        });
    }
}
