use std::{
    cmp::Ordering,
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    env,
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, SystemTime},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use base64::{Engine, engine::general_purpose::STANDARD as BASE64_STANDARD};
use chrono::{DateTime, Utc};
use minisign_verify::{PublicKey, Signature};
use regex::Regex;
use reqwest::{Client, Url, redirect::Policy};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

const OFFICIAL_UPDATE_FEED: &str = "https://github.com/taori2731/minecraft-server-hub-releases/releases/latest/download/latest.json";
const OSV_QUERY_ENDPOINT: &str = "https://api.osv.dev/v1/querybatch";
const OSV_BATCH_SIZE: usize = 500;
const OSV_MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const CARGO_WINDOWS_X64_TARGET: &str = "x86_64-pc-windows-msvc";
const DEVELOPER_ALLOWED_PERMISSIONS: [&str; 3] =
    ["core:default", "dialog:allow-open", "dialog:allow-save"];
const DEVELOPER_CAPABILITY_PATH: &str = "developer-tools/src-tauri/capabilities/default.json";
const DEVELOPER_TAURI_CONFIG_PATH: &str = "developer-tools/src-tauri/tauri.conf.json";
const DEVELOPER_APP_IDENTIFIER: &str = "local.minecraft-server-hub.developer-tools";
const DEVELOPER_CAPABILITY_IDENTIFIER: &str = "main-capability";
const MPL_2_0_SOURCE_URL: &str = "https://www.mozilla.org/media/MPL/2.0/index.f75d2927d3c1.txt";
const MPL_2_0_TEXT: &str = include_str!("../../../docs/licenses/MPL-2.0.txt");
const MPL_2_0_TEXT_SHA256: &str =
    "3F3D9E0024B1921B067D6F7F88DEB4A60CBE7A78E76C64E3F1D7FC3B779B9D04";
const MPL_2_0_HEADER: &str = "This Source Code Form is subject to the terms of the Mozilla Public\n * License, v. 2.0. If a copy of the MPL was not distributed with this\n * file, You can obtain one at https://mozilla.org/MPL/2.0/.";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionSource {
    id: String,
    path: String,
    value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperCheck {
    id: String,
    status: String,
    detail: String,
    technical_detail: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct CheckSummary {
    pass: usize,
    warning: usize,
    fail: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseDetails {
    artifact_version: String,
    artifact_directory: String,
    manifest_path: String,
    installer_path: String,
    signature_path: String,
    installer_size_bytes: u64,
    installer_sha256: String,
    manifest_version: String,
    download_url: String,
    published_at: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseHistoryEntry {
    version: String,
    manifest_path: String,
    installer_path: String,
    installer_size_bytes: u64,
    installer_sha256: String,
    download_url: String,
    published_at: String,
    signature_valid: bool,
    integrity_error: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteFeed {
    endpoint: String,
    checked: bool,
    reachable: bool,
    version: String,
    download_url: String,
    error: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyPackageSummary {
    component_id: String,
    ecosystem: String,
    name: String,
    version: String,
    direct: bool,
    development: bool,
    license: String,
    license_class: String,
    source: String,
    integrity: String,
    integrity_present: bool,
    reason: String,
    host_applicability: String,
    applicability_reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisoryQueryPreview {
    endpoint: String,
    total_packages: usize,
    eligible_packages: usize,
    unique_packages: usize,
    duplicate_packages: usize,
    npm_packages: usize,
    cargo_packages: usize,
    request_digest: String,
    transmitted_fields: Vec<String>,
    includes_paths: bool,
    includes_sources: bool,
    includes_licenses: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisoryFinding {
    component_ids: Vec<String>,
    ecosystem: String,
    name: String,
    version: String,
    advisory_id: String,
    modified: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdvisoryScanResult {
    scanned_at: String,
    endpoint: String,
    request_digest: String,
    queried_packages: usize,
    affected_packages: usize,
    vulnerability_count: usize,
    complete: bool,
    findings: Vec<AdvisoryFinding>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseEvidenceFile {
    name: String,
    kind: String,
    size_bytes: u64,
    sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalLicenseEvidence {
    spdx_id: String,
    source_url: String,
    local_resource: String,
    size_bytes: usize,
    sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseEvidenceItem {
    ecosystem: String,
    name: String,
    version: String,
    component_ids: Vec<String>,
    declared_license: String,
    manifest_license: String,
    manifest_source: String,
    status: String,
    integrity: String,
    host_applicability: String,
    applicability_reason: String,
    files: Vec<LicenseEvidenceFile>,
    #[serde(skip_serializing_if = "Option::is_none")]
    canonical_license: Option<CanonicalLicenseEvidence>,
    reason: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseEvidenceApplicabilitySummary {
    applicable: usize,
    excluded: usize,
    unknown: usize,
    actionable_gaps: usize,
    excluded_gaps: usize,
    unknown_gaps: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseEvidenceSummary {
    total: usize,
    complete: usize,
    partial: usize,
    missing: usize,
    mismatch: usize,
    integrity_verified: usize,
    evidence_files: usize,
    applicability: LicenseEvidenceApplicabilitySummary,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseEvidenceReport {
    schema_version: u8,
    scanned_at: String,
    inventory_digest: String,
    local_only: bool,
    summary: LicenseEvidenceSummary,
    items: Vec<LicenseEvidenceItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyLockfileSummary {
    id: String,
    ecosystem: String,
    manifest_path: String,
    lockfile_path: String,
    present: bool,
    package_count: usize,
    direct_count: usize,
    development_count: usize,
    unknown_license_count: usize,
    reciprocal_license_count: usize,
    insecure_source_count: usize,
    missing_integrity_count: usize,
    licenses: Vec<LicenseCount>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LicenseCount {
    name: String,
    count: usize,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyTotals {
    lockfiles: usize,
    packages: usize,
    direct: usize,
    development: usize,
    unknown_license: usize,
    reciprocal_license: usize,
    insecure_source: usize,
    missing_integrity: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct AdvisoryScan {
    checked: bool,
    mode: String,
    reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyInventory {
    generated_from_lockfiles: bool,
    lockfiles: Vec<DependencyLockfileSummary>,
    totals: DependencyTotals,
    packages: Vec<DependencyPackageSummary>,
    review_packages: Vec<DependencyPackageSummary>,
    advisory_preview: AdvisoryQueryPreview,
    advisory_scan: AdvisoryScan,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleBudgets {
    entry_java_script_bytes: u64,
    chunk_java_script_bytes: u64,
    total_java_script_gzip_bytes: u64,
    total_css_bytes: u64,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleTotals {
    total_java_script_bytes: u64,
    total_java_script_gzip_bytes: u64,
    total_css_bytes: u64,
    chunks: usize,
    assets: usize,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleModuleSummary {
    id: String,
    rendered_bytes: u64,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleChunkSummary {
    file_name: String,
    name: String,
    entry: bool,
    dynamic_entry: bool,
    raw_bytes: u64,
    gzip_bytes: u64,
    imports: Vec<String>,
    dynamic_imports: Vec<String>,
    module_count: usize,
    largest_modules: Vec<BundleModuleSummary>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleAssetSummary {
    file_name: String,
    raw_bytes: u64,
    gzip_bytes: u64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleViolation {
    id: String,
    actual_bytes: u64,
    budget_bytes: u64,
    file_name: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleAnalysis {
    status: String,
    report_path: String,
    generated_at: String,
    source_newest_at: String,
    budgets: BundleBudgets,
    totals: BundleTotals,
    chunks: Vec<BundleChunkSummary>,
    assets: Vec<BundleAssetSummary>,
    violations: Vec<BundleViolation>,
    error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawBundleReport {
    schema_version: u32,
    generated_at: String,
    budgets: BundleBudgets,
    totals: BundleTotals,
    chunks: Vec<BundleChunkSummary>,
    assets: Vec<BundleAssetSummary>,
}

const QUALITY_REQUIRED_STAGE_IDS: [&str; 7] = [
    "appTypecheck",
    "developerTypecheck",
    "unitCoverage",
    "developerNodeTests",
    "rustFormat",
    "rustTests",
    "uiSmoke",
];

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualitySourceSnapshot {
    algorithm: String,
    digest: String,
    file_count: usize,
    total_bytes: u64,
    newest_at: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QualitySummary {
    total_stages: usize,
    passed_stages: usize,
    failed_stages: usize,
    total_tests: usize,
    passed_tests: usize,
    failed_tests: usize,
    skipped_tests: usize,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct QualityTestCounts {
    total: usize,
    passed: usize,
    failed: usize,
    skipped: usize,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityStage {
    id: String,
    kind: String,
    command: String,
    status: String,
    exit_code: u32,
    started_at: String,
    completed_at: String,
    duration_ms: u64,
    tests: QualityTestCounts,
    output_tail: String,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct QualityCoverageMetric {
    total: u64,
    covered: u64,
    skipped: u64,
    pct: f64,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityCoverage {
    available: bool,
    report_path: String,
    lines: QualityCoverageMetric,
    statements: QualityCoverageMetric,
    functions: QualityCoverageMetric,
    branches: QualityCoverageMetric,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct QualityCoverageThresholds {
    lines: f64,
    statements: f64,
    functions: f64,
    branches: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct QualityCoverageViolation {
    id: String,
    actual: f64,
    threshold: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityEvidenceAnalysis {
    status: String,
    report_path: String,
    generated_at: String,
    started_at: String,
    completed_at: String,
    duration_ms: u64,
    source_newest_at: String,
    source_digest: String,
    source_stable: bool,
    required_stage_ids: Vec<String>,
    summary: QualitySummary,
    coverage: QualityCoverage,
    coverage_thresholds: QualityCoverageThresholds,
    coverage_violations: Vec<QualityCoverageViolation>,
    stages: Vec<QualityStage>,
    error: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct CspDirective {
    name: String,
    values: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilitySecurityAudit {
    status: String,
    capability_path: String,
    configuration_path: String,
    capability_identifier: String,
    app_identifier: String,
    windows: Vec<String>,
    configured_windows: Vec<String>,
    permissions: Vec<String>,
    allowed_permissions: Vec<String>,
    csp: String,
    csp_directives: Vec<CspDirective>,
    issues: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildEnvironmentTool {
    id: String,
    command: String,
    available: bool,
    version: String,
    output: String,
    error: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildEnvironmentAudit {
    status: String,
    host_os: String,
    host_arch: String,
    expected_os: String,
    expected_arch: String,
    rust_target: String,
    rust_target_installed: bool,
    installed_rust_targets: Vec<String>,
    tools: Vec<BuildEnvironmentTool>,
    issues: Vec<String>,
    error: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawQualityEvidence {
    schema_version: u32,
    runner_version: String,
    generated_at: String,
    started_at: String,
    completed_at: String,
    duration_ms: u64,
    source_before: QualitySourceSnapshot,
    source_after: QualitySourceSnapshot,
    source_stable: bool,
    required_stage_ids: Vec<String>,
    summary: QualitySummary,
    coverage: QualityCoverage,
    stages: Vec<QualityStage>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperInspectionReport {
    schema_version: u32,
    inspected_at: String,
    workspace_root: String,
    read_only: bool,
    expected_version: String,
    version_sources: Vec<VersionSource>,
    release: ReleaseDetails,
    release_history: Vec<ReleaseHistoryEntry>,
    dependency_inventory: DependencyInventory,
    bundle_analysis: BundleAnalysis,
    quality_evidence: QualityEvidenceAnalysis,
    capability_security: CapabilitySecurityAudit,
    build_environment: BuildEnvironmentAudit,
    remote_feed: RemoteFeed,
    checks: Vec<DeveloperCheck>,
    summary: CheckSummary,
}

fn text(path: &Path) -> Option<String> {
    fs::read_to_string(path).ok()
}

fn json(path: &Path) -> Option<Value> {
    serde_json::from_str(&text(path)?).ok()
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy().into_owned();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    value.strip_prefix(r"\\?\").unwrap_or(&value).to_owned()
}

fn check(id: &str, status: &str, detail: impl Into<String>) -> DeveloperCheck {
    DeveloperCheck {
        id: id.into(),
        status: status.into(),
        detail: detail.into(),
        technical_detail: String::new(),
    }
}

fn valid_workspace(path: &Path) -> bool {
    path.join("package.json").is_file()
        && path.join("src-tauri").join("Cargo.toml").is_file()
        && path.join("src-tauri").join("tauri.conf.json").is_file()
}

pub(crate) fn canonical_workspace(input: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(input.trim());
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("workspace-not-found: {error}"))?;
    if !valid_workspace(&canonical) {
        return Err("workspace-invalid".into());
    }
    Ok(canonical)
}

fn find_workspace_from(start: &Path) -> Option<PathBuf> {
    start
        .ancestors()
        .find(|candidate| valid_workspace(candidate))
        .map(Path::to_path_buf)
}

#[tauri::command]
pub fn discover_workspace() -> Option<String> {
    let mut starts = Vec::new();
    if let Ok(current) = std::env::current_dir() {
        starts.push(current);
    }
    if let Ok(executable) = std::env::current_exe()
        && let Some(parent) = executable.parent()
    {
        starts.push(parent.to_path_buf());
    }
    starts.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    starts
        .into_iter()
        .find_map(|start| find_workspace_from(&start))
        .map(|path| display_path(&path))
}

fn version_parts(value: &str) -> Vec<VersionPart> {
    value
        .split(['.', '-'])
        .map(|part| {
            part.parse::<u64>()
                .map(VersionPart::Number)
                .unwrap_or_else(|_| VersionPart::Text(part.to_owned()))
        })
        .collect()
}

#[derive(Debug, Eq, PartialEq)]
enum VersionPart {
    Number(u64),
    Text(String),
}

fn compare_versions(left: &str, right: &str) -> Ordering {
    let left = version_parts(left);
    let right = version_parts(right);
    for index in 0..left.len().max(right.len()) {
        match (left.get(index), right.get(index)) {
            (Some(VersionPart::Number(a)), Some(VersionPart::Number(b))) if a != b => {
                return a.cmp(b);
            }
            (Some(a), Some(b)) if a != b => return format!("{a:?}").cmp(&format!("{b:?}")),
            (Some(_), None) => return Ordering::Greater,
            (None, Some(_)) => return Ordering::Less,
            _ => {}
        }
    }
    Ordering::Equal
}

fn sha256(path: &Path) -> Result<String, String> {
    let file = File::open(path).map_err(|error| format!("sha256-open: {error}"))?;
    let mut reader = BufReader::new(file);
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let length = reader
            .read(&mut buffer)
            .map_err(|error| format!("sha256-read: {error}"))?;
        if length == 0 {
            break;
        }
        hash.update(&buffer[..length]);
    }
    Ok(hex::encode_upper(hash.finalize()))
}

fn verify_updater_signature(
    path: &Path,
    encoded_signature: &str,
    encoded_public_key: &str,
) -> Result<(), String> {
    let signature_text = String::from_utf8(
        BASE64_STANDARD
            .decode(encoded_signature.trim())
            .map_err(|error| format!("signature-base64: {error}"))?,
    )
    .map_err(|error| format!("signature-utf8: {error}"))?;
    let signature = Signature::decode(&signature_text)
        .map_err(|error| format!("signature-minisign: {error}"))?;

    let public_key_text = String::from_utf8(
        BASE64_STANDARD
            .decode(encoded_public_key.trim())
            .map_err(|error| format!("public-key-base64: {error}"))?,
    )
    .map_err(|error| format!("public-key-utf8: {error}"))?;
    let public_key_line = public_key_text
        .lines()
        .nth(1)
        .ok_or_else(|| "public-key-line-missing".to_owned())?;
    let public_key = PublicKey::from_base64(public_key_line)
        .map_err(|error| format!("public-key-minisign: {error}"))?;
    let mut verifier = public_key
        .verify_stream(&signature)
        .map_err(|error| format!("signature-stream: {error}"))?;
    let mut file =
        BufReader::new(File::open(path).map_err(|error| format!("signature-open: {error}"))?);
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let length = file
            .read(&mut buffer)
            .map_err(|error| format!("signature-read: {error}"))?;
        if length == 0 {
            break;
        }
        verifier.update(&buffer[..length]);
    }
    verifier
        .finalize()
        .map_err(|error| format!("signature-invalid: {error}"))
}

fn inspect_release_history_entry(
    root: &Path,
    updates: &Path,
    version: &str,
    public_key: &str,
) -> ReleaseHistoryEntry {
    let directory = updates.join(version);
    let manifest_path = directory.join("latest.json");
    let manifest = json(&manifest_path);
    let platform = manifest
        .as_ref()
        .and_then(|value| value.pointer("/platforms/windows-x86_64"));
    let download_url = platform
        .and_then(|value| value.get("url"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let published_at = manifest
        .as_ref()
        .and_then(|value| value.get("pub_date"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let url_name = download_url.rsplit('/').next().unwrap_or_default();
    let mut installer_path = directory.join(url_name);
    if !installer_path.is_file() {
        installer_path = fs::read_dir(&directory)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .find(|path| {
                path.extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
            })
            .unwrap_or_default();
    }
    let signature_path = PathBuf::from(format!("{}.sig", installer_path.to_string_lossy()));
    let signature = text(&signature_path).unwrap_or_default().trim().to_owned();
    let installer_sha256 = if installer_path.is_file() {
        sha256(&installer_path).unwrap_or_default()
    } else {
        String::new()
    };
    let installer_size_bytes = installer_path
        .metadata()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let integrity = if installer_path.is_file() && !signature.is_empty() && !public_key.is_empty() {
        verify_updater_signature(&installer_path, &signature, public_key)
    } else {
        Err("signature-prerequisite-missing".to_owned())
    };
    ReleaseHistoryEntry {
        version: version.to_owned(),
        manifest_path: relative(root, &manifest_path),
        installer_path: relative(root, &installer_path),
        installer_size_bytes,
        installer_sha256,
        download_url,
        published_at,
        signature_valid: integrity.is_ok(),
        integrity_error: integrity.err().unwrap_or_default(),
    }
}

#[derive(Clone, Copy)]
struct DependencyTarget {
    id: &'static str,
    ecosystem: &'static str,
    manifest_path: &'static str,
    lockfile_path: &'static str,
}

const DEPENDENCY_TARGETS: [DependencyTarget; 4] = [
    DependencyTarget {
        id: "app-npm",
        ecosystem: "npm",
        manifest_path: "package.json",
        lockfile_path: "package-lock.json",
    },
    DependencyTarget {
        id: "website-npm",
        ecosystem: "npm",
        manifest_path: "website/package.json",
        lockfile_path: "website/package-lock.json",
    },
    DependencyTarget {
        id: "app-cargo",
        ecosystem: "cargo",
        manifest_path: "src-tauri/Cargo.toml",
        lockfile_path: "src-tauri/Cargo.lock",
    },
    DependencyTarget {
        id: "developer-cargo",
        ecosystem: "cargo",
        manifest_path: "developer-tools/src-tauri/Cargo.toml",
        lockfile_path: "developer-tools/src-tauri/Cargo.lock",
    },
];

fn classify_license(license: &str) -> &'static str {
    let normalized = license.trim().to_ascii_uppercase();
    if normalized.is_empty()
        || matches!(
            normalized.as_str(),
            "UNKNOWN" | "UNLICENSED" | "SEE LICENSE" | "NOASSERTION"
        )
    {
        "unknown"
    } else if ["AGPL", "GPL", "LGPL", "MPL", "EPL", "CDDL"]
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        "reciprocal"
    } else {
        "permissive"
    }
}

fn secure_dependency_source(source: &str) -> bool {
    source.is_empty()
        || ["https:", "registry+https:", "git+https:", "file:", "link:"]
            .iter()
            .any(|prefix| source.to_ascii_lowercase().starts_with(prefix))
}

fn npm_package_name(package_path: &str) -> &str {
    package_path
        .rsplit("node_modules/")
        .next()
        .unwrap_or(package_path)
}

#[derive(Debug, Clone, Serialize)]
struct OsvPackage {
    name: String,
    ecosystem: String,
}

#[derive(Debug, Clone, Serialize)]
struct OsvQuery {
    version: String,
    package: OsvPackage,
    #[serde(skip_serializing_if = "Option::is_none")]
    page_token: Option<String>,
}

#[derive(Debug, Clone)]
struct AdvisoryQueryItem {
    ecosystem: String,
    name: String,
    version: String,
    component_ids: Vec<String>,
}

fn advisory_query_items(packages: &[DependencyPackageSummary]) -> Vec<AdvisoryQueryItem> {
    let mut unique = BTreeMap::<String, AdvisoryQueryItem>::new();
    for item in packages {
        let ecosystem = match item.ecosystem.as_str() {
            "npm" => "npm",
            "cargo" => "crates.io",
            _ => continue,
        };
        if item.name.is_empty() || item.version.is_empty() {
            continue;
        }
        let key = format!("{ecosystem}\0{}\0{}", item.name, item.version);
        let query = unique.entry(key).or_insert_with(|| AdvisoryQueryItem {
            ecosystem: ecosystem.into(),
            name: item.name.clone(),
            version: item.version.clone(),
            component_ids: Vec::new(),
        });
        if !query.component_ids.contains(&item.component_id) {
            query.component_ids.push(item.component_id.clone());
        }
    }
    unique.into_values().collect()
}

fn advisory_preview(packages: &[DependencyPackageSummary]) -> AdvisoryQueryPreview {
    let eligible_packages = packages
        .iter()
        .filter(|item| {
            matches!(item.ecosystem.as_str(), "npm" | "cargo")
                && !item.name.is_empty()
                && !item.version.is_empty()
        })
        .count();
    let queries = advisory_query_items(packages);
    let canonical = queries
        .iter()
        .map(|item| format!("{}\0{}\0{}", item.ecosystem, item.name, item.version))
        .collect::<Vec<_>>()
        .join("\n");
    let request_digest = hex::encode_upper(Sha256::digest(canonical.as_bytes()));
    AdvisoryQueryPreview {
        endpoint: OSV_QUERY_ENDPOINT.into(),
        total_packages: packages.len(),
        eligible_packages,
        unique_packages: queries.len(),
        duplicate_packages: eligible_packages.saturating_sub(queries.len()),
        npm_packages: queries
            .iter()
            .filter(|item| item.ecosystem == "npm")
            .count(),
        cargo_packages: queries
            .iter()
            .filter(|item| item.ecosystem == "crates.io")
            .count(),
        request_digest,
        transmitted_fields: vec!["ecosystem".into(), "name".into(), "version".into()],
        includes_paths: false,
        includes_sources: false,
        includes_licenses: false,
    }
}

#[derive(Debug, Serialize)]
struct OsvBatchRequest {
    queries: Vec<OsvQuery>,
}

#[derive(Debug, Deserialize)]
struct OsvBatchResponse {
    #[serde(default)]
    results: Vec<OsvBatchResult>,
}

#[derive(Debug, Deserialize)]
struct OsvBatchResult {
    #[serde(default)]
    vulns: Vec<OsvVulnerability>,
    #[serde(default)]
    next_page_token: String,
}

#[derive(Debug, Deserialize)]
struct OsvVulnerability {
    id: String,
    #[serde(default)]
    modified: String,
}

fn osv_query(item: &AdvisoryQueryItem, page_token: Option<String>) -> OsvQuery {
    OsvQuery {
        version: item.version.clone(),
        package: OsvPackage {
            name: item.name.clone(),
            ecosystem: item.ecosystem.clone(),
        },
        page_token,
    }
}

async fn fetch_osv_batch(
    client: &Client,
    queries: Vec<OsvQuery>,
) -> Result<OsvBatchResponse, String> {
    let mut response = client
        .post(OSV_QUERY_ENDPOINT)
        .json(&OsvBatchRequest { queries })
        .send()
        .await
        .map_err(|error| format!("osv-request: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("osv-http: {}", response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > OSV_MAX_RESPONSE_BYTES as u64)
    {
        return Err("osv-response-too-large".into());
    }
    let mut body = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or_default()
            .min(OSV_MAX_RESPONSE_BYTES as u64) as usize,
    );
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("osv-body: {error}"))?
    {
        if body.len().saturating_add(chunk.len()) > OSV_MAX_RESPONSE_BYTES {
            return Err("osv-response-too-large".into());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|error| format!("osv-json: {error}"))
}

fn append_osv_findings(
    items: &[AdvisoryQueryItem],
    results: &[OsvBatchResult],
    findings: &mut Vec<AdvisoryFinding>,
    seen: &mut HashSet<String>,
) -> Result<Vec<(AdvisoryQueryItem, String)>, String> {
    if items.len() != results.len() {
        return Err(format!(
            "osv-result-count: expected {} got {}",
            items.len(),
            results.len()
        ));
    }
    let mut continuation = Vec::new();
    for (item, result) in items.iter().zip(results) {
        for vulnerability in &result.vulns {
            let key = format!(
                "{}\0{}\0{}\0{}",
                item.ecosystem, item.name, item.version, vulnerability.id
            );
            if seen.insert(key) {
                findings.push(AdvisoryFinding {
                    component_ids: item.component_ids.clone(),
                    ecosystem: item.ecosystem.clone(),
                    name: item.name.clone(),
                    version: item.version.clone(),
                    advisory_id: vulnerability.id.clone(),
                    modified: vulnerability.modified.clone(),
                });
            }
        }
        if !result.next_page_token.is_empty() {
            continuation.push((item.clone(), result.next_page_token.clone()));
        }
    }
    Ok(continuation)
}

async fn scan_advisories(inventory: &DependencyInventory) -> Result<AdvisoryScanResult, String> {
    let items = advisory_query_items(&inventory.packages);
    let client = Client::builder()
        .https_only(true)
        .redirect(Policy::none())
        .timeout(Duration::from_secs(25))
        .user_agent("Minecraft-Server-Hub-Developer-Tools/0.1")
        .build()
        .map_err(|error| format!("osv-client: {error}"))?;
    let mut findings = Vec::new();
    let mut seen = HashSet::new();
    let mut complete = true;
    for chunk in items.chunks(OSV_BATCH_SIZE) {
        let initial_queries = chunk.iter().map(|item| osv_query(item, None)).collect();
        let response = fetch_osv_batch(&client, initial_queries).await?;
        let mut continuation =
            append_osv_findings(chunk, &response.results, &mut findings, &mut seen)?;
        for _ in 0..8 {
            if continuation.is_empty() {
                break;
            }
            let continued_items = continuation
                .iter()
                .map(|(item, _)| item.clone())
                .collect::<Vec<_>>();
            let continued_queries = continuation
                .iter()
                .map(|(item, token)| osv_query(item, Some(token.clone())))
                .collect::<Vec<_>>();
            let response = fetch_osv_batch(&client, continued_queries).await?;
            continuation = append_osv_findings(
                &continued_items,
                &response.results,
                &mut findings,
                &mut seen,
            )?;
        }
        if !continuation.is_empty() {
            complete = false;
        }
    }
    findings.sort_by(|left, right| {
        left.ecosystem
            .cmp(&right.ecosystem)
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.version.cmp(&right.version))
            .then_with(|| left.advisory_id.cmp(&right.advisory_id))
    });
    let affected_packages = findings
        .iter()
        .map(|item| format!("{}\0{}\0{}", item.ecosystem, item.name, item.version))
        .collect::<HashSet<_>>()
        .len();
    let vulnerability_count = findings
        .iter()
        .map(|item| item.advisory_id.as_str())
        .collect::<HashSet<_>>()
        .len();
    Ok(AdvisoryScanResult {
        scanned_at: Utc::now().to_rfc3339(),
        endpoint: OSV_QUERY_ENDPOINT.into(),
        request_digest: inventory.advisory_preview.request_digest.clone(),
        queried_packages: items.len(),
        affected_packages,
        vulnerability_count,
        complete,
        findings,
    })
}

fn empty_dependency_summary(target: DependencyTarget) -> DependencyLockfileSummary {
    DependencyLockfileSummary {
        id: target.id.into(),
        ecosystem: target.ecosystem.into(),
        manifest_path: target.manifest_path.into(),
        lockfile_path: target.lockfile_path.into(),
        present: false,
        package_count: 0,
        direct_count: 0,
        development_count: 0,
        unknown_license_count: 0,
        reciprocal_license_count: 0,
        insecure_source_count: 0,
        missing_integrity_count: 0,
        licenses: Vec::new(),
    }
}

fn license_breakdown(packages: &[DependencyPackageSummary]) -> Vec<LicenseCount> {
    let mut counts = BTreeMap::<String, usize>::new();
    for package in packages {
        let license = if package.license.is_empty() {
            "Unknown"
        } else {
            &package.license
        };
        *counts.entry(license.into()).or_default() += 1;
    }
    let mut result = counts
        .into_iter()
        .map(|(name, count)| LicenseCount { name, count })
        .collect::<Vec<_>>();
    result.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.name.cmp(&right.name))
    });
    result.truncate(8);
    result
}

fn dependency_summary(
    target: DependencyTarget,
    packages: &[DependencyPackageSummary],
) -> DependencyLockfileSummary {
    DependencyLockfileSummary {
        id: target.id.into(),
        ecosystem: target.ecosystem.into(),
        manifest_path: target.manifest_path.into(),
        lockfile_path: target.lockfile_path.into(),
        present: true,
        package_count: packages.len(),
        direct_count: packages.iter().filter(|item| item.direct).count(),
        development_count: packages.iter().filter(|item| item.development).count(),
        unknown_license_count: packages
            .iter()
            .filter(|item| item.license_class == "unknown")
            .count(),
        reciprocal_license_count: packages
            .iter()
            .filter(|item| item.license_class == "reciprocal")
            .count(),
        insecure_source_count: packages
            .iter()
            .filter(|item| !secure_dependency_source(&item.source))
            .count(),
        missing_integrity_count: packages
            .iter()
            .filter(|item| !item.integrity_present)
            .count(),
        licenses: license_breakdown(packages),
    }
}

fn npm_platform_constraint(value: &Value, field: &str, current: &str) -> (bool, bool) {
    let values = match value.get(field) {
        Some(Value::Array(values)) => values.iter().filter_map(Value::as_str).collect::<Vec<_>>(),
        Some(Value::String(value)) => vec![value.as_str()],
        _ => Vec::new(),
    };
    if values.is_empty() {
        return (false, true);
    }
    let denied = values.iter().any(|value| {
        value
            .strip_prefix('!')
            .is_some_and(|value| value == current)
    });
    if denied {
        return (true, false);
    }
    let positive = values
        .iter()
        .filter(|value| !value.starts_with('!'))
        .collect::<Vec<_>>();
    (
        true,
        positive.is_empty() || positive.iter().any(|value| **value == current),
    )
}

fn npm_host_applicability(value: &Value) -> (String, String) {
    let (os_present, os_allowed) = npm_platform_constraint(value, "os", "win32");
    let (cpu_present, cpu_allowed) = npm_platform_constraint(value, "cpu", "x64");
    if !os_allowed || !cpu_allowed {
        let reason = match (!os_allowed, !cpu_allowed) {
            (true, true) => "npm-os-cpu-excluded",
            (true, false) => "npm-os-excluded",
            (false, true) => "npm-cpu-excluded",
            (false, false) => unreachable!(),
        };
        return ("excluded".into(), reason.into());
    }
    (
        "applicable".into(),
        if os_present || cpu_present {
            "npm-platform-compatible"
        } else {
            "npm-no-platform-restriction"
        }
        .into(),
    )
}

fn inspect_npm_lockfile(
    root: &Path,
    target: DependencyTarget,
) -> (DependencyLockfileSummary, Vec<DependencyPackageSummary>) {
    let Some(manifest) = json(&root.join(target.manifest_path)) else {
        return (empty_dependency_summary(target), Vec::new());
    };
    let Some(lock) = json(&root.join(target.lockfile_path)) else {
        return (empty_dependency_summary(target), Vec::new());
    };
    let Some(lock_packages) = lock.get("packages").and_then(Value::as_object) else {
        return (empty_dependency_summary(target), Vec::new());
    };
    let direct = manifest
        .get("dependencies")
        .and_then(Value::as_object)
        .map(|items| items.keys().cloned().collect::<HashSet<_>>())
        .unwrap_or_default();
    let development = manifest
        .get("devDependencies")
        .and_then(Value::as_object)
        .map(|items| items.keys().cloned().collect::<HashSet<_>>())
        .unwrap_or_default();
    let packages = lock_packages
        .iter()
        .filter(|(package_path, _)| !package_path.is_empty())
        .map(|(package_path, value)| {
            let name = npm_package_name(package_path).to_owned();
            let (host_applicability, applicability_reason) = npm_host_applicability(value);
            let license = value
                .get("license")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_owned();
            let source = value
                .get("resolved")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let integrity = value
                .get("integrity")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let integrity_present = !integrity.is_empty()
                || value.get("link").and_then(Value::as_bool).unwrap_or(false);
            let license_class = classify_license(&license).to_owned();
            let mut reasons = Vec::new();
            if license_class == "unknown" {
                reasons.push("unknown-license");
            }
            if license_class == "reciprocal" {
                reasons.push("reciprocal-license");
            }
            if !secure_dependency_source(&source) {
                reasons.push("insecure-source");
            }
            if !integrity_present {
                reasons.push("missing-integrity");
            }
            DependencyPackageSummary {
                component_id: target.id.into(),
                ecosystem: "npm".into(),
                version: value
                    .get("version")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into(),
                direct: direct.contains(&name) || development.contains(&name),
                development: development.contains(&name),
                name,
                license,
                license_class,
                source,
                integrity,
                integrity_present,
                reason: reasons.join(","),
                host_applicability,
                applicability_reason,
            }
        })
        .collect::<Vec<_>>();
    (dependency_summary(target, &packages), packages)
}

#[derive(Debug)]
struct CargoLockedPackage {
    name: String,
    version: String,
    source: String,
    checksum: String,
}

fn quoted_toml_value(block: &str, key: &str) -> String {
    block
        .lines()
        .find_map(|line| {
            let line = line.trim();
            let value = line
                .strip_prefix(key)?
                .trim_start()
                .strip_prefix('=')?
                .trim();
            value
                .strip_prefix('"')
                .and_then(|value| value.strip_suffix('"'))
                .map(str::to_owned)
        })
        .unwrap_or_default()
}

fn parse_cargo_packages(source: &str) -> Vec<CargoLockedPackage> {
    source
        .split("[[package]]")
        .skip(1)
        .filter_map(|block| {
            let name = quoted_toml_value(block, "name");
            let version = quoted_toml_value(block, "version");
            (!name.is_empty() && !version.is_empty()).then(|| CargoLockedPackage {
                name,
                version,
                source: quoted_toml_value(block, "source"),
                checksum: quoted_toml_value(block, "checksum"),
            })
        })
        .collect()
}

fn cargo_package_key(name: &str, version: &str, source: &str) -> String {
    format!("{name}\0{version}\0{source}")
}

fn cargo_windows_x64_resolution(root: &Path, manifest_path: &str) -> Option<HashSet<String>> {
    let mut command = Command::new("cargo");
    command
        .current_dir(root)
        .env("CARGO_NET_OFFLINE", "true")
        .args([
            "metadata",
            "--format-version",
            "1",
            "--locked",
            "--offline",
            "--filter-platform",
            CARGO_WINDOWS_X64_TARGET,
            "--manifest-path",
        ])
        .arg(root.join(manifest_path));
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let metadata = serde_json::from_slice::<Value>(&output.stdout).ok()?;
    Some(
        metadata
            .get("packages")?
            .as_array()?
            .iter()
            .filter_map(|package| {
                let name = package.get("name")?.as_str()?;
                let version = package.get("version")?.as_str()?;
                let source = package
                    .get("source")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                Some(cargo_package_key(name, version, source))
            })
            .collect(),
    )
}

fn cargo_host_applicability(
    package: &CargoLockedPackage,
    resolution: Option<&HashSet<String>>,
) -> (String, String) {
    let Some(resolution) = resolution else {
        return ("unknown".into(), "cargo-metadata-unavailable".into());
    };
    if resolution.contains(&cargo_package_key(
        &package.name,
        &package.version,
        &package.source,
    )) {
        (
            "applicable".into(),
            "cargo-metadata-windows-x64-applicable".into(),
        )
    } else {
        (
            "excluded".into(),
            "cargo-metadata-windows-x64-excluded".into(),
        )
    }
}

fn parse_cargo_direct_dependencies(source: &str) -> (HashSet<String>, HashSet<String>) {
    let mut normal = HashSet::new();
    let mut development = HashSet::new();
    let mut section = String::new();
    let package_override = Regex::new(r#"\bpackage\s*=\s*"([^"]+)""#).unwrap();
    let dependency = Regex::new(r"^([A-Za-z0-9_-]+)\s*=\s*(.+)$").unwrap();
    for raw_line in source.lines() {
        let line = raw_line.split('#').next().unwrap_or_default().trim();
        if let Some(value) = line
            .strip_prefix('[')
            .and_then(|line| line.strip_suffix(']'))
        {
            section = value.into();
            continue;
        }
        if !section.ends_with("dependencies") {
            continue;
        }
        let Some(captures) = dependency.captures(line) else {
            continue;
        };
        let name = package_override
            .captures(
                captures
                    .get(2)
                    .map(|value| value.as_str())
                    .unwrap_or_default(),
            )
            .and_then(|captures| captures.get(1))
            .or_else(|| captures.get(1))
            .map(|value| value.as_str().to_owned())
            .unwrap_or_default();
        if section.ends_with("dev-dependencies") {
            development.insert(name);
        } else {
            normal.insert(name);
        }
    }
    (normal, development)
}

fn cargo_home_path() -> Option<PathBuf> {
    env::var_os("CARGO_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join(".cargo")))
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".cargo")))
}

fn cargo_registry_roots() -> Vec<PathBuf> {
    cargo_home_path()
        .and_then(|home| fs::read_dir(home.join("registry/src")).ok())
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .map(|entry| entry.path())
        .collect()
}

fn cargo_cache_roots() -> Vec<PathBuf> {
    cargo_home_path()
        .and_then(|home| fs::read_dir(home.join("registry/cache")).ok())
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .map(|entry| entry.path())
        .collect()
}

fn cargo_git_checkout_roots() -> Vec<PathBuf> {
    const MAX_REPOSITORIES: usize = 256;
    cargo_home_path()
        .and_then(|home| fs::read_dir(home.join("git/checkouts")).ok())
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .take(MAX_REPOSITORIES)
        .map(|entry| entry.path())
        .collect()
}

fn cargo_package_license(
    registry_roots: &[PathBuf],
    cache: &mut HashMap<(String, String), String>,
    name: &str,
    version: &str,
) -> String {
    let key = (name.to_owned(), version.to_owned());
    if let Some(license) = cache.get(&key) {
        return license.clone();
    }
    let mut license = String::new();
    for root in registry_roots {
        let Some(manifest) = text(&root.join(format!("{name}-{version}")).join("Cargo.toml"))
        else {
            continue;
        };
        license = manifest
            .lines()
            .find_map(|line| {
                let line = line.trim();
                let value = line
                    .strip_prefix("license")?
                    .trim_start()
                    .strip_prefix('=')?
                    .trim();
                value
                    .strip_prefix('"')
                    .and_then(|value| value.strip_suffix('"'))
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| {
                if manifest
                    .lines()
                    .any(|line| line.trim().starts_with("license-file"))
                {
                    "SEE LICENSE".into()
                } else {
                    String::new()
                }
            });
        break;
    }
    cache.insert(key, license.clone());
    license
}

fn inspect_cargo_lockfile(
    root: &Path,
    target: DependencyTarget,
    registry_roots: &[PathBuf],
    license_cache: &mut HashMap<(String, String), String>,
) -> (DependencyLockfileSummary, Vec<DependencyPackageSummary>) {
    let Some(manifest) = text(&root.join(target.manifest_path)) else {
        return (empty_dependency_summary(target), Vec::new());
    };
    let Some(lock) = text(&root.join(target.lockfile_path)) else {
        return (empty_dependency_summary(target), Vec::new());
    };
    let (normal, development) = parse_cargo_direct_dependencies(&manifest);
    let cargo_resolution = cargo_windows_x64_resolution(root, target.manifest_path);
    let packages = parse_cargo_packages(&lock)
        .into_iter()
        .filter(|item| !item.source.is_empty())
        .map(|item| {
            let (host_applicability, applicability_reason) =
                cargo_host_applicability(&item, cargo_resolution.as_ref());
            let license =
                cargo_package_license(registry_roots, license_cache, &item.name, &item.version);
            let license_class = classify_license(&license).to_owned();
            let integrity_present =
                !item.source.starts_with("registry+") || !item.checksum.is_empty();
            let mut reasons = Vec::new();
            if license_class == "unknown" {
                reasons.push("unknown-license");
            }
            if license_class == "reciprocal" {
                reasons.push("reciprocal-license");
            }
            if !secure_dependency_source(&item.source) {
                reasons.push("insecure-source");
            }
            if !integrity_present {
                reasons.push("missing-integrity");
            }
            DependencyPackageSummary {
                component_id: target.id.into(),
                ecosystem: "cargo".into(),
                direct: normal.contains(&item.name) || development.contains(&item.name),
                development: development.contains(&item.name),
                name: item.name,
                version: item.version,
                license,
                license_class,
                source: item.source,
                integrity: item.checksum,
                integrity_present,
                reason: reasons.join(","),
                host_applicability,
                applicability_reason,
            }
        })
        .collect::<Vec<_>>();
    (dependency_summary(target, &packages), packages)
}

fn inspect_dependency_inventory(root: &Path) -> DependencyInventory {
    let registry_roots = cargo_registry_roots();
    let mut license_cache = HashMap::new();
    let mut lockfiles = Vec::new();
    let mut packages = Vec::new();
    for target in DEPENDENCY_TARGETS {
        let (summary, mut inspected_packages) = if target.ecosystem == "npm" {
            inspect_npm_lockfile(root, target)
        } else {
            inspect_cargo_lockfile(root, target, &registry_roots, &mut license_cache)
        };
        lockfiles.push(summary);
        packages.append(&mut inspected_packages);
    }
    let totals = DependencyTotals {
        lockfiles: lockfiles.iter().filter(|item| item.present).count(),
        packages: packages.len(),
        direct: packages.iter().filter(|item| item.direct).count(),
        development: packages.iter().filter(|item| item.development).count(),
        unknown_license: packages
            .iter()
            .filter(|item| item.license_class == "unknown")
            .count(),
        reciprocal_license: packages
            .iter()
            .filter(|item| item.license_class == "reciprocal")
            .count(),
        insecure_source: packages
            .iter()
            .filter(|item| !secure_dependency_source(&item.source))
            .count(),
        missing_integrity: packages
            .iter()
            .filter(|item| !item.integrity_present)
            .count(),
    };
    let advisory_preview = advisory_preview(&packages);
    let mut review_packages = packages
        .iter()
        .filter(|item| !item.reason.is_empty() || item.direct)
        .cloned()
        .collect::<Vec<_>>();
    review_packages.sort_by(|left, right| {
        (!right.reason.is_empty())
            .cmp(&(!left.reason.is_empty()))
            .then_with(|| right.direct.cmp(&left.direct))
            .then_with(|| left.name.cmp(&right.name))
    });
    review_packages.truncate(60);
    DependencyInventory {
        generated_from_lockfiles: lockfiles.iter().all(|item| item.present),
        lockfiles,
        totals,
        packages,
        review_packages,
        advisory_preview,
        advisory_scan: AdvisoryScan {
            checked: false,
            mode: "offline".into(),
            reason: "network-consent-required".into(),
        },
    }
}

#[derive(Debug, Clone)]
struct LicenseEvidenceTarget {
    package: DependencyPackageSummary,
    component_ids: Vec<String>,
}

fn license_evidence_targets(packages: &[DependencyPackageSummary]) -> Vec<LicenseEvidenceTarget> {
    let mut targets = BTreeMap::<String, LicenseEvidenceTarget>::new();
    for package in packages
        .iter()
        .filter(|package| package.license_class != "permissive")
    {
        let key = [
            package.ecosystem.as_str(),
            package.name.as_str(),
            package.version.as_str(),
            package.license.as_str(),
            package.source.as_str(),
            package.integrity.as_str(),
        ]
        .join("\0");
        let target = targets.entry(key).or_insert_with(|| LicenseEvidenceTarget {
            package: package.clone(),
            component_ids: Vec::new(),
        });
        let merged_applicability = match (
            target.package.host_applicability.as_str(),
            package.host_applicability.as_str(),
        ) {
            ("applicable", _) | (_, "applicable") => "applicable",
            ("excluded", "excluded") => "excluded",
            _ => "unknown",
        };
        target.package.host_applicability = merged_applicability.into();
        if !package.applicability_reason.is_empty()
            && !target
                .package
                .applicability_reason
                .split(',')
                .any(|reason| reason == package.applicability_reason)
        {
            if !target.package.applicability_reason.is_empty() {
                target.package.applicability_reason.push(',');
            }
            target
                .package
                .applicability_reason
                .push_str(&package.applicability_reason);
        }
        if !target.component_ids.contains(&package.component_id) {
            target.component_ids.push(package.component_id.clone());
        }
    }
    targets
        .into_values()
        .map(|mut target| {
            target.component_ids.sort();
            target
        })
        .collect()
}

fn evidence_file_kind(name: &str) -> Option<&'static str> {
    let normalized = name.to_ascii_lowercase();
    if normalized.starts_with("license") || normalized.starts_with("licence") {
        Some("license")
    } else if normalized.starts_with("notice") {
        Some("notice")
    } else if normalized.starts_with("copying") || normalized.starts_with("copyright") {
        Some("copying")
    } else if normalized.starts_with("authors") || normalized.starts_with("contributors") {
        Some("authors")
    } else {
        None
    }
}

fn collect_evidence_files(package_root: &Path) -> Vec<LicenseEvidenceFile> {
    const MAX_EVIDENCE_FILE_BYTES: u64 = 2 * 1024 * 1024;
    const MAX_EVIDENCE_FILES: usize = 16;
    let mut candidates = Vec::<(PathBuf, String, String)>::new();
    let Ok(entries) = fs::read_dir(package_root) else {
        return Vec::new();
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if kind.is_file() {
            if let Some(evidence_kind) = evidence_file_kind(&name) {
                candidates.push((entry.path(), name, evidence_kind.into()));
            }
        } else if kind.is_dir() && name.eq_ignore_ascii_case("licenses") {
            let Ok(nested) = fs::read_dir(entry.path()) else {
                continue;
            };
            for file in nested.flatten() {
                if !file
                    .file_type()
                    .map(|value| value.is_file())
                    .unwrap_or(false)
                {
                    continue;
                }
                let file_name = file.file_name().to_string_lossy().into_owned();
                let evidence_kind = evidence_file_kind(&file_name).unwrap_or("other");
                candidates.push((
                    file.path(),
                    format!("{name}/{file_name}"),
                    evidence_kind.into(),
                ));
            }
        }
    }
    candidates.sort_by(|left, right| left.1.cmp(&right.1));
    candidates
        .into_iter()
        .take(MAX_EVIDENCE_FILES)
        .filter_map(|(path, name, kind)| {
            let metadata = fs::metadata(&path).ok()?;
            if metadata.len() > MAX_EVIDENCE_FILE_BYTES {
                return None;
            }
            Some(LicenseEvidenceFile {
                name,
                kind,
                size_bytes: metadata.len(),
                sha256: sha256(&path).ok()?,
            })
        })
        .collect()
}

fn collect_mpl_source_header(package_root: &Path) -> Option<LicenseEvidenceFile> {
    const MAX_SOURCE_HEADER_BYTES: u64 = 2 * 1024 * 1024;
    for logical_name in ["lib.rs", "src/lib.rs"] {
        let path = package_root.join(logical_name);
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.len() == 0 || metadata.len() > MAX_SOURCE_HEADER_BYTES {
            continue;
        }
        let mut source = String::new();
        let Ok(file) = File::open(&path) else {
            continue;
        };
        if file.take(8 * 1024).read_to_string(&mut source).is_err() {
            continue;
        }
        let normalized = source.replace("\r\n", "\n");
        if !normalized.contains(MPL_2_0_HEADER) {
            continue;
        }
        return Some(LicenseEvidenceFile {
            name: logical_name.into(),
            kind: "license-header".into(),
            size_bytes: metadata.len(),
            sha256: match sha256(&path) {
                Ok(value) => value,
                Err(_) => continue,
            },
        });
    }
    None
}

fn canonical_mpl_2_0_evidence() -> Option<CanonicalLicenseEvidence> {
    let sha256 = hex::encode_upper(Sha256::digest(MPL_2_0_TEXT.as_bytes()));
    if sha256 != MPL_2_0_TEXT_SHA256 {
        return None;
    }
    Some(CanonicalLicenseEvidence {
        spdx_id: "MPL-2.0".into(),
        source_url: MPL_2_0_SOURCE_URL.into(),
        local_resource: "embedded/MPL-2.0.txt".into(),
        size_bytes: MPL_2_0_TEXT.len(),
        sha256,
    })
}

fn manifest_license_from_cargo(manifest: &str) -> String {
    manifest
        .lines()
        .find_map(|line| {
            let line = line.trim();
            let value = line
                .strip_prefix("license")?
                .trim_start()
                .strip_prefix('=')?
                .trim();
            value
                .strip_prefix('"')
                .and_then(|value| value.strip_suffix('"'))
                .map(str::to_owned)
        })
        .unwrap_or_else(|| {
            if manifest
                .lines()
                .any(|line| line.trim().starts_with("license-file"))
            {
                "SEE LICENSE".into()
            } else {
                String::new()
            }
        })
}

fn cargo_archive_integrity(
    cache_roots: &[PathBuf],
    name: &str,
    version: &str,
    expected: &str,
) -> String {
    if expected.is_empty() {
        return "unavailable".into();
    }
    let archive_name = format!("{name}-{version}.crate");
    for root in cache_roots {
        let archive = root.join(&archive_name);
        if !archive.is_file() {
            continue;
        }
        return match sha256(&archive) {
            Ok(actual) if actual.eq_ignore_ascii_case(expected) => "verified".into(),
            Ok(_) => "mismatch".into(),
            Err(_) => "unavailable".into(),
        };
    }
    "unavailable".into()
}

fn locked_cargo_git_revision(source: &str) -> Option<String> {
    if !source.starts_with("git+") {
        return None;
    }
    let (_, revision) = source.rsplit_once('#')?;
    if revision.len() != 40 || !revision.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(revision.to_ascii_lowercase())
}

fn bounded_text(path: &Path, max_bytes: u64) -> Option<String> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.file_type().is_file() || metadata.len() > max_bytes {
        return None;
    }
    fs::read_to_string(path).ok()
}

fn safe_git_reference(reference: &str) -> bool {
    reference.starts_with("refs/")
        && reference.len() <= 512
        && reference
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
        && reference
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'.' | b'_' | b'-'))
}

fn cargo_git_checkout_head(checkout: &Path) -> Option<String> {
    const MAX_GIT_METADATA_BYTES: u64 = 64 * 1024;
    let git_dir = checkout.join(".git");
    if !fs::symlink_metadata(&git_dir)
        .ok()
        .is_some_and(|metadata| metadata.file_type().is_dir())
    {
        return None;
    }
    let head = bounded_text(&git_dir.join("HEAD"), MAX_GIT_METADATA_BYTES)?;
    let head = head.trim();
    if head.len() == 40 && head.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Some(head.to_ascii_lowercase());
    }
    let reference = head.strip_prefix("ref: ")?;
    if !safe_git_reference(reference) {
        return None;
    }
    let resolved = bounded_text(&git_dir.join(reference), MAX_GIT_METADATA_BYTES)?;
    let resolved = resolved.trim();
    (resolved.len() == 40 && resolved.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| resolved.to_ascii_lowercase())
}

fn cargo_manifest_string(manifest: &str, section: &str, key: &str) -> Option<String> {
    let mut current_section = "";
    for line in manifest.lines() {
        let line = line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            current_section = line.trim_matches(['[', ']']).trim();
            continue;
        }
        if current_section != section || line.starts_with('#') {
            continue;
        }
        let Some((candidate, value)) = line.split_once('=') else {
            continue;
        };
        if candidate.trim() != key {
            continue;
        }
        let value = value.trim();
        return value
            .strip_prefix('"')
            .and_then(|value| value.split_once('"').map(|(value, _)| value.to_owned()));
    }
    None
}

fn cargo_manifest_uses_workspace_version(manifest: &str) -> bool {
    let mut current_section = "";
    for line in manifest.lines() {
        let line = line.trim();
        if line.starts_with('[') && line.ends_with(']') {
            current_section = line.trim_matches(['[', ']']).trim();
            continue;
        }
        if current_section != "package" || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        if key.trim() == "version.workspace" && value.trim() == "true" {
            return true;
        }
    }
    false
}

fn find_cargo_git_package(checkout: &Path, name: &str, version: &str) -> Option<(PathBuf, String)> {
    const MAX_DEPTH: usize = 4;
    const MAX_VISITED_ENTRIES: usize = 4_096;
    const MAX_MANIFEST_BYTES: u64 = 2 * 1024 * 1024;
    let workspace_manifest = bounded_text(&checkout.join("Cargo.toml"), MAX_MANIFEST_BYTES);
    let workspace_version = workspace_manifest
        .as_deref()
        .and_then(|manifest| cargo_manifest_string(manifest, "workspace.package", "version"));
    let mut queue = VecDeque::from([(checkout.to_path_buf(), 0usize)]);
    let mut visited = 0usize;
    while let Some((directory, depth)) = queue.pop_front() {
        let manifest_path = directory.join("Cargo.toml");
        if let Some(manifest) = bounded_text(&manifest_path, MAX_MANIFEST_BYTES) {
            let manifest_name = cargo_manifest_string(&manifest, "package", "name");
            let manifest_version =
                cargo_manifest_string(&manifest, "package", "version").or_else(|| {
                    cargo_manifest_uses_workspace_version(&manifest)
                        .then(|| workspace_version.clone())
                        .flatten()
                });
            if manifest_name.as_deref() == Some(name)
                && manifest_version.as_deref() == Some(version)
            {
                return Some((directory, manifest));
            }
        }
        if depth >= MAX_DEPTH {
            continue;
        }
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        let mut children = entries
            .flatten()
            .filter(|entry| {
                entry
                    .file_type()
                    .map(|kind| kind.is_dir() && !kind.is_symlink())
                    .unwrap_or(false)
            })
            .filter(|entry| {
                let name = entry.file_name();
                name != ".git" && name != "target"
            })
            .map(|entry| entry.path())
            .collect::<Vec<_>>();
        children.sort();
        for child in children {
            visited += 1;
            if visited > MAX_VISITED_ENTRIES {
                return None;
            }
            queue.push_back((child, depth + 1));
        }
    }
    None
}

fn cargo_git_evidence_location(
    checkout_roots: &[PathBuf],
    name: &str,
    version: &str,
    source: &str,
) -> Option<(PathBuf, PathBuf, String, String)> {
    const MAX_CHECKOUTS_PER_REPOSITORY: usize = 256;
    let revision = locked_cargo_git_revision(source)?;
    for repository in checkout_roots {
        let Ok(entries) = fs::read_dir(repository) else {
            continue;
        };
        let mut checkouts = entries
            .flatten()
            .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
            .take(MAX_CHECKOUTS_PER_REPOSITORY)
            .map(|entry| entry.path())
            .collect::<Vec<_>>();
        checkouts.sort();
        for checkout in checkouts {
            if cargo_git_checkout_head(&checkout).as_deref() != Some(revision.as_str()) {
                continue;
            }
            let Some((package_root, manifest)) = find_cargo_git_package(&checkout, name, version)
            else {
                continue;
            };
            let relative = package_root
                .strip_prefix(&checkout)
                .ok()
                .map(|path| path.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            let manifest_source = if relative.is_empty() {
                "cargo-git-checkout/Cargo.toml".into()
            } else {
                format!("cargo-git-checkout/{relative}/Cargo.toml")
            };
            return Some((package_root, checkout, manifest, manifest_source));
        }
    }
    None
}

fn npm_component_root<'a>(workspace: &'a Path, component_id: &str) -> Option<PathBuf> {
    match component_id {
        "app-npm" => Some(workspace.to_path_buf()),
        "website-npm" => Some(workspace.join("website")),
        _ => None,
    }
}

fn collect_npm_license_evidence(
    workspace: &Path,
    target: &LicenseEvidenceTarget,
) -> LicenseEvidenceItem {
    let package = &target.package;
    let mut selected_root = None;
    let mut manifest_license = String::new();
    let mut manifest_source = String::new();
    let mut mismatch_reason = String::new();
    for component_id in &target.component_ids {
        let Some(component_root) = npm_component_root(workspace, component_id) else {
            continue;
        };
        let package_root = component_root.join("node_modules").join(&package.name);
        let Some(manifest) = json(&package_root.join("package.json")) else {
            continue;
        };
        let actual_version = manifest
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if actual_version != package.version {
            mismatch_reason = "manifest-version-mismatch".into();
            continue;
        }
        manifest_license = manifest
            .get("license")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_owned();
        manifest_source = format!("{component_id}/node_modules/package.json");
        selected_root = Some(package_root);
        break;
    }
    let files = selected_root
        .as_deref()
        .map(collect_evidence_files)
        .unwrap_or_default();
    let license_mismatch = !package.license.is_empty()
        && !manifest_license.is_empty()
        && package.license.trim() != manifest_license.trim();
    let (status, reason) = if selected_root.is_none() {
        if mismatch_reason.is_empty() {
            ("missing", "local-manifest-missing")
        } else {
            ("mismatch", mismatch_reason.as_str())
        }
    } else if license_mismatch {
        ("mismatch", "manifest-license-mismatch")
    } else if files.is_empty() {
        ("partial", "license-file-missing")
    } else {
        ("complete", "local-evidence-complete")
    };
    LicenseEvidenceItem {
        ecosystem: package.ecosystem.clone(),
        name: package.name.clone(),
        version: package.version.clone(),
        component_ids: target.component_ids.clone(),
        declared_license: package.license.clone(),
        manifest_license,
        manifest_source,
        status: status.into(),
        integrity: "unavailable".into(),
        host_applicability: package.host_applicability.clone(),
        applicability_reason: package.applicability_reason.clone(),
        files,
        canonical_license: None,
        reason: reason.into(),
    }
}

fn collect_cargo_license_evidence(
    target: &LicenseEvidenceTarget,
    registry_roots: &[PathBuf],
    cache_roots: &[PathBuf],
    git_checkout_roots: &[PathBuf],
) -> LicenseEvidenceItem {
    let package = &target.package;
    let git_location = cargo_git_evidence_location(
        git_checkout_roots,
        &package.name,
        &package.version,
        &package.source,
    );
    let registry_root = (!package.source.starts_with("git+"))
        .then(|| {
            registry_roots
                .iter()
                .map(|root| root.join(format!("{}-{}", package.name, package.version)))
                .find(|candidate| candidate.join("Cargo.toml").is_file())
        })
        .flatten();
    let package_root = git_location
        .as_ref()
        .map(|(package_root, _, _, _)| package_root.clone())
        .or(registry_root);
    let manifest = git_location
        .as_ref()
        .map(|(_, _, manifest, _)| manifest.clone())
        .or_else(|| {
            package_root
                .as_deref()
                .and_then(|root| text(&root.join("Cargo.toml")))
        });
    let manifest_license = manifest
        .as_deref()
        .map(manifest_license_from_cargo)
        .unwrap_or_default();
    let mut files = package_root
        .as_deref()
        .map(collect_evidence_files)
        .unwrap_or_default();
    if files.is_empty() {
        if let Some((_, checkout_root, _, _)) = &git_location {
            files = collect_evidence_files(checkout_root);
        }
    }
    let mut canonical_license = None;
    let mut source_header_supplemented = false;
    if files.is_empty() && manifest_license.trim() == "MPL-2.0" {
        if let Some(package_root) = package_root.as_deref() {
            if let (Some(header), Some(canonical)) = (
                collect_mpl_source_header(package_root),
                canonical_mpl_2_0_evidence(),
            ) {
                files.push(header);
                canonical_license = Some(canonical);
                source_header_supplemented = true;
            }
        }
    }
    let integrity = if git_location.is_some() {
        "verified".into()
    } else if package.source.starts_with("git+") {
        "unavailable".into()
    } else {
        cargo_archive_integrity(
            cache_roots,
            &package.name,
            &package.version,
            &package.integrity,
        )
    };
    let license_mismatch = !package.license.is_empty()
        && !manifest_license.is_empty()
        && package.license.trim() != manifest_license.trim();
    let (status, reason) = if package_root.is_none() {
        ("missing", "local-manifest-missing")
    } else if integrity == "mismatch" {
        ("mismatch", "archive-integrity-mismatch")
    } else if license_mismatch {
        ("mismatch", "manifest-license-mismatch")
    } else if files.is_empty() {
        ("partial", "license-file-missing")
    } else if source_header_supplemented {
        ("complete", "source-header-canonical-license-complete")
    } else {
        ("complete", "local-evidence-complete")
    };
    LicenseEvidenceItem {
        ecosystem: package.ecosystem.clone(),
        name: package.name.clone(),
        version: package.version.clone(),
        component_ids: target.component_ids.clone(),
        declared_license: package.license.clone(),
        manifest_license,
        manifest_source: git_location
            .as_ref()
            .map(|(_, _, _, source)| source.clone())
            .or_else(|| {
                manifest
                    .as_ref()
                    .map(|_| "cargo-registry/Cargo.toml".into())
            })
            .unwrap_or_default(),
        status: status.into(),
        integrity,
        host_applicability: package.host_applicability.clone(),
        applicability_reason: package.applicability_reason.clone(),
        files,
        canonical_license,
        reason: reason.into(),
    }
}

fn collect_license_evidence_local(
    workspace: &Path,
    inventory: &DependencyInventory,
) -> LicenseEvidenceReport {
    let registry_roots = cargo_registry_roots();
    let cache_roots = cargo_cache_roots();
    let git_checkout_roots = cargo_git_checkout_roots();
    let mut items = license_evidence_targets(&inventory.packages)
        .iter()
        .map(|target| match target.package.ecosystem.as_str() {
            "npm" => collect_npm_license_evidence(workspace, target),
            "cargo" => collect_cargo_license_evidence(
                target,
                &registry_roots,
                &cache_roots,
                &git_checkout_roots,
            ),
            _ => LicenseEvidenceItem {
                ecosystem: target.package.ecosystem.clone(),
                name: target.package.name.clone(),
                version: target.package.version.clone(),
                component_ids: target.component_ids.clone(),
                declared_license: target.package.license.clone(),
                manifest_license: String::new(),
                manifest_source: String::new(),
                status: "missing".into(),
                integrity: "unavailable".into(),
                host_applicability: target.package.host_applicability.clone(),
                applicability_reason: target.package.applicability_reason.clone(),
                files: Vec::new(),
                canonical_license: None,
                reason: "unsupported-ecosystem".into(),
            },
        })
        .collect::<Vec<_>>();
    items.sort_by(|left, right| {
        left.status
            .cmp(&right.status)
            .then_with(|| left.ecosystem.cmp(&right.ecosystem))
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.version.cmp(&right.version))
    });
    let gap = |item: &&LicenseEvidenceItem| item.status == "missing" || item.status == "partial";
    let applicability = LicenseEvidenceApplicabilitySummary {
        applicable: items
            .iter()
            .filter(|item| item.host_applicability == "applicable")
            .count(),
        excluded: items
            .iter()
            .filter(|item| item.host_applicability == "excluded")
            .count(),
        unknown: items
            .iter()
            .filter(|item| item.host_applicability == "unknown")
            .count(),
        actionable_gaps: items
            .iter()
            .filter(|item| gap(item) && item.host_applicability == "applicable")
            .count(),
        excluded_gaps: items
            .iter()
            .filter(|item| gap(item) && item.host_applicability == "excluded")
            .count(),
        unknown_gaps: items
            .iter()
            .filter(|item| gap(item) && item.host_applicability == "unknown")
            .count(),
    };
    let summary = LicenseEvidenceSummary {
        total: items.len(),
        complete: items
            .iter()
            .filter(|item| item.status == "complete")
            .count(),
        partial: items.iter().filter(|item| item.status == "partial").count(),
        missing: items.iter().filter(|item| item.status == "missing").count(),
        mismatch: items
            .iter()
            .filter(|item| item.status == "mismatch")
            .count(),
        integrity_verified: items
            .iter()
            .filter(|item| item.integrity == "verified")
            .count(),
        evidence_files: items.iter().map(|item| item.files.len()).sum(),
        applicability,
    };
    LicenseEvidenceReport {
        schema_version: 3,
        scanned_at: Utc::now().to_rfc3339(),
        inventory_digest: inventory.advisory_preview.request_digest.clone(),
        local_only: true,
        summary,
        items,
    }
}

pub(crate) fn inspect_release_evidence_sources(root: &Path) -> Result<(Value, Value), String> {
    let report = inspect_local(root)?;
    let evidence = collect_license_evidence_local(root, &report.dependency_inventory);
    Ok((
        serde_json::to_value(report)
            .map_err(|error| format!("release-evidence-inspection-serialize: {error}"))?,
        serde_json::to_value(evidence)
            .map_err(|error| format!("release-evidence-license-serialize: {error}"))?,
    ))
}

fn empty_bundle_analysis(status: &str, error: &str) -> BundleAnalysis {
    BundleAnalysis {
        status: status.into(),
        report_path: "dist/bundle-report.json".into(),
        error: error.into(),
        ..BundleAnalysis::default()
    }
}

fn newest_bundle_source(root: &Path) -> Option<SystemTime> {
    let mut candidates = vec![
        root.join("package.json"),
        root.join("package-lock.json"),
        root.join("vite.config.ts"),
    ];
    let mut stack = vec![root.join("src")];
    let mut visited = 0usize;
    while let Some(directory) = stack.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            visited += 1;
            if visited > 10_000 {
                break;
            }
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                stack.push(path);
            } else if path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| {
                    matches!(
                        value.to_ascii_lowercase().as_str(),
                        "ts" | "tsx" | "css" | "html" | "json"
                    )
                })
            {
                candidates.push(path);
            }
        }
        if visited > 10_000 {
            break;
        }
    }
    candidates
        .into_iter()
        .filter_map(|path| fs::metadata(path).ok()?.modified().ok())
        .max()
}

fn inspect_bundle_analysis(root: &Path) -> BundleAnalysis {
    let report_path = root.join("dist").join("bundle-report.json");
    let Ok(metadata) = fs::metadata(&report_path) else {
        return empty_bundle_analysis("missing", "");
    };
    if metadata.len() > 4 * 1024 * 1024 {
        return empty_bundle_analysis("invalid", "bundle-report-too-large");
    }
    let Some(source) = text(&report_path) else {
        return empty_bundle_analysis("invalid", "bundle-report-unreadable");
    };
    let Ok(mut report) = serde_json::from_str::<RawBundleReport>(&source) else {
        return empty_bundle_analysis("invalid", "bundle-report-invalid");
    };
    let recomputed_js = report.chunks.iter().map(|item| item.raw_bytes).sum::<u64>();
    let recomputed_gzip = report
        .chunks
        .iter()
        .map(|item| item.gzip_bytes)
        .sum::<u64>();
    let recomputed_css = report
        .assets
        .iter()
        .filter(|item| item.file_name.ends_with(".css"))
        .map(|item| item.raw_bytes)
        .sum::<u64>();
    let valid = report.schema_version == 1
        && report.budgets.entry_java_script_bytes > 0
        && report.budgets.chunk_java_script_bytes > 0
        && report.budgets.total_java_script_gzip_bytes > 0
        && report.budgets.total_css_bytes > 0
        && report.totals.chunks == report.chunks.len()
        && report.totals.assets == report.assets.len()
        && report.totals.total_java_script_bytes == recomputed_js
        && report.totals.total_java_script_gzip_bytes == recomputed_gzip
        && report.totals.total_css_bytes == recomputed_css
        && report.chunks.iter().filter(|item| item.entry).count() == 1
        && report.chunks.iter().all(|item| {
            !item.file_name.is_empty()
                && item.file_name.len() <= 500
                && item.largest_modules.len() <= 100
                && item
                    .largest_modules
                    .iter()
                    .all(|module| module.id.len() <= 1_000)
        });
    if !valid {
        return empty_bundle_analysis("invalid", "bundle-report-invalid");
    }
    let report_modified = metadata.modified().ok();
    let source_newest = newest_bundle_source(root);
    let status = if report_modified
        .zip(source_newest)
        .is_some_and(|(report_time, source_time)| {
            report_time + Duration::from_secs(1) < source_time
        }) {
        "stale"
    } else {
        "current"
    };
    let entry = report.chunks.iter().find(|item| item.entry);
    let largest = report.chunks.iter().max_by_key(|item| item.raw_bytes);
    let mut violations = Vec::new();
    if let Some(item) = entry.filter(|item| item.raw_bytes > report.budgets.entry_java_script_bytes)
    {
        violations.push(BundleViolation {
            id: "entryJavaScript".into(),
            actual_bytes: item.raw_bytes,
            budget_bytes: report.budgets.entry_java_script_bytes,
            file_name: item.file_name.clone(),
        });
    }
    if let Some(item) =
        largest.filter(|item| item.raw_bytes > report.budgets.chunk_java_script_bytes)
    {
        violations.push(BundleViolation {
            id: "chunkJavaScript".into(),
            actual_bytes: item.raw_bytes,
            budget_bytes: report.budgets.chunk_java_script_bytes,
            file_name: item.file_name.clone(),
        });
    }
    if report.totals.total_java_script_gzip_bytes > report.budgets.total_java_script_gzip_bytes {
        violations.push(BundleViolation {
            id: "totalJavaScriptGzip".into(),
            actual_bytes: report.totals.total_java_script_gzip_bytes,
            budget_bytes: report.budgets.total_java_script_gzip_bytes,
            file_name: String::new(),
        });
    }
    if report.totals.total_css_bytes > report.budgets.total_css_bytes {
        violations.push(BundleViolation {
            id: "totalCss".into(),
            actual_bytes: report.totals.total_css_bytes,
            budget_bytes: report.budgets.total_css_bytes,
            file_name: String::new(),
        });
    }
    report.chunks.truncate(100);
    report.assets.truncate(100);
    BundleAnalysis {
        status: status.into(),
        report_path: relative(root, &report_path),
        generated_at: report.generated_at,
        source_newest_at: source_newest
            .map(|value| DateTime::<Utc>::from(value).to_rfc3339())
            .unwrap_or_default(),
        budgets: report.budgets,
        totals: report.totals,
        chunks: report.chunks,
        assets: report.assets,
        violations,
        error: String::new(),
    }
}

fn quality_coverage_thresholds() -> QualityCoverageThresholds {
    QualityCoverageThresholds {
        lines: 70.0,
        statements: 70.0,
        functions: 60.0,
        branches: 55.0,
    }
}

fn empty_quality_evidence(status: &str, error: &str) -> QualityEvidenceAnalysis {
    QualityEvidenceAnalysis {
        status: status.into(),
        report_path: "artifacts/developer-tools/quality-evidence.json".into(),
        required_stage_ids: QUALITY_REQUIRED_STAGE_IDS
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
        coverage_thresholds: quality_coverage_thresholds(),
        error: error.into(),
        ..QualityEvidenceAnalysis::default()
    }
}

fn quality_source_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| {
            matches!(
                value.to_ascii_lowercase().as_str(),
                "cjs" | "css" | "html" | "js" | "json" | "mjs" | "rs" | "toml" | "ts" | "tsx"
            )
        })
}

fn add_quality_source(
    root: &Path,
    target: &Path,
    files: &mut BTreeMap<String, PathBuf>,
    visited: &mut usize,
) -> Result<(), String> {
    if *visited >= 20_000 {
        return Err("quality-source-file-limit".into());
    }
    *visited += 1;
    let Ok(metadata) = fs::metadata(target) else {
        return Ok(());
    };
    if metadata.is_file() {
        if metadata.len() > 8 * 1024 * 1024 {
            return Err(format!(
                "quality-source-file-too-large:{}",
                relative(root, target)
            ));
        }
        files.insert(relative(root, target), target.to_path_buf());
        return Ok(());
    }
    if !metadata.is_dir() {
        return Ok(());
    }
    let entries = fs::read_dir(target).map_err(|error| format!("quality-source-read:{error}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            if matches!(
                name.as_str(),
                "artifacts" | "coverage" | "dist" | "node_modules" | "target"
            ) {
                continue;
            }
            add_quality_source(root, &path, files, visited)?;
        } else if file_type.is_file() && quality_source_extension(&path) {
            add_quality_source(root, &path, files, visited)?;
        }
    }
    Ok(())
}

fn quality_source_snapshot(root: &Path) -> Result<QualitySourceSnapshot, String> {
    let targets = [
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "tsconfig.node.json",
        "vite.config.ts",
        "scripts",
        "src",
        "src-tauri/Cargo.toml",
        "src-tauri/Cargo.lock",
        "src-tauri/tauri.conf.json",
        "src-tauri/src",
        "developer-tools/vite.config.ts",
        "developer-tools/tsconfig.json",
        "developer-tools/src",
        "developer-tools/src-tauri/Cargo.toml",
        "developer-tools/src-tauri/Cargo.lock",
        "developer-tools/src-tauri/src",
        "website/package.json",
        "website/package-lock.json",
        "website/tsconfig.json",
        "website/vite.config.ts",
        "website/src",
    ];
    let mut files = BTreeMap::new();
    let mut visited = 0usize;
    for target in targets {
        add_quality_source(root, &root.join(target), &mut files, &mut visited)?;
    }
    let mut digest = Sha256::new();
    let mut total_bytes = 0u64;
    let mut newest: Option<SystemTime> = None;
    for (name, path) in &files {
        let content = fs::read(path).map_err(|error| format!("quality-source-read:{error}"))?;
        total_bytes = total_bytes.saturating_add(content.len() as u64);
        if total_bytes > 128 * 1024 * 1024 {
            return Err("quality-source-total-too-large".into());
        }
        if let Ok(modified) = fs::metadata(path).and_then(|value| value.modified()) {
            newest = Some(newest.map_or(modified, |current| current.max(modified)));
        }
        digest.update(name.as_bytes());
        digest.update([0]);
        digest.update(&content);
        digest.update([0]);
    }
    Ok(QualitySourceSnapshot {
        algorithm: "sha256".into(),
        digest: format!("{:X}", digest.finalize()),
        file_count: files.len(),
        total_bytes,
        newest_at: newest
            .map(|value| DateTime::<Utc>::from(value).to_rfc3339())
            .unwrap_or_default(),
    })
}

fn valid_quality_metric(metric: &QualityCoverageMetric) -> bool {
    metric.pct.is_finite()
        && (0.0..=100.0).contains(&metric.pct)
        && metric.covered <= metric.total
        && metric.skipped <= metric.total
}

fn inspect_quality_evidence(root: &Path) -> QualityEvidenceAnalysis {
    let report_path = root
        .join("artifacts")
        .join("developer-tools")
        .join("quality-evidence.json");
    let Ok(metadata) = fs::metadata(&report_path) else {
        return empty_quality_evidence("missing", "");
    };
    if metadata.len() > 1024 * 1024 {
        return empty_quality_evidence("invalid", "quality-evidence-too-large");
    }
    let Some(source) = text(&report_path) else {
        return empty_quality_evidence("invalid", "quality-evidence-unreadable");
    };
    let Ok(mut report) = serde_json::from_str::<RawQualityEvidence>(&source) else {
        return empty_quality_evidence("invalid", "quality-evidence-invalid");
    };
    let expected_ids = QUALITY_REQUIRED_STAGE_IDS
        .iter()
        .map(|value| (*value).to_owned())
        .collect::<Vec<_>>();
    let stage_ids = report
        .stages
        .iter()
        .map(|stage| stage.id.clone())
        .collect::<Vec<_>>();
    let unique_ids = stage_ids.iter().collect::<HashSet<_>>();
    let digest_valid = |value: &str| {
        value.len() == 64
            && value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'A'..=b'F').contains(&byte))
    };
    let stages_valid = report.stages.iter().all(|stage| {
        !stage.id.is_empty()
            && !stage.command.is_empty()
            && stage.command.len() <= 2_000
            && stage.output_tail.len() <= 8_000
            && matches!(stage.status.as_str(), "pass" | "fail")
            && ((stage.status == "pass" && stage.exit_code == 0)
                || (stage.status == "fail" && stage.exit_code > 0))
            && stage.tests.total == stage.tests.passed + stage.tests.failed + stage.tests.skipped
    });
    let coverage_valid = !report.coverage.available
        || [
            &report.coverage.lines,
            &report.coverage.statements,
            &report.coverage.functions,
            &report.coverage.branches,
        ]
        .iter()
        .all(|metric| valid_quality_metric(metric));
    let valid = report.schema_version == 1
        && report.runner_version == "d31-1"
        && stage_ids == expected_ids
        && report.required_stage_ids == expected_ids
        && unique_ids.len() == expected_ids.len()
        && stages_valid
        && coverage_valid
        && report.source_before.algorithm == "sha256"
        && report.source_after.algorithm == "sha256"
        && digest_valid(&report.source_before.digest)
        && digest_valid(&report.source_after.digest);
    if !valid {
        return empty_quality_evidence("invalid", "quality-evidence-invalid");
    }
    let mut summary = QualitySummary::default();
    for stage in &report.stages {
        summary.total_stages += 1;
        if stage.status == "pass" {
            summary.passed_stages += 1;
        } else {
            summary.failed_stages += 1;
        }
        summary.total_tests += stage.tests.total;
        summary.passed_tests += stage.tests.passed;
        summary.failed_tests += stage.tests.failed;
        summary.skipped_tests += stage.tests.skipped;
    }
    if summary != report.summary {
        return empty_quality_evidence("invalid", "quality-summary-mismatch");
    }
    let current_source = match quality_source_snapshot(root) {
        Ok(value) => value,
        Err(error) => return empty_quality_evidence("invalid", &error),
    };
    let source_stable =
        report.source_stable && report.source_before.digest == report.source_after.digest;
    let source_current = report.source_after.digest == current_source.digest
        && report.source_after.file_count == current_source.file_count
        && report.source_after.total_bytes == current_source.total_bytes;
    let failed = summary.failed_stages > 0 || !source_stable;
    let status = if failed {
        "failed"
    } else if source_current {
        "current"
    } else {
        "stale"
    };
    let thresholds = quality_coverage_thresholds();
    let mut coverage_violations = Vec::new();
    if !report.coverage.available {
        coverage_violations.push(QualityCoverageViolation {
            id: "coverageUnavailable".into(),
            actual: 0.0,
            threshold: 0.0,
        });
    } else {
        for (id, metric, threshold) in [
            ("lines", &report.coverage.lines, thresholds.lines),
            (
                "statements",
                &report.coverage.statements,
                thresholds.statements,
            ),
            (
                "functions",
                &report.coverage.functions,
                thresholds.functions,
            ),
            ("branches", &report.coverage.branches, thresholds.branches),
        ] {
            if metric.pct < threshold {
                coverage_violations.push(QualityCoverageViolation {
                    id: id.into(),
                    actual: metric.pct,
                    threshold,
                });
            }
        }
    }
    report.stages.truncate(20);
    QualityEvidenceAnalysis {
        status: status.into(),
        report_path: relative(root, &report_path),
        generated_at: report.generated_at,
        started_at: report.started_at,
        completed_at: report.completed_at,
        duration_ms: report.duration_ms,
        source_newest_at: current_source.newest_at,
        source_digest: report.source_after.digest,
        source_stable,
        required_stage_ids: expected_ids,
        summary,
        coverage: report.coverage,
        coverage_thresholds: thresholds,
        coverage_violations,
        stages: report.stages,
        error: if failed && !source_stable {
            "source-changed-during-quality-run".into()
        } else {
            String::new()
        },
    }
}

fn value_strings(value: Option<&Value>) -> Option<Vec<String>> {
    value?
        .as_array()?
        .iter()
        .map(|item| item.as_str().map(str::to_owned))
        .collect()
}

fn inspect_capability_security(root: &Path) -> CapabilitySecurityAudit {
    let capability_path = root.join(DEVELOPER_CAPABILITY_PATH);
    let configuration_path = root.join(DEVELOPER_TAURI_CONFIG_PATH);
    let capability_present = capability_path.is_file();
    let configuration_present = configuration_path.is_file();
    let capability = json(&capability_path);
    let configuration = json(&configuration_path);
    let permissions = capability
        .as_ref()
        .and_then(|v| value_strings(v.get("permissions")));
    let windows = capability
        .as_ref()
        .and_then(|v| value_strings(v.get("windows")));
    let configured_windows: Option<Vec<String>> = configuration.as_ref().and_then(|v| {
        v.pointer("/app/windows")?
            .as_array()?
            .iter()
            .map(|item| item.get("label")?.as_str().map(str::to_owned))
            .collect()
    });
    let capability_identifier = capability
        .as_ref()
        .and_then(|v| v.get("identifier")?.as_str())
        .unwrap_or("")
        .to_owned();
    let app_identifier = configuration
        .as_ref()
        .and_then(|v| v.get("identifier")?.as_str())
        .unwrap_or("")
        .to_owned();
    let csp = configuration
        .as_ref()
        .and_then(|v| v.pointer("/app/security/csp")?.as_str())
        .unwrap_or("")
        .to_owned();
    let csp_directives: Vec<CspDirective> = csp
        .split(';')
        .filter_map(|part| {
            let mut tokens = part.split_whitespace();
            Some(CspDirective {
                name: tokens.next()?.to_ascii_lowercase(),
                values: tokens.map(str::to_owned).collect(),
            })
        })
        .collect();
    let mut issues = Vec::new();
    if !capability_present {
        issues.push("capability-file-missing".into());
    } else if capability.is_none()
        || permissions.is_none()
        || windows.is_none()
        || capability_identifier.is_empty()
    {
        issues.push("capability-file-invalid".into());
    }
    if !configuration_present {
        issues.push("tauri-config-missing".into());
    } else if configuration.is_none() || configured_windows.is_none() || app_identifier.is_empty() {
        issues.push("tauri-config-invalid".into());
    }
    if let (Some(permissions), Some(windows)) = (&permissions, &windows) {
        if capability_identifier != DEVELOPER_CAPABILITY_IDENTIFIER {
            issues.push(format!("capability-identifier:{capability_identifier}"));
        }
        for allowed in DEVELOPER_ALLOWED_PERMISSIONS {
            if !permissions.iter().any(|v| v == allowed) {
                issues.push(format!("missing-permission:{allowed}"));
            }
        }
        for permission in permissions {
            if !DEVELOPER_ALLOWED_PERMISSIONS.contains(&permission.as_str()) {
                issues.push(format!("unexpected-permission:{permission}"));
            }
        }
        if permissions.iter().collect::<HashSet<_>>().len() != permissions.len() {
            issues.push("duplicate-permission".into());
        }
        if !windows.iter().any(|v| v == "main") {
            issues.push("missing-capability-window:main".into());
        }
        for window in windows {
            if window != "main" {
                issues.push(format!("unexpected-capability-window:{window}"));
            }
        }
    }
    if let Some(configured_windows) = &configured_windows {
        if app_identifier != DEVELOPER_APP_IDENTIFIER {
            issues.push(format!("app-identifier:{app_identifier}"));
        }
        if !configured_windows.iter().any(|v| v == "main") {
            issues.push("missing-configured-window:main".into());
        }
        for window in configured_windows {
            if window != "main" {
                issues.push(format!("unexpected-configured-window:{window}"));
            }
        }
    }
    let expected: [(&str, &[&str]); 5] = [
        ("default-src", &["'self'"]),
        (
            "connect-src",
            &[
                "'self'",
                "ipc:",
                "http://ipc.localhost",
                "http://127.0.0.1:1421",
            ],
        ),
        ("img-src", &["'self'", "data:"]),
        ("style-src", &["'self'", "'unsafe-inline'"]),
        ("font-src", &["'self'"]),
    ];
    if configuration.is_some() && csp_directives.is_empty() {
        issues.push("csp-missing".into());
    }
    for (name, sources) in expected {
        if let Some(directive) = csp_directives.iter().find(|v| v.name == name) {
            for source in sources {
                if !directive.values.iter().any(|v| v == source) {
                    issues.push(format!("csp-missing-source:{name}:{source}"));
                }
            }
            for source in &directive.values {
                if !sources.contains(&source.as_str()) {
                    issues.push(format!("csp-unexpected-source:{name}:{source}"));
                }
            }
        } else {
            issues.push(format!("csp-missing-directive:{name}"));
        }
    }
    for directive in &csp_directives {
        if !expected.iter().any(|(name, _)| *name == directive.name) {
            issues.push(format!("csp-unexpected-directive:{}", directive.name));
        }
    }
    let status = if issues.iter().any(|v| v.ends_with("-invalid")) {
        "invalid"
    } else if issues.iter().any(|v| v.ends_with("-missing")) {
        "missing"
    } else if issues.is_empty() {
        "verified"
    } else {
        "violation"
    };
    CapabilitySecurityAudit {
        status: status.into(),
        capability_path: DEVELOPER_CAPABILITY_PATH.into(),
        configuration_path: DEVELOPER_TAURI_CONFIG_PATH.into(),
        capability_identifier,
        app_identifier,
        windows: windows.unwrap_or_default(),
        configured_windows: configured_windows.unwrap_or_default(),
        permissions: permissions.unwrap_or_default(),
        allowed_permissions: DEVELOPER_ALLOWED_PERMISSIONS
            .iter()
            .map(|v| (*v).into())
            .collect(),
        csp,
        csp_directives,
        issues,
    }
}

fn run_version_tool(id: &str, program: &str, args: &[&str], label: &str) -> BuildEnvironmentTool {
    let mut command = Command::new(program);
    command.args(args);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    match command.output() {
        Ok(result) if result.status.success() => {
            let stdout = String::from_utf8_lossy(&result.stdout);
            let stderr = String::from_utf8_lossy(&result.stderr);
            let output = format!("{stdout}\n{stderr}").trim().to_owned();
            let version = Regex::new(r"\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?")
                .ok()
                .and_then(|pattern| pattern.find(&output).map(|item| item.as_str().to_owned()))
                .unwrap_or_default();
            BuildEnvironmentTool {
                id: id.into(),
                command: label.into(),
                available: true,
                version,
                output: output
                    .lines()
                    .next()
                    .unwrap_or_default()
                    .chars()
                    .take(240)
                    .collect(),
                error: String::new(),
            }
        }
        Ok(result) => BuildEnvironmentTool {
            id: id.into(),
            command: label.into(),
            available: false,
            version: String::new(),
            output: String::new(),
            error: format!("exit-status:{}", result.status.code().unwrap_or(-1)),
        },
        Err(error) => BuildEnvironmentTool {
            id: id.into(),
            command: label.into(),
            available: false,
            version: String::new(),
            output: String::new(),
            error: error.to_string().chars().take(240).collect(),
        },
    }
}

fn inspect_build_environment() -> BuildEnvironmentAudit {
    let mut tools = vec![
        run_version_tool("node", "node", &["--version"], "node --version"),
        #[cfg(windows)]
        run_version_tool(
            "npm",
            "cmd",
            &["/D", "/S", "/C", "npm --version"],
            "npm --version",
        ),
        #[cfg(not(windows))]
        run_version_tool("npm", "npm", &["--version"], "npm --version"),
        run_version_tool("rustc", "rustc", &["--version"], "rustc --version"),
        run_version_tool("cargo", "cargo", &["--version"], "cargo --version"),
        run_version_tool("rustup", "rustup", &["--version"], "rustup --version"),
    ];
    let mut target_command = Command::new("rustup");
    target_command.args(["target", "list", "--installed"]);
    #[cfg(windows)]
    target_command.creation_flags(CREATE_NO_WINDOW);
    let (mut installed_rust_targets, error) = match target_command.output() {
        Ok(result) if result.status.success() => (
            String::from_utf8_lossy(&result.stdout)
                .lines()
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(str::to_owned)
                .collect::<Vec<_>>(),
            String::new(),
        ),
        Ok(result) => (
            Vec::new(),
            format!("exit-status:{}", result.status.code().unwrap_or(-1)),
        ),
        Err(error) => (Vec::new(), error.to_string()),
    };
    installed_rust_targets.sort();
    let host_os = if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
    .to_owned();
    let host_arch = if cfg!(target_arch = "x86_64") {
        "x64"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        std::env::consts::ARCH
    }
    .to_owned();
    let rust_target_installed = installed_rust_targets
        .iter()
        .any(|target| target == CARGO_WINDOWS_X64_TARGET);
    let mut issues = Vec::new();
    if host_os != "win32" {
        issues.push(format!("unsupported-os:{host_os}"));
    }
    if host_arch != "x64" {
        issues.push(format!("unsupported-arch:{host_arch}"));
    }
    for tool in tools.iter().filter(|tool| !tool.available) {
        issues.push(format!("missing-tool:{}", tool.id));
    }
    if !rust_target_installed {
        issues.push(format!("missing-rust-target:{CARGO_WINDOWS_X64_TARGET}"));
    }
    let status = if issues.iter().any(|issue| issue.starts_with("unsupported-")) {
        "unsupported"
    } else if issues.is_empty() {
        "ready"
    } else {
        "incomplete"
    };
    tools.shrink_to_fit();
    BuildEnvironmentAudit {
        status: status.into(),
        host_os,
        host_arch,
        expected_os: "win32".into(),
        expected_arch: "x64".into(),
        rust_target: CARGO_WINDOWS_X64_TARGET.into(),
        rust_target_installed,
        installed_rust_targets,
        tools,
        issues,
        error,
    }
}

fn inspect_local(root: &Path) -> Result<DeveloperInspectionReport, String> {
    let package = json(&root.join("package.json"));
    let package_lock = json(&root.join("package-lock.json"));
    let cargo_source = text(&root.join("src-tauri").join("Cargo.toml")).unwrap_or_default();
    let tauri = json(&root.join("src-tauri").join("tauri.conf.json"));
    let package_version = package
        .as_ref()
        .and_then(|value| value.get("version"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let cargo_version = Regex::new(r#"(?m)^version\s*=\s*"([^"]+)""#)
        .unwrap()
        .captures(&cargo_source)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_owned())
        .unwrap_or_default();
    let version_sources = vec![
        VersionSource {
            id: "package".into(),
            path: "package.json".into(),
            value: package_version.clone(),
        },
        VersionSource {
            id: "packageLock".into(),
            path: "package-lock.json".into(),
            value: package_lock
                .as_ref()
                .and_then(|value| value.get("version"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .into(),
        },
        VersionSource {
            id: "packageLockRoot".into(),
            path: "package-lock.json packages['']".into(),
            value: package_lock
                .as_ref()
                .and_then(|value| value.pointer("/packages//version"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .into(),
        },
        VersionSource {
            id: "cargo".into(),
            path: "src-tauri/Cargo.toml".into(),
            value: cargo_version,
        },
        VersionSource {
            id: "tauri".into(),
            path: "src-tauri/tauri.conf.json".into(),
            value: tauri
                .as_ref()
                .and_then(|value| value.get("version"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .into(),
        },
    ];
    let versions_match = !package_version.is_empty()
        && version_sources
            .iter()
            .all(|source| source.value == package_version);
    let public_key_path = root.join("src-tauri").join("updater-public.key");
    let public_key = text(&public_key_path).unwrap_or_default().trim().to_owned();
    let configured_key = tauri
        .as_ref()
        .and_then(|value| value.pointer("/plugins/updater/pubkey"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned();

    let updates = root.join("artifacts").join("updates");
    let mut versions = fs::read_dir(&updates)
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|value| Regex::new(r"^\d+\.\d+\.\d+").unwrap().is_match(value))
        .collect::<Vec<_>>();
    versions.sort_by(|left, right| compare_versions(left, right));
    let release_history = versions
        .iter()
        .rev()
        .take(5)
        .map(|version| inspect_release_history_entry(root, &updates, version, &public_key))
        .collect::<Vec<_>>();
    let artifact_version = versions.last().cloned().unwrap_or_default();
    let artifact_directory = updates.join(&artifact_version);
    let manifest_path = artifact_directory.join("latest.json");
    let manifest = json(&manifest_path);
    let platform = manifest
        .as_ref()
        .and_then(|value| value.pointer("/platforms/windows-x86_64"));
    let manifest_version = manifest
        .as_ref()
        .and_then(|value| value.get("version"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let download_url = platform
        .and_then(|value| value.get("url"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let manifest_signature = platform
        .and_then(|value| value.get("signature"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned();
    let published_at = manifest
        .as_ref()
        .and_then(|value| value.get("pub_date"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let url_name = download_url.rsplit('/').next().unwrap_or_default();
    let mut installer_path = artifact_directory.join(url_name);
    if !installer_path.is_file() {
        installer_path = fs::read_dir(&artifact_directory)
            .ok()
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| entry.path())
            .find(|path| {
                path.extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
            })
            .unwrap_or_default();
    }
    let installer_present = installer_path.is_file();
    let signature_path = PathBuf::from(format!("{}.sig", installer_path.to_string_lossy()));
    let signature = text(&signature_path).unwrap_or_default().trim().to_owned();
    let installer_sha256 = if installer_present {
        sha256(&installer_path).unwrap_or_default()
    } else {
        String::new()
    };
    let installer_size = installer_path
        .metadata()
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let cryptographic_signature =
        if installer_present && !signature.is_empty() && !public_key.is_empty() {
            verify_updater_signature(&installer_path, &signature, &public_key)
        } else {
            Err("signature-prerequisite-missing".to_owned())
        };
    let cryptographic_check = match cryptographic_signature {
        Ok(()) => check("cryptographicSignature", "pass", "verified"),
        Err(error) => {
            let mut result = check("cryptographicSignature", "fail", "verification-failed");
            result.technical_detail = error;
            result
        }
    };
    let invalid_history = release_history
        .iter()
        .filter(|entry| !entry.signature_valid || entry.installer_sha256.is_empty())
        .map(|entry| entry.version.as_str())
        .collect::<Vec<_>>();
    let history_check = if release_history.is_empty() {
        check("artifactHistoryIntegrity", "fail", "0 releases")
    } else if invalid_history.is_empty() {
        check(
            "artifactHistoryIntegrity",
            "pass",
            format!("{} releases", release_history.len()),
        )
    } else {
        check(
            "artifactHistoryIntegrity",
            "fail",
            invalid_history.join(", "),
        )
    };
    let dependency_inventory = inspect_dependency_inventory(root);
    let missing_lockfiles = dependency_inventory
        .lockfiles
        .iter()
        .filter(|item| !item.present)
        .map(|item| item.lockfile_path.as_str())
        .collect::<Vec<_>>();
    let dependency_problems = dependency_inventory
        .review_packages
        .iter()
        .filter(|item| !item.reason.is_empty())
        .map(|item| {
            format!(
                "{}:{}@{} ({})",
                item.ecosystem, item.name, item.version, item.reason
            )
        })
        .collect::<Vec<_>>();
    let mut dependency_lockfiles_check = check(
        "dependencyLockfiles",
        if dependency_inventory.generated_from_lockfiles {
            "pass"
        } else {
            "fail"
        },
        format!(
            "{}/{} lockfiles",
            dependency_inventory.totals.lockfiles,
            dependency_inventory.lockfiles.len()
        ),
    );
    dependency_lockfiles_check.technical_detail = missing_lockfiles.join("\n");
    let mut dependency_integrity_check = check(
        "dependencyIntegrity",
        if dependency_inventory.totals.insecure_source > 0 {
            "fail"
        } else if dependency_inventory.totals.missing_integrity > 0 {
            "warning"
        } else {
            "pass"
        },
        format!(
            "{} packages · {} missing integrity · {} insecure sources",
            dependency_inventory.totals.packages,
            dependency_inventory.totals.missing_integrity,
            dependency_inventory.totals.insecure_source
        ),
    );
    dependency_integrity_check.technical_detail = dependency_problems
        .iter()
        .filter(|item| item.contains("missing-integrity") || item.contains("insecure-source"))
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");
    let mut dependency_license_check = check(
        "dependencyLicenseMetadata",
        if dependency_inventory.totals.unknown_license > 0 {
            "warning"
        } else {
            "pass"
        },
        format!(
            "{} unknown licenses",
            dependency_inventory.totals.unknown_license
        ),
    );
    dependency_license_check.technical_detail = dependency_problems
        .iter()
        .filter(|item| item.contains("unknown-license"))
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");
    let mut dependency_reciprocal_check = check(
        "dependencyReciprocalLicenses",
        if dependency_inventory.totals.reciprocal_license > 0 {
            "warning"
        } else {
            "pass"
        },
        format!(
            "{} reciprocal licenses",
            dependency_inventory.totals.reciprocal_license
        ),
    );
    dependency_reciprocal_check.technical_detail = dependency_problems
        .iter()
        .filter(|item| item.contains("reciprocal-license"))
        .cloned()
        .collect::<Vec<_>>()
        .join("\n");
    let mut dependency_advisory_check = check("dependencyAdvisories", "warning", "offline-not-run");
    dependency_advisory_check.technical_detail = "No dependency names were transmitted. Network advisory lookup requires a future explicit approval flow.".into();
    let bundle_analysis = inspect_bundle_analysis(root);
    let mut bundle_check = check(
        "bundlePerformance",
        if bundle_analysis.status == "invalid" {
            "fail"
        } else if bundle_analysis.status != "current" || !bundle_analysis.violations.is_empty() {
            "warning"
        } else {
            "pass"
        },
        format!(
            "{} · {} chunks · {} budget violations",
            bundle_analysis.status,
            bundle_analysis.totals.chunks,
            bundle_analysis.violations.len()
        ),
    );
    bundle_check.technical_detail = if bundle_analysis.error.is_empty() {
        bundle_analysis
            .violations
            .iter()
            .map(|item| {
                format!(
                    "{}: {}/{} {}",
                    item.id, item.actual_bytes, item.budget_bytes, item.file_name
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        bundle_analysis.error.clone()
    };
    let quality_evidence = inspect_quality_evidence(root);
    let mut quality_check = check(
        "qualityEvidence",
        if matches!(quality_evidence.status.as_str(), "invalid" | "failed") {
            "fail"
        } else if quality_evidence.status != "current"
            || !quality_evidence.coverage_violations.is_empty()
        {
            "warning"
        } else {
            "pass"
        },
        format!(
            "{} · {}/{} stages · {}/{} tests · {} coverage gaps",
            quality_evidence.status,
            quality_evidence.summary.passed_stages,
            quality_evidence.summary.total_stages,
            quality_evidence.summary.passed_tests,
            quality_evidence.summary.total_tests,
            quality_evidence.coverage_violations.len()
        ),
    );
    quality_check.technical_detail = if quality_evidence.error.is_empty() {
        quality_evidence
            .coverage_violations
            .iter()
            .map(|item| format!("{}: {}/{}", item.id, item.actual, item.threshold))
            .collect::<Vec<_>>()
            .join("\n")
    } else {
        quality_evidence.error.clone()
    };
    let capability_security = inspect_capability_security(root);
    let mut capability_check = check(
        "developerCapabilityPolicy",
        if capability_security.status == "verified" {
            "pass"
        } else {
            "fail"
        },
        format!(
            "{} · {} permissions · {} CSP directives",
            capability_security.status,
            capability_security.permissions.len(),
            capability_security.csp_directives.len()
        ),
    );
    capability_check.technical_detail = capability_security.issues.join("\n");
    let build_environment = inspect_build_environment();
    let mut build_environment_check = check(
        "developerBuildEnvironment",
        if build_environment.status == "ready" {
            "pass"
        } else {
            "fail"
        },
        format!(
            "{} · {}/{} tools · {}/{}",
            build_environment.status,
            build_environment
                .tools
                .iter()
                .filter(|tool| tool.available)
                .count(),
            build_environment.tools.len(),
            build_environment.host_os,
            build_environment.host_arch
        ),
    );
    build_environment_check.technical_detail = build_environment
        .issues
        .iter()
        .cloned()
        .chain((!build_environment.error.is_empty()).then(|| build_environment.error.clone()))
        .collect::<Vec<_>>()
        .join("\n");

    let mut checks = vec![
        check(
            "versionConsistency",
            if versions_match { "pass" } else { "fail" },
            version_sources
                .iter()
                .map(|source| {
                    format!(
                        "{}={}",
                        source.id,
                        if source.value.is_empty() {
                            "—"
                        } else {
                            &source.value
                        }
                    )
                })
                .collect::<Vec<_>>()
                .join(" · "),
        ),
        check(
            "publicKeyPresent",
            if public_key.is_empty() {
                "fail"
            } else {
                "pass"
            },
            relative(root, &public_key_path),
        ),
        check(
            "publicKeyMatches",
            if !public_key.is_empty() && public_key == configured_key {
                "pass"
            } else {
                "fail"
            },
            "src-tauri/updater-public.key ↔ tauri.conf.json",
        ),
        check(
            "manifestPresent",
            if manifest.is_some() { "pass" } else { "fail" },
            relative(root, &manifest_path),
        ),
        check(
            "manifestVersion",
            if !manifest_version.is_empty()
                && manifest_version == artifact_version
                && manifest_version == package_version
            {
                "pass"
            } else {
                "fail"
            },
            format!(
                "app={} · artifact={} · manifest={}",
                package_version, artifact_version, manifest_version
            ),
        ),
        check(
            "installerPresent",
            if installer_present { "pass" } else { "fail" },
            relative(root, &installer_path),
        ),
        check(
            "signaturePresent",
            if signature.is_empty() { "fail" } else { "pass" },
            relative(root, &signature_path),
        ),
        check(
            "signatureMatchesManifest",
            if !signature.is_empty() && signature == manifest_signature {
                "pass"
            } else {
                "fail"
            },
            "signature file ↔ latest.json",
        ),
        check(
            "sha256Calculated",
            if installer_sha256.is_empty() {
                "fail"
            } else {
                "pass"
            },
            installer_sha256.clone(),
        ),
        check(
            "downloadUrlHttps",
            if Url::parse(&download_url).is_ok_and(|url| {
                url.scheme() == "https" && url.username().is_empty() && url.password().is_none()
            }) {
                "pass"
            } else {
                "fail"
            },
            download_url.clone(),
        ),
        check("remoteFeed", "warning", OFFICIAL_UPDATE_FEED),
        check(
            "remoteVersion",
            "warning",
            format!("local={} · remote=—", package_version),
        ),
        cryptographic_check,
        history_check,
        dependency_lockfiles_check,
        dependency_integrity_check,
        dependency_license_check,
        dependency_reciprocal_check,
        dependency_advisory_check,
        bundle_check,
        quality_check,
        capability_check,
        build_environment_check,
    ];
    let summary = summarize(&checks);
    Ok(DeveloperInspectionReport {
        schema_version: 12,
        inspected_at: Utc::now().to_rfc3339(),
        workspace_root: display_path(root),
        read_only: true,
        expected_version: package_version,
        version_sources,
        release: ReleaseDetails {
            artifact_version,
            artifact_directory: relative(root, &artifact_directory),
            manifest_path: relative(root, &manifest_path),
            installer_path: relative(root, &installer_path),
            signature_path: relative(root, &signature_path),
            installer_size_bytes: installer_size,
            installer_sha256,
            manifest_version,
            download_url,
            published_at,
        },
        release_history,
        dependency_inventory,
        bundle_analysis,
        quality_evidence,
        capability_security,
        build_environment,
        remote_feed: RemoteFeed {
            endpoint: OFFICIAL_UPDATE_FEED.into(),
            ..RemoteFeed::default()
        },
        checks: std::mem::take(&mut checks),
        summary,
    })
}

fn summarize(checks: &[DeveloperCheck]) -> CheckSummary {
    let mut summary = CheckSummary::default();
    for check in checks {
        match check.status.as_str() {
            "pass" => summary.pass += 1,
            "warning" => summary.warning += 1,
            "fail" => summary.fail += 1,
            _ => {}
        }
    }
    summary
}

async fn inspect_remote() -> RemoteFeed {
    let mut result = RemoteFeed {
        endpoint: OFFICIAL_UPDATE_FEED.into(),
        checked: true,
        ..RemoteFeed::default()
    };
    let client = match Client::builder()
        .timeout(Duration::from_secs(10))
        .redirect(Policy::limited(3))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            result.error = error.to_string();
            return result;
        }
    };
    match client
        .get(OFFICIAL_UPDATE_FEED)
        .header("accept", "application/json")
        .send()
        .await
    {
        Ok(response) if response.status().is_success() => match response.json::<Value>().await {
            Ok(manifest) => {
                result.reachable = true;
                result.version = manifest
                    .get("version")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into();
                result.download_url = manifest
                    .pointer("/platforms/windows-x86_64/url")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into();
            }
            Err(error) => result.error = format!("feed-json: {error}"),
        },
        Ok(response) => result.error = format!("HTTP {}", response.status()),
        Err(error) => result.error = format!("feed-request: {error}"),
    }
    result
}

fn update_remote_checks(report: &mut DeveloperInspectionReport) {
    let reachable = report.remote_feed.reachable;
    let version_match = reachable && report.remote_feed.version == report.expected_version;
    for check in &mut report.checks {
        match check.id.as_str() {
            "remoteFeed" => {
                check.status = if reachable { "pass" } else { "warning" }.into();
                check.detail = if reachable {
                    format!(
                        "{} · {}",
                        report.remote_feed.version, report.remote_feed.endpoint
                    )
                } else {
                    report.remote_feed.endpoint.clone()
                };
                check.technical_detail = report.remote_feed.error.clone();
            }
            "remoteVersion" => {
                check.status = if version_match { "pass" } else { "warning" }.into();
                check.detail = format!(
                    "local={} · remote={}",
                    report.expected_version,
                    if report.remote_feed.version.is_empty() {
                        "—"
                    } else {
                        &report.remote_feed.version
                    }
                );
            }
            _ => {}
        }
    }
    report.summary = summarize(&report.checks);
}

#[tauri::command]
pub async fn inspect_workspace(
    workspace_root: String,
    check_remote_feed: Option<bool>,
) -> Result<DeveloperInspectionReport, String> {
    let root = canonical_workspace(&workspace_root)?;
    let inspect_root = root.clone();
    let mut report = tauri::async_runtime::spawn_blocking(move || inspect_local(&inspect_root))
        .await
        .map_err(|error| format!("inspection-join: {error}"))??;
    if check_remote_feed.unwrap_or(true) {
        report.remote_feed = inspect_remote().await;
        update_remote_checks(&mut report);
    }
    Ok(report)
}

#[tauri::command]
pub async fn scan_dependency_advisories(
    workspace_root: String,
    expected_digest: String,
    consent: bool,
) -> Result<AdvisoryScanResult, String> {
    if !consent {
        return Err("advisory-consent-required".into());
    }
    let root = canonical_workspace(&workspace_root)?;
    let inventory =
        tauri::async_runtime::spawn_blocking(move || inspect_dependency_inventory(&root))
            .await
            .map_err(|error| format!("advisory-inventory-join: {error}"))?;
    if expected_digest.trim() != inventory.advisory_preview.request_digest {
        return Err("advisory-preview-stale".into());
    }
    scan_advisories(&inventory).await
}

#[tauri::command]
pub async fn collect_license_evidence(
    workspace_root: String,
    expected_digest: String,
) -> Result<LicenseEvidenceReport, String> {
    let root = canonical_workspace(&workspace_root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let inventory = inspect_dependency_inventory(&root);
        if expected_digest.trim() != inventory.advisory_preview.request_digest {
            return Err("license-evidence-preview-stale".into());
        }
        Ok(collect_license_evidence_local(&root, &inventory))
    })
    .await
    .map_err(|error| format!("license-evidence-join: {error}"))?
}

fn valid_sha256_text(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn valid_logical_export_path(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 1_024
        && !value.starts_with('/')
        && !value.starts_with('\\')
        && !value.contains(':')
        && value.split(['/', '\\']).all(|part| part != "..")
}

fn valid_review_timestamp(value: &str) -> bool {
    (20..=40).contains(&value.len())
        && value.contains('T')
        && value.ends_with('Z')
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'-' | b':' | b'.' | b'T' | b'Z'))
}

fn valid_review_document(value: &Value) -> bool {
    let digest_valid = value
        .get("inventoryDigest")
        .and_then(Value::as_str)
        .is_some_and(valid_sha256_text);
    let entries_valid = value
        .get("reviews")
        .and_then(Value::as_array)
        .is_some_and(|reviews| {
            reviews.len() <= 2_000
                && reviews.iter().all(|review| {
                    let text = |key| review.get(key).and_then(Value::as_str);
                    let status = text("status").unwrap_or_default();
                    let decision = text("decision").unwrap_or_default();
                    let attributed = text("reviewer")
                        .is_some_and(|reviewer| (2..=80).contains(&reviewer.trim().len()))
                        && text("rationale")
                            .is_some_and(|rationale| (8..=2_000).contains(&rationale.trim().len()))
                        && text("reviewedAt").is_some_and(valid_review_timestamp)
                        && text("expiresAt").is_some_and(valid_review_timestamp);
                    let decision_valid = matches!(decision, "approved" | "restricted" | "blocked");
                    text("itemId").is_some_and(|item| !item.is_empty() && item.len() <= 500)
                        && text("name").is_some_and(|name| !name.is_empty() && name.len() <= 512)
                        && text("version")
                            .is_some_and(|version| !version.is_empty() && version.len() <= 128)
                        && match status {
                            "pending" => [
                                "decision",
                                "reviewer",
                                "rationale",
                                "reviewedAt",
                                "expiresAt",
                            ]
                            .iter()
                            .all(|key| text(key) == Some("")),
                            "expired" => decision_valid && attributed,
                            "approved" | "restricted" | "blocked" => {
                                decision == status && attributed
                            }
                            _ => false,
                        }
                })
        });
    value.get("documentType").and_then(Value::as_str)
        == Some("minecraft-server-hub-license-review-register")
        && value.get("schemaVersion").and_then(Value::as_u64) == Some(2)
        && digest_valid
        && entries_valid
}

fn valid_canonical_license(value: &Value) -> bool {
    value.get("spdxId").and_then(Value::as_str) == Some("MPL-2.0")
        && value.get("sourceUrl").and_then(Value::as_str) == Some(MPL_2_0_SOURCE_URL)
        && value.get("localResource").and_then(Value::as_str) == Some("embedded/MPL-2.0.txt")
        && value.get("sizeBytes").and_then(Value::as_u64) == Some(MPL_2_0_TEXT.len() as u64)
        && value.get("sha256").and_then(Value::as_str) == Some(MPL_2_0_TEXT_SHA256)
}

fn valid_windows_evidence_item(item: &Value, group: &str) -> bool {
    let text = |key| item.get(key).and_then(Value::as_str);
    let reason = text("reason").unwrap_or_default();
    let status = text("status").unwrap_or_default();
    let manifest_source_valid = text("manifestSource").is_some_and(|source| {
        (status == "missing" && source.is_empty()) || valid_logical_export_path(source)
    });
    let canonical_valid = match item.get("canonicalLicense") {
        Some(value) => valid_canonical_license(value),
        None => reason != "source-header-canonical-license-complete",
    };
    matches!(text("ecosystem"), Some("npm" | "cargo"))
        && text("name").is_some_and(|name| !name.is_empty() && name.len() <= 512)
        && text("version").is_some_and(|version| !version.is_empty() && version.len() <= 128)
        && text("hostApplicability") == Some(group)
        && matches!(status, "complete" | "partial" | "missing" | "mismatch")
        && text("integrity")
            .is_some_and(|integrity| matches!(integrity, "verified" | "unavailable" | "mismatch"))
        && manifest_source_valid
        && item
            .get("components")
            .and_then(Value::as_array)
            .is_some_and(|components| {
                components.len() <= 64
                    && components.iter().all(|component| {
                        component
                            .as_str()
                            .is_some_and(|value| !value.is_empty() && value.len() <= 128)
                    })
            })
        && item
            .get("files")
            .and_then(Value::as_array)
            .is_some_and(|files| {
                files.len() <= 16
                    && files.iter().all(|file| {
                        file.get("name")
                            .and_then(Value::as_str)
                            .is_some_and(valid_logical_export_path)
                            && file
                                .get("sha256")
                                .and_then(Value::as_str)
                                .is_some_and(valid_sha256_text)
                            && file.get("sizeBytes").and_then(Value::as_u64).is_some()
                    })
            })
        && canonical_valid
}

fn valid_windows_evidence_document(value: &Value, expected_digest: Option<&str>) -> bool {
    let digest = value.get("inventoryDigest").and_then(Value::as_str);
    let schema = value.get("schemaVersion").and_then(Value::as_u64);
    let evidence_valid = value
        .get("evidence")
        .and_then(Value::as_object)
        .is_some_and(|evidence| {
            ["applicable", "excluded", "unknown"].iter().all(|group| {
                evidence
                    .get(*group)
                    .and_then(Value::as_array)
                    .is_some_and(|items| {
                        items.len() <= 2_000
                            && items
                                .iter()
                                .all(|item| valid_windows_evidence_item(item, group))
                    })
            })
        });
    value.get("documentType").and_then(Value::as_str)
        == Some("minecraft-server-hub-windows-x64-license-evidence")
        && matches!(schema, Some(1 | 2))
        && value.get("localOnly").and_then(Value::as_bool) == Some(true)
        && value
            .get("target")
            .and_then(|target| target.get("rustTarget"))
            .and_then(Value::as_str)
            == Some(CARGO_WINDOWS_X64_TARGET)
        && digest.is_some_and(valid_sha256_text)
        && expected_digest.map_or(true, |expected| digest == Some(expected))
        && evidence_valid
}

fn recognized_supply_chain_json(value: &Value) -> bool {
    value.get("bomFormat").and_then(Value::as_str) == Some("CycloneDX")
        || value.get("spdxVersion").and_then(Value::as_str) == Some("SPDX-2.3")
        || valid_review_document(value)
        || valid_windows_evidence_document(value, None)
}

fn valid_third_party_notices(contents: &str) -> bool {
    const PREFIX: &str = "<!-- minecraft-server-hub-third-party-notices schema=1 inventory-digest=";
    let Some(first_line) = contents.lines().next() else {
        return false;
    };
    let Some(digest) = first_line
        .strip_prefix(PREFIX)
        .and_then(|value| value.strip_suffix(" -->"))
    else {
        return false;
    };
    valid_sha256_text(digest)
        && !contents.contains('\0')
        && contents.contains("## Audited Windows x64 dependency notices")
        && contents.contains("Target: `x86_64-pc-windows-msvc`")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupplyChainReportVerification {
    document_type: String,
    schema_version: u64,
    inventory_digest: String,
    target: String,
    applicable: usize,
    excluded: usize,
    unknown: usize,
    size_bytes: u64,
    sha256: String,
}

#[tauri::command]
pub fn verify_supply_chain_report(
    path: String,
    expected_digest: String,
) -> Result<SupplyChainReportVerification, String> {
    const MAX_EXPORT_BYTES: u64 = 16 * 1024 * 1024;
    if !valid_sha256_text(expected_digest.trim()) {
        return Err("verify-digest-invalid".into());
    }
    let target = PathBuf::from(path.trim());
    let metadata = fs::symlink_metadata(&target).map_err(|_| "verify-file-missing")?;
    if !target.is_absolute()
        || !metadata.file_type().is_file()
        || metadata.file_type().is_symlink()
        || metadata.len() > MAX_EXPORT_BYTES
        || target.extension().and_then(|value| value.to_str()) != Some("json")
    {
        return Err("verify-file-invalid".into());
    }
    let contents = fs::read_to_string(&target).map_err(|error| format!("verify-read: {error}"))?;
    let value: Value =
        serde_json::from_str(&contents).map_err(|error| format!("verify-json-invalid: {error}"))?;
    if !valid_windows_evidence_document(&value, Some(expected_digest.trim())) {
        return Err("verify-evidence-invalid".into());
    }
    let evidence = value
        .get("evidence")
        .and_then(Value::as_object)
        .ok_or("verify-evidence-invalid")?;
    let count = |group: &str| {
        evidence
            .get(group)
            .and_then(Value::as_array)
            .map_or(0, Vec::len)
    };
    Ok(SupplyChainReportVerification {
        document_type: "minecraft-server-hub-windows-x64-license-evidence".into(),
        schema_version: value
            .get("schemaVersion")
            .and_then(Value::as_u64)
            .unwrap_or_default(),
        inventory_digest: expected_digest.trim().to_ascii_uppercase(),
        target: CARGO_WINDOWS_X64_TARGET.into(),
        applicable: count("applicable"),
        excluded: count("excluded"),
        unknown: count("unknown"),
        size_bytes: metadata.len(),
        sha256: sha256(&target)?,
    })
}

fn valid_supply_chain_diff_document(value: &Value) -> bool {
    let text = |value: &Value, key: &str, max: usize, empty: bool| {
        value.get(key).and_then(Value::as_str).is_some_and(|entry| {
            entry.len() <= max && (empty || !entry.is_empty()) && !entry.contains('\0')
        })
    };
    let digest =
        |value: &str| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit());
    let exact_keys = |value: &Value, allowed: &[&str]| {
        value.as_object().is_some_and(|object| {
            object.len() == allowed.len()
                && object.keys().all(|key| allowed.contains(&key.as_str()))
        })
    };
    let valid_summary = |summary: &Value, keys: &[&str]| {
        exact_keys(summary, keys)
            && keys.iter().all(|key| {
                summary
                    .get(*key)
                    .and_then(Value::as_u64)
                    .is_some_and(|count| count <= 10_000)
            })
    };
    let valid_package = |item: &Value| {
        exact_keys(
            item,
            &[
                "ecosystem",
                "name",
                "version",
                "license",
                "licenseClass",
                "direct",
                "development",
                "integrityPresent",
                "componentIds",
                "advisoryIds",
            ],
        ) && matches!(
            item.get("ecosystem").and_then(Value::as_str),
            Some("npm" | "cargo")
        ) && text(item, "name", 512, false)
            && text(item, "version", 512, false)
            && text(item, "license", 512, true)
            && matches!(
                item.get("licenseClass").and_then(Value::as_str),
                Some("permissive" | "reciprocal" | "unknown")
            )
            && item.get("direct").and_then(Value::as_bool).is_some()
            && item.get("development").and_then(Value::as_bool).is_some()
            && item
                .get("integrityPresent")
                .and_then(Value::as_bool)
                .is_some()
            && ["componentIds", "advisoryIds"].iter().all(|key| {
                item.get(*key)
                    .and_then(Value::as_array)
                    .is_some_and(|entries| {
                        entries.len() <= 64
                            && entries.iter().all(|entry| {
                                entry.as_str().is_some_and(|text| {
                                    !text.is_empty() && text.len() <= 512 && !text.contains('\0')
                                })
                            })
                    })
            })
    };
    let valid_snapshot = |snapshot: &Value| {
        let packages = snapshot.get("packages").and_then(Value::as_array);
        exact_keys(
            snapshot,
            &[
                "documentType",
                "schemaVersion",
                "createdAt",
                "inventoryDigest",
                "advisoryChecked",
                "advisoryRequestDigest",
                "packages",
                "summary",
            ],
        ) && snapshot.get("documentType").and_then(Value::as_str)
            == Some("minecraft-server-hub-supply-chain-snapshot")
            && snapshot.get("schemaVersion").and_then(Value::as_u64) == Some(1)
            && text(snapshot, "createdAt", 64, false)
            && snapshot
                .get("inventoryDigest")
                .and_then(Value::as_str)
                .is_some_and(digest)
            && snapshot
                .get("advisoryChecked")
                .and_then(Value::as_bool)
                .is_some()
            && snapshot
                .get("advisoryRequestDigest")
                .and_then(Value::as_str)
                .is_some_and(|entry| entry.is_empty() || digest(entry))
            && packages
                .is_some_and(|entries| entries.len() <= 10_000 && entries.iter().all(valid_package))
            && snapshot.get("summary").is_some_and(|summary| {
                valid_summary(
                    summary,
                    &[
                        "packages",
                        "direct",
                        "development",
                        "unknownLicense",
                        "reciprocalLicense",
                        "missingIntegrity",
                        "affectedPackages",
                    ],
                )
            })
            && snapshot
                .get("summary")
                .and_then(|summary| summary.get("packages"))
                .and_then(Value::as_u64)
                == packages.map(|entries| entries.len() as u64)
    };
    let valid_change = |item: &Value| {
        exact_keys(
            item,
            &[
                "kind",
                "ecosystem",
                "name",
                "beforeVersion",
                "afterVersion",
                "beforeLicenseClass",
                "afterLicenseClass",
                "reasons",
            ],
        ) && matches!(
            item.get("kind").and_then(Value::as_str),
            Some(
                "added"
                    | "removed"
                    | "updated"
                    | "license"
                    | "risk-regression"
                    | "risk-improvement"
            )
        ) && matches!(
            item.get("ecosystem").and_then(Value::as_str),
            Some("npm" | "cargo")
        ) && text(item, "name", 512, false)
            && text(item, "beforeVersion", 512, true)
            && text(item, "afterVersion", 512, true)
            && ["beforeLicenseClass", "afterLicenseClass"]
                .iter()
                .all(|key| {
                    matches!(
                        item.get(*key).and_then(Value::as_str),
                        Some("" | "permissive" | "reciprocal" | "unknown")
                    )
                })
            && item
                .get("reasons")
                .and_then(Value::as_array)
                .is_some_and(|reasons| {
                    reasons.len() <= 16
                        && reasons.iter().all(|reason| {
                            reason
                                .as_str()
                                .is_some_and(|text| !text.is_empty() && text.len() <= 128)
                        })
                })
    };
    let privacy = value.get("privacy");
    let changes = value.get("changes");
    exact_keys(
        value,
        &[
            "documentType",
            "schemaVersion",
            "generatedAt",
            "privacy",
            "baseline",
            "current",
            "summary",
            "changes",
        ],
    ) && value.get("documentType").and_then(Value::as_str)
        == Some("minecraft-server-hub-supply-chain-diff")
        && value.get("schemaVersion").and_then(Value::as_u64) == Some(1)
        && text(value, "generatedAt", 64, false)
        && privacy.is_some_and(|privacy| {
            exact_keys(
                privacy,
                &[
                    "localOnly",
                    "excludesAbsolutePaths",
                    "excludesSources",
                    "excludesIntegrityValues",
                ],
            ) && [
                "localOnly",
                "excludesAbsolutePaths",
                "excludesSources",
                "excludesIntegrityValues",
            ]
            .iter()
            .all(|key| privacy.get(*key).and_then(Value::as_bool) == Some(true))
        })
        && value.get("baseline").is_some_and(valid_snapshot)
        && value.get("current").is_some_and(valid_snapshot)
        && value.get("summary").is_some_and(|summary| {
            valid_summary(
                summary,
                &[
                    "added",
                    "removed",
                    "updated",
                    "licenseChanges",
                    "riskRegressions",
                    "riskImprovements",
                    "unchanged",
                ],
            )
        })
        && changes.is_some_and(|changes| {
            exact_keys(
                changes,
                &[
                    "added",
                    "removed",
                    "updated",
                    "licenseChanges",
                    "riskRegressions",
                    "riskImprovements",
                ],
            ) && [
                "added",
                "removed",
                "updated",
                "licenseChanges",
                "riskRegressions",
                "riskImprovements",
            ]
            .iter()
            .all(|key| {
                changes
                    .get(*key)
                    .and_then(Value::as_array)
                    .is_some_and(|entries| {
                        entries.len() <= 10_000 && entries.iter().all(valid_change)
                    })
            })
        })
}

#[tauri::command]
pub fn write_supply_chain_report(path: String, contents: String) -> Result<String, String> {
    const MAX_EXPORT_BYTES: usize = 16 * 1024 * 1024;
    if contents.len() > MAX_EXPORT_BYTES {
        return Err("export-too-large".into());
    }
    let target = PathBuf::from(path.trim());
    if !target.is_absolute() || !target.parent().is_some_and(Path::is_dir) {
        return Err("export-path-invalid".into());
    }
    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "json" => {
            let value: Value = serde_json::from_str(&contents)
                .map_err(|error| format!("export-json-invalid: {error}"))?;
            let review_digest_valid = value
                .get("inventoryDigest")
                .and_then(Value::as_str)
                .is_some_and(|digest| {
                    digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
                });
            let recognized_review = valid_review_document(&value);
            let evidence_entries_valid = value
                .get("evidence")
                .and_then(Value::as_object)
                .is_some_and(|evidence| {
                    ["applicable", "excluded", "unknown"].iter().all(|group| {
                        evidence
                            .get(*group)
                            .and_then(Value::as_array)
                            .is_some_and(|items| {
                                items.len() <= 2_000
                                    && items.iter().all(|item| {
                                        let text = |key| item.get(key).and_then(Value::as_str);
                                        let logical_path = |value: &str| {
                                            value.len() <= 1_024
                                                && !value.starts_with('/')
                                                && !value.contains(':')
                                                && value.split(['/', '\\']).all(|part| part != "..")
                                        };
                                        matches!(text("ecosystem"), Some("npm" | "cargo"))
                                            && text("name").is_some_and(|name| {
                                                !name.is_empty() && name.len() <= 512
                                            })
                                            && text("version").is_some_and(|version| {
                                                !version.is_empty() && version.len() <= 128
                                            })
                                            && text("hostApplicability") == Some(*group)
                                            && text("status").is_some_and(|status| {
                                                matches!(
                                                    status,
                                                    "complete" | "partial" | "missing" | "mismatch"
                                                )
                                            })
                                            && text("integrity").is_some_and(|integrity| {
                                                matches!(
                                                    integrity,
                                                    "verified" | "unavailable" | "mismatch"
                                                )
                                            })
                                            && text("manifestSource").is_some_and(logical_path)
                                            && item
                                                .get("components")
                                                .and_then(Value::as_array)
                                                .is_some_and(|components| {
                                                    components.len() <= 64
                                                        && components.iter().all(|component| {
                                                            component.as_str().is_some_and(
                                                                |value| {
                                                                    !value.is_empty()
                                                                        && value.len() <= 128
                                                                },
                                                            )
                                                        })
                                                })
                                            && item
                                                .get("files")
                                                .and_then(Value::as_array)
                                                .is_some_and(|files| {
                                                    files.len() <= 16
                                                        && files.iter().all(|file| {
                                                            let name = file
                                                                .get("name")
                                                                .and_then(Value::as_str);
                                                            let hash = file
                                                                .get("sha256")
                                                                .and_then(Value::as_str);
                                                            name.is_some_and(logical_path)
                                                                && hash.is_some_and(|hash| {
                                                                    hash.len() == 64
                                                                    && hash.bytes().all(|byte| {
                                                                        byte.is_ascii_hexdigit()
                                                                    })
                                                                })
                                                        })
                                                })
                                    })
                            })
                    })
                });
            let recognized_windows_evidence = value.get("documentType").and_then(Value::as_str)
                == Some("minecraft-server-hub-windows-x64-license-evidence")
                && value.get("schemaVersion").and_then(Value::as_u64) == Some(1)
                && value.get("localOnly").and_then(Value::as_bool) == Some(true)
                && value
                    .get("target")
                    .and_then(|target| target.get("rustTarget"))
                    .and_then(Value::as_str)
                    == Some(CARGO_WINDOWS_X64_TARGET)
                && review_digest_valid
                && evidence_entries_valid;
            let recognized = recognized_supply_chain_json(&value)
                || value.get("bomFormat").and_then(Value::as_str) == Some("CycloneDX")
                || value.get("spdxVersion").and_then(Value::as_str) == Some("SPDX-2.3")
                || recognized_review
                || recognized_windows_evidence
                || valid_supply_chain_diff_document(&value);
            if !recognized {
                return Err("export-json-unrecognized".into());
            }
        }
        "csv" if contents.starts_with("\"component\",") => {}
        "md" if valid_third_party_notices(&contents) => {}
        _ => return Err("export-extension-invalid".into()),
    }
    fs::write(&target, contents).map_err(|error| format!("export-write: {error}"))?;
    Ok(display_path(&target))
}

#[cfg(test)]
mod tests {
    use super::{
        BASE64_STANDARD, CargoLockedPackage, DependencyPackageSummary, LicenseEvidenceTarget,
        MPL_2_0_HEADER, MPL_2_0_SOURCE_URL, MPL_2_0_TEXT, MPL_2_0_TEXT_SHA256, OsvBatchResponse,
        QUALITY_REQUIRED_STAGE_IDS, advisory_preview, advisory_query_items, append_osv_findings,
        cargo_host_applicability, collect_cargo_license_evidence, collect_npm_license_evidence,
        compare_versions, display_path, inspect_build_environment, inspect_bundle_analysis,
        inspect_capability_security, inspect_local, inspect_quality_evidence,
        npm_host_applicability, quality_source_snapshot, scan_dependency_advisories, sha256,
        valid_sha256_text, valid_workspace, verify_supply_chain_report, write_supply_chain_report,
    };
    use base64::Engine;
    use std::collections::HashSet;
    use std::fs;
    use tempfile::tempdir;

    fn fixture() -> tempfile::TempDir {
        let public_key_text = "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n";
        let public_key = BASE64_STANDARD.encode(public_key_text);
        let signature_text = "untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1556193335\tfile:test\ny/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==\n";
        let signature = BASE64_STANDARD.encode(signature_text);
        let root = tempdir().unwrap();
        fs::create_dir_all(root.path().join("src-tauri")).unwrap();
        fs::create_dir_all(root.path().join("website")).unwrap();
        fs::create_dir_all(root.path().join("developer-tools/src-tauri/capabilities")).unwrap();
        fs::create_dir_all(root.path().join("artifacts/updates/1.2.3")).unwrap();
        fs::create_dir_all(root.path().join("artifacts/updates/1.2.2")).unwrap();
        let npm_manifest = r#"{"version":"1.2.3","dependencies":{"safe-package":"1.0.0"}}"#;
        let npm_lock = r#"{"version":"1.2.3","packages":{"":{"version":"1.2.3","dependencies":{"safe-package":"1.0.0"}},"node_modules/safe-package":{"version":"1.0.0","license":"MIT","resolved":"https://registry.npmjs.org/safe-package/-/safe-package-1.0.0.tgz","integrity":"sha512-fixture"}}}"#;
        fs::write(root.path().join("package.json"), npm_manifest).unwrap();
        fs::write(root.path().join("package-lock.json"), npm_lock).unwrap();
        fs::write(root.path().join("website/package.json"), npm_manifest).unwrap();
        fs::write(root.path().join("website/package-lock.json"), npm_lock).unwrap();
        let cargo_manifest =
            "[package]\nname = \"fixture\"\nversion = \"1.2.3\"\n[dependencies]\nserde = \"1\"\n";
        let cargo_lock = "version = 4\n\n[[package]]\nname = \"fixture\"\nversion = \"1.2.3\"\n\n[[package]]\nname = \"serde\"\nversion = \"1.0.229\"\nsource = \"registry+https://github.com/rust-lang/crates.io-index\"\nchecksum = \"fixture\"\n";
        fs::write(root.path().join("src-tauri/Cargo.toml"), cargo_manifest).unwrap();
        fs::write(root.path().join("src-tauri/Cargo.lock"), cargo_lock).unwrap();
        fs::write(
            root.path().join("developer-tools/src-tauri/Cargo.toml"),
            cargo_manifest,
        )
        .unwrap();
        fs::write(
            root.path().join("developer-tools/src-tauri/Cargo.lock"),
            cargo_lock,
        )
        .unwrap();
        fs::write(
            root.path().join("developer-tools/src-tauri/capabilities/default.json"),
            r#"{"identifier":"main-capability","windows":["main"],"permissions":["core:default","dialog:allow-open","dialog:allow-save"]}"#,
        ).unwrap();
        fs::write(
            root.path().join("developer-tools/src-tauri/tauri.conf.json"),
            r#"{"identifier":"local.minecraft-server-hub.developer-tools","app":{"windows":[{"label":"main"}],"security":{"csp":"default-src 'self'; connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:1421; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'"}}}"#,
        ).unwrap();
        fs::write(
            root.path().join("src-tauri/updater-public.key"),
            &public_key,
        )
        .unwrap();
        fs::write(
            root.path().join("src-tauri/tauri.conf.json"),
            format!(r#"{{"version":"1.2.3","plugins":{{"updater":{{"pubkey":"{public_key}"}}}}}}"#),
        )
        .unwrap();
        fs::write(
            root.path().join("artifacts/updates/1.2.3/Test.exe"),
            b"test",
        )
        .unwrap();
        fs::write(
            root.path().join("artifacts/updates/1.2.3/Test.exe.sig"),
            &signature,
        )
        .unwrap();
        fs::write(root.path().join("artifacts/updates/1.2.3/latest.json"), format!(r#"{{"version":"1.2.3","platforms":{{"windows-x86_64":{{"signature":"{signature}","url":"https://example.com/Test.exe"}}}}}}"#)).unwrap();
        fs::write(
            root.path().join("artifacts/updates/1.2.2/Test.exe"),
            b"test",
        )
        .unwrap();
        fs::write(
            root.path().join("artifacts/updates/1.2.2/Test.exe.sig"),
            &signature,
        )
        .unwrap();
        fs::write(root.path().join("artifacts/updates/1.2.2/latest.json"), format!(r#"{{"version":"1.2.2","platforms":{{"windows-x86_64":{{"signature":"{signature}","url":"https://example.com/Test.exe"}}}}}}"#)).unwrap();
        root
    }

    #[test]
    fn orders_versions_numerically() {
        assert!(compare_versions("0.10.0", "0.9.9").is_gt());
        assert!(compare_versions("1.0.0", "1.0.0").is_eq());
    }

    #[test]
    fn hides_windows_extended_length_prefixes_from_the_ui() {
        assert_eq!(
            display_path(std::path::Path::new(r"\\?\C:\workspace")),
            r"C:\workspace"
        );
        assert_eq!(
            display_path(std::path::Path::new(r"\\?\UNC\server\share")),
            r"\\server\share"
        );
    }

    #[test]
    fn requires_the_expected_workspace_markers() {
        let root = fixture();
        assert!(valid_workspace(root.path()));
        assert!(!valid_workspace(&root.path().join("artifacts")));
    }

    #[test]
    fn blocks_unexpected_capability_and_csp_expansion() {
        let root = fixture();
        let valid = inspect_capability_security(root.path());
        assert_eq!(valid.status, "verified");
        fs::write(
            root.path().join("developer-tools/src-tauri/capabilities/default.json"),
            r#"{"identifier":"main-capability","windows":["main"],"permissions":["core:default","dialog:allow-open","dialog:allow-save","shell:allow-execute"]}"#,
        ).unwrap();
        let audit = inspect_capability_security(root.path());
        assert_eq!(audit.status, "violation");
        assert!(
            audit
                .issues
                .iter()
                .any(|issue| issue == "unexpected-permission:shell:allow-execute")
        );
    }

    #[test]
    fn detects_the_local_windows_x64_build_environment() {
        let audit = inspect_build_environment();
        assert_eq!(audit.status, "ready");
        assert_eq!(audit.host_os, "win32");
        assert_eq!(audit.host_arch, "x64");
        assert!(audit.rust_target_installed);
        assert_eq!(audit.tools.len(), 5);
        assert!(
            audit
                .tools
                .iter()
                .all(|tool| tool.available && !tool.version.is_empty())
        );
    }

    #[test]
    fn inspects_a_consistent_release_without_writes() {
        let root = fixture();
        let report = inspect_local(root.path()).unwrap();
        assert!(report.read_only);
        assert_eq!(report.expected_version, "1.2.3");
        assert_eq!(report.summary.fail, 0);
        assert_eq!(report.release.installer_sha256.len(), 64);
        assert_eq!(
            report
                .checks
                .iter()
                .find(|check| check.id == "signatureMatchesManifest")
                .unwrap()
                .status,
            "pass"
        );
        assert_eq!(
            report
                .checks
                .iter()
                .find(|check| check.id == "artifactHistoryIntegrity")
                .unwrap()
                .status,
            "pass"
        );
        assert_eq!(report.release_history.len(), 2);
        assert_eq!(report.schema_version, 12);
        assert_eq!(report.dependency_inventory.lockfiles.len(), 4);
        assert!(report.dependency_inventory.generated_from_lockfiles);
        assert_eq!(report.dependency_inventory.totals.insecure_source, 0);
        assert_eq!(
            report
                .checks
                .iter()
                .find(|check| check.id == "cryptographicSignature")
                .unwrap()
                .status,
            "pass"
        );
    }

    #[test]
    fn rejects_an_installer_modified_after_signing() {
        let root = fixture();
        fs::write(
            root.path().join("artifacts/updates/1.2.3/Test.exe"),
            b"tampered",
        )
        .unwrap();
        let report = inspect_local(root.path()).unwrap();
        assert_eq!(
            report
                .checks
                .iter()
                .find(|check| check.id == "cryptographicSignature")
                .unwrap()
                .status,
            "fail"
        );
    }

    #[test]
    fn rejects_a_tampered_historical_artifact() {
        let root = fixture();
        fs::write(
            root.path().join("artifacts/updates/1.2.2/Test.exe"),
            b"historical-tampering",
        )
        .unwrap();
        let report = inspect_local(root.path()).unwrap();
        assert_eq!(
            report
                .checks
                .iter()
                .find(|check| check.id == "cryptographicSignature")
                .unwrap()
                .status,
            "pass"
        );
        assert_eq!(
            report
                .checks
                .iter()
                .find(|check| check.id == "artifactHistoryIntegrity")
                .unwrap()
                .status,
            "fail"
        );
    }

    #[test]
    fn rejects_a_workspace_without_release_history() {
        let root = fixture();
        fs::remove_dir_all(root.path().join("artifacts/updates")).unwrap();
        let report = inspect_local(root.path()).unwrap();
        assert_eq!(report.release_history.len(), 0);
        assert_eq!(
            report
                .checks
                .iter()
                .find(|check| check.id == "artifactHistoryIntegrity")
                .unwrap()
                .status,
            "fail"
        );
    }

    #[test]
    fn rejects_a_workspace_with_a_missing_dependency_lockfile() {
        let root = fixture();
        fs::remove_file(root.path().join("website/package-lock.json")).unwrap();
        let report = inspect_local(root.path()).unwrap();
        assert!(!report.dependency_inventory.generated_from_lockfiles);
        assert_eq!(
            report
                .checks
                .iter()
                .find(|check| check.id == "dependencyLockfiles")
                .unwrap()
                .status,
            "fail"
        );
    }

    #[test]
    fn rejects_an_insecure_dependency_source() {
        let root = fixture();
        let lock_path = root.path().join("package-lock.json");
        let lock = fs::read_to_string(&lock_path)
            .unwrap()
            .replace("https://registry.npmjs.org", "http://example.com");
        fs::write(lock_path, lock).unwrap();
        let report = inspect_local(root.path()).unwrap();
        assert_eq!(report.dependency_inventory.totals.insecure_source, 1);
        assert_eq!(
            report
                .checks
                .iter()
                .find(|check| check.id == "dependencyIntegrity")
                .unwrap()
                .status,
            "fail"
        );
    }

    #[test]
    fn classifies_npm_windows_x64_applicability_from_lockfile_metadata() {
        let unrestricted = serde_json::json!({"version":"1.0.0"});
        let windows = serde_json::json!({"os":["win32"],"cpu":["x64"]});
        let darwin = serde_json::json!({"os":["darwin"],"cpu":["x64"]});
        let denied = serde_json::json!({"os":["!win32"]});
        assert_eq!(
            npm_host_applicability(&unrestricted),
            ("applicable".into(), "npm-no-platform-restriction".into())
        );
        assert_eq!(
            npm_host_applicability(&windows),
            ("applicable".into(), "npm-platform-compatible".into())
        );
        assert_eq!(
            npm_host_applicability(&darwin),
            ("excluded".into(), "npm-os-excluded".into())
        );
        assert_eq!(
            npm_host_applicability(&denied),
            ("excluded".into(), "npm-os-excluded".into())
        );
    }

    #[test]
    fn classifies_cargo_windows_x64_applicability_from_exact_metadata_key() {
        let package = CargoLockedPackage {
            name: "serde".into(),
            version: "1.0.229".into(),
            source: "registry+https://github.com/rust-lang/crates.io-index".into(),
            checksum: "fixture".into(),
        };
        let included = HashSet::from([super::cargo_package_key(
            &package.name,
            &package.version,
            &package.source,
        )]);
        assert_eq!(
            cargo_host_applicability(&package, Some(&included)),
            (
                "applicable".into(),
                "cargo-metadata-windows-x64-applicable".into()
            )
        );
        assert_eq!(
            cargo_host_applicability(&package, Some(&HashSet::new())),
            (
                "excluded".into(),
                "cargo-metadata-windows-x64-excluded".into()
            )
        );
        assert_eq!(
            cargo_host_applicability(&package, None),
            ("unknown".into(), "cargo-metadata-unavailable".into())
        );
    }

    #[test]
    fn builds_a_minimal_deduplicated_advisory_preview() {
        let root = fixture();
        let report = inspect_local(root.path()).unwrap();
        let preview = report.dependency_inventory.advisory_preview;
        assert_eq!(preview.endpoint, "https://api.osv.dev/v1/querybatch");
        assert_eq!(preview.total_packages, 4);
        assert_eq!(preview.unique_packages, 2);
        assert_eq!(preview.duplicate_packages, 2);
        assert_eq!(preview.transmitted_fields, ["ecosystem", "name", "version"]);
        assert!(!preview.includes_paths);
        assert!(!preview.includes_sources);
        assert!(!preview.includes_licenses);
        assert_eq!(
            preview.request_digest,
            "DA356F1778B41143DD697A1D656AECE787AFB7D3511BFB1D35DFD7563EA7B6E2"
        );
    }

    #[test]
    fn validates_a_current_bundle_report_and_rejects_tampered_totals() {
        let root = fixture();
        fs::create_dir_all(root.path().join("dist")).unwrap();
        let report_path = root.path().join("dist/bundle-report.json");
        fs::write(
            &report_path,
            r#"{"schemaVersion":1,"generatedAt":"2026-08-31T00:00:00Z","budgets":{"entryJavaScriptBytes":512000,"chunkJavaScriptBytes":512000,"totalJavaScriptGzipBytes":1228800,"totalCssBytes":256000},"totals":{"totalJavaScriptBytes":300000,"totalJavaScriptGzipBytes":90000,"totalCssBytes":10000,"chunks":1,"assets":1},"chunks":[{"fileName":"assets/index.js","name":"index","entry":true,"dynamicEntry":false,"rawBytes":300000,"gzipBytes":90000,"imports":[],"dynamicImports":[],"moduleCount":1,"largestModules":[{"id":"src/main.tsx","renderedBytes":250000}]}],"assets":[{"fileName":"assets/index.css","rawBytes":10000,"gzipBytes":2000}]}"#,
        )
        .unwrap();
        let current = inspect_bundle_analysis(root.path());
        assert_eq!(current.status, "current");
        assert!(current.violations.is_empty());
        fs::write(
            &report_path,
            fs::read_to_string(&report_path).unwrap().replace(
                "\"totalJavaScriptBytes\":300000",
                "\"totalJavaScriptBytes\":1",
            ),
        )
        .unwrap();
        let invalid = inspect_bundle_analysis(root.path());
        assert_eq!(invalid.status, "invalid");
        assert_eq!(invalid.error, "bundle-report-invalid");
    }

    #[test]
    fn validates_current_quality_evidence_and_detects_source_changes() {
        let root = fixture();
        fs::create_dir_all(root.path().join("src")).unwrap();
        fs::create_dir_all(root.path().join("artifacts/developer-tools")).unwrap();
        fs::write(root.path().join("src/main.tsx"), "export {};\n").unwrap();
        let source = quality_source_snapshot(root.path()).unwrap();
        let stages = QUALITY_REQUIRED_STAGE_IDS
            .iter()
            .enumerate()
            .map(|(index, id)| serde_json::json!({
                "id": id,
                "kind": if id.contains("Tests") || *id == "unitCoverage" { "test" } else { "static" },
                "command": format!("fixture-{id}"),
                "status": "pass",
                "exitCode": 0,
                "startedAt": "2026-08-31T00:00:00.000Z",
                "completedAt": "2026-08-31T00:00:01.000Z",
                "durationMs": 1000,
                "tests": if index == 2 { serde_json::json!({"total":10,"passed":10,"failed":0,"skipped":0}) } else { serde_json::json!({"total":0,"passed":0,"failed":0,"skipped":0}) },
                "outputTail": "pass"
            }))
            .collect::<Vec<_>>();
        let report = serde_json::json!({
            "schemaVersion": 1,
            "runnerVersion": "d31-1",
            "generatedAt": "2026-08-31T00:00:07.000Z",
            "startedAt": "2026-08-31T00:00:00.000Z",
            "completedAt": "2026-08-31T00:00:07.000Z",
            "durationMs": 7000,
            "sourceBefore": source,
            "sourceAfter": source,
            "sourceStable": true,
            "requiredStageIds": QUALITY_REQUIRED_STAGE_IDS,
            "summary": {"totalStages":7,"passedStages":7,"failedStages":0,"totalTests":10,"passedTests":10,"failedTests":0,"skippedTests":0},
            "coverage": {
                "available": true,
                "reportPath": "coverage/quality/coverage-summary.json",
                "lines": {"total":100,"covered":80,"skipped":0,"pct":80},
                "statements": {"total":100,"covered":80,"skipped":0,"pct":80},
                "functions": {"total":100,"covered":70,"skipped":0,"pct":70},
                "branches": {"total":100,"covered":60,"skipped":0,"pct":60}
            },
            "stages": stages
        });
        let report_path = root
            .path()
            .join("artifacts/developer-tools/quality-evidence.json");
        fs::write(&report_path, serde_json::to_vec(&report).unwrap()).unwrap();
        let current = inspect_quality_evidence(root.path());
        assert_eq!(current.status, "current");
        assert!(current.coverage_violations.is_empty());
        fs::write(
            root.path().join("src/main.tsx"),
            "export const changed = true;\n",
        )
        .unwrap();
        assert_eq!(inspect_quality_evidence(root.path()).status, "stale");
        let mut tampered = report;
        tampered["summary"]["passedTests"] = serde_json::json!(9);
        fs::write(&report_path, serde_json::to_vec(&tampered).unwrap()).unwrap();
        let invalid = inspect_quality_evidence(root.path());
        assert_eq!(invalid.status, "invalid");
        assert_eq!(invalid.error, "quality-summary-mismatch");
    }

    #[test]
    fn advisory_digest_uses_the_same_locale_independent_order_as_javascript() {
        let package = |ecosystem: &str, name: &str, version: &str, component_id: &str| {
            DependencyPackageSummary {
                component_id: component_id.into(),
                ecosystem: ecosystem.into(),
                name: name.into(),
                version: version.into(),
                direct: false,
                development: false,
                license: String::new(),
                license_class: String::new(),
                source: String::new(),
                integrity: String::new(),
                integrity_present: false,
                reason: String::new(),
                host_applicability: "unknown".into(),
                applicability_reason: "fixture".into(),
            }
        };
        let packages = vec![
            package("npm", "react", "19.2.8", "app"),
            package("npm", "react", "19.2.8", "website"),
            package("npm", "@scope/demo", "1.0.0", "app"),
            package("npm", "Zed", "2.0.0", "app"),
            package("npm", "alpha", "1.0.0", "app"),
            package("cargo", "serde", "1.0.229", "rust"),
        ];
        let preview = advisory_preview(&packages);
        assert_eq!(preview.unique_packages, 5);
        assert_eq!(preview.duplicate_packages, 1);
        assert_eq!(
            preview.request_digest,
            "64E2A1F2176701BBA55AD1DE8BD47DD9D0C3D702049AA28BD839BC3BD18433E1"
        );
    }

    #[test]
    fn maps_osv_results_by_request_order_and_keeps_pagination() {
        let root = fixture();
        let report = inspect_local(root.path()).unwrap();
        let items = advisory_query_items(&report.dependency_inventory.packages);
        let response: OsvBatchResponse = serde_json::from_str(
            r#"{"results":[{"vulns":[{"id":"OSV-FIXTURE","modified":"2026-08-31T00:00:00Z"}],"next_page_token":"page-2"}]}"#,
        )
        .unwrap();
        let mut findings = Vec::new();
        let mut seen = HashSet::new();
        let continuation =
            append_osv_findings(&items[..1], &response.results, &mut findings, &mut seen).unwrap();
        assert_eq!(findings.len(), 1);
        assert_eq!(findings[0].advisory_id, "OSV-FIXTURE");
        assert_eq!(continuation.len(), 1);
        assert_eq!(continuation[0].1, "page-2");
        assert!(
            append_osv_findings(&items, &[], &mut findings, &mut seen)
                .unwrap_err()
                .starts_with("osv-result-count:")
        );
    }

    #[test]
    fn requires_explicit_advisory_consent_before_workspace_or_network_access() {
        let result = tauri::async_runtime::block_on(scan_dependency_advisories(
            "does-not-exist".into(),
            "stale".into(),
            false,
        ));
        assert_eq!(result.unwrap_err(), "advisory-consent-required");
    }

    #[test]
    fn collects_exact_local_npm_license_files_without_exposing_absolute_paths() {
        let root = tempdir().unwrap();
        let package_root = root.path().join("node_modules").join("fixture-mpl");
        fs::create_dir_all(&package_root).unwrap();
        fs::write(
            package_root.join("package.json"),
            r#"{"name":"fixture-mpl","version":"2.0.0","license":"MPL-2.0"}"#,
        )
        .unwrap();
        fs::write(package_root.join("LICENSE"), "fixture license terms").unwrap();
        let target = LicenseEvidenceTarget {
            package: DependencyPackageSummary {
                component_id: "app-npm".into(),
                ecosystem: "npm".into(),
                name: "fixture-mpl".into(),
                version: "2.0.0".into(),
                direct: true,
                development: false,
                license: "MPL-2.0".into(),
                license_class: "reciprocal".into(),
                source: "https://registry.npmjs.org/fixture-mpl.tgz".into(),
                integrity: "sha512-fixture".into(),
                integrity_present: true,
                reason: "reciprocal-license".into(),
                host_applicability: "applicable".into(),
                applicability_reason: "npm-no-platform-restriction".into(),
            },
            component_ids: vec!["app-npm".into()],
        };
        let evidence = collect_npm_license_evidence(root.path(), &target);
        assert_eq!(evidence.status, "complete");
        assert_eq!(evidence.manifest_license, "MPL-2.0");
        assert_eq!(
            evidence.manifest_source,
            "app-npm/node_modules/package.json"
        );
        assert_eq!(evidence.files.len(), 1);
        assert_eq!(evidence.files[0].name, "LICENSE");
        assert!(
            !evidence
                .manifest_source
                .contains(root.path().to_string_lossy().as_ref())
        );
    }

    #[test]
    fn verifies_cached_cargo_archive_and_detects_tampering() {
        let root = tempdir().unwrap();
        let registry = root.path().join("registry");
        let cache = root.path().join("cache");
        let package_root = registry.join("fixture-crate-1.0.0");
        fs::create_dir_all(&package_root).unwrap();
        fs::create_dir_all(&cache).unwrap();
        fs::write(
            package_root.join("Cargo.toml"),
            "[package]\nname = \"fixture-crate\"\nversion = \"1.0.0\"\nlicense = \"MPL-2.0\"\n",
        )
        .unwrap();
        fs::write(package_root.join("LICENSE-MPL"), "fixture cargo license").unwrap();
        let archive = cache.join("fixture-crate-1.0.0.crate");
        fs::write(&archive, b"verified archive").unwrap();
        let checksum = sha256(&archive).unwrap();
        let target = LicenseEvidenceTarget {
            package: DependencyPackageSummary {
                component_id: "app-cargo".into(),
                ecosystem: "cargo".into(),
                name: "fixture-crate".into(),
                version: "1.0.0".into(),
                direct: false,
                development: false,
                license: "MPL-2.0".into(),
                license_class: "reciprocal".into(),
                source: "registry+https://github.com/rust-lang/crates.io-index".into(),
                integrity: checksum,
                integrity_present: true,
                reason: "reciprocal-license".into(),
                host_applicability: "unknown".into(),
                applicability_reason: "cargo-lockfile-target-unknown".into(),
            },
            component_ids: vec!["app-cargo".into()],
        };
        let evidence = collect_cargo_license_evidence(
            &target,
            std::slice::from_ref(&registry),
            std::slice::from_ref(&cache),
            &[],
        );
        assert_eq!(evidence.status, "complete");
        assert_eq!(evidence.integrity, "verified");
        assert_eq!(evidence.files[0].name, "LICENSE-MPL");

        fs::write(&archive, b"tampered archive").unwrap();
        let tampered = collect_cargo_license_evidence(&target, &[registry], &[cache], &[]);
        assert_eq!(tampered.status, "mismatch");
        assert_eq!(tampered.integrity, "mismatch");
        assert_eq!(tampered.reason, "archive-integrity-mismatch");
    }

    #[test]
    fn supplements_mpl_source_header_with_embedded_canonical_license() {
        let root = tempdir().unwrap();
        let registry = root.path().join("registry");
        let cache = root.path().join("cache");
        let package_root = registry.join("fixture-mpl-header-1.0.0");
        fs::create_dir_all(&package_root).unwrap();
        fs::create_dir_all(&cache).unwrap();
        fs::write(
            package_root.join("Cargo.toml"),
            "[package]\nname = \"fixture-mpl-header\"\nversion = \"1.0.0\"\nlicense = \"MPL-2.0\"\n",
        )
        .unwrap();
        fs::write(
            package_root.join("lib.rs"),
            format!("/* {MPL_2_0_HEADER} */\npub fn fixture() {{}}\n"),
        )
        .unwrap();
        let archive = cache.join("fixture-mpl-header-1.0.0.crate");
        fs::write(&archive, b"verified archive without a license file").unwrap();
        let target = LicenseEvidenceTarget {
            package: DependencyPackageSummary {
                component_id: "app-cargo".into(),
                ecosystem: "cargo".into(),
                name: "fixture-mpl-header".into(),
                version: "1.0.0".into(),
                direct: false,
                development: false,
                license: "MPL-2.0".into(),
                license_class: "reciprocal".into(),
                source: "registry+https://github.com/rust-lang/crates.io-index".into(),
                integrity: sha256(&archive).unwrap(),
                integrity_present: true,
                reason: "reciprocal-license".into(),
                host_applicability: "applicable".into(),
                applicability_reason: "cargo-metadata-windows-x64-applicable".into(),
            },
            component_ids: vec!["app-cargo".into()],
        };

        let evidence = collect_cargo_license_evidence(&target, &[registry], &[cache], &[]);
        assert_eq!(evidence.status, "complete");
        assert_eq!(evidence.reason, "source-header-canonical-license-complete");
        assert_eq!(evidence.files.len(), 1);
        assert_eq!(evidence.files[0].name, "lib.rs");
        assert_eq!(evidence.files[0].kind, "license-header");
        let canonical = evidence.canonical_license.unwrap();
        assert_eq!(canonical.spdx_id, "MPL-2.0");
        assert_eq!(canonical.source_url, MPL_2_0_SOURCE_URL);
        assert_eq!(canonical.local_resource, "embedded/MPL-2.0.txt");
        assert_eq!(canonical.size_bytes, 16_726);
        assert_eq!(canonical.sha256, MPL_2_0_TEXT_SHA256);
    }

    #[test]
    fn verifies_exact_locked_cargo_git_checkout_and_collects_workspace_license() {
        let root = tempdir().unwrap();
        let repository = root.path().join("playit-agent-fixture");
        let checkout = repository.join("9e7b9a1");
        fs::create_dir_all(checkout.join(".git/refs/heads")).unwrap();
        fs::create_dir_all(checkout.join("packages/playit-ipc")).unwrap();
        let revision = "9e7b9a1cb42d057e7993e21ef4fe32348d1e7fcd";
        fs::write(checkout.join(".git/HEAD"), "ref: refs/heads/master\n").unwrap();
        fs::write(
            checkout.join(".git/refs/heads/master"),
            format!("{revision}\n"),
        )
        .unwrap();
        fs::write(
            checkout.join("Cargo.toml"),
            "[workspace]\nmembers = [\"packages/playit-ipc\"]\n[workspace.package]\nversion = \"1.0.10\"\n",
        )
        .unwrap();
        fs::write(
            checkout.join("packages/playit-ipc/Cargo.toml"),
            "[package]\nname = \"playit-ipc\"\nversion.workspace = true\n",
        )
        .unwrap();
        fs::write(checkout.join("LICENSE.txt"), "fixture git license terms").unwrap();
        let target = LicenseEvidenceTarget {
            package: DependencyPackageSummary {
                component_id: "app-cargo".into(),
                ecosystem: "cargo".into(),
                name: "playit-ipc".into(),
                version: "1.0.10".into(),
                direct: false,
                development: false,
                license: String::new(),
                license_class: "unknown".into(),
                source: format!("git+https://example.invalid/playit-agent?tag=v1.0.10#{revision}"),
                integrity: String::new(),
                integrity_present: false,
                reason: "unknown-license,missing-integrity".into(),
                host_applicability: "applicable".into(),
                applicability_reason: "cargo-metadata-windows-x64-applicable".into(),
            },
            component_ids: vec!["app-cargo".into()],
        };

        let evidence = collect_cargo_license_evidence(&target, &[], &[], &[repository.clone()]);
        assert_eq!(evidence.status, "complete");
        assert_eq!(evidence.integrity, "verified");
        assert_eq!(
            evidence.manifest_source,
            "cargo-git-checkout/packages/playit-ipc/Cargo.toml"
        );
        assert_eq!(evidence.files.len(), 1);
        assert_eq!(evidence.files[0].name, "LICENSE.txt");
        assert_eq!(evidence.files[0].sha256.len(), 64);
        assert!(
            !evidence
                .manifest_source
                .contains(root.path().to_string_lossy().as_ref())
        );

        fs::write(
            checkout.join(".git/refs/heads/master"),
            "0000000000000000000000000000000000000000\n",
        )
        .unwrap();
        let wrong_revision = collect_cargo_license_evidence(&target, &[], &[], &[repository]);
        assert_eq!(wrong_revision.status, "missing");
        assert_eq!(wrong_revision.integrity, "unavailable");
    }

    #[test]
    fn rejects_short_or_traversing_cargo_git_revisions() {
        assert!(
            super::locked_cargo_git_revision("git+https://example.invalid/repo#9e7b9a1").is_none()
        );
        assert!(
            super::locked_cargo_git_revision("git+https://example.invalid/repo#../../HEAD")
                .is_none()
        );
        assert!(
            super::locked_cargo_git_revision("registry+https://example.invalid#index").is_none()
        );
    }

    #[test]
    fn writes_only_recognized_supply_chain_reports_to_existing_absolute_parents() {
        let root = tempdir().unwrap();
        let cyclone_path = root.path().join("fixture.cdx.json");
        let csv_path = root.path().join("fixture.csv");
        let review_path = root.path().join("fixture.license-review.json");
        let evidence_path = root.path().join("fixture.windows-evidence.json");
        let notices_path = root.path().join("fixture.third-party-notices.md");
        let diff_path = root.path().join("fixture.supply-chain-diff.json");
        write_supply_chain_report(
            cyclone_path.to_string_lossy().into_owned(),
            r#"{"bomFormat":"CycloneDX","specVersion":"1.7"}"#.into(),
        )
        .unwrap();
        write_supply_chain_report(
            csv_path.to_string_lossy().into_owned(),
            "\"component\",\"ecosystem\"\r\n".into(),
        )
        .unwrap();
        write_supply_chain_report(
            review_path.to_string_lossy().into_owned(),
            format!(
                r#"{{"documentType":"minecraft-server-hub-license-review-register","schemaVersion":2,"inventoryDigest":"{}","reviews":[{{"itemId":"cargo:demo@1.0.0:ABC","name":"demo","version":"1.0.0","status":"approved","decision":"approved","reviewer":"Release team","rationale":"Verified exact license obligations.","reviewedAt":"2026-09-01T00:00:00.000Z","expiresAt":"2027-02-28T00:00:00.000Z"}}]}}"#,
                "A".repeat(64)
            ),
        )
        .unwrap();
        let evidence_document = serde_json::json!({
            "documentType": "minecraft-server-hub-windows-x64-license-evidence",
            "schemaVersion": 1,
            "inventoryDigest": "B".repeat(64),
            "localOnly": true,
            "target": { "rustTarget": "x86_64-pc-windows-msvc" },
            "evidence": {
                "applicable": [{
                    "ecosystem": "cargo",
                    "name": "playit-ipc",
                    "version": "1.0.10",
                    "components": ["app-cargo"],
                    "manifestSource": "cargo-git-checkout/packages/playit-ipc/Cargo.toml",
                    "hostApplicability": "applicable",
                    "status": "complete",
                    "integrity": "verified",
                    "files": [{ "name": "LICENSE.txt", "sha256": "C".repeat(64) }]
                }],
                "excluded": [],
                "unknown": []
            }
        });
        write_supply_chain_report(
            evidence_path.to_string_lossy().into_owned(),
            serde_json::to_string_pretty(&evidence_document).unwrap(),
        )
        .unwrap();
        write_supply_chain_report(
            notices_path.to_string_lossy().into_owned(),
            format!("<!-- minecraft-server-hub-third-party-notices schema=1 inventory-digest={} -->\n## Audited Windows x64 dependency notices\n\nTarget: `x86_64-pc-windows-msvc`\n", "D".repeat(64)),
        )
        .unwrap();
        let snapshot = serde_json::json!({
            "documentType": "minecraft-server-hub-supply-chain-snapshot", "schemaVersion": 1,
            "createdAt": "2026-09-01T00:00:00.000Z", "inventoryDigest": "E".repeat(64),
            "advisoryChecked": false, "advisoryRequestDigest": "", "packages": [{
                "ecosystem": "npm", "name": "react", "version": "19.2.8", "license": "MIT",
                "licenseClass": "permissive", "direct": true, "development": false,
                "integrityPresent": true, "componentIds": ["app-npm"], "advisoryIds": []
            }],
            "summary": { "packages": 1, "direct": 1, "development": 0, "unknownLicense": 0, "reciprocalLicense": 0, "missingIntegrity": 0, "affectedPackages": 0 }
        });
        let diff_document = serde_json::json!({
            "documentType": "minecraft-server-hub-supply-chain-diff", "schemaVersion": 1,
            "generatedAt": "2026-09-01T00:01:00.000Z",
            "privacy": { "localOnly": true, "excludesAbsolutePaths": true, "excludesSources": true, "excludesIntegrityValues": true },
            "baseline": snapshot.clone(), "current": snapshot,
            "summary": { "added": 0, "removed": 0, "updated": 0, "licenseChanges": 0, "riskRegressions": 0, "riskImprovements": 0, "unchanged": 1 },
            "changes": { "added": [], "removed": [], "updated": [], "licenseChanges": [], "riskRegressions": [], "riskImprovements": [] }
        });
        write_supply_chain_report(
            diff_path.to_string_lossy().into_owned(),
            serde_json::to_string_pretty(&diff_document).unwrap(),
        )
        .unwrap();
        assert!(cyclone_path.is_file());
        assert!(csv_path.is_file());
        assert!(review_path.is_file());
        assert!(evidence_path.is_file());
        assert!(notices_path.is_file());
        assert!(diff_path.is_file());
        let mut unsafe_diff = diff_document;
        unsafe_diff["baseline"]["packages"][0]["source"] =
            serde_json::json!(r"C:\Users\user\package.json");
        assert_eq!(
            write_supply_chain_report(
                root.path()
                    .join("unsafe-diff.json")
                    .to_string_lossy()
                    .into_owned(),
                serde_json::to_string(&unsafe_diff).unwrap()
            )
            .unwrap_err(),
            "export-json-unrecognized"
        );
        let mut unsafe_evidence = evidence_document;
        unsafe_evidence["evidence"]["applicable"][0]["manifestSource"] =
            serde_json::json!(r"C:\Users\user\LICENSE.txt");
        assert_eq!(
            write_supply_chain_report(
                root.path()
                    .join("unsafe-evidence.json")
                    .to_string_lossy()
                    .into_owned(),
                serde_json::to_string(&unsafe_evidence).unwrap(),
            )
            .unwrap_err(),
            "export-json-unrecognized"
        );
        assert_eq!(
            write_supply_chain_report(
                root.path()
                    .join("unknown.json")
                    .to_string_lossy()
                    .into_owned(),
                r#"{"kind":"unknown"}"#.into(),
            )
            .unwrap_err(),
            "export-json-unrecognized"
        );
        assert_eq!(
            write_supply_chain_report(
                root.path()
                    .join("invalid-review.json")
                    .to_string_lossy()
                    .into_owned(),
                r#"{"documentType":"minecraft-server-hub-license-review-register","schemaVersion":1,"inventoryDigest":"BAD","reviews":[]}"#.into(),
            )
            .unwrap_err(),
            "export-json-unrecognized"
        );
        assert_eq!(
            write_supply_chain_report(
                "relative.json".into(),
                r#"{"bomFormat":"CycloneDX"}"#.into()
            )
            .unwrap_err(),
            "export-path-invalid"
        );
    }

    #[test]
    fn verifies_current_windows_evidence_and_rejects_tampering() {
        let root = tempdir().unwrap();
        let path = root.path().join("current.windows-evidence.json");
        let digest = "A".repeat(64);
        let mut document = serde_json::json!({
            "documentType": "minecraft-server-hub-windows-x64-license-evidence",
            "schemaVersion": 2,
            "inventoryDigest": digest,
            "localOnly": true,
            "target": { "rustTarget": "x86_64-pc-windows-msvc" },
            "evidence": {
                "applicable": [{
                    "ecosystem": "cargo",
                    "name": "selectors",
                    "version": "0.36.1",
                    "components": ["app-cargo", "developer-cargo"],
                    "manifestSource": "cargo-registry/Cargo.toml",
                    "hostApplicability": "applicable",
                    "status": "complete",
                    "integrity": "verified",
                    "reason": "source-header-canonical-license-complete",
                    "canonicalLicense": {
                        "spdxId": "MPL-2.0",
                        "sourceUrl": MPL_2_0_SOURCE_URL,
                        "localResource": "embedded/MPL-2.0.txt",
                        "sizeBytes": MPL_2_0_TEXT.len(),
                        "sha256": MPL_2_0_TEXT_SHA256
                    },
                    "files": [{ "name": "lib.rs", "sizeBytes": 643, "sha256": "B".repeat(64) }]
                }],
                "excluded": [{
                    "ecosystem": "cargo",
                    "name": "libredox",
                    "version": "0.1.21",
                    "components": ["developer-cargo"],
                    "manifestSource": "",
                    "hostApplicability": "excluded",
                    "status": "missing",
                    "integrity": "unavailable",
                    "reason": "local-manifest-missing",
                    "files": []
                }],
                "unknown": []
            }
        });
        fs::write(&path, serde_json::to_string_pretty(&document).unwrap()).unwrap();
        let verified =
            verify_supply_chain_report(path.to_string_lossy().into_owned(), "A".repeat(64))
                .unwrap();
        assert_eq!(verified.schema_version, 2);
        assert_eq!(verified.applicable, 1);
        assert_eq!(verified.excluded, 1);
        assert_eq!(verified.unknown, 0);
        assert!(valid_sha256_text(&verified.sha256));

        assert_eq!(
            verify_supply_chain_report(path.to_string_lossy().into_owned(), "C".repeat(64),)
                .unwrap_err(),
            "verify-evidence-invalid"
        );
        document["evidence"]["applicable"][0]["canonicalLicense"]["sha256"] =
            serde_json::json!("0".repeat(64));
        fs::write(&path, serde_json::to_string(&document).unwrap()).unwrap();
        assert_eq!(
            verify_supply_chain_report(path.to_string_lossy().into_owned(), "A".repeat(64),)
                .unwrap_err(),
            "verify-evidence-invalid"
        );
    }
}
