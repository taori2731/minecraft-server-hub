use std::{
    collections::HashMap,
    fs::File,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    sync::LazyLock,
};

use chrono::Utc;
use regex::Regex;
use sha2::{Digest, Sha256};
use sysinfo::System;
use uuid::Uuid;
use zip::ZipArchive;

use crate::{
    bedrock,
    error::{AppError, AppResult},
    java::detect_java_runtimes,
    models::{BasicSettings, ImportPreview, ServerProfile},
};

pub fn registration_profile(
    preview: ImportPreview,
    name: &str,
    java_path: String,
    java_major: u16,
) -> ServerProfile {
    let now = Utc::now().to_rfc3339();
    let bedrock = preview.server_type == "bedrock";
    ServerProfile {
        id: Uuid::new_v4().to_string(),
        name: name.trim().into(),
        root_path: preview.root_path,
        game_kind: "minecraft".into(),
        server_type: preview.server_type,
        minecraft_version: preview.minecraft_version,
        distribution_build: preview.distribution_build,
        launch_target: preview.server_jar.unwrap_or_else(|| {
            if bedrock {
                "bedrock_server.exe".into()
            } else {
                "server.jar".into()
            }
        }),
        java_path: if bedrock { String::new() } else { java_path },
        java_major: if bedrock { 0 } else { java_major },
        min_memory_mib: preview.min_memory_mib,
        max_memory_mib: preview.max_memory_mib,
        port: preview.port,
        eula_accepted_at: if preview.eula_accepted {
            now.clone()
        } else {
            String::new()
        },
        pending_restart: false,
        settings: preview.settings,
        palworld_settings: None,
        created_at: now.clone(),
        updated_at: now,
    }
}

pub fn inspect(input: &str) -> AppResult<ImportPreview> {
    let requested = PathBuf::from(input);
    if !requested.is_absolute() || !requested.is_dir() {
        return Err(AppError::Validation(
            "既存サーバーのフォルダーを選択してください".into(),
        ));
    }
    let root = requested.canonicalize()?;
    let properties_path = root.join("server.properties");
    if !properties_path.is_file() {
        return Err(AppError::Validation("server.properties が見つかりません。Minecraftサーバーのルートフォルダーを選択してください".into()));
    }
    let properties_text = std::fs::read_to_string(&properties_path)?;
    let properties = parse_properties(&properties_text);
    let (server_type, distribution_build, server_jar) = detect_distribution(&root);
    let bedrock = server_type == "bedrock";
    let verified_bedrock = if bedrock {
        Some(bedrock::verify_installed_executable(&root)?)
    } else {
        None
    };
    let mut warnings = Vec::new();
    if server_jar.is_none() && !matches!(server_type.as_str(), "forge" | "neoforge") {
        warnings.push(
            "起動に使えるServer JARを検出できません。登録後も起動できない可能性があります。".into(),
        );
    }
    let minecraft_version = detect_minecraft_version(
        &root,
        server_jar.as_deref(),
        distribution_build.as_deref(),
        &server_type,
    )
    .unwrap_or_else(|| {
        warnings.push(
            "Minecraftバージョンを自動判定できませんでした。ログまたは配布元を確認してください。"
                .into(),
        );
        "unknown".into()
    });
    let eula_accepted = !bedrock
        && std::fs::read_to_string(root.join("eula.txt"))
            .ok()
            .is_some_and(|text| {
                text.lines()
                    .any(|line| line.trim().eq_ignore_ascii_case("eula=true"))
            });
    if bedrock {
        warnings.push("統合版専用サーバーの利用条件はファイルから判定できません。登録後、起動前に公式利用条件を確認してください。".into());
        warnings.push("bedrock_server.exeの有効なMicrosoft署名は確認しました。同じフォルダーのDLL、設定、ワールド、アドオンが公式由来であることまでは証明しないため、入手元が不明な場合は公式BDSの再取得を推奨します。".into());
    } else if !eula_accepted {
        warnings.push(
            "EULA同意を確認できません。起動前にMinecraft EULAを本人が確認する必要があります。"
                .into(),
        );
    }
    let settings = settings_from_properties_for_type(&properties, &server_type);
    let world_folders = detect_worlds(&root, &settings.world_name, bedrock);
    if world_folders.is_empty() {
        warnings.push("level.dat を含むワールドフォルダーを検出できませんでした。新規または不完全なサーバーの可能性があります。".into());
    }
    let (mod_count, plugin_count, datapack_count) = if bedrock {
        (
            count_pack_folders(&root.join("behavior_packs")),
            count_pack_folders(&root.join("resource_packs")),
            world_folders
                .iter()
                .map(|world| {
                    count_world_pack_references(
                        &root
                            .join("worlds")
                            .join(world)
                            .join("world_behavior_packs.json"),
                    ) + count_world_pack_references(
                        &root
                            .join("worlds")
                            .join(world)
                            .join("world_resource_packs.json"),
                    )
                })
                .sum(),
        )
    } else {
        (
            count_files(&root.join("mods"), "jar"),
            count_files(&root.join("plugins"), "jar"),
            world_folders
                .iter()
                .map(|world| count_files(&root.join(world).join("datapacks"), "zip"))
                .sum(),
        )
    };
    if !bedrock && plugin_count > 0 && server_type != "paper" {
        warnings
            .push("プラグインを検出しましたが、Paper系サーバーとは判定できませんでした。".into());
    }
    if !bedrock && mod_count > 0 && !matches!(server_type.as_str(), "fabric" | "forge" | "neoforge")
    {
        warnings.push("Modを検出しましたが、対応ローダーを判定できませんでした。".into());
    }
    let (min_memory_mib, max_memory_mib) = if bedrock {
        (0, 0)
    } else {
        detect_memory(&root).unwrap_or_else(|| {
        warnings.push("既存のメモリ設定を取得できなかったため、このPCの空きメモリから安全側の候補値を提案します。".into());
        recommended_memory()
    })
    };
    let java_version_hint = if minecraft_version == "unknown" {
        "1.21.1"
    } else {
        &minecraft_version
    };
    let java_runtimes = if bedrock {
        Vec::new()
    } else {
        detect_java_runtimes(&server_type, java_version_hint)
    };
    if !bedrock && java_runtimes.iter().all(|runtime| !runtime.compatible) {
        warnings.push("互換性のあるJavaを検出できませんでした。登録前または起動前にJava環境を確認してください。".into());
    }
    let source_fingerprint = fingerprint(
        &properties_text,
        server_jar.as_deref(),
        &server_type,
        &minecraft_version,
        verified_bedrock.as_ref().map(|verified| verified.sha256()),
        verified_bedrock
            .as_ref()
            .map(|verified| verified.signature_subject()),
    );
    let suggested_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Imported Server")
        .to_string();
    Ok(ImportPreview {
        root_path: root.display().to_string(),
        suggested_name,
        server_type,
        minecraft_version,
        distribution_build,
        server_jar,
        world_folders,
        mod_count,
        plugin_count,
        datapack_count,
        port: properties
            .get("server-port")
            .and_then(|value| value.parse().ok())
            .unwrap_or(if bedrock { 19132 } else { 25565 }),
        min_memory_mib,
        max_memory_mib,
        eula_accepted,
        java_runtimes,
        settings,
        can_import: true,
        warnings,
        source_fingerprint,
    })
}

fn parse_properties(text: &str) -> HashMap<String, String> {
    text.lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let (key, value) = line.split_once('=')?;
            Some((key.trim().to_string(), value.trim().to_string()))
        })
        .collect()
}

fn settings_from_properties_for_type(
    values: &HashMap<String, String>,
    server_type: &str,
) -> BasicSettings {
    let mut settings = BasicSettings::default();
    let bedrock = server_type == "bedrock";
    settings.default_game_mode = values
        .get("gamemode")
        .cloned()
        .unwrap_or(settings.default_game_mode);
    settings.difficulty = values
        .get("difficulty")
        .cloned()
        .unwrap_or(settings.difficulty);
    settings.max_players = values
        .get("max-players")
        .and_then(|value| value.parse().ok())
        .unwrap_or(settings.max_players);
    settings.pvp = bool_value(values.get("pvp"), settings.pvp);
    settings.whitelist = bool_value(
        values.get(if bedrock { "allow-list" } else { "white-list" }),
        settings.whitelist,
    );
    settings.allow_commands = bool_value(
        values.get(if bedrock {
            "allow-cheats"
        } else {
            "enable-command-block"
        }),
        settings.allow_commands,
    );
    settings.online_mode = bool_value(values.get("online-mode"), settings.online_mode);
    settings.allow_flight = bool_value(values.get("allow-flight"), settings.allow_flight);
    settings.force_game_mode = bool_value(values.get("force-gamemode"), settings.force_game_mode);
    settings.spawn_protection = values
        .get("spawn-protection")
        .and_then(|value| value.parse().ok())
        .unwrap_or(settings.spawn_protection);
    settings.require_resource_pack = bool_value(
        values.get(if bedrock {
            "texturepack-required"
        } else {
            "require-resource-pack"
        }),
        settings.require_resource_pack,
    );
    if !bedrock {
        settings.resource_pack_url = values.get("resource-pack").cloned().unwrap_or_default();
        settings.resource_pack_prompt = values
            .get("resource-pack-prompt")
            .map(|value| parse_resource_pack_prompt(value))
            .unwrap_or_default();
    }
    settings.world_name = values
        .get("level-name")
        .cloned()
        .unwrap_or(settings.world_name);
    settings.world_type = values
        .get("level-type")
        .map(|value| {
            if bedrock {
                bedrock_world_type(value)
            } else {
                value.clone()
            }
        })
        .unwrap_or(settings.world_type);
    settings.world_seed = values.get("level-seed").cloned().unwrap_or_default();
    settings.generate_structures = bool_value(
        values.get("generate-structures"),
        settings.generate_structures,
    );
    settings.hardcore = bool_value(values.get("hardcore"), settings.hardcore);
    settings.spawn_monsters = bool_value(values.get("spawn-monsters"), settings.spawn_monsters);
    settings.spawn_animals = bool_value(values.get("spawn-animals"), settings.spawn_animals);
    settings.view_distance = values
        .get("view-distance")
        .and_then(|value| value.parse().ok())
        .unwrap_or(settings.view_distance);
    settings.simulation_distance = values
        .get(if bedrock {
            "tick-distance"
        } else {
            "simulation-distance"
        })
        .and_then(|value| value.parse().ok())
        .unwrap_or(settings.simulation_distance);
    settings
}

fn bedrock_world_type(value: &str) -> String {
    match value.trim().to_ascii_uppercase().as_str() {
        "FLAT" => "minecraft:flat".into(),
        "LEGACY" => "legacy".into(),
        _ => "minecraft:normal".into(),
    }
}

fn parse_resource_pack_prompt(value: &str) -> String {
    serde_json::from_str::<serde_json::Value>(value)
        .ok()
        .and_then(|json| {
            json.get("text")
                .and_then(|text| text.as_str())
                .map(str::to_string)
                .or_else(|| json.as_str().map(str::to_string))
        })
        .unwrap_or_else(|| value.to_string())
}

fn bool_value(value: Option<&String>, fallback: bool) -> bool {
    value.and_then(|text| text.parse().ok()).unwrap_or(fallback)
}

fn detect_distribution(root: &Path) -> (String, Option<String>, Option<String>) {
    if root.join("bedrock_server.exe").is_file() {
        return ("bedrock".into(), None, Some("bedrock_server.exe".into()));
    }
    if let Some(build) = loader_build(root.join("libraries/net/neoforged/neoforge")) {
        return ("neoforge".into(), Some(build), None);
    }
    if let Some(build) = loader_build(root.join("libraries/net/minecraftforge/forge")) {
        return ("forge".into(), Some(build), None);
    }
    let jars = std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            (path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("jar")))
            .then_some(path)
        })
        .collect::<Vec<_>>();
    let choose = |needle: &str| {
        jars.iter()
            .find(|path| {
                path.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .contains(needle)
            })
            .cloned()
    };
    if let Some(path) = choose("fabric") {
        return (
            "fabric".into(),
            jar_manifest_version(&path),
            path.file_name().map(|v| v.to_string_lossy().to_string()),
        );
    }
    if root.join("paper-global.yml").exists()
        || root.join("paper.yml").exists()
        || root.join("plugins").is_dir()
    {
        let jar = choose("paper").or_else(|| choose("server"));
        return (
            "paper".into(),
            jar.as_ref().and_then(|path| jar_manifest_version(path)),
            jar.and_then(|path| path.file_name().map(|v| v.to_string_lossy().to_string())),
        );
    }
    let jar = choose("server").or_else(|| jars.first().cloned());
    (
        "vanilla".into(),
        None,
        jar.and_then(|path| path.file_name().map(|v| v.to_string_lossy().to_string())),
    )
}

fn loader_build(path: PathBuf) -> Option<String> {
    std::fs::read_dir(path)
        .ok()?
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .max()
}

fn detect_minecraft_version(
    root: &Path,
    jar: Option<&str>,
    build: Option<&str>,
    server_type: &str,
) -> Option<String> {
    if server_type == "bedrock" {
        return detect_bedrock_version(root);
    }
    if let Some(build) = build {
        if build.starts_with("1.") {
            return build.split('-').next().map(str::to_string);
        }
        let base = build.split('-').next().unwrap_or(build);
        let mut parts = base.split('.');
        let major = parts.next()?;
        let minor = parts.next()?;
        return Some(if major.parse::<u32>().ok()? >= 26 {
            format!("{major}.{minor}")
        } else {
            format!("1.{major}.{minor}")
        });
    }
    for candidate in [root.join("logs/latest.log"), root.join("logs/latest.log.1")] {
        if let Ok(text) = std::fs::read_to_string(candidate) {
            for marker in [
                "Starting minecraft server version ",
                "Minecraft version ",
                "minecraftVersion=",
            ] {
                if let Some(rest) = text.split(marker).nth(1) {
                    let value = rest
                        .split(|c: char| c.is_whitespace() || matches!(c, ',' | ')' | ';'))
                        .next()
                        .unwrap_or("")
                        .trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.');
                    if !value.is_empty() {
                        return Some(value.to_string());
                    }
                }
            }
        }
    }
    jar.and_then(|name| version_from_name(name))
        .or_else(|| jar.and_then(|name| jar_manifest_version(&root.join(name))))
}

fn detect_bedrock_version(root: &Path) -> Option<String> {
    let metadata_path = root.join(".server-hub").join("bedrock-install.json");
    if metadata_path
        .metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.len() <= 64 * 1024)
    {
        if let Ok(bytes) = std::fs::read(&metadata_path) {
            if let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                if let Some(version) = value
                    .get("version")
                    .and_then(serde_json::Value::as_str)
                    .and_then(extract_bedrock_version)
                {
                    return Some(version);
                }
            }
        }
    }
    for candidate in [
        "release-notes.txt",
        "bedrock_server_how_to.html",
        "logs/latest.log",
    ] {
        let path = root.join(candidate);
        if !path
            .metadata()
            .is_ok_and(|metadata| metadata.is_file() && metadata.len() <= 4 * 1024 * 1024)
        {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(path) else {
            continue;
        };
        for marker in [
            "Bedrock Dedicated Server version ",
            "Server version ",
            "Version: ",
        ] {
            if let Some(version) = text.split(marker).nth(1).and_then(extract_bedrock_version) {
                return Some(version);
            }
        }
    }
    bedrock_executable_version(&root.join("bedrock_server.exe"))
}

fn extract_bedrock_version(value: &str) -> Option<String> {
    static VERSION: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)(?:^|[^0-9])([0-9]+(?:\.[0-9]+){2,3})(?:[^0-9]|$)").unwrap()
    });
    VERSION
        .captures(value)
        .and_then(|captures| captures.get(1))
        .map(|matched| matched.as_str().to_string())
}

#[cfg(windows)]
fn bedrock_executable_version(path: &Path) -> Option<String> {
    if !path.is_file() {
        return None;
    }
    let mut command = Command::new("powershell.exe");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", "(Get-Item -LiteralPath ([Environment]::GetEnvironmentVariable('MSH_BEDROCK_EXE_PATH', 'Process'))).VersionInfo.ProductVersion"])
        .env("MSH_BEDROCK_EXE_PATH", path);
    crate::windows_process::hide_console_window(&mut command);
    let output = command.output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).to_string())
        .and_then(|value| extract_bedrock_version(&value))
}

#[cfg(not(windows))]
fn bedrock_executable_version(_path: &Path) -> Option<String> {
    None
}

fn version_from_name(name: &str) -> Option<String> {
    name.split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .map(|part| part.trim_matches('.'))
        .find(|part| part.matches('.').count() >= 1 && part.chars().any(|c| c.is_ascii_digit()))
        .map(str::to_string)
}

fn jar_manifest_version(path: &Path) -> Option<String> {
    let mut archive = ZipArchive::new(File::open(path).ok()?).ok()?;
    let mut manifest = archive.by_name("META-INF/MANIFEST.MF").ok()?;
    let mut text = String::new();
    manifest.read_to_string(&mut text).ok()?;
    for key in [
        "Implementation-Version:",
        "Specification-Version:",
        "Fabric-Loom-Version:",
    ] {
        if let Some(line) = text.lines().find(|line| line.starts_with(key)) {
            return Some(line[key.len()..].trim().to_string());
        }
    }
    None
}

fn detect_worlds(root: &Path, configured: &str, bedrock: bool) -> Vec<String> {
    let mut worlds = Vec::new();
    let worlds_root = if bedrock {
        root.join("worlds")
    } else {
        root.to_path_buf()
    };
    if worlds_root.join(configured).join("level.dat").is_file() {
        worlds.push(configured.to_string());
    }
    if let Ok(entries) = std::fs::read_dir(worlds_root) {
        for entry in entries.flatten() {
            if entry.path().join("level.dat").is_file() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !worlds.contains(&name) {
                    worlds.push(name);
                }
            }
        }
    }
    worlds.sort();
    worlds
}

fn count_pack_folders(folder: &Path) -> usize {
    std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.path().is_dir() && entry.path().join("manifest.json").is_file())
        .count()
}

fn count_world_pack_references(path: &Path) -> usize {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| value.as_array().map(Vec::len))
        .unwrap_or(0)
}

fn count_files(folder: &Path, extension: &str) -> usize {
    std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            entry
                .path()
                .extension()
                .and_then(|v| v.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case(extension))
        })
        .count()
}

fn detect_memory(root: &Path) -> Option<(u32, u32)> {
    for file in ["user_jvm_args.txt", "start.bat", "run.bat"] {
        if let Ok(text) = std::fs::read_to_string(root.join(file)) {
            let min = memory_flag(&text, "-Xms");
            let max = memory_flag(&text, "-Xmx");
            if let Some(max) = max {
                return Some((min.unwrap_or(max.min(1024)), max));
            }
        }
    }
    None
}

fn memory_flag(text: &str, marker: &str) -> Option<u32> {
    let rest = text.split(marker).nth(1)?;
    let number = rest
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse::<u32>()
        .ok()?;
    let unit = rest
        .chars()
        .find(|c| c.is_ascii_alphabetic())
        .unwrap_or('m')
        .to_ascii_lowercase();
    Some(if unit == 'g' {
        number.saturating_mul(1024)
    } else {
        number
    })
}

fn recommended_memory() -> (u32, u32) {
    let system = System::new_all();
    let available = (system.available_memory() / 1024 / 1024) as u32;
    let max = (available / 2).clamp(2048, 8192);
    (1024.min(max), max)
}

fn fingerprint(
    properties: &str,
    jar: Option<&str>,
    server_type: &str,
    version: &str,
    executable_sha256: Option<&str>,
    signature_subject: Option<&str>,
) -> String {
    let mut digest = Sha256::new();
    digest.update(properties.as_bytes());
    digest.update(jar.unwrap_or("").as_bytes());
    digest.update(server_type.as_bytes());
    digest.update(version.as_bytes());
    digest.update(executable_sha256.unwrap_or("").as_bytes());
    digest.update(signature_subject.unwrap_or("").as_bytes());
    hex::encode(digest.finalize())
}

#[cfg(test)]
mod tests {
    use super::{inspect, registration_profile};
    use crate::store::Store;

    #[test]
    fn inspects_vanilla_without_writing_source() {
        let base = std::env::temp_dir().join(format!("msh-import-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(base.join("world")).unwrap();
        std::fs::write(base.join("world/level.dat"), b"world").unwrap();
        std::fs::write(base.join("server.properties"), b"server-port=25570\nlevel-name=world\nlevel-type=minecraft:large_biomes\nlevel-seed=imported-seed\ngenerate-structures=false\nhardcore=true\ngamemode=creative\nmax-players=8\nonline-mode=false\nallow-flight=true\nspawn-protection=0\nresource-pack=https://example.com/server-pack.zip\n").unwrap();
        std::fs::write(base.join("server.jar"), b"not-a-real-jar").unwrap();
        let before = std::fs::read_dir(&base).unwrap().count();
        let result = inspect(&base.display().to_string()).unwrap();
        assert_eq!(result.server_type, "vanilla");
        assert_eq!(result.port, 25570);
        assert_eq!(result.settings.default_game_mode, "creative");
        assert!(!result.settings.online_mode);
        assert!(result.settings.allow_flight);
        assert_eq!(result.settings.spawn_protection, 0);
        assert_eq!(
            result.settings.resource_pack_url,
            "https://example.com/server-pack.zip"
        );
        assert_eq!(result.settings.world_type, "minecraft:large_biomes");
        assert_eq!(result.settings.world_seed, "imported-seed");
        assert!(!result.settings.generate_structures);
        assert!(result.settings.hardcore);
        assert_eq!(result.world_folders, vec!["world"]);
        assert_eq!(before, std::fs::read_dir(&base).unwrap().count());
        let database = base.join("registry.sqlite3");
        let store = Store::open(&database).unwrap();
        let profile = registration_profile(result, "Imported Vanilla", "java.exe".into(), 21);
        store.insert_server(&profile).unwrap();
        assert_eq!(store.list_servers().unwrap()[0].launch_target, "server.jar");
        drop(store);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn rejects_incomplete_folder_without_changes() {
        let base = std::env::temp_dir().join(format!("msh-import-reject-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&base).unwrap();
        std::fs::write(base.join("keep.txt"), b"keep").unwrap();
        assert!(inspect(&base.display().to_string()).is_err());
        assert_eq!(std::fs::read(base.join("keep.txt")).unwrap(), b"keep");
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn inspects_paper_extensions_and_worlds() {
        let base = std::env::temp_dir().join(format!("msh-import-paper-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(base.join("plugins")).unwrap();
        std::fs::create_dir_all(base.join("world/datapacks")).unwrap();
        std::fs::write(
            base.join("server.properties"),
            b"level-name=world\nserver-port=25565\n",
        )
        .unwrap();
        std::fs::write(base.join("world/level.dat"), b"world").unwrap();
        std::fs::write(base.join("plugins/example.jar"), b"plugin").unwrap();
        std::fs::write(base.join("world/datapacks/example.zip"), b"datapack").unwrap();
        std::fs::write(base.join("paper-1.21.1.jar"), b"paper").unwrap();
        let result = inspect(&base.display().to_string()).unwrap();
        assert_eq!(result.server_type, "paper");
        assert_eq!(result.minecraft_version, "1.21.1");
        assert_eq!(result.plugin_count, 1);
        assert_eq!(result.datapack_count, 1);
        let database = base.join("registry.sqlite3");
        let store = Store::open(&database).unwrap();
        let profile = registration_profile(result, "Imported Paper", "java.exe".into(), 21);
        store.insert_server(&profile).unwrap();
        let saved = store.list_servers().unwrap();
        assert_eq!(saved[0].server_type, "paper");
        assert_eq!(saved[0].launch_target, "paper-1.21.1.jar");
        drop(store);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn inspects_bedrock_without_java_or_java_world_layout() {
        let base =
            std::env::temp_dir().join(format!("msh-import-bedrock-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(base.join("worlds/Bedrock World")).unwrap();
        std::fs::create_dir_all(base.join("behavior_packs/demo_behavior")).unwrap();
        std::fs::create_dir_all(base.join("resource_packs/demo_resource")).unwrap();
        std::fs::create_dir_all(base.join(".server-hub")).unwrap();
        let notepad = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap())
            .join("System32")
            .join("notepad.exe");
        std::fs::copy(notepad, base.join("bedrock_server.exe")).unwrap();
        std::fs::write(base.join("worlds/Bedrock World/level.dat"), b"world").unwrap();
        std::fs::write(
            base.join("behavior_packs/demo_behavior/manifest.json"),
            b"{}",
        )
        .unwrap();
        std::fs::write(
            base.join("resource_packs/demo_resource/manifest.json"),
            b"{}",
        )
        .unwrap();
        std::fs::write(
            base.join(".server-hub/bedrock-install.json"),
            br#"{"version":"1.26.44.3"}"#,
        )
        .unwrap();
        std::fs::write(base.join("server.properties"), b"level-name=Bedrock World\nlevel-type=FLAT\nallow-list=true\nallow-cheats=true\ntexturepack-required=true\ntick-distance=8\n").unwrap();

        let result = inspect(&base.display().to_string()).unwrap();
        assert_eq!(result.server_type, "bedrock");
        assert_eq!(result.server_jar.as_deref(), Some("bedrock_server.exe"));
        assert_eq!(result.minecraft_version, "1.26.44.3");
        assert_eq!(result.port, 19132);
        assert_eq!(result.world_folders, vec!["Bedrock World"]);
        assert_eq!(result.mod_count, 1);
        assert_eq!(result.plugin_count, 1);
        assert!(result.warnings.iter().all(|warning| {
            !warning.contains("Paper系") && !warning.contains("対応ローダー")
        }));
        assert!(result.java_runtimes.is_empty());
        assert_eq!(result.min_memory_mib, 0);
        assert_eq!(result.max_memory_mib, 0);
        assert!(result.settings.whitelist);
        assert!(result.settings.allow_commands);
        assert!(result.settings.require_resource_pack);
        assert_eq!(result.settings.world_type, "minecraft:flat");
        assert_eq!(result.settings.simulation_distance, 8);
        let profile =
            registration_profile(result, "Imported Bedrock", "ignored-java.exe".into(), 21);
        assert_eq!(profile.launch_target, "bedrock_server.exe");
        assert!(profile.java_path.is_empty());
        assert_eq!(profile.java_major, 0);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn rejects_an_unsigned_imported_bedrock_executable() {
        let base = std::env::temp_dir().join(format!(
            "msh-import-bedrock-unsigned-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&base).unwrap();
        std::fs::write(base.join("server.properties"), b"server-port=19132\n").unwrap();
        std::fs::write(base.join("bedrock_server.exe"), b"unsigned fixture").unwrap();
        let error = inspect(&base.display().to_string())
            .unwrap_err()
            .to_string();
        assert!(error.contains("Microsoft署名"), "{error}");
        std::fs::remove_dir_all(base).unwrap();
    }
}
