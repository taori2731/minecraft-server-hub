import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const WebSocketModule = require("../co-management/relay/node_modules/ws");
const WebSocket = WebSocketModule.WebSocket ?? WebSocketModule;

const DEFAULT_BASE_URL = "https://staging.cohostrelay.online";
const PROTOCOL_VERSION = 1;
const SERVER_NAME = "Synthetic Staging Server";
const initialMaxPlayers = 20;
const updatedMaxPlayers = 24;
const runtimeSecrets = [];

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function randomSecret() {
  return randomBytes(32).toString("base64url");
}

function now() {
  return new Date().toISOString();
}

function snapshot(serverId, revision, maxPlayers) {
  return {
    serverId,
    serverName: SERVER_NAME,
    gameKind: "java",
    state: "stopped",
    playerCount: 0,
    maxPlayers,
    fetchedAt: now(),
    revision,
    capabilities: [{ key: "maxPlayers", valueType: "integer", editableWhenStopped: true, min: 1, max: 100 }],
  };
}

function settings(serverId, revision, maxPlayers) {
  return {
    serverId,
    gameKind: "java",
    state: "stopped",
    revision,
    fetchedAt: now(),
    fields: { maxPlayers },
    capabilities: [{ key: "maxPlayers", valueType: "integer", editableWhenStopped: true, min: 1, max: 100 }],
    editable: true,
  };
}

class SyntheticHost {
  constructor({ baseUrl, origin, hostId, serverId, token }) {
    this.baseUrl = baseUrl;
    this.origin = origin;
    this.hostId = hostId;
    this.serverId = serverId;
    this.token = token;
    this.revision = 1;
    this.maxPlayers = initialMaxPlayers;
    this.audit = [];
    this.lastOperation = undefined;
    this.closing = false;
    this.failure = undefined;
    this.registerWaiters = new Map();
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.socket = new WebSocket(`${baseUrl.replace(/^https:/u, "wss:").replace(/^http:/u, "ws:")}/ws/host`, {
      headers: { Authorization: `Bearer ${token}`, Origin: origin },
    });
    this.socket.on("open", () => {
      try {
        this.send({
          type: "host.hello",
          protocolVersion: PROTOCOL_VERSION,
          hostId: this.hostId,
          serverId: this.serverId,
        });
      } catch (error) {
        this.fail(error);
      }
    });
    this.socket.on("message", (data) => this.handleMessage(data));
    this.socket.on("error", (error) => this.fail(error));
    this.socket.on("close", (code, reason) => {
      if (!this.closing) this.fail(new Error(`host-wss-closed-${code}-${String(reason)}`));
    });
  }

  fail(error) {
    if (this.failure) return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.rejectReady?.(this.failure);
    for (const waiter of this.registerWaiters.values()) waiter.reject(this.failure);
    this.registerWaiters.clear();
  }

  send(payload) {
    if (this.failure) throw this.failure;
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error("host-wss-not-open");
    this.socket.send(JSON.stringify(payload));
  }

  async waitUntilReady() {
    await this.readyPromise;
  }

  async registerInvite({ inviteId, secret, role, expiresAt }) {
    const acknowledgement = new Promise((resolve, reject) => {
      this.registerWaiters.set(inviteId, { resolve, reject });
    });
    this.send({
      type: "invite.register",
      protocolVersion: PROTOCOL_VERSION,
      inviteId,
      serverId: this.serverId,
      role,
      secretHash: sha256(secret),
      expiresAt,
    });
    await acknowledgement;
  }

  handleMessage(data) {
    let payload;
    try {
      payload = JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
    } catch (error) {
      this.fail(new Error(`host-message-invalid-${String(error)}`));
      return;
    }
    if (payload.type === "host.ready") {
      assert.equal(payload.hostId, this.hostId);
      assert.equal(payload.serverId, this.serverId);
      this.resolveReady?.();
      this.resolveReady = undefined;
      return;
    }
    if (payload.type === "invite.registered") {
      const waiter = this.registerWaiters.get(payload.inviteId);
      if (waiter) {
        this.registerWaiters.delete(payload.inviteId);
        waiter.resolve();
      }
      return;
    }
    if (payload.type === "participant.pending") {
      this.send({
        type: "participant.approved",
        protocolVersion: PROTOCOL_VERSION,
        serverId: this.serverId,
        participantId: payload.participantId,
      });
      return;
    }
    if (["summary.get", "settings.get", "settings.patch", "audit.get", "operation.get"].includes(payload.type)) {
      try {
        this.respondToRequest(payload);
      } catch (error) {
        this.fail(error);
      }
    }
  }

  respondToRequest(request) {
    assert.equal(request.serverId, this.serverId);
    let ok = true;
    let result;
    let errorCode;
    if (request.type === "summary.get") {
      result = snapshot(this.serverId, this.revision, this.maxPlayers);
    } else if (request.type === "settings.get") {
      result = settings(this.serverId, this.revision, this.maxPlayers);
    } else if (request.type === "audit.get") {
      result = this.audit;
    } else if (request.type === "operation.get") {
      const operationId = request.operationId;
      if (this.lastOperation?.requestId === operationId) {
        result = { requestId: operationId, state: "completed", result: this.lastOperation.result };
      } else {
        result = { requestId: operationId, state: "running" };
      }
    } else if (request.type === "settings.patch") {
      if (request.expectedRevision !== this.revision) {
        ok = false;
        errorCode = "revision-conflict";
      } else if (request.changes?.maxPlayers !== updatedMaxPlayers) {
        ok = false;
        errorCode = "synthetic-change-mismatch";
      } else {
        this.maxPlayers = updatedMaxPlayers;
        this.revision += 1;
        const resultSettings = settings(this.serverId, this.revision, this.maxPlayers);
        result = {
          requestId: request.operationId,
          serverId: this.serverId,
          revision: this.revision,
          changedFields: ["maxPlayers"],
          settings: resultSettings,
          message: "synthetic-applied",
        };
        this.lastOperation = { requestId: request.operationId, result };
        this.audit.unshift({
          id: "synthetic-audit-1",
          at: now(),
          actorId: "synthetic-editor",
          actorDisplayName: "Editor QA",
          action: "settings.patch",
          changes: { maxPlayers: updatedMaxPlayers },
          result: "completed",
          requestId: request.operationId,
        });
      }
    }
    this.send({
      type: "host.response",
      protocolVersion: PROTOCOL_VERSION,
      serverId: this.serverId,
      requestId: request.requestId,
      ok,
      ...(ok ? { result } : { errorCode }),
    });
  }

  async close() {
    this.closing = true;
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      this.socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.close(1000, "synthetic-acceptance-complete");
    });
  }
}

async function expectStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label}-http-${response.status}`);
}

async function waitForInputValue(locator, expected, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await locator.inputValue() === expected) return;
    await locator.page().waitForTimeout(250);
  }
  throw new Error(`input-value-not-updated-${expected}`);
}

async function joinAndApprove(page, baseUrl, secret, displayName, serverHeading) {
  await page.goto(`${baseUrl}/#invite=${encodeURIComponent(secret)}`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "友達のサーバーに参加" }).waitFor({ state: "visible", timeout: 15_000 });
  await page.getByLabel("表示名").fill(displayName);
  assert.equal(await page.getByLabel("招待秘密").inputValue(), secret);
  await page.getByRole("button", { name: "共同管理に参加" }).click();
  await page.getByRole("heading", { name: "ホストPCの承認を待っています" }).waitFor({ state: "visible", timeout: 15_000 });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const refresh = page.getByRole("button", { name: "承認状態を確認" });
    await refresh.waitFor({ state: "visible", timeout: 5_000 });
    await refresh.click();
    try {
      await page.getByRole("heading", { name: serverHeading }).waitFor({ state: "visible", timeout: 3_000 });
      return;
    } catch {
      await page.waitForTimeout(500);
    }
  }
  throw new Error(`approval-timeout-${displayName}`);
}

function browserExecutable() {
  const configured = process.env.MSH_STAGING_BROWSER_EXECUTABLE;
  const candidates = [
    configured,
    "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
    "C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe",
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("brave-executable-not-found-set-MSH_STAGING_BROWSER_EXECUTABLE");
  return found;
}

function redact(message, secrets) {
  let value = String(message);
  for (const secret of secrets) value = value.split(secret).join("[redacted]");
  value = value.replace(/#invite=[^\s&"']+/gu, "#invite=[redacted]");
  return value.slice(0, 300);
}

async function main() {
  const baseUrl = (process.env.MSH_CO_MANAGEMENT_STAGING_URL ?? DEFAULT_BASE_URL).replace(/\/+$/u, "");
  const parsedBase = new URL(baseUrl);
  if (!["http:", "https:"].includes(parsedBase.protocol) || parsedBase.username || parsedBase.password || parsedBase.pathname !== "/") {
    throw new Error("staging-url-must-be-origin");
  }
  const origin = parsedBase.origin;
  const suffix = randomBytes(8).toString("hex");
  const hostId = `stage-accept-host-${suffix}`;
  const serverId = `stage-accept-server-${suffix}`;
  const token = randomSecret();
  const viewerSecret = randomSecret();
  const editorSecret = randomSecret();
  const secrets = [token, viewerSecret, editorSecret];
  runtimeSecrets.push(...secrets);
  const screenshotDir = join(tmpdir(), `msh-co-management-staging-${Date.now()}`);
  await mkdir(screenshotDir, { recursive: true });

  let browser;
  let viewerContext;
  let editorContext;
  let host;
  const pageErrors = [];
  try {
    const readiness = await fetch(`${baseUrl}/health/ready`);
    await expectStatus(readiness, 200, "readiness");
    assert.match(readiness.headers.get("strict-transport-security") ?? "", /^max-age=\d+$/u);

    const registration = await fetch(`${baseUrl}/api/v1/hosts/register`, {
      method: "POST",
      headers: { "content-type": "application/json", Origin: origin },
      body: JSON.stringify({ hostId, token, protocolVersion: PROTOCOL_VERSION }),
    });
    await expectStatus(registration, 204, "host-registration");

    host = new SyntheticHost({ baseUrl, origin, hostId, serverId, token });
    await host.waitUntilReady();
    host.send({ type: "host.snapshot", protocolVersion: PROTOCOL_VERSION, serverId, snapshot: snapshot(serverId, 1, initialMaxPlayers) });
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    await Promise.all([
      host.registerInvite({ inviteId: `stage-invite-viewer-${suffix}`, secret: viewerSecret, role: "viewer", expiresAt }),
      host.registerInvite({ inviteId: `stage-invite-editor-${suffix}`, secret: editorSecret, role: "editor", expiresAt }),
    ]);

    browser = await chromium.launch({ headless: true, executablePath: browserExecutable(), args: ["--no-sandbox"] });
    viewerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    editorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const viewerPage = await viewerContext.newPage();
    const editorPage = await editorContext.newPage();
    for (const page of [viewerPage, editorPage]) {
      page.on("pageerror", (error) => pageErrors.push(String(error)));
      page.on("console", (message) => {
        if (message.type() === "error") pageErrors.push(`${message.text()} @ ${message.location().url}`);
      });
    }

    await Promise.all([
      joinAndApprove(viewerPage, baseUrl, viewerSecret, "Viewer QA", SERVER_NAME),
      joinAndApprove(editorPage, baseUrl, editorSecret, "Editor QA", SERVER_NAME),
    ]);

    const viewerSessionCookie = (await viewerContext.cookies()).find((cookie) => cookie.name === "msh_co_session");
    const editorSessionCookie = (await editorContext.cookies()).find((cookie) => cookie.name === "msh_co_session");
    assert.ok(viewerSessionCookie?.value);
    assert.ok(editorSessionCookie?.value);
    assert.notEqual(viewerSessionCookie.value, editorSessionCookie.value);

    for (const page of [viewerPage, editorPage]) {
      assert.equal(new URL(page.url()).origin, origin);
      assert.equal(await page.title(), "Minecraft Server Hub | 共同管理");
      const bodyText = await page.locator("body").innerText();
      assert.match(bodyText, new RegExp(SERVER_NAME));
      assert.doesNotMatch(bodyText, /Vite|Unhandled Runtime Error|Cannot find module/iu);
    }

    await viewerPage.getByText("閲覧者は設定を確認できますが、変更は申請できません。", { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
    assert.equal(await viewerPage.getByRole("button", { name: "変更を申請" }).isDisabled(), true);
    await viewerPage.screenshot({ path: join(screenshotDir, "viewer-desktop-dashboard.png"), fullPage: false });

    const editorInput = editorPage.getByLabel("最大人数");
    assert.equal(await editorInput.inputValue(), String(initialMaxPlayers));
    await editorInput.fill(String(updatedMaxPlayers));
    await editorPage.getByRole("button", { name: "変更を申請" }).click();
    const confirmation = editorPage.getByRole("dialog", { name: "変更内容の確認" });
    await confirmation.waitFor({ state: "visible", timeout: 5_000 });
    const confirmationText = await confirmation.innerText();
    assert.match(confirmationText, /20/);
    assert.match(confirmationText, /24/);
    await confirmation.getByRole("button", { name: "この内容で申請" }).click();
    await editorPage.getByText("rev. 2", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
    await waitForInputValue(editorInput, String(updatedMaxPlayers));
    await editorPage.getByText("設定変更", { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
    await editorPage.screenshot({ path: join(screenshotDir, "editor-mobile-after-apply.png"), fullPage: false });

    await host.close();
    await Promise.all([
      viewerPage.getByRole("heading", { name: "参加セッションが終了しました" }).waitFor({ state: "visible", timeout: 20_000 }),
      editorPage.getByRole("heading", { name: "参加セッションが終了しました" }).waitFor({ state: "visible", timeout: 20_000 }),
    ]);
    assert.equal(pageErrors.length, 0, `browser-console-errors-${pageErrors.join(" | ")}`);

    console.log(JSON.stringify({
      status: "passed",
      surface: "public-staging-edge",
      browser: "Brave via Playwright",
      contexts: { viewer: "desktop-1280x900", editor: "mobile-390x844" },
      isolatedSessions: true,
      flow: ["invite-redeem", "host-ready", "dual-approval", "viewer-read-only", "editor-confirmation", "settings-apply", "host-disconnect-revocation"],
      settingsChange: `${initialMaxPlayers}->${updatedMaxPlayers}`,
      screenshots: [join(screenshotDir, "viewer-desktop-dashboard.png"), join(screenshotDir, "editor-mobile-after-apply.png")],
    }));
  } finally {
    if (host && !host.closing) await host.close().catch(() => undefined);
    await viewerContext?.close().catch(() => undefined);
    await editorContext?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

main().catch((error) => {
  const configuredSecrets = [process.env.MSH_CO_MANAGEMENT_REAL_RELAY, process.env.MSH_CO_MANAGEMENT_REAL_RELAY_ORIGIN].filter(Boolean);
  console.error(JSON.stringify({ status: "failed", error: redact(error instanceof Error ? error.message : error, [...runtimeSecrets, ...configuredSecrets]) }));
  process.exitCode = 1;
});
