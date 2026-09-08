import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocketModule = require("../co-management/relay/node_modules/ws");
const WebSocket = WebSocketModule.WebSocket ?? WebSocketModule;

const DEFAULT_BASE_URL = "https://staging.cohostrelay.online";
const PROTOCOL_VERSION = 1;
const SERVER_NAME = "Smartphone Manual QA Server";
const INITIAL_MAX_PLAYERS = 20;
const MIN_MAX_PLAYERS = 1;
const MAX_MAX_PLAYERS = 100;

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
    capabilities: [{ key: "maxPlayers", valueType: "integer", editableWhenStopped: true, min: MIN_MAX_PLAYERS, max: MAX_MAX_PLAYERS }],
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
    capabilities: [{ key: "maxPlayers", valueType: "integer", editableWhenStopped: true, min: MIN_MAX_PLAYERS, max: MAX_MAX_PLAYERS }],
    editable: true,
  };
}

class ManualFixtureHost {
  constructor({ baseUrl, origin, hostId, serverId, token }) {
    this.baseUrl = baseUrl;
    this.origin = origin;
    this.hostId = hostId;
    this.serverId = serverId;
    this.token = token;
    this.revision = 1;
    this.maxPlayers = INITIAL_MAX_PLAYERS;
    this.audit = [];
    this.operations = new Map();
    this.registerWaiters = new Map();
    this.closing = false;
    this.failure = undefined;
    this.keepaliveTimer = undefined;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    const wsBase = baseUrl.replace(/^https:/u, "wss:").replace(/^http:/u, "ws:");
    this.socket = new WebSocket(`${wsBase}/ws/host`, {
      headers: { Authorization: `Bearer ${token}`, Origin: origin },
    });
    this.socket.on("open", () => {
      try {
        this.send({ type: "host.hello", protocolVersion: PROTOCOL_VERSION, hostId, serverId });
        this.keepaliveTimer = setInterval(() => {
          if (this.socket.readyState === WebSocket.OPEN) this.socket.ping();
        }, 15_000);
      } catch (error) {
        this.fail(error);
      }
    });
    this.socket.on("message", (data) => this.handleMessage(data));
    this.socket.on("error", (error) => this.fail(error));
    this.socket.on("close", () => {
      if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = undefined;
      if (!this.closing) this.fail(new Error("manual-fixture-host-wss-closed"));
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
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error("manual-fixture-wss-not-open");
    this.socket.send(JSON.stringify(payload));
  }

  async waitUntilReady() {
    await Promise.race([
      this.readyPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("manual-fixture-host-ready-timeout")), 20_000)),
    ]);
  }

  async registerInvite({ inviteId, secret, role, expiresAt }) {
    const acknowledgement = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.registerWaiters.delete(inviteId);
        reject(new Error(`manual-fixture-invite-registration-timeout-${role}`));
      }, 10_000);
      this.registerWaiters.set(inviteId, { resolve: () => { clearTimeout(timer); resolve(); }, reject });
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
    } catch {
      this.fail(new Error("manual-fixture-host-message-invalid"));
      return;
    }
    if (payload.type === "host.ready") {
      if (payload.hostId !== this.hostId || payload.serverId !== this.serverId) {
        this.fail(new Error("manual-fixture-host-ready-mismatch"));
        return;
      }
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
    if (request.serverId !== this.serverId) throw new Error("manual-fixture-server-id-mismatch");
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
      const operation = this.operations.get(request.operationId);
      result = operation ? { requestId: request.operationId, state: "completed", result: operation } : { requestId: request.operationId, state: "running" };
    } else if (request.type === "settings.patch") {
      const operationId = request.operationId;
      const existing = this.operations.get(operationId);
      if (existing) {
        result = existing;
      } else if (request.expectedRevision !== this.revision) {
        ok = false;
        errorCode = "revision-conflict";
      } else if (!request.changes || Object.keys(request.changes).length !== 1 || typeof request.changes.maxPlayers !== "number" || !Number.isInteger(request.changes.maxPlayers) || request.changes.maxPlayers < MIN_MAX_PLAYERS || request.changes.maxPlayers > MAX_MAX_PLAYERS) {
        ok = false;
        errorCode = "synthetic-change-out-of-range";
      } else {
        this.maxPlayers = request.changes.maxPlayers;
        this.revision += 1;
        const resultSettings = settings(this.serverId, this.revision, this.maxPlayers);
        result = {
          requestId: operationId,
          serverId: this.serverId,
          revision: this.revision,
          changedFields: ["maxPlayers"],
          settings: resultSettings,
          message: "manual-fixture-applied",
        };
        this.operations.set(operationId, result);
        this.audit.unshift({
          id: `manual-fixture-audit-${this.revision}`,
          at: now(),
          actorId: "smartphone-manual-editor",
          actorDisplayName: "Smartphone QA",
          action: "settings.patch",
          changes: { maxPlayers: this.maxPlayers },
          result: "completed",
          requestId: operationId,
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
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    this.keepaliveTimer = undefined;
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      this.socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.close(1000, "manual-fixture-stopped");
    });
  }
}

async function requireStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label}-http-${response.status}`);
}

async function main() {
  const baseUrl = (process.env.MSH_CO_MANAGEMENT_STAGING_URL ?? DEFAULT_BASE_URL).replace(/\/+$/u, "");
  const parsedBase = new URL(baseUrl);
  if (!["http:", "https:"].includes(parsedBase.protocol) || parsedBase.username || parsedBase.password || parsedBase.pathname !== "/") {
    throw new Error("staging-url-must-be-origin");
  }
  const configuredMinutes = Number.parseInt(process.env.MSH_CO_MANAGEMENT_MANUAL_DURATION_MINUTES ?? "45", 10);
  const durationMinutes = Number.isInteger(configuredMinutes) ? Math.min(Math.max(configuredMinutes, 10), 120) : 45;
  const durationMs = durationMinutes * 60_000;
  const origin = parsedBase.origin;
  const suffix = randomBytes(8).toString("hex");
  const hostId = `manual-smartphone-host-${suffix}`;
  const serverId = `manual-smartphone-server-${suffix}`;
  const token = randomSecret();
  const viewerSecret = randomSecret();
  const editorSecret = randomSecret();
  const expiresAt = new Date(Date.now() + durationMs).toISOString();
  const host = new ManualFixtureHost({ baseUrl, origin, hostId, serverId, token });
  let stopped = false;

  const stop = async (reason) => {
    if (stopped) return;
    stopped = true;
    await host.close().catch(() => undefined);
    if (reason) console.log(JSON.stringify({ status: "stopped", reason }));
  };
  process.once("SIGINT", () => { void stop("signal").finally(() => process.exit(0)); });
  process.once("SIGTERM", () => { void stop("signal").finally(() => process.exit(0)); });

  try {
    const registration = await fetch(`${baseUrl}/api/v1/hosts/register`, {
      method: "POST",
      headers: { "content-type": "application/json", Origin: origin },
      body: JSON.stringify({ hostId, token, protocolVersion: PROTOCOL_VERSION }),
    });
    await requireStatus(registration, 204, "host-registration");
    await host.waitUntilReady();
    host.send({ type: "host.snapshot", protocolVersion: PROTOCOL_VERSION, serverId, snapshot: snapshot(serverId, 1, INITIAL_MAX_PLAYERS) });
    await Promise.all([
      host.registerInvite({ inviteId: `manual-invite-viewer-${suffix}`, secret: viewerSecret, role: "viewer", expiresAt }),
      host.registerInvite({ inviteId: `manual-invite-editor-${suffix}`, secret: editorSecret, role: "editor", expiresAt }),
    ]);
    const stopAt = new Date(Date.now() + durationMs).toISOString();
    console.log(JSON.stringify({
      status: "ready",
      surface: "public-staging-edge",
      baseUrl,
      serverName: SERVER_NAME,
      settings: { initialMaxPlayers: INITIAL_MAX_PLAYERS, allowedRange: `${MIN_MAX_PLAYERS}-${MAX_MAX_PLAYERS}` },
      editorUrl: `${baseUrl}/#invite=${encodeURIComponent(editorSecret)}`,
      viewerUrl: `${baseUrl}/#invite=${encodeURIComponent(viewerSecret)}`,
      expiresAt,
      stopAt,
      note: "Synthetic host only; no real game or password is connected. Do not share these temporary links.",
    }));
    setTimeout(() => { void stop("duration-expired").finally(() => process.exit(0)); }, durationMs).unref();
    await new Promise(() => {});
  } catch (error) {
    await stop("startup-failed");
    throw error;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
