import type { Locale } from "./locale";
import { operationsNavigatorText } from "./operationsNavigatorLocale";
import { capabilitySecurityText } from "./capabilitySecurityLocale";
import { buildEnvironmentText } from "./buildEnvironmentLocale";
import { developerUpdateText } from "./developerUpdateLocale";

export const operationSectionIds = [
  "developer-overview",
  "developer-update-center",
  "release-evidence-center",
  "release-approval-center",
  "release-handoff-center",
  "quality-evidence-center",
  "bundle-performance-center",
  "dependency-center",
  "capability-security-center",
  "build-environment-center",
  "release-gates",
] as const;

export type OperationSectionId = typeof operationSectionIds[number];

export function isOperationSectionId(value: string): value is OperationSectionId {
  return operationSectionIds.includes(value as OperationSectionId);
}

export function OperationsNavigator({ locale, activeId, onNavigate }: {
  locale: Locale;
  activeId: OperationSectionId;
  onNavigate: (id: OperationSectionId, label: string) => void;
}) {
  const labels = operationsNavigatorText(locale);
  const items: Array<{ id: OperationSectionId; label: string }> = [
    { id: "developer-overview", label: labels.overview },
    { id: "developer-update-center", label: developerUpdateText(locale).nav },
    { id: "release-evidence-center", label: labels.evidence },
    { id: "release-approval-center", label: labels.approval },
    { id: "release-handoff-center", label: labels.handoff },
    { id: "quality-evidence-center", label: labels.quality },
    { id: "bundle-performance-center", label: labels.performance },
    { id: "dependency-center", label: labels.dependencies },
    { id: "capability-security-center", label: capabilitySecurityText(locale).nav },
    { id: "build-environment-center", label: buildEnvironmentText(locale).nav },
    { id: "release-gates", label: labels.gates },
  ];

  const currentLabel = items.find((item) => item.id === activeId)?.label ?? labels.overview;

  return <nav className="operations-navigator" aria-label={labels.ariaLabel}>
    <div className="operations-navigator-copy">
      <span className="kicker">D24 · QUICK NAVIGATION</span>
      <strong>{labels.title}</strong>
      <small id="operations-navigator-intro">{labels.intro}</small>
    </div>
    <div className="operations-navigator-track" aria-describedby="operations-navigator-intro">
      {items.map((item) => <button
        type="button"
        key={item.id}
        className={item.id === activeId ? "active" : ""}
        aria-current={item.id === activeId ? "location" : undefined}
        onClick={() => onNavigate(item.id, item.label)}
      >{item.label}</button>)}
    </div>
    <span className="sr-only" aria-live="polite" aria-atomic="true">{labels.jumpedTo.replace("{section}", currentLabel)}</span>
  </nav>;
}
