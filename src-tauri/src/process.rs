use std::{
    collections::{BTreeMap, HashMap},
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use chrono::Local;
use regex::Regex;
use sysinfo::{Pid, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

use crate::{
    bedrock,
    error::{AppError, AppResult},
    game_adapter::GameAdapter,
    models::{LogEntry, RuntimeStatus, ServerProfile},
    palworld,
    ping::{ping_bedrock_server, ping_local_server},
    windows_process::hide_console_window,
};

pub type ProcessMap = Mutex<HashMap<String, ManagedProcess>>;
pub type StoppingMap = Mutex<HashMap<String, ManagedProcess>>;
pub type LogMap = Arc<Mutex<HashMap<String, Vec<LogEntry>>>>;

/// Owns a child between `spawn` and registration in ProcessMap. `std::process::Child`
/// does not terminate on Drop, so every early-return path must explicitly reap it.
struct UnregisteredChild {
    child: Option<Child>,
}

impl UnregisteredChild {
    fn new(child: Child) -> Self {
        Self { child: Some(child) }
    }

    fn child_mut(&mut self) -> &mut Child {
        self.child.as_mut().expect("unregistered child is present")
    }

    fn commit(mut self) -> Child {
        self.child.take().expect("unregistered child is present")
    }
}

impl Drop for UnregisteredChild {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub struct ManagedProcess {
    pub child: Child,
    pub stdin: ChildStdin,
    pub started_at: Instant,
    pub pid: u32,
    pub port: u16,
    pub transport: String,
    system: System,
    last_metrics_query: Option<Instant>,
    metrics_log_start_index: Option<usize>,
    session_log_start_index: usize,
    #[cfg(windows)]
    job_handle: isize,
}

impl Drop for ManagedProcess {
    fn drop(&mut self) {
        #[cfg(windows)]
        close_job(self.job_handle);
    }
}

fn reap_finished(map: &mut HashMap<String, ManagedProcess>) {
    map.retain(|_, process| !matches!(process.child.try_wait(), Ok(Some(_))));
}

fn reap_finished_server(map: &mut HashMap<String, ManagedProcess>, server_id: &str) {
    let finished = map
        .get_mut(server_id)
        .is_some_and(|process| matches!(process.child.try_wait(), Ok(Some(_))));
    if finished {
        map.remove(server_id);
    }
}

/// Returns true only while the process is still owned by the regular running map.
/// A process that is shutting down is reported by [`is_stopping`] instead.
pub fn is_running(server_id: &str, processes: &ProcessMap) -> bool {
    let mut guard = processes.lock().unwrap();
    reap_finished_server(&mut guard, server_id);
    guard.contains_key(server_id)
}

/// Returns true while a graceful or forced stop owns the process.
/// Finished children are reaped so a cancelled stop future cannot leave a stale
/// reservation forever.
pub fn is_stopping(server_id: &str, stopping: &StoppingMap) -> bool {
    let mut guard = stopping.lock().unwrap();
    reap_finished_server(&mut guard, server_id);
    guard.contains_key(server_id)
}

/// Checks both registries atomically with the global lock order: stopping first,
/// then running. Use this before mutations which are unsafe during either state.
pub fn is_busy(server_id: &str, processes: &ProcessMap, stopping: &StoppingMap) -> bool {
    let mut stopping_guard = stopping.lock().unwrap();
    reap_finished_server(&mut stopping_guard, server_id);
    if stopping_guard.contains_key(server_id) {
        return true;
    }

    let mut process_guard = processes.lock().unwrap();
    reap_finished_server(&mut process_guard, server_id);
    process_guard.contains_key(server_id)
}

fn begin_stop(server_id: &str, processes: &ProcessMap, stopping: &StoppingMap) -> AppResult<()> {
    let mut stopping_guard = stopping.lock().unwrap();
    reap_finished_server(&mut stopping_guard, server_id);
    if stopping_guard.contains_key(server_id) {
        return Err(AppError::Validation(
            "このサーバーはすでに停止処理中です".into(),
        ));
    }

    let mut process_guard = processes.lock().unwrap();
    reap_finished_server(&mut process_guard, server_id);
    let process = process_guard
        .remove(server_id)
        .ok_or(AppError::NotRunning)?;
    stopping_guard.insert(server_id.to_string(), process);
    Ok(())
}

pub fn start(
    app: &AppHandle,
    profile: &ServerProfile,
    processes: &ProcessMap,
    stopping: &StoppingMap,
    logs: &LogMap,
) -> AppResult<()> {
    // Authenticode verification can invoke Windows PowerShell, so perform it
    // before taking the shared process-map lock. The returned file guard still
    // prevents replacement until spawn completes.
    let adapter = profile.game_adapter();
    let verified_bedrock = if adapter.is_minecraft_bedrock() {
        Some(verified_bedrock_executable(profile)?)
    } else {
        None
    };
    let palworld_executable = if adapter.is_palworld() {
        Some(palworld::validate_server_layout(std::path::Path::new(
            &profile.root_path,
        ))?)
    } else {
        None
    };
    // Keep this lock until the child is registered. This makes the port check and
    // reservation atomic even when two Tauri commands arrive at nearly the same
    // time, before either server process has opened its listener.
    let mut stopping_guard = stopping.lock().unwrap();
    reap_finished(&mut stopping_guard);
    if stopping_guard.contains_key(&profile.id) {
        return Err(AppError::Validation(
            "サーバーの停止処理が完了するまで待ってください".into(),
        ));
    }
    let mut process_guard = processes.lock().unwrap();
    reap_finished(&mut process_guard);
    if process_guard.contains_key(&profile.id) {
        return Err(AppError::AlreadyRunning);
    }
    if let Some((_, owner)) =
        stopping_guard
            .iter()
            .chain(process_guard.iter())
            .find(|(server_id, process)| {
                server_id.as_str() != profile.id
                    && process.port == profile.port
                    && process.transport == profile.network_transport()
            })
    {
        return Err(AppError::Validation(format!(
            "{}ポート {} は起動中または起動準備中の別サーバーが使用しています",
            owner.transport.to_ascii_uppercase(),
            owner.port
        )));
    }
    let (mut command, arguments) = if let Some(verified) = verified_bedrock.as_ref() {
        (Command::new(verified.path()), Vec::new())
    } else if let Some(executable) = palworld_executable.as_ref() {
        (
            Command::new(executable),
            palworld::launch_arguments(profile)?,
        )
    } else {
        let mut arguments = vec![
            format!("-Xms{}M", profile.min_memory_mib),
            format!("-Xmx{}M", profile.max_memory_mib),
        ];
        match profile.server_type.as_str() {
            "forge" => {
                let build = profile
                    .distribution_build
                    .as_deref()
                    .ok_or_else(|| AppError::Other("Forge起動情報がありません".into()))?;
                arguments.push(format!(
                    "@libraries/net/minecraftforge/forge/{build}/win_args.txt"
                ));
                arguments.push("nogui".into());
            }
            "neoforge" => {
                let build = profile
                    .distribution_build
                    .as_deref()
                    .ok_or_else(|| AppError::Other("NeoForge起動情報がありません".into()))?;
                arguments.push(format!(
                    "@libraries/net/neoforged/neoforge/{build}/win_args.txt"
                ));
                arguments.push("nogui".into());
            }
            _ => arguments.extend(["-jar".into(), profile.launch_target.clone(), "nogui".into()]),
        }
        (Command::new(&profile.java_path), arguments)
    };
    command
        .current_dir(&profile.root_path)
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    hide_console_window(&mut command);

    let mut unregistered_child = UnregisteredChild::new(command.spawn()?);
    // Keep the no-write/no-delete verification handle alive through spawn so
    // the file cannot be replaced after signature verification but before
    // CreateProcess opens it.
    drop(verified_bedrock);
    let pid = unregistered_child.child_mut().id();
    let stdin = unregistered_child
        .child_mut()
        .stdin
        .take()
        .ok_or_else(|| AppError::Other("サーバーの標準入力を取得できません".into()))?;
    let stdout = unregistered_child
        .child_mut()
        .stdout
        .take()
        .ok_or_else(|| AppError::Other("サーバーログを取得できません".into()))?;
    let stderr = unregistered_child
        .child_mut()
        .stderr
        .take()
        .ok_or_else(|| AppError::Other("サーバーエラー出力を取得できません".into()))?;

    spawn_log_reader(
        app.clone(),
        profile.id.clone(),
        stdout,
        logs.clone(),
        "INFO",
    );
    spawn_log_reader(
        app.clone(),
        profile.id.clone(),
        stderr,
        logs.clone(),
        "ERROR",
    );

    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
    let session_log_start_index = logs.lock().unwrap().get(&profile.id).map_or(0, Vec::len);
    #[cfg(windows)]
    let job_handle = assign_job(pid)?;
    // All fallible setup has completed; ProcessMap becomes the sole child owner.
    let child = unregistered_child.commit();
    process_guard.insert(
        profile.id.clone(),
        ManagedProcess {
            child,
            stdin,
            started_at: Instant::now(),
            pid,
            port: profile.port,
            transport: profile.network_transport().into(),
            system,
            last_metrics_query: None,
            metrics_log_start_index: None,
            session_log_start_index,
            #[cfg(windows)]
            job_handle,
        },
    );
    drop(process_guard);
    drop(stopping_guard);
    let _ = app.emit("server-status", (&profile.id, "starting"));
    Ok(())
}

pub async fn stop(
    app: &AppHandle,
    server_id: &str,
    force: bool,
    graceful_command: Option<&str>,
    processes: &ProcessMap,
    stopping: &StoppingMap,
) -> AppResult<()> {
    if force {
        // Acquire and terminate without releasing the stopping lock between the
        // registry transition and force termination. This closes the race where
        // a failing graceful stop could otherwise move the child back to
        // `processes` after a force request had observed it in `stopping`.
        let mut stopping_guard = stopping.lock().unwrap();
        let was_stopping = stopping_guard.contains_key(server_id);
        reap_finished_server(&mut stopping_guard, server_id);
        if !stopping_guard.contains_key(server_id) {
            let mut process_guard = processes.lock().unwrap();
            reap_finished_server(&mut process_guard, server_id);
            let Some(process) = process_guard.remove(server_id) else {
                drop(process_guard);
                drop(stopping_guard);
                if was_stopping {
                    let _ = app.emit("server-status", (server_id, "stopped"));
                    return Ok(());
                }
                return Err(AppError::NotRunning);
            };
            stopping_guard.insert(server_id.to_string(), process);
        }
        let process = stopping_guard
            .get_mut(server_id)
            .ok_or(AppError::NotRunning)?;
        force_terminate(process)?;
        process.child.wait()?;
        stopping_guard.remove(server_id);
        drop(stopping_guard);
        let _ = app.emit("server-status", (server_id, "stopped"));
        return Ok(());
    }

    // Transfer ownership before the first await. If the invoking Tauri future is
    // cancelled after this point, the stopping registry still owns the child,
    // its job handle, and its port/transport reservation.
    begin_stop(server_id, processes, stopping)?;

    let write_result = {
        let mut stopping_guard = stopping.lock().unwrap();
        let Some(process) = stopping_guard.get_mut(server_id) else {
            let _ = app.emit("server-status", (server_id, "stopped"));
            return Ok(());
        };
        let result = if let Some(command) = graceful_command {
            process
                .stdin
                .write_all(command.as_bytes())
                .and_then(|_| process.stdin.write_all(b"\n"))
                .and_then(|_| process.stdin.flush())
        } else {
            Ok(())
        };
        if result.is_err() {
            // The stop command was not confirmed. Move the child back to the
            // running registry while the stopping lock is still held, so a
            // concurrent force request cannot lose it during the transfer.
            let mut process_guard = processes.lock().unwrap();
            if let Some(process) = stopping_guard.remove(server_id) {
                process_guard.insert(server_id.to_string(), process);
            }
        }
        result
    };
    if let Err(error) = write_result {
        return Err(error.into());
    }
    let _ = app.emit("server-status", (server_id, "stopping"));

    let deadline = Instant::now() + Duration::from_secs(45);
    while Instant::now() < deadline {
        let exited = {
            let mut stopping_guard = stopping.lock().unwrap();
            let Some(process) = stopping_guard.get_mut(server_id) else {
                // A concurrent force request or runtime-status reap completed it.
                return Ok(());
            };
            match process.child.try_wait() {
                Ok(Some(_)) => {
                    stopping_guard.remove(server_id);
                    true
                }
                Ok(None) => false,
                Err(error) => return Err(error.into()),
            }
        };
        if exited {
            let _ = app.emit("server-status", (server_id, "stopped"));
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    // Keep the child in `stopping` so the caller can safely retry with force=true.
    // Restoring it to `processes` would make it look runnable while it may still
    // be saving or exiting.
    Err(AppError::ForceRequired)
}

pub fn send_command(server_id: &str, value: &str, processes: &ProcessMap) -> AppResult<()> {
    let command = value.trim();
    if command.is_empty() || command.len() > 512 || command.contains(['\r', '\n', '\0']) {
        return Err(AppError::Validation(
            "コマンドは1行、512文字以内で入力してください".into(),
        ));
    }
    let mut guard = processes.lock().unwrap();
    let process = guard.get_mut(server_id).ok_or(AppError::NotRunning)?;
    process.stdin.write_all(command.as_bytes())?;
    process.stdin.write_all(b"\n")?;
    process.stdin.flush()?;
    Ok(())
}

fn stopping_status(profile: &ServerProfile, stopping: &StoppingMap) -> Option<RuntimeStatus> {
    let mut stopping_guard = stopping.lock().unwrap();
    let process = stopping_guard.get_mut(&profile.id)?;
    if matches!(process.child.try_wait(), Ok(Some(_))) {
        stopping_guard.remove(&profile.id);
        Some(stopped_status(profile))
    } else {
        Some(RuntimeStatus {
            state: "stopping".into(),
            ..stopped_status(profile)
        })
    }
}

pub fn runtime_status(
    profile: &ServerProfile,
    processes: &ProcessMap,
    stopping: &StoppingMap,
    logs: &LogMap,
) -> RuntimeStatus {
    if let Some(status) = stopping_status(profile, stopping) {
        return status;
    }
    let mut guard = processes.lock().unwrap();
    let Some(process) = guard.get_mut(&profile.id) else {
        // A lifecycle transition may have completed between the two registry
        // locks. Re-check after releasing ProcessMap.
        drop(guard);
        return stopping_status(profile, stopping).unwrap_or_else(|| stopped_status(profile));
    };

    if process.child.try_wait().ok().flatten().is_some() {
        guard.remove(&profile.id);
        return RuntimeStatus {
            state: "crashed".into(),
            ..stopped_status(profile)
        };
    }

    let pid = process.pid;
    let uptime_seconds = process.started_at.elapsed().as_secs();
    let session_log_start_index = process.session_log_start_index;
    drop(guard);

    // The local status ping is intentionally outside the process-map lock so a slow
    // status response never delays stop/restart actions.
    let adapter = profile.game_adapter();
    let ping = match adapter {
        GameAdapter::MinecraftBedrock => ping_bedrock_server(profile.port),
        GameAdapter::MinecraftJava => ping_local_server(profile.port),
        GameAdapter::Palworld => None,
    };
    let state = if ping.is_some() {
        "running"
    } else {
        "starting"
    };
    let (player_count, max_players) = ping
        .as_ref()
        .map(|players| (players.online, players.max))
        .unwrap_or((0, configured_max_players(profile)));
    let ping_sample = ping
        .as_ref()
        .map(|players| players.sample.clone())
        .unwrap_or_default();
    let ping_latency_ms = ping.map(|players| players.latency_ms);

    let mut online_players = online_players_from_logs(
        logs,
        &profile.id,
        session_log_start_index,
        adapter.is_minecraft_bedrock(),
    );
    for name in ping_sample {
        online_players
            .entry(name.to_ascii_lowercase())
            .or_insert(name);
    }
    let online_players = online_players.into_values().collect();

    let log_count = logs.lock().unwrap().get(&profile.id).map_or(0, Vec::len);
    let mut guard = processes.lock().unwrap();
    let Some(process) = guard.get_mut(&profile.id) else {
        // The child can move to StoppingMap while the local ping is in flight.
        // Report that transition instead of announcing a completed stop early.
        drop(guard);
        return stopping_status(profile, stopping).unwrap_or_else(|| stopped_status(profile));
    };
    process
        .system
        .refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
    let logical_processors = std::thread::available_parallelism().map_or(1, usize::from) as f32;
    let (memory_used_mib, cpu_percent) = process
        .system
        .process(Pid::from_u32(pid))
        .map(|server_process| {
            (
                server_process.memory() / 1024 / 1024,
                (server_process.cpu_usage() / logical_processors).clamp(0.0, 100.0),
            )
        })
        .unwrap_or_default();

    if state == "running"
        && uptime_seconds >= 3
        && process
            .last_metrics_query
            .is_none_or(|last| last.elapsed() >= Duration::from_secs(10))
        && let Some(command) = metrics_command(profile)
        && process
            .stdin
            .write_all(command.as_bytes())
            .and_then(|_| process.stdin.write_all(b"\n"))
            .and_then(|_| process.stdin.flush())
            .is_ok()
    {
        process.last_metrics_query = Some(Instant::now());
        process.metrics_log_start_index.get_or_insert(log_count);
    }
    let metrics_log_start_index = process.metrics_log_start_index;
    drop(guard);
    let tps = metrics_log_start_index.and_then(|start| latest_tps(logs, &profile.id, start));

    RuntimeStatus {
        state: state.into(),
        player_count,
        max_players,
        online_players,
        memory_used_mib,
        uptime_seconds,
        address: format!("localhost:{}", profile.port),
        cpu_percent,
        tps,
        tps_supported: metrics_command(profile).is_some(),
        ping_latency_ms,
        palworld: None,
    }
}

fn stopped_status(profile: &ServerProfile) -> RuntimeStatus {
    RuntimeStatus {
        state: "stopped".into(),
        player_count: 0,
        max_players: configured_max_players(profile),
        online_players: Vec::new(),
        memory_used_mib: 0,
        uptime_seconds: 0,
        address: format!("localhost:{}", profile.port),
        cpu_percent: 0.0,
        tps: None,
        tps_supported: metrics_command(profile).is_some(),
        ping_latency_ms: None,
        palworld: None,
    }
}

fn configured_max_players(profile: &ServerProfile) -> u32 {
    profile
        .palworld_settings
        .as_ref()
        .filter(|_| profile.game_adapter().is_palworld())
        .map_or(profile.settings.max_players as u32, |settings| {
            settings.max_players as u32
        })
}

fn online_players_from_logs(
    logs: &LogMap,
    server_id: &str,
    start: usize,
    is_bedrock: bool,
) -> BTreeMap<String, String> {
    let guard = logs.lock().unwrap();
    let mut online = BTreeMap::new();
    for entry in guard.get(server_id).into_iter().flatten().skip(start) {
        let Some((name, joined)) = player_presence_event(&entry.message, is_bedrock) else {
            continue;
        };
        let key = name.to_ascii_lowercase();
        if joined {
            online.insert(key, name);
        } else {
            online.remove(&key);
        }
    }
    online
}

fn player_presence_event(line: &str, is_bedrock: bool) -> Option<(String, bool)> {
    static JAVA_JOIN: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r"([A-Za-z0-9_.-]{1,32}) joined the game\b").unwrap()
    });
    static JAVA_LEAVE: std::sync::LazyLock<Regex> =
        std::sync::LazyLock::new(|| Regex::new(r"([A-Za-z0-9_.-]{1,32}) left the game\b").unwrap());
    static BEDROCK_JOIN: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r"(?i)(?:Player connected|Player Spawned):\s*([^,]+?)(?:,|\s+xuid:)").unwrap()
    });
    static BEDROCK_LEAVE: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(r"(?i)Player disconnected:\s*([^,]+?)(?:,|\s+xuid:)").unwrap()
    });
    let captures = if is_bedrock {
        BEDROCK_JOIN
            .captures(line)
            .map(|value| (value, true))
            .or_else(|| BEDROCK_LEAVE.captures(line).map(|value| (value, false)))
    } else {
        JAVA_JOIN
            .captures(line)
            .map(|value| (value, true))
            .or_else(|| JAVA_LEAVE.captures(line).map(|value| (value, false)))
    }?;
    let name = captures.0.get(1)?.as_str().trim();
    if name.is_empty() || name.chars().count() > 64 || name.chars().any(char::is_control) {
        return None;
    }
    Some((name.to_string(), captures.1))
}

fn bedrock_executable(profile: &ServerProfile) -> AppResult<std::path::PathBuf> {
    let target = std::path::Path::new(&profile.launch_target);
    if target.components().count() != 1
        || target.file_name().and_then(|name| name.to_str()) != Some("bedrock_server.exe")
    {
        return Err(AppError::Validation(
            "統合版の起動対象はサーバーフォルダー直下のbedrock_server.exeに限られます".into(),
        ));
    }
    let executable = std::path::Path::new(&profile.root_path).join(target);
    if !executable.is_file() {
        return Err(AppError::Validation(
            "bedrock_server.exeが見つかりません。統合版サーバーを再検証してください".into(),
        ));
    }
    Ok(executable)
}

fn verified_bedrock_executable(
    profile: &ServerProfile,
) -> AppResult<bedrock::VerifiedBedrockExecutable> {
    let configured = bedrock_executable(profile)?.canonicalize()?;
    let verified = bedrock::verify_installed_executable(std::path::Path::new(&profile.root_path))?;
    if verified.path() != configured {
        return Err(AppError::Validation(
            "検証したbedrock_server.exeと起動対象が一致しません".into(),
        ));
    }
    Ok(verified)
}

fn metrics_command(profile: &ServerProfile) -> Option<&'static str> {
    match profile.server_type.as_str() {
        "paper" => Some("tps"),
        "vanilla" if version_at_least(&profile.minecraft_version, 1, 20, 3) => Some("tick query"),
        _ => None,
    }
}

fn version_at_least(value: &str, major: u16, minor: u16, patch: u16) -> bool {
    let mut values = value
        .split('.')
        .map(|part| part.parse::<u16>().unwrap_or_default());
    let actual = (
        values.next().unwrap_or_default(),
        values.next().unwrap_or_default(),
        values.next().unwrap_or_default(),
    );
    actual >= (major, minor, patch)
}

fn latest_tps(logs: &LogMap, server_id: &str, start: usize) -> Option<f32> {
    let guard = logs.lock().unwrap();
    guard
        .get(server_id)?
        .iter()
        .skip(start)
        .rev()
        .find_map(|entry| parse_tps(&entry.message))
}

fn parse_tps(line: &str) -> Option<f32> {
    static TPS_AFTER: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(
            r"(?i)(?:TPS(?: from [^:]+)?|Average TPS|Mean TPS)\s*[:=]?\s*\*?([0-9]+(?:\.[0-9]+)?)",
        )
        .unwrap()
    });
    static TPS_BEFORE: std::sync::LazyLock<Regex> =
        std::sync::LazyLock::new(|| Regex::new(r"(?i)([0-9]+(?:\.[0-9]+)?)\s*TPS").unwrap());
    static TICK_TIME: std::sync::LazyLock<Regex> = std::sync::LazyLock::new(|| {
        Regex::new(
            r"(?i)(?:average(?: tick time)?|mean tick time)[^0-9]*([0-9]+(?:\.[0-9]+)?)\s*ms",
        )
        .unwrap()
    });
    let direct = TPS_AFTER
        .captures(line)
        .or_else(|| TPS_BEFORE.captures(line))
        .and_then(|captures| captures.get(1)?.as_str().parse::<f32>().ok());
    if let Some(value) = direct {
        return value.is_finite().then(|| value.clamp(0.0, 20.0));
    }
    let milliseconds = TICK_TIME
        .captures(line)?
        .get(1)?
        .as_str()
        .parse::<f32>()
        .ok()?;
    (milliseconds > 0.0 && milliseconds.is_finite())
        .then(|| (1_000.0 / milliseconds).clamp(0.0, 20.0))
}

fn spawn_log_reader<R: std::io::Read + Send + 'static>(
    app: AppHandle,
    server_id: String,
    reader: R,
    logs: LogMap,
    fallback_level: &'static str,
) {
    thread::spawn(move || {
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            let level = parse_level(&line).unwrap_or(fallback_level).to_string();
            let entry = LogEntry {
                timestamp: Local::now().format("%H:%M:%S").to_string(),
                level,
                message: line,
            };
            {
                let mut all_logs = logs.lock().unwrap();
                let server_logs = all_logs.entry(server_id.clone()).or_default();
                server_logs.push(entry.clone());
                if server_logs.len() > 5_000 {
                    server_logs.drain(..500);
                }
            }
            let _ = app.emit("server-log", (&server_id, &entry));
        }
    });
}

fn parse_level(line: &str) -> Option<&'static str> {
    if line.contains("/ERROR]") || line.contains("[ERROR]") || line.contains("Exception") {
        Some("ERROR")
    } else if line.contains("/WARN]") || line.contains("[WARN]") {
        Some("WARN")
    } else if line.contains("/INFO]") || line.contains("[INFO]") {
        Some("INFO")
    } else {
        None
    }
}

#[cfg(windows)]
fn assign_job(pid: u32) -> AppResult<isize> {
    use windows::Win32::{
        Foundation::CloseHandle,
        System::{
            JobObjects::{AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob},
            Threading::{GetCurrentProcess, OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
        },
    };
    use windows::core::BOOL;
    unsafe {
        let job = CreateJobObjectW(None, None)
            .map_err(|error| AppError::Other(format!("Job Objectを作成できません: {error}")))?;
        let process =
            OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid).map_err(|error| {
                AppError::Other(format!("サーバープロセスを監視対象にできません: {error}"))
            })?;
        let assigned = AssignProcessToJobObject(job, process).is_ok();
        let _ = CloseHandle(process);
        if !assigned {
            let _ = CloseHandle(job);
            return Err(AppError::Other(
                "JavaプロセスをJob Objectへ登録できません".into(),
            ));
        }
        let mut app_is_in_server_job = BOOL::default();
        if let Err(error) =
            IsProcessInJob(GetCurrentProcess(), Some(job), &mut app_is_in_server_job)
        {
            let _ = CloseHandle(job);
            return Err(AppError::Other(format!(
                "アプリとサーバープロセスの分離を確認できません: {error}"
            )));
        }
        if app_is_in_server_job.as_bool() {
            let _ = CloseHandle(job);
            return Err(AppError::Other(
                "安全のため、アプリ自身を含むJob Objectではサーバーを起動しません".into(),
            ));
        }
        Ok(job.0 as isize)
    }
}

#[cfg(windows)]
fn force_terminate(process: &mut ManagedProcess) -> AppResult<()> {
    use windows::Win32::{Foundation::HANDLE, System::JobObjects::TerminateJobObject};
    unsafe {
        TerminateJobObject(HANDLE(process.job_handle as *mut _), 1)
            .map_err(|error| AppError::Other(format!("プロセスツリーを終了できません: {error}")))
    }
}

#[cfg(not(windows))]
fn force_terminate(process: &mut ManagedProcess) -> AppResult<()> {
    process.child.kill().map_err(Into::into)
}

#[cfg(windows)]
fn close_job(job_handle: isize) {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    if job_handle != 0 {
        unsafe {
            let _ = CloseHandle(HANDLE(job_handle as *mut _));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        LogMap, ManagedProcess, ProcessMap, StoppingMap, bedrock_executable, begin_stop, is_busy,
        is_running, is_stopping, parse_tps, player_presence_event, runtime_status,
        verified_bedrock_executable,
    };
    use crate::models::{BasicSettings, ServerProfile};
    use std::{
        process::{Command, Stdio},
        time::Instant,
    };
    use sysinfo::System;

    fn bedrock_profile(root: &std::path::Path, launch_target: &str) -> ServerProfile {
        ServerProfile {
            id: "bedrock-process-test".into(),
            name: "Bedrock".into(),
            root_path: root.display().to_string(),
            game_kind: "minecraft".into(),
            server_type: "bedrock".into(),
            minecraft_version: "1.26.44.3".into(),
            distribution_build: None,
            launch_target: launch_target.into(),
            java_path: String::new(),
            java_major: 0,
            min_memory_mib: 0,
            max_memory_mib: 0,
            port: 19132,
            eula_accepted_at: "test".into(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: None,
            created_at: "test".into(),
            updated_at: "test".into(),
        }
    }

    #[test]
    fn parses_paper_and_vanilla_tps_output() {
        assert_eq!(
            parse_tps("TPS from last 1m, 5m, 15m: 19.87, 19.91, 19.95"),
            Some(19.87)
        );
        assert_eq!(
            parse_tps("Running normally at 20.0 TPS with an average of 4.8 ms per tick"),
            Some(20.0)
        );
        assert_eq!(parse_tps("Average tick time: 62.5 ms"), Some(16.0));
        assert_eq!(parse_tps("Time elapsed: 2156 ms"), None);
    }

    #[test]
    fn stopping_registry_owns_the_process_and_reserves_its_port() {
        let processes = ProcessMap::default();
        let stopping = StoppingMap::default();
        let cleanup = TestProcessCleanup {
            server_id: "server-a",
            processes: &processes,
            stopping: &stopping,
        };
        processes
            .lock()
            .unwrap()
            .insert("server-a".into(), test_managed_process(25565));

        assert!(is_running("server-a", &processes));
        assert!(!is_stopping("server-a", &stopping));
        assert!(is_busy("server-a", &processes, &stopping));

        begin_stop("server-a", &processes, &stopping).unwrap();
        assert!(!is_running("server-a", &processes));
        assert!(is_stopping("server-a", &stopping));
        assert!(is_busy("server-a", &processes, &stopping));
        assert_eq!(stopping.lock().unwrap()["server-a"].port, 25565);
        assert!(begin_stop("server-a", &processes, &stopping).is_err());
        let mut profile = bedrock_profile(std::path::Path::new("."), "bedrock_server.exe");
        profile.id = "server-a".into();
        assert_eq!(
            runtime_status(&profile, &processes, &stopping, &LogMap::default()).state,
            "stopping"
        );

        cleanup.stop();
        assert!(!is_busy("server-a", &processes, &stopping));
    }

    struct TestProcessCleanup<'a> {
        server_id: &'a str,
        processes: &'a ProcessMap,
        stopping: &'a StoppingMap,
    }

    impl TestProcessCleanup<'_> {
        fn stop(&self) {
            let mut process = self
                .stopping
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .remove(self.server_id)
                .or_else(|| {
                    self.processes
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .remove(self.server_id)
                });
            if let Some(process) = process.as_mut() {
                let _ = process.child.kill();
                let _ = process.child.wait();
            }
        }
    }

    impl Drop for TestProcessCleanup<'_> {
        fn drop(&mut self) {
            self.stop();
        }
    }

    fn test_managed_process(port: u16) -> ManagedProcess {
        #[cfg(windows)]
        let mut command = {
            let mut command = Command::new("powershell.exe");
            command.args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 30",
            ]);
            super::hide_console_window(&mut command);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut command = Command::new("sleep");
            command.arg("30");
            command
        };
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let pid = child.id();
        ManagedProcess {
            child,
            stdin,
            started_at: Instant::now(),
            pid,
            port,
            transport: "tcp".into(),
            system: System::new(),
            last_metrics_query: None,
            metrics_log_start_index: None,
            session_log_start_index: 0,
            #[cfg(windows)]
            job_handle: 0,
        }
    }

    #[test]
    fn parses_java_bedrock_and_floodgate_presence_events() {
        assert_eq!(
            player_presence_event("[Server thread/INFO]: Steve joined the game", false),
            Some(("Steve".into(), true))
        );
        assert_eq!(
            player_presence_event("[Server thread/INFO]: .BedrockFriend left the game", false),
            Some((".BedrockFriend".into(), false))
        );
        assert_eq!(
            player_presence_event(
                "[INFO] Player connected: Xbox Friend, xuid: 2533270000000000",
                true
            ),
            Some(("Xbox Friend".into(), true))
        );
        assert_eq!(
            player_presence_event(
                "[INFO] Player disconnected: Xbox Friend, xuid: 2533270000000000",
                true
            ),
            Some(("Xbox Friend".into(), false))
        );
    }

    #[test]
    fn bedrock_launch_target_is_fixed_to_the_server_root() {
        let root =
            std::env::temp_dir().join(format!("msh-bedrock-process-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("bedrock_server.exe"), b"test").unwrap();
        let valid = bedrock_profile(&root, "bedrock_server.exe");
        assert_eq!(
            bedrock_executable(&valid).unwrap(),
            root.join("bedrock_server.exe")
        );
        for unsafe_target in [
            "../bedrock_server.exe",
            "tools/bedrock_server.exe",
            "server.jar",
        ] {
            assert!(bedrock_executable(&bedrock_profile(&root, unsafe_target)).is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn bedrock_launch_preparation_rejects_an_unsigned_executable() {
        let root = std::env::temp_dir().join(format!(
            "msh-bedrock-process-unsigned-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("bedrock_server.exe"), b"unsigned fixture").unwrap();
        let error = verified_bedrock_executable(&bedrock_profile(&root, "bedrock_server.exe"))
            .unwrap_err()
            .to_string();
        assert!(error.contains("Microsoft署名"), "{error}");
        std::fs::remove_dir_all(root).unwrap();
    }
}
