import { useEffect, useState } from "react";
import { backend, confirmDanger } from "../lib/backend";
import type { FixedPlayerPreset, PlayerAccessEntry, PlayerAccessKind, RuntimeStatus, ServerFileEntry, ServerProfile } from "../types";
import { Icon } from "./Icon";
import { PlayerFace } from "./PlayerFace";
import { useI18n } from "../lib/i18n";
import { serverManagerText } from "../lib/serverManagerLocale";

const javaAccessTabs: { id: PlayerAccessKind; label: string; detail: string; addLabel: string; removeLabel: string; placeholder: string; dangerousAdd: boolean }[] = [
  { id: "whitelist", label: "ホワイトリスト", detail: "参加を許可するプレイヤー", addLabel: "追加", removeLabel: "外す", placeholder: "Minecraft Java版のプレイヤー名", dangerousAdd: false },
  { id: "operators", label: "権限者", detail: "管理コマンドを使えるプレイヤー", addLabel: "権限を付与", removeLabel: "権限を外す", placeholder: "権限を与えるプレイヤー名", dangerousAdd: true },
  { id: "banned_players", label: "BANプレイヤー", detail: "サーバーへの参加を禁止", addLabel: "BANする", removeLabel: "BAN解除", placeholder: "BANするプレイヤー名", dangerousAdd: true },
  { id: "banned_ips", label: "BANしたIP", detail: "特定IPからの参加を禁止", addLabel: "IPをBAN", removeLabel: "BAN解除", placeholder: "例: 203.0.113.42", dangerousAdd: true },
];

const bedrockAccessTabs: typeof javaAccessTabs = [
  { id: "whitelist", label: "許可リスト", detail: "参加を許可するXboxプレイヤー", addLabel: "追加", removeLabel: "外す", placeholder: "Xboxゲーマータグ", dangerousAdd: false },
  { id: "operators", label: "権限", detail: "ビジター・メンバー・オペレーター", addLabel: "権限を登録", removeLabel: "権限を外す", placeholder: "XboxゲーマータグまたはXUID", dangerousAdd: true },
];

const floodgateAccessTab: (typeof javaAccessTabs)[number] = {
  id: "bedrock_whitelist",
  label: "統合版ホワイトリスト",
  detail: "Geyser／Floodgateから参加するプレイヤー",
  addLabel: "統合版プレイヤーを追加",
  removeLabel: "外す",
  placeholder: "Xboxゲーマータグ（接頭辞は不要）",
  dangerousAdd: false,
};

type PlayerAccessProps = { server: ServerProfile; status: RuntimeStatus; notify: (message: string) => void; fail: (message: string) => void };

export function PlayerAccessTab({ server, status, notify, fail }: PlayerAccessProps) {
  const isBedrock = server.serverType === "bedrock";
  const accessTabs = isBedrock ? bedrockAccessTabs : server.serverType === "paper" ? [javaAccessTabs[0], floodgateAccessTab, ...javaAccessTabs.slice(1)] : javaAccessTabs;
  const [kind, setKind] = useState<PlayerAccessKind>("whitelist");
  const [entries, setEntries] = useState<PlayerAccessEntry[]>([]);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [fixedMembers, setFixedMembers] = useState<FixedPlayerPreset[]>([]);
  const [busy, setBusy] = useState(false);
  const currentTab = accessTabs.find((tab) => tab.id === kind) ?? accessTabs[0];
  const isFloodgateWhitelist = kind === "bedrock_whitelist";
  const running = status.state === "running";
  const stopped = status.state === "stopped";
  const canEdit = running || stopped;
  const onlinePlayers = status.onlinePlayers ?? [];

  useEffect(() => {
    setKind("whitelist");
    setTarget("");
    setReason("");
  }, [server.id, isBedrock]);

  useEffect(() => {
    let active = true;
    backend.playerAccess(server.id, kind).then((items) => active && setEntries(items)).catch((reason) => active && fail(String(reason)));
    return () => { active = false; };
  }, [server.id, kind, fail]);

  useEffect(() => {
    if (!isBedrock || kind !== "operators" || !running) return;
    let active = true;
    const timer = window.setInterval(() => {
      backend.playerAccess(server.id, kind)
        .then((items) => active && setEntries(items))
        .catch((reason) => active && fail(String(reason)));
    }, 3000);
    return () => { active = false; window.clearInterval(timer); };
  }, [server.id, kind, isBedrock, running, fail]);

  useEffect(() => {
    let active = true;
    const refreshFixedMembers = () => backend.listFixedPlayers().then((items) => active && setFixedMembers(items)).catch((reason) => active && fail(String(reason)));
    refreshFixedMembers();
    window.addEventListener("server-hub:fixed-players-changed", refreshFixedMembers);
    return () => { active = false; window.removeEventListener("server-hub:fixed-players-changed", refreshFixedMembers); };
  }, [server.id, fail]);

  const refresh = () => backend.playerAccess(server.id, kind).then(setEntries).catch((failure) => fail(String(failure)));
  const change = async (entry: PlayerAccessEntry | undefined, add: boolean) => {
    const requestedTarget = add ? target.trim() : entry?.label ?? "";
    const action = add ? currentTab.addLabel : currentTab.removeLabel;
    if ((currentTab.dangerousAdd && add) || !add) {
      const subject = kind === "banned_ips" && !add ? "選択したIPアドレス" : requestedTarget;
      if (!await confirmDanger(`${subject} に「${action}」を実行しますか？\nサーバーのプレイヤーアクセス状態が変わります。`)) return;
    }
    setBusy(true);
    try {
      await backend.updatePlayerAccess({ serverId: server.id, kind, target: add ? requestedTarget : (kind === "banned_ips" ? "" : requestedTarget), entryId: entry?.id, add, reason: add ? reason.trim() || undefined : undefined });
      setTarget("");
      setReason("");
      if (running) window.setTimeout(refresh, 700); else await refresh();
      notify(running ? `${action}コマンドを送信しました` : `${action}を停止中の設定ファイルへ保存しました`);
    } catch (failure) { fail(String(failure)); }
    finally { setBusy(false); }
  };

  const fixedMembersForTab = kind === "bedrock_whitelist"
    ? fixedMembers.filter((member) => member.edition === "bedrock" && member.whitelist)
    : kind === "whitelist"
      ? fixedMembers.filter((member) => member.edition === (isBedrock ? "bedrock" : "java") && member.whitelist)
      : kind === "operators" ? fixedMembers.filter((member) => member.edition === (isBedrock ? "bedrock" : "java") && member.operator) : [];
  const applyFixedMembers = async () => {
    if (kind !== "whitelist" && kind !== "bedrock_whitelist" && kind !== "operators") return;
    if (kind === "operators" && !await confirmDanger(`いつものメンバー ${fixedMembersForTab.length}人へ権限を付与しますか？\n権限者は管理コマンドを実行できます。`)) return;
    setBusy(true);
    try {
      const registered = new Set(entries.map((entry) => entry.label.toLowerCase()));
      let applied = 0;
      let skipped = 0;
      for (const member of fixedMembersForTab) {
        const nameKey = member.playerName.toLowerCase();
        if (registered.has(nameKey)) { skipped += 1; continue; }
        try {
          await backend.updatePlayerAccess({ serverId: server.id, kind, target: member.playerName, add: true });
        } catch (failure) {
          throw new Error(`${member.playerName}: ${String(failure)}`);
        }
        registered.add(nameKey);
        applied += 1;
      }
      if (running) window.setTimeout(refresh, 700); else await refresh();
      notify(`いつものメンバーを${currentTab.label}へ反映しました（追加${applied}件・登録済み${skipped}件）`);
    } catch (failure) { fail(`いつものメンバーを反映できませんでした: ${String(failure)}`); }
    finally { setBusy(false); }
  };

  const validTarget = kind === "banned_ips" ? target.trim().length >= 7 : isBedrock || isFloodgateWhitelist ? target.trim().length > 0 && target.trim().length <= 32 && !/[\r\n\t]/.test(target) : /^[A-Za-z0-9_]{3,16}$/.test(target.trim());
  const manageOnlinePlayer = async (playerName: string, action: "op" | "ban") => {
    const label = action === "op" ? (isBedrock ? "オペレーターにする" : "OPにする") : (isBedrock ? "許可リストから外す" : "BANする");
    const detail = isBedrock && action === "ban"
      ? "統合版BDSにはJava版と同じBAN一覧がないため、許可リストから外します。許可リストが有効なサーバーで再参加を防げます。"
      : "サーバーのプレイヤーアクセス状態が変わります。";
    if (!await confirmDanger(`${playerName} を「${label}」しますか？\n${detail}`)) return;
    setBusy(true);
    try {
      await backend.updatePlayerAccess({ serverId: server.id, kind: action === "op" ? "operators" : isBedrock ? "whitelist" : "banned_players", target: playerName, add: action === "op", reason: action === "ban" && !isBedrock ? "Banned from the online player list." : undefined });
      notify(`${playerName} に「${label}」を反映しました`);
      if (kind === (action === "op" ? "operators" : isBedrock ? "whitelist" : "banned_players")) window.setTimeout(refresh, 700);
    } catch (failure) { fail(String(failure)); }
    finally { setBusy(false); }
  };
  return <div className="tab-content files-content">
    <section className="feature-panel player-access-panel">
      <header><div><span className="section-kicker">PLAYER ACCESS</span><h2>プレイヤー管理</h2></div><span className={running ? "status-pill on" : stopped ? "status-pill offline-edit" : "status-pill"}>{running ? "即時反映" : stopped ? "停止中も編集可能" : "処理待ち"}</span></header>
      <nav className="player-access-tabs" aria-label="プレイヤー管理の種類">
        {accessTabs.map((tab) => <button type="button" key={tab.id} className={kind === tab.id ? `active ${tab.id}` : tab.id} onClick={() => { setKind(tab.id); setTarget(""); setReason(""); }}><Icon name={tab.id === "whitelist" || tab.id === "bedrock_whitelist" ? "users" : tab.id === "operators" ? "gear" : "close"} size={20} /><span><strong>{tab.label}</strong><small>{tab.detail}</small></span></button>)}
      </nav>
      <div className="player-access-body">
        <section className="online-player-section" aria-labelledby="online-player-title">
          <div className="online-player-heading"><div><span className="section-kicker">ONLINE NOW</span><h3 id="online-player-title">現在参加しているプレイヤー</h3></div><span className="status-pill on">{`${status.playerCount}人`}</span></div>
          {onlinePlayers.length > 0 ? <div className="online-player-list">{onlinePlayers.map((playerName) => <article key={playerName}>
            <PlayerFace playerName={playerName} playerId={entries.find((entry) => entry.label.toLowerCase() === playerName.toLowerCase())?.id} bedrock={isBedrock} />
            <div><strong>{playerName}</strong><small>{isBedrock ? "統合版プレイヤー" : "Java版またはGeyser経由のプレイヤー"}</small></div>
            <div className="online-player-actions"><button className="small-button" type="button" disabled={busy || !running} onClick={() => manageOnlinePlayer(playerName, "op")}><Icon name="gear" size={15} />{isBedrock ? "オペレーター" : "OP"}</button><button className="danger-button compact" type="button" disabled={busy || !running} onClick={() => manageOnlinePlayer(playerName, "ban")}><Icon name="close" size={15} />{isBedrock ? "許可から外す" : "BAN"}</button></div>
          </article>)}</div> : <div className="panel-empty compact"><p>{status.playerCount > 0 ? `参加人数は${status.playerCount}人ですが、サーバー応答と現在セッションのログから名前を取得できませんでした。` : running ? "現在参加しているプレイヤーはいません。" : "サーバー起動後に参加中のプレイヤーが表示されます。"}</p></div>}
          {isBedrock ? <p className="online-player-note"><Icon name="info" size={15} />統合版BDSではJava版と同じ永続BAN機能がないため、参加拒否は許可リストを有効にして「許可から外す」を使います。</p> : null}
        </section>
        {kind === "whitelist" || kind === "bedrock_whitelist" || kind === "operators" ? <div className="fixed-members-quick"><div><span className="access-avatar whitelist"><Icon name="users" size={19} /></span><span><strong>{kind === "bedrock_whitelist" || isBedrock ? "統合版専用のいつものメンバー" : "いつものメンバー"}</strong><small>設定で保存した{currentTab.label}対象の{fixedMembersForTab.length}人を、このサーバーへ反映します。</small></span></div><button className="secondary-button" type="button" disabled={busy || !canEdit || fixedMembersForTab.length === 0} onClick={applyFixedMembers}><Icon name="users" size={17} />{busy ? "反映中…" : `${currentTab.label}へ反映（${fixedMembersForTab.length}人）`}</button></div> : null}
        {isFloodgateWhitelist ? <p className="offline-access-note"><Icon name="info" size={17} /><span><strong>Floodgate専用</strong>{"公式のfwhitelistを使用します。Xboxゲーマータグに設定上の接頭辞を付けずに入力してください。追加にはFloodgateの導入が必要です。"}</span></p> : null}
        <div className="player-access-add">
          <label><span>{kind === "banned_ips" ? "IPアドレス" : isBedrock ? "Xboxゲーマータグ / XUID" : isFloodgateWhitelist ? "Xboxゲーマータグ" : "プレイヤー名"}</span><input aria-label={kind === "banned_ips" ? "IPアドレス" : isBedrock ? "Xboxゲーマータグ / XUID" : isFloodgateWhitelist ? "Xboxゲーマータグ" : "プレイヤー名"} value={target} onChange={(event) => setTarget(event.target.value)} placeholder={currentTab.placeholder} maxLength={kind === "banned_ips" ? 45 : isBedrock || isFloodgateWhitelist ? 32 : 16} /></label>
          {kind.startsWith("banned_") ? <label className="ban-reason"><span>BAN理由（任意）</span><input aria-label="BAN理由（任意）" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例: 迷惑行為" maxLength={120} /></label> : null}
          <button className={currentTab.dangerousAdd ? "danger-button" : "primary-button"} type="button" disabled={busy || !canEdit || !validTarget} onClick={() => change(undefined, true)}><Icon name={currentTab.dangerousAdd ? "info" : "add"} size={17} />{busy ? (running ? "送信中…" : "保存中…") : currentTab.addLabel}</button>
        </div>
        {stopped ? <p className="offline-access-note"><Icon name="check" size={17} /><span><strong>起動前に登録できます</strong>{isBedrock ? "許可リストはallowlist.json、権限はpermissions.jsonへ保存します。XUIDをまだ取得できないゲーマータグは反映待ちとして表示し、プレイヤーが一度参加した後にもう一度登録すると確定します。" : isFloodgateWhitelist ? "GeyserMC公式プロフィールサービスでFloodgate UUIDを確認できるプレイヤーだけ、安全にwhitelist.jsonへ保存します。確認できない場合はサーバー起動後に再試行してください。" : "停止中はアクセス設定ファイルへ安全に保存し、次回起動時にMinecraftが読み込みます。過去に参加していない名前だけ、公式プロフィール確認を行います。"}</span></p> : null}
        {!canEdit ? <p className="inline-warning"><Icon name="info" size={17} />起動処理または停止処理が終わってから変更してください。</p> : null}
        {kind === "banned_ips" ? <p className="privacy-note access-privacy"><Icon name="info" size={16} />登録済みIPは画面・監査ログで一部を伏せ字にします。BAN解除は内部識別子から安全に実行します。</p> : null}
        <div className="player-access-list">
          {entries.map((entry) => <article key={entry.id}>{kind === "banned_ips" ? <span className={`access-avatar ${kind}`}><Icon name="close" size={19} /></span> : <PlayerFace playerName={entry.label} playerId={entry.id} bedrock={isBedrock || isFloodgateWhitelist} />}<div><strong>{entry.label}</strong><small>{entry.detail || "詳細なし"}</small>{entry.pending ? <em>参加後は最大3秒ほどでXUIDを確認し、オペレーター権限を自動反映します。</em> : null}{entry.reason ? <em>理由: {entry.reason}</em> : null}{entry.level !== undefined ? <em>権限レベル: {entry.level}</em> : null}{entry.expires ? <em>期限: {entry.expires}</em> : null}</div><button className="small-button" type="button" disabled={busy || !canEdit} onClick={() => change(entry, false)}>{entry.pending ? "待機を取消" : currentTab.removeLabel}</button></article>)}
          {entries.length === 0 ? <div className="panel-empty compact"><p>{currentTab.label}に登録された項目はありません。</p></div> : null}
        </div>
      </div>
    </section>
  </div>;
}

function joinServerPath(directory: string, name: string) { return directory ? `${directory}/${name}` : name; }
function parentServerPath(path: string) { return path.split("/").slice(0, -1).join("/"); }
function formatFileSize(size: number) { if (size < 1024) return `${size} B`; if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`; return `${(size / 1024 / 1024).toFixed(1)} MiB`; }

export function ServerFilesTab({ server, status }: { server: ServerProfile; status?: RuntimeStatus }) {
  const { locale } = useI18n();
  const fm = (key: Parameters<typeof serverManagerText>[1], values?: Record<string, string>) => serverManagerText(locale, key, values);
  const [path, setPath] = useState("");
  const [items, setItems] = useState<ServerFileEntry[]>([]);
  const [selected, setSelected] = useState<ServerFileEntry>();
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const stopped = !status || status.state === "stopped";
  const dirty = selected?.editable && content !== savedContent;

  const refresh = async (nextPath = path) => {
    setBusy(true); setError("");
    try { setItems(await backend.listServerFiles(server.id, nextPath)); setPath(nextPath); setSelected(undefined); setContent(""); setSavedContent(""); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  useEffect(() => { void refresh(""); }, [server.id]);

  const openItem = async (item: ServerFileEntry) => {
    if (dirty && !await confirmDanger(fm("discardChanges"))) return;
    if (item.kind === "directory") { await refresh(item.path); return; }
    setSelected(item); setError("");
    if (!item.editable) { setContent(""); setSavedContent(""); return; }
    setBusy(true);
    try { const value = await backend.readServerTextFile(server.id, item.path); setContent(value); setSavedContent(value); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const mutate = async (action: () => Promise<unknown>) => { setBusy(true); setError(""); try { await action(); await refresh(path); } catch (reason) { setError(String(reason)); setBusy(false); } };
  const createFile = () => { const name = window.prompt(fm("newFilePrompt")); if (name?.trim()) void mutate(() => backend.writeServerTextFile(server.id, joinServerPath(path, name.trim()), "")); };
  const createFolder = () => { const name = window.prompt(fm("newFolderPrompt")); if (name?.trim()) void mutate(() => backend.createServerDirectory(server.id, joinServerPath(path, name.trim()))); };
  const renameItem = () => { if (!selected) return; const name = window.prompt(fm("renamePrompt"), selected.name); if (name?.trim() && name.trim() !== selected.name) void mutate(() => backend.renameServerFile(server.id, selected.path, name.trim())); };
  const deleteItem = async () => { if (!selected || !await confirmDanger(fm("deleteConfirm", { name: selected.name }))) return; await mutate(() => backend.deleteServerFile(server.id, selected.path)); };
  const upload = async () => { try { const { open } = await import("@tauri-apps/plugin-dialog"); const source = await open({ multiple: false, title: fm("uploadTitle") }); if (typeof source === "string") await mutate(() => backend.uploadServerFile(server.id, path, source)); } catch (reason) { setError(String(reason)); } };
  const download = async () => { if (!selected || selected.kind !== "file") return; try { const { save } = await import("@tauri-apps/plugin-dialog"); const destination = await save({ title: fm("downloadTitle"), defaultPath: selected.name }); if (destination) { await backend.downloadServerFile(server.id, selected.path, destination); } } catch (reason) { setError(String(reason)); } };
  const saveText = async () => { if (!selected?.editable) return; setBusy(true); setError(""); try { await backend.writeServerTextFile(server.id, selected.path, content); setSavedContent(content); } catch (reason) { setError(String(reason)); } finally { setBusy(false); } };

  const crumbs = path ? path.split("/") : [];
  return <div className="tab-content files-content"><section className="feature-panel file-manager"><header><div><span className="section-kicker">FILES · SANDBOXED</span><h2>{fm("serverFiles")}</h2></div><div className="file-actions"><button className="small-button" onClick={() => backend.openFolder(server.id)}><Icon name="folder" size={16}/>{fm("openWindows")}</button><button className="small-button" disabled={!stopped || busy} onClick={createFile}>{fm("newFile")}</button><button className="small-button" disabled={!stopped || busy} onClick={createFolder}>{fm("newFolder")}</button><button className="small-button" disabled={!stopped || busy} onClick={upload}><Icon name="download" size={16}/>{fm("upload")}</button></div></header>
    <div className="file-manager-note"><Icon name="check" size={16}/><span>{fm("sandboxNote")}</span></div>
    <nav className="file-breadcrumb" aria-label="Current folder"><button onClick={() => void refresh("")}>ROOT</button>{crumbs.map((crumb, index) => <button key={`${crumb}-${index}`} onClick={() => void refresh(crumbs.slice(0, index + 1).join("/"))}>/ {crumb}</button>)}</nav>
    {error ? <p className="inline-error"><Icon name="info" size={16}/>{error}</p> : null}
    <div className="file-manager-grid"><div className="file-list" aria-busy={busy}>{path ? <button className="file-row parent" onClick={() => void refresh(parentServerPath(path))}><Icon name="folder"/><span><strong>..</strong><small>{fm("parentFolder")}</small></span></button> : null}{items.map((item) => <button key={item.path} className={`file-row${selected?.path === item.path ? " selected" : ""}`} onClick={() => void openItem(item)}><Icon name={item.kind === "directory" ? "folder" : "clipboard"}/><span><strong>{item.name}</strong><small>{item.kind === "directory" ? "Folder" : formatFileSize(item.sizeBytes)}{item.editable ? " · Text" : ""}</small></span><Icon name="chevron" size={16}/></button>)}{!busy && items.length === 0 ? <div className="panel-empty compact"><p>{fm("emptyFolder")}</p></div> : null}</div>
      <div className="file-preview">{selected ? <><header><div><strong>{selected.name}</strong><small>{selected.path}</small></div><div><button className="small-button" disabled={busy} onClick={download}>{fm("download")}</button><button className="small-button" disabled={!stopped || busy} onClick={renameItem}>{fm("rename")}</button><button className="danger-button" disabled={!stopped || busy} onClick={deleteItem}>{fm("delete")}</button></div></header>{selected.editable ? <><textarea value={content} onChange={(event) => setContent(event.target.value)} spellCheck={false}/><footer><span>{new Blob([content]).size.toLocaleString(locale)} B · {dirty ? fm("unsaved") : fm("saved")}</span><button className="primary-button" disabled={!stopped || busy || !dirty} onClick={saveText}>{fm("save")}</button></footer></> : <div className="panel-empty"><Icon name="info"/><p>{fm("unsupportedEdit")}</p></div>}</> : <div className="panel-empty"><Icon name="folder"/><p>{fm("selectFile")}</p></div>}</div>
    </div></section></div>;
}

/** Kept for focused compatibility tests; the app now shows these in separate tabs. */
export function FilesPlayersTab(props: PlayerAccessProps) {
  return <><PlayerAccessTab {...props} /><ServerFilesTab server={props.server} status={props.status} /></>;
}
