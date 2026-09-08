use std::{
    collections::HashSet,
    fs::File,
    io::Read,
    net::{TcpListener, UdpSocket},
    path::Path,
};

use chrono::Utc;
use regex::Regex;
use sysinfo::{Disks, System};
use zip::ZipArchive;

use crate::{
    java::required_java_major,
    models::{DiagnosisIssue, LogEntry, ServerDiagnosisReport, ServerProfile},
};

pub fn analyze(
    profile: &ServerProfile,
    memory_logs: &[LogEntry],
    check_port: bool,
) -> ServerDiagnosisReport {
    let mut issues = Vec::new();
    let root = Path::new(&profile.root_path);
    let is_bedrock = profile.server_type == "bedrock";

    if !is_bedrock {
        let required_java = required_java_major(&profile.server_type, &profile.minecraft_version);
        if !Path::new(&profile.java_path).is_file() {
            issues.push(issue(
                "java-missing",
                "error",
                "設定されたJavaが見つかりません",
                "サーバーを起動できません。",
                "Javaが移動・削除されたか、登録したパスが無効です。",
                &[
                    "Java環境画面で再検出してください。",
                    "必要なJavaを公式配布元から導入し、サーバーごとに選択してください。",
                ],
                vec![],
                false,
            ));
        } else if profile.java_major < required_java {
            issues.push(issue(
                "java-version",
                "error",
                &format!(
                    "Java {} が必要ですが、Java {} が選択されています",
                    required_java, profile.java_major
                ),
                "起動直後に終了する可能性があります。",
                "Minecraftまたはサーバー種類とJavaの世代が一致していません。",
                &["Java環境画面で互換と表示されるJavaを選択してください。"],
                vec![],
                false,
            ));
        }

        let eula_ok = std::fs::read_to_string(root.join("eula.txt"))
            .ok()
            .is_some_and(|text| {
                text.lines()
                    .any(|line| line.trim().eq_ignore_ascii_case("eula=true"))
            });
        if !eula_ok {
            issues.push(issue(
                "eula",
                "error",
                "Minecraft EULAへの同意を確認できません",
                "サーバーは起動を拒否します。",
                "eula.txtがないか、eula=falseのままです。",
                &["EULAの内容を本人が確認し、同意する場合だけeula=trueに変更してください。"],
                vec![],
                false,
            ));
        }
    }

    if !launch_target_exists(profile) {
        if is_bedrock {
            issues.push(issue(
                "launch-target",
                "error",
                "bedrock_server.exe が見つかりません",
                "統合版サーバーを起動できません。",
                "公式BDSの実行ファイルが削除・移動されたか、取り込み元が不完全です。",
                &[
                    "既存サーバーを再スキャンしてください。",
                    "現在のフォルダーを保全してからMinecraft公式BDSを再取得してください。",
                ],
                vec![],
                true,
            ));
        } else {
            issues.push(issue(
                "launch-target",
                "error",
                "サーバーの起動ファイルが見つかりません",
                "Javaを実行してもサーバーを読み込めません。",
                "JARが削除・改名されたか、Forge系の起動情報が不足しています。",
                &[
                    "ファイルを再配置するか、既存サーバーを再スキャンしてください。",
                    "配布元から対応バージョンを再取得する前にバックアップしてください。",
                ],
                vec![],
                true,
            ));
        }
    }

    let port_available = if is_bedrock {
        udp_port_available(profile.port)
    } else {
        tcp_port_available(profile.port)
    };
    if check_port && !port_available {
        let protocol = if is_bedrock { "UDP" } else { "TCP" };
        issues.push(issue(
            "port-in-use",
            "error",
            &format!("{protocol}ポート {} はすでに使用されています", profile.port),
            "サーバーはアドレスを確保できず起動に失敗します。",
            "別のMinecraftサーバーやアプリが同じポートを使っています。",
            &[
                "別のサーバーが動いていないか確認してください。",
                "設定で未使用のポートへ変更してください。",
            ],
            vec![],
            false,
        ));
    }

    if let Some(incomplete) = incomplete_world_issue(profile) {
        issues.push(incomplete);
    }

    let mut system = System::new_all();
    system.refresh_memory();
    let total_mib = system.total_memory() / 1024 / 1024;
    let available_mib = system.available_memory() / 1024 / 1024;
    if profile.max_memory_mib as u64 + 1024 > total_mib
        || profile.max_memory_mib as u64 > available_mib.saturating_add(512)
    {
        issues.push(issue(
            "memory",
            "warning",
            "設定したメモリを安全に確保できない可能性があります",
            "起動失敗、強制終了、PC全体の動作低下につながります。",
            "最大割り当てが現在の空きメモリまたはPC全体に対して大きすぎます。",
            &["最大メモリを下げるか、他のアプリを終了してください。"],
            vec![],
            false,
        ));
    }

    if let Some(disk) = Disks::new_with_refreshed_list()
        .list()
        .iter()
        .filter(|disk| root.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().as_os_str().len())
    {
        if disk.available_space() < 2 * 1024 * 1024 * 1024 {
            issues.push(issue(
                "disk",
                "warning",
                "サーバー保存先の空き容量が少なくなっています",
                "ワールド保存やバックアップが途中で失敗する可能性があります。",
                "保存先の空き容量が2 GiB未満です。",
                &[
                    "不要ファイルを確認して空きを増やしてください。",
                    "削除前にバックアップ先も確認してください。",
                ],
                vec![],
                true,
            ));
        }
    }

    if profile.server_type == "fabric" {
        issues.extend(fabric_dependency_issues(root));
    }
    issues.extend(extension_compatibility_issues(profile));

    let logs = collect_logs(root, memory_logs);
    issues.extend(classify_logs(&logs));
    deduplicate(&mut issues);
    ServerDiagnosisReport {
        checked_at: Utc::now().to_rfc3339(),
        healthy: !issues.iter().any(|item| item.severity == "error"),
        issues,
        redaction_note: "診断はこのPC内だけで実行しました。IPアドレス、トークン、認証情報らしき文字列は関連ログで伏せ字にしています。".into(),
    }
}

fn tcp_port_available(port: u16) -> bool {
    // On Windows, binding 0.0.0.0 can succeed while another process already
    // owns 127.0.0.1:<port> (and vice versa). Probe the two bind scopes
    // separately, dropping each probe before the next one so they do not
    // conflict with each other.
    let loopback_available = match TcpListener::bind(("127.0.0.1", port)) {
        Ok(listener) => {
            drop(listener);
            true
        }
        Err(_) => false,
    };
    if !loopback_available {
        return false;
    }
    match TcpListener::bind(("0.0.0.0", port)) {
        Ok(listener) => {
            drop(listener);
            true
        }
        Err(_) => false,
    }
}

pub(crate) fn udp_port_available(port: u16) -> bool {
    let loopback_available = match UdpSocket::bind(("127.0.0.1", port)) {
        Ok(socket) => {
            drop(socket);
            true
        }
        Err(_) => false,
    };
    if !loopback_available {
        return false;
    }
    match UdpSocket::bind(("0.0.0.0", port)) {
        Ok(socket) => {
            drop(socket);
            true
        }
        Err(_) => false,
    }
}

fn launch_target_exists(profile: &ServerProfile) -> bool {
    let root = Path::new(&profile.root_path);
    match profile.server_type.as_str() {
        "forge" => profile.distribution_build.as_ref().is_some_and(|build| {
            root.join(format!(
                "libraries/net/minecraftforge/forge/{build}/win_args.txt"
            ))
            .is_file()
        }),
        "neoforge" => profile.distribution_build.as_ref().is_some_and(|build| {
            root.join(format!(
                "libraries/net/neoforged/neoforge/{build}/win_args.txt"
            ))
            .is_file()
        }),
        _ => root.join(&profile.launch_target).is_file(),
    }
}

fn collect_logs(root: &Path, memory_logs: &[LogEntry]) -> Vec<String> {
    let mut result = memory_logs
        .iter()
        .rev()
        .take(300)
        .map(|entry| entry.message.clone())
        .collect::<Vec<_>>();
    for path in [
        Some(root.join("logs/latest.log")),
        newest_crash_report(root),
    ] {
        let Some(path) = path else { continue };
        if let Ok(text) = std::fs::read_to_string(path) {
            result.extend(text.lines().rev().take(400).map(str::to_string));
        }
    }
    result
}

fn newest_crash_report(root: &Path) -> Option<std::path::PathBuf> {
    std::fs::read_dir(root.join("crash-reports"))
        .ok()?
        .flatten()
        .filter(|entry| entry.path().extension().and_then(|v| v.to_str()) == Some("txt"))
        .max_by_key(|entry| entry.metadata().and_then(|meta| meta.modified()).ok())
        .map(|entry| entry.path())
}

fn incomplete_world_issue(profile: &ServerProfile) -> Option<DiagnosisIssue> {
    let root = Path::new(&profile.root_path);
    let world = root.join(&profile.settings.world_name);
    if !world.join("level.dat").is_file() {
        return None;
    }
    let expected_settings =
        world.join("dimensions/minecraft/overworld/data/minecraft/world_gen_settings.dat");
    if expected_settings.is_file() {
        return None;
    }
    let latest_log = std::fs::read_to_string(root.join("logs/latest.log")).ok()?;
    let failure_lines = latest_log
        .lines()
        .filter(|line| {
            line.contains("Overworld settings missing")
                || line.contains("Unable to read or access the world gen settings file")
        })
        .take(5)
        .map(redact)
        .collect::<Vec<_>>();
    if failure_lines.is_empty() {
        return None;
    }
    Some(issue(
        "world-generation-incomplete",
        "error",
        "初回生成が途中で止まった不完全なワールドを検出しました",
        "このままではワールドを読み込めず、サーバーを起動できません。",
        "最初のワールド生成中にポート競合や強制終了が発生し、生成設定ファイルが保存されなかった可能性があります。",
        &[
            "設定の「ワールド再生成」を開いてください。",
            "アプリが現在の状態をバックアップしてからワールドを再生成します。",
            "残したいワールドの場合は、再生成せず検証済みバックアップから復元してください。",
        ],
        failure_lines,
        true,
    ))
}

fn classify_logs(logs: &[String]) -> Vec<DiagnosisIssue> {
    let joined = logs.join("\n");
    let patterns = [
        (
            "unsupported-class",
            "UnsupportedClassVersionError",
            "Javaのバージョンが合っていません",
            "起動直後にサーバーが終了します。",
            "JARが現在より新しいJavaで作られています。",
            "互換Javaへ切り替えてください。",
            false,
        ),
        (
            "oom",
            "OutOfMemoryError",
            "サーバーのメモリが不足しました",
            "サーバーが停止したり、ワールド保存が遅れる可能性があります。",
            "割り当て不足、Mod過多、またはメモリリークが考えられます。",
            "バックアップ後に割り当てとMod構成を見直してください。",
            true,
        ),
        (
            "bind",
            "Failed to bind to port",
            "ポートを使用できませんでした",
            "サーバーは外部から接続できない状態で終了します。",
            "同じポートを別プロセスが使っています。",
            "別サーバーを停止するか、ポートを変更してください。",
            false,
        ),
        (
            "mod-dependency-log",
            "requires version",
            "Modの依存関係または対応版に問題があります",
            "Modローダーが起動を中止する可能性があります。",
            "必要なModがないか、Minecraft・ローダーのバージョンが一致していません。",
            "関連ログのMod名を確認し、配布元の対応表に合わせてください。",
            true,
        ),
        (
            "missing-class",
            "NoClassDefFoundError",
            "必要なJavaクラスを読み込めませんでした",
            "Mod・プラグインまたはサーバー本体が停止します。",
            "依存ファイル不足または組み合わせの不一致が考えられます。",
            "直前に追加した拡張機能を確認し、バックアップから戻すことを検討してください。",
            true,
        ),
        (
            "permission",
            "AccessDeniedException",
            "ファイルへのアクセスが拒否されました",
            "設定・ワールド・ログを書き込めない可能性があります。",
            "権限不足、同期ソフト、ウイルス対策、または他プロセスのロックが考えられます。",
            "サーバーを停止し、対象ファイルを使用中のアプリとフォルダー権限を確認してください。",
            false,
        ),
        (
            "world-load",
            "Failed to load level",
            "ワールドを読み込めませんでした",
            "サーバーが起動できないか、別ワールドで起動する危険があります。",
            "ワールドデータの破損または非互換が考えられます。",
            "現在のフォルダーを保全し、検証済みバックアップからの復元を検討してください。",
            true,
        ),
        (
            "main-class",
            "Could not find or load main class",
            "サーバーの起動クラスが見つかりません",
            "起動処理を開始できません。",
            "起動引数またはローダーのインストールが不完全です。",
            "起動ファイルを再スキャンし、対応ローダーを正しく導入してください。",
            true,
        ),
    ];
    patterns
        .into_iter()
        .filter_map(|(id, needle, what, impact, cause, action, restore)| {
            if !joined.contains(needle) {
                return None;
            }
            let related = logs
                .iter()
                .filter(|line| line.contains(needle))
                .take(5)
                .map(|line| redact(line))
                .collect();
            Some(issue(
                id,
                "error",
                what,
                impact,
                cause,
                &[action],
                related,
                restore,
            ))
        })
        .collect()
}

fn fabric_dependency_issues(root: &Path) -> Vec<DiagnosisIssue> {
    let mut installed = HashSet::from([
        "minecraft".to_string(),
        "java".to_string(),
        "fabricloader".to_string(),
    ]);
    let mut required = Vec::new();
    let Ok(entries) = std::fs::read_dir(root.join("mods")) else {
        return Vec::new();
    };
    for entry in entries
        .flatten()
        .filter(|entry| entry.path().extension().and_then(|v| v.to_str()) == Some("jar"))
    {
        let Ok(mut archive) = File::open(entry.path())
            .and_then(|file| ZipArchive::new(file).map_err(std::io::Error::other))
        else {
            continue;
        };
        let Ok(mut metadata) = archive.by_name("fabric.mod.json") else {
            continue;
        };
        let mut text = String::new();
        if metadata.read_to_string(&mut text).is_err() {
            continue;
        }
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        if let Some(id) = json.get("id").and_then(|value| value.as_str()) {
            installed.insert(id.to_string());
        }
        if let Some(deps) = json.get("depends").and_then(|value| value.as_object()) {
            required.extend(
                deps.keys()
                    .filter(|id| !matches!(id.as_str(), "minecraft" | "java" | "fabricloader"))
                    .cloned(),
            );
        }
    }
    required.sort();
    required.dedup();
    let missing = required
        .into_iter()
        .filter(|id| !installed.contains(id))
        .collect::<Vec<_>>();
    if missing.is_empty() {
        Vec::new()
    } else {
        vec![issue(
            "fabric-dependencies",
            "warning",
            &format!(
                "Fabric Modの依存候補が不足しています: {}",
                missing.join(", ")
            ),
            "次回起動時にModローダーが停止する可能性があります。",
            "fabric.mod.jsonに必須指定されたModがmodsフォルダーで見つかりません。",
            &["各Modの配布元で正しいMinecraft・Fabric Loader向け依存Modを確認してください。"],
            vec![],
            true,
        )]
    }
}

fn extension_compatibility_issues(profile: &ServerProfile) -> Vec<DiagnosisIssue> {
    let root = Path::new(&profile.root_path);
    let mut issues = Vec::new();
    let mut mismatched = Vec::new();
    if let Ok(entries) = std::fs::read_dir(root.join("mods")) {
        for entry in entries
            .flatten()
            .filter(|entry| entry.path().extension().and_then(|v| v.to_str()) == Some("jar"))
        {
            let Ok(file) = File::open(entry.path()) else {
                continue;
            };
            let Ok(mut archive) = ZipArchive::new(file) else {
                continue;
            };
            let detected = if archive.by_name("fabric.mod.json").is_ok() {
                Some("fabric")
            } else if archive.by_name("META-INF/neoforge.mods.toml").is_ok() {
                Some("neoforge")
            } else if archive.by_name("META-INF/mods.toml").is_ok() {
                Some("forge")
            } else {
                None
            };
            if detected.is_some_and(|loader| loader != profile.server_type) {
                mismatched.push(entry.file_name().to_string_lossy().to_string());
            }
        }
    }
    if !mismatched.is_empty() {
        issues.push(issue(
            "loader-mismatch",
            "error",
            &format!(
                "別のModローダー向けと思われるModがあります: {}",
                mismatched.join(", ")
            ),
            "ローダーがModを拒否し、起動できない可能性があります。",
            "Fabric／Forge／NeoForgeのいずれかが現在のサーバー種類と一致していません。",
            &["各Modの配布元で、このサーバーのローダー向けファイルを取得してください。"],
            vec![],
            true,
        ));
    }
    if profile.server_type == "paper" {
        let server_line = release_numbers(&profile.minecraft_version);
        let mut too_new = Vec::new();
        if let Ok(entries) = std::fs::read_dir(root.join("plugins")) {
            for entry in entries
                .flatten()
                .filter(|entry| entry.path().extension().and_then(|v| v.to_str()) == Some("jar"))
            {
                let Ok(file) = File::open(entry.path()) else {
                    continue;
                };
                let Ok(mut archive) = ZipArchive::new(file) else {
                    continue;
                };
                let metadata_name = archive
                    .file_names()
                    .find(|name| matches!(*name, "paper-plugin.yml" | "plugin.yml"))
                    .map(str::to_string);
                let Some(metadata_name) = metadata_name else {
                    continue;
                };
                let mut text = String::new();
                let Ok(mut metadata) = archive.by_name(&metadata_name) else {
                    continue;
                };
                if metadata.read_to_string(&mut text).is_err() {
                    continue;
                }
                let api = text.lines().find_map(|line| {
                    line.trim()
                        .strip_prefix("api-version:")
                        .map(|value| value.trim().trim_matches(['\'', '\"']).to_string())
                });
                if api
                    .as_ref()
                    .is_some_and(|value| release_numbers(value) > server_line)
                {
                    too_new.push(entry.file_name().to_string_lossy().to_string());
                }
            }
        }
        if !too_new.is_empty() {
            issues.push(issue(
                "plugin-api-version",
                "warning",
                &format!(
                    "現在より新しいAPI向けの可能性があるプラグイン: {}",
                    too_new.join(", ")
                ),
                "プラグインが無効化または起動失敗する可能性があります。",
                "plugin.ymlのapi-versionがサーバーのMinecraft版より新しく指定されています。",
                &["対応する古い版のプラグインを配布元で確認してください。"],
                vec![],
                true,
            ));
        }
    }
    issues
}

fn release_numbers(value: &str) -> (u32, u32) {
    let mut parts = value.split('.').filter_map(|part| part.parse().ok());
    (parts.next().unwrap_or(0), parts.next().unwrap_or(0))
}

fn redact(text: &str) -> String {
    let ipv4 = Regex::new(r"\b(?:\d{1,3}\.){3}\d{1,3}\b").unwrap();
    let secret =
        Regex::new(r"(?i)(token|secret|password|authorization|api[_-]?key)(\s*[:=]\s*)\S+")
            .unwrap();
    let text = ipv4.replace_all(text, "[IP_REDACTED]");
    secret.replace_all(&text, "$1$2[REDACTED]").into_owned()
}

fn deduplicate(issues: &mut Vec<DiagnosisIssue>) {
    let mut seen = HashSet::new();
    issues.retain(|item| seen.insert(item.id.clone()));
}

fn issue(
    id: &str,
    severity: &str,
    what: &str,
    impact: &str,
    cause: &str,
    actions: &[&str],
    related_logs: Vec<String>,
    suggest_restore: bool,
) -> DiagnosisIssue {
    DiagnosisIssue {
        id: id.into(),
        severity: severity.into(),
        what_happened: what.into(),
        impact: impact.into(),
        likely_cause: cause.into(),
        next_actions: actions.iter().map(|value| (*value).into()).collect(),
        related_logs,
        suggest_restore,
    }
}

#[cfg(test)]
mod tests {
    use super::{analyze, classify_logs, redact, tcp_port_available, udp_port_available};
    use crate::models::{BasicSettings, ServerProfile};

    #[test]
    fn classifies_common_crash_causes() {
        let logs = vec![
            "java.lang.OutOfMemoryError: Java heap space".into(),
            "Failed to bind to port 25565".into(),
            "Mod abc requires version xyz".into(),
        ];
        let issues = classify_logs(&logs);
        assert!(issues.iter().any(|issue| issue.id == "oom"));
        assert!(issues.iter().any(|issue| issue.id == "bind"));
        assert!(issues.iter().any(|issue| issue.id == "mod-dependency-log"));
    }

    #[test]
    fn redacts_network_and_secret_values() {
        let value = redact("client 192.168.1.12 token=super-secret password: hello");
        assert!(!value.contains("192.168.1.12"));
        assert!(!value.contains("super-secret"));
        assert!(!value.contains("hello"));
    }

    #[test]
    fn detects_missing_and_incompatible_java_and_busy_port() {
        let base =
            std::env::temp_dir().join(format!("msh-diagnosis-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("server.jar"), b"jar").unwrap();
        std::fs::write(base.join("eula.txt"), b"eula=true").unwrap();
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let mut profile = ServerProfile {
            id: "server".into(),
            name: "Server".into(),
            root_path: base.display().to_string(),
            game_kind: "minecraft".into(),
            server_type: "vanilla".into(),
            minecraft_version: "1.21.1".into(),
            distribution_build: None,
            launch_target: "server.jar".into(),
            java_path: std::env::current_exe().unwrap().display().to_string(),
            java_major: 8,
            min_memory_mib: 1024,
            max_memory_mib: 2048,
            port,
            eula_accepted_at: "test".into(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: None,
            created_at: "test".into(),
            updated_at: "test".into(),
        };
        let report = analyze(&profile, &[], true);
        assert!(report.issues.iter().any(|issue| issue.id == "java-version"));
        assert!(report.issues.iter().any(|issue| issue.id == "port-in-use"));
        profile.java_path = base.join("missing-java.exe").display().to_string();
        let report = analyze(&profile, &[], false);
        assert!(report.issues.iter().any(|issue| issue.id == "java-missing"));
        drop(listener);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn checks_loopback_and_wildcard_bind_scopes_for_tcp_and_udp() {
        let tcp_loopback = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        assert!(!tcp_port_available(
            tcp_loopback.local_addr().unwrap().port()
        ));
        drop(tcp_loopback);

        let tcp_wildcard = std::net::TcpListener::bind(("0.0.0.0", 0)).unwrap();
        assert!(!tcp_port_available(
            tcp_wildcard.local_addr().unwrap().port()
        ));
        drop(tcp_wildcard);

        let udp_loopback = std::net::UdpSocket::bind(("127.0.0.1", 0)).unwrap();
        assert!(!udp_port_available(
            udp_loopback.local_addr().unwrap().port()
        ));
        drop(udp_loopback);

        let udp_wildcard = std::net::UdpSocket::bind(("0.0.0.0", 0)).unwrap();
        assert!(!udp_port_available(
            udp_wildcard.local_addr().unwrap().port()
        ));
    }

    #[test]
    fn bedrock_skips_java_and_eula_and_checks_udp_port() {
        let base = std::env::temp_dir().join(format!(
            "msh-bedrock-diagnosis-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join("bedrock_server.exe"), b"native").unwrap();
        let socket = std::net::UdpSocket::bind(("0.0.0.0", 0)).unwrap();
        let port = socket.local_addr().unwrap().port();
        let profile = ServerProfile {
            id: "bedrock".into(),
            name: "Bedrock".into(),
            root_path: base.display().to_string(),
            game_kind: "minecraft".into(),
            server_type: "bedrock".into(),
            minecraft_version: "1.21.100.7".into(),
            distribution_build: None,
            launch_target: "bedrock_server.exe".into(),
            java_path: String::new(),
            java_major: 0,
            min_memory_mib: 0,
            max_memory_mib: 0,
            port,
            eula_accepted_at: "accepted-in-app".into(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: None,
            created_at: "test".into(),
            updated_at: "test".into(),
        };
        let report = analyze(&profile, &[], true);
        assert!(
            report
                .issues
                .iter()
                .all(|item| !matches!(item.id.as_str(), "java-missing" | "java-version" | "eula"))
        );
        assert!(report.issues.iter().any(|item| item.id == "port-in-use"));
        drop(socket);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn detects_an_incomplete_first_world_generation() {
        let base =
            std::env::temp_dir().join(format!("msh-incomplete-world-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(base.join("world")).unwrap();
        std::fs::create_dir_all(base.join("logs")).unwrap();
        std::fs::write(base.join("world/level.dat"), b"partial").unwrap();
        std::fs::write(base.join("server.jar"), b"jar").unwrap();
        std::fs::write(base.join("eula.txt"), b"eula=true").unwrap();
        std::fs::write(base.join("logs/latest.log"), "Unable to read or access the world gen settings file!\nCaused by: Overworld settings missing\n").unwrap();
        let profile = ServerProfile {
            id: "server".into(),
            name: "Server".into(),
            root_path: base.display().to_string(),
            game_kind: "minecraft".into(),
            server_type: "paper".into(),
            minecraft_version: "26.2".into(),
            distribution_build: None,
            launch_target: "server.jar".into(),
            java_path: std::env::current_exe().unwrap().display().to_string(),
            java_major: 25,
            min_memory_mib: 1024,
            max_memory_mib: 2048,
            port: 25565,
            eula_accepted_at: "test".into(),
            pending_restart: false,
            settings: BasicSettings::default(),
            palworld_settings: None,
            created_at: "test".into(),
            updated_at: "test".into(),
        };
        let report = analyze(&profile, &[], false);
        assert!(
            report
                .issues
                .iter()
                .any(|issue| issue.id == "world-generation-incomplete")
        );
        std::fs::remove_dir_all(base).unwrap();
    }
}
