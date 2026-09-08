import type { CSSProperties } from "react";
import type { AccentTheme, AppearanceSettings } from "../types";

const APPEARANCE_KEY = "server-hub:appearance:v2";
const LEGACY_APPEARANCE_KEY = "server-hub:appearance:v1";
const PRESET_ACCENTS: AccentTheme[] = ["emerald", "amethyst", "ocean", "copper"];

export const defaultAppearance: AppearanceSettings = {
  accent: "emerald",
  iconScale: "comfortable",
  customAccent: "#49DA6B",
};

export function normalizeHexColor(value: string): string | null {
  const compact = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(compact)) {
    return `#${[...compact].map((character) => character.repeat(2)).join("").toUpperCase()}`;
  }
  return /^[0-9a-f]{6}$/i.test(compact) ? `#${compact.toUpperCase()}` : null;
}

export function readAppearance(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY) ?? localStorage.getItem(LEGACY_APPEARANCE_KEY);
    const value = JSON.parse(raw ?? "null") as Partial<AppearanceSettings> | null;
    const accent = [...PRESET_ACCENTS, "custom"].includes(value?.accent ?? "")
      ? value!.accent as AccentTheme
      : defaultAppearance.accent;
    const iconScale = value?.iconScale === "compact" ? "compact" : "comfortable";
    const customAccent = normalizeHexColor(value?.customAccent ?? "") ?? defaultAppearance.customAccent;
    return { accent, iconScale, customAccent };
  } catch {
    return defaultAppearance;
  }
}

export function storeAppearance(settings: AppearanceSettings): void {
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify({
    accent: settings.accent,
    iconScale: settings.iconScale,
    customAccent: normalizeHexColor(settings.customAccent) ?? defaultAppearance.customAccent,
  }));
}

function contrastColor(hex: string): "#07110A" | "#FFFFFF" {
  const normalized = normalizeHexColor(hex) ?? defaultAppearance.customAccent;
  const channels = [1, 3, 5].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return luminance > 0.44 ? "#07110A" : "#FFFFFF";
}

export function customAccentStyle(settings: AppearanceSettings): CSSProperties | undefined {
  if (settings.accent !== "custom") return undefined;
  const accent = normalizeHexColor(settings.customAccent) ?? defaultAppearance.customAccent;
  return {
    "--accent": accent,
    "--accent-strong": `color-mix(in srgb, ${accent} 72%, black)`,
    "--accent-soft": `color-mix(in srgb, ${accent} 13%, transparent)`,
    "--accent-contrast": contrastColor(accent),
  } as CSSProperties;
}
