import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { commandPaletteText } from "./commandPaletteLocale";
import { capabilitySecurityText } from "./capabilitySecurityLocale";
import { buildEnvironmentText } from "./buildEnvironmentLocale";
import { developerUpdateText } from "./developerUpdateLocale";
import { type Locale } from "./locale";
import { operationSectionIds, type OperationSectionId } from "./OperationsNavigator";
import { operationsNavigatorText } from "./operationsNavigatorLocale";

interface PaletteCommand {
  category: "section" | "action";
  description: string;
  id: string;
  label: string;
  run: () => void;
}

export interface CommandPaletteProps {
  busy: boolean;
  locale: Locale;
  onChooseWorkspace?: () => void;
  onClose: () => void;
  onFilterChecks: (filter: "all" | "problems") => void;
  onNavigate: (sectionId: OperationSectionId) => void;
  onRefresh: () => void;
  returnFocusTo?: HTMLElement | null;
}

const normalizeSearch = (value: string) => value
  .normalize("NFKD")
  .replace(/\p{Diacritic}/gu, "")
  .toLocaleLowerCase();

export function CommandPalette({ busy, locale, onChooseWorkspace, onClose, onFilterChecks, onNavigate, onRefresh, returnFocusTo }: CommandPaletteProps) {
  const labels = commandPaletteText(locale);
  const sections = operationsNavigatorText(locale);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(returnFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const sectionLabels: Record<OperationSectionId, string> = {
    "developer-overview": sections.overview,
    "developer-update-center": developerUpdateText(locale).nav,
    "release-evidence-center": sections.evidence,
    "release-approval-center": sections.approval,
    "release-handoff-center": sections.handoff,
    "quality-evidence-center": sections.quality,
    "bundle-performance-center": sections.performance,
    "dependency-center": sections.dependencies,
    "capability-security-center": capabilitySecurityText(locale).nav,
    "build-environment-center": buildEnvironmentText(locale).nav,
    "release-gates": sections.gates,
  };

  const commands: PaletteCommand[] = operationSectionIds.map((sectionId) => ({
    category: "section",
    description: labels.openSection.replace("{section}", sectionLabels[sectionId]),
    id: sectionId,
    label: sectionLabels[sectionId],
    run: () => onNavigate(sectionId),
  }));
  commands.push(
    { category: "action", description: labels.refreshHint, id: "refresh", label: labels.refresh, run: onRefresh },
    { category: "action", description: labels.showProblemsHint, id: "show-problems", label: labels.showProblems, run: () => onFilterChecks("problems") },
    { category: "action", description: labels.showAllHint, id: "show-all", label: labels.showAll, run: () => onFilterChecks("all") },
  );
  if (onChooseWorkspace) commands.push({ category: "action", description: labels.chooseWorkspaceHint, id: "choose-workspace", label: labels.chooseWorkspace, run: onChooseWorkspace });

  const normalizedQuery = normalizeSearch(query.trim());
  const filtered = normalizedQuery
    ? commands.filter((command) => normalizeSearch(`${command.label} ${command.description}`).includes(normalizedQuery))
    : commands;
  const selectedIndex = filtered.length === 0 ? -1 : Math.min(activeIndex, filtered.length - 1);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => setActiveIndex(0), [query]);

  const execute = (command: PaletteCommand | undefined) => {
    if (!command || busy) return;
    command.run();
    onClose();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown" && filtered.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % filtered.length);
      return;
    }
    if (event.key === "ArrowUp" && filtered.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + filtered.length) % filtered.length);
      return;
    }
    if (event.key === "Home" && filtered.length > 0) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === "End" && filtered.length > 0) {
      event.preventDefault();
      setActiveIndex(filtered.length - 1);
      return;
    }
    if (event.key === "Enter" && document.activeElement === inputRef.current) {
      event.preventDefault();
      execute(filtered[selectedIndex]);
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)")];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return <div className="command-palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title" aria-describedby="command-palette-intro" onKeyDown={handleKeyDown}>
      <header>
        <div><span className="kicker">D25 · KEYBOARD COMMAND CENTER</span><h2 id="command-palette-title">{labels.title}</h2><p id="command-palette-intro">{labels.intro}</p></div>
        <button type="button" className="command-palette-close" aria-label={labels.close} onClick={onClose}>×</button>
      </header>
      <label className="command-palette-search">
        <span className="sr-only">{labels.searchLabel}</span>
        <span aria-hidden="true">⌕</span>
        <input ref={inputRef} type="search" aria-label={labels.searchLabel} placeholder={labels.searchPlaceholder} value={query} onChange={(event) => setQuery(event.target.value)} aria-controls="command-palette-results" />
        <kbd>{labels.shortcut}</kbd>
      </label>
      <div className="command-palette-count" role="status" aria-live="polite">{labels.resultCount.replace("{count}", String(filtered.length))}</div>
      <div id="command-palette-results" className="command-palette-results">
        {filtered.length === 0 ? <p className="command-palette-empty">{labels.noResults}</p> : filtered.map((command, index) => <button
          type="button"
          key={command.id}
          className={index === selectedIndex ? "active" : ""}
          data-command-id={command.id}
          disabled={busy}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => execute(command)}
        >
          <span className="command-palette-category">{command.category === "section" ? labels.sectionGroup : labels.actionGroup}</span>
          <strong>{command.label}</strong>
          <small>{command.description}</small>
          <span className="command-palette-enter" aria-hidden="true">↵</span>
        </button>)}
      </div>
    </div>
  </div>;
}
