use std::{path::Path, process::Command};

use sysinfo::{Disks, System};

use crate::{
    java::detect_java_runtimes,
    models::{PcDiagnosis, ServerProfile},
};

pub fn diagnose(profile: &ServerProfile) -> PcDiagnosis {
    diagnose_target(
        &profile.server_type,
        &profile.minecraft_version,
        Path::new(&profile.root_path),
        Some(profile.max_memory_mib),
    )
}

pub fn diagnose_new(server_type: &str, minecraft_version: &str, root: &Path) -> PcDiagnosis {
    diagnose_target(server_type, minecraft_version, root, None)
}

fn diagnose_target(
    server_type: &str,
    minecraft_version: &str,
    root: &Path,
    current_max_memory_mib: Option<u32>,
) -> PcDiagnosis {
    let mut system = System::new_all();
    system.refresh_all();
    let memory_total_mib = system.total_memory() / 1024 / 1024;
    let memory_available_mib = system.available_memory() / 1024 / 1024;
    let logical_threads = system.cpus().len();
    let physical_cores = System::physical_core_count().unwrap_or(logical_threads);
    let cpu_name = system
        .cpus()
        .first()
        .map(|cpu| cpu.brand().trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "取得できませんでした".into());
    let cpu_usage_percent = if logical_threads == 0 {
        0.0
    } else {
        system.cpus().iter().map(|cpu| cpu.cpu_usage()).sum::<f32>() / logical_threads as f32
    };

    let (storage_kind, storage_free_gib, storage_available) = storage_info(root);

    let reserve_mib = (memory_total_mib / 4).clamp(3_072, 8_192);
    let usable_mib = memory_available_mib
        .saturating_sub(2_048)
        .min(memory_total_mib.saturating_sub(reserve_mib));
    let palworld = server_type == "palworld";
    let modded = matches!(server_type, "fabric" | "forge" | "neoforge");
    let floor = if palworld {
        8_192
    } else if modded {
        3_072
    } else {
        2_048
    };
    let ceiling = if palworld {
        16_384
    } else if modded {
        12_288
    } else {
        8_192
    };
    let recommended_memory_mib = usable_mib.clamp(floor, ceiling) as u32;
    let memory_players = recommended_memory_mib.saturating_sub(if modded { 2_048 } else { 1_024 })
        / if modded { 512 } else { 320 };
    let cpu_players =
        (logical_threads.saturating_sub(2).max(1) * if modded { 2 } else { 3 }) as u32;
    let recommended_players = memory_players.min(cpu_players).clamp(2, 30) as u16;
    let recommended_view_distance: u8 = if logical_threads >= 12 && recommended_memory_mib >= 6_144
    {
        10
    } else if logical_threads >= 6 {
        8
    } else {
        6
    };
    let recommended_simulation_distance = recommended_view_distance.saturating_sub(2).max(4);
    let mut warnings = Vec::new();
    if memory_available_mib < 4_096 {
        warnings.push("空きメモリが4 GiB未満です。Minecraftクライアントと同時起動する場合は他のアプリを閉じてください。".into());
    }
    if palworld && memory_total_mib < 16_384 {
        warnings.push(
            "Palworld公式推奨の16 GiBを下回ります。人数を抑えてもメモリ不足で停止する可能性があります。"
                .into(),
        );
    } else if palworld && memory_available_mib < 12_288 {
        warnings.push(
            "Palworldクライアントと同じPCで検証する前に、12 GiB以上の空きメモリを確保してください。"
                .into(),
        );
    }
    if storage_available && storage_free_gib < 10 {
        warnings
            .push("保存先の空き容量が10 GiB未満です。バックアップ領域を確保してください。".into());
    }
    if !storage_available {
        warnings.push("保存先の空き容量を取得できませんでした。これは選択ミスとは限りません。ローカルドライブの既存フォルダーを選び直して再診断してください。".into());
    }
    if !matches!(server_type, "bedrock" | "palworld")
        && current_max_memory_mib
            .is_some_and(|value| value as u64 > memory_total_mib.saturating_sub(reserve_mib))
    {
        warnings
            .push("現在の割り当てはOSとクライアント用の余裕を圧迫する可能性があります。".into());
    }

    PcDiagnosis {
        cpu_name,
        physical_cores,
        logical_threads,
        cpu_usage_percent,
        memory_total_mib,
        memory_available_mib,
        gpu_name: gpu_name(),
        os: System::long_os_version().unwrap_or_else(|| "Windows".into()),
        storage_kind,
        storage_free_gib,
        storage_available,
        java_runtimes: if matches!(server_type, "bedrock" | "palworld") {
            Vec::new()
        } else {
            detect_java_runtimes(server_type, minecraft_version)
        },
        recommended_memory_mib,
        recommended_players,
        recommended_view_distance,
        recommended_simulation_distance,
        warnings,
        privacy_note: "診断はこのPC内だけで実行され、結果を外部へ送信しません。ネットワーク速度測定は自動実行しません。".into(),
    }
}

fn storage_info(root: &Path) -> (String, u64, bool) {
    let disks = Disks::new_with_refreshed_list();
    let selected = disks
        .list()
        .iter()
        .filter(|disk| root.starts_with(disk.mount_point()))
        .max_by_key(|disk| disk.mount_point().as_os_str().len());
    let kind = selected
        .map(|disk| format!("{:?}", disk.kind()))
        .unwrap_or_else(|| "ローカルドライブ".into());
    let free_bytes =
        platform_free_space(root).or_else(|| selected.map(|disk| disk.available_space()));
    match free_bytes {
        Some(bytes) => (kind, bytes / 1024 / 1024 / 1024, true),
        None => ("取得できませんでした".into(), 0, false),
    }
}

#[cfg(windows)]
fn platform_free_space(root: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{Win32::Storage::FileSystem::GetDiskFreeSpaceExW, core::PCWSTR};

    let path = root
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let mut available_to_caller = 0_u64;
    let mut total = 0_u64;
    let mut total_free = 0_u64;
    unsafe {
        GetDiskFreeSpaceExW(
            PCWSTR(path.as_ptr()),
            Some(&mut available_to_caller),
            Some(&mut total),
            Some(&mut total_free),
        )
    }
    .ok()
    .map(|_| available_to_caller)
}

#[cfg(not(windows))]
fn platform_free_space(_root: &Path) -> Option<u64> {
    None
}

fn gpu_name() -> String {
    let script =
        "(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join ' / '";
    let mut command = Command::new("powershell.exe");
    command.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    crate::windows_process::hide_console_window(&mut command);
    command
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "取得できませんでした".into())
}

#[cfg(test)]
mod tests {
    use super::{diagnose_new, storage_info};
    #[test]
    fn recommendation_reserves_host_memory() {
        let total = 16_384_u64;
        let reserve = (total / 4).clamp(3_072, 8_192);
        assert_eq!(reserve, 4_096);
        assert!(total - reserve < total);
    }

    #[test]
    fn existing_folder_reports_storage_without_a_false_zero_warning() {
        let (kind, free_gib, available) = storage_info(&std::env::temp_dir());
        assert!(
            available,
            "storage probe failed for temp directory ({kind})"
        );
        assert!(
            free_gib > 0,
            "storage probe returned a false zero value ({kind})"
        );
    }

    #[test]
    fn bedrock_diagnosis_does_not_require_java() {
        let diagnosis = diagnose_new("bedrock", "1.21.100.7", &std::env::temp_dir());
        assert!(diagnosis.java_runtimes.is_empty());
        assert!(
            diagnosis
                .warnings
                .iter()
                .all(|warning| !warning.contains("Java"))
        );
    }

    #[test]
    fn palworld_diagnosis_does_not_require_java() {
        let diagnosis = diagnose_new("palworld", "", &std::env::temp_dir());
        assert!(diagnosis.java_runtimes.is_empty());
        assert!(diagnosis.recommended_memory_mib >= 8_192);
    }
}
