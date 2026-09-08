use std::{sync::Arc, time::Duration};

use reqwest::Url;
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::error::{AppError, AppResult};

const UPDATE_PUBLIC_KEY: &str = include_str!("../updater-public.key");
const COMPILED_UPDATE_ENDPOINT: Option<&str> = option_env!("MSH_UPDATE_ENDPOINT");
const DEFAULT_UPDATE_ENDPOINT: &str = "https://github.com/taori2731/minecraft-server-hub-releases/releases/latest/download/latest.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub configured: bool,
    pub current_version: String,
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateProgress {
    pub phase: String,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
}

pub type ProgressCallback = Arc<dyn Fn(AppUpdateProgress) + Send + Sync>;

pub async fn check(app: &AppHandle, endpoint: Option<&str>) -> AppResult<AppUpdateInfo> {
    let current_version = app.package_info().version.to_string();
    let Some(endpoint) = resolve_endpoint(endpoint)? else {
        return Ok(AppUpdateInfo {
            configured: false,
            current_version,
            available: false,
            version: None,
            notes: None,
            published_at: None,
        });
    };
    let updater = app
        .updater_builder()
        .pubkey(UPDATE_PUBLIC_KEY.trim())
        .endpoints(vec![endpoint])
        .map_err(updater_error)?
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(updater_error)?;
    let update = updater.check().await.map_err(updater_error)?;
    Ok(match update {
        Some(update) => AppUpdateInfo {
            configured: true,
            current_version,
            available: true,
            version: Some(update.version),
            notes: update
                .body
                .map(|notes| notes.chars().take(12_000).collect()),
            published_at: update.date.map(|date| date.to_string()),
        },
        None => AppUpdateInfo {
            configured: true,
            current_version,
            available: false,
            version: None,
            notes: None,
            published_at: None,
        },
    })
}

pub async fn install(
    app: &AppHandle,
    endpoint: Option<&str>,
    expected_version: &str,
    progress: ProgressCallback,
    on_before_exit: impl Fn() + Send + Sync + 'static,
) -> AppResult<()> {
    let endpoint = resolve_endpoint(endpoint)?
        .ok_or_else(|| AppError::Validation("アプリ更新の配布先がまだ設定されていません".into()))?;
    let updater = app
        .updater_builder()
        .pubkey(UPDATE_PUBLIC_KEY.trim())
        .endpoints(vec![endpoint])
        .map_err(updater_error)?
        .timeout(Duration::from_secs(60))
        .on_before_exit(on_before_exit)
        .build()
        .map_err(updater_error)?;
    let update = updater
        .check()
        .await
        .map_err(updater_error)?
        .ok_or_else(|| AppError::Validation("利用できるアプリ更新はありません".into()))?;
    if update.version != expected_version {
        return Err(AppError::Validation(format!(
            "確認後に更新バージョンが変更されました（確認: {expected_version}、現在: {}）。もう一度確認してください",
            update.version
        )));
    }

    let mut downloaded_bytes = 0u64;
    let chunk_progress = progress.clone();
    progress(AppUpdateProgress {
        phase: "downloading".into(),
        downloaded_bytes: 0,
        total_bytes: None,
    });
    let bytes = update
        .download(
            move |chunk_size, total_bytes| {
                downloaded_bytes = downloaded_bytes.saturating_add(chunk_size as u64);
                chunk_progress(AppUpdateProgress {
                    phase: "downloading".into(),
                    downloaded_bytes,
                    total_bytes,
                });
            },
            || {},
        )
        .await
        .map_err(updater_error)?;
    progress(AppUpdateProgress {
        phase: "verified".into(),
        downloaded_bytes: bytes.len() as u64,
        total_bytes: Some(bytes.len() as u64),
    });
    update.install(bytes).map_err(updater_error)?;
    Ok(())
}

fn resolve_endpoint(input: Option<&str>) -> AppResult<Option<Url>> {
    let value = input
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or(COMPILED_UPDATE_ENDPOINT
            .map(str::trim)
            .filter(|value| !value.is_empty()))
        .or(Some(DEFAULT_UPDATE_ENDPOINT));
    let Some(value) = value else { return Ok(None) };
    let url = Url::parse(value)
        .map_err(|_| AppError::Validation("更新フィードURLが正しくありません".into()))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::Validation(
            "更新フィードには認証情報やフラグメントを含まないHTTPS URLを指定してください".into(),
        ));
    }
    Ok(Some(url))
}

fn updater_error(error: impl std::fmt::Display) -> AppError {
    AppError::Other(format!("アプリ更新処理に失敗しました: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{DEFAULT_UPDATE_ENDPOINT, UPDATE_PUBLIC_KEY, resolve_endpoint};
    use base64::{Engine, engine::general_purpose::STANDARD as BASE64_STANDARD};
    use minisign_verify::{PublicKey, Signature};

    #[test]
    fn update_feed_requires_a_credential_free_https_url() {
        assert!(
            resolve_endpoint(Some("https://example.com/latest.json"))
                .unwrap()
                .is_some()
        );
        assert!(resolve_endpoint(Some("http://example.com/latest.json")).is_err());
        assert!(resolve_endpoint(Some("https://user:secret@example.com/latest.json")).is_err());
        assert!(resolve_endpoint(Some("https://example.com/latest.json#test")).is_err());
    }

    #[test]
    fn official_update_feed_is_used_without_manual_configuration() {
        let endpoint = resolve_endpoint(None)
            .unwrap()
            .expect("the official update feed must always be configured");
        assert_eq!(endpoint.as_str(), DEFAULT_UPDATE_ENDPOINT);
    }

    #[test]
    #[ignore = "set MSH_UPDATER_ARTIFACT to verify a built NSIS updater and its adjacent .sig"]
    fn verifies_a_built_updater_with_the_embedded_public_key() {
        let artifact_path = std::env::var("MSH_UPDATER_ARTIFACT")
            .expect("MSH_UPDATER_ARTIFACT must point to the built NSIS updater");
        let artifact = std::fs::read(&artifact_path).expect("failed to read updater artifact");
        let encoded_signature = std::fs::read_to_string(format!("{artifact_path}.sig"))
            .expect("failed to read updater signature");
        let signature_text = String::from_utf8(
            BASE64_STANDARD
                .decode(encoded_signature.trim())
                .expect("updater signature is not valid base64"),
        )
        .expect("decoded updater signature is not UTF-8 minisign text");
        let signature = Signature::decode(&signature_text).expect("invalid minisign signature");

        let public_key_text = String::from_utf8(
            BASE64_STANDARD
                .decode(UPDATE_PUBLIC_KEY.trim())
                .expect("embedded updater public key is not valid base64"),
        )
        .expect("decoded updater public key is not UTF-8 minisign text");
        let public_key_value = public_key_text
            .lines()
            .nth(1)
            .expect("embedded minisign public key has no key line");
        let public_key =
            PublicKey::from_base64(public_key_value).expect("invalid embedded minisign public key");

        public_key
            .verify(&artifact, &signature, false)
            .expect("updater artifact signature did not match the embedded public key");
    }
}
