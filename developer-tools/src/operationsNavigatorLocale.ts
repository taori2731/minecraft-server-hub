import { getLocalePack, type Locale } from "./locale";

export interface OperationsNavigatorText {
  title: string;
  intro: string;
  ariaLabel: string;
  overview: string;
  evidence: string;
  approval: string;
  handoff: string;
  quality: string;
  performance: string;
  dependencies: string;
  gates: string;
  jumpedTo: string;
}

export const operationsNavigatorText = (locale: Locale): OperationsNavigatorText => getLocalePack(locale).operationsNavigator as unknown as OperationsNavigatorText;
