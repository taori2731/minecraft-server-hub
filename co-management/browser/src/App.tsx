import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CoManagementApplyResult,
  CoManagementCapability,
  CoManagementAuditEntry,
  CoManagementOperationResult,
  CoManagementSettingsSnapshot,
} from "../../shared/protocol.ts";
import type { PublicServerSnapshot, SessionView } from "../../shared/protocol.ts";

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

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409 || error.code.includes("conflict")) return "設定が更新されています。最新の値を読み込み直してから、もう一度選択してください。";
    if (error.code === "host-offline" || error.code === "host-timeout" || error.code === "host-send-failed") return "ホストPCがオフラインか、応答に時間がかかっています。しばらくしてから再試行してください。";
    if (error.code === "editor-required") return "この招待には設定変更の権限がありません。";
    if (error.code === "session-not-authorized" || error.code === "session-required") return "参加セッションが無効になりました。招待リンクから再参加してください。";
    if (error.code === "csrf-failed") return "セキュリティ確認に失敗しました。ページを再読み込みしてください。";
    if (error.code === "invite-invalid-or-expired") return "招待リンクが無効か、有効期限が切れています。ホストPCで新しい招待を発行してください。";
    return "中継サービスで処理を完了できませんでした。設定を確認して再試行してください。";
  }
  return "通信を完了できませんでした。しばらくしてから再試行してください。";
}

function gameLabel(kind: string): string {
  return kind === "palworld" ? "Palworld" : kind === "bedrock" ? "Minecraft Bedrock" : "Minecraft Java";
}

function stateLabel(state: string): string {
  return state === "running" ? "オンライン" : state === "starting" ? "起動中" : state === "stopping" ? "停止中" : state === "crashed" ? "要確認" : "停止";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    difficulty: "難易度",
    defaultGameMode: "デフォルトゲームモード",
    maxPlayers: "最大人数",
    pvp: "PvP",
    allowFlight: "飛行を許可",
    forceGameMode: "ゲームモード固定",
    spawnProtection: "スポーン保護",
    viewDistance: "視認距離",
    simulationDistance: "シミュレーション距離",
    serverDescription: "サーバー説明",
    expRate: "経験値倍率",
    collectionDropRate: "採集ドロップ倍率",
    palCaptureRate: "捕獲倍率",
    dayTimeSpeedRate: "昼の時間速度",
    nightTimeSpeedRate: "夜の時間速度",
    palEggDefaultHatchingTime: "卵の孵化時間",
    deathPenalty: "死亡ペナルティ",
    invaderEnemiesEnabled: "侵入敵を有効化",
    fastTravelEnabled: "ファストトラベル",
    baseCampMaxNumInGuild: "ギルド拠点数",
    baseCampWorkerMaxNum: "拠点ワーカー数",
  };
  return labels[key] ?? key;
}

function fieldSuffix(key: string): string {
  if (["viewDistance", "simulationDistance", "spawnProtection"].includes(key)) return "チャンク";
  if (key.endsWith("Rate")) return "倍";
  if (key === "palEggDefaultHatchingTime") return "分";
  return "";
}

export function formatFieldValue(key: string, value: Primitive | undefined): string {
  if (value === undefined) return "未設定";
  if (typeof value === "boolean") return value ? "有効" : "無効";
  const suffix = fieldSuffix(key);
  return suffix ? `${String(value)} ${suffix}` : String(value);
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    "settings.patch": "設定変更",
    "participant.approve": "参加者を承認",
    "participant.revoke": "参加者を取り消し",
    "invite.issue": "招待を発行",
    "co-management.enable": "共同管理を有効化",
    "co-management.disable": "共同管理を無効化",
  };
  return labels[action] ?? action;
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
      onError(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return <main className="access-shell">
    <div className="access-card">
      <div className="access-brand"><div className="pixel-mark" aria-hidden="true"><span /><span /><span /></div><div><strong>Minecraft Server Hub</strong><small>共同管理コンソール</small></div></div>
      <div className="access-copy"><span className="eyebrow">INVITATION</span><h1>友達のサーバーに参加</h1><p>ホストPCの管理者が発行した招待リンクを使って、許可された範囲のサーバー情報を確認できます。</p></div>
      <form onSubmit={redeem} className="access-form">
        <label><span>表示名</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={32} autoComplete="nickname" placeholder="例: Takeru" required /></label>
        <label><span>招待秘密</span><input value={inviteInput} onChange={(event) => setInviteInput(event.target.value)} maxLength={256} spellCheck={false} placeholder="招待リンクから自動入力されます" required /></label>
        <button className="primary-button" type="submit" disabled={busy || !displayName.trim() || !inviteInput.trim()}>{busy ? "参加処理中…" : "共同管理に参加"}<Glyph name="arrow" size={18} /></button>
      </form>
      <div className="safe-note"><Glyph name="shield" size={18} /><span>パスワード、ローカルパス、任意コマンドはこの画面に送られません。</span></div>
    </div>
  </main>;
}

function PendingView({ session, onRefresh, onClose }: { session: SessionView; onRefresh: () => Promise<void>; onClose: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const refresh = async () => { setBusy(true); try { await onRefresh(); } finally { setBusy(false); } };
  return <main className="waiting-shell">
    <section className="waiting-card">
      <div className="waiting-icon"><Glyph name="users" size={32} /></div>
      <span className="eyebrow">REQUEST SENT</span>
      <h1>ホストPCの承認を待っています</h1>
      <p><strong>{session.displayName}</strong> として参加リクエストを送信しました。ホストPCの画面でこのコードと表示名を確認してもらってください。</p>
      <div className="join-code-label">参加コード</div>
      <div className="join-code" aria-label={`参加コード ${session.joinCode ?? "未取得"}`}>{(session.joinCode ?? "------").split("").map((digit, index) => <span key={`${digit}-${index}`}>{digit}</span>)}</div>
      <div className="waiting-meta"><span>権限</span><strong>{session.role === "editor" ? "編集者" : "閲覧者"}</strong><span>有効期限</span><strong>{formatTime(session.expiresAt)}</strong></div>
      <button className="secondary-button wide-button" type="button" onClick={refresh} disabled={busy}>{busy ? "確認中…" : "承認状態を確認"}<Glyph name="clock" size={18} /></button>
      <button className="text-button" type="button" onClick={() => void onClose()}>このセッションを閉じる</button>
    </section>
  </main>;
}

function RevokedView({ onClose }: { onClose: () => Promise<void> }) {
  return <main className="waiting-shell"><section className="waiting-card compact"><div className="waiting-icon warning"><Glyph name="shield" size={32} /></div><h1>参加セッションが終了しました</h1><p>ホストPCで権限が取り消されたか、有効期限が切れています。</p><button className="primary-button wide-button" type="button" onClick={() => void onClose()}>招待画面へ戻る</button></section></main>;
}

function SettingControl({ capability, value, disabled, onChange }: { capability: CoManagementCapability; value: Primitive | undefined; disabled: boolean; onChange: (value: Primitive) => void }) {
  if (capability.enumValues?.length) return <select value={String(value ?? "")} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{capability.enumValues.map((option) => <option key={option} value={option}>{option}</option>)}</select>;
  if (capability.valueType === "boolean") return <button className={`toggle ${value === true ? "on" : ""}`} type="button" role="switch" aria-checked={value === true} disabled={disabled} onClick={() => onChange(value !== true)}><span /></button>;
  if (capability.valueType === "string") return <div className="text-control"><input type="text" value={value === undefined ? "" : String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></div>;
  return <div className="number-control"><input type="number" step={capability.valueType === "integer" ? 1 : 0.1} min={capability.min} max={capability.max} value={value === undefined ? "" : String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value === "" ? 0 : capability.valueType === "integer" ? Number.parseInt(event.target.value, 10) : Number.parseFloat(event.target.value))} />{fieldSuffix(capability.key) ? <small>{fieldSuffix(capability.key)}</small> : null}</div>;
}

function SettingsPanel({ settings, role, saving, fresh, operationPending, onSave, onCheckPending }: { settings: CoManagementSettingsSnapshot; role: "viewer" | "editor"; saving: boolean; fresh: boolean; operationPending: boolean; onSave: (changes: Fields) => Promise<void>; onCheckPending: () => Promise<void> }) {
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
    ? "ホストPCとの接続を確認できないため、保存を停止しています。最新値を更新してから再試行してください。"
    : editable
      ? "変更はホストPCの検証・バックアップ後に反映されます。"
    : role === "viewer"
      ? "閲覧者は設定を確認できますが、変更は申請できません。"
      : settings.state !== "stopped"
        ? "サーバーを停止すると設定変更を申請できます。"
        : "共同管理の設定変更が許可されていません。";

  return <section className="panel settings-panel">
    <header className="panel-header"><div><span className="panel-kicker">SAFE WRITE</span><h2>サーバー設定</h2></div><span className="revision">rev. {settings.revision}</span></header>
    <div className="settings-body">
      {conflict ? <div className="settings-conflict" role="alert"><strong>他の変更を検知しました</strong><span>未保存の入力を保持しています。最新値を読み込むまで申請できません。</span><button className="secondary-button" type="button" onClick={reloadLatest}>最新値を読み込む</button></div> : null}
      {operationPending ? <div className="settings-pending" role="status"><strong>前回の申請結果を確認してください</strong><span>通信が途切れたため、同じ変更を再送せずホストPCへ結果を照会します。</span><button className="secondary-button" type="button" onClick={() => void onCheckPending()} disabled={saving}>結果を確認</button></div> : null}
      {settings.capabilities.map((capability) => <label className="setting-row" key={capability.key}><span className="setting-label">{fieldLabel(capability.key)}</span><SettingControl capability={capability} value={draft[capability.key]} disabled={!editable || conflict || operationPending} onChange={(value) => { setConflict(false); setDraft((current) => ({ ...current, [capability.key]: value })); }} /></label>)}
      <div className="settings-footer"><small>{footerMessage}</small><button className="primary-button" type="button" disabled={!editable || saving || conflict || operationPending || !dirty} onClick={() => setConfirming(true)}>{saving ? "申請中…" : operationPending ? "結果確認待ち" : "変更を申請"}<Glyph name="arrow" size={18} /></button></div>
      {confirming ? <div className="settings-confirmation" role="dialog" aria-label="変更内容の確認"><strong>この変更を申請しますか？</strong><ul>{Object.entries(changes).map(([key, value]) => <li key={key}><span>{fieldLabel(key)}</span><span className="settings-change-values"><span>{formatFieldValue(key, settings.fields[key])}</span><b aria-hidden="true">→</b><span>{formatFieldValue(key, value)}</span></span></li>)}</ul><div><button className="secondary-button" type="button" onClick={() => setConfirming(false)}>キャンセル</button><button className="primary-button" type="button" onClick={() => void submit()} disabled={saving || conflict || !editable || !dirty}>この内容で申請</button></div></div> : null}
    </div>
  </section>;
}

function ActivityPanel({ entries }: { entries: CoManagementAuditEntry[] }) {
  return <section className="panel activity-panel"><header className="panel-header"><div><span className="panel-kicker">AUDIT TRAIL</span><h2>アクティビティ</h2></div><Glyph name="audit" size={21} /></header><div className="activity-list">{entries.length === 0 ? <p className="empty-copy">まだ共同管理の操作履歴はありません。</p> : entries.slice(0, 8).map((entry) => <article className="activity-row" key={entry.id}><div className="activity-icon"><Glyph name={entry.action === "settings.patch" ? "settings" : entry.action.startsWith("participant") ? "users" : "shield"} size={18} /></div><div><strong>{actionLabel(entry.action)}</strong><p>{entry.actorDisplayName} が操作しました。</p></div><time>{formatTime(entry.at)}</time></article>)}</div><div className="audit-footer"><Glyph name="shield" size={18} /><span>サーバー管理者のポリシーにより、すべての変更は監査ログに記録されます。</span></div></section>;
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
  const [saving, setSaving] = useState(false);
  const [pendingOperation, setPendingOperation] = useState<PendingOperation | undefined>(() => readPendingOperation(session));
  const save = async (changes: Fields) => {
    if (pendingOperation) {
      onError("前回の申請結果が未確認です。結果を確認してから次の変更を申請してください。");
      return;
    }
    const requestId = `request-${crypto.randomUUID()}`;
    const pending: PendingOperation = { requestId, expectedRevision: settings.revision, changes, createdAt: new Date().toISOString() };
    try {
      writePendingOperation(session, pending);
    } catch {
      onError("このブラウザで申請状態を保存できないため、変更を送信できません。");
      return;
    }
    setPendingOperation(pending);
    setSaving(true);
    try {
      const response = await request<{ result?: CoManagementApplyResult; operation?: CoManagementOperationResult }>(`/api/v1/servers/${encodeURIComponent(session.serverId)}/settings`, { method: "PATCH", headers: { "x-msh-user-activity": "1" }, body: JSON.stringify({ requestId, expectedRevision: settings.revision, changes }) });
      if (response.operation || !response.result) {
        onError("申請の結果を確定できませんでした。再送せず「結果を確認」を押してください。");
        return;
      }
      deletePendingOperation(session);
      setPendingOperation(undefined);
      await onRefresh();
    } catch (error) {
      if (error instanceof ApiError && (error.code === "host-timeout" || error.code === "host-offline" || error.code === "host-send-failed")) {
        onError("申請結果が不明です。再送せず「結果を確認」を押してください。");
      } else {
        deletePendingOperation(session);
        setPendingOperation(undefined);
        onError(errorText(error));
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
        onError("ホストPCの処理がまだ完了していません。しばらくしてから再確認してください。");
        return;
      }
      deletePendingOperation(session);
      setPendingOperation(undefined);
      if (operation.state === "completed") await onRefresh();
      else onError("ホストPCで申請が失敗しました。変更内容を確認して再申請してください。");
    } catch (error) {
      onError(error instanceof ApiError && error.code === "host-timeout" ? "まだ結果を取得できません。再送せず、後でもう一度確認してください。" : errorText(error));
    } finally {
      setSaving(false);
    }
  };
  return <div className="portal-shell">
    <header className="portal-header"><div className="portal-brand"><div className="pixel-mark small" aria-hidden="true"><span /><span /><span /></div><div><strong>Minecraft Server Hub</strong><small>共同管理コンソール</small></div></div><div className="header-right"><span className={`connection-state ${fresh ? "" : "offline"}`}><StatusDot state={fresh ? "connected" : "disconnected"} />{fresh ? "接続中" : "接続不可"}</span><span className="user-name">{session.displayName}</span><button className="icon-button" type="button" aria-label="セッションを閉じる" title="セッションを閉じる" onClick={() => void onClose()}><Glyph name="close" size={18} /></button></div></header>
    <div className="portal-body"><aside className="portal-nav"><nav aria-label="共同管理メニュー"><button className="nav-item active" type="button"><Glyph name="server" />概要</button><button className="nav-item" type="button" onClick={() => document.getElementById("settings-panel")?.scrollIntoView({ behavior: "smooth" })}><Glyph name="settings" />設定</button><button className="nav-item" type="button" onClick={() => document.getElementById("audit-panel")?.scrollIntoView({ behavior: "smooth" })}><Glyph name="audit" />監査ログ</button></nav><div className="nav-security"><Glyph name="shield" size={20} /><strong>安全な共同管理</strong><p>ホストPCが権限・設定・ファイル書き込みを管理します。</p></div></aside><main className="portal-main"><div className="mobile-title"><span>サーバー概要</span><button className="text-button" type="button" onClick={() => void onRefresh()}>更新</button></div><div className="dashboard-grid"><section className="panel server-panel"><div className="server-visual" aria-hidden="true"><div className="voxel-scene"><span className="sun-disc" /><span className="mountain m1" /><span className="mountain m2" /><span className="water-line" /><span className="tree t1" /><span className="tree t2" /></div></div><div className="server-details"><div className="status-heading"><span className="online-label"><StatusDot state={snapshot.state} />{stateLabel(snapshot.state)}</span><span className="server-revision">rev. {snapshot.revision}</span></div><h1>{snapshot.serverName}</h1><p className="game-type">{gameLabel(snapshot.gameKind)}</p><dl className="server-facts"><div><dt>プレイヤー</dt><dd>{snapshot.playerCount} / {snapshot.maxPlayers}</dd></div><div><dt>サーバー状態</dt><dd>{stateLabel(snapshot.state)}</dd></div><div><dt>最終同期</dt><dd>{formatTime(lastSyncedAt ?? snapshot.fetchedAt)}</dd></div></dl></div></section><div id="audit-panel"><ActivityPanel entries={audit} /></div><div id="settings-panel"><SettingsPanel settings={settings} role={session.role} saving={saving} fresh={fresh} operationPending={Boolean(pendingOperation)} onSave={save} onCheckPending={checkPending} /></div></div><footer className="portal-footer"><span>表示範囲: ホストPCが許可した公開サーバー情報のみ</span><button className="text-button" type="button" onClick={() => void onRefresh()}>最終同期 {formatTime(lastSyncedAt ?? snapshot.fetchedAt)}</button></footer></main></div>
  </div>;
}

export function App() {
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
      else setError(errorText(error));
      return undefined;
    }
  }, []);

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
      setError(errorText(error));
    }
  }, [session]);

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

  if (loading) return <div className="loading-screen"><span className="spinner" />接続状態を確認しています…</div>;
  if (!session) return <><RedeemView secret={inviteSecret} onRedeemed={(next, csrfToken) => { void csrfToken; setSession(next); setInviteSecret(undefined); }} onError={setError} />{error ? <ErrorToast message={error} onClose={() => setError("")} /> : null}</>;
  if (session.state === "pending") return <><PendingView session={session} onRefresh={async () => { const next = await refreshSession(true); if (next?.state === "approved") await refreshDashboard(next, true); }} onClose={closeSession} />{error ? <ErrorToast message={error} onClose={() => setError("")} /> : null}</>;
  if (session.state === "revoked" || session.state === "expired") return <><RevokedView onClose={closeSession} />{error ? <ErrorToast message={error} onClose={() => setError("")} /> : null}</>;
  return snapshot && settings ? <><Dashboard session={session} snapshot={snapshot} settings={settings} audit={audit} fresh={dashboardFresh} lastSyncedAt={lastSyncedAt} onRefresh={() => refreshDashboard(session, true)} onClose={closeSession} onError={setError} />{error ? <ErrorToast message={error} onClose={() => setError("")} /> : null}</> : <div className="loading-screen"><span className="spinner" />サーバー情報を読み込んでいます…{error ? <ErrorToast message={error} onClose={() => setError("")} /> : null}</div>;
}

function ErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  return <div className="error-toast" role="alert"><span>{message}</span><button className="icon-button" type="button" aria-label="エラーを閉じる" onClick={onClose}><Glyph name="close" size={17} /></button></div>;
}
