import type { DependencyPackageSummary, DeveloperInspectionReport, LicenseClass } from "./types.ts";

type CompactPackage = [string, 0 | 1, string, string, 0 | 1, 0 | 1, string, 0 | 1 | 2, string, string, 0 | 1, string, 0 | 1 | 2, string];

export interface EmbeddedReportPayload {
  report: DeveloperInspectionReport;
  packages: CompactPackage[];
}

const licenseClasses: LicenseClass[] = ["permissive", "reciprocal", "unknown"];

export function compactEmbeddedReport(report: DeveloperInspectionReport): EmbeddedReportPayload {
  const packages: CompactPackage[] = report.dependencyInventory.packages.map((item) => [
    item.componentId, item.ecosystem === "npm" ? 0 : 1, item.name, item.version,
    item.direct ? 1 : 0, item.development ? 1 : 0, item.license,
    item.licenseClass === "permissive" ? 0 : item.licenseClass === "reciprocal" ? 1 : 2,
    item.source, item.integrity, item.integrityPresent ? 1 : 0, item.reason,
    item.hostApplicability === "applicable" ? 0 : item.hostApplicability === "excluded" ? 1 : 2,
    item.applicabilityReason,
  ]);
  return { report: { ...report, dependencyInventory: { ...report.dependencyInventory, packages: [] } }, packages };
}

export function hydrateEmbeddedReport(payload: EmbeddedReportPayload): DeveloperInspectionReport {
  const packages: DependencyPackageSummary[] = payload.packages.map((item) => ({
    componentId: item[0], ecosystem: item[1] === 0 ? "npm" : "cargo", name: item[2], version: item[3],
    direct: item[4] === 1, development: item[5] === 1, license: item[6], licenseClass: licenseClasses[item[7]],
    source: item[8], integrity: item[9], integrityPresent: item[10] === 1, reason: item[11],
    hostApplicability: item[12] === 0 ? "applicable" : item[12] === 1 ? "excluded" : "unknown",
    applicabilityReason: item[13],
  }));
  return { ...payload.report, dependencyInventory: { ...payload.report.dependencyInventory, packages } };
}
