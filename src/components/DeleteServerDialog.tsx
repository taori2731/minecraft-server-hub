import { useState } from "react";
import { backend, confirmDanger } from "../lib/backend";
import { DELETE_CONFIRMATION_TEXT, isValidDeleteConfirmation } from "../lib/deleteConfirmation";
import { minecraftDeleteCopy, palworldDeleteCopy } from "../lib/deleteServerLocale";
import { useI18n } from "../lib/i18n";
import type { DeleteServerInput, DeleteServerResult, RuntimeStatus, ServerProfile } from "../types";
import { Icon } from "./Icon";
import { OperationOverlay } from "./OperationOverlay";

interface Props {
  server: ServerProfile;
  status: RuntimeStatus;
  onClose: () => void;
  onDeleted: (result: DeleteServerResult) => void;
  fail: (message: string) => void;
}

type DeleteMode = "registration" | "full" | "essential" | "none";

export function DeleteServerDialog({ server, status, onClose, onDeleted, fail }: Props) {
  const { locale } = useI18n();
  const [mode, setMode] = useState<DeleteMode>("registration");
  const [confirmationText, setConfirmationText] = useState("");
  const [busy, setBusy] = useState(false);
  const isPalworld = server.gameKind === "palworld" || server.serverType === "palworld";
  const copy = palworldDeleteCopy(locale);
  const immediateCopy = isPalworld ? copy : minecraftDeleteCopy(locale);
  const deleteFiles = mode !== "registration";
  const backupMode: DeleteServerInput["backupMode"] = mode === "registration" ? undefined : mode;
  const canDelete = status.state === "stopped" && isValidDeleteConfirmation(confirmationText);

  const remove = async () => {
    if (!canDelete) return;
    const message = mode === "essential"
      ? `「${server.name}」\n\n${copy.essentialConfirm}`
      : mode === "none"
        ? `「${server.name}」\n\n${immediateCopy.noneConfirm}`
        : mode === "full"
          ? `「${server.name}」の登録とサーバーフォルダーを削除します。\n\n削除直前に最終バックアップを作成しますが、元フォルダーは削除されます。続けますか？`
          : `「${server.name}」をアプリの一覧から外します。\n\nサーバーフォルダーとデータはPCに残ります。続けますか？`;
    if (!await confirmDanger(message)) return;
    setBusy(true);
    try {
      onDeleted(await backend.deleteServer({ serverId: server.id, deleteFiles, backupMode, confirmationText }));
    } catch (reason) {
      fail(String(reason));
      setBusy(false);
    }
  };

  const buttonLabel = busy ? "処理中…" : mode === "essential" ? copy.essentialButton : mode === "none" ? immediateCopy.noneButton : mode === "full" ? "バックアップして削除" : "一覧から外す";
  const overlay = mode === "essential"
    ? { title: copy.essentialOverlayTitle, detail: copy.essentialOverlayDetail, stages: ["重要データ", "整合性確認", "高速削除"] }
    : mode === "none"
      ? { title: immediateCopy.noneOverlayTitle, detail: immediateCopy.noneOverlayDetail, stages: ["削除対象を確認", "即時削除", "一覧更新"] }
      : mode === "full"
        ? { title: "最終バックアップ後に削除しています", detail: "現在の状態を復旧できるよう保存してから、登録済みフォルダーだけを削除します。", stages: ["バックアップ", "整合性確認", "削除"] }
        : { title: "サーバーを一覧から外しています", detail: "サーバーファイルをPCに残したまま、アプリの登録だけを解除します。", stages: ["登録確認", "解除", "一覧更新"] };

  return <div className="modal-backdrop" role="presentation">
    <section className="wizard delete-server-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-server-title">
      <header className="wizard-header">
        <div><p className="wizard-kicker danger-text">DANGER ZONE</p><h2 id="delete-server-title">サーバーを削除</h2></div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="削除画面を閉じる"><Icon name="close" /></button>
      </header>
      <div className="wizard-body form-stack">
        <div className="delete-server-summary"><Icon name="server" size={30} /><div><strong>{server.name}</strong><code>{server.rootPath}</code></div></div>
        {status.state !== "stopped" ? <p className="warning-callout"><Icon name="info" />安全のため、削除する前にサーバーを停止してください。</p> : null}
        <fieldset className="delete-mode-choice">
          <legend>削除する範囲</legend>
          <label className={mode === "registration" ? "selected" : ""}><input type="radio" name="delete-mode" checked={mode === "registration"} onChange={() => setMode("registration")} /><span><strong>一覧から外す（おすすめ）</strong><small>アプリの登録だけを解除します。ワールドや設定はPCに残ります。</small></span></label>
          {isPalworld ? <>
            <label className={mode === "essential" ? "selected" : ""}><input type="radio" name="delete-mode" checked={mode === "essential"} onChange={() => setMode("essential")} /><span><strong>{copy.essentialTitle}</strong><small>{copy.essentialDetail}</small></span></label>
            <label className={mode === "none" ? "selected danger" : ""}><input type="radio" name="delete-mode" checked={mode === "none"} onChange={() => setMode("none")} /><span><strong>{copy.noneTitle}</strong><small>{copy.noneDetail}</small></span></label>
          </> : <>
            <label className={mode === "full" ? "selected danger" : ""}><input type="radio" name="delete-mode" checked={mode === "full"} onChange={() => setMode("full")} /><span><strong>フォルダーも削除</strong><small>最終バックアップを作成してから、登録済みのサーバーフォルダーだけを削除します。</small></span></label>
            <label className={mode === "none" ? "selected danger" : ""}><input type="radio" name="delete-mode" checked={mode === "none"} onChange={() => setMode("none")} /><span><strong>{immediateCopy.noneTitle}</strong><small>{immediateCopy.noneDetail}</small></span></label>
          </>}
        </fieldset>
        {mode === "essential" ? <>
          <p className="warning-callout"><Icon name="info" />{copy.passwordWarning}</p>
          <p className="warning-callout"><Icon name="info" />{copy.essentialRecovery}</p>
        </> : null}
        {mode === "none" ? <p className="warning-callout danger-callout"><Icon name="info" />{immediateCopy.noneWarning}</p> : null}
        <label>
          <span>{`確認のため「${DELETE_CONFIRMATION_TEXT}」と入力`}</span>
          <input value={confirmationText} placeholder={DELETE_CONFIRMATION_TEXT} autoComplete="off" spellCheck={false} onChange={(event) => setConfirmationText(event.target.value)} />
        </label>
        {mode === "full" ? <p className="warning-callout"><Icon name="info" />削除後は、アプリのバックアップ保存先に残る最終バックアップから手動で復旧できます。</p> : null}
      </div>
      <footer className="wizard-footer">
        <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>キャンセル</button>
        <button className="danger-button" type="button" disabled={!canDelete || busy} onClick={remove}><Icon name="trash" size={18} />{buttonLabel}</button>
      </footer>
      {busy ? <OperationOverlay title={overlay.title} detail={overlay.detail} stages={overlay.stages} /> : null}
    </section>
  </div>;
}
