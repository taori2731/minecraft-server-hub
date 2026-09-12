import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { buildAdvisoryPreview, cargoHostApplicability, computeQualitySourceSnapshot, inspectBuildEnvironment, inspectBundleAnalysis, inspectCapabilitySecurity, inspectDeveloperWorkspace, inspectQualityEvidence, isSafeUpdateUrl, npmHostApplicability, QUALITY_REQUIRED_STAGE_IDS } from "./developer-inspection.mjs";

const execFileAsync = promisify(execFile);

async function fixture() {
  const publicKeyText = "untrusted comment: minisign public key E7620F1842B4E81F\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n";
  const publicKey = Buffer.from(publicKeyText, "utf8").toString("base64");
  const signatureText = "untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1556193335\tfile:test\ny/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==\n";
  const signature = Buffer.from(signatureText, "utf8").toString("base64");
  const root = await mkdtemp(path.join(os.tmpdir(), "msh-developer-inspection-"));
  await mkdir(path.join(root, "src-tauri"), { recursive: true });
  await mkdir(path.join(root, "website"), { recursive: true });
  await mkdir(path.join(root, "developer-tools", "src-tauri", "capabilities"), { recursive: true });
  await mkdir(path.join(root, "artifacts", "updates", "1.2.3"), { recursive: true });
  await mkdir(path.join(root, "artifacts", "updates", "1.2.2"), { recursive: true });
  const npmManifest = { version: "1.2.3", dependencies: { "safe-package": "1.0.0" } };
  const npmLock = { version: "1.2.3", packages: { "": npmManifest, "node_modules/safe-package": { version: "1.0.0", license: "MIT", resolved: "https://registry.npmjs.org/safe-package/-/safe-package-1.0.0.tgz", integrity: "sha512-fixture" } } };
  await writeFile(path.join(root, "package.json"), JSON.stringify(npmManifest));
  await writeFile(path.join(root, "package-lock.json"), JSON.stringify(npmLock));
  await writeFile(path.join(root, "website", "package.json"), JSON.stringify(npmManifest));
  await writeFile(path.join(root, "website", "package-lock.json"), JSON.stringify(npmLock));
  const cargoManifest = '[package]\nname = "fixture"\nversion = "1.2.3"\n[dependencies]\nserde = "1"\n';
  const cargoLock = 'version = 4\n\n[[package]]\nname = "fixture"\nversion = "1.2.3"\n\n[[package]]\nname = "serde"\nversion = "1.0.229"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "fixture"\n';
  await writeFile(path.join(root, "src-tauri", "Cargo.toml"), cargoManifest);
  await writeFile(path.join(root, "src-tauri", "Cargo.lock"), cargoLock);
  await writeFile(path.join(root, "developer-tools", "src-tauri", "Cargo.toml"), cargoManifest);
  await writeFile(path.join(root, "developer-tools", "src-tauri", "Cargo.lock"), cargoLock);
  await writeFile(path.join(root, "developer-tools", "src-tauri", "capabilities", "default.json"), JSON.stringify({
    identifier: "main-capability",
    windows: ["main"],
    permissions: ["core:default", "dialog:allow-open", "dialog:allow-save"],
  }));
  await writeFile(path.join(root, "developer-tools", "src-tauri", "tauri.conf.json"), JSON.stringify({
    identifier: "local.minecraft-server-hub.developer-tools",
    app: {
      windows: [{ label: "main" }],
      security: { csp: "default-src 'self'; connect-src 'self' ipc: http://ipc.localhost http://127.0.0.1:1421; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'" },
    },
  }));
  await writeFile(path.join(root, "src-tauri", "updater-public.key"), publicKey);
  await writeFile(path.join(root, "src-tauri", "tauri.conf.json"), JSON.stringify({ version: "1.2.3", plugins: { updater: { pubkey: publicKey } } }));
  const installer = "Fixture_1.2.3_x64-setup.exe";
  await writeFile(path.join(root, "artifacts", "updates", "1.2.3", installer), "test");
  await writeFile(path.join(root, "artifacts", "updates", "1.2.3", `${installer}.sig`), signature);
  await writeFile(path.join(root, "artifacts", "updates", "1.2.3", "latest.json"), JSON.stringify({
    version: "1.2.3",
    pub_date: "2026-08-31T00:00:00Z",
    platforms: { "windows-x86_64": { signature, url: `https://example.com/${installer}` } },
  }));
  const previousInstaller = "Fixture_1.2.2_x64-setup.exe";
  await writeFile(path.join(root, "artifacts", "updates", "1.2.2", previousInstaller), "test");
  await writeFile(path.join(root, "artifacts", "updates", "1.2.2", `${previousInstaller}.sig`), signature);
  await writeFile(path.join(root, "artifacts", "updates", "1.2.2", "latest.json"), JSON.stringify({
    version: "1.2.2",
    pub_date: "2026-08-30T00:00:00Z",
    platforms: { "windows-x86_64": { signature, url: `https://example.com/${previousInstaller}` } },
  }));
  return root;
}

test("accepts only authentication-free HTTPS release URLs", () => {
  assert.equal(isSafeUpdateUrl("https://example.com/latest.json"), true);
  assert.equal(isSafeUpdateUrl("http://example.com/latest.json"), false);
  assert.equal(isSafeUpdateUrl("https://user:secret@example.com/latest.json"), false);
  assert.equal(isSafeUpdateUrl("https://example.com/latest.json?token=hidden"), false);
  assert.equal(isSafeUpdateUrl("https://example.com/latest.json#latest"), false);
});

test("keeps the 0.4.1 release workflow on the Tauri-only signing path", async () => {
  const workflow = await readFile(path.join(process.cwd(), ".github", "workflows", "sign-windows-release.yml"), "utf8");
  assert.doesNotMatch(workflow, /signpath|authenticode/i);
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/);
  assert.match(workflow, /RELEASE_REPO_TOKEN/);
  assert.match(workflow, /RELEASE_VERSION -ne "0\.4\.1"/);
  assert.match(workflow, /RELEASE_TAG -ne "v0\.4\.1"/);
  assert.match(workflow, /--draft/);
  assert.match(workflow, /--draft=false/);
  assert.match(workflow, /--latest/);
  assert.match(workflow, /Minecraft\.Server\.Hub_\$\{env:RELEASE_VERSION\}_x64-setup\.exe/);
  assert.match(workflow, /verifies_a_built_updater_with_the_embedded_public_key/);
  assert.match(workflow, /releases\/latest\/download\/latest\.json/);
});

test("reports a consistent local signed release without mutating the workspace", async () => {
  const root = await fixture();
  try {
    const report = await inspectDeveloperWorkspace(root, { checkRemoteFeed: false });
    assert.equal(report.readOnly, true);
    assert.equal(report.schemaVersion, 12);
    assert.equal(report.expectedVersion, "1.2.3");
    assert.equal(report.release.artifactVersion, "1.2.3");
    assert.match(report.release.installerSha256, /^[A-F0-9]{64}$/);
    assert.equal(report.checks.find((check) => check.id === "versionConsistency")?.status, "pass");
    assert.equal(report.checks.find((check) => check.id === "signatureMatchesManifest")?.status, "pass");
    assert.equal(report.checks.find((check) => check.id === "cryptographicSignature")?.status, "pass");
    assert.equal(report.checks.find((check) => check.id === "artifactHistoryIntegrity")?.status, "pass");
    assert.equal(report.checks.find((check) => check.id === "dependencyLockfiles")?.status, "pass");
    assert.equal(report.checks.find((check) => check.id === "dependencyIntegrity")?.status, "pass");
    assert.equal(report.checks.find((check) => check.id === "developerCapabilityPolicy")?.status, "pass");
    assert.equal(report.capabilitySecurity.status, "verified");
    assert.equal(report.buildEnvironment.status, "ready");
    assert.equal(report.checks.find((check) => check.id === "developerBuildEnvironment")?.status, "pass");
    assert.equal(report.dependencyInventory.lockfiles.length, 4);
    assert.equal(report.dependencyInventory.totals.insecureSource, 0);
    assert.equal(report.dependencyInventory.packages.length, 4);
    assert.ok(report.dependencyInventory.packages.filter((item) => item.ecosystem === "npm").every((item) => item.hostApplicability === "applicable" && item.applicabilityReason === "npm-no-platform-restriction"));
    assert.ok(report.dependencyInventory.packages.filter((item) => item.ecosystem === "cargo").every((item) => item.hostApplicability === "unknown" && item.applicabilityReason === "cargo-metadata-unavailable"));
    assert.equal(report.dependencyInventory.advisoryPreview.uniquePackages, 2);
    assert.equal(report.dependencyInventory.advisoryPreview.duplicatePackages, 2);
    assert.deepEqual(report.dependencyInventory.advisoryPreview.transmittedFields, ["ecosystem", "name", "version"]);
    assert.equal(report.dependencyInventory.advisoryPreview.includesPaths, false);
    assert.deepEqual(report.releaseHistory.map((entry) => entry.version), ["1.2.3", "1.2.2"]);
    assert.equal(report.summary.fail, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("detects the local Windows x64 build toolchain without opening consoles", async () => {
  const audit = await inspectBuildEnvironment();
  assert.equal(audit.hostOs, "win32");
  assert.equal(audit.hostArch, "x64");
  assert.equal(audit.rustTargetInstalled, true);
  assert.deepEqual(audit.tools.map((tool) => tool.id), ["node", "npm", "rustc", "cargo", "rustup"]);
  assert.ok(audit.tools.every((tool) => tool.available && /^\d+\.\d+/.test(tool.version)));
});

test("blocks unexpected Tauri permissions and CSP directives", async () => {
  const root = await fixture();
  try {
    const capabilityPath = path.join(root, "developer-tools", "src-tauri", "capabilities", "default.json");
    const configPath = path.join(root, "developer-tools", "src-tauri", "tauri.conf.json");
    const capability = JSON.parse(await readFile(capabilityPath, "utf8"));
    capability.permissions.push("shell:allow-execute");
    await writeFile(capabilityPath, JSON.stringify(capability));
    const config = JSON.parse(await readFile(configPath, "utf8"));
    config.app.security.csp += "; script-src 'self' 'unsafe-eval'";
    await writeFile(configPath, JSON.stringify(config));
    const audit = await inspectCapabilitySecurity(root);
    assert.equal(audit.status, "violation");
    assert.ok(audit.issues.includes("unexpected-permission:shell:allow-execute"));
    assert.ok(audit.issues.includes("csp-unexpected-directive:script-src"));
    const report = await inspectDeveloperWorkspace(root, { checkRemoteFeed: false });
    assert.equal(report.checks.find((check) => check.id === "developerCapabilityPolicy")?.status, "fail");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("classifies npm Windows x64 applicability from exact lockfile metadata", () => {
  assert.deepEqual(npmHostApplicability({ version: "1.0.0" }), { hostApplicability: "applicable", applicabilityReason: "npm-no-platform-restriction" });
  assert.deepEqual(npmHostApplicability({ os: ["win32"], cpu: ["x64"] }), { hostApplicability: "applicable", applicabilityReason: "npm-platform-compatible" });
  assert.deepEqual(npmHostApplicability({ os: ["darwin"], cpu: ["x64"] }), { hostApplicability: "excluded", applicabilityReason: "npm-os-excluded" });
  assert.deepEqual(npmHostApplicability({ os: ["!win32"] }), { hostApplicability: "excluded", applicabilityReason: "npm-os-excluded" });
});

test("classifies Cargo Windows x64 applicability from the exact metadata package key", () => {
  const source = "registry+https://github.com/rust-lang/crates.io-index";
  const packageItem = { name: "serde", version: "1.0.229", source };
  const included = { available: true, packages: new Set([`serde\0${packageItem.version}\0${source}`]) };
  assert.deepEqual(cargoHostApplicability(packageItem, included), {
    hostApplicability: "applicable",
    applicabilityReason: "cargo-metadata-windows-x64-applicable",
  });
  assert.deepEqual(cargoHostApplicability(packageItem, { available: true, packages: new Set() }), {
    hostApplicability: "excluded",
    applicabilityReason: "cargo-metadata-windows-x64-excluded",
  });
  assert.deepEqual(cargoHostApplicability(packageItem, { available: false, packages: new Set() }), {
    hostApplicability: "unknown",
    applicabilityReason: "cargo-metadata-unavailable",
  });
});

test("reads bundle budgets without running a build and detects stale reports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "msh-bundle-inspection-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "src", "main.tsx"), "export {};\n");
    await writeFile(path.join(root, "package.json"), "{}\n");
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    await writeFile(path.join(root, "vite.config.ts"), "export default {};\n");
    await writeFile(path.join(root, "dist", "bundle-report.json"), JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-08-31T00:00:00.000Z",
      budgets: { entryJavaScriptBytes: 512000, chunkJavaScriptBytes: 512000, totalJavaScriptGzipBytes: 1228800, totalCssBytes: 256000 },
      totals: { totalJavaScriptBytes: 530000, totalJavaScriptGzipBytes: 140000, totalCssBytes: 10000, chunks: 1, assets: 1 },
      chunks: [{ fileName: "assets/index.js", name: "index", entry: true, dynamicEntry: false, rawBytes: 530000, gzipBytes: 140000, imports: [], dynamicImports: [], moduleCount: 1, largestModules: [{ id: "src/main.tsx", renderedBytes: 500000 }] }],
      assets: [{ fileName: "assets/index.css", rawBytes: 10000, gzipBytes: 2000 }],
    }));
    const current = await inspectBundleAnalysis(root);
    assert.equal(current.status, "current");
    assert.deepEqual(current.violations.map((item) => item.id), ["entryJavaScript", "chunkJavaScript"]);
    const future = new Date(Date.now() + 5_000);
    await utimes(path.join(root, "src", "main.tsx"), future, future);
    assert.equal((await inspectBundleAnalysis(root)).status, "stale");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("accepts current quality evidence and rejects stale or tampered summaries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "msh-quality-inspection-"));
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await mkdir(path.join(root, "artifacts", "developer-tools"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}\n");
    await writeFile(path.join(root, "package-lock.json"), "{}\n");
    await writeFile(path.join(root, "vite.config.ts"), "export default {};\n");
    await writeFile(path.join(root, "src", "main.tsx"), "export {};\n");
    const source = await computeQualitySourceSnapshot(root);
    const stages = QUALITY_REQUIRED_STAGE_IDS.map((id, index) => ({
      id,
      kind: id.includes("Tests") || id === "unitCoverage" ? "test" : "static",
      command: `fixture-${id}`,
      status: "pass",
      exitCode: 0,
      startedAt: "2026-08-31T00:00:00.000Z",
      completedAt: "2026-08-31T00:00:01.000Z",
      durationMs: 1_000,
      tests: index === 2 ? { total: 10, passed: 10, failed: 0, skipped: 0 } : { total: 0, passed: 0, failed: 0, skipped: 0 },
      outputTail: "pass",
    }));
    const report = {
      schemaVersion: 1,
      runnerVersion: "d31-1",
      generatedAt: "2026-08-31T00:00:07.000Z",
      startedAt: "2026-08-31T00:00:00.000Z",
      completedAt: "2026-08-31T00:00:07.000Z",
      durationMs: 7_000,
      sourceBefore: source,
      sourceAfter: source,
      sourceStable: true,
      requiredStageIds: [...QUALITY_REQUIRED_STAGE_IDS],
      summary: { totalStages: 7, passedStages: 7, failedStages: 0, totalTests: 10, passedTests: 10, failedTests: 0, skippedTests: 0 },
      coverage: {
        available: true,
        reportPath: "coverage/quality/coverage-summary.json",
        lines: { total: 100, covered: 80, skipped: 0, pct: 80 },
        statements: { total: 100, covered: 80, skipped: 0, pct: 80 },
        functions: { total: 100, covered: 70, skipped: 0, pct: 70 },
        branches: { total: 100, covered: 60, skipped: 0, pct: 60 },
      },
      stages,
    };
    const reportPath = path.join(root, "artifacts", "developer-tools", "quality-evidence.json");
    await writeFile(reportPath, JSON.stringify(report));
    const current = await inspectQualityEvidence(root);
    assert.equal(current.status, "current");
    assert.equal(current.coverageViolations.length, 0);
    await writeFile(path.join(root, "src", "main.tsx"), "export const changed = true;\n");
    assert.equal((await inspectQualityEvidence(root)).status, "stale");
    report.summary.passedTests = 9;
    await writeFile(reportPath, JSON.stringify(report));
    const invalid = await inspectQualityEvidence(root);
    assert.equal(invalid.status, "invalid");
    assert.equal(invalid.error, "quality-summary-mismatch");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("builds a deterministic minimal OSV query preview", () => {
  const packages = [
    { ecosystem: "npm", name: "react", version: "19.2.8", componentId: "app" },
    { ecosystem: "npm", name: "react", version: "19.2.8", componentId: "website" },
    { ecosystem: "npm", name: "@scope/demo", version: "1.0.0", componentId: "app" },
    { ecosystem: "npm", name: "Zed", version: "2.0.0", componentId: "app" },
    { ecosystem: "npm", name: "alpha", version: "1.0.0", componentId: "app" },
    { ecosystem: "cargo", name: "serde", version: "1.0.229", componentId: "rust" },
  ];
  const first = buildAdvisoryPreview(packages);
  const second = buildAdvisoryPreview([...packages].reverse());
  assert.equal(first.uniquePackages, 5);
  assert.equal(first.duplicatePackages, 1);
  assert.equal(first.requestDigest, second.requestDigest);
  assert.equal(first.requestDigest, "64E2A1F2176701BBA55AD1DE8BD47DD9D0C3D702049AA28BD839BC3BD18433E1");
  assert.deepEqual(first.transmittedFields, ["ecosystem", "name", "version"]);
  assert.equal(first.includesPaths, false);
  assert.equal(first.includesSources, false);
  assert.equal(first.includesLicenses, false);
});

test("marks mismatched versions and signatures as blockers", async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, "src-tauri", "Cargo.toml"), '[package]\nname = "fixture"\nversion = "9.9.9"\n');
    await writeFile(path.join(root, "artifacts", "updates", "1.2.3", "Fixture_1.2.3_x64-setup.exe.sig"), "different-signature");
    const report = await inspectDeveloperWorkspace(root, { checkRemoteFeed: false });
    assert.equal(report.checks.find((check) => check.id === "versionConsistency")?.status, "fail");
    assert.equal(report.checks.find((check) => check.id === "signatureMatchesManifest")?.status, "fail");
    assert.equal(report.checks.find((check) => check.id === "cryptographicSignature")?.status, "fail");
    assert.equal(report.checks.find((check) => check.id === "artifactHistoryIntegrity")?.status, "fail");
    assert.equal(report.summary.fail, 4);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("detects a tampered historical artifact without blaming the current release", async () => {
  const root = await fixture();
  try {
    await writeFile(path.join(root, "artifacts", "updates", "1.2.2", "Fixture_1.2.2_x64-setup.exe"), "tampered-history");
    const report = await inspectDeveloperWorkspace(root, { checkRemoteFeed: false });
    assert.equal(report.checks.find((check) => check.id === "cryptographicSignature")?.status, "pass");
    assert.equal(report.checks.find((check) => check.id === "artifactHistoryIntegrity")?.status, "fail");
    assert.equal(report.releaseHistory.find((entry) => entry.version === "1.2.2")?.signatureValid, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects a workspace without a release history", async () => {
  const root = await fixture();
  try {
    await rm(path.join(root, "artifacts", "updates"), { recursive: true, force: true });
    const report = await inspectDeveloperWorkspace(root, { checkRemoteFeed: false });
    assert.equal(report.releaseHistory.length, 0);
    assert.equal(report.checks.find((check) => check.id === "artifactHistoryIntegrity")?.status, "fail");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("blocks a missing dependency lockfile", async () => {
  const root = await fixture();
  try {
    await rm(path.join(root, "website", "package-lock.json"), { force: true });
    const report = await inspectDeveloperWorkspace(root, { checkRemoteFeed: false });
    assert.equal(report.dependencyInventory.generatedFromLockfiles, false);
    assert.equal(report.checks.find((check) => check.id === "dependencyLockfiles")?.status, "fail");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("blocks an insecure dependency source and flags unknown licensing", async () => {
  const root = await fixture();
  try {
    const lockPath = path.join(root, "package-lock.json");
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    lock.packages["node_modules/safe-package"].resolved = "http://example.com/safe-package.tgz";
    lock.packages["node_modules/safe-package"].license = "";
    await writeFile(lockPath, JSON.stringify(lock));
    const report = await inspectDeveloperWorkspace(root, { checkRemoteFeed: false });
    assert.equal(report.checks.find((check) => check.id === "dependencyIntegrity")?.status, "fail");
    assert.equal(report.checks.find((check) => check.id === "dependencyLicenseMetadata")?.status, "warning");
    assert.equal(report.dependencyInventory.reviewPackages.some((item) => item.reason.includes("insecure-source") && item.reason.includes("unknown-license")), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("writes an explicitly requested inspection report without mixing progress text into JSON", async () => {
  const root = await fixture();
  try {
    const output = path.join(root, "artifacts", "developer-tools", "inspection.json");
    const script = path.join(process.cwd(), "scripts", "developer-inspection.mjs");
    const result = await execFileAsync(process.execPath, [script, root, "--output", output], { windowsHide: true });
    const report = JSON.parse(await readFile(output, "utf8"));
    assert.equal(report.schemaVersion, 12);
    assert.equal(report.workspaceRoot, root);
    assert.match(result.stdout, /Inspection report:/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
