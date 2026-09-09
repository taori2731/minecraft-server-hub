import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { QueryResultRow } from "pg";
import { defaultMigrationsDirectory } from "./migrations.ts";
import {
  PostgresRelayMaintenance,
  PostgresRateLimiter,
  PostgresRelayStore,
  RelayStorageUnavailableError,
  type SqlConnection,
  type SqlPool,
} from "./postgres-store.ts";
import { RelayKeyring } from "./relay-crypto.ts";
import { hashRelaySecret } from "./store.ts";
import { createRelayServer } from "./server.ts";

class PGlitePool implements SqlPool {
  private connectionTail: Promise<void> = Promise.resolve();

  constructor(readonly database: PGlite) {}

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number }> {
    const result = await this.database.query<T>(sql, values as never[] | undefined);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  }

  async connect(): Promise<SqlConnection> {
    const previous = this.connectionTail;
    let release!: () => void;
    this.connectionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    return {
      query: this.query.bind(this),
      release,
    };
  }
}

class FaultInjectingPool implements SqlPool {
  private remainingFailures = 1;

  constructor(
    private readonly base: SqlPool,
    private readonly sqlFragment: string,
  ) {}

  private run<T>(sql: string, operation: () => Promise<T>): Promise<T> {
    if (this.remainingFailures > 0 && sql.includes(this.sqlFragment)) {
      this.remainingFailures -= 1;
      return Promise.reject(new Error("injected-database-failure"));
    }
    return operation();
  }

  query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> {
    return this.run(sql, () => this.base.query<T>(sql, values));
  }

  async connect(): Promise<SqlConnection> {
    const client = await this.base.connect();
    return {
      query: <T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => this.run(sql, () => client.query<T>(sql, values)),
      release: client.release?.bind(client),
    };
  }
}

class DeleteDenyingPool implements SqlPool {
  constructor(private readonly base: SqlPool) {}

  private rejectDelete(sql: string): void {
    if (/^\s*DELETE\b/iu.test(sql)) throw new Error("relay-role-delete-denied");
  }

  query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }> {
    this.rejectDelete(sql);
    return this.base.query<T>(sql, values);
  }

  async connect(): Promise<SqlConnection> {
    const client = await this.base.connect();
    return {
      query: <T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) => {
        this.rejectDelete(sql);
        return client.query<T>(sql, values);
      },
      release: client.release?.bind(client),
    };
  }
}

async function fixture(clock: () => Date = () => new Date("2026-09-08T00:00:00.000Z")) {
  const database = new PGlite();
  const migrationDirectory = defaultMigrationsDirectory();
  const migrations = (await readdir(migrationDirectory))
    .filter((name) => /^\d{3}_[a-z0-9_-]+\.sql$/u.test(name))
    .sort();
  for (const migration of migrations) {
    await database.exec(await readFile(`${migrationDirectory}/${migration}`, "utf8"));
  }
  const pool = new PGlitePool(database);
  const key = Buffer.alloc(32, 7).toString("base64url");
  const keyring = RelayKeyring.fromEnvironment(`test-v1:${key}`);
  return { database, pool, keyring, store: new PostgresRelayStore(pool, keyring, clock) };
}

test("PostgresRelayStore atomically redeems one invite and persists an approved session", async (t) => {
  const { database, store } = await fixture();
  t.after(async () => database.close());
  const token = "host-token-" + "a".repeat(40);
  const secret = "invite-secret-" + "b".repeat(40);
  await store.registerHost("host-test", token);
  await store.registerHost("host-test", token);
  await assert.rejects(() => store.registerHost("host-test", "other-token-" + "c".repeat(40)), /host-registration-conflict/u);
  await store.bindHostServer("host-test", "server-test");
  await store.registerInvite({
    inviteId: "invite-test",
    serverId: "server-test",
    hostId: "host-test",
    secretHash: hashRelaySecret(secret),
    role: "editor",
    expiresAt: "2026-09-08T00:10:00.000Z",
  });

  const attempts = await Promise.allSettled([
    store.redeemInvite(secret, "Takeru"),
    store.redeemInvite(secret, "Second"),
  ]);
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((item) => item.status === "rejected").length, 1);
  const redeemed = attempts.find((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof store.redeemInvite>>> => item.status === "fulfilled")!.value;
  assert.match(redeemed.session.joinCode, /^\d{6}$/u);
  assert.equal(await store.verifyCsrfForSession(redeemed.session.sessionId, redeemed.session.csrfToken), true);
  await store.approveParticipant("host-test", "server-test", redeemed.session.participantId);
  assert.equal((await store.sessionView(redeemed.session.sessionId))?.state, "approved");
});

test("PostgresRelayStore scopes idempotency and encrypts persisted operation results", async (t) => {
  const { database, store } = await fixture();
  t.after(async () => database.close());
  const token = "host-token-" + "a".repeat(40);
  const secret = "invite-secret-" + "b".repeat(40);
  await store.registerHost("host-test", token);
  await store.bindHostServer("host-test", "server-test");
  await store.registerInvite({ inviteId: "invite-test", serverId: "server-test", hostId: "host-test", secretHash: hashRelaySecret(secret), role: "editor", expiresAt: "2026-09-08T00:10:00.000Z" });
  const redeemed = await store.redeemInvite(secret, "Takeru");
  const operation = {
    requestId: "request-12345678",
    serverId: "server-test",
    hostId: "host-test",
    participantId: redeemed.session.participantId,
    contentHash: "d".repeat(64),
    state: "completed" as const,
    result: { status: "saved", syntheticSecret: "DO-NOT-PERSIST-PLAINTEXT" },
    updatedAt: "2026-09-08T00:01:00.000Z",
  };
  const audit = {
    hostId: operation.hostId,
    serverId: operation.serverId,
    actorId: operation.participantId,
    actorDisplayName: "Takeru",
    action: "settings.patch",
    changedKeys: ["maxPlayers"],
    result: "success" as const,
    requestId: operation.requestId,
    at: "2026-09-08T00:01:00.000Z",
  };
  await store.saveOperation(operation, audit);
  assert.deepEqual((await store.operation("host-test", "server-test", redeemed.session.participantId, operation.requestId))?.result, operation.result);
  await assert.rejects(
    () => store.saveOperation({ ...operation, contentHash: "e".repeat(64) }),
    /request-id-reused/u,
  );
  const raw = await database.query<{ encoded: string }>("SELECT encode(result_ciphertext, 'hex') AS encoded FROM co_management_operations");
  assert.equal(raw.rows[0].encoded.includes(Buffer.from("DO-NOT-PERSIST-PLAINTEXT").toString("hex")), false);
  const auditRows = await database.query<{ count: string; changed_keys: string[] }>("SELECT count(*)::text AS count, changed_keys FROM co_management_audit GROUP BY changed_keys");
  assert.equal(auditRows.rows[0].count, "1");
  assert.deepEqual(auditRows.rows[0].changed_keys, ["maxPlayers"]);
  await store.saveOperation(operation, audit);
  const auditCount = await database.query<{ count: string }>("SELECT count(*)::text AS count FROM co_management_audit");
  assert.equal(auditCount.rows[0].count, "1");
  await store.appendAudit({
    hostId: operation.hostId,
    serverId: operation.serverId,
    actorId: "host-test",
    actorDisplayName: "Host",
    action: "participant.approved",
    changedKeys: [],
    result: "success",
  });
  const nullRequestAudit = await database.query<{ count: string }>("SELECT count(*)::text AS count FROM co_management_audit WHERE request_id IS NULL");
  assert.equal(nullRequestAudit.rows[0].count, "1");
});

test("PostgresRelayStore rolls back every transaction step on injected failure", async (t) => {
  const { database, pool, keyring, store } = await fixture();
  t.after(async () => database.close());
  const token = "host-token-" + "a".repeat(40);
  const secret = "invite-secret-" + "b".repeat(40);
  await store.registerHost("host-test", token);
  await store.bindHostServer("host-test", "server-test");
  await store.setSnapshot("host-test", {
    serverId: "server-test", serverName: "Test", gameKind: "java", state: "stopped",
    playerCount: 0, maxPlayers: 20, fetchedAt: "2026-09-08T00:00:00.000Z", revision: 1, capabilities: [],
  });
  await store.registerInvite({
    inviteId: "invite-test", serverId: "server-test", hostId: "host-test",
    secretHash: hashRelaySecret(secret), role: "editor", expiresAt: "2026-09-08T00:10:00.000Z",
  });
  const redeemed = await store.redeemInvite(secret, "Takeru");

  const disconnectingStore = new PostgresRelayStore(
    new FaultInjectingPool(pool, "UPDATE co_management_invites"),
    keyring,
  );
  await assert.rejects(() => disconnectingStore.disconnectHost("host-test"), RelayStorageUnavailableError);
  assert.ok(await store.snapshot("host-test", "server-test"));
  assert.equal((await store.participant("host-test", redeemed.session.participantId))?.state, "pending");
  const inviteState = await database.query<{ used_at: string | null; revoked_at: string | null }>(
    "SELECT used_at::text, revoked_at::text FROM co_management_invites WHERE host_id = 'host-test' AND invite_id = 'invite-test'",
  );
  assert.ok(inviteState.rows[0].used_at);
  assert.equal(inviteState.rows[0].revoked_at, null);

  const record = {
    requestId: "request-rollback",
    serverId: "server-test",
    hostId: "host-test",
    participantId: redeemed.session.participantId,
    contentHash: "d".repeat(64),
    state: "completed" as const,
    result: { status: "saved" },
    updatedAt: "2026-09-08T00:01:00.000Z",
  };
  await assert.rejects(
    () => new PostgresRelayStore(new FaultInjectingPool(pool, "INSERT INTO co_management_audit"), keyring).saveOperation(record, {
      hostId: record.hostId,
      serverId: record.serverId,
      actorId: record.participantId,
      actorDisplayName: "Takeru",
      action: "settings.patch",
      changedKeys: ["maxPlayers"],
      result: "success",
      requestId: record.requestId,
      at: record.updatedAt,
    }),
    RelayStorageUnavailableError,
  );
  assert.equal(await store.operation(record.hostId, record.serverId, record.participantId, record.requestId), undefined);
  const auditRows = await database.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM co_management_audit WHERE request_id = 'request-rollback'",
  );
  assert.equal(auditRows.rows[0].count, "0");
});

test("PostgresRelayStore revokes sessions and snapshots without relay-role DELETE permission", async (t) => {
  const clock = () => new Date("2026-09-08T00:00:00.000Z");
  const { database, pool, keyring } = await fixture(clock);
  t.after(async () => database.close());
  const store = new PostgresRelayStore(new DeleteDenyingPool(pool), keyring, clock);
  const token = "host-token-" + "a".repeat(40);
  const firstSecret = "invite-secret-" + "b".repeat(40);
  await store.registerHost("host-test", token);
  await store.bindHostServer("host-test", "server-test");
  await store.registerInvite({
    inviteId: "invite-close", serverId: "server-test", hostId: "host-test",
    secretHash: hashRelaySecret(firstSecret), role: "viewer", expiresAt: "2026-09-08T00:10:00.000Z",
  });
  const first = await store.redeemInvite(firstSecret, "Close test");
  await store.closeSession(first.session.sessionId);
  assert.equal(await store.session(first.session.sessionId), undefined);
  assert.equal(await store.verifyCsrfForSession(first.session.sessionId, first.session.csrfToken), false);

  await store.setSnapshot("host-test", {
    serverId: "server-test", serverName: "Test", gameKind: "java", state: "stopped",
    playerCount: 0, maxPlayers: 24, fetchedAt: "2026-09-08T00:00:00.000Z", revision: 2, capabilities: [],
  });
  assert.equal((await store.snapshot("host-test", "server-test"))?.maxPlayers, 24);
  await store.disconnectHost("host-test");
  assert.equal(await store.snapshot("host-test", "server-test"), undefined);

  const retainedSession = await database.query<{ revoked_at: string | null }>(
    "SELECT revoked_at::text FROM co_management_sessions WHERE session_id = $1",
    [first.session.sessionId],
  );
  assert.ok(retainedSession.rows[0].revoked_at);
  const retainedSnapshot = await database.query<{ invalidated_at: string | null }>(
    "SELECT invalidated_at::text FROM co_management_snapshots WHERE host_id = 'host-test' AND server_id = 'server-test'",
  );
  assert.ok(retainedSnapshot.rows[0].invalidated_at);
  assert.equal((await store.participant("host-test", first.session.participantId))?.state, "revoked");

  await store.setSnapshot("host-test", {
    serverId: "server-test", serverName: "Reconnected", gameKind: "java", state: "running",
    playerCount: 1, maxPlayers: 24, fetchedAt: "2026-09-08T00:01:00.000Z", revision: 3, capabilities: [],
  });
  assert.equal((await store.snapshot("host-test", "server-test"))?.revision, 3);
});

test("PostgresRelayMaintenance applies audit expiry, newest-row caps, and rate-limit expiry", async (t) => {
  const { database, pool } = await fixture(() => new Date("2026-09-08T00:00:00.000Z"));
  t.after(async () => database.close());
  await database.exec(`
    INSERT INTO co_management_audit
      (host_id, server_id, actor_id, actor_display_name, action, changed_keys, result, request_id, at)
    SELECT 'host-retention', 'server-retention', 'participant-retention', 'Synthetic', 'settings.patch',
           ARRAY['maxPlayers'], 'success', 'retention-' || n,
           TIMESTAMPTZ '2026-09-07T00:00:00Z' + (n * INTERVAL '1 second')
    FROM generate_series(1, 10002) AS series(n);
  `);
  await database.exec(`
    INSERT INTO co_management_audit
      (host_id, server_id, actor_id, actor_display_name, action, changed_keys, result, request_id, at)
    VALUES ('host-retention', 'server-retention', 'participant-retention', 'Synthetic', 'settings.patch',
            ARRAY['maxPlayers'], 'success', 'retention-old', TIMESTAMPTZ '2026-01-01T00:00:00Z');
  `);
  await database.exec(`
    INSERT INTO co_management_rate_limits
      (identifier_hash, bucket_started_at, request_count, expires_at)
    VALUES (repeat('a', 64), TIMESTAMPTZ '2026-01-01T00:00:00Z', 1, TIMESTAMPTZ '2026-01-01T00:01:00Z');
  `);

  const maintenance = new PostgresRelayMaintenance(pool, () => new Date("2026-09-08T00:00:00.000Z"));
  assert.deepEqual(await maintenance.run(), {
    auditRowsDeleted: 3,
    rateLimitRowsDeleted: 1,
    sessionRowsDeleted: 0,
    participantRowsDeleted: 0,
    inviteRowsDeleted: 0,
    operationRowsDeleted: 0,
    snapshotRowsDeleted: 0,
    hostServerRowsDeleted: 0,
    hostRowsDeleted: 0,
  });
  const remainingAudit = await database.query<{ count: string; oldest: string }>(
    "SELECT count(*)::text AS count, min(at)::text AS oldest FROM co_management_audit WHERE host_id = 'host-retention' AND server_id = 'server-retention'",
  );
  assert.equal(remainingAudit.rows[0].count, "10000");
  assert.equal(new Date(remainingAudit.rows[0].oldest).toISOString(), "2026-09-07T00:00:03.000Z");
  const remainingOperations = await database.query<{ count: string }>("SELECT count(*)::text AS count FROM co_management_operations");
  assert.equal(remainingOperations.rows[0].count, "0");
});

test("PostgresRelayMaintenance removes expired lifecycle rows while retaining active and running state", async (t) => {
  const { database, pool } = await fixture(() => new Date("2026-09-08T00:00:00.000Z"));
  t.after(async () => database.close());
  await database.exec(`
    INSERT INTO co_management_hosts (host_id, token_hash, registered_at, last_seen_at)
    VALUES
      ('host-old', repeat('a', 64), TIMESTAMPTZ '2025-01-01T00:00:00Z', TIMESTAMPTZ '2025-01-01T00:00:00Z'),
      ('host-active', repeat('b', 64), TIMESTAMPTZ '2026-09-07T00:00:00Z', TIMESTAMPTZ '2026-09-08T00:00:00Z');
    INSERT INTO co_management_host_servers (host_id, server_id)
    VALUES ('host-old', 'server-old'), ('host-active', 'server-active');
    INSERT INTO co_management_invites
      (host_id, invite_id, server_id, secret_hash, role, issued_at, expires_at, used_at, revoked_at)
    VALUES ('host-old', 'invite-old', 'server-old', repeat('c', 64), 'viewer',
            TIMESTAMPTZ '2025-01-01T00:00:00Z', TIMESTAMPTZ '2025-01-02T00:00:00Z',
            TIMESTAMPTZ '2025-01-01T00:01:00Z', NULL);
    INSERT INTO co_management_participants
      (host_id, participant_id, server_id, display_name, role, state, join_code_hash,
       pending_expires_at, absolute_expires_at, created_at, approved_at, last_seen_at,
       last_interaction_at, last_polled_at)
    VALUES ('host-old', 'participant-old', 'server-old', 'Old', 'viewer', 'revoked', repeat('d', 64),
            TIMESTAMPTZ '2025-01-01T00:10:00Z', TIMESTAMPTZ '2025-01-02T00:00:00Z',
            TIMESTAMPTZ '2025-01-01T00:00:00Z', TIMESTAMPTZ '2025-01-01T00:02:00Z',
            TIMESTAMPTZ '2025-01-01T00:02:00Z', TIMESTAMPTZ '2025-01-01T00:02:00Z', NULL),
           ('host-active', 'participant-active', 'server-active', 'Active', 'viewer', 'approved', repeat('e', 64),
            TIMESTAMPTZ '2026-09-09T00:10:00Z', TIMESTAMPTZ '2026-09-10T00:00:00Z',
            TIMESTAMPTZ '2026-09-07T00:00:00Z', TIMESTAMPTZ '2026-09-07T00:01:00Z',
            TIMESTAMPTZ '2026-09-08T00:00:00Z', TIMESTAMPTZ '2026-09-08T00:00:00Z', NULL);
    INSERT INTO co_management_sessions
      (session_id, host_id, participant_id, csrf_token_hash, join_code_ciphertext, key_id,
       absolute_expires_at, idle_expires_at, created_at, last_seen_at, last_interaction_at, last_polled_at, revoked_at)
    VALUES ('session-old', 'host-old', 'participant-old', repeat('f', 64), decode('00', 'hex'), 'test-v1',
            TIMESTAMPTZ '2025-01-02T00:00:00Z', TIMESTAMPTZ '2025-01-02T00:00:00Z',
            TIMESTAMPTZ '2025-01-01T00:00:00Z', TIMESTAMPTZ '2025-01-01T00:01:00Z',
            TIMESTAMPTZ '2025-01-01T00:01:00Z', NULL, NULL),
           ('session-active', 'host-active', 'participant-active', repeat('0', 64), decode('00', 'hex'), 'test-v1',
            TIMESTAMPTZ '2026-09-10T00:00:00Z', TIMESTAMPTZ '2026-09-09T00:00:00Z',
            TIMESTAMPTZ '2026-09-07T00:00:00Z', TIMESTAMPTZ '2026-09-08T00:00:00Z',
            TIMESTAMPTZ '2026-09-08T00:00:00Z', NULL, NULL),
           ('session-revoked', 'host-active', 'participant-active', repeat('1', 64), decode('00', 'hex'), 'test-v1',
            TIMESTAMPTZ '2026-09-10T00:00:00Z', TIMESTAMPTZ '2026-09-09T00:00:00Z',
            TIMESTAMPTZ '2026-01-01T00:00:00Z', TIMESTAMPTZ '2026-01-01T00:00:00Z',
            TIMESTAMPTZ '2026-01-01T00:00:00Z', NULL, TIMESTAMPTZ '2026-01-01T00:00:00Z');
    INSERT INTO co_management_operations
      (host_id, server_id, participant_id, request_id, state, content_hash, result_ciphertext, key_id,
       error_code, created_at, updated_at)
    VALUES ('host-old', 'server-old', 'participant-old', 'operation-old', 'completed', NULL, NULL, NULL,
            NULL, TIMESTAMPTZ '2025-01-01T00:00:00Z', TIMESTAMPTZ '2025-01-01T00:03:00Z'),
           ('host-active', 'server-active', 'participant-active', 'operation-running', 'running', NULL, NULL, NULL,
            NULL, TIMESTAMPTZ '2026-09-08T00:00:00Z', TIMESTAMPTZ '2026-09-08T00:00:00Z');
    INSERT INTO co_management_snapshots (host_id, server_id, snapshot, updated_at, invalidated_at)
    VALUES ('host-old', 'server-old', '{}'::jsonb, TIMESTAMPTZ '2025-01-01T00:00:00Z', NULL),
           ('host-active', 'server-active', '{}'::jsonb, TIMESTAMPTZ '2026-01-01T00:00:00Z',
            TIMESTAMPTZ '2026-01-01T00:00:00Z');
  `);

  const maintenance = new PostgresRelayMaintenance(pool, () => new Date("2026-09-08T00:00:00.000Z"));
  assert.deepEqual(await maintenance.run(), {
    auditRowsDeleted: 0,
    rateLimitRowsDeleted: 0,
    sessionRowsDeleted: 2,
    participantRowsDeleted: 1,
    inviteRowsDeleted: 1,
    operationRowsDeleted: 1,
    snapshotRowsDeleted: 2,
    hostServerRowsDeleted: 1,
    hostRowsDeleted: 1,
  });
  assert.equal((await database.query<{ count: string }>("SELECT count(*)::text AS count FROM co_management_hosts WHERE host_id = 'host-old'")).rows[0].count, "0");
  assert.equal((await database.query<{ count: string }>("SELECT count(*)::text AS count FROM co_management_hosts WHERE host_id = 'host-active'")).rows[0].count, "1");
  assert.equal((await database.query<{ count: string }>("SELECT count(*)::text AS count FROM co_management_sessions WHERE session_id = 'session-active'")).rows[0].count, "1");
  assert.equal((await database.query<{ count: string }>("SELECT count(*)::text AS count FROM co_management_operations WHERE request_id = 'operation-running'")).rows[0].count, "1");
});

test("PostgresRateLimiter shares counters and storage failures fail closed", async (t) => {
  const { database, pool } = await fixture();
  t.after(async () => database.close());
  const first = new PostgresRateLimiter(pool, () => new Date("2026-09-08T00:00:05.000Z"));
  const second = new PostgresRateLimiter(pool, () => new Date("2026-09-08T00:00:10.000Z"));
  assert.equal(await first.consume("client-a", 3, 60_000), true);
  assert.equal(await second.consume("client-a", 3, 60_000), true);
  assert.equal(await first.consume("client-a", 3, 60_000), true);
  assert.equal(await second.consume("client-a", 3, 60_000), false);

  const failingPool: SqlPool = {
    async query() { throw new Error("connection-lost"); },
    async connect() { throw new Error("connection-lost"); },
  };
  const relay = createRelayServer({
    rateLimiter: new PostgresRateLimiter(failingPool),
    allowedOrigins: ["https://staging.cohostrelay.online"],
  });
  t.after(async () => relay.close());
  const response = await relay.app.inject({ method: "GET", url: "/api/v1/session", headers: { origin: "https://staging.cohostrelay.online" } });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "relay-storage-unavailable" });
  await assert.rejects(() => new PostgresRelayStore(failingPool, RelayKeyring.fromEnvironment(`test-v1:${Buffer.alloc(32, 9).toString("base64url")}`)).hasHost("host-test"), RelayStorageUnavailableError);
  await assert.rejects(() => new PostgresRelayMaintenance(failingPool).run(), RelayStorageUnavailableError);
});
