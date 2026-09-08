import { useEffect, useState } from "react";
import { backend } from "../lib/backend";

type SkinCacheEntry = { expiresAt: number; request: Promise<string | null> };
const skinCache = new Map<string, SkinCacheEntry>();
const FOUND_SKIN_CACHE_MS = 24 * 60 * 60 * 1000;
const MISSING_SKIN_CACHE_MS = 60 * 1000;

function loadSkin(playerName: string, playerId?: string) {
  const key = `${playerName.toLowerCase()}:${playerId?.toLowerCase() ?? ""}`;
  const cached = skinCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.request;
  const request = backend.playerSkin(playerName, playerId)
    .then((value) => {
      skinCache.set(key, {
        expiresAt: Date.now() + (value ? FOUND_SKIN_CACHE_MS : MISSING_SKIN_CACHE_MS),
        request: Promise.resolve(value),
      });
      return value;
    })
    .catch((failure) => {
      skinCache.delete(key);
      throw failure;
    });
  skinCache.set(key, { expiresAt: Date.now() + MISSING_SKIN_CACHE_MS, request });
  return request;
}

export function PlayerFace({ playerName, playerId, bedrock = false }: { playerName: string; playerId?: string; bedrock?: boolean }) {
  const [skin, setSkin] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (bedrock) { setSkin(null); return () => { active = false; }; }
    setSkin(null);
    loadSkin(playerName, playerId).then((value) => { if (active) setSkin(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [playerName, playerId, bedrock]);
  return <span className="player-face" aria-hidden="true">
    {skin ? <><img className="skin-face-base" src={skin} alt="" /><img className="skin-face-hat" src={skin} alt="" /></> : <span className="skin-face-fallback"><i /><i /><i /></span>}
  </span>;
}
