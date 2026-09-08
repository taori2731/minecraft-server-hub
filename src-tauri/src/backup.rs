use std::{
    fs::File,
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex, MutexGuard},
    time::Duration,
};

use chrono::Utc;
use sha2::{Digest, Sha256};
use sysinfo::Disks;
use walkdir::WalkDir;
use zip::{CompressionMethod, ZipArchive, ZipWriter, write::SimpleFileOptions};

use crate::{
    error::{AppError, AppResult},
    models::{BackupInfo, BackupKind, BackupProgress, ServerProfile},
    protected_data,
};

const CURRENT_SCHEMA_VERSION: u16 = 2;
const COPY_BUFFER_BYTES: usize = 1024 * 1024;
const PROGRESS_INTERVAL_BYTES: u64 = 8 * 1024 * 1024;
const STALE_PART_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_PROTECTED_ENTRY_BYTES: u64 = 8 * 1024 * 1024;

// Backup and restore are related filesystem transactions. One operation at a
// time prevents races on one server and avoids saturating the same disk when
// several servers request a backup together.
static BACKUP_OPERATION_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Debug, Clone, Copy)]
struct SourceScan {
    size_bytes: u64,
    file_count: u64,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum BackupScope {
    Full,
    PalworldEssential,
}

fn operation_lock() -> AppResult<MutexGuard<'static, ()>> {
    BACKUP_OPERATION_LOCK
        .lock()
        .map_err(|_| AppError::Other("バックアップ処理の排他状態を回復できません".into()))
}

pub fn list(backups_root: &Path, server_id: &str) -> AppResult<Vec<BackupInfo>> {
    let _operation = operation_lock()?;
    let folder = backups_root.join(server_id);
    if !folder.is_dir() {
        return Ok(Vec::new());
    }
    let mut items = std::fs::read_dir(&folder)?
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("zip") {
                return None;
            }
            let id = path.file_stem()?.to_string_lossy().to_string();
            let mut info = read_metadata(&folder, &id).unwrap_or_else(|| {
                legacy_info(
                    &id,
                    &path,
                    entry
                        .metadata()
                        .map(|metadata| metadata.len())
                        .unwrap_or_default(),
                )
            });
            if info.display_name.trim().is_empty() {
                info.display_name = id.clone();
            }
            info.path = path.display().to_string();
            info.valid = verify_path(
                &path,
                (!info.sha256.is_empty()).then_some(info.sha256.as_str()),
            )
            .is_ok();
            Some(info)
        })
        .collect::<Vec<_>>();
    items.sort_by(|left, right| right.id.cmp(&left.id));
    Ok(items)
}

pub fn create(backups_root: &Path, profile: &ServerProfile, label: &str) -> AppResult<BackupInfo> {
    create_with_progress(backups_root, profile, label, |_| {})
}

pub fn planned_co_management_backup_path(
    backups_root: &Path,
    profile: &ServerProfile,
    operation_id: &str,
) -> PathBuf {
    backups_root
        .join(&profile.id)
        .join(format!("{}.zip", operation_backup_id(operation_id)))
}

pub fn create_for_operation(
    backups_root: &Path,
    profile: &ServerProfile,
    label: &str,
    operation_id: &str,
) -> AppResult<BackupInfo> {
    let _operation = operation_lock()?;
    create_unlocked(
        backups_root,
        profile,
        label,
        BackupScope::Full,
        Some(operation_id),
        &mut |_| {},
    )
}

pub fn create_palworld_essential(
    backups_root: &Path,
    profile: &ServerProfile,
    label: &str,
) -> AppResult<BackupInfo> {
    if !profile.game_adapter().is_palworld() {
        return Err(AppError::Validation(
            "重要データだけの高速バックアップはPalworld専用です".into(),
        ));
    }
    let _operation = operation_lock()?;
    create_unlocked(
        backups_root,
        profile,
        label,
        BackupScope::PalworldEssential,
        None,
        &mut |_| {},
    )
}

pub fn create_with_progress<F>(
    backups_root: &Path,
    profile: &ServerProfile,
    label: &str,
    mut on_progress: F,
) -> AppResult<BackupInfo>
where
    F: FnMut(&BackupProgress),
{
    let _operation = operation_lock()?;
    create_unlocked(
        backups_root,
        profile,
        label,
        BackupScope::Full,
        None,
        &mut on_progress,
    )
}

fn create_unlocked<F>(
    backups_root: &Path,
    profile: &ServerProfile,
    label: &str,
    scope: BackupScope,
    operation_id: Option<&str>,
    on_progress: &mut F,
) -> AppResult<BackupInfo>
where
    F: FnMut(&BackupProgress),
{
    let source = PathBuf::from(&profile.root_path).canonicalize()?;
    if !source.is_dir() {
        return Err(AppError::Validation(
            "バックアップ元のサーバーフォルダーが見つかりません".into(),
        ));
    }
    std::fs::create_dir_all(backups_root)?;
    let backups_root = backups_root.canonicalize()?;
    validate_layout(&source, &backups_root)?;
    let folder = backups_root.join(&profile.id);
    std::fs::create_dir_all(&folder)?;

    emit_progress(on_progress, profile, "scanning", 0, 0, 0, 0);
    let scan = scan_source(&source, scope)?;
    ensure_space(&backups_root, scan.size_bytes)?;

    let now = Utc::now();
    let stamp = now.format("%Y-%m-%dT%H_%M_%S_%3fZ").to_string();
    let safe_label: String = label
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(30)
        .collect();
    let id = if let Some(operation_id) = operation_id {
        operation_backup_id(operation_id)
    } else if safe_label.is_empty() {
        stamp
    } else {
        format!("{stamp}-{safe_label}")
    };
    let temporary = folder.join(format!("{id}.zip.part"));
    let destination = folder.join(format!("{id}.zip"));

    emit_progress(
        on_progress,
        profile,
        "creating",
        0,
        scan.size_bytes,
        0,
        scan.file_count,
    );
    if let Err(error) = write_zip(&source, &temporary, profile, scan, scope, &id, on_progress) {
        let _ = std::fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = std::fs::rename(&temporary, &destination) {
        let _ = std::fs::remove_file(&temporary);
        return Err(error.into());
    }

    emit_progress(
        on_progress,
        profile,
        "verifying",
        scan.size_bytes,
        scan.size_bytes,
        scan.file_count,
        scan.file_count,
    );
    let size_bytes = destination.metadata()?.len();
    let sha256 = file_sha256(&destination)?;
    if let Err(error) = verify_path(&destination, Some(&sha256)) {
        let _ = std::fs::remove_file(&destination);
        return Err(error);
    }
    let kind = kind_from_label(label);
    let info = BackupInfo {
        id: id.clone(),
        created_at: now.to_rfc3339(),
        size_bytes,
        path: destination.display().to_string(),
        server_name: profile.name.clone(),
        minecraft_version: profile.minecraft_version.clone(),
        server_type: profile.server_type.clone(),
        extension_summary: if scope == BackupScope::PalworldEssential {
            format!("Palworld essential delete; {}", extension_summary(profile))
        } else {
            extension_summary(profile)
        },
        sha256,
        valid: true,
        schema_version: CURRENT_SCHEMA_VERSION,
        kind: kind.clone(),
        display_name: display_name(label, &kind),
        source_size_bytes: scan.size_bytes,
        file_count: scan.file_count,
        verified_at: Some(Utc::now().to_rfc3339()),
        pinned: kind != BackupKind::Scheduled,
        schedule_id: None,
    };
    if let Err(error) = write_metadata(&folder, &id, &info) {
        let _ = std::fs::remove_file(&destination);
        return Err(error);
    }
    emit_progress(
        on_progress,
        profile,
        "completed",
        scan.size_bytes,
        scan.size_bytes,
        scan.file_count,
        scan.file_count,
    );
    Ok(info)
}

fn operation_backup_id(operation_id: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(operation_id.as_bytes());
    format!("co-management-{}", &hex::encode(hasher.finalize())[..32])
}

pub fn restore(backups_root: &Path, profile: &ServerProfile, backup_id: &str) -> AppResult<()> {
    let _operation = operation_lock()?;
    validate_id(backup_id)?;
    let source = backups_root
        .join(&profile.id)
        .join(format!("{backup_id}.zip"));
    if !source.is_file() {
        return Err(AppError::NotFound);
    }
    let metadata = read_metadata(&backups_root.join(&profile.id), backup_id);
    verify_path(
        &source,
        metadata
            .as_ref()
            .and_then(|info| (!info.sha256.is_empty()).then_some(info.sha256.as_str())),
    )?;
    let mut no_progress = |_: &BackupProgress| {};
    let _safety = create_unlocked(
        backups_root,
        profile,
        "before-restore",
        BackupScope::Full,
        None,
        &mut no_progress,
    )?;
    let root = PathBuf::from(&profile.root_path).canonicalize()?;
    let parent = root
        .parent()
        .ok_or_else(|| AppError::Validation("サーバーフォルダーの親を確認できません".into()))?;
    let token = uuid::Uuid::new_v4();
    let staging = parent.join(format!(".msh-restore-{token}"));
    let previous = parent.join(format!(".msh-previous-{token}"));
    std::fs::create_dir(&staging)?;
    if let Err(error) = extract_archive(&source, &staging, profile, backup_id) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error);
    }
    if !staging.join("server.properties").is_file() {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(AppError::Validation(
            "バックアップにserver.propertiesがないため復元を中止しました".into(),
        ));
    }
    std::fs::rename(&root, &previous)?;
    if let Err(error) = std::fs::rename(&staging, &root) {
        let _ = std::fs::rename(&previous, &root);
        let _ = std::fs::remove_dir_all(&staging);
        return Err(error.into());
    }
    if previous.parent() == Some(parent)
        && previous
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.starts_with(".msh-previous-"))
    {
        std::fs::remove_dir_all(previous)?;
    }
    Ok(())
}

fn extract_archive(
    source: &Path,
    destination: &Path,
    profile: &ServerProfile,
    backup_id: &str,
) -> AppResult<()> {
    let mut archive =
        ZipArchive::new(File::open(source)?).map_err(|error| AppError::Other(error.to_string()))?;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| AppError::Other(error.to_string()))?;
        let relative = entry
            .enclosed_name()
            .ok_or_else(|| {
                AppError::Validation("危険なパスを含むバックアップを拒否しました".into())
            })?
            .to_path_buf();
        let output = destination.join(&relative);
        if entry.is_dir() {
            std::fs::create_dir_all(output)?;
            continue;
        }
        if let Some(parent) = output.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let name = relative.to_string_lossy().replace('\\', "/");
        let mut target = File::create(output)?;
        if is_palworld_secret_entry(profile, &name) {
            if entry.size() > MAX_PROTECTED_ENTRY_BYTES * 2 {
                return Err(AppError::Validation(
                    "Palworld設定バックアップの保護エントリが上限を超えています".into(),
                ));
            }
            let mut stored = Vec::with_capacity(entry.size().min(usize::MAX as u64) as usize);
            entry.read_to_end(&mut stored)?;
            let bytes = if protected_data::is_protected_blob(&stored) {
                protected_data::unprotect_bytes(
                    protected_data::BACKUP_SECRET_ENTRY_DOMAIN,
                    &backup_secret_scope(profile, backup_id, &name),
                    &stored,
                )?
            } else {
                // Archives created before this hardening remain readable. New
                // archives always take the protected branch in write_zip.
                stored
            };
            target.write_all(&bytes)?;
        } else {
            std::io::copy(&mut entry, &mut target)?;
        }
    }
    Ok(())
}

pub fn verify(backups_root: &Path, server_id: &str, backup_id: &str) -> AppResult<bool> {
    let _operation = operation_lock()?;
    validate_id(backup_id)?;
    let folder = backups_root.join(server_id);
    let source = folder.join(format!("{backup_id}.zip"));
    let metadata = read_metadata(&folder, backup_id);
    Ok(verify_path(
        &source,
        metadata
            .as_ref()
            .and_then(|info| (!info.sha256.is_empty()).then_some(info.sha256.as_str())),
    )
    .is_ok())
}

pub fn delete(backups_root: &Path, server_id: &str, backup_id: &str) -> AppResult<()> {
    let _operation = operation_lock()?;
    validate_id(backup_id)?;
    let folder = backups_root.join(server_id);
    let archive = folder.join(format!("{backup_id}.zip"));
    if !archive.is_file() {
        return Err(AppError::NotFound);
    }
    std::fs::remove_file(archive)?;
    let metadata = folder.join(format!("{backup_id}.json"));
    if metadata.is_file() {
        std::fs::remove_file(metadata)?;
    }
    Ok(())
}

pub fn cleanup_stale_parts(backups_root: &Path) -> AppResult<usize> {
    let _operation = operation_lock()?;
    cleanup_parts_older_than(backups_root, STALE_PART_MAX_AGE)
}

fn cleanup_parts_older_than(backups_root: &Path, max_age: Duration) -> AppResult<usize> {
    if !backups_root.is_dir() {
        return Ok(0);
    }
    let mut removed = 0;
    for server in std::fs::read_dir(backups_root)? {
        let server = server?;
        if !server.path().is_dir() {
            continue;
        }
        for entry in std::fs::read_dir(server.path())? {
            let entry = entry?;
            let path = entry.path();
            let is_partial = path
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| name.ends_with(".zip.part") || name.ends_with(".json.part"));
            if !is_partial || !path.is_file() {
                continue;
            }
            let old_enough = entry.metadata()?.modified()?.elapsed().unwrap_or_default() >= max_age;
            if old_enough {
                std::fs::remove_file(path)?;
                removed += 1;
            }
        }
    }
    Ok(removed)
}

fn validate_id(backup_id: &str) -> AppResult<()> {
    if backup_id.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | 'T' | 'Z')
    }) {
        Ok(())
    } else {
        Err(AppError::Validation(
            "バックアップIDが正しくありません".into(),
        ))
    }
}

fn validate_layout(source: &Path, backups_root: &Path) -> AppResult<()> {
    if source == backups_root
        || source.starts_with(backups_root)
        || backups_root.starts_with(source)
    {
        return Err(AppError::Validation(
            "バックアップ元と保存先を入れ子にはできません".into(),
        ));
    }
    Ok(())
}

fn verify_path(path: &Path, expected_hash: Option<&str>) -> AppResult<()> {
    if !path.is_file() {
        return Err(AppError::NotFound);
    }
    if let Some(expected) = expected_hash {
        if file_sha256(path)? != expected {
            return Err(AppError::Other(
                "バックアップのSHA-256が一致しません".into(),
            ));
        }
    }
    let mut archive = ZipArchive::new(File::open(path)?)
        .map_err(|error| AppError::Other(format!("バックアップZIPを開けません: {error}")))?;
    let mut buffer = [0_u8; 8192];
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| AppError::Other(format!("バックアップ項目を読めません: {error}")))?;
        while entry
            .read(&mut buffer)
            .map_err(|error| AppError::Other(format!("バックアップが破損しています: {error}")))?
            > 0
        {}
    }
    Ok(())
}

fn file_sha256(path: &Path) -> AppResult<String> {
    let mut file = BufReader::with_capacity(COPY_BUFFER_BYTES, File::open(path)?);
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(hex::encode(digest.finalize()))
}

fn ensure_space(backups_root: &Path, estimated: u64) -> AppResult<()> {
    let disks = Disks::new_with_refreshed_list();
    let selected = disks
        .list()
        .iter()
        .filter(|disk| backups_root.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().as_os_str().len());
    if let Some(disk) = selected {
        let required = estimated.saturating_add(512 * 1024 * 1024);
        if disk.available_space() < required {
            return Err(AppError::Validation(format!(
                "バックアップ先の空き容量が不足しています。少なくとも約{} MiB必要です",
                required / 1024 / 1024
            )));
        }
    }
    Ok(())
}

fn extension_summary(profile: &ServerProfile) -> String {
    let root = Path::new(&profile.root_path);
    if profile.server_type == "bedrock" {
        let count_packs = |folder: PathBuf| {
            std::fs::read_dir(folder)
                .into_iter()
                .flatten()
                .flatten()
                .filter(|entry| {
                    entry.path().is_dir() && entry.path().join("manifest.json").is_file()
                })
                .count()
        };
        return format!(
            "behavior_packs={} resource_packs={}",
            count_packs(root.join("behavior_packs")),
            count_packs(root.join("resource_packs")),
        );
    }
    let count = |folder: PathBuf, extension: &str| {
        std::fs::read_dir(folder)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case(extension))
            })
            .count()
    };
    format!(
        "mods={} plugins={} datapacks={}",
        count(root.join("mods"), "jar"),
        count(root.join("plugins"), "jar"),
        count(
            root.join(&profile.settings.world_name).join("datapacks"),
            "zip"
        )
    )
}

fn scan_source(root: &Path, scope: BackupScope) -> AppResult<SourceScan> {
    let mut size_bytes = 0_u64;
    let mut file_count = 0_u64;
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry
            .map_err(|error| AppError::Other(format!("バックアップ元を読み取れません: {error}")))?;
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|error| AppError::Other(error.to_string()))?;
        if should_skip(
            relative,
            entry.file_type().is_symlink(),
            entry.file_type().is_dir(),
            scope,
        ) {
            continue;
        }
        if entry.file_type().is_file() {
            let metadata = entry.metadata().map_err(|error| {
                AppError::Other(format!("バックアップ元の容量を確認できません: {error}"))
            })?;
            size_bytes = size_bytes.saturating_add(metadata.len());
            file_count = file_count.saturating_add(1);
        }
    }
    Ok(SourceScan {
        size_bytes,
        file_count,
    })
}

fn write_zip<F>(
    root: &Path,
    destination: &Path,
    profile: &ServerProfile,
    scan: SourceScan,
    scope: BackupScope,
    backup_id: &str,
    on_progress: &mut F,
) -> AppResult<()>
where
    F: FnMut(&BackupProgress),
{
    let file = File::create(destination)?;
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    let mut bytes_processed = 0_u64;
    let mut files_processed = 0_u64;
    let mut next_progress = PROGRESS_INTERVAL_BYTES;

    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry
            .map_err(|error| AppError::Other(format!("バックアップ元を読み取れません: {error}")))?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|error| AppError::Other(error.to_string()))?;
        if should_skip(
            relative,
            entry.file_type().is_symlink(),
            entry.file_type().is_dir(),
            scope,
        ) {
            continue;
        }
        let name = relative.to_string_lossy().replace('\\', "/");
        if entry.file_type().is_dir() {
            writer
                .add_directory(format!("{name}/"), options)
                .map_err(|error| AppError::Other(error.to_string()))?;
            continue;
        }
        let file_size = entry
            .metadata()
            .map_err(|error| {
                AppError::Other(format!("バックアップ元の容量を確認できません: {error}"))
            })?
            .len();
        let protect_entry = is_palworld_secret_entry(profile, &name);
        if protect_entry && file_size > MAX_PROTECTED_ENTRY_BYTES {
            return Err(AppError::Validation(
                "Palworld設定バックアップが上限を超えているため保護保存を中止しました".into(),
            ));
        }
        writer
            .start_file(name.clone(), options.large_file(requires_zip64(file_size)))
            .map_err(|error| AppError::Other(error.to_string()))?;
        if protect_entry {
            let source_bytes = std::fs::read(path)?;
            let protected = protected_data::protect_bytes(
                protected_data::BACKUP_SECRET_ENTRY_DOMAIN,
                &backup_secret_scope(profile, backup_id, &name),
                &source_bytes,
            )?;
            writer.write_all(&protected)?;
            bytes_processed = bytes_processed.saturating_add(source_bytes.len() as u64);
        } else {
            let mut input = BufReader::with_capacity(COPY_BUFFER_BYTES, File::open(path)?);
            loop {
                let read = input.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                writer.write_all(&buffer[..read])?;
                bytes_processed = bytes_processed.saturating_add(read as u64);
                if bytes_processed >= next_progress {
                    emit_progress(
                        on_progress,
                        profile,
                        "creating",
                        bytes_processed,
                        scan.size_bytes,
                        files_processed,
                        scan.file_count,
                    );
                    next_progress = bytes_processed.saturating_add(PROGRESS_INTERVAL_BYTES);
                }
            }
        }
        files_processed = files_processed.saturating_add(1);
        emit_progress(
            on_progress,
            profile,
            "creating",
            bytes_processed,
            scan.size_bytes,
            files_processed,
            scan.file_count,
        );
    }
    writer
        .finish()
        .map_err(|error| AppError::Other(error.to_string()))?;
    Ok(())
}

fn is_palworld_secret_entry(profile: &ServerProfile, name: &str) -> bool {
    profile.game_adapter().is_palworld()
        && name.eq_ignore_ascii_case("Pal/Saved/Config/WindowsServer/PalWorldSettings.ini")
}

fn backup_secret_scope(profile: &ServerProfile, backup_id: &str, name: &str) -> String {
    format!(
        "{}\u{1f}{}\u{1f}{}",
        profile.id,
        backup_id,
        name.to_ascii_lowercase()
    )
}

fn requires_zip64(file_size: u64) -> bool {
    const ZIP64_SAFE_THRESHOLD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
    file_size >= ZIP64_SAFE_THRESHOLD_BYTES
}

fn should_skip(relative: &Path, symlink: bool, is_dir: bool, scope: BackupScope) -> bool {
    if relative.as_os_str().is_empty() || relative.starts_with(".server-hub") || symlink {
        return true;
    }
    scope == BackupScope::PalworldEssential && !is_palworld_essential_path(relative, is_dir)
}

fn is_palworld_essential_path(relative: &Path, is_dir: bool) -> bool {
    let normalized = relative.to_string_lossy().replace('\\', "/").to_lowercase();
    let excluded_saved = ["pal/saved/logs", "pal/saved/crashes", "pal/saved/profiling"];
    if excluded_saved
        .iter()
        .any(|path| normalized == *path || normalized.starts_with(&format!("{path}/")))
    {
        return false;
    }

    let roots = [
        "pal/saved",
        "mods",
        "pal/mods",
        "pal/binaries/win64/mods",
        "pal/content/paks",
        "steamapps/workshop/content/1623730",
    ];
    let related = roots.iter().any(|root| {
        normalized == *root
            || normalized.starts_with(&format!("{root}/"))
            || (is_dir && root.starts_with(&format!("{normalized}/")))
    });
    if !related {
        return false;
    }

    !normalized.starts_with("pal/content/paks/pal-windowsserver.")
}

fn emit_progress<F>(
    on_progress: &mut F,
    profile: &ServerProfile,
    stage: &str,
    bytes_processed: u64,
    total_bytes: u64,
    files_processed: u64,
    total_files: u64,
) where
    F: FnMut(&BackupProgress),
{
    let percent = if stage == "completed" {
        100
    } else if total_bytes == 0 {
        0
    } else {
        ((bytes_processed.saturating_mul(100) / total_bytes).min(99)) as u8
    };
    on_progress(&BackupProgress {
        server_id: profile.id.clone(),
        stage: stage.into(),
        bytes_processed,
        total_bytes,
        files_processed,
        total_files,
        percent,
    });
}

fn kind_from_label(label: &str) -> BackupKind {
    match label.trim().to_ascii_lowercase().as_str() {
        "scheduled" => BackupKind::Scheduled,
        "before-restore" => BackupKind::BeforeRestore,
        "before-settings" => BackupKind::BeforeSettings,
        "before-extension" | "before-extension-remove" => BackupKind::BeforeExtension,
        "before-update" => BackupKind::BeforeUpdate,
        "before-world-regeneration" => BackupKind::BeforeWorldRegeneration,
        "before-server-delete" => BackupKind::BeforeServerDelete,
        "initial-import" => BackupKind::InitialImport,
        _ => BackupKind::Manual,
    }
}

fn display_name(label: &str, kind: &BackupKind) -> String {
    let requested = label.trim().chars().take(80).collect::<String>();
    if !requested.is_empty() {
        return requested;
    }
    match kind {
        BackupKind::Scheduled => "予約バックアップ",
        BackupKind::BeforeRestore => "復元直前",
        BackupKind::BeforeSettings => "設定変更前",
        BackupKind::BeforeExtension => "拡張機能変更前",
        BackupKind::BeforeUpdate => "更新前",
        BackupKind::BeforeWorldRegeneration => "ワールド再生成前",
        BackupKind::BeforeServerDelete => "サーバー削除前",
        BackupKind::InitialImport => "取り込み時",
        BackupKind::Manual | BackupKind::Legacy => "手動バックアップ",
    }
    .into()
}

fn legacy_info(id: &str, path: &Path, size_bytes: u64) -> BackupInfo {
    BackupInfo {
        id: id.into(),
        created_at: id.replace('_', ":"),
        size_bytes,
        path: path.display().to_string(),
        server_name: "旧形式バックアップ".into(),
        minecraft_version: "unknown".into(),
        server_type: "unknown".into(),
        extension_summary: "メタデータなし".into(),
        sha256: String::new(),
        valid: false,
        schema_version: 1,
        kind: BackupKind::Legacy,
        display_name: id.into(),
        source_size_bytes: 0,
        file_count: 0,
        verified_at: None,
        pinned: true,
        schedule_id: None,
    }
}

fn read_metadata(folder: &Path, backup_id: &str) -> Option<BackupInfo> {
    std::fs::read(folder.join(format!("{backup_id}.json")))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<BackupInfo>(&bytes).ok())
}

fn write_metadata(folder: &Path, backup_id: &str, info: &BackupInfo) -> AppResult<()> {
    let temporary = folder.join(format!("{backup_id}.json.part"));
    let destination = folder.join(format!("{backup_id}.json"));
    let result = (|| -> AppResult<()> {
        std::fs::write(&temporary, serde_json::to_vec_pretty(info)?)?;
        std::fs::rename(&temporary, &destination)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        path::Path,
        time::Duration,
    };

    use super::{
        cleanup_parts_older_than, create, create_palworld_essential, create_with_progress, delete,
        extract_archive, is_palworld_essential_path, requires_zip64, restore, verify,
    };
    use crate::models::{BackupInfo, BackupKind, BasicSettings, ServerProfile};

    fn profile(root: &Path) -> ServerProfile {
        ServerProfile {
            id: "backup-test".into(),
            name: "Backup Test".into(),
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
    fn enables_zip64_before_writing_a_four_gibibyte_file() {
        assert!(!requires_zip64(2 * 1024 * 1024 * 1024 - 1));
        assert!(requires_zip64(2 * 1024 * 1024 * 1024));
        assert!(requires_zip64(u32::MAX as u64));
        assert!(requires_zip64(u32::MAX as u64 + 1));
    }

    #[test]
    fn palworld_essential_scope_includes_user_data_and_excludes_official_content() {
        assert!(is_palworld_essential_path(
            Path::new("Pal/Saved/SaveGames/0/Level.sav"),
            false
        ));
        assert!(is_palworld_essential_path(
            Path::new("Pal/Saved/Config/WindowsServer/PalWorldSettings.ini"),
            false
        ));
        assert!(is_palworld_essential_path(
            Path::new("Mods/MyMod/config.json"),
            false
        ));
        assert!(is_palworld_essential_path(
            Path::new("Pal/Content/Paks/MyCommunityMod.pak"),
            false
        ));
        assert!(is_palworld_essential_path(
            Path::new("steamapps/workshop/content/1623730/123/mod.pak"),
            false
        ));
        assert!(!is_palworld_essential_path(
            Path::new("Pal/Content/Paks/Pal-WindowsServer.pak"),
            false
        ));
        assert!(!is_palworld_essential_path(
            Path::new("Pal/Saved/Logs/Pal.log"),
            false
        ));
        assert!(!is_palworld_essential_path(
            Path::new("PalServer.exe"),
            false
        ));
    }

    #[test]
    fn creates_verified_palworld_essential_archive_without_official_files() {
        let base = std::env::temp_dir().join(format!(
            "msh-palworld-essential-test-{}",
            uuid::Uuid::new_v4()
        ));
        let root = base.join("server");
        let backups = base.join("backups");
        std::fs::create_dir_all(root.join("Pal/Saved/SaveGames/0")).unwrap();
        std::fs::create_dir_all(root.join("Pal/Saved/Config/WindowsServer")).unwrap();
        std::fs::create_dir_all(root.join("Pal/Saved/Logs")).unwrap();
        std::fs::create_dir_all(root.join("Pal/Content/Paks")).unwrap();
        std::fs::create_dir_all(root.join("Mods")).unwrap();
        std::fs::write(root.join("Pal/Saved/SaveGames/0/Level.sav"), b"world").unwrap();
        std::fs::write(
            root.join("Pal/Saved/Config/WindowsServer/PalWorldSettings.ini"),
            b"password=settings",
        )
        .unwrap();
        std::fs::write(root.join("Pal/Saved/Logs/Pal.log"), b"log").unwrap();
        std::fs::write(
            root.join("Pal/Content/Paks/Pal-WindowsServer.pak"),
            b"official",
        )
        .unwrap();
        std::fs::write(root.join("Pal/Content/Paks/MyCommunityMod.pak"), b"mod").unwrap();
        std::fs::write(root.join("Mods/mod-config.json"), b"mod-settings").unwrap();
        let mut profile = profile(&root);
        profile.game_kind = "palworld".into();
        profile.server_type = "palworld".into();
        let info = create_palworld_essential(&backups, &profile, "before-server-delete").unwrap();
        assert!(verify(&backups, &profile.id, &info.id).unwrap());
        let file = std::fs::File::open(&info.path).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        assert!(archive.by_name("Pal/Saved/SaveGames/0/Level.sav").is_ok());
        let stored_settings = {
            let mut protected_settings = archive
                .by_name("Pal/Saved/Config/WindowsServer/PalWorldSettings.ini")
                .unwrap();
            let mut stored_settings = Vec::new();
            protected_settings
                .read_to_end(&mut stored_settings)
                .unwrap();
            stored_settings
        };
        assert!(crate::protected_data::is_protected_blob(&stored_settings));
        assert!(
            !stored_settings
                .windows(b"password=settings".len())
                .any(|window| window == b"password=settings")
        );
        assert!(archive.by_name("Mods/mod-config.json").is_ok());
        assert!(
            archive
                .by_name("Pal/Content/Paks/MyCommunityMod.pak")
                .is_ok()
        );
        assert!(
            archive
                .by_name("Pal/Content/Paks/Pal-WindowsServer.pak")
                .is_err()
        );
        assert!(archive.by_name("Pal/Saved/Logs/Pal.log").is_err());
        drop(archive);
        let restored = base.join("restored");
        std::fs::create_dir_all(&restored).unwrap();
        extract_archive(Path::new(&info.path), &restored, &profile, &info.id).unwrap();
        assert!(
            std::fs::read(restored.join("Pal/Saved/Config/WindowsServer/PalWorldSettings.ini"))
                .unwrap()
                == b"password=settings"
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn creates_and_restores_round_trip_with_safety_backup() {
        let base = std::env::temp_dir().join(format!("msh-backup-test-{}", uuid::Uuid::new_v4()));
        let root = base.join("server");
        let backups = base.join("backups");
        std::fs::create_dir_all(root.join("world")).unwrap();
        std::fs::write(root.join("world").join("level.dat"), b"original-world").unwrap();
        std::fs::write(root.join("server.properties"), b"level-name=world").unwrap();
        let profile = profile(&root);
        let backup = create(&backups, &profile, "roundtrip").unwrap();
        assert_eq!(backup.kind, BackupKind::Manual);
        assert!(backup.pinned);
        assert_eq!(backup.schema_version, 2);
        assert_eq!(backup.file_count, 2);
        std::fs::write(root.join("world").join("level.dat"), b"changed-world").unwrap();
        std::fs::write(root.join("added-after-backup.txt"), b"remove-me").unwrap();
        restore(&backups, &profile, &backup.id).unwrap();
        assert_eq!(
            std::fs::read(root.join("world").join("level.dat")).unwrap(),
            b"original-world"
        );
        assert!(!root.join("added-after-backup.txt").exists());
        assert!(
            std::fs::read_dir(backups.join("backup-test"))
                .unwrap()
                .count()
                >= 4
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn includes_bedrock_packs_in_backup_metadata() {
        let base =
            std::env::temp_dir().join(format!("msh-bedrock-backup-test-{}", uuid::Uuid::new_v4()));
        let root = base.join("server");
        let backups = base.join("backups");
        std::fs::create_dir_all(root.join("behavior_packs/example")).unwrap();
        std::fs::create_dir_all(root.join("resource_packs/example")).unwrap();
        std::fs::write(root.join("server.properties"), b"level-name=Bedrock level").unwrap();
        std::fs::write(root.join("bedrock_server.exe"), b"fixture").unwrap();
        std::fs::write(root.join("behavior_packs/example/manifest.json"), b"{}").unwrap();
        std::fs::write(root.join("resource_packs/example/manifest.json"), b"{}").unwrap();
        let mut profile = profile(&root);
        profile.server_type = "bedrock".into();
        profile.launch_target = "bedrock_server.exe".into();
        profile.minecraft_version = "1.26.44.3".into();
        profile.java_path.clear();
        profile.java_major = 0;
        profile.min_memory_mib = 0;
        profile.max_memory_mib = 0;
        profile.port = 19132;

        let backup = create(&backups, &profile, "bedrock-packs").unwrap();
        assert_eq!(
            backup.extension_summary,
            "behavior_packs=1 resource_packs=1"
        );
        assert!(verify(&backups, &profile.id, &backup.id).unwrap());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn detects_tampering_and_deletes_archive_with_metadata() {
        let base =
            std::env::temp_dir().join(format!("msh-backup-tamper-test-{}", uuid::Uuid::new_v4()));
        let root = base.join("server");
        let backups = base.join("backups");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("server.properties"), b"motd=test").unwrap();
        let profile = profile(&root);
        let info = create(&backups, &profile, "tamper").unwrap();
        assert!(verify(&backups, &profile.id, &info.id).unwrap());
        std::fs::OpenOptions::new()
            .append(true)
            .open(&info.path)
            .unwrap()
            .write_all(b"tampered")
            .unwrap();
        assert!(!verify(&backups, &profile.id, &info.id).unwrap());
        delete(&backups, &profile.id, &info.id).unwrap();
        assert!(!std::path::Path::new(&info.path).exists());
        assert!(
            !backups
                .join(&profile.id)
                .join(format!("{}.json", info.id))
                .exists()
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn streams_progress_and_classifies_scheduled_backups_as_prunable() {
        let base =
            std::env::temp_dir().join(format!("msh-backup-progress-test-{}", uuid::Uuid::new_v4()));
        let root = base.join("server");
        let backups = base.join("backups");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("server.properties"), b"motd=test").unwrap();
        std::fs::write(root.join("large.bin"), vec![7_u8; 3 * 1024 * 1024]).unwrap();
        let profile = profile(&root);
        let mut events = Vec::new();
        let info = create_with_progress(&backups, &profile, "scheduled", |progress| {
            events.push(progress.clone())
        })
        .unwrap();
        assert_eq!(info.kind, BackupKind::Scheduled);
        assert!(!info.pinned);
        assert!(
            events
                .iter()
                .any(|event| event.stage == "creating" && event.bytes_processed > 0)
        );
        assert_eq!(
            events
                .last()
                .map(|event| (event.stage.as_str(), event.percent)),
            Some(("completed", 100))
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn reads_old_metadata_as_protected_legacy_backup() {
        let json = serde_json::json!({
            "id": "old", "createdAt": "2026-01-01T00:00:00Z", "sizeBytes": 12,
            "path": "old.zip", "serverName": "Old", "minecraftVersion": "1.20.1",
            "serverType": "forge", "extensionSummary": "metadata", "sha256": "abc", "valid": true
        });
        let info: BackupInfo = serde_json::from_value(json).unwrap();
        assert_eq!(info.schema_version, 1);
        assert_eq!(info.kind, BackupKind::Legacy);
        assert!(info.pinned);
    }

    #[test]
    fn removes_only_partial_backup_files_during_recovery() {
        let base =
            std::env::temp_dir().join(format!("msh-backup-part-test-{}", uuid::Uuid::new_v4()));
        let folder = base.join("server-id");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("interrupted.zip.part"), b"partial").unwrap();
        std::fs::write(folder.join("keep.zip"), b"keep").unwrap();
        assert_eq!(cleanup_parts_older_than(&base, Duration::ZERO).unwrap(), 1);
        assert!(!folder.join("interrupted.zip.part").exists());
        assert!(folder.join("keep.zip").exists());
        std::fs::remove_dir_all(base).unwrap();
    }
}
