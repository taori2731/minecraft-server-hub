import { useEffect, useState } from "react";
import { backend, confirmDanger, selectTunnelAgent } from "../lib/backend";
import { getServerNetworkProtocol } from "../lib/serverEdition";
import type { RuntimeStatus, ServerProfile, TunnelAgentInstallPlan, TunnelAgentValidation, TunnelDiagnosis, TunnelExternalProbe, TunnelState, TunnelStatus } from "../types";
import { Icon } from "./Icon";
import { OperationOverlay } from "./OperationOverlay";

interface Props {
  server: ServerProfile;
  runtime: RuntimeStatus;
  notify: (message: string) => void;
  reportError: (message: string) => void;
}

const stateLabels: Record<TunnelState, string> = {
  unconfigured: "未設定", preparing: "準備中", starting: "起動中", running: "エージェント稼働中",
  connected: "接続済み", disconnected: "停止中", error: "エラー", stopping: "停止中",
  awaiting_terms: "利用規約確認待ち", awaiting_login: "ログイン確認待ち",
};

export function TunnelLocalPanel({ server, runtime, notify, reportError }: Props) {
  const isBedrock = server.serverType === "bedrock";
  const editionName = isBedrock ? "Minecraft 統合版" : "Minecraft Java版";
  const [status, setStatus] = useState<TunnelStatus>();
  const [agentPath, setAgentPath] = useState("");
  const [validation, setValidation] = useState<TunnelAgentValidation>();
  const [diagnosis, setDiagnosis] = useState<TunnelDiagnosis>();
  const [probe, setProbe] = useState<TunnelExternalProbe>();
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [quickStep, setQuickStep] = useState("サーバー起動から接続先表示まで自動で進めます");
  const [installPlan, setInstallPlan] = useState<TunnelAgentInstallPlan>();
  const [installAccepted, setInstallAccepted] = useState(false);
  const transport = (status?.transport ?? getServerNetworkProtocol(server.serverType)).toUpperCase();
  const probeTransport = (probe?.transport ?? getServerNetworkProtocol(server.serverType)).toUpperCase();

  const shouldPoll = status?.state === "starting" || status?.state === "running" || status?.state === "connected" || status?.state === "stopping" || status?.state === "awaiting_login";
  const pollInterval = status?.state === "connected" ? 30_000 : 5_000;

  useEffect(() => {
    let active = true;
    backend.tunnelStatus(server.id).then((next) => {
      if (!active) return;
      setStatus(next);
      setAgentPath(next.agentPath ?? "");
      setTermsAccepted(next.termsAcknowledged);
    }).catch((reason) => active && reportError(String(reason)));
    return () => { active = false; };
  }, [server.id, reportError]);

  useEffect(() => {
    if (!shouldPoll) return;
    let active = true;
    let requestActive = false;
    const timer = window.setInterval(() => {
      if (requestActive) return;
      requestActive = true;
      backend.tunnelStatus(server.id)
        .then((next) => active && setStatus(next))
        .catch(() => undefined)
        .finally(() => { requestActive = false; });
    }, pollInterval);
    return () => { active = false; window.clearInterval(timer); };
  }, [server.id, shouldPoll, pollInterval]);

  useEffect(() => {
    if (status?.state === "connected" && status.publicEndpoint) {
      setQuickStep("準備完了。接続先を友達へ送れます");
    }
  }, [status?.state, status?.publicEndpoint]);

  const chooseAgent = async () => {
    const path = await selectTunnelAgent();
    if (!path) return;
    setAgentPath(path);
    setValidation(undefined);
    setDiagnosis(undefined);
  };

  const validate = async () => {
    setBusy(true); reportError("");
    try {
      const result = await backend.validateTunnelAgent({ serverId: server.id, providerId: "playit", agentPath });
      setValidation(result);
      setStatus(await backend.tunnelStatus(server.id));
      notify("playit.gg公式エージェントを検証しました");
    } catch (reason) { reportError(String(reason)); }
    finally { setBusy(false); }
  };

  const start = async () => {
    const accepted = await confirmDanger(`playit.ggエージェントを開始しますか？\n\n${editionName}の127.0.0.1:${server.port}/${transport}だけを対象にします。管理画面、SQLite、設定、バックアップは公開しません。外部サービスへ接続情報が送信されます。`);
    if (!accepted) return;
    setBusy(true); reportError("");
    try {
      const next = await backend.startTunnel({ serverId: server.id, providerId: "playit", agentPath, termsAccepted });
      setStatus(next);
      notify("ローカルトンネルエージェントを開始しました");
    } catch (reason) { reportError(String(reason)); }
    finally { setBusy(false); }
  };

  const runQuickPublish = async (confirmedByInstall = false) => {
    const termsReady = Boolean(status?.termsAcknowledged || termsAccepted);
    if (!termsReady) {
      reportError("初回だけ、playit.ggの利用規約とプライバシーポリシーを確認してください");
      return;
    }
    if (!confirmedByInstall) {
      const accepted = await confirmDanger(`友達が参加できる状態まで自動で準備しますか？\n\n停止中ならMinecraftサーバーを起動し、公式playitエージェントを検証して、127.0.0.1:${server.port}/${transport}だけを公開します。管理画面、SQLite、設定、バックアップは公開しません。`);
      if (!accepted) return;
    }
    setBusy(true); reportError(""); setProbe(undefined); setDiagnosis(undefined);
    try {
      if (!["running", "starting"].includes(runtime.state)) {
        setQuickStep("Minecraftサーバーを起動しています…");
        await backend.start(server.id);
      }
      setQuickStep("公式エージェントを確認して公開準備中…");
      const next = await backend.quickStartTunnel({ serverId: server.id, termsAccepted: termsReady });
      setStatus(next);
      setAgentPath(next.agentPath ?? "");
      setTermsAccepted(next.termsAcknowledged);
      if (next.state === "connected" && next.publicEndpoint) {
        setQuickStep("準備完了。接続先を友達へ送れます");
        notify("友達が参加できる状態になりました");
      } else if (["not_configured", "invalid"].includes(next.accountState)) {
        setQuickStep("初回だけ、公式画面でアカウントを確認してください");
        await backend.openTunnelAccountLogin(server.id);
      } else if (!next.matchingTunnel) {
        setQuickStep("初回だけ、公式画面でMinecraftトンネルを作成してください");
        await backend.openTunnelDashboard(server.id);
      } else {
        setQuickStep("公開接続先を取得中です。少し待ってください…");
      }
    } catch (reason) {
      setQuickStep("自動準備を完了できませんでした。下の案内を確認してください");
      reportError(String(reason));
    } finally { setBusy(false); }
  };

  const quickPublish = async () => {
    const termsReady = Boolean(status?.termsAcknowledged || termsAccepted);
    if (!termsReady) {
      reportError("初回だけ、playit.ggの利用規約とプライバシーポリシーを確認してください");
      return;
    }
    setBusy(true); reportError("");
    try {
      const plan = await backend.tunnelAgentInstallPlan(server.id);
      if (plan.alreadyInstalled && plan.installedValidation) {
        setValidation(plan.installedValidation);
        setAgentPath(plan.installedValidation.agentPath);
        setStatus(await backend.tunnelStatus(server.id));
        await runQuickPublish();
      } else {
        setInstallPlan(plan);
        setInstallAccepted(false);
        setQuickStep("公式playitエージェントを安全に準備します");
      }
    } catch (reason) {
      reportError(String(reason));
    } finally { setBusy(false); }
  };

  const installAndContinue = async () => {
    if (!installPlan || !installAccepted) return;
    setBusy(true); reportError("");
    try {
      setQuickStep("公式MSIをダウンロード・検証・インストール中…");
      const result = await backend.installTunnelAgent({ serverId: server.id, version: installPlan.version, sourceUrl: installPlan.sourceUrl, sizeBytes: installPlan.sizeBytes, checksumSha256: installPlan.checksumSha256 });
      setValidation(result);
      setAgentPath(result.agentPath);
      setStatus(await backend.tunnelStatus(server.id));
      setInstallPlan(undefined);
      setInstallAccepted(false);
      notify("playit.gg公式エージェントを準備しました");
      await runQuickPublish(true);
    } catch (reason) {
      setQuickStep("playit.gg公式エージェントの準備を完了できませんでした");
      reportError(String(reason));
    } finally { setBusy(false); }
  };

  const stop = async () => {
    setBusy(true); reportError("");
    try {
      const next = await backend.stopTunnel(server.id);
      setStatus(next);
      if (next.state === "disconnected") notify(next.message);
      else reportError(next.message);
    }
    catch (reason) { reportError(String(reason)); }
    finally { setBusy(false); }
  };

  const diagnose = async () => {
    setBusy(true); reportError("");
    try { setDiagnosis(await backend.diagnoseTunnel(server.id)); }
    catch (reason) { reportError(String(reason)); }
    finally { setBusy(false); }
  };

  const refresh = async () => {
    setBusy(true); reportError("");
    try { setStatus(await backend.tunnelStatus(server.id)); }
    catch (reason) { reportError(String(reason)); }
    finally { setBusy(false); }
  };

  const openLogin = async () => {
    setBusy(true); reportError("");
    try { await backend.openTunnelAccountLogin(server.id); notify("playit.gg公式ログイン画面を開きました"); }
    catch (reason) { reportError(String(reason)); }
    finally { setBusy(false); }
  };

  const openDashboard = async () => {
    setBusy(true); reportError("");
    try { await backend.openTunnelDashboard(server.id); notify("playit.gg公式トンネル設定画面を開きました"); }
    catch (reason) { reportError(String(reason)); }
    finally { setBusy(false); }
  };

  const probeEndpoint = async () => {
    setBusy(true); reportError("");
    try { setProbe(await backend.probeTunnelEndpoint(server.id)); }
    catch (reason) { reportError(String(reason)); }
    finally { setBusy(false); }
  };

  const copyEndpoint = async () => {
    if (!status?.publicEndpoint) return;
    await navigator.clipboard.writeText(status.publicEndpoint);
    notify("友達用の接続先をコピーしました");
  };

  const active = Boolean(status && !["unconfigured", "disconnected", "error"].includes(status.state));
  const verified = Boolean(validation?.valid || status?.agentVerified);
  return <><section className="tunnel-local-panel" aria-labelledby="tunnel-local-title">
    <header>
      <div><span className="section-kicker">PHASE T2 · RELAY INVITE</span><h3 id="tunnel-local-title">ポート開放なしで友達を招待</h3></div>
      <span className={`status-pill ${status?.state === "connected" ? "on" : ""}`}>{stateLabels[status?.state ?? "unconfigured"]}</span>
    </header>
    <p>playit.gg公式Windowsエージェントを検証し、{editionName}の <code>127.0.0.1:{server.port}/{transport}</code> だけを中継します。管理画面・SQLite・バックアップは公開しません。</p>
    <div className={`quick-publish-card ${status?.state === "connected" ? "ready" : ""}`}>
      <div><span className="section-kicker">PHASE T4 · BEGINNER MODE</span><strong>かんたん公開（おすすめ）</strong><p>{quickStep}</p></div>
      {!status?.termsAcknowledged ? <label className="tunnel-terms"><input type="checkbox" checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} /><span><a href="https://playit.gg/terms/" target="_blank" rel="noreferrer">利用規約</a>と<a href="https://playit.gg/privacy-policy/" target="_blank" rel="noreferrer">プライバシーポリシー</a>、無料枠や通信品質が外部サービスに依存することを確認しました。</span></label> : <p className="terms-saved"><Icon name="check" size={16} />利用条件は確認済みです</p>}
      {installPlan ? <div className="tunnel-install-plan" role="region" aria-label="playit.gg公式エージェントの準備内容">
        <strong>playit.gg公式エージェントを準備</strong>
        <p>この内容を確認した場合だけ、公式MSIを取得してWindowsへインストールします。</p>
        <dl><div><dt>配布元</dt><dd>{installPlan.publisher} / GitHub Releases</dd></div><div><dt>バージョン</dt><dd>{installPlan.version}</dd></div><div><dt>容量</dt><dd>{(installPlan.sizeBytes / 1024 / 1024).toFixed(1)} MiB</dd></div><div><dt>ライセンス</dt><dd>{installPlan.licenseName}</dd></div><div><dt>インストール</dt><dd>{installPlan.installScope}</dd></div><div><dt>保存先</dt><dd><code>{installPlan.installPath}</code></dd></div></dl>
        <p className="privacy-note">SHA-256とWindows署名を検証します。一時MSIは<code>{installPlan.temporaryPath}</code>へ保存し、インストール後に削除します。UAC確認はWindowsが表示します。</p>
        <div className="official-links"><a href={installPlan.sourceUrl} target="_blank" rel="noreferrer">公式MSI</a><a href={installPlan.licenseUrl} target="_blank" rel="noreferrer">ライセンス</a></div>
        <label className="tunnel-install-consent"><input type="checkbox" checked={installAccepted} disabled={busy} onChange={(event) => setInstallAccepted(event.target.checked)} /><span>配布元、版、容量、ライセンス、管理者権限、Windowsサービス、保存先を確認しました。インストール後にMinecraft公開の準備を続けます。</span></label>
        <div><button className="secondary-button" type="button" disabled={busy} onClick={() => { setInstallPlan(undefined); setInstallAccepted(false); setQuickStep("サーバー起動から接続先表示まで自動で進めます"); }}>キャンセル</button><button className="primary-button" type="button" disabled={busy || !installAccepted} onClick={installAndContinue}><Icon name="download" size={17} />{busy ? "ダウンロード・検証・インストール中…" : "公式エージェントを入れて公開を続ける"}</button></div>
      </div> : <div className="quick-publish-actions">
        <button className="primary-button" type="button" disabled={busy || !(status?.termsAcknowledged || termsAccepted)} onClick={quickPublish}><Icon name="invite" size={18} />{busy ? "公式エージェントを確認中…" : status?.state === "connected" ? "公開状態を確認" : "友達と遊べるようにする"}</button>
        <button className="secondary-button" type="button" disabled={busy || !active} onClick={stop}><Icon name="close" size={16} />招待を停止</button>
      </div>}
      <small>初回のアカウント確認と{isBedrock ? "Minecraft Bedrock / UDP" : "Minecraft Java / TCP"}トンネル作成だけは、playit.gg公式画面が開きます。2回目からはこのボタンだけで接続します。</small>
    </div>
    {status?.state === "connected" && status.publicEndpoint ? <div className="tunnel-endpoint-card" role="status">
      <span>友達用の接続先</span><strong>{status.publicEndpoint}</strong>
      <p>友達の{editionName}で「{isBedrock ? "プレイ → サーバー → サーバーを追加" : "マルチプレイ → サーバーを追加"}」に入力してください。</p>
      <div><button className="primary-button" type="button" onClick={copyEndpoint}><Icon name="clipboard" size={17} />接続先をコピー</button><button className="secondary-button" type="button" disabled={busy} onClick={probeEndpoint}><Icon name="refresh" size={16} />外部経路をテスト</button></div>
    </div> : null}
    <details className="tunnel-advanced">
      <summary>詳しい設定と診断</summary>
      <div className="tunnel-agent-row">
        <div><span>公式エージェント</span>{agentPath ? <code data-no-translate>{agentPath}</code> : <span className="tunnel-agent-placeholder">自動検出します</span>}</div>
        <button className="secondary-button" type="button" disabled={busy || active} onClick={chooseAgent}><Icon name="folder" size={16} />選択</button>
        <button className="secondary-button" type="button" disabled={busy || active || !agentPath} onClick={validate}><Icon name="check" size={16} />署名を検証</button>
      </div>
      {validation ? <div className="tunnel-verification"><Icon name="check" size={17} /><div><strong>{validation.message}</strong><small>バージョン {validation.version} · SHA-256 {validation.sha256.slice(0, 16)}… · {validation.verificationMethod}</small></div></div> : null}
      <div className="tunnel-actions">
        <button className="primary-button" type="button" disabled={busy || active || runtime.state !== "running" || !verified || !(status?.termsAcknowledged || termsAccepted)} onClick={start}><Icon name="invite" size={17} />トンネルを開始</button>
        <button className="secondary-button" type="button" disabled={busy || !active} onClick={refresh}><Icon name="refresh" size={16} />接続先を再確認</button>
        <button className="secondary-button" type="button" disabled={busy} onClick={diagnose}><Icon name="refresh" size={16} />接続診断</button>
      </div>
    </details>
    {status ? <p className="tunnel-message">対象: <code>{status.localHost}:{status.localPort}</code> · {status.message}</p> : null}
    {active && status?.state !== "connected" ? <div className="tunnel-setup-guide">
      <strong>公開接続先を作る手順</strong><ol><li>公式ログイン画面でアカウントを確認</li><li>公式トンネル設定で{isBedrock ? "Minecraft Bedrock / UDP" : "Minecraft Java / TCP"}、転送先 <code>127.0.0.1:{server.port}</code> を追加</li><li>この画面へ戻り「接続先を再確認」</li></ol>
      <div><button className="secondary-button" type="button" disabled={busy} onClick={openLogin}>公式画面でログイン</button><button className="secondary-button" type="button" disabled={busy} onClick={openDashboard}>公式画面でトンネルを追加</button></div>
    </div> : null}
    {status?.providerNotices.map((notice) => <p className="inline-warning" key={notice}><Icon name="info" size={17} />{notice}</p>)}
    {probe ? <div className={`tunnel-probe ${probe.reachable ? "ok" : ""}`} role="status"><strong>{probe.reachable ? `このPCからの外部経路: ${probeTransport === "UDP" ? "RakNet応答あり" : "到達"}` : "外部経路: 未確認"}</strong><p>{probe.message}</p><small>{probeTransport === "UDP" ? "統合版はUDP/RakNet応答を確認します。" : "TCP接続を確認します。"}</small><small>この結果だけでは別の家からのMinecraft参加を保証しません。</small></div> : null}
    {diagnosis ? <div className="tunnel-diagnosis"><strong>ローカル診断結果（{(diagnosis.transport ?? getServerNetworkProtocol(server.serverType)).toUpperCase()}）</strong><ul>{diagnosis.items.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
    {status?.recentLogs.length ? <details className="tunnel-logs"><summary>伏せ字済みエージェントログ</summary><pre>{status.recentLogs.join("\n")}</pre></details> : null}
    <div className="official-links"><a href="https://playit.gg/download" target="_blank" rel="noreferrer">公式セットアップ</a><a href="https://playit.gg/support/" target="_blank" rel="noreferrer">公式ヘルプ</a><a href="https://github.com/playit-cloud/playit-agent" target="_blank" rel="noreferrer">公開ソース・ライセンス</a></div>
  </section>{busy ? <OperationOverlay title="友達向け公開を準備しています" detail={quickStep} stages={["公式エージェント", "接続確認", "公開先取得"]} /> : null}</>;
}
