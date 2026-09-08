use base64::{
    Engine as _,
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD},
};
use reqwest::Client;
use serde_json::Value;

use crate::error::{AppError, AppResult};

const MAX_SKIN_BYTES: usize = 1_048_576;

fn canonical_uuid(value: &str) -> Option<String> {
    let uuid = value
        .chars()
        .filter(|value| *value != '-')
        .collect::<String>();
    (uuid.len() == 32 && uuid.chars().all(|value| value.is_ascii_hexdigit()))
        .then(|| uuid.to_ascii_lowercase())
}

async fn resolve_uuid(client: &Client, player_name: &str) -> AppResult<Option<String>> {
    if !(3..=16).contains(&player_name.len())
        || !player_name
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '_')
    {
        return Ok(None);
    }
    let profile = client
        .get(format!(
            "https://api.mojang.com/users/profiles/minecraft/{player_name}"
        ))
        .send()
        .await?;
    if matches!(
        profile.status(),
        reqwest::StatusCode::NO_CONTENT | reqwest::StatusCode::NOT_FOUND
    ) {
        return Ok(None);
    }
    let profile: Value = profile.error_for_status()?.json().await?;
    Ok(profile
        .get("id")
        .and_then(Value::as_str)
        .and_then(canonical_uuid))
}

async fn skin_url_for_uuid(client: &Client, uuid: &str) -> AppResult<Option<reqwest::Url>> {
    let response = client
        .get(format!(
            "https://sessionserver.mojang.com/session/minecraft/profile/{uuid}"
        ))
        .send()
        .await?;
    if matches!(
        response.status(),
        reqwest::StatusCode::NO_CONTENT | reqwest::StatusCode::NOT_FOUND
    ) {
        return Ok(None);
    }
    let session: Value = response.error_for_status()?.json().await?;
    let Some(encoded) = session
        .get("properties")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|property| property.get("name").and_then(Value::as_str) == Some("textures"))
        .and_then(|property| property.get("value"))
        .and_then(Value::as_str)
    else {
        return Ok(None);
    };
    let decoded = STANDARD
        .decode(encoded)
        .or_else(|_| STANDARD_NO_PAD.decode(encoded))
        .map_err(|_| AppError::Validation("公式スキン情報を読み取れませんでした".into()))?;
    let textures: Value = serde_json::from_slice(&decoded)?;
    let Some(url) = textures
        .pointer("/textures/SKIN/url")
        .and_then(Value::as_str)
    else {
        return Ok(None);
    };
    let parsed = reqwest::Url::parse(url)
        .map_err(|_| AppError::Validation("公式スキンURLを検証できませんでした".into()))?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str() != Some("textures.minecraft.net")
        || !parsed.path().starts_with("/texture/")
    {
        return Err(AppError::Validation(
            "公式Minecraftスキン配布元以外は読み込みません".into(),
        ));
    }
    let mut parsed = parsed;
    if parsed.scheme() == "http" {
        parsed.set_scheme("https").map_err(|_| {
            AppError::Validation("公式スキンURLをHTTPSへ変換できませんでした".into())
        })?;
    }
    Ok(Some(parsed))
}

pub async fn official_skin_data_url(
    client: &Client,
    player_name: &str,
    player_id: Option<&str>,
) -> AppResult<Option<String>> {
    let provided_uuid = player_id.and_then(canonical_uuid);
    let mut skin_url = None;
    if let Some(uuid) = provided_uuid.as_deref() {
        skin_url = skin_url_for_uuid(client, uuid).await?;
    }
    if skin_url.is_none() {
        let Some(uuid) = resolve_uuid(client, player_name).await? else {
            return Ok(None);
        };
        skin_url = skin_url_for_uuid(client, &uuid).await?;
    }
    let Some(parsed) = skin_url else {
        return Ok(None);
    };
    let response = client.get(parsed).send().await?.error_for_status()?;
    if response
        .content_length()
        .is_some_and(|size| size > MAX_SKIN_BYTES as u64)
    {
        return Err(AppError::Validation(
            "スキン画像が上限容量を超えています".into(),
        ));
    }
    let bytes = response.bytes().await?;
    if bytes.len() > MAX_SKIN_BYTES
        || !bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a])
    {
        return Err(AppError::Validation(
            "公式スキン画像の形式を確認できませんでした".into(),
        ));
    }
    Ok(Some(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(bytes)
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_compact_and_hyphenated_official_uuids() {
        assert_eq!(
            canonical_uuid("e5004b4d198347f582f38d218d5adb83").as_deref(),
            Some("e5004b4d198347f582f38d218d5adb83")
        );
        assert_eq!(
            canonical_uuid("e5004b4d-1983-47f5-82f3-8d218d5adb83").as_deref(),
            Some("e5004b4d198347f582f38d218d5adb83")
        );
        assert!(canonical_uuid("not-a-player-id").is_none());
    }

    #[test]
    #[ignore = "requires the official Mojang profile, session, and texture services"]
    fn fetches_a_configured_players_official_skin() {
        let player_name = std::env::var("MSH_TEST_PLAYER_NAME").expect("set MSH_TEST_PLAYER_NAME");
        let client = crate::downloads::http_client().expect("HTTP client");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Tokio runtime");
        let skin = runtime
            .block_on(official_skin_data_url(&client, &player_name, None))
            .expect("official skin request");
        assert!(skin.is_some_and(|value| value.starts_with("data:image/png;base64,")));
    }
}
