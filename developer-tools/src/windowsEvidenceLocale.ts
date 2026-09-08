import { getLocalePack, type Locale } from "./locale";

interface WindowsEvidenceCopy { exportButton: string; ready: string; unavailable: string }
export function windowsEvidenceText(locale: Locale): WindowsEvidenceCopy {
  return getLocalePack(locale).windowsEvidence as unknown as WindowsEvidenceCopy;
}
