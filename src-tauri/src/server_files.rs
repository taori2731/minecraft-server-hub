use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    models::ServerProfile,
};

const MAX_TEXT_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerFileEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size_bytes: u64,
    pub modified_at: Option<u64>,
    pub editable: bool,
}

fn clean_relative(value: &str, allow_empty: bool) -> AppResult<PathBuf> {
    let path = Path::new(value);
    if path.is_absolute() || (!allow_empty && value.trim().is_empty()) {
        return Err(AppError::Validation(
            "サーバーフォルダー内の相対パスを指定してください".into(),
        ));
    }
    let mut cleaned = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => cleaned.push(value),
            Component::CurDir => {}
            _ => {
                return Err(AppError::Validation(
                    "親フォルダーへ移動するパスは使用できません".into(),
                ));
            }
        }
    }
    if !allow_empty && cleaned.as_os_str().is_empty() {
        return Err(AppError::Validation(
            "ファイル名またはフォルダー名を指定してください".into(),
        ));
    }
    Ok(cleaned)
}

fn root(profile: &ServerProfile) -> AppResult<PathBuf> {
    let path = PathBuf::from(&profile.root_path).canonicalize()?;
    if !path.is_dir() {
        return Err(AppError::Validation(
            "サーバーフォルダーが見つかりません".into(),
        ));
    }
    Ok(path)
}

fn existing(profile: &ServerProfile, relative: &str) -> AppResult<(PathBuf, PathBuf)> {
    let root = root(profile)?;
    let relative = clean_relative(relative, true)?;
    let target = root.join(&relative).canonicalize()?;
    if !target.starts_with(&root) {
        return Err(AppError::Validation(
            "サーバーフォルダー外にはアクセスできません".into(),
        ));
    }
    Ok((root, target))
}

fn new_target(profile: &ServerProfile, relative: &str) -> AppResult<(PathBuf, PathBuf)> {
    let root = root(profile)?;
    let relative = clean_relative(relative, false)?;
    let target = root.join(&relative);
    let parent = target
        .parent()
        .ok_or_else(|| AppError::Validation("保存先が正しくありません".into()))?
        .canonicalize()?;
    if !parent.starts_with(&root) {
        return Err(AppError::Validation(
            "サーバーフォルダー外には保存できません".into(),
        ));
    }
    Ok((root, target))
}

fn relative_text(root: &Path, target: &Path) -> AppResult<String> {
    Ok(target
        .strip_prefix(root)
        .map_err(|_| AppError::Validation("サーバーフォルダー外にはアクセスできません".into()))?
        .to_string_lossy()
        .replace('\\', "/"))
}

fn editable(path: &Path, size: u64) -> bool {
    size <= MAX_TEXT_BYTES
        && path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| {
                matches!(
                    value.to_ascii_lowercase().as_str(),
                    "txt"
                        | "log"
                        | "json"
                        | "json5"
                        | "yml"
                        | "yaml"
                        | "toml"
                        | "properties"
                        | "conf"
                        | "cfg"
                        | "ini"
                        | "xml"
                        | "md"
                        | "sh"
                        | "bat"
                        | "cmd"
                )
            })
}

pub fn list(profile: &ServerProfile, relative: &str) -> AppResult<Vec<ServerFileEntry>> {
    let (root, directory) = existing(profile, relative)?;
    if !directory.is_dir() {
        return Err(AppError::Validation("フォルダーを指定してください".into()));
    }
    let mut items = Vec::new();
    for item in fs::read_dir(directory)? {
        let item = item?;
        let metadata = fs::symlink_metadata(item.path())?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let path = item.path();
        let is_dir = metadata.is_dir();
        items.push(ServerFileEntry {
            name: item.file_name().to_string_lossy().into_owned(),
            path: relative_text(&root, &path)?,
            kind: if is_dir {
                "directory".into()
            } else {
                "file".into()
            },
            size_bytes: if is_dir { 0 } else { metadata.len() },
            modified_at: metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|value| value.as_secs()),
            editable: !is_dir && editable(&path, metadata.len()),
        });
    }
    items.sort_by(|left, right| {
        (left.kind != "directory", left.name.to_ascii_lowercase())
            .cmp(&(right.kind != "directory", right.name.to_ascii_lowercase()))
    });
    Ok(items)
}

pub fn read_text(profile: &ServerProfile, relative: &str) -> AppResult<String> {
    let (_, path) = existing(profile, relative)?;
    let metadata = path.metadata()?;
    if !metadata.is_file() || !editable(&path, metadata.len()) {
        return Err(AppError::Validation(
            "このファイルはアプリ内テキスト編集に対応していません".into(),
        ));
    }
    String::from_utf8(fs::read(path)?)
        .map_err(|_| AppError::Validation("UTF-8テキストとして読み取れません".into()))
}

pub fn write_text(profile: &ServerProfile, relative: &str, content: &str) -> AppResult<()> {
    if content.len() as u64 > MAX_TEXT_BYTES {
        return Err(AppError::Validation(
            "テキストファイルは2 MiB以下にしてください".into(),
        ));
    }
    let (_, target) = new_target(profile, relative)?;
    if target.exists() && !target.is_file() {
        return Err(AppError::Validation(
            "ファイル以外には保存できません".into(),
        ));
    }
    let temporary = target.with_extension(format!("msh-tmp-{}", uuid::Uuid::new_v4()));
    fs::write(&temporary, content.as_bytes())?;
    let result = if target.exists() {
        replace_existing_file(&target, &temporary)
    } else {
        fs::rename(&temporary, &target).map_err(Into::into)
    };
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

#[cfg(windows)]
fn replace_existing_file(target: &Path, replacement: &Path) -> AppResult<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        Win32::Storage::FileSystem::{REPLACE_FILE_FLAGS, ReplaceFileW},
        core::PCWSTR,
    };
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let replacement = replacement
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    unsafe {
        ReplaceFileW(
            PCWSTR(target.as_ptr()),
            PCWSTR(replacement.as_ptr()),
            PCWSTR::null(),
            REPLACE_FILE_FLAGS(0),
            None,
            None,
        )
    }
    .map_err(|error| {
        AppError::Other(format!(
            "ファイルを原子的に置き換えられませんでした: {error}"
        ))
    })
}

#[cfg(not(windows))]
fn replace_existing_file(target: &Path, replacement: &Path) -> AppResult<()> {
    fs::rename(replacement, target).map_err(Into::into)
}

pub fn create_directory(profile: &ServerProfile, relative: &str) -> AppResult<()> {
    let (_, target) = new_target(profile, relative)?;
    if target.exists() {
        return Err(AppError::Validation(
            "同じ名前の項目がすでにあります".into(),
        ));
    }
    fs::create_dir(&target)?;
    Ok(())
}

pub fn rename(profile: &ServerProfile, relative: &str, new_name: &str) -> AppResult<String> {
    let new_component = clean_relative(new_name, false)?;
    if new_component.components().count() != 1 {
        return Err(AppError::Validation(
            "新しい名前だけを入力してください".into(),
        ));
    }
    let (root, target) = existing(profile, relative)?;
    if target == root {
        return Err(AppError::Validation(
            "サーバールートの名前はここでは変更できません".into(),
        ));
    }
    let destination = target.parent().unwrap().join(new_component);
    if destination.exists() {
        return Err(AppError::Validation(
            "同じ名前の項目がすでにあります".into(),
        ));
    }
    fs::rename(&target, &destination)?;
    relative_text(&root, &destination)
}

pub fn delete(profile: &ServerProfile, relative: &str) -> AppResult<()> {
    let (root, target) = existing(profile, relative)?;
    if target == root {
        return Err(AppError::Validation(
            "サーバールートは削除できません".into(),
        ));
    }
    if target.is_dir() {
        fs::remove_dir_all(target)?;
    } else {
        fs::remove_file(target)?;
    }
    Ok(())
}

pub fn upload(profile: &ServerProfile, directory: &str, source: &str) -> AppResult<String> {
    let source = PathBuf::from(source).canonicalize()?;
    if !source.is_file() {
        return Err(AppError::Validation(
            "アップロードするファイルを選択してください".into(),
        ));
    }
    let name = source
        .file_name()
        .ok_or_else(|| AppError::Validation("ファイル名を取得できません".into()))?;
    let relative = clean_relative(directory, true)?.join(name);
    let relative_value = relative.to_string_lossy().into_owned();
    let (root, target) = new_target(profile, &relative_value)?;
    if target.exists() {
        return Err(AppError::Validation(
            "同じ名前のファイルがすでにあります".into(),
        ));
    }
    fs::copy(source, &target)?;
    relative_text(&root, &target)
}

pub fn download(profile: &ServerProfile, relative: &str, destination: &str) -> AppResult<()> {
    let (_, source) = existing(profile, relative)?;
    if !source.is_file() {
        return Err(AppError::Validation(
            "ダウンロードするファイルを選択してください".into(),
        ));
    }
    let destination = PathBuf::from(destination);
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::Validation("保存先が正しくありません".into()))?;
    if !parent.is_dir() {
        return Err(AppError::Validation(
            "保存先フォルダーが見つかりません".into(),
        ));
    }
    fs::copy(source, destination)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::clean_relative;
    #[test]
    fn rejects_parent_and_absolute_paths() {
        assert!(clean_relative("../secret", false).is_err());
        assert!(clean_relative("C:\\Windows", false).is_err());
        assert!(clean_relative("world/level.dat", false).is_ok());
    }
}
