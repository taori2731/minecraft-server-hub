import { useEffect, useState } from "react";
import { backend, confirmDanger } from "../lib/backend";
import type { CrossplayPlan, CrossplayStatus, RuntimeStatus, ServerProfile, TunnelAgentInstallPlan, TunnelDiagnosis, TunnelExternalProbe, TunnelStatus } from "../types";
import { Icon } from "./Icon";
import { OperationOverlay } from "./OperationOverlay";

interface Props {
  server: ServerProfile;
  status: RuntimeStatus;
  onClose: () => void;
  notify: (message: string) => void;
}

const activeTunnel = (status?: TunnelStatus) => Boolean(status && !["unconfigured", "disconnected", "error"].includes(status.state));

export function splitBedrockEndpoint(value: string) {
  const endpoint = value.trim();
  const bracketed = /^\[([^\]]+)]:(\d{1,5})$/.exec(endpoint);
  if (bracketed) {
    const port = Number(bracketed[2]);
    if (port >= 1 && port <= 65535) return { address: bracketed[1], port: String(port), complete: true };
  }
  if ((endpoint.match(/:/g) ?? []).length === 1) {
    const separator = endpoint.lastIndexOf(":");
    const address = endpoint.slice(0, separator).trim();
    const rawPort = endpoint.slice(separator + 1).trim();
    const port = /^\d{1,5}$/.test(rawPort) ? Number(rawPort) : 0;
    if (address && port >= 1 && port <= 65535) return { address, port: String(port), complete: true };
  }
  return { address: endpoint, port: "", complete: false };
}

export function CrossplayInviteDialog({ server, status: runtime, onClose, notify }: Props) {
  const [crossplay, setCrossplay] = useState<CrossplayStatus>();
  const [plan, setPlan] = useState<CrossplayPlan>();
  const [port, setPort] = useState(19132);
  const [includeFloodgate, setIncludeFloodgate] = useState(true);
  const [acceptInstall, setAcceptInstall] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [tunnel, setTunnel] = useState<TunnelStatus>();
  const [diagnosis, setDiagnosis] = useState<TunnelDiagnosis>();
  const [probe, setProbe] = useState<TunnelExternalProbe>();
  const [installPlan, setInstallPlan] = useState<TunnelAgentInstallPlan>();
  const [installAccepted, setInstallAccepted] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    const next = await backend.crossplayStatus(server.id);
    setCrossplay(next);
    if (next.bedrockPort) setPort(next.bedrockPort);
    setIncludeFloodgate(next.floodgateInstalled || !next.installed);
    if (next.installed) {
      const tunnelStatus = await backend.crossplayTunnelStatus(server.id);
      setTunnel(tunnelStatus);
      setTermsAccepted(tunnelStatus.termsAcknowledged);
    }
  };

  useEffect(() => {
    let active = true;
    backend.crossplayStatus(server.id).then(async (next) => {
      if (!active) return;
      setCrossplay(next);
      if (next.bedrockPort) setPort(next.bedrockPort);
      setIncludeFloodgate(next.floodgateInstalled || !next.installed);
      if (next.installed) {
        const nextTunnel = await backend.crossplayTunnelStatus(server.id);
        if (!active) return;
        setTunnel(nextTunnel);
        setTermsAccepted(nextTunnel.termsAcknowledged);
      }
    }).catch((reason: unknown) => active && setError(String(reason)));
    return () => { active = false; };
  }, [server.id]);

  useEffect(() => {
    if (!activeTunnel(tunnel)) return;
    let active = true;
    let requestActive = false;
    const timer = window.setInterval(() => {
      if (requestActive) return;
      requestActive = true;
      backend.crossplayTunnelStatus(server.id)
        .then((next) => active && setTunnel(next))
        .catch(() => undefined)
        .finally(() => { requestActive = false; });
    }, tunnel?.state === "connected" ? 30_000 : 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [server.id, tunnel?.state]);

  const prepare = async () => {
    setBusy("plan"); setError(""); setAcceptInstall(false);
    try { setPlan(await backend.getCrossplayPlan(server.id, port)); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(""); }
  };

  const install = async () => {
    if (!plan?.eligible || !acceptInstall) return;
    if (!await confirmDanger(`Geyser${includeFloodgate ? "とFloodgate" : ""}を導入しますか？\n\n現在のサーバーを安全に停止し、変更前バックアップを作成してから公式配布物を追加します。`)) return;
    setBusy("crossplay"); setError("");
    try {
      if (["running", "starting"].includes(runtime.state)) await backend.stop(server.id);
      await backend.installCrossplay({ serverId: server.id, includeFloodgate, bedrockPort: port, acceptWarnings: true });
      await refresh();
      notify("Geyserと統合版招待の準備を追加しました");
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(""); }
  };

  const beginTunnel = async (confirmedByInstall = false) => {
    const termsReady = Boolean(tunnel?.termsAcknowledged || termsAccepted);
    if (!termsReady) { setError("初回だけ、playit.ggの利用規約とプライバシーポリシーを確認してください"); return; }
    if (!confirmedByInstall && !await confirmDanger(`統合版用アドレスを作成しますか？\n\nPaperを起動し、Geyserの127.0.0.1:${port}/UDPだけをplayit.ggで中継します。Java版のTCP招待や管理画面は変更しません。`)) return;
    setBusy("tunnel"); setError(""); setDiagnosis(undefined); setProbe(undefined);
    try {
      let currentCrossplay = await backend.crossplayStatus(server.id);
      let currentRuntime = await backend.status(server.id);
      if (!currentCrossplay.configurationReady) {
        if (!currentCrossplay.configurationGenerated) {
          if (!["running", "starting"].includes(currentRuntime.state)) await backend.start(server.id);
          const deadline = Date.now() + 60_000;
          while (!currentCrossplay.configurationGenerated && Date.now() < deadline) {
            await new Promise((resolve) => window.setTimeout(resolve, 1_000));
            currentCrossplay = await backend.crossplayStatus(server.id);
          }
          if (!currentCrossplay.configurationGenerated) throw new Error("Geyserのconfig.ymlを60秒以内に生成できませんでした。Paperのログを確認してください");
        }
        currentRuntime = await backend.status(server.id);
        if (["running", "starting"].includes(currentRuntime.state)) await backend.stop(server.id);
        const configured = await backend.configureCrossplay(server.id);
        notify(configured.message);
      }
      currentRuntime = await backend.status(server.id);
      if (!["running", "starting"].includes(currentRuntime.state)) await backend.start(server.id);
      const next = await backend.quickStartCrossplayTunnel({ serverId: server.id, termsAccepted: termsReady });
      setTunnel(next);
      setTermsAccepted(next.termsAcknowledged);
      if (["not_configured", "invalid"].includes(next.accountState)) {
        await backend.openCrossplayTunnelAccountLogin(server.id);
        notify("playit.gg公式ログイン画面を開きました");
      } else if (!next.matchingTunnel) {
        await backend.openCrossplayTunnelDashboard(server.id);
        notify("Minecraft Bedrock / UDPトンネル作成画面を開きました");
      } else if (next.publicEndpoint) {
        notify("統合版用の参加アドレスを取得しました");
      }
      await refresh();
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(""); }
  };

  const publish = async () => {
    setBusy("agent"); setError("");
    try {
      const nextPlan = await backend.tunnelAgentInstallPlan(server.id);
      if (nextPlan.alreadyInstalled && nextPlan.installedValidation) {
        setBusy("");
        await beginTunnel();
      } else {
        setInstallPlan(nextPlan);
        setInstallAccepted(false);
      }
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(""); }
  };

  const installAgentAndPublish = async () => {
    if (!installPlan || !installAccepted) return;
    setBusy("agent-install"); setError("");
    try {
      await backend.installTunnelAgent({ serverId: server.id, version: installPlan.version, sourceUrl: installPlan.sourceUrl, sizeBytes: installPlan.sizeBytes, checksumSha256: installPlan.checksumSha256 });
      setInstallPlan(undefined);
      notify("playit.gg公式エージェントを準備しました");
      await beginTunnel(true);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(""); }
  };

  const stop = async () => {
    setBusy("stop"); setError("");
    try { setTunnel(await backend.stopCrossplayTunnel(server.id)); notify("統合版の招待を停止しました"); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(""); }
  };

  const copyPart = async (value: string, label: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    notify(`${label}をコピーしました`);
  };

  const connected = tunnel?.state === "connected" && Boolean(tunnel.publicEndpoint);
  const endpointReady = Boolean(tunnel?.publicEndpoint);
  const bedrockEndpoint = tunnel?.publicEndpoint ? splitBedrockEndpoint(tunnel.publicEndpoint) : undefined;
  return <div className="modal-backdrop">
    <section className="wizard invite-dialog crossplay-invite-dialog" role="dialog" aria-modal="true" aria-labelledby="crossplay-invite-title">
      <header className="wizard-header">
        <div><p className="wizard-kicker">JAVA + BEDROCK CROSSPLAY</p><h2 id="crossplay-invite-title">統合版を招待</h2></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="閉じる"><Icon name="close" /></button>
      </header>
      <div className="wizard-body invite-body">
        <section className="crossplay-summary-card">
          <div className="crossplay-path"><span>Paper</span><Icon name="chevron" size={17}/><span>Geyser</span><Icon name="chevron" size={17}/><span>Java版＋統合版</span></div>
          <p>このPaperサーバーと同じワールドへ、Java版の友達は通常のJavaアドレス、統合版の友達はここで作るUDPアドレスから参加します。</p>
        </section>

        {!crossplay?.installed ? <section className="feature-panel crossplay-guide-panel">
          <header><div><span className="section-kicker">STEP 1 · OFFICIAL GEYSER</span><h3>Java版と統合版をつなぐ</h3></div><span className="status-pill">未導入</span></header>
          <div className="crossplay-config-row">
            <label><span>統合版用UDPポート</span><input type="number" min={1024} max={65535} value={port} onChange={(event) => { setPort(Number(event.target.value)); setPlan(undefined); }} /></label>
            <label className="confirm-check"><input type="checkbox" checked={includeFloodgate} onChange={(event) => setIncludeFloodgate(event.target.checked)} />Floodgateも導入する（統合版の友達はJavaアカウント不要）</label>
            <button className="primary-button" type="button" disabled={Boolean(busy) || port < 1024 || port > 65535} onClick={prepare}><Icon name="search" size={17}/>{busy === "plan" ? "公式配布情報を確認中…" : "公式導入内容を確認"}</button>
          </div>
          {plan ? <div className="crossplay-plan">
            <p className={plan.eligible ? "diagnosis-ok" : "inline-warning"}><Icon name={plan.eligible ? "check" : "info"} size={17}/>{plan.eligible ? "このPaperサーバーへ導入できます" : "現在の構成には導入できません"}</p>
            {plan.warnings.map((warning) => <p className="inline-warning" key={warning}>{warning}</p>)}
            <label className="confirm-check"><input type="checkbox" checked={acceptInstall} onChange={(event) => setAcceptInstall(event.target.checked)} />バックアップ後に公式Geyser/Floodgateを追加し、統合版用UDP公開が別に必要なことを確認しました</label>
            <button className="primary-button" type="button" disabled={Boolean(busy) || !plan.eligible || !acceptInstall} onClick={install}><Icon name="download" size={17}/>停止・バックアップして導入</button>
          </div> : null}
        </section> : <section className="tunnel-local-panel">
          <header><div><span className="section-kicker">STEP 2 · BEDROCK UDP INVITE</span><h3>統合版用アドレスを作る</h3></div><span className={`status-pill ${connected ? "on" : ""}`}>{connected ? "接続確認済み" : endpointReady ? "接続先取得済み" : activeTunnel(tunnel) ? "準備中" : "停止中"}</span></header>
          <p>Geyserの <code>127.0.0.1:{port}/UDP</code> だけを中継します。Java版用TCPアドレス、管理画面、SQLite、バックアップは公開しません。</p>
          {!crossplay.configurationGenerated ? <p className="inline-warning"><Icon name="info" size={17}/>初回はPaper起動時にGeyser設定が生成されます。UDPポートが準備できない場合は、<code>plugins/Geyser-Spigot/config.yml</code> のBedrockポートを {port} にしてください。</p> : null}
          {!tunnel?.termsAcknowledged ? <label className="tunnel-terms"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)}/><span><a href="https://playit.gg/terms/" target="_blank" rel="noreferrer">利用規約</a>と<a href="https://playit.gg/privacy-policy/" target="_blank" rel="noreferrer">プライバシーポリシー</a>、通信品質が外部サービスに依存することを確認しました。</span></label> : <p className="terms-saved"><Icon name="check" size={16}/>利用条件は確認済みです</p>}
          {installPlan ? <div className="tunnel-install-plan">
            <strong>playit.gg公式エージェントを準備</strong><p>公式MSIをSHA-256とWindows署名で検証してからインストールします。</p>
            <dl><div><dt>配布元</dt><dd>{installPlan.publisher}</dd></div><div><dt>バージョン</dt><dd>{installPlan.version}</dd></div><div><dt>容量</dt><dd>{(installPlan.sizeBytes / 1024 / 1024).toFixed(1)} MiB</dd></div><div><dt>保存先</dt><dd>{installPlan.installPath}</dd></div></dl>
            <label className="tunnel-install-consent"><input type="checkbox" checked={installAccepted} onChange={(event) => setInstallAccepted(event.target.checked)}/><span>配布元、版、容量、管理者権限、Windowsサービス、保存先を確認しました。</span></label>
            <button className="primary-button" type="button" disabled={Boolean(busy) || !installAccepted} onClick={installAgentAndPublish}><Icon name="download" size={17}/>公式エージェントを入れて続ける</button>
          </div> : <div className="quick-publish-actions">
            <button className="primary-button" type="button" disabled={Boolean(busy) || !(tunnel?.termsAcknowledged || termsAccepted)} onClick={publish}><Icon name="invite" size={18}/>{busy ? "準備しています…" : endpointReady ? "公開状態を再確認" : "統合版用アドレスを作る"}</button>
            <button className="secondary-button" type="button" disabled={Boolean(busy) || !activeTunnel(tunnel)} onClick={stop}><Icon name="close" size={16}/>統合版の招待を停止</button>
          </div>}
          {endpointReady && bedrockEndpoint ? <div className="tunnel-endpoint-card bedrock-endpoint-card" role="status"><span>統合版の友達が入力する内容</span><h4>Minecraft統合版では、アドレスとポートを別々に入力します</h4><div className="bedrock-endpoint-fields"><div><small>サーバーアドレス</small><strong>{bedrockEndpoint.address}</strong><button className="secondary-button" type="button" onClick={() => copyPart(bedrockEndpoint.address, "サーバーアドレス")}><Icon name="clipboard" size={17}/>アドレスをコピー</button></div><div><small>サーバーポート</small><strong>{bedrockEndpoint.port || "未取得"}</strong><button className="secondary-button" type="button" disabled={!bedrockEndpoint.port} onClick={() => copyPart(bedrockEndpoint.port, "サーバーポート")}><Icon name="clipboard" size={17}/>ポートをコピー</button></div></div><p className="inline-warning"><Icon name="info" size={16}/>統合版の「サーバーポート」にJava版用の 25565 を残さず、上に表示された統合版用ポートを入力してください。</p><ol className="bedrock-join-steps"><li>「プレイ」を開く</li><li>「サーバー」→「サーバーを追加」を選ぶ</li><li>上のサーバーアドレスとサーバーポートを、それぞれ対応する欄へ入力する</li></ol>{!bedrockEndpoint.complete ? <p className="inline-warning"><Icon name="info" size={16}/>公開先からポートを分離できませんでした。playit.ggのMinecraft Bedrock / UDP設定を確認してください。</p> : null}<p>Java版の友達は、ここに表示された値ではなく従来のJava版用アドレスを使います。</p><div><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={async () => { setBusy("probe"); try { setProbe(await backend.probeCrossplayTunnelEndpoint(server.id)); await refresh(); } catch (reason) { setError(String(reason)); } finally { setBusy(""); } }}><Icon name="refresh" size={16}/>外部経路をテスト</button></div></div> : null}
          {activeTunnel(tunnel) && !tunnel?.matchingTunnel ? <div className="tunnel-setup-guide"><strong>初回だけ公式画面で設定</strong><ol><li>playit.ggへログイン</li><li>Minecraft Bedrock / UDPを選択</li><li>転送先を <code>127.0.0.1:{port}</code> にする</li><li>この画面で「公開状態を再確認」</li></ol><div><button className="secondary-button" type="button" onClick={() => backend.openCrossplayTunnelAccountLogin(server.id).catch((reason: unknown) => setError(String(reason)))}>公式画面でログイン</button><button className="secondary-button" type="button" onClick={() => backend.openCrossplayTunnelDashboard(server.id).catch((reason: unknown) => setError(String(reason)))}>UDPトンネルを追加</button></div></div> : null}
          <div className="tunnel-actions"><button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={async () => { setBusy("diagnosis"); try { setDiagnosis(await backend.diagnoseCrossplayTunnel(server.id)); } catch (reason) { setError(String(reason)); } finally { setBusy(""); } }}><Icon name="refresh" size={16}/>接続診断</button></div>
          {probe ? <div className={`tunnel-probe ${probe.reachable ? "ok" : ""}`}><strong>{probe.reachable ? "Bedrock UDP/RakNet応答あり" : "外部経路は未確認"}</strong><p>{probe.message}</p></div> : null}
          {diagnosis ? <div className="tunnel-diagnosis"><strong>統合版接続の診断</strong><ul>{diagnosis.items.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
          {tunnel ? <p className="tunnel-message">対象: <code>127.0.0.1:{tunnel.localPort}/UDP</code> · {tunnel.message}</p> : null}
          <div className="official-links"><a href="https://geysermc.org/wiki/geyser/setup/" target="_blank" rel="noreferrer">Geyser公式手順</a><a href="https://playit.gg/docs/" target="_blank" rel="noreferrer">playit.gg公式ヘルプ</a></div>
        </section>}
        {error ? <div className="error-banner" role="alert"><Icon name="info"/><span>{error}</span></div> : null}
      </div>
      <footer className="wizard-footer"><button className="secondary-button" type="button" onClick={onClose}>閉じる</button><small>Java版と統合版では参加アドレスと通信方式が別です。</small></footer>
    </section>
    {busy === "crossplay" ? <OperationOverlay title="クロスプレイ機能を導入しています" detail="停止、変更前バックアップ、公式配布物の検証、導入を順番に行っています。" stages={["安全停止", "バックアップ", "導入"]}/> : null}
    {busy === "tunnel" || busy === "agent-install" ? <OperationOverlay title="統合版の招待を準備しています" detail="Geyser設定の生成・バックアップ・反映、Paper起動、UDP公開先の確認を順番に行っています。" stages={["Geyser設定", "Paper起動", "UDP公開"]}/> : null}
  </div>;
}
