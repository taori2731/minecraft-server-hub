import baseNotices from "../../docs/THIRD_PARTY_NOTICES.md?raw";
import mpl20Text from "../../docs/licenses/MPL-2.0.txt?raw";
import type { DeveloperInspectionReport, LicenseEvidenceReport } from "./types";

export const MPL_2_0_SOURCE_URL = "https://www.mozilla.org/media/MPL/2.0/index.f75d2927d3c1.txt";
export const MPL_2_0_SHA256 = "3F3D9E0024B1921B067D6F7F88DEB4A60CBE7A78E76C64E3F1D7FC3B779B9D04";

function tableCell(value: string) {
  return value.replaceAll("|", "\\|").replaceAll("\r", " ").replaceAll("\n", " ").trim();
}

export function createThirdPartyNoticesExport(
  report: DeveloperInspectionReport,
  evidence: LicenseEvidenceReport,
  generatedAt = new Date().toISOString(),
) {
  const inventoryDigest = report.dependencyInventory.advisoryPreview.requestDigest;
  if (!inventoryDigest || evidence.inventoryDigest !== inventoryDigest) {
    throw new Error("license-evidence-not-current");
  }
  if (evidence.summary.mismatch > 0
    || evidence.summary.applicability.actionableGaps > 0
    || evidence.summary.applicability.unknownGaps > 0) {
    throw new Error("license-evidence-incomplete");
  }
  const applicable = evidence.items
    .filter((item) => item.hostApplicability === "applicable")
    .sort((left, right) => left.ecosystem.localeCompare(right.ecosystem, "en")
      || left.name.localeCompare(right.name, "en")
      || left.version.localeCompare(right.version, "en"));
  if (applicable.some((item) => item.status !== "complete")) {
    throw new Error("license-evidence-incomplete");
  }
  const canonicalMpl = applicable.some((item) => {
    const license = item.manifestLicense || item.declaredLicense;
    return /(?:^|\s|\()MPL-2\.0(?:$|\s|\))/.test(license);
  });
  const rows = applicable.map((item) => {
    const files = item.files.map((file) => `${file.name} (${file.sha256})`).join("; ");
    return `| ${tableCell(item.ecosystem)} | ${tableCell(item.name)} | ${tableCell(item.version)} | ${tableCell(item.manifestLicense || item.declaredLicense || "NOASSERTION")} | ${tableCell(item.componentIds.join(", "))} | ${tableCell(files)} |`;
  });
  const canonicalSection = canonicalMpl
    ? `\n## Canonical license text: MPL-2.0\n\nOfficial source: ${MPL_2_0_SOURCE_URL}\n\nBundled text SHA-256: \`${MPL_2_0_SHA256}\`\n\n\`\`\`text\n${mpl20Text.trimEnd()}\n\`\`\`\n`
    : "";
  const marker = `<!-- minecraft-server-hub-third-party-notices schema=1 inventory-digest=${inventoryDigest} -->`;
  const content = `${marker}\n${baseNotices.trim()}\n\n## Audited Windows x64 dependency notices\n\nGenerated: ${generatedAt}\n\nApplication version: ${report.expectedVersion}\n\nTarget: \`x86_64-pc-windows-msvc\`\n\nInventory digest: \`${inventoryDigest}\`\n\nThis section is generated from the exact current lockfile inventory and locally verified evidence. It does not replace legal review.\n\n| Ecosystem | Package | Version | Declared license | Components | Evidence files and SHA-256 |\n| --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n${canonicalSection}`;
  return {
    filename: `minecraft-server-hub-${report.expectedVersion}-windows-x64-third-party-notices.md`,
    mime: "text/markdown;charset=utf-8",
    content,
  };
}
