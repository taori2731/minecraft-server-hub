import { getLocalePack, type Locale } from "./locale";

export type ReleaseEvidenceCopy = {
  kicker: string; title: string; intro: string; privacy: string; prepare: string; preparing: string;
  previewReady: string; version: string; checks: string; tests: string; licenses: string; ledger: string;
  packSize: string; digest: string; contents: string; confirm: string; export: string; exporting: string;
  exportSuccess: string; canceled: string; failed: string; nativeOnly: string; verify: string; verifying: string;
  verified: string; invalid: string; currentVersion: string; currentInventory: string; currentSource: string;
  matches: string; differs: string; warningQuality: string; refreshPreview: string;
};

export const releaseEvidenceText = (locale: Locale): ReleaseEvidenceCopy => getLocalePack(locale).releaseEvidence as unknown as ReleaseEvidenceCopy;
