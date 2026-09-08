import { useEffect, useRef, useState } from "react";
import { backend } from "../lib/backend";
import { useI18n } from "../lib/i18n";
import { palworldInviteText } from "../lib/palworldInviteLocale";
import type { PublicAccessStatus, ServerProfile, TunnelStatus } from "../types";
import { Icon } from "./Icon";

type Props = { server: ServerProfile; onClose: () => void; notify: (message: string) => void };
export function PalworldInviteDialog({ server, onClose, notify }: Props) {
  const { locale } = useI18n();
  const text = (key: Parameters<typeof palworldInviteText>[1]) => palworldInviteText(locale, key, `127.0.0.1:${server.port}`);
  const [publication, setPublication] = useState<PublicAccessStatus>();
  const [tunnel, setTunnel] = useState<TunnelStatus>();
  const [relay, setRelay] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    let polling = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try {
        const [next, nextTunnel] = await Promise.all([backend.publicAccessStatus(server.id), backend.tunnelStatus(server.id)]);
        if (mounted.current) { setPublication(next); setTunnel(nextTunnel); }
      } catch (reason) { if (mounted.current) setError(String(reason)); }
      finally { polling = false; }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, [server.id]);

  const ready = async () => {
    let runtime = await backend.status(server.id);
    if (["stopped", "crashed"].includes(runtime.state)) await backend.start(server.id);
    const deadline = Date.now() + 120_000;
    while (mounted.current && Date.now() < deadline) {
      runtime = await backend.status(server.id);
      if (runtime.state === "running" && runtime.palworld?.apiReachable) return;
      if (runtime.state === "crashed") break;
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    }
    throw new Error(text("timeout"));
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await action(); } catch (reason) { if (mounted.current) setError(String(reason)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const connectRelay = async () => {
    await ready();
    const plan = await backend.tunnelAgentInstallPlan(server.id);
    if (!plan.alreadyInstalled) await backend.installTunnelAgent({ serverId: server.id, version: plan.version, sourceUrl: plan.sourceUrl, sizeBytes: plan.sizeBytes, checksumSha256: plan.checksumSha256 });
    const next = await backend.quickStartPalworldTunnel({ serverId: server.id, termsAccepted: consent || Boolean(tunnel?.termsAcknowledged) });
    setTunnel(next);
    if (!next.publicEndpoint) {
      try { await backend.openTunnelAccountLogin(server.id); }
      catch { await backend.openTunnelDashboard(server.id); }
    }
  };
  const prepare = () => run(async () => {
    await ready();
    try { setPublication(await backend.publishPalworldUpnp(server.id)); }
    catch {
      setRelay(true);
      if (tunnel?.termsAcknowledged) await connectRelay();
    }
  });
  const prepareRelay = () => run(connectRelay);
  const stop = () => run(async () => {
    // Attempt both cleanups even if either provider reports a failure.
    const results = await Promise.allSettled([backend.unpublishServer(server.id), backend.stopTunnel(server.id)]);
    if (results[0].status === "fulfilled") setPublication(results[0].value);
    if (results[1].status === "fulfilled") {
      setTunnel(results[1].value);
      if (!["disconnected", "unconfigured"].includes(results[1].value.state)) setError(text("stopHelp"));
    }
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  });
  const endpoint = publication?.address ?? (tunnel?.matchingTunnel ? tunnel.publicEndpoint : undefined);
  const active = Boolean(publication?.address || (tunnel && !["unconfigured", "disconnected", "error"].includes(tunnel.state)));
  const copy = (address: string) => run(async () => { await navigator.clipboard.writeText(address); notify(text("copy")); });
  return <div className="modal-backdrop"><section className="wizard invite-dialog" role="dialog" aria-modal="true" aria-labelledby="palworld-invite-title">
    <header className="wizard-header"><div><p className="wizard-kicker">PALWORLD</p><h2 id="palworld-invite-title">{text("title")}</h2></div><button className="icon-button" disabled={busy} onClick={onClose} aria-label={text("close")}><Icon name="close" /></button></header>
    <div className="wizard-body invite-body">
      <p>{text("intro")}</p><p className="inline-warning">{text("privacy")}</p>
      {error ? <p role="alert" className="inline-warning">{error}</p> : null}
      <button className="primary-button" disabled={busy || Boolean(endpoint)} onClick={() => void prepare()}>{busy ? text("working") : text("start")}</button>
      <section className="feature-panel" style={{ padding: 20 }}><h3>{text("friend")}</h3><strong>{endpoint ?? text("stopped")}</strong>{endpoint ? <><p>{text("verify")}</p><button className="small-button" disabled={busy} onClick={() => void copy(endpoint)}>{text("copy")}</button></> : null}</section>
      <section className="feature-panel" style={{ padding: 20 }}><h3>{text("host")}</h3><code>127.0.0.1:{server.port}</code></section>
      {!endpoint ? <details open={relay || active}><summary>{text("relay")}</summary>
        <p>{text("setupHelp")}</p>
        <p><a href="https://playit.gg/terms/" target="_blank" rel="noreferrer">playit.gg Terms</a> · <a href="https://playit.gg/privacy-policy/" target="_blank" rel="noreferrer">Privacy</a> · <a href="https://github.com/playit-cloud/playit-agent" target="_blank" rel="noreferrer">Official agent</a></p>
        {!tunnel?.termsAcknowledged ? <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />{text("consent")}</label> : null}
        <p><button className="primary-button" disabled={busy || !(consent || tunnel?.termsAcknowledged)} onClick={() => void prepareRelay()}>{text("relay")}</button></p>
        {active ? <button className="secondary-button" disabled={busy} onClick={() => void run(async () => { try { await backend.openTunnelAccountLogin(server.id); } catch { await backend.openTunnelDashboard(server.id); } })}>{text("setup")}</button> : null}
      </details> : null}
      {active ? <button className="danger-button" disabled={busy} onClick={() => void stop()}>{text("stop")}</button> : null}
    </div><footer className="wizard-footer"><button className="secondary-button" disabled={busy} onClick={onClose}>{text("close")}</button></footer>
  </section></div>;
}
