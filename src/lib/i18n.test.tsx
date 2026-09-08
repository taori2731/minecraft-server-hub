import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { detectSystemLocale, I18nProvider, readLanguagePreference, useI18n } from "./i18n";

function Probe() {
  const { locale, preference, setPreference, t } = useI18n();
  return <><span>{preference}</span><strong>{locale}</strong><p>{t("newServer")}</p><button onClick={() => setPreference("ja")}>日本語</button></>;
}

describe("app localization", () => {
  beforeEach(() => localStorage.clear());

  it("matches common system languages and falls back to English", () => {
    expect(detectSystemLocale(["ja-JP"])).toBe("ja");
    expect(detectSystemLocale(["zh-Hant-TW"])).toBe("zh-TW");
    expect(detectSystemLocale(["pt-PT"])).toBe("pt-BR");
    expect(detectSystemLocale(["ru-RU"])).toBe("en");
  });

  it("uses system mode by default and persists a manual choice", async () => {
    expect(readLanguagePreference()).toBe("system");
    render(<I18nProvider><Probe /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "日本語" }));
    expect(await screen.findByText("新しいサーバー")).toBeInTheDocument();
    expect(localStorage.getItem("server-hub:language:v1")).toBe("ja");
    expect(document.documentElement.lang).toBe("ja");
  });
});
