import type { ReactNode } from "react";

export type Status = "available" | "conditional" | "developing" | "planned" | "preparing";
const statusLabels: Record<Status, string> = { available: "実装済み", conditional: "条件付き", developing: "開発中", planned: "対応予定", preparing: "準備中" };

export function StatusTag({ status, children }: { status: Status; children?: ReactNode }) {
  return <span className={`status-tag status-${status}`}>{children ?? statusLabels[status]}</span>;
}

export function SectionHeading({ id, title, description, align = "left" }: { id?: string; title: string; description: string; align?: "left" | "center" }) {
  return <div className={`section-heading section-heading-${align}`}><h2 id={id}>{title}</h2><p>{description}</p></div>;
}
