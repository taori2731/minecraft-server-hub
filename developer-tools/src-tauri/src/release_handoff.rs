use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::{release_approval, release_evidence};

const DOCUMENT_TYPE: &str = "minecraft-server-hub-release-handoff-pack";
const SCHEMA_VERSION: u32 = 1;
const MAX_PACK_BYTES: u64 = 20 * 1024 * 1024;
const MAX_PREVIEW_AGE_SECONDS: i64 = 30 * 60;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseHandoffPreview {
    generated_at: String,
    status: String,
    project_version: String,
    candidate_fingerprint: String,
    evidence_payload_sha256: String,
    installer_sha256: String,
    approval_sequence: u64,
    approval_event_hash: String,
    approved_at: String,
    warning_ids: Vec<String>,
    ledger_event_count: usize,
    ledger_last_hash: String,
    payload_sha256: String,
    size_bytes: u64,
    contains_personal_data: bool,
    can_export: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReleaseHandoffInput {
    workspace_root: String,
    generated_at: String,
    expected_payload_sha256: String,
    destination_path: String,
    confirmed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseHandoffExportReceipt {
    path: String,
    generated_at: String,
    project_version: String,
    candidate_fingerprint: String,
    approval_event_hash: String,
    payload_sha256: String,
    file_sha256: String,
    size_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseHandoffVerification {
    integrity: String,
    error: String,
    generated_at: String,
    project_version: String,
    candidate_fingerprint: String,
    approval_event_hash: String,
    payload_sha256: String,
    file_sha256: String,
    size_bytes: u64,
    contains_personal_data: bool,
    matches_current_candidate: bool,
    matches_current_approval: bool,
    expected_digest_status: String,
    origin_assurance: String,
    warnings: Vec<String>,
}

fn sha256_upper(bytes: &[u8]) -> String {
    hex::encode_upper(Sha256::digest(bytes))
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

fn valid_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn compare_expected_digest(expected: &str, actual: &str) -> Result<(String, String), String> {
    let normalized = expected.trim().to_ascii_uppercase();
    if normalized.is_empty() {
        return Ok(("notProvided".into(), "notEstablished".into()));
    }
    if !valid_digest(&normalized) {
        return Err("release-handoff-expected-digest-invalid".into());
    }
    if normalized == actual {
        Ok(("matches".into(), "trustedDigestMatch".into()))
    } else {
        Ok(("differs".into(), "digestMismatch".into()))
    }
}

fn looks_like_absolute_path(value: &str) -> bool {
    let bytes = value.as_bytes();
    (bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'\\' | b'/'))
        || value.starts_with("\\\\")
        || value.starts_with("//")
}

fn validate_privacy(value: &Value) -> Result<(), String> {
    const FORBIDDEN_KEYS: &[&str] = &[
        "reviewer",
        "rationale",
        "workspaceRoot",
        "command",
        "outputTail",
        "storage",
        "technicalDetail",
    ];
    match value {
        Value::Object(map) => {
            for (key, item) in map {
                if FORBIDDEN_KEYS.contains(&key.as_str()) {
                    return Err(format!("release-handoff-private-key:{key}"));
                }
                validate_privacy(item)?;
            }
        }
        Value::Array(items) => {
            for item in items {
                validate_privacy(item)?;
            }
        }
        Value::String(text) if looks_like_absolute_path(text) => {
            return Err("release-handoff-absolute-path".into());
        }
        _ => {}
    }
    Ok(())
}

fn build_pack(
    generated_at: &str,
    release_evidence_pack: &Value,
    anchor: &release_approval::ReleaseAuthorizationAnchor,
) -> Result<Value, String> {
    DateTime::parse_from_rfc3339(generated_at)
        .map_err(|_| "release-handoff-generated-at-invalid")?;
    let (evidence_payload, current_evidence_sha256) =
        release_evidence::verify_pack_value(release_evidence_pack)?;
    let candidate_fingerprint = release_approval::fingerprint_candidate(evidence_payload)?;
    let project_version = string_at(evidence_payload, "/projectVersion");
    let installer_sha256 = string_at(evidence_payload, "/inspection/release/installerSha256");
    if candidate_fingerprint != anchor.candidate_fingerprint
        || project_version != anchor.project_version
        || installer_sha256 != anchor.installer_sha256
    {
        return Err("release-handoff-approval-stale".into());
    }
    let payload = json!({
        "generatedAt": generated_at,
        "projectVersion": project_version,
        "candidateFingerprint": candidate_fingerprint,
        "evidencePayloadSha256": current_evidence_sha256,
        "originalApprovedEvidenceSha256": anchor.evidence_payload_sha256,
        "installerSha256": installer_sha256,
        "releaseEvidence": release_evidence_pack,
        "authorization": {
            "sequence": anchor.sequence,
            "approvalDigest": anchor.approval_digest,
            "approvedAt": anchor.approved_at,
            "warningIds": anchor.warning_ids,
            "eventHash": anchor.event_hash
        },
        "ledger": {
            "integrity": "verified",
            "eventCount": anchor.ledger_event_count,
            "lastHash": anchor.ledger_last_hash
        },
        "privacy": {
            "containsReviewer": false,
            "containsRationale": false,
            "containsAbsolutePaths": false
        },
        "capabilities": {
            "build": false,
            "sign": false,
            "upload": false,
            "publish": false
        }
    });
    validate_privacy(&payload)?;
    let payload_sha256 = sha256_upper(
        &serde_json::to_vec(&payload)
            .map_err(|error| format!("release-handoff-payload-serialize:{error}"))?,
    );
    Ok(json!({
        "documentType": DOCUMENT_TYPE,
        "schemaVersion": SCHEMA_VERSION,
        "payload": payload,
        "payloadSha256": payload_sha256
    }))
}

fn pack_bytes(pack: &Value) -> Result<Vec<u8>, String> {
    let mut bytes = serde_json::to_vec_pretty(pack)
        .map_err(|error| format!("release-handoff-serialize:{error}"))?;
    bytes.push(b'\n');
    if bytes.len() as u64 > MAX_PACK_BYTES {
        return Err("release-handoff-too-large".into());
    }
    Ok(bytes)
}

fn verify_pack_value(pack: &Value) -> Result<(&Value, String), String> {
    if string_at(pack, "/documentType") != DOCUMENT_TYPE
        || number_at(pack, "/schemaVersion") != SCHEMA_VERSION as u64
    {
        return Err("release-handoff-document-invalid".into());
    }
    let payload = pack
        .get("payload")
        .ok_or("release-handoff-payload-missing")?;
    validate_privacy(payload)?;
    let expected = string_at(pack, "/payloadSha256").to_ascii_uppercase();
    if !valid_digest(&expected) {
        return Err("release-handoff-digest-invalid".into());
    }
    let actual = sha256_upper(
        &serde_json::to_vec(payload)
            .map_err(|error| format!("release-handoff-payload-serialize:{error}"))?,
    );
    if expected != actual {
        return Err("release-handoff-digest-mismatch".into());
    }
    let evidence = payload
        .get("releaseEvidence")
        .ok_or("release-handoff-evidence-missing")?;
    let (evidence_payload, evidence_sha256) = release_evidence::verify_pack_value(evidence)?;
    if evidence_sha256 != string_at(payload, "/evidencePayloadSha256")
        || release_approval::fingerprint_candidate(evidence_payload)?
            != string_at(payload, "/candidateFingerprint")
        || string_at(evidence_payload, "/projectVersion") != string_at(payload, "/projectVersion")
        || string_at(evidence_payload, "/inspection/release/installerSha256")
            != string_at(payload, "/installerSha256")
        || string_at(payload, "/ledger/integrity") != "verified"
        || !valid_digest(&string_at(payload, "/authorization/approvalDigest"))
        || !valid_digest(&string_at(payload, "/authorization/eventHash"))
        || !valid_digest(&string_at(payload, "/ledger/lastHash"))
    {
        return Err("release-handoff-anchor-invalid".into());
    }
    Ok((payload, actual))
}

fn missing_preview(
    generated_at: &str,
    project_version: String,
    candidate: String,
) -> ReleaseHandoffPreview {
    ReleaseHandoffPreview {
        generated_at: generated_at.into(),
        status: "approvalRequired".into(),
        project_version,
        candidate_fingerprint: candidate,
        evidence_payload_sha256: String::new(),
        installer_sha256: String::new(),
        approval_sequence: 0,
        approval_event_hash: String::new(),
        approved_at: String::new(),
        warning_ids: Vec::new(),
        ledger_event_count: 0,
        ledger_last_hash: String::new(),
        payload_sha256: String::new(),
        size_bytes: 0,
        contains_personal_data: false,
        can_export: false,
    }
}

fn preview_from_pack(pack: &Value) -> Result<ReleaseHandoffPreview, String> {
    let (payload, payload_sha256) = verify_pack_value(pack)?;
    let bytes = pack_bytes(pack)?;
    Ok(ReleaseHandoffPreview {
        generated_at: string_at(payload, "/generatedAt"),
        status: "ready".into(),
        project_version: string_at(payload, "/projectVersion"),
        candidate_fingerprint: string_at(payload, "/candidateFingerprint"),
        evidence_payload_sha256: string_at(payload, "/evidencePayloadSha256"),
        installer_sha256: string_at(payload, "/installerSha256"),
        approval_sequence: number_at(payload, "/authorization/sequence"),
        approval_event_hash: string_at(payload, "/authorization/eventHash"),
        approved_at: string_at(payload, "/authorization/approvedAt"),
        warning_ids: payload
            .pointer("/authorization/warningIds")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        ledger_event_count: number_at(payload, "/ledger/eventCount") as usize,
        ledger_last_hash: string_at(payload, "/ledger/lastHash"),
        payload_sha256,
        size_bytes: bytes.len() as u64,
        contains_personal_data: false,
        can_export: true,
    })
}

async fn build_current(
    app: AppHandle,
    workspace_root: String,
    generated_at: String,
) -> Result<(ReleaseHandoffPreview, Option<Value>), String> {
    let (evidence_pack, _) =
        release_evidence::build_current_pack(app.clone(), workspace_root, generated_at.clone())
            .await?;
    let (evidence_payload, _) = release_evidence::verify_pack_value(&evidence_pack)?;
    let candidate = release_approval::fingerprint_candidate(evidence_payload)?;
    let project_version = string_at(evidence_payload, "/projectVersion");
    let Some(anchor) = release_approval::authorization_for_candidate(&app, &candidate)? else {
        return Ok((
            missing_preview(&generated_at, project_version, candidate),
            None,
        ));
    };
    let pack = build_pack(&generated_at, &evidence_pack, &anchor)?;
    Ok((preview_from_pack(&pack)?, Some(pack)))
}

fn ensure_fresh(value: &str) -> Result<(), String> {
    let timestamp = DateTime::parse_from_rfc3339(value)
        .map_err(|_| "release-handoff-generated-at-invalid")?
        .with_timezone(&Utc);
    let age = Utc::now().signed_duration_since(timestamp).num_seconds();
    if !(0..=MAX_PREVIEW_AGE_SECONDS).contains(&age) {
        return Err("release-handoff-preview-expired".into());
    }
    Ok(())
}

fn validate_path(path: &str, extension: &str, error: &str) -> Result<PathBuf, String> {
    let target = PathBuf::from(path.trim());
    if !target.is_absolute()
        || target
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| !value.eq_ignore_ascii_case(extension))
            .unwrap_or(true)
    {
        return Err(error.into());
    }
    Ok(target)
}

fn write_atomic_new(target: &Path, bytes: &[u8]) -> Result<(), String> {
    if target.exists() {
        return Err("release-handoff-destination-exists".into());
    }
    let parent = target.parent().ok_or("release-handoff-parent-invalid")?;
    let parent_meta =
        fs::symlink_metadata(parent).map_err(|error| format!("release-handoff-parent:{error}"))?;
    if !parent_meta.is_dir() || parent_meta.file_type().is_symlink() {
        return Err("release-handoff-parent-invalid".into());
    }
    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("release-handoff-destination-invalid")?;
    let temporary = target.with_file_name(format!(".{file_name}.{}.tmp", std::process::id()));
    if temporary.exists() {
        return Err("release-handoff-temporary-exists".into());
    }
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("release-handoff-temporary-create:{error}"))?;
        file.write_all(bytes)
            .map_err(|error| format!("release-handoff-write:{error}"))?;
        file.sync_all()
            .map_err(|error| format!("release-handoff-sync:{error}"))?;
        fs::hard_link(&temporary, target)
            .map_err(|error| format!("release-handoff-commit:{error}"))?;
        fs::remove_file(&temporary)
            .map_err(|error| format!("release-handoff-temporary-remove:{error}"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn invalid_verification(
    error: String,
    file_sha256: String,
    size_bytes: u64,
    expected_digest_status: String,
) -> ReleaseHandoffVerification {
    let origin_assurance = if expected_digest_status == "differs" {
        "digestMismatch"
    } else {
        "notEstablished"
    };
    ReleaseHandoffVerification {
        integrity: "invalid".into(),
        error,
        generated_at: String::new(),
        project_version: String::new(),
        candidate_fingerprint: String::new(),
        approval_event_hash: String::new(),
        payload_sha256: String::new(),
        file_sha256,
        size_bytes,
        contains_personal_data: false,
        matches_current_candidate: false,
        matches_current_approval: false,
        expected_digest_status,
        origin_assurance: origin_assurance.into(),
        warnings: Vec::new(),
    }
}

#[tauri::command]
pub async fn preview_release_handoff(
    app: AppHandle,
    workspace_root: String,
) -> Result<ReleaseHandoffPreview, String> {
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    build_current(app, workspace_root, generated_at)
        .await
        .map(|result| result.0)
}

#[tauri::command]
pub async fn export_release_handoff(
    app: AppHandle,
    input: ExportReleaseHandoffInput,
) -> Result<ReleaseHandoffExportReceipt, String> {
    if !input.confirmed {
        return Err("release-handoff-confirmation-required".into());
    }
    ensure_fresh(&input.generated_at)?;
    let target = validate_path(
        &input.destination_path,
        "mshhandoff",
        "release-handoff-destination-invalid",
    )?;
    let (preview, pack) =
        build_current(app, input.workspace_root, input.generated_at.clone()).await?;
    if !preview.can_export {
        return Err("release-handoff-approval-required".into());
    }
    if preview.payload_sha256 != input.expected_payload_sha256.trim().to_ascii_uppercase() {
        return Err("release-handoff-preview-stale".into());
    }
    let pack = pack.ok_or("release-handoff-pack-missing")?;
    let bytes = pack_bytes(&pack)?;
    write_atomic_new(&target, &bytes)?;
    let readback =
        fs::read(&target).map_err(|error| format!("release-handoff-readback:{error}"))?;
    let parsed: Value = serde_json::from_slice(&readback)
        .map_err(|error| format!("release-handoff-readback-json:{error}"))?;
    let (_, payload_sha256) = verify_pack_value(&parsed)?;
    Ok(ReleaseHandoffExportReceipt {
        path: target.to_string_lossy().into_owned(),
        generated_at: preview.generated_at,
        project_version: preview.project_version,
        candidate_fingerprint: preview.candidate_fingerprint,
        approval_event_hash: preview.approval_event_hash,
        payload_sha256,
        file_sha256: sha256_upper(&readback),
        size_bytes: readback.len() as u64,
    })
}

#[tauri::command]
pub async fn verify_release_handoff(
    app: AppHandle,
    workspace_root: String,
    source_path: String,
    expected_file_sha256: String,
) -> Result<ReleaseHandoffVerification, String> {
    let source = validate_path(&source_path, "mshhandoff", "release-handoff-source-invalid")?;
    let metadata =
        fs::symlink_metadata(&source).map_err(|error| format!("release-handoff-source:{error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_PACK_BYTES {
        return Err("release-handoff-source-invalid".into());
    }
    let bytes =
        fs::read(&source).map_err(|error| format!("release-handoff-source-read:{error}"))?;
    let file_sha256 = sha256_upper(&bytes);
    let (expected_digest_status, mut origin_assurance) =
        compare_expected_digest(&expected_file_sha256, &file_sha256)?;
    let parsed: Value =
        serde_json::from_slice(&bytes).map_err(|error| format!("release-handoff-json:{error}"))?;
    let (payload, payload_sha256) = match verify_pack_value(&parsed) {
        Ok(result) => result,
        Err(error) => {
            return Ok(invalid_verification(
                error,
                file_sha256,
                bytes.len() as u64,
                expected_digest_status,
            ));
        }
    };
    let generated_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    let (current_evidence, _) =
        release_evidence::build_current_pack(app.clone(), workspace_root.clone(), generated_at)
            .await?;
    let (current_payload, _) = release_evidence::verify_pack_value(&current_evidence)?;
    let current_candidate = release_approval::fingerprint_candidate(current_payload)?;
    let candidate_fingerprint = string_at(payload, "/candidateFingerprint");
    let approval_event_hash = string_at(payload, "/authorization/eventHash");
    let matches_current_candidate = current_candidate == candidate_fingerprint;
    let matches_current_approval =
        release_approval::authorization_for_candidate(&app, &candidate_fingerprint)?
            .map(|anchor| anchor.event_hash == approval_event_hash)
            .unwrap_or(false);
    if expected_digest_status == "notProvided" && matches_current_approval {
        origin_assurance = "localApprovalMatch".into();
    }
    let mut warnings = Vec::new();
    if !matches_current_candidate {
        warnings.push("candidate-differs".into());
    }
    if !matches_current_approval {
        warnings.push("approval-not-present".into());
    }
    if expected_digest_status == "notProvided" {
        warnings.push("trusted-digest-not-provided".into());
    } else if expected_digest_status == "differs" {
        warnings.push("expected-digest-differs".into());
    }
    Ok(ReleaseHandoffVerification {
        integrity: "verified".into(),
        error: String::new(),
        generated_at: string_at(payload, "/generatedAt"),
        project_version: string_at(payload, "/projectVersion"),
        candidate_fingerprint,
        approval_event_hash,
        payload_sha256,
        file_sha256,
        size_bytes: bytes.len() as u64,
        contains_personal_data: false,
        matches_current_candidate,
        matches_current_approval,
        expected_digest_status,
        origin_assurance,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn evidence_pack() -> Value {
        let payload = json!({
            "generatedAt":"2026-09-01T00:00:00Z",
            "projectVersion":"0.3.2",
            "inspection":{"release":{"installerSha256":"A".repeat(64)}}
        });
        let digest = sha256_upper(&serde_json::to_vec(&payload).unwrap());
        json!({
            "documentType":"minecraft-server-hub-release-evidence-pack",
            "schemaVersion":1,
            "payload":payload,
            "payloadSha256":digest
        })
    }

    fn anchor(pack: &Value) -> release_approval::ReleaseAuthorizationAnchor {
        let (payload, digest) = release_evidence::verify_pack_value(pack).unwrap();
        release_approval::ReleaseAuthorizationAnchor {
            sequence: 1,
            project_version: "0.3.2".into(),
            evidence_payload_sha256: digest,
            candidate_fingerprint: release_approval::fingerprint_candidate(payload).unwrap(),
            approval_digest: "B".repeat(64),
            installer_sha256: "A".repeat(64),
            approved_at: "2026-09-01T00:01:00Z".into(),
            warning_ids: vec!["dependencyAdvisories".into()],
            event_hash: "C".repeat(64),
            ledger_event_count: 1,
            ledger_last_hash: "C".repeat(64),
        }
    }

    #[test]
    fn handoff_is_deterministic_and_omits_reviewer_and_rationale() {
        let evidence = evidence_pack();
        let approval = anchor(&evidence);
        let left = build_pack("2026-09-01T00:02:00Z", &evidence, &approval).unwrap();
        let right = build_pack("2026-09-01T00:02:00Z", &evidence, &approval).unwrap();
        assert_eq!(left, right);
        let text = serde_json::to_string(&left).unwrap();
        assert!(!text.contains("reviewer"));
        assert!(!text.contains("rationale"));
        assert!(!text.contains("Release Owner"));
        assert!(verify_pack_value(&left).is_ok());
        assert_eq!(string_at(&left, "/payload/capabilities/publish"), "");
        assert_eq!(left["payload"]["capabilities"]["publish"], json!(false));
    }

    #[test]
    fn stale_approval_is_rejected() {
        let evidence = evidence_pack();
        let mut approval = anchor(&evidence);
        approval.candidate_fingerprint = "D".repeat(64);
        assert_eq!(
            build_pack("2026-09-01T00:02:00Z", &evidence, &approval).unwrap_err(),
            "release-handoff-approval-stale"
        );
    }

    #[test]
    fn nested_evidence_or_outer_payload_tampering_is_detected() {
        let evidence = evidence_pack();
        let approval = anchor(&evidence);
        let mut outer = build_pack("2026-09-01T00:02:00Z", &evidence, &approval).unwrap();
        outer["payload"]["projectVersion"] = json!("9.9.9");
        assert_eq!(
            verify_pack_value(&outer).unwrap_err(),
            "release-handoff-digest-mismatch"
        );

        let mut nested = build_pack("2026-09-01T00:02:00Z", &evidence, &approval).unwrap();
        nested["payload"]["releaseEvidence"]["payload"]["projectVersion"] = json!("9.9.9");
        let payload = nested["payload"].clone();
        nested["payloadSha256"] = json!(sha256_upper(&serde_json::to_vec(&payload).unwrap()));
        assert_eq!(
            verify_pack_value(&nested).unwrap_err(),
            "release-evidence-digest-mismatch"
        );
    }

    #[test]
    fn privacy_guard_rejects_sensitive_keys_and_absolute_paths() {
        assert!(validate_privacy(&json!({"reviewer":"Private"})).is_err());
        assert!(validate_privacy(&json!({"safe":"C:\\private\\file"})).is_err());
        assert!(validate_privacy(&json!({"safe":"release/file.exe"})).is_ok());
    }

    #[test]
    fn atomic_export_does_not_overwrite() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("release.mshhandoff");
        write_atomic_new(&target, b"first").unwrap();
        assert_eq!(
            write_atomic_new(&target, b"second").unwrap_err(),
            "release-handoff-destination-exists"
        );
        assert_eq!(fs::read(&target).unwrap(), b"first");
    }

    #[test]
    fn missing_approval_preview_never_enables_export() {
        let preview = missing_preview("2026-09-01T00:02:00Z", "0.3.2".into(), "A".repeat(64));
        assert_eq!(preview.status, "approvalRequired");
        assert!(!preview.can_export);
        assert!(preview.payload_sha256.is_empty());
        assert_eq!(preview.approval_sequence, 0);
    }

    #[test]
    fn trusted_digest_detects_a_rehashed_self_consistent_document() {
        let evidence = evidence_pack();
        let approval = anchor(&evidence);
        let original = build_pack("2026-09-01T00:02:00Z", &evidence, &approval).unwrap();
        let original_bytes = pack_bytes(&original).unwrap();
        let expected = sha256_upper(&original_bytes);

        let mut rewritten = original;
        rewritten["payload"]["generatedAt"] = json!("2026-09-01T00:03:00Z");
        let rewritten_payload = rewritten["payload"].clone();
        rewritten["payloadSha256"] = json!(sha256_upper(
            &serde_json::to_vec(&rewritten_payload).unwrap()
        ));
        assert!(verify_pack_value(&rewritten).is_ok());

        let rewritten_sha = sha256_upper(&pack_bytes(&rewritten).unwrap());
        assert_eq!(
            compare_expected_digest(&expected, &rewritten_sha).unwrap(),
            ("differs".into(), "digestMismatch".into())
        );
    }

    #[test]
    fn expected_digest_is_optional_but_must_be_a_complete_sha256() {
        let actual = "A".repeat(64);
        assert_eq!(
            compare_expected_digest("", &actual).unwrap(),
            ("notProvided".into(), "notEstablished".into())
        );
        assert_eq!(
            compare_expected_digest(&"a".repeat(64), &actual).unwrap(),
            ("matches".into(), "trustedDigestMatch".into())
        );
        assert_eq!(
            compare_expected_digest("ABC", &actual).unwrap_err(),
            "release-handoff-expected-digest-invalid"
        );
    }
}
