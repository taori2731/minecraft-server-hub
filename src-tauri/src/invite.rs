use std::{
    collections::HashMap,
    net::{IpAddr, Ipv4Addr, SocketAddr, ToSocketAddrs},
    sync::{Arc, Mutex},
    thread,
    time::Duration,
};

use chrono::{Duration as ChronoDuration, Utc};
use igd_next::{PortMappingProtocol, search_gateway};

use crate::{
    error::{AppError, AppResult},
    models::{ExternalProvider, InviteInfo, InviteSettings, PublicAccessStatus, ServerProfile},
};

const LEASE_SECONDS: u32 = 600;
const RENEW_SECONDS: u64 = 300;

#[derive(Clone)]
pub struct Publication {
    token: String,
    external_ip: Ipv4Addr,
    external_port: u16,
    local_addr: SocketAddr,
    protocol: PortMappingProtocol,
    expires_at: String,
    last_error: Option<String>,
    invite_name: String,
    custom_hostname: Option<String>,
    named_address: Option<String>,
    hostname_state: String,
    hostname_message: String,
}

pub type PublicationMap = Arc<Mutex<HashMap<String, Publication>>>;

pub fn info(profile: &ServerProfile) -> InviteInfo {
    let mut lan_addresses = local_ip_address::list_afinet_netifas()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|(_, ip)| ip.is_ipv4().then(|| format!("{}:{}", ip, profile.port)))
        .collect::<Vec<_>>();
    lan_addresses.sort();
    lan_addresses.dedup();
    InviteInfo {
        lan_addresses,
        host_address: format!("localhost:{}", profile.port),
        port: profile.port,
        whitelist_recommended: !profile.settings.whitelist,
        external_providers: vec![
            ExternalProvider {
                id: "upnp".into(),
                name: "ルーター自動公開（UPnP）".into(),
                account: "不要".into(),
                price: "通常は追加料金なし".into(),
                limits: "UPnP対応ルーターと公開IPv4が必要".into(),
                privacy: "参加者には自宅回線の公開IPが見えます".into(),
                status: "アプリ内で利用可能".into(),
            },
            ExternalProvider {
                id: "playit".into(),
                name: "playit.gg（代替中継）".into(),
                account: "初回登録・規約同意が必要".into(),
                price: "無料枠の対象・制限はplayit.gg公式表示を確認".into(),
                limits: if profile.server_type == "bedrock" {
                    "Minecraft Bedrock用UDPトンネルが必要。外部サービスの提供状況・規約に依存"
                        .into()
                } else {
                    "Minecraft Java用TCPトンネルが必要。外部サービスの提供状況・規約に依存".into()
                },
                privacy: "ゲーム通信がplayit.ggを経由します".into(),
                status: "公式セットアップを案内".into(),
            },
        ],
    }
}

pub fn status(
    server_id: &str,
    settings: &InviteSettings,
    publications: &PublicationMap,
) -> PublicAccessStatus {
    publications
        .lock()
        .unwrap()
        .get(server_id)
        .map(publication_status)
        .unwrap_or_else(|| stopped_status(settings))
}

pub fn is_published(server_id: &str, publications: &PublicationMap) -> bool {
    publications.lock().unwrap().contains_key(server_id)
}

pub fn publish(
    server_id: &str,
    port: u16,
    transport: &str,
    settings: &InviteSettings,
    publications: &PublicationMap,
) -> AppResult<PublicAccessStatus> {
    let local_ip =
        match local_ip_address::local_ip().map_err(|error| AppError::Other(error.to_string()))? {
            IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => ip,
            _ => {
                return Err(AppError::Validation(
                    "ルーターへ接続するIPv4アドレスを取得できませんでした".into(),
                ));
            }
        };
    let local_addr = SocketAddr::new(IpAddr::V4(local_ip), port);
    let protocol = match transport {
        "tcp" => PortMappingProtocol::TCP,
        "udp" => PortMappingProtocol::UDP,
        _ => {
            return Err(AppError::Validation(
                "公開通信方式はTCPまたはUDPに限られます".into(),
            ));
        }
    };
    let gateway = search_gateway(Default::default())
        .map_err(|_| AppError::Validation("UPnP対応ルーターを見つけられませんでした。ルーターのUPnP設定または代替中継を確認してください".into()))?;
    let external_addr = gateway
        .get_any_address(protocol, local_addr, LEASE_SECONDS, "Minecraft Server Hub")
        .map_err(|error| AppError::Other(format!("ルーターの自動公開に失敗しました: {error}")))?;
    let external_ip = match external_addr.ip() {
        IpAddr::V4(ip) if is_public_ipv4(ip) => ip,
        _ => {
            let _ = gateway.remove_port(protocol, external_addr.port());
            return Err(AppError::Validation("この回線は公開IPv4を持っていない可能性があります（CGNAT）。UPnPでは公開できないため、代替中継を利用してください".into()));
        }
    };

    let token = uuid::Uuid::new_v4().to_string();
    let mut publication = Publication {
        token: token.clone(),
        external_ip,
        external_port: external_addr.port(),
        local_addr,
        protocol,
        expires_at: expires_at(),
        last_error: None,
        invite_name: settings.invite_name.clone(),
        custom_hostname: settings.custom_hostname.clone(),
        named_address: None,
        hostname_state: "not_configured".into(),
        hostname_message: "独自ホスト名は未設定です。数値アドレスで参加できます。".into(),
    };
    apply_hostname(&mut publication);
    publications
        .lock()
        .unwrap()
        .insert(server_id.to_string(), publication.clone());
    spawn_renewal(server_id.to_string(), token, publications.clone());
    Ok(publication_status(&publication))
}

pub fn unpublish(server_id: &str, publications: &PublicationMap) -> AppResult<()> {
    let publication = publications.lock().unwrap().remove(server_id);
    if let Some(publication) = publication {
        let gateway = search_gateway(Default::default())
            .map_err(|_| AppError::Validation("公開状態は解除しましたが、ルーターへ接続できませんでした。転送設定は最大10分で自動失効します".into()))?;
        gateway
            .remove_port(publication.protocol, publication.external_port)
            .map_err(|error| AppError::Other(format!("公開状態は解除しましたが、ルーター設定の削除に失敗しました（最大10分で失効）: {error}")))?;
    }
    Ok(())
}

pub fn normalize_settings(
    invite_name: &str,
    custom_hostname: Option<&str>,
) -> AppResult<(String, Option<String>)> {
    let invite_name = invite_name.trim();
    if invite_name.is_empty()
        || invite_name.chars().count() > 32
        || invite_name.chars().any(char::is_control)
    {
        return Err(AppError::Validation(
            "招待名は制御文字を含めず、1～32文字で入力してください".into(),
        ));
    }
    let hostname = custom_hostname
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_end_matches('.').to_ascii_lowercase());
    if let Some(hostname) = hostname.as_deref() {
        validate_hostname(hostname)?;
    }
    Ok((invite_name.to_string(), hostname))
}

pub fn update_publication_settings(
    server_id: &str,
    settings: &InviteSettings,
    publications: &PublicationMap,
) {
    let current = publications.lock().unwrap().get(server_id).cloned();
    let Some(mut publication) = current else {
        return;
    };
    publication.invite_name = settings.invite_name.clone();
    publication.custom_hostname = settings.custom_hostname.clone();
    apply_hostname(&mut publication);
    let mut guard = publications.lock().unwrap();
    if guard
        .get(server_id)
        .is_some_and(|item| item.token == publication.token)
    {
        guard.insert(server_id.to_string(), publication);
    }
}

fn spawn_renewal(server_id: String, token: String, publications: PublicationMap) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(RENEW_SECONDS));
            let current = publications.lock().unwrap().get(&server_id).cloned();
            let Some(current) = current.filter(|item| item.token == token) else {
                break;
            };
            let result = match search_gateway(Default::default()) {
                Ok(gateway) => gateway
                    .add_port(
                        current.protocol,
                        current.external_port,
                        current.local_addr,
                        LEASE_SECONDS,
                        "Minecraft Server Hub",
                    )
                    .map_err(|error| error.to_string()),
                Err(error) => Err(error.to_string()),
            };
            let mut guard = publications.lock().unwrap();
            let Some(entry) = guard.get_mut(&server_id).filter(|item| item.token == token) else {
                break;
            };
            match result {
                Ok(()) => {
                    entry.expires_at = expires_at();
                    entry.last_error = None;
                }
                Err(error) => {
                    entry.last_error = Some(format!("公開期限の自動更新に失敗しました: {error}"))
                }
            }
        }
    });
}

fn publication_status(publication: &Publication) -> PublicAccessStatus {
    PublicAccessStatus {
        state: if publication.last_error.is_some() {
            "warning"
        } else {
            "published"
        }
        .into(),
        address: Some(format!(
            "{}:{}",
            publication.external_ip, publication.external_port
        )),
        named_address: publication.named_address.clone(),
        invite_name: publication.invite_name.clone(),
        custom_hostname: publication.custom_hostname.clone(),
        hostname_state: publication.hostname_state.clone(),
        hostname_message: publication.hostname_message.clone(),
        method: "UPnP".into(),
        expires_at: Some(publication.expires_at.clone()),
        message: publication.last_error.clone().unwrap_or_else(|| {
            "別の家の友達がこのアドレスで参加できます。アプリが5分ごとに公開期限を更新します。"
                .into()
        }),
        home_ip_exposed: true,
    }
}

fn stopped_status(settings: &InviteSettings) -> PublicAccessStatus {
    PublicAccessStatus {
        state: "stopped".into(),
        address: None,
        named_address: None,
        invite_name: settings.invite_name.clone(),
        custom_hostname: settings.custom_hostname.clone(),
        hostname_state: if settings.custom_hostname.is_some() {
            "pending"
        } else {
            "not_configured"
        }
        .into(),
        hostname_message: if settings.custom_hostname.is_some() {
            "公開開始時に、この名前が公開IPを指しているか確認します。".into()
        } else {
            "独自ホスト名は未設定です。数値アドレスで参加できます。".into()
        },
        method: "UPnP".into(),
        expires_at: None,
        message: "インターネットには公開していません。".into(),
        home_ip_exposed: true,
    }
}

fn apply_hostname(publication: &mut Publication) {
    publication.named_address = None;
    let Some(hostname) = publication.custom_hostname.as_deref() else {
        publication.hostname_state = "not_configured".into();
        publication.hostname_message =
            "独自ホスト名は未設定です。数値アドレスで参加できます。".into();
        return;
    };
    let resolved = format!("{hostname}:0").to_socket_addrs();
    match resolved {
        Ok(addresses) => {
            let ips = addresses
                .filter_map(|address| match address.ip() {
                    IpAddr::V4(ip) => Some(ip),
                    IpAddr::V6(_) => None,
                })
                .collect::<Vec<_>>();
            if ips.contains(&publication.external_ip) {
                publication.named_address = Some(join_address(hostname, publication.external_port));
                publication.hostname_state = "verified".into();
                publication.hostname_message =
                    "独自ホスト名が現在の公開IPを指していることを確認しました。".into();
            } else if ips.is_empty() {
                publication.hostname_state = "unresolved".into();
                publication.hostname_message = "独自ホスト名からIPv4アドレスを取得できません。DNS設定の反映後に招待設定を保存し直してください。".into();
            } else {
                publication.hostname_state = "mismatch".into();
                publication.hostname_message = "独自ホスト名が現在の公開IPを指していません。安全のため数値アドレスを表示しています。".into();
            }
        }
        Err(_) => {
            publication.hostname_state = "unresolved".into();
            publication.hostname_message =
                "独自ホスト名を解決できません。入力とDNS設定を確認してください。".into();
        }
    }
}

fn join_address(hostname: &str, port: u16) -> String {
    if port == 25565 {
        hostname.to_string()
    } else {
        format!("{hostname}:{port}")
    }
}

fn validate_hostname(hostname: &str) -> AppResult<()> {
    if hostname.len() > 253
        || !hostname.is_ascii()
        || !hostname.contains('.')
        || hostname.parse::<IpAddr>().is_ok()
        || hostname.ends_with(".local")
        || hostname.ends_with(".localhost")
        || hostname.split('.').any(|label| {
            label.is_empty()
                || label.len() > 63
                || label.starts_with('-')
                || label.ends_with('-')
                || !label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
    {
        return Err(AppError::Validation(
            "独自ホスト名は、ポートやURLを含めず play.example.com の形式で入力してください".into(),
        ));
    }
    Ok(())
}

fn expires_at() -> String {
    (Utc::now() + ChronoDuration::seconds(LEASE_SECONDS as i64)).to_rfc3339()
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_multicast()
        || octets == [255, 255, 255, 255]
        || (octets[0] == 100 && (64..=127).contains(&octets[1])))
}

#[cfg(test)]
mod tests {
    use super::{
        PortMappingProtocol, Publication, PublicationMap, is_public_ipv4, join_address,
        normalize_settings, status,
    };
    use crate::models::InviteSettings;
    use std::{
        collections::HashMap,
        net::{IpAddr, Ipv4Addr, SocketAddr},
        sync::{Arc, Mutex},
    };

    #[test]
    fn rejects_private_and_cgnat_addresses() {
        assert!(!is_public_ipv4(Ipv4Addr::new(192, 168, 1, 2)));
        assert!(!is_public_ipv4(Ipv4Addr::new(10, 0, 0, 1)));
        assert!(!is_public_ipv4(Ipv4Addr::new(100, 64, 0, 1)));
        assert!(is_public_ipv4(Ipv4Addr::new(8, 8, 8, 8)));
    }

    #[test]
    fn reports_only_active_publications() {
        let publications: PublicationMap = Arc::new(Mutex::new(HashMap::new()));
        let settings = InviteSettings {
            invite_name: "テスト部屋".into(),
            custom_hostname: None,
            updated_at: String::new(),
        };
        assert_eq!(status("server", &settings, &publications).state, "stopped");
        publications.lock().unwrap().insert(
            "server".into(),
            Publication {
                token: "test".into(),
                external_ip: Ipv4Addr::new(203, 0, 113, 42),
                external_port: 30123,
                local_addr: SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 20)), 25565),
                protocol: PortMappingProtocol::TCP,
                expires_at: "2026-08-25T00:10:00Z".into(),
                last_error: None,
                invite_name: "テスト部屋".into(),
                custom_hostname: None,
                named_address: None,
                hostname_state: "not_configured".into(),
                hostname_message: "未設定".into(),
            },
        );
        let published = status("server", &settings, &publications);
        assert_eq!(published.state, "published");
        assert_eq!(published.address.as_deref(), Some("203.0.113.42:30123"));
    }

    #[test]
    fn validates_and_normalizes_invite_settings() {
        let (name, hostname) =
            normalize_settings("  夜ふかし部屋  ", Some("PLAY.Example.COM.")).unwrap();
        assert_eq!(name, "夜ふかし部屋");
        assert_eq!(hostname.as_deref(), Some("play.example.com"));
        assert!(normalize_settings("", None).is_err());
        assert!(normalize_settings("部屋", Some("https://play.example.com")).is_err());
        assert!(normalize_settings("部屋", Some("localhost")).is_err());
    }

    #[test]
    fn omits_only_the_default_minecraft_port() {
        assert_eq!(join_address("play.example.com", 25565), "play.example.com");
        assert_eq!(
            join_address("play.example.com", 52321),
            "play.example.com:52321"
        );
    }
}
