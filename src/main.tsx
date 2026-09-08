import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { detectSystemLocale, readLanguagePreference, type AppLocale } from "./lib/i18n";
import { loadTranslationCatalog } from "./lib/translationCatalog";
import "./styles/app.css";

async function bootstrap() {
  const preference = readLanguagePreference();
  const initialLocale: AppLocale = preference === "system" ? detectSystemLocale() : preference;
  try {
    await loadTranslationCatalog(initialLocale);
  } catch (error) {
    console.error(`Failed to preload the ${initialLocale} translation catalog.`, error);
  }
  document.documentElement.lang = initialLocale;
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
