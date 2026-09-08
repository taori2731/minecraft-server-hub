use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
};

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

const DOCUMENT_TYPE: &str = "minecraft-server-hub-license-review-ledger";
const SCHEMA_VERSION: u32 = 1;
const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const MAX_LEDGER_BYTES: u64 = 4 * 1024 * 1024;
const MAX_EVENTS: usize = 4_000;
const MAX_COMPONENTS: usize = 32;
const MAX_RECOVERY_SCAN: usize = 128;
const MAX_RECOVERY_ENTRIES: usize = 20;
const MAX_RECOVERY_DIFFERENCES: usize = 100;
static LEDGER_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

fn lock_ledger() -> Result<MutexGuard<'static, ()>, String> {
    LEDGER_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "license-ledger-lock-poisoned".into())
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseReviewRecord {
    item_id: String,
    inventory_digest: String,
    ecosystem: String,
    name: String,
    version: String,
    license: String,
    license_class: String,
    source: String,
    integrity: String,
    component_ids: Vec<String>,
    decision: String,
    reviewer: String,
    rationale: String,
    reviewed_at: String,
    expires_at: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseReviewDecisionInput {
    inventory_digest: String,
    item_id: String,
    ecosystem: String,
    name: String,
    version: String,
    license: String,
    license_class: String,
    source: String,
    integrity: String,
    component_ids: Vec<String>,
    decision: String,
    reviewer: String,
    rationale: String,
    validity_days: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LicenseLedgerEvent {
    sequence: u64,
    action: String,
    inventory_digest: String,
    item_id: String,
    ecosystem: String,
    name: String,
    version: String,
    license: String,
    license_class: String,
    source: String,
    integrity: String,
    component_ids: Vec<String>,
    decision: String,
    reviewer: String,
    rationale: String,
    occurred_at: String,
    expires_at: String,
    previous_hash: String,
    event_hash: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredLicenseLedger {
    document_type: String,
    schema_version: u32,
    inventory_digest: String,
    created_at: String,
    updated_at: String,
    events: Vec<LicenseLedgerEvent>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseLedgerHistoryEntry {
    sequence: u64,
    action: String,
    item_id: String,
    name: String,
    version: String,
    decision: String,
    reviewer: String,
    rationale: String,
    occurred_at: String,
    expires_at: String,
    event_hash: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseLedgerSnapshot {
    schema_version: u32,
    inventory_digest: String,
    storage: String,
    integrity: String,
    event_count: usize,
    expiring_soon: usize,
    last_hash: String,
    updated_at: String,
    records: Vec<LicenseReviewRecord>,
    history: Vec<LicenseLedgerHistoryEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseLedgerExportReceipt {
    path: String,
    event_count: usize,
    last_hash: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseLedgerBackupPreview {
    inventory_digest: String,
    source_path: String,
    relation: String,
    can_restore: bool,
    reason: String,
    current_event_count: usize,
    backup_event_count: usize,
    common_event_count: usize,
    active_records: usize,
    expiring_soon: usize,
    current_last_hash: String,
    backup_last_hash: String,
    backup_sha256: String,
    created_at: String,
    updated_at: String,
    size_bytes: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreLicenseLedgerInput {
    inventory_digest: String,
    source_path: String,
    expected_backup_hash: String,
    expected_backup_sha256: String,
    expected_current_hash: String,
    confirmed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseLedgerRestoreReceipt {
    snapshot: LicenseLedgerSnapshot,
    recovery_created: bool,
    recovery_file: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseLedgerRecordDifference {
    item_id: String,
    name: String,
    version: String,
    kind: String,
    current_decision: String,
    recovery_decision: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseLedgerRecoveryEntry {
    file_name: String,
    integrity: String,
    error: String,
    relation: String,
    common_event_count: usize,
    event_count: usize,
    active_records: usize,
    expiring_soon: usize,
    created_at: String,
    updated_at: String,
    size_bytes: u64,
    sha256: String,
    last_hash: String,
    difference_count: usize,
    differences: Vec<LicenseLedgerRecordDifference>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseLedgerRecoveryList {
    inventory_digest: String,
    generated_at: String,
    total_files: usize,
    returned_files: usize,
    verified_files: usize,
    invalid_files: usize,
    total_size_bytes: u64,
    retention_limit: usize,
    truncated: bool,
    entries: Vec<LicenseLedgerRecoveryEntry>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportLicenseLedgerRecoveryInput {
    inventory_digest: String,
    file_name: String,
    expected_sha256: String,
    expected_last_hash: String,
    destination_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LedgerEventHashPayload<'a> {
    sequence: u64,
    action: &'a str,
    inventory_digest: &'a str,
    item_id: &'a str,
    ecosystem: &'a str,
    name: &'a str,
    version: &'a str,
    license: &'a str,
    license_class: &'a str,
    source: &'a str,
    integrity: &'a str,
    component_ids: &'a [String],
    decision: &'a str,
    reviewer: &'a str,
    rationale: &'a str,
    occurred_at: &'a str,
    expires_at: &'a str,
    previous_hash: &'a str,
}

fn sha256_upper(bytes: &[u8]) -> String {
    hex::encode_upper(Sha256::digest(bytes))
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_text(value: &str, min: usize, max: usize) -> bool {
    let trimmed = value.trim();
    (min..=max).contains(&trimmed.len()) && !trimmed.chars().any(char::is_control)
}

fn valid_metadata_text(value: &str, max: usize) -> bool {
    value.len() <= max
        && !value
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\t' | '\n' | '\r'))
}

fn normalize_components(values: Vec<String>) -> Result<Vec<String>, String> {
    if values.is_empty() || values.len() > MAX_COMPONENTS {
        return Err("license-ledger-components-invalid".into());
    }
    let mut normalized = values
        .into_iter()
        .map(|value| value.trim().to_string())
        .collect::<Vec<_>>();
    if normalized.iter().any(|value| !valid_text(value, 1, 100)) {
        return Err("license-ledger-components-invalid".into());
    }
    normalized.sort();
    normalized.dedup();
    Ok(normalized)
}

fn parse_timestamp(value: &str) -> Result<DateTime<Utc>, String> {
    DateTime::parse_from_rfc3339(value)
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .map_err(|_| "license-ledger-timestamp-invalid".into())
}

fn validate_record(record: &mut LicenseReviewRecord) -> Result<(), String> {
    if !valid_digest(&record.inventory_digest)
        || !valid_text(&record.item_id, 1, 500)
        || !matches!(record.ecosystem.as_str(), "npm" | "cargo")
        || !valid_text(&record.name, 1, 512)
        || !valid_text(&record.version, 1, 128)
        || !valid_metadata_text(&record.license, 512)
        || !matches!(record.license_class.as_str(), "unknown" | "reciprocal")
        || !valid_metadata_text(&record.source, 4_096)
        || !valid_metadata_text(&record.integrity, 4_096)
        || !matches!(
            record.decision.as_str(),
            "approved" | "restricted" | "blocked"
        )
        || !valid_text(&record.reviewer, 2, 80)
        || !valid_text(&record.rationale, 8, 2_000)
    {
        return Err("license-ledger-record-invalid".into());
    }
    record.component_ids = normalize_components(std::mem::take(&mut record.component_ids))?;
    let reviewed = parse_timestamp(&record.reviewed_at)?;
    let expires = parse_timestamp(&record.expires_at)?;
    let validity = expires - reviewed;
    if validity < Duration::days(29) || validity > Duration::days(366) {
        return Err("license-ledger-validity-invalid".into());
    }
    Ok(())
}

fn event_hash(event: &LicenseLedgerEvent) -> Result<String, String> {
    let payload = LedgerEventHashPayload {
        sequence: event.sequence,
        action: &event.action,
        inventory_digest: &event.inventory_digest,
        item_id: &event.item_id,
        ecosystem: &event.ecosystem,
        name: &event.name,
        version: &event.version,
        license: &event.license,
        license_class: &event.license_class,
        source: &event.source,
        integrity: &event.integrity,
        component_ids: &event.component_ids,
        decision: &event.decision,
        reviewer: &event.reviewer,
        rationale: &event.rationale,
        occurred_at: &event.occurred_at,
        expires_at: &event.expires_at,
        previous_hash: &event.previous_hash,
    };
    serde_json::to_vec(&payload)
        .map(|bytes| sha256_upper(&bytes))
        .map_err(|error| format!("license-ledger-hash-encode: {error}"))
}

fn validate_event(event: &LicenseLedgerEvent, digest: &str) -> Result<(), String> {
    if event.inventory_digest != digest
        || !matches!(event.action.as_str(), "decision" | "migration" | "reset")
        || !valid_text(&event.item_id, 1, 500)
        || !valid_digest(&event.previous_hash)
        || !valid_digest(&event.event_hash)
    {
        return Err("license-ledger-event-invalid".into());
    }
    parse_timestamp(&event.occurred_at)?;
    if event.action == "reset" {
        if !event.decision.is_empty()
            || !event.reviewer.is_empty()
            || !event.rationale.is_empty()
            || !event.expires_at.is_empty()
        {
            return Err("license-ledger-reset-invalid".into());
        }
        return Ok(());
    }
    let mut record = event_record(event);
    validate_record(&mut record)
}

fn validate_ledger(ledger: &StoredLicenseLedger, expected_digest: &str) -> Result<(), String> {
    if ledger.document_type != DOCUMENT_TYPE
        || ledger.schema_version != SCHEMA_VERSION
        || ledger.inventory_digest != expected_digest
        || !valid_digest(&ledger.inventory_digest)
        || ledger.events.len() > MAX_EVENTS
    {
        return Err("license-ledger-document-invalid".into());
    }
    let created_at = parse_timestamp(&ledger.created_at)?;
    let updated_at = parse_timestamp(&ledger.updated_at)?;
    if updated_at < created_at {
        return Err("license-ledger-document-time-invalid".into());
    }
    let mut previous = GENESIS_HASH.to_string();
    let mut previous_time = created_at;
    for (index, event) in ledger.events.iter().enumerate() {
        validate_event(event, expected_digest)?;
        let occurred_at = parse_timestamp(&event.occurred_at)?;
        if event.sequence != index as u64 + 1 || event.previous_hash != previous {
            return Err("license-ledger-chain-invalid".into());
        }
        if occurred_at < previous_time {
            return Err("license-ledger-event-order-invalid".into());
        }
        let calculated = event_hash(event)?;
        if event.event_hash != calculated {
            return Err("license-ledger-hash-mismatch".into());
        }
        previous = calculated;
        previous_time = occurred_at;
    }
    if let Some(last) = ledger.events.last() {
        if ledger.updated_at != last.occurred_at {
            return Err("license-ledger-updated-at-invalid".into());
        }
    } else if ledger.updated_at != ledger.created_at {
        return Err("license-ledger-updated-at-invalid".into());
    }
    Ok(())
}

fn ledger_path(root: &Path, digest: &str) -> Result<PathBuf, String> {
    if !valid_digest(digest) {
        return Err("license-ledger-digest-invalid".into());
    }
    Ok(root
        .join("license-review-ledgers")
        .join(format!("{}.json", digest.to_ascii_uppercase())))
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("license-ledger-symlink-rejected".into());
    }
    Ok(())
}

fn read_ledger(path: &Path, digest: &str) -> Result<Option<StoredLicenseLedger>, String> {
    if !path.exists() {
        return Ok(None);
    }
    reject_symlink(path)?;
    let metadata =
        fs::metadata(path).map_err(|error| format!("license-ledger-metadata: {error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_LEDGER_BYTES {
        return Err("license-ledger-size-invalid".into());
    }
    let bytes = fs::read(path).map_err(|error| format!("license-ledger-read: {error}"))?;
    let ledger: StoredLicenseLedger = serde_json::from_slice(&bytes)
        .map_err(|error| format!("license-ledger-json-invalid: {error}"))?;
    validate_ledger(&ledger, digest)?;
    Ok(Some(ledger))
}

fn new_ledger(digest: &str) -> StoredLicenseLedger {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    StoredLicenseLedger {
        document_type: DOCUMENT_TYPE.into(),
        schema_version: SCHEMA_VERSION,
        inventory_digest: digest.to_ascii_uppercase(),
        created_at: now.clone(),
        updated_at: now,
        events: Vec::new(),
    }
}

fn write_atomic(path: &Path, ledger: &StoredLicenseLedger) -> Result<(), String> {
    validate_ledger(ledger, &ledger.inventory_digest)?;
    let parent = path
        .parent()
        .ok_or_else(|| "license-ledger-path-invalid".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("license-ledger-create-dir: {error}"))?;
    reject_symlink(parent)?;
    reject_symlink(path)?;
    let bytes = serde_json::to_vec_pretty(ledger)
        .map_err(|error| format!("license-ledger-json-encode: {error}"))?;
    if bytes.len() as u64 > MAX_LEDGER_BYTES {
        return Err("license-ledger-size-invalid".into());
    }
    let temporary = path.with_extension(format!("json.{}.tmp", std::process::id()));
    let backup = path.with_extension("json.bak");
    if temporary.exists() {
        reject_symlink(&temporary)?;
        fs::remove_file(&temporary)
            .map_err(|error| format!("license-ledger-temp-cleanup: {error}"))?;
    }
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("license-ledger-temp-create: {error}"))?;
    output
        .write_all(&bytes)
        .and_then(|_| output.write_all(b"\n"))
        .and_then(|_| output.sync_all())
        .map_err(|error| format!("license-ledger-temp-write: {error}"))?;
    if path.exists() {
        reject_symlink(&backup)?;
        fs::copy(path, &backup).map_err(|error| format!("license-ledger-backup: {error}"))?;
        fs::remove_file(path).map_err(|error| format!("license-ledger-replace-remove: {error}"))?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if backup.is_file() {
            let _ = fs::copy(&backup, path);
        }
        let _ = fs::remove_file(&temporary);
        return Err(format!("license-ledger-replace: {error}"));
    }
    Ok(())
}

fn event_record(event: &LicenseLedgerEvent) -> LicenseReviewRecord {
    LicenseReviewRecord {
        item_id: event.item_id.clone(),
        inventory_digest: event.inventory_digest.clone(),
        ecosystem: event.ecosystem.clone(),
        name: event.name.clone(),
        version: event.version.clone(),
        license: event.license.clone(),
        license_class: event.license_class.clone(),
        source: event.source.clone(),
        integrity: event.integrity.clone(),
        component_ids: event.component_ids.clone(),
        decision: event.decision.clone(),
        reviewer: event.reviewer.clone(),
        rationale: event.rationale.clone(),
        reviewed_at: event.occurred_at.clone(),
        expires_at: event.expires_at.clone(),
    }
}

fn current_records(ledger: &StoredLicenseLedger) -> Vec<LicenseReviewRecord> {
    let mut current = BTreeMap::<String, LicenseReviewRecord>::new();
    for event in &ledger.events {
        if event.action == "reset" {
            current.remove(&event.item_id);
        } else {
            current.insert(event.item_id.clone(), event_record(event));
        }
    }
    current.into_values().collect()
}

fn snapshot(ledger: &StoredLicenseLedger) -> LicenseLedgerSnapshot {
    let records = current_records(ledger);
    let now = Utc::now();
    let expiring_soon = records
        .iter()
        .filter_map(|record| parse_timestamp(&record.expires_at).ok())
        .filter(|expires| *expires > now && *expires <= now + Duration::days(30))
        .count();
    let history = ledger
        .events
        .iter()
        .rev()
        .take(250)
        .map(|event| LicenseLedgerHistoryEntry {
            sequence: event.sequence,
            action: event.action.clone(),
            item_id: event.item_id.clone(),
            name: event.name.clone(),
            version: event.version.clone(),
            decision: event.decision.clone(),
            reviewer: event.reviewer.clone(),
            rationale: event.rationale.clone(),
            occurred_at: event.occurred_at.clone(),
            expires_at: event.expires_at.clone(),
            event_hash: event.event_hash.clone(),
        })
        .collect();
    LicenseLedgerSnapshot {
        schema_version: SCHEMA_VERSION,
        inventory_digest: ledger.inventory_digest.clone(),
        storage: "app-data".into(),
        integrity: "verified".into(),
        event_count: ledger.events.len(),
        expiring_soon,
        last_hash: ledger
            .events
            .last()
            .map(|event| event.event_hash.clone())
            .unwrap_or_else(|| GENESIS_HASH.into()),
        updated_at: ledger.updated_at.clone(),
        records,
        history,
    }
}

fn append_record_event(
    ledger: &mut StoredLicenseLedger,
    action: &str,
    mut record: LicenseReviewRecord,
) -> Result<(), String> {
    validate_record(&mut record)?;
    if record.inventory_digest != ledger.inventory_digest {
        return Err("license-ledger-digest-mismatch".into());
    }
    let occurred_at = parse_timestamp(&record.reviewed_at)?;
    if let Some(last) = ledger.events.last() {
        if occurred_at < parse_timestamp(&last.occurred_at)? {
            return Err("license-ledger-event-order-invalid".into());
        }
    } else if occurred_at < parse_timestamp(&ledger.created_at)? {
        ledger.created_at = record.reviewed_at.clone();
    }
    let previous_hash = ledger
        .events
        .last()
        .map(|event| event.event_hash.clone())
        .unwrap_or_else(|| GENESIS_HASH.into());
    let mut event = LicenseLedgerEvent {
        sequence: ledger.events.len() as u64 + 1,
        action: action.into(),
        inventory_digest: record.inventory_digest,
        item_id: record.item_id,
        ecosystem: record.ecosystem,
        name: record.name,
        version: record.version,
        license: record.license,
        license_class: record.license_class,
        source: record.source,
        integrity: record.integrity,
        component_ids: record.component_ids,
        decision: record.decision,
        reviewer: record.reviewer,
        rationale: record.rationale,
        occurred_at: record.reviewed_at,
        expires_at: record.expires_at,
        previous_hash,
        event_hash: String::new(),
    };
    event.event_hash = event_hash(&event)?;
    ledger.updated_at = event.occurred_at.clone();
    ledger.events.push(event);
    Ok(())
}

fn append_reset_event(ledger: &mut StoredLicenseLedger, item_id: &str) -> Result<(), String> {
    let record = current_records(ledger)
        .into_iter()
        .find(|record| record.item_id == item_id)
        .ok_or_else(|| "license-ledger-item-not-found".to_string())?;
    let occurred_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    if ledger
        .events
        .last()
        .map(|event| {
            parse_timestamp(&occurred_at)
                .and_then(|now| parse_timestamp(&event.occurred_at).map(|previous| now < previous))
        })
        .transpose()?
        .unwrap_or(false)
    {
        return Err("license-ledger-event-order-invalid".into());
    }
    let previous_hash = ledger
        .events
        .last()
        .map(|event| event.event_hash.clone())
        .unwrap_or_else(|| GENESIS_HASH.into());
    let mut event = LicenseLedgerEvent {
        sequence: ledger.events.len() as u64 + 1,
        action: "reset".into(),
        inventory_digest: ledger.inventory_digest.clone(),
        item_id: record.item_id,
        ecosystem: record.ecosystem,
        name: record.name,
        version: record.version,
        license: record.license,
        license_class: record.license_class,
        source: record.source,
        integrity: record.integrity,
        component_ids: record.component_ids,
        decision: String::new(),
        reviewer: String::new(),
        rationale: String::new(),
        occurred_at: occurred_at.clone(),
        expires_at: String::new(),
        previous_hash,
        event_hash: String::new(),
    };
    event.event_hash = event_hash(&event)?;
    ledger.updated_at = occurred_at;
    ledger.events.push(event);
    Ok(())
}

fn app_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("license-ledger-app-data: {error}"))
}

fn app_ledger_path(app: &AppHandle, digest: &str) -> Result<PathBuf, String> {
    ledger_path(&app_data_root(app)?, digest)
}

fn last_hash(ledger: &StoredLicenseLedger) -> String {
    ledger
        .events
        .last()
        .map(|event| event.event_hash.clone())
        .unwrap_or_else(|| GENESIS_HASH.into())
}

fn ledger_relation(current: &StoredLicenseLedger, backup: &StoredLicenseLedger) -> (String, usize) {
    let common = current
        .events
        .iter()
        .zip(&backup.events)
        .take_while(|(left, right)| left.event_hash == right.event_hash)
        .count();
    let relation = if current.events.len() == backup.events.len() && common == current.events.len()
    {
        "identical"
    } else if common == current.events.len() && backup.events.len() > current.events.len() {
        if current.events.is_empty() {
            "new"
        } else {
            "incoming-ahead"
        }
    } else if common == backup.events.len() && current.events.len() > backup.events.len() {
        "current-ahead"
    } else {
        "diverged"
    };
    (relation.into(), common)
}

fn validate_backup_path(path: &Path, require_existing: bool) -> Result<(), String> {
    if !path.is_absolute()
        || !path
            .extension()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("mshlicense"))
    {
        return Err("license-ledger-backup-path-invalid".into());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "license-ledger-backup-path-invalid".to_string())?;
    reject_symlink(parent)?;
    let metadata =
        fs::metadata(parent).map_err(|error| format!("license-ledger-backup-parent: {error}"))?;
    if !metadata.is_dir() {
        return Err("license-ledger-backup-parent-invalid".into());
    }
    reject_symlink(path)?;
    if require_existing {
        let metadata = fs::metadata(path)
            .map_err(|error| format!("license-ledger-backup-metadata: {error}"))?;
        if !metadata.is_file() || metadata.len() > MAX_LEDGER_BYTES {
            return Err("license-ledger-backup-size-invalid".into());
        }
    }
    Ok(())
}

fn reject_internal_backup_path(root: &Path, path: &Path) -> Result<(), String> {
    let external_parent = path
        .parent()
        .and_then(|value| value.canonicalize().ok())
        .ok_or_else(|| "license-ledger-backup-parent-invalid".to_string())?;
    let internal = root.join("license-review-ledgers");
    if internal.exists() {
        let internal = internal
            .canonicalize()
            .map_err(|error| format!("license-ledger-internal-path: {error}"))?;
        if external_parent.starts_with(internal) {
            return Err("license-ledger-internal-backup-path-rejected".into());
        }
    }
    Ok(())
}

fn read_backup(path: &Path, digest: &str) -> Result<(StoredLicenseLedger, Vec<u8>), String> {
    validate_backup_path(path, true)?;
    let bytes = fs::read(path).map_err(|error| format!("license-ledger-backup-read: {error}"))?;
    if bytes.len() as u64 > MAX_LEDGER_BYTES {
        return Err("license-ledger-backup-size-invalid".into());
    }
    let ledger: StoredLicenseLedger = serde_json::from_slice(&bytes)
        .map_err(|error| format!("license-ledger-backup-json-invalid: {error}"))?;
    validate_ledger(&ledger, digest)?;
    Ok((ledger, bytes))
}

fn write_backup_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    validate_backup_path(path, false)?;
    if bytes.len() as u64 > MAX_LEDGER_BYTES {
        return Err("license-ledger-backup-size-invalid".into());
    }
    let temporary = path.with_extension(format!("mshlicense.{}.tmp", std::process::id()));
    let rollback = path.with_extension("mshlicense.bak");
    reject_symlink(&temporary)?;
    reject_symlink(&rollback)?;
    if temporary.exists() {
        fs::remove_file(&temporary)
            .map_err(|error| format!("license-ledger-backup-temp-cleanup: {error}"))?;
    }
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("license-ledger-backup-temp-create: {error}"))?;
    output
        .write_all(bytes)
        .and_then(|_| output.write_all(b"\n"))
        .and_then(|_| output.sync_all())
        .map_err(|error| format!("license-ledger-backup-temp-write: {error}"))?;
    if path.exists() {
        fs::copy(path, &rollback)
            .map_err(|error| format!("license-ledger-backup-rollback: {error}"))?;
        fs::remove_file(path)
            .map_err(|error| format!("license-ledger-backup-replace-remove: {error}"))?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if rollback.is_file() {
            let _ = fs::copy(&rollback, path);
        }
        let _ = fs::remove_file(&temporary);
        return Err(format!("license-ledger-backup-replace: {error}"));
    }
    Ok(())
}

fn preview_backup(
    root: &Path,
    digest: &str,
    source: &Path,
) -> Result<LicenseLedgerBackupPreview, String> {
    reject_internal_backup_path(root, source)?;
    let (backup, bytes) = read_backup(source, digest)?;
    let target = ledger_path(root, digest)?;
    let current = read_ledger(&target, digest)?.unwrap_or_else(|| new_ledger(digest));
    let (relation, common_event_count) = ledger_relation(&current, &backup);
    let backup_snapshot = snapshot(&backup);
    let can_restore = matches!(relation.as_str(), "new" | "incoming-ahead");
    let reason = match relation.as_str() {
        "new" => "license-ledger-restore-new",
        "incoming-ahead" => "license-ledger-restore-forward",
        "identical" => "license-ledger-restore-identical",
        "current-ahead" => "license-ledger-restore-older",
        _ => "license-ledger-restore-diverged",
    };
    Ok(LicenseLedgerBackupPreview {
        inventory_digest: digest.into(),
        source_path: source.to_string_lossy().into_owned(),
        relation,
        can_restore,
        reason: reason.into(),
        current_event_count: current.events.len(),
        backup_event_count: backup.events.len(),
        common_event_count,
        active_records: backup_snapshot.records.len(),
        expiring_soon: backup_snapshot.expiring_soon,
        current_last_hash: last_hash(&current),
        backup_last_hash: last_hash(&backup),
        backup_sha256: sha256_upper(&bytes),
        created_at: backup.created_at,
        updated_at: backup.updated_at,
        size_bytes: bytes.len() as u64,
    })
}

fn recovery_filename(digest: &str, ledger: &StoredLicenseLedger) -> String {
    let timestamp = Utc::now().format("%Y%m%dT%H%M%S%3fZ");
    format!(
        "{}-{}-{}.json",
        &digest[..12],
        timestamp,
        &last_hash(ledger)[..12]
    )
}

fn recovery_directory(root: &Path) -> PathBuf {
    root.join("license-review-ledgers").join("recovery")
}

fn valid_recovery_filename(digest: &str, value: &str) -> bool {
    value.len() <= 128
        && value.starts_with(&format!("{}-", &digest[..12]))
        && value.ends_with(".json")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.'))
}

fn records_equivalent(left: &LicenseReviewRecord, right: &LicenseReviewRecord) -> bool {
    left.name == right.name
        && left.version == right.version
        && left.license == right.license
        && left.license_class == right.license_class
        && left.source == right.source
        && left.integrity == right.integrity
        && left.component_ids == right.component_ids
        && left.decision == right.decision
        && left.reviewer == right.reviewer
        && left.rationale == right.rationale
        && left.reviewed_at == right.reviewed_at
        && left.expires_at == right.expires_at
}

fn recovery_differences(
    current: &StoredLicenseLedger,
    recovery: &StoredLicenseLedger,
) -> (usize, Vec<LicenseLedgerRecordDifference>) {
    let current = current_records(current)
        .into_iter()
        .map(|record| (record.item_id.clone(), record))
        .collect::<BTreeMap<_, _>>();
    let recovery = current_records(recovery)
        .into_iter()
        .map(|record| (record.item_id.clone(), record))
        .collect::<BTreeMap<_, _>>();
    let mut item_ids = current
        .keys()
        .chain(recovery.keys())
        .cloned()
        .collect::<Vec<_>>();
    item_ids.sort();
    item_ids.dedup();
    let mut differences = Vec::new();
    for item_id in item_ids {
        let current_record = current.get(&item_id);
        let recovery_record = recovery.get(&item_id);
        let kind = match (current_record, recovery_record) {
            (Some(left), Some(right)) if records_equivalent(left, right) => continue,
            (Some(_), Some(_)) => "changed",
            (Some(_), None) => "current-only",
            (None, Some(_)) => "recovery-only",
            (None, None) => continue,
        };
        let display = recovery_record.or(current_record).expect("record exists");
        differences.push(LicenseLedgerRecordDifference {
            item_id,
            name: display.name.clone(),
            version: display.version.clone(),
            kind: kind.into(),
            current_decision: current_record
                .map(|record| record.decision.clone())
                .unwrap_or_default(),
            recovery_decision: recovery_record
                .map(|record| record.decision.clone())
                .unwrap_or_default(),
        });
    }
    let count = differences.len();
    differences.truncate(MAX_RECOVERY_DIFFERENCES);
    (count, differences)
}

fn invalid_recovery_entry(
    file_name: String,
    size_bytes: u64,
    error: &str,
) -> LicenseLedgerRecoveryEntry {
    LicenseLedgerRecoveryEntry {
        file_name,
        integrity: "invalid".into(),
        error: error
            .split(':')
            .next()
            .unwrap_or("license-ledger-recovery-invalid")
            .into(),
        relation: "invalid".into(),
        common_event_count: 0,
        event_count: 0,
        active_records: 0,
        expiring_soon: 0,
        created_at: String::new(),
        updated_at: String::new(),
        size_bytes,
        sha256: String::new(),
        last_hash: String::new(),
        difference_count: 0,
        differences: Vec::new(),
    }
}

fn list_recoveries(root: &Path, digest: &str) -> Result<LicenseLedgerRecoveryList, String> {
    if !valid_digest(digest) {
        return Err("license-ledger-digest-invalid".into());
    }
    let directory = recovery_directory(root);
    if !directory.exists() {
        return Ok(LicenseLedgerRecoveryList {
            inventory_digest: digest.into(),
            generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            total_files: 0,
            returned_files: 0,
            verified_files: 0,
            invalid_files: 0,
            total_size_bytes: 0,
            retention_limit: MAX_RECOVERY_ENTRIES,
            truncated: false,
            entries: Vec::new(),
        });
    }
    reject_symlink(&directory)?;
    let target = ledger_path(root, digest)?;
    let current = read_ledger(&target, digest)?.unwrap_or_else(|| new_ledger(digest));
    let mut candidates = fs::read_dir(&directory)
        .map_err(|error| format!("license-ledger-recovery-read-dir: {error}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_name = entry.file_name().to_str()?.to_string();
            valid_recovery_filename(digest, &file_name).then_some((file_name, entry.path()))
        })
        .take(MAX_RECOVERY_SCAN + 1)
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| right.0.cmp(&left.0));
    let truncated = candidates.len() > MAX_RECOVERY_SCAN;
    candidates.truncate(MAX_RECOVERY_SCAN);
    let total_files = candidates.len();
    let mut entries = Vec::with_capacity(candidates.len());
    for (file_name, path) in candidates {
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                entries.push(invalid_recovery_entry(
                    file_name,
                    0,
                    &format!("license-ledger-recovery-metadata: {error}"),
                ));
                continue;
            }
        };
        let size_bytes = metadata.len();
        if metadata.file_type().is_symlink() || !metadata.is_file() || size_bytes > MAX_LEDGER_BYTES
        {
            entries.push(invalid_recovery_entry(
                file_name,
                size_bytes,
                "license-ledger-recovery-file-invalid",
            ));
            continue;
        }
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) => {
                entries.push(invalid_recovery_entry(
                    file_name,
                    size_bytes,
                    &format!("license-ledger-recovery-read: {error}"),
                ));
                continue;
            }
        };
        let recovery: StoredLicenseLedger = match serde_json::from_slice(&bytes) {
            Ok(ledger) => ledger,
            Err(error) => {
                entries.push(invalid_recovery_entry(
                    file_name,
                    size_bytes,
                    &format!("license-ledger-recovery-json-invalid: {error}"),
                ));
                continue;
            }
        };
        if let Err(error) = validate_ledger(&recovery, digest) {
            entries.push(invalid_recovery_entry(file_name, size_bytes, &error));
            continue;
        }
        let (relation, common_event_count) = ledger_relation(&current, &recovery);
        let recovery_snapshot = snapshot(&recovery);
        let (difference_count, differences) = recovery_differences(&current, &recovery);
        let recovery_last_hash = last_hash(&recovery);
        entries.push(LicenseLedgerRecoveryEntry {
            file_name,
            integrity: "verified".into(),
            error: String::new(),
            relation,
            common_event_count,
            event_count: recovery.events.len(),
            active_records: recovery_snapshot.records.len(),
            expiring_soon: recovery_snapshot.expiring_soon,
            created_at: recovery.created_at,
            updated_at: recovery.updated_at,
            size_bytes,
            sha256: sha256_upper(&bytes),
            last_hash: recovery_last_hash,
            difference_count,
            differences,
        });
    }
    let verified_files = entries
        .iter()
        .filter(|entry| entry.integrity == "verified")
        .count();
    let invalid_files = entries.len() - verified_files;
    let total_size_bytes = entries.iter().map(|entry| entry.size_bytes).sum();
    entries.truncate(MAX_RECOVERY_ENTRIES);
    Ok(LicenseLedgerRecoveryList {
        inventory_digest: digest.into(),
        generated_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        total_files,
        returned_files: entries.len(),
        verified_files,
        invalid_files,
        total_size_bytes,
        retention_limit: MAX_RECOVERY_ENTRIES,
        truncated,
        entries,
    })
}

fn export_recovery(
    root: &Path,
    input: &ExportLicenseLedgerRecoveryInput,
) -> Result<LicenseLedgerExportReceipt, String> {
    let digest = input.inventory_digest.trim().to_ascii_uppercase();
    if !valid_digest(&digest)
        || !valid_digest(&input.expected_sha256)
        || !valid_digest(&input.expected_last_hash)
        || !valid_recovery_filename(&digest, &input.file_name)
    {
        return Err("license-ledger-recovery-export-input-invalid".into());
    }
    let directory = recovery_directory(root);
    reject_symlink(&directory)?;
    let source = directory.join(&input.file_name);
    let metadata = fs::symlink_metadata(&source)
        .map_err(|error| format!("license-ledger-recovery-metadata: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > MAX_LEDGER_BYTES
    {
        return Err("license-ledger-recovery-file-invalid".into());
    }
    let bytes =
        fs::read(&source).map_err(|error| format!("license-ledger-recovery-read: {error}"))?;
    let recovery: StoredLicenseLedger = serde_json::from_slice(&bytes)
        .map_err(|error| format!("license-ledger-recovery-json-invalid: {error}"))?;
    validate_ledger(&recovery, &digest)?;
    if sha256_upper(&bytes) != input.expected_sha256.to_ascii_uppercase()
        || last_hash(&recovery) != input.expected_last_hash.to_ascii_uppercase()
    {
        return Err("license-ledger-recovery-changed-after-list".into());
    }
    let destination = Path::new(&input.destination_path);
    reject_internal_backup_path(root, destination)?;
    let encoded = serde_json::to_vec_pretty(&recovery)
        .map_err(|error| format!("license-ledger-backup-json-encode: {error}"))?;
    write_backup_atomic(destination, &encoded)?;
    let written = fs::read(destination)
        .map_err(|error| format!("license-ledger-backup-verify-read: {error}"))?;
    let (verified, _) = read_backup(destination, &digest)?;
    Ok(LicenseLedgerExportReceipt {
        path: destination.to_string_lossy().into_owned(),
        event_count: verified.events.len(),
        last_hash: last_hash(&verified),
        size_bytes: written.len() as u64,
        sha256: sha256_upper(&written),
    })
}

fn restore_backup(
    root: &Path,
    input: &RestoreLicenseLedgerInput,
) -> Result<LicenseLedgerRestoreReceipt, String> {
    if !input.confirmed {
        return Err("license-ledger-restore-confirmation-required".into());
    }
    let digest = input.inventory_digest.trim().to_ascii_uppercase();
    if !valid_digest(&digest)
        || !valid_digest(&input.expected_backup_hash)
        || !valid_digest(&input.expected_backup_sha256)
        || !valid_digest(&input.expected_current_hash)
    {
        return Err("license-ledger-restore-input-invalid".into());
    }
    let source = PathBuf::from(&input.source_path);
    reject_internal_backup_path(root, &source)?;
    let (backup, bytes) = read_backup(&source, &digest)?;
    if last_hash(&backup) != input.expected_backup_hash.to_ascii_uppercase()
        || sha256_upper(&bytes) != input.expected_backup_sha256.to_ascii_uppercase()
    {
        return Err("license-ledger-backup-changed-after-preview".into());
    }
    let target = ledger_path(root, &digest)?;
    let current = read_ledger(&target, &digest)?.unwrap_or_else(|| new_ledger(&digest));
    if last_hash(&current) != input.expected_current_hash.to_ascii_uppercase() {
        return Err("license-ledger-current-changed-after-preview".into());
    }
    let (relation, _) = ledger_relation(&current, &backup);
    if !matches!(relation.as_str(), "new" | "incoming-ahead") {
        return Err(format!("license-ledger-restore-not-forward:{relation}"));
    }

    let mut recovery_file = String::new();
    if !current.events.is_empty() {
        let recovery_dir = root.join("license-review-ledgers").join("recovery");
        fs::create_dir_all(&recovery_dir)
            .map_err(|error| format!("license-ledger-recovery-dir: {error}"))?;
        reject_symlink(&recovery_dir)?;
        recovery_file = recovery_filename(&digest, &current);
        let recovery_path = recovery_dir.join(&recovery_file);
        write_atomic(&recovery_path, &current)?;
    }
    write_atomic(&target, &backup)?;
    let verified = read_ledger(&target, &digest)?
        .ok_or_else(|| "license-ledger-restore-verification-missing".to_string())?;
    Ok(LicenseLedgerRestoreReceipt {
        snapshot: snapshot(&verified),
        recovery_created: !recovery_file.is_empty(),
        recovery_file,
    })
}

fn export_backup(
    root: &Path,
    digest: &str,
    destination: &Path,
) -> Result<LicenseLedgerExportReceipt, String> {
    reject_internal_backup_path(root, destination)?;
    let source = ledger_path(root, digest)?;
    let ledger = read_ledger(&source, digest)?.unwrap_or_else(|| new_ledger(digest));
    validate_ledger(&ledger, digest)?;
    let bytes = serde_json::to_vec_pretty(&ledger)
        .map_err(|error| format!("license-ledger-backup-json-encode: {error}"))?;
    write_backup_atomic(destination, &bytes)?;
    let written = fs::read(destination)
        .map_err(|error| format!("license-ledger-backup-verify-read: {error}"))?;
    let (verified, _) = read_backup(destination, digest)?;
    Ok(LicenseLedgerExportReceipt {
        path: destination.to_string_lossy().into_owned(),
        event_count: verified.events.len(),
        last_hash: last_hash(&verified),
        size_bytes: written.len() as u64,
        sha256: sha256_upper(&written),
    })
}

#[tauri::command]
pub fn export_license_review_ledger(
    app: AppHandle,
    inventory_digest: String,
    destination_path: String,
) -> Result<LicenseLedgerExportReceipt, String> {
    let _guard = lock_ledger()?;
    let digest = inventory_digest.trim().to_ascii_uppercase();
    let root = app_data_root(&app)?;
    export_backup(&root, &digest, Path::new(&destination_path))
}

#[tauri::command]
pub fn preview_license_review_ledger_backup(
    app: AppHandle,
    inventory_digest: String,
    source_path: String,
) -> Result<LicenseLedgerBackupPreview, String> {
    let _guard = lock_ledger()?;
    let digest = inventory_digest.trim().to_ascii_uppercase();
    let root = app_data_root(&app)?;
    preview_backup(&root, &digest, Path::new(&source_path))
}

#[tauri::command]
pub fn restore_license_review_ledger_backup(
    app: AppHandle,
    input: RestoreLicenseLedgerInput,
) -> Result<LicenseLedgerRestoreReceipt, String> {
    let _guard = lock_ledger()?;
    let root = app_data_root(&app)?;
    restore_backup(&root, &input)
}

#[tauri::command]
pub fn list_license_review_recoveries(
    app: AppHandle,
    inventory_digest: String,
) -> Result<LicenseLedgerRecoveryList, String> {
    let _guard = lock_ledger()?;
    let digest = inventory_digest.trim().to_ascii_uppercase();
    let root = app_data_root(&app)?;
    list_recoveries(&root, &digest)
}

#[tauri::command]
pub fn export_license_review_recovery(
    app: AppHandle,
    input: ExportLicenseLedgerRecoveryInput,
) -> Result<LicenseLedgerExportReceipt, String> {
    let _guard = lock_ledger()?;
    let root = app_data_root(&app)?;
    export_recovery(&root, &input)
}

#[tauri::command]
pub fn load_license_review_ledger(
    app: AppHandle,
    inventory_digest: String,
) -> Result<LicenseLedgerSnapshot, String> {
    let _guard = lock_ledger()?;
    let digest = inventory_digest.trim().to_ascii_uppercase();
    let path = app_ledger_path(&app, &digest)?;
    let ledger = read_ledger(&path, &digest)?.unwrap_or_else(|| new_ledger(&digest));
    Ok(snapshot(&ledger))
}

#[tauri::command]
pub fn append_license_review_decision(
    app: AppHandle,
    input: LicenseReviewDecisionInput,
) -> Result<LicenseLedgerSnapshot, String> {
    let _guard = lock_ledger()?;
    let digest = input.inventory_digest.trim().to_ascii_uppercase();
    let path = app_ledger_path(&app, &digest)?;
    let mut ledger = read_ledger(&path, &digest)?.unwrap_or_else(|| new_ledger(&digest));
    if ledger.events.len() >= MAX_EVENTS {
        return Err("license-ledger-event-limit".into());
    }
    if !matches!(input.validity_days, 30 | 90 | 180 | 365) {
        return Err("license-ledger-validity-invalid".into());
    }
    let reviewed_at = Utc::now();
    let record = LicenseReviewRecord {
        item_id: input.item_id,
        inventory_digest: digest,
        ecosystem: input.ecosystem,
        name: input.name,
        version: input.version,
        license: input.license,
        license_class: input.license_class,
        source: input.source,
        integrity: input.integrity,
        component_ids: input.component_ids,
        decision: input.decision,
        reviewer: input.reviewer.trim().into(),
        rationale: input.rationale.trim().into(),
        reviewed_at: reviewed_at.to_rfc3339_opts(SecondsFormat::Millis, true),
        expires_at: (reviewed_at + Duration::days(i64::from(input.validity_days)))
            .to_rfc3339_opts(SecondsFormat::Millis, true),
    };
    append_record_event(&mut ledger, "decision", record)?;
    write_atomic(&path, &ledger)?;
    Ok(snapshot(&ledger))
}

#[tauri::command]
pub fn reset_license_review_decision(
    app: AppHandle,
    inventory_digest: String,
    item_id: String,
) -> Result<LicenseLedgerSnapshot, String> {
    let _guard = lock_ledger()?;
    let digest = inventory_digest.trim().to_ascii_uppercase();
    let path = app_ledger_path(&app, &digest)?;
    let mut ledger =
        read_ledger(&path, &digest)?.ok_or_else(|| "license-ledger-not-found".to_string())?;
    if ledger.events.len() >= MAX_EVENTS {
        return Err("license-ledger-event-limit".into());
    }
    append_reset_event(&mut ledger, item_id.trim())?;
    write_atomic(&path, &ledger)?;
    Ok(snapshot(&ledger))
}

#[tauri::command]
pub fn migrate_license_review_records(
    app: AppHandle,
    inventory_digest: String,
    records: Vec<LicenseReviewRecord>,
) -> Result<LicenseLedgerSnapshot, String> {
    let _guard = lock_ledger()?;
    let digest = inventory_digest.trim().to_ascii_uppercase();
    if records.len() > 500 {
        return Err("license-ledger-migration-limit".into());
    }
    let path = app_ledger_path(&app, &digest)?;
    let mut ledger = read_ledger(&path, &digest)?.unwrap_or_else(|| new_ledger(&digest));
    if !ledger.events.is_empty() {
        return Ok(snapshot(&ledger));
    }
    let mut records = records;
    records.sort_by(|left, right| left.reviewed_at.cmp(&right.reviewed_at));
    for record in records {
        append_record_event(&mut ledger, "migration", record)?;
    }
    if !ledger.events.is_empty() {
        write_atomic(&path, &ledger)?;
    }
    Ok(snapshot(&ledger))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn fixture_record(digest: &str, item_id: &str, decision: &str) -> LicenseReviewRecord {
        let reviewed_at = Utc::now() - Duration::days(1);
        LicenseReviewRecord {
            item_id: item_id.into(),
            inventory_digest: digest.into(),
            ecosystem: "cargo".into(),
            name: "demo".into(),
            version: "1.0.0".into(),
            license: "MPL-2.0".into(),
            license_class: "reciprocal".into(),
            source: "registry+https://github.com/rust-lang/crates.io-index".into(),
            integrity: "A".repeat(64),
            component_ids: vec!["developer-cargo".into(), "app-cargo".into()],
            decision: decision.into(),
            reviewer: "Release team".into(),
            rationale: "Reviewed the exact manifest and distribution obligations.".into(),
            reviewed_at: reviewed_at.to_rfc3339_opts(SecondsFormat::Millis, true),
            expires_at: (reviewed_at + Duration::days(180))
                .to_rfc3339_opts(SecondsFormat::Millis, true),
        }
    }

    #[test]
    fn appends_decisions_and_resets_without_losing_history() {
        let digest = "A".repeat(64);
        let mut ledger = new_ledger(&digest);
        append_record_event(
            &mut ledger,
            "decision",
            fixture_record(&digest, "cargo:demo@1.0.0:AAAA", "approved"),
        )
        .unwrap();
        append_reset_event(&mut ledger, "cargo:demo@1.0.0:AAAA").unwrap();
        validate_ledger(&ledger, &digest).unwrap();
        let result = snapshot(&ledger);
        assert!(result.records.is_empty());
        assert_eq!(result.event_count, 2);
        assert_eq!(result.history[0].action, "reset");
        assert_eq!(result.history[1].decision, "approved");
    }

    #[test]
    fn detects_event_and_chain_tampering() {
        let digest = "B".repeat(64);
        let mut ledger = new_ledger(&digest);
        append_record_event(
            &mut ledger,
            "decision",
            fixture_record(&digest, "cargo:demo@1.0.0:BBBB", "restricted"),
        )
        .unwrap();
        let mut content_tampered = ledger.clone();
        content_tampered.events[0].rationale = "Tampered rationale".into();
        assert_eq!(
            validate_ledger(&content_tampered, &digest).unwrap_err(),
            "license-ledger-hash-mismatch"
        );
        let mut chain_tampered = ledger;
        chain_tampered.events[0].previous_hash = "C".repeat(64);
        assert_eq!(
            validate_ledger(&chain_tampered, &digest).unwrap_err(),
            "license-ledger-chain-invalid"
        );
    }

    #[test]
    fn writes_atomically_and_rejects_a_tampered_saved_ledger() {
        let root = tempdir().unwrap();
        let digest = "D".repeat(64);
        let path = ledger_path(root.path(), &digest).unwrap();
        let mut ledger = new_ledger(&digest);
        append_record_event(
            &mut ledger,
            "migration",
            fixture_record(&digest, "cargo:demo@1.0.0:DDDD", "approved"),
        )
        .unwrap();
        write_atomic(&path, &ledger).unwrap();
        assert_eq!(
            read_ledger(&path, &digest).unwrap().unwrap().events.len(),
            1
        );
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        value["events"][0]["decision"] = serde_json::json!("blocked");
        fs::write(&path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
        assert_eq!(
            read_ledger(&path, &digest).unwrap_err(),
            "license-ledger-hash-mismatch"
        );
    }

    #[test]
    fn sorts_and_deduplicates_components_before_hashing() {
        let digest = "E".repeat(64);
        let mut ledger = new_ledger(&digest);
        let mut record = fixture_record(&digest, "cargo:demo@1.0.0:EEEE", "approved");
        record.component_ids = vec!["website-npm".into(), "app-cargo".into(), "app-cargo".into()];
        append_record_event(&mut ledger, "decision", record).unwrap();
        assert_eq!(ledger.events[0].component_ids, ["app-cargo", "website-npm"]);
    }

    #[test]
    fn counts_only_active_decisions_expiring_within_thirty_days() {
        let digest = "F".repeat(64);
        let mut ledger = new_ledger(&digest);
        let now = Utc::now();
        let mut soon = fixture_record(&digest, "cargo:soon@1.0.0:FFFF", "restricted");
        soon.reviewed_at = (now - Duration::days(20)).to_rfc3339_opts(SecondsFormat::Millis, true);
        soon.expires_at = (now + Duration::days(10)).to_rfc3339_opts(SecondsFormat::Millis, true);
        append_record_event(&mut ledger, "decision", soon).unwrap();

        let mut later = fixture_record(&digest, "cargo:later@1.0.0:FFFF", "approved");
        later.reviewed_at = now.to_rfc3339_opts(SecondsFormat::Millis, true);
        later.expires_at = (now + Duration::days(180)).to_rfc3339_opts(SecondsFormat::Millis, true);
        append_record_event(&mut ledger, "decision", later).unwrap();

        assert_eq!(snapshot(&ledger).expiring_soon, 1);
    }

    #[test]
    fn classifies_identical_forward_older_and_diverged_histories() {
        let digest = "1".repeat(64);
        let mut first = new_ledger(&digest);
        append_record_event(
            &mut first,
            "decision",
            fixture_record(&digest, "cargo:first@1.0.0:1111", "approved"),
        )
        .unwrap();
        let mut forward = first.clone();
        append_record_event(
            &mut forward,
            "decision",
            fixture_record(&digest, "cargo:second@1.0.0:1111", "restricted"),
        )
        .unwrap();
        let mut diverged = first.clone();
        append_record_event(
            &mut diverged,
            "decision",
            fixture_record(&digest, "cargo:other@1.0.0:1111", "blocked"),
        )
        .unwrap();

        assert_eq!(ledger_relation(&first, &first), ("identical".into(), 1));
        assert_eq!(
            ledger_relation(&first, &forward),
            ("incoming-ahead".into(), 1)
        );
        assert_eq!(
            ledger_relation(&forward, &first),
            ("current-ahead".into(), 1)
        );
        assert_eq!(ledger_relation(&forward, &diverged), ("diverged".into(), 1));
    }

    #[test]
    fn previews_and_restores_only_a_verified_forward_backup() {
        let root = tempdir().unwrap();
        let digest = "2".repeat(64);
        let target = ledger_path(root.path(), &digest).unwrap();
        let mut current = new_ledger(&digest);
        append_record_event(
            &mut current,
            "decision",
            fixture_record(&digest, "cargo:first@1.0.0:2222", "approved"),
        )
        .unwrap();
        write_atomic(&target, &current).unwrap();

        let mut forward = current.clone();
        append_record_event(
            &mut forward,
            "decision",
            fixture_record(&digest, "cargo:second@1.0.0:2222", "restricted"),
        )
        .unwrap();
        let source = root.path().join("forward.mshlicense");
        write_backup_atomic(&source, &serde_json::to_vec_pretty(&forward).unwrap()).unwrap();
        let preview = preview_backup(root.path(), &digest, &source).unwrap();
        assert_eq!(preview.relation, "incoming-ahead");
        assert!(preview.can_restore);
        assert_eq!(preview.common_event_count, 1);

        let receipt = restore_backup(
            root.path(),
            &RestoreLicenseLedgerInput {
                inventory_digest: digest.clone(),
                source_path: source.to_string_lossy().into_owned(),
                expected_backup_hash: preview.backup_last_hash,
                expected_backup_sha256: preview.backup_sha256,
                expected_current_hash: preview.current_last_hash,
                confirmed: true,
            },
        )
        .unwrap();
        assert_eq!(receipt.snapshot.event_count, 2);
        assert!(receipt.recovery_created);
        assert!(
            root.path()
                .join("license-review-ledgers")
                .join("recovery")
                .join(receipt.recovery_file)
                .is_file()
        );
        assert_eq!(
            read_ledger(&target, &digest).unwrap().unwrap().events.len(),
            2
        );
    }

    #[test]
    fn rejects_older_diverged_unconfirmed_and_changed_backups() {
        let root = tempdir().unwrap();
        let digest = "3".repeat(64);
        let target = ledger_path(root.path(), &digest).unwrap();
        let mut older = new_ledger(&digest);
        append_record_event(
            &mut older,
            "decision",
            fixture_record(&digest, "cargo:first@1.0.0:3333", "approved"),
        )
        .unwrap();
        let mut current = older.clone();
        append_record_event(
            &mut current,
            "decision",
            fixture_record(&digest, "cargo:second@1.0.0:3333", "restricted"),
        )
        .unwrap();
        write_atomic(&target, &current).unwrap();
        let source = root.path().join("older.mshlicense");
        write_backup_atomic(&source, &serde_json::to_vec_pretty(&older).unwrap()).unwrap();
        let preview = preview_backup(root.path(), &digest, &source).unwrap();
        assert_eq!(preview.relation, "current-ahead");
        assert!(!preview.can_restore);

        let mut input = RestoreLicenseLedgerInput {
            inventory_digest: digest.clone(),
            source_path: source.to_string_lossy().into_owned(),
            expected_backup_hash: preview.backup_last_hash,
            expected_backup_sha256: preview.backup_sha256,
            expected_current_hash: preview.current_last_hash,
            confirmed: false,
        };
        assert_eq!(
            restore_backup(root.path(), &input).unwrap_err(),
            "license-ledger-restore-confirmation-required"
        );
        input.confirmed = true;
        assert_eq!(
            restore_backup(root.path(), &input).unwrap_err(),
            "license-ledger-restore-not-forward:current-ahead"
        );

        fs::OpenOptions::new()
            .append(true)
            .open(&source)
            .unwrap()
            .write_all(b" \n")
            .unwrap();
        assert_eq!(
            restore_backup(root.path(), &input).unwrap_err(),
            "license-ledger-backup-changed-after-preview"
        );
    }

    #[test]
    fn rejects_document_time_and_event_order_tampering() {
        let digest = "4".repeat(64);
        let mut ledger = new_ledger(&digest);
        append_record_event(
            &mut ledger,
            "decision",
            fixture_record(&digest, "cargo:first@1.0.0:4444", "approved"),
        )
        .unwrap();
        let mut wrong_update = ledger.clone();
        wrong_update.updated_at = "2027-01-01T00:00:00.000Z".into();
        assert_eq!(
            validate_ledger(&wrong_update, &digest).unwrap_err(),
            "license-ledger-updated-at-invalid"
        );

        let mut earlier = fixture_record(&digest, "cargo:earlier@1.0.0:4444", "approved");
        earlier.reviewed_at = "2025-09-01T00:00:00.000Z".into();
        earlier.expires_at = "2026-02-28T00:00:00.000Z".into();
        assert_eq!(
            append_record_event(&mut ledger, "decision", earlier).unwrap_err(),
            "license-ledger-event-order-invalid"
        );
    }

    #[test]
    fn rejects_a_restore_if_the_current_ledger_changes_after_preview() {
        let root = tempdir().unwrap();
        let digest = "5".repeat(64);
        let target = ledger_path(root.path(), &digest).unwrap();
        let mut current = new_ledger(&digest);
        append_record_event(
            &mut current,
            "decision",
            fixture_record(&digest, "cargo:first@1.0.0:5555", "approved"),
        )
        .unwrap();
        write_atomic(&target, &current).unwrap();

        let mut forward = current.clone();
        append_record_event(
            &mut forward,
            "decision",
            fixture_record(&digest, "cargo:backup@1.0.0:5555", "restricted"),
        )
        .unwrap();
        let source = root.path().join("forward-after-preview.mshlicense");
        write_backup_atomic(&source, &serde_json::to_vec_pretty(&forward).unwrap()).unwrap();
        let preview = preview_backup(root.path(), &digest, &source).unwrap();

        append_record_event(
            &mut current,
            "decision",
            fixture_record(&digest, "cargo:local@1.0.0:5555", "blocked"),
        )
        .unwrap();
        write_atomic(&target, &current).unwrap();
        assert_eq!(
            restore_backup(
                root.path(),
                &RestoreLicenseLedgerInput {
                    inventory_digest: digest,
                    source_path: source.to_string_lossy().into_owned(),
                    expected_backup_hash: preview.backup_last_hash,
                    expected_backup_sha256: preview.backup_sha256,
                    expected_current_hash: preview.current_last_hash,
                    confirmed: true,
                },
            )
            .unwrap_err(),
            "license-ledger-current-changed-after-preview"
        );
    }

    #[test]
    fn verifies_export_receipts_and_blocks_diverged_history() {
        let root = tempdir().unwrap();
        let digest = "6".repeat(64);
        let target = ledger_path(root.path(), &digest).unwrap();
        let mut shared = new_ledger(&digest);
        append_record_event(
            &mut shared,
            "decision",
            fixture_record(&digest, "cargo:first@1.0.0:6666", "approved"),
        )
        .unwrap();
        let mut current = shared.clone();
        append_record_event(
            &mut current,
            "decision",
            fixture_record(&digest, "cargo:local@1.0.0:6666", "restricted"),
        )
        .unwrap();
        write_atomic(&target, &current).unwrap();

        let exported = root.path().join("exported.mshlicense");
        let receipt = export_backup(root.path(), &digest, &exported).unwrap();
        let exported_preview = preview_backup(root.path(), &digest, &exported).unwrap();
        assert_eq!(receipt.sha256, exported_preview.backup_sha256);
        assert_eq!(receipt.last_hash, exported_preview.backup_last_hash);
        assert_eq!(exported_preview.relation, "identical");

        let mut diverged = shared;
        append_record_event(
            &mut diverged,
            "decision",
            fixture_record(&digest, "cargo:remote@1.0.0:6666", "blocked"),
        )
        .unwrap();
        let source = root.path().join("diverged.mshlicense");
        write_backup_atomic(&source, &serde_json::to_vec_pretty(&diverged).unwrap()).unwrap();
        let preview = preview_backup(root.path(), &digest, &source).unwrap();
        assert_eq!(preview.relation, "diverged");
        assert!(!preview.can_restore);
        assert_eq!(
            restore_backup(
                root.path(),
                &RestoreLicenseLedgerInput {
                    inventory_digest: digest,
                    source_path: source.to_string_lossy().into_owned(),
                    expected_backup_hash: preview.backup_last_hash,
                    expected_backup_sha256: preview.backup_sha256,
                    expected_current_hash: preview.current_last_hash,
                    confirmed: true,
                },
            )
            .unwrap_err(),
            "license-ledger-restore-not-forward:diverged"
        );
    }

    #[test]
    fn lists_verified_recoveries_with_bounded_current_differences() {
        let root = tempdir().unwrap();
        let digest = "7".repeat(64);
        let target = ledger_path(root.path(), &digest).unwrap();
        let mut recovery = new_ledger(&digest);
        append_record_event(
            &mut recovery,
            "decision",
            fixture_record(&digest, "cargo:shared@1.0.0:7777", "approved"),
        )
        .unwrap();
        let mut current = recovery.clone();
        append_record_event(
            &mut current,
            "decision",
            fixture_record(&digest, "cargo:current@1.0.0:7777", "restricted"),
        )
        .unwrap();
        write_atomic(&target, &current).unwrap();
        let directory = recovery_directory(root.path());
        fs::create_dir_all(&directory).unwrap();
        let file_name = recovery_filename(&digest, &recovery);
        write_atomic(&directory.join(&file_name), &recovery).unwrap();

        let listed = list_recoveries(root.path(), &digest).unwrap();
        assert_eq!(listed.total_files, 1);
        assert_eq!(listed.verified_files, 1);
        assert_eq!(listed.invalid_files, 0);
        assert_eq!(listed.entries[0].integrity, "verified");
        assert_eq!(listed.entries[0].relation, "current-ahead");
        assert_eq!(listed.entries[0].common_event_count, 1);
        assert_eq!(listed.entries[0].difference_count, 1);
        assert_eq!(listed.entries[0].differences[0].kind, "current-only");
        assert_eq!(
            listed.entries[0].differences[0].current_decision,
            "restricted"
        );
        assert!(
            listed.entries[0].differences[0]
                .recovery_decision
                .is_empty()
        );
    }

    #[test]
    fn keeps_corrupt_recoveries_visible_but_never_marks_them_verified() {
        let root = tempdir().unwrap();
        let digest = "8".repeat(64);
        let directory = recovery_directory(root.path());
        fs::create_dir_all(&directory).unwrap();
        let file_name = format!("{}-20260901T010203000Z-AAAAAAAAAAAA.json", &digest[..12]);
        fs::write(directory.join(&file_name), b"{\"tampered\":true}").unwrap();

        let listed = list_recoveries(root.path(), &digest).unwrap();
        assert_eq!(listed.total_files, 1);
        assert_eq!(listed.verified_files, 0);
        assert_eq!(listed.invalid_files, 1);
        assert_eq!(listed.entries[0].integrity, "invalid");
        assert_eq!(listed.entries[0].relation, "invalid");
        assert!(!listed.entries[0].error.is_empty());
        assert!(listed.entries[0].sha256.is_empty());
    }

    #[test]
    fn exports_only_the_exact_verified_recovery_selected_from_the_list() {
        let root = tempdir().unwrap();
        let digest = "9".repeat(64);
        let mut recovery = new_ledger(&digest);
        append_record_event(
            &mut recovery,
            "decision",
            fixture_record(&digest, "cargo:recover@1.0.0:9999", "approved"),
        )
        .unwrap();
        let directory = recovery_directory(root.path());
        fs::create_dir_all(&directory).unwrap();
        let file_name = recovery_filename(&digest, &recovery);
        let source = directory.join(&file_name);
        write_atomic(&source, &recovery).unwrap();
        let listed = list_recoveries(root.path(), &digest).unwrap();
        let entry = &listed.entries[0];
        let destination = root.path().join("selected-recovery.mshlicense");
        let input = ExportLicenseLedgerRecoveryInput {
            inventory_digest: digest.clone(),
            file_name: entry.file_name.clone(),
            expected_sha256: entry.sha256.clone(),
            expected_last_hash: entry.last_hash.clone(),
            destination_path: destination.to_string_lossy().into_owned(),
        };
        let receipt = export_recovery(root.path(), &input).unwrap();
        assert_eq!(receipt.event_count, 1);
        assert_eq!(receipt.last_hash, entry.last_hash);
        assert!(destination.is_file());
        assert_eq!(
            read_backup(&destination, &digest).unwrap().0.events.len(),
            1
        );

        fs::OpenOptions::new()
            .append(true)
            .open(&source)
            .unwrap()
            .write_all(b" \n")
            .unwrap();
        assert_eq!(
            export_recovery(root.path(), &input).unwrap_err(),
            "license-ledger-recovery-changed-after-list"
        );
        let mut traversal = input;
        traversal.file_name = "../recovery.json".into();
        assert_eq!(
            export_recovery(root.path(), &traversal).unwrap_err(),
            "license-ledger-recovery-export-input-invalid"
        );
    }

    #[test]
    fn limits_the_returned_recovery_history_without_unbounded_scanning() {
        let root = tempdir().unwrap();
        let digest = "A".repeat(64);
        let recovery = new_ledger(&digest);
        let directory = recovery_directory(root.path());
        fs::create_dir_all(&directory).unwrap();
        for index in 0..25 {
            let file_name = format!(
                "{}-20260901T{:09}Z-{}.json",
                &digest[..12],
                index,
                &last_hash(&recovery)[..12]
            );
            write_atomic(&directory.join(file_name), &recovery).unwrap();
        }
        let listed = list_recoveries(root.path(), &digest).unwrap();
        assert_eq!(listed.total_files, 25);
        assert_eq!(listed.returned_files, MAX_RECOVERY_ENTRIES);
        assert_eq!(listed.verified_files, 25);
        assert_eq!(listed.entries.len(), MAX_RECOVERY_ENTRIES);
        assert!(!listed.truncated);
    }
}
