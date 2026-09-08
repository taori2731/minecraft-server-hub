import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

export async function openExternalUrl(value: string) {
  const url = new URL(value, window.location.href);
  if (url.protocol !== "https:") throw new Error("安全のためHTTPSの公式ページだけを開けます");
  if (isTauriRuntime()) {
    await openUrl(url.toString());
    return;
  }
  const opened = window.open(url.toString(), "_blank", "noopener,noreferrer");
  if (!opened) throw new Error("ブラウザでページを開けませんでした。ポップアップ許可を確認してください");
}

export function ExternalLinkHandler({ onError }: { onError: (message: string) => void }) {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>('a[target="_blank"]');
      if (!anchor) return;
      event.preventDefault();
      void openExternalUrl(anchor.href).catch((error) => onError(String(error)));
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [onError]);
  return null;
}
