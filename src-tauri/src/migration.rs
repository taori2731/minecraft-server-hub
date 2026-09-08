use std::{
    fs::File,
    io::{BufReader, Read, Write},
    path::{Component, Path, PathBuf},
};

use chrono::Utc;
use sha2::{Digest, Sha256};
use walkdir::WalkDir;
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

use crate::{
    error::{AppError, AppResult},
    models::{MigrationExportResult, MigrationManifest, RestoreMigrationInput, ServerProfile},
};

const SCHEMA_VERSION: u16 = 1;
const MAX_FILES: u64 = 100_000;
const MAX_UNPACKED_BYTES: u64 = 32 * 1024 * 1024 * 1024;
const BUFFER_BYTES: usize = 256 * 1024;
const MANIFEST_NAME: &str = "minecraft-server-hub-migration.json";

pub fn export(profile: &ServerProfile, destination: &Path) -> AppResult<MigrationExportResult> {
    let root = PathBuf::from(&profile.root_path).canonicalize()?;
    if !root.is_dir() {
        return Err(AppError::Validation(
            "移行元のサーバーフォルダーが見つかりません".into(),
        ));
    }
    if destination.extension().and_then(|value| value.to_str()) != Some("mshmove") {
        return Err(AppError::Validation(
            "移行ファイルの拡張子は.mshmoveにしてください".into(),
        ));
    }
    let destination_parent = destination
        .parent()
        .ok_or_else(|| AppError::Validation("保存先が正しくありません".into()))?;
    std::fs::create_dir_all(destination_parent)?;
    let destination_parent = destination_parent.canonicalize()?;
    if destination_parent.starts_with(&root) {
        return Err(AppError::Validation(
            "移行ファイルはサーバーフォルダーの外へ保存してください".into(),
        ));
    }
    let mut files = Vec::new();
    let mut size = 0_u64;
    for entry in WalkDir::new(&root).follow_links(false) {
        let entry =
            entry.map_err(|error| AppError::Other(format!("移行元を読み取れません: {error}")))?;
        let relative = entry
            .path()
            .strip_prefix(&root)
            .map_err(|error| AppError::Other(error.to_string()))?;
        if relative.as_os_str().is_empty() || should_skip(relative, entry.file_type().is_symlink())
        {
            continue;
        }
        if entry.file_type().is_file() {
            let length = entry
                .metadata()
                .map_err(|error| AppError::Other(error.to_string()))?
                .len();
            size = size
                .checked_add(length)
                .ok_or_else(|| AppError::Validation("移行対象の容量が大きすぎます".into()))?;
            files.push((entry.path().to_path_buf(), relative.to_path_buf(), length));
        }
    }
    if files.len() as u64 > MAX_FILES || size > MAX_UNPACKED_BYTES {
        return Err(AppError::Validation(
            "移行対象が安全上限を超えています".into(),
        ));
    }
    let mut manifest = MigrationManifest {
        schema_version: SCHEMA_VERSION,
        created_at: Utc::now().to_rfc3339(),
        source_server_name: profile.name.clone(),
        server_type: profile.server_type.clone(),
        minecraft_version: profile.minecraft_version.clone(),
        distribution_build: profile.distribution_build.clone(),
        launch_target: profile.launch_target.clone(),
        java_major: profile.java_major,
        min_memory_mib: profile.min_memory_mib,
        max_memory_mib: profile.max_memory_mib,
        port: profile.port,
        settings: profile.settings.clone(),
        file_count: files.len() as u64,
        source_size_bytes: size,
        archive_sha256: String::new(),
    };
    let temporary = destination.with_extension("mshmove.part");
    let result = (|| -> AppResult<()> {
        let mut writer = ZipWriter::new(File::create(&temporary)?);
        let options = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .unix_permissions(0o644);
        writer
            .start_file(MANIFEST_NAME, options)
            .map_err(zip_error)?;
        writer.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
        let mut buffer = vec![0_u8; BUFFER_BYTES];
        for (path, relative, _) in &files {
            let name = relative.to_string_lossy().replace('\\', "/");
            writer
                .start_file(format!("server/{name}"), options)
                .map_err(zip_error)?;
            let mut input = BufReader::new(File::open(path)?);
            loop {
                let read = input.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                writer.write_all(&buffer[..read])?;
            }
        }
        writer.finish().map_err(zip_error)?;
        Ok(())
    })();
    if let Err(error) = result {
        let _ = std::fs::remove_file(&temporary);
        return Err(error);
    }
    std::fs::rename(&temporary, destination)?;
    manifest.archive_sha256 = file_sha256(destination)?;
    Ok(MigrationExportResult {
        path: destination.display().to_string(),
        manifest,
    })
}

pub fn read_manifest(archive_path: &Path) -> AppResult<MigrationManifest> {
    let file = File::open(archive_path)?;
    let mut archive = ZipArchive::new(file).map_err(zip_error)?;
    let mut manifest_file = archive.by_name(MANIFEST_NAME).map_err(|_| {
        AppError::Validation("Minecraft Server Hubの移行ファイルではありません".into())
    })?;
    if manifest_file.size() > 1024 * 1024 {
        return Err(AppError::Validation("移行情報が大きすぎます".into()));
    }
    let mut bytes = Vec::new();
    manifest_file.read_to_end(&mut bytes)?;
    let mut manifest: MigrationManifest = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::Validation("移行情報を読み取れません".into()))?;
    if manifest.schema_version != SCHEMA_VERSION {
        return Err(AppError::Validation(
            "この移行ファイルの形式には対応していません".into(),
        ));
    }
    manifest.archive_sha256 = file_sha256(archive_path)?;
    Ok(manifest)
}

pub fn restore(input: &RestoreMigrationInput) -> AppResult<(MigrationManifest, PathBuf)> {
    let archive_path = PathBuf::from(&input.archive_path).canonicalize()?;
    let manifest = read_manifest(&archive_path)?;
    let safe_name = input.server_name.trim();
    if safe_name.is_empty()
        || safe_name.chars().count() > 64
        || safe_name
            .chars()
            .any(|value| matches!(value, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
    {
        return Err(AppError::Validation(
            "復元後のサーバー名に使用できない文字があります".into(),
        ));
    }
    let parent = PathBuf::from(&input.parent_path).canonicalize()?;
    if !parent.is_dir() {
        return Err(AppError::Validation(
            "復元先フォルダーが見つかりません".into(),
        ));
    }
    let destination = parent.join(safe_name);
    if destination.exists() {
        return Err(AppError::Validation(
            "復元先に同名フォルダーがあります。上書きはしません".into(),
        ));
    }
    let staging = parent.join(format!(".msh-restore-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&staging)?;
    let result = extract_verified(&archive_path, &staging, &manifest);
    if let Err(error) = result {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    std::fs::rename(&staging, &destination)?;
    Ok((manifest, destination))
}

fn extract_verified(
    archive_path: &Path,
    destination: &Path,
    manifest: &MigrationManifest,
) -> AppResult<()> {
    let mut archive = ZipArchive::new(File::open(archive_path)?).map_err(zip_error)?;
    let mut files = 0_u64;
    let mut total = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(zip_error)?;
        let raw_name = entry.name().replace('\\', "/");
        if raw_name == MANIFEST_NAME {
            continue;
        }
        let Some(relative_name) = raw_name.strip_prefix("server/") else {
            return Err(AppError::Validation(
                "移行ファイルに不明な項目があります".into(),
            ));
        };
        let relative = Path::new(relative_name);
        if relative.as_os_str().is_empty()
            || relative
                .components()
                .any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err(AppError::Validation(
                "移行ファイルに危険なパスがあります".into(),
            ));
        }
        files += 1;
        total = total
            .checked_add(entry.size())
            .ok_or_else(|| AppError::Validation("展開容量を検証できません".into()))?;
        if files > MAX_FILES
            || total > MAX_UNPACKED_BYTES
            || files > manifest.file_count
            || total > manifest.source_size_bytes
        {
            return Err(AppError::Validation(
                "移行ファイルの内容が記録された上限を超えています".into(),
            ));
        }
        let output = destination.join(relative);
        if !output.starts_with(destination) {
            return Err(AppError::Validation(
                "復元先の外へ展開しようとしたため拒否しました".into(),
            ));
        }
        if entry.is_dir() {
            std::fs::create_dir_all(output)?;
        } else {
            if let Some(parent) = output.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut writer = File::create(output)?;
            std::io::copy(&mut entry, &mut writer)?;
        }
    }
    if files != manifest.file_count || total != manifest.source_size_bytes {
        return Err(AppError::Validation(
            "移行ファイルの件数または容量が作成時と一致しません".into(),
        ));
    }
    Ok(())
}

fn should_skip(relative: &Path, symlink: bool) -> bool {
    if symlink {
        return true;
    }
    let normalized = relative
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase();
    normalized.starts_with("logs/")
        || normalized.starts_with("crash-reports/")
        || normalized.starts_with(".server-hub/tunnel")
        || normalized.contains("token")
        || normalized.ends_with(".log")
        || normalized.ends_with(".lck")
}

fn file_sha256(path: &Path) -> AppResult<String> {
    let mut file = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; BUFFER_BYTES];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(hex::encode(digest.finalize()))
}

fn zip_error(error: zip::result::ZipError) -> AppError {
    AppError::Other(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::BasicSettings;

    fn profile(root: &Path) -> ServerProfile {
        ServerProfile {
            id: "move-test".into(),
            name: "Move Test".into(),
            root_path: root.display().to_string(),
            game_kind: "minecraft".into(),
            server_type: "paper".into(),
            minecraft_version: "1.21.11".into(),
            distribution_build: Some("1".into()),
            launch_target: "server.jar".into(),
            java_path: "java.exe".into(),
            java_major: 21,
            min_memory_mib: 1024,
            max_memory_mib: 4096,
            port: 25565,
            eula_accepted_at: Utc::now().to_rfc3339(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: None,
            created_at: Utc::now().to_rfc3339(),
            updated_at: Utc::now().to_rfc3339(),
        }
    }

    #[test]
    fn migration_round_trip_excludes_logs_and_tokens() {
        let base = std::env::temp_dir().join(format!("msh-move-{}", uuid::Uuid::new_v4()));
        let root = base.join("source");
        let target = base.join("target");
        std::fs::create_dir_all(root.join("world")).unwrap();
        std::fs::create_dir_all(root.join("logs")).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(root.join("server.jar"), b"jar").unwrap();
        std::fs::write(root.join("world/level.dat"), b"world").unwrap();
        std::fs::write(root.join("logs/latest.log"), b"private").unwrap();
        std::fs::write(root.join("provider-token.json"), b"secret").unwrap();
        let archive = base.join("server.mshmove");
        let exported = export(&profile(&root), &archive).unwrap();
        assert_eq!(exported.manifest.file_count, 2);
        let (_, restored) = restore(&RestoreMigrationInput {
            archive_path: archive.display().to_string(),
            parent_path: target.display().to_string(),
            server_name: "restored".into(),
            java_path: "java.exe".into(),
            java_major: 21,
        })
        .unwrap();
        assert!(restored.join("world/level.dat").is_file());
        assert!(!restored.join("logs/latest.log").exists());
        assert!(!restored.join("provider-token.json").exists());
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn restore_rejects_path_traversal_without_writing_outside_destination() {
        let base = std::env::temp_dir().join(format!("msh-move-unsafe-{}", uuid::Uuid::new_v4()));
        let target = base.join("target");
        std::fs::create_dir_all(&target).unwrap();
        let archive = base.join("unsafe.mshmove");
        let mut manifest = MigrationManifest {
            schema_version: SCHEMA_VERSION,
            created_at: Utc::now().to_rfc3339(),
            source_server_name: "Unsafe".into(),
            server_type: "paper".into(),
            minecraft_version: "1.21.11".into(),
            distribution_build: None,
            launch_target: "server.jar".into(),
            java_major: 21,
            min_memory_mib: 1024,
            max_memory_mib: 4096,
            port: 25565,
            settings: BasicSettings::default(),
            file_count: 1,
            source_size_bytes: 1,
            archive_sha256: String::new(),
        };
        let file = File::create(&archive).unwrap();
        let mut writer = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        writer.start_file(MANIFEST_NAME, options).unwrap();
        writer
            .write_all(&serde_json::to_vec(&manifest).unwrap())
            .unwrap();
        writer.start_file("server/../escape.txt", options).unwrap();
        writer.write_all(b"x").unwrap();
        writer.finish().unwrap();
        manifest.archive_sha256 = file_sha256(&archive).unwrap();

        let result = restore(&RestoreMigrationInput {
            archive_path: archive.display().to_string(),
            parent_path: target.display().to_string(),
            server_name: "restored".into(),
            java_path: "java.exe".into(),
            java_major: 21,
        });
        assert!(result.is_err());
        assert!(!target.join("escape.txt").exists());
        assert!(!target.join("restored").exists());
        let _ = std::fs::remove_dir_all(base);
    }
}
