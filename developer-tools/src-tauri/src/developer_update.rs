use std::{sync::Arc, time::Duration};

use reqwest::Url;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

const UPDATE_PUBLIC_KEY: &str = include_str!("../updater-public.key");
pub const DEFAULT_UPDATE_ENDPOINT: &str = "https://raw.githubusercontent.com/taori2731/minecraft-server-hub-releases/main/developer-tools/latest.json";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperUpdateInfo {
    configured: bool,
    current_version: String,
    available: bool,
    version: Option<String>,
    notes: Option<String>,
    published_at: Option<String>,
    endpoint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeveloperUpdateProgress {
    phase: String,
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
}

fn update_endpoint() -> Result<Url, String> {
    let url = Url::parse(DEFAULT_UPDATE_ENDPOINT).map_err(|_| "developer-update-feed-invalid")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("developer-update-feed-invalid".into());
    }
    Ok(url)
}

fn validate_install_request(expected_version: &str, confirmed: bool) -> Result<&str, String> {
    if !confirmed {
        return Err("developer-update-not-confirmed".into());
    }
    let expected_version = expected_version.trim();
    if expected_version.is_empty()
        || expected_version.len() > 64
        || !expected_version
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '-' | '+'))
    {
        return Err("developer-update-version-invalid".into());
    }
    Ok(expected_version)
}

#[tauri::command]
pub async fn check_developer_update(app: AppHandle) -> Result<DeveloperUpdateInfo, String> {
    let endpoint = update_endpoint()?;
    let current_version = app.package_info().version.to_string();
    let updater = app
        .updater_builder()
        .pubkey(UPDATE_PUBLIC_KEY.trim())
        .endpoints(vec![endpoint.clone()])
        .map_err(|error| format!("developer-update-check-failed:{error}"))?
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("developer-update-check-failed:{error}"))?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("developer-update-check-failed:{error}"))?;
    Ok(match update {
        Some(update) => DeveloperUpdateInfo {
            configured: true,
            current_version,
            available: true,
            version: Some(update.version),
            notes: update
                .body
                .map(|notes| notes.chars().take(12_000).collect()),
            // OffsetDateTime's Display representation is not guaranteed to be
            // accepted by JavaScript Date. Send an unambiguous Unix timestamp.
            published_at: update.date.map(|date| date.unix_timestamp().to_string()),
            endpoint: endpoint.to_string(),
        },
        None => DeveloperUpdateInfo {
            configured: true,
            current_version,
            available: false,
            version: None,
            notes: None,
            published_at: None,
            endpoint: endpoint.to_string(),
        },
    })
}

#[tauri::command]
pub async fn install_developer_update(
    app: AppHandle,
    expected_version: String,
    confirmed: bool,
) -> Result<(), String> {
    let expected_version = validate_install_request(&expected_version, confirmed)?;
    let endpoint = update_endpoint()?;
    let updater = app
        .updater_builder()
        .pubkey(UPDATE_PUBLIC_KEY.trim())
        .endpoints(vec![endpoint])
        .map_err(|error| format!("developer-update-install-failed:{error}"))?
        .timeout(Duration::from_secs(90))
        .build()
        .map_err(|error| format!("developer-update-install-failed:{error}"))?;
    let update = updater
        .check()
        .await
        .map_err(|error| format!("developer-update-check-failed:{error}"))?
        .ok_or_else(|| "developer-update-not-available".to_string())?;
    if update.version != expected_version {
        return Err(format!(
            "developer-update-version-changed:{expected_version}:{}",
            update.version
        ));
    }

    let downloaded_bytes = Arc::new(std::sync::Mutex::new(0u64));
    let progress_app = app.clone();
    let progress_bytes = downloaded_bytes.clone();
    let _ = app.emit(
        "developer-update-progress",
        DeveloperUpdateProgress {
            phase: "downloading".into(),
            downloaded_bytes: 0,
            total_bytes: None,
        },
    );
    let bytes = update
        .download(
            move |chunk_size, total_bytes| {
                let mut downloaded = progress_bytes
                    .lock()
                    .unwrap_or_else(|error| error.into_inner());
                *downloaded = downloaded.saturating_add(chunk_size as u64);
                let _ = progress_app.emit(
                    "developer-update-progress",
                    DeveloperUpdateProgress {
                        phase: "downloading".into(),
                        downloaded_bytes: *downloaded,
                        total_bytes,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|error| format!("developer-update-download-failed:{error}"))?;
    let _ = app.emit(
        "developer-update-progress",
        DeveloperUpdateProgress {
            phase: "verifying".into(),
            downloaded_bytes: bytes.len() as u64,
            total_bytes: Some(bytes.len() as u64),
        },
    );
    update
        .install(bytes)
        .map_err(|error| format!("developer-update-install-failed:{error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        DEFAULT_UPDATE_ENDPOINT, UPDATE_PUBLIC_KEY, update_endpoint, validate_install_request,
    };
    use base64::{Engine, engine::general_purpose::STANDARD as BASE64_STANDARD};

    #[test]
    fn dedicated_feed_is_fixed_credential_free_https() {
        let endpoint = update_endpoint().expect("dedicated feed must be valid");
        assert_eq!(endpoint.as_str(), DEFAULT_UPDATE_ENDPOINT);
        assert_eq!(endpoint.scheme(), "https");
        assert!(endpoint.username().is_empty());
        assert!(endpoint.password().is_none());
        assert!(endpoint.fragment().is_none());
        assert!(endpoint.path().ends_with("/developer-tools/latest.json"));
    }

    #[test]
    fn install_requires_explicit_confirmation_and_exact_safe_version() {
        assert_eq!(validate_install_request("0.3.1", true).unwrap(), "0.3.1");
        assert!(validate_install_request("0.3.1", false).is_err());
        assert!(validate_install_request("", true).is_err());
        assert!(validate_install_request("0.3.1/../../x", true).is_err());
    }

    #[test]
    fn embedded_updater_public_key_is_valid_base64_text() {
        let decoded = BASE64_STANDARD
            .decode(UPDATE_PUBLIC_KEY.trim())
            .expect("public key must be base64");
        let text = String::from_utf8(decoded).expect("public key must be UTF-8");
        assert!(text.contains("minisign public key"));
        assert_eq!(text.lines().count(), 2);
    }
}
