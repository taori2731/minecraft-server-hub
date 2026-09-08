export const CO_MANAGEMENT_PROTOCOL_VERSION = 1 as const;

export type CoManagementRole = "viewer" | "editor";
export type ParticipantState = "pending" | "approved" | "revoked";

export interface CoManagementCapability {
  key: string;
  valueType: "string" | "boolean" | "integer" | "number";
  editableWhenStopped: boolean;
  min?: number;
  max?: number;
  enumValues?: string[];
}

export interface PublicServerSnapshot {
  serverId: string;
  serverName: string;
  gameKind: "java" | "bedrock" | "palworld" | string;
  state: "stopped" | "starting" | "running" | "stopping" | "crashed" | string;
  playerCount: number;
  maxPlayers: number;
  fetchedAt: string;
  revision: number;
  capabilities: CoManagementCapability[];
}

export interface SettingsSnapshot {
  serverId: string;
  gameKind: string;
  state: string;
  revision: number;
  fetchedAt: string;
  fields: Record<string, string | number | boolean>;
  capabilities: CoManagementCapability[];
  editable: boolean;
}

export type CoManagementSettingsSnapshot = SettingsSnapshot;

export interface CoManagementAuditEntry {
  id: string;
  at: string;
  actorId: string;
  actorDisplayName: string;
  action: string;
  changes: unknown;
  result: string;
  requestId?: string;
}

export interface CoManagementApplyResult {
  requestId: string;
  serverId: string;
  revision: number;
  changedFields: string[];
  settings: SettingsSnapshot;
  message: string;
}

export interface CoManagementOperationResult {
  requestId: string;
  state: "running" | "completed" | "failed";
  result?: unknown;
  errorCode?: string;
}

export interface ParticipantView {
  id: string;
  displayName: string;
  role: CoManagementRole;
  state: ParticipantState;
  expiresAt: string;
}

export interface SessionView {
  state: "pending" | "approved" | "revoked" | "expired";
  participantId: string;
  serverId: string;
  role: CoManagementRole;
  displayName: string;
  expiresAt: string;
  joinCode?: string;
  server?: PublicServerSnapshot;
}

export interface RedeemResponse {
  session: SessionView;
  csrfToken: string;
  joinCode: string;
}

export interface HostPendingEvent {
  type: "participant.pending";
  protocolVersion: typeof CO_MANAGEMENT_PROTOCOL_VERSION;
  serverId: string;
  participantId: string;
  displayName: string;
  role: CoManagementRole;
  joinCode: string;
  expiresAt: string;
}

export interface HostRequest {
  type: "summary.get" | "settings.get" | "settings.patch" | "audit.get" | "operation.get";
  protocolVersion: typeof CO_MANAGEMENT_PROTOCOL_VERSION;
  /** Relay-generated transport correlation. */
  requestId: string;
  /** Browser operation identity, used only for idempotent settings operations. */
  operationId?: string;
  serverId: string;
  participantId: string;
  role?: CoManagementRole;
  expectedRevision?: number;
  changes?: Record<string, string | number | boolean>;
}

export interface HostResponse {
  type: "host.response";
  protocolVersion: typeof CO_MANAGEMENT_PROTOCOL_VERSION;
  serverId: string;
  requestId: string;
  ok: boolean;
  result?: unknown;
  errorCode?: string;
  errorMessage?: string;
}

export function isCoManagementRole(value: unknown): value is CoManagementRole {
  return value === "viewer" || value === "editor";
}

export function isSafePublicSnapshot(value: unknown): value is PublicServerSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  const allowed = new Set(["serverId", "serverName", "gameKind", "state", "playerCount", "maxPlayers", "fetchedAt", "revision", "capabilities"]);
  if (!Object.keys(snapshot).every((name) => allowed.has(name))) return false;
  const safeText = (candidate: unknown, max: number): candidate is string => typeof candidate === "string"
    && candidate.length > 0
    && candidate.length <= max
    && !/[\u0000-\u001f\u007f]/u.test(candidate);
  const safeCapability = (candidate: unknown): candidate is CoManagementCapability => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const capability = candidate as Record<string, unknown>;
    const keys = new Set(["key", "valueType", "editableWhenStopped", "min", "max", "enumValues"]);
    if (!Object.keys(capability).every((name) => keys.has(name))) return false;
    if (!safeText(capability.key, 64)
      || !["string", "boolean", "integer", "number"].includes(String(capability.valueType))
      || typeof capability.editableWhenStopped !== "boolean") return false;
    if (capability.min !== undefined && (typeof capability.min !== "number" || !Number.isFinite(capability.min))) return false;
    if (capability.max !== undefined && (typeof capability.max !== "number" || !Number.isFinite(capability.max))) return false;
    if (typeof capability.min === "number" && typeof capability.max === "number" && capability.min > capability.max) return false;
    return capability.enumValues === undefined
      || (Array.isArray(capability.enumValues)
        && capability.enumValues.length <= 32
        && capability.enumValues.every((item) => safeText(item, 64)));
  };
  return safeText(snapshot.serverId, 128)
    && safeText(snapshot.serverName, 128)
    && ["java", "bedrock", "palworld"].includes(String(snapshot.gameKind))
    && ["stopped", "starting", "running", "stopping", "crashed"].includes(String(snapshot.state))
    && typeof snapshot.playerCount === "number" && Number.isInteger(snapshot.playerCount) && snapshot.playerCount >= 0 && snapshot.playerCount <= 10_000
    && typeof snapshot.maxPlayers === "number" && Number.isInteger(snapshot.maxPlayers) && snapshot.maxPlayers >= 0 && snapshot.maxPlayers <= 10_000
    && typeof snapshot.fetchedAt === "string" && snapshot.fetchedAt.length <= 40 && Number.isFinite(Date.parse(snapshot.fetchedAt))
    && typeof snapshot.revision === "number" && Number.isInteger(snapshot.revision) && snapshot.revision >= 1
    && Array.isArray(snapshot.capabilities) && snapshot.capabilities.length <= 32 && snapshot.capabilities.every(safeCapability);
}
