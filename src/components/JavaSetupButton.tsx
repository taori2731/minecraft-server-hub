import { useState } from "react";
import { createPortal } from "react-dom";
import { backend } from "../lib/backend";
import type { JavaDownloadPlan, JavaRuntime, ServerType } from "../types";
import { Icon } from "./Icon";
import { OperationOverlay } from "./OperationOverlay";

interface Props {
  serverType: ServerType;
  minecraftVersion: string;
  disabled?: boolean;
  label?: string;
  onInstalled: (runtime: JavaRuntime) => void | Promise<void>;
}

const formatMib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

export function JavaSetupButton({ serverType, minecraftVersion, disabled, label = "必要なJavaを自動で準備", onInstalled }: Props) {
  const [plan, setPlan] = useState<JavaDownloadPlan>();
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState<"plan" | "install" | "">("");
  const [error, setError] = useState("");

  const openPlan = async () => {
    setBusy("plan");
    setError("");
    try {
      setPlan(await backend.getJavaDownloadPlan(serverType, minecraftVersion));
      setAccepted(false);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  };

  const install = async () => {
    if (!plan || !accepted) return;
    setBusy("install");
    setError("");
    try {
      const runtime = await backend.installManagedJava(plan);
      await onInstalled(runtime);
      setPlan(undefined);
      setAccepted(false);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy("");
    }
  };

  const dialog = plan ? <div className="modal-backdrop java-setup-backdrop" role="presentation">
    <section className="java-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="java-setup-title">
      <header>
        <div><span className="section-kicker">SAFE JAVA SETUP</span><h2 id="java-setup-title">Javaをアプリ内に準備</h2></div>
        <button className="icon-button" type="button" aria-label="Java確認画面を閉じる" disabled={busy === "install"} onClick={() => { setPlan(undefined); setAccepted(false); setError(""); }}><Icon name="close" /></button>
      </header>
      <div className="java-setup-body">
        <div className="info-callout"><Icon name="check" size={20}/><div><strong>PC初心者でも、この画面だけで準備できます</strong><br/>Windows全体へインストールせず、このアプリ専用フォルダーに保存して自動選択します。管理者権限、PATH設定、JAVA_HOME設定は不要です。</div></div>
        <dl className="java-plan-facts">
          <div><dt>配布元</dt><dd>{plan.provider}</dd></div>
          <div><dt>Java</dt><dd>{plan.distribution}</dd></div>
          <div><dt>バージョン</dt><dd>{plan.releaseName}</dd></div>
          <div><dt>ダウンロード容量</dt><dd>{formatMib(plan.sizeBytes)}</dd></div>
          <div><dt>ライセンス</dt><dd>{plan.licenseName}</dd></div>
          <div className="wide"><dt>保存先</dt><dd>{plan.destinationPath}</dd></div>
        </dl>
        <p className="privacy-note">公式APIが示すSHA-256を照合し、安全なZIP項目だけを展開します。不一致・中断・容量超過の場合はJavaとして登録しません。</p>
        <div className="official-links java-plan-links"><a href={plan.licenseUrl} target="_blank" rel="noreferrer">ライセンスを確認</a><a href={plan.sourceUrl} target="_blank" rel="noreferrer">公式配布ファイル</a></div>
        <div className="eula-consent java-license-consent"><input aria-label="配布元・ライセンス・バージョン・容量・保存先を確認しました" type="checkbox" checked={accepted} disabled={busy === "install"} onChange={(event) => setAccepted(event.target.checked)} /><span><strong>配布元・ライセンス・バージョン・容量・保存先を確認しました</strong><small>確認後に「ダウンロードして自動選択」を押した場合だけ取得します。</small></span></div>
        {error ? <div className="error-banner" role="alert"><Icon name="info"/><span>{error}</span></div> : null}
      </div>
      <footer>
        <button className="secondary-button" type="button" disabled={busy === "install"} onClick={() => { setPlan(undefined); setAccepted(false); setError(""); }}>キャンセル</button>
        <button className="primary-button" type="button" disabled={!accepted || busy === "install"} onClick={install}><Icon name="download" size={18}/>{busy === "install" ? "ダウンロード・検証・展開中…" : "ダウンロードして自動選択"}</button>
      </footer>
    </section>
  </div> : null;

  return <>
    <div className="java-setup-action">
      <button className="primary-button" type="button" onClick={openPlan} disabled={disabled || busy !== "" || !minecraftVersion}>
        <Icon name="download" size={18} />{busy === "plan" ? "公式配布情報を確認中…" : label}
      </button>
      {error && !plan ? <p className="java-setup-error" role="alert">{error}</p> : null}
    </div>
    {dialog ? createPortal(dialog, document.querySelector(".app") ?? document.body) : null}
    {busy === "install" ? <OperationOverlay title="Javaを安全に準備しています" detail="公式ファイルのダウンロード、SHA-256検証、安全な展開を順番に行っています。" stages={["ダウンロード", "安全確認", "自動選択"]} /> : null}
  </>;
}
