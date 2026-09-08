#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod developer_update;
mod inspection;
mod license_ledger;
mod release_approval;
mod release_evidence;
mod release_handoff;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            developer_update::check_developer_update,
            developer_update::install_developer_update,
            inspection::discover_workspace,
            inspection::inspect_workspace,
            inspection::scan_dependency_advisories,
            inspection::collect_license_evidence,
            inspection::write_supply_chain_report,
            inspection::verify_supply_chain_report,
            license_ledger::load_license_review_ledger,
            license_ledger::append_license_review_decision,
            license_ledger::reset_license_review_decision,
            license_ledger::migrate_license_review_records,
            license_ledger::export_license_review_ledger,
            license_ledger::preview_license_review_ledger_backup,
            license_ledger::restore_license_review_ledger_backup,
            license_ledger::list_license_review_recoveries,
            license_ledger::export_license_review_recovery,
            release_approval::preview_release_approval,
            release_approval::record_release_approval,
            release_handoff::preview_release_handoff,
            release_handoff::export_release_handoff,
            release_handoff::verify_release_handoff,
            release_evidence::preview_release_evidence_pack,
            release_evidence::export_release_evidence_pack,
            release_evidence::verify_release_evidence_pack,
        ])
        .run(tauri::generate_context!())
        .expect("Minecraft Server Hub Developer Tools failed to start");
}
