import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

async function fixture(clock: () => Date = () => new Date("2026-09-08T00:00:00.000Z")) {
  const database = new PGlite();
  const migration = await readFile(defaultMigrationsDirectory() + "/001_initial.sql", "utf8");
  const auditMigration = await readFile(defaultMigrationsDirectory() + "/002_audit_idempotency.sql", "utf8");
  await database.exec(migration);
  await database.exec(auditMigration);
  const pool = new PGlitePool(database);
  const key = Buffer.alloc(32, 7).toString("base64url");
  const keyring = RelayKeyring.fromEnvironment(`test-v1:${key}`);
  return { database, pool, store: new PostgresRelayStore(pool, keyring, clock) };
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

test("PostgresRelayMaintenance retains the newest audit rows per server and only deletes expired rate limits", async (t) => {
  const { database, pool } = await fixture(() => new Date("2026-09-08T00:00:00.000Z"));
  t.after(async () => database.close());
  await database.exec(`
    INSERT INTO co_management_audit
      (host_id, server_id, actor_id, actor_display_name, action, changed_keys, result, request_id, at)
    SELECT 'host-retention', 'server-retention', 'participant-retention', 'Synthetic', 'settings.patch',
           ARRAY['maxPlayers'], 'success', 'retention-' || n,
           TIMESTAMPTZ '2026-01-01T00:00:00Z' + (n * INTERVAL '1 second')
    FROM generate_series(1, 10002) AS series(n);
  `);
  await database.exec(`
    INSERT INTO co_management_rate_limits
      (identifier_hash, bucket_started_at, request_count, expires_at)
    VALUES (repeat('a', 64), TIMESTAMPTZ '2026-01-01T00:00:00Z', 1, TIMESTAMPTZ '2026-01-01T00:01:00Z');
  `);

  const maintenance = new PostgresRelayMaintenance(pool, () => new Date("2026-09-08T00:00:00.000Z"));
  assert.deepEqual(await maintenance.run(), { auditRowsDeleted: 2, rateLimitRowsDeleted: 1 });
  const remainingAudit = await database.query<{ count: string; oldest: string }>(
    "SELECT count(*)::text AS count, min(at)::text AS oldest FROM co_management_audit WHERE host_id = 'host-retention' AND server_id = 'server-retention'",
  );
  assert.equal(remainingAudit.rows[0].count, "10000");
  assert.equal(new Date(remainingAudit.rows[0].oldest).toISOString(), "2026-01-01T00:00:03.000Z");
  const remainingOperations = await database.query<{ count: string }>("SELECT count(*)::text AS count FROM co_management_operations");
  assert.equal(remainingOperations.rows[0].count, "0");
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
