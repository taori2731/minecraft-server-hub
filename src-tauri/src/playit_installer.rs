use std::{path::Path, process::Command};

use reqwest::Client;

use crate::{
    error::{AppError, AppResult},
    models::{InstallTunnelAgentInput, TunnelAgentInstallPlan, TunnelAgentValidation},
    tunnel::{hash_file, is_official_signer, verify_authenticode},
};

pub const VERSION: &str = "1.0.10";
pub const SOURCE_URL: &str = "https://github.com/playit-cloud/playit-agent/releases/download/v1.0.10/playit-windows-x86_64-signed.msi";
pub const SIZE_BYTES: u64 = 6_070_272;
pub const SHA256: &str = "18c022281fcfe578fb0d614ac6dc1d36cd6885b4a5439b97655768cd2a82bdc1";
pub const PUBLISHER: &str = "Developed Methods LLC";
pub const LICENSE_NAME: &str = "BSD-2-Clause";
pub const LICENSE_URL: &str =
    "https://github.com/playit-cloud/playit-agent/blob/v1.0.10/LICENSE.txt";

pub fn plan(cache_dir: &Path, installed: Option<TunnelAgentValidation>) -> TunnelAgentInstallPlan {
    TunnelAgentInstallPlan {
        provider_id: "playit".into(),
        version: VERSION.into(),
        source_url: SOURCE_URL.into(),
        size_bytes: SIZE_BYTES,
        checksum_sha256: SHA256.into(),
        publisher: PUBLISHER.into(),
        license_name: LICENSE_NAME.into(),
        license_url: LICENSE_URL.into(),
        install_scope: "このPCの全ユーザー（Windowsサービスを含む）".into(),
        install_path: r"C:\Program Files\playit_gg".into(),
        temporary_path: cache_dir
            .join("playit-v1.0.10-x64-signed.msi")
            .display()
            .to_string(),
        already_installed: installed.is_some(),
        installed_validation: installed,
    }
}

fn validate_confirmation(input: &InstallTunnelAgentInput) -> AppResult<()> {
    if input.version != VERSION
        || input.source_url != SOURCE_URL
        || input.size_bytes != SIZE_BYTES
        || !input.checksum_sha256.eq_ignore_ascii_case(SHA256)
    {
        return Err(AppError::Validation(
            "確認後にplayit.ggの配布情報が変わりました。安全のため準備画面を開き直してください"
                .into(),
        ));
    }
    Ok(())
}

pub async fn download_and_install(
    client: &Client,
    cache_dir: &Path,
    input: &InstallTunnelAgentInput,
) -> AppResult<()> {
    validate_confirmation(input)?;
    std::fs::create_dir_all(cache_dir)?;
    let installer = cache_dir.join("playit-v1.0.10-x64-signed.msi");
    let partial = cache_dir.join("playit-v1.0.10-x64-signed.msi.download");
    let _ = std::fs::remove_file(&partial);

    let response = client.get(SOURCE_URL).send().await?.error_for_status()?;
    if response
        .content_length()
        .is_some_and(|size| size != SIZE_BYTES)
    {
        return Err(AppError::Validation(
            "公式配布元が示したMSI容量が固定値と一致しないため中止しました".into(),
        ));
    }
    let bytes = response.bytes().await?;
    if bytes.len() as u64 != SIZE_BYTES {
        return Err(AppError::Validation(
            "ダウンロードしたMSI容量が固定値と一致しないため中止しました".into(),
        ));
    }
    std::fs::write(&partial, &bytes)?;
    let actual = hash_file(&partial)?;
    if !actual.eq_ignore_ascii_case(SHA256) {
        let _ = std::fs::remove_file(&partial);
        return Err(AppError::Validation(
            "playit.gg公式MSIのSHA-256が一致しないため実行しませんでした".into(),
        ));
    }
    let _ = std::fs::remove_file(&installer);
    std::fs::rename(&partial, &installer)?;
    let subject = match verify_authenticode(&installer) {
        Ok(subject) => subject,
        Err(error) => {
            let _ = std::fs::remove_file(&installer);
            return Err(error);
        }
    };
    if subject.is_empty() || !is_official_signer(&subject) {
        let _ = std::fs::remove_file(&installer);
        return Err(AppError::Validation(
            "playit.gg公式MSIのWindows署名と発行者を確認できないため実行しませんでした".into(),
        ));
    }

    let install_path = installer.clone();
    let result = tokio::task::spawn_blocking(move || run_installer(&install_path))
        .await
        .map_err(|error| AppError::Other(error.to_string()))?;
    let _ = std::fs::remove_file(&installer);
    result
}

#[cfg(windows)]
fn run_installer(installer: &Path) -> AppResult<()> {
    let status = Command::new("msiexec.exe")
        .arg("/i")
        .arg(installer)
        .args(["/passive", "/norestart"])
        .status()?;
    match status.code() {
        Some(0) | Some(3010) => Ok(()),
        Some(1602) => Err(AppError::Validation(
            "playit.ggのインストールがキャンセルされました".into(),
        )),
        code => Err(AppError::Other(format!(
            "playit.ggのインストールを完了できませんでした（終了コード: {code:?}）"
        ))),
    }
}

#[cfg(not(windows))]
fn run_installer(_installer: &Path) -> AppResult<()> {
    Err(AppError::Validation(
        "playit.ggの自動インストールはWindows x64だけに対応しています".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn confirmed() -> InstallTunnelAgentInput {
        InstallTunnelAgentInput {
            server_id: "server".into(),
            version: VERSION.into(),
            source_url: SOURCE_URL.into(),
            size_bytes: SIZE_BYTES,
            checksum_sha256: SHA256.into(),
        }
    }

    #[test]
    fn accepts_only_the_exact_pinned_installer_confirmation() {
        assert!(validate_confirmation(&confirmed()).is_ok());
        let mut changed = confirmed();
        changed.source_url = "https://example.com/playit.msi".into();
        assert!(validate_confirmation(&changed).is_err());
        let mut changed = confirmed();
        changed.checksum_sha256 = "tampered".into();
        assert!(validate_confirmation(&changed).is_err());
        let mut changed = confirmed();
        changed.size_bytes += 1;
        assert!(validate_confirmation(&changed).is_err());
    }

    #[test]
    #[ignore = "公式GitHub ReleaseからMSIを取得して署名・SHA-256を実検証する明示実行用テスト"]
    fn downloads_and_validates_the_pinned_official_msi_without_installing() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let root =
                std::env::temp_dir().join(format!("msh-playit-msi-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            let client = crate::downloads::http_client().unwrap();
            let response = client
                .get(SOURCE_URL)
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap();
            let bytes = response.bytes().await.unwrap();
            let path = root.join("playit.msi");
            std::fs::write(&path, bytes).unwrap();
            assert_eq!(std::fs::metadata(&path).unwrap().len(), SIZE_BYTES);
            assert_eq!(hash_file(&path).unwrap(), SHA256);
            let subject = verify_authenticode(&path).unwrap();
            assert!(
                is_official_signer(&subject),
                "unexpected Authenticode subject: {subject:?}"
            );
            std::fs::remove_dir_all(root).unwrap();
        });
    }
}
