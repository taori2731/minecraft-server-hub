import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { QueryResultRow } from "pg";
import type { PublicServerSnapshot, SessionView } from "../../shared/protocol.ts";
import { RelayKeyring } from "./relay-crypto.ts";
import {
  AUDIT_MAX_ROWS_PER_SCOPE,
  AUDIT_RETENTION_MS,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  type InviteRecord,
  type OperationRecord,
  type ParticipantRecord,
  type RedeemedInvite,
  type RelayAuditInput,
  type RelayAuditRecord,
  type RelayStore,
  type SessionRecord,
  normalizeAudit,
} from "./store.ts";

export interface SqlConnection {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]): Promise<{
    rows: T[];
    rowCount: number | null;
  }>;
  release?(): void;
}

export interface SqlPool extends SqlConnection {
  connect(): Promise<SqlConnection>;
}

export class RelayStorageUnavailableError extends Error {
  constructor(public readonly cause?: unknown) {
    super("relay-storage-unavailable");
  }
}

interface SessionRow extends QueryResultRow {
  session_id: string;
  host_id: string;
  participant_id: string;
  server_id: string;
  display_name: string;
  role: "viewer" | "editor";
  state: "pending" | "approved" | "revoked";
  join_code_hash: string;
  join_code_ciphertext: Buffer | Uint8Array;
  pending_expires_at: string | Date;
  absolute_expires_at: string | Date;
  created_at: string | Date;
  approved_at: string | Date | null;
  last_seen_at: string | Date;
  last_interaction_at: string | Date;
  last_polled_at: string | Date | null;
  snapshot: PublicServerSnapshot | null;
}

interface ParticipantRow extends QueryResultRow {
  participant_id: string;
  server_id: string;
  host_id: string;
  display_name: string;
  role: "viewer" | "editor";
  state: "pending" | "approved" | "revoked";
  join_code_hash: string;
  pending_expires_at: string | Date;
  absolute_expires_at: string | Date;
  created_at: string | Date;
  approved_at: string | Date | null;
  last_seen_at: string | Date;
  last_interaction_at: string | Date;
  last_polled_at: string | Date | null;
}

interface OperationRow extends QueryResultRow {
  request_id: string;
  server_id: string;
  host_id: string;
  participant_id: string;
  content_hash: string | null;
  state: "running" | "completed" | "failed";
  result_ciphertext: Buffer | Uint8Array | null;
  error_code: string | null;
  updated_at: string | Date;
}

const STORE_ERRORS = new Set([
  "host-registration-conflict",
  "host-not-registered",
  "host-server-not-bound",
  "invalid-secret-hash",
  "invite-expired",
  "invite-id-conflict",
  "invite-invalid-or-expired",
  "invalid-display-name",
  "participant-not-found",
  "participant-expired",
  "session-not-authorized",
  "editor-required",
  "snapshot-too-large",
  "request-id-reused",
  "invalid-audit-entry",
  "relay-key-unavailable",
  "relay-ciphertext-invalid",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function randomId(prefix: string): string {
  return prefix + "-" + randomBytes(16).toString("hex");
}

function sixDigitCode(): string {
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function optionalIso(value: string | Date | null): string | undefined {
  return value === null ? undefined : iso(value);
}

function asBuffer(value: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

async function insertAudit(client: SqlConnection, entry: RelayAuditRecord): Promise<void> {
  await client.query(
    `INSERT INTO co_management_audit
       (host_id, server_id, actor_id, actor_display_name, action, changed_keys, result, request_id, at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (host_id, server_id, action, request_id) WHERE request_id IS NOT NULL DO NOTHING`,
    [entry.hostId, entry.serverId, entry.actorId, entry.actorDisplayName, entry.action, entry.changedKeys, entry.result, entry.requestId ?? null, entry.at],
  );
}

function participantFromRow(row: ParticipantRow): ParticipantRecord {
  return {
    participantId: row.participant_id,
    serverId: row.server_id,
    hostId: row.host_id,
    displayName: row.display_name,
    role: row.role,
    state: row.state,
    joinCodeHash: row.join_code_hash,
    pendingExpiresAt: iso(row.pending_expires_at),
    expiresAt: iso(row.absolute_expires_at),
    createdAt: iso(row.created_at),
    approvedAt: optionalIso(row.approved_at),
    lastSeenAt: iso(row.last_seen_at),
    lastInteractionAt: iso(row.last_interaction_at),
    lastPolledAt: optionalIso(row.last_polled_at),
  };
}

export class PostgresRelayStore implements RelayStore {
  constructor(
    private readonly pool: SqlPool,
    private readonly keyring: RelayKeyring,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private now(): string {
    return this.clock().toISOString();
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof RelayStorageUnavailableError) throw error;
      if (error instanceof Error && STORE_ERRORS.has(error.message)) throw error;
      throw new RelayStorageUnavailableError(error);
    }
  }

  private async transaction<T>(operation: (client: SqlConnection) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // The original failure is more useful and is converted by run().
      }
      throw error;
    } finally {
      client.release?.();
    }
  }

  async registerHost(hostId: string, token: string): Promise<void> {
    await this.run(async () => {
      const timestamp = this.now();
      const result = await this.pool.query<{ token_hash: string }>(
        `INSERT INTO co_management_hosts (host_id, token_hash, registered_at, last_seen_at)
         VALUES ($1, $2, $3, $3)
         ON CONFLICT (host_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at
         WHERE co_management_hosts.token_hash = EXCLUDED.token_hash
         RETURNING token_hash`,
        [hostId, sha256(token), timestamp],
      );
      if (result.rowCount !== 1) throw new Error("host-registration-conflict");
    });
  }

  async verifyHost(hostId: string, token: string): Promise<boolean> {
    return this.run(async () => {
      const result = await this.pool.query<{ token_hash: string }>(
        "SELECT token_hash FROM co_management_hosts WHERE host_id = $1",
        [hostId],
      );
      const valid = result.rows[0]
        ? constantTimeEqual(result.rows[0].token_hash.trim(), sha256(token))
        : false;
      if (valid) {
        await this.pool.query("UPDATE co_management_hosts SET last_seen_at = $2 WHERE host_id = $1", [hostId, this.now()]);
      }
      return valid;
    });
  }

  async hasHost(hostId: string): Promise<boolean> {
    return this.run(async () => {
      const result = await this.pool.query("SELECT 1 FROM co_management_hosts WHERE host_id = $1", [hostId]);
      return result.rowCount === 1;
    });
  }

  async bindHostServer(hostId: string, serverId: string): Promise<void> {
    await this.run(async () => {
      const result = await this.pool.query(
        `INSERT INTO co_management_host_servers (host_id, server_id)
         SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM co_management_hosts WHERE host_id = $1)
         ON CONFLICT DO NOTHING
         RETURNING host_id`,
        [hostId, serverId],
      );
      if (result.rowCount !== 1) {
        const exists = await this.hostOwnsServer(hostId, serverId);
        if (!exists) throw new Error("host-not-registered");
      }
    });
  }

  async hostOwnsServer(hostId: string, serverId: string): Promise<boolean> {
    return this.run(async () => {
      const result = await this.pool.query(
        "SELECT 1 FROM co_management_host_servers WHERE host_id = $1 AND server_id = $2",
        [hostId, serverId],
      );
      return result.rowCount === 1;
    });
  }

  async registerInvite(input: Omit<InviteRecord, "issuedAt"> & { issuedAt?: string }): Promise<void> {
    await this.run(async () => {
      if (!/^[a-f0-9]{64}$/iu.test(input.secretHash)) throw new Error("invalid-secret-hash");
      const issuedAt = input.issuedAt ?? this.now();
      if (Date.parse(input.expiresAt) <= this.clock().getTime()) throw new Error("invite-expired");
      const result = await this.pool.query(
        `INSERT INTO co_management_invites
           (host_id, invite_id, server_id, secret_hash, role, issued_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (host_id, invite_id) DO UPDATE SET issued_at = co_management_invites.issued_at
         WHERE co_management_invites.server_id = EXCLUDED.server_id
           AND co_management_invites.secret_hash = EXCLUDED.secret_hash
           AND co_management_invites.role = EXCLUDED.role
           AND co_management_invites.expires_at = EXCLUDED.expires_at
         RETURNING invite_id`,
        [input.hostId, input.inviteId, input.serverId, input.secretHash.toLowerCase(), input.role, issuedAt, input.expiresAt],
      );
      if (result.rowCount !== 1) throw new Error("invite-id-conflict");
    });
  }

  async redeemInvite(secret: string, displayName: string): Promise<RedeemedInvite> {
    return this.run(async () => {
      const normalizedName = displayName.trim();
      if (normalizedName.length === 0 || normalizedName.length > 32 || /[\u0000-\u001f\u007f]/u.test(normalizedName)) {
        throw new Error("invalid-display-name");
      }
      return this.transaction(async (client) => {
        const timestamp = this.now();
        const inviteResult = await client.query<{
          host_id: string;
          invite_id: string;
          server_id: string;
          role: "viewer" | "editor";
          expires_at: string | Date;
        }>(
          `SELECT host_id, invite_id, server_id, role, expires_at
           FROM co_management_invites
           WHERE secret_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > $2
           FOR UPDATE SKIP LOCKED
           LIMIT 1`,
          [sha256(secret), timestamp],
        );
        const invite = inviteResult.rows[0];
        if (!invite) throw new Error("invite-invalid-or-expired");

        const participantId = randomId("participant");
        const sessionId = randomId("session");
        const csrfToken = randomBytes(32).toString("base64url");
        const joinCode = sixDigitCode();
        const absoluteExpiresAt = new Date(this.clock().getTime() + SESSION_ABSOLUTE_MS).toISOString();
        const idleExpiresAt = new Date(this.clock().getTime() + SESSION_IDLE_MS).toISOString();
        const joinCiphertext = this.keyring.encrypt(joinCode);

        const used = await client.query(
          `UPDATE co_management_invites SET used_at = $3
           WHERE host_id = $1 AND invite_id = $2 AND used_at IS NULL AND revoked_at IS NULL
           RETURNING invite_id`,
          [invite.host_id, invite.invite_id, timestamp],
        );
        if (used.rowCount !== 1) throw new Error("invite-invalid-or-expired");

        await client.query(
          `INSERT INTO co_management_participants
             (host_id, participant_id, server_id, display_name, role, state, join_code_hash,
              pending_expires_at, absolute_expires_at, created_at, last_seen_at, last_interaction_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $9, $9)`,
          [invite.host_id, participantId, invite.server_id, normalizedName, invite.role, sha256(joinCode), iso(invite.expires_at), absoluteExpiresAt, timestamp],
        );
        await client.query(
          `INSERT INTO co_management_sessions
             (session_id, host_id, participant_id, csrf_token_hash, join_code_ciphertext, key_id,
              absolute_expires_at, idle_expires_at, created_at, last_seen_at, last_interaction_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $9)`,
          [sessionId, invite.host_id, participantId, sha256(csrfToken), joinCiphertext, this.keyring.activeKeyId(), absoluteExpiresAt, idleExpiresAt, timestamp],
        );

        const participant: ParticipantRecord = {
          participantId,
          serverId: invite.server_id,
          hostId: invite.host_id,
          displayName: normalizedName,
          role: invite.role,
          state: "pending",
          joinCodeHash: sha256(joinCode),
          pendingExpiresAt: iso(invite.expires_at),
          expiresAt: absoluteExpiresAt,
          createdAt: timestamp,
          lastSeenAt: timestamp,
          lastInteractionAt: timestamp,
        };
        const session: SessionRecord = { ...participant, sessionId, csrfToken, joinCode };
        return {
          session,
          pendingEvent: {
            type: "participant.pending",
            protocolVersion: 1,
            serverId: invite.server_id,
            participantId,
            displayName: normalizedName,
            role: invite.role,
            joinCode,
            expiresAt: iso(invite.expires_at),
          },
        };
      });
    });
  }

  private async sessionRow(sessionId: string, touch: boolean): Promise<SessionRow | undefined> {
    const timestamp = this.now();
    const result = await this.pool.query<SessionRow>(
      `SELECT s.session_id, s.host_id, s.participant_id, p.server_id, p.display_name, p.role, p.state,
              p.join_code_hash, s.join_code_ciphertext, p.pending_expires_at, s.absolute_expires_at,
              s.created_at, p.approved_at, s.last_seen_at, s.last_interaction_at, s.last_polled_at,
              sn.snapshot
       FROM co_management_sessions s
       JOIN co_management_participants p ON p.host_id = s.host_id AND p.participant_id = s.participant_id
       LEFT JOIN co_management_snapshots sn ON sn.host_id = p.host_id AND sn.server_id = p.server_id
       WHERE s.session_id = $1`,
      [sessionId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const expired = this.clock().getTime() >= Date.parse(iso(row.absolute_expires_at))
      || this.clock().getTime() >= Date.parse(iso(row.last_interaction_at)) + SESSION_IDLE_MS;
    if (expired) {
      await this.pool.query(
        "UPDATE co_management_participants SET state = 'revoked', last_seen_at = $3 WHERE host_id = $1 AND participant_id = $2",
        [row.host_id, row.participant_id, timestamp],
      );
      row.state = "revoked";
      return row;
    }
    if (touch) {
      await this.pool.query(
        `UPDATE co_management_sessions SET last_seen_at = $2, last_interaction_at = $2, idle_expires_at = $3
         WHERE session_id = $1`,
        [sessionId, timestamp, new Date(this.clock().getTime() + SESSION_IDLE_MS).toISOString()],
      );
      await this.pool.query(
        `UPDATE co_management_participants SET last_seen_at = $3, last_interaction_at = $3
         WHERE host_id = $1 AND participant_id = $2`,
        [row.host_id, row.participant_id, timestamp],
      );
      row.last_seen_at = timestamp;
      row.last_interaction_at = timestamp;
    } else {
      await this.pool.query("UPDATE co_management_sessions SET last_polled_at = $2 WHERE session_id = $1", [sessionId, timestamp]);
      row.last_polled_at = timestamp;
    }
    return row;
  }

  async session(sessionId: string, touch = false): Promise<SessionRecord | undefined> {
    return this.run(async () => {
      const row = await this.sessionRow(sessionId, touch);
      if (!row) return undefined;
      const participant = participantFromRow(row);
      return {
        ...participant,
        sessionId: row.session_id,
        csrfToken: "",
        joinCode: this.keyring.decrypt(asBuffer(row.join_code_ciphertext)),
      };
    });
  }

  async sessionView(sessionId: string, touch = false): Promise<SessionView | undefined> {
    return this.run(async () => {
      const row = await this.sessionRow(sessionId, touch);
      if (!row) return undefined;
      const expired = this.clock().getTime() >= Date.parse(iso(row.absolute_expires_at))
        || this.clock().getTime() >= Date.parse(iso(row.last_interaction_at)) + SESSION_IDLE_MS;
      const view: SessionView = {
        state: expired ? "expired" : row.state,
        participantId: row.participant_id,
        serverId: row.server_id,
        role: row.role,
        displayName: row.display_name,
        expiresAt: iso(row.absolute_expires_at),
      };
      if (view.state === "pending") view.joinCode = this.keyring.decrypt(asBuffer(row.join_code_ciphertext));
      if (view.state === "approved" && row.snapshot) view.server = structuredClone(row.snapshot);
      return view;
    });
  }

  async verifyCsrfForSession(sessionId: string, csrfToken: string): Promise<boolean> {
    return this.run(async () => {
      const result = await this.pool.query<{ csrf_token_hash: string; absolute_expires_at: string | Date; last_interaction_at: string | Date }>(
        `SELECT csrf_token_hash, absolute_expires_at, last_interaction_at
         FROM co_management_sessions WHERE session_id = $1`,
        [sessionId],
      );
      const row = result.rows[0];
      if (!row) return false;
      const current = this.clock().getTime();
      if (current >= Date.parse(iso(row.absolute_expires_at)) || current >= Date.parse(iso(row.last_interaction_at)) + SESSION_IDLE_MS) return false;
      return constantTimeEqual(row.csrf_token_hash.trim(), sha256(csrfToken));
    });
  }

  async approveParticipant(hostId: string, serverId: string, participantId: string): Promise<void> {
    await this.run(async () => {
      const timestamp = this.now();
      const result = await this.pool.query(
        `UPDATE co_management_participants
         SET state = 'approved', approved_at = COALESCE(approved_at, $4), last_seen_at = $4
         WHERE host_id = $1 AND server_id = $2 AND participant_id = $3 AND pending_expires_at > $4
         RETURNING participant_id`,
        [hostId, serverId, participantId, timestamp],
      );
      if (result.rowCount === 1) return;
      const participant = await this.participant(hostId, participantId);
      if (!participant || participant.serverId !== serverId) throw new Error("participant-not-found");
      await this.revokeParticipant(hostId, serverId, participantId);
      throw new Error("participant-expired");
    });
  }

  async revokeParticipant(hostId: string, serverId: string, participantId: string): Promise<void> {
    await this.run(async () => {
      const result = await this.pool.query(
        `UPDATE co_management_participants SET state = 'revoked', last_seen_at = $4
         WHERE host_id = $1 AND server_id = $2 AND participant_id = $3 RETURNING participant_id`,
        [hostId, serverId, participantId, this.now()],
      );
      if (result.rowCount !== 1) throw new Error("participant-not-found");
    });
  }

  async participant(hostId: string, participantId: string): Promise<ParticipantRecord | undefined> {
    return this.run(async () => {
      const result = await this.pool.query<ParticipantRow>(
        `SELECT participant_id, server_id, host_id, display_name, role, state, join_code_hash,
                pending_expires_at, absolute_expires_at, created_at, approved_at, last_seen_at,
                last_interaction_at, last_polled_at
         FROM co_management_participants WHERE host_id = $1 AND participant_id = $2`,
        [hostId, participantId],
      );
      return result.rows[0] ? participantFromRow(result.rows[0]) : undefined;
    });
  }

  async authorize(sessionId: string, serverId: string, requiredRole: "viewer" | "editor" = "viewer", touch = false): Promise<SessionRecord> {
    return this.run(async () => {
      const session = await this.session(sessionId, touch);
      if (!session || session.serverId !== serverId || session.state !== "approved") throw new Error("session-not-authorized");
      const current = this.clock().getTime();
      if (current >= Date.parse(session.expiresAt) || current >= Date.parse(session.lastInteractionAt) + SESSION_IDLE_MS) {
        throw new Error("session-not-authorized");
      }
      if (requiredRole === "editor" && session.role !== "editor") throw new Error("editor-required");
      return session;
    });
  }

  async setSnapshot(hostId: string, snapshot: PublicServerSnapshot): Promise<void> {
    await this.run(async () => {
      if (JSON.stringify(snapshot).length > 64 * 1024) throw new Error("snapshot-too-large");
      await this.pool.query(
        `INSERT INTO co_management_snapshots (host_id, server_id, snapshot, updated_at)
         VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (host_id, server_id)
         DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = EXCLUDED.updated_at`,
        [hostId, snapshot.serverId, JSON.stringify(snapshot), this.now()],
      );
    });
  }

  async snapshot(hostId: string, serverId: string): Promise<PublicServerSnapshot | undefined> {
    return this.run(async () => {
      const result = await this.pool.query<{ snapshot: PublicServerSnapshot }>(
        "SELECT snapshot FROM co_management_snapshots WHERE host_id = $1 AND server_id = $2",
        [hostId, serverId],
      );
      return result.rows[0]?.snapshot ? structuredClone(result.rows[0].snapshot) : undefined;
    });
  }

  private operationFromRow(row: OperationRow): OperationRecord {
    let result: unknown;
    if (row.result_ciphertext) result = JSON.parse(this.keyring.decrypt(asBuffer(row.result_ciphertext)));
    return {
      requestId: row.request_id,
      serverId: row.server_id,
      hostId: row.host_id,
      participantId: row.participant_id,
      contentHash: row.content_hash?.trim() || undefined,
      state: row.state,
      result,
      errorCode: row.error_code ?? undefined,
      updatedAt: iso(row.updated_at),
    };
  }

  async saveOperation(record: OperationRecord, audit?: RelayAuditInput): Promise<OperationRecord> {
    return this.run(async () => this.transaction(async (client) => {
      const existingResult = await client.query<OperationRow>(
        `SELECT request_id, server_id, host_id, participant_id, content_hash, state,
                result_ciphertext, error_code, updated_at
         FROM co_management_operations
         WHERE host_id = $1 AND server_id = $2 AND participant_id = $3 AND request_id = $4
         FOR UPDATE`,
        [record.hostId, record.serverId, record.participantId, record.requestId],
      );
      const existing = existingResult.rows[0];
      if (existing?.content_hash && record.contentHash && !constantTimeEqual(existing.content_hash.trim(), record.contentHash)) {
        throw new Error("request-id-reused");
      }
      if (existing && existing.state !== "running" && record.state === "running") return this.operationFromRow(existing);
      const contentHash = record.contentHash ?? existing?.content_hash?.trim() ?? null;
      const resultCiphertext = record.result === undefined ? null : this.keyring.encrypt(JSON.stringify(record.result));
      const keyId = resultCiphertext ? this.keyring.activeKeyId() : null;
      const timestamp = record.updatedAt || this.now();
      const saved = await client.query<OperationRow>(
        `INSERT INTO co_management_operations
           (host_id, server_id, participant_id, request_id, state, content_hash,
            result_ciphertext, key_id, error_code, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         ON CONFLICT (host_id, server_id, participant_id, request_id)
         DO UPDATE SET state = EXCLUDED.state,
                       content_hash = COALESCE(co_management_operations.content_hash, EXCLUDED.content_hash),
                       result_ciphertext = EXCLUDED.result_ciphertext,
                       key_id = EXCLUDED.key_id,
                       error_code = EXCLUDED.error_code,
                       updated_at = EXCLUDED.updated_at
         RETURNING request_id, server_id, host_id, participant_id, content_hash, state,
                   result_ciphertext, error_code, updated_at`,
        [record.hostId, record.serverId, record.participantId, record.requestId, record.state, contentHash, resultCiphertext, keyId, record.errorCode ?? null, timestamp],
      );
      if (audit && record.state !== "running") {
        await insertAudit(client, normalizeAudit(audit, timestamp));
      }
      return this.operationFromRow(saved.rows[0]);
    }));
  }

  async operation(hostId: string, serverId: string, participantId: string, requestId: string): Promise<OperationRecord | undefined> {
    return this.run(async () => {
      const result = await this.pool.query<OperationRow>(
        `SELECT request_id, server_id, host_id, participant_id, content_hash, state,
                result_ciphertext, error_code, updated_at
         FROM co_management_operations
         WHERE host_id = $1 AND server_id = $2 AND participant_id = $3 AND request_id = $4`,
        [hostId, serverId, participantId, requestId],
      );
      return result.rows[0] ? this.operationFromRow(result.rows[0]) : undefined;
    });
  }

  async appendAudit(entry: RelayAuditInput): Promise<void> {
    await this.run(async () => {
      await insertAudit(this.pool, normalizeAudit(entry, this.now()));
    });
  }

  async disconnectHost(hostId: string): Promise<void> {
    await this.run(async () => this.transaction(async (client) => {
      const timestamp = this.now();
      await client.query("DELETE FROM co_management_snapshots WHERE host_id = $1", [hostId]);
      await client.query("UPDATE co_management_participants SET state = 'revoked', last_seen_at = $2 WHERE host_id = $1", [hostId, timestamp]);
      await client.query(
        "UPDATE co_management_invites SET revoked_at = $2 WHERE host_id = $1 AND used_at IS NULL AND revoked_at IS NULL",
        [hostId, timestamp],
      );
    }));
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.run(async () => {
      await this.pool.query("DELETE FROM co_management_sessions WHERE session_id = $1", [sessionId]);
    });
  }
}

export interface SharedRateLimiter {
  consume(identifier: string, limit: number, windowMs: number): Promise<boolean>;
}

export interface RelayMaintenanceResult {
  auditRowsDeleted: number;
  rateLimitRowsDeleted: number;
}

/**
 * Destructive retention work is deliberately separated from the application
 * store. Run this with a maintenance-only database role; the relay role only
 * needs the INSERT/SELECT permissions used during request handling.
 */
export class PostgresRelayMaintenance {
  constructor(
    private readonly pool: SqlPool,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async run(): Promise<RelayMaintenanceResult> {
    try {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const now = this.clock();
        const auditResult = await client.query(
          `WITH ranked AS (
             SELECT audit_id, at,
                    row_number() OVER (
                      PARTITION BY host_id, server_id
                      ORDER BY at DESC, audit_id DESC
                    ) AS row_number
             FROM co_management_audit
           )
           DELETE FROM co_management_audit audit
           USING ranked
           WHERE audit.audit_id = ranked.audit_id
             AND ranked.row_number > $2
             AND ranked.at < $1`,
          [new Date(now.getTime() - AUDIT_RETENTION_MS).toISOString(), AUDIT_MAX_ROWS_PER_SCOPE],
        );
        const rateLimitResult = await client.query(
          "DELETE FROM co_management_rate_limits WHERE expires_at <= $1",
          [now.toISOString()],
        );
        await client.query("COMMIT");
        return {
          auditRowsDeleted: auditResult.rowCount ?? 0,
          rateLimitRowsDeleted: rateLimitResult.rowCount ?? 0,
        };
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // Preserve the original failure; the caller will stop the job.
        }
        throw error;
      } finally {
        client.release?.();
      }
    } catch (error) {
      throw new RelayStorageUnavailableError(error);
    }
  }
}

export class PostgresRateLimiter implements SharedRateLimiter {
  constructor(private readonly pool: SqlConnection, private readonly clock: () => Date = () => new Date()) {}

  async consume(identifier: string, limit: number, windowMs: number): Promise<boolean> {
    try {
      const nowMs = this.clock().getTime();
      const bucket = new Date(Math.floor(nowMs / windowMs) * windowMs).toISOString();
      const expiresAt = new Date(Math.floor(nowMs / windowMs) * windowMs + windowMs * 2).toISOString();
      const result = await this.pool.query<{ request_count: number }>(
        `INSERT INTO co_management_rate_limits (identifier_hash, bucket_started_at, request_count, expires_at)
         VALUES ($1, $2, 1, $3)
         ON CONFLICT (identifier_hash, bucket_started_at)
         DO UPDATE SET request_count = co_management_rate_limits.request_count + 1
         RETURNING request_count`,
        [sha256(identifier), bucket, expiresAt],
      );
      return Number(result.rows[0]?.request_count ?? limit + 1) <= limit;
    } catch (error) {
      throw new RelayStorageUnavailableError(error);
    }
  }

  async prune(): Promise<number> {
    try {
      const result = await this.pool.query("DELETE FROM co_management_rate_limits WHERE expires_at <= $1", [this.clock().toISOString()]);
      return result.rowCount ?? 0;
    } catch (error) {
      throw new RelayStorageUnavailableError(error);
    }
  }
}
