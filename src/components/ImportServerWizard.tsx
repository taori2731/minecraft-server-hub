import { useState } from "react";
import { backend, selectFolder, selectMigrationImport } from "../lib/backend";
import type { ImportPreview, JavaRuntime, MigrationManifest, ServerProfile } from "../types";
import { Icon } from "./Icon";
import { JavaSetupButton } from "./JavaSetupButton";
import { OperationOverlay } from "./OperationOverlay";

const typeLabel = { vanilla: "Vanilla", paper: "Paper", fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", bedrock: "Bedrock Dedicated Server", palworld: "Palworld Dedicated Server" } as const;

export function ImportServerWizard({ onClose, onImported }: { onClose: () => void; onImported: (server: ServerProfile) => void }) {
  const [folder, setFolder] = useState("");
  const [preview, setPreview] = useState<ImportPreview>();
  const [name, setName] = useState("");
  const [javaPath, setJavaPath] = useState("");
  const [backup, setBackup] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [migration, setMigration] = useState<{ archivePath: string; manifest: MigrationManifest; runtimes: JavaRuntime[] }>();
  const [migrationParent, setMigrationParent] = useState("");

  const choose = async () => {
    const selected = await selectFolder();
    if (!selected) return;
    setFolder(selected); setPreview(undefined); setError("");
  };
  const scan = async () => {
    if (!folder) return;
    setBusy(true); setError("");
    try {
      const result = await backend.inspectExistingServer(folder);
      setPreview(result); setName(result.suggestedName);
      setJavaPath((result.javaRuntimes.find((runtime) => runtime.compatible) ?? result.javaRuntimes[0])?.executablePath ?? "");
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const finish = async () => {
    if (!preview) return;
    const runtime = preview.javaRuntimes.find((item) => item.executablePath === javaPath);
    if (preview.serverType !== "bedrock" && !runtime?.compatible) { setError("互換性のあるJavaを選択してください"); return; }
    setBusy(true); setError("");
    try {
      onImported(await backend.importExistingServer({ rootPath: preview.rootPath, name, javaPath: preview.serverType === "bedrock" ? "" : javaPath, javaMajor: preview.serverType === "bedrock" ? 0 : runtime?.majorVersion ?? 0, createInitialBackup: backup, sourceFingerprint: preview.sourceFingerprint }));
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const chooseMigration = async () => {
    const archivePath = await selectMigrationImport();
    if (!archivePath) return;
    setBusy(true); setError("");
    try {
      const manifest = await backend.inspectServerMigration(archivePath);
      const runtimes = manifest.serverType === "bedrock" ? [] : await backend.detectJava(manifest.serverType, manifest.minecraftVersion);
      setMigration({ archivePath, manifest, runtimes }); setName(manifest.sourceServerName);
      setJavaPath(runtimes.find((runtime) => runtime.compatible && runtime.majorVersion >= manifest.javaMajor)?.executablePath ?? "");
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const restoreMigration = async () => {
    if (!migration || !migrationParent || !name.trim()) return;
    const runtime = migration.runtimes.find((item) => item.executablePath === javaPath);
    if (migration.manifest.serverType !== "bedrock" && (!runtime?.compatible || runtime.majorVersion < migration.manifest.javaMajor)) { setError(`Java ${migration.manifest.javaMajor}以上を準備してください`); return; }
    setBusy(true); setError("");
    try { onImported(await backend.restoreServerMigration({ archivePath: migration.archivePath, parentPath: migrationParent, serverName: name, javaPath, javaMajor: runtime?.majorVersion ?? 0 })); }
    catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };

  return <div className="modal-backdrop"><section className="wizard import-wizard" role="dialog" aria-modal="true" aria-labelledby="import-title">
    <header className="wizard-header"><div><p className="wizard-kicker">READ-ONLY FIRST</p><h2 id="import-title">既存サーバーを取り込む</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="取り込み画面を閉じる"><Icon name="close" /></button></header>
    <div className="wizard-body import-body">
      <div className="import-intro"><Icon name="folder" size={30} /><div><strong>元のサーバーフォルダーを壊さずに調べます</strong><p>まず読み取りだけでJava版／統合版、ワールド、拡張機能、実行環境を確認し、登録内容を表示します。登録前は元フォルダーへ書き込みません。</p></div></div>
      <div className="migration-import-offer"><div><strong>別のPCで作った引っ越しファイルがありますか？</strong><small>.mshmoveを検証し、新しいフォルダーへ上書きせず復元します。</small></div><button className="secondary-button" type="button" onClick={chooseMigration} disabled={busy}><Icon name="download" size={17}/>移行ファイルから復元</button></div>
      {migration ? <div className="migration-preview">
        <header><div><span className="scan-success"><Icon name="check" size={16}/>移行ファイルを検証しました</span><h3>{migration.manifest.sourceServerName}</h3><code>{migration.manifest.minecraftVersion} · {migration.manifest.serverType} · {migration.manifest.fileCount}ファイル</code></div></header>
        <div className="import-form"><label><span>復元後のサーバー名</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={64}/></label><label><span>新PCでの保存先</span><div className="path-picker"><input value={migrationParent} readOnly placeholder="復元先の親フォルダー"/><button className="secondary-button" type="button" onClick={async () => setMigrationParent(await selectFolder() ?? migrationParent)}>選択</button></div></label>{migration.manifest.serverType !== "bedrock" ? <label><span>新PCで使うJava {migration.manifest.javaMajor}以上</span><select value={javaPath} onChange={(event) => setJavaPath(event.target.value)}><option value="">Javaを選択</option>{migration.runtimes.map((runtime) => <option key={runtime.executablePath} value={runtime.executablePath} disabled={!runtime.compatible || runtime.majorVersion < migration.manifest.javaMajor}>Java {runtime.majorVersion} · {runtime.vendor}</option>)}</select></label> : null}</div>
        {migration.manifest.serverType !== "bedrock" && !migration.runtimes.some((runtime) => runtime.compatible && runtime.majorVersion >= migration.manifest.javaMajor) ? <JavaSetupButton serverType={migration.manifest.serverType} minecraftVersion={migration.manifest.minecraftVersion} label="必要なJavaを自動で準備" onInstalled={(runtime) => { setMigration((current) => current ? { ...current, runtimes: [runtime, ...current.runtimes] } : current); setJavaPath(runtime.executablePath); }}/>: null}
        <div className="inline-warning"><Icon name="info" size={16}/><span>既存フォルダーは上書きしません。Java本体とトンネル認証情報は新PCで安全に再設定します。</span></div>
      </div> : null}
      {!migration ? <>
      <label className="import-folder"><span>サーバールートフォルダー</span><div><input value={folder} readOnly placeholder="server.properties があるフォルダー" /><button className="secondary-button" type="button" onClick={choose}><Icon name="folder" size={17} />選択</button><button className="primary-button" type="button" onClick={scan} disabled={!folder || busy}>{busy && !preview ? "確認中…" : "安全にスキャン"}</button></div></label>
      {preview ? <div className="import-preview">
        <header><div><span className="scan-success"><Icon name="check" size={16} />読み取り完了</span><h3>{typeLabel[preview.serverType]} / {preview.minecraftVersion}</h3><code>{preview.rootPath}</code></div>{preview.serverType === "bedrock" ? <span className="status-pill">公式利用条件を起動前に確認</span> : <span className={preview.eulaAccepted ? "status-pill on" : "status-pill"}>EULA {preview.eulaAccepted ? "確認済み" : "未確認"}</span>}</header>
        <div className="import-facts"><div><span>起動ファイル</span><strong>{preview.serverType === "bedrock" ? "bedrock_server.exe" : preview.serverJar ?? preview.distributionBuild ?? "未検出"}</strong></div><div><span>ワールド</span><strong>{preview.worldFolders.join(", ") || "未検出"}</strong></div><div><span>拡張機能</span><strong>{preview.serverType === "bedrock" ? `Behavior ${preview.behaviorPackCount ?? preview.modCount} / Resource ${preview.resourcePackCount ?? preview.pluginCount} / World refs ${preview.datapackCount}` : `Mod ${preview.modCount} / Plugin ${preview.pluginCount} / Data ${preview.datapackCount}`}</strong></div><div><span>実行環境</span><strong>{preview.serverType === "bedrock" ? "Windowsネイティブ（Java不要）" : `${preview.minMemoryMib}–${preview.maxMemoryMib} MiB`}</strong></div></div>
        {preview.warnings.length ? <div className="import-warnings"><strong><Icon name="info" size={18} />確認が必要な項目</strong>{preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div> : null}
        <div className="import-form"><label><span>アプリ内の表示名</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} /></label>{preview.serverType === "bedrock" ? <div className="compatibility good"><Icon name="check" /><div><strong>Javaは不要です</strong><small>bedrock_server.exeを直接起動します</small></div></div> : <label><span>このサーバーで使うJava</span><select value={javaPath} onChange={(event) => setJavaPath(event.target.value)}>{preview.javaRuntimes.map((runtime) => <option value={runtime.executablePath} key={runtime.executablePath} disabled={!runtime.compatible}>Java {runtime.majorVersion} · {runtime.vendor}{runtime.compatible ? "" : "（非互換）"}</option>)}{preview.javaRuntimes.length === 0 ? <option value="">互換Javaが見つかりません</option> : null}</select></label>}</div>
        {preview.serverType !== "bedrock" && !preview.javaRuntimes.some((runtime) => runtime.compatible) ? <div className="java-missing-card"><div><Icon name="info" size={21}/><span><strong>このサーバーに合うJavaがありません</strong><small>元のサーバーフォルダーを変更せず、アプリ専用Javaを準備できます。</small></span></div><JavaSetupButton serverType={preview.serverType} minecraftVersion={preview.minecraftVersion} label="Javaを自動で準備" onInstalled={(runtime) => { setPreview((current) => current ? { ...current, javaRuntimes: [runtime, ...current.javaRuntimes.filter((item) => item.executablePath !== runtime.executablePath)] } : current); setJavaPath(runtime.executablePath); setError(""); }} /></div> : null}
        <label className="eula-consent import-backup"><input type="checkbox" checked={backup} onChange={(event) => setBackup(event.target.checked)} /><span><strong>登録時に初回バックアップを作成する（推奨）</strong><small>バックアップはアプリのデータ領域へ保存し、元フォルダーの内容は変更しません。</small></span></label>
      </div> : null}
      </> : null}
      {error ? <div className="error-banner" role="alert"><Icon name="info" /><span>{error}</span></div> : null}
    </div>
    <footer className="wizard-footer"><button className="secondary-button" type="button" onClick={onClose} disabled={busy}>キャンセル</button>{migration ? <button className="primary-button" type="button" onClick={restoreMigration} disabled={!migrationParent || !name.trim() || (migration.manifest.serverType !== "bedrock" && !javaPath) || busy}>{busy ? "復元中…" : "新PCへ復元して登録"}</button> : <button className="primary-button" type="button" onClick={finish} disabled={!preview || !name.trim() || (preview.serverType !== "bedrock" && !javaPath) || busy}>{busy && preview ? "登録中…" : "この内容で登録"}</button>}</footer>
    {busy ? <OperationOverlay title={migration ? "引っ越しファイルを安全に復元しています" : preview ? "既存サーバーを登録しています" : "サーバーフォルダーを調べています"} detail={migration ? "移行情報、件数、容量、危険なパスを確認して新しいフォルダーへ展開しています。" : preview ? "元のサーバーを壊さず、必要な場合は初回バックアップを作成してアプリへ登録しています。" : "server.properties、起動ファイル、ワールド、拡張機能、Java環境を読み取り専用で確認しています。"} stages={migration ? ["移行ファイル検証", "安全な展開", "サーバー登録"] : preview ? ["内容確認", "バックアップ", "登録"] : ["ファイル検出", "構成判定", "問題確認"]} /> : null}
  </section></div>;
}
