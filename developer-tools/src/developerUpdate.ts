const STORAGE_KEY = "msh-developer-tools:update-preferences:v1";

export interface DeveloperUpdatePreferences {
  autoCheck: boolean;
}

export const defaultDeveloperUpdatePreferences: DeveloperUpdatePreferences = { autoCheck: true };

export function readDeveloperUpdatePreferences(): DeveloperUpdatePreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<DeveloperUpdatePreferences> | null;
    return { autoCheck: parsed?.autoCheck !== false };
  } catch {
    return defaultDeveloperUpdatePreferences;
  }
}

export function storeDeveloperUpdatePreferences(preferences: DeveloperUpdatePreferences): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ autoCheck: preferences.autoCheck }));
}

export function updateErrorCode(reason: unknown): string {
  const value = reason instanceof Error ? reason.message : String(reason);
  const match = value.match(/developer-update-[a-z-]+/);
  return match?.[0] ?? "developer-update-unknown";
}
