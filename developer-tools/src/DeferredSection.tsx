import { Component, type ErrorInfo, type ReactNode, useEffect, useRef, useState } from "react";
import { deferredText } from "./deferredLocale";
import type { Locale } from "./locale";

interface DeferredSectionProps {
  children: ReactNode;
  eager?: boolean;
  forceActive?: boolean;
  label: string;
  locale: Locale;
  minHeight?: number;
  onContentReady?: (sectionId: string) => void;
  sectionId?: string;
}

interface BoundaryProps {
  children: ReactNode;
  label: string;
  locale: Locale;
}

interface BoundaryState {
  failed: boolean;
}

export class DeferredSectionBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // The localized boundary keeps the rest of the inspection available.
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const labels = deferredText(this.props.locale);
    return <section className="panel deferred-section-error" role="alert">
      <strong>{labels.failed.replace("{section}", this.props.label)}</strong>
      <p>{labels.failedHint}</p>
      <button type="button" onClick={() => window.location.reload()}>{labels.reload}</button>
    </section>;
  }
}

export function DeferredPanelFallback({ label, locale }: Pick<DeferredSectionProps, "label" | "locale">) {
  const labels = deferredText(locale);
  return <section className="panel deferred-section-placeholder" role="status" aria-label={labels.loading.replace("{section}", label)}>
    <span className="deferred-spinner" aria-hidden="true" />
    <div><strong>{labels.loading.replace("{section}", label)}</strong><p>{labels.loadingHint}</p></div>
  </section>;
}

export function DeferredSection({ children, eager = false, forceActive = false, label, locale, minHeight = 420, onContentReady, sectionId }: DeferredSectionProps) {
  const host = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => eager || forceActive || typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (eager || forceActive) {
      setActive(true);
      return;
    }
    if (active || !host.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setActive(true);
      observer.disconnect();
    }, { rootMargin: "800px 0px" });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [active, eager, forceActive]);

  useEffect(() => {
    if (!active || !forceActive || !host.current || !onContentReady || !sectionId) return;
    let frame = 0;
    const notifyReady = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => onContentReady(sectionId));
    };
    notifyReady();
    if (typeof ResizeObserver === "undefined") return () => window.cancelAnimationFrame(frame);
    const observer = new ResizeObserver(notifyReady);
    observer.observe(host.current);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [active, forceActive, onContentReady, sectionId]);

  return <div
    ref={host}
    id={sectionId}
    className="deferred-section-host"
    style={{ minHeight: active ? undefined : minHeight }}
    tabIndex={sectionId ? -1 : undefined}
    aria-label={sectionId ? label : undefined}
    data-deferred-active={active ? "true" : "false"}
  >
    {active
      ? <DeferredSectionBoundary label={label} locale={locale}>{children}</DeferredSectionBoundary>
      : <DeferredPanelFallback label={label} locale={locale} />}
  </div>;
}
