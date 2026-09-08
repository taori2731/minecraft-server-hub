use std::{
    ffi::OsString,
    fs::{File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::Arc,
    thread,
    time::Duration,
};

use base64::{Engine, engine::general_purpose::STANDARD as BASE64_STANDARD};
use futures_util::StreamExt;
use reqwest::{Client, StatusCode, Url, redirect::Policy};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zip::ZipArchive;

use crate::{
    credentials,
    error::{AppError, AppResult},
    models::{PalworldPlayer, PalworldRuntimeMetrics, PalworldSettings, ServerProfile},
    protected_data,
    windows_process::hide_console_window,
};

pub const STEAM_APP_ID: &str = "2394010";
pub const STEAMCMD_SOURCE_URL: &str =
    "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip";
pub const DEFAULT_GAME_PORT: u16 = 8211;
pub const DEFAULT_REST_PORT: u16 = 8212;
pub const REST_USERNAME: &str = "admin";

const MAX_STEAMCMD_ARCHIVE_BYTES: u64 = 8 * 1024 * 1024;
const MAX_STEAMCMD_INSTALL_ATTEMPTS: u8 = 3;
const DOWNLOAD_IDLE_TIMEOUT: Duration = Duration::from_secs(45);
const REST_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone)]
pub struct PalworldInstallResult {
    pub steamcmd_sha256: String,
    pub steamcmd_signer: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PalworldInstallProgress {
    pub phase: String,
    pub percent: Option<f64>,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub bytes_per_second: Option<u64>,
}

pub type InstallProgressCallback = Arc<dyn Fn(PalworldInstallProgress) + Send + Sync>;

#[derive(Debug, Deserialize)]
struct SignatureResult {
    status: String,
    subject: String,
}

#[derive(Debug, Deserialize)]
struct RestInfo {
    version: String,
    servername: String,
    description: String,
    worldguid: String,
}

#[derive(Debug, Deserialize)]
struct RestMetrics {
    serverfps: u32,
    currentplayernum: u32,
    serverframetime: f32,
    maxplayernum: u32,
    uptime: u64,
    #[serde(default)]
    basecampnum: Option<u32>,
    #[serde(default)]
    days: Option<u32>,
}

#[derive(Debug, Deserialize)]
struct RestPlayers {
    players: Vec<RestPlayer>,
}

#[derive(Debug, Deserialize)]
struct RestPlayer {
    name: String,
    #[serde(rename = "accountName")]
    account_name: String,
    #[serde(rename = "playerId")]
    player_id: String,
    #[serde(rename = "userId")]
    user_id: String,
    ping: f32,
    level: u32,
    #[serde(default)]
    building_count: u32,
    // The official response also contains IP address and coordinates. They are
    // intentionally not represented so they cannot cross the Tauri boundary.
}

#[derive(Debug, Clone)]
pub struct MonitorSnapshot {
    pub metrics: PalworldRuntimeMetrics,
    pub current_players: u32,
    pub max_players: u32,
    pub uptime_seconds: u64,
}

pub async fn install_server(
    download_client: &Client,
    tools_root: &Path,
    server_root: &Path,
    server_id: &str,
    server_name: &str,
    game_port: u16,
    settings: &PalworldSettings,
    on_progress: InstallProgressCallback,
) -> AppResult<PalworldInstallResult> {
    validate_settings(game_port, settings)?;
    on_progress(PalworldInstallProgress::phase("steamcmd"));
    let (steamcmd, _, _) = ensure_steamcmd(download_client, tools_root).await?;
    let root = server_root.to_path_buf();
    let executable = steamcmd.clone();
    let install_progress = on_progress.clone();
    tokio::task::spawn_blocking(move || {
        run_steamcmd_install(&executable, &root, &install_progress)
    })
    .await
    .map_err(|error| AppError::Other(format!("SteamCMD処理が中断されました: {error}")))??;
    on_progress(PalworldInstallProgress::phase("verify"));
    // SteamCMD self-updates during execution. Validate and inventory the exact
    // executable left on disk, not only the small bootstrap we downloaded.
    let steamcmd_signer = verify_valve_authenticode(&steamcmd)?;
    let steamcmd_sha256 = sha256_file(&steamcmd)?;
    validate_server_layout(server_root)?;

    let password = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    credentials::store_palworld_admin_password(server_id, &password)?;
    if let Err(error) =
        write_initial_config(server_root, server_name, game_port, settings, &password)
    {
        let _ = credentials::delete_palworld_admin_password(server_id);
        return Err(error);
    }
    on_progress(PalworldInstallProgress::phase("configure"));

    let management = server_root.join(".server-hub");
    std::fs::create_dir_all(&management)?;
    std::fs::write(
        management.join("palworld-install.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "source": STEAMCMD_SOURCE_URL,
            "steamAppId": STEAM_APP_ID,
            "steamCmdSha256": steamcmd_sha256,
            "steamCmdSigner": steamcmd_signer,
            "installedAt": chrono::Utc::now().to_rfc3339(),
            "restApi": {
                "host": "127.0.0.1",
                "port": settings.rest_api_port,
                "credentialStore": "Windows Credential Manager",
                "internetExposureSupported": false
            }
        }))?,
    )?;

    Ok(PalworldInstallResult {
        steamcmd_sha256,
        steamcmd_signer,
    })
}

impl PalworldInstallProgress {
    fn phase(phase: &str) -> Self {
        Self {
            phase: phase.into(),
            percent: None,
            downloaded_bytes: None,
            total_bytes: None,
            bytes_per_second: None,
        }
    }
}

pub fn validate_server_layout(root: &Path) -> AppResult<PathBuf> {
    let canonical_root = root.canonicalize()?;
    let launcher = root.join("PalServer.exe");
    let executable = root
        .join("Pal")
        .join("Binaries")
        .join("Win64")
        .join("PalServer-Win64-Shipping-Cmd.exe");
    if !launcher.is_file()
        || !executable.is_file()
        || !root.join("DefaultPalWorldSettings.ini").is_file()
    {
        return Err(AppError::Validation(
            "SteamCMDの完了後にPalworldの実行ファイルまたは既定設定が見つかりません".into(),
        ));
    }
    let canonical_executable = executable.canonicalize()?;
    if !canonical_executable.starts_with(&canonical_root) {
        return Err(AppError::Validation(
            "Palworldの実行ファイルが管理対象フォルダーの外を指しているため実行しません".into(),
        ));
    }
    Ok(canonical_executable)
}

pub fn launch_arguments(profile: &ServerProfile) -> AppResult<Vec<String>> {
    let settings = profile
        .palworld_settings
        .as_ref()
        .ok_or_else(|| AppError::Validation("Palworld設定が登録されていません".into()))?;
    validate_settings(profile.port, settings)?;
    Ok(vec![
        "Pal".into(),
        format!("-port={}", profile.port),
        format!("-players={}", settings.max_players),
        "-logformat=text".into(),
    ])
}

pub async fn monitor(profile: &ServerProfile) -> AppResult<MonitorSnapshot> {
    let settings = profile
        .palworld_settings
        .as_ref()
        .ok_or_else(|| AppError::Validation("Palworld REST設定が登録されていません".into()))?;
    if !settings.rest_api_enabled {
        return Err(AppError::Validation(
            "Palworld REST APIが無効になっています".into(),
        ));
    }
    let password = credentials::load_palworld_admin_password(&profile.id)?;
    let client = rest_client()?;
    let info_url = rest_url(settings.rest_api_port, "info")?;
    let metrics_url = rest_url(settings.rest_api_port, "metrics")?;
    let players_url = rest_url(settings.rest_api_port, "players")?;
    let (info, metrics, players) = tokio::try_join!(
        get_json::<RestInfo>(&client, info_url, &password),
        get_json::<RestMetrics>(&client, metrics_url, &password),
        get_json::<RestPlayers>(&client, players_url, &password),
    )?;
    let safe_players = safe_players(players);
    Ok(MonitorSnapshot {
        metrics: PalworldRuntimeMetrics {
            api_reachable: true,
            version: Some(info.version),
            server_name: Some(info.servername),
            world_guid: Some(info.worldguid),
            server_fps: Some(metrics.serverfps),
            server_frame_time_ms: Some(metrics.serverframetime),
            base_camp_count: metrics.basecampnum,
            world_days: metrics.days,
            players: safe_players,
        },
        current_players: metrics.currentplayernum,
        max_players: metrics.maxplayernum,
        uptime_seconds: metrics.uptime,
    })
}

fn safe_players(players: RestPlayers) -> Vec<PalworldPlayer> {
    players
        .players
        .into_iter()
        .filter(|player| valid_player_text(&player.name) && valid_player_text(&player.user_id))
        .map(|player| PalworldPlayer {
            name: player.name,
            account_name: player.account_name,
            player_id: player.player_id,
            user_id: player.user_id,
            ping: player.ping,
            level: player.level,
            building_count: player.building_count,
        })
        .collect()
}

pub async fn save_world(profile: &ServerProfile) -> AppResult<()> {
    post_empty(profile, "save").await
}

pub async fn shutdown(profile: &ServerProfile, wait_seconds: u32) -> AppResult<()> {
    let settings = profile
        .palworld_settings
        .as_ref()
        .ok_or_else(|| AppError::Validation("Palworld REST設定が登録されていません".into()))?;
    let password = credentials::load_palworld_admin_password(&profile.id)?;
    shutdown_with_password(settings.rest_api_port, &password, wait_seconds).await
}

async fn shutdown_with_password(port: u16, password: &str, wait_seconds: u32) -> AppResult<()> {
    let body = serde_json::to_string(&serde_json::json!({
        "waittime": wait_seconds,
        "message": "Saving complete. Server is shutting down safely."
    }))?;
    post_with_password(port, "shutdown", password, Some(body), "Palworld安全停止").await
}

async fn post_empty(profile: &ServerProfile, endpoint: &str) -> AppResult<()> {
    let settings = profile
        .palworld_settings
        .as_ref()
        .ok_or_else(|| AppError::Validation("Palworld REST設定が登録されていません".into()))?;
    let password = credentials::load_palworld_admin_password(&profile.id)?;
    post_empty_with_password(settings.rest_api_port, endpoint, &password).await
}

async fn post_empty_with_password(port: u16, endpoint: &str, password: &str) -> AppResult<()> {
    post_with_password(port, endpoint, password, None, "Palworldワールド保存").await
}

async fn post_with_password(
    port: u16,
    endpoint: &str,
    password: &str,
    body: Option<String>,
    operation: &'static str,
) -> AppResult<()> {
    // Validate with the same fixed loopback URL policy used by GET requests
    // before handing owned values to the blocking socket task.
    rest_url(port, endpoint)?;
    let endpoint = endpoint.to_owned();
    let password = password.to_owned();
    tokio::task::spawn_blocking(move || {
        post_loopback_blocking(port, &endpoint, &password, body.as_deref(), operation)
    })
    .await
    .map_err(|error| AppError::Other(format!("Palworld REST処理が中断されました: {error}")))?
}

fn post_loopback_blocking(
    port: u16,
    endpoint: &str,
    password: &str,
    body: Option<&str>,
    operation: &str,
) -> AppResult<()> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))?;
    stream.set_read_timeout(Some(REST_TIMEOUT))?;
    stream.set_write_timeout(Some(REST_TIMEOUT))?;
    let body = body.unwrap_or("");
    let authorization = BASE64_STANDARD.encode(format!("{REST_USERNAME}:{password}"));
    let request = format!(
        "POST /v1/api/{endpoint} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Basic {authorization}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream.write_all(request.as_bytes())?;
    stream.flush()?;

    // Palworld 1.0.3 currently replies to mutating endpoints with
    // `HTTP/1.1 200` (no reason phrase). That status line is unambiguous but
    // rejected by strict hyper parsing. Parse only a bounded status line and
    // accept it solely when its HTTP version and numeric 2xx status are valid.
    let mut status_line = String::new();
    BufReader::new(stream)
        .take(256)
        .read_line(&mut status_line)?;
    if status_line.len() > 128 || !status_line.ends_with('\n') {
        return Err(AppError::Other(format!(
            "{operation}のREST応答先頭行が不正です"
        )));
    }
    let fields = status_line.split_ascii_whitespace().collect::<Vec<_>>();
    if fields.len() < 2 || !matches!(fields[0], "HTTP/1.0" | "HTTP/1.1") {
        return Err(AppError::Other(format!(
            "{operation}のREST応答形式が不正です"
        )));
    }
    let status = fields[1]
        .parse::<u16>()
        .map_err(|_| AppError::Other(format!("{operation}のREST状態コードが不正です")))?;
    if (200..300).contains(&status) {
        return Ok(());
    }
    if status == 401 {
        return Err(AppError::Validation(format!(
            "{operation}のREST認証に失敗しました。管理資格情報を再設定してください"
        )));
    }
    Err(AppError::Other(format!(
        "{operation}に失敗しました（HTTP {status}）"
    )))
}

async fn get_json<T: for<'de> Deserialize<'de>>(
    client: &Client,
    url: Url,
    password: &str,
) -> AppResult<T> {
    let response = client
        .get(url)
        .basic_auth(REST_USERNAME, Some(password))
        .send()
        .await?;
    if response.status() == StatusCode::UNAUTHORIZED {
        return Err(AppError::Validation(
            "Palworld REST認証に失敗しました。管理資格情報を再設定してください".into(),
        ));
    }
    Ok(response.error_for_status()?.json().await?)
}

fn rest_client() -> AppResult<Client> {
    Client::builder()
        .no_proxy()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(2))
        .timeout(REST_TIMEOUT)
        .build()
        .map_err(Into::into)
}

fn rest_url(port: u16, endpoint: &str) -> AppResult<Url> {
    if port == 0 || endpoint.is_empty() || !endpoint.bytes().all(|byte| byte.is_ascii_alphabetic())
    {
        return Err(AppError::Validation(
            "Palworld REST APIの宛先が不正です".into(),
        ));
    }
    Url::parse(&format!("http://127.0.0.1:{port}/v1/api/{endpoint}"))
        .map_err(|error| AppError::Other(error.to_string()))
}

fn valid_player_text(value: &str) -> bool {
    !value.trim().is_empty() && value.chars().count() <= 128 && !value.chars().any(char::is_control)
}

pub fn validate_settings(game_port: u16, settings: &PalworldSettings) -> AppResult<()> {
    if game_port < 1024 || settings.rest_api_port < 1024 {
        return Err(AppError::Validation(
            "Palworldのゲーム用ポートとRESTポートは1024以上にしてください".into(),
        ));
    }
    if game_port == settings.rest_api_port {
        return Err(AppError::Validation(
            "Palworldのゲーム用UDPポートとREST管理ポートは別の番号にしてください".into(),
        ));
    }
    if !(1..=32).contains(&settings.max_players) {
        return Err(AppError::Validation(
            "Palworldの最大人数は1～32人で設定してください".into(),
        ));
    }
    if !settings.rest_api_enabled {
        return Err(AppError::Validation(
            "安全な保存・停止のためPalworld REST APIを有効にしてください".into(),
        ));
    }
    for (label, value) in [
        ("経験値倍率", settings.exp_rate),
        ("ドロップ倍率", settings.collection_drop_rate),
        ("捕獲率", settings.pal_capture_rate),
        ("昼の速度", settings.day_time_speed_rate),
        ("夜の速度", settings.night_time_speed_rate),
    ] {
        if !value.is_finite() || !(0.1..=20.0).contains(&value) {
            return Err(AppError::Validation(format!(
                "Palworldの{label}は0.1～20.0で設定してください"
            )));
        }
    }
    if !settings.pal_egg_default_hatching_time.is_finite()
        || !(0.0..=240.0).contains(&settings.pal_egg_default_hatching_time)
    {
        return Err(AppError::Validation(
            "Palworldの巨大卵の孵化時間は0～240時間で設定してください".into(),
        ));
    }
    if !matches!(
        settings.death_penalty.as_str(),
        "None" | "Item" | "ItemAndEquipment" | "All"
    ) {
        return Err(AppError::Validation(
            "Palworldの死亡時ペナルティが不正です".into(),
        ));
    }
    if !(1..=10).contains(&settings.base_camp_max_num_in_guild) {
        return Err(AppError::Validation(
            "ギルドの拠点上限は1～10で設定してください".into(),
        ));
    }
    if !(1..=50).contains(&settings.base_camp_worker_max_num) {
        return Err(AppError::Validation(
            "拠点の作業パル上限は1～50で設定してください".into(),
        ));
    }
    if settings.server_description.chars().count() > 256
        || settings.server_description.chars().any(char::is_control)
    {
        return Err(AppError::Validation(
            "Palworldのサーバー説明は制御文字を含めず256文字以内にしてください".into(),
        ));
    }
    Ok(())
}

pub fn validate_password(value: &str, allow_empty: bool) -> AppResult<()> {
    let length = value.chars().count();
    if (length == 0 && allow_empty) || (1..=64).contains(&length) {
        if !value.chars().any(char::is_control) && !value.contains(['"', '\\']) {
            return Ok(());
        }
    }
    Err(AppError::Validation(
        "Palworldのパスワードは1～64文字とし、改行・ダブルクォート・バックスラッシュを含めないでください".into(),
    ))
}

async fn ensure_steamcmd(
    client: &Client,
    tools_root: &Path,
) -> AppResult<(PathBuf, String, String)> {
    std::fs::create_dir_all(tools_root)?;
    let executable = tools_root.join("steamcmd.exe");
    if executable.is_file() {
        let signer = verify_valve_authenticode(&executable)?;
        return Ok((executable.clone(), sha256_file(&executable)?, signer));
    }

    let archive = tools_root.join(format!(".steamcmd-{}.zip.part", Uuid::new_v4()));
    let staged_executable = tools_root.join(format!(".steamcmd-{}.exe.part", Uuid::new_v4()));
    let result: AppResult<(PathBuf, String, String)> = async {
        download_steamcmd(client, &archive).await?;
        extract_steamcmd(&archive, &staged_executable)?;
        let signer = verify_valve_authenticode(&staged_executable)?;
        let sha256 = sha256_file(&staged_executable)?;
        std::fs::rename(&staged_executable, &executable)?;
        Ok((executable.clone(), sha256, signer))
    }
    .await;
    let _ = std::fs::remove_file(&archive);
    let _ = std::fs::remove_file(&staged_executable);
    result
}

async fn download_steamcmd(client: &Client, destination: &Path) -> AppResult<()> {
    let url =
        Url::parse(STEAMCMD_SOURCE_URL).map_err(|error| AppError::Other(error.to_string()))?;
    validate_steamcmd_url(&url)?;
    let response = client
        .get(url)
        .timeout(Duration::from_secs(180))
        .send()
        .await?
        .error_for_status()?;
    validate_steamcmd_url(response.url())?;
    if response
        .content_length()
        .is_some_and(|length| length > MAX_STEAMCMD_ARCHIVE_BYTES)
    {
        return Err(AppError::Validation(
            "SteamCMD ZIPが安全上限（8 MiB）を超えています".into(),
        ));
    }
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?;
    let mut received = 0u64;
    let mut stream = response.bytes_stream();
    loop {
        let next = tokio::time::timeout(DOWNLOAD_IDLE_TIMEOUT, stream.next())
            .await
            .map_err(|_| AppError::Other("SteamCMDの受信が45秒間進みませんでした".into()))?;
        let Some(chunk) = next else { break };
        let chunk = chunk?;
        received = received.saturating_add(chunk.len() as u64);
        if received > MAX_STEAMCMD_ARCHIVE_BYTES {
            return Err(AppError::Validation(
                "SteamCMD ZIPが安全上限（8 MiB）を超えました".into(),
            ));
        }
        output.write_all(&chunk)?;
    }
    output.flush()?;
    Ok(())
}

fn validate_steamcmd_url(url: &Url) -> AppResult<()> {
    if url.scheme() != "https"
        || url.host_str() != Some("steamcdn-a.akamaihd.net")
        || url.path() != "/client/installer/steamcmd.zip"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(AppError::Validation(
            "SteamCMDの配布URLが公式の固定HTTPS URLと一致しません".into(),
        ));
    }
    Ok(())
}

fn extract_steamcmd(archive_path: &Path, destination: &Path) -> AppResult<()> {
    let mut archive = ZipArchive::new(File::open(archive_path)?)
        .map_err(|error| AppError::Other(format!("SteamCMD ZIPを開けません: {error}")))?;
    if archive.len() == 0 || archive.len() > 16 {
        return Err(AppError::Validation(
            "SteamCMD ZIPの項目数が想定範囲外です".into(),
        ));
    }
    let mut found = false;
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| AppError::Other(error.to_string()))?;
        let enclosed = entry
            .enclosed_name()
            .ok_or_else(|| AppError::Validation("SteamCMD ZIPに危険な相対パスがあります".into()))?;
        if enclosed.components().any(|part| {
            !matches!(part, Component::Normal(_))
                || part.as_os_str().to_string_lossy().contains([':', '\0'])
        }) {
            return Err(AppError::Validation(
                "SteamCMD ZIPにWindowsで安全に展開できない項目があります".into(),
            ));
        }
        if enclosed == Path::new("steamcmd.exe") {
            if found || entry.is_dir() || entry.size() > 4 * 1024 * 1024 {
                return Err(AppError::Validation(
                    "SteamCMD実行ファイルの構成が不正です".into(),
                ));
            }
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(destination)?;
            std::io::copy(&mut entry, &mut output)?;
            output.flush()?;
            found = true;
        }
    }
    if !found {
        return Err(AppError::Validation(
            "SteamCMD ZIPにsteamcmd.exeがありません".into(),
        ));
    }
    Ok(())
}

fn run_steamcmd_install(
    steamcmd: &Path,
    server_root: &Path,
    on_progress: &InstallProgressCallback,
) -> AppResult<()> {
    if !server_root.is_absolute() || !server_root.is_dir() {
        return Err(AppError::Validation(
            "Palworldの取得先は作成済みの絶対パスに限られます".into(),
        ));
    }
    let tool_root = steamcmd
        .parent()
        .ok_or_else(|| AppError::Other("SteamCMDフォルダーを確認できません".into()))?;
    let mut last_output = String::new();
    for attempt in 1..=MAX_STEAMCMD_INSTALL_ATTEMPTS {
        let management = server_root.join(".server-hub");
        std::fs::create_dir_all(&management)?;
        let output_path = management.join(format!("steamcmd-attempt-{attempt}.log"));
        let output_file = File::create(&output_path)?;
        let error_file = output_file.try_clone()?;
        let content_log = tool_root.join("logs").join("content_log.txt");
        let mut command = Command::new(steamcmd);
        command
            .current_dir(tool_root)
            .args(steamcmd_arguments(server_root))
            .stdout(Stdio::from(output_file))
            .stderr(Stdio::from(error_file));
        hide_console_window(&mut command);
        let mut child = command.spawn()?;
        on_progress(PalworldInstallProgress {
            phase: "download".into(),
            percent: Some(0.0),
            downloaded_bytes: Some(0),
            total_bytes: None,
            bytes_per_second: None,
        });
        loop {
            if let Some(status) = child.try_wait()? {
                last_output = std::fs::read_to_string(&output_path)
                    .map(|value| tail(&value, 2_000))
                    .unwrap_or_default();
                if status.success() {
                    let mut progress = read_steamcmd_progress(&content_log, &output_path);
                    progress.percent = Some(100.0);
                    if progress.downloaded_bytes.is_none() {
                        progress.downloaded_bytes = progress.total_bytes;
                    }
                    on_progress(progress);
                    let _ = std::fs::remove_file(&output_path);
                    return Ok(());
                }
                break;
            }
            on_progress(read_steamcmd_progress(&content_log, &output_path));
            // SteamCMD rewrites its console progress in place. Sampling twice a
            // second keeps the UI current without inventing estimated values.
            thread::sleep(Duration::from_millis(500));
        }
        if child.try_wait()?.is_some_and(|status| status.success()) {
            return Ok(());
        }

        // The small official bootstrap can finish its first self-update by
        // replacing steamcmd.exe and returning a non-zero status before it
        // processes +app_update. Retry only after the executable left on disk
        // is still signed by Valve, and keep the retry count strictly bounded.
        verify_valve_authenticode(steamcmd)?;
        if attempt < MAX_STEAMCMD_INSTALL_ATTEMPTS {
            continue;
        }
    }
    Err(AppError::Other(format!(
        "SteamCMDによるPalworldサーバー取得に{MAX_STEAMCMD_INSTALL_ATTEMPTS}回失敗しました: {last_output}"
    )))
}

fn read_steamcmd_progress(content_log: &Path, output_log: &Path) -> PalworldInstallProgress {
    let contents = std::fs::read_to_string(content_log).unwrap_or_default();
    let recent = tail(&contents, 96_000);
    // SteamCMD keeps content_log.txt between runs. Only inspect the current
    // Palworld update block so an old completed download cannot be shown as the
    // progress of a new server.
    let update_marker = format!("AppID {STEAM_APP_ID} update started : download ");
    let current_update = recent
        .rfind(&update_marker)
        .map(|index| &recent[index..])
        .unwrap_or(&recent);
    let mut total = None;
    let mut downloaded = None;
    let mut bytes_per_second = None;
    for line in current_update.lines() {
        if let Some(marker) = line.find("update started : download ") {
            let values = &line[marker + "update started : download ".len()..];
            if let Some((_, value)) = values.split_once('/') {
                total = value
                    .split_whitespace()
                    .next()
                    .map(|value| {
                        value.trim_end_matches(|character: char| !character.is_ascii_digit())
                    })
                    .and_then(|value| value.parse().ok());
            }
        }
        if line.contains(" stats: ") {
            if let Some((prefix, _)) = line.rsplit_once(" Bytes") {
                downloaded = prefix
                    .split_whitespace()
                    .last()
                    .and_then(|value| value.parse::<u64>().ok())
                    .or(downloaded);
            }
        }
        if let Some((_, value)) = line.rsplit_once("Current download rate: ") {
            if let Some(mbps) = value
                .split_whitespace()
                .next()
                .and_then(|value| value.parse::<f64>().ok())
            {
                bytes_per_second = Some((mbps * 1_000_000.0 / 8.0) as u64);
            }
        }
    }
    // Newer SteamCMD builds do not always write the former `stats: ... Bytes`
    // line to content_log.txt. Its console output still reports
    // `progress: 12.34 (current / total)`, so read the per-attempt output too.
    let console = std::fs::read_to_string(output_log).unwrap_or_default();
    let mut console_percent = None;
    for line in tail(&console, 96_000).lines() {
        let Some((_, value)) = line.rsplit_once("progress:") else {
            continue;
        };
        if let Some(parsed) = value
            .trim_start()
            .split_whitespace()
            .next()
            .map(|value| value.trim_end_matches('%'))
            .and_then(|value| value.parse::<f64>().ok())
            .filter(|value| value.is_finite() && (0.0..=100.0).contains(value))
        {
            console_percent = Some(parsed);
        }
        if let Some((_, parenthesized)) = value.split_once('(') {
            if let Some((values, _)) = parenthesized.split_once(')') {
                if let Some((current, maximum)) = values.split_once('/') {
                    downloaded = current.trim().parse::<u64>().ok().or(downloaded);
                    total = maximum.trim().parse::<u64>().ok().or(total);
                }
            }
        }
    }

    let mut percent = downloaded.zip(total).and_then(|(current, total)| {
        (total > 0).then_some(((current as f64 / total as f64) * 100.0).clamp(0.0, 99.9))
    });
    if console_percent.is_some() {
        percent = console_percent.map(|value| value.clamp(0.0, 99.9));
    }
    if downloaded.is_none() {
        downloaded = percent
            .zip(total)
            .map(|(value, total)| ((value / 100.0) * total as f64).round() as u64);
    }
    PalworldInstallProgress {
        phase: "download".into(),
        // A real percentage becomes available as soon as SteamCMD has resolved
        // the manifest. Until then show 0.0%, never an unexplained dash.
        percent: Some(percent.unwrap_or(0.0)),
        downloaded_bytes: downloaded,
        total_bytes: total,
        bytes_per_second,
    }
}

fn steamcmd_arguments(server_root: &Path) -> Vec<OsString> {
    vec![
        "+force_install_dir".into(),
        server_root.as_os_str().to_owned(),
        "+login".into(),
        "anonymous".into(),
        "+app_update".into(),
        STEAM_APP_ID.into(),
        "validate".into(),
        "+quit".into(),
    ]
}

fn write_initial_config(
    root: &Path,
    server_name: &str,
    game_port: u16,
    settings: &PalworldSettings,
    admin_password: &str,
) -> AppResult<()> {
    let default_path = root.join("DefaultPalWorldSettings.ini");
    let mut defaults = String::new();
    File::open(default_path)?.read_to_string(&mut defaults)?;
    let rendered = render_settings(
        &defaults,
        server_name,
        game_port,
        settings,
        admin_password,
        Some(""),
    )?;
    let config = root
        .join("Pal")
        .join("Saved")
        .join("Config")
        .join("WindowsServer");
    std::fs::create_dir_all(&config)?;
    std::fs::write(config.join("PalWorldSettings.ini"), rendered)?;
    Ok(())
}

#[derive(Debug)]
pub struct PalworldConfigBackup {
    config_path: PathBuf,
    backup_path: PathBuf,
}

fn config_backup_scope(backup_path: &Path) -> String {
    backup_path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "palworld-config-backup".into())
}

pub fn update_config(
    root: &Path,
    server_name: &str,
    game_port: u16,
    settings: &PalworldSettings,
    admin_password: &str,
    server_password: Option<&str>,
) -> AppResult<PalworldConfigBackup> {
    validate_settings(game_port, settings)?;
    validate_password(admin_password, false)?;
    if let Some(password) = server_password {
        validate_password(password, true)?;
    }
    let config_path = root
        .join("Pal")
        .join("Saved")
        .join("Config")
        .join("WindowsServer")
        .join("PalWorldSettings.ini");
    let source_path = if config_path.is_file() {
        config_path.clone()
    } else {
        root.join("DefaultPalWorldSettings.ini")
    };
    let source = std::fs::read_to_string(&source_path)?;
    let rendered = render_config_from_source(
        &source,
        server_name,
        game_port,
        settings,
        admin_password,
        server_password,
    )?;
    write_prepared_config(root, &config_path, source.as_bytes(), &rendered)
}

pub fn render_config_from_source(
    source: &str,
    server_name: &str,
    game_port: u16,
    settings: &PalworldSettings,
    admin_password: &str,
    server_password: Option<&str>,
) -> AppResult<String> {
    render_settings(
        source,
        server_name,
        game_port,
        settings,
        admin_password,
        server_password,
    )
}

pub fn write_prepared_config(
    root: &Path,
    config_path: &Path,
    source: &[u8],
    rendered: &str,
) -> AppResult<PalworldConfigBackup> {
    let backup_dir = root.join(".server-hub").join("config-backups");
    std::fs::create_dir_all(&backup_dir)?;
    let id = Uuid::new_v4().simple().to_string();
    let backup_path = backup_dir.join(format!("PalWorldSettings-before-{id}.ini"));
    let protected_source = protected_data::protect_bytes(
        protected_data::PALWORLD_CONFIG_BACKUP_DOMAIN,
        &config_backup_scope(&backup_path),
        source,
    )?;
    std::fs::write(&backup_path, protected_source)?;
    let parent = config_path
        .parent()
        .ok_or_else(|| AppError::Validation("Palworld設定フォルダーが不正です".into()))?;
    std::fs::create_dir_all(parent)?;
    let staging = parent.join(format!("PalWorldSettings-{id}.ini.part"));
    let previous = parent.join(format!("PalWorldSettings-{id}.ini.previous"));
    {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&staging)?;
        file.write_all(rendered.as_bytes())?;
        file.sync_all()?;
    }
    if config_path.is_file() {
        std::fs::rename(&config_path, &previous)?;
    }
    if let Err(error) = std::fs::rename(&staging, &config_path) {
        if previous.is_file() {
            let _ = std::fs::rename(&previous, &config_path);
        }
        let _ = std::fs::remove_file(&staging);
        return Err(error.into());
    }
    if previous.is_file() {
        std::fs::remove_file(previous)?;
    }
    Ok(PalworldConfigBackup {
        config_path: config_path.to_path_buf(),
        backup_path,
    })
}

pub fn rollback_config(backup: &PalworldConfigBackup) -> AppResult<()> {
    let stored = std::fs::read(&backup.backup_path)?;
    let source = if protected_data::is_protected_blob(&stored) {
        protected_data::unprotect_bytes(
            protected_data::PALWORLD_CONFIG_BACKUP_DOMAIN,
            &config_backup_scope(&backup.backup_path),
            &stored,
        )?
    } else {
        // Existing pre-hardening backups remain readable. They are never
        // re-written here, so migration is explicit and auditable.
        stored
    };
    std::fs::write(&backup.config_path, source)?;
    Ok(())
}

pub fn config_backup_name(backup: &PalworldConfigBackup) -> String {
    backup
        .backup_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("PalWorldSettings-backup.ini")
        .to_string()
}

fn render_settings(
    source: &str,
    server_name: &str,
    game_port: u16,
    settings: &PalworldSettings,
    admin_password: &str,
    server_password: Option<&str>,
) -> AppResult<String> {
    let boolean = |value: bool| if value { "True" } else { "False" }.to_string();
    let mut replacements = vec![
        ("ServerName", quote_ini(server_name)),
        ("ServerDescription", quote_ini(&settings.server_description)),
        ("AdminPassword", quote_ini(admin_password)),
        ("ServerPlayerMaxNum", settings.max_players.to_string()),
        ("PublicPort", game_port.to_string()),
        ("RESTAPIEnabled", "True".into()),
        ("RESTAPIPort", settings.rest_api_port.to_string()),
        ("RCONEnabled", "False".into()),
        ("bIsUseBackupSaveData", boolean(settings.backup_enabled)),
        ("ExpRate", settings.exp_rate.to_string()),
        (
            "CollectionDropRate",
            settings.collection_drop_rate.to_string(),
        ),
        ("PalCaptureRate", settings.pal_capture_rate.to_string()),
        ("DayTimeSpeedRate", settings.day_time_speed_rate.to_string()),
        (
            "NightTimeSpeedRate",
            settings.night_time_speed_rate.to_string(),
        ),
        (
            "PalEggDefaultHatchingTime",
            settings.pal_egg_default_hatching_time.to_string(),
        ),
        ("DeathPenalty", settings.death_penalty.clone()),
        (
            "bEnableInvaderEnemy",
            boolean(settings.invader_enemies_enabled),
        ),
        ("bEnableFastTravel", boolean(settings.fast_travel_enabled)),
        ("bShowPlayerList", boolean(settings.player_list_enabled)),
        (
            "bIsShowJoinLeftMessage",
            boolean(settings.join_leave_messages_enabled),
        ),
        ("bEnableVoiceChat", boolean(settings.voice_chat_enabled)),
        ("bAllowClientMod", boolean(settings.client_mods_allowed)),
        (
            "BaseCampMaxNumInGuild",
            settings.base_camp_max_num_in_guild.to_string(),
        ),
        (
            "BaseCampWorkerMaxNum",
            settings.base_camp_worker_max_num.to_string(),
        ),
        ("LogFormatType", "Text".into()),
    ];
    if let Some(password) = server_password {
        replacements.push(("ServerPassword", quote_ini(password)));
    }
    patch_option_settings(source, &replacements)
}

fn quote_ini(value: &str) -> String {
    let sanitized = value
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(256)
        .collect::<String>()
        .replace('\\', "\\\\")
        .replace('"', "'");
    format!("\"{sanitized}\"")
}

fn patch_option_settings(source: &str, replacements: &[(&str, String)]) -> AppResult<String> {
    let marker = "OptionSettings=(";
    let start = source.find(marker).ok_or_else(|| {
        AppError::Validation("Palworld既定設定のOptionSettingsがありません".into())
    })?;
    let content_start = start + marker.len();
    let end = find_matching_parenthesis(source, content_start - 1)
        .ok_or_else(|| AppError::Validation("Palworld既定設定の括弧が閉じていません".into()))?;
    let mut entries = split_option_entries(&source[content_start..end]);
    for (key, value) in replacements {
        if let Some(entry) = entries.iter_mut().find(|entry| {
            entry
                .split_once('=')
                .is_some_and(|(existing, _)| existing.trim() == *key)
        }) {
            *entry = format!("{key}={value}");
        } else {
            entries.push(format!("{key}={value}"));
        }
    }
    let mut output = String::with_capacity(source.len() + 256);
    output.push_str(&source[..content_start]);
    output.push_str(&entries.join(","));
    output.push_str(&source[end..]);
    Ok(output)
}

fn find_matching_parenthesis(source: &str, opening: usize) -> Option<usize> {
    let mut depth = 0i32;
    let mut quoted = false;
    let mut escaped = false;
    for (offset, character) in source[opening..].char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if character == '\\' && quoted {
            escaped = true;
            continue;
        }
        if character == '"' {
            quoted = !quoted;
            continue;
        }
        if quoted {
            continue;
        }
        if character == '(' {
            depth += 1;
        } else if character == ')' {
            depth -= 1;
            if depth == 0 {
                return Some(opening + offset);
            }
        }
    }
    None
}

fn split_option_entries(value: &str) -> Vec<String> {
    let mut entries = Vec::new();
    let mut start = 0usize;
    let mut depth = 0i32;
    let mut quoted = false;
    let mut escaped = false;
    for (index, character) in value.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if character == '\\' && quoted {
            escaped = true;
            continue;
        }
        if character == '"' {
            quoted = !quoted;
            continue;
        }
        if quoted {
            continue;
        }
        match character {
            '(' => depth += 1,
            ')' => depth -= 1,
            ',' if depth == 0 => {
                entries.push(value[start..index].trim().to_string());
                start = index + 1;
            }
            _ => {}
        }
    }
    if start <= value.len() {
        let tail = value[start..].trim();
        if !tail.is_empty() {
            entries.push(tail.to_string());
        }
    }
    entries
}

fn tail(value: &str, max_chars: usize) -> String {
    value
        .chars()
        .rev()
        .take(max_chars)
        .collect::<String>()
        .chars()
        .rev()
        .collect()
}

fn sha256_file(path: &Path) -> AppResult<String> {
    let mut input = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = input.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(hex::encode(digest.finalize()))
}

#[cfg(windows)]
fn verify_valve_authenticode(executable: &Path) -> AppResult<String> {
    let system_root = std::env::var_os("SystemRoot")
        .ok_or_else(|| AppError::Other("WindowsのSystemRootを確認できません".into()))?;
    let powershell = PathBuf::from(system_root)
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    let script = r#"$ErrorActionPreference='Stop'; $module=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'; Import-Module -Name $module -Force; $target=[Environment]::GetEnvironmentVariable('MSH_STEAMCMD_SIGNATURE_TARGET','Process'); $signature=Get-AuthenticodeSignature -LiteralPath $target; [pscustomobject]@{status=$signature.Status.ToString();subject=if($signature.SignerCertificate){$signature.SignerCertificate.Subject}else{''}} | ConvertTo-Json -Compress"#;
    let mut command = Command::new(powershell);
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env("MSH_STEAMCMD_SIGNATURE_TARGET", executable.as_os_str());
    hide_console_window(&mut command);
    let output = command.output()?;
    if !output.status.success() {
        return Err(AppError::Other(
            "steamcmd.exeのWindows署名を検証できません".into(),
        ));
    }
    let value: SignatureResult = serde_json::from_slice(&output.stdout)
        .map_err(|_| AppError::Other("SteamCMD署名結果を解釈できません".into()))?;
    let valve_signer = value.subject.contains("O=Valve") || value.subject.contains("CN=Valve");
    if value.status != "Valid" || !valve_signer {
        return Err(AppError::Validation(
            "steamcmd.exeの有効なValve署名を確認できないため実行しません".into(),
        ));
    }
    Ok(value.subject)
}

#[cfg(not(windows))]
fn verify_valve_authenticode(_executable: &Path) -> AppResult<String> {
    Err(AppError::Validation(
        "Palworld Dedicated Serverの初期対応はWindowsのみです".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        DEFAULT_GAME_PORT, DEFAULT_REST_PORT, RestInfo, RestPlayers, extract_steamcmd, get_json,
        patch_option_settings, post_empty_with_password, quote_ini, read_steamcmd_progress,
        render_settings, rest_client, rest_url, rollback_config, safe_players,
        shutdown_with_password, split_option_entries, steamcmd_arguments, update_config,
        validate_password, validate_server_layout, validate_settings, validate_steamcmd_url,
    };
    use crate::models::PalworldSettings;
    use reqwest::Url;
    use std::{
        fs::File,
        io::{Read, Write},
        net::TcpListener,
        sync::mpsc,
        time::Duration,
    };
    use zip::{ZipWriter, write::SimpleFileOptions};

    #[test]
    fn parses_official_steamcmd_content_progress() {
        let root = std::env::temp_dir().join(format!("msh-progress-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let log = root.join("content_log.txt");
        std::fs::write(
            &log,
            "[2026-08-29 20:50:00] AppID 2394010 update started : download 0/4921151008, stage 0/6041663011\n[2026-08-29 20:58:52] AppID 2394010 stats: (Invalid, 0) : 3600563874 Bytes\n[2026-08-29 20:59:43] Current download rate: 88.261 Mbps\n",
        )
        .unwrap();
        let output = root.join("steamcmd-output.log");
        std::fs::write(
            &output,
            "Update state (0x61) downloading, progress: 73.16 (3600563874 / 4921151008)\n",
        )
        .unwrap();
        let progress = read_steamcmd_progress(&log, &output);
        assert_eq!(progress.downloaded_bytes, Some(3_600_563_874));
        assert_eq!(progress.total_bytes, Some(4_921_151_008));
        assert!(
            progress
                .percent
                .is_some_and(|value| value > 73.0 && value < 73.3)
        );
        assert_eq!(progress.bytes_per_second, Some(11_032_625));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn parses_new_steamcmd_console_progress_when_content_stats_are_missing() {
        let root =
            std::env::temp_dir().join(format!("msh-console-progress-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let content = root.join("content_log.txt");
        let output = root.join("steamcmd-output.log");
        std::fs::write(
            &content,
            "[2026-08-31 15:21:34] AppID 2394010 update started : download 0/4921151008, store 0/0, stage 0/6041663011\n[2026-08-31 15:22:46] Current download rate: 89.808 Mbps\n",
        )
        .unwrap();
        std::fs::write(
            &output,
            "Update state (0x61) downloading, progress: 12.00 (590538121 / 4921151008)\nUpdate state (0x61) downloading, progress: 27.50 (1353316527 / 4921151008)\n",
        )
        .unwrap();

        let progress = read_steamcmd_progress(&content, &output);
        assert_eq!(progress.percent, Some(27.5));
        assert_eq!(progress.downloaded_bytes, Some(1_353_316_527));
        assert_eq!(progress.total_bytes, Some(4_921_151_008));
        assert_eq!(progress.bytes_per_second, Some(11_226_000));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn download_progress_starts_at_zero_instead_of_an_unknown_dash() {
        let root =
            std::env::temp_dir().join(format!("msh-empty-progress-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let progress = read_steamcmd_progress(
            &root.join("missing-content.log"),
            &root.join("missing-output.log"),
        );
        assert_eq!(progress.percent, Some(0.0));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn launches_the_real_palworld_console_binary_directly() {
        let root = std::env::temp_dir().join(format!("msh-launch-{}", uuid::Uuid::new_v4()));
        let binary = root.join("Pal/Binaries/Win64/PalServer-Win64-Shipping-Cmd.exe");
        std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
        std::fs::write(root.join("PalServer.exe"), b"launcher").unwrap();
        std::fs::write(root.join("DefaultPalWorldSettings.ini"), b"settings").unwrap();
        std::fs::write(&binary, b"server").unwrap();

        let selected = validate_server_layout(&root).unwrap();
        assert_eq!(selected, binary.canonicalize().unwrap());
        assert_eq!(
            selected.file_name().unwrap(),
            "PalServer-Win64-Shipping-Cmd.exe"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    fn mock_http(response: &'static str) -> (u16, mpsc::Receiver<String>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (sender, receiver) = mpsc::channel();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = Vec::new();
            let mut buffer = [0u8; 4096];
            loop {
                let read = stream.read(&mut buffer).unwrap_or_default();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&buffer[..read]);
                let text = String::from_utf8_lossy(&request);
                let Some(header_end) = text.find("\r\n\r\n") else {
                    continue;
                };
                let content_length = text[..header_end]
                    .lines()
                    .find_map(|line| {
                        line.strip_prefix("content-length: ")
                            .or_else(|| line.strip_prefix("Content-Length: "))
                    })
                    .and_then(|value| value.trim().parse::<usize>().ok())
                    .unwrap_or(0);
                if request.len() >= header_end + 4 + content_length {
                    break;
                }
            }
            let _ = sender.send(String::from_utf8_lossy(&request).into());
            stream.write_all(response.as_bytes()).unwrap();
            stream.flush().unwrap();
        });
        (port, receiver)
    }

    #[test]
    fn only_accepts_the_fixed_official_steamcmd_url() {
        assert!(
            validate_steamcmd_url(
                &Url::parse("https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip")
                    .unwrap()
            )
            .is_ok()
        );
        for unsafe_url in [
            "http://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip",
            "https://steamcdn-a.akamaihd.net.evil.example/client/installer/steamcmd.zip",
            "https://steamcdn-a.akamaihd.net/client/installer/../steamcmd.zip",
            "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip?mirror=1",
        ] {
            assert!(validate_steamcmd_url(&Url::parse(unsafe_url).unwrap()).is_err());
        }
    }

    #[test]
    fn steamcmd_arguments_keep_force_install_dir_before_anonymous_login() {
        let root = std::path::Path::new(r"C:\Servers\Palworld Test");
        let values = steamcmd_arguments(root)
            .into_iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(
            values,
            vec![
                "+force_install_dir",
                r"C:\Servers\Palworld Test",
                "+login",
                "anonymous",
                "+app_update",
                "2394010",
                "validate",
                "+quit",
            ]
        );
    }

    #[test]
    fn rejects_path_traversal_in_the_steamcmd_bootstrap_zip() {
        let root = std::env::temp_dir().join(format!("msh-steamcmd-zip-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let archive = root.join("unsafe.zip");
        let output = root.join("steamcmd.exe");
        let mut zip = ZipWriter::new(File::create(&archive).unwrap());
        zip.start_file("../steamcmd.exe", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(b"not-an-executable").unwrap();
        zip.finish().unwrap();
        assert!(extract_steamcmd(&archive, &output).is_err());
        assert!(!output.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn patches_known_ini_values_and_preserves_unknown_and_nested_values() {
        let source = "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(UnknownFuture=42,CrossplayPlatforms=(Steam,Xbox,PS5,Mac),ServerName=\"Default Palworld Server\",RESTAPIEnabled=False)\n";
        let rendered = patch_option_settings(
            source,
            &[
                ("ServerName", "\"Friends\"".into()),
                ("RESTAPIEnabled", "True".into()),
                ("RESTAPIPort", DEFAULT_REST_PORT.to_string()),
                ("PublicPort", DEFAULT_GAME_PORT.to_string()),
            ],
        )
        .unwrap();
        assert!(rendered.contains("UnknownFuture=42"));
        assert!(rendered.contains("CrossplayPlatforms=(Steam,Xbox,PS5,Mac)"));
        assert!(rendered.contains("ServerName=\"Friends\""));
        assert!(rendered.contains("RESTAPIEnabled=True"));
        assert!(rendered.contains("RESTAPIPort=8212"));
        assert_eq!(rendered.matches("ServerName=").count(), 1);
    }

    #[test]
    fn option_splitter_does_not_split_quoted_or_nested_commas() {
        assert_eq!(
            split_option_entries("A=1,B=\"x,y\",C=(Steam,Xbox),D=4"),
            vec!["A=1", "B=\"x,y\"", "C=(Steam,Xbox)", "D=4"]
        );
    }

    #[test]
    fn ini_quoting_preserves_field_boundaries_for_trailing_backslashes_and_commas() {
        let source = "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName=\"Default\",ServerDescription=\"Default\",RESTAPIEnabled=False)\n";
        let rendered = patch_option_settings(
            source,
            &[
                ("ServerName", quote_ini(r#"Friends\"#)),
                ("ServerDescription", quote_ini(r#"Co-op, "weekend"\"#)),
                ("RESTAPIEnabled", "True".into()),
            ],
        )
        .unwrap();
        let marker = "OptionSettings=(";
        let start = rendered.find(marker).unwrap() + marker.len();
        let end = super::find_matching_parenthesis(&rendered, start - 1).unwrap();
        let entries = split_option_entries(&rendered[start..end]);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0], r#"ServerName="Friends\\""#);
        assert_eq!(entries[1], r#"ServerDescription="Co-op, 'weekend'\\""#);
        assert_eq!(entries[2], "RESTAPIEnabled=True");
    }

    #[test]
    fn renders_all_managed_settings_and_preserves_unknown_values() {
        let source = "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(UnknownFuture=42,ServerName=\"Old\",ServerPassword=\"OldJoin\",AdminPassword=\"OldAdmin\")\n";
        let settings = PalworldSettings {
            server_description: "Weekend world".into(),
            max_players: 12,
            rest_api_port: 9321,
            backup_enabled: false,
            exp_rate: 2.5,
            pal_capture_rate: 1.8,
            collection_drop_rate: 3.0,
            pal_egg_default_hatching_time: 12.0,
            death_penalty: "ItemAndEquipment".into(),
            voice_chat_enabled: true,
            client_mods_allowed: true,
            base_camp_max_num_in_guild: 8,
            base_camp_worker_max_num: 40,
            ..PalworldSettings::default()
        };
        validate_settings(9320, &settings).unwrap();
        let rendered = render_settings(
            source,
            "New Pal Server",
            9320,
            &settings,
            "AdminSecret",
            Some("Join,Secret"),
        )
        .unwrap();
        for expected in [
            "UnknownFuture=42",
            "ServerName=\"New Pal Server\"",
            "ServerPassword=\"Join,Secret\"",
            "AdminPassword=\"AdminSecret\"",
            "PublicPort=9320",
            "RESTAPIPort=9321",
            "ExpRate=2.5",
            "PalCaptureRate=1.8",
            "CollectionDropRate=3",
            "PalEggDefaultHatchingTime=12",
            "DeathPenalty=ItemAndEquipment",
            "bEnableVoiceChat=True",
            "bAllowClientMod=True",
            "BaseCampMaxNumInGuild=8",
            "BaseCampWorkerMaxNum=40",
        ] {
            assert!(rendered.contains(expected), "missing {expected}");
        }
    }

    #[test]
    fn config_update_creates_a_recoverable_backup_and_keeps_passwords_exact() {
        let root = std::env::temp_dir().join(format!("msh-pal-settings-{}", uuid::Uuid::new_v4()));
        let config = root.join("Pal/Saved/Config/WindowsServer");
        std::fs::create_dir_all(&config).unwrap();
        let path = config.join("PalWorldSettings.ini");
        let original = "[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(ServerName=\"Old\",ServerPassword=\"OldJoin\",AdminPassword=\"OldAdmin\",UnknownFuture=True)\n";
        std::fs::write(&path, original).unwrap();
        let backup = update_config(
            &root,
            "Friends",
            8211,
            &PalworldSettings::default(),
            "NewAdmin",
            Some("NewJoin"),
        )
        .unwrap();
        let changed = std::fs::read_to_string(&path).unwrap();
        assert!(changed.contains("AdminPassword=\"NewAdmin\""));
        assert!(changed.contains("ServerPassword=\"NewJoin\""));
        assert!(changed.contains("UnknownFuture=True"));
        assert!(backup.backup_path.is_file());
        let stored_backup = std::fs::read(&backup.backup_path).unwrap();
        assert!(crate::protected_data::is_protected_blob(&stored_backup));
        for secret in ["OldAdmin", "OldJoin"] {
            assert!(
                !stored_backup
                    .windows(secret.len())
                    .any(|window| window == secret.as_bytes())
            );
        }
        rollback_config(&backup).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rollback_config_keeps_legacy_raw_backup_readable() {
        let root =
            std::env::temp_dir().join(format!("msh-pal-legacy-backup-{}", uuid::Uuid::new_v4()));
        let config_path = root.join("Pal/Saved/Config/WindowsServer/PalWorldSettings.ini");
        let backup_path =
            root.join(".server-hub/config-backups/PalWorldSettings-before-legacy.ini");
        let original =
            b"[/Script/Pal.PalGameWorldSettings]\nOptionSettings=(AdminPassword=\"LegacyAdmin\")\n";
        std::fs::create_dir_all(config_path.parent().unwrap()).unwrap();
        std::fs::create_dir_all(backup_path.parent().unwrap()).unwrap();
        std::fs::write(&backup_path, original).unwrap();

        rollback_config(&super::PalworldConfigBackup {
            config_path: config_path.clone(),
            backup_path,
        })
        .unwrap();

        assert_eq!(std::fs::read(&config_path).unwrap(), original);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_password_characters_that_would_be_rewritten_by_the_ini_format() {
        assert!(validate_password("Normal password 123", false).is_ok());
        assert!(validate_password("", true).is_ok());
        assert!(validate_password("", false).is_err());
        assert!(validate_password("bad\"quote", false).is_err());
        assert!(validate_password("bad\\slash", false).is_err());
    }

    #[tokio::test]
    async fn rest_get_is_loopback_only_and_uses_basic_auth_without_redirects() {
        let body =
            r#"{"version":"1.0.3","servername":"PW2","description":"local","worldguid":"world-a"}"#;
        let response = Box::leak(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(), body
            )
            .into_boxed_str(),
        );
        let (port, request) = mock_http(response);
        let info = get_json::<RestInfo>(
            &rest_client().unwrap(),
            rest_url(port, "info").unwrap(),
            "secret",
        )
        .await
        .unwrap();
        assert_eq!(info.servername, "PW2");
        let request = request.recv_timeout(Duration::from_secs(3)).unwrap();
        assert!(request.starts_with("GET /v1/api/info HTTP/1.1"));
        assert!(request.contains("authorization: Basic YWRtaW46c2VjcmV0"));
        assert!(!request.contains("Proxy-Authorization"));
    }

    #[tokio::test]
    async fn rest_save_then_shutdown_use_the_official_methods_and_body() {
        // Palworld 1.0.3 omits the optional reason phrase for mutating REST
        // endpoints. Keep this exact live-server status line in regression.
        let ok = "HTTP/1.1 200\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let (save_port, save_request) = mock_http(ok);
        post_empty_with_password(save_port, "save", "secret")
            .await
            .unwrap();
        let save_request = save_request.recv_timeout(Duration::from_secs(3)).unwrap();
        assert!(save_request.starts_with("POST /v1/api/save HTTP/1.1"));
        assert!(
            save_request
                .to_ascii_lowercase()
                .contains("authorization: basic ywrtaw46c2vjcmv0")
        );

        let (shutdown_port, shutdown_request) = mock_http(ok);
        shutdown_with_password(shutdown_port, "secret", 5)
            .await
            .unwrap();
        let shutdown_request = shutdown_request
            .recv_timeout(Duration::from_secs(3))
            .unwrap();
        assert!(shutdown_request.starts_with("POST /v1/api/shutdown HTTP/1.1"));
        let body = shutdown_request.split("\r\n\r\n").nth(1).unwrap();
        let json: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(json["waittime"], 5);
        assert!(json["message"].as_str().unwrap().contains("safely"));

        let malformed = "NOT-HTTP 200\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let (malformed_port, _) = mock_http(malformed);
        assert!(
            post_empty_with_password(malformed_port, "save", "secret")
                .await
                .unwrap_err()
                .to_string()
                .contains("応答形式")
        );
    }

    #[test]
    fn player_ip_and_coordinates_cannot_cross_the_public_model() {
        let raw = r#"{"players":[{"name":"Tester","accountName":"steam","playerId":"p1","userId":"u1","ip":"203.0.113.7","ping":12.5,"location_x":123.0,"location_y":456.0,"level":7,"building_count":2}]}"#;
        let safe = safe_players(serde_json::from_str::<RestPlayers>(raw).unwrap());
        assert_eq!(safe.len(), 1);
        let serialized = serde_json::to_string(&safe).unwrap();
        assert!(!serialized.contains("203.0.113.7"));
        assert!(!serialized.contains("location"));
        assert_eq!(safe[0].name, "Tester");

        // A client can appear in /players while it is still creating its first
        // character. Current servers omit building_count in that short phase,
        // even though the published schema lists it. Monitoring must remain
        // available and expose a conservative zero instead of failing the
        // entire REST snapshot.
        let joining = r#"{"players":[{"name":"Joining","accountName":"steam","playerId":"p2","userId":"u2","ip":"127.0.0.1","ping":4.0,"location_x":0.0,"location_y":0.0,"level":1}]}"#;
        let joining = safe_players(serde_json::from_str::<RestPlayers>(joining).unwrap());
        assert_eq!(joining[0].building_count, 0);
    }

    #[tokio::test]
    async fn rest_auth_errors_never_echo_the_password() {
        let unauthorized =
            "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let (port, request) = mock_http(unauthorized);
        let secret = "do-not-echo-this-secret";
        let error = get_json::<RestInfo>(
            &rest_client().unwrap(),
            rest_url(port, "info").unwrap(),
            secret,
        )
        .await
        .unwrap_err()
        .to_string();
        let _ = request.recv_timeout(Duration::from_secs(3));
        assert!(!error.contains(secret));
        assert!(error.contains("REST認証"));
    }

    #[cfg(windows)]
    #[tokio::test]
    #[ignore = "downloads the official Palworld server and waits for a real local game client"]
    async fn installs_connects_saves_restarts_and_safely_stops_a_live_server() {
        use crate::{
            credentials,
            downloads::http_client,
            models::{BasicSettings, PalworldSettings, ServerProfile},
        };
        use std::{
            path::{Path, PathBuf},
            process::{Child, Command, Stdio},
            time::Instant,
        };

        struct LiveChild(Option<Child>);
        impl Drop for LiveChild {
            fn drop(&mut self) {
                if let Some(child) = self.0.as_mut() {
                    if child.try_wait().ok().flatten().is_none() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
            }
        }

        struct CredentialCleanup(String);
        impl Drop for CredentialCleanup {
            fn drop(&mut self) {
                let _ = credentials::delete_palworld_admin_password(&self.0);
            }
        }

        fn required_port(name: &str) -> u16 {
            std::env::var(name)
                .expect("set the isolated live-test port")
                .parse::<u16>()
                .expect("live-test port must be a valid u16")
        }

        fn spawn(profile: &ServerProfile) -> Child {
            let executable = super::validate_server_layout(Path::new(&profile.root_path)).unwrap();
            let mut command = Command::new(executable);
            command
                .current_dir(&profile.root_path)
                .args(super::launch_arguments(profile).unwrap())
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            super::hide_console_window(&mut command);
            command.spawn().unwrap()
        }

        async fn wait_for_rest(
            profile: &ServerProfile,
            timeout: Duration,
        ) -> super::MonitorSnapshot {
            let deadline = Instant::now() + timeout;
            loop {
                if let Ok(snapshot) = super::monitor(profile).await {
                    return snapshot;
                }
                assert!(
                    Instant::now() < deadline,
                    "Palworld REST did not become ready"
                );
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        }

        async fn wait_for_exit(child: &mut Child, timeout: Duration) {
            let deadline = Instant::now() + timeout;
            loop {
                if child.try_wait().unwrap().is_some() {
                    return;
                }
                assert!(
                    Instant::now() < deadline,
                    "PalServer.exe did not exit safely"
                );
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
        }

        fn latest_save_time(root: &Path) -> Option<std::time::SystemTime> {
            walkdir::WalkDir::new(root.join("Pal/Saved/SaveGames"))
                .follow_links(false)
                .into_iter()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().is_file())
                .filter_map(|entry| entry.metadata().ok()?.modified().ok())
                .max()
        }

        let root = PathBuf::from(
            std::env::var_os("MSH_PALWORLD_LIVE_ROOT")
                .expect("set MSH_PALWORLD_LIVE_ROOT to a new isolated directory"),
        );
        assert!(root.is_absolute());
        let temp_root = std::env::temp_dir().canonicalize().unwrap();
        let canonical_parent = root
            .parent()
            .expect("live root needs a parent")
            .canonicalize()
            .unwrap();
        assert!(canonical_parent.starts_with(&temp_root));
        assert!(
            root.file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.starts_with("server"))
        );
        if root.exists() && root.read_dir().unwrap().next().is_some() {
            assert!(root.join("PalServer.exe").is_file());
            assert!(root.join(".server-hub/palworld-install.json").is_file());
        } else if !root.exists() {
            std::fs::create_dir_all(&root).unwrap();
        } else {
            assert!(root.read_dir().unwrap().next().is_none());
        }
        let tools = root
            .parent()
            .expect("live root needs a parent")
            .join("steamcmd-tools");
        let game_port = required_port("MSH_PALWORLD_LIVE_GAME_PORT");
        let rest_port = required_port("MSH_PALWORLD_LIVE_REST_PORT");
        let server_id = format!("palworld-live-{}", uuid::Uuid::new_v4());
        let _credential_cleanup = CredentialCleanup(server_id.clone());
        let settings = PalworldSettings {
            server_description: "Isolated Minecraft Server Hub PW0-PW2 acceptance test".into(),
            max_players: 4,
            rest_api_port: rest_port,
            rest_api_enabled: true,
            backup_enabled: true,
            ..PalworldSettings::default()
        };
        let install = super::install_server(
            &http_client().unwrap(),
            &tools,
            &root,
            &server_id,
            "MSH PW2 Isolated Live Test",
            game_port,
            &settings,
            std::sync::Arc::new(|_| {}),
        )
        .await
        .unwrap();
        assert_eq!(install.steamcmd_sha256.len(), 64);
        assert!(install.steamcmd_signer.contains("Valve"));

        let now = chrono::Utc::now().to_rfc3339();
        let profile = ServerProfile {
            id: server_id,
            name: "MSH PW2 Isolated Live Test".into(),
            root_path: root.display().to_string(),
            game_kind: "palworld".into(),
            server_type: "palworld".into(),
            minecraft_version: String::new(),
            distribution_build: Some(format!("steam-app:{}", super::STEAM_APP_ID)),
            launch_target: "PalServer.exe".into(),
            java_path: String::new(),
            java_major: 0,
            min_memory_mib: 0,
            max_memory_mib: 0,
            port: game_port,
            eula_accepted_at: "not-applicable".into(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: Some(settings),
            created_at: now.clone(),
            updated_at: now,
        };

        let mut child = LiveChild(Some(spawn(&profile)));
        let ready = wait_for_rest(&profile, Duration::from_secs(300)).await;
        let first_world_guid = ready
            .metrics
            .world_guid
            .clone()
            .expect("REST /info must return a world GUID");
        eprintln!(
            "[PALWORLD-LIVE] READY address=127.0.0.1:{} players={} world-guid-present=true",
            game_port, ready.current_players
        );

        let deadline = Instant::now() + Duration::from_secs(900);
        let connected = loop {
            let snapshot = super::monitor(&profile).await.unwrap();
            if snapshot.current_players > 0 && !snapshot.metrics.players.is_empty() {
                break snapshot;
            }
            assert!(
                Instant::now() < deadline,
                "a real Palworld client did not join within 15 minutes"
            );
            tokio::time::sleep(Duration::from_secs(2)).await;
        };
        assert_eq!(
            connected.current_players as usize,
            connected.metrics.players.len()
        );
        eprintln!(
            "[PALWORLD-LIVE] CLIENT_CONNECTED count={}",
            connected.current_players
        );

        let before_save = latest_save_time(&root);
        super::save_world(&profile).await.unwrap();
        tokio::time::sleep(Duration::from_secs(3)).await;
        let after_save = latest_save_time(&root).expect("save files must exist after /save");
        if let Some(before) = before_save {
            assert!(after_save >= before);
        }
        eprintln!("[PALWORLD-LIVE] SAVE_CONFIRMED files-present=true");

        super::shutdown(&profile, 5).await.unwrap();
        wait_for_exit(child.0.as_mut().unwrap(), Duration::from_secs(90)).await;
        child.0.take();
        eprintln!("[PALWORLD-LIVE] SAFE_STOP_CONFIRMED");

        child.0 = Some(spawn(&profile));
        let restarted = wait_for_rest(&profile, Duration::from_secs(300)).await;
        assert_eq!(
            restarted.metrics.world_guid.as_deref(),
            Some(first_world_guid.as_str())
        );
        eprintln!("[PALWORLD-LIVE] RESTART_PERSISTENCE_CONFIRMED");
        super::save_world(&profile).await.unwrap();
        super::shutdown(&profile, 5).await.unwrap();
        wait_for_exit(child.0.as_mut().unwrap(), Duration::from_secs(90)).await;
        child.0.take();
        credentials::delete_palworld_admin_password(&profile.id).unwrap();
    }
}
