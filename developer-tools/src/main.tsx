import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { developerBrand } from "./brand";
import { DeveloperToolsApp } from "./DeveloperToolsApp";
import { hydrateEmbeddedReport } from "./embeddedReport";
import { detectLocale, loadLocalePack, localeLoaderMessages } from "./locale";
import "./styles.css";

const startupMessages: Record<string, string> = { ja: `${developerBrand.productName}を読み込めませんでした。`, en: `${developerBrand.productName} could not be loaded.`, "zh-CN": `无法加载 ${developerBrand.productName}。`, "zh-TW": `無法載入 ${developerBrand.productName}。`, ko: `${developerBrand.productName}을(를) 불러올 수 없습니다.`, es: `No se pudo cargar ${developerBrand.productName}.`, de: `${developerBrand.productName} konnte nicht geladen werden.`, fr: `Impossible de charger ${developerBrand.productName}.`, "pt-BR": `Não foi possível carregar ${developerBrand.productName}.` };
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
