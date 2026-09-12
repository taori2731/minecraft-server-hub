import { useEffect, useMemo, useRef, useState } from "react";
import { backend, selectFolder } from "../lib/backend";
import { getAdaptiveMemoryLimitMib, getMemoryOptions } from "../lib/memoryOptions";
import { getClientEditionLabel, getCreateRuntimeMemoryDefaults, getDefaultServerPort, getServerEdition, getServerNetworkProtocol } from "../lib/serverEdition";
import { applyServerTemplate, serverTemplates } from "../lib/templates";
import type { CreateServerInput, JavaRuntime, PcDiagnosis, ServerProfile, ServerType, VersionOption } from "../types";
import { Icon } from "./Icon";
import { JavaSetupButton } from "./JavaSetupButton";
import { OperationOverlay } from "./OperationOverlay";
import { useI18n } from "../lib/i18n";
import { palworldText } from "../lib/palworldLocale";

interface Props {
  onClose: () => void;
  onCreated: (server: ServerProfile) => void;
  isFirstServer: boolean;
  initialTemplateId?: string;
}

const initialInput: CreateServerInput = {
  name: "",
  parentPath: "",
  gameKind: "minecraft",
  serverType: "paper",
  minecraftVersion: "",
  javaPath: "",
  javaMajor: 0,
  minMemoryMib: 1024,
  maxMemoryMib: 4096,
  port: 25565,
  eulaAccepted: false,
  palworldSettings: null,
  settings: {
    defaultGameMode: "survival",
    difficulty: "easy",
    maxPlayers: 20,
    pvp: true,
    whitelist: false,
    allowCommands: false,
    onlineMode: true,
    allowFlight: false,
    forceGameMode: false,
    spawnProtection: 16,
    requireResourcePack: false,
    resourcePackUrl: "",
    resourcePackPrompt: "",
    worldName: "world",
    worldType: "minecraft:normal",
    worldSeed: "",
    generateStructures: true,
    hardcore: false,
    daylightCycle: true,
    spawnMonsters: true,
    spawnAnimals: true,
    viewDistance: 10,
    simulationDistance: 8,
    defaultPlayerPermissionLevel: "member",
    serverPortV6: 19133,
    enableLanVisibility: true,
  },
};

const serverTypeCopy: Record<ServerType, { label: string; detail: string }> = {
  paper: { label: "Paper", detail: "軽快でプラグイン対応。Geyserを追加すると統合版の友達とも遊べます" },
  vanilla: { label: "Vanilla", detail: "公式に近い標準サーバー" },
  fabric: { label: "Fabric", detail: "軽量なModローダー。Fabric Mod向け" },
  forge: { label: "Forge", detail: "幅広いForge Modに対応" },
  neoforge: { label: "NeoForge", detail: "新しい世代のNeoForge Mod向け" },
  bedrock: { label: "統合版（BDS）", detail: "Windows・スマホ・ゲーム機の統合版向け。Javaは不要" },
  palworld: { label: "Palworld Dedicated Server", detail: "公式SteamCMDで準備するWindows向けPalworldサーバー" },
};

const MINIMUM_LOADING_FEEDBACK_MS = 700;

type PalworldInstallProgress = {
  phase: "steamcmd" | "download" | "verify" | "configure";
  percent?: number | null;
  downloadedBytes?: number | null;
  totalBytes?: number | null;
  bytesPerSecond?: number | null;
};

function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export function CreateServerWizard({ onClose, onCreated, isFirstServer, initialTemplateId }: Props) {
  const { locale } = useI18n();
  const pw = (key: Parameters<typeof palworldText>[1], values: Parameters<typeof palworldText>[2] = {}) => palworldText(locale, key, values);
  const [step, setStep] = useState(0);
  const initialTemplate = serverTemplates.find((template) => template.id === initialTemplateId);
  const [input, setInput] = useState<CreateServerInput>(() => initialTemplate ? applyServerTemplate(initialInput, initialTemplate) : initialInput);
  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [javaRuntimes, setJavaRuntimes] = useState<JavaRuntime[]>([]);
  const [loading, setLoading] = useState(false);
  const [installProgress, setInstallProgress] = useState<PalworldInstallProgress>();
  const [installElapsedSeconds, setInstallElapsedSeconds] = useState(0);
  const [error, setError] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState(initialTemplate?.id ?? "");
  const [pcDiagnosis, setPcDiagnosis] = useState<PcDiagnosis>();
  const [recommendationApplied, setRecommendationApplied] = useState(false);
  const [portHint, setPortHint] = useState("空きポートを確認中…");
  const [restPortHint, setRestPortHint] = useState("");
  const portEditedRef = useRef(false);
  const restPortEditedRef = useRef(false);
  const isPalworld = input.gameKind === "palworld" || input.serverType === "palworld";
  const isBedrock = getServerEdition(input.serverType) === "bedrock";
  const nativeRuntime = isBedrock || isPalworld;
  const visibleServerTypes: ServerType[] = isPalworld ? ["palworld"] : isBedrock ? ["bedrock"] : ["paper", "vanilla", "fabric", "forge", "neoforge"];

  useEffect(() => {
    if (!isPalworld) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen<PalworldInstallProgress>("palworld-install-progress", (event) => {
        if (!disposed) setInstallProgress(event.payload);
      }))
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isPalworld]);

  useEffect(() => {
    if (!loading || !isPalworld || step !== 5) return;
    const started = Date.now();
    setInstallElapsedSeconds(0);
    const timer = window.setInterval(() => setInstallElapsedSeconds(Math.floor((Date.now() - started) / 1000)), 1_000);
    return () => window.clearInterval(timer);
  }, [loading, isPalworld, step]);
  const stepLabels = isPalworld
    ? [pw("phasePw0Title"), pw("basicInfoTitle"), pw("officialSteamCmdTitle"), pw("phasePw1Title"), pw("phasePw2Title"), pw("credentialsTitle")]
    : ["PC診断", "テンプレートと基本情報", "種類とバージョン", isBedrock ? "実行環境" : "Javaとメモリ", "ワールド設定", "確認とEULA"];
  const suggestGamePort = async (startingPort: number) => {
    const protocol = getServerNetworkProtocol(input.serverType);
    let port = await backend.suggestServerPort(startingPort, protocol, input.serverType === "bedrock");
    if (isPalworld && port === (input.palworldSettings?.restApiPort ?? 8212)) {
      port = await backend.suggestServerPort(port + 1, protocol, false);
    }
    return port;
  };

  useEffect(() => {
    let active = true;
    const serverType = input.serverType;
    const protocol = getServerNetworkProtocol(serverType);
    const palworld = serverType === "palworld";
    const suggestions = async () => {
      const gamePromise = backend.suggestServerPort(
        getDefaultServerPort(serverType),
        protocol,
        serverType === "bedrock",
      );
      if (!palworld) return { gamePort: await gamePromise };
      const [gamePort, firstRestPort] = await Promise.all([
        gamePromise,
        backend.suggestServerPort(8212, "tcp", false),
      ]);
      const restPort = firstRestPort === gamePort
        ? await backend.suggestServerPort(firstRestPort + 1, "tcp", false)
        : firstRestPort;
      return { gamePort, restPort };
    };
    suggestions().then(({ gamePort, restPort }) => {
      if (!active) return;
      setInput((current) => {
        if (current.serverType !== serverType) return current;
        const nextGamePort = portEditedRef.current ? current.port : gamePort;
        const currentPalworld = current.palworldSettings;
        const nextRestPort = restPortEditedRef.current || restPort === undefined
          ? currentPalworld?.restApiPort
          : restPort;
        if (nextGamePort === current.port && nextRestPort === currentPalworld?.restApiPort) return current;
        return {
          ...current,
          port: nextGamePort,
          palworldSettings: currentPalworld && nextRestPort !== undefined
            ? { ...currentPalworld, restApiPort: nextRestPort }
            : currentPalworld,
        };
      });
      setPortHint(`LOCAL · ${gamePort}/${protocol.toUpperCase()}`);
      if (restPort !== undefined) setRestPortHint(`LOCAL · 127.0.0.1:${restPort}/TCP`);
    }).catch((reason: unknown) => {
      if (!active) return;
      const prefix = palworldText(locale, "portCheckFailedPrefix");
      setPortHint(palworld ? prefix : `自動確認できませんでした: ${String(reason)}`);
      if (palworld) setRestPortHint(prefix);
    });
    return () => { active = false; };
  }, [input.serverType, locale]);

  useEffect(() => {
    if (step !== 2) return;
    if (isPalworld) {
      const dedicatedServer = { id: "Dedicated Server", channel: "stable" };
      setVersions([dedicatedServer]);
      setError("");
      setLoading(false);
      setInput((current) => current.minecraftVersion === dedicatedServer.id
        ? current
        : { ...current, minecraftVersion: dedicatedServer.id });
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    backend.listVersions(input.serverType)
      .then((items) => {
        if (!active) return;
        setVersions(items);
        setInput((current) => items.some((item) => item.id === current.minecraftVersion)
          ? current
          : { ...current, minecraftVersion: items[0]?.id ?? "" });
      })
      .catch((reason: unknown) => active && setError(String(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [step, input.serverType, isPalworld]);

  useEffect(() => {
    if (step !== 3 || !input.minecraftVersion || nativeRuntime) {
      if (nativeRuntime) {
        setJavaRuntimes([]);
        setInput((current) => current.javaPath || current.javaMajor ? { ...current, javaPath: "", javaMajor: 0 } : current);
      }
      return;
    }
    let active = true;
    setLoading(true);
    setError("");
    backend.detectJava(input.serverType, input.minecraftVersion)
      .then((items) => {
        if (!active) return;
        setJavaRuntimes(items);
        const selected = items.find((item) => item.compatible) ?? items[0];
        if (selected) {
          setInput((current) => ({
            ...current,
            javaPath: selected.executablePath,
            javaMajor: selected.majorVersion,
          }));
        }
      })
      .catch((reason: unknown) => active && setError(String(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [step, input.serverType, input.minecraftVersion, nativeRuntime]);

  const selectedJava = useMemo(
    () => javaRuntimes.find((runtime) => runtime.executablePath === input.javaPath),
    [javaRuntimes, input.javaPath],
  );
  const memoryOptions = getMemoryOptions(
    pcDiagnosis?.memoryTotalMib,
    input.maxMemoryMib,
    pcDiagnosis?.recommendedMemoryMib,
  );
  const adaptiveMemoryLimitMib = getAdaptiveMemoryLimitMib(pcDiagnosis?.memoryTotalMib);
  const loadingCopy = step === 0
    ? { title: isPalworld ? pw("diagnosisLoadingTitle") : "このPCを診断しています", detail: isPalworld ? pw("diagnosisLoadingDescription") : "CPU・メモリ・保存先を確認しています。結果はこのPCの外へ送信しません。" }
    : step === 2
      ? { title: isPalworld ? pw("versionLoadingTitle") : "利用できるバージョンを確認しています", detail: isPalworld ? pw("versionLoadingDescription") : "公式配布元から対応バージョンの一覧を取得しています。" }
      : step === 3
        ? { title: isPalworld ? pw("statusPreparing") : "実行環境を確認しています", detail: isPalworld ? pw("phasePw1Description") : isBedrock ? "WindowsとBDSの実行条件を確認しています。" : "このサーバーで使えるJavaを確認しています。" }
        : { title: isPalworld ? pw("statusDownloadingServer") : "サーバーを準備しています", detail: isPalworld ? pw("officialSteamCmdDescription") : isBedrock ? "公式BDSの取得、安全確認、展開を順番に行っています。数分かかる場合があります。" : "公式サーバーファイルの取得、安全確認、初期設定を順番に行っています。" };
  const installProgressView = loading && isPalworld && step === 5 ? {
    percent: installProgress?.percent ?? undefined,
    summary: (() => {
      const downloaded = installProgress?.downloadedBytes;
      const total = installProgress?.totalBytes;
      const speed = installProgress?.bytesPerSecond;
      const size = (bytes: number) => bytes >= 1024 ** 3
        ? `${(bytes / 1024 ** 3).toFixed(2)} GiB`
        : `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
      const hasMeasuredSize = downloaded !== null && downloaded !== undefined && total !== null && total !== undefined;
      const parts = [hasMeasuredSize ? `${size(downloaded)} / ${size(total)}` : undefined, speed ? `${(speed * 8 / 1_000_000).toFixed(1)} Mbps` : undefined];
      return parts.filter(Boolean).join(" · ") || pw("statusDownloadingServer");
    })(),
    elapsed: formatElapsed(installElapsedSeconds),
  } : undefined;
  const installPhaseTitle = installProgress?.phase === "steamcmd"
    ? pw("statusInstallingSteamCmd")
    : installProgress?.phase === "verify" || installProgress?.phase === "configure"
      ? pw("statusPreparing")
      : loadingCopy.title;
  const palworldDiagnosisWarnings: string[] = [];
  if (isPalworld && pcDiagnosis) {
    if (pcDiagnosis.memoryAvailableMib < 4_096) {
      palworldDiagnosisWarnings.push(pw("warningAvailableMemoryUnder4"));
    }
    if (pcDiagnosis.memoryTotalMib < 16_384) {
      palworldDiagnosisWarnings.push(pw("warningTotalMemoryUnder16"));
    } else if (pcDiagnosis.memoryAvailableMib < 12_288) {
      palworldDiagnosisWarnings.push(pw("warningAvailableMemoryUnder12"));
    }
    if (pcDiagnosis.storageAvailable && pcDiagnosis.storageFreeGib < 10) {
      palworldDiagnosisWarnings.push(pw("warningStorageUnder10"));
    }
    if (!pcDiagnosis.storageAvailable) {
      palworldDiagnosisWarnings.push(pw("warningStorageUnavailable"));
    }
  }

  const canContinue = [
    Boolean(pcDiagnosis) || !isFirstServer,
    input.name.trim().length > 0 && input.parentPath.length > 0,
    input.minecraftVersion.length > 0,
    nativeRuntime ? true : Boolean(selectedJava?.compatible) && input.maxMemoryMib >= input.minMemoryMib,
    isPalworld ? Boolean(input.palworldSettings && input.palworldSettings.maxPlayers > 0 && input.port >= 1024 && input.port <= 65535 && input.palworldSettings.restApiPort >= 1024 && input.palworldSettings.restApiPort <= 65535 && input.port !== input.palworldSettings.restApiPort) : input.settings.worldName.trim().length > 0 && input.settings.maxPlayers > 0,
    isPalworld ? true : input.eulaAccepted,
  ][step];

  const chooseFolder = async () => {
    const folder = await selectFolder();
    if (folder) {
      setInput((current) => ({ ...current, parentPath: folder }));
      setPcDiagnosis(undefined);
      setRecommendationApplied(false);
    }
  };

  const chooseEdition = (edition: "java" | "bedrock") => {
    const serverType: ServerType = edition === "bedrock" ? "bedrock" : "paper";
    const preferredPort = getDefaultServerPort(serverType);
    const runtimeMemory = getCreateRuntimeMemoryDefaults(serverType);
    portEditedRef.current = false;
    restPortEditedRef.current = false;
    setSelectedTemplate("");
    setPcDiagnosis(undefined);
    setRecommendationApplied(false);
    setInput((current) => ({
      ...current,
      gameKind: "minecraft",
      serverType,
      minecraftVersion: "",
      javaPath: "",
      javaMajor: 0,
      ...runtimeMemory,
      palworldSettings: null,
      bedrockArchivePath: edition === "bedrock" ? current.bedrockArchivePath : undefined,
      port: preferredPort,
      settings: {
        ...current.settings,
        worldType: edition === "bedrock" ? "DEFAULT" : "minecraft:normal",
        simulationDistance: edition === "bedrock" ? Math.min(12, Math.max(4, current.settings.simulationDistance)) : current.settings.simulationDistance,
      },
    }));
    setPortHint("空きポートを確認中…");
    setRestPortHint("");
  };

  const chooseGame = (gameKind: "minecraft" | "palworld") => {
    if (gameKind === "minecraft") {
      chooseEdition("java");
      return;
    }
    portEditedRef.current = false;
    restPortEditedRef.current = false;
    setSelectedTemplate("");
    setPcDiagnosis(undefined);
    setRecommendationApplied(false);
    setInput((current) => ({
      ...current,
      gameKind: "palworld",
      serverType: "palworld",
      minecraftVersion: "Dedicated Server",
      javaPath: "",
      javaMajor: 0,
      minMemoryMib: 0,
      maxMemoryMib: 0,
      port: 8211,
      eulaAccepted: false,
      bedrockArchivePath: undefined,
      settings: { ...current.settings, maxPlayers: 32, worldName: "Palworld" },
      palworldSettings: {
        serverDescription: "",
        maxPlayers: 32,
        restApiPort: 8212,
        restApiEnabled: true,
        backupEnabled: true,
      },
    }));
    setPortHint(pw("portCheckingHint"));
    setRestPortHint(pw("portCheckingHint"));
  };

  const chooseBedrockArchive = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({ multiple: false, title: "Minecraft公式 Bedrock Dedicated Server ZIPを選択", filters: [{ name: "Bedrock Dedicated Server", extensions: ["zip"] }] });
      if (typeof selected === "string") setInput((current) => ({ ...current, bedrockArchivePath: selected }));
    } catch (reason) {
      setError(`BDS ZIPを選択できませんでした: ${String(reason)}`);
    }
  };

  const diagnosePc = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await backend.diagnoseNewServer(input.serverType, input.minecraftVersion, input.parentPath);
      setPcDiagnosis(result);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  };

  const applyRecommendation = () => {
    if (!pcDiagnosis) return;
    setInput((current) => ({
      ...current,
      minMemoryMib: nativeRuntime ? 0 : Math.min(2048, pcDiagnosis.recommendedMemoryMib),
      maxMemoryMib: nativeRuntime ? 0 : pcDiagnosis.recommendedMemoryMib,
      palworldSettings: isPalworld && current.palworldSettings ? {
        ...current.palworldSettings,
        maxPlayers: Math.min(32, Math.max(1, pcDiagnosis.recommendedPlayers)),
      } : current.palworldSettings,
      settings: {
        ...current.settings,
        maxPlayers: Math.min(isPalworld ? 32 : 500, pcDiagnosis.recommendedPlayers),
        viewDistance: pcDiagnosis.recommendedViewDistance,
        simulationDistance: pcDiagnosis.recommendedSimulationDistance,
      },
    }));
    setRecommendationApplied(true);
  };

  const chooseAvailablePort = async () => {
    setPortHint(isPalworld ? pw("portCheckingHint") : "空きポートを確認中…");
    try {
      const port = await suggestGamePort(input.port || getDefaultServerPort(input.serverType));
      setInput((current) => ({ ...current, port }));
      setPortHint(`LOCAL · ${port}/${getServerNetworkProtocol(input.serverType).toUpperCase()}`);
    } catch (reason) {
      setPortHint(isPalworld ? pw("portCheckFailedPrefix") : `自動確認できませんでした: ${String(reason)}`);
    }
  };

  const chooseAvailableRestPort = async () => {
    if (!input.palworldSettings) return;
    setRestPortHint(pw("portCheckingHint"));
    try {
      let restPort = await backend.suggestServerPort(input.palworldSettings.restApiPort || 8212, "tcp", false);
      if (restPort === input.port) {
        restPort = await backend.suggestServerPort(restPort + 1, "tcp", false);
      }
      setInput((current) => current.palworldSettings ? {
        ...current,
        palworldSettings: { ...current.palworldSettings, restApiPort: restPort },
      } : current);
      setRestPortHint(`LOCAL · 127.0.0.1:${restPort}/TCP`);
    } catch {
      setRestPortHint(pw("portCheckFailedPrefix"));
    }
  };

  const finish = async () => {
    setLoading(true);
    setInstallProgress(undefined);
    setInstallElapsedSeconds(0);
    setError("");
    try {
      const [server] = await Promise.all([
        backend.createServer(nativeRuntime ? { ...input, javaPath: "", javaMajor: 0, minMemoryMib: 0, maxMemoryMib: 0 } : input),
        new Promise<void>((resolve) => window.setTimeout(resolve, MINIMUM_LOADING_FEEDBACK_MS)),
      ]);
      onCreated(server);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="wizard" role="dialog" aria-modal="true" aria-labelledby="wizard-title" aria-busy={loading}>
        <header className="wizard-header">
          <div>
            <p className="wizard-kicker">{isPalworld ? pw("wizardKicker") : "新しいローカルサーバー"}</p>
            <h2 id="wizard-title">{stepLabels[step]}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label={isPalworld ? pw("closeWizardLabel") : "作成画面を閉じる"}>
            <Icon name="close" />
          </button>
        </header>

        <ol className="wizard-progress" aria-label={isPalworld ? pw("progressLabel") : "作成手順"}>
          {stepLabels.map((label, index) => (
            <li key={label} className={index === step ? "active" : index < step ? "done" : ""}>
              <span>{index < step ? <Icon name="check" size={14} /> : index + 1}</span>
              <small>{label}</small>
            </li>
          ))}
        </ol>

        <div className="wizard-body">
          {step === 0 ? (
            <div className="form-stack pc-setup-step">
              <fieldset className="edition-choice-grid game-choice-grid">
                <legend>{isPalworld ? pw("gameServerLegend") : "作るゲームサーバー"}</legend>
                <button type="button" className={!isPalworld ? "selected" : ""} onClick={() => chooseGame("minecraft")}><strong>Minecraft</strong><small>{isPalworld ? pw("minecraftOptionDescription") : "Java版、統合版、Paper、Modローダーに対応"}</small></button>
                <button type="button" className={isPalworld ? "selected" : ""} onClick={() => chooseGame("palworld")}><strong>Palworld</strong><small>{pw("phasePw1Description")}</small></button>
              </fieldset>
              {!isPalworld ? <fieldset className="edition-choice-grid">
                <legend>Minecraftのエディション</legend>
                <button type="button" className={!isBedrock ? "selected" : ""} onClick={() => chooseEdition("java")}><strong>Minecraft Java版</strong><small>PC版Javaクライアント向け · Vanilla／Paper／Modローダー</small></button>
                <button type="button" className={isBedrock ? "selected" : ""} onClick={() => chooseEdition("bedrock")}><strong>Minecraft 統合版</strong><small>Windows・スマホ・ゲーム機向け · Bedrock Dedicated Server</small></button>
              </fieldset> : <div className="info-callout palworld-local-api-note"><Icon name="check" /><div><strong>{pw("officialSteamCmdTitle")}</strong><br />{pw("gamePortDescription")} {pw("restLocalOnlyDescription")}</div></div>}
              <div className="info-callout"><Icon name="memory" /><div><strong>{isPalworld ? pw(isFirstServer ? "diagnosisFirstTitle" : "diagnosisRepeatTitle") : isFirstServer ? "最初のサーバー用に、このPCを先に診断します" : "このサーバー用の推奨値を再計算できます"}</strong><br />{isPalworld ? pw("diagnosisDescription") : <>CPU・メモリ・{isBedrock ? "Windows環境" : "Java"}・保存先の空き容量だけをPC内で確認します。結果は外部へ送信しません。</>}</div></div>
              <label>
                <span>{isPalworld ? pw("saveFolderLabel") : "サーバーの保存先"}</span>
                <div className="input-action">
                  <input value={input.parentPath} placeholder={isPalworld ? pw("saveFolderPlaceholder") : "診断する保存先フォルダー"} readOnly />
                  <button className="secondary-button" type="button" onClick={chooseFolder}><Icon name="folder" size={18} /> {isPalworld ? pw("selectFolderButton") : "選択"}</button>
                </div>
              </label>
              <button className="primary-button diagnose-main-button" type="button" onClick={diagnosePc} disabled={!input.parentPath || loading}><Icon name="search" size={18} />{isPalworld ? loading ? pw("diagnosingButton") : pcDiagnosis ? pw("diagnoseAgainButton") : pw("diagnoseButton") : loading ? "PCを診断中…" : pcDiagnosis ? "もう一度診断" : "このPCを診断"}</button>
              {pcDiagnosis ? <div className="pc-setup-result">
                <div className="diagnosis-facts compact-facts">
                  <div><span>CPU</span><strong>{isPalworld ? pw("cpuCoresThreadsValue", { cores: pcDiagnosis.physicalCores, threads: pcDiagnosis.logicalThreads }) : `${pcDiagnosis.physicalCores}コア / ${pcDiagnosis.logicalThreads}スレッド`}</strong><small>{pcDiagnosis.cpuName}</small></div>
                  <div><span>{isPalworld ? pw("availableMemoryLabel") : "空きメモリ"}</span><strong>{(pcDiagnosis.memoryAvailableMib / 1024).toFixed(1)} GiB</strong><small>{isPalworld ? pw("totalMemoryValue", { memory: (pcDiagnosis.memoryTotalMib / 1024).toFixed(1) }) : `合計 ${(pcDiagnosis.memoryTotalMib / 1024).toFixed(1)} GiB`}</small></div>
                  <div><span>{isPalworld ? pw("freeStorageLabel") : "保存先の空き"}</span><strong>{pcDiagnosis.storageAvailable ? `${pcDiagnosis.storageFreeGib} GiB` : isPalworld ? pw("storageUnavailable") : "取得できません"}</strong><small>{pcDiagnosis.storageKind}</small></div>
                </div>
                <div className="recommendation-strip"><div><span>{isPalworld ? pw("recommendedMemoryLabel") : "推奨メモリ"}</span><b>{isPalworld ? pw("recommendedMemoryValue") : `${(pcDiagnosis.recommendedMemoryMib / 1024).toFixed(1)} GiB`}</b></div><div><span>{isPalworld ? pw("recommendedPlayersLabel") : "人数の目安"}</span><b>{isPalworld ? pw("recommendedPlayersValue", { count: pcDiagnosis.recommendedPlayers }) : `${pcDiagnosis.recommendedPlayers}人`}</b></div><div><span>{isPalworld ? pw("recommendedStorageLabel") : "描画 / シミュレーション"}</span><b>{isPalworld ? pw("recommendedStorageValue") : `${pcDiagnosis.recommendedViewDistance} / ${pcDiagnosis.recommendedSimulationDistance}`}</b></div></div>
                {(isPalworld ? palworldDiagnosisWarnings : pcDiagnosis.warnings).map((warning) => <p className="inline-warning" key={warning}><Icon name="info" size={17} />{warning}</p>)}
                <button className="secondary-button apply-recommendation" type="button" onClick={applyRecommendation}><Icon name="check" size={18} />{isPalworld ? recommendationApplied ? pw("recommendationApplied") : pw("applyRecommendation") : recommendationApplied ? "推奨値を反映済み" : "この構成をサーバーに反映"}</button>
                <p className="capacity-note">{isPalworld ? pw("capacityNote") : "推奨値は安全余裕を含む目安です。次の画面以降でいつでも手動変更できます。"}</p>
              </div> : null}
              {!isFirstServer && !pcDiagnosis ? <p className="field-help">{isPalworld ? pw("skipDiagnosis") : "今回は診断せずに次へ進むこともできます。作成後は概要画面から手動診断できます。"}</p> : null}
            </div>
          ) : null}

          {step === 1 ? (
            <div className="form-stack">
              {isPalworld ? <div className="info-callout"><Icon name="info" /><div><strong>{pw("officialSteamCmdTitle")}</strong><br />{pw("officialSteamCmdDescription")}</div></div> : !isBedrock ? <fieldset className="template-choice-grid">
                <legend>初期値テンプレート（任意）</legend>
                {serverTemplates.map((template) => <button type="button" key={template.id} className={selectedTemplate === template.id ? "selected" : ""} onClick={() => { setSelectedTemplate(template.id); setInput((current) => applyServerTemplate(current, template)); }}><strong>{template.label}</strong><small>{template.detail}</small></button>)}
              </fieldset> : <div className="info-callout"><Icon name="check" /><div><strong>統合版の安全な初期値を使用します</strong><br />サバイバル・イージー・許可リスト任意・UDP 19132から始め、作成前に変更できます。</div></div>}
              {selectedTemplate ? <p className="template-preview"><Icon name="check" size={17}/>提案値を反映しました。次の画面で種類・メモリ・設定を確認して変更できます。既存サーバーには適用しません。</p> : null}
              <label>
                <span>{isPalworld ? pw("serverNameLabel") : "サーバー名"}</span>
                <input autoFocus value={input.name} maxLength={64} placeholder={isPalworld ? pw("serverNamePlaceholder") : "例：友達とのサバイバル"} onChange={(event) => setInput({ ...input, name: event.target.value })} />
              </label>
              <label>
                <span>{isPalworld ? pw("saveDestinationLabel") : "保存先"}</span>
                <div className="input-action">
                  <input value={input.parentPath} placeholder={isPalworld ? pw("saveDestinationPlaceholder") : "サーバーを保存する親フォルダー"} readOnly />
                  <button className="secondary-button" type="button" onClick={chooseFolder}><Icon name="folder" size={18} /> {isPalworld ? pw("selectFolderButton") : "選択"}</button>
                </div>
              </label>
              <p className="field-help">{isPalworld ? pw("saveDestinationHelp") : "選択したフォルダー内に、サーバー専用の新しいフォルダーを作成します。既存ファイルは上書きしません。"}</p>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="form-stack">
              {isPalworld ? <>
                <div className="bedrock-download-card palworld-steamcmd-card">
                  <div><span className="section-kicker">OFFICIAL STEAMCMD</span><h3>{pw("officialSteamCmdTitle")}</h3><p>{pw("officialSteamCmdDescription")}</p></div>
                  <a className="secondary-button" href="https://developer.valvesoftware.com/wiki/SteamCMD" target="_blank" rel="noreferrer"><Icon name="download" size={17} />{pw("steamCmdGuideLabel")}</a>
                </div>
                <div className="palworld-download-facts">
                  <article><span>{pw("downloadMethodLabel")}</span><strong data-no-translate>SteamCMD · 2394010</strong></article>
                  <article><span>{pw("executableLabel")}</span><strong data-no-translate>PalServer.exe</strong></article>
                  <article><span>{pw("transportLabel")}</span><strong data-no-translate>UDP {input.port}</strong></article>
                </div>
                <p className="privacy-note"><Icon name="info" size={16} />{pw("installedSizeDescription")}</p>
              </> : <><fieldset className="choice-grid">
                <legend>サーバー種類</legend>
                {visibleServerTypes.map((type) => (
                  <label key={type} className={input.serverType === type ? "choice selected" : "choice"}>
                    <input type="radio" name="server-type" value={type} checked={input.serverType === type} onChange={() => setInput({ ...input, serverType: type, minecraftVersion: "", port: getDefaultServerPort(type) })} />
                    <strong>{serverTypeCopy[type].label}</strong>
                    <span>{serverTypeCopy[type].detail}</span>
                  </label>
                ))}
              </fieldset>
              <label>
                <span>{getClientEditionLabel(input.serverType)}のバージョン</span>
                <select value={input.minecraftVersion} disabled={loading} onChange={(event) => setInput({ ...input, minecraftVersion: event.target.value })}>
                  {versions.map((version) => <option key={version.id} value={version.id}>{version.id}</option>)}
                </select>
              </label>
              <div className="info-callout"><Icon name="info" />{isBedrock ? "Minecraft公式のBedrock Dedicated Serverを使います。Java版のModやプラグインとは互換性がありません。" : "公式配布元の安定版を優先します。Forge／NeoForgeは初回作成時に公式インストーラーを実行します。"}</div>
              </>}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="form-stack">
              {isPalworld ? <>
                <div className="bedrock-runtime-card palworld-runtime-card"><Icon name="check" size={22} /><div><strong>PalServer.exe</strong><p>{pw("phasePw1Description")}</p></div></div>
                <div className="info-callout palworld-local-api-note"><Icon name="server" /><div><strong>{pw("credentialsTitle")}</strong><br />{pw("credentialsDescription")}</div></div>
                <div className="palworld-download-facts">
                  <article><span>{pw("transportLabel")}</span><strong>UDP {input.port}</strong></article>
                  <article><span>{pw("restApiLabel")}</span><strong>127.0.0.1:{input.palworldSettings?.restApiPort ?? 8212}</strong></article>
                  <article><span>RCON</span><strong>OFF</strong></article>
                </div>
              </> : isBedrock ? <>
                <div className="bedrock-runtime-card"><Icon name="check" size={22} /><div><strong>Javaは必要ありません</strong><p>統合版は公式の <code>bedrock_server.exe</code> を直接起動します。メモリはWindowsとBDSが管理し、使用量は起動後にリアルタイム表示します。</p></div></div>
                <div className="bedrock-download-card">
                  <div><span className="section-kicker">OFFICIAL BDS DOWNLOAD</span><h3>公式版を自動取得（おすすめ）</h3><p>作成時にMinecraft公式APIからWindows版BDSを取得し、HTTPS配布元、ZIP構造、実行ファイル、Windows署名を検証します。公式APIを利用できない場合だけ手元のZIPを選べます。</p></div>
                  <div className="bedrock-download-actions"><a className="secondary-button" href="https://www.minecraft.net/en-us/download/server/bedrock" target="_blank" rel="noreferrer"><Icon name="download" size={17} />公式配布ページ</a><button className="secondary-button" type="button" onClick={chooseBedrockArchive}><Icon name="folder" size={17} />手元の公式ZIPを使う</button></div>
                  <div className={`bedrock-archive-source ${input.bedrockArchivePath ? "selected-archive" : ""}`}>
                    {input.bedrockArchivePath ? <><span>手動選択:</span> <code data-no-translate>{input.bedrockArchivePath}</code></> : <span>自動取得: Minecraft公式の最新対応Windows版</span>}
                  </div>
                </div>
                <p className="privacy-note"><Icon name="info" size={16} />ZIPは選択したサーバー専用の新しいフォルダーへ安全に展開します。元のZIPや既存フォルダーは上書きしません。</p>
              </> : <><label>
                <span>使用するJava</span>
                <select value={input.javaPath} disabled={loading || javaRuntimes.length === 0} onChange={(event) => {
                  const runtime = javaRuntimes.find((item) => item.executablePath === event.target.value);
                  setInput({ ...input, javaPath: event.target.value, javaMajor: runtime?.majorVersion ?? 0 });
                }}>
                  {javaRuntimes.length === 0 ? <option value="">互換Javaが見つかりません</option> : null}
                  {javaRuntimes.map((runtime) => <option key={runtime.executablePath} value={runtime.executablePath}>Java {runtime.version} — {runtime.vendor}</option>)}
                </select>
              </label>
              {selectedJava ? <div className={selectedJava.compatible ? "compatibility good" : "compatibility bad"}><Icon name={selectedJava.compatible ? "check" : "info"} /> <div><strong>{selectedJava.compatibilityMessage}</strong><small>{selectedJava.executablePath}</small></div></div> : null}
              {!selectedJava?.compatible ? <div className="java-missing-card"><div><Icon name="info" size={21}/><span><strong>Javaがなくても大丈夫です</strong><small>このサーバーに必要なJavaを判定し、アプリ内だけに安全に準備します。</small></span></div><JavaSetupButton serverType={input.serverType} minecraftVersion={input.minecraftVersion} disabled={loading} label="Javaを自動で準備" onInstalled={(runtime) => { setJavaRuntimes((current) => [runtime, ...current.filter((item) => item.executablePath !== runtime.executablePath)]); setInput((current) => ({ ...current, javaPath: runtime.executablePath, javaMajor: runtime.majorVersion })); setError(""); }} /></div> : <JavaSetupButton serverType={input.serverType} minecraftVersion={input.minecraftVersion} disabled={loading} label="アプリ用Javaを準備し直す" onInstalled={(runtime) => { setJavaRuntimes((current) => [runtime, ...current.filter((item) => item.executablePath !== runtime.executablePath)]); setInput((current) => ({ ...current, javaPath: runtime.executablePath, javaMajor: runtime.majorVersion })); setError(""); }} />}
              <div className="two-columns">
                <label><span>最小メモリ</span><select value={input.minMemoryMib} onChange={(event) => setInput({ ...input, minMemoryMib: Number(event.target.value) })}><option value={512}>512 MiB</option><option value={1024}>1 GiB</option><option value={2048}>2 GiB</option></select></label>
                <label><span>最大メモリ</span><select value={input.maxMemoryMib} onChange={(event) => setInput({ ...input, maxMemoryMib: Number(event.target.value) })}>{memoryOptions.map((value) => <option key={value} value={value}>{Number.isInteger(value / 1024) ? value / 1024 : (value / 1024).toFixed(1)} GiB{value === pcDiagnosis?.recommendedMemoryMib ? "（おすすめ）" : ""}</option>)}</select></label>
              </div>
              <p className="field-help">搭載メモリに合わせた通常候補は最大{adaptiveMemoryLimitMib / 1024} GiBです。診断のおすすめ値は現在の空きメモリも考慮します。大きくする場合は、ほかのアプリの空きメモリも確認してください。</p>
              </>}
            </div>
          ) : null}

          {step === 4 ? (
            <div className="form-stack">
              {isPalworld ? <>
                <div className="info-callout"><Icon name="info" /><div><strong>{pw("phasePw2Title")}</strong><br />{pw("phasePw2Description")}</div></div>
                <div className="two-columns">
                  <label><span>{pw("gamePortTitle")}</span><div className="input-action"><input aria-label={pw("gamePortTitle")} type="number" min={1024} max={65535} value={input.port} onChange={(event) => { portEditedRef.current = true; setInput({ ...input, port: Number(event.target.value) }); }} /><button className="secondary-button" type="button" onClick={chooseAvailablePort}>{pw("autoSelectButton")}</button></div><small>{portHint}</small></label>
                  <label><span>{pw("maxPlayersLabel")}</span><input aria-label={`Palworld ${pw("maxPlayersLabel")}`} type="number" min={1} max={32} value={input.palworldSettings?.maxPlayers ?? 32} onChange={(event) => setInput((current) => ({ ...current, settings: { ...current.settings, maxPlayers: Number(event.target.value) }, palworldSettings: { ...(current.palworldSettings ?? { serverDescription: "", maxPlayers: 32, restApiPort: 8212, restApiEnabled: true, backupEnabled: true }), maxPlayers: Number(event.target.value) } }))} /></label>
                  <label className="wide-field"><span>{pw("serverDescriptionLabel")}</span><input aria-label={`Palworld ${pw("serverDescriptionLabel")}`} value={input.palworldSettings?.serverDescription ?? ""} maxLength={120} placeholder="Palworld" onChange={(event) => setInput((current) => ({ ...current, palworldSettings: { ...(current.palworldSettings ?? { serverDescription: "", maxPlayers: 32, restApiPort: 8212, restApiEnabled: true, backupEnabled: true }), serverDescription: event.target.value } }))} /></label>
                  <label><span>{pw("restPortLabel")}</span><div className="input-action"><input aria-label={pw("restPortLabel")} type="number" min={1024} max={65535} value={input.palworldSettings?.restApiPort ?? 8212} onChange={(event) => { restPortEditedRef.current = true; setInput((current) => current.palworldSettings ? { ...current, palworldSettings: { ...current.palworldSettings, restApiPort: Number(event.target.value) } } : current); }} /><button className="secondary-button" type="button" onClick={chooseAvailableRestPort}>{pw("autoSelectButton")}</button></div><small>{restPortHint || pw("restLocalOnlyDescription")}</small></label>
                </div>
                <div className="toggle-list"><label><input type="checkbox" checked={input.palworldSettings?.backupEnabled ?? true} onChange={(event) => setInput((current) => ({ ...current, palworldSettings: { ...(current.palworldSettings ?? { serverDescription: "", maxPlayers: 32, restApiPort: 8212, restApiEnabled: true, backupEnabled: true }), backupEnabled: event.target.checked } }))} /><span>{pw("backupDescription")}</span></label></div>
                {input.port === (input.palworldSettings?.restApiPort ?? 8212) ? <p className="inline-warning"><Icon name="info" size={16} />UDP {input.port} / REST {input.palworldSettings?.restApiPort ?? 8212}</p> : null}
                <p className="inline-warning"><Icon name="info" size={16} />{pw("restNeverExpose")}</p>
              </> : <><div className="info-callout"><Icon name="info" /><div><strong>シングルプレイに近いワールド生成設定</strong><br />タイプとシードは最初のワールド生成時に使われます。作成後に変えても生成済みチャンクは変わりません。</div></div>
              <div className="two-columns">
                <label><span>ワールド名</span><input value={input.settings.worldName} onChange={(event) => setInput({ ...input, settings: { ...input.settings, worldName: event.target.value } })} /></label>
                <label><span>{isBedrock ? "ポート番号（UDP）" : "ポート番号（TCP）"}</span><div className="input-action"><input aria-label="ポート番号" type="number" min={1024} max={65535} value={input.port} onChange={(event) => { portEditedRef.current = true; setInput({ ...input, port: Number(event.target.value) }); }} /><button className="secondary-button" type="button" onClick={chooseAvailablePort}>空きを選ぶ</button></div><small>{portHint}</small></label>
                <label><span>ワールドタイプ</span><select aria-label="ワールドタイプ" value={input.settings.worldType ?? (isBedrock ? "DEFAULT" : "minecraft:normal")} onChange={(event) => setInput({ ...input, settings: { ...input.settings, worldType: event.target.value as CreateServerInput["settings"]["worldType"] } })}>{isBedrock ? <><option value="DEFAULT">デフォルト</option><option value="FLAT">フラット</option><option value="LEGACY">レガシー</option></> : <><option value="minecraft:normal">デフォルト</option><option value="minecraft:flat">スーパーフラット</option><option value="minecraft:large_biomes">大きなバイオーム</option><option value="minecraft:amplified">アンプリファイド</option></>}</select><small>level-type</small></label>
                <label><span>ワールド生成のシード値</span><input aria-label="ワールド生成のシード値" maxLength={128} value={input.settings.worldSeed ?? ""} placeholder="空白でランダム" onChange={(event) => setInput({ ...input, settings: { ...input.settings, worldSeed: event.target.value } })} /><small>数値または文字列 · level-seed</small></label>
                <label><span>初期ゲームモード</span><select value={input.settings.defaultGameMode} onChange={(event) => setInput({ ...input, settings: { ...input.settings, defaultGameMode: event.target.value as CreateServerInput["settings"]["defaultGameMode"] } })}><option value="survival">サバイバル</option><option value="creative">クリエイティブ</option><option value="adventure">アドベンチャー</option><option value="spectator">スペクテイター</option></select></label>
                <label><span>難易度</span><select value={input.settings.difficulty} onChange={(event) => setInput({ ...input, settings: { ...input.settings, difficulty: event.target.value as CreateServerInput["settings"]["difficulty"] } })}><option value="peaceful">ピースフル</option><option value="easy">イージー</option><option value="normal">ノーマル</option><option value="hard">ハード</option></select></label>
                <label><span>最大プレイヤー数</span><input type="number" min={1} max={500} value={input.settings.maxPlayers} onChange={(event) => setInput({ ...input, settings: { ...input.settings, maxPlayers: Number(event.target.value) } })} /></label>
                {isBedrock ? <label><span>既定のプレイヤー権限</span><select value={input.settings.defaultPlayerPermissionLevel ?? "member"} onChange={(event) => setInput({ ...input, settings: { ...input.settings, defaultPlayerPermissionLevel: event.target.value as NonNullable<CreateServerInput["settings"]["defaultPlayerPermissionLevel"]> } })}><option value="visitor">ビジター</option><option value="member">メンバー</option><option value="operator">オペレーター</option></select><small>default-player-permission-level</small></label> : null}
              </div>
              <div className="toggle-list">
                {!isBedrock ? <><label><input type="checkbox" checked={input.settings.generateStructures ?? true} onChange={(event) => setInput({ ...input, settings: { ...input.settings, generateStructures: event.target.checked } })} /><span>村や要塞などの構造物を生成する</span></label>
                <label><input type="checkbox" checked={input.settings.hardcore ?? false} onChange={(event) => setInput({ ...input, settings: { ...input.settings, hardcore: event.target.checked, ...(event.target.checked ? { difficulty: "hard", defaultGameMode: "survival" } : {}) } })} /><span>ハードコアにする（難易度ハード・サバイバル）</span></label></> : null}
                <label><input type="checkbox" checked={input.settings.pvp} onChange={(event) => setInput({ ...input, settings: { ...input.settings, pvp: event.target.checked } })} /><span>PvPを有効にする</span></label>
                <label><input type="checkbox" checked={input.settings.whitelist} onChange={(event) => setInput({ ...input, settings: { ...input.settings, whitelist: event.target.checked } })} /><span>{isBedrock ? "許可リストを有効にする" : "ホワイトリストを有効にする"}</span></label>
              </div>
              </>}
            </div>
          ) : null}

          {step === 5 ? (
            <div className="form-stack review-stack">
              <dl className="review-list">
                <div><dt>{isPalworld ? pw("reviewServerLabel") : "サーバー"}</dt><dd>{input.name}</dd></div>
                <div><dt>{isPalworld ? pw("reviewConfigurationLabel") : "構成"}</dt><dd>{serverTypeCopy[input.serverType].label} / {input.minecraftVersion}</dd></div>
                {isPalworld ? <><div><dt>{pw("downloadMethodLabel")}</dt><dd>SteamCMD · {pw("steamAppId")}</dd></div><div><dt>{pw("executableLabel")}</dt><dd>PalServer.exe</dd></div><div><dt>{pw("transportLabel")}</dt><dd>UDP {input.port}</dd></div></> : <><div><dt>実行環境</dt><dd>{isBedrock ? "bedrock_server.exe（Java不要）" : `Java ${input.javaMajor}`}</dd></div><div><dt>メモリ</dt><dd>{isBedrock ? "WindowsとBDSが自動管理" : `${input.minMemoryMib}–${input.maxMemoryMib} MiB`}</dd></div><div><dt>ローカル接続</dt><dd>127.0.0.1:{input.port} / {nativeRuntime ? "UDP" : "TCP"}</dd></div></>}
                {isPalworld ? <><div><dt>{pw("maxPlayersLabel")}</dt><dd>{input.palworldSettings?.maxPlayers ?? 32}</dd></div><div><dt>{pw("restApiLabel")} · {pw("localOnly")}</dt><dd>127.0.0.1:{input.palworldSettings?.restApiPort ?? 8212}</dd></div></> : <div><dt>ワールド生成</dt><dd>{input.settings.worldType?.replace("minecraft:", "") ?? "normal"} / {input.settings.worldSeed?.trim() ? `シード ${input.settings.worldSeed.trim()}` : "ランダムシード"}</dd></div>}
                <div><dt>{isPalworld ? pw("reviewSaveDestinationLabel") : "保存先"}</dt><dd>{input.parentPath}</dd></div>
                {isBedrock ? <div><dt>公式BDS</dt><dd>{input.bedrockArchivePath?.split(/[\\/]/).pop() ?? "公式APIから自動取得"}</dd></div> : null}
              </dl>
              {!isPalworld ? <div className="eula-consent">
                <input aria-label="Minecraft EULAに同意する" type="checkbox" checked={input.eulaAccepted} onChange={(event) => setInput({ ...input, eulaAccepted: event.target.checked })} />
                <span><strong>Minecraft EULAを読み、このサーバーでの利用条件に同意します</strong><small><a href="https://www.minecraft.net/eula" target="_blank" rel="noreferrer">EULAを新しいウィンドウで確認</a>。同意日時をサーバー情報へ記録します。</small></span>
              </div> : <div className="info-callout palworld-local-api-note"><Icon name="check" /><div><strong>{pw("credentialsTitle")}</strong><br />{pw("credentialsDescription")}</div></div>}
              <div className="warning-callout"><Icon name="download" />{isPalworld ? `${pw("officialSteamCmdDescription")} ${pw("installedSizeDescription")}` : isBedrock ? "作成するとMinecraft公式からBDSを取得（手動ZIP選択時はそのファイルを使用）し、ZIP構造・実行ファイル・Windows署名を検証してから安全な新規フォルダーへ展開します。" : "作成すると公式配布元からServer JARをダウンロードし、ハッシュを確認します。"}</div>
            </div>
          ) : null}

          {error ? <div className="error-banner" role="alert"><Icon name="info" /> <span>{error}</span></div> : null}
          {loading ? <OperationOverlay title={installPhaseTitle} detail={loadingCopy.detail} progress={installProgressView} stages={step === 5 ? isPalworld ? [pw("statusInstallingSteamCmd"), pw("statusDownloadingServer"), pw("statusPreparing")] : ["ダウンロード", "安全確認", "ファイル作成"] : isPalworld ? [pw("statusPreparing"), pw("monitoringTitle"), pw("statusRunning")] : ["準備", "確認", "完了"]} /> : null}
        </div>

        <footer className="wizard-footer">
          <button className="secondary-button" type="button" onClick={step === 0 ? onClose : () => setStep(step - 1)} disabled={loading}>{isPalworld ? step === 0 ? pw("cancelButton") : pw("backButton") : step === 0 ? "キャンセル" : "戻る"}</button>
          {step < stepLabels.length - 1 ? <button className="primary-button" type="button" disabled={!canContinue || loading} onClick={() => { setError(""); setStep(step + 1); }}>{isPalworld ? pw("nextButton") : "次へ"} <Icon name="chevron" size={18} /></button> : <button className="primary-button" type="button" disabled={!canContinue || loading} onClick={finish}>{loading ? isPalworld ? pw("statusDownloadingServer") : "ダウンロード・作成中…" : isPalworld ? pw("createServer") : "サーバーを作成"}</button>}
        </footer>
      </section>
    </div>
  );
}
