import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { WebSocket } from "ws";
import { assertDatabaseTlsConfiguration, postgresSslConfiguration } from "./database-config.ts";
import {
  assertRelayRuntimeConfiguration,
  configuredPort,
  createRelayServer,
  hasWebSocketSendCapacity,
  MemoryRateLimiter,
} from "./server.ts";
import { MEMORY_OPERATION_RETENTION_MS, MemoryRelayStore, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, hashRelaySecret, type RelayStore } from "./store.ts";
import { isSafePublicSnapshot } from "../../shared/protocol.ts";

const origin = "http://127.0.0.1:8787";
const token = "t".repeat(48);
const secret = "s".repeat(48);

function waitForSocketMessage(socket: WebSocket, predicate: (payload: Record<string, unknown>) => boolean): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", onMessage);
      reject(new Error("socket-message-timeout"));
    }, 2_000);
    const onMessage = (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const parsed: unknown = JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
        const payload = parsed as Record<string, unknown>;
        if (!predicate(payload)) return;
        clearTimeout(timer);
        socket.off("message", onMessage);
        resolve(payload);
      } catch {
        // Ignore unrelated or malformed messages; the timeout reports a missing expected event.
      }
    };
    socket.on("message", onMessage);
  });
}

async function openSocket(socket: WebSocket): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

test("MemoryRelayStore redeems an invite once and hides the join code after approval", () => {
  const store = new MemoryRelayStore();
  store.registerHost("host-test", token);
  store.bindHostServer("host-test", "server-test");
  store.registerInvite({
    inviteId: "invite-test",
    serverId: "server-test",
    hostId: "host-test",
    secretHash: hashRelaySecret(secret),
    role: "editor",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  const redeemed = store.redeemInvite(secret, "Takeru");
  assert.equal(redeemed.pendingEvent.serverId, "server-test");
  assert.match(redeemed.pendingEvent.joinCode, /^\d{6}$/u);
  assert.equal(store.sessionView(redeemed.session.sessionId)?.joinCode, redeemed.session.joinCode);
  assert.throws(() => store.redeemInvite(secret, "Second user"), /invite-invalid-or-expired/u);

  store.approveParticipant("host-test", "server-test", redeemed.session.participantId);
  const approved = store.sessionView(redeemed.session.sessionId);
  assert.equal(approved?.state, "approved");
  assert.equal(approved?.joinCode, undefined);
  assert.equal(approved?.server, undefined);
  store.revokeParticipant("host-test", "server-test", redeemed.session.participantId);
  assert.throws(
    () => store.approveParticipant("host-test", "server-test", redeemed.session.participantId),
    /participant-not-pending/u,
  );
});

test("all PostgreSQL entry points reject production TLS disable", () => {
  const production = {
    NODE_ENV: "production",
    MSH_CO_MANAGEMENT_DATABASE_SSL: "disable",
  };
  assert.throws(() => assertDatabaseTlsConfiguration(production), /PostgreSQL TLS/u);
  assert.throws(() => postgresSslConfiguration(production), /PostgreSQL TLS/u);
  assert.deepEqual(postgresSslConfiguration({ NODE_ENV: "development", MSH_CO_MANAGEMENT_DATABASE_SSL: "disable" }), false);
  assert.deepEqual(postgresSslConfiguration({ NODE_ENV: "production", MSH_CO_MANAGEMENT_DATABASE_SSL: "require" }), { rejectUnauthorized: true });
});

test("production startup fails closed until persistent storage and TLS are configured", () => {
  assert.throws(
    () => assertRelayRuntimeConfiguration({ NODE_ENV: "production" }),
    /PostgreSQL/u,
  );
  assert.throws(
    () => assertRelayRuntimeConfiguration({ NODE_ENV: "production", MSH_CO_MANAGEMENT_DATABASE_URL: "postgres://staging.invalid/db" }),
    /暗号化鍵リング/u,
  );
  assert.throws(
    () => assertRelayRuntimeConfiguration({
      NODE_ENV: "production",
      MSH_CO_MANAGEMENT_DATABASE_URL: "postgres://staging.invalid/db",
      MSH_CO_MANAGEMENT_RELAY_KEYS: "v1:placeholder",
      MSH_CO_MANAGEMENT_ALLOWED_ORIGINS: "http://localhost:8788",
    }),
    /HTTPS.*Origin/u,
  );
  assert.doesNotThrow(() => assertRelayRuntimeConfiguration({
    NODE_ENV: "production",
    MSH_CO_MANAGEMENT_DATABASE_URL: "postgres://staging.invalid/db",
    MSH_CO_MANAGEMENT_DATABASE_SSL: "require",
    MSH_CO_MANAGEMENT_RELAY_KEYS: `v1:${Buffer.alloc(32, 4).toString("base64url")}`,
    MSH_CO_MANAGEMENT_ALLOWED_ORIGINS: "https://staging.cohostrelay.online",
  }));
  assert.doesNotThrow(() => assertRelayRuntimeConfiguration({ NODE_ENV: "development" }));
});

test("configuredPort supports hosting PORT and validates the range", () => {
  assert.equal(configuredPort({ PORT: "10000" }), 10_000);
  assert.equal(configuredPort({ PORT: "10000", MSH_CO_MANAGEMENT_PORT: "8787" }), 8787);
  assert.equal(configuredPort({}), 8787);
  assert.throws(() => configuredPort({ PORT: "0" }), /invalid-relay-port/u);
  assert.throws(() => configuredPort({ PORT: "not-a-number" }), /invalid-relay-port/u);
});

test("relay emits security headers and readiness fails closed", async (t) => {
  const relay = createRelayServer({
    hstsMaxAgeSeconds: 300,
    readinessCheck: async () => { throw new Error("database-unavailable"); },
  });
  t.after(async () => relay.close());
  const live = await relay.app.inject({ method: "GET", url: "/health/live" });
  assert.equal(live.statusCode, 200);
  assert.equal(live.headers["x-content-type-options"], "nosniff");
  assert.equal(live.headers["strict-transport-security"], "max-age=300");
  assert.match(String(live.headers["content-security-policy"]), /frame-ancestors 'none'/u);
  const ready = await relay.app.inject({ method: "GET", url: "/health/ready" });
  assert.equal(ready.statusCode, 503);
  assert.deepEqual(ready.json(), { status: "not-ready" });
});

test("host registration is idempotent only for the current credential", () => {
  const store = new MemoryRelayStore();
  store.registerHost("host-test", token);
  store.registerHost("host-test", token);
  assert.throws(() => store.registerHost("host-test", "x".repeat(48)), /host-registration-conflict/u);
  assert.equal(store.verifyHost("host-test", token), true);
  assert.equal(store.verifyHost("host-test", "x".repeat(48)), false);
});

test("host registration endpoint preserves the original credential", async (t) => {
  const relay = createRelayServer({ secureCookies: false, allowedOrigins: [origin] });
  t.after(async () => relay.close());
  await relay.app.ready();
  const first = await relay.app.inject({ method: "POST", url: "/api/v1/hosts/register", headers: { origin }, payload: { hostId: "host-api-test", token, protocolVersion: 1 } });
  assert.equal(first.statusCode, 204);
  const conflicting = await relay.app.inject({ method: "POST", url: "/api/v1/hosts/register", headers: { origin }, payload: { hostId: "host-api-test", token: "x".repeat(48), protocolVersion: 1 } });
  assert.equal(conflicting.statusCode, 409);
  const original = await relay.app.inject({ method: "POST", url: "/api/v1/hosts/register", headers: { origin }, payload: { hostId: "host-api-test", token, protocolVersion: 1 } });
  assert.equal(original.statusCode, 204);
  assert.equal(relay.store.verifyHost("host-api-test", token), true);
});

test("host-local server and operation IDs remain isolated", () => {
  const store = new MemoryRelayStore();
  const secondToken = "u".repeat(48);
  const snapshot = (serverName: string) => ({
    serverId: "same-local-server", serverName, gameKind: "java", state: "stopped",
    playerCount: 0, maxPlayers: 20, fetchedAt: new Date().toISOString(), revision: 1, capabilities: [],
  });
  store.registerHost("host-a", token);
  store.registerHost("host-b", secondToken);
  store.bindHostServer("host-a", "same-local-server");
  store.bindHostServer("host-b", "same-local-server");
  store.setSnapshot("host-a", snapshot("A"));
  store.setSnapshot("host-b", snapshot("B"));
  assert.equal(store.snapshot("host-a", "same-local-server")?.serverName, "A");
  assert.equal(store.snapshot("host-b", "same-local-server")?.serverName, "B");
  store.saveOperation({ requestId: "request-same", hostId: "host-a", serverId: "same-local-server", participantId: "participant-a", contentHash: "a".repeat(64), state: "completed", result: { owner: "a" }, updatedAt: new Date().toISOString() });
  store.saveOperation({ requestId: "request-same", hostId: "host-b", serverId: "same-local-server", participantId: "participant-b", contentHash: "b".repeat(64), state: "completed", result: { owner: "b" }, updatedAt: new Date().toISOString() });
  assert.deepEqual(store.operation("host-a", "same-local-server", "participant-a", "request-same")?.result, { owner: "a" });
  assert.deepEqual(store.operation("host-b", "same-local-server", "participant-b", "request-same")?.result, { owner: "b" });
  assert.equal(store.operation("host-a", "same-local-server", "participant-b", "request-same"), undefined);
});

test("session expiry is independent from the invitation and polling does not extend idle time", () => {
  let current = Date.parse("2026-09-07T00:00:00.000Z");
  const store = new MemoryRelayStore(() => new Date(current));
  store.registerHost("host-test", token);
  store.bindHostServer("host-test", "server-test");
  store.registerInvite({ inviteId: "invite-test", serverId: "server-test", hostId: "host-test", secretHash: hashRelaySecret(secret), role: "viewer", expiresAt: new Date(current + 10 * 60_000).toISOString() });
  const redeemed = store.redeemInvite(secret, "Takeru");
  assert.equal(Date.parse(redeemed.session.expiresAt) - current, SESSION_ABSOLUTE_MS);
  current += SESSION_IDLE_MS - 1;
  assert.equal(store.sessionView(redeemed.session.sessionId)?.state, "pending");
  current += 2;
  assert.equal(store.sessionView(redeemed.session.sessionId)?.state, "expired");
});

test("MemoryRelayStore bounds state and reclaims only expired or terminal records", () => {
  let current = Date.parse("2026-09-07T00:00:00.000Z");
  const store = new MemoryRelayStore(() => new Date(current), {
    maxHosts: 1,
    maxServersPerHost: 2,
    maxInvites: 1,
    maxParticipants: 1,
    maxSessions: 1,
    maxSnapshots: 1,
    maxOperations: 1,
  });
  store.registerHost("host-test", token);
  assert.throws(() => store.registerHost("host-overflow", "u".repeat(48)), /relay-memory-capacity/u);
  store.bindHostServer("host-test", "server-test");
  store.bindHostServer("host-test", "server-second");
  const snapshot = (serverId: string) => ({
    serverId, serverName: serverId, gameKind: "java", state: "stopped",
    playerCount: 0, maxPlayers: 20, fetchedAt: new Date(current).toISOString(), revision: 1, capabilities: [],
  });
  store.setSnapshot("host-test", snapshot("server-test"));
  assert.throws(() => store.setSnapshot("host-test", snapshot("server-second")), /relay-memory-capacity/u);

  store.registerInvite({
    inviteId: "invite-first", serverId: "server-test", hostId: "host-test",
    secretHash: hashRelaySecret("a".repeat(48)), role: "viewer",
    expiresAt: new Date(current + 1_000).toISOString(),
  });
  const first = store.redeemInvite("a".repeat(48), "First");
  current += 2_000;
  store.registerInvite({
    inviteId: "invite-second", serverId: "server-test", hostId: "host-test",
    secretHash: hashRelaySecret("b".repeat(48)), role: "viewer",
    expiresAt: new Date(current + 60_000).toISOString(),
  });
  const second = store.redeemInvite("b".repeat(48), "Second");
  assert.notEqual(first.session.sessionId, second.session.sessionId);

  store.saveOperation({
    requestId: "operation-first", hostId: "host-test", serverId: "server-test", participantId: second.session.participantId,
    state: "completed", result: { ok: true }, updatedAt: new Date(current).toISOString(),
  });
  current += MEMORY_OPERATION_RETENTION_MS + 1;
  store.saveOperation({
    requestId: "operation-second", hostId: "host-test", serverId: "server-test", participantId: second.session.participantId,
    state: "completed", result: { ok: true }, updatedAt: new Date(current).toISOString(),
  });
  assert.equal(store.operation("host-test", "server-test", second.session.participantId, "operation-first"), undefined);
  assert.deepEqual(store.operation("host-test", "server-test", second.session.participantId, "operation-second")?.result, { ok: true });
  assert.throws(() => store.saveOperation({
    requestId: "operation-running", hostId: "host-test", serverId: "server-test", participantId: second.session.participantId,
    state: "running", updatedAt: new Date(current).toISOString(),
  }), /relay-memory-capacity/u);
});

test("MemoryRateLimiter reclaims expired windows and fails closed at capacity", async () => {
  let current = 0;
  const limiter = new MemoryRateLimiter({ maxEntries: 1, clock: () => current });
  assert.equal(await limiter.consume("first", 1, 1_000), true);
  assert.equal(await limiter.consume("first", 1, 1_000), false);
  await assert.rejects(limiter.consume("second", 1, 1_000), /relay-memory-capacity/u);
  current = 2_001;
  assert.equal(await limiter.consume("second", 1, 1_000), true);
});

test("bounded WebSocket send capacity rejects invalid or over-limit buffers", () => {
  assert.equal(hasWebSocketSendCapacity({ bufferedAmount: 0 }, 100, 100), true);
  assert.equal(hasWebSocketSendCapacity({ bufferedAmount: 1 }, 100, 100), false);
  assert.equal(hasWebSocketSendCapacity({ bufferedAmount: 0 }, 101, 100), false);
  assert.equal(hasWebSocketSendCapacity({ bufferedAmount: Number.NaN }, 100, 100), false);
});

test("host disconnect removes cached snapshots and revokes existing sessions", () => {
  const store = new MemoryRelayStore();
  store.registerHost("host-test", token);
  store.bindHostServer("host-test", "server-test");
  store.setSnapshot("host-test", {
    serverId: "server-test", serverName: "Test", gameKind: "java", state: "stopped",
    playerCount: 0, maxPlayers: 20, fetchedAt: new Date().toISOString(), revision: 1, capabilities: [],
  });
  store.registerInvite({ inviteId: "invite-test", serverId: "server-test", hostId: "host-test", secretHash: hashRelaySecret(secret), role: "viewer", expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const redeemed = store.redeemInvite(secret, "Takeru");
  store.approveParticipant("host-test", "server-test", redeemed.session.participantId);
  assert.equal(store.snapshot("host-test", "server-test")?.serverName, "Test");
  assert.equal(store.sessionView(redeemed.session.sessionId)?.state, "approved");
  store.disconnectHost("host-test");
  assert.equal(store.snapshot("host-test", "server-test"), undefined);
  assert.equal(store.sessionView(redeemed.session.sessionId)?.state, "revoked");
  assert.equal(store.participant("host-test", redeemed.session.participantId)?.state, "revoked");
});

test("public snapshots reject unknown fields and oversized capability arrays", () => {
  const safe = { serverId: "server-test", serverName: "Test", gameKind: "java", state: "stopped", playerCount: 0, maxPlayers: 20, fetchedAt: new Date().toISOString(), revision: 1, capabilities: [] };
  assert.equal(isSafePublicSnapshot(safe), true);
  assert.equal(isSafePublicSnapshot({ ...safe, rootPath: "C:\\Servers\\Test" }), false);
  assert.equal(isSafePublicSnapshot({ ...safe, capabilities: Array.from({ length: 33 }, () => ({ key: "difficulty", valueType: "string", editableWhenStopped: true })) }), false);
  assert.equal(isSafePublicSnapshot({ ...safe, capabilities: [{ key: "difficulty", valueType: "string", editableWhenStopped: true, adminPassword: "secret" }] }), false);
});

test("relay rejects an unapproved origin and redeems through the browser route", async (t) => {
  const relay = createRelayServer({ secureCookies: false });
  t.after(async () => relay.close());
  await relay.app.ready();

  const rejected = await relay.app.inject({
    method: "POST",
    url: "/api/v1/invites/redeem",
    headers: { origin: "http://malicious.example" },
    payload: { secret, displayName: "Takeru" },
  });
  assert.equal(rejected.statusCode, 403);
  assert.deepEqual(rejected.json(), { error: "origin-not-allowed" });

  relay.store.registerHost("host-test", token);
  relay.store.bindHostServer("host-test", "server-test");
  relay.store.registerInvite({
    inviteId: "invite-test",
    serverId: "server-test",
    hostId: "host-test",
    secretHash: hashRelaySecret(secret),
    role: "viewer",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const redeemed = await relay.app.inject({
    method: "POST",
    url: "/api/v1/invites/redeem",
    headers: { origin },
    payload: { secret, displayName: "Takeru" },
  });
  assert.equal(redeemed.statusCode, 200);
  const body = redeemed.json() as { session: { state: string; joinCode?: string }; joinCode: string };
  assert.equal(body.session.state, "pending");
  assert.match(body.joinCode, /^\d{6}$/u);
  assert.equal(body.session.joinCode, body.joinCode);
  const cookies = redeemed.headers["set-cookie"];
  assert.ok(cookies);
  if (!Array.isArray(cookies)) throw new Error("missing-set-cookie");
  const cookieHeader = cookies.map((value) => value.split(";", 1)[0]).join("; ");
  const sameOriginGet = await relay.app.inject({ method: "GET", url: "/api/v1/session", headers: { cookie: cookieHeader } });
  assert.equal(sameOriginGet.statusCode, 200);
  assert.equal(sameOriginGet.json().session.state, "pending");
});

test("relay requires the CSRF cookie/header pair to close a session", async (t) => {
  const relay = createRelayServer({ secureCookies: false });
  t.after(async () => relay.close());
  await relay.app.ready();
  relay.store.registerHost("host-test", token);
  relay.store.bindHostServer("host-test", "server-test");
  relay.store.registerInvite({
    inviteId: "invite-test",
    serverId: "server-test",
    hostId: "host-test",
    secretHash: hashRelaySecret(secret),
    role: "viewer",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const redeemed = await relay.app.inject({ method: "POST", url: "/api/v1/invites/redeem", headers: { origin }, payload: { secret, displayName: "Takeru" } });
  const cookies = redeemed.headers["set-cookie"];
  assert.ok(Array.isArray(cookies));
  const cookieHeader = cookies.map((value) => value.split(";", 1)[0]).join("; ");
  const noCsrf = await relay.app.inject({ method: "POST", url: "/api/v1/session/close", headers: { origin, cookie: cookieHeader }, payload: {} });
  assert.equal(noCsrf.statusCode, 403);
  const csrfCookie = cookies.find((value) => value.startsWith("msh_co_csrf="));
  assert.ok(csrfCookie);
  const csrf = csrfCookie.split(";", 1)[0].slice("msh_co_csrf=".length);
  const closed = await relay.app.inject({ method: "POST", url: "/api/v1/session/close", headers: { origin, cookie: cookieHeader, "x-csrf-token": decodeURIComponent(csrf) }, payload: {} });
  assert.equal(closed.statusCode, 204);
  assert.equal((await relay.app.inject({ method: "GET", url: "/api/v1/session", headers: { origin, cookie: cookieHeader } })).statusCode, 401);
});

test("relay bounds pre-auth WebSocket connections and releases the budget", async (t) => {
  const relay = createRelayServer({ maxPreAuthWebSocketConnections: 1 });
  t.after(async () => relay.close());
  await relay.start(0, "127.0.0.1");
  const address = relay.app.server.address() as AddressInfo;
  const first = new WebSocket(`ws://127.0.0.1:${address.port}/ws/host`, { headers: { Authorization: `Bearer ${token}` } });
  t.after(() => first.terminate());
  await openSocket(first);

  const second = new WebSocket(`ws://127.0.0.1:${address.port}/ws/host`, { headers: { Authorization: `Bearer ${token}` } });
  t.after(() => second.terminate());
  const rejected = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 1_000);
    const finish = (value: boolean) => {
      clearTimeout(timer);
      resolve(value);
    };
    second.once("open", () => finish(false));
    second.once("error", () => finish(true));
    second.once("close", () => finish(true));
  });
  assert.equal(rejected, true);

  await new Promise<void>((resolve) => {
    first.once("close", () => resolve());
    first.terminate();
  });
  const third = new WebSocket(`ws://127.0.0.1:${address.port}/ws/host`, { headers: { Authorization: `Bearer ${token}` } });
  t.after(() => third.terminate());
  await openSocket(third);
});

test("relay rate-limits WebSocket upgrade attempts by the TCP peer even with proxy headers", async (t) => {
  const relay = createRelayServer({ maxWebSocketUpgradeAttempts: 1, maxPreAuthWebSocketConnections: 8, trustProxy: true });
  t.after(async () => relay.close());
  await relay.start(0, "127.0.0.1");
  const address = relay.app.server.address() as AddressInfo;
  const first = new WebSocket(`ws://127.0.0.1:${address.port}/ws/host`, { headers: { Authorization: `Bearer ${token}`, "X-Forwarded-For": "198.51.100.1" } });
  t.after(() => first.terminate());
  await openSocket(first);
  await new Promise<void>((resolve) => {
    first.once("close", () => resolve());
    first.terminate();
  });

  const second = new WebSocket(`ws://127.0.0.1:${address.port}/ws/host`, { headers: { Authorization: `Bearer ${token}`, "X-Forwarded-For": "198.51.100.2" } });
  t.after(() => second.terminate());
  const statusCode = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("websocket-rate-limit-timeout")), 1_000);
    second.once("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      resolve(response.statusCode ?? 0);
    });
    second.once("error", () => undefined);
  });
  assert.equal(statusCode, 429);
});

test("relay closes a connected host before exceeding its event send buffer", async (t) => {
  const relay = createRelayServer({
    secureCookies: false,
    allowedOrigins: [origin],
    maxHostEventBufferedBytes: 256 * 1024,
  });
  t.after(async () => relay.close());
  await relay.start(0, "127.0.0.1");
  const address = relay.app.server.address() as AddressInfo;
  relay.store.registerHost("buffered-host", token);
  relay.store.bindHostServer("buffered-host", "server-test");

  let hostSocket: WebSocket;
  let serverSocket: WebSocket | undefined;
  const webSocketPrototype = WebSocket.prototype as unknown as {
    send(this: WebSocket, ...args: unknown[]): void;
  };
  const originalSend = webSocketPrototype.send;
  webSocketPrototype.send = function (this: WebSocket, ...args: unknown[]) {
    if (this !== hostSocket && (this as WebSocket & { _isServer?: boolean })._isServer === true) {
      serverSocket = this;
    }
    return originalSend.apply(this, args);
  };
  t.after(() => {
    webSocketPrototype.send = originalSend;
  });

  hostSocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/host`, { headers: { Authorization: `Bearer ${token}` } });
  hostSocket.on("error", () => undefined);
  t.after(() => hostSocket.terminate());
  await openSocket(hostSocket);
  hostSocket.send(JSON.stringify({ type: "host.hello", protocolVersion: 1, hostId: "buffered-host", serverId: "server-test" }));
  await waitForSocketMessage(hostSocket, (payload) => payload.type === "host.ready");
  assert.ok(serverSocket);
  Object.defineProperty(serverSocket, "bufferedAmount", { configurable: true, value: 256 * 1024 });

  const eventSecret = "e".repeat(48);
  relay.store.registerInvite({
    inviteId: "buffered-invite",
    serverId: "server-test",
    hostId: "buffered-host",
    secretHash: hashRelaySecret(eventSecret),
    role: "viewer",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  const response = await relay.app.inject({
    method: "POST",
    url: "/api/v1/invites/redeem",
    headers: { origin },
    payload: { secret: eventSecret, displayName: "Buffered" },
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "host-notification-unavailable" });
  await new Promise<void>((resolve) => {
    if (hostSocket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    hostSocket.once("close", () => resolve());
  });
});

test("relay terminates a WebSocket when its bounded inbound queue overflows", async (t) => {
  const baseStore = new MemoryRelayStore();
  const store = new Proxy(baseStore, {
    get(target, property, receiver) {
      if (property === "verifyHost") {
        return async (hostId: string, hostToken: string) => {
          await new Promise((resolve) => setTimeout(resolve, 250));
          return target.verifyHost(hostId, hostToken);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as RelayStore;
  const relay = createRelayServer({ store, maxInboundWebSocketMessages: 1 });
  t.after(async () => relay.close());
  await relay.start(0, "127.0.0.1");
  const address = relay.app.server.address() as AddressInfo;
  store.registerHost("slow-host", token);
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/host`, { headers: { Authorization: `Bearer ${token}` } });
  t.after(() => socket.terminate());
  await openSocket(socket);
  const closed = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 1_500);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
    socket.once("error", () => undefined);
  });
  socket.send(JSON.stringify({ type: "host.hello", protocolVersion: 1, hostId: "slow-host", serverId: "server-test" }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  socket.send(JSON.stringify({ type: "host.hello", protocolVersion: 1, hostId: "slow-host", serverId: "server-test" }));
  assert.equal(await closed, true);
});

test("invite redemption reports a bounded host-event queue failure", async (t) => {
  const relay = createRelayServer({ secureCookies: false, maxQueuedHostEvents: 1 });
  t.after(async () => relay.close());
  await relay.app.ready();
  relay.store.registerHost("offline-host", token);
  relay.store.bindHostServer("offline-host", "server-test");
  const firstSecret = "a".repeat(48);
  const secondSecret = "b".repeat(48);
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  relay.store.registerInvite({ inviteId: "invite-first", serverId: "server-test", hostId: "offline-host", secretHash: hashRelaySecret(firstSecret), role: "viewer", expiresAt });
  relay.store.registerInvite({ inviteId: "invite-second", serverId: "server-test", hostId: "offline-host", secretHash: hashRelaySecret(secondSecret), role: "viewer", expiresAt });
  const first = await relay.app.inject({ method: "POST", url: "/api/v1/invites/redeem", headers: { origin }, payload: { secret: firstSecret, displayName: "First" } });
  assert.equal(first.statusCode, 200);
  const second = await relay.app.inject({ method: "POST", url: "/api/v1/invites/redeem", headers: { origin }, payload: { secret: secondSecret, displayName: "Second" } });
  assert.equal(second.statusCode, 503);
  assert.deepEqual(second.json(), { error: "host-notification-unavailable" });
});

test("host reconnect does not replay a participant event after approval", async (t) => {
  const relay = createRelayServer({ secureCookies: false, allowedOrigins: [origin] });
  t.after(async () => relay.close());
  const base = await relay.start(0, "127.0.0.1");
  const address = relay.app.server.address() as AddressInfo;
  relay.store.registerHost("replay-host", token);
  relay.store.bindHostServer("replay-host", "server-test");
  const firstSocket = new WebSocket(`${base.replace(/:\d+$/u, `:${address.port}`)}/ws/host`, { headers: { Authorization: `Bearer ${token}` } });
  t.after(() => firstSocket.terminate());
  await openSocket(firstSocket);
  firstSocket.send(JSON.stringify({ type: "host.hello", protocolVersion: 1, hostId: "replay-host", serverId: "server-test" }));
  await waitForSocketMessage(firstSocket, (payload) => payload.type === "host.ready");
  await new Promise<void>((resolve) => {
    firstSocket.once("close", () => resolve());
    firstSocket.terminate();
  });
  await new Promise((resolve) => setTimeout(resolve, 40));

  const pendingSecret = "p".repeat(48);
  relay.store.registerInvite({ inviteId: "replay-invite", serverId: "server-test", hostId: "replay-host", secretHash: hashRelaySecret(pendingSecret), role: "viewer", expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const redeemed = await relay.app.inject({ method: "POST", url: "/api/v1/invites/redeem", headers: { origin }, payload: { secret: pendingSecret, displayName: "Pending" } });
  assert.equal(redeemed.statusCode, 200);
  const participantId = (redeemed.json() as { session: { participantId: string } }).session.participantId;
  relay.store.approveParticipant("replay-host", "server-test", participantId);

  const reconnect = new WebSocket(`ws://127.0.0.1:${address.port}/ws/host`, { headers: { Authorization: `Bearer ${token}` } });
  t.after(() => reconnect.terminate());
  await openSocket(reconnect);
  reconnect.send(JSON.stringify({ type: "host.hello", protocolVersion: 1, hostId: "replay-host", serverId: "server-test" }));
  await waitForSocketMessage(reconnect, (payload) => payload.type === "host.ready");
  let staleEventDelivered = false;
  const onMessage = (data: Buffer | ArrayBuffer | Buffer[]) => {
    const payload = JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : String(data)) as Record<string, unknown>;
    if (payload.type === "participant.pending") staleEventDelivered = true;
  };
  reconnect.on("message", onMessage);
  await new Promise((resolve) => setTimeout(resolve, 250));
  reconnect.off("message", onMessage);
  assert.equal(staleEventDelivered, false);
});

test("relay bridges a host WebSocket request without exposing host-only fields", async (t) => {
  const relay = createRelayServer({ secureCookies: false, allowedOrigins: [origin], maxPendingHostRequests: 1 });
  t.after(async () => relay.close());
  const base = await relay.start(0, "127.0.0.1");
  const address = relay.app.server.address() as AddressInfo;
  assert.equal(address.address, "127.0.0.1");
  relay.store.registerHost("host-test", token);
  relay.store.bindHostServer("host-test", "server-test");

  const hostSocket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/host`, { headers: { Authorization: `Bearer ${token}` } });
  t.after(() => hostSocket.close());
  await openSocket(hostSocket);
  hostSocket.send(JSON.stringify({ type: "host.hello", protocolVersion: 1, hostId: "host-test", serverId: "server-test" }));
  const ready = await waitForSocketMessage(hostSocket, (payload) => payload.type === "host.ready");
  assert.equal(ready.serverId, "server-test");
  hostSocket.send(JSON.stringify({ type: "host.snapshot", protocolVersion: 1, serverId: "server-test", snapshot: {
    serverId: "server-test", serverName: "Test World", gameKind: "java", state: "stopped", playerCount: 0, maxPlayers: 20,
    fetchedAt: new Date().toISOString(), revision: 1, capabilities: [],
  } }));
  const hostEvent = waitForSocketMessage(hostSocket, (payload) => payload.type === "participant.pending");
  relay.store.registerInvite({ inviteId: "invite-test", serverId: "server-test", hostId: "host-test", secretHash: hashRelaySecret(secret), role: "editor", expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const redeemed = await relay.app.inject({ method: "POST", url: "/api/v1/invites/redeem", headers: { origin }, payload: { secret, displayName: "Takeru" } });
  assert.equal(redeemed.statusCode, 200);
  const body = redeemed.json() as { session: { participantId: string; serverId: string }; joinCode: string };
  const pending = await hostEvent;
  assert.equal(pending.joinCode, body.joinCode);
  relay.store.approveParticipant("host-test", "server-test", body.session.participantId);
  const cookies = redeemed.headers["set-cookie"];
  assert.ok(Array.isArray(cookies));
  const cookieHeader = cookies.map((value) => value.split(";", 1)[0]).join("; ");
  const sessionId = decodeURIComponent(cookies.find((value) => value.startsWith("msh_co_session="))!.split(";", 1)[0].slice("msh_co_session=".length));
  const summary = await relay.app.inject({ method: "GET", url: "/api/v1/servers/server-test/summary", headers: { origin, cookie: cookieHeader } });
  assert.equal(summary.statusCode, 200);
  assert.equal(JSON.stringify(summary.json()).includes("address"), false);

  const settingsRequest = relay.app.inject({ method: "GET", url: "/api/v1/servers/server-test/settings", headers: { origin, cookie: cookieHeader } });
  const settingsMessage = await waitForSocketMessage(hostSocket, (payload) => payload.type === "settings.get");
  hostSocket.send(JSON.stringify({ type: "host.response", protocolVersion: 1, serverId: "server-test", requestId: settingsMessage.requestId, ok: true, result: { serverId: "server-test", gameKind: "java", state: "stopped", revision: 1, fetchedAt: new Date().toISOString(), fields: { difficulty: "normal" }, capabilities: [], editable: true } }));
  const settings = await settingsRequest;
  assert.equal(settings.statusCode, 200);

  const requestId = "request-test-1234";
  const patchRequest = relay.app.inject({ method: "PATCH", url: "/api/v1/servers/server-test/settings", headers: { origin, cookie: cookieHeader, "x-csrf-token": decodeURIComponent(cookies.find((value) => value.startsWith("msh_co_csrf="))!.split(";", 1)[0].slice("msh_co_csrf=".length)) }, payload: { requestId, expectedRevision: 1, changes: { difficulty: "hard" } } });
  const patchMessage = await waitForSocketMessage(hostSocket, (payload) => payload.type === "settings.patch" && payload.operationId === requestId);
  assert.equal(patchMessage.serverId, "server-test");
  assert.notEqual(patchMessage.requestId, requestId);
  assert.equal((patchMessage.changes as Record<string, unknown>).difficulty, "hard");
  hostSocket.send(JSON.stringify({ type: "host.response", protocolVersion: 1, serverId: "server-test", requestId: patchMessage.requestId, ok: true, result: { requestId, serverId: "server-test", revision: 2, changedFields: ["difficulty"], settings: { serverId: "server-test", gameKind: "java", state: "stopped", revision: 2, fetchedAt: new Date().toISOString(), fields: { difficulty: "hard" }, capabilities: [], editable: true }, message: "ok" } }));
  const patched = await patchRequest;
  assert.equal(patched.statusCode, 200);
  assert.equal(JSON.stringify(patched.json()).includes("rootPath"), false);
  const relayAudit = relay.store instanceof MemoryRelayStore
    ? relay.store.relayAuditEntries("host-test", "server-test")
    : [];
  const patchAudit = relayAudit.find((entry) => entry.requestId === requestId);
  assert.deepEqual(patchAudit?.changedKeys, ["difficulty"]);
  assert.equal(JSON.stringify(patchAudit).includes("hard"), false);

  const operationQueryId = "operation-query-1234";
  relay.store.saveOperation({ requestId: operationQueryId, hostId: "host-test", serverId: "server-test", participantId: body.session.participantId, contentHash: "c".repeat(64), state: "running", updatedAt: new Date().toISOString() });
  const operationGetRequest = relay.app.inject({ method: "GET", url: `/api/v1/operations/${operationQueryId}`, headers: { origin, cookie: cookieHeader } });
  const operationGetMessage = await waitForSocketMessage(hostSocket, (payload) => payload.type === "operation.get" && payload.operationId === operationQueryId);
  hostSocket.send(JSON.stringify({ type: "host.response", protocolVersion: 1, serverId: "server-test", requestId: operationGetMessage.requestId, ok: true, result: { requestId: operationQueryId, state: "completed", result: { requestId: operationQueryId, serverId: "server-test", revision: 4, changedFields: ["difficulty"], settings: { serverId: "server-test", gameKind: "java", state: "stopped", revision: 4, fetchedAt: new Date().toISOString(), fields: { difficulty: "easy" }, capabilities: [], editable: true }, message: "queried-ok" } } }));
  const operationGetResponse = await operationGetRequest;
  assert.equal(operationGetResponse.statusCode, 200);
  assert.equal(operationGetResponse.json().operation.result.revision, 4);
  assert.equal(operationGetResponse.json().operation.result.state, undefined);

  const delayedRequestId = "request-timeout-1234";
  const delayedPatchRequest = relay.app.inject({ method: "PATCH", url: "/api/v1/servers/server-test/settings", headers: { origin, cookie: cookieHeader, "x-csrf-token": decodeURIComponent(cookies.find((value) => value.startsWith("msh_co_csrf="))!.split(";", 1)[0].slice("msh_co_csrf=".length)) }, payload: { requestId: delayedRequestId, expectedRevision: 2, changes: { difficulty: "normal" } } });
  const delayedPatchMessage = await waitForSocketMessage(hostSocket, (payload) => payload.type === "settings.patch" && payload.operationId === delayedRequestId);
  const busySettings = await relay.app.inject({ method: "GET", url: "/api/v1/servers/server-test/settings", headers: { origin, cookie: cookieHeader } });
  assert.equal(busySettings.statusCode, 503);
  assert.deepEqual(busySettings.json(), { error: "relay-busy" });
  setTimeout(() => {
    hostSocket.send(JSON.stringify({ type: "host.response", protocolVersion: 1, serverId: "server-test", requestId: delayedPatchMessage.requestId, ok: true, result: { requestId: delayedRequestId, serverId: "server-test", revision: 3, changedFields: ["difficulty"], settings: { serverId: "server-test", gameKind: "java", state: "stopped", revision: 3, fetchedAt: new Date().toISOString(), fields: { difficulty: "normal" }, capabilities: [], editable: true }, message: "delayed-ok" } }));
  }, 10_100);
  const timedOut = await delayedPatchRequest;
  assert.equal(timedOut.statusCode, 502);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const delayedOperation = await relay.app.inject({ method: "GET", url: `/api/v1/operations/${delayedRequestId}`, headers: { origin, cookie: cookieHeader } });
  assert.equal(delayedOperation.statusCode, 200);
  assert.equal(delayedOperation.json().operation.state, "completed");
  assert.equal(delayedOperation.json().operation.result.requestId, delayedRequestId);
  await new Promise<void>((resolve) => {
    hostSocket.once("close", () => resolve());
    hostSocket.close();
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(await relay.store.snapshot("host-test", "server-test"), undefined);
  assert.equal((await relay.store.sessionView(sessionId))?.state, "revoked");
  assert.equal(base.startsWith("http://127.0.0.1:0"), true);
});
