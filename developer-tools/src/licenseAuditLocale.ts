import { getLocalePack, type FlatLocaleCopy, type Locale } from "./locale";

export type LicenseAuditCopy = FlatLocaleCopy;
export function licenseAuditText(locale: Locale): LicenseAuditCopy {
  return getLocalePack(locale).licenseAudit;
}
