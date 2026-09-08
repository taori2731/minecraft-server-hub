import { getLocalePack, type Locale } from "./locale";

interface CargoApplicabilityLabels { applicable: string; excluded: string; unavailable: string }
export const cargoApplicabilityLabels = new Proxy({} as Record<Locale, CargoApplicabilityLabels>, {
  get: (_target, locale: string) => getLocalePack(locale as Locale).cargoApplicability as unknown as CargoApplicabilityLabels,
});

export function cargoApplicabilityReason(locale: Locale, reason: string) {
  const labels = cargoApplicabilityLabels[locale];
  if (reason === "cargo-metadata-windows-x64-applicable") return labels.applicable;
  if (reason === "cargo-metadata-windows-x64-excluded") return labels.excluded;
  if (reason === "cargo-metadata-unavailable") return labels.unavailable;
  return undefined;
}
