use std::{collections::HashMap, path::Path};

use chrono::Utc;

use crate::{
    error::{AppError, AppResult},
    models::{BasicSettings, ServerProfile},
};

pub fn validate_for_server_type(
    server_type: &str,
    settings: &BasicSettings,
    max_memory_mib: u32,
    port: u16,
) -> AppResult<()> {
    if !(1..=500).contains(&settings.max_players)
        || !(2..=32).contains(&settings.view_distance)
        || !(2..=32).contains(&settings.simulation_distance)
    {
        return Err(AppError::Validation(
            "人数は1～500、距離は2～32で指定してください".into(),
        ));
    }
    let bedrock = server_type == "bedrock";
    if !(1024..=65535).contains(&port) || (!bedrock && !(512..=65_536).contains(&max_memory_mib)) {
        return Err(AppError::Validation(
            "ポートまたはメモリ設定が範囲外です".into(),
        ));
    }
    if bedrock && !(4..=12).contains(&settings.simulation_distance) {
        return Err(AppError::Validation(
            "統合版のティック距離は4～12で指定してください".into(),
        ));
    }
    if settings.spawn_protection > 256 {
        return Err(AppError::Validation(
            "スポーン保護範囲は0～256ブロックで指定してください".into(),
        ));
    }
    let valid_world_type = if bedrock {
        matches!(
            settings.world_type.to_ascii_lowercase().as_str(),
            "minecraft:normal" | "minecraft:flat" | "default" | "flat" | "legacy"
        )
    } else {
        matches!(
            settings.world_type.as_str(),
            "minecraft:normal"
                | "minecraft:flat"
                | "minecraft:large_biomes"
                | "minecraft:amplified"
        )
    };
    if !valid_world_type {
        return Err(AppError::Validation(
            "対応していないワールドタイプです".into(),
        ));
    }
    if settings.world_seed.chars().count() > 128
        || settings.world_seed.chars().any(char::is_control)
    {
        return Err(AppError::Validation(
            "シード値は改行などを含めず128文字以内で入力してください".into(),
        ));
    }
    if settings.hardcore
        && (settings.difficulty != "hard" || settings.default_game_mode != "survival")
    {
        return Err(AppError::Validation(
            "ハードコアは難易度ハード・サバイバルで設定してください".into(),
        ));
    }
    let resource_pack_url = settings.resource_pack_url.trim();
    let valid_resource_pack_url =
        resource_pack_url
            .split_once("://")
            .is_some_and(|(scheme, remainder)| {
                matches!(scheme, "http" | "https")
                    && !remainder.is_empty()
                    && !remainder.chars().any(char::is_whitespace)
            });
    if !bedrock
        && ((!resource_pack_url.is_empty()
            && (!valid_resource_pack_url
                || resource_pack_url.len() > 2_048
                || resource_pack_url.chars().any(char::is_control)))
            || (settings.require_resource_pack && resource_pack_url.is_empty()))
    {
        return Err(AppError::Validation(
            "リソースパックURLはhttp://またはhttps://で入力し、必須にする場合は空欄にできません"
                .into(),
        ));
    }
    if settings.resource_pack_prompt.chars().count() > 160
        || settings.resource_pack_prompt.chars().any(char::is_control)
    {
        return Err(AppError::Validation(
            "リソースパック案内は制御文字を含めず160文字以内で入力してください".into(),
        ));
    }
    Ok(())
}

pub fn apply(
    profile: &mut ServerProfile,
    settings: BasicSettings,
    max_memory_mib: u32,
    port: u16,
) -> AppResult<()> {
    let root = Path::new(&profile.root_path);
    let properties_path = root.join("server.properties");
    let original_exists = properties_path.is_file();
    let original = std::fs::read_to_string(&properties_path).unwrap_or_default();
    let rendered = render(profile, &original, &settings, max_memory_mib, port)?;
    write_rendered(profile, &original, original_exists, &rendered)?;
    profile.settings = settings;
    profile.max_memory_mib = max_memory_mib;
    profile.port = port;
    profile.pending_restart = true;
    profile.updated_at = Utc::now().to_rfc3339();
    Ok(())
}

pub fn render(
    profile: &ServerProfile,
    original: &str,
    settings: &BasicSettings,
    max_memory_mib: u32,
    port: u16,
) -> AppResult<String> {
    validate_for_server_type(&profile.server_type, settings, max_memory_mib, port)?;
    let updates = if profile.server_type == "bedrock" {
        HashMap::from([
            ("gamemode".into(), settings.default_game_mode.clone()),
            ("difficulty".into(), settings.difficulty.clone()),
            ("max-players".into(), settings.max_players.to_string()),
            ("allow-list".into(), settings.whitelist.to_string()),
            ("allow-cheats".into(), settings.allow_commands.to_string()),
            ("online-mode".into(), settings.online_mode.to_string()),
            (
                "force-gamemode".into(),
                settings.force_game_mode.to_string(),
            ),
            (
                "texturepack-required".into(),
                settings.require_resource_pack.to_string(),
            ),
            ("view-distance".into(), settings.view_distance.to_string()),
            (
                "tick-distance".into(),
                settings.simulation_distance.to_string(),
            ),
            (
                "level-type".into(),
                bedrock_world_type(&settings.world_type).into(),
            ),
            ("level-seed".into(), settings.world_seed.trim().to_string()),
            ("server-port".into(), port.to_string()),
            (
                "server-portv6".into(),
                port.checked_add(1).unwrap_or(19_133).to_string(),
            ),
        ])
    } else {
        HashMap::from([
            ("gamemode".into(), settings.default_game_mode.clone()),
            ("difficulty".into(), settings.difficulty.clone()),
            ("max-players".into(), settings.max_players.to_string()),
            ("pvp".into(), settings.pvp.to_string()),
            ("white-list".into(), settings.whitelist.to_string()),
            ("enforce-whitelist".into(), settings.whitelist.to_string()),
            (
                "enable-command-block".into(),
                settings.allow_commands.to_string(),
            ),
            ("online-mode".into(), settings.online_mode.to_string()),
            ("allow-flight".into(), settings.allow_flight.to_string()),
            (
                "force-gamemode".into(),
                settings.force_game_mode.to_string(),
            ),
            (
                "spawn-protection".into(),
                settings.spawn_protection.to_string(),
            ),
            (
                "require-resource-pack".into(),
                settings.require_resource_pack.to_string(),
            ),
            (
                "resource-pack".into(),
                settings.resource_pack_url.trim().to_string(),
            ),
            (
                "resource-pack-prompt".into(),
                render_resource_pack_prompt(&settings.resource_pack_prompt),
            ),
            ("spawn-monsters".into(), settings.spawn_monsters.to_string()),
            ("spawn-animals".into(), settings.spawn_animals.to_string()),
            ("view-distance".into(), settings.view_distance.to_string()),
            (
                "simulation-distance".into(),
                settings.simulation_distance.to_string(),
            ),
            ("level-type".into(), settings.world_type.clone()),
            ("level-seed".into(), settings.world_seed.trim().to_string()),
            (
                "generate-structures".into(),
                settings.generate_structures.to_string(),
            ),
            ("hardcore".into(), settings.hardcore.to_string()),
            ("server-port".into(), port.to_string()),
        ])
    };
    Ok(update_properties(original, &updates))
}

pub fn write_rendered(
    profile: &ServerProfile,
    original: &str,
    original_exists: bool,
    rendered: &str,
) -> AppResult<()> {
    let root = Path::new(&profile.root_path);
    let properties_path = root.join("server.properties");
    let history_dir = root.join(".server-hub").join("settings-history");
    std::fs::create_dir_all(&history_dir)?;
    if original_exists {
        std::fs::write(
            history_dir.join(format!(
                "{}.properties",
                Utc::now().format("%Y%m%dT%H%M%SZ")
            )),
            original,
        )?;
    }
    let temporary = properties_path.with_extension("properties.tmp");
    std::fs::write(&temporary, rendered.as_bytes())?;
    std::fs::rename(temporary, properties_path)?;
    Ok(())
}

fn bedrock_world_type(value: &str) -> &'static str {
    match value.to_ascii_lowercase().as_str() {
        "minecraft:flat" | "flat" => "FLAT",
        "legacy" => "LEGACY",
        _ => "DEFAULT",
    }
}

fn render_resource_pack_prompt(prompt: &str) -> String {
    if prompt.trim().is_empty() {
        String::new()
    } else {
        serde_json::json!({ "text": prompt.trim() }).to_string()
    }
}

fn update_properties(original: &str, updates: &HashMap<String, String>) -> String {
    let mut seen = std::collections::HashSet::new();
    let mut output = Vec::new();
    for line in original.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || !trimmed.contains('=') {
            output.push(line.to_string());
            continue;
        }
        let key = trimmed.split_once('=').map(|v| v.0.trim()).unwrap_or("");
        if let Some(value) = updates.get(key) {
            output.push(format!("{key}={value}"));
            seen.insert(key.to_string());
        } else {
            output.push(line.to_string());
        }
    }
    let mut missing = updates
        .keys()
        .filter(|key| !seen.contains(*key))
        .cloned()
        .collect::<Vec<_>>();
    missing.sort_unstable();
    for key in missing {
        output.push(format!("{key}={}", updates[&key]));
    }
    output.join("\r\n") + "\r\n"
}

#[cfg(test)]
mod tests {
    use super::{apply, render_resource_pack_prompt, update_properties, validate_for_server_type};
    use crate::models::{BasicSettings, ServerProfile};
    use std::collections::HashMap;
    #[test]
    fn preserves_unknown_properties() {
        let input = "motd=Hello\ncustom-option=keep\nmax-players=5\n";
        let updates = HashMap::from([
            ("max-players".into(), "10".into()),
            ("pvp".into(), "true".into()),
        ]);
        let output = update_properties(input, &updates);
        assert!(output.contains("custom-option=keep"));
        assert!(output.contains("max-players=10"));
        assert!(output.contains("pvp=true"));
    }

    #[test]
    fn validates_resource_pack_and_renders_safe_prompt_json() {
        let mut settings = BasicSettings::default();
        settings.require_resource_pack = true;
        assert!(validate_for_server_type("paper", &settings, 4096, 25565).is_err());
        settings.resource_pack_url = "https://example.com/server-pack.zip".into();
        settings.resource_pack_prompt = "友達用パックを使いますか？".into();
        assert!(validate_for_server_type("paper", &settings, 4096, 25565).is_ok());
        assert_eq!(
            render_resource_pack_prompt(&settings.resource_pack_prompt),
            r#"{"text":"友達用パックを使いますか？"}"#
        );
    }

    #[test]
    fn validates_world_generation_settings() {
        let mut settings = BasicSettings::default();
        settings.world_type = "minecraft:flat".into();
        settings.world_seed = "flat-world-2026".into();
        assert!(validate_for_server_type("paper", &settings, 4096, 25565).is_ok());
        settings.world_type = "unsupported:debug".into();
        assert!(validate_for_server_type("paper", &settings, 4096, 25565).is_err());
        settings.world_type = "minecraft:normal".into();
        settings.world_seed = "line1\nline2".into();
        assert!(validate_for_server_type("paper", &settings, 4096, 25565).is_err());
    }

    #[test]
    fn applies_expanded_properties_without_losing_unknown_values() {
        let root =
            std::env::temp_dir().join(format!("msh-expanded-settings-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("server.properties"),
            "custom-paper-setting=keep\nonline-mode=true\n",
        )
        .unwrap();
        let mut profile = ServerProfile {
            id: "settings-test".into(),
            name: "Settings".into(),
            root_path: root.display().to_string(),
            game_kind: "minecraft".into(),
            server_type: "paper".into(),
            minecraft_version: "1.21.11".into(),
            distribution_build: None,
            launch_target: "server.jar".into(),
            java_path: "java.exe".into(),
            java_major: 21,
            min_memory_mib: 1024,
            max_memory_mib: 4096,
            port: 25565,
            eula_accepted_at: String::new(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: None,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let mut settings = BasicSettings::default();
        settings.online_mode = false;
        settings.allow_flight = true;
        settings.force_game_mode = true;
        settings.spawn_protection = 0;
        settings.resource_pack_url = "https://example.com/server-pack.zip".into();
        settings.require_resource_pack = true;
        settings.resource_pack_prompt = "専用パック".into();
        apply(&mut profile, settings, 6144, 25570).unwrap();
        let rendered = std::fs::read_to_string(root.join("server.properties")).unwrap();
        assert!(rendered.contains("custom-paper-setting=keep"));
        assert!(rendered.contains("online-mode=false"));
        assert!(rendered.contains("allow-flight=true"));
        assert!(rendered.contains("force-gamemode=true"));
        assert!(rendered.contains("spawn-protection=0"));
        assert!(rendered.contains("require-resource-pack=true"));
        assert!(rendered.contains("resource-pack=https://example.com/server-pack.zip"));
        assert!(rendered.contains(r#"resource-pack-prompt={"text":"専用パック"}"#));
        assert!(profile.pending_restart);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn applies_bedrock_property_names_without_java_only_keys() {
        let root =
            std::env::temp_dir().join(format!("msh-bedrock-settings-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("server.properties"),
            "server-name=Keep me\ncustom-bedrock-setting=keep\n",
        )
        .unwrap();
        let mut profile = ServerProfile {
            id: "bedrock-settings-test".into(),
            name: "Bedrock Settings".into(),
            root_path: root.display().to_string(),
            game_kind: "minecraft".into(),
            server_type: "bedrock".into(),
            minecraft_version: "1.21.100.7".into(),
            distribution_build: None,
            launch_target: "bedrock_server.exe".into(),
            java_path: String::new(),
            java_major: 0,
            min_memory_mib: 0,
            max_memory_mib: 0,
            port: 19132,
            eula_accepted_at: String::new(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: None,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let mut settings = BasicSettings::default();
        settings.whitelist = true;
        settings.allow_commands = true;
        settings.require_resource_pack = true;
        settings.world_type = "minecraft:flat".into();
        settings.simulation_distance = 8;
        assert!(validate_for_server_type("bedrock", &settings, 0, 19132).is_ok());
        apply(&mut profile, settings, 0, 19132).unwrap();
        let rendered = std::fs::read_to_string(root.join("server.properties")).unwrap();
        assert!(rendered.contains("custom-bedrock-setting=keep"));
        assert!(rendered.contains("allow-list=true"));
        assert!(rendered.contains("allow-cheats=true"));
        assert!(rendered.contains("texturepack-required=true"));
        assert!(rendered.contains("tick-distance=8"));
        assert!(rendered.contains("level-type=FLAT"));
        assert!(rendered.contains("server-portv6=19133"));
        assert!(!rendered.contains("white-list="));
        assert!(!rendered.contains("enable-command-block="));
        assert!(!rendered.contains("resource-pack="));
        std::fs::remove_dir_all(root).unwrap();
    }
}
