import { useEffect, useState } from "react";
import { DEFAULT_SERVER_ICON } from "../lib/serverIcons";

export function ServerIcon({ source, className, alt = "" }: { source?: string; className?: string; alt?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  return <img src={!failed && source ? source : DEFAULT_SERVER_ICON} alt={alt} className={className} onError={() => setFailed(true)} />;
}
