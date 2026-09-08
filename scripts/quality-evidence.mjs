import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { computeQualitySourceSnapshot, QUALITY_REQUIRED_STAGE_IDS } from "./developer-inspection.mjs";

const root = process.cwd();
const outputPath = path.join(root, "artifacts", "developer-tools", "quality-evidence.json");
const coveragePath = path.join(root, "coverage", "quality", "coverage-summary.json");
const windows = process.platform === "win32";
const scriptCommand = (name, args) => windows
  ? { executable: process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe", args: ["/d", "/s", "/c", [name, ...args].join(" ")], displayCommand: [name, ...args].join(" ") }
  : { executable: name, args, displayCommand: [name, ...args].join(" ") };

const stages = [
  { id: "appTypecheck", kind: "static", ...scriptCommand("npm", ["run", "check"]) },
  { id: "developerTypecheck", kind: "static", ...scriptCommand("npm", ["run", "check:developer-tools"]) },
  { id: "unitCoverage", kind: "test", ...scriptCommand("npx", ["vitest", "run", "--coverage.enabled=true", "--maxWorkers=1"]) },
  { id: "developerNodeTests", kind: "test", executable: process.execPath, args: ["--test", "scripts/developer-inspection.node.mjs"] },
  { id: "rustFormat", kind: "static", executable: "cargo", args: ["fmt", "--check", "--manifest-path", "developer-tools/src-tauri/Cargo.toml"] },
  { id: "rustTests", kind: "test", executable: "cargo", args: ["test", "--locked", "--manifest-path", "developer-tools/src-tauri/Cargo.toml"] },
  { id: "uiSmoke", kind: "interaction", ...scriptCommand("npm", ["run", "test:ui"]) },
];

if (stages.map((stage) => stage.id).join("|") !== QUALITY_REQUIRED_STAGE_IDS.join("|")) {
  throw new Error("quality-stage-definition-mismatch");
}

const stripAnsi = (value) => value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
const iso = (value) => new Date(value).toISOString();
const commandText = (stage) => stage.displayCommand ?? [stage.executable, ...stage.args].map((part) => /\s/.test(part) ? JSON.stringify(part) : part).join(" ");

function parseNamedCounts(line, names) {
  const counts = Object.fromEntries(names.map((name) => [name, 0]));
  for (const name of names) {
    const match = line.match(new RegExp(`(\\d+)\\s+${name}`, "i"));
    if (match) counts[name] = Number(match[1]);
  }
  return counts;
}

function testCounts(stage, output) {
  const plain = stripAnsi(output);
  if (stage.id === "unitCoverage") {
    const line = plain.split(/\r?\n/).find((item) => /^\s*Tests\s+/i.test(item)) ?? "";
    const counts = parseNamedCounts(line, ["passed", "failed", "skipped"]);
    return { total: counts.passed + counts.failed + counts.skipped, ...counts };
  }
  if (stage.id === "developerNodeTests") {
    const find = (name) => Number(plain.match(new RegExp(`(?:ℹ\\s+)?${name}\\s+(\\d+)`, "i"))?.[1] ?? 0);
    const passed = find("pass");
    const failed = find("fail");
    const skipped = find("skipped");
    return { total: passed + failed + skipped, passed, failed, skipped };
  }
  if (stage.id === "rustTests") {
    const results = [...plain.matchAll(/test result:\s+\w+\.\s+(\d+) passed;\s+(\d+) failed;\s+(\d+) ignored/gi)];
    const counts = results.reduce((sum, match) => ({ passed: sum.passed + Number(match[1]), failed: sum.failed + Number(match[2]), skipped: sum.skipped + Number(match[3]) }), { passed: 0, failed: 0, skipped: 0 });
    return { total: counts.passed + counts.failed + counts.skipped, ...counts };
  }
  if (stage.id === "uiSmoke") return stage.status === "pass"
    ? { total: 1, passed: 1, failed: 0, skipped: 0 }
    : { total: 1, passed: 0, failed: 1, skipped: 0 };
  return { total: 0, passed: 0, failed: 0, skipped: 0 };
}

async function runStage(definition) {
  const started = Date.now();
  const output = [];
  let outputLength = 0;
  const keep = (chunk) => {
    const text = String(chunk);
    output.push(text);
    outputLength += text.length;
    while (outputLength > 128_000 && output.length > 1) outputLength -= output.shift().length;
    process.stdout.write(text);
  };
  const exitCode = await new Promise((resolve) => {
    const child = spawn(definition.executable, definition.args, {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (error) => { keep(`\n${error.message}\n`); resolve(1); });
    child.on("close", (code) => resolve(Number.isInteger(code) && code >= 0 ? code : 1));
  });
  const completed = Date.now();
  const status = exitCode === 0 ? "pass" : "fail";
  const fullOutput = output.join("");
  const stage = {
    id: definition.id,
    kind: definition.kind,
    command: commandText(definition),
    status,
    exitCode,
    startedAt: iso(started),
    completedAt: iso(completed),
    durationMs: completed - started,
    tests: { total: 0, passed: 0, failed: 0, skipped: 0 },
    outputTail: stripAnsi(fullOutput).slice(status === "pass" ? -2_000 : -8_000),
  };
  stage.tests = testCounts(stage, fullOutput);
  return stage;
}

function coverageMetric(value) {
  return {
    total: Number(value?.total ?? 0),
    covered: Number(value?.covered ?? 0),
    skipped: Number(value?.skipped ?? 0),
    pct: Number(value?.pct ?? 0),
  };
}

async function readCoverage() {
  try {
    const report = JSON.parse(await readFile(coveragePath, "utf8"));
    const total = report?.total;
    return {
      available: true,
      reportPath: path.relative(root, coveragePath).replaceAll("\\", "/"),
      lines: coverageMetric(total?.lines),
      statements: coverageMetric(total?.statements),
      functions: coverageMetric(total?.functions),
      branches: coverageMetric(total?.branches),
    };
  } catch {
    const empty = { total: 0, covered: 0, skipped: 0, pct: 0 };
    return { available: false, reportPath: "", lines: { ...empty }, statements: { ...empty }, functions: { ...empty }, branches: { ...empty } };
  }
}

const started = Date.now();
const sourceBefore = await computeQualitySourceSnapshot(root);
const results = [];
for (const stage of stages) {
  process.stdout.write(`\n[D31 ${results.length + 1}/${stages.length}] ${stage.id}: ${commandText(stage)}\n`);
  results.push(await runStage(stage));
}
const completed = Date.now();
const sourceAfter = await computeQualitySourceSnapshot(root);
const summary = results.reduce((value, stage) => {
  value.totalStages += 1;
  value[stage.status === "pass" ? "passedStages" : "failedStages"] += 1;
  value.totalTests += stage.tests.total;
  value.passedTests += stage.tests.passed;
  value.failedTests += stage.tests.failed;
  value.skippedTests += stage.tests.skipped;
  return value;
}, { totalStages: 0, passedStages: 0, failedStages: 0, totalTests: 0, passedTests: 0, failedTests: 0, skippedTests: 0 });
const evidence = {
  schemaVersion: 1,
  runnerVersion: "d31-1",
  generatedAt: iso(completed),
  startedAt: iso(started),
  completedAt: iso(completed),
  durationMs: completed - started,
  sourceBefore,
  sourceAfter,
  sourceStable: sourceBefore.digest === sourceAfter.digest,
  requiredStageIds: [...QUALITY_REQUIRED_STAGE_IDS],
  summary,
  coverage: await readCoverage(),
  stages: results,
};
await mkdir(path.dirname(outputPath), { recursive: true });
const temporary = `${outputPath}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
await rename(temporary, outputPath);
process.stdout.write(`\nD31 quality evidence: ${path.relative(root, outputPath)}\n`);
process.stdout.write(`${summary.passedStages}/${summary.totalStages} stages · ${summary.passedTests}/${summary.totalTests} tests · source ${evidence.sourceStable ? "stable" : "changed"}\n`);
if (summary.failedStages > 0 || !evidence.sourceStable || !evidence.coverage.available) process.exitCode = 1;
