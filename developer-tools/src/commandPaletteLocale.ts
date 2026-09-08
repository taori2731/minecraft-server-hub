import { getLocalePack, type Locale } from "./locale";

export interface CommandPaletteText {
  title: string;
  intro: string;
  open: string;
  close: string;
  searchLabel: string;
  searchPlaceholder: string;
  shortcut: string;
  sectionGroup: string;
  actionGroup: string;
  openSection: string;
  refresh: string;
  refreshHint: string;
  showProblems: string;
  showProblemsHint: string;
  showAll: string;
  showAllHint: string;
  chooseWorkspace: string;
  chooseWorkspaceHint: string;
  noResults: string;
  resultCount: string;
}

export const commandPaletteText = (locale: Locale): CommandPaletteText => getLocalePack(locale).commandPalette as unknown as CommandPaletteText;
