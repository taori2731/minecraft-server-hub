import { memo, useEffect, useState } from "react";
import { backend, confirmDanger, selectProfileExport, selectProfileImport } from "../lib/backend";
import type { JavaRuntime, ModpackProfile, ProfileDiff, RuntimeStatus, ServerProfile, ServerType, UpdateApplyResult, UpdateSafetyReport } from "../types";
import { Icon } from "./Icon";
import { JavaSetupButton } from "./JavaSetupButton";
import { OperationOverlay } from "./OperationOverlay";

export const SafetyToolsTab = memo(function SafetyToolsTab({ server, status, onUpdated, notify, fail }: { server: ServerProfile; status: RuntimeStatus; onUpdated: (server: ServerProfile) => void; notify: (message: string) => void; fail: (message: string) => void }) {
  const [profiles, setProfiles] = useState<ModpackProfile[]>([]);
  const [name, setName] = useState(`${server.name} 構成`);
  const [busy, setBusy] = useState("");
  const [diff, setDiff] = useState<{ id: string; value: ProfileDiff }>();
  const [targetVersion, setTargetVersion] = useState(server.minecraftVersion);
  const [targetType, setTargetType] = useState<ServerType>(server.serverType);
  const [updateReport, setUpdateReport] = useState<UpdateSafetyReport>();
  const [updateResult, setUpdateResult] = useState<UpdateApplyResult>();
  const [updateConfirmation, setUpdateConfirmation] = useState("");
  const [acceptUpdateWarnings, setAcceptUpdateWarnings] = useState(false);
  const [javaRuntimes, setJavaRuntimes] = useState<JavaRuntime[]>([]);
  const [javaChecked, setJavaChecked] = useState(false);
  const [selectedJava, setSelectedJava] = useState(server.javaPath);
  const refresh = () => backend.listModpackProfiles().then(setProfiles).catch((reason) => fail(String(reason)));
  useEffect(() => { setName(`${server.name} 構成`); setDiff(undefined); setTargetVersion(server.minecraftVersion); setTargetType(server.serverType); setUpdateReport(undefined); setUpdateResult(undefined); setUpdateConfirmation(""); setAcceptUpdateWarnings(false); setSelectedJava(server.javaPath); setJavaRuntimes([]); setJavaChecked(false); refresh(); }, [server.id]);
  const run = async (key: string, action: () => Promise<void>) => { setBusy(key); try { await action(); } catch (reason) { fail(String(reason)); } finally { setBusy(""); } };
  const detectJava = () => run("java-detect", async () => { const items = await backend.detectJava(server.serverType, server.minecraftVersion); setJavaRuntimes(items); setJavaChecked(true); const current = items.find((item) => item.executablePath === server.javaPath); setSelectedJava((current?.compatible ? current : items.find((item) => item.compatible) ?? items[0])?.executablePath ?? server.javaPath); });
  const save = () => run("save", async () => { await backend.saveModpackProfile(server.id, name); await refresh(); notify("現在のModパック構成を保存しました"); });
  const importProfile = () => run("import", async () => { const source = await selectProfileImport(); if (!source) return; await backend.importModpackProfile(source); await refresh(); notify("秘密項目を持たないプロファイルをインポートしました"); });
  const exportProfile = (item: ModpackProfile) => run(item.id, async () => { const destination = await selectProfileExport(`${item.name.replace(/[\\/:*?\"<>|]/g, "-")}.json`); if (!destination) return; await backend.exportModpackProfile(item.id, destination); notify("プロファイルをエクスポートしました"); });
  const remove = async (item: ModpackProfile) => { if (!await confirmDanger(`「${item.name}」を削除しますか？`)) return; await run(item.id, async () => { await backend.deleteModpackProfile(item.id); await refresh(); notify("プロファイルを削除しました"); }); };
  const applyUpdate = async () => {
    if (!updateReport || !await confirmDanger(`「${server.name}」を Minecraft ${targetVersion} へ更新しますか？\n停止中にバックアップを作成してから、検証済み配布ファイルを適用します。`)) return;
    await run("update-apply", async () => {
      const result = await backend.applyServerUpdate({ serverId: server.id, targetMinecraftVersion: targetVersion, targetServerType: targetType, confirmationName: updateConfirmation, acceptWarnings: acceptUpdateWarnings });
      setUpdateResult(result);
      setUpdateReport(undefined);
      setUpdateConfirmation("");
      setAcceptUpdateWarnings(false);
      onUpdated(result.server);
      notify("安全バックアップ後にサーバー更新を適用しました");
    });
  };
  return <div className="tab-content safety-tools">
    <section className="feature-panel profile-panel">
      <header><div><span className="section-kicker">SHAREABLE JSON</span><h2>{server.serverType === "bedrock" ? "アドオン構成プロファイル" : "Modパックプロファイル"}</h2></div><button className="small-button" type="button" onClick={importProfile} disabled={Boolean(busy)}><Icon name="download" size={17}/>インポート</button></header>
      <div className="profile-create"><label><span>プロファイル名</span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label><button className="primary-button" type="button" onClick={save} disabled={!name.trim() || Boolean(busy)}><Icon name="add" size={17}/>現在の構成を保存</button></div>
      <p className="privacy-note">ファイル名・Minecraft版・ローダー・設定値だけを保存します。個人情報、認証情報、トークン、実ファイル本体は含めません。</p>
      <div className="profile-list">{profiles.map((item) => <article key={item.id}><div><strong>{item.name}</strong><small>{item.minecraftVersion} · {item.loader} · Mod {item.mods.length} / Plugin {item.plugins.length} / Datapack {item.datapacks.length}</small><small>推奨 {(item.recommendedMemoryMib / 1024).toFixed(1)} GiB · 予定 {item.plannedPlayers}人 · 設定ファイル {item.configurationFiles.length}件</small></div><div className="profile-actions"><button className="small-button" onClick={() => run(item.id, async () => { await backend.duplicateModpackProfile(item.id); await refresh(); notify("プロファイルを複製しました"); })}>複製</button><button className="small-button" onClick={() => exportProfile(item)}>共有用JSON</button><button className="small-button" onClick={() => run(item.id, async () => setDiff({ id: item.id, value: await backend.compareModpackProfile(server.id, item.id) }))}>差分</button><button className="danger-icon" aria-label="プロファイルを削除" onClick={() => remove(item)}><Icon name="trash" size={17}/></button></div>{item.mods.length ? <details className="client-mod-list"><summary>クライアント側に必要なModを確認</summary><ul>{item.mods.map((mod) => <li key={mod.fileName}><b>{mod.fileName}</b><span>{mod.clientRequirement}</span></li>)}</ul></details> : null}{diff?.id === item.id ? <div className="profile-diff"><b>このサーバーとの差分</b>{diff.value.missingFromServer.length ? <p>不足: {diff.value.missingFromServer.join(", ")}</p> : <p>不足ファイルなし</p>}{diff.value.extraOnServer.length ? <p>追加: {diff.value.extraOnServer.join(", ")}</p> : null}{diff.value.configurationNotes.map((note) => <p key={note}>{note}</p>)}</div> : null}</article>)}{profiles.length === 0 ? <div className="panel-empty compact"><p>まだ保存されたプロファイルはありません。</p></div> : null}</div>
    </section>

    {server.serverType !== "bedrock" ? <section className="feature-panel java-guide-panel">
      <header><div><span className="section-kicker">PER SERVER</span><h2>Java環境</h2></div><button className="small-button" type="button" onClick={detectJava} disabled={Boolean(busy)}><Icon name="search" size={17}/>{busy === "java-detect" ? "検出中…" : javaChecked ? "再検出" : "Javaを検出"}</button></header>
      <div className="java-current"><div><span>現在のJava</span><strong>Java {server.javaMajor}</strong><small>{server.javaPath}</small></div><div><span>検出結果</span><strong>{javaChecked ? `${javaRuntimes.filter((item) => item.compatible).length}件が互換` : "まだ検出していません"}</strong><small>{javaChecked ? "起動前診断でも再確認します" : "この画面を軽くするため必要なときだけ検出します"}</small></div></div>
      {javaChecked ? <div className="java-selector"><label><span>このサーバーで使うJava</span><select value={selectedJava} onChange={(event) => setSelectedJava(event.target.value)}>{javaRuntimes.map((runtime) => <option value={runtime.executablePath} key={runtime.executablePath} disabled={!runtime.compatible}>Java {runtime.version} · {runtime.vendor} · {runtime.compatible ? "互換" : "非互換"}</option>)}{javaRuntimes.length === 0 ? <option value="">Javaが見つかりません</option> : null}</select></label><button className="small-button" type="button" disabled={!javaRuntimes.some((item) => item.executablePath === selectedJava && item.compatible) || selectedJava === server.javaPath || Boolean(busy)} onClick={() => run("java", async () => { const runtime = javaRuntimes.find((item) => item.executablePath === selectedJava); if (!runtime) return; const updated = await backend.updateServerJava(server.id, runtime.executablePath, runtime.majorVersion); onUpdated(updated); notify("このサーバーのJava設定を更新しました"); })}>選択を保存</button></div> : <p className="privacy-note">Java環境を変更するときだけ「Javaを検出」を押してください。安全ツールを開くだけでは重いPC走査を開始しません。</p>}
      <div className="managed-java-offer"><div><strong>Javaがなくてもアプリ内で準備できます</strong><small>Windows全体の設定を変えず、公式Eclipse Temurinを検証して保存します。サーバー停止中は設定まで自動で完了します。</small></div><JavaSetupButton serverType={server.serverType} minecraftVersion={server.minecraftVersion} disabled={Boolean(busy)} onInstalled={async (runtime) => { setJavaRuntimes((current) => [runtime, ...current.filter((item) => item.executablePath !== runtime.executablePath)]); setSelectedJava(runtime.executablePath); setJavaChecked(true); if (["stopped", "crashed"].includes(status.state)) { const updated = await backend.updateServerJava(server.id, runtime.executablePath, runtime.majorVersion); onUpdated(updated); notify("Javaを安全に準備し、このサーバーへの設定まで完了しました"); } else { notify("Javaを安全に準備しました。次回停止後に「選択を保存」で切り替えられます"); } }} /></div>
      <div className="official-links"><a href="https://adoptium.net/temurin/releases/" target="_blank" rel="noreferrer">Eclipse Temurin 公式</a><a href="https://learn.microsoft.com/java/openjdk/download" target="_blank" rel="noreferrer">Microsoft OpenJDK 公式</a></div>
    </section> : <section className="feature-panel java-guide-panel bedrock-runtime-guide">
      <header><div><span className="section-kicker">NATIVE WINDOWS RUNTIME</span><h2>統合版の実行環境</h2></div><span className="status-pill on">Java不要</span></header>
      <div className="java-current"><div><span>実行ファイル</span><strong>bedrock_server.exe</strong><small>{server.launchTarget}</small></div><div><span>通信</span><strong>UDP {server.port}</strong><small>Bedrock RakNetステータスで監視</small></div></div>
      <p className="privacy-note">統合版専用サーバーはWindowsネイティブで動作します。Javaの検出・ダウンロード・JVMメモリ設定は実行しません。CPUと使用メモリは概要画面で監視できます。</p>
      <div className="official-links"><a href="https://www.minecraft.net/en-us/download/server/bedrock" target="_blank" rel="noreferrer">Minecraft公式BDS</a><a href="https://learn.microsoft.com/minecraft/creator/documents/bedrockserver/getting-started" target="_blank" rel="noreferrer">Microsoft公式セットアップ</a></div>
    </section>}

    <section className="feature-panel template-info-panel">
      <header><div><span className="section-kicker">NEW SERVERS ONLY</span><h2>サーバーテンプレート</h2></div></header>
      <div className="template-grid">{(server.serverType === "bedrock" ? ["統合版で友達と遊ぶ", "統合版クリエイティブ", "統合版テスト用"] : ["友達と遊ぶ", "軽量Mod", "クリエイティブ", "Paperプラグイン", "Vanillaサバイバル", "テスト用"]).map((label) => <div key={label}><Icon name="server" size={18}/><strong>{label}</strong><small>新規作成画面で内容を確認してから適用</small></div>)}</div>
      <p className="privacy-note">テンプレートは新規サーバーの初期値だけを提案します。既存サーバーには適用せず、ファイルを上書きしません。</p>
    </section>

    {server.serverType === "bedrock" ? <section className="feature-panel update-check-panel bedrock-update-guide">
      <header><div><span className="section-kicker">MANUAL BDS UPDATE</span><h2>統合版サーバーの更新</h2></div><span className="status-pill">自動適用しません</span></header>
      <div className="inline-warning"><Icon name="info" size={17}/><div><strong>現在の安全更新機能はJava版サーバーJAR専用です</strong><p>Bedrock Dedicated Serverは配布ZIP全体の差し替えが必要なため、この画面から自動更新しません。</p></div></div>
      <ol className="safe-step-list"><li>サーバーを停止する</li><li>ワールド・設定・アドオンをバックアップする</li><li>Minecraft公式から新しいWindows BDSを取得する</li><li>変更内容と互換性を確認してから別フォルダーで検証する</li></ol>
      <p className="privacy-note">既存ワールドを上書きせずに移行できる専用フローを今後追加します。それまでは公式手順を確認し、手動での差し替えを行ってください。</p>
      <div className="official-links"><a href="https://www.minecraft.net/en-us/download/server/bedrock" target="_blank" rel="noreferrer">Minecraft公式BDS</a><a href="https://learn.microsoft.com/minecraft/creator/documents/bedrockserver/getting-started" target="_blank" rel="noreferrer">Microsoft公式ガイド</a></div>
    </section> : <section className="feature-panel update-check-panel">
      <header><div><span className="section-kicker">CHECK · BACKUP · APPLY</span><h2>確認付きサーバー更新</h2></div><button className="small-button" type="button" disabled={Boolean(busy) || !targetVersion.trim()} onClick={() => run("update-check", async () => { setUpdateResult(undefined); setUpdateConfirmation(""); setAcceptUpdateWarnings(false); setUpdateReport(await backend.checkUpdateSafety(server.id, targetVersion, targetType)); notify("更新前の安全確認が完了しました"); })}><Icon name="search" size={17}/>{busy === "update-check" ? "確認中…" : "安全確認"}</button></header>
      <div className="update-target"><label><span>更新先Minecraft版</span><input value={targetVersion} onChange={(event) => { setTargetVersion(event.target.value); setUpdateReport(undefined); setUpdateResult(undefined); }} /></label><label><span>サーバー種類／ローダー</span><select value={targetType} onChange={(event) => { setTargetType(event.target.value as ServerType); setUpdateReport(undefined); setUpdateResult(undefined); }}><option value="vanilla">Vanilla</option><option value="paper">Paper</option><option value="fabric">Fabric</option><option value="forge">Forge</option><option value="neoforge">NeoForge</option></select></label></div>
      {targetType !== server.serverType ? <p className="inline-warning"><Icon name="info" size={16}/>サーバー種類やModローダーの変更は自動適用しません。同じ種類を選択してください。</p> : null}
      {updateReport ? <div className="update-report"><p className={updateReport.safeToProceed ? "diagnosis-ok" : "inline-warning"}><Icon name={updateReport.safeToProceed ? "check" : "info"} size={17}/>{updateReport.safeToProceed ? "事前条件を満たしています。適用前に最終確認してください。" : "警告があります。内容を確認するまで更新しません。"}</p><div className="update-columns"><div><b>確認結果</b><ul>{updateReport.compatibilityChecks.map((value) => <li key={value}>{value}</li>)}</ul></div><div><b>変更予定ファイル</b><ul>{updateReport.affectedFiles.map((value) => <li key={value}>{value}</li>)}</ul></div></div>{updateReport.dependencyWarnings.map((value) => <p className="inline-warning" key={value}><Icon name="info" size={16}/>{value}</p>)}<p className="rollback-state"><b>適用時の保護:</b> 更新直前に新しい検証済みバックアップを必ず作成</p><p className="privacy-note">{updateReport.disclaimer}</p><div className="update-apply-confirm"><label><span>確認のためサーバー名「{server.name}」を入力</span><input aria-label="更新確認用サーバー名" value={updateConfirmation} onChange={(event) => setUpdateConfirmation(event.target.value)} /></label>{updateReport.dependencyWarnings.length ? <label className="confirm-check"><input type="checkbox" checked={acceptUpdateWarnings} onChange={(event) => setAcceptUpdateWarnings(event.target.checked)} />警告を読み、バックアップ後に更新を続ける</label> : null}<button className="primary-button" type="button" disabled={Boolean(busy) || status.state !== "stopped" || targetType !== server.serverType || updateConfirmation !== server.name || (updateReport.dependencyWarnings.length > 0 && !acceptUpdateWarnings)} onClick={applyUpdate}><Icon name="download" size={17}/>{busy === "update-apply" ? "バックアップ・更新中…" : "バックアップして更新を適用"}</button>{status.state !== "stopped" ? <small>更新を適用するにはサーバーを完全に停止してください。</small> : null}</div></div> : <div className="panel-empty compact"><p>対象版を入力して、互換性・依存関係・変更ファイルを確認します。適用時は必ず新しいバックアップを作成します。</p></div>}
      {updateResult ? <div className="update-applied"><Icon name="check" size={20}/><div><strong>更新を適用しました</strong><p>{updateResult.message}</p><small>バックアップ: {updateResult.backup.id}</small></div></div> : null}
    </section>}
    {busy === "update-apply" ? <OperationOverlay title="サーバー更新を安全に適用しています" detail="更新直前バックアップを作成し、配布ファイルを検証してから差し替えています。" stages={["バックアップ", "配布元検証", "更新反映"]} /> : null}
  </div>;
});
