import { createHash, createPublicKey, verify } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

export const OFFICIAL_UPDATE_FEED = "https://github.com/taori2731/minecraft-server-hub-releases/releases/latest/download/latest.json";
export const OSV_QUERY_ENDPOINT = "https://api.osv.dev/v1/querybatch";
export const CARGO_WINDOWS_X64_TARGET = "x86_64-pc-windows-msvc";
export const DEVELOPER_ALLOWED_PERMISSIONS = ["core:default", "dialog:allow-open", "dialog:allow-save"];
export const REQUIRED_BUILD_TOOLS = ["node", "npm", "rustc", "cargo", "rustup"];

const DEVELOPER_CAPABILITY_PATH = "developer-tools/src-tauri/capabilities/default.json";
const DEVELOPER_TAURI_CONFIG_PATH = "developer-tools/src-tauri/tauri.conf.json";
const DEVELOPER_APP_IDENTIFIER = "local.minecraft-server-hub.developer-tools";
const DEVELOPER_CAPABILITY_IDENTIFIER = "main-capability";
const DEVELOPER_WINDOW_LABEL = "main";
const DEVELOPER_CSP_POLICY = {
  "default-src": ["'self'"],
  "connect-src": ["'self'", "ipc:", "http://ipc.localhost", "http://127.0.0.1:1421"],
  "img-src": ["'self'", "data:"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "font-src": ["'self'"],
};

const execFileAsync = promisify(execFile);

const asMessage = (reason) => reason instanceof Error ? reason.message : String(reason);
const safeText = async (file) => {
  try { return await readFile(file, "utf8"); }
  catch { return undefined; }
};
const safeJson = async (file) => {
  const source = await safeText(file);
  if (source === undefined) return undefined;
  try { return JSON.parse(source); }
  catch { return undefined; }
};
const exists = async (file) => {
  try { await access(file); return true; }
  catch { return false; }
};
const relative = (root, file) => path.relative(root, file).replaceAll("\\", "/");
const versionParts = (value) => String(value ?? "").split(/[.-]/).map((part) => /^\d+$/.test(part) ? Number(part) : part);
const compareVersions = (left, right) => {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x).localeCompare(String(y), "en", { numeric: true });
  }
  return 0;
};

const DEPENDENCY_TARGETS = [
  { id: "app-npm", ecosystem: "npm", manifestPath: "package.json", lockfilePath: "package-lock.json" },
  { id: "website-npm", ecosystem: "npm", manifestPath: "website/package.json", lockfilePath: "website/package-lock.json" },
  { id: "app-cargo", ecosystem: "cargo", manifestPath: "src-tauri/Cargo.toml", lockfilePath: "src-tauri/Cargo.lock" },
  { id: "developer-cargo", ecosystem: "cargo", manifestPath: "developer-tools/src-tauri/Cargo.toml", lockfilePath: "developer-tools/src-tauri/Cargo.lock" },
];

export const QUALITY_REQUIRED_STAGE_IDS = [
  "appTypecheck",
  "developerTypecheck",
  "unitCoverage",
  "developerNodeTests",
  "rustFormat",
  "rustTests",
  "uiSmoke",
];

export const QUALITY_COVERAGE_THRESHOLDS = {
  lines: 70,
  statements: 70,
  functions: 60,
  branches: 55,
};

const QUALITY_SOURCE_TARGETS = [
  "package.json", "package-lock.json", "tsconfig.json", "tsconfig.node.json", "vite.config.ts",
  "scripts", "src", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json", "src-tauri/src",
  "developer-tools/vite.config.ts", "developer-tools/tsconfig.json", "developer-tools/src",
  "developer-tools/src-tauri/Cargo.toml", "developer-tools/src-tauri/Cargo.lock", "developer-tools/src-tauri/src",
  "website/package.json", "website/package-lock.json", "website/tsconfig.json", "website/vite.config.ts", "website/src",
];

const QUALITY_SOURCE_EXTENSION = /\.(?:cjs|css|html|js|json|mjs|rs|toml|ts|tsx)$/i;
const reciprocalLicensePattern = /(?:^|[^A-Z])(?:A?GPL|LGPL|MPL|EPL|CDDL)(?:[^A-Z]|$)/i;
const unknownLicensePattern = /^(?:|UNKNOWN|UNLICENSED|SEE LICENSE|NOASSERTION)$/i;
const classifyLicense = (license) => unknownLicensePattern.test(String(license ?? "").trim())
  ? "unknown"
  : reciprocalLicensePattern.test(String(license)) ? "reciprocal" : "permissive";
const secureDependencySource = (source) => !source
  || /^(?:https:|registry\+https:|git\+https:|file:|link:)/i.test(source);
const npmPackageName = (packagePath) => packagePath.split("node_modules/").at(-1) ?? packagePath;

const stringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
const sortedUnique = (values) => [...new Set(values)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
const parseCsp = (value) => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const directives = [];
  for (const source of value.split(";")) {
    const tokens = source.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    directives.push({ name: tokens[0].toLowerCase(), values: tokens.slice(1) });
  }
  return directives;
};

export async function inspectCapabilitySecurity(root) {
  const capabilityFile = path.join(root, DEVELOPER_CAPABILITY_PATH);
  const configFile = path.join(root, DEVELOPER_TAURI_CONFIG_PATH);
  const capabilityPresent = await exists(capabilityFile);
  const configurationPresent = await exists(configFile);
  const capability = capabilityPresent ? await safeJson(capabilityFile) : undefined;
  const configuration = configurationPresent ? await safeJson(configFile) : undefined;
  const permissions = stringArray(capability?.permissions);
  const windows = stringArray(capability?.windows);
  const configuredWindows = stringArray(configuration?.app?.windows?.map?.((item) => item?.label));
  const csp = configuration?.app?.security?.csp;
  const directives = parseCsp(csp);
  const issues = [];

  if (!capabilityPresent) issues.push("capability-file-missing");
  else if (!capability || !permissions || !windows || typeof capability.identifier !== "string") issues.push("capability-file-invalid");
  if (!configurationPresent) issues.push("tauri-config-missing");
  else if (!configuration || !configuredWindows || typeof configuration.identifier !== "string") issues.push("tauri-config-invalid");

  if (capability && permissions && windows) {
    if (capability.identifier !== DEVELOPER_CAPABILITY_IDENTIFIER) issues.push(`capability-identifier:${String(capability.identifier ?? "")}`);
    for (const permission of DEVELOPER_ALLOWED_PERMISSIONS.filter((item) => !permissions.includes(item))) issues.push(`missing-permission:${permission}`);
    for (const permission of permissions.filter((item) => !DEVELOPER_ALLOWED_PERMISSIONS.includes(item))) issues.push(`unexpected-permission:${permission}`);
    if (new Set(permissions).size !== permissions.length) issues.push("duplicate-permission");
    if (!windows.includes(DEVELOPER_WINDOW_LABEL)) issues.push(`missing-capability-window:${DEVELOPER_WINDOW_LABEL}`);
    for (const windowLabel of windows.filter((item) => item !== DEVELOPER_WINDOW_LABEL)) issues.push(`unexpected-capability-window:${windowLabel}`);
    if (new Set(windows).size !== windows.length) issues.push("duplicate-capability-window");
  }

  if (configuration && configuredWindows) {
    if (configuration.identifier !== DEVELOPER_APP_IDENTIFIER) issues.push(`app-identifier:${String(configuration.identifier ?? "")}`);
    if (!configuredWindows.includes(DEVELOPER_WINDOW_LABEL)) issues.push(`missing-configured-window:${DEVELOPER_WINDOW_LABEL}`);
    for (const windowLabel of configuredWindows.filter((item) => item !== DEVELOPER_WINDOW_LABEL)) issues.push(`unexpected-configured-window:${windowLabel}`);
    if (new Set(configuredWindows).size !== configuredWindows.length) issues.push("duplicate-configured-window");
  }

  if (configuration && !directives) issues.push("csp-missing");
  if (directives) {
    const seen = new Set();
    for (const directive of directives) {
      if (seen.has(directive.name)) issues.push(`csp-duplicate-directive:${directive.name}`);
      seen.add(directive.name);
    }
    for (const [name, expectedValues] of Object.entries(DEVELOPER_CSP_POLICY)) {
      const matching = directives.find((item) => item.name === name);
      if (!matching) { issues.push(`csp-missing-directive:${name}`); continue; }
      const actualValues = sortedUnique(matching.values);
      for (const token of expectedValues.filter((item) => !actualValues.includes(item))) issues.push(`csp-missing-source:${name}:${token}`);
      for (const token of actualValues.filter((item) => !expectedValues.includes(item))) issues.push(`csp-unexpected-source:${name}:${token}`);
    }
    for (const directive of directives.filter((item) => !(item.name in DEVELOPER_CSP_POLICY))) issues.push(`csp-unexpected-directive:${directive.name}`);
  }

  const malformed = issues.some((item) => item.endsWith("-invalid"));
  const missing = issues.some((item) => item.endsWith("-missing"));
  return {
    status: malformed ? "invalid" : missing ? "missing" : issues.length > 0 ? "violation" : "verified",
    capabilityPath: DEVELOPER_CAPABILITY_PATH,
    configurationPath: DEVELOPER_TAURI_CONFIG_PATH,
    capabilityIdentifier: typeof capability?.identifier === "string" ? capability.identifier : "",
    appIdentifier: typeof configuration?.identifier === "string" ? configuration.identifier : "",
    windows: windows ?? [],
    configuredWindows: configuredWindows ?? [],
    permissions: permissions ?? [],
    allowedPermissions: [...DEVELOPER_ALLOWED_PERMISSIONS],
    csp: typeof csp === "string" ? csp : "",
    cspDirectives: directives ?? [],
    issues,
  };
}

async function inspectVersionTool(id, command, args) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { windowsHide: true, timeout: 8_000, maxBuffer: 1024 * 1024 });
    const output = `${stdout ?? ""}\n${stderr ?? ""}`.trim();
    const version = output.match(/\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?/)?.[0] ?? "";
    return { id, command: [command, ...args].join(" "), available: true, version, output: output.split(/\r?\n/)[0]?.slice(0, 240) ?? "", error: "" };
  } catch (reason) {
    return { id, command: [command, ...args].join(" "), available: false, version: "", output: "", error: asMessage(reason).slice(0, 240) };
  }
}

export async function inspectBuildEnvironment() {
  const npmCliCandidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter(Boolean);
  const npmCli = (await Promise.all(npmCliCandidates.map(async (candidate) => await exists(candidate) ? candidate : ""))).find(Boolean);
  const npmTool = npmCli
    ? inspectVersionTool("npm", process.execPath, [npmCli, "--version"]).then((tool) => ({ ...tool, command: "npm --version" }))
    : inspectVersionTool("npm", "npm", ["--version"]);
  const tools = await Promise.all([
    inspectVersionTool("node", "node", ["--version"]),
    npmTool,
    inspectVersionTool("rustc", "rustc", ["--version"]),
    inspectVersionTool("cargo", "cargo", ["--version"]),
    inspectVersionTool("rustup", "rustup", ["--version"]),
  ]);
  let rustTargets = [];
  let rustTargetError = "";
  try {
    const { stdout } = await execFileAsync("rustup", ["target", "list", "--installed"], { windowsHide: true, timeout: 8_000, maxBuffer: 1024 * 1024 });
    rustTargets = String(stdout ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean).sort();
  } catch (reason) { rustTargetError = asMessage(reason).slice(0, 240); }
  const issues = [];
  if (process.platform !== "win32") issues.push(`unsupported-os:${process.platform}`);
  if (process.arch !== "x64") issues.push(`unsupported-arch:${process.arch}`);
  for (const tool of tools.filter((item) => !item.available)) issues.push(`missing-tool:${tool.id}`);
  if (!rustTargets.includes(CARGO_WINDOWS_X64_TARGET)) issues.push(`missing-rust-target:${CARGO_WINDOWS_X64_TARGET}`);
  return {
    status: issues.some((item) => item.startsWith("unsupported-")) ? "unsupported" : issues.length > 0 ? "incomplete" : "ready",
    hostOs: process.platform,
    hostArch: process.arch,
    expectedOs: "win32",
    expectedArch: "x64",
    rustTarget: CARGO_WINDOWS_X64_TARGET,
    rustTargetInstalled: rustTargets.includes(CARGO_WINDOWS_X64_TARGET),
    installedRustTargets: rustTargets,
    tools,
    issues,
    error: rustTargetError,
  };
}

export function advisoryQueries(packages) {
  const unique = new Map();
  for (const item of packages) {
    const ecosystem = item.ecosystem === "npm" ? "npm" : item.ecosystem === "cargo" ? "crates.io" : "";
    if (!ecosystem || !item.name || !item.version) continue;
    const key = `${ecosystem}\u0000${item.name}\u0000${item.version}`;
    const current = unique.get(key) ?? { ecosystem, name: item.name, version: item.version, componentIds: [] };
    if (!current.componentIds.includes(item.componentId)) current.componentIds.push(item.componentId);
    unique.set(key, current);
  }
  // Use a locale-independent ordinal order so the browser-side report and the
  // Rust desktop inspector produce the same consent digest on every machine.
  const compareOrdinal = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  return [...unique.values()].sort((left, right) => compareOrdinal(left.ecosystem, right.ecosystem)
    || compareOrdinal(left.name, right.name)
    || compareOrdinal(left.version, right.version));
}

export function buildAdvisoryPreview(packages) {
  const eligiblePackages = packages.filter((item) => (item.ecosystem === "npm" || item.ecosystem === "cargo") && item.name && item.version).length;
  const queries = advisoryQueries(packages);
  const canonical = queries.map((item) => `${item.ecosystem}\u0000${item.name}\u0000${item.version}`).join("\n");
  return {
    endpoint: OSV_QUERY_ENDPOINT,
    totalPackages: packages.length,
    eligiblePackages,
    uniquePackages: queries.length,
    duplicatePackages: Math.max(0, eligiblePackages - queries.length),
    npmPackages: queries.filter((item) => item.ecosystem === "npm").length,
    cargoPackages: queries.filter((item) => item.ecosystem === "crates.io").length,
    requestDigest: createHash("sha256").update(canonical).digest("hex").toUpperCase(),
    transmittedFields: ["ecosystem", "name", "version"],
    includesPaths: false,
    includesSources: false,
    includesLicenses: false,
  };
}

function parseCargoDirectDependencies(source = "") {
  const normal = new Set();
  const development = new Set();
  let section = "";
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) { section = sectionMatch[1]; continue; }
    if (!/(?:^|\.)dependencies$/.test(section) && !/(?:^|\.)dev-dependencies$/.test(section) && !/(?:^|\.)build-dependencies$/.test(section)) continue;
    const dependencyMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!dependencyMatch) continue;
    const packageOverride = dependencyMatch[2].match(/\bpackage\s*=\s*"([^"]+)"/)?.[1];
    const name = packageOverride ?? dependencyMatch[1];
    if (/(?:^|\.)dev-dependencies$/.test(section)) development.add(name);
    else normal.add(name);
  }
  return { normal, development };
}

function parseCargoPackages(source = "") {
  return source.split(/^\[\[package\]\]\s*$/m).slice(1).flatMap((block) => {
    const value = (key) => block.match(new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m"))?.[1] ?? "";
    const name = value("name");
    const version = value("version");
    return name && version ? [{ name, version, source: value("source"), checksum: value("checksum") }] : [];
  });
}

function cargoPackageKey(item) {
  return `${String(item?.name ?? "")}\0${String(item?.version ?? "")}\0${String(item?.source ?? "")}`;
}

async function cargoWindowsX64Resolution(root, manifestPath) {
  try {
    const { stdout } = await execFileAsync("cargo", [
      "metadata",
      "--format-version", "1",
      "--locked",
      "--offline",
      "--filter-platform", CARGO_WINDOWS_X64_TARGET,
      "--manifest-path", path.join(root, manifestPath),
    ], {
      cwd: root,
      env: { ...process.env, CARGO_NET_OFFLINE: "true" },
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const metadata = JSON.parse(stdout);
    if (!Array.isArray(metadata?.packages)) throw new Error("cargo-metadata-packages-missing");
    return { available: true, packages: new Set(metadata.packages.map(cargoPackageKey)) };
  } catch {
    return { available: false, packages: new Set() };
  }
}

export function cargoHostApplicability(item, resolution) {
  if (!resolution?.available) {
    return { hostApplicability: "unknown", applicabilityReason: "cargo-metadata-unavailable" };
  }
  if (resolution.packages.has(cargoPackageKey(item))) {
    return { hostApplicability: "applicable", applicabilityReason: "cargo-metadata-windows-x64-applicable" };
  }
  return { hostApplicability: "excluded", applicabilityReason: "cargo-metadata-windows-x64-excluded" };
}

async function cargoRegistryRoots() {
  const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), ".cargo");
  const sourceRoot = path.join(cargoHome, "registry", "src");
  return (await readdir(sourceRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(sourceRoot, entry.name));
}

async function cargoPackageLicense(registryRoots, name, version) {
  for (const registryRoot of registryRoots) {
    const manifest = await safeText(path.join(registryRoot, `${name}-${version}`, "Cargo.toml"));
    if (!manifest) continue;
    const license = manifest.match(/^license\s*=\s*"([^"]+)"/m)?.[1]?.trim();
    if (license) return license;
    if (/^license-file\s*=/m.test(manifest)) return "SEE LICENSE";
  }
  return "";
}

function licenseBreakdown(packages) {
  const counts = new Map();
  for (const item of packages) counts.set(item.license || "Unknown", (counts.get(item.license || "Unknown") ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)).slice(0, 8);
}

function npmPlatformConstraint(value, field, current) {
  const raw = value?.[field];
  const values = Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : typeof raw === "string" ? [raw] : [];
  if (values.length === 0) return { present: false, allowed: true };
  if (values.some((item) => item === `!${current}`)) return { present: true, allowed: false };
  const positive = values.filter((item) => !item.startsWith("!"));
  return { present: true, allowed: positive.length === 0 || positive.includes(current) };
}

export function npmHostApplicability(value) {
  const os = npmPlatformConstraint(value, "os", "win32");
  const cpu = npmPlatformConstraint(value, "cpu", "x64");
  if (!os.allowed || !cpu.allowed) {
    return {
      hostApplicability: "excluded",
      applicabilityReason: !os.allowed && !cpu.allowed ? "npm-os-cpu-excluded" : !os.allowed ? "npm-os-excluded" : "npm-cpu-excluded",
    };
  }
  return {
    hostApplicability: "applicable",
    applicabilityReason: os.present || cpu.present ? "npm-platform-compatible" : "npm-no-platform-restriction",
  };
}

async function inspectNpmLockfile(root, target) {
  const manifest = await safeJson(path.join(root, target.manifestPath));
  const lock = await safeJson(path.join(root, target.lockfilePath));
  if (!manifest || !lock?.packages) return { summary: { ...target, present: false, packageCount: 0, directCount: 0, developmentCount: 0, unknownLicenseCount: 0, reciprocalLicenseCount: 0, insecureSourceCount: 0, missingIntegrityCount: 0, licenses: [] }, packages: [] };
  const direct = new Set(Object.keys(manifest.dependencies ?? {}));
  const development = new Set(Object.keys(manifest.devDependencies ?? {}));
  const packages = Object.entries(lock.packages).flatMap(([packagePath, value]) => {
    if (!packagePath || !value || typeof value !== "object") return [];
    const name = npmPackageName(packagePath);
    const license = typeof value.license === "string" ? value.license.trim() : "";
    const source = typeof value.resolved === "string" ? value.resolved : "";
    const integrity = typeof value.integrity === "string" ? value.integrity : "";
    const integrityPresent = integrity.length > 0;
    const licenseClass = classifyLicense(license);
    const applicability = npmHostApplicability(value);
    const directDependency = direct.has(name) || development.has(name);
    const reasons = [licenseClass === "unknown" ? "unknown-license" : "", licenseClass === "reciprocal" ? "reciprocal-license" : "", !secureDependencySource(source) ? "insecure-source" : "", !integrityPresent && !value.link ? "missing-integrity" : ""].filter(Boolean);
    return [{ componentId: target.id, ecosystem: "npm", name, version: String(value.version ?? ""), direct: directDependency, development: development.has(name), license, licenseClass, source, integrity, integrityPresent: integrityPresent || Boolean(value.link), reason: reasons.join(","), ...applicability }];
  });
  return {
    summary: {
      ...target, present: true, packageCount: packages.length,
      directCount: packages.filter((item) => item.direct).length,
      developmentCount: packages.filter((item) => item.development).length,
      unknownLicenseCount: packages.filter((item) => item.licenseClass === "unknown").length,
      reciprocalLicenseCount: packages.filter((item) => item.licenseClass === "reciprocal").length,
      insecureSourceCount: packages.filter((item) => !secureDependencySource(item.source)).length,
      missingIntegrityCount: packages.filter((item) => !item.integrityPresent).length,
      licenses: licenseBreakdown(packages),
    },
    packages,
  };
}

async function inspectCargoLockfile(root, target, registryRoots) {
  const manifest = await safeText(path.join(root, target.manifestPath));
  const lock = await safeText(path.join(root, target.lockfilePath));
  if (manifest === undefined || lock === undefined) return { summary: { ...target, present: false, packageCount: 0, directCount: 0, developmentCount: 0, unknownLicenseCount: 0, reciprocalLicenseCount: 0, insecureSourceCount: 0, missingIntegrityCount: 0, licenses: [] }, packages: [] };
  const direct = parseCargoDirectDependencies(manifest);
  const cargoResolution = await cargoWindowsX64Resolution(root, target.manifestPath);
  const externalPackages = parseCargoPackages(lock).filter((item) => item.source);
  const packages = await Promise.all(externalPackages.map(async (item) => {
    const license = await cargoPackageLicense(registryRoots, item.name, item.version);
    const licenseClass = classifyLicense(license);
    const integrityPresent = !item.source.startsWith("registry+") || Boolean(item.checksum);
    const reasons = [licenseClass === "unknown" ? "unknown-license" : "", licenseClass === "reciprocal" ? "reciprocal-license" : "", !secureDependencySource(item.source) ? "insecure-source" : "", !integrityPresent ? "missing-integrity" : ""].filter(Boolean);
    const applicability = cargoHostApplicability(item, cargoResolution);
    return { componentId: target.id, ecosystem: "cargo", name: item.name, version: item.version, direct: direct.normal.has(item.name) || direct.development.has(item.name), development: direct.development.has(item.name), license, licenseClass, source: item.source, integrity: item.checksum, integrityPresent, reason: reasons.join(","), ...applicability };
  }));
  return {
    summary: {
      ...target, present: true, packageCount: packages.length,
      directCount: packages.filter((item) => item.direct).length,
      developmentCount: packages.filter((item) => item.development).length,
      unknownLicenseCount: packages.filter((item) => item.licenseClass === "unknown").length,
      reciprocalLicenseCount: packages.filter((item) => item.licenseClass === "reciprocal").length,
      insecureSourceCount: packages.filter((item) => !secureDependencySource(item.source)).length,
      missingIntegrityCount: packages.filter((item) => !item.integrityPresent).length,
      licenses: licenseBreakdown(packages),
    },
    packages,
  };
}

async function inspectDependencyInventory(root) {
  const registryRoots = await cargoRegistryRoots();
  const inspected = await Promise.all(DEPENDENCY_TARGETS.map((target) => target.ecosystem === "npm"
    ? inspectNpmLockfile(root, target)
    : inspectCargoLockfile(root, target, registryRoots)));
  const lockfiles = inspected.map((item) => item.summary);
  const packages = inspected.flatMap((item) => item.packages);
  const totals = {
    lockfiles: lockfiles.filter((item) => item.present).length,
    packages: packages.length,
    direct: packages.filter((item) => item.direct).length,
    development: packages.filter((item) => item.development).length,
    unknownLicense: packages.filter((item) => item.licenseClass === "unknown").length,
    reciprocalLicense: packages.filter((item) => item.licenseClass === "reciprocal").length,
    insecureSource: packages.filter((item) => !secureDependencySource(item.source)).length,
    missingIntegrity: packages.filter((item) => !item.integrityPresent).length,
  };
  const reviewPackages = packages
    .filter((item) => item.reason || item.direct)
    .sort((left, right) => Number(Boolean(right.reason)) - Number(Boolean(left.reason)) || Number(right.direct) - Number(left.direct) || left.name.localeCompare(right.name))
    .slice(0, 60);
  return {
    generatedFromLockfiles: lockfiles.every((item) => item.present),
    lockfiles, totals, packages, reviewPackages,
    advisoryPreview: buildAdvisoryPreview(packages),
    advisoryScan: { checked: false, mode: "offline", reason: "network-consent-required" },
  };
}

async function sha256(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex").toUpperCase();
}

async function blake2b512(file) {
  const hash = createHash("blake2b512");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest();
}

async function verifyUpdaterSignature(file, encodedSignature, encodedPublicKey) {
  const signatureLines = Buffer.from(encodedSignature.trim(), "base64").toString("utf8").split(/\r?\n/).filter(Boolean);
  if (signatureLines.length !== 4 || !signatureLines[2].startsWith("trusted comment: ")) throw new Error("signature-minisign: invalid line structure");
  const signatureRecord = Buffer.from(signatureLines[1], "base64");
  const globalSignature = Buffer.from(signatureLines[3], "base64");
  if (signatureRecord.length !== 74 || globalSignature.length !== 64) throw new Error("signature-minisign: invalid record size");
  if (signatureRecord.subarray(0, 2).toString("ascii") !== "ED") throw new Error("signature-minisign: prehashed Ed25519 signature required");

  const publicKeyLines = Buffer.from(encodedPublicKey.trim(), "base64").toString("utf8").split(/\r?\n/).filter(Boolean);
  if (publicKeyLines.length < 2) throw new Error("public-key-minisign: key line missing");
  const publicKeyRecord = Buffer.from(publicKeyLines[1], "base64");
  if (publicKeyRecord.length !== 42) throw new Error("public-key-minisign: invalid record size");
  if (!signatureRecord.subarray(2, 10).equals(publicKeyRecord.subarray(2, 10))) throw new Error("signature-minisign: unexpected key id");

  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const key = createPublicKey({ key: Buffer.concat([spkiPrefix, publicKeyRecord.subarray(10)]), format: "der", type: "spki" });
  const artifactDigest = await blake2b512(file);
  const signature = signatureRecord.subarray(10);
  if (!verify(null, artifactDigest, key, signature)) throw new Error("signature-minisign: artifact signature mismatch");
  const trustedComment = Buffer.from(signatureLines[2].slice("trusted comment: ".length), "utf8");
  if (!verify(null, Buffer.concat([signature, trustedComment]), key, globalSignature)) throw new Error("signature-minisign: trusted comment signature mismatch");
}

async function inspectReleaseHistoryEntry(root, updatesRoot, version, publicKey) {
  const directory = path.join(updatesRoot, version);
  const manifestPath = path.join(directory, "latest.json");
  const manifest = await safeJson(manifestPath);
  const platform = manifest?.platforms?.["windows-x86_64"];
  const files = await readdir(directory).catch(() => []);
  const urlName = typeof platform?.url === "string" ? decodeURIComponent(platform.url.split("/").at(-1) ?? "") : "";
  const installerPath = path.join(directory, files.includes(urlName) ? urlName : files.find((file) => file.toLowerCase().endsWith(".exe")) ?? "");
  const signaturePath = `${installerPath}.sig`;
  const signature = (await safeText(signaturePath))?.trim() ?? "";
  const installerPresent = Boolean(installerPath) && await exists(installerPath);
  let integrityError = "";
  if (installerPresent && signature && publicKey) {
    try { await verifyUpdaterSignature(installerPath, signature, publicKey); }
    catch (reason) { integrityError = asMessage(reason); }
  } else {
    integrityError = "signature-prerequisite-missing";
  }
  return {
    version,
    manifestPath: relative(root, manifestPath),
    installerPath: relative(root, installerPath),
    installerSizeBytes: installerPresent ? (await stat(installerPath)).size : 0,
    installerSha256: installerPresent ? await sha256(installerPath).catch(() => "") : "",
    downloadUrl: typeof platform?.url === "string" ? platform.url : "",
    publishedAt: typeof manifest?.pub_date === "string" ? manifest.pub_date : "",
    signatureValid: !integrityError,
    integrityError,
  };
}

function statusCheck(id, status, detail, technicalDetail) {
  return { id, status, detail: detail ?? "", technicalDetail: technicalDetail ?? "" };
}

async function inspectRemoteFeed(endpoint, timeoutMs) {
  const result = { endpoint, checked: false, reachable: false, version: "", downloadUrl: "", error: "" };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(endpoint, { signal: controller.signal, headers: { accept: "application/json" } });
    } finally {
      clearTimeout(timeout);
    }
    result.checked = true;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    result.reachable = true;
    result.version = typeof manifest?.version === "string" ? manifest.version : "";
    result.downloadUrl = typeof manifest?.platforms?.["windows-x86_64"]?.url === "string"
      ? manifest.platforms["windows-x86_64"].url
      : "";
  } catch (reason) {
    result.checked = true;
    result.error = asMessage(reason).slice(0, 500);
  }
  return result;
}

async function newestSourceTime(root) {
  const candidates = [path.join(root, "package.json"), path.join(root, "package-lock.json"), path.join(root, "vite.config.ts")];
  const stack = [path.join(root, "src")];
  let newest = 0;
  let visited = 0;
  while (stack.length > 0 && visited < 10_000) {
    const current = stack.pop();
    if (!current) break;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      visited += 1;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(target);
      else if (/\.(?:ts|tsx|css|html|json)$/i.test(entry.name)) candidates.push(target);
    }
  }
  for (const candidate of candidates) {
    const info = await stat(candidate).catch(() => undefined);
    if (info) newest = Math.max(newest, info.mtimeMs);
  }
  return newest;
}

async function collectQualitySourceFiles(root) {
  const files = new Map();
  let visited = 0;
  const add = async (target) => {
    if (visited >= 20_000) throw new Error("quality-source-file-limit");
    visited += 1;
    const info = await stat(target).catch(() => undefined);
    if (!info) return;
    if (info.isFile()) {
      if (info.size > 8 * 1024 * 1024) throw new Error(`quality-source-file-too-large:${relative(root, target)}`);
      files.set(relative(root, target), { target, info });
      return;
    }
    if (!info.isDirectory()) return;
    const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (["artifacts", "coverage", "dist", "node_modules", "target"].includes(entry.name)) continue;
      const child = path.join(target, entry.name);
      if (entry.isDirectory()) await add(child);
      else if (entry.isFile() && QUALITY_SOURCE_EXTENSION.test(entry.name)) await add(child);
    }
  };
  for (const source of QUALITY_SOURCE_TARGETS) await add(path.join(root, source));
  return [...files.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
}

export async function computeQualitySourceSnapshot(root) {
  const hash = createHash("sha256");
  const files = await collectQualitySourceFiles(root);
  let totalBytes = 0;
  let newest = 0;
  for (const [fileName, { target, info }] of files) {
    const content = await readFile(target);
    totalBytes += content.byteLength;
    if (totalBytes > 128 * 1024 * 1024) throw new Error("quality-source-total-too-large");
    newest = Math.max(newest, info.mtimeMs);
    hash.update(fileName);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return {
    algorithm: "sha256",
    digest: hash.digest("hex").toUpperCase(),
    fileCount: files.length,
    totalBytes,
    newestAt: newest ? new Date(newest).toISOString() : "",
  };
}

function emptyQualityEvidence(status = "missing", error = "") {
  return {
    status,
    reportPath: "artifacts/developer-tools/quality-evidence.json",
    generatedAt: "",
    startedAt: "",
    completedAt: "",
    durationMs: 0,
    sourceNewestAt: "",
    sourceDigest: "",
    sourceStable: false,
    requiredStageIds: [...QUALITY_REQUIRED_STAGE_IDS],
    summary: { totalStages: 0, passedStages: 0, failedStages: 0, totalTests: 0, passedTests: 0, failedTests: 0, skippedTests: 0 },
    coverage: { available: false, reportPath: "", lines: { total: 0, covered: 0, skipped: 0, pct: 0 }, statements: { total: 0, covered: 0, skipped: 0, pct: 0 }, functions: { total: 0, covered: 0, skipped: 0, pct: 0 }, branches: { total: 0, covered: 0, skipped: 0, pct: 0 } },
    coverageThresholds: { ...QUALITY_COVERAGE_THRESHOLDS },
    coverageViolations: [],
    stages: [],
    error,
  };
}

const qualityMetricValid = (metric) => metric && [metric.total, metric.covered, metric.skipped, metric.pct]
  .every((value) => Number.isFinite(value) && value >= 0) && metric.pct <= 100
  && metric.covered <= metric.total && metric.skipped <= metric.total;

export async function inspectQualityEvidence(root) {
  const reportFile = path.join(root, "artifacts", "developer-tools", "quality-evidence.json");
  const reportStat = await stat(reportFile).catch(() => undefined);
  if (!reportStat) return emptyQualityEvidence();
  if (reportStat.size > 1024 * 1024) return emptyQualityEvidence("invalid", "quality-evidence-too-large");
  const report = await safeJson(reportFile);
  const stages = Array.isArray(report?.stages) ? report.stages : undefined;
  const sourceBefore = report?.sourceBefore;
  const sourceAfter = report?.sourceAfter;
  const coverage = report?.coverage;
  const numeric = (value) => Number.isFinite(value) && value >= 0;
  const stageIds = stages?.map((stage) => stage?.id) ?? [];
  const expectedStageIds = [...QUALITY_REQUIRED_STAGE_IDS];
  const declaredStageIds = Array.isArray(report?.requiredStageIds) ? report.requiredStageIds : [];
  const hasExpectedStages = stageIds.length === expectedStageIds.length
    && new Set(stageIds).size === stageIds.length
    && expectedStageIds.every((id) => stageIds.includes(id));
  const stageInvalid = stages?.some((stage) => typeof stage?.id !== "string" || typeof stage?.command !== "string"
    || !["pass", "fail"].includes(stage?.status) || !numeric(stage?.exitCode) || !numeric(stage?.durationMs)
    || (stage.status === "pass" ? stage.exitCode !== 0 : stage.exitCode === 0)
    || !stage?.tests || ![stage.tests.total, stage.tests.passed, stage.tests.failed, stage.tests.skipped].every(numeric)
    || stage.tests.total !== stage.tests.passed + stage.tests.failed + stage.tests.skipped
    || typeof stage?.outputTail !== "string" || stage.outputTail.length > 8_000);
  if (report?.schemaVersion !== 1 || report?.runnerVersion !== "d31-1" || !stages || !hasExpectedStages || stageInvalid
    || JSON.stringify(declaredStageIds) !== JSON.stringify(expectedStageIds)
    || !sourceBefore || !sourceAfter || sourceBefore.algorithm !== "sha256" || sourceAfter.algorithm !== "sha256"
    || !/^[A-F0-9]{64}$/.test(sourceBefore.digest) || !/^[A-F0-9]{64}$/.test(sourceAfter.digest)
    || ![sourceBefore.fileCount, sourceBefore.totalBytes, sourceAfter.fileCount, sourceAfter.totalBytes, report?.durationMs].every(numeric)
    || !coverage || typeof coverage.available !== "boolean"
    || (coverage.available && ![coverage.lines, coverage.statements, coverage.functions, coverage.branches].every(qualityMetricValid))) {
    return emptyQualityEvidence("invalid", "quality-evidence-invalid");
  }
  const recomputedSummary = stages.reduce((summary, stage) => {
    summary.totalStages += 1;
    summary[stage.status === "pass" ? "passedStages" : "failedStages"] += 1;
    summary.totalTests += stage.tests.total;
    summary.passedTests += stage.tests.passed;
    summary.failedTests += stage.tests.failed;
    summary.skippedTests += stage.tests.skipped;
    return summary;
  }, { totalStages: 0, passedStages: 0, failedStages: 0, totalTests: 0, passedTests: 0, failedTests: 0, skippedTests: 0 });
  if (JSON.stringify(recomputedSummary) !== JSON.stringify(report.summary)) return emptyQualityEvidence("invalid", "quality-summary-mismatch");
  const currentSource = await computeQualitySourceSnapshot(root).catch((reason) => ({ error: asMessage(reason) }));
  if ("error" in currentSource) return emptyQualityEvidence("invalid", currentSource.error);
  const sourceStable = report.sourceStable === true && sourceBefore.digest === sourceAfter.digest;
  const sourceCurrent = sourceAfter.digest === currentSource.digest && sourceAfter.fileCount === currentSource.fileCount && sourceAfter.totalBytes === currentSource.totalBytes;
  const failed = recomputedSummary.failedStages > 0 || !sourceStable;
  const status = failed ? "failed" : sourceCurrent ? "current" : "stale";
  const metrics = ["lines", "statements", "functions", "branches"];
  const coverageViolations = !coverage.available
    ? [{ id: "coverageUnavailable", actual: 0, threshold: 0 }]
    : metrics.filter((id) => coverage[id].pct < QUALITY_COVERAGE_THRESHOLDS[id])
      .map((id) => ({ id, actual: coverage[id].pct, threshold: QUALITY_COVERAGE_THRESHOLDS[id] }));
  return {
    status,
    reportPath: relative(root, reportFile),
    generatedAt: typeof report.generatedAt === "string" ? report.generatedAt : "",
    startedAt: typeof report.startedAt === "string" ? report.startedAt : "",
    completedAt: typeof report.completedAt === "string" ? report.completedAt : "",
    durationMs: report.durationMs,
    sourceNewestAt: currentSource.newestAt,
    sourceDigest: sourceAfter.digest,
    sourceStable,
    requiredStageIds: expectedStageIds,
    summary: recomputedSummary,
    coverage,
    coverageThresholds: { ...QUALITY_COVERAGE_THRESHOLDS },
    coverageViolations,
    stages: stages.slice(0, 20),
    error: failed && !sourceStable ? "source-changed-during-quality-run" : "",
  };
}

function emptyBundleAnalysis(status = "missing", error = "") {
  return {
    status,
    reportPath: "dist/bundle-report.json",
    generatedAt: "",
    sourceNewestAt: "",
    budgets: { entryJavaScriptBytes: 0, chunkJavaScriptBytes: 0, totalJavaScriptGzipBytes: 0, totalCssBytes: 0 },
    totals: { totalJavaScriptBytes: 0, totalJavaScriptGzipBytes: 0, totalCssBytes: 0, chunks: 0, assets: 0 },
    chunks: [],
    assets: [],
    violations: [],
    error,
  };
}

export async function inspectBundleAnalysis(root) {
  const reportFile = path.join(root, "dist", "bundle-report.json");
  const reportStat = await stat(reportFile).catch(() => undefined);
  if (!reportStat) return emptyBundleAnalysis();
  if (reportStat.size > 4 * 1024 * 1024) return emptyBundleAnalysis("invalid", "bundle-report-too-large");
  const report = await safeJson(reportFile);
  const budgets = report?.budgets;
  const totals = report?.totals;
  const chunks = Array.isArray(report?.chunks) ? report.chunks : undefined;
  const assets = Array.isArray(report?.assets) ? report.assets : undefined;
  const numeric = (value) => Number.isFinite(value) && value >= 0;
  if (report?.schemaVersion !== 1 || !budgets || !totals || !chunks || !assets
    || ![budgets.entryJavaScriptBytes, budgets.chunkJavaScriptBytes, budgets.totalJavaScriptGzipBytes, budgets.totalCssBytes,
      totals.totalJavaScriptBytes, totals.totalJavaScriptGzipBytes, totals.totalCssBytes, totals.chunks, totals.assets].every(numeric)
    || chunks.some((chunk) => typeof chunk?.fileName !== "string" || !numeric(chunk?.rawBytes) || !numeric(chunk?.gzipBytes))) {
    return emptyBundleAnalysis("invalid", "bundle-report-invalid");
  }
  const newestSource = await newestSourceTime(root);
  const status = reportStat.mtimeMs + 1_000 < newestSource ? "stale" : "current";
  const entry = chunks.find((chunk) => chunk.entry);
  const largestChunk = chunks.reduce((largest, chunk) => !largest || chunk.rawBytes > largest.rawBytes ? chunk : largest, undefined);
  const violations = [
    entry && entry.rawBytes > budgets.entryJavaScriptBytes ? { id: "entryJavaScript", actualBytes: entry.rawBytes, budgetBytes: budgets.entryJavaScriptBytes, fileName: entry.fileName } : undefined,
    largestChunk && largestChunk.rawBytes > budgets.chunkJavaScriptBytes ? { id: "chunkJavaScript", actualBytes: largestChunk.rawBytes, budgetBytes: budgets.chunkJavaScriptBytes, fileName: largestChunk.fileName } : undefined,
    totals.totalJavaScriptGzipBytes > budgets.totalJavaScriptGzipBytes ? { id: "totalJavaScriptGzip", actualBytes: totals.totalJavaScriptGzipBytes, budgetBytes: budgets.totalJavaScriptGzipBytes, fileName: "" } : undefined,
    totals.totalCssBytes > budgets.totalCssBytes ? { id: "totalCss", actualBytes: totals.totalCssBytes, budgetBytes: budgets.totalCssBytes, fileName: "" } : undefined,
  ].filter(Boolean);
  return {
    status,
    reportPath: relative(root, reportFile),
    generatedAt: typeof report.generatedAt === "string" ? report.generatedAt : "",
    sourceNewestAt: newestSource ? new Date(newestSource).toISOString() : "",
    budgets,
    totals,
    chunks: chunks.slice(0, 100),
    assets: assets.slice(0, 100),
    violations,
    error: "",
  };
}

export async function inspectDeveloperWorkspace(workspaceRoot, options = {}) {
  const root = path.resolve(workspaceRoot);
  const checkRemoteFeed = options.checkRemoteFeed !== false;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const dependencyInventoryPromise = inspectDependencyInventory(root);
  const bundleAnalysisPromise = inspectBundleAnalysis(root);
  const qualityEvidencePromise = inspectQualityEvidence(root);
  const capabilitySecurityPromise = inspectCapabilitySecurity(root);
  const buildEnvironmentPromise = inspectBuildEnvironment();
  const packageJson = await safeJson(path.join(root, "package.json"));
  const packageLock = await safeJson(path.join(root, "package-lock.json"));
  const cargoToml = await safeText(path.join(root, "src-tauri", "Cargo.toml"));
  const tauriConfig = await safeJson(path.join(root, "src-tauri", "tauri.conf.json"));
  const cargoVersion = cargoToml?.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "";
  const versionSources = [
    { id: "package", path: "package.json", value: packageJson?.version ?? "" },
    { id: "packageLock", path: "package-lock.json", value: packageLock?.version ?? "" },
    { id: "packageLockRoot", path: "package-lock.json packages['']", value: packageLock?.packages?.[""]?.version ?? "" },
    { id: "cargo", path: "src-tauri/Cargo.toml", value: cargoVersion },
    { id: "tauri", path: "src-tauri/tauri.conf.json", value: tauriConfig?.version ?? "" },
  ];
  const expectedVersion = String(packageJson?.version ?? "");
  const versionConsistent = Boolean(expectedVersion) && versionSources.every((item) => item.value === expectedVersion);

  const publicKeyPath = path.join(root, "src-tauri", "updater-public.key");
  const publicKey = (await safeText(publicKeyPath))?.trim() ?? "";
  const configuredKey = String(tauriConfig?.plugins?.updater?.pubkey ?? "").trim();

  const updatesRoot = path.join(root, "artifacts", "updates");
  let artifactVersions = [];
  try {
    artifactVersions = (await readdir(updatesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+/.test(entry.name))
      .map((entry) => entry.name)
      .sort(compareVersions);
  } catch { artifactVersions = []; }
  const releaseHistory = await Promise.all(
    [...artifactVersions].reverse().slice(0, 5).map((version) => inspectReleaseHistoryEntry(root, updatesRoot, version, publicKey)),
  );
  const artifactVersion = artifactVersions.at(-1) ?? "";
  const artifactDirectory = artifactVersion ? path.join(updatesRoot, artifactVersion) : "";
  const manifestPath = artifactDirectory ? path.join(artifactDirectory, "latest.json") : "";
  const manifest = manifestPath ? await safeJson(manifestPath) : undefined;
  const platform = manifest?.platforms?.["windows-x86_64"];
  let installerPath = "";
  if (artifactDirectory) {
    const files = await readdir(artifactDirectory).catch(() => []);
    const urlName = typeof platform?.url === "string" ? decodeURIComponent(platform.url.split("/").at(-1) ?? "") : "";
    installerPath = path.join(artifactDirectory, files.includes(urlName) ? urlName : files.find((file) => file.toLowerCase().endsWith(".exe")) ?? "");
  }
  const installerPresent = Boolean(installerPath) && await exists(installerPath);
  const signaturePath = installerPath ? `${installerPath}.sig` : "";
  const signatureText = signaturePath ? (await safeText(signaturePath))?.trim() ?? "" : "";
  const manifestSignature = typeof platform?.signature === "string" ? platform.signature.trim() : "";
  const installerStat = installerPresent ? await stat(installerPath) : undefined;
  const installerSha256 = installerPresent ? await sha256(installerPath).catch(() => "") : "";
  const manifestVersion = typeof manifest?.version === "string" ? manifest.version : "";
  const manifestUrl = typeof platform?.url === "string" ? platform.url : "";
  let cryptographicSignatureError = "";
  if (installerPresent && signatureText && publicKey) {
    try { await verifyUpdaterSignature(installerPath, signatureText, publicKey); }
    catch (reason) { cryptographicSignatureError = asMessage(reason); }
  } else {
    cryptographicSignatureError = "signature-prerequisite-missing";
  }

  const endpoint = OFFICIAL_UPDATE_FEED;
  const remoteFeed = checkRemoteFeed
    ? await inspectRemoteFeed(endpoint, timeoutMs)
    : { endpoint, checked: false, reachable: false, version: "", downloadUrl: "", error: "" };
  const dependencyInventory = await dependencyInventoryPromise;
  const bundleAnalysis = await bundleAnalysisPromise;
  const qualityEvidence = await qualityEvidencePromise;
  const capabilitySecurity = await capabilitySecurityPromise;
  const buildEnvironment = await buildEnvironmentPromise;
  const missingLockfiles = dependencyInventory.lockfiles.filter((item) => !item.present).map((item) => item.lockfilePath);
  const dependencyProblems = dependencyInventory.reviewPackages.filter((item) => item.reason).map((item) => `${item.ecosystem}:${item.name}@${item.version} (${item.reason})`);

  const checks = [
    statusCheck("versionConsistency", versionConsistent ? "pass" : "fail", versionSources.map((item) => `${item.id}=${item.value || "—"}`).join(" · ")),
    statusCheck("publicKeyPresent", publicKey ? "pass" : "fail", publicKey ? relative(root, publicKeyPath) : ""),
    statusCheck("publicKeyMatches", publicKey && publicKey === configuredKey ? "pass" : "fail", "src-tauri/updater-public.key ↔ tauri.conf.json"),
    statusCheck("manifestPresent", manifest ? "pass" : "fail", manifestPath ? relative(root, manifestPath) : ""),
    statusCheck("manifestVersion", manifestVersion && manifestVersion === artifactVersion && manifestVersion === expectedVersion ? "pass" : "fail", `app=${expectedVersion || "—"} · artifact=${artifactVersion || "—"} · manifest=${manifestVersion || "—"}`),
    statusCheck("installerPresent", installerPresent ? "pass" : "fail", installerPath ? relative(root, installerPath) : ""),
    statusCheck("signaturePresent", signatureText ? "pass" : "fail", signaturePath ? relative(root, signaturePath) : ""),
    statusCheck("signatureMatchesManifest", signatureText && signatureText === manifestSignature ? "pass" : "fail", signatureText && manifestSignature ? "signature file ↔ latest.json" : ""),
    statusCheck("sha256Calculated", installerSha256 ? "pass" : "fail", installerSha256),
    statusCheck("downloadUrlHttps", /^https:\/\//i.test(manifestUrl) ? "pass" : "fail", manifestUrl),
    statusCheck("remoteFeed", !remoteFeed.checked ? "warning" : remoteFeed.reachable ? "pass" : "warning", remoteFeed.reachable ? `${remoteFeed.version || "—"} · ${endpoint}` : endpoint, remoteFeed.error),
    statusCheck("remoteVersion", !remoteFeed.checked ? "warning" : remoteFeed.reachable && remoteFeed.version === expectedVersion ? "pass" : "warning", `local=${expectedVersion || "—"} · remote=${remoteFeed.version || "—"}`),
    statusCheck("cryptographicSignature", cryptographicSignatureError ? "fail" : "pass", cryptographicSignatureError ? "verification-failed" : "verified", cryptographicSignatureError),
    statusCheck(
      "artifactHistoryIntegrity",
      releaseHistory.length > 0 && releaseHistory.every((entry) => entry.signatureValid && entry.installerSha256) ? "pass" : "fail",
      releaseHistory.filter((entry) => !entry.signatureValid || !entry.installerSha256).map((entry) => entry.version).join(", ") || `${releaseHistory.length} releases`,
      releaseHistory.filter((entry) => entry.integrityError).map((entry) => `${entry.version}: ${entry.integrityError}`).join("\n"),
    ),
    statusCheck("dependencyLockfiles", dependencyInventory.generatedFromLockfiles ? "pass" : "fail", `${dependencyInventory.totals.lockfiles}/${dependencyInventory.lockfiles.length} lockfiles`, missingLockfiles.join("\n")),
    statusCheck(
      "dependencyIntegrity",
      dependencyInventory.totals.insecureSource > 0 ? "fail" : dependencyInventory.totals.missingIntegrity > 0 ? "warning" : "pass",
      `${dependencyInventory.totals.packages} packages · ${dependencyInventory.totals.missingIntegrity} missing integrity · ${dependencyInventory.totals.insecureSource} insecure sources`,
      dependencyProblems.filter((item) => /(?:missing-integrity|insecure-source)/.test(item)).join("\n"),
    ),
    statusCheck("dependencyLicenseMetadata", dependencyInventory.totals.unknownLicense > 0 ? "warning" : "pass", `${dependencyInventory.totals.unknownLicense} unknown licenses`, dependencyProblems.filter((item) => item.includes("unknown-license")).join("\n")),
    statusCheck("dependencyReciprocalLicenses", dependencyInventory.totals.reciprocalLicense > 0 ? "warning" : "pass", `${dependencyInventory.totals.reciprocalLicense} reciprocal licenses`, dependencyProblems.filter((item) => item.includes("reciprocal-license")).join("\n")),
    statusCheck("dependencyAdvisories", "warning", "offline-not-run", "No dependency names were transmitted. Network advisory lookup requires a future explicit approval flow."),
    statusCheck(
      "bundlePerformance",
      bundleAnalysis.status === "invalid" ? "fail" : bundleAnalysis.status !== "current" || bundleAnalysis.violations.length > 0 ? "warning" : "pass",
      `${bundleAnalysis.status} · ${bundleAnalysis.totals.chunks} chunks · ${bundleAnalysis.violations.length} budget violations`,
      bundleAnalysis.error || bundleAnalysis.violations.map((item) => `${item.id}: ${item.actualBytes}/${item.budgetBytes} ${item.fileName}`.trim()).join("\n"),
    ),
    statusCheck(
      "qualityEvidence",
      ["invalid", "failed"].includes(qualityEvidence.status) ? "fail"
        : qualityEvidence.status !== "current" || qualityEvidence.coverageViolations.length > 0 ? "warning" : "pass",
      `${qualityEvidence.status} · ${qualityEvidence.summary.passedStages}/${qualityEvidence.summary.totalStages} stages · ${qualityEvidence.summary.passedTests}/${qualityEvidence.summary.totalTests} tests · ${qualityEvidence.coverageViolations.length} coverage gaps`,
      qualityEvidence.error || qualityEvidence.coverageViolations.map((item) => `${item.id}: ${item.actual}/${item.threshold}`).join("\n"),
    ),
    statusCheck(
      "developerCapabilityPolicy",
      capabilitySecurity.status === "verified" ? "pass" : "fail",
      `${capabilitySecurity.status} · ${capabilitySecurity.permissions.length} permissions · ${capabilitySecurity.cspDirectives.length} CSP directives`,
      capabilitySecurity.issues.join("\n"),
    ),
    statusCheck(
      "developerBuildEnvironment",
      buildEnvironment.status === "ready" ? "pass" : "fail",
      `${buildEnvironment.status} · ${buildEnvironment.tools.filter((item) => item.available).length}/${buildEnvironment.tools.length} tools · ${buildEnvironment.hostOs}/${buildEnvironment.hostArch}`,
      [...buildEnvironment.issues, buildEnvironment.error].filter(Boolean).join("\n"),
    ),
  ];
  const summary = checks.reduce((totals, check) => ({ ...totals, [check.status]: totals[check.status] + 1 }), { pass: 0, warning: 0, fail: 0 });

  return {
    schemaVersion: 12,
    inspectedAt: new Date().toISOString(),
    workspaceRoot: root,
    readOnly: true,
    expectedVersion,
    versionSources,
    release: {
      artifactVersion,
      artifactDirectory: artifactDirectory ? relative(root, artifactDirectory) : "",
      manifestPath: manifestPath ? relative(root, manifestPath) : "",
      installerPath: installerPath ? relative(root, installerPath) : "",
      signaturePath: signaturePath ? relative(root, signaturePath) : "",
      installerSizeBytes: installerStat?.size ?? 0,
      installerSha256,
      manifestVersion,
      downloadUrl: manifestUrl,
      publishedAt: typeof manifest?.pub_date === "string" ? manifest.pub_date : "",
    },
    releaseHistory,
    dependencyInventory,
    bundleAnalysis,
    qualityEvidence,
    capabilitySecurity,
    buildEnvironment,
    remoteFeed,
    checks,
    summary,
  };
}

if (import.meta.url === new URL(`file://${process.argv[1]?.replaceAll("\\", "/")}`).href) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const report = await inspectDeveloperWorkspace(root);
  const outputIndex = process.argv.indexOf("--output");
  const outputPath = outputIndex >= 0 && process.argv[outputIndex + 1] ? path.resolve(process.argv[outputIndex + 1]) : "";
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, "utf8");
    process.stdout.write(`Inspection report: ${path.relative(root, outputPath)}\n`);
  } else {
    process.stdout.write(serialized);
  }
}
