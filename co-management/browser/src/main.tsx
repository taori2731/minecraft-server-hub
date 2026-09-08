import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { CoManagementI18nProvider } from "./i18n";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CoManagementI18nProvider>
      <App />
    </CoManagementI18nProvider>
  </StrictMode>,
);
