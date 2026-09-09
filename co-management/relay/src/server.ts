import { promises as fs } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { Pool } from "pg";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type {
  CoManagementOperationResult,
  HostRequest,
  HostResponse,
  PublicServerSnapshot,
  SessionView,
} from "../../shared/protocol.ts";
import { isCoManagementRole, isSafePublicSnapshot } from "../../shared/protocol.ts";
import {
  MemoryRelayStore,
  hashRelaySecret,
  type OperationRecord,
  type ParticipantRecord,
  type RelayAuditInput,
  type RelayStore,
} from "./store.ts";
import {
  PostgresRateLimiter,
  PostgresRelayStore,
  RelayStorageUnavailableError,
  type SharedRateLimiter,
} from "./postgres-store.ts";
import { RelayKeyring } from "./relay-crypto.ts";
import { verifyMigrations } from "./migrations.ts";
import { postgresSslConfiguration, assertDatabaseTlsConfiguration } from "./database-config.ts";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_WS_BYTES = 256 * 1024;
export const MAX_PENDING_HOST_REQUESTS = 1_024;
export const DEFAULT_MEMORY_RATE_LIMIT_ENTRIES = 10_000;
export const MAX_ACTIVE_WEB_SOCKETS = 512;
export const MAX_PREAUTH_WEB_SOCKETS = 128;
export const MAX_WEBSOCKET_UPGRADE_ATTEMPTS = 60;
export const MAX_INBOUND_WEB_SOCKET_MESSAGES = 64;
export const MAX_INBOUND_WEB_SOCKET_BYTES = 2 * 1024 * 1024;
export const MAX_QUEUED_HOST_EVENTS = 4_096;
export const MAX_QUEUED_HOST_EVENT_BYTES = 8 * 1024 * 1024;
export const MAX_QUEUED_HOST_EVENT_HOSTS = 1_024;
export const MAX_HOST_EVENT_BUFFERED_BYTES = 8 * 1024 * 1024;
const MAX_QUEUED_HOST_EVENTS_PER_HOST = 100;
const QUEUED_HOST_EVENT_TTL_MS = 10 * 60_000;
const SESSION_COOKIE = "msh_co_session";
const CSRF_COOKIE = "msh_co_csrf";
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,128}$/u;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/u;
const EDITABLE_KEYS = new Set([
  "difficulty",
  "defaultGameMode",
  "maxPlayers",
  "pvp",
  "allowFlight",
  "forceGameMode",
  "spawnProtection",
  "viewDistance",
  "simulationDistance",
  "serverDescription",
  "expRate",
  "collectionDropRate",
  "palCaptureRate",
  "dayTimeSpeedRate",
  "nightTimeSpeedRate",
  "palEggDefaultHatchingTime",
  "deathPenalty",
  "invaderEnemiesEnabled",
  "fastTravelEnabled",
  "baseCampMaxNumInGuild",
  "baseCampWorkerMaxNum",
]);

type JsonObject = Record<string, unknown>;

interface QueuedHostEvent {
  payload: JsonObject;
  bytes: number;
  expiresAtMs: number;
}

interface InboundWebSocketMessage {
  data: RawData;
  bytes: number;
}

function validPositiveLimit(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function rawDataBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(String(data), "utf8");
}

export interface RelayServerOptions {
  store?: RelayStore;
  rateLimiter?: SharedRateLimiter;
  allowedOrigins?: string[];
  secureCookies?: boolean;
  staticDir?: string;
  onClose?: () => Promise<void>;
  readinessCheck?: () => Promise<void>;
  trustProxy?: boolean;
  hstsMaxAgeSeconds?: number;
  maxPendingHostRequests?: number;
  maxWebSocketConnections?: number;
  maxPreAuthWebSocketConnections?: number;
  maxWebSocketUpgradeAttempts?: number;
  maxInboundWebSocketMessages?: number;
  maxInboundWebSocketBytes?: number;
  maxQueuedHostEvents?: number;
  maxQueuedHostEventBytes?: number;
  maxQueuedHostEventHosts?: number;
  maxHostEventBufferedBytes?: number;
}

export interface RelayServer {
  app: FastifyInstance;
  store: RelayStore;
  start(port?: number, host?: string): Promise<string>;
  close(): Promise<void>;
}

export function hasWebSocketSendCapacity(
  socket: Pick<WebSocket, "bufferedAmount">,
  bytes: number,
  limit: number,
): boolean {
  return Number.isSafeInteger(bytes)
    && bytes >= 0
    && Number.isSafeInteger(limit)
    && limit >= bytes
    && Number.isSafeInteger(socket.bufferedAmount)
    && socket.bufferedAmount >= 0
    && socket.bufferedAmount <= limit - bytes;
}

export function assertRelayRuntimeConfiguration(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === "production") {
    if (!env.MSH_CO_MANAGEMENT_DATABASE_URL) throw new Error("本番中継は停止しました。PostgreSQL接続先がありません。");
    if (!env.MSH_CO_MANAGEMENT_RELAY_KEYS) throw new Error("本番中継は停止しました。暗号化鍵リングがありません。");
    assertDatabaseTlsConfiguration(env);
    const origins = (env.MSH_CO_MANAGEMENT_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (origins.length === 0 || origins.some((origin) => !origin.startsWith("https://") || origin.includes("localhost") || origin.includes("127.0.0.1"))) {
      throw new Error("本番中継は停止しました。HTTPSのOrigin許可リストを明示してください。");
    }
    RelayKeyring.fromEnvironment(env.MSH_CO_MANAGEMENT_RELAY_KEYS);
  }
}

class RelayError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message = code,
  ) {
    super(message);
  }
}

class HostRequestError extends Error {
  constructor(
    public readonly code: string,
    public readonly safeMessage: string,
  ) {
    super(code);
  }
}

interface PendingHostRequest {
  relayRequestId: string;
  hostId: string;
  serverId: string;
  participantId: string;
  operationId?: string;
  contentHash?: string;
  audit?: RelayAuditInput;
  timeoutTimer: NodeJS.Timeout;
  cleanupTimer: NodeJS.Timeout;
  timedOut: boolean;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

interface RateWindow {
  startedAt: number;
  count: number;
  expiresAt: number;
}

export interface MemoryRateLimiterOptions {
  maxEntries?: number;
  clock?: () => number;
}

export class MemoryRateLimiter implements SharedRateLimiter {
  private readonly rates = new Map<string, RateWindow>();
  private readonly maxEntries: number;
  private readonly clock: () => number;

  constructor(options: MemoryRateLimiterOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MEMORY_RATE_LIMIT_ENTRIES;
    this.clock = options.clock ?? (() => Date.now());
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new Error("invalid-memory-limits");
    }
  }

  private pruneExpired(timestamp: number): void {
    for (const [identifier, window] of this.rates) {
      if (window.expiresAt <= timestamp) this.rates.delete(identifier);
    }
  }

  async consume(identifier: string, limit: number, windowMs: number): Promise<boolean> {
    if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
      throw new Error("invalid-rate-limit");
    }
    const timestamp = this.clock();
    this.pruneExpired(timestamp);
    const current = this.rates.get(identifier);
    if (!current || timestamp - current.startedAt >= windowMs) {
      if (!current && this.rates.size >= this.maxEntries) {
        throw new Error("relay-memory-capacity");
      }
      this.rates.set(identifier, {
        startedAt: timestamp,
        count: 1,
        expiresAt: timestamp + windowMs * 2,
      });
      return true;
    }
    current.count += 1;
    return current.count <= limit;
  }
}

function asObject(value: unknown): JsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

function onlyKeys(value: JsonObject, allowed: readonly string[]): boolean {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
}

function text(value: unknown, min: number, max: number): value is string {
  return typeof value === "string"
    && value.length >= min
    && value.length <= max
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

function requestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_RE.test(value);
}

function cookieMap(header: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  for (const item of (header ?? "").split(";")) {
    const [name, ...rest] = item.trim().split("=");
    if (!name || rest.length === 0) continue;
    result.set(name, decodeURIComponent(rest.join("=")));
  }
  return result;
}

function constantTimeEqual(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function genericError(error: unknown): RelayError {
  if (error instanceof RelayError) return error;
  if (error instanceof HostRequestError) {
    return new RelayError(error.code === "relay-busy" ? 503 : 502, error.code, error.safeMessage);
  }
  if (error instanceof RelayStorageUnavailableError) return new RelayError(503, "relay-storage-unavailable");
  if (error instanceof Error) {
    switch (error.message) {
      case "invite-invalid-or-expired":
        return new RelayError(400, "invite-invalid-or-expired");
      case "invalid-display-name":
        return new RelayError(400, "invalid-display-name");
      case "session-not-authorized":
        return new RelayError(403, "session-not-authorized");
      case "editor-required":
        return new RelayError(403, "editor-required");
      case "host-not-registered":
        return new RelayError(401, "host-not-registered");
      case "host-registration-conflict":
        return new RelayError(409, "host-registration-conflict");
      case "request-id-reused":
        return new RelayError(409, "request-id-reused");
      case "relay-memory-capacity":
        return new RelayError(503, "relay-memory-capacity");
      case "participant-expired":
        return new RelayError(403, "session-not-authorized");
      case "participant-not-pending":
        return new RelayError(409, "participant-not-pending");
      default:
        break;
    }
  }
  return new RelayError(500, "relay-operation-failed");
}

function sendError(reply: FastifyReply, error: unknown): void {
  const safe = genericError(error);
  reply.code(safe.statusCode).send({ error: safe.code });
}

function sessionIdFrom(request: FastifyRequest): string | undefined {
  return cookieMap(request.headers.cookie).get(SESSION_COOKIE);
}

function originAllowed(request: FastifyRequest, allowedOrigins: Set<string>, allowMissing: boolean): boolean {
  const origin = request.headers.origin;
  return !origin ? allowMissing : allowedOrigins.has(origin);
}

function requireBrowserRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  allowedOrigins: Set<string>,
  allowMissingOrigin = false,
): boolean {
  if (!originAllowed(request, allowedOrigins, allowMissingOrigin)) {
    reply.code(403).send({ error: "origin-not-allowed" });
    return false;
  }
  return true;
}

async function requireCsrf(
  request: FastifyRequest,
  reply: FastifyReply,
  store: RelayStore,
): Promise<string | undefined> {
  const sessionId = sessionIdFrom(request);
  const csrfCookie = cookieMap(request.headers.cookie).get(CSRF_COOKIE);
  const csrfHeader = request.headers["x-csrf-token"];
  const header = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
  if (!sessionId || !header || !constantTimeEqual(csrfCookie, header) || !await store.verifyCsrfForSession(sessionId, header)) {
    reply.code(403).send({ error: "csrf-failed" });
    return undefined;
  }
  return sessionId;
}

function setSessionCookies(
  reply: FastifyReply,
  sessionId: string,
  csrfToken: string,
  secure: boolean,
): void {
  const securePart = secure ? "; Secure" : "";
  reply.header("Set-Cookie", [
    SESSION_COOKIE + "=" + encodeURIComponent(sessionId) + "; Path=/; HttpOnly; SameSite=Strict" + securePart,
    CSRF_COOKIE + "=" + encodeURIComponent(csrfToken) + "; Path=/; SameSite=Strict" + securePart,
  ]);
}

function clearSessionCookies(reply: FastifyReply, secure: boolean): void {
  const securePart = secure ? "; Secure" : "";
  reply.header("Set-Cookie", [
    SESSION_COOKIE + "=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict" + securePart,
    CSRF_COOKIE + "=; Path=/; Max-Age=0; SameSite=Strict" + securePart,
  ]);
}

function hostToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  const value = header.slice("Bearer ".length).trim();
  return value || undefined;
}

function randomRequestId(): string {
  return "relay-" + randomBytes(16).toString("hex");
}

function isUserActivity(request: FastifyRequest): boolean {
  const value = request.headers["x-msh-user-activity"];
  return (Array.isArray(value) ? value[0] : value) === "1";
}

function operationContentHash(serverId: string, participantId: string, expectedRevision: number, changes: Record<string, string | number | boolean>): string {
  const normalizedChanges = Object.fromEntries(Object.entries(changes).sort(([left], [right]) => left.localeCompare(right)));
  return hashRelaySecret(JSON.stringify({ serverId, participantId, expectedRevision, changes: normalizedChanges }));
}

export function configuredPort(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.MSH_CO_MANAGEMENT_PORT ?? env.PORT ?? 8787);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error("invalid-relay-port");
  }
  return value;
}

function assertNoSensitiveKeys(value: unknown, depth = 0): void {
  if (depth > 8 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoSensitiveKeys(item, depth + 1);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (/^(rootPath|javaPath|password|token|secret|restApiPort|address|connectionString|command|path)$/iu.test(key)) {
      throw new HostRequestError("host-response-invalid", "ホスト応答に公開禁止の情報が含まれていました");
    }
    assertNoSensitiveKeys(nested, depth + 1);
  }
}

function validateChanges(value: unknown): Record<string, string | number | boolean> {
  const object = asObject(value);
  if (!object || Object.keys(object).length === 0 || Object.keys(object).length > 32) {
    throw new RelayError(400, "invalid-changes");
  }
  const result: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(object)) {
    if (!EDITABLE_KEYS.has(key) || item === null || typeof item === "object") {
      throw new RelayError(400, "field-not-allowed");
    }
    if (typeof item === "string" && (item.length > 256 || /[\u0000-\u001f\u007f]/u.test(item))) {
      throw new RelayError(400, "invalid-field-value");
    }
    if (typeof item === "number" && !Number.isFinite(item)) {
      throw new RelayError(400, "invalid-field-value");
    }
    if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
      throw new RelayError(400, "invalid-field-value");
    }
    result[key] = item;
  }
  return result;
}

function participantView(participant: ParticipantRecord): ParticipantRecord {
  return {
    ...participant,
    joinCodeHash: "[redacted]",
    hostId: "[redacted]",
  };
}

function operationRecord(
  pending: Pick<PendingHostRequest, "hostId" | "serverId" | "participantId" | "operationId" | "contentHash">,
  response: HostResponse,
): OperationRecord {
  return {
    requestId: pending.operationId ?? response.requestId,
    serverId: pending.serverId,
    hostId: pending.hostId,
    participantId: pending.participantId,
    contentHash: pending.contentHash,
    state: response.ok ? "completed" : "failed",
    result: response.ok ? response.result : undefined,
    errorCode: response.ok ? undefined : response.errorCode ?? "host-operation-failed",
    updatedAt: new Date().toISOString(),
  };
}

function settingsAudit(
  participant: ParticipantRecord,
  serverId: string,
  requestId: string,
  changedKeys: string[],
  result: "success" | "failure",
): RelayAuditInput {
  return {
    hostId: participant.hostId,
    serverId,
    actorId: participant.participantId,
    actorDisplayName: participant.displayName,
    action: "settings.patch",
    changedKeys: [...changedKeys],
    result,
    requestId,
    at: new Date().toISOString(),
  };
}

function parseHostOperationStatus(value: unknown, expectedRequestId: string): CoManagementOperationResult {
  const object = asObject(value);
  const state = object?.state;
  if (!object
    || object.requestId !== expectedRequestId
    || (state !== "running" && state !== "completed" && state !== "failed")
    || (object.errorCode !== undefined && !text(object.errorCode, 1, 128))) {
    throw new HostRequestError("host-operation-invalid", "ホスト応答の操作状態が不正です");
  }
  if (state === "completed" && (object.result === undefined || object.result === null)) {
    throw new HostRequestError("host-operation-invalid", "ホスト応答に保存結果がありません");
  }
  return {
    requestId: expectedRequestId,
    state,
    result: object.result,
    errorCode: typeof object.errorCode === "string" ? object.errorCode : undefined,
  };
}

export function createRelayServer(options: RelayServerOptions = {}): RelayServer {
  const store = options.store ?? new MemoryRelayStore();
  const sharedRateLimiter = options.rateLimiter ?? new MemoryRateLimiter();
  const allowedOrigins = new Set(options.allowedOrigins ?? [
    "http://127.0.0.1:8787",
    "http://localhost:8787",
    "http://127.0.0.1:8788",
    "http://localhost:8788",
  ]);
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === "production";
  const maxPendingHostRequests = options.maxPendingHostRequests ?? MAX_PENDING_HOST_REQUESTS;
  const maxWebSocketConnections = options.maxWebSocketConnections ?? MAX_ACTIVE_WEB_SOCKETS;
  const maxPreAuthWebSocketConnections = options.maxPreAuthWebSocketConnections ?? MAX_PREAUTH_WEB_SOCKETS;
  const maxWebSocketUpgradeAttempts = options.maxWebSocketUpgradeAttempts ?? MAX_WEBSOCKET_UPGRADE_ATTEMPTS;
  const maxInboundWebSocketMessages = options.maxInboundWebSocketMessages ?? MAX_INBOUND_WEB_SOCKET_MESSAGES;
  const maxInboundWebSocketBytes = options.maxInboundWebSocketBytes ?? MAX_INBOUND_WEB_SOCKET_BYTES;
  const maxQueuedHostEvents = options.maxQueuedHostEvents ?? MAX_QUEUED_HOST_EVENTS;
  const maxQueuedHostEventBytes = options.maxQueuedHostEventBytes ?? MAX_QUEUED_HOST_EVENT_BYTES;
  const maxQueuedHostEventHosts = options.maxQueuedHostEventHosts ?? MAX_QUEUED_HOST_EVENT_HOSTS;
  const maxHostEventBufferedBytes = options.maxHostEventBufferedBytes ?? MAX_HOST_EVENT_BUFFERED_BYTES;
  if (!validPositiveLimit(maxPendingHostRequests)
    || !validPositiveLimit(maxWebSocketConnections)
    || !validPositiveLimit(maxPreAuthWebSocketConnections)
    || !validPositiveLimit(maxWebSocketUpgradeAttempts)
    || !validPositiveLimit(maxInboundWebSocketMessages)
    || !validPositiveLimit(maxInboundWebSocketBytes)
    || maxInboundWebSocketBytes < MAX_WS_BYTES
    || !validPositiveLimit(maxQueuedHostEvents)
    || !validPositiveLimit(maxQueuedHostEventBytes)
    || maxQueuedHostEventBytes < MAX_WS_BYTES
    || !validPositiveLimit(maxQueuedHostEventHosts)) {
    throw new Error("invalid-memory-limits");
  }
  if (!validPositiveLimit(maxHostEventBufferedBytes) || maxHostEventBufferedBytes < MAX_WS_BYTES) {
    throw new Error("invalid-memory-limits");
  }
  const app = fastify({ logger: false, bodyLimit: MAX_BODY_BYTES, trustProxy: options.trustProxy ?? false });
  const sockets = new Map<string, WebSocket>();
  const queuedHostEvents = new Map<string, QueuedHostEvent[]>();
  let queuedHostEventCount = 0;
  let queuedHostEventBytes = 0;
  const pending = new Map<string, PendingHostRequest>();
  const connectedSockets = new Set<WebSocket>();
  const preAuthSockets = new Set<WebSocket>();
  const pendingUpgradeSockets = new Set<Socket>();
  // Keep upgrade abuse local to this relay process. The shared HTTP limiter is
  // PostgreSQL-backed in production, but using it before a WebSocket exists
  // would turn an unauthenticated handshake flood into more DB work.
  const websocketUpgradeRateLimiter = new MemoryRateLimiter();
  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    maxPayload: MAX_WS_BYTES,
    perMessageDeflate: false,
  });
  const socketAlive = new Map<WebSocket, boolean>();

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    reply.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' wss:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (request.url.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (options.hstsMaxAgeSeconds && options.hstsMaxAgeSeconds > 0) {
      reply.header("Strict-Transport-Security", `max-age=${Math.floor(options.hstsMaxAgeSeconds)}`);
    }
    return payload;
  });

  app.get("/health/live", async (_request, reply) => {
    reply.send({ status: "ok" });
  });

  app.get("/health/ready", async (_request, reply) => {
    try {
      await options.readinessCheck?.();
      reply.send({ status: "ready" });
    } catch {
      reply.code(503).send({ status: "not-ready" });
    }
  });

  const rateLimit = async (request: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    // Use the actual TCP peer for the limiter. Fastify's request.ip can be
    // derived from X-Forwarded-For when trustProxy is enabled, and that header
    // must not become an attacker-controlled way to evade the shared limit.
    const address = request.raw.socket.remoteAddress || "unknown";
    try {
      if (await sharedRateLimiter.consume(address, 120, 60_000)) return true;
      reply.code(429).send({ error: "rate-limited" });
      return false;
    } catch (error) {
      sendError(reply, error);
      return false;
    }
  };

  const removeQueuedHostEvents = (hostId: string): QueuedHostEvent[] => {
    const queue = queuedHostEvents.get(hostId);
    if (!queue) return [];
    queuedHostEvents.delete(hostId);
    queuedHostEventCount -= queue.length;
    queuedHostEventBytes -= queue.reduce((total, item) => total + item.bytes, 0);
    return queue;
  };

  const pruneQueuedHostEvents = (nowMs = Date.now()): void => {
    for (const [hostId, queue] of queuedHostEvents) {
      const retained = queue.filter((item) => item.expiresAtMs > nowMs);
      if (retained.length === queue.length) continue;
      queuedHostEventCount -= queue.length - retained.length;
      queuedHostEventBytes -= queue
        .filter((item) => item.expiresAtMs <= nowMs)
        .reduce((total, item) => total + item.bytes, 0);
      if (retained.length === 0) queuedHostEvents.delete(hostId);
      else queuedHostEvents.set(hostId, retained);
    }
  };

  const sendBoundedHostEvent = (socket: WebSocket, serialized: string, bytes: number): boolean => {
    if (socket.readyState !== WebSocket.OPEN
      || bytes > MAX_WS_BYTES
      || !hasWebSocketSendCapacity(socket, bytes, maxHostEventBufferedBytes)) {
      if (socket.readyState === WebSocket.OPEN) socket.terminate();
      return false;
    }
    try {
      socket.send(serialized);
      return true;
    } catch {
      socket.terminate();
      return false;
    }
  };

  const sendHostEvent = (hostId: string, payload: JsonObject): "sent" | "queued" | "rejected" => {
    const serialized = JSON.stringify(payload);
    const bytes = Buffer.byteLength(serialized, "utf8");
    const socket = sockets.get(hostId);
    if (socket?.readyState === WebSocket.OPEN) {
      return sendBoundedHostEvent(socket, serialized, bytes) ? "sent" : "rejected";
    }
    pruneQueuedHostEvents();
    const payloadExpiry = typeof payload.expiresAt === "string" ? Date.parse(payload.expiresAt) : Number.NaN;
    const expiresAtMs = Number.isFinite(payloadExpiry) ? payloadExpiry : Date.now() + QUEUED_HOST_EVENT_TTL_MS;
    if (bytes > MAX_WS_BYTES || expiresAtMs <= Date.now()) return "rejected";
    const queue = queuedHostEvents.get(hostId) ?? [];
    if (queue.length >= MAX_QUEUED_HOST_EVENTS_PER_HOST
      || queuedHostEventCount >= maxQueuedHostEvents
      || queuedHostEventBytes + bytes > maxQueuedHostEventBytes
      || (!queuedHostEvents.has(hostId) && queuedHostEvents.size >= maxQueuedHostEventHosts)) {
      return "rejected";
    }
    queue.push({ payload, bytes, expiresAtMs });
    queuedHostEvents.set(hostId, queue);
    queuedHostEventCount += 1;
    queuedHostEventBytes += bytes;
    return "queued";
  };

  const sendHostRequest = (
    hostId: string,
    serverId: string,
    participantId: string,
    payload: JsonObject,
    operationId?: string,
    contentHash?: string,
    audit?: RelayAuditInput,
  ): Promise<unknown> => {
    const socket = sockets.get(hostId);
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new HostRequestError("host-offline", "ホストPCが接続していません");
    }
    if (pending.size >= maxPendingHostRequests) {
      throw new HostRequestError("relay-busy", "中継が一時的に混雑しています。しばらくしてから再試行してください");
    }
    // Relay correlation IDs must never be controlled by a browser operation
    // ID. More than one participant may legitimately choose the same ID.
    const relayRequestId = randomRequestId();
    const message = {
      ...payload,
      type: payload.type,
      protocolVersion: 1,
      requestId: relayRequestId,
      serverId,
      participantId,
      ...(operationId ? { operationId } : {}),
    };
    return new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        const waiting = pending.get(relayRequestId);
        if (!waiting) return;
        waiting.timedOut = true;
        reject(new HostRequestError("host-timeout", "ホストPCから時間内に応答がありません"));
      }, 10_000);
      // Keep the correlation briefly after reporting an uncertain timeout so a
      // delayed host result is persisted. A later operation.get is still safe
      // after this grace period because it is a read-only host request.
      const cleanupTimer = setTimeout(() => {
        pending.delete(relayRequestId);
      }, 60_000);
      pending.set(relayRequestId, {
        relayRequestId,
        hostId,
        serverId,
        participantId,
        operationId,
        contentHash,
        audit,
        timeoutTimer,
        cleanupTimer,
        timedOut: false,
        resolve,
        reject,
      });
      try {
        socket.send(JSON.stringify(message));
      } catch {
        clearTimeout(timeoutTimer);
        clearTimeout(cleanupTimer);
        pending.delete(relayRequestId);
        reject(new HostRequestError("host-send-failed", "ホストPCへ送信できませんでした"));
      }
    });
  };

  const requireAuthorizedSession = async (
    request: FastifyRequest,
    reply: FastifyReply,
    serverId: string,
    role: "viewer" | "editor",
  ): Promise<{ sessionId: string; session: SessionView; hostId: string } | undefined> => {
    const sessionId = sessionIdFrom(request);
    if (!sessionId) {
      reply.code(401).send({ error: "session-required" });
      return undefined;
    }
    try {
      const record = await store.authorize(sessionId, serverId, role, isUserActivity(request));
      const session = await store.sessionView(sessionId);
      if (!session || session.state !== "approved") throw new Error("session-not-authorized");
      if (sockets.get(record.hostId)?.readyState !== WebSocket.OPEN) {
        throw new HostRequestError("host-offline", "ホストPCが接続していません");
      }
      // The returned view deliberately contains no secret, host ID, or local path.
      void record;
      return { sessionId, session, hostId: record.hostId };
    } catch (error) {
      sendError(reply, error);
      return undefined;
    }
  };

  const readHostOperation = async (
    hostId: string,
    serverId: string,
    participantId: string,
    operationId: string,
    contentHash?: string,
  ): Promise<CoManagementOperationResult> => {
    const result = await sendHostRequest(
      hostId,
      serverId,
      participantId,
      { type: "operation.get" },
      operationId,
      contentHash,
    );
    assertNoSensitiveKeys(result);
    const operation = parseHostOperationStatus(result, operationId);
    if (operation.state === "completed") assertNoSensitiveKeys(operation.result);
    return operation;
  };

  app.post("/api/v1/hosts/register", async (request, reply) => {
    if (!await rateLimit(request, reply)) return;
    if (!originAllowed(request, allowedOrigins, true)) {
      reply.code(403).send({ error: "origin-not-allowed" });
      return;
    }
    const body = asObject(request.body);
    if (!body || !onlyKeys(body, ["hostId", "token", "protocolVersion"]) || !safeId(body.hostId) || !text(body.token, 32, 256) || body.protocolVersion !== 1) {
      reply.code(400).send({ error: "invalid-host-registration" });
      return;
    }
    try {
      await store.registerHost(body.hostId, body.token);
      reply.code(204).send();
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.post("/api/v1/invites/redeem", async (request, reply) => {
    if (!await rateLimit(request, reply) || !requireBrowserRequest(request, reply, allowedOrigins)) return;
    const body = asObject(request.body);
    if (!body || !onlyKeys(body, ["secret", "displayName"]) || !text(body.secret, 43, 256) || !text(body.displayName, 1, 32)) {
      reply.code(400).send({ error: "invalid-invite-redemption" });
      return;
    }
    try {
      const redeemed = await store.redeemInvite(body.secret, body.displayName);
      const delivery = sendHostEvent(redeemed.session.hostId, redeemed.pendingEvent);
      if (delivery === "rejected") {
        throw new RelayError(503, "host-notification-unavailable");
      }
      const session = await store.sessionView(redeemed.session.sessionId);
      if (!session) throw new RelayError(500, "session-creation-failed");
      setSessionCookies(reply, redeemed.session.sessionId, redeemed.session.csrfToken, secureCookies);
      reply.send({ session, csrfToken: redeemed.session.csrfToken, joinCode: redeemed.session.joinCode });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get("/api/v1/session", async (request, reply) => {
    if (!await rateLimit(request, reply) || !requireBrowserRequest(request, reply, allowedOrigins, true)) return;
    const sessionId = sessionIdFrom(request);
    const session = sessionId ? await store.sessionView(sessionId, isUserActivity(request)) : undefined;
    if (!session) {
      reply.code(401).send({ error: "session-required" });
      return;
    }
    reply.send({ session });
  });

  app.post("/api/v1/session/close", async (request, reply) => {
    if (!await rateLimit(request, reply) || !requireBrowserRequest(request, reply, allowedOrigins)) return;
    const sessionId = await requireCsrf(request, reply, store);
    if (!sessionId) return;
    await store.closeSession(sessionId);
    clearSessionCookies(reply, secureCookies);
    reply.code(204).send();
  });

  app.get<{ Params: { serverId: string } }>("/api/v1/servers/:serverId/summary", async (request, reply) => {
    if (!await rateLimit(request, reply) || !requireBrowserRequest(request, reply, allowedOrigins, true)) return;
    if (!safeId(request.params.serverId)) {
      reply.code(400).send({ error: "invalid-server-id" });
      return;
    }
    const authorization = await requireAuthorizedSession(request, reply, request.params.serverId, "viewer");
    if (!authorization) return;
    const participant = await store.participant(authorization.hostId, authorization.session.participantId);
    if (!participant) {
      reply.code(403).send({ error: "session-not-authorized" });
      return;
    }
    const snapshot = await store.snapshot(participant.hostId, request.params.serverId);
    if (!snapshot) {
      reply.code(503).send({ error: "host-offline" });
      return;
    }
    reply.send({ snapshot });
  });

  app.get<{ Params: { serverId: string } }>("/api/v1/servers/:serverId/settings", async (request, reply) => {
    if (!await rateLimit(request, reply) || !requireBrowserRequest(request, reply, allowedOrigins, true)) return;
    if (!safeId(request.params.serverId)) {
      reply.code(400).send({ error: "invalid-server-id" });
      return;
    }
    const authorization = await requireAuthorizedSession(request, reply, request.params.serverId, "viewer");
    if (!authorization) return;
    const participant = await store.participant(authorization.hostId, authorization.session.participantId);
    if (!participant) {
      reply.code(403).send({ error: "session-not-authorized" });
      return;
    }
    try {
      const result = await sendHostRequest(
        participant.hostId,
        request.params.serverId,
        participant.participantId,
        { type: "settings.get" },
      );
      assertNoSensitiveKeys(result);
      reply.send({ settings: result });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.patch<{ Params: { serverId: string } }>("/api/v1/servers/:serverId/settings", async (request, reply) => {
    if (!await rateLimit(request, reply) || !requireBrowserRequest(request, reply, allowedOrigins)) return;
    if (!safeId(request.params.serverId)) {
      reply.code(400).send({ error: "invalid-server-id" });
      return;
    }
    const sessionId = await requireCsrf(request, reply, store);
    if (!sessionId) return;
    let authorization: { sessionId: string; session: SessionView; hostId: string } | undefined;
    try {
      const record = await store.authorize(sessionId, request.params.serverId, "editor", true);
      const session = await store.sessionView(sessionId);
      if (!session) throw new Error("session-not-authorized");
      authorization = { sessionId, session, hostId: record.hostId };
    } catch (error) {
      sendError(reply, error);
      return;
    }
    const body = asObject(request.body);
    if (!body || !onlyKeys(body, ["requestId", "expectedRevision", "changes"]) || !requestId(body.requestId) || !Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 1) {
      reply.code(400).send({ error: "invalid-settings-request" });
      return;
    }
    const changes = validateChanges(body.changes);
    const participant = await store.participant(authorization.hostId, authorization.session.participantId);
    if (!participant) {
      reply.code(403).send({ error: "session-not-authorized" });
      return;
    }
    const auditSuccess = settingsAudit(participant, request.params.serverId, body.requestId as string, Object.keys(changes), "success");
    const auditFailure = settingsAudit(participant, request.params.serverId, body.requestId as string, Object.keys(changes), "failure");
    const contentHash = operationContentHash(
      request.params.serverId,
      participant.participantId,
      body.expectedRevision as number,
      changes,
    );
    const existing = await store.operation(participant.hostId, request.params.serverId, participant.participantId, body.requestId);
    if (existing) {
      if (existing.contentHash && existing.contentHash !== contentHash) {
        reply.code(409).send({ error: "request-id-reused" });
        return;
      }
      if (existing.state === "completed") {
        reply.send({ result: existing.result });
        return;
      }
      if (existing.state === "failed") {
        reply.code(502).send({ error: existing.errorCode ?? "host-operation-failed" });
        return;
      }
      // The first response was lost or timed out. Ask the host for the
      // result; do not send a second settings.patch operation.
      try {
        const hostOperation = await readHostOperation(
          participant.hostId,
          request.params.serverId,
          participant.participantId,
          body.requestId,
          contentHash,
        );
        if (hostOperation.state === "running") {
          reply.code(202).send({ operation: existing });
          return;
        }
        if (hostOperation.state === "failed") {
          const operation = await store.saveOperation({
            requestId: body.requestId,
            serverId: request.params.serverId,
            hostId: participant.hostId,
            participantId: participant.participantId,
            contentHash,
            state: "failed",
            errorCode: hostOperation.errorCode ?? "host-operation-failed",
            updatedAt: new Date().toISOString(),
          }, auditFailure);
          reply.code(502).send({ error: operation.errorCode ?? "host-operation-failed" });
          return;
        }
        const operation = await store.saveOperation({
          requestId: body.requestId,
          serverId: request.params.serverId,
          hostId: participant.hostId,
          participantId: participant.participantId,
          contentHash,
          state: "completed",
          result: hostOperation.result,
          updatedAt: new Date().toISOString(),
        }, auditSuccess);
        reply.send({ result: operation.result });
      } catch (error) {
        if (error instanceof HostRequestError && error.code === "host-timeout") {
          reply.code(202).send({ operation: existing });
          return;
        }
        sendError(reply, error);
      }
      return;
    }
    await store.saveOperation({
      requestId: body.requestId,
      serverId: request.params.serverId,
      hostId: participant.hostId,
      participantId: participant.participantId,
      contentHash,
      state: "running",
      updatedAt: new Date().toISOString(),
    });
    try {
      const result = await sendHostRequest(
        participant.hostId,
        request.params.serverId,
        participant.participantId,
        {
          type: "settings.patch",
          role: "editor",
          expectedRevision: body.expectedRevision,
          changes,
        },
        body.requestId,
        contentHash,
        auditSuccess,
      );
      assertNoSensitiveKeys(result);
      await store.saveOperation({
        requestId: body.requestId,
        serverId: request.params.serverId,
        hostId: participant.hostId,
        participantId: participant.participantId,
        contentHash,
        state: "completed",
        result,
        updatedAt: new Date().toISOString(),
      }, auditSuccess);
      reply.send({ result });
    } catch (error) {
      if (error instanceof HostRequestError && error.code === "host-timeout") {
        await store.saveOperation({
          requestId: body.requestId,
          serverId: request.params.serverId,
          hostId: participant.hostId,
          participantId: participant.participantId,
          contentHash,
          state: "running",
          updatedAt: new Date().toISOString(),
        });
      }
      sendError(reply, error);
    }
  });

  app.get<{ Params: { serverId: string } }>("/api/v1/servers/:serverId/audit", async (request, reply) => {
    if (!await rateLimit(request, reply) || !requireBrowserRequest(request, reply, allowedOrigins, true)) return;
    if (!safeId(request.params.serverId)) {
      reply.code(400).send({ error: "invalid-server-id" });
      return;
    }
    const authorization = await requireAuthorizedSession(request, reply, request.params.serverId, "viewer");
    if (!authorization) return;
    const participant = await store.participant(authorization.hostId, authorization.session.participantId);
    if (!participant) {
      reply.code(403).send({ error: "session-not-authorized" });
      return;
    }
    try {
      const result = await sendHostRequest(
        participant.hostId,
        request.params.serverId,
        participant.participantId,
        { type: "audit.get" },
      );
      assertNoSensitiveKeys(result);
      if (!Array.isArray(result)) {
        throw new HostRequestError("host-response-invalid", "ホスト応答の監査ログ形式が不正です");
      }
      reply.send({ entries: result });
    } catch (error) {
      sendError(reply, error);
    }
  });

  app.get<{ Params: { requestId: string } }>("/api/v1/operations/:requestId", async (request, reply) => {
    if (!await rateLimit(request, reply) || !requireBrowserRequest(request, reply, allowedOrigins, true)) return;
    if (!requestId(request.params.requestId)) {
      reply.code(400).send({ error: "invalid-request-id" });
      return;
    }
    const sessionId = sessionIdFrom(request);
    if (!sessionId) {
      reply.code(401).send({ error: "session-required" });
      return;
    }
    const session = await store.sessionView(sessionId, false);
    if (!session || session.state !== "approved") {
      reply.code(403).send({ error: "session-not-authorized" });
      return;
    }
    let hostId: string;
    try {
      hostId = (await store.authorize(sessionId, session.serverId, "viewer", isUserActivity(request))).hostId;
    } catch (error) {
      sendError(reply, error);
      return;
    }
    const participant = await store.participant(hostId, session.participantId);
    if (!participant) {
      reply.code(403).send({ error: "session-not-authorized" });
      return;
    }
    const existing = await store.operation(participant.hostId, session.serverId, participant.participantId, request.params.requestId);
    if (existing) {
      if (existing.state !== "running") {
        reply.send({ operation: existing });
        return;
      }
    }
    try {
      const hostOperation = await readHostOperation(
        participant.hostId,
        session.serverId,
        participant.participantId,
        request.params.requestId,
        existing?.contentHash,
      );
      if (hostOperation.state === "running") {
        if (existing) reply.code(202).send({ operation: existing });
        else reply.code(202).send({ operation: { requestId: request.params.requestId, state: "running" } });
        return;
      }
      const operation = await store.saveOperation({
        requestId: request.params.requestId,
        serverId: session.serverId,
        hostId: participant.hostId,
        participantId: participant.participantId,
        contentHash: existing?.contentHash,
        state: hostOperation.state,
        result: hostOperation.state === "completed" ? hostOperation.result : undefined,
        errorCode: hostOperation.state === "failed" ? hostOperation.errorCode ?? "host-operation-failed" : undefined,
        updatedAt: new Date().toISOString(),
      }, {
        hostId: participant.hostId,
        serverId: session.serverId,
        actorId: participant.participantId,
        actorDisplayName: participant.displayName,
        action: "settings.patch",
        changedKeys: [],
        result: hostOperation.state === "completed" ? "success" : "failure",
        requestId: request.params.requestId,
        at: new Date().toISOString(),
      });
      reply.send({ operation });
    } catch (error) {
      if (error instanceof HostRequestError && error.code === "host-timeout" && existing) {
        reply.code(202).send({ operation: existing });
        return;
      }
      sendError(reply, error);
    }
  });

  app.setNotFoundHandler(async (request, reply) => {
    const staticDir = options.staticDir;
    if (staticDir && !request.url.startsWith("/api/") && !request.url.startsWith("/ws/")) {
      try {
        const pathname = decodeURIComponent(new URL(request.url, "http://relay.local").pathname);
        const relativePath = pathname === "/" || !pathname.includes(".") ? "index.html" : pathname.replace(/^\/+/u, "");
        const root = resolve(staticDir);
        const target = resolve(root, relativePath);
        const check = relative(root, target);
        if (check && check !== ".." && !check.startsWith("../") && !isAbsolute(check)) {
          const body = await fs.readFile(target);
          const extension = target.split(".").pop()?.toLowerCase();
          const types: Record<string, string> = {
            html: "text/html; charset=utf-8",
            js: "text/javascript; charset=utf-8",
            css: "text/css; charset=utf-8",
            svg: "image/svg+xml",
            png: "image/png",
          };
          reply.type(types[extension ?? ""] ?? "application/octet-stream").send(body);
          return;
        }
      } catch {
        // Fall through to the generic 404 without returning filesystem details.
      }
    }
    reply.code(404).send({ error: "not-found" });
  });

  const rejectUpgrade = (socket: Socket, status: number, reason: string): void => {
    if (socket.destroyed) return;
    const body = `${reason}\n`;
    const statusText = status === 429 ? "Too Many Requests" : "Service Unavailable";
    socket.write(`HTTP/1.1 ${status} ${statusText}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
    socket.destroy();
  };

  const upgradeClientIdentifier = (_request: IncomingMessage, socket: Socket): string => {
    // The upgrade limiter intentionally keys on the TCP peer. Unlike Fastify's
    // request.ip, this cannot be changed by a client-supplied forwarded header.
    return socket.remoteAddress ?? "unknown";
  };

  const upgradeHandler = (request: import("node:http").IncomingMessage, socket: Socket, head: Buffer) => {
    const pathname = new URL(request.url ?? "/", "http://relay.local").pathname;
    if (pathname !== "/ws/host") {
      socket.destroy();
      return;
    }
    const token = request.headers.authorization?.startsWith("Bearer ")
      ? request.headers.authorization.slice("Bearer ".length).trim()
      : undefined;
    if (!token || token.length < 32) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    if (connectedSockets.size + pendingUpgradeSockets.size >= maxWebSocketConnections
      || preAuthSockets.size + pendingUpgradeSockets.size >= maxPreAuthWebSocketConnections) {
      rejectUpgrade(socket, 503, "websocket-capacity");
      return;
    }
    pendingUpgradeSockets.add(socket);
    const releaseUpgrade = () => {
      pendingUpgradeSockets.delete(socket);
      socket.off("close", releaseUpgrade);
      socket.off("error", releaseUpgrade);
    };
    socket.once("close", releaseUpgrade);
    socket.once("error", releaseUpgrade);
    void (async () => {
      try {
        const allowed = await websocketUpgradeRateLimiter.consume(
          upgradeClientIdentifier(request, socket),
          maxWebSocketUpgradeAttempts,
          60_000,
        );
        if (!allowed) {
          releaseUpgrade();
          rejectUpgrade(socket, 429, "websocket-rate-limit");
          return;
        }
        if (socket.destroyed) {
          releaseUpgrade();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
          releaseUpgrade();
          wss.emit("connection", ws, request, token);
        });
      } catch {
        releaseUpgrade();
        socket.destroy();
      }
    })();
  };
  app.server.on("upgrade", upgradeHandler);

  wss.on("connection", (ws: WebSocket, request: IncomingMessage, token: string) => {
    let authenticatedHostId: string | undefined;
    connectedSockets.add(ws);
    preAuthSockets.add(ws);
    const authTimer = setTimeout(() => {
      if (!authenticatedHostId) ws.terminate();
    }, 5_000);
    socketAlive.set(ws, true);
    ws.on("pong", () => socketAlive.set(ws, true));
    ws.on("error", () => undefined);
    const handleMessage = async (data: RawData): Promise<void> => {
      const raw = rawDataBuffer(data).toString("utf8");
      if (Buffer.byteLength(raw, "utf8") > MAX_WS_BYTES) {
        ws.terminate();
        return;
      }
      let payload: JsonObject;
      try {
        const parsed: unknown = JSON.parse(raw);
        const object = asObject(parsed);
        if (!object) throw new Error("not-object");
        payload = object;
      } catch {
        ws.terminate();
        return;
      }
      const type = payload.type;
      if (payload.protocolVersion !== 1 || typeof type !== "string") {
        ws.terminate();
        return;
      }
      if (!authenticatedHostId) {
        if (type !== "host.hello" || !safeId(payload.hostId) || !safeId(payload.serverId)) {
          ws.terminate();
          return;
        }
        try {
          if (!await store.verifyHost(payload.hostId, token)) {
            ws.terminate();
            return;
          }
          await store.bindHostServer(payload.hostId, payload.serverId);
        } catch (error) {
          if (error instanceof RelayStorageUnavailableError) {
            ws.terminate();
            return;
          }
          ws.terminate();
          return;
        }
        authenticatedHostId = payload.hostId;
        preAuthSockets.delete(ws);
        clearTimeout(authTimer);
        const previous = sockets.get(authenticatedHostId);
        if (previous && previous !== ws) previous.close(1008, "replaced");
        sockets.set(authenticatedHostId, ws);
        ws.send(JSON.stringify({
          type: "host.ready",
          protocolVersion: 1,
          hostId: authenticatedHostId,
          serverId: payload.serverId,
        }));
        const queue = removeQueuedHostEvents(authenticatedHostId);
        for (let index = 0; index < queue.length; index += 1) {
          const item = queue[index];
          if (item.expiresAtMs <= Date.now()) continue;
          if (item.payload.type === "participant.pending") {
            const participantId = typeof item.payload.participantId === "string" ? item.payload.participantId : "";
            const participant = participantId ? await store.participant(authenticatedHostId, participantId) : undefined;
            if (!participant
              || participant.serverId !== payload.serverId
              || participant.state !== "pending"
              || !Number.isFinite(Date.parse(participant.pendingExpiresAt))
              || Date.parse(participant.pendingExpiresAt) <= Date.now()) {
              continue;
            }
          }
          const serialized = JSON.stringify(item.payload);
          if (!sendBoundedHostEvent(ws, serialized, Buffer.byteLength(serialized, "utf8"))) break;
        }
        return;
      }
      if (type === "host.ping") {
        try {
          await store.touchHost(authenticatedHostId);
        } catch (error) {
          if (error instanceof RelayStorageUnavailableError) {
            ws.terminate();
            return;
          }
        }
        ws.send(JSON.stringify({ type: "host.pong", protocolVersion: 1 }));
        return;
      }
      const serverId = typeof payload.serverId === "string" ? payload.serverId : "";
      let ownsServer = false;
      try {
        ownsServer = safeId(serverId) && await store.hostOwnsServer(authenticatedHostId, serverId);
      } catch (error) {
        if (error instanceof RelayStorageUnavailableError) {
          ws.terminate();
          return;
        }
      }
      if (!ownsServer) {
        ws.close(1008, "server-binding-failed");
        return;
      }
      try {
        if (type === "invite.register") {
          if (!safeId(payload.inviteId) || !isCoManagementRole(payload.role) || !text(payload.secretHash, 64, 64) || !/^[a-f0-9]{64}$/iu.test(payload.secretHash) || !text(payload.expiresAt, 20, 40)) {
            throw new RelayError(400, "invalid-invite-register");
          }
          await store.registerInvite({
            inviteId: payload.inviteId,
            serverId,
            hostId: authenticatedHostId,
            secretHash: payload.secretHash,
            role: payload.role,
            expiresAt: payload.expiresAt,
          });
          ws.send(JSON.stringify({ type: "invite.registered", protocolVersion: 1, inviteId: payload.inviteId }));
        } else if (type === "host.snapshot") {
          if (!isSafePublicSnapshot(payload.snapshot) || (payload.snapshot as PublicServerSnapshot).serverId !== serverId) {
            throw new RelayError(400, "invalid-snapshot");
          }
          await store.setSnapshot(authenticatedHostId, payload.snapshot as PublicServerSnapshot);
        } else if (type === "host.response") {
          if (!requestId(payload.requestId) || typeof payload.ok !== "boolean") {
            throw new RelayError(400, "invalid-host-response");
          }
          const response = payload as unknown as HostResponse;
          const waiting = pending.get(response.requestId);
          if (!waiting || waiting.hostId !== authenticatedHostId || waiting.serverId !== serverId) return;
          clearTimeout(waiting.timeoutTimer);
          clearTimeout(waiting.cleanupTimer);
          pending.delete(response.requestId);
          assertNoSensitiveKeys(response.result);
          if (waiting.operationId) {
            try {
              await store.saveOperation(operationRecord(waiting, response), waiting.audit);
            } catch (error) {
              waiting.reject(error instanceof Error ? error : new RelayStorageUnavailableError(error));
              throw error;
            }
          }
          if (response.ok) waiting.resolve(response.result);
          else waiting.reject(new HostRequestError(response.errorCode ?? "host-operation-failed", "ホストPCで操作を完了できませんでした"));
        } else if (type === "participant.approved" || type === "participant.revoked") {
          if (!safeId(payload.participantId)) throw new RelayError(400, "invalid-participant");
          const participant = await store.participant(authenticatedHostId, payload.participantId);
          if (!participant || participant.hostId !== authenticatedHostId || participant.serverId !== serverId) {
            throw new RelayError(403, "participant-binding-failed");
          }
          if (type === "participant.approved") await store.approveParticipant(authenticatedHostId, serverId, participant.participantId);
          else await store.revokeParticipant(authenticatedHostId, serverId, participant.participantId);
          await store.appendAudit({
            hostId: authenticatedHostId,
            serverId,
            actorId: authenticatedHostId,
            actorDisplayName: "Host",
            action: type,
            changedKeys: [],
            result: "success",
          });
        } else {
          throw new RelayError(1008, "message-not-allowed");
        }
      } catch (error) {
        if (error instanceof RelayStorageUnavailableError) {
          ws.close(1013, "relay-storage-unavailable");
          return;
        }
        if (error instanceof RelayError && error.statusCode < 1000 && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "host.error", protocolVersion: 1, code: error.code }));
        }
      }
    };
    const messageQueue: InboundWebSocketMessage[] = [];
    let queuedMessageBytes = 0;
    let activeMessageBytes = 0;
    let processingMessages = false;
    const processMessageQueue = async (): Promise<void> => {
      if (processingMessages) return;
      processingMessages = true;
      try {
        while (messageQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
          const item = messageQueue.shift()!;
          queuedMessageBytes -= item.bytes;
          activeMessageBytes = item.bytes;
          try {
            await handleMessage(item.data);
          } finally {
            activeMessageBytes = 0;
          }
        }
      } finally {
        messageQueue.length = 0;
        queuedMessageBytes = 0;
        activeMessageBytes = 0;
        processingMessages = false;
      }
    };
    ws.on("message", (data: RawData) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const bytes = rawDataBuffer(data).byteLength;
      const pendingMessages = messageQueue.length + (processingMessages ? 1 : 0);
      if (pendingMessages >= maxInboundWebSocketMessages
        || queuedMessageBytes + activeMessageBytes + bytes > maxInboundWebSocketBytes) {
        ws.terminate();
        return;
      }
      messageQueue.push({ data, bytes });
      queuedMessageBytes += bytes;
      void processMessageQueue().catch(() => {
        if (ws.readyState === WebSocket.OPEN) ws.terminate();
      });
    });
    ws.on("close", () => {
      clearTimeout(authTimer);
      socketAlive.delete(ws);
      connectedSockets.delete(ws);
      preAuthSockets.delete(ws);
      messageQueue.length = 0;
      queuedMessageBytes = 0;
      activeMessageBytes = 0;
      if (authenticatedHostId && sockets.get(authenticatedHostId) === ws) {
        sockets.delete(authenticatedHostId);
        removeQueuedHostEvents(authenticatedHostId);
        void Promise.resolve(store.disconnectHost(authenticatedHostId)).catch(() => undefined);
      }
    });
  });

  const heartbeat = setInterval(() => {
    pruneQueuedHostEvents();
    for (const socket of connectedSockets) {
      if (socketAlive.get(socket) === false) {
        socket.terminate();
        continue;
      }
      socketAlive.set(socket, false);
      socket.ping();
    }
    for (const [hostId, socket] of sockets) {
      void Promise.resolve(store.touchHost(hostId)).catch(() => {
        if (socket.readyState === WebSocket.OPEN) socket.terminate();
      });
    }
  }, 30_000);

  return {
    app,
    store,
    async start(port = configuredPort(), host = process.env.MSH_CO_MANAGEMENT_HOST ?? "127.0.0.1") {
      await app.listen({ port, host });
      return "http://" + host + ":" + port;
    },
    async close() {
      clearInterval(heartbeat);
      for (const socket of connectedSockets) socket.terminate();
      for (const socket of pendingUpgradeSockets) socket.destroy();
      sockets.clear();
      queuedHostEvents.clear();
      queuedHostEventCount = 0;
      queuedHostEventBytes = 0;
      wss.close();
      for (const item of pending.values()) {
        clearTimeout(item.timeoutTimer);
        clearTimeout(item.cleanupTimer);
        item.reject(new HostRequestError("relay-closed", "中継が停止しました"));
      }
      pending.clear();
      connectedSockets.clear();
      preAuthSockets.clear();
      pendingUpgradeSockets.clear();
      socketAlive.clear();
      await app.close();
      await options.onClose?.();
    },
  };
}

async function main(): Promise<void> {
  assertRelayRuntimeConfiguration();
  const staticDir = process.env.MSH_CO_MANAGEMENT_UI_DIR
    ? resolve(process.env.MSH_CO_MANAGEMENT_UI_DIR)
    : resolve(fileURLToPath(new URL("../../browser/dist", import.meta.url)));
  const databaseUrl = process.env.MSH_CO_MANAGEMENT_DATABASE_URL;
  let pool: Pool | undefined;
  let store: RelayStore | undefined;
  let rateLimiter: SharedRateLimiter | undefined;
  if (databaseUrl) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: Number(process.env.MSH_CO_MANAGEMENT_DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000,
      application_name: "minecraft-server-hub-co-management-relay",
      ssl: postgresSslConfiguration(),
    });
    await verifyMigrations(pool);
    const keyring = RelayKeyring.fromEnvironment(process.env.MSH_CO_MANAGEMENT_RELAY_KEYS);
    store = new PostgresRelayStore(pool, keyring);
    rateLimiter = new PostgresRateLimiter(pool);
  }
  const relay = createRelayServer({
    store,
    rateLimiter,
    staticDir,
    allowedOrigins: (process.env.MSH_CO_MANAGEMENT_ALLOWED_ORIGINS ?? "http://127.0.0.1:8787,http://localhost:8787,http://127.0.0.1:8788,http://localhost:8788")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    secureCookies: process.env.NODE_ENV === "production",
    trustProxy: process.env.MSH_CO_MANAGEMENT_TRUST_PROXY === "1",
    hstsMaxAgeSeconds: Number(process.env.MSH_CO_MANAGEMENT_HSTS_MAX_AGE ?? 0),
    maxWebSocketUpgradeAttempts: Number(process.env.MSH_CO_MANAGEMENT_MAX_WEBSOCKET_UPGRADE_ATTEMPTS ?? MAX_WEBSOCKET_UPGRADE_ATTEMPTS),
    maxHostEventBufferedBytes: Number(process.env.MSH_CO_MANAGEMENT_MAX_HOST_EVENT_BUFFERED_BYTES ?? MAX_HOST_EVENT_BUFFERED_BYTES),
    readinessCheck: pool ? async () => { await pool!.query("SELECT 1"); } : undefined,
    onClose: pool ? async () => { await pool!.end(); } : undefined,
  });
  const base = await relay.start();
  console.log("Minecraft Server Hub co-management relay listening at " + base);
  console.log(databaseUrl ? "PostgreSQL persistence and shared rate limiting enabled." : "Local development mode: in-memory relay store.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error) => {
    console.error("Relay startup failed:", error instanceof Error ? error.message : "unknown");
    process.exitCode = 1;
  });
}
