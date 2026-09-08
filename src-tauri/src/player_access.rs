use std::{net::IpAddr, path::Path};

use chrono::Utc;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{
    crossplay,
    error::{AppError, AppResult},
    models::{PlayerAccessEntry, ServerProfile, UpdatePlayerAccessInput},
};

pub fn list(profile: &ServerProfile, kind: &str) -> AppResult<Vec<PlayerAccessEntry>> {
    let file_name = file_for_kind(profile, kind)?;
    let path = Path::new(&profile.root_path).join(file_name);
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let value: Value = serde_json::from_slice(&std::fs::read(path)?)?;
    let values = value
        .as_array()
        .ok_or_else(|| AppError::Validation(format!("{file_name} の形式を読み取れませんでした")))?;
    let mut entries = values
        .iter()
        .enumerate()
        .filter_map(|(index, value)| {
            entry_from_value(kind, index, value, profile.server_type == "bedrock")
        })
        .collect::<Vec<_>>();
    if profile.server_type != "bedrock" && matches!(kind, "whitelist" | "bedrock_whitelist") {
        entries.retain(|entry| is_floodgate_uuid(&entry.id) == (kind == "bedrock_whitelist"));
    }
    if profile.server_type == "bedrock" && kind == "operators" {
        entries.extend(
            read_pending_bedrock_operators(Path::new(&profile.root_path))?
                .into_iter()
                .map(|pending| PlayerAccessEntry {
                    id: format!("pending-{}", private_id(&pending.name.to_ascii_lowercase())),
                    label: pending.name,
                    detail: "XUID待ち・権限はまだ未反映".into(),
                    level: None,
                    reason: None,
                    expires: None,
                    pending: true,
                }),
        );
    }
    Ok(entries)
}

pub fn command(profile: &ServerProfile, input: &UpdatePlayerAccessInput) -> AppResult<String> {
    let kind = input.kind.as_str();
    file_for_kind(profile, kind)?;
    let target = if kind == "banned_ips" && !input.add {
        let entry_id = input
            .entry_id
            .as_deref()
            .ok_or_else(|| AppError::Validation("解除するBAN IPを選択してください".into()))?;
        resolve_banned_ip(profile, entry_id)?
    } else {
        input.target.trim().to_string()
    };
    if kind == "bedrock_whitelist" {
        if !crossplay::floodgate_installed(profile) {
            return Err(AppError::Validation(
                "統合版ホワイトリストを使うには、このPaperサーバーへFloodgateを導入してください"
                    .into(),
            ));
        }
        if !valid_bedrock_name(&target) || target.chars().count() > 32 {
            return Err(AppError::Validation(
                "Xboxゲーマータグは制御文字を含めず32文字以内で入力してください".into(),
            ));
        }
        let prefix = floodgate_username_prefix(Path::new(&profile.root_path));
        let floodgate_target = target.strip_prefix(&prefix).unwrap_or(&target);
        let command_target = quote_command_target(floodgate_target)?;
        return Ok(if input.add {
            format!("fwhitelist add {command_target}")
        } else {
            format!("fwhitelist remove {command_target}")
        });
    }
    if profile.server_type == "bedrock" {
        if !valid_bedrock_name(&target) {
            return Err(AppError::Validation(
                "統合版のゲーマータグは制御文字を含めず64文字以内で入力してください".into(),
            ));
        }
    } else if kind == "banned_ips" {
        if target.parse::<IpAddr>().is_err() {
            return Err(AppError::Validation(
                "有効なIPv4またはIPv6アドレスを入力してください".into(),
            ));
        }
    } else if !valid_runtime_player_name(&target) {
        return Err(AppError::Validation(
            "プレイヤー名は英数字・_、またはGeyser/Floodgateの安全な接頭辞を含む32文字以内で入力してください".into(),
        ));
    }
    let reason = input.reason.as_deref().unwrap_or("").trim();
    if reason.chars().count() > 120 || reason.chars().any(char::is_control) {
        return Err(AppError::Validation(
            "BAN理由は制御文字を含めず120文字以内で入力してください".into(),
        ));
    }
    let command_target = quote_command_target(&target)?;
    let command = if profile.server_type == "bedrock" {
        match (kind, input.add) {
            ("whitelist", true) => format!("allowlist add {command_target}"),
            ("whitelist", false) => format!("allowlist remove {command_target}"),
            ("operators", true) => format!("op {command_target}"),
            ("operators", false) => format!("deop {command_target}"),
            _ => {
                return Err(AppError::Validation(
                    "統合版専用サーバーはこのアクセス管理操作に対応していません".into(),
                ));
            }
        }
    } else {
        match (kind, input.add) {
            ("whitelist", true) => format!("whitelist add {command_target}"),
            ("whitelist", false) => format!("whitelist remove {command_target}"),
            ("operators", true) => format!("op {command_target}"),
            ("operators", false) => format!("deop {command_target}"),
            ("banned_players", true) => with_reason("ban", &command_target, reason),
            ("banned_players", false) => format!("pardon {command_target}"),
            ("banned_ips", true) => with_reason("ban-ip", &target, reason),
            ("banned_ips", false) => format!("pardon-ip {target}"),
            _ => unreachable!(),
        }
    };
    Ok(command)
}

pub async fn update_offline(
    client: &Client,
    profile: &ServerProfile,
    input: &UpdatePlayerAccessInput,
) -> AppResult<()> {
    let kind = input.kind.as_str();
    let file_name = file_for_kind(profile, kind)?;
    let root = Path::new(&profile.root_path);
    if !root.is_dir() {
        return Err(AppError::Validation(
            "サーバーフォルダーが見つかりません".into(),
        ));
    }
    let path = root.join(file_name);
    let original = if path.is_file() {
        std::fs::read(&path)?
    } else {
        b"[]".to_vec()
    };
    let mut value: Value = serde_json::from_slice(&original)?;

    if kind == "bedrock_whitelist" {
        return update_floodgate_offline(client, profile, &path, &original, &mut value, input)
            .await;
    }
    if profile.server_type == "bedrock" {
        update_bedrock_offline(root, file_name, &path, &original, &mut value, input)?;
        return replace_json_file(&path, &serde_json::to_vec_pretty(&value)?);
    }
    let entries = value
        .as_array_mut()
        .ok_or_else(|| AppError::Validation(format!("{file_name} の形式を読み取れませんでした")))?;

    if input.add {
        let target = input.target.trim();
        let reason = validated_reason(input.reason.as_deref())?;
        let entry = if kind == "banned_ips" {
            if target.parse::<IpAddr>().is_err() {
                return Err(AppError::Validation(
                    "有効なIPv4またはIPv6アドレスを入力してください".into(),
                ));
            }
            if entries
                .iter()
                .any(|entry| entry.get("ip").and_then(Value::as_str) == Some(target))
            {
                return Err(AppError::Validation(
                    "このIPアドレスはすでに登録されています".into(),
                ));
            }
            serde_json::json!({
                "ip": target,
                "created": minecraft_timestamp(),
                "source": "Minecraft Server Hub",
                "expires": "forever",
                "reason": if reason.is_empty() { "Banned by an operator." } else { reason },
            })
        } else {
            if !valid_player_name(target) {
                return Err(AppError::Validation(
                    "プレイヤー名は英数字と_の3～16文字で入力してください".into(),
                ));
            }
            if entries.iter().any(|entry| {
                entry
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| name.eq_ignore_ascii_case(target))
            }) {
                return Err(AppError::Validation(
                    "このプレイヤーはすでに登録されています".into(),
                ));
            }
            let (uuid, verified_name) = resolve_player_profile(client, profile, target).await?;
            match kind {
                "whitelist" => serde_json::json!({ "uuid": uuid, "name": verified_name }),
                "operators" => {
                    serde_json::json!({ "uuid": uuid, "name": verified_name, "level": 4, "bypassesPlayerLimit": false })
                }
                "banned_players" => serde_json::json!({
                    "uuid": uuid,
                    "name": verified_name,
                    "created": minecraft_timestamp(),
                    "source": "Minecraft Server Hub",
                    "expires": "forever",
                    "reason": if reason.is_empty() { "Banned by an operator." } else { reason },
                }),
                _ => unreachable!(),
            }
        };
        entries.push(entry);
    } else {
        let original_len = entries.len();
        if kind == "banned_ips" {
            let entry_id = input
                .entry_id
                .as_deref()
                .ok_or_else(|| AppError::Validation("解除するBAN IPを選択してください".into()))?;
            entries.retain(|entry| {
                entry
                    .get("ip")
                    .and_then(Value::as_str)
                    .is_none_or(|ip| private_id(ip) != entry_id)
            });
        } else {
            let entry_id = input.entry_id.as_deref();
            let target = input.target.trim();
            entries.retain(|entry| {
                let uuid_matches = entry_id
                    .is_some_and(|id| entry.get("uuid").and_then(Value::as_str) == Some(id));
                let name_matches = entry
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| name.eq_ignore_ascii_case(target));
                !(uuid_matches || name_matches)
            });
        }
        if entries.len() == original_len {
            return Err(AppError::Validation(
                "選択した登録項目を再確認できませんでした".into(),
            ));
        }
    }

    save_history(root, file_name, &path, &original)?;
    replace_json_file(&path, &serde_json::to_vec_pretty(&value)?)
}

async fn resolve_player_profile(
    client: &Client,
    profile: &ServerProfile,
    requested_name: &str,
) -> AppResult<(String, String)> {
    if let Some(found) = cached_player_profile(Path::new(&profile.root_path), requested_name) {
        return Ok(found);
    }
    if !profile.settings.online_mode {
        return Err(AppError::Validation("認証無効サーバーではUUIDを安全に確認できません。一度参加したことがあるプレイヤーか、サーバー起動中に登録してください".into()));
    }
    let response = client
        .get(format!(
            "https://api.mojang.com/users/profiles/minecraft/{requested_name}"
        ))
        .send()
        .await?;
    if matches!(
        response.status(),
        StatusCode::NO_CONTENT | StatusCode::NOT_FOUND
    ) {
        return Err(AppError::Validation(
            "そのMinecraft Java版プレイヤー名を公式サービスで確認できませんでした".into(),
        ));
    }
    if response.status() == StatusCode::TOO_MANY_REQUESTS {
        return Err(AppError::Validation(
            "Minecraft公式プロフィール確認が混み合っています。少し待って再試行してください".into(),
        ));
    }
    let profile_json: Value = response.error_for_status()?.json().await?;
    let raw_uuid = profile_json
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Validation("公式プロフィール応答にUUIDがありません".into()))?;
    let name = profile_json
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or(requested_name);
    Ok((canonical_uuid(raw_uuid)?, name.to_string()))
}

async fn update_floodgate_offline(
    client: &Client,
    profile: &ServerProfile,
    path: &Path,
    original: &[u8],
    value: &mut Value,
    input: &UpdatePlayerAccessInput,
) -> AppResult<()> {
    if !crossplay::floodgate_installed(profile) {
        return Err(AppError::Validation(
            "統合版ホワイトリストを使うには、このPaperサーバーへFloodgateを導入してください".into(),
        ));
    }
    let entries = value.as_array_mut().ok_or_else(|| {
        AppError::Validation("whitelist.json の形式を読み取れませんでした".into())
    })?;
    if input.add {
        let prefix = floodgate_username_prefix(Path::new(&profile.root_path));
        if prefix.is_empty() {
            return Err(AppError::Validation(
                "Floodgateの接頭辞が空のため、停止中は統合版UUIDを安全に判別できません。サーバー起動後に追加してください".into(),
            ));
        }
        let requested = input.target.trim();
        if requested.is_empty()
            || requested.chars().count() > 32
            || requested.chars().any(char::is_control)
        {
            return Err(AppError::Validation(
                "Xboxゲーマータグは制御文字を含めず32文字以内で入力してください".into(),
            ));
        }
        let requested = requested.strip_prefix(&prefix).unwrap_or(requested);
        let (uuid, name) = resolve_floodgate_profile(client, requested, &prefix).await?;
        if entries.iter().any(|entry| {
            entry.get("uuid").and_then(Value::as_str) == Some(uuid.as_str())
                || entry
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|existing| existing.eq_ignore_ascii_case(&name))
        }) {
            return Err(AppError::Validation(
                "この統合版プレイヤーはすでに登録されています".into(),
            ));
        }
        entries.push(serde_json::json!({ "uuid": uuid, "name": name }));
    } else {
        let entry_id = input
            .entry_id
            .as_deref()
            .ok_or_else(|| AppError::Validation("外す統合版プレイヤーを選択してください".into()))?;
        let before = entries.len();
        entries.retain(|entry| entry.get("uuid").and_then(Value::as_str) != Some(entry_id));
        if entries.len() == before {
            return Err(AppError::Validation(
                "選択した統合版プレイヤーを再確認できませんでした".into(),
            ));
        }
    }
    save_history(
        Path::new(&profile.root_path),
        "whitelist.json",
        path,
        original,
    )?;
    replace_json_file(path, &serde_json::to_vec_pretty(value)?)
}

async fn resolve_floodgate_profile(
    client: &Client,
    requested_name: &str,
    prefix: &str,
) -> AppResult<(String, String)> {
    let mut url = reqwest::Url::parse("https://api.geysermc.org/v2/utils/uuid/bedrock_or_java/")
        .map_err(|_| {
            AppError::Validation("GeyserMC公式プロフィールURLを作成できませんでした".into())
        })?;
    url.path_segments_mut()
        .map_err(|_| {
            AppError::Validation("GeyserMC公式プロフィールURLを検証できませんでした".into())
        })?
        .push(requested_name);
    url.query_pairs_mut().append_pair("prefix", prefix);
    let response = client.get(url).send().await?;
    if matches!(
        response.status(),
        StatusCode::NO_CONTENT | StatusCode::NOT_FOUND
    ) {
        return Err(AppError::Validation(
            "そのXboxゲーマータグをGeyserMC公式サービスで確認できませんでした。一度Geyserサーバーへ参加してから再試行してください".into(),
        ));
    }
    if matches!(
        response.status(),
        StatusCode::TOO_MANY_REQUESTS | StatusCode::SERVICE_UNAVAILABLE
    ) {
        return Err(AppError::Validation(
            "GeyserMC公式プロフィール確認が混み合っています。サーバー起動後に再試行してください"
                .into(),
        ));
    }
    let profile: Value = response.error_for_status()?.json().await?;
    let raw_uuid = profile
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Validation("GeyserMC公式応答にUUIDがありません".into()))?;
    let uuid = canonical_uuid(raw_uuid)?;
    if !is_floodgate_uuid(&uuid) {
        return Err(AppError::Validation(
            "指定した名前はFloodgate統合版プレイヤーとして確認できませんでした".into(),
        ));
    }
    let name = profile
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty() && !name.chars().any(char::is_control))
        .ok_or_else(|| AppError::Validation("GeyserMC公式応答にプレイヤー名がありません".into()))?;
    Ok((uuid, name.to_string()))
}

fn floodgate_username_prefix(root: &Path) -> String {
    let config = std::fs::read_dir(root.join("plugins"))
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .find(|entry| {
            entry.file_type().is_ok_and(|kind| kind.is_dir())
                && entry
                    .file_name()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .contains("floodgate")
        })
        .map(|entry| entry.path().join("config.yml"));
    let Some(contents) = config.and_then(|path| std::fs::read_to_string(path).ok()) else {
        return ".".into();
    };
    contents
        .lines()
        .find_map(|line| {
            let value = line.trim().strip_prefix("username-prefix:")?.trim();
            let value = value.trim_matches(['\'', '"']);
            (value.chars().count() <= 8 && !value.chars().any(char::is_control))
                .then(|| value.to_string())
        })
        .unwrap_or_else(|| ".".into())
}

fn is_floodgate_uuid(value: &str) -> bool {
    canonical_uuid(value)
        .ok()
        .and_then(|uuid| uuid.split('-').nth(3).map(str::to_string))
        .is_some_and(|group| group == "0009")
}

fn cached_player_profile(root: &Path, requested_name: &str) -> Option<(String, String)> {
    [
        "usercache.json",
        "whitelist.json",
        "ops.json",
        "banned-players.json",
    ]
    .iter()
    .find_map(|file_name| {
        let value: Value =
            serde_json::from_slice(&std::fs::read(root.join(file_name)).ok()?).ok()?;
        value.as_array()?.iter().find_map(|entry| {
            let name = entry.get("name")?.as_str()?;
            if !name.eq_ignore_ascii_case(requested_name) {
                return None;
            }
            let uuid = canonical_uuid(entry.get("uuid")?.as_str()?).ok()?;
            if is_floodgate_uuid(&uuid) {
                return None;
            }
            Some((uuid, name.to_string()))
        })
    })
}

fn canonical_uuid(value: &str) -> AppResult<String> {
    let compact = value
        .chars()
        .filter(|character| *character != '-')
        .collect::<String>();
    if compact.len() != 32
        || !compact
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err(AppError::Validation(
            "プレイヤーUUIDの形式が正しくありません".into(),
        ));
    }
    Ok(format!(
        "{}-{}-{}-{}-{}",
        &compact[0..8],
        &compact[8..12],
        &compact[12..16],
        &compact[16..20],
        &compact[20..32]
    )
    .to_ascii_lowercase())
}

fn validated_reason(reason: Option<&str>) -> AppResult<&str> {
    let reason = reason.unwrap_or("").trim();
    if reason.chars().count() > 120 || reason.chars().any(char::is_control) {
        return Err(AppError::Validation(
            "BAN理由は制御文字を含めず120文字以内で入力してください".into(),
        ));
    }
    Ok(reason)
}

fn minecraft_timestamp() -> String {
    Utc::now().format("%Y-%m-%d %H:%M:%S %z").to_string()
}

fn save_history(root: &Path, file_name: &str, path: &Path, original: &[u8]) -> AppResult<()> {
    if !path.is_file() {
        return Ok(());
    }
    let history = root.join(".server-hub").join("player-access-history");
    std::fs::create_dir_all(&history)?;
    let timestamp = Utc::now().format("%Y%m%dT%H%M%S%.3fZ");
    std::fs::write(history.join(format!("{timestamp}-{file_name}")), original)?;
    Ok(())
}

fn replace_json_file(path: &Path, bytes: &[u8]) -> AppResult<()> {
    let temporary = path.with_extension("json.tmp");
    let previous = path.with_extension("json.previous");
    std::fs::write(&temporary, bytes)?;
    let had_original = path.is_file();
    if previous.exists() {
        std::fs::remove_file(&previous)?;
    }
    if had_original {
        std::fs::rename(path, &previous)?;
    }
    if let Err(error) = std::fs::rename(&temporary, path) {
        if had_original {
            let _ = std::fs::rename(&previous, path);
        }
        let _ = std::fs::remove_file(&temporary);
        return Err(error.into());
    }
    if had_original {
        std::fs::remove_file(previous)?;
    }
    Ok(())
}

pub fn audit_action(kind: &str, add: bool) -> &'static str {
    match (kind, add) {
        ("whitelist", true) => "whitelist.add",
        ("whitelist", false) => "whitelist.remove",
        ("bedrock_whitelist", true) => "floodgate-whitelist.add",
        ("bedrock_whitelist", false) => "floodgate-whitelist.remove",
        ("operators", true) => "operator.add",
        ("operators", false) => "operator.remove",
        ("banned_players", true) => "player-ban.add",
        ("banned_players", false) => "player-ban.remove",
        ("banned_ips", true) => "ip-ban.add",
        ("banned_ips", false) => "ip-ban.remove",
        _ => "player-access.update",
    }
}

fn file_for_kind(profile: &ServerProfile, kind: &str) -> AppResult<&'static str> {
    if profile.server_type == "bedrock" {
        return match kind {
            "whitelist" => Ok("allowlist.json"),
            "operators" => Ok("permissions.json"),
            "banned_players" | "banned_ips" => Err(AppError::Validation(
                "統合版専用サーバーは永続BANファイルを提供していません".into(),
            )),
            _ => Err(AppError::Validation(
                "プレイヤー管理の種類が不正です".into(),
            )),
        };
    }
    match kind {
        "whitelist" => Ok("whitelist.json"),
        "bedrock_whitelist" if profile.server_type == "paper" => Ok("whitelist.json"),
        "operators" => Ok("ops.json"),
        "banned_players" => Ok("banned-players.json"),
        "banned_ips" => Ok("banned-ips.json"),
        _ => Err(AppError::Validation(
            "プレイヤー管理の種類が不正です".into(),
        )),
    }
}

fn entry_from_value(
    kind: &str,
    index: usize,
    value: &Value,
    bedrock: bool,
) -> Option<PlayerAccessEntry> {
    let object = value.as_object()?;
    if bedrock && kind == "operators" {
        let xuid = object.get("xuid")?.as_str()?;
        let permission = object
            .get("permission")
            .and_then(Value::as_str)
            .unwrap_or("member");
        return Some(PlayerAccessEntry {
            id: xuid.to_string(),
            label: format!("XUID {xuid}"),
            detail: permission.to_string(),
            level: Some(match permission {
                "operator" => 4,
                "member" => 1,
                _ => 0,
            }),
            reason: None,
            expires: None,
            pending: false,
        });
    }
    let name = object.get("name").and_then(Value::as_str);
    let uuid = object.get("uuid").and_then(Value::as_str).unwrap_or("");
    let ip = object.get("ip").and_then(Value::as_str);
    let (id, label, detail) = if kind == "banned_ips" {
        let ip = ip?;
        (
            private_id(ip),
            mask_ip(ip),
            "IPアドレスは安全のため一部を非表示".into(),
        )
    } else {
        let name = name?;
        (
            if uuid.is_empty() {
                format!("{kind}-{index}-{name}")
            } else {
                uuid.to_string()
            },
            name.to_string(),
            uuid.to_string(),
        )
    };
    Some(PlayerAccessEntry {
        id,
        label,
        detail,
        level: object
            .get("level")
            .and_then(Value::as_u64)
            .and_then(|value| u8::try_from(value).ok()),
        reason: object
            .get("reason")
            .and_then(Value::as_str)
            .map(str::to_string),
        expires: object
            .get("expires")
            .and_then(Value::as_str)
            .filter(|value| *value != "forever")
            .map(str::to_string),
        pending: false,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingBedrockOperator {
    name: String,
    created_at: String,
}

fn update_bedrock_offline(
    root: &Path,
    file_name: &str,
    path: &Path,
    original: &[u8],
    value: &mut Value,
    input: &UpdatePlayerAccessInput,
) -> AppResult<()> {
    let entries = value
        .as_array_mut()
        .ok_or_else(|| AppError::Validation(format!("{file_name} の形式を読み取れませんでした")))?;
    let target = input.target.trim();
    if input.kind == "whitelist" {
        if input.add {
            if !valid_bedrock_name(target) {
                return Err(AppError::Validation(
                    "統合版のゲーマータグは制御文字を含めず64文字以内で入力してください".into(),
                ));
            }
            if entries.iter().any(|entry| {
                entry
                    .get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| name.eq_ignore_ascii_case(target))
            }) {
                return Err(AppError::Validation(
                    "このプレイヤーはすでに登録されています".into(),
                ));
            }
            entries.push(serde_json::json!({ "ignoresPlayerLimit": false, "name": target }));
        } else {
            let before = entries.len();
            let entry_id = input.entry_id.as_deref();
            entries.retain(|entry| {
                let name = entry.get("name").and_then(Value::as_str).unwrap_or("");
                let id_matches = entry_id.is_some_and(|id| {
                    id == name || entry.get("xuid").and_then(Value::as_str) == Some(id)
                });
                !(id_matches || (!target.is_empty() && name.eq_ignore_ascii_case(target)))
            });
            if entries.len() == before {
                return Err(AppError::Validation(
                    "選択した登録項目を再確認できませんでした".into(),
                ));
            }
        }
    } else if input.kind == "operators" {
        if input.add {
            let xuid = match resolve_bedrock_xuid(root, target) {
                Ok(xuid) => xuid,
                Err(AppError::Validation(_)) if valid_bedrock_name(target) => {
                    add_pending_bedrock_operator(root, target)?;
                    return Ok(());
                }
                Err(error) => return Err(error),
            };
            remove_pending_bedrock_operator(root, target)?;
            if entries
                .iter()
                .any(|entry| entry.get("xuid").and_then(Value::as_str) == Some(xuid.as_str()))
            {
                return Err(AppError::Validation(
                    "このXUIDはすでに権限一覧へ登録されています".into(),
                ));
            }
            entries.push(serde_json::json!({ "permission": "operator", "xuid": xuid }));
        } else {
            if remove_pending_bedrock_operator(root, target)? {
                return Ok(());
            }
            let xuid = input
                .entry_id
                .as_deref()
                .filter(|value| valid_xuid(value))
                .or_else(|| valid_xuid(target).then_some(target))
                .ok_or_else(|| {
                    AppError::Validation("解除する統合版プレイヤーのXUIDを確認できません".into())
                })?;
            let before = entries.len();
            entries.retain(|entry| entry.get("xuid").and_then(Value::as_str) != Some(xuid));
            if entries.len() == before {
                return Err(AppError::Validation(
                    "選択した登録項目を再確認できませんでした".into(),
                ));
            }
        }
    } else {
        return Err(AppError::Validation(
            "統合版専用サーバーはこのアクセス管理操作に対応していません".into(),
        ));
    }
    save_history(root, file_name, path, original)
}

pub fn bedrock_operator_pending(profile: &ServerProfile, target: &str) -> AppResult<bool> {
    if profile.server_type != "bedrock" {
        return Ok(false);
    }
    Ok(
        read_pending_bedrock_operators(Path::new(&profile.root_path))?
            .iter()
            .any(|pending| pending.name.eq_ignore_ascii_case(target.trim())),
    )
}

pub fn reconcile_pending_bedrock_operators(profile: &ServerProfile) -> AppResult<bool> {
    if profile.server_type != "bedrock" {
        return Ok(false);
    }
    let root = Path::new(&profile.root_path);
    let pending = read_pending_bedrock_operators(root)?;
    if pending.is_empty() {
        return Ok(false);
    }

    let permissions_path = root.join("permissions.json");
    let original = if permissions_path.is_file() {
        std::fs::read(&permissions_path)?
    } else {
        b"[]".to_vec()
    };
    let mut permissions: Value = serde_json::from_slice(&original)?;
    let entries = permissions.as_array_mut().ok_or_else(|| {
        AppError::Validation("permissions.json の形式を読み取れませんでした".into())
    })?;
    let mut remaining = Vec::new();
    let mut resolved_any = false;
    let mut permissions_changed = false;

    for pending_operator in pending {
        match resolve_bedrock_xuid(root, &pending_operator.name) {
            Ok(xuid) => {
                resolved_any = true;
                if !entries
                    .iter()
                    .any(|entry| entry.get("xuid").and_then(Value::as_str) == Some(xuid.as_str()))
                {
                    entries.push(serde_json::json!({ "permission": "operator", "xuid": xuid }));
                    permissions_changed = true;
                }
            }
            Err(AppError::Validation(_)) => remaining.push(pending_operator),
            Err(error) => return Err(error),
        }
    }

    if !resolved_any {
        return Ok(false);
    }
    if permissions_changed {
        save_history(root, "permissions.json", &permissions_path, &original)?;
        replace_json_file(&permissions_path, &serde_json::to_vec_pretty(&permissions)?)?;
    }
    write_pending_bedrock_operators(root, &remaining)?;
    Ok(true)
}

fn pending_bedrock_operators_path(root: &Path) -> std::path::PathBuf {
    root.join(".server-hub")
        .join("pending-bedrock-operators.json")
}

fn read_pending_bedrock_operators(root: &Path) -> AppResult<Vec<PendingBedrockOperator>> {
    let path = pending_bedrock_operators_path(root);
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let pending: Vec<PendingBedrockOperator> = serde_json::from_slice(&std::fs::read(path)?)?;
    Ok(pending
        .into_iter()
        .filter(|entry| valid_bedrock_name(&entry.name))
        .collect())
}

fn write_pending_bedrock_operators(
    root: &Path,
    pending: &[PendingBedrockOperator],
) -> AppResult<()> {
    let path = pending_bedrock_operators_path(root);
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Validation("権限反映待ちの保存先が正しくありません".into()))?;
    std::fs::create_dir_all(parent)?;
    replace_json_file(&path, &serde_json::to_vec_pretty(pending)?)
}

fn add_pending_bedrock_operator(root: &Path, name: &str) -> AppResult<()> {
    let mut pending = read_pending_bedrock_operators(root)?;
    if pending
        .iter()
        .any(|entry| entry.name.eq_ignore_ascii_case(name))
    {
        return Err(AppError::Validation(
            "このプレイヤーはXUID確認待ちとして登録済みです".into(),
        ));
    }
    pending.push(PendingBedrockOperator {
        name: name.to_string(),
        created_at: Utc::now().to_rfc3339(),
    });
    write_pending_bedrock_operators(root, &pending)
}

fn remove_pending_bedrock_operator(root: &Path, name: &str) -> AppResult<bool> {
    let mut pending = read_pending_bedrock_operators(root)?;
    let before = pending.len();
    pending.retain(|entry| !entry.name.eq_ignore_ascii_case(name));
    if pending.len() == before {
        return Ok(false);
    }
    write_pending_bedrock_operators(root, &pending)?;
    Ok(true)
}

fn resolve_bedrock_xuid(root: &Path, target: &str) -> AppResult<String> {
    if valid_xuid(target) {
        return Ok(target.to_string());
    }
    if !valid_bedrock_name(target) {
        return Err(AppError::Validation(
            "権限者にはゲーマータグまたは数字のXUIDを入力してください".into(),
        ));
    }
    let allowlist: Value = serde_json::from_slice(
        &std::fs::read(root.join("allowlist.json")).unwrap_or_else(|_| b"[]".to_vec()),
    )?;
    allowlist.as_array().into_iter().flatten().find_map(|entry| {
        let name = entry.get("name")?.as_str()?;
        if !name.eq_ignore_ascii_case(target) { return None; }
        entry.get("xuid")?.as_str().filter(|xuid| valid_xuid(xuid)).map(str::to_string)
    }).ok_or_else(|| AppError::Validation("停止中に権限者へ追加するには、一度参加してXUIDが記録されたプレイヤーか、数字のXUIDを指定してください".into()))
}

fn valid_xuid(value: &str) -> bool {
    (8..=20).contains(&value.len()) && value.chars().all(|character| character.is_ascii_digit())
}

fn valid_bedrock_name(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed == value
        && trimmed.chars().count() <= 64
        && !trimmed.chars().any(char::is_control)
}

fn resolve_banned_ip(profile: &ServerProfile, entry_id: &str) -> AppResult<String> {
    let path = Path::new(&profile.root_path).join("banned-ips.json");
    let value: Value = serde_json::from_slice(&std::fs::read(path)?)?;
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get("ip").and_then(Value::as_str))
        .find(|ip| private_id(ip) == entry_id)
        .map(str::to_string)
        .ok_or_else(|| AppError::Validation("選択したBAN IPを再確認できませんでした".into()))
}

fn valid_player_name(value: &str) -> bool {
    (3..=16).contains(&value.len())
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
}

fn valid_runtime_player_name(value: &str) -> bool {
    (1..=32).contains(&value.len())
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '.' | '-')
        })
}

fn quote_command_target(value: &str) -> AppResult<String> {
    if value.contains(['"', '\\', '\r', '\n', '\0']) {
        return Err(AppError::Validation(
            "プレイヤー名にコマンドで扱えない文字が含まれています".into(),
        ));
    }
    Ok(if value.chars().any(char::is_whitespace) {
        format!("\"{value}\"")
    } else {
        value.to_string()
    })
}

fn with_reason(command: &str, target: &str, reason: &str) -> String {
    if reason.is_empty() {
        format!("{command} {target}")
    } else {
        format!("{command} {target} {reason}")
    }
}

fn private_id(value: &str) -> String {
    hex::encode(Sha256::digest(value.as_bytes()))[..20].to_string()
}

fn mask_ip(value: &str) -> String {
    match value.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            let octets = ip.octets();
            format!("{}.{}.***.***", octets[0], octets[1])
        }
        Ok(IpAddr::V6(ip)) => format!("{}:****:****", ip.segments()[0]),
        Err(_) => "***".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_uuid, command, entry_from_value, floodgate_username_prefix, private_id,
        resolve_player_profile, update_offline,
    };
    use crate::models::{BasicSettings, ServerProfile, UpdatePlayerAccessInput};
    use serde_json::json;

    fn profile(root: &std::path::Path) -> ServerProfile {
        ServerProfile {
            id: "access-test".into(),
            name: "Access Test".into(),
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
        }
    }

    #[test]
    fn parses_player_lists_and_masks_banned_ips() {
        let operator = entry_from_value(
            "operators",
            0,
            &json!({ "uuid": "demo-uuid", "name": "Player123", "level": 4 }),
            false,
        )
        .unwrap();
        assert_eq!(operator.label, "Player123");
        assert_eq!(operator.level, Some(4));
        let banned_ip = entry_from_value(
            "banned_ips",
            0,
            &json!({ "ip": "203.0.113.42", "reason": "spam" }),
            false,
        )
        .unwrap();
        assert_eq!(banned_ip.label, "203.0.***.***");
        assert_eq!(banned_ip.id, private_id("203.0.113.42"));
        assert!(!banned_ip.detail.contains("113.42"));
    }

    #[test]
    fn builds_safe_commands_and_resolves_masked_ip_removal_in_backend() {
        let root = std::env::temp_dir().join(format!("msh-player-access-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("banned-ips.json"),
            serde_json::to_vec(&json!([{ "ip": "203.0.113.42", "reason": "spam" }])).unwrap(),
        )
        .unwrap();
        let profile = profile(&root);
        let remove = UpdatePlayerAccessInput {
            server_id: profile.id.clone(),
            kind: "banned_ips".into(),
            target: String::new(),
            entry_id: Some(private_id("203.0.113.42")),
            add: false,
            reason: None,
        };
        assert_eq!(
            command(&profile, &remove).unwrap(),
            "pardon-ip 203.0.113.42"
        );
        let ban = UpdatePlayerAccessInput {
            server_id: profile.id.clone(),
            kind: "banned_players".into(),
            target: "Griefer123".into(),
            entry_id: None,
            add: true,
            reason: Some("迷惑行為".into()),
        };
        assert_eq!(command(&profile, &ban).unwrap(), "ban Griefer123 迷惑行為");
        let invalid = UpdatePlayerAccessInput {
            server_id: profile.id.clone(),
            kind: "operators".into(),
            target: "bad name".into(),
            entry_id: None,
            add: true,
            reason: None,
        };
        assert!(command(&profile, &invalid).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn edits_player_access_files_while_stopped_and_keeps_history() {
        let root = std::env::temp_dir().join(format!(
            "msh-player-access-offline-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("usercache.json"),
            serde_json::to_vec(&json!([{
                "name": "Player123",
                "uuid": "12345678123456781234567812345678",
                "expiresOn": "2099-01-01 00:00:00 +0000"
            }]))
            .unwrap(),
        )
        .unwrap();
        let profile = profile(&root);
        let client = crate::downloads::http_client().unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let add = UpdatePlayerAccessInput {
                server_id: profile.id.clone(),
                kind: "whitelist".into(),
                target: "Player123".into(),
                entry_id: None,
                add: true,
                reason: None,
            };
            update_offline(&client, &profile, &add).await.unwrap();
            let listed = super::list(&profile, "whitelist").unwrap();
            assert_eq!(listed[0].label, "Player123");
            assert_eq!(listed[0].detail, "12345678-1234-5678-1234-567812345678");

            let remove = UpdatePlayerAccessInput {
                server_id: profile.id.clone(),
                kind: "whitelist".into(),
                target: "Player123".into(),
                entry_id: Some(listed[0].id.clone()),
                add: false,
                reason: None,
            };
            update_offline(&client, &profile, &remove).await.unwrap();
            assert!(super::list(&profile, "whitelist").unwrap().is_empty());

            let ban_ip = UpdatePlayerAccessInput {
                server_id: profile.id.clone(),
                kind: "banned_ips".into(),
                target: "203.0.113.42".into(),
                entry_id: None,
                add: true,
                reason: Some("test".into()),
            };
            update_offline(&client, &profile, &ban_ip).await.unwrap();
            assert_eq!(
                super::list(&profile, "banned_ips").unwrap()[0].label,
                "203.0.***.***"
            );
        });
        let history = root.join(".server-hub/player-access-history");
        assert!(history.is_dir());
        assert!(std::fs::read_dir(history).unwrap().count() >= 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn refuses_unverifiable_offline_mode_names_before_start() {
        let root = std::env::temp_dir().join(format!(
            "msh-player-access-offline-mode-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let mut profile = profile(&root);
        profile.settings.online_mode = false;
        let input = UpdatePlayerAccessInput {
            server_id: profile.id.clone(),
            kind: "whitelist".into(),
            target: "Unknown123".into(),
            entry_id: None,
            add: true,
            reason: None,
        };
        let client = crate::downloads::http_client().unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        assert!(
            runtime
                .block_on(update_offline(&client, &profile, &input))
                .is_err()
        );
        assert!(!root.join("whitelist.json").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reuses_a_fixed_players_uuid_across_access_files_without_another_lookup() {
        let root =
            std::env::temp_dir().join(format!("msh-player-access-reuse-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("whitelist.json"),
            serde_json::to_vec(&json!([{
                "name": "FixedFriend",
                "uuid": "12345678-1234-5678-1234-567812345678"
            }]))
            .unwrap(),
        )
        .unwrap();
        let mut profile = profile(&root);
        profile.settings.online_mode = false;
        let input = UpdatePlayerAccessInput {
            server_id: profile.id.clone(),
            kind: "operators".into(),
            target: "FixedFriend".into(),
            entry_id: None,
            add: true,
            reason: None,
        };
        let client = crate::downloads::http_client().unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime
            .block_on(update_offline(&client, &profile, &input))
            .unwrap();
        let operators = super::list(&profile, "operators").unwrap();
        assert_eq!(operators[0].label, "FixedFriend");
        assert_eq!(operators[0].detail, "12345678-1234-5678-1234-567812345678");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn normalizes_compact_and_hyphenated_player_uuids() {
        assert_eq!(
            canonical_uuid("12345678123456781234567812345678").unwrap(),
            "12345678-1234-5678-1234-567812345678"
        );
        assert_eq!(
            canonical_uuid("12345678-1234-5678-1234-567812345678").unwrap(),
            "12345678-1234-5678-1234-567812345678"
        );
        assert!(canonical_uuid("bad").is_err());
    }

    #[test]
    fn separates_java_and_floodgate_whitelists_and_uses_fwhitelist() {
        let root =
            std::env::temp_dir().join(format!("msh-floodgate-whitelist-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("plugins/Floodgate")).unwrap();
        std::fs::write(
            root.join("plugins/Floodgate-Spigot.jar"),
            b"test plugin marker",
        )
        .unwrap();
        std::fs::write(
            root.join("plugins/Floodgate/config.yml"),
            b"username-prefix: \"+\"\n",
        )
        .unwrap();
        std::fs::write(
            root.join("whitelist.json"),
            serde_json::to_vec(&json!([
                { "uuid": "12345678-1234-4234-8234-123456789abc", "name": "JavaFriend" },
                { "uuid": "00000000-0000-0000-0009-01f64f65c7c3", "name": "+Xbox Friend" }
            ]))
            .unwrap(),
        )
        .unwrap();
        let profile = profile(&root);

        assert_eq!(
            super::list(&profile, "whitelist").unwrap()[0].label,
            "JavaFriend"
        );
        let bedrock = super::list(&profile, "bedrock_whitelist").unwrap();
        assert_eq!(bedrock.len(), 1);
        assert_eq!(bedrock[0].label, "+Xbox Friend");
        assert_eq!(floodgate_username_prefix(&root), "+");
        assert_eq!(
            command(
                &profile,
                &UpdatePlayerAccessInput {
                    server_id: profile.id.clone(),
                    kind: "bedrock_whitelist".into(),
                    target: "Xbox Friend".into(),
                    entry_id: None,
                    add: true,
                    reason: None,
                }
            )
            .unwrap(),
            "fwhitelist add \"Xbox Friend\""
        );
        assert_eq!(
            command(
                &profile,
                &UpdatePlayerAccessInput {
                    server_id: profile.id.clone(),
                    kind: "bedrock_whitelist".into(),
                    target: "+Xbox Friend".into(),
                    entry_id: Some(bedrock[0].id.clone()),
                    add: false,
                    reason: None,
                }
            )
            .unwrap(),
            "fwhitelist remove \"Xbox Friend\""
        );

        let client = crate::downloads::http_client().unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime
            .block_on(update_offline(
                &client,
                &profile,
                &UpdatePlayerAccessInput {
                    server_id: profile.id.clone(),
                    kind: "bedrock_whitelist".into(),
                    target: "+Xbox Friend".into(),
                    entry_id: Some(bedrock[0].id.clone()),
                    add: false,
                    reason: None,
                },
            ))
            .unwrap();
        assert!(
            super::list(&profile, "bedrock_whitelist")
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            super::list(&profile, "whitelist").unwrap()[0].label,
            "JavaFriend"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "Minecraft公式プロフィールAPIへ接続する明示実行用テスト"]
    fn resolves_a_live_official_player_profile_before_start() {
        let root =
            std::env::temp_dir().join(format!("msh-player-profile-live-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let profile = profile(&root);
        let client = crate::downloads::http_client().unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let (uuid, name) = runtime
            .block_on(resolve_player_profile(&client, &profile, "Notch"))
            .unwrap();
        assert_eq!(name, "Notch");
        assert_eq!(uuid.len(), 36);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn manages_bedrock_allowlist_and_permissions_without_java_uuid_lookup() {
        let root = std::env::temp_dir().join(format!(
            "msh-bedrock-player-access-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("allowlist.json"),
            serde_json::to_vec(&json!([{
                "name": "Known Friend", "xuid": "2533274790000001", "ignoresPlayerLimit": false
            }]))
            .unwrap(),
        )
        .unwrap();
        let mut profile = profile(&root);
        profile.server_type = "bedrock".into();
        profile.launch_target = "bedrock_server.exe".into();
        profile.java_path.clear();
        profile.java_major = 0;
        profile.port = 19132;
        let client = crate::downloads::http_client().unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let add_friend = UpdatePlayerAccessInput {
                server_id: profile.id.clone(),
                kind: "whitelist".into(),
                target: "Second Friend".into(),
                entry_id: None,
                add: true,
                reason: None,
            };
            update_offline(&client, &profile, &add_friend)
                .await
                .unwrap();
            assert!(
                super::list(&profile, "whitelist")
                    .unwrap()
                    .iter()
                    .any(|entry| entry.label == "Second Friend")
            );

            let add_operator = UpdatePlayerAccessInput {
                server_id: profile.id.clone(),
                kind: "operators".into(),
                target: "Known Friend".into(),
                entry_id: None,
                add: true,
                reason: None,
            };
            update_offline(&client, &profile, &add_operator)
                .await
                .unwrap();
            let operators = super::list(&profile, "operators").unwrap();
            assert_eq!(operators[0].id, "2533274790000001");
            assert_eq!(operators[0].detail, "operator");

            let pending_operator = UpdatePlayerAccessInput {
                server_id: profile.id.clone(),
                kind: "operators".into(),
                target: "Not Joined Yet".into(),
                entry_id: None,
                add: true,
                reason: None,
            };
            update_offline(&client, &profile, &pending_operator)
                .await
                .unwrap();
            let operators = super::list(&profile, "operators").unwrap();
            let pending = operators
                .iter()
                .find(|entry| entry.label == "Not Joined Yet")
                .expect("unresolved Bedrock player should remain visible");
            assert!(pending.pending);
            assert!(pending.detail.contains("未反映"));

            let remove_pending = UpdatePlayerAccessInput {
                server_id: profile.id.clone(),
                kind: "operators".into(),
                target: pending.label.clone(),
                entry_id: Some(pending.id.clone()),
                add: false,
                reason: None,
            };
            update_offline(&client, &profile, &remove_pending)
                .await
                .unwrap();
            assert!(
                super::list(&profile, "operators")
                    .unwrap()
                    .iter()
                    .all(|entry| entry.label != "Not Joined Yet")
            );
        });
        let running_space_command = command(
            &profile,
            &UpdatePlayerAccessInput {
                server_id: profile.id.clone(),
                kind: "whitelist".into(),
                target: "Second Friend".into(),
                entry_id: None,
                add: true,
                reason: None,
            },
        )
        .unwrap();
        assert_eq!(running_space_command, "allowlist add \"Second Friend\"");
        assert_eq!(
            command(
                &profile,
                &UpdatePlayerAccessInput {
                    server_id: profile.id.clone(),
                    kind: "whitelist".into(),
                    target: "Friend2".into(),
                    entry_id: None,
                    add: true,
                    reason: None
                }
            )
            .unwrap(),
            "allowlist add Friend2"
        );
        assert!(super::list(&profile, "banned_players").is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn promotes_a_pending_bedrock_operator_after_the_allowlist_records_xuid() {
        let root = std::env::temp_dir().join(format!(
            "msh-bedrock-operator-reconcile-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("allowlist.json"), b"[]").unwrap();
        let mut profile = profile(&root);
        profile.server_type = "bedrock".into();
        profile.launch_target = "bedrock_server.exe".into();
        profile.java_path.clear();
        profile.java_major = 0;
        profile.port = 19132;
        let client = crate::downloads::http_client().unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            update_offline(
                &client,
                &profile,
                &UpdatePlayerAccessInput {
                    server_id: profile.id.clone(),
                    kind: "operators".into(),
                    target: "Joined Player".into(),
                    entry_id: None,
                    add: true,
                    reason: None,
                },
            )
            .await
            .unwrap();
        });
        assert!(super::list(&profile, "operators").unwrap()[0].pending);

        std::fs::write(
            root.join("allowlist.json"),
            serde_json::to_vec(&json!([{
                "name": "Joined Player",
                "xuid": "2533274790000099",
                "ignoresPlayerLimit": false
            }]))
            .unwrap(),
        )
        .unwrap();
        assert!(super::reconcile_pending_bedrock_operators(&profile).unwrap());

        let operators = super::list(&profile, "operators").unwrap();
        assert_eq!(operators.len(), 1);
        assert_eq!(operators[0].id, "2533274790000099");
        assert_eq!(operators[0].detail, "operator");
        assert!(!operators[0].pending);
        let permissions: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("permissions.json")).unwrap()).unwrap();
        assert_eq!(permissions[0]["permission"], "operator");
        assert_eq!(permissions[0]["xuid"], "2533274790000099");
        let pending: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.join(".server-hub/pending-bedrock-operators.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(pending, json!([]));
        std::fs::remove_dir_all(root).unwrap();
    }
}
