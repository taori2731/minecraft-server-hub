import { useCallback, useEffect, useMemo, useState } from "react";
import { backend } from "../lib/backend";
import { Icon } from "./Icon";
import type {
  CoManagementConfigView,
  CoManagementInviteResult,
  CoManagementParticipant,
  CoManagementServerSnapshot,
  RuntimeStatus,
  ServerProfile,
} from "../types";

function stateLabel(state: string): string {
  return state === "connected" ? "接続中" : state === "connecting" ? "接続しています" : state === "pending" ? "承認待ち" : state === "approved" ? "承認済み" : state === "revoked" ? "取り消し" : "未接続";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function CoManagementDialog({ server, status, onClose, notify, fail }: { server: ServerProfile; status: RuntimeStatus; onClose: () => void; notify: (message: string) => void; fail: (message: string) => void }) {
  const [snapshot, setSnapshot] = useState<CoManagementServerSnapshot>();
  const [config, setConfig] = useState<CoManagementConfigView>();
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:8787");
  const [enabled, setEnabled] = useState(false);
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor">("viewer");
  const [invite, setInvite] = useState<CoManagementInviteResult>();
  const [pendingCodes, setPendingCodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [legacyJournalCount, setLegacyJournalCount] = useState(0);
  const [legacyMigrationWarning, setLegacyMigrationWarning] = useState<string>();

  const refresh = useCallback(async () => {
    const [next, current, legacyCount] = await Promise.all([
      backend.coManagementSnapshot(server.id),
      backend.coManagementConfig(server.id),
      backend.coManagementLegacyJournalCount(server.id),
    ]);
    setSnapshot(next);
    setEnabled(next.enabled);
    setConfig(current);
    setEndpoint(current.endpoint ?? "http://127.0.0.1:8787");
    setLegacyJournalCount(legacyCount);
  }, [server.id]);

  useEffect(() => {
    let active = true;
    refresh().catch((reason) => active && fail(String(reason)));
    return () => { active = false; };
  }, [fail, refresh]);

  useEffect(() => {
    const onPending = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (detail.serverId !== server.id || typeof detail.participantId !== "string" || typeof detail.joinCode !== "string") return;
      setPendingCodes((current) => ({ ...current, [detail.participantId as string]: detail.joinCode as string }));
      void refresh();
    };
    window.addEventListener("server-hub:co-management-pending", onPending);
    return () => window.removeEventListener("server-hub:co-management-pending", onPending);
  }, [refresh, server.id]);

  useEffect(() => {
    let active = true;
    const pending = snapshot?.participants.filter((participant) => participant.state === "pending") ?? [];
    if (pending.length === 0) {
      setPendingCodes({});
      return () => { active = false; };
    }
    void Promise.all(pending.map(async (participant) => {
      try {
        return [participant.id, await backend.coManagementPendingCode({ serverId: server.id, participantId: participant.id })] as const;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (!active) return;
      setPendingCodes(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null)));
    });
    return () => { active = false; };
  }, [server.id, snapshot]);

  const saveConfig = async () => {
    setBusy("config");
    try {
      const next = await backend.configureCoManagement({ serverId: server.id, endpoint: endpoint.trim(), enabled });
      setConfig(next);
      setSnapshot(await backend.coManagementSnapshot(server.id));
      notify(enabled ? "共同管理を有効にしました" : "共同管理を無効にしました");
    } catch (reason) { fail(String(reason)); }
    finally { setBusy(""); }
  };

  const connect = async () => {
    setBusy("connect");
    try {
      const next = await backend.connectCoManagement(server.id);
      setConfig(next);
      setSnapshot(await backend.coManagementSnapshot(server.id));
      notify("共同管理中継へ接続しました");
    } catch (reason) { fail(String(reason)); }
    finally { setBusy(""); }
  };

  const issueInvite = async () => {
    setBusy("invite");
    try {
      const next = await backend.issueCoManagementInvite({ serverId: server.id, role: inviteRole, expiresMinutes: 10 });
      setInvite(next);
      notify("共同管理の招待リンクを発行しました");
    } catch (reason) { fail(String(reason)); }
    finally { setBusy(""); }
  };

  const migrateLegacyJournal = async () => {
    setBusy("journal");
    try {
      const result = await backend.migrateCoManagementLegacyJournal(server.id);
      setLegacyJournalCount(result.remainingLegacy);
      if (result.databaseCompacted) {
        setLegacyMigrationWarning(undefined);
        notify(result.message);
      } else {
        setLegacyMigrationWarning(result.message);
        fail(result.message);
      }
      await refresh();
    } catch (reason) { fail(String(reason)); }
    finally { setBusy(""); }
  };

  const setParticipant = async (participant: CoManagementParticipant, nextState: "approved" | "revoked") => {
    setBusy(participant.id);
    try {
      const input = { serverId: server.id, participantId: participant.id };
      if (nextState === "approved") await backend.approveCoManagementParticipant(input);
      else await backend.revokeCoManagementParticipant(input);
      setSnapshot(await backend.coManagementSnapshot(server.id));
      notify(nextState === "approved" ? `${participant.displayName} を承認しました` : `${participant.displayName} の権限を取り消しました`);
    } catch (reason) { fail(String(reason)); }
    finally { setBusy(""); }
  };

  const copyInvite = async () => {
    if (!invite) return;
    await navigator.clipboard.writeText(invite.inviteUrl);
    notify("招待リンクをコピーしました");
  };

  const pending = useMemo(() => snapshot?.participants.filter((participant) => participant.state === "pending") ?? [], [snapshot]);
  const approved = useMemo(() => snapshot?.participants.filter((participant) => participant.state === "approved") ?? [], [snapshot]);
  const stopped = status.state === "stopped";

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="wizard co-management-dialog" role="dialog" aria-modal="true" aria-labelledby="co-management-title">
      <header className="wizard-header"><div><p className="wizard-kicker">COLLABORATION</p><h2 id="co-management-title">共同管理</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button></header>
      <div className="co-management-body">
        <div className="co-management-intro"><div className="co-management-intro-icon"><Icon name="users" size={25} /></div><div><strong>友達に安全な管理権限を共有</strong><p>ホストPCが権限、設定検証、バックアップ、revisionを管理します。招待先へローカルパス・パスワード・任意コマンドは公開しません。</p></div></div>
        {config?.recoveryRequired ? <div className="co-recovery-warning" role="alert"><strong>前回の保存を復旧できていません</strong><span>安全のため、新しい招待と参加者の承認を停止しています。ホストPCの復旧ログを確認してください。</span></div> : null}
        {legacyJournalCount > 0 || legacyMigrationWarning ? <div className="co-recovery-warning" role="alert"><strong>{legacyMigrationWarning ?? `旧形式の平文ジャーナルが${legacyJournalCount}件あります`}</strong><span>明示的に実行した場合だけWindowsユーザー保護データへ置換します。行の削除は行わず、SQLite/WALの再構築結果も表示します。</span><button className="secondary-button" type="button" onClick={() => void migrateLegacyJournal()} disabled={busy === "journal"}>{busy === "journal" ? "移行中…" : "暗号化して移行"}</button></div> : null}
        <section className="co-management-section"><div className="co-management-section-title"><div><h3>中継接続</h3><p>CM1: ローカル検証用の中継URLを指定します。</p></div><span className={`co-state ${config?.connectionState === "connected" ? "connected" : ""}`}><i />{stateLabel(config?.connectionState ?? "disconnected")}</span></div><div className="co-management-form-grid"><label><span>中継URL</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="http://127.0.0.1:8787" disabled={busy === "config"} /></label><label className="co-switch-label"><span>共同管理を有効化</span><button className={`co-switch ${enabled ? "on" : ""}`} type="button" role="switch" aria-checked={enabled} onClick={() => setEnabled((current) => !current)} disabled={busy === "config"}><i /></button></label></div><div className="co-management-actions"><button className="secondary-button" type="button" onClick={() => void saveConfig()} disabled={busy === "config"}>{busy === "config" ? "保存中…" : "接続設定を保存"}</button><button className="primary-button" type="button" onClick={() => void connect()} disabled={!enabled || busy === "connect"}>{busy === "connect" ? "接続中…" : "中継へ接続"}<Icon name="refresh" size={17} /></button></div><small className="co-management-note">HTTPはlocalhost/127.0.0.1の開発接続だけ許可されます。本番運用ではHTTPS/WSSと永続DB/TLSを別途構築してください。</small></section>
        <section className="co-management-section"><div className="co-management-section-title"><div><h3>招待を発行</h3><p>リンクは一度だけ利用でき、有効期限は最大10分です。</p></div><Icon name="invite" size={23} /></div><div className="co-management-form-grid invite-grid"><label><span>付与する権限</span><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "viewer" | "editor")}><option value="viewer">閲覧者 — 状態・設定を確認</option><option value="editor">編集者 — 停止中の設定変更を申請</option></select></label><button className="primary-button" type="button" onClick={() => void issueInvite()} disabled={!enabled || busy === "invite" || config?.recoveryRequired}>{busy === "invite" ? "発行中…" : "招待リンクを発行"}</button></div>{invite ? <div className="co-invite-result"><div><strong>{invite.role === "editor" ? "編集者" : "閲覧者"}招待</strong><small>有効期限: {formatTime(invite.expiresAt)}</small></div><code>{invite.inviteUrl}</code><button className="secondary-button" type="button" onClick={() => void copyInvite()}>リンクをコピー</button></div> : null}</section>
        <section className="co-management-section"><div className="co-management-section-title"><div><h3>参加リクエスト</h3><p>表示名と参加コードを確認してから承認してください。</p></div><span className="co-count">{pending.length}件</span></div>{pending.length === 0 ? <p className="co-empty">新しい参加リクエストはありません。</p> : <div className="co-participant-list">{pending.map((participant) => { const joinCode = pendingCodes[participant.id]; return <article className="co-participant pending" key={participant.id}><div className="co-avatar"><Icon name="users" size={20} /></div><div className="co-participant-copy"><strong>{participant.displayName}</strong><span>{participant.role === "editor" ? "編集者" : "閲覧者"} · ブラウザ画面のコードと照合</span></div><div className="co-participant-code" aria-label={joinCode ? `参加コード ${joinCode}` : "参加コードを受信中"}>{joinCode ? joinCode.replace(/(.{3})/u, "$1 ") : "照合待ち"}</div><div className="co-participant-actions"><button className="primary-button" type="button" onClick={() => void setParticipant(participant, "approved")} disabled={busy === participant.id || !joinCode || config?.recoveryRequired}>承認</button><button className="secondary-button" type="button" onClick={() => void setParticipant(participant, "revoked")} disabled={busy === participant.id}>拒否</button></div></article>; })}</div>}{approved.length > 0 ? <div className="co-approved-list"><span>承認済み</span>{approved.map((participant) => <div key={participant.id}><strong>{participant.displayName}</strong><small>{participant.role === "editor" ? "編集者" : "閲覧者"} · {stateLabel(participant.state)}</small><button className="text-button" type="button" onClick={() => void setParticipant(participant, "revoked")} disabled={busy === participant.id}>取り消し</button></div>)}</div> : null}</section>
        <section className="co-management-section"><div className="co-management-section-title"><div><h3>共有できる設定</h3><p>現在のサーバー: {server.name} · {stopped ? "停止中で編集申請が可能" : "起動中のため閲覧のみ"}</p></div><span className="co-revision">rev. {snapshot?.revision ?? "—"}</span></div><div className="co-capability-list">{(snapshot?.capabilities ?? []).map((capability) => <span key={capability.key}>{capability.key}</span>)}</div></section>
      </div>
      <footer className="wizard-footer"><span>状態: {stateLabel(config?.connectionState ?? "disconnected")} · 更新 {config ? formatTime(config.updatedAt) : "—"}</span><button className="secondary-button" type="button" onClick={onClose}>完了</button></footer>
    </section>
  </div>;
}
