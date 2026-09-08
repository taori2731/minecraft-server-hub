use std::{
    fs,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::{inspection, license_ledger};

const DOCUMENT_TYPE: &str = "minecraft-server-hub-release-evidence-pack";
const SCHEMA_VERSION: u32 = 1;
const MAX_PACK_BYTES: u64 = 16 * 1024 * 1024;
const MAX_EXPORT_AGE_SECONDS: i64 = 30 * 60;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseEvidencePackPreview {
    generated_at: String,
    project_version: String,
    inventory_digest: String,
    source_digest: String,
    payload_sha256: String,
    size_bytes: u64,
    sections: Vec<String>,
    warnings: Vec<String>,
    check_summary: Value,
    quality_summary: Value,
    license_summary: Value,
    ledger_integrity: String,
    ledger_event_count: u64,
    can_export: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseEvidenceExportReceipt {
    path: String,
    generated_at: String,
    project_version: String,
    payload_sha256: String,
    file_sha256: String,
    size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseEvidenceVerification {
    integrity: String,
    error: String,
    generated_at: String,
    project_version: String,
    inventory_digest: String,
    source_digest: String,
    payload_sha256: String,
    file_sha256: String,
    size_bytes: u64,
    section_count: usize,
    matches_current_version: bool,
    matches_current_inventory: bool,
    matches_current_source: bool,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReleaseEvidenceInput {
    workspace_root: String,
    generated_at: String,
    expected_payload_sha256: String,
    destination_path: String,
    confirmed: bool,
}

fn sha256_upper(bytes: &[u8]) -> String {
    hex::encode_upper(Sha256::digest(bytes))
}

fn pointer(value: &Value, path: &str) -> Value {
    value.pointer(path).cloned().unwrap_or(Value::Null)
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

fn selected(value: &Value, fields: &[&str]) -> Value {
    let mut result = Map::new();
    for field in fields {
        if let Some(item) = value.get(*field) {
            result.insert((*field).to_owned(), item.clone());
        }
    }
    Value::Object(result)
}

fn selected_array(value: &Value, path: &str, fields: &[&str], limit: usize) -> Value {
    Value::Array(
        value
            .pointer(path)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .take(limit)
            .map(|item| selected(item, fields))
            .collect(),
    )
}

fn sanitize_inspection(report: &Value) -> Value {
    let release = pointer(report, "/release");
    let dependencies = pointer(report, "/dependencyInventory");
    let bundle = pointer(report, "/bundleAnalysis");
    let quality = pointer(report, "/qualityEvidence");
    json!({
        "readOnly": report.get("readOnly").cloned().unwrap_or(Value::Bool(true)),
        "expectedVersion": pointer(report, "/expectedVersion"),
        "versionSources": selected_array(report, "/versionSources", &["id", "path", "value"], 32),
        "release": selected(&release, &[
            "artifactVersion", "manifestPath", "installerPath", "signaturePath",
            "installerSizeBytes", "installerSha256", "manifestVersion", "downloadUrl", "publishedAt"
        ]),
        "releaseHistory": selected_array(report, "/releaseHistory", &[
            "version", "manifestPath", "installerPath", "installerSizeBytes", "installerSha256",
            "downloadUrl", "publishedAt", "signatureValid", "integrityError"
        ], 100),
        "dependencies": {
            "generatedFromLockfiles": pointer(&dependencies, "/generatedFromLockfiles"),
            "totals": pointer(&dependencies, "/totals"),
            "lockfiles": selected_array(&dependencies, "/lockfiles", &[
                "id", "ecosystem", "manifestPath", "lockfilePath", "present", "packageCount",
                "directCount", "developmentCount", "unknownLicenseCount", "reciprocalLicenseCount",
                "insecureSourceCount", "missingIntegrityCount", "licenses"
            ], 32),
            "packages": selected_array(&dependencies, "/packages", &[
                "componentId", "ecosystem", "name", "version", "direct", "development", "license",
                "licenseClass", "source", "integrity", "integrityPresent", "reason",
                "hostApplicability", "applicabilityReason"
            ], 5000),
            "advisoryPreview": selected(&pointer(&dependencies, "/advisoryPreview"), &[
                "totalPackages", "eligiblePackages", "uniquePackages", "duplicatePackages",
                "npmPackages", "cargoPackages", "requestDigest", "transmittedFields",
                "includesPaths", "includesSources", "includesLicenses"
            ])
        },
        "bundle": {
            "status": pointer(&bundle, "/status"),
            "generatedAt": pointer(&bundle, "/generatedAt"),
            "budgets": pointer(&bundle, "/budgets"),
            "totals": pointer(&bundle, "/totals"),
            "chunks": selected_array(&bundle, "/chunks", &[
                "fileName", "name", "entry", "dynamicEntry", "rawBytes", "gzipBytes",
                "imports", "dynamicImports", "moduleCount"
            ], 1000),
            "assets": selected_array(&bundle, "/assets", &["fileName", "rawBytes", "gzipBytes"], 1000),
            "violations": pointer(&bundle, "/violations"),
            "error": pointer(&bundle, "/error")
        },
        "quality": {
            "status": pointer(&quality, "/status"),
            "generatedAt": pointer(&quality, "/generatedAt"),
            "durationMs": pointer(&quality, "/durationMs"),
            "sourceDigest": pointer(&quality, "/sourceDigest"),
            "sourceStable": pointer(&quality, "/sourceStable"),
            "requiredStageIds": pointer(&quality, "/requiredStageIds"),
            "summary": pointer(&quality, "/summary"),
            "coverage": selected(&pointer(&quality, "/coverage"), &["available", "lines", "statements", "functions", "branches"]),
            "coverageThresholds": pointer(&quality, "/coverageThresholds"),
            "coverageViolations": pointer(&quality, "/coverageViolations"),
            "stages": selected_array(&quality, "/stages", &[
                "id", "kind", "status", "exitCode", "durationMs", "tests"
            ], 128),
            "error": pointer(&quality, "/error")
        },
        "checks": selected_array(report, "/checks", &["id", "status"], 256),
        "summary": pointer(report, "/summary")
    })
}

fn sanitize_license_evidence(evidence: &Value) -> Value {
    json!({
        "schemaVersion": pointer(evidence, "/schemaVersion"),
        "inventoryDigest": pointer(evidence, "/inventoryDigest"),
        "localOnly": pointer(evidence, "/localOnly"),
        "summary": pointer(evidence, "/summary"),
        "items": selected_array(evidence, "/items", &[
            "ecosystem", "name", "version", "componentIds", "declaredLicense", "manifestLicense",
            "status", "integrity", "hostApplicability", "files", "canonicalLicense", "reason"
        ], 5000)
    })
}

fn sanitize_ledger(ledger: &Value) -> Value {
    let records = ledger
        .pointer("/records")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let decision_count = |decision: &str| {
        records
            .iter()
            .filter(|record| string_at(record, "/decision") == decision)
            .count()
    };
    json!({
        "schemaVersion": pointer(ledger, "/schemaVersion"),
        "inventoryDigest": pointer(ledger, "/inventoryDigest"),
        "integrity": pointer(ledger, "/integrity"),
        "eventCount": pointer(ledger, "/eventCount"),
        "activeRecords": records.len(),
        "decisions": {
            "approved": decision_count("approved"),
            "restricted": decision_count("restricted"),
            "blocked": decision_count("blocked")
        },
        "expiringSoon": pointer(ledger, "/expiringSoon"),
        "lastHash": pointer(ledger, "/lastHash"),
        "updatedAt": pointer(ledger, "/updatedAt")
    })
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
    const FORBIDDEN: &[&str] = &[
        "workspaceRoot",
        "artifactDirectory",
        "reportPath",
        "sourceNewestAt",
        "command",
        "outputTail",
        "reviewer",
        "rationale",
        "storage",
        "technicalDetail",
        "manifestSource",
    ];
    match value {
        Value::Object(map) => {
            for (key, item) in map {
                if FORBIDDEN.contains(&key.as_str()) {
                    return Err(format!("release-evidence-private-key:{key}"));
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
            return Err("release-evidence-absolute-path".into());
        }
        _ => {}
    }
    Ok(())
}

fn build_pack(
    generated_at: &str,
    report: &Value,
    evidence: &Value,
    ledger: &Value,
) -> Result<Value, String> {
    DateTime::parse_from_rfc3339(generated_at)
        .map_err(|_| "release-evidence-generated-at-invalid")?;
    let payload = json!({
        "generatedAt": generated_at,
        "projectVersion": pointer(report, "/expectedVersion"),
        "sourceDigests": {
            "inventory": pointer(report, "/dependencyInventory/advisoryPreview/requestDigest"),
            "quality": pointer(report, "/qualityEvidence/sourceDigest")
        },
        "inspection": sanitize_inspection(report),
        "licenseEvidence": sanitize_license_evidence(evidence),
        "licenseLedger": sanitize_ledger(ledger)
    });
    validate_privacy(&payload)?;
    let payload_bytes = serde_json::to_vec(&payload)
        .map_err(|error| format!("release-evidence-payload-serialize:{error}"))?;
    let payload_sha256 = sha256_upper(&payload_bytes);
    Ok(json!({
        "documentType": DOCUMENT_TYPE,
        "schemaVersion": SCHEMA_VERSION,
        "payload": payload,
        "payloadSha256": payload_sha256
    }))
}

fn pack_bytes(pack: &Value) -> Result<Vec<u8>, String> {
    let mut bytes = serde_json::to_vec_pretty(pack)
        .map_err(|error| format!("release-evidence-serialize:{error}"))?;
    bytes.push(b'\n');
    if bytes.len() as u64 > MAX_PACK_BYTES {
        return Err("release-evidence-too-large".into());
    }
    Ok(bytes)
}

pub(crate) fn verify_pack_value(pack: &Value) -> Result<(&Value, String), String> {
    if string_at(pack, "/documentType") != DOCUMENT_TYPE
        || number_at(pack, "/schemaVersion") != SCHEMA_VERSION as u64
    {
        return Err("release-evidence-document-invalid".into());
    }
    let payload = pack
        .get("payload")
        .ok_or("release-evidence-payload-missing")?;
    validate_privacy(payload)?;
    let expected = string_at(pack, "/payloadSha256").to_ascii_uppercase();
    if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("release-evidence-digest-invalid".into());
    }
    let actual = sha256_upper(
        &serde_json::to_vec(payload)
            .map_err(|error| format!("release-evidence-payload-serialize:{error}"))?,
    );
    if expected != actual {
        return Err("release-evidence-digest-mismatch".into());
    }
    Ok((payload, actual))
}

fn preview_from_pack(pack: &Value) -> Result<ReleaseEvidencePackPreview, String> {
    let (payload, payload_sha256) = verify_pack_value(pack)?;
    let quality_status = string_at(payload, "/inspection/quality/status");
    let ledger_integrity = string_at(payload, "/licenseLedger/integrity");
    let mut warnings = Vec::new();
    if quality_status != "current" {
        warnings.push(format!("quality-{quality_status}"));
    }
    if ledger_integrity != "verified" {
        warnings.push("license-ledger-unverified".into());
    }
    let bytes = pack_bytes(pack)?;
    Ok(ReleaseEvidencePackPreview {
        generated_at: string_at(payload, "/generatedAt"),
        project_version: string_at(payload, "/projectVersion"),
        inventory_digest: string_at(payload, "/sourceDigests/inventory"),
        source_digest: string_at(payload, "/sourceDigests/quality"),
        payload_sha256,
        size_bytes: bytes.len() as u64,
        sections: vec![
            "inspection".into(),
            "release".into(),
            "dependencies".into(),
            "bundle".into(),
            "quality".into(),
            "licenseEvidence".into(),
            "licenseLedger".into(),
        ],
        warnings,
        check_summary: pointer(payload, "/inspection/summary"),
        quality_summary: pointer(payload, "/inspection/quality/summary"),
        license_summary: pointer(payload, "/licenseEvidence/summary"),
        ledger_integrity,
        ledger_event_count: number_at(payload, "/licenseLedger/eventCount"),
        can_export: quality_status == "current",
    })
}

fn ensure_export_time(value: &str) -> Result<(), String> {
    let timestamp = DateTime::parse_from_rfc3339(value)
        .map_err(|_| "release-evidence-generated-at-invalid")?
        .with_timezone(&Utc);
    let age = Utc::now().signed_duration_since(timestamp).num_seconds();
    if !(0..=MAX_EXPORT_AGE_SECONDS).contains(&age) {
        return Err("release-evidence-preview-expired".into());
    }
    Ok(())
}

fn validate_export_path(path: &str) -> Result<PathBuf, String> {
    let target = PathBuf::from(path.trim());
    if !target.is_absolute()
        || target
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| !value.eq_ignore_ascii_case("mshrelease"))
            .unwrap_or(true)
    {
        return Err("release-evidence-destination-invalid".into());
    }
    if target.exists() {
        return Err("release-evidence-destination-exists".into());
    }
    let parent = target.parent().ok_or("release-evidence-parent-invalid")?;
    let metadata =
        fs::symlink_metadata(parent).map_err(|error| format!("release-evidence-parent:{error}"))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("release-evidence-parent-invalid".into());
    }
    Ok(target)
}

fn write_atomic_new(target: &Path, bytes: &[u8]) -> Result<(), String> {
    if target.exists() {
        return Err("release-evidence-destination-exists".into());
    }
    let file_name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("release-evidence-destination-invalid")?;
    let temporary = target.with_file_name(format!(".{file_name}.{}.tmp", std::process::id()));
    if temporary.exists() {
        return Err("release-evidence-temporary-exists".into());
    }
    let result = (|| {
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| format!("release-evidence-temporary-create:{error}"))?;
        file.write_all(bytes)
            .map_err(|error| format!("release-evidence-write:{error}"))?;
        file.sync_all()
            .map_err(|error| format!("release-evidence-sync:{error}"))?;
        fs::hard_link(&temporary, target)
            .map_err(|error| format!("release-evidence-commit:{error}"))?;
        fs::remove_file(&temporary)
            .map_err(|error| format!("release-evidence-temporary-remove:{error}"))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub(crate) async fn build_current_pack(
    app: AppHandle,
    workspace_root: String,
    generated_at: String,
) -> Result<(Value, Value), String> {
    let root = inspection::canonical_workspace(&workspace_root)?;
    let (report, evidence) = tauri::async_runtime::spawn_blocking(move || {
        inspection::inspect_release_evidence_sources(&root)
    })
    .await
    .map_err(|error| format!("release-evidence-inspection-join:{error}"))??;
    let inventory_digest = string_at(
        &report,
        "/dependencyInventory/advisoryPreview/requestDigest",
    );
    let ledger_snapshot = license_ledger::load_license_review_ledger(app, inventory_digest)?;
    let ledger = serde_json::to_value(ledger_snapshot)
        .map_err(|error| format!("release-evidence-ledger-serialize:{error}"))?;
    let pack = build_pack(&generated_at, &report, &evidence, &ledger)?;
    Ok((pack, report))
}

#[tauri::command]
pub async fn preview_release_evidence_pack(
    app: AppHandle,
    workspace_root: String,
) -> Result<ReleaseEvidencePackPreview, String> {
    let generated_at = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let (pack, _) = build_current_pack(app, workspace_root, generated_at).await?;
    preview_from_pack(&pack)
}

#[tauri::command]
pub async fn export_release_evidence_pack(
    app: AppHandle,
    input: ExportReleaseEvidenceInput,
) -> Result<ReleaseEvidenceExportReceipt, String> {
    if !input.confirmed {
        return Err("release-evidence-confirmation-required".into());
    }
    ensure_export_time(&input.generated_at)?;
    let target = validate_export_path(&input.destination_path)?;
    let (pack, _) =
        build_current_pack(app, input.workspace_root, input.generated_at.clone()).await?;
    let preview = preview_from_pack(&pack)?;
    if !preview.can_export {
        return Err("release-evidence-quality-not-current".into());
    }
    if preview.payload_sha256 != input.expected_payload_sha256.trim().to_ascii_uppercase() {
        return Err("release-evidence-preview-stale".into());
    }
    let bytes = pack_bytes(&pack)?;
    write_atomic_new(&target, &bytes)?;
    let written =
        fs::read(&target).map_err(|error| format!("release-evidence-readback:{error}"))?;
    let parsed: Value = serde_json::from_slice(&written)
        .map_err(|error| format!("release-evidence-readback-json:{error}"))?;
    let (_, payload_sha256) = verify_pack_value(&parsed)?;
    Ok(ReleaseEvidenceExportReceipt {
        path: target.to_string_lossy().into_owned(),
        generated_at: input.generated_at,
        project_version: preview.project_version,
        payload_sha256,
        file_sha256: sha256_upper(&written),
        size_bytes: written.len() as u64,
    })
}

#[tauri::command]
pub async fn verify_release_evidence_pack(
    workspace_root: String,
    source_path: String,
) -> Result<ReleaseEvidenceVerification, String> {
    let source = PathBuf::from(source_path.trim());
    if !source.is_absolute()
        || source
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| !value.eq_ignore_ascii_case("mshrelease"))
            .unwrap_or(true)
    {
        return Err("release-evidence-source-invalid".into());
    }
    let metadata = fs::symlink_metadata(&source)
        .map_err(|error| format!("release-evidence-source:{error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_PACK_BYTES {
        return Err("release-evidence-source-invalid".into());
    }
    let bytes =
        fs::read(&source).map_err(|error| format!("release-evidence-source-read:{error}"))?;
    let file_sha256 = sha256_upper(&bytes);
    let parsed: Value =
        serde_json::from_slice(&bytes).map_err(|error| format!("release-evidence-json:{error}"))?;
    let (payload, payload_sha256) = match verify_pack_value(&parsed) {
        Ok(result) => result,
        Err(error) => {
            return Ok(ReleaseEvidenceVerification {
                integrity: "invalid".into(),
                error,
                generated_at: String::new(),
                project_version: String::new(),
                inventory_digest: String::new(),
                source_digest: String::new(),
                payload_sha256: String::new(),
                file_sha256,
                size_bytes: bytes.len() as u64,
                section_count: 0,
                matches_current_version: false,
                matches_current_inventory: false,
                matches_current_source: false,
                warnings: Vec::new(),
            });
        }
    };
    let root = inspection::canonical_workspace(&workspace_root)?;
    let (current, _) = tauri::async_runtime::spawn_blocking(move || {
        inspection::inspect_release_evidence_sources(&root)
    })
    .await
    .map_err(|error| format!("release-evidence-current-join:{error}"))??;
    let project_version = string_at(payload, "/projectVersion");
    let inventory_digest = string_at(payload, "/sourceDigests/inventory");
    let source_digest = string_at(payload, "/sourceDigests/quality");
    let matches_current_version = project_version == string_at(&current, "/expectedVersion");
    let matches_current_inventory = inventory_digest
        == string_at(
            &current,
            "/dependencyInventory/advisoryPreview/requestDigest",
        );
    let matches_current_source =
        source_digest == string_at(&current, "/qualityEvidence/sourceDigest");
    let mut warnings = Vec::new();
    if !matches_current_version {
        warnings.push("project-version-differs".into());
    }
    if !matches_current_inventory {
        warnings.push("dependency-inventory-differs".into());
    }
    if !matches_current_source {
        warnings.push("quality-source-differs".into());
    }
    Ok(ReleaseEvidenceVerification {
        integrity: "verified".into(),
        error: String::new(),
        generated_at: string_at(payload, "/generatedAt"),
        project_version,
        inventory_digest,
        source_digest,
        payload_sha256,
        file_sha256,
        size_bytes: bytes.len() as u64,
        section_count: payload.as_object().map(Map::len).unwrap_or_default(),
        matches_current_version,
        matches_current_inventory,
        matches_current_source,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sources() -> (Value, Value, Value) {
        let report = json!({
            "readOnly": true, "expectedVersion": "0.3.2", "versionSources": [],
            "release": {"artifactVersion":"0.3.2","installerPath":"release/app.exe","installerSha256":"A".repeat(64)},
            "releaseHistory": [],
            "dependencyInventory": {"generatedFromLockfiles":true,"totals":{"packages":1},"lockfiles":[],"packages":[],"advisoryPreview":{"requestDigest":"B".repeat(64)}},
            "bundleAnalysis": {"status":"current","generatedAt":"2026-09-01T00:00:00Z","budgets":{},"totals":{},"chunks":[],"assets":[],"violations":[],"reportPath":"C:\\private\\bundle.json"},
            "qualityEvidence": {"status":"current","generatedAt":"2026-09-01T00:00:00Z","sourceDigest":"C".repeat(64),"sourceStable":true,"summary":{"totalTests":10},"coverage":{},"coverageThresholds":{},"coverageViolations":[],"stages":[{"id":"test","command":"secret","outputTail":"secret","status":"pass"}]},
            "checks": [{"id":"version","status":"pass","technicalDetail":"C:\\private"}], "summary":{"pass":1,"warning":0,"fail":0},
            "workspaceRoot":"C:\\private"
        });
        let evidence = json!({"schemaVersion":3,"inventoryDigest":"B".repeat(64),"localOnly":true,"summary":{"total":1},"items":[]});
        let ledger = json!({"schemaVersion":1,"inventoryDigest":"B".repeat(64),"integrity":"verified","eventCount":1,"expiringSoon":0,"lastHash":"D".repeat(64),"updatedAt":"2026-09-01T00:00:00Z","records":[{"reviewer":"private"}],"storage":"C:\\private"});
        (report, evidence, ledger)
    }

    #[test]
    fn pack_is_deterministic_and_omits_private_fields() {
        let (report, evidence, ledger) = sources();
        let left = build_pack("2026-09-01T00:00:00Z", &report, &evidence, &ledger).unwrap();
        let right = build_pack("2026-09-01T00:00:00Z", &report, &evidence, &ledger).unwrap();
        assert_eq!(left, right);
        let text = serde_json::to_string(&left).unwrap();
        for forbidden in [
            "workspaceRoot",
            "technicalDetail",
            "outputTail",
            "reviewer",
            "rationale",
            "C:\\\\private",
        ] {
            assert!(!text.contains(forbidden), "found {forbidden}");
        }
        assert!(verify_pack_value(&left).is_ok());
    }

    #[test]
    fn payload_tampering_is_detected() {
        let (report, evidence, ledger) = sources();
        let mut pack = build_pack("2026-09-01T00:00:00Z", &report, &evidence, &ledger).unwrap();
        pack["payload"]["projectVersion"] = Value::String("9.9.9".into());
        assert_eq!(
            verify_pack_value(&pack).unwrap_err(),
            "release-evidence-digest-mismatch"
        );
    }

    #[test]
    fn privacy_guard_rejects_absolute_paths_and_sensitive_keys() {
        assert!(validate_privacy(&json!({"safe":"C:\\private\\file"})).is_err());
        assert!(validate_privacy(&json!({"reviewer":"name"})).is_err());
        assert!(validate_privacy(&json!({"url":"https://example.com/file"})).is_ok());
    }

    #[test]
    fn atomic_writer_does_not_overwrite() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("proof.mshrelease");
        write_atomic_new(&target, b"one").unwrap();
        assert!(write_atomic_new(&target, b"two").is_err());
        assert_eq!(fs::read(&target).unwrap(), b"one");
    }

    #[test]
    fn current_workspace_can_be_sanitized_without_leaking_its_path() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let (report, evidence) = inspection::inspect_release_evidence_sources(&root).unwrap();
        let inventory_digest = string_at(
            &report,
            "/dependencyInventory/advisoryPreview/requestDigest",
        );
        let ledger = json!({
            "schemaVersion": 1, "inventoryDigest": inventory_digest, "integrity": "verified",
            "eventCount": 0, "expiringSoon": 0, "lastHash": "", "updatedAt": "", "records": []
        });
        let pack = build_pack("2026-09-01T00:00:00Z", &report, &evidence, &ledger).unwrap();
        let serialized = serde_json::to_string(&pack).unwrap();
        assert!(!serialized.contains(&root.to_string_lossy().to_string()));
        assert!(verify_pack_value(&pack).is_ok());
    }
}
