import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type {
  CoManagementRole,
  ParticipantState,
  PublicServerSnapshot,
  SessionView,
} from "../../shared/protocol.ts";

export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1_000;
export const SESSION_IDLE_MS = 30 * 60 * 1_000;
export const AUDIT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
export const AUDIT_MAX_ROWS_PER_SCOPE = 10_000;
/**
 * The in-memory store is development-only. Keep terminal operation results
 * long enough for the normal retry/recovery window, then reclaim them when a
 * new entry needs space. The PostgreSQL adapter has its own persistence and
 * maintenance policy.
 */
export const MEMORY_OPERATION_RETENTION_MS = 24 * 60 * 60 * 1_000;

export interface MemoryRelayStoreLimits {
  maxHosts: number;
  maxServersPerHost: number;
  maxInvites: number;
  maxParticipants: number;
  maxSessions: number;
  maxSnapshots: number;
  maxOperations: number;
}

export const DEFAULT_MEMORY_RELAY_STORE_LIMITS: Readonly<MemoryRelayStoreLimits> = {
  maxHosts: 1_024,
  maxServersPerHost: 64,
  maxInvites: 4_096,
  maxParticipants: 4_096,
  maxSessions: 4_096,
  maxSnapshots: 4_096,
  maxOperations: 10_000,
};

export interface HostRecord {
  hostId: string;
  tokenHash: string;
  registeredAt: string;
  lastSeenAt: string;
}

export interface InviteRecord {
  inviteId: string;
  serverId: string;
  hostId: string;
  secretHash: string;
  role: CoManagementRole;
  expiresAt: string;
  issuedAt: string;
  usedAt?: string;
  revokedAt?: string;
}

export interface ParticipantRecord {
  participantId: string;
  serverId: string;
  hostId: string;
  displayName: string;
  role: CoManagementRole;
  state: ParticipantState;
  joinCodeHash: string;
  /** Invitation and approval window; not browser-session lifetime. */
  pendingExpiresAt: string;
  /** Absolute browser-session expiry. */
  expiresAt: string;
  createdAt: string;
  approvedAt?: string;
  lastSeenAt: string;
  lastInteractionAt: string;
  lastPolledAt?: string;
}

export interface SessionRecord extends ParticipantRecord {
  sessionId: string;
  csrfToken: string;
  joinCode: string;
}

export interface RedeemedInvite {
  session: SessionRecord;
  pendingEvent: {
    type: "participant.pending";
    protocolVersion: 1;
    serverId: string;
    participantId: string;
    displayName: string;
    role: CoManagementRole;
    joinCode: string;
    expiresAt: string;
  };
}

export interface OperationRecord {
  requestId: string;
  serverId: string;
  hostId: string;
  participantId: string;
  contentHash?: string;
  state: "running" | "completed" | "failed";
  result?: unknown;
  errorCode?: string;
  updatedAt: string;
}

/**
 * Operational relay audit metadata. The host remains authoritative for the
 * user-visible before/after audit. The relay copy intentionally contains only
 * safe field names and outcomes, never setting values or credentials.
 */
export interface RelayAuditRecord {
  hostId: string;
  serverId: string;
  actorId: string;
  actorDisplayName: string;
  action: string;
  changedKeys: string[];
  result: "success" | "failure";
  requestId?: string;
  at: string;
}

export type RelayAuditInput = Omit<RelayAuditRecord, "at"> & { at?: string };

export type Awaitable<T> = T | Promise<T>;

export interface RelayStore {
  registerHost(hostId: string, token: string): Awaitable<void>;
  verifyHost(hostId: string, token: string): Awaitable<boolean>;
  hasHost(hostId: string): Awaitable<boolean>;
  bindHostServer(hostId: string, serverId: string): Awaitable<void>;
  hostOwnsServer(hostId: string, serverId: string): Awaitable<boolean>;
  registerInvite(input: Omit<InviteRecord, "issuedAt"> & { issuedAt?: string }): Awaitable<void>;
  redeemInvite(secret: string, displayName: string): Awaitable<RedeemedInvite>;
  session(sessionId: string, touch?: boolean): Awaitable<SessionRecord | undefined>;
  sessionView(sessionId: string, touch?: boolean): Awaitable<SessionView | undefined>;
  verifyCsrfForSession(sessionId: string, csrfToken: string): Awaitable<boolean>;
  approveParticipant(hostId: string, serverId: string, participantId: string): Awaitable<void>;
  revokeParticipant(hostId: string, serverId: string, participantId: string): Awaitable<void>;
  participant(hostId: string, participantId: string): Awaitable<ParticipantRecord | undefined>;
  authorize(
    sessionId: string,
    serverId: string,
    requiredRole?: "viewer" | "editor",
    touch?: boolean,
  ): Awaitable<SessionRecord>;
  setSnapshot(hostId: string, snapshot: PublicServerSnapshot): Awaitable<void>;
  snapshot(hostId: string, serverId: string): Awaitable<PublicServerSnapshot | undefined>;
  saveOperation(record: OperationRecord, audit?: RelayAuditInput): Awaitable<OperationRecord>;
  operation(
    hostId: string,
    serverId: string,
    participantId: string,
    requestId: string,
  ): Awaitable<OperationRecord | undefined>;
  appendAudit(entry: RelayAuditInput): Awaitable<void>;
  disconnectHost(hostId: string): Awaitable<void>;
  closeSession(sessionId: string): Awaitable<void>;
}

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

function clone<T>(value: T): T {
  return structuredClone(value);
}

function key(...parts: string[]): string {
  // Identifiers are validated by the relay before they reach this store.
  return parts.join("\u001f");
}

export function normalizeAudit(input: RelayAuditInput, now: string): RelayAuditRecord {
  const values = [input.hostId, input.serverId, input.actorId, input.actorDisplayName, input.action];
  if (values.some((value) => typeof value !== "string" || value.length === 0 || value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value))) {
    throw new Error("invalid-audit-entry");
  }
  if (!Array.isArray(input.changedKeys) || input.changedKeys.length > 32 || input.changedKeys.some((value) => typeof value !== "string" || value.length === 0 || value.length > 128 || /[\u0000-\u001f\u007f]/u.test(value))) {
    throw new Error("invalid-audit-entry");
  }
  if (input.result !== "success" && input.result !== "failure") throw new Error("invalid-audit-entry");
  if (input.requestId !== undefined && (typeof input.requestId !== "string" || input.requestId.length === 0 || input.requestId.length > 128 || /[\u0000-\u001f\u007f]/u.test(input.requestId))) {
    throw new Error("invalid-audit-entry");
  }
  const at = input.at ?? now;
  if (!Number.isFinite(Date.parse(at))) throw new Error("invalid-audit-entry");
  return { ...input, changedKeys: [...input.changedKeys], at };
}

export function hashRelaySecret(value: string): string {
  return sha256(value);
}

export class MemoryRelayStore implements RelayStore {
  private readonly hosts = new Map<string, HostRecord>();
  private readonly hostServers = new Map<string, Set<string>>();
  private readonly invites = new Map<string, InviteRecord>();
  private readonly participants = new Map<string, ParticipantRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly snapshots = new Map<string, PublicServerSnapshot>();
  private readonly operations = new Map<string, OperationRecord>();
  private audits: RelayAuditRecord[] = [];

  private readonly limits: MemoryRelayStoreLimits;

  constructor(
    private readonly clock: () => Date = () => new Date(),
    limits: Partial<MemoryRelayStoreLimits> = {},
  ) {
    const resolved = { ...DEFAULT_MEMORY_RELAY_STORE_LIMITS, ...limits };
    if (Object.values(resolved).some((value) => !Number.isSafeInteger(value) || value < 1)) {
      throw new Error("invalid-memory-limits");
    }
    this.limits = resolved;
  }

  private now(): string {
    return this.clock().toISOString();
  }

  private milliseconds(value: string): number {
    return Date.parse(value);
  }

  private hostServerKey(hostId: string, serverId: string): string {
    return key(hostId, serverId);
  }

  private participantKey(hostId: string, participantId: string): string {
    return key(hostId, participantId);
  }

  private operationKey(hostId: string, serverId: string, participantId: string, requestId: string): string {
    return key(hostId, serverId, participantId, requestId);
  }

  /**
   * Reclaim only records that can no longer authorize a browser or change an
   * operation outcome. Active hosts, bindings, snapshots, pending invites,
   * approved participants, and running operations are never evicted.
   */
  private pruneExpiredRecords(nowMs = this.clock().getTime()): void {
    for (const participant of this.participants.values()) {
      const pendingExpiresAt = this.milliseconds(participant.pendingExpiresAt);
      const absoluteExpiresAt = this.milliseconds(participant.expiresAt);
      const pendingExpired = participant.state === "pending"
        && (!Number.isFinite(pendingExpiresAt) || nowMs >= pendingExpiresAt);
      const sessionExpired = !Number.isFinite(absoluteExpiresAt) || nowMs >= absoluteExpiresAt;
      if (participant.state === "revoked" || pendingExpired || sessionExpired) {
        participant.state = "revoked";
      }
    }

    for (const [sessionId, session] of this.sessions) {
      const participant = this.participants.get(this.participantKey(session.hostId, session.participantId));
      if (participant?.state === "revoked" || this.sessionExpired(session, nowMs)) {
        this.sessions.delete(sessionId);
      }
    }

    for (const [participantKey, participant] of this.participants) {
      if (participant.state === "revoked") this.participants.delete(participantKey);
    }

    for (const [inviteKey, invite] of this.invites) {
      const expiresAt = this.milliseconds(invite.expiresAt);
      if (invite.usedAt || invite.revokedAt || !Number.isFinite(expiresAt) || nowMs >= expiresAt) {
        this.invites.delete(inviteKey);
      }
    }

    for (const [operationKey, operation] of this.operations) {
      const updatedAt = this.milliseconds(operation.updatedAt);
      if (operation.state !== "running"
        && (!Number.isFinite(updatedAt) || nowMs - updatedAt >= MEMORY_OPERATION_RETENTION_MS)) {
        this.operations.delete(operationKey);
      }
    }
  }

  private requireCapacity(size: number, limit: number): void {
    if (size >= limit) throw new Error("relay-memory-capacity");
  }

  registerHost(hostId: string, token: string): void {
    const tokenHash = sha256(token);
    const previous = this.hosts.get(hostId);
    if (previous && !constantTimeEqual(previous.tokenHash, tokenHash)) {
      // An ID is not proof of possession. Credential rotation requires an
      // authenticated recovery flow, which this local relay does not expose.
      throw new Error("host-registration-conflict");
    }
    if (!previous) {
      this.pruneExpiredRecords();
      this.requireCapacity(this.hosts.size, this.limits.maxHosts);
    }
    this.hosts.set(hostId, {
      hostId,
      tokenHash: previous?.tokenHash ?? tokenHash,
      registeredAt: previous?.registeredAt ?? this.now(),
      lastSeenAt: this.now(),
    });
  }

  verifyHost(hostId: string, token: string): boolean {
    const host = this.hosts.get(hostId);
    if (!host) return false;
    const valid = constantTimeEqual(host.tokenHash, sha256(token));
    if (valid) host.lastSeenAt = this.now();
    return valid;
  }

  hasHost(hostId: string): boolean {
    return this.hosts.has(hostId);
  }

  bindHostServer(hostId: string, serverId: string): void {
    if (!this.hasHost(hostId)) throw new Error("host-not-registered");
    const servers = this.hostServers.get(hostId) ?? new Set<string>();
    if (!servers.has(serverId)) this.requireCapacity(servers.size, this.limits.maxServersPerHost);
    servers.add(serverId);
    this.hostServers.set(hostId, servers);
  }

  hostOwnsServer(hostId: string, serverId: string): boolean {
    return this.hostServers.get(hostId)?.has(serverId) ?? false;
  }

  registerInvite(input: Omit<InviteRecord, "issuedAt"> & { issuedAt?: string }): void {
    if (!this.hasHost(input.hostId)) throw new Error("host-not-registered");
    if (!this.hostOwnsServer(input.hostId, input.serverId)) throw new Error("host-server-not-bound");
    if (!/^[a-f0-9]{64}$/i.test(input.secretHash)) throw new Error("invalid-secret-hash");
    if (this.milliseconds(input.expiresAt) <= this.clock().getTime()) throw new Error("invite-expired");
    const inviteKey = key(input.hostId, input.inviteId);
    const previous = this.invites.get(inviteKey);
    if (previous && (previous.secretHash !== input.secretHash
      || previous.serverId !== input.serverId
      || previous.role !== input.role
      || previous.expiresAt !== input.expiresAt)) {
      throw new Error("invite-id-conflict");
    }
    if (previous) return;
    this.pruneExpiredRecords();
    this.requireCapacity(this.invites.size, this.limits.maxInvites);
    this.invites.set(inviteKey, { ...input, issuedAt: input.issuedAt ?? this.now() });
  }

  redeemInvite(secret: string, displayName: string): RedeemedInvite {
    const secretHash = sha256(secret);
    const invite = [...this.invites.values()].find((candidate) =>
      constantTimeEqual(candidate.secretHash, secretHash)
        && !candidate.usedAt
        && !candidate.revokedAt
        && this.milliseconds(candidate.expiresAt) > this.clock().getTime(),
    );
    if (!invite) throw new Error("invite-invalid-or-expired");
    if (displayName.trim().length === 0 || displayName.trim().length > 32 || /[\u0000-\u001f\u007f]/u.test(displayName)) {
      throw new Error("invalid-display-name");
    }
    this.pruneExpiredRecords();
    this.requireCapacity(this.participants.size, this.limits.maxParticipants);
    this.requireCapacity(this.sessions.size, this.limits.maxSessions);
    const issuedAt = this.now();
    const participantId = randomId("participant");
    const sessionId = randomId("session");
    const csrfToken = randomBytes(32).toString("base64url");
    const joinCode = sixDigitCode();
    const participant: ParticipantRecord = {
      participantId,
      serverId: invite.serverId,
      hostId: invite.hostId,
      displayName: displayName.trim(),
      role: invite.role,
      state: "pending",
      joinCodeHash: sha256(joinCode),
      pendingExpiresAt: invite.expiresAt,
      expiresAt: new Date(this.clock().getTime() + SESSION_ABSOLUTE_MS).toISOString(),
      createdAt: issuedAt,
      lastSeenAt: issuedAt,
      lastInteractionAt: issuedAt,
    };
    const session: SessionRecord = { ...participant, sessionId, csrfToken, joinCode };
    invite.usedAt = issuedAt;
    this.participants.set(this.participantKey(participant.hostId, participantId), participant);
    this.sessions.set(sessionId, session);
    return {
      session: clone(session),
      pendingEvent: {
        type: "participant.pending",
        protocolVersion: 1,
        serverId: invite.serverId,
        participantId,
        displayName: participant.displayName,
        role: invite.role,
        joinCode,
        expiresAt: invite.expiresAt,
      },
    };
  }

  private sessionExpired(session: SessionRecord, current = this.clock().getTime()): boolean {
    const absolute = this.milliseconds(session.expiresAt);
    const idle = this.milliseconds(session.lastInteractionAt) + SESSION_IDLE_MS;
    return !Number.isFinite(absolute) || !Number.isFinite(idle) || current >= absolute || current >= idle;
  }

  private refreshSession(session: SessionRecord, touch: boolean): boolean {
    if (this.sessionExpired(session)) {
      session.state = "revoked";
      const participant = this.participants.get(this.participantKey(session.hostId, session.participantId));
      if (participant) participant.state = "revoked";
      return true;
    }
    const participant = this.participants.get(this.participantKey(session.hostId, session.participantId));
    if (participant) session.state = participant.state;
    if (touch) {
      const timestamp = this.now();
      session.lastInteractionAt = timestamp;
      session.lastSeenAt = timestamp;
      if (participant) {
        participant.lastInteractionAt = timestamp;
        participant.lastSeenAt = timestamp;
      }
    } else {
      session.lastPolledAt = this.now();
    }
    return false;
  }

  session(sessionId: string, touch = false): SessionRecord | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    this.refreshSession(session, touch);
    return clone(session);
  }

  sessionView(sessionId: string, touch = false): SessionView | undefined {
    const record = this.sessions.get(sessionId);
    if (!record) return undefined;
    const expired = this.refreshSession(record, touch);
    const view: SessionView = {
      state: expired ? "expired" : record.state,
      participantId: record.participantId,
      serverId: record.serverId,
      role: record.role,
      displayName: record.displayName,
      expiresAt: record.expiresAt,
    };
    if (view.state === "pending") view.joinCode = record.joinCode;
    const snapshot = this.snapshots.get(this.hostServerKey(record.hostId, record.serverId));
    if (snapshot && view.state === "approved") view.server = clone(snapshot);
    return view;
  }

  csrfForSession(sessionId: string): string | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || this.refreshSession(session, false)) return undefined;
    return session.csrfToken;
  }

  verifyCsrfForSession(sessionId: string, csrfToken: string): boolean {
    return constantTimeEqual(this.csrfForSession(sessionId) ?? "", csrfToken);
  }

  approveParticipant(hostId: string, serverId: string, participantId: string): void {
    const participant = this.participants.get(this.participantKey(hostId, participantId));
    if (!participant || participant.serverId !== serverId) throw new Error("participant-not-found");
    if (this.milliseconds(participant.pendingExpiresAt) <= this.clock().getTime()) {
      participant.state = "revoked";
      throw new Error("participant-expired");
    }
    participant.state = "approved";
    participant.approvedAt = this.now();
    participant.lastSeenAt = this.now();
    const session = [...this.sessions.values()].find((candidate) => candidate.hostId === hostId && candidate.participantId === participantId);
    if (session) session.state = "approved";
  }

  revokeParticipant(hostId: string, serverId: string, participantId: string): void {
    const participant = this.participants.get(this.participantKey(hostId, participantId));
    if (!participant || participant.serverId !== serverId) throw new Error("participant-not-found");
    participant.state = "revoked";
    participant.lastSeenAt = this.now();
    const session = [...this.sessions.values()].find((candidate) => candidate.hostId === hostId && candidate.participantId === participantId);
    if (session) session.state = "revoked";
  }

  participant(hostId: string, participantId: string): ParticipantRecord | undefined {
    const participant = this.participants.get(this.participantKey(hostId, participantId));
    return participant ? clone(participant) : undefined;
  }

  authorize(sessionId: string, serverId: string, requiredRole: "viewer" | "editor" = "viewer", touch = false): SessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session || session.serverId !== serverId || this.refreshSession(session, touch) || session.state !== "approved") {
      throw new Error("session-not-authorized");
    }
    if (requiredRole === "editor" && session.role !== "editor") throw new Error("editor-required");
    const participant = this.participants.get(this.participantKey(session.hostId, session.participantId));
    if (!participant || participant.state !== "approved") throw new Error("session-not-authorized");
    return clone(session);
  }

  setSnapshot(hostId: string, snapshot: PublicServerSnapshot): void {
    if (JSON.stringify(snapshot).length > 64 * 1024) throw new Error("snapshot-too-large");
    const snapshotKey = this.hostServerKey(hostId, snapshot.serverId);
    if (!this.snapshots.has(snapshotKey)) {
      this.pruneExpiredRecords();
      this.requireCapacity(this.snapshots.size, this.limits.maxSnapshots);
    }
    this.snapshots.set(snapshotKey, clone(snapshot));
  }

  snapshot(hostId: string, serverId: string): PublicServerSnapshot | undefined {
    const snapshot = this.snapshots.get(this.hostServerKey(hostId, serverId));
    return snapshot ? clone(snapshot) : undefined;
  }

  saveOperation(record: OperationRecord, audit?: RelayAuditInput): OperationRecord {
    const operationKey = this.operationKey(record.hostId, record.serverId, record.participantId, record.requestId);
    const existing = this.operations.get(operationKey);
    if (existing?.contentHash && record.contentHash && !constantTimeEqual(existing.contentHash, record.contentHash)) {
      throw new Error("request-id-reused");
    }
    // A timeout is uncertain. Never replace a final result with a retry's
    // `running` marker.
    if (existing && existing.state !== "running" && record.state === "running") return clone(existing);
    if (!existing) {
      this.pruneExpiredRecords();
      this.requireCapacity(this.operations.size, this.limits.maxOperations);
    }
    if (audit && record.state !== "running") this.appendAudit(audit);
    const stored = { ...record, contentHash: record.contentHash ?? existing?.contentHash };
    this.operations.set(operationKey, clone(stored));
    return clone(stored);
  }

  operation(hostId: string, serverId: string, participantId: string, requestId: string): OperationRecord | undefined {
    const operation = this.operations.get(this.operationKey(hostId, serverId, participantId, requestId));
    return operation ? clone(operation) : undefined;
  }

  appendAudit(entry: RelayAuditInput): void {
    const normalized = normalizeAudit(entry, this.now());
    if (normalized.requestId && this.audits.some((candidate) =>
      candidate.requestId === normalized.requestId
      && candidate.hostId === normalized.hostId
      && candidate.serverId === normalized.serverId
      && candidate.action === normalized.action,
    )) return;
    this.audits.push(clone(normalized));
  }

  /** Test/diagnostic view; the browser audit endpoint reads the host's authoritative log. */
  relayAuditEntries(hostId: string, serverId: string): RelayAuditRecord[] {
    return this.audits
      .filter((entry) => entry.hostId === hostId && entry.serverId === serverId)
      .map((entry) => clone(entry));
  }

  pruneAudit(at = this.now()): number {
    const cutoff = Date.parse(at) - AUDIT_RETENTION_MS;
    const grouped = new Map<string, Array<{ index: number; at: number }>>();
    this.audits.forEach((entry, index) => {
      const scope = key(entry.hostId, entry.serverId);
      const rows = grouped.get(scope) ?? [];
      rows.push({ index, at: Date.parse(entry.at) });
      grouped.set(scope, rows);
    });
    const keep = new Set<number>();
    for (const rows of grouped.values()) {
      rows.sort((left, right) => right.at - left.at || right.index - left.index);
      for (const row of rows.slice(0, AUDIT_MAX_ROWS_PER_SCOPE)) keep.add(row.index);
    }
    const before = this.audits.length;
    this.audits = this.audits.filter((entry, index) => keep.has(index) || Date.parse(entry.at) >= cutoff);
    return before - this.audits.length;
  }

  disconnectHost(hostId: string): void {
    const prefix = key(hostId);
    for (const snapshotKey of this.snapshots.keys()) {
      if (snapshotKey.startsWith(prefix + "\u001f")) this.snapshots.delete(snapshotKey);
    }
    for (const participant of this.participants.values()) {
      if (participant.hostId !== hostId) continue;
      participant.state = "revoked";
      participant.lastSeenAt = this.now();
      const session = [...this.sessions.values()].find((candidate) =>
        candidate.hostId === hostId && candidate.participantId === participant.participantId,
      );
      if (session) session.state = "revoked";
    }
    const timestamp = this.now();
    for (const invite of this.invites.values()) {
      if (invite.hostId === hostId && !invite.usedAt && !invite.revokedAt) invite.revokedAt = timestamp;
    }
  }

  closeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}

export async function sessionForCookie(store: RelayStore, sessionId: string | undefined): Promise<SessionView | undefined> {
  return sessionId ? await store.sessionView(sessionId) : undefined;
}
