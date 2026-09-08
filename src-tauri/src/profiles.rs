use std::path::{Path, PathBuf};

use chrono::Utc;
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::{ModpackProfile, ProfileDiff, ProfileEntry, ServerProfile},
};

pub fn list(root: &Path) -> AppResult<Vec<ModpackProfile>> {
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut profiles = std::fs::read_dir(root)?
        .flatten()
        .filter_map(|entry| {
            (entry.path().extension().and_then(|v| v.to_str()) == Some("json"))
                .then(|| std::fs::read(entry.path()).ok())
                .flatten()
                .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        })
        .collect::<Vec<_>>();
    profiles.sort_by(|a: &ModpackProfile, b| b.updated_at.cmp(&a.updated_at));
    Ok(profiles)
}

pub fn capture(root: &Path, server: &ServerProfile, name: &str) -> AppResult<ModpackProfile> {
    validate_name(name)?;
    std::fs::create_dir_all(root)?;
    let now = Utc::now().to_rfc3339();
    let profile = ModpackProfile {
        id: Uuid::new_v4().to_string(),
        name: name.trim().into(),
        source_server_id: server.id.clone(),
        minecraft_version: server.minecraft_version.clone(),
        server_type: server.server_type.clone(),
        loader: loader_name(server),
        mods: entries(Path::new(&server.root_path).join("mods"), "jar", true),
        plugins: entries(Path::new(&server.root_path).join("plugins"), "jar", false),
        datapacks: entries(
            Path::new(&server.root_path)
                .join(&server.settings.world_name)
                .join("datapacks"),
            "zip",
            false,
        ),
        configuration_files: configuration_files(Path::new(&server.root_path)),
        settings: server.settings.clone(),
        recommended_memory_mib: server.max_memory_mib,
        planned_players: server.settings.max_players,
        created_at: now.clone(),
        updated_at: now,
    };
    save(root, &profile)?;
    Ok(profile)
}

pub fn duplicate(root: &Path, id: &str) -> AppResult<ModpackProfile> {
    let mut profile = get(root, id)?;
    profile.id = Uuid::new_v4().to_string();
    profile.name = format!("{} のコピー", profile.name);
    let now = Utc::now().to_rfc3339();
    profile.created_at = now.clone();
    profile.updated_at = now;
    save(root, &profile)?;
    Ok(profile)
}

pub fn export(root: &Path, id: &str, destination: &Path) -> AppResult<()> {
    let profile = get(root, id)?;
    validate_destination(destination)?;
    std::fs::write(destination, serde_json::to_vec_pretty(&profile)?)?;
    Ok(())
}

pub fn import(root: &Path, source: &Path) -> AppResult<ModpackProfile> {
    if !source.is_file()
        || source
            .extension()
            .and_then(|v| v.to_str())
            .map(|v| v.eq_ignore_ascii_case("json"))
            != Some(true)
    {
        return Err(AppError::Validation(
            "JSONプロファイルを選択してください".into(),
        ));
    }
    let bytes = std::fs::read(source)?;
    if bytes.len() > 5 * 1024 * 1024 {
        return Err(AppError::Validation("プロファイルが大きすぎます".into()));
    }
    let mut profile: ModpackProfile = serde_json::from_slice(&bytes)?;
    validate_profile(&profile)?;
    profile.id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    profile.created_at = now.clone();
    profile.updated_at = now;
    std::fs::create_dir_all(root)?;
    save(root, &profile)?;
    Ok(profile)
}

pub fn diff(root: &Path, id: &str, server: &ServerProfile) -> AppResult<ProfileDiff> {
    let profile = get(root, id)?;
    let expected = names(&profile);
    let actual_profile = ModpackProfile {
        mods: entries(Path::new(&server.root_path).join("mods"), "jar", true),
        plugins: entries(Path::new(&server.root_path).join("plugins"), "jar", false),
        datapacks: entries(
            Path::new(&server.root_path)
                .join(&server.settings.world_name)
                .join("datapacks"),
            "zip",
            false,
        ),
        configuration_files: configuration_files(Path::new(&server.root_path)),
        ..profile.clone()
    };
    let actual = names(&actual_profile);
    let mut configuration_notes = Vec::new();
    if profile.minecraft_version != server.minecraft_version {
        configuration_notes.push(format!(
            "Minecraft版: プロファイル {} / サーバー {}",
            profile.minecraft_version, server.minecraft_version
        ));
    }
    if profile.server_type != server.server_type {
        configuration_notes.push(format!(
            "サーバー種類: プロファイル {} / サーバー {}",
            profile.server_type, server.server_type
        ));
    }
    if profile.recommended_memory_mib > server.max_memory_mib {
        configuration_notes.push(format!(
            "推奨メモリ {} MiBに対し、現在は {} MiBです",
            profile.recommended_memory_mib, server.max_memory_mib
        ));
    }
    let actual_configs = configuration_files(Path::new(&server.root_path));
    if profile.configuration_files != actual_configs {
        configuration_notes.push("保存時とconfigフォルダーのファイル一覧が異なります。内容は秘密情報保護のため比較していません。".into());
    }
    Ok(ProfileDiff {
        missing_from_server: expected.difference(&actual).cloned().collect(),
        extra_on_server: actual.difference(&expected).cloned().collect(),
        configuration_notes,
    })
}

pub fn delete(root: &Path, id: &str) -> AppResult<()> {
    validate_id(id)?;
    let path = root.join(format!("{id}.json"));
    if !path.is_file() {
        return Err(AppError::NotFound);
    }
    std::fs::remove_file(path)?;
    Ok(())
}

fn get(root: &Path, id: &str) -> AppResult<ModpackProfile> {
    validate_id(id)?;
    let path = root.join(format!("{id}.json"));
    if !path.is_file() {
        return Err(AppError::NotFound);
    }
    Ok(serde_json::from_slice(&std::fs::read(path)?)?)
}
fn save(root: &Path, profile: &ModpackProfile) -> AppResult<()> {
    validate_profile(profile)?;
    std::fs::write(
        root.join(format!("{}.json", profile.id)),
        serde_json::to_vec_pretty(profile)?,
    )?;
    Ok(())
}
fn validate_id(id: &str) -> AppResult<()> {
    Uuid::parse_str(id)
        .map(|_| ())
        .map_err(|_| AppError::Validation("プロファイルIDが正しくありません".into()))
}
fn validate_name(name: &str) -> AppResult<()> {
    if name.trim().is_empty() || name.chars().count() > 80 {
        Err(AppError::Validation(
            "プロファイル名は1～80文字で入力してください".into(),
        ))
    } else {
        Ok(())
    }
}
fn validate_destination(path: &Path) -> AppResult<()> {
    if !path.is_absolute()
        || path.parent().is_none_or(|parent| !parent.is_dir())
        || path
            .extension()
            .and_then(|v| v.to_str())
            .map(|v| !v.eq_ignore_ascii_case("json"))
            .unwrap_or(true)
    {
        Err(AppError::Validation(
            "既存フォルダー内の.json保存先を指定してください".into(),
        ))
    } else {
        Ok(())
    }
}
fn validate_profile(profile: &ModpackProfile) -> AppResult<()> {
    validate_id(&profile.id)?;
    validate_name(&profile.name)?;
    if profile.minecraft_version.trim().is_empty()
        || profile.recommended_memory_mib < 512
        || !(1..=500).contains(&profile.planned_players)
    {
        return Err(AppError::Validation(
            "プロファイルの構成値が正しくありません".into(),
        ));
    }
    for item in profile
        .mods
        .iter()
        .chain(&profile.plugins)
        .chain(&profile.datapacks)
    {
        if item.file_name.contains(['/', '\\', '\0']) || item.file_name.chars().count() > 255 {
            return Err(AppError::Validation(
                "プロファイルに危険なファイル名が含まれています".into(),
            ));
        }
    }
    Ok(())
}
fn loader_name(profile: &ServerProfile) -> String {
    match profile.server_type.as_str() {
        "fabric" => "Fabric Loader",
        "forge" => "Forge",
        "neoforge" => "NeoForge",
        "paper" => "Paper",
        _ => "Vanilla",
    }
    .into()
}
fn entries(folder: PathBuf, extension: &str, client: bool) -> Vec<ProfileEntry> {
    let mut values = std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            (path
                .extension()
                .and_then(|v| v.to_str())
                .is_some_and(|v| v.eq_ignore_ascii_case(extension)))
            .then(|| {
                let file_name = entry.file_name().to_string_lossy().to_string();
                let version = guess_version(&file_name);
                ProfileEntry {
                    file_name,
                    version,
                    dependency_note: "配布元の情報を確認".into(),
                    client_requirement: if client {
                        "Modによりクライアント側にも必要"
                    } else {
                        "通常はサーバー側のみ"
                    }
                    .into(),
                }
            })
        })
        .collect::<Vec<_>>();
    values.sort_by(|a, b| a.file_name.cmp(&b.file_name));
    values
}
fn guess_version(file: &str) -> String {
    let stem = file.trim_end_matches(".jar").trim_end_matches(".zip");
    stem.rsplit_once('-')
        .map(|(_, value)| value.to_string())
        .unwrap_or_else(|| "不明".into())
}
fn configuration_files(root: &Path) -> Vec<String> {
    let base = root.join("config");
    let mut files = walkdir::WalkDir::new(&base)
        .follow_links(false)
        .max_depth(4)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_file())
        .filter_map(|entry| {
            entry
                .path()
                .strip_prefix(&base)
                .ok()
                .map(|path| path.to_string_lossy().replace('\\', "/"))
        })
        .filter(|name| name.chars().count() <= 255)
        .collect::<Vec<_>>();
    files.sort();
    files
}
fn names(profile: &ModpackProfile) -> std::collections::BTreeSet<String> {
    profile
        .mods
        .iter()
        .map(|v| format!("mod:{}", v.file_name))
        .chain(
            profile
                .plugins
                .iter()
                .map(|v| format!("plugin:{}", v.file_name)),
        )
        .chain(
            profile
                .datapacks
                .iter()
                .map(|v| format!("datapack:{}", v.file_name)),
        )
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{capture, diff, export, import};
    use crate::models::{BasicSettings, ServerProfile};
    #[test]
    fn profile_round_trip_and_diff() {
        let base = std::env::temp_dir().join(format!("msh-profile-test-{}", uuid::Uuid::new_v4()));
        let root = base.join("server");
        let profiles = base.join("profiles");
        std::fs::create_dir_all(root.join("mods")).unwrap();
        std::fs::write(root.join("mods/a-1.0.jar"), b"x").unwrap();
        let server = ServerProfile {
            id: "server".into(),
            name: "Server".into(),
            root_path: root.display().to_string(),
            game_kind: "minecraft".into(),
            server_type: "fabric".into(),
            minecraft_version: "1.21.1".into(),
            distribution_build: None,
            launch_target: "server.jar".into(),
            java_path: "java".into(),
            java_major: 21,
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
        let profile = capture(&profiles, &server, "共有用").unwrap();
        let exported = base.join("profile.json");
        export(&profiles, &profile.id, &exported).unwrap();
        let imported = import(&profiles, &exported).unwrap();
        assert_ne!(profile.id, imported.id);
        assert!(
            diff(&profiles, &profile.id, &server)
                .unwrap()
                .missing_from_server
                .is_empty()
        );
        std::fs::remove_dir_all(base).unwrap();
    }
}
