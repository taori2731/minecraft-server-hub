use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use playit_ipc::{
    ipc::IpcClient,
    model::{AccountStatus, AgentLifecycle, AgentState},
};
use regex::Regex;
use sha2::{Digest, Sha256};

use crate::{
    error::{AppError, AppResult},
    models::{TunnelAgentValidation, TunnelExternalProbe, TunnelStatus},
};

const PROVIDER_ID: &str = "playit";
const LOCAL_HOST: &str = "127.0.0.1";
const PLAYIT_MSI_CLI_V1_0_10_SHA256: &str =
    "4fe0c01b1becbf5f096878d74de45c3a474435330abc1193b891e788421cb395";

pub trait TunnelProvider: Send + Sync {
    fn id(&self) -> &'static str;
    fn validate(&self, agent_path: &Path) -> AppResult<TunnelAgentValidation>;
    fn install_or_locate_agent(&self, requested: Option<&Path>) -> AppResult<PathBuf>;
    fn start(
        &self,
        local_host: &str,
        local_port: u16,
        agent_path: &Path,
    ) -> AppResult<ProviderSession>;
    fn get_status(&self, session: &mut ProviderSession) -> AppResult<ProviderSnapshot>;
    fn get_public_endpoint(&self, session: &ProviderSession) -> Option<String> {
        session.snapshot.public_endpoint.clone()
    }
    fn account_login_url(&self, _session: &ProviderSession) -> AppResult<String> {
        Err(AppError::Validation(
            "このエージェントではアカウント画面を開けません".into(),
        ))
    }
    fn stop(&self, session: &mut ProviderSession) -> AppResult<()>;
    fn revoke(&self, session: &mut ProviderSession) -> AppResult<()> {
        self.stop(session)
    }
}

pub struct ProviderSession {
    kind: ProviderSessionKind,
    agent_path: PathBuf,
    version: String,
    logs: Arc<Mutex<Vec<String>>>,
    owned_by_app: bool,
    local_port: u16,
    snapshot: ProviderSnapshot,
}

#[derive(Debug, Clone)]
pub struct ProviderSnapshot {
    state: String,
    message: String,
    public_endpoint: Option<String>,
    account_state: String,
    pending_tunnel_count: usize,
    notices: Vec<String>,
    matching_tunnel: bool,
    matching_tunnel_enabled: bool,
    tunnel_inventory_confirmed: bool,
}

impl ProviderSnapshot {
    fn basic(state: &str, message: impl Into<String>) -> Self {
        Self {
            state: state.into(),
            message: message.into(),
            public_endpoint: None,
            account_state: "unknown".into(),
            pending_tunnel_count: 0,
            notices: Vec::new(),
            matching_tunnel: false,
            matching_tunnel_enabled: false,
            tunnel_inventory_confirmed: false,
        }
    }
}

enum ProviderSessionKind {
    Service,
    Portable(Child),
}

pub struct PlayitProvider;

impl TunnelProvider for PlayitProvider {
    fn id(&self) -> &'static str {
        PROVIDER_ID
    }

    fn validate(&self, agent_path: &Path) -> AppResult<TunnelAgentValidation> {
        let path = agent_path.canonicalize().map_err(|_| {
            AppError::Validation("選択したplayit.ggエージェントが見つかりません".into())
        })?;
        if !path.is_file()
            || !path
                .extension()
                .is_some_and(|value| value.eq_ignore_ascii_case("exe"))
        {
            return Err(AppError::Validation(
                "Windows用の.exeファイルを選択してください".into(),
            ));
        }
        let metadata = std::fs::metadata(&path)?;
        if metadata.len() > 200 * 1024 * 1024 {
            return Err(AppError::Validation(
                "エージェントとしてはファイルサイズが大きすぎます".into(),
            ));
        }
        let sha256 = hash_file(&path)?;
        let version = read_agent_version(&path)?;
        let signer = verify_authenticode(&path)?;
        let (verification_method, message) = if is_official_signer(&signer) {
            (
                "Windows Authenticode（Developed Methods）",
                "公式署名とエージェントのバージョンを確認しました",
            )
        } else if is_known_official_msi_cli(&version, &sha256) {
            (
                "公式署名済みMSI v1.0.10由来の固定SHA-256",
                "公式MSI版CLIのバージョンと固定SHA-256を確認しました",
            )
        } else {
            return Err(AppError::Validation(format!(
                "公式署名または既知の公式MSI版SHA-256を確認できませんでした（署名者: {}）。playit.gg公式配布元から入手したエージェントを選択してください",
                if signer.is_empty() { "不明" } else { &signer }
            )));
        };
        Ok(TunnelAgentValidation {
            valid: true,
            provider_id: PROVIDER_ID.into(),
            agent_path: path.display().to_string(),
            version: Some(version),
            sha256,
            verification_method: verification_method.into(),
            message: message.into(),
        })
    }

    fn install_or_locate_agent(&self, requested: Option<&Path>) -> AppResult<PathBuf> {
        if let Some(path) = requested {
            return path.canonicalize().map_err(Into::into);
        }
        let mut candidates = Vec::new();
        if let Some(program_files) = std::env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join("playit_gg/bin/playit.exe"));
        }
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local_app_data.clone()).join("playit_gg/bin/playit.exe"));
            candidates.push(PathBuf::from(local_app_data).join("playit/playit.exe"));
        }
        if let Some(candidate) = candidates.into_iter().find(|candidate| candidate.is_file()) {
            return candidate.canonicalize().map_err(Into::into);
        }
        for name in ["playit.exe", "playit-cli.exe"] {
            let (success, stdout, _) =
                run_with_timeout(Path::new("where.exe"), &[name], Duration::from_secs(3))?;
            if success {
                if let Some(first) = stdout.lines().map(str::trim).find(|line| !line.is_empty()) {
                    return PathBuf::from(first).canonicalize().map_err(Into::into);
                }
            }
        }
        Err(AppError::Validation(
            "playit.ggエージェントが見つかりません。公式セットアップ後に実行ファイルを選択してください".into(),
        ))
    }

    fn start(
        &self,
        _local_host: &str,
        local_port: u16,
        agent_path: &Path,
    ) -> AppResult<ProviderSession> {
        let version = read_agent_version(agent_path)?;
        let logs = Arc::new(Mutex::new(Vec::new()));
        let major = version
            .split('.')
            .next()
            .and_then(|part| part.parse::<u16>().ok())
            .unwrap_or(1);
        if major >= 1 {
            let (already_running, status_out, status_err) =
                run_with_timeout(agent_path, &["status"], Duration::from_secs(8))?;
            let status_text = format!("{status_out}\n{status_err}");
            if already_running && status_reports_running(&status_text) {
                for line in status_text.lines() {
                    push_log(&logs, line);
                }
                let snapshot = read_playit_snapshot(local_port).unwrap_or_else(|_| {
                    ProviderSnapshot::basic(
                        "running",
                        "既に稼働している公式エージェントへ接続しました。状態を再確認しています",
                    )
                });
                return Ok(ProviderSession {
                    kind: ProviderSessionKind::Service,
                    agent_path: agent_path.to_path_buf(),
                    version,
                    logs,
                    owned_by_app: false,
                    local_port,
                    snapshot,
                });
            }
            let (success, stdout, stderr) =
                run_with_timeout(agent_path, &["start"], Duration::from_secs(20))?;
            for line in format!("{stdout}\n{stderr}").lines() {
                push_log(&logs, line);
            }
            if !success {
                let safe = redact_tunnel_log(&format!("{stdout} {stderr}"));
                return Err(AppError::Validation(format!(
                    "playit.ggエージェントを開始できませんでした。公式セットアップとログインを完了してから再試行してください: {safe}"
                )));
            }
            if !wait_for_service_running(agent_path, &logs, Duration::from_secs(20)) {
                return Err(AppError::Validation(
                    "playit.ggエージェントの起動を20秒以内に確認できませんでした。Windowsサービスを確認して再試行してください".into(),
                ));
            }
            let snapshot = read_playit_snapshot(local_port).unwrap_or_else(|_| {
                ProviderSnapshot::basic(
                    "running",
                    "エージェントを起動しました。公開接続先を確認しています",
                )
            });
            Ok(ProviderSession {
                kind: ProviderSessionKind::Service,
                agent_path: agent_path.to_path_buf(),
                version,
                logs,
                owned_by_app: true,
                local_port,
                snapshot,
            })
        } else {
            let mut child = Command::new(agent_path)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()?;
            if let Some(stdout) = child.stdout.take() {
                read_redacted_lines(stdout, logs.clone());
            }
            if let Some(stderr) = child.stderr.take() {
                read_redacted_lines(stderr, logs.clone());
            }
            Ok(ProviderSession {
                kind: ProviderSessionKind::Portable(child),
                agent_path: agent_path.to_path_buf(),
                version,
                logs,
                owned_by_app: true,
                local_port,
                snapshot: ProviderSnapshot::basic("starting", "エージェントを開始しました"),
            })
        }
    }

    fn get_status(&self, session: &mut ProviderSession) -> AppResult<ProviderSnapshot> {
        let snapshot = match &mut session.kind {
            ProviderSessionKind::Portable(child) => match child.try_wait()? {
                None => ProviderSnapshot::basic(
                    "running",
                    "旧形式のエージェントは稼働中ですが、公開接続先の自動取得には1.xが必要です",
                ),
                Some(status) => ProviderSnapshot::basic(
                    "error",
                    format!(
                        "エージェントが終了しました（終了コード: {:?}）",
                        status.code()
                    ),
                ),
            },
            ProviderSessionKind::Service => {
                let (success, stdout, stderr) =
                    run_with_timeout(&session.agent_path, &["status"], Duration::from_secs(8))?;
                let text = format!("{stdout}\n{stderr}");
                for line in text.lines() {
                    push_log(&session.logs, line);
                }
                if success && status_reports_running(&text) {
                    match read_playit_snapshot(session.local_port) {
                        Ok(snapshot) => snapshot,
                        Err(_) => ProviderSnapshot::basic(
                            "running",
                            "エージェントは稼働中ですが、公式ローカルIPCから状態を取得できませんでした。少し待って再確認してください",
                        ),
                    }
                } else {
                    ProviderSnapshot::basic("disconnected", "エージェントサービスは停止しています")
                }
            }
        };
        session.snapshot = snapshot.clone();
        Ok(snapshot)
    }

    fn account_login_url(&self, session: &ProviderSession) -> AppResult<String> {
        if !matches!(&session.kind, ProviderSessionKind::Service) {
            return Err(AppError::Validation(
                "アカウント画面の安全な取得にはplayitエージェント1.xが必要です".into(),
            ));
        }
        read_playit_login_url()
    }

    fn stop(&self, session: &mut ProviderSession) -> AppResult<()> {
        match &mut session.kind {
            ProviderSessionKind::Portable(child) => {
                if child.try_wait()?.is_none() {
                    child.kill()?;
                    child.wait()?;
                }
            }
            ProviderSessionKind::Service => {
                if session.owned_by_app {
                    let (success, stdout, stderr) =
                        run_with_timeout(&session.agent_path, &["stop"], Duration::from_secs(20))?;
                    for line in format!("{stdout}\n{stderr}").lines() {
                        push_log(&session.logs, line);
                    }
                    if !success {
                        return Err(AppError::Other(
                            "playit.ggエージェントを停止できませんでした".into(),
                        ));
                    }
                }
            }
        }
        Ok(())
    }
}

struct ActiveTunnel {
    palworld: bool,
    provider_id: String,
    local_port: u16,
    transport: String,
    session: ProviderSession,
    last_state: String,
    last_message: String,
    verified_public_endpoint: Option<String>,
}

pub struct TunnelManager {
    provider: Arc<dyn TunnelProvider>,
    sessions: Mutex<HashMap<String, ActiveTunnel>>,
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            provider: Arc::new(PlayitProvider),
            sessions: Mutex::new(HashMap::new()),
        }
    }

    #[cfg(test)]
    fn with_provider(provider: Arc<dyn TunnelProvider>) -> Self {
        Self {
            provider,
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn validate(
        &self,
        provider_id: &str,
        agent_path: &Path,
    ) -> AppResult<TunnelAgentValidation> {
        self.ensure_provider(provider_id)?;
        let located = self.provider.install_or_locate_agent(Some(agent_path))?;
        self.provider.validate(&located)
    }

    pub fn locate_and_validate(
        &self,
        provider_id: &str,
        requested: Option<&Path>,
    ) -> AppResult<TunnelAgentValidation> {
        self.ensure_provider(provider_id)?;
        let located = self.provider.install_or_locate_agent(requested)?;
        self.provider.validate(&located)
    }

    pub fn start(
        &self,
        server_id: &str,
        provider_id: &str,
        agent_path: &Path,
        local_port: u16,
    ) -> AppResult<TunnelStatus> {
        self.start_with_transport(server_id, provider_id, agent_path, local_port, "tcp")
    }

    pub fn start_with_transport(
        &self,
        server_id: &str,
        provider_id: &str,
        agent_path: &Path,
        local_port: u16,
        transport: &str,
    ) -> AppResult<TunnelStatus> {
        self.start_protocol(
            server_id,
            provider_id,
            agent_path,
            local_port,
            transport,
            false,
        )
    }

    /// Caller must first verify the selected Palworld process and its authenticated REST API.
    pub fn start_palworld(
        &self,
        server_id: &str,
        agent_path: &Path,
        local_port: u16,
    ) -> AppResult<TunnelStatus> {
        self.start_protocol(server_id, "playit", agent_path, local_port, "udp", true)
    }

    fn start_protocol(
        &self,
        server_id: &str,
        provider_id: &str,
        agent_path: &Path,
        local_port: u16,
        transport: &str,
        palworld: bool,
    ) -> AppResult<TunnelStatus> {
        self.ensure_provider(provider_id)?;
        validate_transport(transport)?;
        if !palworld && !local_port_listening_for(local_port, transport) {
            return Err(AppError::Validation(format!(
                "Minecraftのローカルポート {local_port} が待受状態ではありません"
            )));
        }
        let validation = self.validate(provider_id, agent_path)?;
        let mut sessions = self.sessions.lock().unwrap();
        if let Some((_, existing)) = sessions
            .iter()
            .find(|(id, existing)| id.as_str() != server_id && existing.local_port == local_port)
        {
            return Err(AppError::Validation(format!(
                "ローカルポート {local_port} は別の公開セッション（{}）が使用中です。playit公式IPCでは同じポートのTCPとUDPを区別できないため、公開時は異なるポートを指定してください",
                existing.transport.to_ascii_uppercase()
            )));
        }
        if sessions.contains_key(server_id) {
            drop(sessions);
            return self.status_with_transport(
                server_id,
                local_port,
                transport,
                Some(validation.agent_path),
            );
        }
        let session =
            self.provider
                .start(LOCAL_HOST, local_port, Path::new(&validation.agent_path))?;
        sessions.insert(
            server_id.to_string(),
            ActiveTunnel {
                palworld,
                provider_id: provider_id.into(),
                local_port,
                transport: transport.into(),
                session,
                last_state: "running".into(),
                last_message: "エージェントを開始しました。公開接続先を確認しています".into(),
                verified_public_endpoint: None,
            },
        );
        drop(sessions);
        self.status_with_transport(
            server_id,
            local_port,
            transport,
            Some(validation.agent_path),
        )
    }

    pub fn status(
        &self,
        server_id: &str,
        default_port: u16,
        configured_path: Option<String>,
    ) -> AppResult<TunnelStatus> {
        self.status_with_transport(server_id, default_port, "tcp", configured_path)
    }

    pub fn status_with_transport(
        &self,
        server_id: &str,
        default_port: u16,
        transport: &str,
        configured_path: Option<String>,
    ) -> AppResult<TunnelStatus> {
        validate_transport(transport)?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(active) = sessions.get_mut(server_id) {
            let snapshot = self.provider.get_status(&mut active.session)?;
            let endpoint = self.provider.get_public_endpoint(&active.session);
            if active.verified_public_endpoint.as_ref() != endpoint.as_ref() {
                active.verified_public_endpoint = None;
            }
            let (state, mut message) = if active.palworld {
                (if endpoint.is_some() && snapshot.matching_tunnel { "running".into() } else { snapshot.state.clone() }, "Palworld: public endpoint discovery does not verify an external game connection.".into())
            } else if endpoint.is_some() && snapshot.matching_tunnel && active.transport == "udp" {
                if active.verified_public_endpoint.as_ref() == endpoint.as_ref() {
                    (
                        "connected".into(),
                        "Bedrock UDPの公開接続先へRakNet応答を確認しました".into(),
                    )
                } else {
                    ("running".into(), "Bedrock UDPの公開接続先を取得しました。接続診断で外部RakNet応答を確認してください".into())
                }
            } else if endpoint.is_some() && snapshot.matching_tunnel {
                (
                    "connected".into(),
                    "Minecraft用の公開接続先を取得しました".into(),
                )
            } else {
                (snapshot.state.clone(), snapshot.message.clone())
            };
            if !active.palworld
                && active.transport == "udp"
                && !snapshot.matching_tunnel
                && message.contains("TCPトンネル")
            {
                message = "このMinecraftポート向けのトンネルがありません。公式画面でMinecraft Bedrock（UDP）トンネルを追加してください".into();
            }
            active.last_state = state.clone();
            active.last_message = message.clone();
            let logs = active
                .session
                .logs
                .lock()
                .unwrap()
                .iter()
                .rev()
                .take(12)
                .cloned()
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            return Ok(TunnelStatus {
                server_id: server_id.into(),
                provider_id: active.provider_id.clone(),
                state,
                local_host: LOCAL_HOST.into(),
                local_port: active.local_port,
                transport: active.transport.clone(),
                agent_path: Some(active.session.agent_path.display().to_string()),
                agent_version: Some(active.session.version.clone()),
                agent_verified: true,
                terms_acknowledged: false,
                public_endpoint: endpoint,
                account_state: snapshot.account_state,
                pending_tunnel_count: snapshot.pending_tunnel_count,
                provider_notices: snapshot.notices,
                matching_tunnel: snapshot.matching_tunnel,
                message,
                last_checked_at: Some(now),
                recent_logs: logs,
            });
        }
        Ok(TunnelStatus {
            server_id: server_id.into(),
            provider_id: PROVIDER_ID.into(),
            state: if configured_path.is_some() {
                "disconnected".into()
            } else {
                "unconfigured".into()
            },
            local_host: LOCAL_HOST.into(),
            local_port: default_port,
            transport: transport.into(),
            agent_path: configured_path,
            agent_version: None,
            agent_verified: false,
            terms_acknowledged: false,
            public_endpoint: None,
            account_state: "unknown".into(),
            pending_tunnel_count: 0,
            provider_notices: Vec::new(),
            matching_tunnel: false,
            message: "公式エージェントを選択して検証してください".into(),
            last_checked_at: Some(now),
            recent_logs: Vec::new(),
        })
    }

    pub fn stop(
        &self,
        server_id: &str,
        default_port: u16,
        configured_path: Option<String>,
    ) -> AppResult<TunnelStatus> {
        self.stop_with_transport(server_id, default_port, "tcp", configured_path)
    }

    pub fn stop_with_transport(
        &self,
        server_id: &str,
        default_port: u16,
        transport: &str,
        configured_path: Option<String>,
    ) -> AppResult<TunnelStatus> {
        let mut sessions = self.sessions.lock().unwrap();
        let Some(active) = sessions.get_mut(server_id) else {
            drop(sessions);
            let mut status =
                self.status_with_transport(server_id, default_port, transport, configured_path)?;
            status.state = "disconnected".into();
            status.message = "このアプリが開始した招待はありません".into();
            return Ok(status);
        };

        let snapshot = self.provider.get_status(&mut active.session)?;
        let is_service = matches!(&active.session.kind, ProviderSessionKind::Service);
        let service_owned_by_app = active.session.owned_by_app;
        let service_path = active.session.agent_path.clone();
        let tunnel_still_configured = !snapshot.tunnel_inventory_confirmed
            || snapshot.matching_tunnel_enabled
            || snapshot.public_endpoint.is_some();
        let provider_state = snapshot.state.clone();
        let _ = active;

        let other_service_session = is_service
            && sessions.iter().any(|(id, candidate)| {
                id != server_id
                    && matches!(&candidate.session.kind, ProviderSessionKind::Service)
                    && candidate.session.agent_path == service_path
            });

        if is_service && tunnel_still_configured && (!service_owned_by_app || other_service_session)
        {
            drop(sessions);
            let mut status =
                self.status_with_transport(server_id, default_port, transport, configured_path)?;
            status.state = match provider_state.as_str() {
                "disconnected" | "error" | "awaiting_login" | "stopping" => provider_state,
                _ if status.public_endpoint.is_some() => "connected".into(),
                _ => "running".into(),
            };
            status.message = if status.state == "disconnected" {
                "playitサービスは現在停止していますが、個別トンネル設定を確認できません。サービス再起動時の再公開を防ぐには、公式トンネル設定でこのMinecraftポートを無効化してください".into()
            } else if other_service_session {
                "他のサーバーも同じplayitサービスを使用中です。全体停止は行いません。公式トンネル設定でこのMinecraftポートだけを無効化し、もう一度『招待を停止』を押してください".into()
            } else {
                "playitサービスはアプリ外で開始されています。勝手に全体停止しません。公式トンネル設定でこのMinecraftポートを無効化し、もう一度『招待を停止』を押してください".into()
            };
            return Ok(status);
        }

        if let Some(active) = sessions.get_mut(server_id) {
            if !is_service || tunnel_still_configured {
                self.provider.revoke(&mut active.session)?;
            }
        }
        sessions.remove(server_id);
        drop(sessions);
        let mut status =
            self.status_with_transport(server_id, default_port, transport, configured_path)?;
        status.state = "disconnected".into();
        status.message = if is_service && !tunnel_still_configured {
            "このMinecraftポートのトンネルが無効であることを確認し、アプリの招待管理を終了しました。playitサービス自体は他の用途のため稼働を継続できます".into()
        } else {
            "このアプリが開始したplayitエージェントを停止し、招待を終了しました".into()
        };
        Ok(status)
    }

    pub fn open_account_login(&self, server_id: &str) -> AppResult<()> {
        let sessions = self.sessions.lock().unwrap();
        let active = sessions.get(server_id).ok_or_else(|| {
            AppError::Validation("先にplayit.ggエージェントを開始してください".into())
        })?;
        let url = self.provider.account_login_url(&active.session)?;
        open_official_url(&url)
    }

    pub fn probe_public_endpoint(&self, server_id: &str) -> AppResult<TunnelExternalProbe> {
        self.probe_public_endpoint_with_transport(server_id, "tcp")
    }

    pub fn probe_public_endpoint_with_transport(
        &self,
        server_id: &str,
        default_transport: &str,
    ) -> AppResult<TunnelExternalProbe> {
        validate_transport(default_transport)?;
        if self
            .sessions
            .lock()
            .unwrap()
            .get(server_id)
            .is_some_and(|session| session.palworld)
        {
            return Err(AppError::Validation("Palworld requires a real game connection; Minecraft RakNet probes cannot verify it.".into()));
        }
        let (endpoint, transport) = {
            let sessions = self.sessions.lock().unwrap();
            let active = sessions.get(server_id);
            (
                active.and_then(|active| self.provider.get_public_endpoint(&active.session)),
                active
                    .map(|active| active.transport.clone())
                    .unwrap_or_else(|| default_transport.into()),
            )
        };
        let checked_at = chrono::Utc::now().to_rfc3339();
        let Some(endpoint) = endpoint else {
            return Ok(TunnelExternalProbe {
                checked_at,
                attempted: false,
                reachable: false,
                endpoint: None,
                transport,
                scope: "host-network".into(),
                message: "公開接続先がまだ取得できていません".into(),
            });
        };
        let direct_target = endpoint_host_port(&endpoint);
        let resolved_via_srv = direct_target.is_none();
        let target = match direct_target {
            Some(target) => Some(target),
            None => resolve_minecraft_srv_endpoint(&endpoint)?,
        };
        let Some((host, port)) = target else {
            return Ok(TunnelExternalProbe {
                checked_at,
                attempted: false,
                reachable: false,
                endpoint: Some(endpoint),
                transport,
                scope: "host-network".into(),
                message: "Minecraft専用の接続先をDNSから確認できませんでした。少し待って再試行するか、別回線のMinecraftで確認してください".into(),
            });
        };
        let reachable = if transport == "udp" {
            crate::ping::ping_bedrock_endpoint(&host, port).is_some()
        } else {
            let addresses = (host.as_str(), port).to_socket_addrs().map_err(|_| {
                AppError::Validation("公開接続先のDNSを解決できませんでした".into())
            })?;
            addresses
                .into_iter()
                .take(4)
                .any(|address| TcpStream::connect_timeout(&address, Duration::from_secs(4)).is_ok())
        };
        if reachable && transport == "udp" {
            if let Some(active) = self.sessions.lock().unwrap().get_mut(server_id) {
                active.verified_public_endpoint = Some(endpoint.clone());
                active.last_state = "connected".into();
                active.last_message = "Bedrock UDPの公開接続先へRakNet応答を確認しました".into();
            }
        }
        Ok(TunnelExternalProbe {
            checked_at,
            attempted: true,
            reachable,
            endpoint: Some(endpoint),
            transport: transport.clone(),
            scope: "host-network".into(),
            message: if reachable && transport == "udp" {
                "このPCから公開エンドポイントへBedrock UDP/RakNetで応答を確認しました。別の家からの実参加は別回線で確認してください".into()
            } else if reachable {
                if resolved_via_srv {
                    "Minecraft用DNS（SRV）を解決し、このPCから公開エンドポイントへのTCP接続に成功しました。別の家からの実参加は別回線で確認してください".into()
                } else {
                    "このPCから公開エンドポイントへのTCP接続に成功しました。別の家からのMinecraft参加は別回線で確認してください".into()
                }
            } else {
                "このPCから公開エンドポイントへ接続できませんでした。エージェント状態、トンネル設定、外向き通信制限を確認してください".into()
            },
        })
    }

    pub fn is_active(&self, server_id: &str) -> bool {
        self.sessions.lock().unwrap().contains_key(server_id)
    }

    pub fn stop_owned_all(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        let mut stopped_services = std::collections::HashSet::new();
        for active in sessions.values_mut() {
            match &active.session.kind {
                ProviderSessionKind::Portable(_) => {
                    if active.session.owned_by_app {
                        let _ = self.provider.stop(&mut active.session);
                    }
                }
                ProviderSessionKind::Service => {
                    if active.session.owned_by_app
                        && stopped_services.insert(active.session.agent_path.clone())
                    {
                        let _ = self.provider.stop(&mut active.session);
                    }
                }
            }
        }
        sessions.clear();
    }

    fn ensure_provider(&self, provider_id: &str) -> AppResult<()> {
        if provider_id == self.provider.id() {
            Ok(())
        } else {
            Err(AppError::Validation(
                "未対応のトンネルプロバイダーです".into(),
            ))
        }
    }
}

impl Drop for TunnelManager {
    fn drop(&mut self) {
        self.stop_owned_all();
    }
}

pub fn local_port_listening(port: u16) -> bool {
    local_port_listening_for(port, "tcp")
}

pub fn local_port_listening_for(port: u16, transport: &str) -> bool {
    if transport == "udp" {
        return crate::ping::ping_bedrock_server(port).is_some();
    }
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    TcpStream::connect_timeout(&address, Duration::from_millis(700)).is_ok()
}

pub fn wait_for_local_port(port: u16, timeout: Duration) -> bool {
    wait_for_local_port_transport(port, "tcp", timeout)
}

pub fn wait_for_local_port_transport(port: u16, transport: &str, timeout: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if local_port_listening_for(port, transport) {
            return true;
        }
        thread::sleep(Duration::from_millis(500));
    }
    local_port_listening_for(port, transport)
}

fn validate_transport(value: &str) -> AppResult<()> {
    if matches!(value, "tcp" | "udp") {
        Ok(())
    } else {
        Err(AppError::Validation(
            "トンネル通信方式はTCPまたはUDPに限られます".into(),
        ))
    }
}

fn read_playit_snapshot(local_port: u16) -> AppResult<ProviderSnapshot> {
    run_ipc(async move {
        let mut client = IpcClient::connect().await.map_err(ipc_error)?;
        let response = client.subscribe().await.map_err(ipc_error)?;
        Ok(snapshot_from_lifecycle(
            response.snapshot.lifecycle,
            local_port,
        ))
    })
}

fn read_playit_login_url() -> AppResult<String> {
    let url = run_ipc(async move {
        let mut client = IpcClient::connect().await.map_err(ipc_error)?;
        let response = client.get_account_login_url().await.map_err(ipc_error)?;
        Ok(response.login_url)
    })?;
    if is_official_playit_url(&url) {
        Ok(url)
    } else {
        Err(AppError::Validation(
            "エージェントが返したログイン先がplayit.gg公式URLではないため開きませんでした".into(),
        ))
    }
}

fn run_ipc<T>(
    future: impl std::future::Future<Output = AppResult<T>> + Send + 'static,
) -> AppResult<T>
where
    T: Send + 'static,
{
    // Tunnel status is also queried from async Tauri commands such as
    // `stop_server`. Starting and blocking a second Tokio runtime on a thread
    // which is already driving Tokio panics ("Cannot start a runtime from
    // within a runtime"). Run the short-lived IPC runtime on its own OS thread
    // so this synchronous adapter is safe from both sync and async callers.
    thread::Builder::new()
        .name("playit-ipc".into())
        .spawn(move || {
            let runtime = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|error| AppError::Other(error.to_string()))?;
            runtime.block_on(async {
                tokio::time::timeout(Duration::from_secs(6), future)
                    .await
                    .map_err(|_| {
                        AppError::Other("playit.ggローカルIPCの応答がタイムアウトしました".into())
                    })?
            })
        })
        .map_err(|error| AppError::Other(format!("playit.ggローカルIPCを開始できません: {error}")))?
        .join()
        .map_err(|_| AppError::Other("playit.ggローカルIPC処理が異常終了しました".into()))?
}

fn ipc_error(error: impl std::fmt::Display) -> AppError {
    let _ = error;
    AppError::Other("playit.ggローカルIPCへ接続できませんでした".into())
}

fn snapshot_from_lifecycle(lifecycle: AgentLifecycle, local_port: u16) -> ProviderSnapshot {
    match lifecycle {
        AgentLifecycle::WaitingForSecret => ProviderSnapshot {
            state: "awaiting_login".into(),
            message: "公式セットアップまたはログインが必要です".into(),
            public_endpoint: None,
            account_state: "not_configured".into(),
            pending_tunnel_count: 0,
            notices: Vec::new(),
            matching_tunnel: false,
            matching_tunnel_enabled: false,
            tunnel_inventory_confirmed: false,
        },
        AgentLifecycle::HasInvalidSecret(_) => ProviderSnapshot {
            state: "awaiting_login".into(),
            message: "playit.ggの認証が無効です。公式画面から再設定してください".into(),
            public_endpoint: None,
            account_state: "invalid".into(),
            pending_tunnel_count: 0,
            notices: Vec::new(),
            matching_tunnel: false,
            matching_tunnel_enabled: false,
            tunnel_inventory_confirmed: false,
        },
        AgentLifecycle::DisabledOverLimit(_) => ProviderSnapshot::basic(
            "error",
            "プロバイダーの利用上限によりエージェントが停止しています。公式アカウント画面で制限を確認してください",
        ),
        AgentLifecycle::Starting => {
            ProviderSnapshot::basic("starting", "エージェントがプロバイダーへ接続しています")
        }
        AgentLifecycle::Stopping => {
            ProviderSnapshot::basic("stopping", "エージェントを停止しています")
        }
        AgentLifecycle::Error(_) => ProviderSnapshot::basic(
            "error",
            "playit.ggエージェントでエラーが発生しました。公式アプリの状態を確認してください",
        ),
        AgentLifecycle::Running(state) => snapshot_from_running_state(state, local_port),
    }
}

fn snapshot_from_running_state(state: AgentState, local_port: u16) -> ProviderSnapshot {
    let account_state = match state.account_status {
        AccountStatus::Unknown => "unknown",
        AccountStatus::Guest => "guest",
        AccountStatus::EmailNotVerified => "email_not_verified",
        AccountStatus::Verified => "verified",
    }
    .to_string();
    let notices = state
        .notices
        .into_iter()
        .take(3)
        .map(|notice| truncate_message(&redact_tunnel_log(&notice.message), 240))
        .filter(|message| !message.trim().is_empty())
        .collect::<Vec<_>>();
    let pending_tunnel_count = state.pending_tunnels.len();
    let matching = state
        .tunnels
        .into_iter()
        .filter(|tunnel| destination_matches(&tunnel.destination, local_port))
        .collect::<Vec<_>>();
    if matching.len() > 1 {
        let matching_tunnel_enabled = matching.iter().any(|tunnel| !tunnel.is_disabled);
        return ProviderSnapshot {
            state: "error".into(),
            message: "同じMinecraftポートを向くトンネルが複数あり、公式IPCではTCPとUDPを区別できません。不要なトンネルを公式設定で無効化するか、別のローカルポートを使用してください".into(),
            public_endpoint: None,
            account_state,
            pending_tunnel_count,
            notices,
            matching_tunnel: true,
            matching_tunnel_enabled,
            tunnel_inventory_confirmed: true,
        };
    }
    if let Some(tunnel) = matching.into_iter().next() {
        if tunnel.is_disabled {
            return ProviderSnapshot {
                state: "error".into(),
                message: tunnel
                    .disabled_reason
                    .map(|reason| truncate_message(&redact_tunnel_log(&reason), 240))
                    .filter(|reason| !reason.is_empty())
                    .unwrap_or_else(|| "Minecraft用トンネルがプロバイダー側で無効です".into()),
                public_endpoint: None,
                account_state,
                pending_tunnel_count,
                notices,
                matching_tunnel: true,
                matching_tunnel_enabled: false,
                tunnel_inventory_confirmed: true,
            };
        }
        if let Some(endpoint) = normalize_public_endpoint(&tunnel.display_address) {
            return ProviderSnapshot {
                state: "connected".into(),
                message: "Minecraft用の公開接続先を取得しました".into(),
                public_endpoint: Some(endpoint),
                account_state,
                pending_tunnel_count,
                notices,
                matching_tunnel: true,
                matching_tunnel_enabled: true,
                tunnel_inventory_confirmed: true,
            };
        }
        return ProviderSnapshot {
            state: "error".into(),
            message: "公開接続先の形式を安全に確認できなかったため表示しません".into(),
            public_endpoint: None,
            account_state,
            pending_tunnel_count,
            notices,
            matching_tunnel: true,
            matching_tunnel_enabled: true,
            tunnel_inventory_confirmed: true,
        };
    }
    ProviderSnapshot {
        state: if pending_tunnel_count > 0 {
            "starting"
        } else {
            "running"
        }
        .into(),
        message: if pending_tunnel_count > 0 {
            "トンネル設定を反映中です。少し待って再確認してください"
        } else {
            "このMinecraftポート向けのトンネルがありません。公式画面でTCPトンネルを追加してください"
        }
        .into(),
        public_endpoint: None,
        account_state,
        pending_tunnel_count,
        notices,
        matching_tunnel: false,
        matching_tunnel_enabled: false,
        tunnel_inventory_confirmed: true,
    }
}

fn destination_matches(destination: &str, local_port: u16) -> bool {
    let value = destination.trim();
    if value.eq_ignore_ascii_case(&format!("localhost:{local_port}")) {
        return true;
    }
    value
        .parse::<SocketAddr>()
        .is_ok_and(|address| address.ip().is_loopback() && address.port() == local_port)
}

fn normalize_public_endpoint(value: &str) -> Option<String> {
    let value = value.trim().trim_end_matches('.');
    if value.is_empty()
        || value.len() > 300
        || value.chars().any(char::is_whitespace)
        || value
            .chars()
            .any(|character| matches!(character, '/' | '\\' | '@' | '?' | '#'))
    {
        return None;
    }
    if let Ok(address) = value.parse::<SocketAddr>() {
        return is_public_ip(address.ip()).then(|| address.to_string());
    }
    if let Some((host, port)) = endpoint_host_port(value) {
        return valid_public_host(&host).then(|| format!("{host}:{port}"));
    }
    valid_public_host(value).then(|| value.to_ascii_lowercase())
}

fn endpoint_host_port(value: &str) -> Option<(String, u16)> {
    let (host, port) = value.rsplit_once(':')?;
    if host.is_empty() || host.contains(':') {
        return None;
    }
    let port = port.parse::<u16>().ok().filter(|port| *port != 0)?;
    Some((host.to_ascii_lowercase(), port))
}

fn resolve_minecraft_srv_endpoint(host: &str) -> AppResult<Option<(String, u16)>> {
    if !valid_public_host(host) {
        return Ok(None);
    }
    let query = format!("_minecraft._tcp.{host}");
    let (success, stdout, stderr) = run_with_timeout(
        Path::new("nslookup.exe"),
        &["-type=SRV", &query],
        Duration::from_secs(8),
    )?;
    if !success {
        return Ok(None);
    }
    Ok(parse_minecraft_srv_output(&format!("{stdout}\n{stderr}")))
}

fn parse_minecraft_srv_output(value: &str) -> Option<(String, u16)> {
    static PORT: OnceLock<Regex> = OnceLock::new();
    static HOST: OnceLock<Regex> = OnceLock::new();
    static COMPACT: OnceLock<Regex> = OnceLock::new();
    let port = PORT
        .get_or_init(|| Regex::new(r"(?im)^\s*port\s*=\s*(\d+)\s*$").unwrap())
        .captures(value)
        .and_then(|capture| capture.get(1))
        .and_then(|value| value.as_str().parse::<u16>().ok())
        .filter(|port| *port != 0);
    let host = HOST
        .get_or_init(|| {
            Regex::new(r"(?im)^\s*(?:svr\s+hostname|target)\s*=\s*([a-z0-9.-]+)\.?\s*$").unwrap()
        })
        .captures(value)
        .and_then(|capture| capture.get(1))
        .map(|value| value.as_str().trim_end_matches('.').to_ascii_lowercase());
    if let (Some(host), Some(port)) = (host, port) {
        return valid_public_host(&host).then_some((host, port));
    }
    let compact = COMPACT
        .get_or_init(|| {
            Regex::new(r"(?im)(?:service\s*=|srv)\s+\d+\s+\d+\s+(\d+)\s+([a-z0-9.-]+)\.?").unwrap()
        })
        .captures(value)?;
    let port = compact
        .get(1)?
        .as_str()
        .parse::<u16>()
        .ok()
        .filter(|port| *port != 0)?;
    let host = compact
        .get(2)?
        .as_str()
        .trim_end_matches('.')
        .to_ascii_lowercase();
    valid_public_host(&host).then_some((host, port))
}

fn valid_public_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") || host.len() > 253 {
        return false;
    }
    if let Ok(ip) = host.parse::<IpAddr>() {
        return is_public_ip(ip);
    }
    host.split('.').count() >= 2
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || character == '-')
        })
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            !ip.is_loopback() && !ip.is_private() && !ip.is_link_local() && !ip.is_unspecified()
        }
        IpAddr::V6(ip) => !ip.is_loopback() && !ip.is_unspecified() && !ip.is_unique_local(),
    }
}

fn truncate_message(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn is_official_playit_url(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    (lower.starts_with("https://playit.gg/") || lower == "https://playit.gg")
        && !value.chars().any(char::is_whitespace)
}

pub fn open_tunnel_dashboard() -> AppResult<()> {
    open_official_url("https://playit.gg/account/tunnels")
}

#[cfg(windows)]
fn open_official_url(url: &str) -> AppResult<()> {
    if !is_official_playit_url(url) {
        return Err(AppError::Validation(
            "playit.gg公式URLだけを開けます".into(),
        ));
    }
    Command::new("explorer.exe")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    Ok(())
}

#[cfg(not(windows))]
fn open_official_url(_url: &str) -> AppResult<()> {
    Err(AppError::Validation("この機能はWindows専用です".into()))
}

fn read_agent_version(path: &Path) -> AppResult<String> {
    for args in [["version"].as_slice(), ["--version"].as_slice()] {
        let (success, stdout, stderr) = run_with_timeout(path, args, Duration::from_secs(8))?;
        if success {
            let text = format!("{stdout} {stderr}");
            if let Some(version) = extract_version(&text) {
                return Ok(version);
            }
        }
    }
    Err(AppError::Validation(
        "playit.ggエージェントのバージョンを確認できませんでした".into(),
    ))
}

fn extract_version(text: &str) -> Option<String> {
    static VERSION: OnceLock<Regex> = OnceLock::new();
    VERSION
        .get_or_init(|| Regex::new(r"(?i)(?:playit(?:-cli)?\s*)?v?(\d+\.\d+(?:\.\d+)?)").unwrap())
        .captures(text)
        .and_then(|capture| capture.get(1))
        .map(|value| value.as_str().to_string())
}

pub(crate) fn hash_file(path: &Path) -> AppResult<String> {
    let mut file = std::fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(hex::encode(digest.finalize()))
}

#[cfg(windows)]
pub(crate) fn verify_authenticode(path: &Path) -> AppResult<String> {
    let script = "Import-Module (Join-Path $PSHOME 'Modules\\Microsoft.PowerShell.Security\\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop;$p=[Environment]::GetEnvironmentVariable('MSH_PLAYIT_AGENT_PATH');$s=Get-AuthenticodeSignature -LiteralPath $p;if(([string]$s.Status -eq 'Valid') -and ([string]$s.SignerCertificate.Subject -match '^CN=Developed Methods LLC(?:,|$)')){exit 0};exit 1";
    let powershell = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .map(|root| {
            root.join("System32")
                .join("WindowsPowerShell")
                .join("v1.0")
                .join("powershell.exe")
        })
        .filter(|candidate| candidate.is_file())
        .unwrap_or_else(|| PathBuf::from("powershell.exe"));
    let mut command = Command::new(powershell);
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
        ])
        .env("MSH_PLAYIT_AGENT_PATH", path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let (success, _, _) = run_spawned_with_timeout(command, Duration::from_secs(12))?;
    Ok(if success {
        "CN=Developed Methods LLC".into()
    } else {
        String::new()
    })
}

#[cfg(not(windows))]
pub(crate) fn verify_authenticode(_path: &Path) -> AppResult<String> {
    Ok(String::new())
}

pub(crate) fn is_official_signer(subject: &str) -> bool {
    let subject = subject.to_ascii_lowercase();
    subject.contains("developed methods") || subject.contains("playit.gg")
}

fn is_known_official_msi_cli(version: &str, sha256: &str) -> bool {
    version == "1.0.10" && sha256.eq_ignore_ascii_case(PLAYIT_MSI_CLI_V1_0_10_SHA256)
}

fn status_reports_running(status: &str) -> bool {
    let status = status.to_ascii_lowercase();
    if status.contains("not running") || status.contains("service stopped") {
        return false;
    }
    status.lines().any(|line| {
        let line = line.trim();
        line.starts_with("phase:") || line == "the playit service is running."
    })
}

fn wait_for_service_running(
    agent_path: &Path,
    logs: &Arc<Mutex<Vec<String>>>,
    timeout: Duration,
) -> bool {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if let Ok((success, stdout, stderr)) =
            run_with_timeout(agent_path, &["status"], Duration::from_secs(5))
        {
            let text = format!("{stdout}\n{stderr}");
            for line in text.lines() {
                push_log(logs, line);
            }
            if success && status_reports_running(&text) {
                return true;
            }
        }
        thread::sleep(Duration::from_millis(500));
    }
    false
}

fn run_with_timeout(
    path: &Path,
    args: &[&str],
    timeout: Duration,
) -> AppResult<(bool, String, String)> {
    let mut command = Command::new(path);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    run_spawned_with_timeout(command, timeout)
}

fn run_spawned_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> AppResult<(bool, String, String)> {
    let mut child = command.spawn()?;
    let started = Instant::now();
    loop {
        if child.try_wait()?.is_some() {
            let output = child.wait_with_output()?;
            return Ok((
                output.status.success(),
                String::from_utf8_lossy(&output.stdout).into_owned(),
                String::from_utf8_lossy(&output.stderr).into_owned(),
            ));
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(AppError::Other(
                "外部エージェントの応答がタイムアウトしました".into(),
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
}

fn read_redacted_lines(reader: impl Read + Send + 'static, logs: Arc<Mutex<Vec<String>>>) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            push_log(&logs, &line);
        }
    });
}

fn push_log(logs: &Arc<Mutex<Vec<String>>>, line: &str) {
    let safe = redact_tunnel_log(line);
    if safe.trim().is_empty() {
        return;
    }
    let mut values = logs.lock().unwrap();
    values.push(safe);
    let excess = values.len().saturating_sub(100);
    if excess > 0 {
        values.drain(..excess);
    }
}

pub fn redact_tunnel_log(value: &str) -> String {
    static URL: OnceLock<Regex> = OnceLock::new();
    static IPV4: OnceLock<Regex> = OnceLock::new();
    static ENDPOINT: OnceLock<Regex> = OnceLock::new();
    static SECRET: OnceLock<Regex> = OnceLock::new();
    let value = URL
        .get_or_init(|| Regex::new(r"https?://[^\s]+").unwrap())
        .replace_all(value, "[URL]");
    let value = ENDPOINT
        .get_or_init(|| {
            Regex::new(r"(?i)\b[a-z0-9.-]+\.(?:playit\.gg|ply\.gg)(?::\d+)?\b").unwrap()
        })
        .replace_all(&value, "[PUBLIC_ENDPOINT]");
    let value = IPV4
        .get_or_init(|| Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b").unwrap())
        .replace_all(&value, "[IP]");
    SECRET
        .get_or_init(|| {
            Regex::new(r"(?i)\b(token|secret|claim|api[_-]?key|password)\s*[:=]\s*[^\s]+").unwrap()
        })
        .replace_all(&value, "$1=[REDACTED]")
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipc_adapter_is_safe_inside_an_existing_tokio_runtime() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let value = runtime
            .block_on(async { run_ipc(async { Ok(42_u8) }) })
            .unwrap();
        assert_eq!(value, 42);
    }

    struct MockProvider;
    impl TunnelProvider for MockProvider {
        fn id(&self) -> &'static str {
            "playit"
        }
        fn validate(&self, path: &Path) -> AppResult<TunnelAgentValidation> {
            Ok(TunnelAgentValidation {
                valid: true,
                provider_id: "playit".into(),
                agent_path: path.display().to_string(),
                version: Some("1.0.0".into()),
                sha256: "mock".into(),
                verification_method: "mock".into(),
                message: "ok".into(),
            })
        }
        fn install_or_locate_agent(&self, requested: Option<&Path>) -> AppResult<PathBuf> {
            Ok(requested
                .unwrap_or_else(|| Path::new("mock.exe"))
                .to_path_buf())
        }
        fn start(&self, _: &str, _: u16, path: &Path) -> AppResult<ProviderSession> {
            Ok(ProviderSession {
                kind: ProviderSessionKind::Service,
                agent_path: path.into(),
                version: "1.0.0".into(),
                logs: Arc::new(Mutex::new(vec![])),
                owned_by_app: true,
                local_port: 25565,
                snapshot: ProviderSnapshot::basic("starting", "mock starting"),
            })
        }
        fn get_status(&self, session: &mut ProviderSession) -> AppResult<ProviderSnapshot> {
            let snapshot = run_ipc(async {
                let mut snapshot = ProviderSnapshot::basic("running", "mock running");
                snapshot.tunnel_inventory_confirmed = true;
                Ok(snapshot)
            })?;
            session.snapshot = snapshot.clone();
            Ok(snapshot)
        }
        fn stop(&self, _: &mut ProviderSession) -> AppResult<()> {
            Ok(())
        }
    }

    struct ExistingServiceProvider {
        state: &'static str,
        public_endpoint: Option<&'static str>,
        matching_tunnel: bool,
        matching_tunnel_enabled: bool,
        tunnel_inventory_confirmed: bool,
    }
    impl TunnelProvider for ExistingServiceProvider {
        fn id(&self) -> &'static str {
            "playit"
        }
        fn validate(&self, path: &Path) -> AppResult<TunnelAgentValidation> {
            Ok(TunnelAgentValidation {
                valid: true,
                provider_id: "playit".into(),
                agent_path: path.display().to_string(),
                version: Some("1.0.10".into()),
                sha256: "mock".into(),
                verification_method: "mock".into(),
                message: "ok".into(),
            })
        }
        fn install_or_locate_agent(&self, requested: Option<&Path>) -> AppResult<PathBuf> {
            Ok(requested
                .unwrap_or_else(|| Path::new("mock.exe"))
                .to_path_buf())
        }
        fn start(&self, _: &str, local_port: u16, path: &Path) -> AppResult<ProviderSession> {
            Ok(ProviderSession {
                kind: ProviderSessionKind::Service,
                agent_path: path.into(),
                version: "1.0.10".into(),
                logs: Arc::new(Mutex::new(vec![])),
                owned_by_app: false,
                local_port,
                snapshot: self.snapshot(),
            })
        }
        fn get_status(&self, session: &mut ProviderSession) -> AppResult<ProviderSnapshot> {
            let snapshot = self.snapshot();
            session.snapshot = snapshot.clone();
            Ok(snapshot)
        }
        fn stop(&self, _: &mut ProviderSession) -> AppResult<()> {
            panic!("an externally managed shared service must not be stopped")
        }
    }

    impl ExistingServiceProvider {
        fn active() -> Self {
            Self {
                state: "connected",
                public_endpoint: Some("minecraft.example.net:19132"),
                matching_tunnel: true,
                matching_tunnel_enabled: true,
                tunnel_inventory_confirmed: true,
            }
        }

        fn disabled() -> Self {
            Self {
                state: "error",
                public_endpoint: None,
                matching_tunnel: true,
                matching_tunnel_enabled: false,
                tunnel_inventory_confirmed: true,
            }
        }

        fn disconnected_with_unknown_inventory() -> Self {
            Self {
                state: "disconnected",
                public_endpoint: None,
                matching_tunnel: false,
                matching_tunnel_enabled: false,
                tunnel_inventory_confirmed: false,
            }
        }

        fn snapshot(&self) -> ProviderSnapshot {
            ProviderSnapshot {
                state: self.state.into(),
                message: format!("mock {}", self.state),
                public_endpoint: self.public_endpoint.map(Into::into),
                account_state: "verified".into(),
                pending_tunnel_count: 0,
                notices: Vec::new(),
                matching_tunnel: self.matching_tunnel,
                matching_tunnel_enabled: self.matching_tunnel_enabled,
                tunnel_inventory_confirmed: self.tunnel_inventory_confirmed,
            }
        }
    }

    #[test]
    fn redacts_secrets_addresses_and_claim_urls() {
        let safe = redact_tunnel_log(
            "token=abc https://playit.gg/claim/secret 203.0.113.5:25565 demo.playit.gg:1234 private.tun.ply.gg",
        );
        assert!(!safe.contains("abc"));
        assert!(!safe.contains("203.0.113.5"));
        assert!(!safe.contains("demo.playit.gg"));
        assert!(!safe.contains("private.tun.ply.gg"));
        assert!(!safe.contains("/claim/"));
    }

    #[test]
    fn accepts_only_official_signer_names() {
        assert!(is_official_signer("CN=Developed Methods LLC"));
        assert!(!is_official_signer("CN=Unknown Publisher"));
    }

    #[test]
    fn accepts_only_the_pinned_official_msi_cli_hash() {
        assert!(is_known_official_msi_cli(
            "1.0.10",
            "4FE0C01B1BECBF5F096878D74DE45C3A474435330ABC1193B891E788421CB395"
        ));
        assert!(!is_known_official_msi_cli(
            "1.0.11",
            PLAYIT_MSI_CLI_V1_0_10_SHA256
        ));
        assert!(!is_known_official_msi_cli("1.0.10", "tampered"));
    }

    #[test]
    fn distinguishes_a_stopped_service_from_a_running_phase() {
        assert!(!status_reports_running(
            "The playit service is not running."
        ));
        assert!(status_reports_running(
            "playit service status:\n  Phase: running\n  Version: 1.0.10"
        ));
        assert!(status_reports_running(
            "playit service status:\n  Phase: waiting for secret"
        ));
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "公式署名済みMSIからインストールした実エージェントを確認する明示実行用テスト"]
    fn validates_the_installed_official_msi_cli() {
        let validation = PlayitProvider
            .validate(Path::new(r"C:\Program Files\playit_gg\bin\playit.exe"))
            .unwrap();
        assert!(validation.valid);
        assert_eq!(validation.version.as_deref(), Some("1.0.10"));
        assert_eq!(validation.sha256, PLAYIT_MSI_CLI_V1_0_10_SHA256);
        assert!(validation.verification_method.contains("固定SHA-256"));
    }

    #[test]
    fn parses_supported_version_output() {
        assert_eq!(extract_version("playit-cli 1.0.4"), Some("1.0.4".into()));
        assert_eq!(extract_version("playit v0.17.1"), Some("0.17.1".into()));
    }

    #[test]
    fn parses_windows_minecraft_srv_output() {
        let output = r#"
_minecraft._tcp.example.net SRV service location:
          priority       = 0
          weight         = 5
          port           = 25565
          svr hostname   = edge.ply.gg
"#;
        assert_eq!(
            parse_minecraft_srv_output(output),
            Some(("edge.ply.gg".into(), 25565))
        );
        assert!(parse_minecraft_srv_output("port = 0\nsvr hostname = localhost").is_none());
    }

    #[test]
    fn locates_and_validates_an_agent_without_manual_file_selection() {
        let manager = TunnelManager::with_provider(Arc::new(MockProvider));
        let validation = manager.locate_and_validate("playit", None).unwrap();
        assert!(validation.valid);
        assert_eq!(validation.agent_path, "mock.exe");
    }

    #[test]
    fn matches_only_the_requested_loopback_minecraft_destination() {
        assert!(destination_matches("127.0.0.1:25565", 25565));
        assert!(destination_matches("localhost:25565", 25565));
        assert!(!destination_matches("127.0.0.1:25575", 25565));
        assert!(!destination_matches("0.0.0.0:25565", 25565));
        assert!(!destination_matches("192.168.1.20:25565", 25565));
    }

    #[test]
    fn accepts_public_endpoints_but_rejects_urls_and_private_targets() {
        assert_eq!(
            normalize_public_endpoint("demo.playit.gg:12345"),
            Some("demo.playit.gg:12345".into())
        );
        assert_eq!(
            normalize_public_endpoint("mc.example.net"),
            Some("mc.example.net".into())
        );
        assert!(normalize_public_endpoint("https://playit.gg/claim/secret").is_none());
        assert!(normalize_public_endpoint("127.0.0.1:25565").is_none());
        assert!(normalize_public_endpoint("192.168.1.20:25565").is_none());
    }

    #[test]
    fn exposes_only_the_tunnel_that_matches_the_requested_minecraft_port() {
        let state = AgentState {
            version: "1.0.10".into(),
            tunnels: vec![
                playit_ipc::model::TunnelState {
                    display_address: "other-service.playit.gg:25575".into(),
                    destination: "127.0.0.1:25575".into(),
                    is_disabled: false,
                    disabled_reason: None,
                },
                playit_ipc::model::TunnelState {
                    display_address: "minecraft.playit.gg:25565".into(),
                    destination: "127.0.0.1:25565".into(),
                    is_disabled: false,
                    disabled_reason: None,
                },
            ],
            pending_tunnels: Vec::new(),
            notices: Vec::new(),
            account_status: AccountStatus::Verified,
            agent_id: "not-exposed".into(),
            login_link: Some("https://playit.gg/secret-link".into()),
            start_time: 0,
        };
        let snapshot = snapshot_from_running_state(state, 25565);
        assert_eq!(snapshot.state, "connected");
        assert_eq!(
            snapshot.public_endpoint.as_deref(),
            Some("minecraft.playit.gg:25565")
        );
        assert!(snapshot.matching_tunnel);
        assert!(!snapshot.message.contains("secret-link"));
        assert!(!snapshot.message.contains("not-exposed"));
    }

    #[test]
    fn never_exposes_an_endpoint_for_a_different_local_port() {
        let state = AgentState {
            version: "1.0.10".into(),
            tunnels: vec![playit_ipc::model::TunnelState {
                display_address: "other-service.playit.gg:25575".into(),
                destination: "127.0.0.1:25575".into(),
                is_disabled: false,
                disabled_reason: None,
            }],
            pending_tunnels: Vec::new(),
            notices: Vec::new(),
            account_status: AccountStatus::Verified,
            agent_id: String::new(),
            login_link: None,
            start_time: 0,
        };
        let snapshot = snapshot_from_running_state(state, 25565);
        assert!(snapshot.public_endpoint.is_none());
        assert!(!snapshot.matching_tunnel);
    }

    #[test]
    fn refuses_to_choose_between_duplicate_tunnels_for_the_same_local_port() {
        let state = AgentState {
            version: "1.0.10".into(),
            tunnels: vec![
                playit_ipc::model::TunnelState {
                    display_address: "java.playit.gg:25565".into(),
                    destination: "127.0.0.1:25565".into(),
                    is_disabled: false,
                    disabled_reason: None,
                },
                playit_ipc::model::TunnelState {
                    display_address: "bedrock.playit.gg:19132".into(),
                    destination: "127.0.0.1:25565".into(),
                    is_disabled: false,
                    disabled_reason: None,
                },
            ],
            pending_tunnels: Vec::new(),
            notices: Vec::new(),
            account_status: AccountStatus::Verified,
            agent_id: String::new(),
            login_link: None,
            start_time: 0,
        };
        let snapshot = snapshot_from_running_state(state, 25565);
        assert_eq!(snapshot.state, "error");
        assert!(snapshot.public_endpoint.is_none());
        assert!(snapshot.matching_tunnel);
        assert!(snapshot.matching_tunnel_enabled);
        assert!(snapshot.tunnel_inventory_confirmed);
        assert!(snapshot.message.contains("TCPとUDPを区別できません"));
    }

    #[test]
    fn inactive_mock_status_never_claims_connected_or_endpoint() {
        let manager = TunnelManager::with_provider(Arc::new(MockProvider));
        let status = manager
            .status("server", 25565, Some("mock.exe".into()))
            .unwrap();
        assert_eq!(status.state, "disconnected");
        assert!(status.recent_logs.is_empty());
        assert!(!manager.is_active("server"));
    }

    #[test]
    fn mock_provider_transitions_from_running_to_disconnected() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let manager = TunnelManager::with_provider(Arc::new(MockProvider));
        let running = manager
            .start("server", "playit", Path::new("mock.exe"), port)
            .unwrap();
        assert_eq!(running.state, "running");
        assert!(manager.is_active("server"));
        assert!(!running.message.contains("接続済み"));
        let stopped = manager
            .stop("server", port, Some("mock.exe".into()))
            .unwrap();
        assert_eq!(stopped.state, "disconnected");
        assert!(!manager.is_active("server"));
        drop(listener);
    }

    #[test]
    fn palworld_udp_invite_starts_after_rest_validation_without_a_raknet_probe() {
        let manager = TunnelManager::with_provider(Arc::new(MockProvider));
        let port = std::net::UdpSocket::bind((Ipv4Addr::LOCALHOST, 0))
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let status = manager
            .start_palworld("palworld", Path::new("mock.exe"), port)
            .unwrap();
        assert_eq!(status.transport, "udp");
        assert_eq!(status.state, "running");
        assert!(status.message.contains("Palworld"));
        manager
            .stop_with_transport("palworld", port, "udp", Some("mock.exe".into()))
            .unwrap();
    }

    #[test]
    fn refuses_to_claim_an_existing_shared_service_tunnel_was_revoked() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let manager = TunnelManager::with_provider(Arc::new(ExistingServiceProvider::active()));
        let running = manager
            .start("server", "playit", Path::new("mock.exe"), port)
            .unwrap();
        assert_eq!(running.state, "connected");
        let result = manager
            .stop("server", port, Some("mock.exe".into()))
            .unwrap();
        assert_eq!(result.state, "connected");
        assert!(result.message.contains("公式トンネル設定"));
        assert!(manager.is_active("server"));
        drop(listener);
    }

    #[test]
    fn detaches_after_an_existing_service_tunnel_is_confirmed_disabled() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let manager = TunnelManager::with_provider(Arc::new(ExistingServiceProvider::disabled()));
        let running = manager
            .start("server", "playit", Path::new("mock.exe"), port)
            .unwrap();
        assert_eq!(running.state, "error");
        let stopped = manager
            .stop("server", port, Some("mock.exe".into()))
            .unwrap();
        assert_eq!(stopped.state, "disconnected");
        assert!(stopped.message.contains("トンネルが無効"));
        assert!(!manager.is_active("server"));
        drop(listener);
    }

    #[test]
    fn preserves_disconnected_state_when_tunnel_inventory_cannot_be_confirmed() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let manager = TunnelManager::with_provider(Arc::new(
            ExistingServiceProvider::disconnected_with_unknown_inventory(),
        ));
        let running = manager
            .start("server", "playit", Path::new("mock.exe"), port)
            .unwrap();
        assert_eq!(running.state, "disconnected");
        let result = manager
            .stop("server", port, Some("mock.exe".into()))
            .unwrap();
        assert_eq!(result.state, "disconnected");
        assert!(result.message.contains("サービス再起動時の再公開"));
        assert!(manager.is_active("server"));
        drop(listener);
    }

    #[test]
    fn refuses_a_second_session_for_the_same_local_port() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let manager = TunnelManager::with_provider(Arc::new(MockProvider));
        manager
            .start("server-a", "playit", Path::new("mock.exe"), port)
            .unwrap();
        let error = manager
            .start("server-b", "playit", Path::new("mock.exe"), port)
            .unwrap_err();
        assert!(error.to_string().contains("TCPとUDPを区別できない"));
        assert!(manager.is_active("server-a"));
        assert!(!manager.is_active("server-b"));
        manager
            .stop("server-a", port, Some("mock.exe".into()))
            .unwrap();
        drop(listener);
    }

    #[test]
    fn active_tunnel_stop_is_safe_inside_an_existing_tokio_runtime() {
        let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let manager = TunnelManager::with_provider(Arc::new(MockProvider));
        manager
            .start("server", "playit", Path::new("mock.exe"), port)
            .unwrap();

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let status = runtime
            .block_on(async { manager.stop("server", port, Some("mock.exe".into())) })
            .unwrap();

        assert_eq!(status.state, "disconnected");
        assert!(!manager.is_active("server"));
        drop(listener);
    }
}
