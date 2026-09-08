import { useEffect, useState } from "react";
import { backend } from "../lib/backend";
import type { ServerProfile, TabId } from "../types";
import { Icon } from "./Icon";

interface Step { id: string; label: string; detail: string; done: boolean; action: string; }

export function NextStepsCard({ server, onNavigate, onInvite }: { server: ServerProfile; onNavigate: (tab: TabId) => void; onInvite: () => void }) {
  const [steps, setSteps] = useState<Step[]>();
  const [hidden, setHidden] = useState(() => localStorage.getItem(`server-hub:next-steps:hidden:${server.id}`) === "1");
  useEffect(() => {
    let active = true;
    Promise.all([
      backend.playerAccess(server.id, "operators"),
      backend.tunnelStatus(server.id).catch(() => undefined),
      backend.getAutomationSettings(server.id),
    ]).then(([operators, tunnel, automation]) => {
      if (!active) return;
      setSteps([
        { id: "whitelist", label: "ホワイトリストを有効にする", detail: "知らない人が参加できないようにします。", done: server.settings.whitelist, action: "players" },
        { id: "operator", label: "自分をOPへ登録する", detail: "ゲーム内で管理コマンドを使えるようにします。", done: operators.length > 0, action: "players" },
        { id: "invite", label: "友達の参加方法を確認する", detail: "別の家から参加するアドレスを準備します。", done: Boolean(tunnel?.publicEndpoint), action: "invite" },
        { id: "automation", label: "0人時の自動停止を選ぶ", detail: "必要なら30分で安全停止できます。", done: automation.autoStopEnabled, action: "operations" },
      ]);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [server.id, server.settings.whitelist]);
  if (hidden) return null;
  const done = steps?.filter((step) => step.done).length ?? 0;
  return <section className="next-steps-card">
    <header><div><span className="section-kicker">BEGINNER GUIDE</span><h2>次にやること</h2><p>サーバー作成後のおすすめ設定を順番に案内します。</p></div><div className="next-progress"><strong>{done} / {steps?.length ?? 4}</strong><button type="button" className="icon-button" aria-label="次にやることを閉じる" onClick={() => { localStorage.setItem(`server-hub:next-steps:hidden:${server.id}`, "1"); setHidden(true); }}><Icon name="close" size={18}/></button></div></header>
    <div className="next-step-list">{steps?.map((step) => <button type="button" key={step.id} className={step.done ? "done" : ""} onClick={() => step.action === "invite" ? onInvite() : onNavigate(step.action as TabId)}><span className="step-check"><Icon name="check" size={15}/></span><span><strong>{step.label}</strong><small>{step.done ? "完了" : step.detail}</small></span><Icon name="chevron" size={17}/></button>) ?? <div className="panel-empty compact"><span className="spinner"/><p>おすすめ設定を確認しています</p></div>}</div>
  </section>;
}
