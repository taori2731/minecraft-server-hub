use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::release_evidence;

const DOCUMENT_TYPE: &str = "minecraft-server-hub-release-approval-ledger";
const SCHEMA_VERSION: u32 = 1;
const GENESIS_HASH: &str = "0000000000000000000000000000000000000000000000000000000000000000";
const MAX_LEDGER_BYTES: u64 = 2 * 1024 * 1024;
const MAX_EVENTS: usize = 512;
const MAX_PREVIEW_AGE_SECONDS: i64 = 30 * 60;
const MAX_HISTORY: usize = 20;
static APPROVAL_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseApprovalCondition {
    id: String,
    status: String,
    actual: String,
    source: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseApprovalEvent {
    sequence: u64,
    action: String,
    project_version: String,
    evidence_payload_sha256: String,
    candidate_fingerprint: String,
    approval_digest: String,
    installer_sha256: String,
    reviewer: String,
    rationale: String,
    approved_at: String,
    warning_ids: Vec<String>,
    previous_hash: String,
    event_hash: String,
}

#[derive(Clone, Debug)]
pub(crate) struct ReleaseAuthorizationAnchor {
    pub(crate) sequence: u64,
    pub(crate) project_version: String,
    pub(crate) evidence_payload_sha256: String,
    pub(crate) candidate_fingerprint: String,
    pub(crate) approval_digest: String,
    pub(crate) installer_sha256: String,
    pub(crate) approved_at: String,
    pub(crate) warning_ids: Vec<String>,
    pub(crate) event_hash: String,
    pub(crate) ledger_event_count: usize,
    pub(crate) ledger_last_hash: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredApprovalLedger {
    document_type: String,
    schema_version: u32,
    created_at: String,
    updated_at: String,
    events: Vec<ReleaseApprovalEvent>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseApprovalHistoryEntry {
    sequence: u64,
    project_version: String,
    evidence_payload_sha256: String,
    candidate_fingerprint: String,
    approval_digest: String,
    installer_sha256: String,
    reviewer: String,
    rationale: String,
    approved_at: String,
    warning_ids: Vec<String>,
    event_hash: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseApprovalLedgerSnapshot {
    integrity: String,
    event_count: usize,
    last_hash: String,
    updated_at: String,
    history: Vec<ReleaseApprovalHistoryEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseApprovalPreview {
    generated_at: String,
    project_version: String,
    evidence_payload_sha256: String,
    candidate_fingerprint: String,
    approval_digest: String,
    installer_sha256: String,
    expected_confirmation: String,
    conditions: Vec<ReleaseApprovalCondition>,
    blocker_count: usize,
    warning_count: usize,
    can_approve: bool,
    ledger: ReleaseApprovalLedgerSnapshot,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordReleaseApprovalInput {
    workspace_root: String,
    generated_at: String,
    expected_approval_digest: String,
    confirmation_text: String,
    reviewer: String,
    rationale: String,
    warnings_confirmed: bool,
    confirmed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseApprovalReceipt {
    event: ReleaseApprovalHistoryEntry,
    ledger: ReleaseApprovalLedgerSnapshot,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EventHashPayload<'a> {
    sequence: u64,
    action: &'a str,
    project_version: &'a str,
    evidence_payload_sha256: &'a str,
    candidate_fingerprint: &'a str,
    approval_digest: &'a str,
    installer_sha256: &'a str,
    reviewer: &'a str,
    rationale: &'a str,
    approved_at: &'a str,
    warning_ids: &'a [String],
    previous_hash: &'a str,
}

fn lock_approval() -> Result<MutexGuard<'static, ()>, String> {
    APPROVAL_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "release-approval-lock-poisoned".into())
}

fn sha256_upper(bytes: &[u8]) -> String {
    hex::encode_upper(Sha256::digest(bytes))
}

pub(crate) fn fingerprint_candidate(payload: &Value) -> Result<String, String> {
    let mut stable_payload = payload.clone();
    if let Some(object) = stable_payload.as_object_mut() {
        object.remove("generatedAt");
    }
    serde_json::to_vec(&stable_payload)
        .map(|bytes| sha256_upper(&bytes))
        .map_err(|error| format!("release-approval-candidate-serialize:{error}"))
}

fn valid_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_text(value: &str, min: usize, max: usize) -> bool {
    let text = value.trim();
    let length = text.chars().count();
    (min..=max).contains(&length) && !text.chars().any(char::is_control)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn string_at(value: &Value, path: &str) -> String {
    value
        .pointer(path)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn number_at(value: &Value, path: &str) -> u64 {
    value
        .pointer(path)
        .and_then(Value::as_u64)
        .unwrap_or_default()
}

fn bool_at(value: &Value, path: &str) -> bool {
    value
        .pointer(path)
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn check_status(payload: &Value, id: &str) -> String {
    payload
        .pointer("/inspection/checks")
        .and_then(Value::as_array)
        .and_then(|checks| checks.iter().find(|check| string_at(check, "/id") == id))
        .map(|check| string_at(check, "/status"))
        .unwrap_or_else(|| "missing".into())
}

fn condition(
    id: &str,
    status: &str,
    actual: impl Into<String>,
    source: &str,
) -> ReleaseApprovalCondition {
    ReleaseApprovalCondition {
        id: id.into(),
        status: status.into(),
        actual: actual.into(),
        source: source.into(),
    }
}

fn required_check(payload: &Value, id: &str, source: &str) -> ReleaseApprovalCondition {
    let actual = check_status(payload, id);
    condition(
        id,
        if actual == "pass" { "pass" } else { "fail" },
        actual,
        source,
    )
}

fn review_check(payload: &Value, id: &str, source: &str) -> ReleaseApprovalCondition {
    let actual = check_status(payload, id);
    let status = match actual.as_str() {
        "pass" => "pass",
        "warning" => "warning",
        _ => "fail",
    };
    condition(id, status, actual, source)
}

fn approval_conditions(
    payload: &Value,
    evidence_payload_sha256: &str,
) -> Vec<ReleaseApprovalCondition> {
    let quality_status = string_at(payload, "/inspection/quality/status");
    let source_stable = bool_at(payload, "/inspection/quality/sourceStable");
    let total_stages = number_at(payload, "/inspection/quality/summary/totalStages");
    let passed_stages = number_at(payload, "/inspection/quality/summary/passedStages");
    let failed_stages = number_at(payload, "/inspection/quality/summary/failedStages");
    let total_tests = number_at(payload, "/inspection/quality/summary/totalTests");
    let passed_tests = number_at(payload, "/inspection/quality/summary/passedTests");
    let failed_tests = number_at(payload, "/inspection/quality/summary/failedTests");
    let skipped_tests = number_at(payload, "/inspection/quality/summary/skippedTests");
    let coverage_gaps = payload
        .pointer("/inspection/quality/coverageViolations")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(usize::MAX);
    let bundle_status = string_at(payload, "/inspection/bundle/status");
    let bundle_gaps = payload
        .pointer("/inspection/bundle/violations")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or(usize::MAX);
    let installer_size = number_at(payload, "/inspection/release/installerSizeBytes");
    let installer_sha256 = string_at(payload, "/inspection/release/installerSha256");
    let license_mismatch = number_at(payload, "/licenseEvidence/summary/mismatch");
    let actionable_gaps = number_at(
        payload,
        "/licenseEvidence/summary/applicability/actionableGaps",
    );
    let ledger_integrity = string_at(payload, "/licenseLedger/integrity");
    let ledger_blocked = number_at(payload, "/licenseLedger/decisions/blocked");

    vec![
        required_check(payload, "versionConsistency", "inspection"),
        required_check(payload, "publicKeyMatches", "inspection"),
        required_check(payload, "manifestVersion", "inspection"),
        condition(
            "artifactPresent",
            if check_status(payload, "installerPresent") == "pass" && installer_size > 0 {
                "pass"
            } else {
                "fail"
            },
            installer_size.to_string(),
            "release",
        ),
        condition(
            "artifactSha256",
            if valid_digest(&installer_sha256)
                && check_status(payload, "sha256Calculated") == "pass"
            {
                "pass"
            } else {
                "fail"
            },
            installer_sha256,
            "release",
        ),
        condition(
            "artifactSignature",
            if [
                "signaturePresent",
                "signatureMatchesManifest",
                "cryptographicSignature",
            ]
            .iter()
            .all(|id| check_status(payload, id) == "pass")
            {
                "pass"
            } else {
                "fail"
            },
            format!(
                "{}/{}/{}",
                check_status(payload, "signaturePresent"),
                check_status(payload, "signatureMatchesManifest"),
                check_status(payload, "cryptographicSignature")
            ),
            "release",
        ),
        required_check(payload, "artifactHistoryIntegrity", "releaseHistory"),
        required_check(payload, "dependencyLockfiles", "dependencies"),
        required_check(payload, "dependencyIntegrity", "dependencies"),
        condition(
            "bundleCurrent",
            if bundle_status == "current"
                && bundle_gaps == 0
                && check_status(payload, "bundlePerformance") == "pass"
            {
                "pass"
            } else {
                "fail"
            },
            format!("{bundle_status}:{bundle_gaps}"),
            "bundle",
        ),
        condition(
            "qualityCurrent",
            if quality_status == "current"
                && source_stable
                && check_status(payload, "qualityEvidence") == "pass"
            {
                "pass"
            } else {
                "fail"
            },
            format!("{quality_status}:{source_stable}"),
            "quality",
        ),
        condition(
            "qualityStages",
            if total_stages > 0 && total_stages == passed_stages && failed_stages == 0 {
                "pass"
            } else {
                "fail"
            },
            format!("{passed_stages}/{total_stages}/{failed_stages}"),
            "quality",
        ),
        condition(
            "qualityTests",
            if total_tests > 0
                && total_tests == passed_tests
                && failed_tests == 0
                && skipped_tests == 0
            {
                "pass"
            } else {
                "fail"
            },
            format!("{passed_tests}/{total_tests}/{failed_tests}/{skipped_tests}"),
            "quality",
        ),
        condition(
            "coverageThresholds",
            if coverage_gaps == 0 { "pass" } else { "fail" },
            coverage_gaps.to_string(),
            "quality",
        ),
        condition(
            "licenseMismatch",
            if license_mismatch == 0 {
                "pass"
            } else {
                "fail"
            },
            license_mismatch.to_string(),
            "licenseEvidence",
        ),
        condition(
            "licenseCoverage",
            if actionable_gaps == 0 {
                "pass"
            } else {
                "warning"
            },
            actionable_gaps.to_string(),
            "licenseEvidence",
        ),
        condition(
            "licenseLedger",
            if ledger_integrity == "verified" {
                "pass"
            } else {
                "fail"
            },
            ledger_integrity,
            "licenseLedger",
        ),
        condition(
            "blockedLicenseDecisions",
            if ledger_blocked == 0 { "pass" } else { "fail" },
            ledger_blocked.to_string(),
            "licenseLedger",
        ),
        review_check(payload, "dependencyLicenseMetadata", "dependencies"),
        review_check(payload, "dependencyReciprocalLicenses", "dependencies"),
        review_check(payload, "dependencyAdvisories", "dependencies"),
        condition(
            "evidenceIntegrity",
            if valid_digest(evidence_payload_sha256) {
                "pass"
            } else {
                "fail"
            },
            evidence_payload_sha256.to_owned(),
            "releaseEvidence",
        ),
    ]
}

fn approval_digest(
    generated_at: &str,
    project_version: &str,
    evidence_payload_sha256: &str,
    candidate_fingerprint: &str,
    installer_sha256: &str,
    conditions: &[ReleaseApprovalCondition],
) -> Result<String, String> {
    let payload = json!({
        "generatedAt": generated_at,
        "projectVersion": project_version,
        "evidencePayloadSha256": evidence_payload_sha256,
        "candidateFingerprint": candidate_fingerprint,
        "installerSha256": installer_sha256,
        "conditions": conditions
    });
    serde_json::to_vec(&payload)
        .map(|bytes| sha256_upper(&bytes))
        .map_err(|error| format!("release-approval-digest-serialize:{error}"))
}

fn event_hash(event: &ReleaseApprovalEvent) -> Result<String, String> {
    let payload = EventHashPayload {
        sequence: event.sequence,
        action: &event.action,
        project_version: &event.project_version,
        evidence_payload_sha256: &event.evidence_payload_sha256,
        candidate_fingerprint: &event.candidate_fingerprint,
        approval_digest: &event.approval_digest,
        installer_sha256: &event.installer_sha256,
        reviewer: &event.reviewer,
        rationale: &event.rationale,
        approved_at: &event.approved_at,
        warning_ids: &event.warning_ids,
        previous_hash: &event.previous_hash,
    };
    serde_json::to_vec(&payload)
        .map(|bytes| sha256_upper(&bytes))
        .map_err(|error| format!("release-approval-event-serialize:{error}"))
}

fn validate_event(event: &ReleaseApprovalEvent) -> Result<(), String> {
    if event.action != "approved"
        || !valid_text(&event.project_version, 1, 64)
        || !valid_digest(&event.evidence_payload_sha256)
        || !valid_digest(&event.candidate_fingerprint)
        || !valid_digest(&event.approval_digest)
        || !valid_digest(&event.installer_sha256)
        || !valid_text(&event.reviewer, 2, 80)
        || !valid_text(&event.rationale, 8, 2_000)
        || DateTime::parse_from_rfc3339(&event.approved_at).is_err()
        || !valid_digest(&event.previous_hash)
        || !valid_digest(&event.event_hash)
        || event.warning_ids.len() > 64
        || event.warning_ids.iter().any(|id| !valid_id(id))
    {
        return Err("release-approval-event-invalid".into());
    }
    Ok(())
}

fn validate_ledger(ledger: &StoredApprovalLedger) -> Result<(), String> {
    if ledger.document_type != DOCUMENT_TYPE
        || ledger.schema_version != SCHEMA_VERSION
        || ledger.events.len() > MAX_EVENTS
    {
        return Err("release-approval-ledger-invalid".into());
    }
    let created_at = DateTime::parse_from_rfc3339(&ledger.created_at)
        .map_err(|_| "release-approval-ledger-time-invalid")?;
    let mut previous_time = created_at;
    let mut previous_hash = GENESIS_HASH.to_owned();
    for (index, event) in ledger.events.iter().enumerate() {
        validate_event(event)?;
        let occurred_at = DateTime::parse_from_rfc3339(&event.approved_at)
            .map_err(|_| "release-approval-event-time-invalid")?;
        if event.sequence != index as u64 + 1 || event.previous_hash != previous_hash {
            return Err("release-approval-chain-invalid".into());
        }
        if occurred_at < previous_time || event.event_hash != event_hash(event)? {
            return Err("release-approval-hash-invalid".into());
        }
        previous_hash = event.event_hash.clone();
        previous_time = occurred_at;
    }
    let expected_updated = ledger
        .events
        .last()
        .map(|event| event.approved_at.as_str())
        .unwrap_or(ledger.created_at.as_str());
    if ledger.updated_at != expected_updated {
        return Err("release-approval-updated-at-invalid".into());
    }
    Ok(())
}

fn new_ledger(now: &str) -> StoredApprovalLedger {
    StoredApprovalLedger {
        document_type: DOCUMENT_TYPE.into(),
        schema_version: SCHEMA_VERSION,
        created_at: now.into(),
        updated_at: now.into(),
        events: Vec::new(),
    }
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err("release-approval-symlink-rejected".into());
    }
    Ok(())
}

fn ledger_path(root: &Path) -> PathBuf {
    root.join("release-approvals").join("ledger-v1.json")
}

fn read_ledger(path: &Path, now: &str) -> Result<StoredApprovalLedger, String> {
    if !path.exists() {
        return Ok(new_ledger(now));
    }
    reject_symlink(path)?;
    let metadata =
        fs::metadata(path).map_err(|error| format!("release-approval-ledger-metadata:{error}"))?;
    if !metadata.is_file() || metadata.len() > MAX_LEDGER_BYTES {
        return Err("release-approval-ledger-size-invalid".into());
    }
    let bytes = fs::read(path).map_err(|error| format!("release-approval-ledger-read:{error}"))?;
    let ledger: StoredApprovalLedger = serde_json::from_slice(&bytes)
        .map_err(|error| format!("release-approval-ledger-json:{error}"))?;
    validate_ledger(&ledger)?;
    Ok(ledger)
}

fn write_atomic(path: &Path, ledger: &StoredApprovalLedger) -> Result<(), String> {
    validate_ledger(ledger)?;
    let parent = path
        .parent()
        .ok_or("release-approval-ledger-path-invalid")?;
    fs::create_dir_all(parent).map_err(|error| format!("release-approval-ledger-dir:{error}"))?;
    reject_symlink(parent)?;
    reject_symlink(path)?;
    let bytes = serde_json::to_vec_pretty(ledger)
        .map_err(|error| format!("release-approval-ledger-serialize:{error}"))?;
    if bytes.len() as u64 > MAX_LEDGER_BYTES {
        return Err("release-approval-ledger-size-invalid".into());
    }
    let temporary = path.with_extension(format!("json.{}.tmp", std::process::id()));
    let backup = path.with_extension("json.bak");
    if temporary.exists() {
        reject_symlink(&temporary)?;
        fs::remove_file(&temporary)
            .map_err(|error| format!("release-approval-temp-cleanup:{error}"))?;
    }
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| format!("release-approval-temp-create:{error}"))?;
    output
        .write_all(&bytes)
        .and_then(|_| output.write_all(b"\n"))
        .and_then(|_| output.sync_all())
        .map_err(|error| format!("release-approval-temp-write:{error}"))?;
    if path.exists() {
        reject_symlink(&backup)?;
        fs::copy(path, &backup).map_err(|error| format!("release-approval-backup:{error}"))?;
        fs::remove_file(path)
            .map_err(|error| format!("release-approval-replace-remove:{error}"))?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if backup.is_file() {
            let _ = fs::copy(&backup, path);
        }
        let _ = fs::remove_file(&temporary);
        return Err(format!("release-approval-replace:{error}"));
    }
    Ok(())
}

fn history_entry(event: &ReleaseApprovalEvent) -> ReleaseApprovalHistoryEntry {
    ReleaseApprovalHistoryEntry {
        sequence: event.sequence,
        project_version: event.project_version.clone(),
        evidence_payload_sha256: event.evidence_payload_sha256.clone(),
        candidate_fingerprint: event.candidate_fingerprint.clone(),
        approval_digest: event.approval_digest.clone(),
        installer_sha256: event.installer_sha256.clone(),
        reviewer: event.reviewer.clone(),
        rationale: event.rationale.clone(),
        approved_at: event.approved_at.clone(),
        warning_ids: event.warning_ids.clone(),
        event_hash: event.event_hash.clone(),
    }
}

fn snapshot(ledger: &StoredApprovalLedger) -> ReleaseApprovalLedgerSnapshot {
    ReleaseApprovalLedgerSnapshot {
        integrity: "verified".into(),
        event_count: ledger.events.len(),
        last_hash: ledger
            .events
            .last()
            .map(|event| event.event_hash.clone())
            .unwrap_or_else(|| GENESIS_HASH.into()),
        updated_at: ledger.updated_at.clone(),
        history: ledger
            .events
            .iter()
            .rev()
            .take(MAX_HISTORY)
            .map(history_entry)
            .collect(),
    }
}

pub(crate) fn authorization_for_candidate(
    app: &AppHandle,
    candidate_fingerprint: &str,
) -> Result<Option<ReleaseAuthorizationAnchor>, String> {
    if !valid_digest(candidate_fingerprint) {
        return Err("release-approval-candidate-invalid".into());
    }
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let root = app_data_root(app)?;
    let _guard = lock_approval()?;
    let ledger = read_ledger(&ledger_path(&root), &now)?;
    let event = match ledger
        .events
        .iter()
        .find(|event| event.candidate_fingerprint == candidate_fingerprint)
    {
        Some(event) => event,
        None => return Ok(None),
    };
    Ok(Some(ReleaseAuthorizationAnchor {
        sequence: event.sequence,
        project_version: event.project_version.clone(),
        evidence_payload_sha256: event.evidence_payload_sha256.clone(),
        candidate_fingerprint: event.candidate_fingerprint.clone(),
        approval_digest: event.approval_digest.clone(),
        installer_sha256: event.installer_sha256.clone(),
        approved_at: event.approved_at.clone(),
        warning_ids: event.warning_ids.clone(),
        event_hash: event.event_hash.clone(),
        ledger_event_count: ledger.events.len(),
        ledger_last_hash: ledger
            .events
            .last()
            .map(|item| item.event_hash.clone())
            .unwrap_or_else(|| GENESIS_HASH.into()),
    }))
}

fn preview_from_payload(
    generated_at: &str,
    payload: &Value,
    evidence_payload_sha256: &str,
    ledger: &StoredApprovalLedger,
) -> Result<ReleaseApprovalPreview, String> {
    let project_version = string_at(payload, "/projectVersion");
    let installer_sha256 = string_at(payload, "/inspection/release/installerSha256");
    let candidate_fingerprint = fingerprint_candidate(payload)?;
    let conditions = approval_conditions(payload, evidence_payload_sha256);
    let blocker_count = conditions
        .iter()
        .filter(|item| item.status == "fail")
        .count();
    let warning_count = conditions
        .iter()
        .filter(|item| item.status == "warning")
        .count();
    let approval_digest = approval_digest(
        generated_at,
        &project_version,
        evidence_payload_sha256,
        &candidate_fingerprint,
        &installer_sha256,
        &conditions,
    )?;
    Ok(ReleaseApprovalPreview {
        generated_at: generated_at.into(),
        expected_confirmation: format!("APPROVE {project_version}"),
        project_version,
        evidence_payload_sha256: evidence_payload_sha256.into(),
        candidate_fingerprint,
        approval_digest,
        installer_sha256,
        conditions,
        blocker_count,
        warning_count,
        can_approve: blocker_count == 0,
        ledger: snapshot(ledger),
    })
}

fn ensure_preview_fresh(value: &str) -> Result<(), String> {
    let timestamp = DateTime::parse_from_rfc3339(value)
        .map_err(|_| "release-approval-preview-time-invalid")?
        .with_timezone(&Utc);
    let age = Utc::now().signed_duration_since(timestamp).num_seconds();
    if !(0..=MAX_PREVIEW_AGE_SECONDS).contains(&age) {
        return Err("release-approval-preview-expired".into());
    }
    Ok(())
}

fn app_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("release-approval-app-data:{error}"))?;
    fs::create_dir_all(&root).map_err(|error| format!("release-approval-app-data-dir:{error}"))?;
    reject_symlink(&root)?;
    Ok(root)
}

async fn build_preview(
    app: AppHandle,
    workspace_root: String,
    generated_at: String,
) -> Result<ReleaseApprovalPreview, String> {
    let (pack, _) =
        release_evidence::build_current_pack(app.clone(), workspace_root, generated_at.clone())
            .await?;
    let (payload, evidence_payload_sha256) = release_evidence::verify_pack_value(&pack)?;
    let root = app_data_root(&app)?;
    let ledger = read_ledger(&ledger_path(&root), &generated_at)?;
    preview_from_payload(&generated_at, payload, &evidence_payload_sha256, &ledger)
}

fn append_approval(
    path: &Path,
    preview: &ReleaseApprovalPreview,
    reviewer: &str,
    rationale: &str,
    approved_at: &str,
) -> Result<ReleaseApprovalReceipt, String> {
    let mut ledger = read_ledger(path, approved_at)?;
    if ledger.events.len() >= MAX_EVENTS {
        return Err("release-approval-ledger-full".into());
    }
    if ledger.events.iter().any(|event| {
        event.project_version == preview.project_version
            && event.candidate_fingerprint == preview.candidate_fingerprint
    }) {
        return Err("release-approval-already-recorded".into());
    }
    let warning_ids = preview
        .conditions
        .iter()
        .filter(|item| item.status == "warning")
        .map(|item| item.id.clone())
        .collect::<Vec<_>>();
    let mut event = ReleaseApprovalEvent {
        sequence: ledger.events.len() as u64 + 1,
        action: "approved".into(),
        project_version: preview.project_version.clone(),
        evidence_payload_sha256: preview.evidence_payload_sha256.clone(),
        candidate_fingerprint: preview.candidate_fingerprint.clone(),
        approval_digest: preview.approval_digest.clone(),
        installer_sha256: preview.installer_sha256.clone(),
        reviewer: reviewer.trim().into(),
        rationale: rationale.trim().into(),
        approved_at: approved_at.into(),
        warning_ids,
        previous_hash: ledger
            .events
            .last()
            .map(|item| item.event_hash.clone())
            .unwrap_or_else(|| GENESIS_HASH.into()),
        event_hash: String::new(),
    };
    validate_event(&ReleaseApprovalEvent {
        event_hash: "A".repeat(64),
        ..event.clone()
    })?;
    event.event_hash = event_hash(&event)?;
    ledger.updated_at = approved_at.into();
    ledger.events.push(event.clone());
    write_atomic(path, &ledger)?;
    let readback = read_ledger(path, approved_at)?;
    if readback.events.last().map(|item| item.event_hash.as_str())
        != Some(event.event_hash.as_str())
    {
        return Err("release-approval-readback-mismatch".into());
    }
    Ok(ReleaseApprovalReceipt {
        event: history_entry(&event),
        ledger: snapshot(&readback),
    })
}

#[tauri::command]
pub async fn preview_release_approval(
    app: AppHandle,
    workspace_root: String,
) -> Result<ReleaseApprovalPreview, String> {
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    build_preview(app, workspace_root, generated_at).await
}

#[tauri::command]
pub async fn record_release_approval(
    app: AppHandle,
    input: RecordReleaseApprovalInput,
) -> Result<ReleaseApprovalReceipt, String> {
    if !input.confirmed {
        return Err("release-approval-confirmation-required".into());
    }
    if !valid_text(&input.reviewer, 2, 80) || !valid_text(&input.rationale, 8, 2_000) {
        return Err("release-approval-review-invalid".into());
    }
    ensure_preview_fresh(&input.generated_at)?;
    let preview = build_preview(app.clone(), input.workspace_root, input.generated_at).await?;
    if !preview.can_approve {
        return Err("release-approval-blocked".into());
    }
    if preview.approval_digest != input.expected_approval_digest.trim().to_ascii_uppercase() {
        return Err("release-approval-preview-stale".into());
    }
    if input.confirmation_text.trim() != preview.expected_confirmation {
        return Err("release-approval-phrase-invalid".into());
    }
    if preview.warning_count > 0 && !input.warnings_confirmed {
        return Err("release-approval-warnings-unconfirmed".into());
    }
    let approved_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let root = app_data_root(&app)?;
    let _guard = lock_approval()?;
    append_approval(
        &ledger_path(&root),
        &preview,
        &input.reviewer,
        &input.rationale,
        &approved_at,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_payload() -> Value {
        let passing = [
            "versionConsistency",
            "publicKeyMatches",
            "manifestVersion",
            "installerPresent",
            "sha256Calculated",
            "signaturePresent",
            "signatureMatchesManifest",
            "cryptographicSignature",
            "artifactHistoryIntegrity",
            "dependencyLockfiles",
            "dependencyIntegrity",
            "bundlePerformance",
            "qualityEvidence",
        ];
        let mut checks = passing
            .iter()
            .map(|id| json!({"id":id,"status":"pass"}))
            .collect::<Vec<_>>();
        checks.extend([
            json!({"id":"dependencyLicenseMetadata","status":"warning"}),
            json!({"id":"dependencyReciprocalLicenses","status":"pass"}),
            json!({"id":"dependencyAdvisories","status":"warning"}),
        ]);
        json!({
            "projectVersion":"0.3.2",
            "inspection":{
                "release":{"installerSizeBytes":1234,"installerSha256":"A".repeat(64)},
                "bundle":{"status":"current","violations":[]},
                "quality":{"status":"current","sourceStable":true,"summary":{"totalStages":7,"passedStages":7,"failedStages":0,"totalTests":293,"passedTests":293,"failedTests":0,"skippedTests":0},"coverageViolations":[]},
                "checks":checks
            },
            "licenseEvidence":{"summary":{"mismatch":0,"applicability":{"actionableGaps":2}}},
            "licenseLedger":{"integrity":"verified","decisions":{"blocked":0}}
        })
    }

    fn ready_preview(ledger: &StoredApprovalLedger) -> ReleaseApprovalPreview {
        preview_from_payload(
            "2026-09-01T00:00:00Z",
            &fixture_payload(),
            &"B".repeat(64),
            ledger,
        )
        .unwrap()
    }

    #[test]
    fn ready_candidate_preserves_non_blocking_warnings() {
        let ledger = new_ledger("2026-09-01T00:00:00Z");
        let preview = ready_preview(&ledger);
        assert!(preview.can_approve);
        assert_eq!(preview.blocker_count, 0);
        assert_eq!(preview.warning_count, 3);
        assert_eq!(preview.expected_confirmation, "APPROVE 0.3.2");
        assert!(valid_digest(&preview.approval_digest));
    }

    #[test]
    fn failed_tests_license_mismatch_and_blocked_decision_stop_approval() {
        let mut payload = fixture_payload();
        payload["inspection"]["quality"]["summary"]["failedTests"] = json!(1);
        payload["licenseEvidence"]["summary"]["mismatch"] = json!(1);
        payload["licenseLedger"]["decisions"]["blocked"] = json!(1);
        let ledger = new_ledger("2026-09-01T00:00:00Z");
        let preview =
            preview_from_payload("2026-09-01T00:00:00Z", &payload, &"B".repeat(64), &ledger)
                .unwrap();
        assert!(!preview.can_approve);
        assert_eq!(preview.blocker_count, 3);
    }

    #[test]
    fn approval_ledger_is_hash_chained_and_rejects_duplicates() {
        let directory = tempfile::tempdir().unwrap();
        let path = ledger_path(directory.path());
        let preview = ready_preview(&new_ledger("2026-09-01T00:00:00Z"));
        let receipt = append_approval(
            &path,
            &preview,
            "Release Owner",
            "All blocking gates and warnings were reviewed.",
            "2026-09-01T00:01:00Z",
        )
        .unwrap();
        assert_eq!(receipt.ledger.event_count, 1);
        assert!(valid_digest(&receipt.event.event_hash));
        assert_eq!(
            append_approval(
                &path,
                &preview,
                "Release Owner",
                "All blocking gates and warnings were reviewed.",
                "2026-09-01T00:02:00Z",
            )
            .unwrap_err(),
            "release-approval-already-recorded"
        );
    }

    #[test]
    fn tampered_approval_history_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let path = ledger_path(directory.path());
        let preview = ready_preview(&new_ledger("2026-09-01T00:00:00Z"));
        append_approval(
            &path,
            &preview,
            "Release Owner",
            "All blocking gates and warnings were reviewed.",
            "2026-09-01T00:01:00Z",
        )
        .unwrap();
        let mut ledger: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        ledger["events"][0]["rationale"] = json!("tampered rationale");
        fs::write(&path, serde_json::to_vec(&ledger).unwrap()).unwrap();
        assert!(read_ledger(&path, "2026-09-01T00:02:00Z").is_err());
    }

    #[test]
    fn approval_digest_changes_with_any_gate_result() {
        let ledger = new_ledger("2026-09-01T00:00:00Z");
        let first = ready_preview(&ledger);
        let mut payload = fixture_payload();
        payload["licenseEvidence"]["summary"]["applicability"]["actionableGaps"] = json!(3);
        let second =
            preview_from_payload("2026-09-01T00:00:00Z", &payload, &"B".repeat(64), &ledger)
                .unwrap();
        assert_ne!(first.approval_digest, second.approval_digest);
    }

    #[test]
    fn candidate_fingerprint_ignores_only_the_generation_time() {
        let ledger = new_ledger("2026-09-01T00:00:00Z");
        let first = preview_from_payload(
            "2026-09-01T00:00:00Z",
            &fixture_payload(),
            &"B".repeat(64),
            &ledger,
        )
        .unwrap();
        let second = preview_from_payload(
            "2026-09-01T00:10:00Z",
            &fixture_payload(),
            &"C".repeat(64),
            &ledger,
        )
        .unwrap();
        assert_eq!(first.candidate_fingerprint, second.candidate_fingerprint);
        assert_ne!(first.approval_digest, second.approval_digest);
    }
}
