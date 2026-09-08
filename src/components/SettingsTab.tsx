import { useEffect, useState } from "react";
import { backend, confirmDanger } from "../lib/backend";
import { getMemoryOptions } from "../lib/memoryOptions";
import { getServerNetworkProtocol } from "../lib/serverEdition";
import type { BasicSettings, RuntimeStatus, ServerProfile } from "../types";
import { Icon } from "./Icon";
import { OperationOverlay } from "./OperationOverlay";
import { ServerIcon } from "./ServerIcon";
import { prepareServerIcon, ServerIconError } from "../lib/serverIcons";
import { useI18n } from "../lib/i18n";

const javaToggleFields: { key: keyof BasicSettings; label: string; property: string; note?: string; danger?: boolean }[] = [
  { key: "whitelist", label: "ホワイトリスト", property: "white-list", note: "公開サーバーでは有効を推奨" },
  { key: "onlineMode", label: "公式アカウント認証", property: "online-mode", note: "無効時はインターネット公開不可", danger: true },
  { key: "allowFlight", label: "飛行を許可", property: "allow-flight", note: "飛行Mod利用時の誤検出を防止" },
  { key: "forceGameMode", label: "ゲームモードを強制", property: "force-gamemode", note: "参加時に既定モードへ戻す" },
  { key: "requireResourcePack", label: "リソースパックを必須にする", property: "require-resource-pack", note: "拒否したプレイヤーは参加不可" },
  { key: "pvp", label: "PvP", property: "pvp" },
  { key: "allowCommands", label: "コマンドブロック", property: "enable-command-block" },
  { key: "spawnMonsters", label: "モンスター出現", property: "spawn-monsters" },
  { key: "spawnAnimals", label: "動物出現", property: "spawn-animals" },
];

const bedrockToggleFields: { key: keyof BasicSettings; label: string; property: string; note?: string; danger?: boolean }[] = [
  { key: "whitelist", label: "許可リスト", property: "allow-list", note: "インターネット公開では有効を推奨" },
  { key: "onlineMode", label: "Xboxアカウント認証", property: "online-mode", note: "無効時は安全な公開を利用不可", danger: true },
  { key: "forceGameMode", label: "ゲームモードを強制", property: "force-gamemode", note: "参加時に既定モードへ戻す" },
  { key: "requireResourcePack", label: "リソースパックを必須にする", property: "texturepack-required", note: "拒否したプレイヤーは参加不可" },
  { key: "pvp", label: "PvP", property: "pvp" },
  { key: "allowCommands", label: "チートを許可", property: "allow-cheats", note: "コマンド利用を許可します" },
  { key: "enableLanVisibility", label: "LANへサーバーを表示", property: "enable-lan-visibility", note: "同じ家の端末から見つけやすくします" },
];

export function SettingsTab({ server, serverIcon, onServerIconChanged, status, onUpdated, notify, fail }: { server: ServerProfile; serverIcon?: string; onServerIconChanged: (serverId: string, dataUrl?: string) => void; status: RuntimeStatus; onUpdated: (server: ServerProfile) => void; notify: (message: string) => void; fail: (message: string) => void }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<BasicSettings>(server.settings);
  const [memory, setMemory] = useState(server.maxMemoryMib);
  const [memoryTotalMib, setMemoryTotalMib] = useState<number>();
  const [port, setPort] = useState(server.port);
  const [saving, setSaving] = useState(false);
  const [choosingPort, setChoosingPort] = useState(false);
  const [maintenance, setMaintenance] = useState<"" | "optimize" | "regenerate">("");
  const [worldConfirmation, setWorldConfirmation] = useState("");
  const [iconBusy, setIconBusy] = useState(false);
  const isBedrock = server.serverType === "bedrock";
  const toggleFields = isBedrock ? bedrockToggleFields : javaToggleFields;
  useEffect(() => { setSettings(server.settings); setMemory(server.maxMemoryMib); setPort(server.port); }, [server]);
  useEffect(() => { setWorldConfirmation(""); }, [server.id]);
  useEffect(() => {
    if (isBedrock) { setMemoryTotalMib(undefined); return; }
    let active = true;
    backend.diagnose(server.id)
      .then((result) => { if (active) setMemoryTotalMib(result.memoryTotalMib); })
      .catch(() => { if (active) setMemoryTotalMib(undefined); });
    return () => { active = false; };
  }, [server.id, isBedrock]);
  const memoryOptions = getMemoryOptions(memoryTotalMib, memory);
  const changeServerIcon = async (file?: File) => {
    if (!file) return;
    setIconBusy(true);
    try {
      onServerIconChanged(server.id, await prepareServerIcon(file));
      notify(t("serverIconSaved"));
    } catch (reason) {
      if (reason instanceof ServerIconError) {
        fail(t(reason.code === "type" ? "serverIconTypeError" : reason.code === "size" ? "serverIconSizeError" : reason.code === "decode" ? "serverIconDecodeError" : "serverIconStorageError"));
      } else {
        fail(String(reason));
      }
    } finally {
      setIconBusy(false);
    }
  };
  const resetServerIcon = () => {
    try {
      onServerIconChanged(server.id, undefined);
      notify(t("serverIconReset"));
    } catch {
      fail(t("serverIconStorageError"));
    }
  };
  const patch = <K extends keyof BasicSettings>(key: K, value: BasicSettings[K]) => setSettings((current) => ({ ...current, [key]: value }));
  const save = async () => {
    if (!settings.onlineMode && !await confirmDanger(`${isBedrock ? "Xbox" : "公式"}アカウント認証を無効にしますか？\n\nプレイヤー名のなりすましを防げなくなるため、Minecraft Server Hubからのインターネット公開は利用できなくなります。`)) return;
    setSaving(true);
    try { const updated = await backend.updateSettings(server.id, settings, memory, port); onUpdated(updated); notify("安全バックアップ後に設定を保存しました。再起動すると反映されます"); }
    catch (reason) { fail(String(reason)); } finally { setSaving(false); }
  };
  const chooseAvailablePort = async () => {
    setChoosingPort(true);
    try {
      const nextPort = await backend.suggestServerPort(port, getServerNetworkProtocol(server.serverType));
      setPort(nextPort);
      notify(`空きポート ${nextPort} を選びました。保存すると反映されます`);
    } catch (reason) { fail(String(reason)); } finally { setChoosingPort(false); }
  };
  const optimizeWorldLoad = async () => {
    const optimized = {
      ...settings,
      viewDistance: Math.min(settings.viewDistance, 6),
      simulationDistance: Math.min(settings.simulationDistance, 4),
    };
    if (optimized.viewDistance === settings.viewDistance && optimized.simulationDistance === settings.simulationDistance) {
      notify("すでに軽量設定です。ワールドデータや建築物は変更していません");
      return;
    }
    if (!await confirmDanger(`「${server.name}」のワールド負荷を軽くしますか？\n\n描画距離を最大6、シミュレーション距離を最大4へ下げます。ワールド、建築物、プレイヤーデータは削除しません。変更前にバックアップを作成します。`)) return;
    setMaintenance("optimize");
    try {
      const updated = await backend.updateSettings(server.id, optimized, memory, port);
      setSettings(updated.settings);
      onUpdated(updated);
      notify("バックアップ後にワールドの軽量設定を反映しました。再起動すると有効になります");
    } catch (reason) { fail(String(reason)); } finally { setMaintenance(""); }
  };
  const regenerateWorld = async () => {
    if (!await confirmDanger(`「${server.name}」の現在のワールドを再生成しますか？\n\n現在のワールドは必須バックアップへ保存した後に取り外します。次回起動時に、画面上のワールドタイプとシードで新しいワールドを生成します。`)) return;
    setMaintenance("regenerate");
    try {
      const result = await backend.regenerateWorld({ serverId: server.id, confirmationName: worldConfirmation, settings, maxMemoryMib: memory, port });
      setSettings(result.server.settings);
      setWorldConfirmation("");
      onUpdated(result.server);
      notify(`再生成の準備ができました。次回起動時に新しいワールドを作ります。バックアップ: ${result.backup.id}`);
    } catch (reason) { fail(String(reason)); } finally { setMaintenance(""); }
  };
  return <div className="tab-content settings-content">
    <section className="feature-panel settings-panel">
      <header><div><span className="section-kicker">SERVER.PROPERTIES · {isBedrock ? "BEDROCK" : "JAVA"}</span><h2>サーバー設定</h2></div><span className="restart-badge"><Icon name="refresh" size={16} />再起動が必要</span></header>
      <div className="server-icon-settings">
        <ServerIcon source={serverIcon} className="server-icon-preview" alt={t("serverIcon")} />
        <div><strong>{t("serverIcon")}</strong><small>{t("serverIconIntro")}</small></div>
        <div className="server-icon-actions">
          <label className="secondary-button server-icon-picker"><Icon name="folder" size={17} />{iconBusy ? t("serverIconProcessing") : t("chooseImage")}<input aria-label={t("chooseImage")} type="file" accept="image/png,image/jpeg,image/webp" disabled={iconBusy} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void changeServerIcon(file); }} /></label>
          <button className="small-button" type="button" disabled={!serverIcon || iconBusy} onClick={resetServerIcon}>{t("restoreDefaultIcon")}</button>
        </div>
      </div>
      <div className="settings-warning"><Icon name="info" /><span><strong>保存前にバックアップを自動作成します</strong><small>既存の未知の server.properties 項目は保持し、変更履歴も残します。</small></span></div>
      {status.state !== "stopped" ? <p className="inline-warning"><Icon name="info" size={17} />設定変更前にサーバーを安全停止してください。</p> : null}

      <div className="property-section-heading"><div><span className="section-kicker">基本設定</span><h3>遊び方と負荷</h3></div><small>初心者向けの安全な範囲に制限しています</small></div>
      <div className="settings-grid properties-basic-grid">
        <label><span>初期ゲームモード</span><select value={settings.defaultGameMode} onChange={(e) => patch("defaultGameMode", e.target.value as BasicSettings["defaultGameMode"])}><option value="survival">サバイバル</option><option value="creative">クリエイティブ</option><option value="adventure">アドベンチャー</option><option value="spectator">スペクテイター</option></select><small>gamemode</small></label>
        <label><span>難易度</span><select value={settings.difficulty} onChange={(e) => patch("difficulty", e.target.value as BasicSettings["difficulty"])}><option value="peaceful">ピースフル</option><option value="easy">イージー</option><option value="normal">ノーマル</option><option value="hard">ハード</option></select><small>difficulty</small></label>
        <label><span>最大プレイヤー数</span><input type="number" min={1} max={500} value={settings.maxPlayers} onChange={(e) => patch("maxPlayers", Number(e.target.value))} /><small>max-players</small></label>
        {!isBedrock ? <label><span>スポーン保護範囲</span><input type="number" min={0} max={256} value={settings.spawnProtection} onChange={(e) => patch("spawnProtection", Number(e.target.value))} /><small>spawn-protection · 0で無効</small></label> : null}
        {!isBedrock ? <label><span>最大メモリ</span><select aria-label="最大メモリ" value={memory} onChange={(e) => setMemory(Number(e.target.value))}>{memoryOptions.map((value) => <option key={value} value={value}>{value / 1024} GiB</option>)}</select><small>{memoryTotalMib ? `このPC（合計約${Math.round(memoryTotalMib / 1024)} GiB）に合わせたJava起動設定` : "1〜16 GiBから選べるJava起動設定"}</small></label> : <div className="bedrock-memory-note"><span>メモリ管理</span><strong>WindowsとBDSが自動管理</strong><small>使用量は概要画面でリアルタイム監視します</small></div>}
        <label><span>ポート（{isBedrock ? "UDP" : "TCP"}）</span><div className="input-action"><input aria-label="サーバーポート" type="number" min={1024} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value))} /><button className="secondary-button" type="button" onClick={chooseAvailablePort} disabled={choosingPort || status.state !== "stopped"}>{choosingPort ? "確認中…" : "空きを選ぶ"}</button></div><small>server-port · 登録済みサーバーと使用中ポートを避けます</small></label>
        <label><span>描画距離</span><input type="number" min={2} max={32} value={settings.viewDistance} onChange={(e) => patch("viewDistance", Number(e.target.value))} /><small>view-distance</small></label>
        <label><span>{isBedrock ? "ティック距離" : "シミュレーション距離"}</span><input type="number" min={isBedrock ? 4 : 2} max={isBedrock ? 12 : 32} value={settings.simulationDistance} onChange={(e) => patch("simulationDistance", Number(e.target.value))} /><small>{isBedrock ? "tick-distance · 4〜12" : "simulation-distance"}</small></label>
        {isBedrock ? <label><span>既定のプレイヤー権限</span><select value={settings.defaultPlayerPermissionLevel ?? "member"} onChange={(event) => patch("defaultPlayerPermissionLevel", event.target.value as NonNullable<BasicSettings["defaultPlayerPermissionLevel"]>)}><option value="visitor">ビジター</option><option value="member">メンバー</option><option value="operator">オペレーター</option></select><small>default-player-permission-level</small></label> : null}
        {isBedrock ? <label><span>IPv6ポート（UDP）</span><input type="number" min={1024} max={65535} value={settings.serverPortV6 ?? 19133} onChange={(event) => patch("serverPortV6", Number(event.target.value))} /><small>server-portv6</small></label> : null}
      </div>

      <div className="property-section-heading"><div><span className="section-kicker">WORLD GENERATION</span><h3>ワールド生成</h3></div><small>生成済みチャンクは変更されません</small></div>
      <div className="settings-grid properties-basic-grid">
        <label><span>ワールドタイプ</span><select aria-label="ワールドタイプ" value={settings.worldType ?? (isBedrock ? "DEFAULT" : "minecraft:normal")} onChange={(event) => patch("worldType", event.target.value as BasicSettings["worldType"])}>{isBedrock ? <><option value="DEFAULT">デフォルト</option><option value="FLAT">フラット</option><option value="LEGACY">レガシー</option></> : <><option value="minecraft:normal">デフォルト</option><option value="minecraft:flat">スーパーフラット</option><option value="minecraft:large_biomes">大きなバイオーム</option><option value="minecraft:amplified">アンプリファイド</option></>}</select><small>level-type</small></label>
        <label><span>ワールド生成のシード値</span><input aria-label="ワールド生成のシード値" maxLength={128} value={settings.worldSeed ?? ""} placeholder="空白でランダム" onChange={(event) => patch("worldSeed", event.target.value)} /><small>level-seed</small></label>
      </div>
      {!isBedrock ? <div className="property-toggle-grid world-generation-toggles">
        <label><span><strong>村や要塞などを生成</strong><small>generate-structures=<b>{String(settings.generateStructures ?? true)}</b></small><em>オフにしても生成済みの構造物は消えません</em></span><input type="checkbox" checked={settings.generateStructures ?? true} onChange={(event) => patch("generateStructures", event.target.checked)} /><i aria-hidden="true" /></label>
        <label className={settings.hardcore ? "danger" : ""}><span><strong>ハードコア</strong><small>hardcore=<b>{String(settings.hardcore ?? false)}</b></small><em>オン時は難易度ハード・サバイバルに揃えます</em></span><input type="checkbox" checked={settings.hardcore ?? false} onChange={(event) => setSettings((current) => ({ ...current, hardcore: event.target.checked, ...(event.target.checked ? { difficulty: "hard", defaultGameMode: "survival" } : {}) }))} /><i aria-hidden="true" /></label>
      </div> : null}
      <p className="field-help">タイプやシードの変更は主にこれから生成されるチャンクへ影響します。既存ワールドでは境界が不自然になる場合があるため、保存前バックアップから戻せる状態で変更してください。</p>

      <div className="world-maintenance-grid">
        <article>
          <div className="world-maintenance-title"><Icon name="check" size={19} /><span><strong>ワールドの負荷を軽くする</strong><small>建築物やチャンクは削除しません</small></span></div>
          <p>描画距離を最大6、{isBedrock ? "ティック距離" : "シミュレーション距離"}を最大4にして、チャンク処理の負荷を減らします。ワールドのファイル容量は変わりません。</p>
          <button className="secondary-button" type="button" disabled={status.state !== "stopped" || Boolean(maintenance) || saving} onClick={optimizeWorldLoad}>{maintenance === "optimize" ? "バックアップ・最適化中…" : "バックアップして軽量化"}</button>
        </article>
        <article className="world-regeneration-card">
          <div className="world-maintenance-title"><Icon name="refresh" size={19} /><span><strong>ワールドを最初から作り直す</strong><small>次回起動時に新規生成</small></span></div>
          <p>現在のワールドをバックアップ後に取り外します。戻したい場合は安全ツールのバックアップ一覧から復元できます。</p>
          <label><span>確認のためサーバー名「{server.name}」を入力</span><input aria-label="ワールド再生成確認用サーバー名" value={worldConfirmation} onChange={(event) => setWorldConfirmation(event.target.value)} /></label>
          <button className="danger-button" type="button" disabled={status.state !== "stopped" || Boolean(maintenance) || saving || worldConfirmation !== server.name} onClick={regenerateWorld}>{maintenance === "regenerate" ? "バックアップ・再生成準備中…" : "バックアップしてワールドを再生成"}</button>
          {status.state !== "stopped" ? <small className="maintenance-stop-note">再生成するにはサーバーを安全停止してください。</small> : null}
        </article>
      </div>

      <div className="property-section-heading"><div><span className="section-kicker">ルールと安全</span><h3>オン・オフ設定</h3></div><small>設定名と実際のpropertiesキーを併記</small></div>
      <div className="property-toggle-grid">
        {toggleFields.map((field) => <label className={field.danger && !settings[field.key] ? "danger" : ""} key={field.key}>
          <span><strong>{field.label}</strong><small>{field.property}=<b>{String(Boolean(settings[field.key]))}</b></small>{field.note ? <em>{field.note}</em> : null}</span>
          <input type="checkbox" checked={Boolean(settings[field.key])} onChange={(event) => patch(field.key, event.target.checked as never)} />
          <i aria-hidden="true" />
        </label>)}
      </div>

      <div className="property-section-heading"><div><span className="section-kicker">RESOURCE PACK</span><h3>リソースパック</h3></div><small>配布元と利用条件を確認して設定してください</small></div>
      {!isBedrock ? <div className="resource-pack-settings">
        <label><span>ダウンロードURL</span><input type="url" value={settings.resourcePackUrl} onChange={(event) => patch("resourcePackUrl", event.target.value)} placeholder="https://example.com/server-pack.zip" /><small>resource-pack · http/httpsのみ</small></label>
        <label><span>参加時の案内</span><input value={settings.resourcePackPrompt} maxLength={160} onChange={(event) => patch("resourcePackPrompt", event.target.value)} placeholder="このサーバー専用のリソースパックを使用します" /><small>resource-pack-prompt · 160文字まで</small></label>
      </div> : <div className="bedrock-resource-pack-note"><Icon name="plugin" size={24} /><div><strong>統合版のリソースパックは「拡張機能」で管理します</strong><p>Behavior Pack／Resource Pack／.mcpack／.mcaddonを、manifest検証と変更前バックアップ付きで追加できます。</p></div></div>}
      {!isBedrock && settings.requireResourcePack && !settings.resourcePackUrl.trim() ? <p className="inline-warning"><Icon name="info" size={17} />必須にする場合はリソースパックURLを入力してください。</p> : null}
      {!settings.onlineMode ? <p className="danger-setting-note"><Icon name="info" size={17} />認証が無効です。なりすまし防止のため、アプリのインターネット公開ボタンは利用できません。</p> : null}
      <footer><button className="primary-button" type="button" onClick={save} disabled={saving || Boolean(maintenance) || status.state !== "stopped" || (!isBedrock && settings.requireResourcePack && !settings.resourcePackUrl.trim())}>{saving ? "保存中…" : "バックアップして設定を保存"}</button></footer>
    </section>
    {saving || maintenance ? <OperationOverlay title={maintenance === "regenerate" ? "ワールド再生成の準備中です" : maintenance === "optimize" ? "ワールドを軽量設定にしています" : "設定を安全に保存しています"} detail="変更前バックアップを作成し、内容を確認してから設定へ反映しています。" stages={["バックアップ", "安全確認", "設定反映"]} /> : null}
  </div>;
}
