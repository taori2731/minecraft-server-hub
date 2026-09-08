import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DeveloperToolsApp } from "./DeveloperToolsApp";
import { hydrateEmbeddedReport } from "./embeddedReport";
import { detectLocale, loadLocalePack, localeLoaderMessages } from "./locale";
import "./styles.css";

const startupMessages: Record<string, string> = { ja: "開発者ツールを読み込めませんでした。", en: "Developer Tools could not be loaded.", "zh-CN": "无法加载开发者工具。", "zh-TW": "無法載入開發者工具。", ko: "개발자 도구를 불러올 수 없습니다.", es: "No se pudieron cargar las herramientas.", de: "Die Entwicklertools konnten nicht geladen werden.", fr: "Impossible de charger les outils de développement.", "pt-BR": "Não foi possível carregar as ferramentas." };
const root = document.getElementById("root")!;

async function start() {
  const initialLocale = detectLocale();
  root.textContent = localeLoaderMessages[initialLocale].loading;
  root.className = "startup-loading";
  try {
    const [response] = await Promise.all([
      fetch(new URL(__MSH_EMBEDDED_REPORT_URL__, window.location.href), { cache: "no-store" }),
      loadLocalePack(initialLocale),
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    document.documentElement.lang = initialLocale;
    root.className = "";
    createRoot(root).render(<StrictMode><DeveloperToolsApp initialLocale={initialLocale} initialReport={hydrateEmbeddedReport(payload)} /></StrictMode>);
  } catch (reason) {
    root.textContent = `${startupMessages[initialLocale] || startupMessages.en} ${reason instanceof Error ? reason.message : String(reason)}`;
    root.className = "startup-error";
  }
}

void start();
