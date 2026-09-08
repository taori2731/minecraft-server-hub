import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { backend, confirmDanger, selectExtensionFile } from "../lib/backend";
import { useI18n, type AppLocale } from "../lib/i18n";
import { translateGeneratedText } from "../lib/documentTranslation";
import type {
  CrossplayInstallResult,
  CrossplayPlan,
  ExtensionInfo,
  ExtensionInstallPlan,
  ExtensionKind,
  ExtensionSearchHit,
  ExtensionVersionOption,
  RuntimeStatus,
  ServerProfile,
} from "../types";
import { Icon } from "./Icon";
import { OperationOverlay } from "./OperationOverlay";

const kindLabel: Record<ExtensionKind, string> = { mod: "Mod", plugin: "プラグイン", datapack: "データパック", behavior_pack: "Behavior Pack", resource_pack: "Resource Pack", addon: "アドオン" };
const releaseLabel: Record<string, string> = { release: "安定版", beta: "ベータ", alpha: "アルファ" };

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`;
}

function formatDownloads(value: number, locale: AppLocale) {
  return new Intl.NumberFormat(locale, { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
}

function formatDate(value: string, locale: AppLocale) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? value : parsed.toLocaleDateString(locale);
}

export function ExtensionsTab({ server, status, notify, fail }: { server: ServerProfile; status: RuntimeStatus; notify: (message: string) => void; fail: (message: string) => void }) {
  const { locale } = useI18n();
  const localized = (value: string) => translateGeneratedText(value, locale);
  const isBedrock = server.serverType === "bedrock";
  const kinds = useMemo<ExtensionKind[]>(() => isBedrock ? ["addon", "behavior_pack", "resource_pack"] : server.serverType === "paper" ? ["plugin", "datapack"] : ["fabric", "forge", "neoforge"].includes(server.serverType) ? ["mod", "datapack"] : ["datapack"], [server.serverType, isBedrock]);
  const [kind, setKind] = useState<ExtensionKind>(kinds[0]);
  const [installed, setInstalled] = useState<ExtensionInfo[]>([]);
  const [results, setResults] = useState<ExtensionSearchHit[]>([]);
  const [selected, setSelected] = useState<ExtensionSearchHit>();
  const [versions, setVersions] = useState<ExtensionVersionOption[]>([]);
  const [plan, setPlan] = useState<ExtensionInstallPlan>();
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [busy, setBusy] = useState("");
  const [crossplayPort, setCrossplayPort] = useState(19132);
  const [crossplayPlan, setCrossplayPlan] = useState<CrossplayPlan>();
  const [crossplayResult, setCrossplayResult] = useState<CrossplayInstallResult>();
  const [includeFloodgate, setIncludeFloodgate] = useState(true);
  const [acceptCrossplayWarnings, setAcceptCrossplayWarnings] = useState(false);
  const stopped = status.state === "stopped";
  const refresh = () => backend.listExtensions(server.id).then(setInstalled).catch((reason) => fail(String(reason)));

  useEffect(() => {
    setKind(kinds[0]);
    setResults([]);
    setSelected(undefined);
    setVersions([]);
    setPlan(undefined);
    setCrossplayPort(19132);
    setCrossplayPlan(undefined);
    setCrossplayResult(undefined);
    setIncludeFloodgate(true);
    setAcceptCrossplayWarnings(false);
    refresh();
  }, [server.id, kinds.join(",")]);

  useEffect(() => {
    if (!kinds.includes(kind) || isBedrock) return;
    let active = true;
    setCatalogLoading(true);
    setCatalogError("");
    setResults([]);
    setSelected(undefined);
    setVersions([]);
    setPlan(undefined);
    backend.searchExtensions(server.id, "", kind)
      .then((items) => {
        if (!active) return;
        setResults(items);
        setActiveQuery("");
      })
      .catch((reason: unknown) => active && setCatalogError(String(reason)))
      .finally(() => active && setCatalogLoading(false));
    return () => { active = false; };
  }, [server.id, kind, kinds, isBedrock]);

  useLayoutEffect(() => {
    if (!plan) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && busy !== "install") setPlan(undefined);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [plan, busy]);

  const changeKind = (value: ExtensionKind) => {
    setKind(value);
    setQuery("");
    setResults([]);
    setSelected(undefined);
    setVersions([]);
    setPlan(undefined);
  };

  const search = async () => {
    const nextQuery = query.trim();
    setCatalogLoading(true);
    setCatalogError("");
    setSelected(undefined);
    setVersions([]);
    setPlan(undefined);
    try {
      setResults(await backend.searchExtensions(server.id, nextQuery, kind));
      setActiveQuery(nextQuery);
    }
    catch (reason) { setCatalogError(String(reason)); fail(String(reason)); } finally { setCatalogLoading(false); }
  };

  const openCrossplayCatalog = async (term: "Geyser" | "Floodgate") => {
    setKind("plugin");
    setQuery(term);
    setActiveQuery(term);
    setSelected(undefined);
    setVersions([]);
    setPlan(undefined);
    setCatalogLoading(true);
    setCatalogError("");
    try { setResults(await backend.searchExtensions(server.id, term, "plugin")); }
    catch (reason) { setCatalogError(String(reason)); fail(String(reason)); }
    finally { setCatalogLoading(false); }
  };

  const prepareCrossplay = async () => {
    setBusy("crossplay-plan");
    setCrossplayResult(undefined);
    setAcceptCrossplayWarnings(false);
    try { setCrossplayPlan(await backend.getCrossplayPlan(server.id, crossplayPort)); }
    catch (reason) { fail(String(reason)); }
    finally { setBusy(""); }
  };

  const installCrossplay = async () => {
    if (!crossplayPlan?.eligible) return;
    if (!stopped) { fail("クロスプレイ導入前にPaperサーバーを停止してください"); return; }
    if (!acceptCrossplayWarnings) { fail("導入後の設定確認と別のUDP公開先が必要なことを確認してください"); return; }
    const floodgateText = includeFloodgate ? "GeyserとFloodgate" : "Geyser";
    if (!await confirmDanger(`${floodgateText}を公式配布元から導入します。\n変更前にバックアップを作成します。続けますか？`)) return;
    setBusy("crossplay-install");
    try {
      const result = await backend.installCrossplay({ serverId: server.id, includeFloodgate, bedrockPort: crossplayPort, acceptWarnings: acceptCrossplayWarnings });
      setCrossplayResult(result);
      await refresh();
      notify(`${floodgateText}をバックアップ後に導入しました`);
    }
    catch (reason) { fail(String(reason)); }
    finally { setBusy(""); }
  };

  const openProject = async (item: ExtensionSearchHit) => {
    setSelected(item);
    setVersions([]);
    setPlan(undefined);
    setBusy(`versions:${item.projectId}`);
    try { setVersions(await backend.listExtensionVersions(server.id, item.projectId, kind)); }
    catch (reason) { fail(String(reason)); } finally { setBusy(""); }
  };

  const prepareInstall = async (version: ExtensionVersionOption) => {
    setSelectedVersionId(version.id);
    setBusy(`plan:${version.id}`);
    try { setPlan(await backend.planExtensionInstall(server.id, version.id, kind)); }
    catch (reason) { fail(String(reason)); } finally { setBusy(""); }
  };

  const installPlan = async () => {
    if (!plan || !selectedVersionId) return;
    if (!stopped) { fail("導入前にMinecraftサーバーを停止してください"); return; }
    const dependencyCount = plan.items.filter((item) => item.dependency).length;
    if (!await confirmDanger(`${plan.items[0]?.fileName ?? kindLabel[kind]} と必須依存 ${dependencyCount}件を導入します。\n変更前に安全バックアップを作成します。続けますか？`)) return;
    setBusy("install");
    try {
      const installedPlan = await backend.installCatalogExtension(server.id, selectedVersionId, kind);
      await refresh();
      setPlan(undefined);
      notify(`${kindLabel[kind]}と必須依存 ${installedPlan.items.length - 1}件をバックアップ後に導入しました`);
    } catch (reason) { fail(String(reason)); } finally { setBusy(""); }
  };

  const addFile = async (path?: string) => {
    if (!stopped) { fail("追加前にMinecraftサーバーを停止してください"); return; }
    try {
      let chosen = path;
      if (!chosen && isBedrock) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ multiple: false, title: `追加する${kindLabel[kind]}を選択`, filters: [{ name: "Minecraft Bedrock Add-on", extensions: ["mcaddon", "mcpack", "zip"] }] });
        chosen = typeof selected === "string" ? selected : undefined;
        if (!chosen) return;
      }
      if (!chosen && !isBedrock) chosen = (await selectExtensionFile(kind)) ?? undefined;
      if (!chosen) return;
      setBusy("install-local");
      await backend.installLocalExtension(server.id, chosen, kind);
      await refresh();
      notify(`${kindLabel[kind]}をバックアップ後に追加しました`);
    }
    catch (reason) { fail(String(reason)); } finally { setBusy(""); }
  };

  const toggle = async (item: ExtensionInfo) => {
    if (!stopped) { fail("有効／無効の変更前にMinecraftサーバーを停止してください"); return; }
    try { await backend.setExtensionEnabled(server.id, item.fileName, item.kind, !item.enabled); await refresh(); notify(item.enabled ? "拡張機能を無効化しました" : "拡張機能を有効化しました"); }
    catch (reason) { fail(String(reason)); }
  };

  const remove = async (item: ExtensionInfo) => {
    if (!stopped) { fail("削除前にMinecraftサーバーを停止してください"); return; }
    if (!await confirmDanger(`${item.fileName} を削除しますか？\n削除前に安全バックアップを作成します。`)) return;
    try { await backend.removeExtension(server.id, item.fileName, item.kind); await refresh(); notify("拡張機能を削除しました"); }
    catch (reason) { fail(String(reason)); }
  };

  const installOverlay = ["install", "install-local", "crossplay-install"].includes(busy)
    ? <OperationOverlay title={busy === "crossplay-install" ? "クロスプレイ機能を導入しています" : isBedrock ? "統合版アドオンを導入しています" : "拡張機能を導入しています"} detail="変更前バックアップを作成し、配布ファイルと互換性を検証してから反映しています。" stages={["バックアップ", "ファイル検証", "導入"]} />
    : null;

  if (isBedrock) return <><div className="tab-content extensions-content bedrock-extensions-content">
    <section className="feature-panel extension-browser bedrock-addon-browser">
      <header className="extension-browser-header">
        <div><span className="section-kicker">BEDROCK ADD-ONS · SAFE LOCAL INSTALL</span><h2>統合版アドオンを追加</h2><p>.mcaddon／.mcpack／ZIPを、manifest検証とバックアップ付きで追加します。</p></div>
        <div className="kind-tabs">{kinds.map((item) => <button type="button" className={kind === item ? "active" : ""} onClick={() => changeKind(item)} key={item}>{localized(kindLabel[item])}</button>)}</div>
      </header>
      <div className="bedrock-addon-intro">
        <div><Icon name="plugin" size={28} /><span><strong>{kindLabel[kind]}を選択</strong><small>公式Marketplaceからコンテンツを自動取得せず、利用権のある手元のファイルだけを追加します。</small></span></div>
        <button className="primary-button" type="button" onClick={() => addFile()} disabled={Boolean(busy) || !stopped}><Icon name="add" size={18} />ファイルから追加</button>
      </div>
      {!stopped ? <div className="catalog-stop-note"><Icon name="info" size={17} />manifestの確認はできますが、追加・削除・有効切替にはサーバー停止が必要です。</div> : null}
      <div className="drop-zone bedrock-drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0] as File & { path?: string }; if (file?.path) addFile(file.path); else fail("この環境ではドロップしたファイルの安全なパスを取得できません。『ファイルから追加』を使ってください。"); }}><Icon name="download" /><span>.mcaddon／.mcpack／ZIPを追加</span><small>パストラバーサル、manifest UUID・版、重複、依存関係を検証し、変更前にバックアップします</small></div>
      <div className="bedrock-addon-safety-grid">
        <article><Icon name="check" size={20} /><strong>manifest.jsonを検証</strong><p>UUID、version、modules、dependenciesを確認します。</p></article>
        <article><Icon name="check" size={20} /><strong>ワールド別に適用</strong><p>Behavior PackとResource Packを対象ワールドへ安全に関連付けます。</p></article>
        <article><Icon name="check" size={20} /><strong>いつでも戻せる</strong><p>追加・無効化・削除の直前にバックアップします。</p></article>
      </div>
      <p className="provider-note">Java版のMod／プラグイン、Minecraft Marketplaceの購入コンテンツはこの画面では導入しません。</p>
    </section>

    <section className="feature-panel installed-panel">
      <header><div><span className="section-kicker">INSTALLED · BEDROCK</span><h2>適用済みアドオン</h2><p>公式BDSに最初から含まれる内蔵パックは表示せず、追加・適用したパックだけを表示します。</p></div><span>{installed.length}件</span></header>
      <div className="installed-list">{installed.map((item) => <div key={`${item.kind}-${item.fileName}`}><span className={`extension-state ${item.enabled ? "enabled" : ""}`}><Icon name="plugin" /></span><div><strong>{item.fileName}</strong><small>{kindLabel[item.kind]} · {formatSize(item.sizeBytes)}{item.manageable ? " · アプリ管理" : " · 外部追加（参照のみ）"}</small><p>{item.compatibility}</p><em>{item.clientRequirement}</em></div>{item.manageable ? <><button className="small-button" type="button" disabled={!stopped} onClick={() => toggle(item)}>{item.enabled ? "無効化" : "有効化"}</button><button className="icon-button danger-icon" type="button" disabled={!stopped} onClick={() => remove(item)} aria-label={`${item.fileName}を削除`}><Icon name="trash" size={18} /></button></> : <span className="status-pill">保護中</span>}</div>)}{installed.length === 0 ? <div className="panel-empty compact"><p>追加・適用済みの統合版アドオンはありません。公式BDS同梱パックは安全のため一覧から除外しています。</p></div> : null}</div>
    </section>

    <section className="feature-panel crossplay-guide-panel">
      <header><div><span className="section-kicker">OPTIONAL CROSSPLAY</span><h2>Java版の友達とも遊びたい場合</h2></div><span className="status-pill">別サーバー構成</span></header>
      <p>ネイティブBDSへJava版クライアントは直接参加できません。クロスプレイはPaperサーバーへGeyserを導入し、統合版アカウントだけで参加させる場合はFloodgateも任意で追加します。</p>
      <div className="crossplay-path"><span>Java版・Paper</span><Icon name="chevron" size={17} /><span>Geyser</span><Icon name="chevron" size={17} /><span>統合版から参加</span></div>
      <div className="official-links"><a href="https://geysermc.org/wiki/geyser/setup/" target="_blank" rel="noreferrer">Geyser公式セットアップ</a><a href="https://geysermc.org/wiki/floodgate/setup/" target="_blank" rel="noreferrer">Floodgate公式セットアップ</a></div>
      <p className="privacy-note">このBDSをPaperへ自動変換したり、既存ワールドを上書きしたりはしません。クロスプレイ用は別サーバーとして作成します。</p>
    </section>
  </div>{installOverlay}</>;

  return <><div className="tab-content extensions-content">
    <section className="feature-panel extension-browser">
      <header className="extension-browser-header">
        <div><span className="section-kicker">SAFE CATALOG</span><h2>{localized(`${kindLabel[kind]}を探して導入`)}</h2><p>{localized(`${server.minecraftVersion} / ${server.serverType} に合う項目だけを表示します`)}</p></div>
        <div className="kind-tabs">{kinds.map((item) => <button type="button" className={kind === item ? "active" : ""} onClick={() => changeKind(item)} key={item}>{localized(kindLabel[item])}</button>)}</div>
      </header>

      <p className="catalog-provider-note"><span data-no-translate="true">Modrinth</span> · {localized("公式API／CDNから対応版を確認します。")}</p>

      <div className="extension-search"><label className="search-field"><Icon name="search" size={18} /><input aria-label={localized(`${kindLabel[kind]}を検索`)} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") search(); }} placeholder={localized("カタログで拡張機能を検索")} /></label><button className="primary-button" type="button" onClick={search} disabled={catalogLoading || Boolean(busy)}>{catalogLoading ? localized("読込中…") : query.trim() ? localized("検索") : localized("人気順")}</button><button className="secondary-button" type="button" onClick={() => addFile()} disabled={Boolean(busy) || !stopped}><Icon name="add" size={18} />{localized("ファイルから追加")}</button></div>
        {!stopped ? <div className="catalog-stop-note"><Icon name="info" size={17} />検索と確認はできます。導入・削除・有効切替にはサーバー停止が必要です。</div> : null}
        <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0] as File & { path?: string }; if (file?.path) addFile(file.path); else fail("この環境ではドロップしたファイルの安全なパスを取得できません。『ファイルから追加』を使ってください。"); }}><Icon name="download" /><span>{localized("手元のJAR／ZIPを追加")}</span><small>{localized("種類確認と変更前バックアップを行います")}</small></div>

        {!selected ? <><div className="catalog-results-heading"><div><span className="section-kicker">{activeQuery ? "SEARCH RESULTS" : "POPULAR ON MODRINTH"}</span><h3>{localized(activeQuery ? `「${activeQuery}」の検索結果` : `人気の${kindLabel[kind]}`)}</h3></div><small>{localized(activeQuery ? `${results.length}件` : `${server.minecraftVersion} / ${server.serverType} 対応 · ダウンロード数順`)}</small></div>
        {catalogLoading ? <div className="catalog-loading"><span className="spinner" />{localized(activeQuery ? "検索しています" : `人気の${kindLabel[kind]}を読み込んでいます`)}</div> : null}
        {catalogError ? <div className="catalog-error" role="alert"><Icon name="info" size={17} /><span><strong>{localized("Modrinthから一覧を取得できませんでした")}</strong><small>{catalogError}</small></span><button className="small-button" type="button" onClick={search}>{localized("再試行")}</button></div> : null}
        {!catalogLoading && !catalogError ? <div className="catalog-grid">{results.map((item) => <button type="button" className="catalog-card" key={item.projectId} onClick={() => openProject(item)}>
          {item.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <span className="result-icon"><Icon name="plugin" /></span>}
          <span><strong>{item.title}</strong><small>{item.author}</small><p>{item.description}</p><em><b>{formatDownloads(item.downloads, locale)}</b> downloads</em></span><Icon name="chevron" size={18} />
        </button>)}{results.length === 0 ? <div className="panel-empty compact"><p>{localized(`このサーバー構成に合う${kindLabel[kind]}は見つかりませんでした。`)}</p></div> : null}</div> : null}</> : <div className="catalog-detail">
          <button className="catalog-back" type="button" onClick={() => { setSelected(undefined); setVersions([]); setPlan(undefined); }}><Icon name="chevron" size={16} />検索結果へ戻る</button>
           <div className="catalog-project-heading">{selected.iconUrl ? <img src={selected.iconUrl} alt="" /> : <span className="result-icon"><Icon name="plugin" /></span>}<div><span className="section-kicker">MODRINTH</span><h3>{selected.title}</h3><p>{selected.description}</p><small>{selected.author} · {formatDownloads(selected.downloads, locale)} downloads</small></div><a className="small-button" href={selected.sourceUrl || `https://modrinth.com/project/${selected.projectId}`} target="_blank" rel="noreferrer">{localized("配布元")}</a></div>
          <div className="version-heading"><h4>対応バージョン</h4><span>{server.minecraftVersion} / {server.serverType}</span></div>
          {busy.startsWith("versions:") ? <div className="catalog-loading"><span className="spinner" />対応ファイルを確認しています</div> : <div className="version-list">{versions.map((version) => <article key={version.id}><div><strong>{version.fileName}</strong><span><b className={`release-channel ${version.releaseChannel}`}>{releaseLabel[version.releaseChannel] ?? version.releaseChannel}</b>{version.versionNumber}</span><small>{formatDate(version.publishedAt, locale)} · {formatSize(version.sizeBytes)} · 必須依存 {version.requiredDependencyCount}件</small><em>{version.clientRequirement}</em></div><button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => prepareInstall(version)}>{busy === `plan:${version.id}` ? "確認中…" : "導入内容を確認"}</button></article>)}{versions.length === 0 ? <div className="panel-empty compact"><p>このサーバー構成に一致するバージョンはありません。</p></div> : null}</div>}
        </div>}
      {plan ? createPortal(<div className="catalog-plan-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && busy !== "install") setPlan(undefined); }}>
      <div className="catalog-plan" role="dialog" aria-modal="true" aria-label="導入内容の確認">
        <header><div><span className="section-kicker">INSTALL PLAN</span><h3>導入内容の確認</h3></div><button className="icon-button" type="button" aria-label="導入確認を閉じる" onClick={() => setPlan(undefined)}><Icon name="close" /></button></header>
        <div className="plan-summary"><div><span>対象</span><strong>{plan.minecraftVersion} / {plan.loader}</strong></div><div><span>ファイル</span><strong>{plan.items.length}件</strong></div><div><span>合計</span><strong>{formatSize(plan.totalSizeBytes)}</strong></div></div>
        <div className="catalog-plan-files">{plan.items.map((item) => <div key={item.versionId}><span className={item.dependency ? "dependency" : "main"}>{item.dependency ? "必須依存" : "選択項目"}</span><strong>{item.fileName}</strong><small>{item.versionNumber} · {formatSize(item.sizeBytes)}</small></div>)}</div>
        <p className="client-requirement"><Icon name="users" size={18} />{plan.clientRequirement}</p>
        {plan.warnings.map((warning) => <p className="inline-warning" key={warning}><Icon name="info" size={16} />{warning}</p>)}
         <footer><p>{localized("全ファイルをSHA-512／SHA-1で検証し、変更直前にバックアップします。失敗時はサーバーフォルダーへ反映しません。")}</p><button className="primary-button" type="button" disabled={!stopped || busy === "install"} onClick={installPlan}>{busy === "install" ? localized("検証して導入中…") : stopped ? localized("バックアップして導入") : localized("サーバー停止後に導入")}</button></footer>
      </div></div>, document.querySelector(".app") ?? document.body) : null}

      <p className="provider-note">{localized("検索・対応版・ダウンロードは公式Modrinth API／CDNだけを使用します。")}</p>
    </section>

    <section className="feature-panel installed-panel">
      <header><div><span className="section-kicker">INSTALLED</span><h2>インストール済み</h2></div><span>{installed.length}件</span></header>
      <div className="installed-list">{installed.map((item) => <div key={`${item.kind}-${item.fileName}`}><span className={`extension-state ${item.enabled ? "enabled" : ""}`}><Icon name="plugin" /></span><div><strong>{item.fileName}</strong><small>{kindLabel[item.kind]} · {formatSize(item.sizeBytes)}</small><p>{item.compatibility}</p><em>{item.clientRequirement}</em></div>{item.manageable ? <><button className="small-button" type="button" disabled={!stopped} onClick={() => toggle(item)}>{item.enabled ? "無効化" : "有効化"}</button><button className="icon-button danger-icon" type="button" disabled={!stopped} onClick={() => remove(item)} aria-label={`${item.fileName}を削除`}><Icon name="trash" size={18} /></button></> : <span className="status-pill">{localized("保護中")}</span>}</div>)}{installed.length === 0 ? <div className="panel-empty compact"><p>{localized(`追加済みの${kindLabel[kind]}はありません。`)}</p></div> : null}</div>
    </section>
    {server.serverType === "paper" ? <section className="feature-panel crossplay-guide-panel crossplay-install-panel">
      <header><div><span className="section-kicker">OPTIONAL CROSSPLAY · OFFICIAL RELEASES</span><h2>統合版の友達も参加できるようにする</h2></div><span className="status-pill">Geyser</span></header>
      <p>GeyserをPaperへ追加すると、Java版サーバーへ統合版クライアントも接続できます。Floodgateは、統合版プレイヤーがJavaアカウントを持たずに参加する場合だけ任意で使います。</p>
      <div className="crossplay-path"><span>Paper</span><Icon name="chevron" size={17} /><span>Geyser</span><Icon name="chevron" size={17} /><span>Java版＋統合版</span></div>
      <div className="crossplay-config-row">
        <label><span>Geyserで使用予定のUDPポート</span><input type="number" min={1024} max={65535} value={crossplayPort} onChange={(event) => { setCrossplayPort(Number(event.target.value)); setCrossplayPlan(undefined); setCrossplayResult(undefined); }} /><small>まだ待受・公開されません</small></label>
        <label className="confirm-check"><input type="checkbox" checked={includeFloodgate} onChange={(event) => setIncludeFloodgate(event.target.checked)} />Floodgateも導入する（Javaアカウント不要）</label>
        <button className="primary-button" type="button" disabled={Boolean(busy) || crossplayPort < 1024 || crossplayPort > 65535} onClick={prepareCrossplay}><Icon name="search" size={17} />{busy === "crossplay-plan" ? "公式配布情報を確認中…" : "公式導入内容を確認"}</button>
      </div>
      <p className="crossplay-port-note"><Icon name="info" size={16}/>この値は導入候補です。導入しただけではUDPポートは有効になりません。Paper再起動後に生成されるGeyserの <code>config.yml</code> で確認・設定してください。</p>
      {crossplayPlan ? <div className="crossplay-plan">
        <p className={crossplayPlan.eligible ? "diagnosis-ok" : "inline-warning"}><Icon name={crossplayPlan.eligible ? "check" : "info"} size={17}/>{crossplayPlan.eligible ? "このPaperサーバーへ安全に導入できます" : "現在の構成には自動導入できません"}</p>
        <div className="crossplay-components">
          {crossplayPlan.geyser ? <article><span className="section-kicker">必須</span><strong>Geyser {crossplayPlan.geyser.version}</strong><small>{crossplayPlan.geyser.fileName} · build {crossplayPlan.geyser.build}</small><small>{crossplayPlan.geyser.installed ? "導入済み・更新確認対象" : "公式配布ファイルをSHA-256検証"}</small></article> : null}
          {includeFloodgate && crossplayPlan.floodgate ? <article><span className="section-kicker">任意</span><strong>Floodgate {crossplayPlan.floodgate.version}</strong><small>{crossplayPlan.floodgate.fileName} · build {crossplayPlan.floodgate.build}</small><small>{crossplayPlan.floodgate.installed ? "導入済み・更新確認対象" : "公式配布ファイルをSHA-256検証"}</small></article> : null}
        </div>
        {crossplayPlan.warnings.map((warning) => <p className="inline-warning" key={warning}><Icon name="info" size={16}/>{warning}</p>)}
        {crossplayPlan.nextSteps.length ? <ol className="safe-step-list">{crossplayPlan.nextSteps.map((step) => <li key={step}>{step}</li>)}</ol> : null}
        <label className="confirm-check"><input type="checkbox" checked={acceptCrossplayWarnings} onChange={(event) => setAcceptCrossplayWarnings(event.target.checked)} />警告の有無にかかわらず、バックアップ後もGeyser設定の確認と、別のMinecraft Bedrock UDP公開先が必要なことを理解しました</label>
        <button className="primary-button" type="button" disabled={Boolean(busy) || !stopped || !crossplayPlan.eligible || !acceptCrossplayWarnings} onClick={installCrossplay}><Icon name="download" size={17}/>{busy === "crossplay-install" ? "バックアップ・導入中…" : "バックアップして公式版を導入"}</button>
        {!stopped ? <small>導入するにはPaperサーバーを完全に停止してください。</small> : null}
      </div> : null}
      {crossplayResult ? <div className="update-applied crossplay-installed"><Icon name="check" size={20}/><div><strong>クロスプレイ用ファイルを導入しました。公開はまだ完了していません</strong><p>{crossplayResult.message}</p><small>{crossplayResult.installedFiles.join(" / ")} · バックアップ {crossplayResult.backup.id}</small><p>Paperを再起動してGeyser設定を生成し、<code>config.yml</code> のBedrock UDPポートを {crossplayResult.bedrockPort} に確認・設定してください。その後、別の家へ公開する場合は、このUDPポートを転送するMinecraft Bedrockトンネルを別途作成します。</p></div></div> : null}
      <div className="crossplay-join-grid">
        <article><span>Java版から参加</span><strong>通常のJava版サーバーアドレス</strong><small>Java版マルチプレイでTCP {server.port}へ接続します。</small></article>
        <article><span>統合版から参加</span><strong>参加先は設定・公開後に確定</strong><small>同じLANではホストPCのアドレスと設定済みUDP {crossplayPort}を使います。別の家からはMinecraft Bedrock UDPトンネルが発行した接続先を使い、Java版と同じホスト名になるとは限りません。</small></article>
      </div>
      <div className="official-links"><a href={crossplayPlan?.sourceUrl || "https://download.geysermc.org/"} target="_blank" rel="noreferrer">Geyser公式配布元</a><a href="https://geysermc.org/wiki/geyser/setup/" target="_blank" rel="noreferrer">Geyser公式手順</a><a href="https://geysermc.org/wiki/floodgate/setup/" target="_blank" rel="noreferrer">Floodgate公式手順</a></div>
      <details><summary>Modrinthカタログを補助確認に使う</summary><div className="crossplay-catalog-actions"><button className="small-button" type="button" onClick={() => openCrossplayCatalog("Geyser")}><Icon name="search" size={17} />Geyserを検索</button><button className="small-button" type="button" onClick={() => openCrossplayCatalog("Floodgate")}><Icon name="search" size={17} />Floodgateを検索</button></div></details>
      <p className="privacy-note">公式配布元の版とSHA-256を確認し、変更直前にバックアップします。Geyserを使わないBDSとは別の構成です。</p>
    </section> : null}
  </div>{installOverlay}</>;
}
