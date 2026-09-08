import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { WebSocket } from "ws";
import { assertRelayRuntimeConfiguration, configuredPort, createRelayServer } from "./server.ts";
import { MemoryRelayStore, SESSION_ABSOLUTE_MS, SESSION_IDLE_MS, hashRelaySecret } from "./store.ts";
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

test("relay bridges a host WebSocket request without exposing host-only fields", async (t) => {
  const relay = createRelayServer({ secureCookies: false, allowedOrigins: [origin] });
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
