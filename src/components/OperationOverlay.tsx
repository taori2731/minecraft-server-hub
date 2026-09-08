import { createPortal } from "react-dom";
import { useI18n, type AppLocale } from "../lib/i18n";
import { translateGeneratedText } from "../lib/documentTranslation";

type Props = {
  title: string;
  detail: string;
  stages?: readonly string[];
  progress?: {
    percent?: number;
    summary: string;
    elapsed: string;
  };
};

const fallback: Record<AppLocale, { title: string; detail: string; waiting: string; flow: string; step: string; progress: string }> = {
  en: { title: "Operation in progress", detail: "The app is safely completing the requested operation.", waiting: "The app is still working. Keep this screen open and wait.", flow: "Operation progress", step: "Step", progress: "Download progress" },
  ja: { title: "処理しています", detail: "要求された処理を安全に実行しています。", waiting: "アプリは動作中です。この画面を閉じずにお待ちください。", flow: "処理の流れ", step: "手順", progress: "ダウンロード進捗" },
  "zh-CN": { title: "正在处理", detail: "应用正在安全地完成所请求的操作。", waiting: "应用仍在运行。请保持此画面打开并等待。", flow: "处理进度", step: "步骤", progress: "下载进度" },
  "zh-TW": { title: "正在處理", detail: "應用程式正在安全地完成要求的操作。", waiting: "應用程式仍在運作。請保持此畫面開啟並等候。", flow: "處理進度", step: "步驟", progress: "下載進度" },
  ko: { title: "처리 중", detail: "앱이 요청한 작업을 안전하게 완료하고 있습니다.", waiting: "앱이 실행 중입니다. 이 화면을 닫지 말고 기다려 주세요.", flow: "작업 진행", step: "단계", progress: "다운로드 진행률" },
  es: { title: "Operación en curso", detail: "La aplicación está completando de forma segura la operación solicitada.", waiting: "La aplicación sigue funcionando. Mantén esta pantalla abierta y espera.", flow: "Progreso de la operación", step: "Paso", progress: "Progreso de descarga" },
  de: { title: "Vorgang läuft", detail: "Die App führt den angeforderten Vorgang sicher aus.", waiting: "Die App arbeitet weiter. Lassen Sie diesen Bildschirm geöffnet und warten Sie.", flow: "Vorgangsfortschritt", step: "Schritt", progress: "Downloadfortschritt" },
  fr: { title: "Opération en cours", detail: "L’application exécute l’opération demandée en toute sécurité.", waiting: "L’application fonctionne toujours. Gardez cet écran ouvert et patientez.", flow: "Progression de l’opération", step: "Étape", progress: "Progression du téléchargement" },
  "pt-BR": { title: "Operação em andamento", detail: "O aplicativo está concluindo com segurança a operação solicitada.", waiting: "O aplicativo continua em execução. Mantenha esta tela aberta e aguarde.", flow: "Progresso da operação", step: "Etapa", progress: "Progresso do download" },
};

const japaneseKana = /[\u3041-\u30fa]/;
const han = /[\u3400-\u9fff]/;

function hasUntranslatedJapanese(source: string, translated: string, locale: AppLocale) {
  if (locale === "ja") return false;
  if (japaneseKana.test(translated)) return true;
  const chineseLocale = locale === "zh-CN" || locale === "zh-TW";
  return !chineseLocale && translated === source && han.test(source);
}

export function OperationOverlay({ title, detail, stages = ["準備", "安全確認", "反映"], progress }: Props) {
  const { locale } = useI18n();
  const messages = fallback[locale];
  const translatedTitle = translateGeneratedText(title, locale);
  const translatedDetail = translateGeneratedText(detail, locale);
  const renderedStages = stages.map((stage, index) => {
    const translated = translateGeneratedText(stage, locale);
    return hasUntranslatedJapanese(stage, translated, locale) ? `${messages.step} ${index + 1}` : translated;
  });
  return createPortal(
    <div className="wizard-loading-overlay operation-overlay" role="status" aria-live="polite" aria-busy="true">
      <span className="spinner large" />
      <strong>{hasUntranslatedJapanese(title, translatedTitle, locale) ? messages.title : translatedTitle}</strong>
      <p>{hasUntranslatedJapanese(detail, translatedDetail, locale) ? messages.detail : translatedDetail}</p>
      <div className="wizard-loading-stages" aria-label={messages.flow}>
        {renderedStages.map((stage, index) => <span key={`${stage}-${index}`}>{stage}</span>)}
      </div>
      {progress ? <div className="operation-progress">
        <div
          className={`operation-progress-track${progress.percent === undefined ? " indeterminate" : ""}`}
          role="progressbar"
          aria-label={messages.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent === undefined ? undefined : Math.round(progress.percent)}
        >
          <span style={progress.percent === undefined ? undefined : { width: `${Math.max(0, Math.min(100, progress.percent))}%` }} />
        </div>
        <div><strong>{progress.percent === undefined ? "—" : `${progress.percent.toFixed(1)}%`}</strong><span>{progress.summary}</span><time>{progress.elapsed}</time></div>
      </div> : null}
      <small>{messages.waiting}</small>
    </div>,
    document.querySelector(".app") ?? document.body,
  );
}
