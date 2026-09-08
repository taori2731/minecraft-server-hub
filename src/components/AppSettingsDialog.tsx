import { useEffect, useState } from "react";
import { backend, confirmDanger } from "../lib/backend";
import type { AppearanceSettings, FixedPlayerPreset, PlayerAccessKind, RuntimeStatus, ServerProfile } from "../types";
import { Icon } from "./Icon";
import { detectSystemLocale, languageOptions, localeDisplayName, translate, useI18n, type LanguagePreference } from "../lib/i18n";
import { ProOperationsPanel } from "./ProOperationsPanel";
import { AppUpdatePanel } from "./AppUpdatePanel";
import { appUpdateText } from "../lib/appUpdateLocale";

type Section = "language" | "members" | "pro" | "plan" | "privacy" | "update" | "uninstall";

const FREE_PLAN_FEATURES = [
  "サーバーの作成・取り込み・起動・停止・削除",
  "Javaの自動準備とPC診断",
  "基本診断・ログ確認",
  "手動バックアップ・復元と変更前の安全バックアップ",
  "ワールド再生成と基本的な軽量化",
  "Modrinthからの拡張導入",
  "playit.ggを使った基本的な友達招待",
  "プレイヤー管理とダーク・ライトテーマ",
] as const;

const PRO_PLAN_FEATURES = [
  "予約・複数世代バックアップ（基盤実装済み・予約UI開発中）",
  "複数サーバーの一括操作（開発版を利用可能）",
  "長期操作履歴（開発版を利用可能）",
  "高度な監視と通知（アプリ内通知を利用可能）",
  "Modパック構成の保存・共有（利用可能）",
  "追加テーマ・アイコン（利用可能）",
  "優先サポート（提供体制の準備後）",
] as const;

export function AppSettingsDialog({
  server,
  status,
  servers,
  statuses,
  onStatusesChanged,
  onAppearanceChanged,
  onClose,
  notify,
  fail,
}: {
  server?: ServerProfile;
  status?: RuntimeStatus;
  servers: ServerProfile[];
  statuses: Record<string, RuntimeStatus>;
  onStatusesChanged: (values: Record<string, RuntimeStatus>) => void;
  onAppearanceChanged: (settings: AppearanceSettings) => void;
  onClose: () => void;
  notify: (message: string) => void;
  fail: (message: string) => void;
}) {
  const { preference, locale, setPreference, t } = useI18n();
  const [section, setSection] = useState<Section>("members");
  const [members, setMembers] = useState<FixedPlayerPreset[]>([]);
  const [edition, setEdition] = useState<"java" | "bedrock">("java");
  const [playerName, setPlayerName] = useState("");
  const [whitelist, setWhitelist] = useState(true);
  const [operator, setOperator] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [busy, setBusy] = useState("");

  useEffect(() => {
    let active = true;
    backend.listFixedPlayers().then((items) => active && setMembers(items)).catch((reason) => active && fail(String(reason)));
    return () => { active = false; };
  }, [fail]);

  const resetForm = () => {
    setEditingId(undefined);
    setEdition("java");
    setPlayerName("");
    setWhitelist(true);
    setOperator(false);
  };

  const saveMember = async () => {
    setBusy("save");
    try {
      const saved = await backend.saveFixedPlayer({ id: editingId, edition, playerName: playerName.trim(), whitelist: edition === "bedrock" ? true : whitelist, operator: edition === "bedrock" ? false : operator });
      setMembers((current) => {
        const exists = current.some((member) => member.id === saved.id);
        const next = exists ? current.map((member) => member.id === saved.id ? saved : member) : [...current, saved];
        return [...next].sort((left, right) => left.playerName.localeCompare(right.playerName, "en", { sensitivity: "base" }));
      });
      resetForm();
      window.dispatchEvent(new Event("server-hub:fixed-players-changed"));
      notify("いつものメンバーを保存しました");
    } catch (reason) { fail(String(reason)); }
    finally { setBusy(""); }
  };

  const editMember = (member: FixedPlayerPreset) => {
    setEditingId(member.id);
    setEdition(member.edition);
    setPlayerName(member.playerName);
    setWhitelist(member.whitelist);
    setOperator(member.operator);
  };

  const deleteMember = async (member: FixedPlayerPreset) => {
    if (!await confirmDanger(`${member.playerName} を「いつものメンバー」から削除しますか？\n適用済みのサーバー設定は自動では削除しません。`)) return;
    setBusy(member.id);
    try {
      await backend.deleteFixedPlayer(member.id);
      setMembers((current) => current.filter((item) => item.id !== member.id));
      if (editingId === member.id) resetForm();
      window.dispatchEvent(new Event("server-hub:fixed-players-changed"));
      notify("いつものメンバーから削除しました");
    } catch (reason) { fail(String(reason)); }
    finally { setBusy(""); }
  };

  const applyMembers = async (targets: FixedPlayerPreset[]) => {
    if (!server || !status || !["running", "stopped"].includes(status.state)) {
      fail("サーバーを選択し、起動または停止の処理が終わってから適用してください");
      return;
    }
    const compatibleTargets = targets.filter((member) => server.serverType === "bedrock"
      ? member.edition === "bedrock"
      : member.edition === "java" || (server.serverType === "paper" && member.edition === "bedrock"));
    if (compatibleTargets.length === 0) {
      fail(server.serverType === "bedrock" ? "このサーバーへ反映できる統合版専用メンバーがいません" : "このサーバーへ反映できるメンバーがいません");
      return;
    }
    if (compatibleTargets.some((member) => member.edition === "java" && member.operator) && !await confirmDanger(`選択中の「${server.name}」へ権限者を含む固定メンバー設定を適用しますか？\n権限者は管理コマンドを実行できます。`)) return;
    setBusy(targets.length === 1 ? targets[0].id : "apply-all");
    try {
      const neededKinds = new Set<PlayerAccessKind>();
      for (const member of compatibleTargets) {
        if (member.edition === "bedrock") neededKinds.add(server.serverType === "bedrock" ? "whitelist" : "bedrock_whitelist");
        else {
          if (member.whitelist) neededKinds.add("whitelist");
          if (member.operator) neededKinds.add("operators");
        }
      }
      const registered = new Map<PlayerAccessKind, Set<string>>();
      await Promise.all([...neededKinds].map(async (kind) => {
        const entries = await backend.playerAccess(server.id, kind);
        registered.set(kind, new Set(entries.map((entry) => entry.label.toLowerCase())));
      }));
      let applied = 0;
      let skipped = 0;
      for (const member of compatibleTargets) {
        const nameKey = member.playerName.toLowerCase();
        const memberKinds: PlayerAccessKind[] = member.edition === "bedrock"
          ? [server.serverType === "bedrock" ? "whitelist" : "bedrock_whitelist"]
          : ["whitelist", "operators"];
        for (const kind of memberKinds) {
          const enabled = member.edition === "bedrock" || (kind === "whitelist" ? member.whitelist : member.operator);
          if (!enabled) continue;
          const registeredForKind = registered.get(kind) ?? new Set<string>();
          if (registeredForKind.has(nameKey)) { skipped += 1; continue; }
          try {
            await backend.updatePlayerAccess({ serverId: server.id, kind, target: member.playerName, add: true });
          } catch (reason) {
            const role = kind === "bedrock_whitelist" ? "統合版ホワイトリスト" : kind === "whitelist" ? "ホワイトリスト" : "権限者";
            throw new Error(`${member.playerName}（${role}）: ${String(reason)}`);
          }
          registeredForKind.add(nameKey);
          registered.set(kind, registeredForKind);
          applied += 1;
        }
      }
      notify(`${compatibleTargets.length}人を${server.name}へ反映しました（追加${applied}件・登録済み${skipped}件）`);
    } catch (reason) { fail(`固定メンバーの適用を完了できませんでした: ${String(reason)}`); }
    finally { setBusy(""); }
  };

  const validName = edition === "bedrock"
    ? playerName.trim().length > 0 && playerName.trim().length <= 32 && !/[\r\n\t]/.test(playerName)
    : /^[A-Za-z0-9_]{3,16}$/.test(playerName.trim());
  const canApply = Boolean(server && status && ["running", "stopped"].includes(status.state));
  const changeLanguage = (next: LanguagePreference) => {
    setPreference(next);
    notify(translate(next === "system" ? detectSystemLocale() : next, "languageSaved"));
  };

  return <div className="modal-backdrop"><section className="wizard app-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="app-settings-title"><header className="wizard-header"><div><p className="wizard-kicker">APP SETTINGS</p><h2 id="app-settings-title">{t("appSettings")}</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label={t("close")}><Icon name="close" /></button></header><div className="settings-dialog-layout"><nav><button className={section === "language" ? "active" : ""} onClick={() => setSection("language")}><Icon name="info" />{t("language")}</button><button className={section === "members" ? "active" : ""} onClick={() => setSection("members")}><Icon name="users" />{t("members")}</button><button className={section === "pro" ? "active" : ""} onClick={() => setSection("pro")}><Icon name="chart" />{t("proOperations")}</button><button className={section === "plan" ? "active" : ""} onClick={() => setSection("plan")}><Icon name="plugin" />{t("plan")}</button><button className={section === "privacy" ? "active" : ""} onClick={() => setSection("privacy")}><Icon name="info" />{t("privacy")}</button><button className={section === "update" ? "active" : ""} onClick={() => setSection("update")}><Icon name="restart" />{appUpdateText(locale, "nav")}</button><button className={section === "uninstall" ? "active" : ""} onClick={() => setSection("uninstall")}><Icon name="trash" />{t("uninstall")}</button></nav><div className="settings-dialog-content">
    {section === "language" ? <><span className="section-kicker">LANGUAGE &amp; REGION</span><h3>{t("languageTitle")}</h3><p>{t("languageIntro")}</p><div className="language-settings-card"><label htmlFor="app-language"><span>{t("languageChoice")}</span><select id="app-language" value={preference} onChange={(event) => changeLanguage(event.target.value as LanguagePreference)}>{languageOptions.map((option) => <option key={option.value} value={option.value}>{option.value === "system" ? `${t("languageSystem")} (${option.nativeName})` : option.nativeName}</option>)}</select></label><div><span>{t("languageResolved")}</span><strong>{localeDisplayName(locale, locale)}</strong><small>{locale}</small></div></div><p className="privacy-note"><Icon name="info" size={16} />{t("languageLocal")}</p></> : null}
    {section === "members" ? <><span className="section-kicker">FIXED PLAYERS</span><h3>いつものメンバー</h3><p>Java版の名前と統合版のXboxゲーマータグを分けて保存し、対応するサーバーへまとめて登録できます。保存しただけではサーバーを書き換えません。</p>
      <div className="fixed-member-editions" role="group" aria-label="メンバーの種類"><button type="button" className={edition === "java" ? "active" : ""} disabled={Boolean(editingId)} onClick={() => { setEdition("java"); setPlayerName(""); setWhitelist(true); setOperator(false); }}>Java版</button><button type="button" className={edition === "bedrock" ? "active" : ""} disabled={Boolean(editingId)} onClick={() => { setEdition("bedrock"); setPlayerName(""); setWhitelist(true); setOperator(false); }}>統合版専用</button></div>
      <div className="fixed-member-form"><label><span>{edition === "bedrock" ? "Xboxゲーマータグ" : "プレイヤー名"}</span><input aria-label={edition === "bedrock" ? "固定メンバーのXboxゲーマータグ" : "固定メンバーのプレイヤー名"} value={playerName} onChange={(event) => setPlayerName(event.target.value)} placeholder={edition === "bedrock" ? "統合版のXboxゲーマータグ" : "Minecraft Java版の名前"} maxLength={edition === "bedrock" ? 32 : 16} /></label><div className="fixed-member-options">{edition === "bedrock" ? <span className="status-pill on">統合版ホワイトリスト</span> : <><label><input type="checkbox" checked={whitelist} onChange={(event) => setWhitelist(event.target.checked)} />ホワイトリスト</label><label><input type="checkbox" checked={operator} onChange={(event) => setOperator(event.target.checked)} />権限者</label></>}</div><button className="primary-button" type="button" disabled={busy !== "" || !validName || (edition === "java" && !whitelist && !operator)} onClick={saveMember}><Icon name="check" size={17} />{editingId ? "変更を保存" : "メンバーを保存"}</button>{editingId ? <button className="secondary-button" type="button" disabled={busy !== ""} onClick={resetForm}>編集をやめる</button> : null}</div>
      <div className="fixed-member-target"><div><strong>{server ? `適用先: ${server.name}` : "適用先のサーバーがありません"}</strong><small>{server ? (canApply ? (status?.state === "running" ? "起動中のため即時反映します" : "停止中の設定ファイルへ保存します") : "起動・停止処理の完了後に適用できます") : "先にサーバーを作成または取り込んでください"}</small></div><button className="primary-button" type="button" disabled={busy !== "" || members.length === 0 || !canApply} onClick={() => applyMembers(members)}><Icon name="users" size={17} />対応メンバーを反映</button></div>
      <div className="fixed-member-list">{members.map((member) => <article key={member.id}><span className={`access-avatar whitelist ${member.edition}`}><Icon name="users" size={19} /></span><div><strong>{member.playerName}</strong><span className="fixed-member-badges"><small>{member.edition === "bedrock" ? "統合版専用" : "Java版"}</small>{member.whitelist ? <small>{member.edition === "bedrock" ? "統合版ホワイトリスト" : "ホワイトリスト"}</small> : null}{member.operator ? <small className="operator">権限者</small> : null}</span></div><div className="fixed-member-actions"><button className="small-button" type="button" disabled={busy !== ""} onClick={() => editMember(member)}>編集</button><button className="small-button" type="button" disabled={busy !== "" || !canApply} onClick={() => applyMembers([member])}>この人を反映</button><button className="icon-button danger-icon" type="button" disabled={busy !== ""} onClick={() => deleteMember(member)} aria-label={`${member.playerName}を削除`}><Icon name="trash" size={17} /></button></div></article>)}{members.length === 0 ? <div className="panel-empty compact"><p>保存されたメンバーはいません。種類と名前を選んで追加してください。</p></div> : null}</div>
      <p className="privacy-note"><Icon name="info" size={16} />統合版専用メンバーは、PaperではFloodgateの統合版ホワイトリスト、BDSでは許可リストへ反映します。Java版メンバーとは同名でも別に保存できます。</p></> : null}
    {section === "pro" ? <><span className="section-kicker">PRO OPERATIONS</span><h3>複数サーバー運用</h3><p>複数サーバーの状態、操作、監視、履歴、Mod構成、外観を一か所で管理します。開発版のため決済やライセンス認証はまだ接続していません。</p><ProOperationsPanel servers={servers} statuses={statuses} selectedServerId={server?.id} onStatusesChanged={onStatusesChanged} onAppearanceChanged={onAppearanceChanged} notify={notify} fail={fail} /></> : null}
    {section === "plan" ? <><span className="section-kicker">PLAN</span><h3>無料版とPro／サポーター版</h3><p>基本機能と安全機能は無料のまま利用できます。Pro版は、運用を便利にする自動化や高度な管理機能を追加する開発支援版として検討中です。</p><div className="plan-grid"><article className="current"><span>利用可能</span><h4>無料版</h4><strong>¥0</strong><ul>{FREE_PLAN_FEATURES.map((feature) => <li key={feature}>{feature}</li>)}</ul></article><article><span>開発中・予定</span><h4>Pro／サポーター版</h4><strong>価格未定</strong><ul>{PRO_PLAN_FEATURES.map((feature) => <li key={feature}>{feature}</li>)}</ul><button className="primary-button" type="button" disabled>準備中（購入できません）</button></article></div><div className="plan-policy"><strong>料金方針</strong><p>継続的なクラウド提供を含まないローカル機能は、買い切り方式を候補として検討しています。決済、ライセンス認証、価格、税、返金条件はまだ未設定です。</p><p>復元、診断、Java準備、変更前バックアップ、基本招待など、安全に使うための機能を有料限定にはしません。</p></div></> : null}
    {section === "privacy" ? <><span className="section-kicker">LOCAL FIRST</span><h3>プライバシーとライセンス</h3><div className="privacy-list"><article><strong>診断データ</strong><p>CPU、メモリ、GPU、Java、保存先の情報はローカルで処理し、自動送信しません。</p></article><article><strong>広告・決済</strong><p>本番広告、決済、ライセンス認証は未接続です。ログ、ワールド名、プレイヤー名、IPアドレスを広告目的で送信しません。</p></article><article><strong>オープンソース</strong><p>配布前に依存ライセンス一覧と第三者表示を同梱します。</p></article><article><strong>非公式ツール</strong><p>公式ロゴや公式アセットを使用しない独立プロジェクトです。公開前に製品名をMinecraft利用ガイドラインに合わせて再検討します。</p></article></div></> : null}
    {section === "update" ? <AppUpdatePanel hasActiveServers={Object.values(statuses).some((value) => value.state !== "stopped" && value.state !== "crashed")} notify={notify} fail={fail} /> : null}
    {section === "uninstall" ? <><span className="section-kicker">WINDOWS APP</span><h3>アプリをアンインストール</h3><p>Minecraft Server Hubの削除はWindowsの「インストールされているアプリ」から行います。確認なく削除は開始しません。</p><div className="uninstall-card"><Icon name="trash" size={28} /><div><strong>Windowsのアンインストール画面を開く</strong><small>サーバーフォルダーやワールドは、この操作だけでは削除しません。</small></div><button className="danger-button" type="button" disabled={busy !== ""} onClick={async () => { if (!await confirmDanger("Windowsのアンインストール画面を開きますか？\nMinecraft Server Hubを選んで削除するまでは、アプリは変更されません。")) return; setBusy("uninstall"); try { await backend.openUninstallSettings(); notify("Windowsのアンインストール画面を開きました"); } catch (reason) { fail(String(reason)); } finally { setBusy(""); } }}><Icon name="trash" size={17} />アンインストール画面を開く</button></div><p className="privacy-note"><Icon name="info" size={16} />このボタンはWindows設定を開くだけです。サーバー、ワールド、バックアップ、アプリ管理データの削除はここでは実行しません。</p></> : null}
  </div></div></section></div>;
}
