import { useEffect, useMemo, useState } from "react";
import { developerBackend } from "./developerBackend";
import { readDeveloperUpdatePreferences, storeDeveloperUpdatePreferences, updateErrorCode } from "./developerUpdate";
import { developerUpdateText } from "./developerUpdateLocale";
import type { Locale } from "./locale";
import type { DeveloperUpdateInfo, DeveloperUpdateProgress } from "./types";

function formatSize(bytes: number, locale: Locale): string {
  if (bytes >= 1024 ** 2) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1024 ** 2)} MiB`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.max(0, bytes / 1024))} KiB`;
}

function localizedError(locale: Locale, reason: unknown): string {
  const labels = developerUpdateText(locale);
  const messages: Record<string, string> = {
    "developer-update-feed-invalid": labels.errorFeedInvalid,
    "developer-update-check-failed": labels.errorCheckFailed,
    "developer-update-download-failed": labels.errorDownloadFailed,
    "developer-update-install-failed": labels.errorInstallFailed,
    "developer-update-not-available": labels.errorNotAvailable,
    "developer-update-version-changed": labels.errorVersionChanged,
    "developer-update-not-confirmed": labels.errorNotConfirmed,
    "developer-update-native-only": labels.errorNativeOnly,
  };
  return messages[updateErrorCode(reason)] ?? labels.errorUnknown;
}

export function formatPublishedAt(value: string, locale: Locale): string {
  const numericTimestamp = /^\d{9,}$/.test(value) ? Number(value) * 1000 : Number.NaN;
  const date = new Date(Number.isFinite(numericTimestamp) ? numericTimestamp : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale);
}

export function DeveloperUpdateCenter({ locale, startupInfo, onInfoChange }: {
  locale: Locale;
  startupInfo?: DeveloperUpdateInfo;
  onInfoChange?: (info: DeveloperUpdateInfo) => void;
}) {
  const labels = developerUpdateText(locale);
  const initialPreferences = useMemo(readDeveloperUpdatePreferences, []);
  const [autoCheck, setAutoCheck] = useState(initialPreferences.autoCheck);
  const [currentVersion, setCurrentVersion] = useState(startupInfo?.currentVersion ?? "0.3.1");
  const [info, setInfo] = useState<DeveloperUpdateInfo | undefined>(startupInfo);
  const [busy, setBusy] = useState<"check" | "install" | "">("");
  const [progress, setProgress] = useState<DeveloperUpdateProgress>();
  const [approved, setApproved] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    developerBackend.getDeveloperToolsVersion().then((version) => {
      if (active) setCurrentVersion(version);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (startupInfo) {
      setInfo(startupInfo);
      setCurrentVersion(startupInfo.currentVersion);
    }
  }, [startupInfo]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen<DeveloperUpdateProgress>("developer-update-progress", (event) => {
        if (!disposed) setProgress(event.payload);
      }))
      .then((stop) => { if (disposed) stop(); else unlisten = stop; })
      .catch(() => undefined);
    return () => { disposed = true; unlisten?.(); };
  }, []);

  const changeAutoCheck = (checked: boolean) => {
    setAutoCheck(checked);
    storeDeveloperUpdatePreferences({ autoCheck: checked });
    setMessage(labels.settingsSaved);
  };

  const check = async () => {
    setBusy("check");
    setError("");
    setMessage("");
    setApproved(false);
    setProgress(undefined);
    try {
      const next = await developerBackend.checkDeveloperUpdate();
      setInfo(next);
      setCurrentVersion(next.currentVersion);
      onInfoChange?.(next);
    } catch (reason) {
      setError(localizedError(locale, reason));
    } finally {
      setBusy("");
    }
  };

  const install = async () => {
    if (!info?.available || !info.version || !approved) {
      setError(labels.errorNotConfirmed);
      return;
    }
    setBusy("install");
    setError("");
    setMessage("");
    setProgress({ phase: "downloading", downloadedBytes: 0 });
    try {
      await developerBackend.installDeveloperUpdate(info.version, true);
      setMessage(labels.updateStarted);
    } catch (reason) {
      setBusy("");
      setError(localizedError(locale, reason));
    }
  };

  const progressPercent = progress?.totalBytes
    ? Math.min(100, progress.downloadedBytes / progress.totalBytes * 100)
    : undefined;
  const progressText = progress?.phase === "verifying"
    ? labels.verifying
    : progress?.totalBytes
      ? labels.downloadProgress.replace("{downloaded}", formatSize(progress.downloadedBytes, locale)).replace("{total}", formatSize(progress.totalBytes, locale))
      : labels.downloadProgressUnknown.replace("{downloaded}", formatSize(progress?.downloadedBytes ?? 0, locale));

  return <section className="panel developer-update-center" aria-labelledby="developer-update-title">
    <div className="panel-heading developer-update-heading">
      <div><span className="kicker">{labels.kicker}</span><h2 id="developer-update-title">{labels.title}</h2><p>{labels.intro}</p></div>
      <span className="developer-update-version"><small>{labels.currentVersion}</small><strong>{info?.currentVersion ?? currentVersion}</strong></span>
    </div>

    <div className="developer-update-completion" role="status">
      <span aria-hidden="true">✓</span>
      <div><small>{labels.completionKicker}</small><strong>{labels.completionTitle}</strong><p>{labels.completionDescription}</p></div>
      <strong>{labels.completionMaintenance}</strong>
    </div>

    <div className="developer-update-settings">
      <label className="developer-update-toggle"><input type="checkbox" checked={autoCheck} onChange={(event) => changeAutoCheck(event.target.checked)} /><span><strong>{labels.autoCheck}</strong><small>{labels.autoCheckHelp}</small></span></label>
      <div className="developer-update-feed"><span aria-hidden="true">✓</span><div><strong>{labels.officialFeed}</strong><small>{labels.officialFeedHelp}</small><code>{info?.endpoint ?? "https://raw.githubusercontent.com/taori2731/minecraft-server-hub-releases/main/developer-tools/latest.json"}</code></div></div>
      <button className="developer-update-check" type="button" onClick={() => void check()} disabled={busy !== ""}>{busy === "check" ? labels.checking : labels.check}</button>
    </div>

    {info ? <article className={`developer-update-result ${info.available ? "available" : "current"}`}>
      <span className="developer-update-result-icon" aria-hidden="true">{info.available ? "↓" : "✓"}</span>
      <div className="developer-update-result-copy">
        <strong>{info.available && info.version ? `${labels.available} · ${info.version}` : labels.upToDate}</strong>
        {info.publishedAt ? <small>{labels.publishedAt}: {formatPublishedAt(info.publishedAt, locale)}</small> : null}
        {info.notes ? <><span>{labels.releaseNotes}</span><pre>{info.notes}</pre></> : null}
        {info.available ? <label className="developer-update-consent"><input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} /><span><strong>{labels.reviewConsent}</strong><small>{labels.reviewConsentHelp}</small></span></label> : null}
      </div>
      {info.available ? <button className="developer-update-install" type="button" disabled={!approved || busy !== "" || !developerBackend.isDesktop} onClick={() => void install()}>{busy === "install" ? labels.installing : labels.install}</button> : null}
    </article> : null}

    {busy === "install" ? <div className="developer-update-progress" role="status" aria-live="polite"><div className={progressPercent === undefined ? "indeterminate" : ""} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent === undefined ? undefined : Math.round(progressPercent)}><span style={progressPercent === undefined ? undefined : { width: `${progressPercent}%` }} /></div><span>{progressText}</span></div> : null}
    {error ? <div className="developer-update-error" role="alert"><strong>{labels.errorTitle}</strong><span>{error}</span><small>{labels.failureSafe}</small></div> : null}
    {message ? <p className="developer-update-message" role="status">{message}</p> : null}
    {!developerBackend.isDesktop ? <p className="developer-update-browser-note">{labels.browserOnly}</p> : null}
    <aside className="developer-update-safety"><strong>{labels.failureSafe}</strong><span>{labels.privacy}</span></aside>
  </section>;
}
