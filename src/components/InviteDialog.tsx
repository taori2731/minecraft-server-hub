import { useEffect, useState } from "react";
import { backend, confirmDanger } from "../lib/backend";
import type { InviteInfo, InviteSettings, PublicAccessStatus, RuntimeStatus, ServerProfile } from "../types";
import { Icon } from "./Icon";
import { TunnelLocalPanel } from "./TunnelLocalPanel";

interface Props {
  server: ServerProfile;
  status: RuntimeStatus;
  onClose: () => void;
  notify: (message: string) => void;
}

const samePublicAccess = (left?: PublicAccessStatus, right?: PublicAccessStatus) => Boolean(left && right
  && left.state === right.state
  && left.address === right.address
  && left.namedAddress === right.namedAddress
  && left.inviteName === right.inviteName
  && left.hostnameState === right.hostnameState
  && left.hostnameMessage === right.hostnameMessage
  && left.expiresAt === right.expiresAt
  && left.message === right.message);

export function InviteDialog({ server, status, onClose, notify }: Props) {
  const isBedrock = server.serverType === "bedrock";
  const editionName = isBedrock ? "Minecraft 統合版" : "Minecraft Java版";
  const transport = isBedrock ? "UDP" : "TCP";
  const [info, setInfo] = useState<InviteInfo>();
  const [settings, setSettings] = useState<InviteSettings>();
  const [inviteName, setInviteName] = useState(server.name);
  const [customHostname, setCustomHostname] = useState("");
  const [publicAccess, setPublicAccess] = useState<PublicAccessStatus>();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const refresh = () => Promise.all([
    backend.inviteInfo(server.id),
    backend.inviteSettings(server.id),
    backend.publicAccessStatus(server.id),
  ]).then(([nextInfo, nextSettings, nextAccess]) => {
    setInfo(nextInfo);
    setSettings(nextSettings);
    setInviteName(nextSettings.inviteName);
    setCustomHostname(nextSettings.customHostname ?? "");
    setPublicAccess((current) => samePublicAccess(current, nextAccess) ? current : nextAccess);
  }).catch((reason) => setError(String(reason)));

  useEffect(() => {
    let active = true;
    Promise.all([
      backend.inviteInfo(server.id),
      backend.inviteSettings(server.id),
      backend.publicAccessStatus(server.id),
    ]).then(([nextInfo, nextSettings, nextAccess]) => {
      if (!active) return;
      setInfo(nextInfo);
      setSettings(nextSettings);
      setInviteName(nextSettings.inviteName);
      setCustomHostname(nextSettings.customHostname ?? "");
      setPublicAccess(nextAccess);
    }).catch((reason) => active && setError(String(reason)));
    const timer = window.setInterval(() => backend.publicAccessStatus(server.id)
      .then((next) => active && setPublicAccess((current) => samePublicAccess(current, next) ? current : next))
      .catch(() => undefined), 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [server.id]);

  const copy = async (value: string, message = "参加用アドレスをコピーしました") => {
    await navigator.clipboard.writeText(value);
    notify(message);
  };

  const saveSettings = async () => {
    setSaving(true);
    setError("");
    try {
      const next = await backend.updateInviteSettings({
        serverId: server.id,
        inviteName,
        customHostname: customHostname.trim() || undefined,
      });
      setSettings(next);
      setInviteName(next.inviteName);
      setCustomHostname(next.customHostname ?? "");
      setPublicAccess(await backend.publicAccessStatus(server.id));
      notify("招待名と接続名の設定を保存しました");
    } catch (reason) { setError(String(reason)); }
    finally { setSaving(false); }
  };

  const publish = async () => {
    const accepted = await confirmDanger(`インターネット公開を開始しますか？\n\nルーターへ${transport} ${server.port}の期限付きUPnP転送を作成します。参加者には自宅回線の公開IPが見えます。公開終了またはサーバー停止で転送を削除します。`);
    if (!accepted) return;
    setBusy(true);
    setError("");
    try {
      const result = await backend.publishServerUpnp(server.id);
      setPublicAccess(result);
      notify("インターネット公開を開始しました");
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };

  const unpublish = async () => {
    setBusy(true);
    setError("");
    try {
      setPublicAccess(await backend.unpublishServer(server.id));
      notify("インターネット公開を終了しました");
    } catch (reason) { setError(String(reason)); await refresh(); }
    finally { setBusy(false); }
  };

  const isPublished = publicAccess?.state === "published" || publicAccess?.state === "warning";
  const canPublish = status.state === "running" && !info?.whitelistRecommended;
  const friendAddress = publicAccess?.namedAddress ?? publicAccess?.address;
  const hostnameReady = publicAccess?.hostnameState === "verified";
  const settingsDirty = Boolean(settings && (inviteName.trim() !== settings.inviteName || customHostname.trim().toLowerCase().replace(/\.$/, "") !== (settings.customHostname ?? "")));

  return <div className="modal-backdrop">
    <section className="wizard invite-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title">
      <header className="wizard-header">
        <div><p className="wizard-kicker">SAFE INTERNET INVITE</p><h2 id="invite-title">友達を招待</h2></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button>
      </header>
      <div className="wizard-body invite-body">
        <section className="invite-settings-card" aria-labelledby="invite-settings-title">
          <div className="invite-settings-heading"><div><span className="section-kicker">参加先の名前</span><h3 id="invite-settings-title">招待名を自分で設定</h3></div><span className="status-pill">サーバー別</span></div>
          <div className="invite-settings-grid">
            <label><span>招待名</span><input aria-label="招待名" value={inviteName} maxLength={32} onChange={(event) => setInviteName(event.target.value)} placeholder="例: 夜ふかしサバイバル" /><small>画面と招待案内に表示する名前です。</small></label>
            <label><span>独自ドメイン・DDNS（任意）</span><input aria-label="独自ドメイン・DDNS（任意）" value={customHostname} onChange={(event) => setCustomHostname(event.target.value)} placeholder="play.example.com" autoCapitalize="none" spellCheck={false} /><small>`https://`、パス、ポートは入力しません。</small></label>
          </div>
          <div className="invite-settings-actions"><p>ドメイン側のAレコードを公開IPへ向けると、数値IPの代わりに名前で参加できます。{isBedrock ? "統合版では参加時にUDPポートも入力します。" : "Java版はSRVレコードでポートを省略できます。"}アプリがドメインを購入・変更することはありません。</p><button className="secondary-button" type="button" disabled={!settingsDirty || saving || !inviteName.trim()} onClick={saveSettings}>{saving ? "DNSを確認中…" : "招待設定を保存"}</button></div>
        </section>

        <TunnelLocalPanel server={server} runtime={status} notify={notify} reportError={setError} />

        <section className={`public-access-card ${isPublished ? "published" : ""}`}>
          <header><div><span className="section-kicker">別の公開方法</span><h3>{isPublished ? `${publicAccess?.inviteName ?? inviteName} を公開中` : "UPnP対応ルーターから直接公開"}</h3></div><span className={`status-pill ${isPublished ? "on" : ""}`}>{isPublished ? "公開中" : "非公開"}</span></header>
          {isPublished && friendAddress ? <>
            <p>友達の{editionName}「{isBedrock ? "プレイ → サーバー → サーバーを追加" : "マルチプレイ → サーバーを追加"}」に、次の接続先を入力してもらいます。</p>
            <div className="public-address"><code>{friendAddress}</code><button className="primary-button" type="button" onClick={() => copy(friendAddress)}><Icon name="clipboard" size={17} />コピー</button></div>
            {publicAccess?.namedAddress && publicAccess.address ? <div className="numeric-fallback"><span>数値アドレス（予備）</span><code>{publicAccess.address}</code><button className="small-button" type="button" onClick={() => copy(publicAccess.address!, "予備アドレスをコピーしました")}><Icon name="clipboard" size={15} />コピー</button></div> : null}
            <p className="privacy-note">方式: {publicAccess?.method} · {publicAccess?.message}</p>
            {publicAccess?.customHostname && !hostnameReady ? <p className="inline-warning"><Icon name="info" size={17} />{publicAccess.hostnameMessage}</p> : null}
            {!isBedrock && publicAccess?.customHostname && publicAccess.address?.split(":")[1] !== "25565" ? <p className="dns-note">ポート番号も省略したい場合は、DNS側でMinecraft Java用SRVレコードを設定してください。</p> : null}
            {publicAccess?.state === "warning" ? <p className="inline-warning"><Icon name="info" size={17} />{publicAccess.message}</p> : null}
          </> : <>
            <p>ルーターがUPnPに対応し、公開IPv4を利用できる場合は、{transport} {server.port}だけを期限付きで転送して参加アドレスを作成します。ルーター画面の操作は不要です。</p>
            <p className="privacy-note">初回起動時にWindows セキュリティの警告が出た場合は、「プライベート ネットワーク」を許可してください。</p>
            {status.state !== "running" ? <p className="inline-warning"><Icon name="info" size={17} />先にMinecraftサーバーを起動してください。</p> : null}
            {info?.whitelistRecommended ? <p className="inline-warning"><Icon name="info" size={17} />安全のため「設定」でホワイトリストを有効にしてから公開してください。</p> : null}
            <button className="primary-button publish-button" type="button" disabled={!canPublish || busy} onClick={publish}><Icon name="invite" size={18} />{busy ? "ルーターを設定中…" : "別の家の友達向けに公開"}</button>
          </>}
          {isPublished ? <button className="secondary-button unpublish-button" type="button" disabled={busy} onClick={unpublish}><Icon name="close" size={17} />{busy ? "公開終了中…" : "公開を終了"}</button> : null}
        </section>

        <section className="join-routes" aria-label="参加方法">
          <article><span className="section-kicker">このPCから参加</span><h3>ホスト本人</h3><p>{editionName}をこのPCで開き、この接続先を使います。</p><div className="address-row"><code>{info?.hostAddress ?? `127.0.0.1:${server.port}`}</code><button className="small-button" type="button" onClick={() => copy(info?.hostAddress ?? `127.0.0.1:${server.port}`, "ホスト用アドレスをコピーしました")}><Icon name="clipboard" size={16} />コピー</button></div>{isBedrock ? <p className="inline-warning"><Icon name="info" size={16} />Windows版統合版で同じPCへ接続できない場合は、Windowsのループバック制限が原因です。<a href="https://learn.microsoft.com/minecraft/creator/documents/bedrockserver/getting-started" target="_blank" rel="noreferrer">Microsoft公式手順</a>を確認してください。アプリは無断でWindows設定を変更しません。</p> : null}</article>
          <article><span className="section-kicker">別の家から参加</span><h3>友達</h3><p>{isPublished ? "上の公開アドレスを使います。" : "公開開始後に友達用アドレスが表示されます。"}</p><strong>{isPublished ? "同じサーバーへ接続" : "現在は非公開"}</strong></article>
        </section>
        <p className="same-world-note"><Icon name="check" size={17} />ホスト本人と別の家の友達は、どちらも同じサーバー・同じワールドに参加します。</p>

        <section className="invite-section lan-section"><h3>同じLANから参加</h3><p>友達の{isBedrock ? "PC・スマホ・タブレット" : "PC"}が同じルーターにつながっている場合に使えます。通信方式は{transport}です。</p>{info?.lanAddresses.map((address) => <div className="address-row" key={address}><code>{address}</code><button className="small-button" type="button" onClick={() => copy(address)}><Icon name="clipboard" size={16} />コピー</button></div>)}{info && info.lanAddresses.length === 0 ? <p className="inline-warning">LANアドレスを取得できませんでした。</p> : null}</section>
        {isBedrock ? <section className="invite-section console-join-note"><h3>ゲーム機から参加する場合</h3><p>Xbox・PlayStation・Nintendo Switchでは、任意サーバー追加がプラットフォームやアカウント設定によって制限される場合があります。PC・スマホでの追加方法と同じとは限りません。</p></section> : null}

        {error ? <div className="error-banner" role="alert"><Icon name="info" /><span>{error}</span></div> : null}
      </div>
      <footer className="wizard-footer"><button className="secondary-button" type="button" onClick={onClose}>閉じる</button><small>公開中はMinecraftサーバーとこのアプリを起動したままにしてください。</small></footer>
    </section>
  </div>;
}
