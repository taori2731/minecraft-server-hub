use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

use chrono::Utc;
use regex::Regex;
use zip::ZipArchive;

use crate::{
    error::AppResult,
    models::{ExtensionCheckItem, ExtensionCheckReport, ServerProfile},
};

#[derive(Default)]
struct Metadata {
    id: Option<String>,
    minecraft: Option<String>,
    loader: Option<String>,
    dependencies: Vec<String>,
    client_required: bool,
}

pub fn check(profile: &ServerProfile) -> AppResult<ExtensionCheckReport> {
    let root = Path::new(&profile.root_path);
    let mut files = Vec::<(PathBuf, String)>::new();
    for (folder, kind) in [
        (root.join("mods"), "mod"),
        (root.join("plugins"), "plugin"),
        (
            root.join(&profile.settings.world_name).join("datapacks"),
            "datapack",
        ),
    ] {
        if !folder.is_dir() {
            continue;
        }
        for entry in std::fs::read_dir(folder)?.flatten() {
            if entry.file_type().is_ok_and(|value| value.is_file()) {
                files.push((entry.path(), kind.into()));
            }
        }
    }
    let managed = managed_files(root)?;
    let mut items = Vec::new();
    let mut ids = HashMap::<String, Vec<String>>::new();
    let mut present_ids = HashSet::new();
    let mut parsed = Vec::new();
    for (path, kind) in &files {
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let metadata = inspect_archive(path, kind);
        if let Some(id) = metadata.id.clone() {
            present_ids.insert(id.to_ascii_lowercase());
            ids.entry(id.to_ascii_lowercase())
                .or_default()
                .push(name.clone());
        }
        if let Some(loader) = metadata.loader.as_deref() {
            let expected = expected_loader(profile, kind);
            if loader != expected && loader != "universal" {
                items.push(item(
                    "error",
                    "loader-mismatch",
                    "ローダーが一致しません",
                    format!("{name} は {loader} 用ですが、このサーバーは {expected} です。"),
                    vec![name.clone()],
                    "対応するローダー版へ入れ替えてください",
                ));
            }
        }
        if let Some(version) = metadata.minecraft.as_deref() {
            if !version_matches(version, &profile.minecraft_version) {
                items.push(item(
                    "warning",
                    "minecraft-version",
                    "Minecraft版を再確認してください",
                    format!(
                        "{name} のメタデータは {version}、サーバーは {} です。",
                        profile.minecraft_version
                    ),
                    vec![name.clone()],
                    "配布元の対応バージョンを確認してください",
                ));
            }
        }
        if metadata.client_required {
            items.push(item(
                "info",
                "client-required",
                "参加者側にも必要なModです",
                format!("{name} はクライアント側にも導入が必要と記録されています。"),
                vec![name.clone()],
                "参加する友達へ同じ版を案内してください",
            ));
        }
        parsed.push((name, metadata));
    }
    for (id, duplicates) in ids {
        if duplicates.len() > 1 {
            items.push(item(
                "error",
                "duplicate-id",
                "同じMod／プラグインが重複しています",
                format!("ID「{id}」が{}件あります。", duplicates.len()),
                duplicates,
                "古い版または重複ファイルを無効化してください",
            ));
        }
    }
    for (name, metadata) in parsed {
        let missing = metadata
            .dependencies
            .into_iter()
            .filter(|value| {
                !built_in_dependency(value) && !present_ids.contains(&value.to_ascii_lowercase())
            })
            .collect::<Vec<_>>();
        if !missing.is_empty() {
            items.push(item(
                "error",
                "missing-dependency",
                "必須依存が不足しています",
                format!("{name} に必要な {} が見つかりません。", missing.join(", ")),
                vec![name],
                "不足している依存Mod／プラグインを追加してください",
            ));
        }
    }
    for (path, _) in &files {
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        if !managed.contains(&name.to_ascii_lowercase()) {
            items.push(item(
                "info",
                "unmanaged-file",
                "手動追加ファイルです",
                format!("{name} は配布元IDを記録していないため、自動更新対象にしません。"),
                vec![name],
                "必要なら配布元で最新版と互換性を確認してください",
            ));
        }
    }
    items.sort_by_key(|value| match value.severity.as_str() {
        "error" => 0,
        "warning" => 1,
        _ => 2,
    });
    Ok(ExtensionCheckReport {
        checked_at: Utc::now().to_rfc3339(),
        blocking: items.iter().any(|value| value.severity == "error"),
        scanned_files: files.len(),
        managed_files: managed.len(),
        items,
        limitation: "JAR／ZIP内の公開メタデータとModrinth導入記録による事前検査です。実際のゲーム内競合や全Mod固有の条件を保証するものではありません。".into(),
    })
}

fn inspect_archive(path: &Path, kind: &str) -> Metadata {
    if !matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("jar" | "zip")
    ) {
        return Metadata::default();
    }
    let Ok(file) = File::open(path) else {
        return Metadata::default();
    };
    let Ok(mut archive) = ZipArchive::new(file) else {
        return Metadata::default();
    };
    if let Some(value) = read_zip_text(&mut archive, "fabric.mod.json", 1024 * 1024) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&value) {
            return Metadata {
                id: json
                    .get("id")
                    .and_then(|value| value.as_str())
                    .map(str::to_string),
                minecraft: json.pointer("/depends/minecraft").and_then(version_value),
                loader: Some("fabric".into()),
                dependencies: json
                    .get("depends")
                    .and_then(|value| value.as_object())
                    .map(|values| {
                        values
                            .keys()
                            .filter(|key| {
                                *key != "minecraft" && *key != "java" && *key != "fabricloader"
                            })
                            .cloned()
                            .collect()
                    })
                    .unwrap_or_default(),
                client_required: json
                    .get("environment")
                    .and_then(|value| value.as_str())
                    .is_some_and(|value| value == "client"),
            };
        }
    }
    for (name, loader) in [
        ("META-INF/mods.toml", "forge"),
        ("META-INF/neoforge.mods.toml", "neoforge"),
    ] {
        if let Some(value) = read_zip_text(&mut archive, name, 2 * 1024 * 1024) {
            let id = Regex::new(r#"(?m)^\s*modId\s*=\s*[\"']([^\"']+)"#)
                .ok()
                .and_then(|regex| regex.captures(&value))
                .and_then(|captures| captures.get(1))
                .map(|value| value.as_str().to_string());
            let minecraft = Regex::new(
                r#"(?s)modId\s*=\s*[\"']minecraft[\"'].*?versionRange\s*=\s*[\"']([^\"']+)"#,
            )
            .ok()
            .and_then(|regex| regex.captures(&value))
            .and_then(|captures| captures.get(1))
            .map(|value| value.as_str().to_string());
            let dependencies = Regex::new(r#"(?m)^\s*modId\s*=\s*[\"']([^\"']+)"#)
                .ok()
                .map(|regex| {
                    regex
                        .captures_iter(&value)
                        .filter_map(|capture| {
                            capture.get(1).map(|value| value.as_str().to_string())
                        })
                        .filter(|value| value != "minecraft" && Some(value) != id.as_ref())
                        .collect()
                })
                .unwrap_or_default();
            return Metadata {
                id,
                minecraft,
                loader: Some(loader.into()),
                dependencies,
                client_required: false,
            };
        }
    }
    if kind == "plugin" {
        if let Some(value) = read_zip_text(&mut archive, "plugin.yml", 1024 * 1024)
            .or_else(|| read_zip_text(&mut archive, "paper-plugin.yml", 1024 * 1024))
        {
            let field = |name: &str| {
                Regex::new(&format!(r"(?m)^{}:\s*([^#\r\n]+)", regex::escape(name)))
                    .ok()
                    .and_then(|regex| regex.captures(&value))
                    .and_then(|capture| capture.get(1))
                    .map(|value| value.as_str().trim().trim_matches(['\'', '"']).to_string())
            };
            let dependencies = field("depend")
                .map(|value| {
                    value
                        .trim_matches(['[', ']'])
                        .split(',')
                        .map(|item| item.trim().to_ascii_lowercase())
                        .filter(|item| !item.is_empty())
                        .collect()
                })
                .unwrap_or_default();
            return Metadata {
                id: field("name").map(|value| value.to_ascii_lowercase()),
                minecraft: field("api-version"),
                loader: Some("paper".into()),
                dependencies,
                client_required: false,
            };
        }
    }
    Metadata::default()
}

fn read_zip_text(archive: &mut ZipArchive<File>, name: &str, max: u64) -> Option<String> {
    let mut entry = archive.by_name(name).ok()?;
    if entry.size() > max {
        return None;
    }
    let mut value = String::new();
    entry.read_to_string(&mut value).ok()?;
    Some(value)
}

fn managed_files(root: &Path) -> AppResult<HashSet<String>> {
    let folder = root.join(".server-hub/extension-manifests");
    if !folder.is_dir() {
        return Ok(HashSet::new());
    }
    let mut values = HashSet::new();
    for entry in std::fs::read_dir(folder)?.flatten() {
        let Ok(bytes) = std::fs::read(entry.path()) else {
            continue;
        };
        let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
            continue;
        };
        if let Some(name) = value.get("fileName").and_then(|value| value.as_str()) {
            values.insert(name.to_ascii_lowercase());
        }
    }
    Ok(values)
}

fn expected_loader(profile: &ServerProfile, kind: &str) -> String {
    if kind == "plugin" {
        "paper".into()
    } else {
        profile.server_type.clone()
    }
}
fn version_value(value: &serde_json::Value) -> Option<String> {
    value.as_str().map(str::to_string).or_else(|| {
        value
            .as_array()
            .and_then(|items| items.first())
            .and_then(|value| value.as_str())
            .map(str::to_string)
    })
}
fn version_matches(requirement: &str, actual: &str) -> bool {
    requirement.contains(actual)
        || actual.starts_with(&format!("{requirement}."))
        || requirement == "*"
        || requirement.eq_ignore_ascii_case("any")
}
fn built_in_dependency(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "minecraft"
            | "java"
            | "fabricloader"
            | "forge"
            | "neoforge"
            | "paper"
            | "bukkit"
            | "spigot"
    )
}
fn item(
    severity: &str,
    code: &str,
    title: &str,
    detail: String,
    files: Vec<String>,
    next_action: &str,
) -> ExtensionCheckItem {
    ExtensionCheckItem {
        severity: severity.into(),
        code: code.into(),
        title: title.into(),
        detail,
        files,
        next_action: next_action.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn version_match_is_conservative() {
        assert!(version_matches(">=1.21.11", "1.21.11"));
        assert!(version_matches("1.21", "1.21.11"));
        assert!(!version_matches("1.20.1", "1.21.11"));
    }
    #[test]
    fn built_ins_are_not_reported_missing() {
        assert!(built_in_dependency("minecraft"));
        assert!(!built_in_dependency("cloth-config"));
    }
}
