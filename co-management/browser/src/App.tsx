import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CoManagementApplyResult,
  CoManagementCapability,
  CoManagementAuditEntry,
  CoManagementOperationResult,
  CoManagementSettingsSnapshot,
} from "../../shared/protocol.ts";
import type { PublicServerSnapshot, SessionView } from "../../shared/protocol.ts";
import { coManagementMessages, intlLocaleForCoManagement, LanguagePicker, useCoManagementI18n, type CoManagementMessages } from "./i18n";

type Primitive = string | number | boolean;
type Fields = Record<string, Primitive>;

interface ApiErrorShape {
  status: number;
  code: string;
}

class ApiError extends Error implements ApiErrorShape {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

interface WindowWithConfig extends Window {
  __MSH_CO_MANAGEMENT_API_BASE__?: string;
}

const apiBase = (): string => {
  const configured = (window as WindowWithConfig).__MSH_CO_MANAGEMENT_API_BASE__;
  return (configured || window.location.origin).replace(/\/$/u, "");
};

function csrfCookie(): string | undefined {
  const cookie = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith("msh_co_csrf="));
  return cookie ? decodeURIComponent(cookie.slice("msh_co_csrf=".length)) : undefined;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const method = (init.method ?? "GET").toUpperCase();
  if (["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
    const csrf = csrfCookie();
    if (csrf) headers.set("x-csrf-token", csrf);
  }
  const response = await fetch(`${apiBase()}${path}`, { ...init, headers, credentials: "include" });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const code = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : "relay-operation-failed";
    throw new ApiError(response.status, code);
  }
  return payload as T;
}

function inviteFromUrl(): string | undefined {
  const hash = window.location.hash.replace(/^#/u, "");
  const params = new URLSearchParams(hash);
  const secret = params.get("invite")?.trim();
  if (secret) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return secret || undefined;
}

function errorText(error: unknown, messages: CoManagementMessages = coManagementMessages.ja): string {
  if (error instanceof ApiError) {
    if (error.status === 409 || error.code.includes("conflict")) return messages.errorConflict;
    if (error.code === "host-offline" || error.code === "host-timeout" || error.code === "host-send-failed") return messages.errorHostOffline;
    if (error.code === "editor-required") return messages.errorEditorRequired;
    if (error.code === "session-not-authorized" || error.code === "session-required") return messages.errorSession;
    if (error.code === "csrf-failed") return messages.errorCsrf;
    if (error.code === "invite-invalid-or-expired") return messages.errorInvite;
    return messages.errorRelay;
  }
  return messages.errorNetwork;
}

function gameLabel(kind: string, messages: CoManagementMessages = coManagementMessages.ja): string {
  return kind === "palworld" ? "Palworld" : kind === "bedrock" ? "Minecraft Bedrock" : "Minecraft Java";
}

function stateLabel(state: string, messages: CoManagementMessages = coManagementMessages.ja): string {
  return state === "running" ? messages.online : state === "starting" ? messages.stateStarting : state === "stopping" ? messages.stateStopping : state === "crashed" ? messages.stateCrashed : messages.stateStopped;
}

function formatTime(value: string, locale: Parameters<typeof intlLocaleForCoManagement>[0] = "ja"): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(intlLocaleForCoManagement(locale), { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function fieldLabel(key: string, messages: CoManagementMessages = coManagementMessages.ja): string {
  return messages.fieldLabels[key] ?? key;
}

function fieldSuffix(key: string, messages: CoManagementMessages = coManagementMessages.ja): string {
  return messages.fieldSuffixes[key] ?? "";
}

export function formatFieldValue(key: string, value: Primitive | undefined, messages: CoManagementMessages = coManagementMessages.ja): string {
  if (value === undefined) return messages.notSet;
  if (typeof value === "boolean") return value ? messages.enabled : messages.disabled;
  const suffix = fieldSuffix(key, messages);
  return suffix ? `${String(value)} ${suffix}` : String(value);
}

function enumOptionLabel(key: string, option: string, messages: CoManagementMessages): string {
  return messages.enumLabels[key]?.[option] ?? option;
}

function actionLabel(action: string, messages: CoManagementMessages = coManagementMessages.ja): string {
  return messages.actionLabels[action] ?? action;
}

function Glyph({ name, size = 20 }: { name: "server" | "settings" | "audit" | "users" | "shield" | "check" | "clock" | "close" | "arrow"; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    server: <><rect x="3" y="3" width="18" height="7" rx="2" /><rect x="3" y="14" width="18" height="7" rx="2" /><path d="M7 6h.01M7 17h.01M11 6h7M11 17h7" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19 13.5-.1-3-2-.7-.8-1.8.9-1.9L15 4l-1.9.9-1.9-.8L10.5 2h-3l-.7 2.1-1.8.8L3.1 4 1 6.1 1.9 8l-.8 1.8-2.1.7v3l2.1.7.8 1.8-.9 1.9L3.1 20l1.9-.9 1.8.8.7 2.1h3l.7-2.1 1.9-.8 1.9.9 2.1-2.1-.9-1.9.8-1.8z" transform="translate(2) scale(.83)" /></>,
    audit: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 3v-1h6v1M8 8h8M8 12h8M8 16h5" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-4 2-7 6-7s6 3 6 7M16 5a3 3 0 0 1 0 6M17 14c2.5.5 4 2.5 4 6" /></>,
    shield: <path d="M12 3 20 6v5c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6z" />,
    check: <path d="m5 12 4 4L19 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    arrow: <path d="M5 12h13m-5-5 5 5-5 5" />,
  };
  return <svg className="glyph" aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function StatusDot({ state }: { state: string }) {
  return <span className={`status-dot ${state === "running" || state === "connected" ? "ok" : state === "pending" ? "pending" : ""}`} aria-hidden="true" />;
}

function RedeemView({ secret, onRedeemed, onError }: { secret?: string; onRedeemed: (session: SessionView, csrfToken: string) => void; onError: (message: string) => void }) {
  const { messages } = useCoManagementI18n();
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteInput, setInviteInput] = useState(secret ?? "");
  useEffect(() => {
    if (secret) setInviteInput(secret);
  }, [secret]);
  const redeem = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!inviteInput.trim() || !displayName.trim()) return;
    setBusy(true);
    try {
      const result = await request<{ session: SessionView; csrfToken: string }>("/api/v1/invites/redeem", { method: "POST", body: JSON.stringify({ secret: inviteInput.trim(), displayName: displayName.trim() }) });
      onRedeemed(result.session, result.csrfToken);
    } catch (error) {
      onError(errorText(error, messages));
    } finally {
      setBusy(false);
    }
  };
  return <main className="access-shell">
    <div className="access-card">
      <div className="access-card-top"><div className="access-brand"><div className="pixel-mark" aria-hidden="true"><span /><span /><span /></div><div><strong>Minecraft Server Hub</strong><small>{messages.brandSubtitle}</small></div></div><LanguagePicker /></div>
      <div className="access-copy"><span className="eyebrow">{messages.invitationEyebrow}</span><h1>{messages.joinHeading}</h1><p>{messages.joinBody}</p></div>
      <form onSubmit={redeem} className="access-form">
        <label><span>{messages.displayName}</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={32} autoComplete="nickname" placeholder={messages.displayNamePlaceholder} required /></label>
        <label><span>{messages.inviteSecret}</span><input value={inviteInput} onChange={(event) => setInviteInput(event.target.value)} maxLength={256} spellCheck={false} placeholder={messages.inviteSecretPlaceholder} required /></label>
        <button className="primary-button" type="submit" disabled={busy || !displayName.trim() || !inviteInput.trim()}>{busy ? messages.joining : messages.joinButton}<Glyph name="arrow" size={18} /></button>
      </form>
      <div className="safe-note"><Glyph name="shield" size={18} /><span>{messages.safeNote}</span></div>
    </div>
  </main>;
}

function PendingView({ session, onRefresh, onClose }: { session: SessionView; onRefresh: () => Promise<void>; onClose: () => Promise<void> }) {
  const { locale, messages } = useCoManagementI18n();
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setBusy(true); try { await onRefresh(); } finally { setBusy(false); } };
  return <main className="waiting-shell">
    <section className="waiting-card">
      <div className="waiting-card-tools"><LanguagePicker /></div>
      <div className="waiting-icon"><Glyph name="users" size={32} /></div>
      <span className="eyebrow">{messages.requestSentEyebrow}</span>
      <h1>{messages.pendingHeading}</h1>
      <p>{messages.pendingBody(session.displayName)}</p>
      <div className="join-code-label">{messages.joinCodeLabel}</div>
      <div className="join-code" aria-label={messages.joinCodeAria(session.joinCode ?? messages.joinCodeNotObtained)}>{(session.joinCode ?? "------").split("").map((digit, index) => <span key={`${digit}-${index}`}>{digit}</span>)}</div>
      <div className="waiting-meta"><span>{messages.roleLabel}</span><strong>{session.role === "editor" ? messages.roleEditor : messages.roleViewer}</strong><span>{messages.expiresLabel}</span><strong>{formatTime(session.expiresAt, locale)}</strong></div>
      <button className="secondary-button wide-button" type="button" onClick={refresh} disabled={busy}>{busy ? messages.checkingApproval : messages.checkApproval}<Glyph name="clock" size={18} /></button>
      <button className="text-button" type="button" onClick={() => void onClose()}>{messages.closeSession}</button>
    </section>
  </main>;
}

function RevokedView({ onClose }: { onClose: () => Promise<void> }) {
  const { messages } = useCoManagementI18n();
  return <main className="waiting-shell"><section className="waiting-card compact"><div className="waiting-card-tools"><LanguagePicker /></div><div className="waiting-icon warning"><Glyph name="shield" size={32} /></div><h1>{messages.revokedHeading}</h1><p>{messages.revokedBody}</p><button className="primary-button wide-button" type="button" onClick={() => void onClose()}>{messages.backToInvite}</button></section></main>;
}

function SettingControl({ capability, value, disabled, onChange, messages }: { capability: CoManagementCapability; value: Primitive | undefined; disabled: boolean; onChange: (value: Primitive) => void; messages: CoManagementMessages }) {
  if (capability.enumValues?.length) return <select value={String(value ?? "")} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{capability.enumValues.map((option) => <option key={option} value={option}>{enumOptionLabel(capability.key, option, messages)}</option>)}</select>;
  if (capability.valueType === "boolean") return <button className={`toggle ${value === true ? "on" : ""}`} type="button" role="switch" aria-checked={value === true} disabled={disabled} onClick={() => onChange(value !== true)}><span /></button>;
  if (capability.valueType === "string") return <div className="text-control"><input type="text" value={value === undefined ? "" : String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></div>;
  return <div className="number-control"><input type="number" step={capability.valueType === "integer" ? 1 : 0.1} min={capability.min} max={capability.max} value={value === undefined ? "" : String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value === "" ? 0 : capability.valueType === "integer" ? Number.parseInt(event.target.value, 10) : Number.parseFloat(event.target.value))} />{fieldSuffix(capability.key, messages) ? <small>{fieldSuffix(capability.key, messages)}</small> : null}</div>;
}

function SettingsPanel({ settings, role, saving, fresh, operationPending, onSave, onCheckPending }: { settings: CoManagementSettingsSnapshot; role: "viewer" | "editor"; saving: boolean; fresh: boolean; operationPending: boolean; onSave: (changes: Fields) => Promise<void>; onCheckPending: () => Promise<void> }) {
  const { messages } = useCoManagementI18n();
  const [draft, setDraft] = useState<Fields>(settings.fields);
  const [draftServerId, setDraftServerId] = useState(settings.serverId);
  const [baseRevision, setBaseRevision] = useState(settings.revision);
  const [conflict, setConflict] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const editable = fresh && role === "editor" && settings.editable && settings.state === "stopped";
  const changes = useMemo(() => Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== settings.fields[key])), [draft, settings.fields]);
  const dirty = Object.keys(changes).length > 0;

  useEffect(() => {
    if (settings.serverId !== draftServerId) {
      setDraftServerId(settings.serverId);
      setDraft(settings.fields);
      setBaseRevision(settings.revision);
      setConflict(false);
      setConfirming(false);
      return;
    }
    if (settings.revision === baseRevision) return;
    if (dirty) {
      setConflict(true);
      setConfirming(false);
      return;
    }
    setDraft(settings.fields);
    setBaseRevision(settings.revision);
    setConflict(false);
  }, [baseRevision, dirty, draftServerId, settings.fields, settings.revision, settings.serverId]);

  const reloadLatest = () => {
    setDraft(settings.fields);
    setBaseRevision(settings.revision);
    setConflict(false);
    setConfirming(false);
  };
  const submit = async () => {
    setConfirming(false);
    await onSave(changes);
  };
  const footerMessage = !fresh
    ? messages.footerOffline
    : editable
      ? messages.footerEditable
    : role === "viewer"
      ? messages.footerViewer
      : settings.state !== "stopped"
        ? messages.footerRunning
        : messages.footerNotAllowed;

  return <section className="panel settings-panel">
    <header className="panel-header"><div><span className="panel-kicker">{messages.safeWrite}</span><h2>{messages.serverSettings}</h2></div><span className="revision">rev. {settings.revision}</span></header>
    <div className="settings-body">
      {conflict ? <div className="settings-conflict" role="alert"><strong>{messages.conflictTitle}</strong><span>{messages.conflictBody}</span><button className="secondary-button" type="button" onClick={reloadLatest}>{messages.loadLatest}</button></div> : null}
      {operationPending ? <div className="settings-pending" role="status"><strong>{messages.pendingTitle}</strong><span>{messages.pendingBodySettings}</span><button className="secondary-button" type="button" onClick={() => void onCheckPending()} disabled={saving}>{messages.checkResult}</button></div> : null}
      {settings.capabilities.map((capability) => <label className="setting-row" key={capability.key}><span className="setting-label">{fieldLabel(capability.key, messages)}</span><SettingControl capability={capability} value={draft[capability.key]} disabled={!editable || conflict || operationPending} messages={messages} onChange={(value) => { setConflict(false); setDraft((current) => ({ ...current, [capability.key]: value })); }} /></label>)}
      <div className="settings-footer"><small>{footerMessage}</small><button className="primary-button" type="button" disabled={!editable || saving || conflict || operationPending || !dirty} onClick={() => setConfirming(true)}>{saving ? messages.applying : operationPending ? messages.pendingResult : messages.requestChange}<Glyph name="arrow" size={18} /></button></div>
      {confirming ? <div className="settings-confirmation" role="dialog" aria-label={messages.confirmationAria}><strong>{messages.confirmationTitle}</strong><ul>{Object.entries(changes).map(([key, value]) => <li key={key}><span>{fieldLabel(key, messages)}</span><span className="settings-change-values"><span>{formatFieldValue(key, settings.fields[key], messages)}</span><b aria-hidden="true">→</b><span>{formatFieldValue(key, value, messages)}</span></span></li>)}</ul><div><button className="secondary-button" type="button" onClick={() => setConfirming(false)}>{messages.cancel}</button><button className="primary-button" type="button" onClick={() => void submit()} disabled={saving || conflict || !editable || !dirty}>{messages.confirmRequest}</button></div></div> : null}
    </div>
  </section>;
}

function ActivityPanel({ entries }: { entries: CoManagementAuditEntry[] }) {
  const { locale, messages } = useCoManagementI18n();
  return <section className="panel activity-panel"><header className="panel-header"><div><span className="panel-kicker">{messages.auditTrail}</span><h2>{messages.activity}</h2></div><Glyph name="audit" size={21} /></header><div className="activity-list">{entries.length === 0 ? <p className="empty-copy">{messages.emptyActivity}</p> : entries.slice(0, 8).map((entry) => <article className="activity-row" key={entry.id}><div className="activity-icon"><Glyph name={entry.action === "settings.patch" ? "settings" : entry.action.startsWith("participant") ? "users" : "shield"} size={18} /></div><div><strong>{actionLabel(entry.action, messages)}</strong><p>{messages.activityBy(entry.actorDisplayName)}</p></div><time>{formatTime(entry.at, locale)}</time></article>)}</div><div className="audit-footer"><Glyph name="shield" size={18} /><span>{messages.auditFooter}</span></div></section>;
}

interface PendingOperation {
  requestId: string;
  expectedRevision: number;
  changes: Fields;
  createdAt: string;
}

function pendingOperationKey(session: SessionView): string {
  return `msh-co-management-pending:${session.serverId}:${session.participantId}`;
}

function readPendingOperation(session: SessionView): PendingOperation | undefined {
  try {
    const raw = window.sessionStorage.getItem(pendingOperationKey(session));
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    const value = parsed as Partial<PendingOperation>;
    if (typeof value.requestId !== "string" || typeof value.expectedRevision !== "number" || !value.changes || typeof value.changes !== "object") return undefined;
    return { requestId: value.requestId, expectedRevision: value.expectedRevision, changes: value.changes as Fields, createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString() };
  } catch {
    return undefined;
  }
}

function writePendingOperation(session: SessionView, pending: PendingOperation): void {
  window.sessionStorage.setItem(pendingOperationKey(session), JSON.stringify(pending));
}

function deletePendingOperation(session: SessionView): void {
  window.sessionStorage.removeItem(pendingOperationKey(session));
}

function Dashboard({ session, snapshot, settings, audit, fresh, lastSyncedAt, onRefresh, onClose, onError }: { session: SessionView; snapshot: PublicServerSnapshot; settings: CoManagementSettingsSnapshot; audit: CoManagementAuditEntry[]; fresh: boolean; lastSyncedAt?: string; onRefresh: () => Promise<void>; onClose: () => Promise<void>; onError: (message: string) => void }) {
  const { locale, messages } = useCoManagementI18n();
  const [saving, setSaving] = useState(false);
  const [pendingOperation, setPendingOperation] = useState<PendingOperation | undefined>(() => readPendingOperation(session));
  const save = async (changes: Fields) => {
    if (pendingOperation) {
      onError(messages.errorPendingUnconfirmed);
      return;
    }
    const requestId = `request-${crypto.randomUUID()}`;
    const pending: PendingOperation = { requestId, expectedRevision: settings.revision, changes, createdAt: new Date().toISOString() };
    try {
      writePendingOperation(session, pending);
    } catch {
      onError(messages.errorPendingStorage);
      return;
    }
    setPendingOperation(pending);
    setSaving(true);
    try {
      const response = await request<{ result?: CoManagementApplyResult; operation?: CoManagementOperationResult }>(`/api/v1/servers/${encodeURIComponent(session.serverId)}/settings`, { method: "PATCH", headers: { "x-msh-user-activity": "1" }, body: JSON.stringify({ requestId, expectedRevision: settings.revision, changes }) });
      if (response.operation || !response.result) {
        onError(messages.errorUnknownResult);
        return;
      }
      deletePendingOperation(session);
      setPendingOperation(undefined);
      await onRefresh();
    } catch (error) {
      if (error instanceof ApiError && (error.code === "host-timeout" || error.code === "host-offline" || error.code === "host-send-failed")) {
        onError(messages.errorUnknownResult);
      } else {
        deletePendingOperation(session);
        setPendingOperation(undefined);
        onError(errorText(error, messages));
      }
    } finally {
      setSaving(false);
    }
  };
  const checkPending = async () => {
    if (!pendingOperation) return;
    setSaving(true);
    try {
      const response = await request<{ operation: CoManagementOperationResult }>(`/api/v1/operations/${encodeURIComponent(pendingOperation.requestId)}`, { headers: { "x-msh-user-activity": "1" } });
      const operation = response.operation;
      if (operation.state === "running") {
        onError(messages.errorOperationRunning);
        return;
      }
      deletePendingOperation(session);
      setPendingOperation(undefined);
      if (operation.state === "completed") await onRefresh();
      else onError(messages.errorOperationFailed);
    } catch (error) {
      onError(error instanceof ApiError && error.code === "host-timeout" ? messages.errorOperationTimeout : errorText(error, messages));
    } finally {
      setSaving(false);
    }
  };
  return <div className="portal-shell">
    <header className="portal-header"><div className="portal-brand"><div className="pixel-mark small" aria-hidden="true"><span /><span /><span /></div><div><strong>Minecraft Server Hub</strong><small>{messages.brandSubtitle}</small></div></div><div className="header-right"><LanguagePicker /><span className={`connection-state ${fresh ? "" : "offline"}`}><StatusDot state={fresh ? "connected" : "disconnected"} />{fresh ? messages.connected : messages.disconnected}</span><span className="user-name">{session.displayName}</span><button className="icon-button" type="button" aria-label={messages.closeSessionAria} title={messages.closeSessionAria} onClick={() => void onClose()}><Glyph name="close" size={18} /></button></div></header>
    <div className="portal-body"><aside className="portal-nav"><nav aria-label={messages.navLabel}><button className="nav-item active" type="button"><Glyph name="server" />{messages.overview}</button><button className="nav-item" type="button" onClick={() => document.getElementById("settings-panel")?.scrollIntoView({ behavior: "smooth" })}><Glyph name="settings" />{messages.settings}</button><button className="nav-item" type="button" onClick={() => document.getElementById("audit-panel")?.scrollIntoView({ behavior: "smooth" })}><Glyph name="audit" />{messages.audit}</button></nav><div className="nav-security"><Glyph name="shield" size={20} /><strong>{messages.safeManagementTitle}</strong><p>{messages.safeManagementBody}</p></div></aside><main className="portal-main"><div className="mobile-title"><span>{messages.serverOverview}</span><button className="text-button" type="button" onClick={() => void onRefresh()}>{messages.refresh}</button></div><div className="dashboard-grid"><section className="panel server-panel"><div className="server-visual" aria-hidden="true"><div className="voxel-scene"><span className="sun-disc" /><span className="mountain m1" /><span className="mountain m2" /><span className="water-line" /><span className="tree t1" /><span className="tree t2" /></div></div><div className="server-details"><div className="status-heading"><span className="online-label"><StatusDot state={snapshot.state} />{stateLabel(snapshot.state, messages)}</span><span className="server-revision">rev. {snapshot.revision}</span></div><h1>{snapshot.serverName}</h1><p className="game-type">{gameLabel(snapshot.gameKind, messages)}</p><dl className="server-facts"><div><dt>{messages.playerCount}</dt><dd>{snapshot.playerCount} / {snapshot.maxPlayers}</dd></div><div><dt>{messages.serverState}</dt><dd>{stateLabel(snapshot.state, messages)}</dd></div><div><dt>{messages.lastSync}</dt><dd>{formatTime(lastSyncedAt ?? snapshot.fetchedAt, locale)}</dd></div></dl></div></section><div id="audit-panel"><ActivityPanel entries={audit} /></div><div id="settings-panel"><SettingsPanel settings={settings} role={session.role} saving={saving} fresh={fresh} operationPending={Boolean(pendingOperation)} onSave={save} onCheckPending={checkPending} /></div></div><footer className="portal-footer"><span>{messages.scopeFooter}</span><button className="text-button" type="button" onClick={() => void onRefresh()}>{messages.lastSyncAt(formatTime(lastSyncedAt ?? snapshot.fetchedAt, locale))}</button></footer></main></div>
  </div>;
}

export function App() {
  const { messages } = useCoManagementI18n();
  const [inviteSecret, setInviteSecret] = useState<string>();
  const [session, setSession] = useState<SessionView>();
  const [snapshot, setSnapshot] = useState<PublicServerSnapshot>();
  const [settings, setSettings] = useState<CoManagementSettingsSnapshot>();
  const [audit, setAudit] = useState<CoManagementAuditEntry[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [dashboardFresh, setDashboardFresh] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>();

  const refreshSession = useCallback(async (userActivity = false) => {
    try {
      const result = await request<{ session: SessionView }>("/api/v1/session", userActivity ? { headers: { "x-msh-user-activity": "1" } } : undefined);
      setSession(result.session);
      return result.session;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setSession(undefined);
      else setError(errorText(error, messages));
      return undefined;
    }
  }, [messages]);

  const refreshDashboard = useCallback(async (current: SessionView = session!, userActivity = false) => {
    if (!current || current.state !== "approved") return;
    try {
      const headers = userActivity ? { "x-msh-user-activity": "1" } : undefined;
      const [summary, settingResult, auditResult] = await Promise.all([
        request<{ snapshot: PublicServerSnapshot }>(`/api/v1/servers/${encodeURIComponent(current.serverId)}/summary`, headers ? { headers } : undefined),
        request<{ settings: CoManagementSettingsSnapshot }>(`/api/v1/servers/${encodeURIComponent(current.serverId)}/settings`, headers ? { headers } : undefined),
        request<{ entries: CoManagementAuditEntry[] }>(`/api/v1/servers/${encodeURIComponent(current.serverId)}/audit`, headers ? { headers } : undefined),
      ]);
      setSnapshot(summary.snapshot);
      setSettings(settingResult.settings);
      setAudit(auditResult.entries);
      setDashboardFresh(true);
      setLastSyncedAt(new Date().toISOString());
    } catch (error) {
      setDashboardFresh(false);
      setError(errorText(error, messages));
    }
  }, [messages, session]);

  useEffect(() => {
    const detectedInvite = inviteFromUrl();
    if (detectedInvite) setInviteSecret(detectedInvite);
    void refreshSession().finally(() => setLoading(false));
  }, [refreshSession]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refreshSession().then((current) => current?.state === "approved" ? refreshDashboard(current) : undefined);
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [refreshDashboard, refreshSession]);

  useEffect(() => {
    if (session?.state === "approved") void refreshDashboard(session);
  }, [refreshDashboard, session]);

  const closeSession = async () => {
    try { await request<void>("/api/v1/session/close", { method: "POST", body: "{}" }); } catch { /* Expired sessions can still return to the invite view. */ }
    setSession(undefined); setSnapshot(undefined); setSettings(undefined); setAudit([]); setInviteSecret(undefined);
  };

  if (loading) return <div className="loading-screen"><span className="spinner" />{messages.loadingChecking}</div>;
  if (!session) return <><RedeemView secret={inviteSecret} onRedeemed={(next, csrfToken) => { void csrfToken; setSession(next); setInviteSecret(undefined); }} onError={setError} />{error ? <ErrorToast message={error} onClose={() => setError("")} /> : null}</>;
  if (session.state === "pending") return <><PendingView session={session} onRefresh={async () => { const next = await refreshSession(true); if (next?.state === "approved") await refreshDashboard(next, true); }} onClose={closeSession} />{error ? <ErrorToast message={error} onClose={() => setError("")} /> : null}</>;
  if (session.state === "revoked" || session.state === "expired") return <><RevokedView onClose={closeSession} />{error ? <ErrorToast message={error} onClose={() => setError("")} /> : null}</>;
  return snapshot && settings ? <><Dashboard session={session} snapshot={snapshot} settings={settings} audit={audit} fresh={dashboardFresh} lastSyncedAt={lastSyncedAt} onRefresh={() => refreshDashboard(session, true)} onClose={closeSession} onError={setError} />{error ? <ErrorToast message={error} onClose={() => setError("")} /> : null}</> : <div className="loading-screen"><span className="spinner" />{messages.loadingServer}{error ? <ErrorToast message={error} onClose={() => setError("")} /> : null}</div>;
}

function ErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  const { messages } = useCoManagementI18n();
  return <div className="error-toast" role="alert"><span>{message}</span><button className="icon-button" type="button" aria-label={messages.errorToastClose} onClick={onClose}><Glyph name="close" size={17} /></button></div>;
}
