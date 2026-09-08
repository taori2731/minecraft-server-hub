mod app_update;
mod backup;
mod bedrock;
mod co_management;
mod credentials;
mod crossplay;
mod diagnostics;
mod downloads;
mod error;
mod existing;
mod extension_check;
mod extensions;
mod game_adapter;
mod invite;
mod java;
mod migration;
mod models;
mod palworld;
mod ping;
mod player_access;
mod player_skin;
mod playit_installer;
mod process;
mod profiles;
mod protected_data;
mod server_diagnosis;
mod settings;
mod store;
mod tunnel;
mod update_safety;
mod windows_process;
mod world_maintenance;

use std::{
    collections::{HashMap, HashSet, VecDeque},
    io::{BufRead, BufReader, Write},
    net::{TcpListener, UdpSocket},
    path::{Path, PathBuf},
    process::Command,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use chrono::Utc;
use tauri::{Emitter, Manager, State};
use uuid::Uuid;

use crate::{
    co_management::{
        CoManagementApplyInput, CoManagementApplyResult, CoManagementAuditEntry,
        CoManagementConfigView, CoManagementEvent, CoManagementHostResponseInput,
        CoManagementInviteResult, CoManagementJournalMigrationResult, CoManagementOperationResult,
        CoManagementParticipantInput, CoManagementServerSnapshot, CoManagementSettingsInput,
        CoManagementSettingsSnapshot, ConfigureCoManagementInput, HostConnectionManager,
        IssueCoManagementInviteInput,
    },
    downloads::{download_server, http_client},
    error::{AppError, AppResult},
    java::{detect_java_runtimes, required_java_major},
    models::{
        ApplyManagedExtensionUpdateInput, ApplyServerUpdateInput, AuditEntry, AutomationSettings,
        BackupInfo, BasicSettings, CreateServerInput, DeleteServerInput, DeleteServerResult,
        DiagnosisIssue, ExtensionCheckReport, ExtensionInfo, ExtensionInstallPlan,
        ExtensionVersionOption, FixedPlayerPreset, ImportPreview, ImportServerInput,
        InstallTunnelAgentInput, InviteInfo, InviteSettings, JavaDownloadPlan, JavaRuntime,
        LogEntry, MigrationExportResult, MigrationManifest, ModpackProfile, PcDiagnosis,
        PlayerAccessEntry, ProfileDiff, PublicAccessStatus, QuickStartTunnelInput,
        RegenerateWorldInput, RestoreMigrationInput, RuntimeStatus, SaveFixedPlayerInput,
        ServerDiagnosisReport, ServerProfile, StartTunnelInput, TunnelAgentInstallPlan,
        TunnelAgentValidation, TunnelDiagnosis, TunnelExternalProbe, TunnelSettings, TunnelStatus,
        UpdateApplyResult, UpdateCenterItem, UpdateCenterReport, UpdateInviteSettingsInput,
        UpdatePalworldSettingsInput, UpdatePlayerAccessInput, UpdateSafetyReport,
        ValidateTunnelAgentInput, VersionOption, WhitelistEntry, WorldRegenerationResult,
    },
    process::{LogMap, ProcessMap, StoppingMap},
    store::Store,
};

#[tauri::command]
async fn check_app_update(
    endpoint: Option<String>,
    app: tauri::AppHandle,
) -> AppResult<app_update::AppUpdateInfo> {
    app_update::check(&app, endpoint.as_deref()).await
}

#[tauri::command]
async fn install_app_update(
    endpoint: Option<String>,
    expected_version: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let running = state.processes.lock().unwrap().len();
    let stopping = state.stopping_servers.lock().unwrap().len();
    if !app_update_install_allowed(
        running,
        stopping,
        state.stop_operations.load(Ordering::SeqCst),
    ) {
        return Err(AppError::Validation(
            "アプリを更新する前に、すべてのゲームサーバーを停止してください".into(),
        ));
    }
    let progress_app = app.clone();
    let progress = Arc::new(move |payload: app_update::AppUpdateProgress| {
        let _ = progress_app.emit("app-update-progress", payload);
    });
    let allow_exit = state.allow_app_exit.clone();
    let result = app_update::install(
        &app,
        endpoint.as_deref(),
        expected_version.trim(),
        progress,
        move || allow_exit.store(true, Ordering::SeqCst),
    )
    .await;
    if result.is_err() {
        state.allow_app_exit.store(false, Ordering::SeqCst);
    }
    result
}

fn app_update_install_allowed(running: usize, stopping: usize, stop_operations: usize) -> bool {
    running == 0 && stopping == 0 && stop_operations == 0
}

pub struct AppState {
    store: Arc<Mutex<Store>>,
    co_management_store: Arc<Mutex<co_management::CoManagementStore>>,
    co_operations: co_management::ServerOperationCoordinator,
    co_connections: HostConnectionManager,
    client: reqwest::Client,
    processes: Arc<ProcessMap>,
    stopping_servers: Arc<StoppingMap>,
    logs: LogMap,
    database_path: PathBuf,
    backups_dir: PathBuf,
    audit_dir: PathBuf,
    profiles_dir: PathBuf,
    java_dir: PathBuf,
    palworld_tools_dir: PathBuf,
    tunnel_install_dir: PathBuf,
    publications: invite::PublicationMap,
    tunnels: Arc<tunnel::TunnelManager>,
    stop_operations: Arc<AtomicUsize>,
    post_stop_exit_guard: Arc<Mutex<Option<Instant>>>,
    allow_app_exit: Arc<AtomicBool>,
}

const POST_STOP_EXIT_GUARD_DURATION: Duration = Duration::from_secs(8);

struct StopOperationGuard {
    counter: Arc<AtomicUsize>,
    post_stop_exit_guard: Arc<Mutex<Option<Instant>>>,
}

impl StopOperationGuard {
    fn new(counter: Arc<AtomicUsize>, post_stop_exit_guard: Arc<Mutex<Option<Instant>>>) -> Self {
        counter.fetch_add(1, Ordering::SeqCst);
        Self {
            counter,
            post_stop_exit_guard,
        }
    }
}

impl Drop for StopOperationGuard {
    fn drop(&mut self) {
        *self.post_stop_exit_guard.lock().unwrap() =
            Some(Instant::now() + POST_STOP_EXIT_GUARD_DURATION);
        self.counter.fetch_sub(1, Ordering::SeqCst);
    }
}

fn should_block_app_exit(stop_operations: usize, post_stop_guard_until: Option<Instant>) -> bool {
    stop_operations > 0 || post_stop_guard_until.is_some_and(|until| Instant::now() < until)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AppExitDecision {
    Allow,
    BlockSilently,
    AskUser,
}

fn app_exit_decision(
    exit_authorized: bool,
    stop_operations: usize,
    post_stop_guard_until: Option<Instant>,
) -> AppExitDecision {
    if exit_authorized {
        AppExitDecision::Allow
    } else if should_block_app_exit(stop_operations, post_stop_guard_until) {
        AppExitDecision::BlockSilently
    } else {
        AppExitDecision::AskUser
    }
}

fn append_lifecycle_event(app: &tauri::AppHandle, event: &str, detail: &str) {
    let Ok(log_dir) = app.path().app_log_dir() else {
        return;
    };
    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }
    let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("lifecycle.jsonl"))
    else {
        return;
    };
    let entry = serde_json::json!({
        "at": Utc::now().to_rfc3339(),
        "event": event,
        "detail": detail,
    });
    let _ = writeln!(file, "{entry}");
}

fn should_restore_main_window(label: &str, exit_authorized: bool) -> bool {
    label == "main" && !exit_authorized
}

struct MainWindowRestoreGuard(Arc<AtomicBool>);

impl Drop for MainWindowRestoreGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn schedule_main_window_restore(
    app: tauri::AppHandle,
    exit_authorized: Arc<AtomicBool>,
    restore_in_flight: Arc<AtomicBool>,
) {
    if exit_authorized.load(Ordering::SeqCst)
        || restore_in_flight
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
    {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let _restore_guard = MainWindowRestoreGuard(restore_in_flight);
        // The runtime removes a destroyed window from its registry asynchronously.
        // Wait briefly before reusing the stable `main` label.
        tokio::time::sleep(Duration::from_millis(150)).await;
        if exit_authorized.load(Ordering::SeqCst) || app.get_webview_window("main").is_some() {
            return;
        }
        let Some(mut config) = app
            .config()
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
            .or_else(|| app.config().app.windows.first())
            .cloned()
        else {
            append_lifecycle_event(&app, "main.restore.failed", "window-config-missing");
            return;
        };
        config.label = "main".into();
        for attempt in 1..=3 {
            if exit_authorized.load(Ordering::SeqCst) || app.get_webview_window("main").is_some() {
                return;
            }
            match tauri::WebviewWindowBuilder::from_config(&app, &config)
                .and_then(|builder| builder.build())
            {
                Ok(window) => {
                    let _ = window.show();
                    let _ = window.set_focus();
                    append_lifecycle_event(&app, "main.restore.completed", "unauthorized-destroy");
                    return;
                }
                Err(error) if attempt < 3 => {
                    append_lifecycle_event(
                        &app,
                        "main.restore.retry",
                        &format!("attempt={attempt} window-build-error={error}"),
                    );
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
                Err(error) => {
                    append_lifecycle_event(
                        &app,
                        "main.restore.failed",
                        &format!("attempt={attempt} window-build-error={error}"),
                    );
                    return;
                }
            }
        }
    });
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    // Match the process start path's lock order. Keep both guards held through
    // exit authorization so no start/stop operation can enter between the
    // empty-state check and setting the explicit-exit flag.
    let stopping_servers = state.stopping_servers.lock().unwrap();
    let processes = state.processes.lock().unwrap();
    if !stopping_servers.is_empty() || !processes.is_empty() {
        return Err(AppError::Validation(
            "起動中・起動準備中・停止処理中のサーバーを先に停止してください".into(),
        ));
    }
    state.allow_app_exit.store(true, Ordering::SeqCst);
    drop(processes);
    drop(stopping_servers);
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn list_servers(state: State<'_, AppState>) -> AppResult<Vec<ServerProfile>> {
    state.store.lock().unwrap().list_servers()
}

fn co_management_config_view(
    config: &co_management::CoManagementConfig,
    connection_state: Option<String>,
) -> CoManagementConfigView {
    CoManagementConfigView {
        server_id: config.server_id.clone(),
        enabled: config.enabled,
        endpoint: config.endpoint.clone(),
        connection_state: connection_state.unwrap_or_else(|| config.connection_state.clone()),
        revision: config.revision,
        permission_generation: config.permission_generation,
        recovery_required: config.recovery_required,
        updated_at: config.updated_at.clone(),
    }
}

#[tauri::command]
fn get_co_management_snapshot(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<CoManagementServerSnapshot> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let fingerprint = co_management::config_fingerprint(&profile).ok();
    let co_store = state.co_management_store.lock().unwrap();
    let config = co_store.ensure_config(&server_id, fingerprint.as_deref())?;
    let status = process::runtime_status(
        &profile,
        &state.processes,
        &state.stopping_servers,
        &state.logs,
    );
    Ok(co_management::build_snapshot(
        &profile,
        &status,
        &config,
        co_store.list_participants(&server_id)?,
        co_store.list_invites(&server_id)?,
        state.co_connections.state(&server_id),
    ))
}

#[tauri::command]
fn get_co_management_config(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<CoManagementConfigView> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let fingerprint = co_management::config_fingerprint(&profile).ok();
    let co_store = state.co_management_store.lock().unwrap();
    let config = co_store.ensure_config(&server_id, fingerprint.as_deref())?;
    Ok(co_management_config_view(
        &config,
        Some(state.co_connections.state(&server_id)),
    ))
}

#[tauri::command]
fn get_co_management_legacy_journal_count(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<u64> {
    state
        .co_management_store
        .lock()
        .unwrap()
        .legacy_journal_count(&server_id)
}

#[tauri::command]
fn migrate_co_management_legacy_journal(
    server_id: String,
    confirmation: String,
    state: State<'_, AppState>,
) -> AppResult<CoManagementJournalMigrationResult> {
    const CONFIRMATION: &str = "平文ジャーナルを暗号化して置換する";
    if confirmation != CONFIRMATION {
        return Err(AppError::Validation(
            "旧形式ジャーナルの明示確認が一致しないため移行を中止しました".into(),
        ));
    }
    let _operation = state.co_operations.blocking_lock(&server_id);
    state
        .co_management_store
        .lock()
        .unwrap()
        .migrate_legacy_journals(&server_id)
}

#[tauri::command]
fn configure_co_management(
    input: ConfigureCoManagementInput,
    state: State<'_, AppState>,
) -> AppResult<CoManagementConfigView> {
    let _operation = state.co_operations.blocking_lock(&input.server_id);
    let profile = state.store.lock().unwrap().get_server(&input.server_id)?;
    let fingerprint = co_management::config_fingerprint(&profile).ok();
    let co_store = state.co_management_store.lock().unwrap();
    let current = co_store.ensure_config(&input.server_id, fingerprint.as_deref())?;
    let endpoint = input
        .endpoint
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| co_management::validate_relay_endpoint(value).map(|url| url.to_string()))
        .transpose()?;
    let endpoint = endpoint.or(current.endpoint.clone());
    if input.enabled && endpoint.is_none() {
        return Err(AppError::Validation(
            "共同管理を有効にするには中継URLを指定してください".into(),
        ));
    }
    let host_id = if input.enabled {
        Some(
            current
                .host_id
                .clone()
                .unwrap_or_else(co_management::generate_host_id),
        )
    } else {
        current.host_id.clone()
    };
    let connection_identity_changed = current.enabled != input.enabled
        || current.endpoint != endpoint
        || current.host_id != host_id;
    if let Some(host_id) = host_id.as_deref() {
        if input.enabled {
            let _ = credentials::ensure_co_management_host_token(
                host_id,
                co_management::generate_secret,
            )?;
        }
    }
    let config = co_store.configure(
        &input.server_id,
        endpoint.as_deref(),
        host_id.as_deref(),
        input.enabled,
        fingerprint.as_deref(),
    )?;
    if !input.enabled || connection_identity_changed {
        state.co_connections.disconnect(&input.server_id);
    }
    let _ = co_store.append_audit(
        &input.server_id,
        "local-host",
        "ホストPC",
        if input.enabled {
            "co-management.enable"
        } else {
            "co-management.disable"
        },
        &serde_json::json!({ "enabled": input.enabled }),
        "success",
        None,
    );
    Ok(co_management_config_view(
        &config,
        Some(state.co_connections.state(&input.server_id)),
    ))
}

#[tauri::command]
async fn connect_co_management(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<CoManagementConfigView> {
    let _operation = state.co_operations.lock(&server_id).await;
    let (endpoint, host_id, token) = {
        let co_store = state.co_management_store.lock().unwrap();
        let config = co_store.config(&server_id)?.ok_or(AppError::NotFound)?;
        if !config.enabled {
            return Err(AppError::Validation("共同管理が無効になっています".into()));
        }
        let endpoint = config
            .endpoint
            .as_deref()
            .ok_or_else(|| AppError::Validation("共同管理の中継URLが未設定です".into()))?
            .to_string();
        let host_id = config
            .host_id
            .as_deref()
            .ok_or_else(|| AppError::Validation("共同管理ホストIDが未登録です".into()))?
            .to_string();
        let token = credentials::load_co_management_host_token(&host_id)?;
        co_store.set_connection_state(&server_id, "connecting")?;
        (endpoint, host_id, token)
    };
    if let Err(error) =
        co_management::register_host(&state.client, &endpoint, &host_id, &token).await
    {
        let _ = state
            .co_management_store
            .lock()
            .unwrap()
            .set_connection_state(&server_id, "disconnected");
        return Err(error);
    }
    let revoked_participants = state
        .co_management_store
        .lock()
        .unwrap()
        .rotate_permission_generation(&server_id)?;
    if let Err(error) = state
        .co_connections
        .connect(&server_id, &endpoint, &host_id, &token)
        .await
    {
        let _ = state
            .co_management_store
            .lock()
            .unwrap()
            .set_connection_state(&server_id, "disconnected");
        return Err(error);
    }
    for participant_id in revoked_participants {
        let _ = state.co_connections.send(
            &server_id,
            serde_json::json!({
                "type": "participant.revoked",
                "protocolVersion": co_management::PROTOCOL_VERSION,
                "serverId": server_id,
                "participantId": participant_id,
            }),
        );
    }
    let co_store = state.co_management_store.lock().unwrap();
    co_store.set_connection_state(&server_id, "connected")?;
    let config = co_store.config(&server_id)?.ok_or(AppError::NotFound)?;
    Ok(co_management_config_view(
        &config,
        Some(state.co_connections.state(&server_id)),
    ))
}

#[tauri::command]
fn issue_co_management_invite(
    input: IssueCoManagementInviteInput,
    state: State<'_, AppState>,
) -> AppResult<CoManagementInviteResult> {
    let _operation = state.co_operations.blocking_lock(&input.server_id);
    let profile = state.store.lock().unwrap().get_server(&input.server_id)?;
    let co_store = state.co_management_store.lock().unwrap();
    let config = co_store
        .config(&input.server_id)?
        .ok_or(AppError::NotFound)?;
    if !config.enabled {
        return Err(AppError::Validation(
            "共同管理を有効にしてから招待を発行してください".into(),
        ));
    }
    if config.recovery_required {
        return Err(AppError::Validation(
            "前回の共同管理保存を復旧するまで、新しい招待は発行できません".into(),
        ));
    }
    let endpoint = config
        .endpoint
        .as_deref()
        .ok_or_else(|| AppError::Validation("共同管理の中継URLが未設定です".into()))?;
    co_management::create_invite(
        &co_store,
        &state.co_connections,
        &profile,
        endpoint,
        &input.role,
        input.expires_minutes,
    )
}

#[tauri::command]
fn poll_co_management_events(state: State<'_, AppState>) -> AppResult<Vec<CoManagementEvent>> {
    let events = state.co_connections.poll_events();
    let co_store = state.co_management_store.lock().unwrap();
    for event in &events {
        if event.event_type != "participant.pending" {
            continue;
        }
        let Some(server_id) = event
            .payload
            .get("serverId")
            .and_then(|value| value.as_str())
        else {
            continue;
        };
        if server_id != event.server_id {
            continue;
        }
        let Some(participant_id) = event
            .payload
            .get("participantId")
            .and_then(|value| value.as_str())
        else {
            continue;
        };
        let Some(display_name) = event
            .payload
            .get("displayName")
            .and_then(|value| value.as_str())
        else {
            continue;
        };
        let Some(role) = event.payload.get("role").and_then(|value| value.as_str()) else {
            continue;
        };
        let Some(join_code) = event
            .payload
            .get("joinCode")
            .and_then(|value| value.as_str())
        else {
            continue;
        };
        let Some(expires_at) = event
            .payload
            .get("expiresAt")
            .and_then(|value| value.as_str())
        else {
            continue;
        };
        credentials::store_co_management_pending_code(server_id, participant_id, join_code)?;
        if let Err(error) = co_store.upsert_pending(
            server_id,
            participant_id,
            display_name,
            role,
            join_code,
            expires_at,
        ) {
            let _ = credentials::delete_co_management_pending_code(server_id, participant_id);
            return Err(error);
        }
    }
    Ok(events)
}

#[tauri::command]
fn get_co_management_pending_code(
    input: CoManagementParticipantInput,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let co_store = state.co_management_store.lock().unwrap();
    let participant = co_store
        .participant(&input.server_id, &input.participant_id)?
        .ok_or(AppError::NotFound)?;
    if participant.state != "pending" || participant.expires_at <= Utc::now().to_rfc3339() {
        let _ =
            credentials::delete_co_management_pending_code(&input.server_id, &input.participant_id);
        return Err(AppError::Validation(
            "共同管理の参加コードが期限切れです".into(),
        ));
    }
    credentials::load_co_management_pending_code(&input.server_id, &input.participant_id)
}

#[tauri::command]
fn approve_co_management_participant(
    input: CoManagementParticipantInput,
    state: State<'_, AppState>,
) -> AppResult<CoManagementParticipantInput> {
    let _operation = state.co_operations.blocking_lock(&input.server_id);
    let co_store = state.co_management_store.lock().unwrap();
    if co_store
        .config(&input.server_id)?
        .ok_or(AppError::NotFound)?
        .recovery_required
    {
        return Err(AppError::Validation(
            "前回の共同管理保存を復旧するまで、参加者を承認できません".into(),
        ));
    }
    let participant =
        co_store.set_participant_state(&input.server_id, &input.participant_id, "approved")?;
    credentials::delete_co_management_pending_code(&input.server_id, &input.participant_id)?;
    co_store.append_audit(
        &input.server_id,
        "local-host",
        "ホストPC",
        "participant.approve",
        &serde_json::json!({ "participantId": participant.id, "role": participant.role }),
        "success",
        None,
    )?;
    state.co_connections.send(
        &input.server_id,
        serde_json::json!({
            "type": "participant.approved",
            "protocolVersion": co_management::PROTOCOL_VERSION,
            "serverId": input.server_id,
            "participantId": input.participant_id,
        }),
    )?;
    Ok(input)
}

#[tauri::command]
fn revoke_co_management_participant(
    input: CoManagementParticipantInput,
    state: State<'_, AppState>,
) -> AppResult<CoManagementParticipantInput> {
    let _operation = state.co_operations.blocking_lock(&input.server_id);
    let co_store = state.co_management_store.lock().unwrap();
    let participant =
        co_store.set_participant_state(&input.server_id, &input.participant_id, "revoked")?;
    credentials::delete_co_management_pending_code(&input.server_id, &input.participant_id)?;
    co_store.append_audit(
        &input.server_id,
        "local-host",
        "ホストPC",
        "participant.revoke",
        &serde_json::json!({ "participantId": participant.id }),
        "success",
        None,
    )?;
    state.co_connections.send(
        &input.server_id,
        serde_json::json!({
            "type": "participant.revoked",
            "protocolVersion": co_management::PROTOCOL_VERSION,
            "serverId": input.server_id,
            "participantId": input.participant_id,
        }),
    )?;
    Ok(input)
}

#[tauri::command]
fn get_co_management_settings(
    input: CoManagementSettingsInput,
    state: State<'_, AppState>,
) -> AppResult<CoManagementSettingsSnapshot> {
    let profile = state.store.lock().unwrap().get_server(&input.server_id)?;
    let co_store = state.co_management_store.lock().unwrap();
    let participant = co_store
        .participant(&input.server_id, &input.participant_id)?
        .ok_or(AppError::NotFound)?;
    co_management::authorize_participant(
        &co_store,
        &input.server_id,
        &input.participant_id,
        &participant.role,
    )?;
    let config = co_store
        .config(&input.server_id)?
        .ok_or(AppError::NotFound)?;
    let status = process::runtime_status(
        &profile,
        &state.processes,
        &state.stopping_servers,
        &state.logs,
    );
    co_management::build_settings_snapshot(&profile, &status, config.revision)
}

#[tauri::command]
async fn apply_co_management_settings(
    input: CoManagementApplyInput,
    state: State<'_, AppState>,
) -> AppResult<CoManagementApplyResult> {
    let _operation = state.co_operations.lock(&input.server_id).await;
    let database_path = state.database_path.clone();
    let backups_dir = state.backups_dir.clone();
    let processes = state.processes.clone();
    let stopping_servers = state.stopping_servers.clone();
    tokio::task::spawn_blocking(move || {
        // Reopen the SQLite handles on the blocking pool. Holding Tauri State
        // mutex guards across the full-file backup would block all commands
        // that need either database, including the event poller.
        let store = Store::open(&database_path)?;
        let co_store = co_management::CoManagementStore::open(&database_path)?;
        co_management::apply_settings(
            &co_store,
            &store,
            &backups_dir,
            &processes,
            &stopping_servers,
            &input,
        )
    })
    .await
    .map_err(|error| AppError::Other(format!("共同管理設定処理が中断されました: {error}")))?
}

#[tauri::command]
fn get_co_management_operation(
    server_id: String,
    participant_id: String,
    request_id: String,
    state: State<'_, AppState>,
) -> AppResult<CoManagementOperationResult> {
    let co_store = state.co_management_store.lock().unwrap();
    let participant = co_store
        .participant(&server_id, &participant_id)?
        .ok_or(AppError::NotFound)?;
    co_management::authorize_participant(
        &co_store,
        &server_id,
        &participant_id,
        &participant.role,
    )?;
    co_store.operation_result(&server_id, &participant_id, &request_id)
}

#[tauri::command]
fn respond_co_management_request(
    input: CoManagementHostResponseInput,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if input.request_id.is_empty() || input.request_id.len() > 128 {
        return Err(AppError::Validation("共同管理requestIdが不正です".into()));
    }
    let error_message = input
        .error_message
        .as_deref()
        .map(|_| "ホストPCで操作を完了できませんでした");
    state.co_connections.send(
        &input.server_id,
        serde_json::json!({
            "type": "host.response",
            "protocolVersion": co_management::PROTOCOL_VERSION,
            "serverId": input.server_id,
            "requestId": input.request_id,
            "ok": input.ok,
            "result": input.result,
            "errorCode": input.error_code,
            "errorMessage": error_message,
        }),
    )
}

#[tauri::command]
fn publish_co_management_snapshot(server_id: String, state: State<'_, AppState>) -> AppResult<()> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let co_store = state.co_management_store.lock().unwrap();
    let config = co_store.config(&server_id)?.ok_or(AppError::NotFound)?;
    if !config.enabled {
        return Ok(());
    }
    let status = process::runtime_status(
        &profile,
        &state.processes,
        &state.stopping_servers,
        &state.logs,
    );
    let snapshot = serde_json::json!({
        "serverId": profile.id,
        "serverName": profile.name,
        "gameKind": profile.edition(),
        "state": status.state,
        "playerCount": status.player_count,
        "maxPlayers": status.max_players,
        "fetchedAt": Utc::now().to_rfc3339(),
        "revision": config.revision,
        "capabilities": co_management::capabilities(&profile),
    });
    state.co_connections.send(
        &server_id,
        serde_json::json!({
            "type": "host.snapshot",
            "protocolVersion": co_management::PROTOCOL_VERSION,
            "serverId": server_id,
            "snapshot": snapshot,
        }),
    )
}

#[tauri::command]
fn get_co_management_audit(
    server_id: String,
    participant_id: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<CoManagementAuditEntry>> {
    let co_store = state.co_management_store.lock().unwrap();
    let participant = co_store
        .participant(&server_id, &participant_id)?
        .ok_or(AppError::NotFound)?;
    co_management::authorize_participant(
        &co_store,
        &server_id,
        &participant_id,
        &participant.role,
    )?;
    co_store.audit(&server_id)
}

#[tauri::command]
fn get_automation_settings(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<AutomationSettings> {
    state.store.lock().unwrap().automation_settings(&server_id)
}

#[tauri::command]
fn save_automation_settings(
    mut settings: AutomationSettings,
    state: State<'_, AppState>,
) -> AppResult<AutomationSettings> {
    if !(5..=1_440).contains(&settings.idle_minutes) {
        return Err(AppError::Validation(
            "自動停止までの時間は5～1440分で選択してください".into(),
        ));
    }
    settings.updated_at = Utc::now().to_rfc3339();
    state
        .store
        .lock()
        .unwrap()
        .save_automation_settings(&settings)?;
    Ok(settings)
}

#[tauri::command]
fn check_extension_conflicts(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<ExtensionCheckReport> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    require_minecraft(&profile, "Mod／プラグイン競合チェック")?;
    extension_check::check(&profile)
}

#[tauri::command]
fn export_server_migration(
    server_id: String,
    destination: String,
    state: State<'_, AppState>,
) -> AppResult<MigrationExportResult> {
    if process::is_busy(&server_id, &state.processes, &state.stopping_servers) {
        return Err(AppError::Validation(
            "移行ファイルを作成する前にサーバーを安全に停止してください".into(),
        ));
    }
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    require_minecraft(&profile, "サーバー移行ファイル")?;
    migration::export(&profile, Path::new(&destination))
}

#[tauri::command]
fn inspect_server_migration(archive_path: String) -> AppResult<MigrationManifest> {
    migration::read_manifest(Path::new(&archive_path))
}

#[tauri::command]
fn restore_server_migration(
    input: RestoreMigrationInput,
    state: State<'_, AppState>,
) -> AppResult<ServerProfile> {
    let existing = state.store.lock().unwrap().list_servers()?;
    let (manifest, destination) = migration::restore(&input)?;
    let transport = if manifest.server_type == "bedrock" {
        "udp"
    } else {
        "tcp"
    };
    if let Err(error) = ensure_registered_port_unique(
        &existing,
        None,
        manifest.port,
        transport,
        manifest.server_type == "bedrock",
    ) {
        let _ = std::fs::remove_dir_all(&destination);
        return Err(error);
    }
    if manifest.server_type != "bedrock"
        && (input.java_path.trim().is_empty() || input.java_major < manifest.java_major)
    {
        let _ = std::fs::remove_dir_all(&destination);
        return Err(AppError::Validation(format!(
            "この移行ファイルにはJava {}以上が必要です。先にJavaを準備してください",
            manifest.java_major
        )));
    }
    let now = Utc::now().to_rfc3339();
    let profile = ServerProfile {
        id: Uuid::new_v4().to_string(),
        name: input.server_name.trim().to_string(),
        root_path: destination.display().to_string(),
        game_kind: "minecraft".into(),
        server_type: manifest.server_type,
        minecraft_version: manifest.minecraft_version,
        distribution_build: manifest.distribution_build,
        launch_target: manifest.launch_target,
        java_path: if manifest.java_major == 0 {
            String::new()
        } else {
            input.java_path
        },
        java_major: if manifest.java_major == 0 {
            0
        } else {
            input.java_major
        },
        min_memory_mib: manifest.min_memory_mib,
        max_memory_mib: manifest.max_memory_mib,
        port: manifest.port,
        eula_accepted_at: now.clone(),
        pending_restart: false,
        settings: manifest.settings,
        palworld_settings: None,
        created_at: now.clone(),
        updated_at: now,
    };
    if let Err(error) = state.store.lock().unwrap().insert_server(&profile) {
        let _ = std::fs::remove_dir_all(&destination);
        return Err(error);
    }
    Ok(profile)
}

#[tauri::command]
fn suggest_server_port(
    starting_port: Option<u16>,
    transport: Option<String>,
    reserve_adjacent: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<u16> {
    let transport = transport
        .unwrap_or_else(|| "tcp".into())
        .to_ascii_lowercase();
    if !matches!(transport.as_str(), "tcp" | "udp") {
        return Err(AppError::Validation(
            "通信方式はTCPまたはUDPを指定してください".into(),
        ));
    }
    let servers = state.store.lock().unwrap().list_servers()?;
    let used = registered_ports_for_transport(&servers, &transport);
    let reserve_adjacent = reserve_adjacent.unwrap_or(transport == "udp");
    find_available_port(&used, starting_port.unwrap_or(25565), |port| {
        if transport == "udp" {
            let Ok(primary) = UdpSocket::bind(("0.0.0.0", port)) else {
                return false;
            };
            let secondary_available = if reserve_adjacent {
                port.checked_add(1)
                    .is_some_and(|ipv6_port| UdpSocket::bind(("0.0.0.0", ipv6_port)).is_ok())
            } else {
                true
            };
            drop(primary);
            secondary_available
        } else {
            TcpListener::bind(("0.0.0.0", port)).is_ok()
        }
    })
    .ok_or_else(|| AppError::Validation("利用できるサーバーポートを見つけられませんでした".into()))
}

fn registered_ports_for_transport(servers: &[ServerProfile], transport: &str) -> HashSet<u16> {
    servers
        .iter()
        .flat_map(|server| {
            let mut ports = Vec::new();
            if server.network_transport() == transport {
                ports.push(server.port);
                if server.server_type == "bedrock" {
                    if let Some(ipv6_port) = server.port.checked_add(1) {
                        ports.push(ipv6_port);
                    }
                }
            }
            if transport == "udp" {
                if let Some(crossplay_port) = crossplay::registered_bedrock_port(server) {
                    ports.push(crossplay_port);
                }
            } else if transport == "tcp" {
                if let Some(rest_port) = server
                    .palworld_settings
                    .as_ref()
                    .map(|settings| settings.rest_api_port)
                {
                    ports.push(rest_port);
                }
            }
            ports
        })
        .collect()
}

#[tauri::command]
fn inspect_existing_server(root_path: String) -> AppResult<ImportPreview> {
    existing::inspect(&root_path)
}

#[tauri::command]
fn import_existing_server(
    input: ImportServerInput,
    state: State<'_, AppState>,
) -> AppResult<ServerProfile> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 64 {
        return Err(AppError::Validation(
            "サーバー名は1～64文字で入力してください".into(),
        ));
    }
    let preview = existing::inspect(&input.root_path)?;
    if preview.source_fingerprint != input.source_fingerprint {
        return Err(AppError::Validation(
            "確認後にサーバー構成が変わりました。安全のため再スキャンしてください".into(),
        ));
    }
    // Re-verify imported BDS at the registration boundary and keep the file
    // locked against writes/deletion while its initial backup and registry row
    // are created. `process::start` performs the same guarded verification
    // immediately before every launch.
    let verified_bedrock = if preview.server_type == "bedrock" {
        Some(bedrock::verify_installed_executable(Path::new(
            &preview.root_path,
        ))?)
    } else {
        None
    };
    if preview.server_type != "bedrock" {
        let selected_java = PathBuf::from(&input.java_path).canonicalize()?;
        let compatible = preview.java_runtimes.iter().any(|runtime| {
            runtime.compatible
                && runtime.major_version == input.java_major
                && PathBuf::from(&runtime.executable_path)
                    .canonicalize()
                    .is_ok_and(|path| path == selected_java)
        });
        if !compatible {
            return Err(AppError::Validation(
                "選択したJavaを互換環境として再確認できませんでした".into(),
            ));
        }
    }
    let already_registered =
        state
            .store
            .lock()
            .unwrap()
            .list_servers()?
            .into_iter()
            .any(|server| {
                PathBuf::from(server.root_path)
                    .canonicalize()
                    .is_ok_and(|path| path == PathBuf::from(&preview.root_path))
            });
    if already_registered {
        return Err(AppError::Validation(
            "このサーバーフォルダーはすでに登録されています".into(),
        ));
    }
    let profile = existing::registration_profile(preview, name, input.java_path, input.java_major);
    let servers = state.store.lock().unwrap().list_servers()?;
    ensure_registered_port_unique(
        &servers,
        None,
        profile.port,
        profile.network_transport(),
        profile.server_type == "bedrock",
    )?;
    if input.create_initial_backup {
        backup::create(&state.backups_dir, &profile, "initial-import")?;
    }
    state.store.lock().unwrap().insert_server(&profile)?;
    append_audit(
        &state.audit_dir,
        &profile.id,
        "local-host",
        "server.import",
        &format!("fingerprint={}", input.source_fingerprint),
    )?;
    drop(verified_bedrock);
    Ok(profile)
}

#[tauri::command]
fn detect_java(server_type: String, minecraft_version: String) -> Vec<JavaRuntime> {
    detect_java_runtimes(&server_type, &minecraft_version)
}

#[tauri::command]
async fn get_java_download_plan(
    server_type: String,
    minecraft_version: String,
    state: State<'_, AppState>,
) -> AppResult<JavaDownloadPlan> {
    java::download_plan(
        &state.client,
        &state.java_dir,
        &server_type,
        &minecraft_version,
    )
    .await
}

#[tauri::command]
async fn install_managed_java(
    plan: JavaDownloadPlan,
    state: State<'_, AppState>,
) -> AppResult<JavaRuntime> {
    java::install_managed_java(&state.client, &state.java_dir, plan).await
}

#[tauri::command]
fn update_server_java(
    server_id: String,
    java_path: String,
    java_major: u16,
    state: State<'_, AppState>,
) -> AppResult<ServerProfile> {
    if process::is_busy(&server_id, &state.processes, &state.stopping_servers) {
        return Err(AppError::Validation(
            "Javaを切り替える前にサーバーを停止してください".into(),
        ));
    }
    let store = state.store.lock().unwrap();
    let mut profile = store.get_server(&server_id)?;
    if profile.game_adapter().is_palworld() {
        return Err(AppError::Validation(
            "Palworld Dedicated ServerはJavaを使用しません".into(),
        ));
    }
    let requested = PathBuf::from(&java_path).canonicalize()?;
    let valid = detect_java_runtimes(&profile.server_type, &profile.minecraft_version)
        .into_iter()
        .any(|runtime| {
            runtime.compatible
                && runtime.major_version == java_major
                && PathBuf::from(runtime.executable_path)
                    .canonicalize()
                    .is_ok_and(|path| path == requested)
        });
    if !valid {
        return Err(AppError::Validation(
            "選択したJavaを互換環境として確認できませんでした".into(),
        ));
    }
    profile.java_path = java_path;
    profile.java_major = java_major;
    profile.updated_at = Utc::now().to_rfc3339();
    profile.pending_restart = true;
    store.update_server(&profile)?;
    append_audit(
        &state.audit_dir,
        &server_id,
        "local-host",
        "java.update",
        &format!("Java {java_major}"),
    )?;
    Ok(profile)
}

#[tauri::command]
async fn get_server_versions(
    server_type: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<VersionOption>> {
    if server_type == "palworld" {
        return Ok(vec![VersionOption {
            id: "Dedicated Server".into(),
            channel: "stable".into(),
        }]);
    }
    if server_type == "bedrock" {
        let plan = bedrock::fetch_download_plan(&state.client).await?;
        return Ok(vec![VersionOption {
            id: plan.version,
            channel: "stable".into(),
        }]);
    }
    downloads::list_versions(&state.client, &server_type).await
}

#[tauri::command]
async fn create_server(
    input: CreateServerInput,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> AppResult<ServerProfile> {
    validate_create_input(&input)?;
    let is_palworld = input.game_kind.eq_ignore_ascii_case("palworld")
        || input.server_type.eq_ignore_ascii_case("palworld");
    if input.server_type != "bedrock" && !is_palworld {
        validate_java(&input)?;
    }
    {
        let servers = state.store.lock().unwrap().list_servers()?;
        let transport = if input.server_type == "bedrock" || is_palworld {
            "udp"
        } else {
            "tcp"
        };
        ensure_registered_port_unique(
            &servers,
            None,
            input.port,
            transport,
            input.server_type == "bedrock",
        )?;
        if is_palworld {
            let settings = input
                .palworld_settings
                .as_ref()
                .ok_or_else(|| AppError::Validation("PalworldのREST管理設定がありません".into()))?;
            ensure_palworld_management_port_unique(&servers, None, settings.rest_api_port)?;
            if TcpListener::bind(("0.0.0.0", settings.rest_api_port)).is_err() {
                return Err(AppError::Validation(format!(
                    "Palworld REST管理用TCPポート {} は使用中です",
                    settings.rest_api_port
                )));
            }
        }
    }

    let parent = PathBuf::from(&input.parent_path);
    if !parent.is_dir() {
        return Err(AppError::Validation(
            "保存先として存在するフォルダーを選択してください".into(),
        ));
    }
    let parent = parent.canonicalize()?;
    let id = Uuid::new_v4().to_string();
    let folder_name = safe_folder_name(&input.name, &id);
    let root = parent.join(folder_name);
    if root.exists() {
        return Err(AppError::Validation(
            "同名の保存フォルダーがすでに存在します".into(),
        ));
    }
    std::fs::create_dir(&root)?;

    let creation_result = create_server_files(
        &input,
        &root,
        &state.client,
        &state.palworld_tools_dir,
        &id,
        &app,
    )
    .await;
    let distribution_build = match creation_result {
        Ok(build) => build,
        Err(error) => {
            if is_palworld {
                let _ = credentials::delete_palworld_admin_password(&id);
            }
            let _ = std::fs::remove_dir_all(&root);
            return Err(error);
        }
    };

    let now = Utc::now().to_rfc3339();
    let is_bedrock = input.server_type == "bedrock";
    let profile = ServerProfile {
        id,
        name: input.name.trim().to_string(),
        root_path: root.display().to_string(),
        game_kind: if is_palworld {
            "palworld".into()
        } else {
            "minecraft".into()
        },
        server_type: input.server_type,
        minecraft_version: input.minecraft_version,
        distribution_build,
        launch_target: if is_palworld {
            "PalServer.exe".into()
        } else if is_bedrock {
            "bedrock_server.exe".into()
        } else {
            "server.jar".into()
        },
        java_path: input.java_path,
        java_major: input.java_major,
        min_memory_mib: input.min_memory_mib,
        max_memory_mib: input.max_memory_mib,
        port: input.port,
        eula_accepted_at: now.clone(),
        pending_restart: false,
        settings: input.settings,
        palworld_settings: input.palworld_settings,
        created_at: now.clone(),
        updated_at: now,
    };
    if let Err(error) = state.store.lock().unwrap().insert_server(&profile) {
        if is_palworld {
            let _ = credentials::delete_palworld_admin_password(&profile.id);
        }
        let _ = std::fs::remove_dir_all(&root);
        return Err(error);
    }
    Ok(profile)
}

#[tauri::command]
fn start_server(
    server_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let _operation = state.co_operations.blocking_lock(&server_id);
    let store = state.store.lock().unwrap();
    let profile = store.get_server(&server_id)?;
    let servers = store.list_servers()?;
    ensure_registered_port_unique(
        &servers,
        Some(&server_id),
        profile.port,
        profile.network_transport(),
        profile.server_type == "bedrock",
    )?;
    if profile.game_adapter().is_palworld() {
        let settings = profile
            .palworld_settings
            .as_ref()
            .ok_or_else(|| AppError::Validation("PalworldのREST管理設定がありません".into()))?;
        ensure_palworld_management_port_unique(&servers, Some(&server_id), settings.rest_api_port)?;
        let game_port_probe = UdpSocket::bind(("0.0.0.0", profile.port)).map_err(|_| {
            AppError::Validation(format!(
                "Palworldゲーム用UDPポート {} は別のプロセスが使用中です",
                profile.port
            ))
        })?;
        let rest_port_probe =
            TcpListener::bind(("0.0.0.0", settings.rest_api_port)).map_err(|_| {
                AppError::Validation(format!(
                    "Palworld REST管理用TCPポート {} は別のプロセスが使用中です",
                    settings.rest_api_port
                ))
            })?;
        drop((game_port_probe, rest_port_probe));
        let _ = credentials::load_palworld_admin_password(&profile.id)?;
        palworld::validate_server_layout(Path::new(&profile.root_path))?;
    }
    drop(store);
    if !profile.game_adapter().is_palworld() {
        enforce_start_preflight(&profile)?;
        let extension_report = extension_check::check(&profile)?;
        if extension_report.blocking {
            let titles = extension_report
                .items
                .iter()
                .filter(|item| item.severity == "error")
                .map(|item| item.title.as_str())
                .collect::<Vec<_>>();
            return Err(AppError::Validation(format!(
                "起動前のMod／プラグイン検査で修正が必要です: {}。自動運用タブで詳細を確認してください",
                titles.join(" / ")
            )));
        }
    }
    process::start(
        &app,
        &profile,
        &state.processes,
        &state.stopping_servers,
        &state.logs,
    )?;
    let _ = append_audit(
        &state.audit_dir,
        &server_id,
        "local-host",
        "server.start",
        &format!(
            "source=desktop edition={} runtime={}",
            profile.edition(),
            profile.runtime_kind()
        ),
    );
    Ok(())
}

#[tauri::command]
async fn stop_server(
    server_id: String,
    force: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let _operation = state.co_operations.lock(&server_id).await;
    let _stop_guard = StopOperationGuard::new(
        state.stop_operations.clone(),
        state.post_stop_exit_guard.clone(),
    );
    append_lifecycle_event(
        &app,
        "server.stop.begin",
        &format!("server={server_id} force={force}"),
    );
    let result: AppResult<()> = async {
        let profile = state.store.lock().unwrap().get_server(&server_id)?;
        let graceful_command = if profile.game_adapter().is_palworld() {
            if !force {
                palworld::save_world(&profile).await?;
                append_lifecycle_event(
                    &app,
                    "server.stop.palworld-save-complete",
                    &format!("server={server_id}"),
                );
                palworld::shutdown(&profile, 2).await?;
                append_lifecycle_event(
                    &app,
                    "server.stop.palworld-shutdown-requested",
                    &format!("server={server_id}"),
                );
            }
            None
        } else {
            Some("stop")
        };
        match process::stop(
            &app,
            &server_id,
            force,
            graceful_command,
            &state.processes,
            &state.stopping_servers,
        )
        .await
        {
            Ok(()) => {}
            Err(AppError::NotRunning) if profile.game_adapter().is_palworld() && !force => {}
            Err(error) => return Err(error),
        }
        append_lifecycle_event(
            &app,
            "server.stop.process-complete",
            &format!("server={server_id}"),
        );
        let publications = state.publications.clone();
        let cleanup_id = server_id.clone();
        tokio::task::spawn_blocking(move || invite::unpublish(&cleanup_id, &publications))
            .await
            .map_err(|error| AppError::Other(error.to_string()))??;
        append_lifecycle_event(
            &app,
            "server.stop.publication-complete",
            &format!("server={server_id}"),
        );
        append_lifecycle_event(
            &app,
            "server.stop.tunnel-begin",
            &format!("server={server_id}"),
        );
        let tunnel_store = state.store.clone();
        let tunnels = state.tunnels.clone();
        let tunnel_server_id = server_id.clone();
        tokio::task::spawn_blocking(move || {
            stop_tunnel_for_server_with(&tunnel_server_id, &tunnel_store, &tunnels)
        })
        .await
        .map_err(|error| AppError::Other(error.to_string()))??;
        append_lifecycle_event(
            &app,
            "server.stop.tunnel-complete",
            &format!("server={server_id}"),
        );
        let _ = append_audit(
            &state.audit_dir,
            &server_id,
            "local-host",
            if force {
                "server.force-stop"
            } else {
                "server.stop"
            },
            "source=desktop",
        );
        Ok(())
    }
    .await;
    append_lifecycle_event(
        &app,
        if result.is_ok() {
            "server.stop.completed"
        } else {
            "server.stop.failed"
        },
        &format!("server={server_id}"),
    );
    result
}

#[tauri::command]
async fn restart_server(
    server_id: String,
    force: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let _operation = state.co_operations.lock(&server_id).await;
    let _stop_guard = StopOperationGuard::new(
        state.stop_operations.clone(),
        state.post_stop_exit_guard.clone(),
    );
    if process::is_stopping(&server_id, &state.stopping_servers) {
        return Err(AppError::Validation(
            "停止処理が完了してから再起動してください".into(),
        ));
    }
    let profile_before_stop = state.store.lock().unwrap().get_server(&server_id)?;
    if process::is_running(&server_id, &state.processes) {
        let graceful_command = if profile_before_stop.game_adapter().is_palworld() {
            if !force {
                palworld::save_world(&profile_before_stop).await?;
                palworld::shutdown(&profile_before_stop, 2).await?;
            }
            None
        } else {
            Some("stop")
        };
        let stop_result = process::stop(
            &app,
            &server_id,
            force,
            graceful_command,
            &state.processes,
            &state.stopping_servers,
        )
        .await;
        match stop_result {
            Ok(()) => {}
            Err(AppError::NotRunning)
                if profile_before_stop.game_adapter().is_palworld() && !force => {}
            Err(error) => return Err(error),
        }
        let publications = state.publications.clone();
        let cleanup_id = server_id.clone();
        tokio::task::spawn_blocking(move || invite::unpublish(&cleanup_id, &publications))
            .await
            .map_err(|error| AppError::Other(error.to_string()))??;
        append_lifecycle_event(
            &app,
            "server.restart.tunnel-begin",
            &format!("server={server_id}"),
        );
        let tunnel_store = state.store.clone();
        let tunnels = state.tunnels.clone();
        let tunnel_server_id = server_id.clone();
        tokio::task::spawn_blocking(move || {
            stop_tunnel_for_server_with(&tunnel_server_id, &tunnel_store, &tunnels)
        })
        .await
        .map_err(|error| AppError::Other(error.to_string()))??;
        append_lifecycle_event(
            &app,
            "server.restart.tunnel-complete",
            &format!("server={server_id}"),
        );
    }
    let store = state.store.lock().unwrap();
    let profile = store.get_server(&server_id)?;
    let servers = store.list_servers()?;
    ensure_registered_port_unique(
        &servers,
        Some(&server_id),
        profile.port,
        profile.network_transport(),
        profile.server_type == "bedrock",
    )?;
    if profile.game_adapter().is_palworld() {
        let rest_port = profile
            .palworld_settings
            .as_ref()
            .ok_or_else(|| AppError::Validation("Palworld REST設定がありません".into()))?
            .rest_api_port;
        ensure_palworld_management_port_unique(&servers, Some(&server_id), rest_port)?;
        let game_port_probe = UdpSocket::bind(("0.0.0.0", profile.port)).map_err(|_| {
            AppError::Validation(format!(
                "Palworldゲーム用UDPポート {} は別のプロセスが使用中です",
                profile.port
            ))
        })?;
        let rest_port_probe = TcpListener::bind(("0.0.0.0", rest_port)).map_err(|_| {
            AppError::Validation(format!(
                "Palworld REST管理用TCPポート {rest_port} は別のプロセスが使用中です"
            ))
        })?;
        drop((game_port_probe, rest_port_probe));
    }
    drop(store);
    if !profile.game_adapter().is_palworld() {
        enforce_start_preflight(&profile)?;
    } else {
        let _ = credentials::load_palworld_admin_password(&profile.id)?;
        palworld::validate_server_layout(Path::new(&profile.root_path))?;
    }
    process::start(
        &app,
        &profile,
        &state.processes,
        &state.stopping_servers,
        &state.logs,
    )?;
    let _ = append_audit(
        &state.audit_dir,
        &server_id,
        "local-host",
        "server.restart",
        "source=desktop",
    );
    Ok(())
}

fn enforce_start_preflight(profile: &ServerProfile) -> AppResult<()> {
    let report = server_diagnosis::analyze(profile, &[], true);
    let blocking = report
        .issues
        .iter()
        .filter(|item| {
            matches!(
                item.id.as_str(),
                "java-missing"
                    | "java-version"
                    | "eula"
                    | "launch-target"
                    | "port-in-use"
                    | "world-generation-incomplete"
            )
        })
        .map(|item| item.what_happened.clone())
        .collect::<Vec<_>>();
    if blocking.is_empty() {
        Ok(())
    } else {
        Err(AppError::Validation(format!(
            "起動前診断で問題を見つけました: {}。概要の「サーバー診断」で次の操作を確認してください",
            blocking.join(" / ")
        )))
    }
}

#[tauri::command]
fn send_console_command(
    server_id: String,
    command: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    if profile.game_adapter().is_palworld() {
        return Err(AppError::Validation(
            "Palworldはコンソール入力ではなくローカルREST APIで安全に管理します".into(),
        ));
    }
    process::send_command(&server_id, &command, &state.processes)
}

#[tauri::command]
async fn save_palworld_world(server_id: String, state: State<'_, AppState>) -> AppResult<()> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    if !profile.game_adapter().is_palworld() {
        return Err(AppError::Validation(
            "この操作はPalworldサーバー専用です".into(),
        ));
    }
    if !process::is_running(&server_id, &state.processes) {
        return Err(AppError::NotRunning);
    }
    palworld::save_world(&profile).await?;
    append_audit(
        &state.audit_dir,
        &server_id,
        "local-host",
        "palworld.save",
        "source=desktop-rest",
    )
}

#[tauri::command]
fn update_palworld_settings(
    input: UpdatePalworldSettingsInput,
    state: State<'_, AppState>,
) -> AppResult<ServerProfile> {
    let _operation = state.co_operations.blocking_lock(&input.server_id);
    if process::is_busy(&input.server_id, &state.processes, &state.stopping_servers) {
        return Err(AppError::Validation(
            "Palworld設定を変更する前にサーバーを安全停止してください".into(),
        ));
    }
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 64 || name.chars().any(char::is_control) {
        return Err(AppError::Validation(
            "Palworldのサーバー名は制御文字を含めず1～64文字で入力してください".into(),
        ));
    }
    if let Some(password) = input.server_password.as_deref() {
        palworld::validate_password(password, true)?;
    }
    if let Some(password) = input.admin_password.as_deref() {
        palworld::validate_password(password, false)?;
    }
    palworld::validate_settings(input.game_port, &input.settings)?;

    let store = state.store.lock().unwrap();
    let mut profile = store.get_server(&input.server_id)?;
    if !profile.game_adapter().is_palworld() {
        return Err(AppError::Validation(
            "この操作はPalworldサーバー専用です".into(),
        ));
    }
    ensure_registered_port_unique(
        &store.list_servers()?,
        Some(&input.server_id),
        input.game_port,
        "udp",
        false,
    )?;
    ensure_palworld_management_port_unique(
        &store.list_servers()?,
        Some(&input.server_id),
        input.settings.rest_api_port,
    )?;
    let game_port_probe = UdpSocket::bind(("0.0.0.0", input.game_port)).map_err(|_| {
        AppError::Validation(format!(
            "Palworldゲーム用UDPポート {} は別のプロセスが使用中です",
            input.game_port
        ))
    })?;
    let rest_port_probe =
        TcpListener::bind(("0.0.0.0", input.settings.rest_api_port)).map_err(|_| {
            AppError::Validation(format!(
                "Palworld REST管理用TCPポート {} は別のプロセスが使用中です",
                input.settings.rest_api_port
            ))
        })?;
    drop((game_port_probe, rest_port_probe));

    let old_admin_password = credentials::load_palworld_admin_password(&input.server_id)?;
    let admin_password = input
        .admin_password
        .as_deref()
        .unwrap_or(old_admin_password.as_str());
    let mut settings = input.settings;
    settings.rest_api_enabled = true;
    settings.join_code_configured = input
        .server_password
        .as_ref()
        .map(|password| !password.is_empty())
        .unwrap_or_else(|| {
            profile
                .palworld_settings
                .as_ref()
                .is_some_and(|current| current.join_code_configured)
        });
    let config_backup = palworld::update_config(
        Path::new(&profile.root_path),
        name,
        input.game_port,
        &settings,
        admin_password,
        input.server_password.as_deref(),
    )?;

    let admin_changed = input.admin_password.is_some();
    if admin_changed {
        if let Err(error) =
            credentials::store_palworld_admin_password(&input.server_id, admin_password)
        {
            let _ = palworld::rollback_config(&config_backup);
            return Err(error);
        }
    }

    profile.name = name.into();
    profile.port = input.game_port;
    profile.palworld_settings = Some(settings);
    profile.pending_restart = true;
    profile.updated_at = Utc::now().to_rfc3339();
    if let Err(error) = store.update_server(&profile) {
        let _ = palworld::rollback_config(&config_backup);
        if admin_changed {
            let _ =
                credentials::store_palworld_admin_password(&input.server_id, &old_admin_password);
        }
        return Err(error);
    }
    co_management::record_local_change(
        &state.co_management_store.lock().unwrap(),
        &input.server_id,
        "local-host",
        "ホストPC",
        "palworld.settings.update",
        &profile,
    )?;
    append_audit(
        &state.audit_dir,
        &input.server_id,
        "local-host",
        "palworld.settings.update",
        &format!(
            "gamePort={}; restPort={}; configBackup={}; joinPasswordChanged={}; adminPasswordChanged={}",
            input.game_port,
            profile
                .palworld_settings
                .as_ref()
                .map(|value| value.rest_api_port)
                .unwrap_or_default(),
            palworld::config_backup_name(&config_backup),
            input.server_password.is_some(),
            admin_changed,
        ),
    )?;
    Ok(profile)
}

fn should_cleanup_external_access(runtime_state: &str) -> bool {
    matches!(runtime_state, "stopped" | "crashed")
}

#[tauri::command]
async fn get_runtime_status(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<RuntimeStatus> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let mut runtime = process::runtime_status(
        &profile,
        &state.processes,
        &state.stopping_servers,
        &state.logs,
    );
    if profile.game_adapter().is_palworld()
        && matches!(runtime.state.as_str(), "starting" | "running")
    {
        match palworld::monitor(&profile).await {
            Ok(snapshot) => {
                runtime.state = "running".into();
                runtime.player_count = snapshot.current_players;
                runtime.max_players = snapshot.max_players;
                runtime.uptime_seconds = snapshot.uptime_seconds;
                runtime.online_players = snapshot
                    .metrics
                    .players
                    .iter()
                    .map(|player| player.name.clone())
                    .collect();
                runtime.palworld = Some(snapshot.metrics);
            }
            Err(_) => {
                runtime.palworld = Some(crate::models::PalworldRuntimeMetrics {
                    api_reachable: false,
                    ..Default::default()
                });
            }
        }
    }
    // A graceful stop owns the Minecraft process until saving has completed.
    // Do not race the explicit stop command by spawning duplicate publication
    // and tunnel cleanup tasks from every status poll while state=stopping.
    let should_cleanup = should_cleanup_external_access(&runtime.state);
    if should_cleanup && invite::is_published(&server_id, &state.publications) {
        let publications = state.publications.clone();
        let cleanup_id = server_id.clone();
        std::thread::spawn(move || {
            let _ = invite::unpublish(&cleanup_id, &publications);
        });
    }
    if should_cleanup && state.tunnels.is_active(&server_id) {
        let tunnels = state.tunnels.clone();
        let store = state.store.clone();
        let cleanup_id = server_id.clone();
        let port = profile.port;
        let transport = profile.network_transport().to_string();
        std::thread::spawn(move || {
            let settings = store
                .lock()
                .unwrap()
                .get_tunnel_settings(&cleanup_id, port, &transport)
                .ok();
            if let Some(mut settings) = settings {
                if let Ok(status) = tunnels.stop_with_transport(
                    &cleanup_id,
                    port,
                    &transport,
                    settings.agent_path.clone(),
                ) {
                    let now = Utc::now().to_rfc3339();
                    settings.last_state = status.state;
                    settings.last_checked_at = Some(now.clone());
                    settings.updated_at = now;
                    let _ = store.lock().unwrap().save_tunnel_settings(&settings);
                }
            }
        });
    }
    let crossplay_id = crossplay_tunnel_id(&server_id);
    if should_cleanup && state.tunnels.is_active(&crossplay_id) {
        if let Some(port) = crossplay::registered_bedrock_port(&profile) {
            let tunnels = state.tunnels.clone();
            let store = state.store.clone();
            let cleanup_server_id = server_id.clone();
            std::thread::spawn(move || {
                let settings = store
                    .lock()
                    .unwrap()
                    .get_crossplay_tunnel_settings(&cleanup_server_id, port)
                    .ok();
                if let Some(mut settings) = settings {
                    if let Ok(status) = tunnels.stop_with_transport(
                        &crossplay_id,
                        port,
                        "udp",
                        settings.agent_path.clone(),
                    ) {
                        let now = Utc::now().to_rfc3339();
                        settings.last_state = status.state;
                        settings.last_checked_at = Some(now.clone());
                        settings.updated_at = now;
                        let _ = store
                            .lock()
                            .unwrap()
                            .save_crossplay_tunnel_settings(&settings);
                    }
                }
            });
        }
    }
    Ok(runtime)
}

#[tauri::command]
fn get_logs(server_id: String, state: State<'_, AppState>) -> Vec<LogEntry> {
    state
        .logs
        .lock()
        .unwrap()
        .get(&server_id)
        .cloned()
        .unwrap_or_default()
}

#[tauri::command]
fn clear_logs(server_id: String, state: State<'_, AppState>) {
    state.logs.lock().unwrap().remove(&server_id);
}

#[tauri::command]
fn save_logs(server_id: String, path: String, state: State<'_, AppState>) -> AppResult<()> {
    let destination = PathBuf::from(path);
    if !destination.is_absolute() {
        return Err(AppError::Validation(
            "ログの保存先は絶対パスで指定してください".into(),
        ));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::Validation("ログの保存先が正しくありません".into()))?;
    if !parent.is_dir() {
        return Err(AppError::Validation(
            "ログの保存先フォルダーが存在しません".into(),
        ));
    }
    let logs = state
        .logs
        .lock()
        .unwrap()
        .get(&server_id)
        .cloned()
        .unwrap_or_default();
    let text = logs
        .iter()
        .map(|entry| format!("[{}] [{}] {}", entry.timestamp, entry.level, entry.message))
        .collect::<Vec<_>>()
        .join("\r\n");
    std::fs::write(destination, text)?;
    Ok(())
}

#[tauri::command]
fn open_server_folder(server_id: String, state: State<'_, AppState>) -> AppResult<()> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let path = PathBuf::from(profile.root_path);
    if !path.is_dir() {
        return Err(AppError::Validation(
            "サーバーフォルダーが見つかりません".into(),
        ));
    }
    Command::new("explorer.exe").arg(path).spawn()?;
    Ok(())
}

#[tauri::command]
fn diagnose_pc(server_id: String, state: State<'_, AppState>) -> AppResult<PcDiagnosis> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    Ok(diagnostics::diagnose(&profile))
}

#[tauri::command]
fn diagnose_new_server(
    server_type: String,
    minecraft_version: String,
    parent_path: String,
) -> AppResult<PcDiagnosis> {
    let parent = PathBuf::from(parent_path);
    if !parent.is_dir() {
        return Err(AppError::Validation(
            "診断する保存先フォルダーを選択してください".into(),
        ));
    }
    let root = parent.canonicalize()?;
    let version = if minecraft_version.trim().is_empty() {
        "1.21.11"
    } else {
        minecraft_version.trim()
    };
    Ok(diagnostics::diagnose_new(&server_type, version, &root))
}

#[tauri::command]
async fn delete_server(
    input: DeleteServerInput,
    state: State<'_, AppState>,
) -> AppResult<DeleteServerResult> {
    let store = state.store.clone();
    let processes = state.processes.clone();
    let stopping_servers = state.stopping_servers.clone();
    let publications = state.publications.clone();
    let tunnels = state.tunnels.clone();
    let backups_dir = state.backups_dir.clone();
    let logs = state.logs.clone();
    let audit_dir = state.audit_dir.clone();
    let co_management_store = state.co_management_store.clone();
    let operation = state.co_operations.lock(&input.server_id).await;

    tokio::task::spawn_blocking(move || {
        let _operation = operation;
        if process::is_busy(&input.server_id, &processes, &stopping_servers) {
            return Err(AppError::Validation(
                "削除する前にサーバーを安全停止してください".into(),
            ));
        }
        let profile = store.lock().unwrap().get_server(&input.server_id)?;
        let host_id = co_management_store
            .lock()
            .unwrap()
            .config(&profile.id)?
            .and_then(|config| config.host_id);
        if !is_valid_delete_confirmation(&input.confirmation_text) {
            return Err(AppError::Validation(
                "削除確認には半角で「Delete」と入力してください".into(),
            ));
        }
        let backup_mode = input
            .delete_files
            .then(|| resolve_delete_backup_mode(input.backup_mode.as_deref(), &profile))
            .transpose()?;
        let _ = invite::unpublish(&profile.id, &publications);
        stop_tunnel_for_server_with(&profile.id, &store, &tunnels)?;

        let mut backup_path = None;
        if let Some(backup_mode) = backup_mode {
            backup_path = delete_server_files(&backups_dir, &profile, backup_mode)?;
        }

        store.lock().unwrap().delete_server(&profile.id)?;
        if let Some(host_id) = host_id {
            credentials::delete_co_management_host_token(&host_id)?;
        }
        if profile.game_adapter().is_palworld() {
            credentials::delete_palworld_admin_password(&profile.id)?;
        }
        logs.lock().unwrap().remove(&profile.id);
        let _ = append_audit(
            &audit_dir,
            &profile.id,
            "local-host",
            "server.delete",
            if input.delete_files {
                match input.backup_mode.as_deref() {
                    Some("essential") => "registration-and-files-essential-backup",
                    Some("none") => "registration-and-files-no-backup",
                    _ => "registration-and-files-full-backup",
                }
            } else {
                "registration-only"
            },
        );
        Ok(DeleteServerResult {
            deleted_files: input.delete_files,
            backup_path,
        })
    })
    .await
    .map_err(|error| AppError::Other(format!("削除処理を完了できませんでした: {error}")))?
}

const DELETE_CONFIRMATION_TEXT: &str = "Delete";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeleteBackupMode {
    Full,
    Essential,
    None,
}

fn is_valid_delete_confirmation(value: &str) -> bool {
    value == DELETE_CONFIRMATION_TEXT
}

fn resolve_delete_backup_mode(
    value: Option<&str>,
    profile: &ServerProfile,
) -> AppResult<DeleteBackupMode> {
    match value.unwrap_or("full") {
        "full" => Ok(DeleteBackupMode::Full),
        "essential" if profile.game_adapter().is_palworld() => Ok(DeleteBackupMode::Essential),
        "essential" => Err(AppError::Validation(
            "重要データだけの高速バックアップはPalworld専用です".into(),
        )),
        "none" => Ok(DeleteBackupMode::None),
        _ => Err(AppError::Validation(
            "削除時のバックアップ方法が正しくありません".into(),
        )),
    }
}

fn stop_tunnel_for_server_with(
    server_id: &str,
    store: &Arc<Mutex<Store>>,
    tunnels: &Arc<tunnel::TunnelManager>,
) -> AppResult<()> {
    let profile = store.lock().unwrap().get_server(server_id)?;
    if tunnels.is_active(server_id) {
        let settings = store.lock().unwrap().get_tunnel_settings(
            server_id,
            profile.port,
            profile.network_transport(),
        )?;
        let status = tunnels.stop_with_transport(
            server_id,
            profile.port,
            profile.network_transport(),
            settings.agent_path.clone(),
        )?;
        save_tunnel_runtime_state_to_store(store, &profile, settings, &status)?;
    }
    let crossplay_id = crossplay_tunnel_id(server_id);
    if tunnels.is_active(&crossplay_id) {
        if let Some(port) = crossplay::registered_bedrock_port(&profile) {
            let settings = store
                .lock()
                .unwrap()
                .get_crossplay_tunnel_settings(server_id, port)?;
            let status = tunnels.stop_with_transport(
                &crossplay_id,
                port,
                "udp",
                settings.agent_path.clone(),
            )?;
            save_crossplay_tunnel_runtime_state_to_store(store, settings, &status)?;
        }
    }
    Ok(())
}

fn crossplay_tunnel_id(server_id: &str) -> String {
    format!("{server_id}::bedrock")
}

fn crossplay_tunnel_target(profile: &ServerProfile) -> AppResult<(String, u16)> {
    if profile.server_type != "paper" {
        return Err(AppError::Validation(
            "統合版クロスプレイ招待はPaperサーバーだけに対応しています".into(),
        ));
    }
    let port = crossplay::registered_bedrock_port(profile).ok_or_else(|| {
        AppError::Validation("先にGeyserを導入し、統合版用UDPポートを登録してください".into())
    })?;
    Ok((crossplay_tunnel_id(&profile.id), port))
}

fn save_tunnel_runtime_state(
    state: &AppState,
    profile: &ServerProfile,
    settings: TunnelSettings,
    status: &TunnelStatus,
) -> AppResult<()> {
    save_tunnel_runtime_state_to_store(&state.store, profile, settings, status)
}

fn save_tunnel_runtime_state_to_store(
    store: &Arc<Mutex<Store>>,
    profile: &ServerProfile,
    mut settings: TunnelSettings,
    status: &TunnelStatus,
) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    settings.local_port = profile.port;
    settings.transport = profile.network_transport().into();
    settings.last_state = status.state.clone();
    settings.last_checked_at = Some(now.clone());
    settings.updated_at = now;
    store.lock().unwrap().save_tunnel_settings(&settings)
}

fn save_crossplay_tunnel_runtime_state(
    state: &AppState,
    settings: TunnelSettings,
    status: &TunnelStatus,
) -> AppResult<()> {
    save_crossplay_tunnel_runtime_state_to_store(&state.store, settings, status)
}

fn save_crossplay_tunnel_runtime_state_to_store(
    store: &Arc<Mutex<Store>>,
    mut settings: TunnelSettings,
    status: &TunnelStatus,
) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    settings.local_port = status.local_port;
    settings.transport = "udp".into();
    settings.last_state = status.state.clone();
    settings.last_checked_at = Some(now.clone());
    settings.updated_at = now;
    store
        .lock()
        .unwrap()
        .save_crossplay_tunnel_settings(&settings)
}

#[tauri::command]
async fn validate_tunnel_agent(
    input: ValidateTunnelAgentInput,
    state: State<'_, AppState>,
) -> AppResult<TunnelAgentValidation> {
    let profile = state.store.lock().unwrap().get_server(&input.server_id)?;
    let tunnels = state.tunnels.clone();
    let provider_id = input.provider_id.clone();
    let agent_path = input.agent_path.clone();
    let validation =
        tokio::task::spawn_blocking(move || tunnels.validate(&provider_id, Path::new(&agent_path)))
            .await
            .map_err(|error| AppError::Other(error.to_string()))??;
    let now = Utc::now().to_rfc3339();
    let mut settings = state.store.lock().unwrap().get_tunnel_settings(
        &profile.id,
        profile.port,
        profile.network_transport(),
    )?;
    settings.provider_id = input.provider_id;
    settings.agent_path = Some(validation.agent_path.clone());
    settings.local_port = profile.port;
    settings.transport = profile.network_transport().into();
    settings.last_state = "disconnected".into();
    settings.last_checked_at = Some(now.clone());
    settings.updated_at = now;
    state
        .store
        .lock()
        .unwrap()
        .save_tunnel_settings(&settings)?;
    Ok(validation)
}

fn save_validated_tunnel_agent(
    state: &AppState,
    profile: &ServerProfile,
    validation: &TunnelAgentValidation,
) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    let mut settings = state.store.lock().unwrap().get_tunnel_settings(
        &profile.id,
        profile.port,
        profile.network_transport(),
    )?;
    settings.provider_id = "playit".into();
    settings.agent_path = Some(validation.agent_path.clone());
    settings.local_port = profile.port;
    settings.transport = profile.network_transport().into();
    settings.last_state = "disconnected".into();
    settings.last_checked_at = Some(now.clone());
    settings.updated_at = now;
    state.store.lock().unwrap().save_tunnel_settings(&settings)
}

#[tauri::command]
async fn get_tunnel_agent_install_plan(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<TunnelAgentInstallPlan> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let settings = state.store.lock().unwrap().get_tunnel_settings(
        &server_id,
        profile.port,
        profile.network_transport(),
    )?;
    let tunnels = state.tunnels.clone();
    let requested = settings.agent_path.map(PathBuf::from);
    let installed = tokio::task::spawn_blocking(move || {
        tunnels.locate_and_validate("playit", requested.as_deref())
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))?
    .ok();
    if let Some(validation) = installed.as_ref() {
        save_validated_tunnel_agent(&state, &profile, validation)?;
    }
    Ok(playit_installer::plan(&state.tunnel_install_dir, installed))
}

#[tauri::command]
async fn install_tunnel_agent(
    input: InstallTunnelAgentInput,
    state: State<'_, AppState>,
) -> AppResult<TunnelAgentValidation> {
    let profile = state.store.lock().unwrap().get_server(&input.server_id)?;
    playit_installer::download_and_install(&state.client, &state.tunnel_install_dir, &input)
        .await?;
    let tunnels = state.tunnels.clone();
    let validation =
        tokio::task::spawn_blocking(move || tunnels.locate_and_validate("playit", None))
            .await
            .map_err(|error| AppError::Other(error.to_string()))??;
    save_validated_tunnel_agent(&state, &profile, &validation)?;
    Ok(validation)
}

#[tauri::command]
async fn get_tunnel_status(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<TunnelStatus> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let settings = state.store.lock().unwrap().get_tunnel_settings(
        &server_id,
        profile.port,
        profile.network_transport(),
    )?;
    let tunnels = state.tunnels.clone();
    let status_id = server_id.clone();
    let agent_path = settings.agent_path.clone();
    let port = profile.port;
    let transport = profile.network_transport().to_string();
    let mut status = tokio::task::spawn_blocking(move || {
        tunnels.status_with_transport(&status_id, port, &transport, agent_path)
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))??;
    status.terms_acknowledged = settings.terms_acknowledged_at.is_some();
    if settings.last_state != status.state {
        save_tunnel_runtime_state(&state, &profile, settings, &status)?;
    }
    Ok(status)
}

#[tauri::command]
async fn start_tunnel(
    input: StartTunnelInput,
    state: State<'_, AppState>,
) -> AppResult<TunnelStatus> {
    let profile = state.store.lock().unwrap().get_server(&input.server_id)?;
    let existing_settings = state.store.lock().unwrap().get_tunnel_settings(
        &input.server_id,
        profile.port,
        profile.network_transport(),
    )?;
    if !input.terms_accepted && existing_settings.terms_acknowledged_at.is_none() {
        return Err(AppError::Validation(
            "playit.ggの利用規約とプライバシーポリシーを確認してください".into(),
        ));
    }
    validate_public_access_profile(&profile)?;
    if !process::is_running(&profile.id, &state.processes) {
        return Err(AppError::Validation(
            "先にMinecraftサーバーを起動してください".into(),
        ));
    }
    let tunnels = state.tunnels.clone();
    let start_id = profile.id.clone();
    let provider_id = input.provider_id.clone();
    let agent_path = input.agent_path.clone();
    let port = profile.port;
    let transport = profile.network_transport().to_string();
    let mut status = tokio::task::spawn_blocking(move || {
        tunnels.start_with_transport(
            &start_id,
            &provider_id,
            Path::new(&agent_path),
            port,
            &transport,
        )
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))??;
    let now = Utc::now().to_rfc3339();
    let mut settings = state.store.lock().unwrap().get_tunnel_settings(
        &profile.id,
        profile.port,
        profile.network_transport(),
    )?;
    settings.provider_id = input.provider_id;
    settings.agent_path = status.agent_path.clone();
    if input.terms_accepted || settings.terms_acknowledged_at.is_none() {
        settings.terms_acknowledged_at = Some(now.clone());
    }
    status.terms_acknowledged = true;
    settings.updated_at = now;
    save_tunnel_runtime_state(&state, &profile, settings, &status)?;
    Ok(status)
}

#[tauri::command]
async fn quick_start_tunnel(
    input: QuickStartTunnelInput,
    state: State<'_, AppState>,
) -> AppResult<TunnelStatus> {
    let profile = state.store.lock().unwrap().get_server(&input.server_id)?;
    validate_public_access_profile(&profile)?;
    if !process::is_running(&profile.id, &state.processes) {
        return Err(AppError::Validation(
            "Minecraftサーバーを起動できませんでした。先にサーバー診断を確認してください".into(),
        ));
    }
    let mut settings = state.store.lock().unwrap().get_tunnel_settings(
        &profile.id,
        profile.port,
        profile.network_transport(),
    )?;
    if !input.terms_accepted && settings.terms_acknowledged_at.is_none() {
        return Err(AppError::Validation(
            "初回だけ、playit.ggの利用規約とプライバシーポリシーを確認してください".into(),
        ));
    }

    let tunnels = state.tunnels.clone();
    let start_id = profile.id.clone();
    let requested_path = settings.agent_path.clone().map(PathBuf::from);
    let port = profile.port;
    let transport = profile.network_transport().to_string();
    let (mut status, validation) = tokio::task::spawn_blocking(move || {
        let validation = tunnels.locate_and_validate("playit", requested_path.as_deref())?;
        if !tunnel::wait_for_local_port_transport(port, &transport, Duration::from_secs(45)) {
            return Err(AppError::Validation(format!(
                "Minecraftサーバーのポート {port} が45秒以内に準備できませんでした。サーバー診断を確認してください"
            )));
        }
        let mut status = tunnels.start_with_transport(
            &start_id,
            "playit",
            Path::new(&validation.agent_path),
            port,
            &transport,
        )?;
        let endpoint_deadline = std::time::Instant::now() + Duration::from_secs(15);
        while status.public_endpoint.is_none()
            && matches!(status.state.as_str(), "starting" | "running")
            && std::time::Instant::now() < endpoint_deadline
        {
            std::thread::sleep(Duration::from_millis(500));
            status = tunnels.status_with_transport(
                &start_id,
                port,
                &transport,
                Some(validation.agent_path.clone()),
            )?;
        }
        Ok::<_, AppError>((status, validation))
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))??;

    let now = Utc::now().to_rfc3339();
    settings.provider_id = "playit".into();
    settings.agent_path = Some(validation.agent_path);
    settings.local_port = profile.port;
    settings.transport = profile.network_transport().into();
    if input.terms_accepted || settings.terms_acknowledged_at.is_none() {
        settings.terms_acknowledged_at = Some(now.clone());
    }
    settings.updated_at = now;
    status.terms_acknowledged = true;
    save_tunnel_runtime_state(&state, &profile, settings, &status)?;
    Ok(status)
}

#[tauri::command]
async fn stop_tunnel(server_id: String, state: State<'_, AppState>) -> AppResult<TunnelStatus> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let settings = state.store.lock().unwrap().get_tunnel_settings(
        &server_id,
        profile.port,
        profile.network_transport(),
    )?;
    let tunnels = state.tunnels.clone();
    let stop_id = server_id.clone();
    let agent_path = settings.agent_path.clone();
    let port = profile.port;
    let transport = profile.network_transport().to_string();
    let mut status = tokio::task::spawn_blocking(move || {
        tunnels.stop_with_transport(&stop_id, port, &transport, agent_path)
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))??;
    status.terms_acknowledged = settings.terms_acknowledged_at.is_some();
    save_tunnel_runtime_state(&state, &profile, settings, &status)?;
    Ok(status)
}

#[tauri::command]
async fn quick_start_palworld_tunnel(
    input: QuickStartTunnelInput,
    state: State<'_, AppState>,
) -> AppResult<TunnelStatus> {
    let profile = state.store.lock().unwrap().get_server(&input.server_id)?;
    if !profile.game_adapter().is_palworld() {
        return Err(AppError::Validation("Palworld server required".into()));
    }
    let mut settings =
        state
            .store
            .lock()
            .unwrap()
            .get_tunnel_settings(&profile.id, profile.port, "udp")?;
    if !input.terms_accepted && settings.terms_acknowledged_at.is_none() {
        return Err(AppError::Validation(
            "Review playit.gg terms and privacy before inviting friends.".into(),
        ));
    }
    if !process::is_running(&profile.id, &state.processes) {
        return Err(AppError::Validation(
            "Start the Palworld server first.".into(),
        ));
    }
    // Palworld is not RakNet. Authenticate against this profile's local REST API instead.
    palworld::monitor(&profile).await?;
    let tunnels = state.tunnels.clone();
    let id = profile.id.clone();
    let port = profile.port;
    let requested = settings.agent_path.clone().map(PathBuf::from);
    let (mut status, validation) = tokio::task::spawn_blocking(move || {
        let validation = tunnels.locate_and_validate("playit", requested.as_deref())?;
        let status = tunnels.start_palworld(&id, Path::new(&validation.agent_path), port)?;
        Ok::<_, AppError>((status, validation))
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))??;
    settings.provider_id = "playit".into();
    settings.agent_path = Some(validation.agent_path);
    settings.terms_acknowledged_at = Some(Utc::now().to_rfc3339());
    settings.updated_at = Utc::now().to_rfc3339();
    status.terms_acknowledged = true;
    save_tunnel_runtime_state(&state, &profile, settings, &status)?;
    Ok(status)
}

#[tauri::command]
async fn diagnose_tunnel(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<TunnelDiagnosis> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let settings = state.store.lock().unwrap().get_tunnel_settings(
        &server_id,
        profile.port,
        profile.network_transport(),
    )?;
    let server_running = process::is_running(&server_id, &state.processes);
    let agent_configured = settings.agent_path.is_some();
    let tunnels = state.tunnels.clone();
    let provider_id = settings.provider_id.clone();
    let agent_path = settings.agent_path.clone();
    let port = profile.port;
    let transport = profile.network_transport().to_string();
    let diagnosis_transport = transport.clone();
    let (local_port_listening, agent_verified) = tokio::task::spawn_blocking(move || {
        (
            tunnel::local_port_listening_for(port, &diagnosis_transport),
            agent_path
                .as_ref()
                .is_some_and(|path| tunnels.validate(&provider_id, Path::new(path)).is_ok()),
        )
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))?;
    let agent_running = state.tunnels.is_active(&server_id);
    let tunnel_status = if agent_running {
        let tunnels = state.tunnels.clone();
        let status_id = server_id.clone();
        let status_path = settings.agent_path.clone();
        let status_transport = transport.clone();
        Some(
            tokio::task::spawn_blocking(move || {
                tunnels.status_with_transport(&status_id, port, &status_transport, status_path)
            })
            .await
            .map_err(|error| AppError::Other(error.to_string()))??,
        )
    } else {
        None
    };
    let provider_authenticated = tunnel_status.as_ref().is_some_and(|status| {
        matches!(
            status.account_state.as_str(),
            "guest" | "email_not_verified" | "verified"
        )
    });
    let matching_tunnel = tunnel_status
        .as_ref()
        .is_some_and(|status| status.matching_tunnel);
    let tunnel_connected = tunnel_status
        .as_ref()
        .is_some_and(|status| status.state == "connected" && status.public_endpoint.is_some());
    let endpoint_available = tunnel_status
        .as_ref()
        .is_some_and(|status| status.public_endpoint.is_some());
    let mut items = Vec::new();
    items.push(
        if server_running {
            "Minecraftサーバープロセスは起動しています"
        } else {
            "Minecraftサーバーが起動していません"
        }
        .into(),
    );
    items.push(if local_port_listening {
        format!("127.0.0.1:{} は待受状態です", profile.port)
    } else {
        format!("127.0.0.1:{} は待受状態ではありません", profile.port)
    });
    items.push(
        if agent_configured {
            "エージェントの保存先は設定済みです"
        } else {
            "トンネルエージェントが選択されていません"
        }
        .into(),
    );
    items.push(
        if agent_verified {
            "エージェントの公式署名を確認できました"
        } else {
            "エージェントの公式署名は未確認です"
        }
        .into(),
    );
    items.push(
        if provider_authenticated {
            "playit.ggのアカウント状態を公式IPCで確認できました"
        } else {
            "playit.ggのログインまたはセットアップが必要です"
        }
        .into(),
    );
    items.push(if matching_tunnel {
        format!(
            "127.0.0.1:{} 専用のトンネル設定を確認しました",
            profile.port
        )
    } else {
        "このMinecraftポート専用のトンネル設定がありません".into()
    });
    items.push(
        if endpoint_available {
            "公開接続先を公式IPCから取得できました"
        } else {
            "公開接続先はまだ取得できません"
        }
        .into(),
    );
    items.push("別の家からのMinecraft実参加は、別回線での手動確認が必要です".into());
    Ok(TunnelDiagnosis {
        checked_at: Utc::now().to_rfc3339(),
        server_running,
        local_port_listening,
        transport: profile.network_transport().into(),
        agent_configured,
        agent_verified,
        agent_running,
        provider_authenticated,
        matching_tunnel,
        tunnel_connected,
        endpoint_available,
        items,
    })
}

#[tauri::command]
async fn open_tunnel_account_login(server_id: String, state: State<'_, AppState>) -> AppResult<()> {
    let tunnels = state.tunnels.clone();
    tokio::task::spawn_blocking(move || tunnels.open_account_login(&server_id))
        .await
        .map_err(|error| AppError::Other(error.to_string()))?
}

#[tauri::command]
async fn open_tunnel_dashboard(_server_id: String) -> AppResult<()> {
    tokio::task::spawn_blocking(tunnel::open_tunnel_dashboard)
        .await
        .map_err(|error| AppError::Other(error.to_string()))?
}

#[tauri::command]
async fn probe_tunnel_endpoint(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<TunnelExternalProbe> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let tunnels = state.tunnels.clone();
    let transport = profile.network_transport().to_string();
    tokio::task::spawn_blocking(move || {
        tunnels.probe_public_endpoint_with_transport(&server_id, &transport)
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))?
}

fn delete_server_files(
    backups_dir: &Path,
    profile: &ServerProfile,
    backup_mode: DeleteBackupMode,
) -> AppResult<Option<String>> {
    let root = validate_server_delete_target(profile)?;
    let backup_path = match backup_mode {
        DeleteBackupMode::Full => {
            Some(backup::create(backups_dir, profile, "before-server-delete")?.path)
        }
        DeleteBackupMode::Essential => Some(
            backup::create_palworld_essential(backups_dir, profile, "before-server-delete")?.path,
        ),
        DeleteBackupMode::None => None,
    };
    std::fs::remove_dir_all(&root)?;
    Ok(backup_path)
}

fn validate_server_delete_target(profile: &ServerProfile) -> AppResult<PathBuf> {
    let path = Path::new(&profile.root_path);
    if !path.is_dir() {
        return Err(AppError::Validation(
            "削除対象のサーバーフォルダーが見つかりません".into(),
        ));
    }
    let root = path.canonicalize()?;
    if root.parent().is_none() || root.components().count() < 3 {
        return Err(AppError::Validation(
            "安全のため、広すぎるフォルダーは削除できません".into(),
        ));
    }
    if profile.game_adapter().is_palworld() {
        palworld::validate_server_layout(&root).map_err(|_| {
            AppError::Validation(
                "Palworld公式サーバーの実行ファイルと既定設定を確認できないため、フォルダーを削除できません"
                    .into(),
            )
        })?;
    } else if !root.join("server.properties").is_file() {
        return Err(AppError::Validation(
            "server.propertiesがないため、サーバーフォルダーとして削除できません".into(),
        ));
    }
    if let Some(home) =
        std::env::var_os("USERPROFILE").and_then(|value| PathBuf::from(value).canonicalize().ok())
    {
        let protected = [
            home.clone(),
            home.join("Desktop"),
            home.join("Documents"),
            home.join("Downloads"),
        ];
        if protected.iter().any(|item| item == &root) {
            return Err(AppError::Validation(
                "ユーザーフォルダーや標準フォルダー自体は削除できません".into(),
            ));
        }
    }
    Ok(root)
}

#[tauri::command]
fn analyze_server(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<ServerDiagnosisReport> {
    let store = state.store.lock().unwrap();
    let profile = store.get_server(&server_id)?;
    require_minecraft(&profile, "Minecraftサーバー診断")?;
    let servers = store.list_servers()?;
    drop(store);
    let running = process::is_running(&server_id, &state.processes);
    let logs = state
        .logs
        .lock()
        .unwrap()
        .get(&server_id)
        .cloned()
        .unwrap_or_default();
    let mut report = server_diagnosis::analyze(&profile, &logs, !running);
    if let Some(owner) = servers
        .iter()
        .find(|server| server.id != server_id && server.port == profile.port)
    {
        report.healthy = false;
        report.issues.insert(
            0,
            DiagnosisIssue {
                id: "registered-port-conflict".into(),
                severity: "error".into(),
                what_happened: format!(
                    "ポート {} が「{}」と重複しています",
                    profile.port, owner.name
                ),
                impact: "2台を同時に起動できず、後から起動したサーバーが停止します。".into(),
                likely_cause: "複数の登録済みサーバーに同じMinecraftポートが設定されています。"
                    .into(),
                next_actions: vec![
                    "設定で空きポートを選び、片方を別ポートへ変更してください。".into(),
                ],
                related_logs: Vec::new(),
                suggest_restore: false,
            },
        );
    }
    Ok(report)
}

#[tauri::command]
fn list_backups(server_id: String, state: State<'_, AppState>) -> AppResult<Vec<BackupInfo>> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    require_minecraft(&profile, "現行バックアップ")?;
    backup::list(&state.backups_dir, &server_id)
}

#[tauri::command]
async fn create_backup(
    server_id: String,
    label: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> AppResult<BackupInfo> {
    let _operation = state.co_operations.lock(&server_id).await;
    if process::is_busy(&server_id, &state.processes, &state.stopping_servers) {
        return Err(AppError::Validation(
            "整合性のあるバックアップを作るため、先にサーバーを停止してください".into(),
        ));
    }
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    require_minecraft(&profile, "現行バックアップ")?;
    let server_name = profile.name.clone();
    let backups_dir = state.backups_dir.clone();
    let audit_dir = state.audit_dir.clone();
    let progress_app = app.clone();
    let result = tokio::task::spawn_blocking(move || {
        backup::create_with_progress(&backups_dir, &profile, &label, |progress| {
            let _ = progress_app.emit("backup-progress", progress.clone());
        })
    })
    .await
    .map_err(|error| AppError::Other(format!("バックアップ処理を完了できませんでした: {error}")))
    .and_then(|value| value);
    let result = match result {
        Ok(value) => value,
        Err(error) => {
            if state
                .store
                .lock()
                .unwrap()
                .automation_settings(&server_id)
                .is_ok_and(|settings| settings.notify_backup_failure)
            {
                emit_local_notification(
                    &app,
                    &server_id,
                    "backup-failure",
                    "バックアップに失敗しました",
                    format!(
                        "{} の保存先容量とファイル権限を確認してください。",
                        server_name
                    ),
                );
            }
            return Err(error);
        }
    };
    append_audit(
        &audit_dir,
        &server_id,
        "local-host",
        "backup.create",
        &result.id,
    )?;
    Ok(result)
}

#[tauri::command]
fn restore_backup(
    server_id: String,
    backup_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let _operation = state.co_operations.blocking_lock(&server_id);
    if process::is_busy(&server_id, &state.processes, &state.stopping_servers) {
        return Err(AppError::Validation(
            "復元する前にサーバーを停止してください".into(),
        ));
    }
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    require_minecraft(&profile, "バックアップ復元")?;
    backup::restore(&state.backups_dir, &profile, &backup_id)?;
    co_management::record_local_change(
        &state.co_management_store.lock().unwrap(),
        &server_id,
        "local-host",
        "ホストPC",
        "backup.restore",
        &profile,
    )?;
    append_audit(
        &state.audit_dir,
        &server_id,
        "local-host",
        "backup.restore",
        &backup_id,
    )
}

#[tauri::command]
fn verify_backup(
    server_id: String,
    backup_id: String,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    require_minecraft(&profile, "バックアップ検証")?;
    backup::verify(&state.backups_dir, &server_id, &backup_id)
}

#[tauri::command]
fn delete_backup(
    server_id: String,
    backup_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    require_minecraft(&profile, "バックアップ削除")?;
    backup::delete(&state.backups_dir, &server_id, &backup_id)?;
    append_audit(
        &state.audit_dir,
        &server_id,
        "local-host",
        "backup.delete",
        &backup_id,
    )
}

#[tauri::command]
fn open_backup_folder(server_id: String, state: State<'_, AppState>) -> AppResult<()> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    require_minecraft(&profile, "現行バックアップ")?;
    let folder = state.backups_dir.join(&server_id);
    std::fs::create_dir_all(&folder)?;
    Command::new("explorer.exe").arg(folder).spawn()?;
    Ok(())
}

#[tauri::command]
fn update_server_settings(
    server_id: String,
    settings: BasicSettings,
    max_memory_mib: u32,
    port: u16,
    state: State<'_, AppState>,
) -> AppResult<ServerProfile> {
    let _operation = state.co_operations.blocking_lock(&server_id);
    if process::is_busy(&server_id, &state.processes, &state.stopping_servers) {
        return Err(AppError::Validation(
            "安全バックアップと設定変更のため、先にサーバーを停止してください".into(),
        ));
    }
    let store = state.store.lock().unwrap();
    let mut profile = store.get_server(&server_id)?;
    require_minecraft(&profile, "Minecraftサーバー設定")?;
    settings::validate_for_server_type(&profile.server_type, &settings, max_memory_mib, port)?;
    ensure_registered_port_unique(
        &store.list_servers()?,
        Some(&server_id),
        port,
        profile.network_transport(),
        profile.server_type == "bedrock",
    )?;
    let backup_info = backup::create(&state.backups_dir, &profile, "before-settings")?;
    settings::apply(&mut profile, settings, max_memory_mib, port)?;
    store.update_server(&profile)?;
    co_management::record_local_change(
        &state.co_management_store.lock().unwrap(),
        &server_id,
        "local-host",
        "ホストPC",
        "settings.update",
        &profile,
    )?;
    append_audit(
        &state.audit_dir,
        &server_id,
        "local-host",
        "settings.update",
        &format!("safetyBackup={}", backup_info.id),
    )?;
    Ok(profile)
}

#[tauri::command]
fn regenerate_world(
    input: RegenerateWorldInput,
    state: State<'_, AppState>,
) -> AppResult<WorldRegenerationResult> {
    let _operation = state.co_operations.blocking_lock(&input.server_id);
    if process::is_busy(&input.server_id, &state.processes, &state.stopping_servers) {
        return Err(AppError::Validation(
            "ワールドを再生成する前にサーバーを安全停止してください".into(),
        ));
    }
    let store = state.store.lock().unwrap();
    let original = store.get_server(&input.server_id)?;
    require_minecraft(&original, "Minecraftワールド再生成")?;
    if input.confirmation_name.trim() != original.name {
        return Err(AppError::Validation(
            "確認用のサーバー名が一致しません".into(),
        ));
    }
    settings::validate_for_server_type(
        &original.server_type,
        &input.settings,
        input.max_memory_mib,
        input.port,
    )?;
    ensure_registered_port_unique(
        &store.list_servers()?,
        Some(&input.server_id),
        input.port,
        original.network_transport(),
        original.server_type == "bedrock",
    )?;

    let (safety_backup, removed_world_folders) =
        world_maintenance::regenerate(&state.backups_dir, &original)?;
    let mut updated = original.clone();
    if let Err(error) = settings::apply(
        &mut updated,
        input.settings,
        input.max_memory_mib,
        input.port,
    ) {
        let _ = backup::restore(&state.backups_dir, &original, &safety_backup.id);
        return Err(AppError::Other(format!(
            "設定の反映に失敗したため、再生成前バックアップから元へ戻しました: {error}"
        )));
    }
    if let Err(error) = store.update_server(&updated) {
        let _ = backup::restore(&state.backups_dir, &original, &safety_backup.id);
        return Err(AppError::Other(format!(
            "設定情報の保存に失敗したため、再生成前バックアップから元へ戻しました: {error}"
        )));
    }
    co_management::record_local_change(
        &state.co_management_store.lock().unwrap(),
        &input.server_id,
        "local-host",
        "ホストPC",
        "world.regenerate",
        &updated,
    )?;
    append_audit(
        &state.audit_dir,
        &input.server_id,
        "local-host",
        "world.regenerate",
        &format!(
            "backup={}; folders={}",
            safety_backup.id,
            removed_world_folders.join(",")
        ),
    )?;
    Ok(WorldRegenerationResult {
        server: updated,
        backup: safety_backup,
        removed_world_folders,
    })
}

#[tauri::command]
fn list_extensions(server_id: String, state: State<'_, AppState>) -> AppResult<Vec<ExtensionInfo>> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    extensions::list(&profile)
}

#[tauri::command]
fn install_local_extension(
    server_id: String,
    source: String,
    kind: String,
    state: State<'_, AppState>,
) -> AppResult<ExtensionInfo> {
    if process::is_busy(&server_id, &state.processes, &state.stopping_servers) {
        return Err(AppError::Validation(
            "拡張機能を追加する前にサーバーを停止してください".into(),
        ));
    }
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let _ = backup::create(&state.backups_dir, &profile, "before-extension")?;
    let info = extensions::install_local(&profile, &source, &kind)?;
    append_audit(
        &state.audit_dir,
        &server_id,
        "local-host",
        "extension.install",
        &format!("{}:{}", kind, info.file_name),
    )?;
    Ok(info)
}

#[tauri::command]
fn set_extension_enabled(
    server_id: String,
    file_name: String,
    kind: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if process::is_busy(&server_id, &state.processes, &state.stopping_servers) {
        return Err(AppError::Validation(
            "拡張機能の有効状態を変える前にサーバーを停止してください".into(),
        ));
    }
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let _ = backup::create(&state.backups_dir, &profile, "before-extension")?;
    extensions::set_enabled(&profile, &file_name, &kind, enabled)?;
    append_audit(
        &state.audit_dir,
        &server_id,
        "local-host",
        "extension.toggle",
        &format!("{}:{} enabled={enabled}", kind, file_name),
    )
}

#[tauri::command]
fn remove_extension(
    server_id: String,
    file_name: String,
    kind: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    if process::is_busy(&server_id, &state.processes, &state.stopping_servers) {
        return Err(AppError::Validation(
            "拡張機能を削除する前にサーバーを停止してください".into(),
        ));
    }
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let _ = backup::create(&state.backups_dir, &profile, "before-extension-remove")?;
    extensions::remove(&profile, &file_name, &kind)?;
    append_audit(
        &state.audit_dir,
        &server_id,
        "local-host",
        "extension.remove",
        &format!("{}:{}", kind, file_name),
    )
}

#[tauri::command]
async fn search_extensions(
    server_id: String,
    query: String,
    kind: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<extensions::SearchHit>> {
    let profile = { state.store.lock().unwrap().get_server(&server_id)? };
    extensions::search_modrinth(&state.client, &profile, query.trim(), &kind).await
}

#[tauri::command]
async fn list_extension_versions(
    server_id: String,
    project_id: String,
    kind: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<ExtensionVersionOption>> {
    let profile = { state.store.lock().unwrap().get_server(&server_id)? };
    extensions::list_modrinth_versions(&state.client, &profile, &project_id, &kind).await
}

#[tauri::command]
async fn plan_extension_install(
    server_id: String,
    version_id: String,
    kind: String,
    state: State<'_, AppState>,
) -> AppResult<ExtensionInstallPlan> {
    let profile = { state.store.lock().unwrap().get_server(&server_id)? };
    extensions::plan_modrinth_install(&state.client, &profile, &version_id, &kind).await
}

#[tauri::command]
async fn install_catalog_extension(
    server_id: String,
    version_id: String,
    kind: String,
    state: State<'_, AppState>,
) -> AppResult<ExtensionInstallPlan> {
    if process::is_busy(&server_id, &state.processes, &state.stopping_servers) {
        return Err(AppError::Validation(
            "Mod／プラグインを導入する前にサーバーを停止してください".into(),
        ));
    }
    let profile = { state.store.lock().unwrap().get_server(&server_id)? };
    let plan = extensions::install_modrinth(
        &state.client,
        &state.backups_dir,
        &profile,
        &version_id,
        &kind,
    )
    .await?;
    append_audit(
        &state.audit_dir,
        &server_id,
        "local-host",
        "extension.catalog-install",
        &format!("provider=modrinth items={}", plan.items.len()),
    )?;
    Ok(plan)
}

#[tauri::command]
fn get_invite_info(server_id: String, state: State<'_, AppState>) -> AppResult<InviteInfo> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    require_minecraft(&profile, "友達招待")?;
    Ok(invite::info(&profile))
}

#[tauri::command]
fn get_invite_settings(server_id: String, state: State<'_, AppState>) -> AppResult<InviteSettings> {
    let store = state.store.lock().unwrap();
    let profile = store.get_server(&server_id)?;
    require_minecraft(&profile, "友達招待")?;
    store.get_invite_settings(&server_id, &profile.name)
}

#[tauri::command]
async fn update_invite_settings(
    input: UpdateInviteSettingsInput,
    state: State<'_, AppState>,
) -> AppResult<InviteSettings> {
    let (invite_name, custom_hostname) =
        invite::normalize_settings(&input.invite_name, input.custom_hostname.as_deref())?;
    let settings = InviteSettings {
        invite_name,
        custom_hostname,
        updated_at: Utc::now().to_rfc3339(),
    };
    {
        let store = state.store.lock().unwrap();
        let profile = store.get_server(&input.server_id)?;
        require_minecraft(&profile, "友達招待")?;
        store.save_invite_settings(&input.server_id, &settings)?;
    }
    let publications = state.publications.clone();
    let update_id = input.server_id.clone();
    let update_settings = settings.clone();
    tokio::task::spawn_blocking(move || {
        invite::update_publication_settings(&update_id, &update_settings, &publications)
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))?;
    let state_label = if settings.custom_hostname.is_some() {
        "configured"
    } else {
        "none"
    };
    let _ = append_audit(
        &state.audit_dir,
        &input.server_id,
        "local-host",
        "invite-settings.update",
        &format!("customHostname={state_label}"),
    );
    Ok(settings)
}

#[tauri::command]
fn get_public_access_status(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<PublicAccessStatus> {
    let store = state.store.lock().unwrap();
    let profile = store.get_server(&server_id)?;
    let settings = store.get_invite_settings(&server_id, &profile.name)?;
    Ok(invite::status(&server_id, &settings, &state.publications))
}

#[tauri::command]
async fn publish_server_upnp(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<PublicAccessStatus> {
    let (profile, settings) = {
        let store = state.store.lock().unwrap();
        let profile = store.get_server(&server_id)?;
        let settings = store.get_invite_settings(&server_id, &profile.name)?;
        (profile, settings)
    };
    if !process::is_running(&server_id, &state.processes) {
        return Err(AppError::Validation(
            "先にMinecraftサーバーを起動してください".into(),
        ));
    }
    if profile.game_adapter().is_palworld() {
        palworld::monitor(&profile).await?;
    } else {
        validate_public_access_profile(&profile)?;
    }
    let current = invite::status(&server_id, &settings, &state.publications);
    if matches!(current.state.as_str(), "published" | "warning") {
        return Ok(current);
    }
    let publications = state.publications.clone();
    let publish_id = server_id.clone();
    let port = profile.port;
    let transport = profile.network_transport().to_string();
    let result = tokio::task::spawn_blocking(move || {
        invite::publish(&publish_id, port, &transport, &settings, &publications)
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))??;
    let _ = append_audit(
        &state.audit_dir,
        &server_id,
        "local-host",
        "public-access.start",
        "method=UPnP address=redacted",
    );
    Ok(result)
}

fn validate_public_access_profile(profile: &ServerProfile) -> AppResult<()> {
    require_minecraft(profile, "Minecraft公開・トンネル")?;
    if !profile.settings.whitelist {
        return Err(AppError::Validation(
            "安全のため、設定画面でホワイトリストを有効にしてから公開してください".into(),
        ));
    }
    if !profile.settings.online_mode {
        return Err(AppError::Validation("認証が無効なサーバーは、プレイヤー名のなりすましを防げないためインターネット公開できません".into()));
    }
    Ok(())
}

#[tauri::command]
async fn unpublish_server(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<PublicAccessStatus> {
    let settings = {
        let store = state.store.lock().unwrap();
        let profile = store.get_server(&server_id)?;
        store.get_invite_settings(&server_id, &profile.name)?
    };
    let publications = state.publications.clone();
    let cleanup_id = server_id.clone();
    tokio::task::spawn_blocking(move || invite::unpublish(&cleanup_id, &publications))
        .await
        .map_err(|error| AppError::Other(error.to_string()))??;
    let _ = append_audit(
        &state.audit_dir,
        &server_id,
        "local-host",
        "public-access.stop",
        "method=UPnP",
    );
    Ok(invite::status(&server_id, &settings, &state.publications))
}

#[tauri::command]
fn list_audit_log(server_id: String, state: State<'_, AppState>) -> AppResult<Vec<AuditEntry>> {
    state.store.lock().unwrap().get_server(&server_id)?;
    let path = state.audit_dir.join(format!("{server_id}.jsonl"));
    read_recent_audit(&path, 2_000)
}

fn read_recent_audit(path: &Path, limit: usize) -> AppResult<Vec<AuditEntry>> {
    if !path.is_file() || limit == 0 {
        return Ok(Vec::new());
    }
    let mut entries = VecDeque::with_capacity(limit.min(2_000));
    for line in BufReader::new(std::fs::File::open(path)?)
        .lines()
        .map_while(Result::ok)
    {
        let Ok(entry) = serde_json::from_str::<AuditEntry>(&line) else {
            continue;
        };
        if entries.len() == limit {
            entries.pop_front();
        }
        entries.push_back(entry);
    }
    Ok(entries.into_iter().rev().collect())
}

#[tauri::command]
fn list_whitelist(server_id: String, state: State<'_, AppState>) -> AppResult<Vec<WhitelistEntry>> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let path = Path::new(&profile.root_path).join("whitelist.json");
    if !path.is_file() {
        return Ok(Vec::new());
    }
    serde_json::from_slice(&std::fs::read(path)?).map_err(Into::into)
}

#[tauri::command]
fn update_whitelist_player(
    server_id: String,
    player_name: String,
    add: bool,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let valid = (3..=16).contains(&player_name.len())
        && player_name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_');
    if !valid {
        return Err(AppError::Validation(
            "プレイヤー名は英数字と_の3～16文字で入力してください".into(),
        ));
    }
    if !process::is_running(&server_id, &state.processes) {
        return Err(AppError::Validation(
            "ホワイトリストを変更するにはサーバーを起動してください".into(),
        ));
    }
    process::send_command(
        &server_id,
        &format!(
            "whitelist {} {}",
            if add { "add" } else { "remove" },
            player_name
        ),
        &state.processes,
    )?;
    append_audit(
        &state.audit_dir,
        &server_id,
        "local-host",
        if add {
            "whitelist.add"
        } else {
            "whitelist.remove"
        },
        &player_name,
    )
}

#[tauri::command]
fn list_player_access(
    server_id: String,
    kind: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<PlayerAccessEntry>> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    require_minecraft(&profile, "Minecraftプレイヤー権限ファイル")?;
    if process::is_stopping(&server_id, &state.stopping_servers) {
        return player_access::list(&profile, &kind);
    }
    if kind == "operators" && player_access::reconcile_pending_bedrock_operators(&profile)? {
        let running = process::is_running(&server_id, &state.processes);
        if running {
            process::send_command(&server_id, "permission reload", &state.processes)?;
        }
    }
    player_access::list(&profile, &kind)
}

#[tauri::command]
async fn get_player_skin(
    player_name: String,
    player_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<Option<String>> {
    player_skin::official_skin_data_url(&state.client, &player_name, player_id.as_deref()).await
}

#[tauri::command]
async fn update_player_access(
    input: UpdatePlayerAccessInput,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let profile = state.store.lock().unwrap().get_server(&input.server_id)?;
    require_minecraft(&profile, "Minecraftプレイヤー権限ファイル")?;
    if process::is_stopping(&input.server_id, &state.stopping_servers) {
        return Err(AppError::Validation(
            "停止処理が完了してからプレイヤー権限を変更してください".into(),
        ));
    }
    let running = process::is_running(&input.server_id, &state.processes);
    if running && profile.server_type == "bedrock" && input.kind == "operators" {
        player_access::update_offline(&state.client, &profile, &input).await?;
        let command =
            if input.add && player_access::bedrock_operator_pending(&profile, &input.target)? {
                Some(player_access::command(&profile, &input)?)
            } else {
                Some("permission reload".into())
            };
        if let Some(command) = command {
            process::send_command(&input.server_id, &command, &state.processes)?;
        }
    } else if running {
        let command = player_access::command(&profile, &input)?;
        process::send_command(&input.server_id, &command, &state.processes)?;
    } else {
        player_access::update_offline(&state.client, &profile, &input).await?;
    }
    let detail = if input.kind == "banned_ips" {
        "target=redacted"
    } else {
        input.target.trim()
    };
    let mode = if running { "command" } else { "offline-file" };
    append_audit(
        &state.audit_dir,
        &input.server_id,
        "local-host",
        player_access::audit_action(&input.kind, input.add),
        &format!("mode={mode} {detail}"),
    )
}

#[tauri::command]
fn list_fixed_players(state: State<'_, AppState>) -> AppResult<Vec<FixedPlayerPreset>> {
    state.store.lock().unwrap().list_fixed_players()
}

#[tauri::command]
fn save_fixed_player(
    input: SaveFixedPlayerInput,
    state: State<'_, AppState>,
) -> AppResult<FixedPlayerPreset> {
    let player_name = input.player_name.trim();
    let edition = input.edition.trim().to_ascii_lowercase();
    if !matches!(edition.as_str(), "java" | "bedrock") {
        return Err(AppError::Validation(
            "対応していないプレイヤー種類です".into(),
        ));
    }
    let valid = if edition == "bedrock" {
        !player_name.is_empty()
            && player_name.chars().count() <= 32
            && !player_name
                .chars()
                .any(|character| matches!(character, '\r' | '\n' | '\t'))
    } else {
        (3..=16).contains(&player_name.len())
            && player_name
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_')
    };
    if !valid {
        return Err(AppError::Validation(if edition == "bedrock" {
            "Xboxゲーマータグは改行を含まない1～32文字で入力してください".into()
        } else {
            "プレイヤー名は英数字と_の3～16文字で入力してください".into()
        }));
    }
    if edition == "bedrock" && input.operator {
        return Err(AppError::Validation(
            "統合版専用メンバーは統合版ホワイトリストへ登録します".into(),
        ));
    }
    if !input.whitelist && !input.operator {
        return Err(AppError::Validation(
            "ホワイトリストまたは権限者を1つ以上選んでください".into(),
        ));
    }
    let now = Utc::now().to_rfc3339();
    let player = FixedPlayerPreset {
        id: input.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
        edition,
        player_name: player_name.to_string(),
        whitelist: input.whitelist,
        operator: input.operator,
        created_at: now.clone(),
        updated_at: now,
    };
    state.store.lock().unwrap().save_fixed_player(&player)
}

#[tauri::command]
fn delete_fixed_player(id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.store.lock().unwrap().delete_fixed_player(&id)
}

#[tauri::command]
fn list_modpack_profiles(state: State<'_, AppState>) -> AppResult<Vec<ModpackProfile>> {
    profiles::list(&state.profiles_dir)
}

#[tauri::command]
fn save_modpack_profile(
    server_id: String,
    name: String,
    state: State<'_, AppState>,
) -> AppResult<ModpackProfile> {
    let server = state.store.lock().unwrap().get_server(&server_id)?;
    let result = profiles::capture(&state.profiles_dir, &server, &name)?;
    append_audit(
        &state.audit_dir,
        &server_id,
        "local-host",
        "profile.save",
        &result.id,
    )?;
    Ok(result)
}

#[tauri::command]
fn duplicate_modpack_profile(
    profile_id: String,
    state: State<'_, AppState>,
) -> AppResult<ModpackProfile> {
    profiles::duplicate(&state.profiles_dir, &profile_id)
}

#[tauri::command]
fn export_modpack_profile(
    profile_id: String,
    destination: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    profiles::export(&state.profiles_dir, &profile_id, Path::new(&destination))
}

#[tauri::command]
fn import_modpack_profile(source: String, state: State<'_, AppState>) -> AppResult<ModpackProfile> {
    profiles::import(&state.profiles_dir, Path::new(&source))
}

#[tauri::command]
fn compare_modpack_profile(
    server_id: String,
    profile_id: String,
    state: State<'_, AppState>,
) -> AppResult<ProfileDiff> {
    let server = state.store.lock().unwrap().get_server(&server_id)?;
    profiles::diff(&state.profiles_dir, &profile_id, &server)
}

#[tauri::command]
fn delete_modpack_profile(profile_id: String, state: State<'_, AppState>) -> AppResult<()> {
    profiles::delete(&state.profiles_dir, &profile_id)
}

#[tauri::command]
fn check_update_safety(
    server_id: String,
    target_minecraft_version: String,
    target_server_type: String,
    state: State<'_, AppState>,
) -> AppResult<UpdateSafetyReport> {
    let server = state.store.lock().unwrap().get_server(&server_id)?;
    update_safety::check(
        &state.backups_dir,
        &server,
        &target_minecraft_version,
        &target_server_type,
    )
}

#[tauri::command]
async fn get_update_center(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<UpdateCenterReport> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let (mut items, unmanaged_files) =
        extensions::scan_managed_updates(&state.client, &profile).await?;
    if profile.server_type != "bedrock" {
        if let Some(latest) = downloads::list_versions(&state.client, &profile.server_type)
            .await?
            .first()
        {
            if latest.id != profile.minecraft_version {
                items.insert(
                    0,
                    UpdateCenterItem {
                        id: "server-runtime".into(),
                        kind: "server".into(),
                        name: format!("{} サーバー", profile.server_type),
                        current_version: profile.minecraft_version.clone(),
                        available_version: latest.id.clone(),
                        source: if profile.server_type == "paper" {
                            "PaperMC公式".into()
                        } else {
                            "Minecraft／ローダー公式".into()
                        },
                        managed: true,
                        selectable: true,
                        requires_client_update: profile.server_type != "paper"
                            && profile.server_type != "vanilla",
                        note: "適用前に互換性チェックと新しいバックアップを実行します。".into(),
                        project_id: None,
                        version_id: None,
                        extension_kind: None,
                    },
                );
            }
        }
    }
    if profile.server_type == "paper" {
        let status = crossplay::status(&profile);
        if let Some(port) = status.bedrock_port
            && let Ok(plan) = crossplay::plan(&state.client, &profile, port).await
            && let Some(geyser) = plan.geyser
            && geyser.installed
        {
            items.push(UpdateCenterItem {
                id: "geyser".into(),
                kind: "geyser".into(),
                name: "Geyser".into(),
                current_version: "導入済み".into(),
                available_version: format!("{} build {}", geyser.version, geyser.build),
                source: "GeyserMC公式".into(),
                managed: true,
                selectable: true,
                requires_client_update: false,
                note: "選択するとGeyser公式ファイルを再検証し、バックアップ後に更新します。".into(),
                project_id: None,
                version_id: None,
                extension_kind: None,
            });
        }
    }
    Ok(UpdateCenterReport {
        checked_at: Utc::now().to_rfc3339(),
        items,
        unmanaged_files,
        disclaimer: "公式APIまたはアプリが記録した配布元IDを確認できた項目だけを候補にします。手動追加ファイルは自動更新しません。".into(),
    })
}

#[tauri::command]
async fn apply_managed_extension_update(
    input: ApplyManagedExtensionUpdateInput,
    state: State<'_, AppState>,
) -> AppResult<crate::models::ExtensionInstallPlan> {
    let _operation = state.co_operations.lock(&input.server_id).await;
    if process::is_busy(&input.server_id, &state.processes, &state.stopping_servers) {
        return Err(AppError::Validation(
            "更新する前にサーバーを停止してください".into(),
        ));
    }
    let profile = state.store.lock().unwrap().get_server(&input.server_id)?;
    let result = extensions::update_managed_modrinth(
        &state.client,
        &state.backups_dir,
        &profile,
        &input.project_id,
        &input.version_id,
        &input.kind,
    )
    .await?;
    append_audit(
        &state.audit_dir,
        &profile.id,
        "local-host",
        "extension.update.apply",
        &format!("project={} version={}", input.project_id, input.version_id),
    )?;
    Ok(result)
}

#[tauri::command]
async fn apply_server_update(
    input: ApplyServerUpdateInput,
    state: State<'_, AppState>,
) -> AppResult<UpdateApplyResult> {
    let _operation = state.co_operations.lock(&input.server_id).await;
    let mut server = state.store.lock().unwrap().get_server(&input.server_id)?;
    if input.confirmation_name.trim() != server.name {
        return Err(AppError::Validation(
            "確認用サーバー名が一致しません".into(),
        ));
    }
    if process::is_busy(&server.id, &state.processes, &state.stopping_servers) {
        return Err(AppError::Validation(
            "更新を適用する前にサーバーを停止してください".into(),
        ));
    }
    if input.target_server_type != server.server_type {
        return Err(AppError::Validation(
            "ローダーやサーバー種類の変更は自動適用できません。同じ種類の更新を選んでください"
                .into(),
        ));
    }
    if server.server_type == "bedrock" {
        return Err(AppError::Validation("統合版BDSの自動更新適用はまだ行いません。ワールド・設定・アドオンを保護できる差し替え処理が完成するまでは、公式配布ページとバックアップを使って手動で更新してください".into()));
    }
    let required_java =
        required_java_major(&input.target_server_type, &input.target_minecraft_version);
    if server.java_major < required_java {
        return Err(AppError::Validation(format!(
            "Minecraft {} の更新にはJava {}が必要です。先にJava環境を準備してください",
            input.target_minecraft_version, required_java
        )));
    }
    let report = update_safety::check(
        &state.backups_dir,
        &server,
        &input.target_minecraft_version,
        &input.target_server_type,
    )?;
    if !report.dependency_warnings.is_empty() && !input.accept_warnings {
        return Err(AppError::Validation(
            "警告内容への確認が必要です。更新前チェックを読み、同意してから適用してください".into(),
        ));
    }

    let backup_info = backup::create(&state.backups_dir, &server, "before-update")?;
    let root = PathBuf::from(&server.root_path);
    let management = root.join(".server-hub");
    std::fs::create_dir_all(&management)?;
    let staging = management.join(format!("update-{}.jar", Uuid::new_v4()));
    let loader_update = matches!(server.server_type.as_str(), "forge" | "neoforge");
    let download = download_server(
        &state.client,
        &server.server_type,
        &input.target_minecraft_version,
        &staging,
        &server.java_path,
        &root,
    )
    .await;
    let build = match download {
        Ok(build) => build,
        Err(error) => {
            let _ = std::fs::remove_file(&staging);
            if loader_update {
                let _ = backup::restore(&state.backups_dir, &server, &backup_info.id);
            }
            return Err(error);
        }
    };

    if !loader_update {
        let destination = root.join(&server.launch_target);
        activate_staged_server_jar(&staging, &destination, &management)?;
    }

    let previous_version = server.minecraft_version.clone();
    server.minecraft_version = input.target_minecraft_version.clone();
    server.distribution_build = build;
    server.pending_restart = true;
    server.updated_at = Utc::now().to_rfc3339();
    if let Err(error) = state.store.lock().unwrap().update_server(&server) {
        let _ = backup::restore(&state.backups_dir, &server, &backup_info.id);
        return Err(error);
    }
    co_management::record_local_change(
        &state.co_management_store.lock().unwrap(),
        &server.id,
        "local-host",
        "ホストPC",
        "server.update.apply",
        &server,
    )?;
    append_audit(
        &state.audit_dir,
        &server.id,
        "local-host",
        "server.update.apply",
        &format!(
            "{} -> {}; backup={}",
            previous_version, server.minecraft_version, backup_info.id
        ),
    )?;
    Ok(UpdateApplyResult {
        server,
        backup: backup_info,
        changed_files: report.affected_files,
        message:
            "バックアップを作成し、配布元の検証済みファイルへ更新しました。次回起動で反映されます。"
                .into(),
    })
}

#[tauri::command]
async fn get_crossplay_plan(
    server_id: String,
    bedrock_port: u16,
    state: State<'_, AppState>,
) -> AppResult<crossplay::CrossplayPlan> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    require_minecraft(&profile, "Geyserクロスプレイ")?;
    let servers = state.store.lock().unwrap().list_servers()?;
    ensure_registered_port_unique(&servers, Some(&profile.id), bedrock_port, "udp", false)?;
    crossplay::plan(&state.client, &profile, bedrock_port).await
}

#[tauri::command]
async fn install_crossplay(
    input: crossplay::CrossplayInstallInput,
    state: State<'_, AppState>,
) -> AppResult<crossplay::CrossplayInstallResult> {
    if process::is_busy(&input.server_id, &state.processes, &state.stopping_servers) {
        return Err(AppError::Validation(
            "クロスプレイ構成を追加する前にサーバーを停止してください".into(),
        ));
    }
    let profile = state.store.lock().unwrap().get_server(&input.server_id)?;
    require_minecraft(&profile, "Geyserクロスプレイ")?;
    let servers = state.store.lock().unwrap().list_servers()?;
    ensure_registered_port_unique(
        &servers,
        Some(&profile.id),
        input.bedrock_port,
        "udp",
        false,
    )?;
    if !server_diagnosis::udp_port_available(input.bedrock_port) {
        return Err(AppError::Validation(format!(
            "Geyser用UDPポート {} はこのPCの別プロセスが使用しています。空きポートを選んでください",
            input.bedrock_port
        )));
    }
    let result = crossplay::install(&state.client, &state.backups_dir, &profile, &input).await?;
    append_audit(
        &state.audit_dir,
        &profile.id,
        "local-host",
        "crossplay.install",
        &format!(
            "bedrockPort={}; floodgate={}",
            input.bedrock_port, input.include_floodgate
        ),
    )?;
    Ok(result)
}

#[tauri::command]
fn get_crossplay_status(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<crossplay::CrossplayStatus> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    require_minecraft(&profile, "Geyserクロスプレイ")?;
    Ok(crossplay::status(&profile))
}

#[tauri::command]
fn configure_crossplay(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<crossplay::CrossplayConfigurationResult> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    require_minecraft(&profile, "Geyserクロスプレイ")?;
    if process::is_busy(&server_id, &state.processes, &state.stopping_servers) {
        return Err(AppError::Validation(
            "Geyser設定を安全に変更する前にPaperサーバーを停止してください".into(),
        ));
    }
    let result = crossplay::configure(&state.backups_dir, &profile)?;
    append_audit(
        &state.audit_dir,
        &server_id,
        "local-host",
        "crossplay.configure",
        &format!(
            "bedrock-port={} floodgate={}",
            result.bedrock_port, result.floodgate_enabled
        ),
    )?;
    Ok(result)
}

#[tauri::command]
async fn get_crossplay_tunnel_status(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<TunnelStatus> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let (tunnel_id, port) = crossplay_tunnel_target(&profile)?;
    let (mut settings, regular_settings) = {
        let store = state.store.lock().unwrap();
        (
            store.get_crossplay_tunnel_settings(&server_id, port)?,
            store.get_tunnel_settings(&server_id, profile.port, profile.network_transport())?,
        )
    };
    if settings.agent_path.is_none() {
        settings.agent_path = regular_settings.agent_path;
    }
    if settings.terms_acknowledged_at.is_none() {
        settings.terms_acknowledged_at = regular_settings.terms_acknowledged_at;
    }
    let tunnels = state.tunnels.clone();
    let agent_path = settings.agent_path.clone();
    let mut status = tokio::task::spawn_blocking(move || {
        tunnels.status_with_transport(&tunnel_id, port, "udp", agent_path)
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))??;
    status.server_id = server_id;
    status.terms_acknowledged = settings.terms_acknowledged_at.is_some();
    Ok(status)
}

#[tauri::command]
async fn quick_start_crossplay_tunnel(
    input: QuickStartTunnelInput,
    state: State<'_, AppState>,
) -> AppResult<TunnelStatus> {
    let profile = state.store.lock().unwrap().get_server(&input.server_id)?;
    validate_public_access_profile(&profile)?;
    let (tunnel_id, port) = crossplay_tunnel_target(&profile)?;
    if !process::is_running(&profile.id, &state.processes) {
        return Err(AppError::Validation(
            "先にPaperサーバーを起動してください".into(),
        ));
    }
    let (mut settings, regular_settings) = {
        let store = state.store.lock().unwrap();
        (
            store.get_crossplay_tunnel_settings(&profile.id, port)?,
            store.get_tunnel_settings(&profile.id, profile.port, profile.network_transport())?,
        )
    };
    if settings.agent_path.is_none() {
        settings.agent_path = regular_settings.agent_path;
    }
    if settings.terms_acknowledged_at.is_none() {
        settings.terms_acknowledged_at = regular_settings.terms_acknowledged_at;
    }
    if !input.terms_accepted && settings.terms_acknowledged_at.is_none() {
        return Err(AppError::Validation(
            "初回だけ、playit.ggの利用規約とプライバシーポリシーを確認してください".into(),
        ));
    }
    let tunnels = state.tunnels.clone();
    let requested_path = settings.agent_path.clone().map(PathBuf::from);
    let (mut status, validation) = tokio::task::spawn_blocking(move || {
        let validation = tunnels.locate_and_validate("playit", requested_path.as_deref())?;
        if !tunnel::wait_for_local_port_transport(port, "udp", Duration::from_secs(45)) {
            return Err(AppError::Validation(format!(
                "GeyserのUDPポート {port} が45秒以内に準備できませんでした。Paperを再起動し、Geyserのconfig.ymlに同じBedrockポートが設定されているか確認してください"
            )));
        }
        let mut status = tunnels.start_with_transport(
            &tunnel_id,
            "playit",
            Path::new(&validation.agent_path),
            port,
            "udp",
        )?;
        let endpoint_deadline = std::time::Instant::now() + Duration::from_secs(15);
        while status.public_endpoint.is_none()
            && matches!(status.state.as_str(), "starting" | "running")
            && std::time::Instant::now() < endpoint_deadline
        {
            std::thread::sleep(Duration::from_millis(500));
            status = tunnels.status_with_transport(
                &tunnel_id,
                port,
                "udp",
                Some(validation.agent_path.clone()),
            )?;
        }
        Ok::<_, AppError>((status, validation))
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))??;
    let now = Utc::now().to_rfc3339();
    settings.provider_id = "playit".into();
    settings.agent_path = Some(validation.agent_path);
    settings.local_port = port;
    settings.transport = "udp".into();
    if input.terms_accepted || settings.terms_acknowledged_at.is_none() {
        settings.terms_acknowledged_at = Some(now.clone());
    }
    settings.updated_at = now;
    status.server_id = profile.id.clone();
    status.terms_acknowledged = true;
    save_crossplay_tunnel_runtime_state(&state, settings, &status)?;
    Ok(status)
}

#[tauri::command]
async fn stop_crossplay_tunnel(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<TunnelStatus> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let (tunnel_id, port) = crossplay_tunnel_target(&profile)?;
    let settings = state
        .store
        .lock()
        .unwrap()
        .get_crossplay_tunnel_settings(&server_id, port)?;
    let tunnels = state.tunnels.clone();
    let agent_path = settings.agent_path.clone();
    let mut status = tokio::task::spawn_blocking(move || {
        tunnels.stop_with_transport(&tunnel_id, port, "udp", agent_path)
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))??;
    status.server_id = server_id;
    status.terms_acknowledged = settings.terms_acknowledged_at.is_some();
    save_crossplay_tunnel_runtime_state(&state, settings, &status)?;
    Ok(status)
}

#[tauri::command]
async fn diagnose_crossplay_tunnel(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<TunnelDiagnosis> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let (tunnel_id, port) = crossplay_tunnel_target(&profile)?;
    let settings = state
        .store
        .lock()
        .unwrap()
        .get_crossplay_tunnel_settings(&server_id, port)?;
    let server_running = process::is_running(&server_id, &state.processes);
    let local_port_listening = tunnel::local_port_listening_for(port, "udp");
    let agent_configured = settings.agent_path.is_some();
    let tunnels = state.tunnels.clone();
    let provider_id = settings.provider_id.clone();
    let agent_path = settings.agent_path.clone();
    let agent_verified = tokio::task::spawn_blocking(move || {
        agent_path
            .as_ref()
            .is_some_and(|path| tunnels.validate(&provider_id, Path::new(path)).is_ok())
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))?;
    let agent_running = state.tunnels.is_active(&tunnel_id);
    let tunnel_status = if agent_running {
        Some(get_crossplay_tunnel_status(server_id.clone(), state.clone()).await?)
    } else {
        None
    };
    let provider_authenticated = tunnel_status.as_ref().is_some_and(|status| {
        matches!(
            status.account_state.as_str(),
            "guest" | "email_not_verified" | "verified"
        )
    });
    let matching_tunnel = tunnel_status
        .as_ref()
        .is_some_and(|status| status.matching_tunnel);
    let endpoint_available = tunnel_status
        .as_ref()
        .is_some_and(|status| status.public_endpoint.is_some());
    let tunnel_connected = tunnel_status
        .as_ref()
        .is_some_and(|status| status.state == "connected" && endpoint_available);
    Ok(TunnelDiagnosis {
        checked_at: Utc::now().to_rfc3339(),
        server_running,
        local_port_listening,
        transport: "udp".into(),
        agent_configured,
        agent_verified,
        agent_running,
        provider_authenticated,
        matching_tunnel,
        tunnel_connected,
        endpoint_available,
        items: vec![
            if server_running {
                "Paperサーバーは起動しています"
            } else {
                "Paperサーバーが起動していません"
            }
            .into(),
            if local_port_listening {
                format!("Geyser UDP {port} は待受状態です")
            } else {
                format!("Geyser UDP {port} は待受状態ではありません")
            },
            if matching_tunnel {
                "統合版用UDPトンネル設定を確認しました"
            } else {
                "統合版用UDPトンネルを公式画面で作成してください"
            }
            .into(),
            if endpoint_available {
                "統合版用の公開接続先を取得できました"
            } else {
                "統合版用の公開接続先はまだ取得できません"
            }
            .into(),
            "別の家からの統合版実参加は、別回線での手動確認が必要です".into(),
        ],
    })
}

#[tauri::command]
async fn open_crossplay_tunnel_account_login(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let tunnel_id = crossplay_tunnel_id(&server_id);
    let tunnels = state.tunnels.clone();
    tokio::task::spawn_blocking(move || tunnels.open_account_login(&tunnel_id))
        .await
        .map_err(|error| AppError::Other(error.to_string()))?
}

#[tauri::command]
async fn open_crossplay_tunnel_dashboard(_server_id: String) -> AppResult<()> {
    tokio::task::spawn_blocking(tunnel::open_tunnel_dashboard)
        .await
        .map_err(|error| AppError::Other(error.to_string()))?
}

#[tauri::command]
async fn probe_crossplay_tunnel_endpoint(
    server_id: String,
    state: State<'_, AppState>,
) -> AppResult<TunnelExternalProbe> {
    let profile = state.store.lock().unwrap().get_server(&server_id)?;
    let (tunnel_id, _) = crossplay_tunnel_target(&profile)?;
    let tunnels = state.tunnels.clone();
    tokio::task::spawn_blocking(move || {
        tunnels.probe_public_endpoint_with_transport(&tunnel_id, "udp")
    })
    .await
    .map_err(|error| AppError::Other(error.to_string()))?
}

fn activate_staged_server_jar(
    staging: &Path,
    destination: &Path,
    management: &Path,
) -> AppResult<()> {
    if !staging.is_file() {
        return Err(AppError::Validation(
            "検証済み更新ファイルが見つかりません".into(),
        ));
    }
    let previous = management.join(format!("previous-{}.jar", Uuid::new_v4()));
    if destination.is_file() {
        std::fs::rename(destination, &previous)?;
    }
    if let Err(error) = std::fs::rename(staging, destination) {
        if previous.is_file() {
            let _ = std::fs::rename(&previous, destination);
        }
        return Err(error.into());
    }
    if previous.is_file() {
        std::fs::remove_file(previous)?;
    }
    Ok(())
}

pub(crate) fn append_audit(
    root: &Path,
    server_id: &str,
    actor: &str,
    action: &str,
    detail: &str,
) -> AppResult<()> {
    use std::io::Write;
    std::fs::create_dir_all(root)?;
    let entry = AuditEntry {
        id: Uuid::new_v4().to_string(),
        at: Utc::now().to_rfc3339(),
        actor: actor.into(),
        action: action.into(),
        detail: detail.into(),
    };
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(root.join(format!("{server_id}.jsonl")))?;
    writeln!(file, "{}", serde_json::to_string(&entry)?)?;
    Ok(())
}

async fn create_server_files(
    input: &CreateServerInput,
    root: &Path,
    client: &reqwest::Client,
    palworld_tools_dir: &Path,
    server_id: &str,
    app: &tauri::AppHandle,
) -> AppResult<Option<String>> {
    if input.game_kind.eq_ignore_ascii_case("palworld") || input.server_type == "palworld" {
        let settings = input
            .palworld_settings
            .as_ref()
            .ok_or_else(|| AppError::Validation("Palworldの作成設定がありません".into()))?;
        let progress_app = app.clone();
        let progress = Arc::new(move |payload: palworld::PalworldInstallProgress| {
            let _ = progress_app.emit("palworld-install-progress", payload);
        });
        let installed = palworld::install_server(
            client,
            palworld_tools_dir,
            root,
            server_id,
            input.name.trim(),
            input.port,
            settings,
            progress,
        )
        .await?;
        return Ok(Some(format!(
            "steam-app:{};steamcmd-sha256:{}",
            palworld::STEAM_APP_ID,
            installed.steamcmd_sha256
        )));
    }
    if input.server_type == "bedrock" {
        let (installed, source_kind) = if let Some(archive) = input
            .bedrock_archive_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            (
                bedrock::install_from_archive(Path::new(archive), root)?,
                "user-selected-archive",
            )
        } else {
            let plan = bedrock::fetch_download_plan(client).await?;
            (
                bedrock::download_and_install(client, &plan, root).await?,
                "official-minecraft-download-api",
            )
        };
        std::fs::write(
            root.join("server.properties"),
            render_server_properties(input),
        )?;
        let management = root.join(".server-hub");
        std::fs::create_dir_all(&management)?;
        std::fs::write(
            management.join("bedrock-install.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "source": source_kind,
                "archiveSha256": installed.archive_sha256,
                "signatureSubject": installed.signature_subject,
                "version": installed.version,
                "installedAt": Utc::now().to_rfc3339(),
            }))?,
        )?;
        std::fs::create_dir_all(root.join("worlds"))?;
        std::fs::create_dir_all(root.join("behavior_packs"))?;
        std::fs::create_dir_all(root.join("resource_packs"))?;
        return Ok(Some(format!("bds-sha256:{}", installed.archive_sha256)));
    }
    let jar_path = root.join("server.jar");
    let build = download_server(
        client,
        &input.server_type,
        &input.minecraft_version,
        &jar_path,
        &input.java_path,
        root,
    )
    .await?;

    std::fs::write(
        root.join("eula.txt"),
        format!(
            "# Accepted explicitly in Minecraft Server Hub at {}\r\neula=true\r\n",
            Utc::now().to_rfc3339()
        ),
    )?;
    std::fs::write(
        root.join("server.properties"),
        render_server_properties(input),
    )?;
    std::fs::create_dir(root.join(".server-hub"))?;
    match input.server_type.as_str() {
        "paper" => std::fs::create_dir_all(root.join("plugins"))?,
        "fabric" | "forge" | "neoforge" => std::fs::create_dir_all(root.join("mods"))?,
        _ => {}
    }
    Ok(build)
}

fn render_server_properties(input: &CreateServerInput) -> String {
    let settings = &input.settings;
    if input.server_type == "bedrock" {
        let port_v6 = input.port.checked_add(1).unwrap_or(19_133);
        let level_type = match settings.world_type.as_str() {
            "minecraft:flat" | "FLAT" => "FLAT",
            "LEGACY" => "LEGACY",
            _ => "DEFAULT",
        };
        return [
            "# Managed Bedrock Dedicated Server settings.".into(),
            format!("server-name={}", input.name.trim()),
            format!("gamemode={}", settings.default_game_mode),
            format!("force-gamemode={}", settings.force_game_mode),
            format!("difficulty={}", settings.difficulty),
            format!("allow-cheats={}", settings.allow_commands),
            format!("max-players={}", settings.max_players),
            format!("online-mode={}", settings.online_mode),
            format!("allow-list={}", settings.whitelist),
            format!("server-port={}", input.port),
            format!("server-portv6={port_v6}"),
            format!("view-distance={}", settings.view_distance),
            format!(
                "tick-distance={}",
                settings.simulation_distance.clamp(4, 12)
            ),
            format!("level-name={}", settings.world_name),
            format!("level-seed={}", settings.world_seed.trim()),
            format!("level-type={level_type}"),
            "default-player-permission-level=member".into(),
            format!("texturepack-required={}", settings.require_resource_pack),
            "enable-lan-visibility=true".into(),
        ]
        .join("\r\n")
            + "\r\n";
    }
    [
        "# Managed basic settings. Unknown server properties are preserved after first launch."
            .into(),
        format!("gamemode={}", settings.default_game_mode),
        format!("difficulty={}", settings.difficulty),
        format!("max-players={}", settings.max_players),
        format!("pvp={}", settings.pvp),
        format!("white-list={}", settings.whitelist),
        format!("enforce-whitelist={}", settings.whitelist),
        format!("server-port={}", input.port),
        format!("level-name={}", settings.world_name),
        format!("level-type={}", settings.world_type),
        format!("level-seed={}", settings.world_seed.trim()),
        format!("generate-structures={}", settings.generate_structures),
        format!("hardcore={}", settings.hardcore),
        format!("enable-command-block={}", settings.allow_commands),
        format!("online-mode={}", settings.online_mode),
        format!("allow-flight={}", settings.allow_flight),
        format!("force-gamemode={}", settings.force_game_mode),
        format!("spawn-protection={}", settings.spawn_protection),
        format!("require-resource-pack={}", settings.require_resource_pack),
        format!("resource-pack={}", settings.resource_pack_url.trim()),
        format!(
            "resource-pack-prompt={}",
            if settings.resource_pack_prompt.trim().is_empty() {
                String::new()
            } else {
                serde_json::json!({ "text": settings.resource_pack_prompt.trim() }).to_string()
            }
        ),
        format!("spawn-monsters={}", settings.spawn_monsters),
        format!("spawn-animals={}", settings.spawn_animals),
        format!("view-distance={}", settings.view_distance),
        format!("simulation-distance={}", settings.simulation_distance),
        "enable-rcon=false".into(),
        "enable-status=true".into(),
        "motd=Local Java Server".into(),
    ]
    .join("\r\n")
        + "\r\n"
}

fn find_available_port(
    used: &HashSet<u16>,
    starting_port: u16,
    mut is_available: impl FnMut(u16) -> bool,
) -> Option<u16> {
    let start = starting_port.max(1024);
    (start..=u16::MAX)
        .chain(1024..start)
        .find(|port| !used.contains(port) && is_available(*port))
}

fn ensure_registered_port_unique(
    servers: &[ServerProfile],
    current_server_id: Option<&str>,
    port: u16,
    transport: &str,
    reserve_adjacent_port: bool,
) -> AppResult<()> {
    let mut requested_ports = vec![port];
    if reserve_adjacent_port {
        let ipv6_port = port.checked_add(1).ok_or_else(|| {
            AppError::Validation(
                "統合版のIPv6用ポートを確保できないため、65534以下を指定してください".into(),
            )
        })?;
        requested_ports.push(ipv6_port);
    }
    let conflict = servers.iter().find_map(|server| {
        if Some(server.id.as_str()) == current_server_id {
            return None;
        }
        let mut owner_ports = Vec::new();
        if server.network_transport() == transport {
            owner_ports.push(server.port);
            if server.server_type == "bedrock" {
                if let Some(ipv6_port) = server.port.checked_add(1) {
                    owner_ports.push(ipv6_port);
                }
            }
        }
        if transport == "udp" {
            if let Some(crossplay_port) = crossplay::registered_bedrock_port(server) {
                owner_ports.push(crossplay_port);
            }
        }
        requested_ports
            .iter()
            .find(|requested| owner_ports.contains(requested))
            .map(|port| (server, *port))
    });
    if let Some((owner, conflicting_port)) = conflict {
        return Err(AppError::Validation(format!(
            "{}ポート {conflicting_port} は「{}」と重複しています。空きポートへ変更してください",
            transport.to_ascii_uppercase(),
            owner.name
        )));
    }
    Ok(())
}

fn ensure_palworld_management_port_unique(
    servers: &[ServerProfile],
    current_server_id: Option<&str>,
    rest_port: u16,
) -> AppResult<()> {
    let conflict = servers.iter().find(|server| {
        if Some(server.id.as_str()) == current_server_id {
            return false;
        }
        if server.network_transport() == "tcp" && server.port == rest_port {
            return true;
        }
        server
            .palworld_settings
            .as_ref()
            .is_some_and(|settings| settings.rest_api_port == rest_port)
    });
    if let Some(owner) = conflict {
        return Err(AppError::Validation(format!(
            "Palworld REST管理用TCPポート {rest_port} は「{}」と重複しています",
            owner.name
        )));
    }
    Ok(())
}

fn require_minecraft(profile: &ServerProfile, feature: &str) -> AppResult<()> {
    if profile.game_adapter().is_palworld() {
        Err(AppError::Validation(format!(
            "{feature}はMinecraftサーバー専用です。PW0～PW2のPalworldプロフィールでは実行しません"
        )))
    } else {
        Ok(())
    }
}

fn validate_create_input(input: &CreateServerInput) -> AppResult<()> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 64 {
        return Err(AppError::Validation(
            "サーバー名は1～64文字で入力してください".into(),
        ));
    }
    if !matches!(input.game_kind.as_str(), "minecraft" | "palworld") {
        return Err(AppError::Validation("対応していないゲーム種類です".into()));
    }
    let is_palworld = input.game_kind == "palworld" || input.server_type == "palworld";
    if is_palworld {
        if input.game_kind != "palworld" || input.server_type != "palworld" {
            return Err(AppError::Validation(
                "Palworldのゲーム種類とサーバー種類が一致していません".into(),
            ));
        }
        if !(1024..=u16::MAX).contains(&input.port) {
            return Err(AppError::Validation(
                "Palworldのゲーム用UDPポートは1024～65535で指定してください".into(),
            ));
        }
        let settings = input
            .palworld_settings
            .as_ref()
            .ok_or_else(|| AppError::Validation("Palworld設定がありません".into()))?;
        if !(1..=32).contains(&settings.max_players) {
            return Err(AppError::Validation(
                "Palworldの最大人数は1～32人で設定してください".into(),
            ));
        }
        if settings.rest_api_port < 1024 || settings.rest_api_port == input.port {
            return Err(AppError::Validation(
                "REST管理ポートは1024以上かつゲーム用UDPポートと別の番号にしてください".into(),
            ));
        }
        if !settings.rest_api_enabled {
            return Err(AppError::Validation(
                "保存と安全停止のためPalworld REST APIを有効にしてください".into(),
            ));
        }
        return Ok(());
    }
    if input.game_kind != "minecraft" {
        return Err(AppError::Validation(
            "MinecraftサーバーにはMinecraftのゲーム種類を指定してください".into(),
        ));
    }
    if !matches!(
        input.server_type.as_str(),
        "vanilla" | "paper" | "fabric" | "forge" | "neoforge" | "bedrock"
    ) {
        return Err(AppError::Validation(
            "対応していないサーバー種類です".into(),
        ));
    }
    if input.minecraft_version.trim().is_empty() {
        return Err(AppError::Validation("Minecraft版を選択してください".into()));
    }
    if !(1024..=65535).contains(&input.port) {
        return Err(AppError::Validation(
            "ポートは1024～65535で指定してください".into(),
        ));
    }
    if input.server_type == "bedrock" && input.port == u16::MAX {
        return Err(AppError::Validation(
            "統合版はIPv6用の隣接UDPポートも使うため、65534以下を指定してください".into(),
        ));
    }
    if input.server_type != "bedrock"
        && (input.min_memory_mib < 512
            || input.max_memory_mib < input.min_memory_mib
            || input.max_memory_mib > 65_536)
    {
        return Err(AppError::Validation(
            "メモリは512 MiB以上で、最小値が最大値を超えないようにしてください".into(),
        ));
    }
    if !(1..=500).contains(&input.settings.max_players) {
        return Err(AppError::Validation("最大プレイヤー数は1～500です".into()));
    }
    if input.settings.world_name.trim().is_empty()
        || input.settings.world_name.contains(['/', '\\', '\0'])
    {
        return Err(AppError::Validation("ワールド名が正しくありません".into()));
    }
    let valid_world_type = if input.server_type == "bedrock" {
        matches!(
            input.settings.world_type.as_str(),
            "DEFAULT" | "FLAT" | "LEGACY" | "minecraft:normal" | "minecraft:flat"
        )
    } else {
        matches!(
            input.settings.world_type.as_str(),
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
    if input.settings.world_seed.chars().count() > 128
        || input.settings.world_seed.chars().any(char::is_control)
    {
        return Err(AppError::Validation(
            "シード値は改行などを含めず128文字以内で入力してください".into(),
        ));
    }
    if input.settings.hardcore
        && (input.settings.difficulty != "hard" || input.settings.default_game_mode != "survival")
    {
        return Err(AppError::Validation(
            "ハードコアは難易度ハード・サバイバルで作成してください".into(),
        ));
    }
    if !input.eula_accepted {
        return Err(AppError::Validation(
            "Minecraft EULAへの明示的な同意が必要です".into(),
        ));
    }
    if input.server_type == "bedrock"
        && let Some(archive) = input
            .bedrock_archive_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
    {
        let path = Path::new(archive);
        if !path.is_absolute()
            || !path.is_file()
            || !path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("zip"))
        {
            return Err(AppError::Validation(
                "有効なBedrock Dedicated Server ZIPを選択してください".into(),
            ));
        }
    }
    Ok(())
}

fn validate_java(input: &CreateServerInput) -> AppResult<()> {
    let required = required_java_major(&input.server_type, &input.minecraft_version);
    if input.java_major < required {
        return Err(AppError::Validation(format!(
            "この構成にはJava {required}以上が必要です"
        )));
    }
    let selected = PathBuf::from(&input.java_path);
    if !selected.is_file() || !selected.ends_with("java.exe") {
        return Err(AppError::Validation(
            "有効なjava.exeを選択してください".into(),
        ));
    }
    let detected = detect_java_runtimes(&input.server_type, &input.minecraft_version);
    let canonical = selected.canonicalize()?;
    let verified = detected.iter().any(|runtime| {
        PathBuf::from(&runtime.executable_path)
            .canonicalize()
            .map(|path| path == canonical && runtime.compatible)
            .unwrap_or(false)
    });
    if !verified {
        return Err(AppError::Validation(
            "選択したJavaを再検証できないか、必要条件を満たしていません".into(),
        ));
    }
    Ok(())
}

fn safe_folder_name(name: &str, id: &str) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|character| {
            if matches!(
                character,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
            ) {
                '-'
            } else {
                character
            }
        })
        .collect();
    let cleaned = cleaned.trim_matches([' ', '.']);
    let base = if cleaned.is_empty() || is_reserved_windows_name(cleaned) {
        "server"
    } else {
        cleaned
    };
    format!("{}-{}", base, &id[..8])
}

fn is_reserved_windows_name(value: &str) -> bool {
    let upper = value.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .is_some_and(|n| matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"))
        || upper
            .strip_prefix("LPT")
            .is_some_and(|n| matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"))
}

#[tauri::command]
fn open_windows_uninstall_settings() -> AppResult<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        std::process::Command::new("explorer.exe")
            .arg("ms-settings:appsfeatures")
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err(AppError::Validation(
            "アンインストール設定はWindows版で利用できます".into(),
        ))
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalNotificationEvent {
    server_id: String,
    kind: String,
    title: String,
    body: String,
}

fn emit_local_notification(
    app: &tauri::AppHandle,
    server_id: &str,
    kind: &str,
    title: impl Into<String>,
    body: impl Into<String>,
) {
    let _ = app.emit(
        "local-notification",
        LocalNotificationEvent {
            server_id: server_id.into(),
            kind: kind.into(),
            title: title.into(),
            body: body.into(),
        },
    );
}

fn auto_stop_due(
    enabled: bool,
    state: &str,
    players: u32,
    idle_for: Duration,
    idle_minutes: u16,
) -> bool {
    enabled
        && state == "running"
        && players == 0
        && idle_for >= Duration::from_secs(u64::from(idle_minutes) * 60)
}

fn start_server_automation_monitor(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut previous_states = HashMap::<String, String>::new();
        let mut previous_players = HashMap::<String, HashSet<String>>::new();
        let mut idle_since = HashMap::<String, Instant>::new();
        loop {
            tokio::time::sleep(Duration::from_secs(10)).await;
            let snapshots = {
                let state = app.state::<AppState>();
                let profiles = match state.store.lock().unwrap().list_servers() {
                    Ok(value) => value,
                    Err(_) => continue,
                };
                profiles
                    .into_iter()
                    .filter_map(|profile| {
                        let settings = state
                            .store
                            .lock()
                            .unwrap()
                            .automation_settings(&profile.id)
                            .ok()?;
                        let status = process::runtime_status(
                            &profile,
                            &state.processes,
                            &state.stopping_servers,
                            &state.logs,
                        );
                        Some((profile, settings, status))
                    })
                    .collect::<Vec<_>>()
            };
            for (profile, settings, mut status) in snapshots {
                if profile.game_adapter().is_palworld()
                    && matches!(status.state.as_str(), "starting" | "running")
                {
                    let snapshot = match palworld::monitor(&profile).await {
                        Ok(snapshot) => snapshot,
                        Err(_) => {
                            // Unknown occupancy is never an empty server. Preserve notification
                            // history across outages, but require a fresh full idle interval.
                            idle_since.remove(&profile.id);
                            continue;
                        }
                    };
                    status.state = "running".into();
                    status.player_count = snapshot
                        .current_players
                        .max(snapshot.metrics.players.len() as u32);
                    status.max_players = snapshot.max_players;
                    status.uptime_seconds = snapshot.uptime_seconds;
                    status.online_players = snapshot
                        .metrics
                        .players
                        .iter()
                        .map(|player| player.name.clone())
                        .collect();
                    status.palworld = Some(snapshot.metrics);
                }
                let previous_state =
                    previous_states.insert(profile.id.clone(), status.state.clone());
                if status.state == "running"
                    && previous_state
                        .as_deref()
                        .is_some_and(|value| value != "running")
                    && settings.notify_startup
                {
                    emit_local_notification(
                        &app,
                        &profile.id,
                        "startup",
                        "サーバー起動完了",
                        format!("{} を友達が参加できる状態で起動しました。", profile.name),
                    );
                }
                if status.state == "crashed"
                    && previous_state
                        .as_deref()
                        .is_some_and(|value| value != "crashed")
                    && settings.notify_crash
                {
                    emit_local_notification(
                        &app,
                        &profile.id,
                        "crash",
                        "サーバーが異常終了しました",
                        format!("{} の診断画面で原因を確認してください。", profile.name),
                    );
                }
                let current_players = status
                    .online_players
                    .iter()
                    .map(|value| value.to_ascii_lowercase())
                    .collect::<HashSet<_>>();
                let old_players = previous_players.entry(profile.id.clone()).or_default();
                if settings.notify_player_join {
                    for joined in current_players.difference(old_players) {
                        let display = status
                            .online_players
                            .iter()
                            .find(|value| value.eq_ignore_ascii_case(joined))
                            .cloned()
                            .unwrap_or_else(|| joined.clone());
                        emit_local_notification(
                            &app,
                            &profile.id,
                            "player-join",
                            "プレイヤーが参加しました",
                            format!("{} が {} に参加しました。", display, profile.name),
                        );
                    }
                }
                *old_players = current_players;

                if settings.auto_stop_enabled
                    && status.state == "running"
                    && status.player_count == 0
                {
                    let started = idle_since
                        .entry(profile.id.clone())
                        .or_insert_with(Instant::now);
                    if auto_stop_due(
                        settings.auto_stop_enabled,
                        &status.state,
                        status.player_count,
                        started.elapsed(),
                        settings.idle_minutes,
                    ) {
                        idle_since.remove(&profile.id);
                        let (
                            processes,
                            stopping_servers,
                            stop_operations,
                            post_stop_exit_guard,
                            tunnel_store,
                            tunnels,
                            audit_dir,
                        ) = {
                            let state = app.state::<AppState>();
                            (
                                state.processes.clone(),
                                state.stopping_servers.clone(),
                                state.stop_operations.clone(),
                                state.post_stop_exit_guard.clone(),
                                state.store.clone(),
                                state.tunnels.clone(),
                                state.audit_dir.clone(),
                            )
                        };
                        let _stop_guard =
                            StopOperationGuard::new(stop_operations, post_stop_exit_guard);
                        append_lifecycle_event(
                            &app,
                            "server.auto-stop.begin",
                            &format!("server={}", profile.id),
                        );
                        let graceful_command = if profile.game_adapter().is_palworld() {
                            if palworld::save_world(&profile).await.is_err()
                                || palworld::shutdown(&profile, 2).await.is_err()
                            {
                                append_lifecycle_event(
                                    &app,
                                    "server.auto-stop.palworld-rest-failed",
                                    &format!("server={}", profile.id),
                                );
                                continue;
                            }
                            None
                        } else {
                            Some("stop")
                        };
                        if process::stop(
                            &app,
                            &profile.id,
                            false,
                            graceful_command,
                            &processes,
                            &stopping_servers,
                        )
                        .await
                        .is_ok()
                        {
                            append_lifecycle_event(
                                &app,
                                "server.auto-stop.tunnel-begin",
                                &format!("server={}", profile.id),
                            );
                            let tunnel_server_id = profile.id.clone();
                            let tunnel_result = tokio::task::spawn_blocking(move || {
                                stop_tunnel_for_server_with(
                                    &tunnel_server_id,
                                    &tunnel_store,
                                    &tunnels,
                                )
                            })
                            .await;
                            append_lifecycle_event(
                                &app,
                                if matches!(tunnel_result, Ok(Ok(()))) {
                                    "server.auto-stop.tunnel-complete"
                                } else {
                                    "server.auto-stop.tunnel-failed"
                                },
                                &format!("server={}", profile.id),
                            );
                            let _ = append_audit(
                                &audit_dir,
                                &profile.id,
                                "automation",
                                "server.auto-stop",
                                &format!("idleMinutes={}", settings.idle_minutes),
                            );
                            emit_local_notification(
                                &app,
                                &profile.id,
                                "auto-stop",
                                "無人のため安全停止しました",
                                format!(
                                    "{} は{}分間プレイヤーが0人だったため保存して停止しました。",
                                    profile.name, settings.idle_minutes
                                ),
                            );
                            append_lifecycle_event(
                                &app,
                                "server.auto-stop.completed",
                                &format!("server={}", profile.id),
                            );
                        } else {
                            append_lifecycle_event(
                                &app,
                                "server.auto-stop.failed",
                                &format!("server={}", profile.id),
                            );
                        }
                    }
                } else {
                    idle_since.remove(&profile.id);
                }
            }
        }
    });
}

pub fn run() {
    let stop_operations = Arc::new(AtomicUsize::new(0));
    let post_stop_exit_guard = Arc::new(Mutex::new(None));
    let allow_app_exit = Arc::new(AtomicBool::new(false));
    let main_restore_in_flight = Arc::new(AtomicBool::new(false));
    let stop_operations_for_state = stop_operations.clone();
    let stop_operations_for_window = stop_operations.clone();
    let stop_operations_for_exit = stop_operations.clone();
    let post_stop_exit_guard_for_state = post_stop_exit_guard.clone();
    let post_stop_exit_guard_for_window = post_stop_exit_guard.clone();
    let post_stop_exit_guard_for_exit = post_stop_exit_guard.clone();
    let stopping_servers = Arc::new(StoppingMap::default());
    let stopping_servers_for_state = stopping_servers.clone();
    let stopping_servers_for_window = stopping_servers.clone();
    let stopping_servers_for_exit = stopping_servers.clone();
    let allow_app_exit_for_state = allow_app_exit.clone();
    let allow_app_exit_for_window = allow_app_exit.clone();
    let allow_app_exit_for_exit = allow_app_exit.clone();
    let main_restore_in_flight_for_window = main_restore_in_flight.clone();
    let main_restore_in_flight_for_exit = main_restore_in_flight.clone();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(move |window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let active_stops = stop_operations_for_window
                    .load(Ordering::SeqCst)
                    .saturating_add(stopping_servers_for_window.lock().unwrap().len());
                let decision = app_exit_decision(
                    allow_app_exit_for_window.load(Ordering::SeqCst),
                    active_stops,
                    *post_stop_exit_guard_for_window.lock().unwrap(),
                );
                append_lifecycle_event(
                    window.app_handle(),
                    "window.close-requested",
                    match decision {
                        AppExitDecision::Allow => "allow",
                        AppExitDecision::BlockSilently => "block-silently",
                        AppExitDecision::AskUser => "ask-user",
                    },
                );
                if decision != AppExitDecision::Allow {
                    api.prevent_close();
                    let _ = window.show();
                    let _ = window.set_focus();
                    if decision == AppExitDecision::AskUser {
                        let _ = window.emit("app-close-requested", ());
                    }
                }
            }
            tauri::WindowEvent::Destroyed => {
                let exit_authorized = allow_app_exit_for_window.load(Ordering::SeqCst);
                append_lifecycle_event(
                    window.app_handle(),
                    "window.destroyed",
                    if exit_authorized {
                        "authorized"
                    } else {
                        "unauthorized"
                    },
                );
                if should_restore_main_window(window.label(), exit_authorized) {
                    schedule_main_window_restore(
                        window.app_handle().clone(),
                        allow_app_exit_for_window.clone(),
                        main_restore_in_flight_for_window.clone(),
                    );
                }
            }
            _ => {}
        })
        .setup(move |app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let backups_dir = data_dir.join("backups");
            std::fs::create_dir_all(&backups_dir)?;
            let _ = backup::cleanup_stale_parts(&backups_dir);
            let store = Arc::new(Mutex::new(
                Store::open(&data_dir.join("server-hub.sqlite3"))
                    .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?,
            ));
            let co_management_store = Arc::new(Mutex::new(
                co_management::CoManagementStore::open(&data_dir.join("server-hub.sqlite3"))
                    .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?,
            ));
            co_management_store
                .lock()
                .unwrap()
                .recover_incomplete_operations(&store.lock().unwrap())
                .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?;
            let processes = Arc::new(Mutex::new(HashMap::new()));
            let logs = Arc::new(Mutex::new(HashMap::new()));
            let audit_dir = data_dir.join("audit");
            let state = AppState {
                store,
                co_management_store,
                co_operations: co_management::ServerOperationCoordinator::default(),
                co_connections: HostConnectionManager::default(),
                client: http_client()
                    .map_err(|error| Box::<dyn std::error::Error>::from(error.to_string()))?,
                processes,
                stopping_servers: stopping_servers_for_state.clone(),
                logs,
                database_path: data_dir.join("server-hub.sqlite3"),
                backups_dir,
                audit_dir,
                profiles_dir: data_dir.join("profiles"),
                java_dir: data_dir.join("java"),
                palworld_tools_dir: data_dir.join("palworld-tools"),
                tunnel_install_dir: data_dir.join("tunnel-installers"),
                publications: Arc::new(Mutex::new(HashMap::new())),
                tunnels: Arc::new(tunnel::TunnelManager::new()),
                stop_operations: stop_operations_for_state.clone(),
                post_stop_exit_guard: post_stop_exit_guard_for_state.clone(),
                allow_app_exit: allow_app_exit_for_state.clone(),
            };
            app.manage(state);
            start_server_automation_monitor(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            quit_app,
            check_app_update,
            install_app_update,
            list_servers,
            get_co_management_snapshot,
            get_co_management_config,
            get_co_management_legacy_journal_count,
            migrate_co_management_legacy_journal,
            configure_co_management,
            connect_co_management,
            issue_co_management_invite,
            poll_co_management_events,
            get_co_management_pending_code,
            approve_co_management_participant,
            revoke_co_management_participant,
            get_co_management_settings,
            apply_co_management_settings,
            get_co_management_operation,
            respond_co_management_request,
            publish_co_management_snapshot,
            get_co_management_audit,
            get_automation_settings,
            save_automation_settings,
            check_extension_conflicts,
            export_server_migration,
            inspect_server_migration,
            restore_server_migration,
            suggest_server_port,
            inspect_existing_server,
            import_existing_server,
            detect_java,
            get_java_download_plan,
            install_managed_java,
            update_server_java,
            get_server_versions,
            create_server,
            start_server,
            stop_server,
            restart_server,
            send_console_command,
            save_palworld_world,
            update_palworld_settings,
            get_runtime_status,
            get_logs,
            clear_logs,
            save_logs,
            open_server_folder,
            diagnose_pc,
            diagnose_new_server,
            delete_server,
            analyze_server,
            list_backups,
            create_backup,
            restore_backup,
            verify_backup,
            delete_backup,
            open_backup_folder,
            update_server_settings,
            regenerate_world,
            list_extensions,
            install_local_extension,
            set_extension_enabled,
            remove_extension,
            search_extensions,
            list_extension_versions,
            plan_extension_install,
            install_catalog_extension,
            get_invite_info,
            get_invite_settings,
            update_invite_settings,
            get_public_access_status,
            publish_server_upnp,
            unpublish_server,
            list_audit_log,
            list_whitelist,
            update_whitelist_player,
            list_player_access,
            get_player_skin,
            update_player_access,
            list_fixed_players,
            save_fixed_player,
            delete_fixed_player,
            open_windows_uninstall_settings,
            list_modpack_profiles,
            save_modpack_profile,
            duplicate_modpack_profile,
            export_modpack_profile,
            import_modpack_profile,
            compare_modpack_profile,
            delete_modpack_profile,
            get_crossplay_plan,
            install_crossplay,
            get_crossplay_status,
            configure_crossplay,
            get_crossplay_tunnel_status,
            quick_start_crossplay_tunnel,
            stop_crossplay_tunnel,
            diagnose_crossplay_tunnel,
            open_crossplay_tunnel_account_login,
            open_crossplay_tunnel_dashboard,
            probe_crossplay_tunnel_endpoint,
            check_update_safety,
            get_update_center,
            apply_managed_extension_update,
            apply_server_update,
            validate_tunnel_agent,
            get_tunnel_agent_install_plan,
            install_tunnel_agent,
            get_tunnel_status,
            start_tunnel,
            quick_start_tunnel,
            quick_start_palworld_tunnel,
            stop_tunnel,
            diagnose_tunnel,
            open_tunnel_account_login,
            open_tunnel_dashboard,
            probe_tunnel_endpoint,
        ])
        .build(tauri::generate_context!())
        .expect("Minecraft Server Hubの起動に失敗しました");

    app.run(move |app_handle, event| match event {
        tauri::RunEvent::ExitRequested { api, .. } => {
            let active_stops = stop_operations_for_exit
                .load(Ordering::SeqCst)
                .saturating_add(stopping_servers_for_exit.lock().unwrap().len());
            let decision = app_exit_decision(
                allow_app_exit_for_exit.load(Ordering::SeqCst),
                active_stops,
                *post_stop_exit_guard_for_exit.lock().unwrap(),
            );
            append_lifecycle_event(
                app_handle,
                "app.exit-requested",
                match decision {
                    AppExitDecision::Allow => "allow",
                    AppExitDecision::BlockSilently => "block-silently",
                    AppExitDecision::AskUser => "ask-user",
                },
            );
            if decision != AppExitDecision::Allow {
                api.prevent_exit();
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    if decision == AppExitDecision::AskUser {
                        let _ = window.emit("app-close-requested", ());
                    }
                } else {
                    schedule_main_window_restore(
                        app_handle.clone(),
                        allow_app_exit_for_exit.clone(),
                        main_restore_in_flight_for_exit.clone(),
                    );
                }
            }
        }
        tauri::RunEvent::Exit => append_lifecycle_event(app_handle, "app.exit", "final"),
        _ => {}
    });
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashSet,
        path::Path,
        sync::{
            Arc, Mutex,
            atomic::{AtomicUsize, Ordering},
        },
        time::{Duration, Instant},
    };

    use super::{
        AppExitDecision, DeleteBackupMode, StopOperationGuard, activate_staged_server_jar,
        app_exit_decision, app_update_install_allowed, auto_stop_due, delete_server_files,
        ensure_palworld_management_port_unique, ensure_registered_port_unique, find_available_port,
        is_reserved_windows_name, is_valid_delete_confirmation, read_recent_audit,
        registered_ports_for_transport, render_server_properties, resolve_delete_backup_mode,
        safe_folder_name, should_block_app_exit, should_cleanup_external_access,
        should_restore_main_window, validate_create_input, validate_public_access_profile,
        validate_server_delete_target,
    };
    use crate::models::{BasicSettings, CreateServerInput, PalworldSettings, ServerProfile};

    fn input() -> CreateServerInput {
        CreateServerInput {
            name: "Survival World".into(),
            parent_path: "C:\\servers".into(),
            game_kind: "minecraft".into(),
            server_type: "paper".into(),
            minecraft_version: "1.21.11".into(),
            java_path: "C:\\Java\\bin\\java.exe".into(),
            java_major: 21,
            min_memory_mib: 1024,
            max_memory_mib: 4096,
            port: 25565,
            eula_accepted: true,
            bedrock_archive_path: None,
            settings: BasicSettings::default(),
            palworld_settings: None,
        }
    }

    #[test]
    fn app_update_requires_every_server_operation_to_be_idle() {
        assert!(app_update_install_allowed(0, 0, 0));
        assert!(!app_update_install_allowed(1, 0, 0));
        assert!(!app_update_install_allowed(0, 1, 0));
        assert!(!app_update_install_allowed(0, 0, 1));
    }

    #[test]
    fn restores_only_an_unauthorized_destroyed_main_window() {
        assert!(should_restore_main_window("main", false));
        assert!(!should_restore_main_window("main", true));
        assert!(!should_restore_main_window("settings", false));
    }

    #[test]
    fn external_access_cleanup_waits_for_minecraft_stop_completion() {
        assert!(!should_cleanup_external_access("running"));
        assert!(!should_cleanup_external_access("starting"));
        assert!(!should_cleanup_external_access("stopping"));
        assert!(should_cleanup_external_access("stopped"));
        assert!(should_cleanup_external_access("crashed"));
    }

    fn profile(id: &str, name: &str, port: u16) -> ServerProfile {
        ServerProfile {
            id: id.into(),
            name: name.into(),
            root_path: format!("C:\\Servers\\{id}"),
            game_kind: "minecraft".into(),
            server_type: "paper".into(),
            minecraft_version: "1.21.11".into(),
            distribution_build: None,
            launch_target: "server.jar".into(),
            java_path: "C:\\Java\\java.exe".into(),
            java_major: 21,
            min_memory_mib: 1024,
            max_memory_mib: 4096,
            port,
            eula_accepted_at: String::new(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn suggests_the_next_unregistered_available_port() {
        let used = HashSet::from([25565, 25566]);
        let port = find_available_port(&used, 25565, |candidate| candidate != 25567).unwrap();
        assert_eq!(port, 25568);
    }

    #[test]
    fn rejects_a_port_owned_by_another_registered_server() {
        let servers = vec![
            profile("alpha", "Alpha", 25565),
            profile("beta", "Beta", 25566),
        ];
        assert!(
            ensure_registered_port_unique(&servers, Some("beta"), 25565, "tcp", false).is_err()
        );
        assert!(ensure_registered_port_unique(&servers, Some("beta"), 25566, "tcp", false).is_ok());
        let mut bedrock = profile("bedrock", "Bedrock", 25565);
        bedrock.server_type = "bedrock".into();
        assert!(
            ensure_registered_port_unique(
                &[servers[0].clone()],
                Some("bedrock"),
                25565,
                bedrock.network_transport(),
                true
            )
            .is_ok()
        );
        let mut existing_bedrock = profile("existing-bedrock", "Existing Bedrock", 19132);
        existing_bedrock.server_type = "bedrock".into();
        assert!(
            ensure_registered_port_unique(&[existing_bedrock], None, 19133, "udp", false).is_err()
        );
    }

    #[test]
    fn separates_palworld_game_udp_and_local_rest_tcp_reservations() {
        let java = profile("java", "Java", 8212);
        assert!(ensure_palworld_management_port_unique(&[java], None, 8212).is_err());

        let mut palworld = profile("pal", "Palworld", 8211);
        palworld.game_kind = "palworld".into();
        palworld.server_type = "palworld".into();
        palworld.java_path.clear();
        palworld.java_major = 0;
        palworld.palworld_settings = Some(PalworldSettings::default());
        assert!(
            ensure_registered_port_unique(&[palworld.clone()], None, 8211, "tcp", false).is_ok()
        );
        assert!(ensure_palworld_management_port_unique(&[palworld], None, 8212).is_err());
    }

    #[test]
    fn suggests_a_unique_rest_port_for_multiple_palworld_servers() {
        let mut first = profile("pal-one", "Palworld One", 8211);
        first.game_kind = "palworld".into();
        first.server_type = "palworld".into();
        first.palworld_settings = Some(PalworldSettings {
            rest_api_port: 8212,
            ..PalworldSettings::default()
        });
        let mut second = profile("pal-two", "Palworld Two", 8213);
        second.game_kind = "palworld".into();
        second.server_type = "palworld".into();
        second.palworld_settings = Some(PalworldSettings {
            rest_api_port: 8214,
            ..PalworldSettings::default()
        });

        let used = registered_ports_for_transport(&[first, second], "tcp");
        assert!(used.contains(&8212));
        assert!(used.contains(&8214));
        assert_eq!(find_available_port(&used, 8212, |_| true), Some(8213));
    }

    #[test]
    fn accepts_palworld_without_java_or_minecraft_eula_but_requires_local_rest() {
        let mut palworld = input();
        palworld.game_kind = "palworld".into();
        palworld.server_type = "palworld".into();
        palworld.minecraft_version.clear();
        palworld.java_path.clear();
        palworld.java_major = 0;
        palworld.min_memory_mib = 0;
        palworld.max_memory_mib = 0;
        palworld.port = 8211;
        palworld.eula_accepted = false;
        palworld.palworld_settings = Some(PalworldSettings::default());
        assert!(validate_create_input(&palworld).is_ok());
        palworld.palworld_settings.as_mut().unwrap().rest_api_port = 8211;
        assert!(validate_create_input(&palworld).is_err());
    }

    #[test]
    fn reserves_a_persisted_geyser_udp_port_for_future_servers() {
        let base =
            std::env::temp_dir().join(format!("msh-geyser-binding-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(base.join(".server-hub")).unwrap();
        std::fs::write(
            base.join(".server-hub/crossplay.json"),
            br#"{"bedrockPort":19132,"configurationStatus":"restart-required"}"#,
        )
        .unwrap();
        let mut paper = profile("paper", "Crossplay Paper", 25565);
        paper.root_path = base.display().to_string();
        assert!(
            ensure_registered_port_unique(&[paper.clone()], None, 19132, "udp", false).is_err()
        );
        assert!(ensure_registered_port_unique(&[paper], None, 19134, "udp", false).is_ok());
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn reads_a_bounded_long_term_audit_tail_newest_first() {
        let path =
            std::env::temp_dir().join(format!("msh-audit-tail-{}.jsonl", uuid::Uuid::new_v4()));
        let lines = (0..12)
            .map(|index| {
                serde_json::json!({
            "id": format!("entry-{index}"), "at": format!("2026-08-26T00:00:{index:02}Z"),
            "actor": "local-host", "action": "server.test", "detail": format!("item={index}")
        }).to_string()
            })
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(&path, format!("{lines}\ninvalid-json\n")).unwrap();
        let entries = read_recent_audit(&path, 5).unwrap();
        assert_eq!(entries.len(), 5);
        assert_eq!(entries[0].id, "entry-11");
        assert_eq!(entries[4].id, "entry-7");
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn atomically_activates_a_verified_staged_server_jar() {
        let base =
            std::env::temp_dir().join(format!("msh-update-activate-{}", uuid::Uuid::new_v4()));
        let management = base.join(".server-hub");
        std::fs::create_dir_all(&management).unwrap();
        let destination = base.join("server.jar");
        let staging = management.join("update.jar");
        std::fs::write(&destination, b"old-server").unwrap();
        std::fs::write(&staging, b"verified-new-server").unwrap();
        activate_staged_server_jar(&staging, &destination, &management).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), b"verified-new-server");
        assert!(!staging.exists());
        assert_eq!(std::fs::read_dir(&management).unwrap().count(), 0);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn renders_safe_basic_properties() {
        let mut input = input();
        input.settings.world_type = "minecraft:amplified".into();
        input.settings.world_seed = "friends-2026".into();
        input.settings.generate_structures = false;
        input.settings.hardcore = true;
        let properties = render_server_properties(&input);
        assert!(properties.contains("gamemode=survival"));
        assert!(properties.contains("online-mode=true"));
        assert!(properties.contains("level-type=minecraft:amplified"));
        assert!(properties.contains("level-seed=friends-2026"));
        assert!(properties.contains("generate-structures=false"));
        assert!(properties.contains("hardcore=true"));
        assert!(properties.contains("enable-rcon=false"));
    }

    #[test]
    fn renders_the_adjacent_bedrock_ipv6_port_for_custom_ports() {
        let mut input = input();
        input.server_type = "bedrock".into();
        input.port = 20_000;
        input.settings.world_type = "DEFAULT".into();
        let properties = render_server_properties(&input);
        assert!(properties.contains("server-port=20000"));
        assert!(properties.contains("server-portv6=20001"));
    }

    #[test]
    fn refuses_publication_when_account_authentication_is_disabled() {
        let mut settings = BasicSettings::default();
        settings.whitelist = true;
        settings.online_mode = false;
        let profile = ServerProfile {
            id: "offline-mode".into(),
            name: "Offline".into(),
            root_path: "C:\\Servers\\Offline".into(),
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
            settings,
            palworld_settings: None,
            created_at: String::new(),
            updated_at: String::new(),
        };
        assert!(validate_public_access_profile(&profile).is_err());
    }

    #[test]
    fn sanitizes_windows_folder_names() {
        assert!(safe_folder_name("CON", "12345678-rest").starts_with("server-"));
        assert!(safe_folder_name("A/B", "12345678-rest").starts_with("A-B-"));
        assert!(is_reserved_windows_name("LPT1"));
    }

    #[test]
    fn blocks_app_exit_while_stopping_and_during_the_post_stop_grace_period() {
        assert!(!should_block_app_exit(0, None));
        assert!(should_block_app_exit(1, None));
        assert!(should_block_app_exit(
            0,
            Some(Instant::now() + Duration::from_secs(1))
        ));
        assert!(!should_block_app_exit(
            0,
            Some(Instant::now() - Duration::from_secs(1))
        ));

        let counter = Arc::new(AtomicUsize::new(0));
        let post_stop_guard = Arc::new(Mutex::new(None));
        {
            let _guard = StopOperationGuard::new(counter.clone(), post_stop_guard.clone());
            assert_eq!(counter.load(Ordering::SeqCst), 1);
        }
        assert_eq!(counter.load(Ordering::SeqCst), 0);
        assert!(should_block_app_exit(0, *post_stop_guard.lock().unwrap()));
    }

    #[test]
    fn app_exit_requires_explicit_authorization_and_stays_silent_while_stopping() {
        assert_eq!(app_exit_decision(true, 0, None), AppExitDecision::Allow);
        assert_eq!(
            app_exit_decision(false, 1, None),
            AppExitDecision::BlockSilently
        );
        assert_eq!(
            app_exit_decision(false, 0, Some(Instant::now() + Duration::from_secs(1))),
            AppExitDecision::BlockSilently
        );
        assert_eq!(app_exit_decision(false, 0, None), AppExitDecision::AskUser);
    }

    #[test]
    fn deletion_target_requires_the_registered_game_layout() {
        let parent = std::env::temp_dir().join(format!("msh-delete-test-{}", uuid::Uuid::new_v4()));
        let target = parent.join("server");
        std::fs::create_dir_all(&target).unwrap();
        let mut minecraft = profile("delete-layout", "Delete Layout", 25565);
        minecraft.root_path = target.display().to_string();
        assert!(validate_server_delete_target(&minecraft).is_err());
        std::fs::write(target.join("server.properties"), "online-mode=true\n").unwrap();
        assert_eq!(
            validate_server_delete_target(&minecraft).unwrap(),
            target.canonicalize().unwrap()
        );

        let palworld_root = parent.join("palworld");
        std::fs::create_dir_all(palworld_root.join("Pal").join("Binaries").join("Win64")).unwrap();
        std::fs::write(palworld_root.join("PalServer.exe"), b"launcher").unwrap();
        let mut palworld = profile("delete-palworld-layout", "Delete Palworld Layout", 8211);
        palworld.root_path = palworld_root.display().to_string();
        palworld.game_kind = "palworld".into();
        palworld.server_type = "palworld".into();
        palworld.launch_target = "PalServer.exe".into();
        palworld.palworld_settings = Some(PalworldSettings::default());
        assert!(validate_server_delete_target(&palworld).is_err());
        std::fs::write(
            palworld_root
                .join("Pal")
                .join("Binaries")
                .join("Win64")
                .join("PalServer-Win64-Shipping-Cmd.exe"),
            b"server",
        )
        .unwrap();
        std::fs::write(
            palworld_root.join("DefaultPalWorldSettings.ini"),
            b"[/Script/Pal.PalGameWorldSettings]",
        )
        .unwrap();
        assert_eq!(
            validate_server_delete_target(&palworld).unwrap(),
            palworld_root.canonicalize().unwrap()
        );
        std::fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn server_deletion_requires_the_exact_language_independent_phrase() {
        assert!(is_valid_delete_confirmation("Delete"));
        assert!(!is_valid_delete_confirmation("delete"));
        assert!(!is_valid_delete_confirmation("DELETE"));
        assert!(!is_valid_delete_confirmation(" Delete "));
        assert!(!is_valid_delete_confirmation("Creative Test"));
    }

    #[test]
    fn deletion_backup_modes_are_explicit_and_palworld_essential_is_scoped() {
        let minecraft = profile("minecraft", "Minecraft", 25565);
        let mut palworld = profile("palworld", "Palworld", 8211);
        palworld.game_kind = "palworld".into();
        palworld.server_type = "palworld".into();
        assert_eq!(
            resolve_delete_backup_mode(None, &minecraft).unwrap(),
            DeleteBackupMode::Full
        );
        assert_eq!(
            resolve_delete_backup_mode(Some("none"), &minecraft).unwrap(),
            DeleteBackupMode::None
        );
        assert!(resolve_delete_backup_mode(Some("essential"), &minecraft).is_err());
        assert_eq!(
            resolve_delete_backup_mode(Some("essential"), &palworld).unwrap(),
            DeleteBackupMode::Essential
        );
        assert!(resolve_delete_backup_mode(Some("unexpected"), &palworld).is_err());
    }

    #[test]
    fn folder_deletion_keeps_a_verified_final_backup() {
        let base =
            std::env::temp_dir().join(format!("msh-delete-backup-test-{}", uuid::Uuid::new_v4()));
        let root = base.join("servers").join("delete-me");
        let backups = base.join("backups");
        std::fs::create_dir_all(root.join("world")).unwrap();
        std::fs::write(root.join("server.properties"), "online-mode=true\n").unwrap();
        std::fs::write(root.join("world").join("level.dat"), b"test-world").unwrap();
        let now = "2026-08-25T00:00:00Z".to_string();
        let profile = ServerProfile {
            id: "delete-me".into(),
            name: "Delete Me".into(),
            root_path: root.display().to_string(),
            game_kind: "minecraft".into(),
            server_type: "paper".into(),
            minecraft_version: "1.21.11".into(),
            distribution_build: None,
            launch_target: "server.jar".into(),
            java_path: "C:\\Java\\java.exe".into(),
            java_major: 21,
            min_memory_mib: 1024,
            max_memory_mib: 4096,
            port: 25565,
            eula_accepted_at: now.clone(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: None,
            created_at: now.clone(),
            updated_at: now,
        };
        let backup_path = delete_server_files(&backups, &profile, DeleteBackupMode::Full)
            .unwrap()
            .unwrap();
        assert!(!root.exists());
        assert!(Path::new(&backup_path).is_file());
        let listed = crate::backup::list(&backups, &profile.id).unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].valid);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn minecraft_immediate_deletion_creates_no_backup() {
        let base = std::env::temp_dir().join(format!(
            "msh-minecraft-immediate-delete-test-{}",
            uuid::Uuid::new_v4()
        ));
        let root = base.join("servers").join("delete-minecraft-now");
        let backups = base.join("backups");
        std::fs::create_dir_all(root.join("world")).unwrap();
        std::fs::create_dir_all(root.join("plugins")).unwrap();
        std::fs::write(root.join("server.properties"), "online-mode=true\n").unwrap();
        std::fs::write(root.join("world").join("level.dat"), b"test-world").unwrap();
        std::fs::write(root.join("plugins").join("test.jar"), b"test-plugin").unwrap();
        let mut minecraft = profile("delete-minecraft-now", "Delete Minecraft Now", 25565);
        minecraft.root_path = root.display().to_string();

        let backup_path =
            delete_server_files(&backups, &minecraft, DeleteBackupMode::None).unwrap();
        assert!(backup_path.is_none());
        assert!(!root.exists());
        assert!(
            crate::backup::list(&backups, &minecraft.id)
                .unwrap()
                .is_empty()
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn palworld_folder_deletion_keeps_a_verified_final_backup() {
        let base = std::env::temp_dir().join(format!(
            "msh-palworld-delete-backup-test-{}",
            uuid::Uuid::new_v4()
        ));
        let root = base.join("servers").join("delete-palworld");
        let backups = base.join("backups");
        let binaries = root.join("Pal").join("Binaries").join("Win64");
        let config = root
            .join("Pal")
            .join("Saved")
            .join("Config")
            .join("WindowsServer");
        let world = root.join("Pal").join("Saved").join("SaveGames");
        std::fs::create_dir_all(&binaries).unwrap();
        std::fs::create_dir_all(&config).unwrap();
        std::fs::create_dir_all(&world).unwrap();
        std::fs::write(root.join("PalServer.exe"), b"launcher").unwrap();
        std::fs::write(binaries.join("PalServer-Win64-Shipping-Cmd.exe"), b"server").unwrap();
        std::fs::write(
            root.join("DefaultPalWorldSettings.ini"),
            b"[/Script/Pal.PalGameWorldSettings]",
        )
        .unwrap();
        std::fs::write(
            config.join("PalWorldSettings.ini"),
            b"OptionSettings=(ServerName=\"Test\")",
        )
        .unwrap();
        std::fs::write(world.join("Level.sav"), b"test-world").unwrap();

        let mut palworld = profile("delete-palworld", "Delete Palworld", 8211);
        palworld.root_path = root.display().to_string();
        palworld.game_kind = "palworld".into();
        palworld.server_type = "palworld".into();
        palworld.minecraft_version = String::new();
        palworld.launch_target = "PalServer.exe".into();
        palworld.java_path = String::new();
        palworld.java_major = 0;
        palworld.palworld_settings = Some(PalworldSettings::default());

        let backup_path = delete_server_files(&backups, &palworld, DeleteBackupMode::Full)
            .unwrap()
            .unwrap();
        assert!(!root.exists());
        assert!(Path::new(&backup_path).is_file());
        let listed = crate::backup::list(&backups, &palworld.id).unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].valid);
        assert_eq!(
            listed[0].kind,
            crate::models::BackupKind::BeforeServerDelete
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn palworld_immediate_deletion_creates_no_backup() {
        let base = std::env::temp_dir().join(format!(
            "msh-palworld-immediate-delete-test-{}",
            uuid::Uuid::new_v4()
        ));
        let root = base.join("servers").join("delete-palworld-now");
        let backups = base.join("backups");
        let binaries = root.join("Pal").join("Binaries").join("Win64");
        std::fs::create_dir_all(&binaries).unwrap();
        std::fs::write(root.join("PalServer.exe"), b"launcher").unwrap();
        std::fs::write(binaries.join("PalServer-Win64-Shipping-Cmd.exe"), b"server").unwrap();
        std::fs::write(root.join("DefaultPalWorldSettings.ini"), b"settings").unwrap();
        let mut palworld = profile("delete-palworld-now", "Delete Palworld Now", 8211);
        palworld.root_path = root.display().to_string();
        palworld.game_kind = "palworld".into();
        palworld.server_type = "palworld".into();
        palworld.launch_target = "PalServer.exe".into();
        palworld.palworld_settings = Some(PalworldSettings::default());

        let backup_path = delete_server_files(&backups, &palworld, DeleteBackupMode::None).unwrap();
        assert!(backup_path.is_none());
        assert!(!root.exists());
        assert!(
            crate::backup::list(&backups, &palworld.id)
                .unwrap()
                .is_empty()
        );
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn auto_stop_waits_for_the_full_idle_period_and_no_players() {
        assert!(!auto_stop_due(
            true,
            "running",
            0,
            Duration::from_secs(29 * 60 + 59),
            30
        ));
        assert!(auto_stop_due(
            true,
            "running",
            0,
            Duration::from_secs(30 * 60),
            30
        ));
        assert!(!auto_stop_due(
            true,
            "running",
            1,
            Duration::from_secs(60 * 60),
            30
        ));
        assert!(!auto_stop_due(
            false,
            "running",
            0,
            Duration::from_secs(60 * 60),
            30
        ));
        assert!(!auto_stop_due(
            true,
            "starting",
            0,
            Duration::from_secs(60 * 60),
            30
        ));
    }
}
