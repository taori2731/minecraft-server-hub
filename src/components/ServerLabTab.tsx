import { useEffect, useMemo, useState } from "react";
import { backend, confirmDanger } from "../lib/backend";
import { useI18n } from "../lib/i18n";
import { getMemoryOptions } from "../lib/memoryOptions";
import {
  applyPerformancePreset,
  applyPlaystylePreset,
  auditServerLabDraft,
  createServerLabDraft,
  diffServerLabDraft,
  estimateChunkSquare,
  estimatePlayerCapacity,
  estimateRecommendedMemoryMib,
  formatPropertiesPatch,
  generateWorldSeed,
  inspectServerPort,
  loadServerLabDraft,
  saveServerLabDraft,
  serverLabDraftStorageKey,
  spawnProtectionFootprint,
  type PerformancePresetId,
  type PlaystylePresetId,
  type ServerLabAuditId,
} from "../lib/serverLab";
import { getServerNetworkProtocol } from "../lib/serverEdition";
import { serverLabText, type ServerLabLocaleKey } from "../lib/serverLabLocale";
import type { RuntimeStatus, ServerProfile } from "../types";
import { Icon } from "./Icon";
import { OperationOverlay } from "./OperationOverlay";

const playstylePresets: ReadonlyArray<{ id: PlaystylePresetId; title: string; detailKey: ServerLabLocaleKey }> = [
  { id: "survival", title: "標準サバイバル", detailKey: "survivalDetail" },
  { id: "creative", title: "クリエイティブ建築", detailKey: "creativeDetail" },
  { id: "peaceful", title: "平和な探索", detailKey: "peacefulDetail" },
  { id: "pvp", title: "PvPイベント", detailKey: "pvpDetail" },
];

const performancePresets: ReadonlyArray<{ id: PerformancePresetId; title: string; detail: string }> = [
  { id: "eco", title: "省電力", detail: "描画5・処理4でPC負荷を抑える" },
  { id: "balanced", title: "バランス", detail: "普段遊び向けの距離設定" },
  { id: "range", title: "遠景重視", detail: "高性能PC向け。負荷が大きくなります" },
];

const auditLabels: Record<ServerLabAuditId, { title: string; detail: string }> = {
  authentication: { title: "公式アカウント認証", detail: "なりすましを防ぐ基本設定" },
  allowlist: { title: "参加者リスト", detail: "招待した人だけ参加できる状態" },
  defaultPermission: { title: "既定権限", detail: "参加者全員が管理者にならない設定" },
  resourcePack: { title: "リソースパック", detail: "必須時に有効なURLが設定済み" },
  port: { title: "ポート範囲", detail: "1024〜65535の利用可能な範囲" },
  hardcore: { title: "ハードコア整合性", detail: "サバイバル・ハードの組み合わせ" },
};

export function ServerLabTab({ server, status, onUpdated, notify, fail }: {
  server: ServerProfile;
  status: RuntimeStatus;
  onUpdated: (server: ServerProfile) => void;
  notify: (message: string) => void;
  fail: (message: string) => void;
}) {
  const { locale } = useI18n();
  const [draft, setDraft] = useState(() => createServerLabDraft(server));
  const [plannedPlayers, setPlannedPlayers] = useState(server.settings.maxPlayers);
  const [memoryTotalMib, setMemoryTotalMib] = useState<number>();
  const [savedDraftAt, setSavedDraftAt] = useState("");
  const [busy, setBusy] = useState<"" | "port" | "apply">("");
  const isBedrock = server.serverType === "bedrock";

  useEffect(() => {
    setDraft(createServerLabDraft(server));
    setPlannedPlayers(server.settings.maxPlayers);
    setSavedDraftAt(loadServerLabDraft(localStorage, server)?.savedAt ?? "");
  }, [server]);

  useEffect(() => {
    if (isBedrock) { setMemoryTotalMib(undefined); return; }
    let active = true;
    backend.diagnose(server.id).then((result) => {
      if (active) setMemoryTotalMib(result.memoryTotalMib);
    }).catch(() => {
      if (active) setMemoryTotalMib(undefined);
    });
    return () => { active = false; };
  }, [isBedrock, server.id]);

  const changes = useMemo(() => diffServerLabDraft(server, draft), [draft, server]);
  const patch = useMemo(() => formatPropertiesPatch(server, draft), [draft, server]);
  const audits = useMemo(() => auditServerLabDraft(draft, server.serverType), [draft, server.serverType]);
  const portInspection = useMemo(() => inspectServerPort(draft.port, server.serverType), [draft.port, server.serverType]);
  const viewChunks = estimateChunkSquare(draft.settings.viewDistance);
  const simulationChunks = estimateChunkSquare(draft.settings.simulationDistance);
  const spawnFootprint = spawnProtectionFootprint(draft.settings.spawnProtection);
  const capacity = estimatePlayerCapacity(draft.memoryMib, server.serverType, draft.settings.viewDistance, draft.settings.simulationDistance);
  const recommendedMemory = estimateRecommendedMemoryMib(plannedPlayers, server.serverType, draft.settings.viewDistance, draft.settings.simulationDistance, memoryTotalMib);
  const memoryOptions = getMemoryOptions(memoryTotalMib, draft.memoryMib);
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const labText = (key: ServerLabLocaleKey, values?: Record<string, string | number>) => serverLabText(locale, key, values);

  const updateSettings = (values: Partial<ServerProfile["settings"]>) => {
    setDraft((current) => ({ ...current, settings: { ...current.settings, ...values } }));
  };

  const applyPlaystyle = (id: PlaystylePresetId) => {
    setDraft((current) => applyPlaystylePreset(current, id, server.serverType));
    notify("遊び方プリセットを下書きへ反映しました。まだサーバーには保存していません");
  };

  const applyPerformance = (id: PerformancePresetId) => {
    setDraft((current) => applyPerformancePreset(current, id, server.serverType));
    notify("性能プリセットを下書きへ反映しました。負荷推定を確認してください");
  };

  const applyCapacityPlan = () => {
    const safePlayers = Math.max(1, Math.min(500, Math.floor(plannedPlayers || 1)));
    setPlannedPlayers(safePlayers);
    setDraft((current) => ({
      ...current,
      memoryMib: isBedrock ? current.memoryMib : recommendedMemory,
      settings: { ...current.settings, maxPlayers: safePlayers },
    }));
    notify(isBedrock ? "予定人数を下書きへ反映しました。統合版のメモリはWindowsが管理します" : "予定人数と推奨メモリを下書きへ反映しました");
  };

  const generateSeed = () => {
    updateSettings({ worldSeed: generateWorldSeed() });
    notify("新しいランダムシードを下書きへ入れました。既存ワールドは自動再生成しません");
  };

  const suggestPort = async () => {
    setBusy("port");
    try {
      const next = await backend.suggestServerPort(draft.port, getServerNetworkProtocol(server.serverType));
      setDraft((current) => ({ ...current, port: next }));
      notify(labText("portNotice", { port: next }));
    } catch (reason) {
      fail(String(reason));
    } finally {
      setBusy("");
    }
  };

  const saveDraft = () => {
    try {
      const stored = saveServerLabDraft(localStorage, server, draft);
      setSavedDraftAt(stored.savedAt);
      notify("このPCへラボの下書きを保存しました。リソースパックURLは保存していません");
    } catch (reason) {
      fail(String(reason));
    }
  };

  const restoreDraft = () => {
    const stored = loadServerLabDraft(localStorage, server);
    if (!stored) { fail("復元できる安全な下書きがありません"); return; }
    setDraft({ settings: stored.settings, memoryMib: stored.memoryMib, port: stored.port });
    setPlannedPlayers(stored.settings.maxPlayers);
    setSavedDraftAt(stored.savedAt);
    notify("保存した下書きを復元しました。まだサーバーには保存していません");
  };

  const resetDraft = () => {
    setDraft(createServerLabDraft(server));
    setPlannedPlayers(server.settings.maxPlayers);
    notify("未保存の変更を現在のサーバー設定へ戻しました");
  };

  const copyPatch = async () => {
    try {
      await navigator.clipboard.writeText(patch);
      notify("server.properties変更案をコピーしました");
    } catch (reason) {
      fail(String(reason));
    }
  };

  const applyDraft = async () => {
    if (changes.length === 0) return;
    if (!draft.settings.onlineMode && !await confirmDanger("公式アカウント認証が無効です。なりすましを防げなくなるため、インターネット公開には使えません。\n\nこの設定を保存しますか？")) return;
    setBusy("apply");
    try {
      const updated = await backend.updateSettings(server.id, draft.settings, draft.memoryMib, draft.port);
      localStorage.removeItem(serverLabDraftStorageKey(server.id));
      setSavedDraftAt("");
      setDraft(createServerLabDraft(updated));
      onUpdated(updated);
      notify("安全バックアップ後にラボの設定を保存しました。再起動すると反映されます");
    } catch (reason) {
      fail(String(reason));
    } finally {
      setBusy("");
    }
  };

  const portState = !portInspection.valid ? "範囲外" : portInspection.isDefault ? "Minecraft標準" : portInspection.isDynamic ? "動的ポート範囲" : "利用可能な範囲";

  return <div className="tab-content server-lab-content">
    <section className="feature-panel server-lab-panel">
      <header>
        <div><span className="section-kicker">LOCAL CONFIG LAB · 15 TOOLS</span><h2>サーバーラボ</h2></div>
        <span className="restart-badge"><Icon name="gear" size={16} />保存までは未反映</span>
      </header>
      <p className="server-lab-intro" data-no-translate>{labText("intro")}</p>
      {status.state !== "stopped" ? <p className="inline-warning server-lab-stop" data-no-translate><Icon name="info" size={17} />{labText("stopToSave")}</p> : null}

      <div className="server-lab-grid">
        <article className="server-lab-card lab-wide-card">
          <div className="lab-card-heading"><span><small>FEATURE 01</small><strong>遊び方プリセット</strong></span><em>明示保存</em></div>
          <p data-no-translate>{labText("playstyleDescription")}</p>
          <div className="lab-preset-grid">
            {playstylePresets.map((preset) => <button type="button" key={preset.id} onClick={() => applyPlaystyle(preset.id)}><strong>{preset.title}</strong><small data-no-translate>{labText(preset.detailKey)}</small></button>)}
          </div>
        </article>

        <article className="server-lab-card lab-wide-card">
          <div className="lab-card-heading"><span><small>FEATURE 02</small><strong>性能プリセット</strong></span><em>距離だけ変更</em></div>
          <p data-no-translate>{labText(isBedrock ? "performanceBedrock" : "performanceJava")}</p>
          <div className="lab-preset-grid lab-performance-presets">
            {performancePresets.map((preset) => <button type="button" key={preset.id} onClick={() => applyPerformance(preset.id)}><strong data-no-translate={preset.id === "range" ? true : undefined}>{preset.id === "range" ? labText("longRange") : preset.title}</strong><small data-no-translate={preset.id === "range" ? true : undefined}>{preset.id === "range" ? labText("longRangeDetail") : preset.detail}</small></button>)}
          </div>
        </article>

        <article className="server-lab-card">
          <div className="lab-card-heading"><span><small>FEATURE 03 + 04</small><strong>人数・メモリプランナー</strong></span></div>
          <label><span>予定プレイヤー数</span><input aria-label="ラボの予定プレイヤー数" type="number" min={1} max={500} value={plannedPlayers} onChange={(event) => setPlannedPlayers(Number(event.target.value))} /></label>
          <div className="lab-plan-result"><span>推定上限の目安</span><strong data-no-translate>{labText("playerCount", { count: number.format(capacity) })}</strong><small data-no-translate>{labText("estimateVaries")}</small></div>
          <div className="lab-plan-result"><span>推奨最大メモリ</span><strong data-no-translate>{isBedrock ? labText("windowsManaged") : `${recommendedMemory / 1024} GiB`}</strong><small data-no-translate>{labText("reserveMemory")}</small></div>
          <button className="secondary-button" data-no-translate type="button" onClick={applyCapacityPlan}>{labText("applyPlan")}</button>
        </article>

        <article className="server-lab-card">
          <div className="lab-card-heading"><span><small>FEATURE 05 + 06 + 07</small><strong>チャンク・保護範囲の推定</strong></span></div>
          <div className="lab-metric-list">
            <div><span>描画チャンク候補</span><strong>{number.format(viewChunks)}</strong><small data-no-translate>{labText("radiusSquare", { radius: draft.settings.viewDistance })}</small></div>
            <div><span>{isBedrock ? "ティック処理候補" : "シミュレーション候補"}</span><strong>{number.format(simulationChunks)}</strong><small data-no-translate>{labText("quadraticLoad")}</small></div>
            <div><span>スポーン保護面積</span><strong>{isBedrock ? "対象外" : `${number.format(spawnFootprint.blocks)} blocks`}</strong><small>{isBedrock ? "統合版BDSには同じ設定がありません" : `${spawnFootprint.diameter} × ${spawnFootprint.diameter}`}</small></div>
          </div>
        </article>

        <article className="server-lab-card lab-wide-card">
          <div className="lab-card-heading"><span><small>ADVANCED TUNING</small><strong data-no-translate>{labText("advancedTitle")}</strong></span><em>範囲制限あり</em></div>
          <div className="lab-tuning-grid">
            <label><span>最大プレイヤー数</span><input type="number" min={1} max={500} value={draft.settings.maxPlayers} onChange={(event) => updateSettings({ maxPlayers: Number(event.target.value) })} /></label>
            {!isBedrock ? <label><span>最大メモリ</span><select value={draft.memoryMib} onChange={(event) => setDraft((current) => ({ ...current, memoryMib: Number(event.target.value) }))}>{memoryOptions.map((value) => <option value={value} key={value}>{value / 1024} GiB</option>)}</select></label> : null}
            <label><span>描画距離</span><input type="number" min={2} max={32} value={draft.settings.viewDistance} onChange={(event) => updateSettings({ viewDistance: Number(event.target.value) })} /></label>
            <label><span>{isBedrock ? "ティック距離" : "シミュレーション距離"}</span><input type="number" min={isBedrock ? 4 : 2} max={isBedrock ? 12 : 32} value={draft.settings.simulationDistance} onChange={(event) => updateSettings({ simulationDistance: Number(event.target.value) })} /></label>
            {!isBedrock ? <label><span>スポーン保護範囲</span><input type="number" min={0} max={256} value={draft.settings.spawnProtection} onChange={(event) => updateSettings({ spawnProtection: Number(event.target.value) })} /></label> : null}
          </div>
        </article>

        <article className="server-lab-card">
          <div className="lab-card-heading"><span><small>FEATURE 08</small><strong>ワールドシード生成</strong></span></div>
          <label><span data-no-translate>{labText("seedCandidate")}</span><input aria-label="ラボのワールドシード" value={draft.settings.worldSeed ?? ""} maxLength={128} onChange={(event) => updateSettings({ worldSeed: event.target.value })} placeholder={labText("seedPlaceholder")} data-no-translate /></label>
          <button className="secondary-button" type="button" onClick={generateSeed}>64-bitランダムシードを作る</button>
          <small data-no-translate>{labText("seedHelp")}</small>
        </article>

        <article className="server-lab-card">
          <div className="lab-card-heading"><span><small>FEATURE 09 + 10</small><strong>ポート検査と提案</strong></span><em className={portInspection.valid ? "lab-good" : "lab-bad"}>{portState}</em></div>
          <label><span data-no-translate>{labText(isBedrock ? "udpPort" : "tcpPort")}</span><input aria-label="ラボのサーバーポート" type="number" min={1024} max={65535} value={draft.port} onChange={(event) => setDraft((current) => ({ ...current, port: Number(event.target.value) }))} /></label>
          <div className="lab-port-flags"><span>{portInspection.isDefault ? "標準ポート" : "カスタムポート"}</span><span>{portInspection.isDynamic ? "動的範囲" : "固定範囲"}</span><span>{portInspection.systemReserved ? "システム範囲" : "一般利用範囲"}</span></div>
          <button className="secondary-button" data-no-translate type="button" disabled={busy === "port" || status.state !== "stopped"} onClick={suggestPort}>{labText(busy === "port" ? "checkingPc" : "suggestPort")}</button>
        </article>

        <article className="server-lab-card lab-wide-card">
          <div className="lab-card-heading"><span><small>FEATURE 11</small><strong>公開前セキュリティ監査</strong></span><em>{audits.filter((item) => item.passed).length} / {audits.length}</em></div>
          <div className="lab-audit-grid">
            {audits.map((item) => <div className={item.passed ? "passed" : "attention"} key={item.id}><Icon name={item.passed ? "check" : "info"} size={18} /><span><strong>{auditLabels[item.id].title}</strong><small data-no-translate>{item.id === "authentication" ? labText("authenticationDetail") : item.id === "allowlist" ? labText("allowlistDetail") : item.id === "defaultPermission" ? labText("permissionDetail") : item.id === "resourcePack" ? labText("resourcePackDetail") : item.id === "port" ? labText("portRangeDetail") : labText("hardcoreDetail")}</small></span><em>{item.passed ? "OK" : "要確認"}</em></div>)}
          </div>
          <small data-no-translate>{labText("auditHelp")}</small>
        </article>

        <article className="server-lab-card lab-wide-card">
          <div className="lab-card-heading"><span><small>FEATURE 12 + 13</small><strong>未保存の変更差分</strong></span><em data-no-translate>{labText("changeCount", { count: changes.length })}</em></div>
          {changes.length ? <div className="lab-diff-table" role="table" aria-label="ラボの設定差分">
            {changes.map((change) => <div role="row" key={`${change.property}-${change.key}`}><code>{change.property}</code><span className="lab-before">{change.before || "(empty)"}</span><Icon name="chevron" size={16} /><span className="lab-after">{change.after || "(empty)"}</span></div>)}
          </div> : <p className="lab-empty-state">現在のサーバー設定から変更はありません。</p>}
          <div className="lab-draft-actions">
            <button className="secondary-button" data-no-translate type="button" onClick={saveDraft}>{labText("saveDraft")}</button>
            <button className="secondary-button" data-no-translate type="button" onClick={restoreDraft}>{labText("restoreDraft")}</button>
            <button className="small-button" data-no-translate type="button" disabled={!changes.length} onClick={resetDraft}>{labText("resetDraft")}</button>
          </div>
          {savedDraftAt ? <small data-no-translate>{labText("savedDraft", { date: new Date(savedDraftAt).toLocaleString(locale) })}</small> : <small data-no-translate>{labText("draftHelp")}</small>}
        </article>

        <article className="server-lab-card lab-wide-card lab-patch-card">
          <div className="lab-card-heading"><span><small>FEATURE 14</small><strong>server.properties変更案</strong></span><button className="secondary-button" type="button" onClick={copyPatch}><Icon name="clipboard" size={17} />変更案をコピー</button></div>
          <pre data-no-translate>{patch}</pre>
          <small data-no-translate>{labText("patchHelp")}</small>
        </article>
      </div>

      <footer className="server-lab-footer">
        <div><span className="section-kicker">FEATURE 15 · SAFE APPLY</span><strong data-no-translate>{changes.length ? labText("applyCount", { count: changes.length }) : labText("noChanges")}</strong><small data-no-translate>{labText("backupBeforeApply")}</small></div>
        <button className="primary-button" type="button" disabled={!changes.length || status.state !== "stopped" || Boolean(busy) || !portInspection.valid} onClick={applyDraft}>{busy === "apply" ? "バックアップ・保存中…" : "バックアップして全変更を保存"}</button>
      </footer>
    </section>
    {busy === "apply" ? <OperationOverlay title="サーバーラボの設定を保存しています" detail="変更前バックアップ、値の検証、server.properties更新を順番に行っています。" stages={["バックアップ", "値の検証", "設定保存"]} /> : null}
  </div>;
}
