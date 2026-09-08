import { useEffect, useMemo, useState } from "react";
import { backend, confirmDanger } from "../lib/backend";
import { appUpdateOfficialFeedText, appUpdateText } from "../lib/appUpdateLocale";
import { isValidUpdateEndpoint, readAppUpdatePreferences, storeAppUpdatePreferences } from "../lib/appUpdate";
import { useI18n } from "../lib/i18n";
import type { AppUpdateInfo, AppUpdateProgress } from "../types";
import { Icon } from "./Icon";

function size(bytes: number) {
  return bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${Math.max(0, Math.round(bytes / 1024))} KiB`;
}

export function AppUpdatePanel({ hasActiveServers, notify, fail }: { hasActiveServers: boolean; notify: (message: string) => void; fail: (message: string) => void }) {
  const { locale } = useI18n();
  const text = (key: Parameters<typeof appUpdateText>[1], values: Record<string, string | number> = {}) => appUpdateText(locale, key, values);
  const initial = useMemo(readAppUpdatePreferences, []);
  const [autoCheck, setAutoCheck] = useState(initial.autoCheck);
  const [endpoint, setEndpoint] = useState(initial.endpoint);
  const [info, setInfo] = useState<AppUpdateInfo>();
  const [currentVersion, setCurrentVersion] = useState("—");
  const [busy, setBusy] = useState<"check" | "install" | "">("");
  const [progress, setProgress] = useState<AppUpdateProgress>();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const endpointValid = isValidUpdateEndpoint(endpoint);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen<AppUpdateProgress>("app-update-progress", (event) => {
        if (!disposed) setProgress(event.payload);
      }))
      .then((stop) => { if (disposed) stop(); else unlisten = stop; })
      .catch(() => undefined);
    return () => { disposed = true; unlisten?.(); };
  }, []);

  useEffect(() => {
    let active = true;
    backend.getAppVersion().then((version) => { if (active) setCurrentVersion(version); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const save = () => {
    if (!endpointValid) { setAdvancedOpen(true); fail(text("endpointInvalid")); return; }
    storeAppUpdatePreferences({ autoCheck, endpoint });
    notify(text("settingsSaved"));
  };

  const check = async () => {
    if (!endpointValid) { setAdvancedOpen(true); fail(text("endpointInvalid")); return; }
    storeAppUpdatePreferences({ autoCheck, endpoint });
    setBusy("check");
    setProgress(undefined);
    try { setInfo(await backend.checkAppUpdate(endpoint)); }
    catch (reason) { fail(String(reason)); }
    finally { setBusy(""); }
  };

  const install = async () => {
    if (!info?.available || !info.version) return;
    if (hasActiveServers) { fail(text("stopServers")); return; }
    if (!await confirmDanger(text("consent", { version: info.version }))) return;
    setBusy("install");
    setProgress({ phase: "downloading", downloadedBytes: 0 });
    try { await backend.installAppUpdate(info.version, endpoint); }
    catch (reason) { setBusy(""); fail(`${String(reason)}\n${text("failureSafe")}`); }
  };

  const progressText = progress?.phase === "verified"
    ? text("verified")
    : progress?.totalBytes
      ? text("downloadProgress", { downloaded: size(progress.downloadedBytes), total: size(progress.totalBytes) })
      : text("downloadProgressUnknown", { downloaded: size(progress?.downloadedBytes ?? 0) });
  const progressPercent = progress?.totalBytes ? Math.min(100, progress.downloadedBytes / progress.totalBytes * 100) : undefined;

  return <>
    <span className="section-kicker">SIGNED APP UPDATE</span>
    <h3>{text("title")}</h3>
    <p>{text("intro")}</p>
    <div className="app-update-card">
      <div className="app-update-current"><span>{text("currentVersion")}</span><strong>{info?.currentVersion ?? currentVersion}</strong></div>
      <label className="switch-row"><input type="checkbox" checked={autoCheck} onChange={(event) => setAutoCheck(event.target.checked)} /><span><b>{text("autoCheck")}</b><small>{text("signed")}</small></span></label>
      <div className={`app-update-channel${endpoint.trim() ? " custom" : ""}`}><Icon name={endpoint.trim() ? "gear" : "check"} size={19} /><span><b>{text("feedMode")}</b><small>{endpoint.trim() ? text("customFeedActive") : appUpdateOfficialFeedText(locale)}</small></span></div>
      <button className="app-update-advanced-toggle" type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen((open) => !open)}><Icon name="gear" size={17} /><span>{text("advancedOptions")}</span><Icon className="app-update-advanced-chevron" name="chevron" size={16} /></button>
      {advancedOpen ? <div className="app-update-advanced">
        <p><Icon name="info" size={16} />{text("advancedHelp")}</p>
        <label className="app-update-feed"><span>{text("feedUrl")}</span><input aria-label={text("feedUrl")} value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://…/latest.json" aria-invalid={!endpointValid} /><small>{!endpointValid ? text("endpointInvalid") : text("feedHelp")}</small></label>
        <button className="secondary-button" type="button" onClick={() => setEndpoint("")} disabled={!endpoint.trim() || busy !== ""}><Icon name="restart" size={16} />{text("useOfficialFeed")}</button>
      </div> : null}
      <div className="app-update-actions"><button className="secondary-button" type="button" onClick={save} disabled={busy !== ""}><Icon name="check" size={17} />{text("saveFeed")}</button><button className="primary-button" type="button" onClick={check} disabled={busy !== ""}><Icon name="restart" size={17} />{busy === "check" ? text("checking") : text("check")}</button></div>
    </div>
    {info ? <div className={`app-update-result${info.available ? " available" : ""}`}>
      <Icon name={info.available ? "download" : "check"} size={26} />
      <div><strong>{!info.configured ? text("notConfigured") : info.available ? `${text("available")} · ${info.version}` : text("latest")}</strong>{info.publishedAt ? <small>{text("publishedAt")}: {info.publishedAt}</small> : null}{info.notes ? <><span>{text("releaseNotes")}</span><pre>{info.notes}</pre></> : null}{!info.configured ? <small>{text("configureLater")}</small> : null}</div>
      {info.available ? <button className="primary-button" type="button" disabled={busy !== "" || hasActiveServers || !backend.isDesktop} onClick={install}><Icon name="download" size={17} />{busy === "install" ? text("installing") : text("install")}</button> : null}
    </div> : null}
    {hasActiveServers ? <p className="app-update-warning"><Icon name="info" size={16} />{text("stopServers")}</p> : null}
    {!backend.isDesktop ? <p className="app-update-warning"><Icon name="info" size={16} />{text("browserOnly")}</p> : null}
    {busy === "install" ? <div className="app-update-download" role="status" aria-live="polite"><div className={`operation-progress-track${progressPercent === undefined ? " indeterminate" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent === undefined ? undefined : Math.round(progressPercent)}><span style={progressPercent === undefined ? undefined : { width: `${progressPercent}%` }} /></div><span>{progressText}</span></div> : null}
    <p className="privacy-note"><Icon name="info" size={16} />{text("failureSafe")}</p>
  </>;
}
