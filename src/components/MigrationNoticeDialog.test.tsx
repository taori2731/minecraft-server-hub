import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AppLocale } from "../lib/i18n";
import { brand } from "../lib/brand";
import { getRebrandCopy } from "../lib/rebrandLocale";
import { MigrationNoticeDialog } from "./MigrationNoticeDialog";

const locales: readonly AppLocale[] = ["ja", "en", "de", "es", "fr", "ko", "pt-BR", "zh-CN", "zh-TW"];

describe("MigrationNoticeDialog", () => {
  it.each(locales)("renders the localized one-time notice for %s", (locale) => {
    const copy = getRebrandCopy(locale);
    const { unmount } = render(<MigrationNoticeDialog locale={locale} onClose={() => undefined} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(copy.migrationTitle);
    expect(dialog).toHaveTextContent(copy.migrationBody);
    expect(dialog).toHaveTextContent(copy.migrationDistribution);
    expect(dialog).toHaveTextContent(brand.productName);
    expect(within(dialog).getByRole("button", { name: copy.migrationClose })).toBeInTheDocument();
    unmount();
  });
});
