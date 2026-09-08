use std::path::{Component, Path, PathBuf};

use crate::{
    backup,
    error::{AppError, AppResult},
    models::{BackupInfo, ServerProfile},
};

pub fn regenerate(
    backups_root: &Path,
    profile: &ServerProfile,
) -> AppResult<(BackupInfo, Vec<String>)> {
    let root = PathBuf::from(&profile.root_path).canonicalize()?;
    if !root.join("server.properties").is_file() {
        return Err(AppError::Validation(
            "server.propertiesを確認できないため再生成を中止しました".into(),
        ));
    }

    let targets = existing_world_targets(
        &root,
        &profile.settings.world_name,
        profile.server_type == "bedrock",
    )?;
    if targets.is_empty() {
        return Err(AppError::Validation(
            "再生成できるワールドデータが見つかりません".into(),
        ));
    }

    let safety_backup = backup::create(backups_root, profile, "before-world-regeneration")?;
    let mut removed = Vec::new();
    for target in targets {
        let name = target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("world")
            .to_string();
        if let Err(error) = std::fs::remove_dir_all(&target) {
            let restore_result = backup::restore(backups_root, profile, &safety_backup.id);
            return match restore_result {
                Ok(()) => Err(AppError::Other(format!(
                    "ワールドの取り外しに失敗したため、作成済みバックアップから元へ戻しました: {error}"
                ))),
                Err(restore_error) => Err(AppError::Other(format!(
                    "ワールドの取り外しに失敗し、自動復元にも失敗しました。バックアップ「{}」から手動復元してください: {error}; 復元エラー: {restore_error}",
                    safety_backup.id
                ))),
            };
        }
        removed.push(name);
    }

    Ok((safety_backup, removed))
}

fn existing_world_targets(root: &Path, world_name: &str, bedrock: bool) -> AppResult<Vec<PathBuf>> {
    let name = validate_world_folder_name(world_name)?;
    let candidates = if bedrock {
        vec![name.clone()]
    } else {
        vec![
            name.clone(),
            format!("{name}_nether"),
            format!("{name}_the_end"),
        ]
    };
    let world_root = if bedrock {
        root.join("worlds")
    } else {
        root.to_path_buf()
    };
    if bedrock && !world_root.is_dir() {
        return Ok(Vec::new());
    }
    let canonical_world_root = world_root.canonicalize()?;
    let mut targets = Vec::new();

    for candidate in candidates {
        let path = world_root.join(&candidate);
        if !path.exists() {
            continue;
        }
        let metadata = std::fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() {
            return Err(AppError::Validation(format!(
                "シンボリックリンクのワールド「{candidate}」は安全のため再生成できません"
            )));
        }
        if !metadata.is_dir() || !path.join("level.dat").is_file() {
            continue;
        }
        let canonical = path.canonicalize()?;
        if canonical.parent() != Some(canonical_world_root.as_path()) {
            return Err(AppError::Validation(
                "サーバーフォルダー外のワールドは操作できません".into(),
            ));
        }
        targets.push(canonical);
    }

    Ok(targets)
}

fn validate_world_folder_name(value: &str) -> AppResult<String> {
    let trimmed = value.trim();
    let mut components = Path::new(trimmed).components();
    let valid_component =
        matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none();
    if trimmed.is_empty() || !valid_component || trimmed.contains(['/', '\\', '\0']) {
        return Err(AppError::Validation(
            "ワールド名が安全なフォルダー名ではないため再生成を中止しました".into(),
        ));
    }
    Ok(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::regenerate;
    use crate::{
        backup,
        models::{BasicSettings, ServerProfile},
    };

    fn profile(root: &std::path::Path, world_name: &str) -> ServerProfile {
        let mut settings = BasicSettings::default();
        settings.world_name = world_name.into();
        ServerProfile {
            id: "world-maintenance".into(),
            name: "World Maintenance".into(),
            root_path: root.display().to_string(),
            game_kind: "minecraft".into(),
            server_type: "paper".into(),
            minecraft_version: "1.21.11".into(),
            distribution_build: None,
            launch_target: "paper.jar".into(),
            java_path: "java.exe".into(),
            java_major: 21,
            min_memory_mib: 1024,
            max_memory_mib: 4096,
            port: 25565,
            eula_accepted_at: "test".into(),
            pending_restart: false,
            settings,
            palworld_settings: None,
            created_at: "test".into(),
            updated_at: "test".into(),
        }
    }

    #[test]
    fn regenerates_only_the_configured_world_and_keeps_a_restorable_backup() {
        let base =
            std::env::temp_dir().join(format!("msh-world-regeneration-{}", uuid::Uuid::new_v4()));
        let root = base.join("server");
        let backups = base.join("backups");
        for name in ["world", "world_nether", "world_the_end", "another_world"] {
            std::fs::create_dir_all(root.join(name)).unwrap();
            std::fs::write(root.join(name).join("level.dat"), name).unwrap();
        }
        std::fs::write(root.join("server.properties"), "level-name=world\n").unwrap();
        let profile = profile(&root, "world");

        let (safety, removed) = regenerate(&backups, &profile).unwrap();
        assert_eq!(removed, vec!["world", "world_nether", "world_the_end"]);
        assert!(!root.join("world").exists());
        assert!(root.join("another_world").is_dir());
        assert!(backup::verify(&backups, &profile.id, &safety.id).unwrap());

        backup::restore(&backups, &profile, &safety.id).unwrap();
        assert!(root.join("world").join("level.dat").is_file());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn rejects_a_world_name_that_can_escape_the_server_folder() {
        let base =
            std::env::temp_dir().join(format!("msh-world-traversal-{}", uuid::Uuid::new_v4()));
        let root = base.join("server");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("server.properties"), "level-name=../outside\n").unwrap();
        let result = regenerate(&base.join("backups"), &profile(&root, "../outside"));
        assert!(result.is_err());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn regenerates_only_the_configured_bedrock_world() {
        let base = std::env::temp_dir().join(format!(
            "msh-bedrock-world-regeneration-{}",
            uuid::Uuid::new_v4()
        ));
        let root = base.join("server");
        let backups = base.join("backups");
        for name in ["Bedrock World", "Keep World"] {
            std::fs::create_dir_all(root.join("worlds").join(name)).unwrap();
            std::fs::write(root.join("worlds").join(name).join("level.dat"), name).unwrap();
        }
        std::fs::write(root.join("server.properties"), "level-name=Bedrock World\n").unwrap();
        let mut profile = profile(&root, "Bedrock World");
        profile.server_type = "bedrock".into();
        profile.launch_target = "bedrock_server.exe".into();
        profile.java_path.clear();
        profile.java_major = 0;
        profile.port = 19132;

        let (safety, removed) = regenerate(&backups, &profile).unwrap();
        assert_eq!(removed, vec!["Bedrock World"]);
        assert!(!root.join("worlds/Bedrock World").exists());
        assert!(root.join("worlds/Keep World/level.dat").is_file());
        assert!(backup::verify(&backups, &profile.id, &safety.id).unwrap());
        backup::restore(&backups, &profile, &safety.id).unwrap();
        assert!(root.join("worlds/Bedrock World/level.dat").is_file());
        std::fs::remove_dir_all(base).unwrap();
    }
}
