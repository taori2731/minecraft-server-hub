import { useEffect, useState } from "react";
import { DiagnosticsCommunity } from "./components/DiagnosticsCommunity";
import { FaqDownloadFooter } from "./components/FaqDownloadFooter";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { OverviewFeatures } from "./components/OverviewFeatures";
import { PricingPolicy } from "./components/PricingPolicy";
import { ReleaseStatus } from "./components/ReleaseStatus";
import { WorkflowMods } from "./components/WorkflowMods";

export type Theme = "dark" | "light";

function getInitialTheme(): Theme {
  const saved = window.localStorage.getItem("msh-theme");
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function App() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem("msh-theme", theme);
  }, [theme]);

  return (
    <>
      <a className="skip-link" href="#main">本文へ移動</a>
      <Header theme={theme} onToggleTheme={() => setTheme((current) => (current === "dark" ? "light" : "dark"))} />
      <main id="main">
        <Hero />
        <OverviewFeatures />
        <WorkflowMods />
        <DiagnosticsCommunity />
        <ReleaseStatus />
        <PricingPolicy />
        <FaqDownloadFooter />
      </main>
    </>
  );
}
