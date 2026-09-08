use std::path::Path;

use chrono::{DateTime, Utc};

use crate::{
    backup,
    error::{AppError, AppResult},
    models::{ServerProfile, UpdateSafetyReport},
};

pub fn check(
    backups_root: &Path,
    profile: &ServerProfile,
    target_version: &str,
    target_type: &str,
) -> AppResult<UpdateSafetyReport> {
    if target_version.trim().is_empty()
        || target_version
            .chars()
            .any(|value| !(value.is_ascii_alphanumeric() || matches!(value, '.' | '-' | '_')))
    {
        return Err(AppError::Validation(
            "更新先Minecraft版が正しくありません".into(),
        ));
    }
    if !matches!(
        target_type,
        "vanilla" | "paper" | "fabric" | "forge" | "neoforge" | "bedrock"
    ) {
        return Err(AppError::Validation(
            "更新先サーバー種類が正しくありません".into(),
        ));
    }
    let backups = backup::list(backups_root, &profile.id)?;
    let latest = backups.iter().find(|item| item.valid);
    let latest_time = latest
        .and_then(|item| DateTime::parse_from_rfc3339(&item.created_at).ok())
        .map(|value| value.with_timezone(&Utc));
    let fresh_backup =
        latest_time.is_some_and(|time| Utc::now().signed_duration_since(time).num_hours() <= 24);
    let root = Path::new(&profile.root_path);
    let mut checks = vec![
        format!(
            "Minecraft: {} → {}",
            profile.minecraft_version, target_version
        ),
        format!("サーバー種類: {} → {}", profile.server_type, target_type),
    ];
    let mut warnings = Vec::new();
    let current_line = release_line(&profile.minecraft_version);
    let target_line = release_line(target_version);
    if current_line != target_line {
        warnings.push(
            "Minecraftの世代が変わります。ワールド形式と全拡張機能の対応確認が必要です。".into(),
        );
    }
    if profile.server_type != target_type {
        warnings.push("サーバー種類またはModローダーが変わります。Modとプラグインをそのまま併用できない場合があります。".into());
    }
    let mod_count = count(root.join("mods"), "jar");
    let plugin_count = count(root.join("plugins"), "jar");
    let datapack_count = count(
        root.join(&profile.settings.world_name).join("datapacks"),
        "zip",
    );
    if mod_count > 0 {
        warnings.push(format!(
            "Mod {mod_count}件は、対象Minecraft版と{}向けの配布ページを個別確認してください。",
            target_type
        ));
    }
    if plugin_count > 0 && target_type != "paper" {
        warnings.push(format!("Plugin {plugin_count}件がありますが、更新先はPaperではありません。互換性を確認してください。"));
    }
    if datapack_count > 0 && current_line != target_line {
        warnings.push(format!(
            "Datapack {datapack_count}件のpack_format対応確認が必要です。"
        ));
    }
    if target_type == "bedrock" {
        let behavior_count = count_dirs_with_manifest(root.join("behavior_packs"));
        let resource_count = count_dirs_with_manifest(root.join("resource_packs"));
        if behavior_count + resource_count > 0 {
            warnings.push(format!("Behavior Pack {behavior_count}件、Resource Pack {resource_count}件の対応バージョンを確認してください。"));
        }
        warnings.push("BDS本体の自動更新適用は、ワールド・設定・アドオンを保護する差し替え処理が未実装のため行いません。公式配布ページとバックアップを確認してください。".into());
    }
    if fresh_backup {
        checks.push("24時間以内の検証済みバックアップがあります。".into());
    } else {
        warnings.push(
            "24時間以内の検証済みバックアップがありません。更新前に作成してください。".into(),
        );
    }
    let affected_files = match target_type {
        "bedrock" => vec![
            "bedrock_server.exe と公式BDS付属バイナリ（自動適用対象外）".into(),
            "server.properties / worlds / packs（保護対象）".into(),
        ],
        "forge" | "neoforge" => vec![
            "libraries/".into(),
            "run.bat / user_jvm_args.txt".into(),
            "mods/（互換性確認後）".into(),
        ],
        "fabric" => vec!["server.jar".into(), "mods/（互換性確認後）".into()],
        "paper" => vec!["server.jar".into(), "plugins/（互換性確認後）".into()],
        _ => vec![
            "server.jar".into(),
            "world/datapacks/（互換性確認後）".into(),
        ],
    };
    Ok(UpdateSafetyReport { checked_at: Utc::now().to_rfc3339(), safe_to_proceed: warnings.is_empty() && fresh_backup, backup_recommended: !fresh_backup, latest_backup_at: latest.map(|item| item.created_at.clone()), compatibility_checks: checks, dependency_warnings: warnings, affected_files, rollback_possible: latest.is_some(), disclaimer: "この確認はローカルファイル名と登録情報に基づく事前判定です。配布元の最新互換表を保証するものではなく、確認なしの更新適用は行いません。".into() })
}

fn release_line(version: &str) -> String {
    version.split('.').take(2).collect::<Vec<_>>().join(".")
}
fn count(folder: std::path::PathBuf, extension: &str) -> usize {
    std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            entry
                .path()
                .extension()
                .and_then(|v| v.to_str())
                .is_some_and(|v| v.eq_ignore_ascii_case(extension))
        })
        .count()
}
fn count_dirs_with_manifest(folder: std::path::PathBuf) -> usize {
    std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.path().is_dir() && entry.path().join("manifest.json").is_file())
        .count()
}

#[cfg(test)]
mod tests {
    use super::check;
    use crate::models::{BasicSettings, ServerProfile};
    #[test]
    fn recommends_backup_and_reports_loader_change() {
        let base = std::env::temp_dir().join(format!("msh-update-test-{}", uuid::Uuid::new_v4()));
        let server_root = base.join("server");
        std::fs::create_dir_all(server_root.join("mods")).unwrap();
        std::fs::write(server_root.join("mods/example.jar"), b"x").unwrap();
        let profile = ServerProfile {
            id: "server".into(),
            name: "Server".into(),
            root_path: server_root.display().to_string(),
            game_kind: "minecraft".into(),
            server_type: "fabric".into(),
            minecraft_version: "1.20.1".into(),
            distribution_build: None,
            launch_target: "server.jar".into(),
            java_path: "java".into(),
            java_major: 17,
            min_memory_mib: 1024,
            max_memory_mib: 4096,
            port: 25565,
            eula_accepted_at: "test".into(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: None,
            created_at: "test".into(),
            updated_at: "test".into(),
        };
        let result = check(&base.join("backups"), &profile, "1.21.1", "paper").unwrap();
        assert!(result.backup_recommended);
        assert!(!result.safe_to_proceed);
        assert!(
            result
                .dependency_warnings
                .iter()
                .any(|value| value.contains("ローダー"))
        );
        std::fs::remove_dir_all(base).unwrap();
    }
}
