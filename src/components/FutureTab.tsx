import type { IconName } from "./Icon";
import { Icon } from "./Icon";

export function FutureTab({ icon, title, description, phase }: { icon: IconName; title: string; description: string; phase: string }) {
  return <div className="tab-content future-tab"><div><Icon name={icon} size={38} /><h2>{title}</h2><p>{description}</p><span>{phase}で実装</span></div></div>;
}

