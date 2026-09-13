const STORAGE_KEY = "server-hub:app-update:v1";
const CURRENT_BRAND_MARKER_KEY = "server-hub:brand-state:v1";
const EXISTING_FRONTEND_STATE_KEYS = [
  "server-hub:language:v1",
  "server-hub:theme:v1",
  "server-hub:appearance:v1",
  "server-hub:appearance:v2",
  "server-hub:server-icons:v1",
  STORAGE_KEY,
] as const;

export type AppUpdatePreferences = {
  autoCheck: boolean;
  endpoint: string;
  migrationNoticeDismissed?: boolean;
};

export const defaultAppUpdatePreferences: AppUpdatePreferences = {
  autoCheck: true,
  endpoint: "",
};

export function readAppUpdatePreferences(): AppUpdatePreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<AppUpdatePreferences> | null;
    const preferences: AppUpdatePreferences = {
      autoCheck: parsed?.autoCheck !== false,
      endpoint: typeof parsed?.endpoint === "string" ? parsed.endpoint.trim() : "",
    };
    if (parsed?.migrationNoticeDismissed === true) preferences.migrationNoticeDismissed = true;
    return preferences;
  } catch {
    return defaultAppUpdatePreferences;
  }
}

export function storeAppUpdatePreferences(preferences: AppUpdatePreferences) {
  const current = readAppUpdatePreferences();
  const migrationNoticeDismissed = preferences.migrationNoticeDismissed ?? current.migrationNoticeDismissed;
  const next: Record<string, boolean | string> = {
    autoCheck: preferences.autoCheck,
    endpoint: preferences.endpoint.trim(),
  };
  if (migrationNoticeDismissed === true) next.migrationNoticeDismissed = true;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

/**
 * The old app did not persist its package version in the frontend.  We can
 * therefore only opt existing frontend state into the one-time notice.  A
 * fresh install with no prior app settings is deliberately excluded.
 */
export function hasExistingFrontendState() {
  if (typeof window === "undefined") return false;
  return EXISTING_FRONTEND_STATE_KEYS.some((key) => localStorage.getItem(key) !== null);
}

export function shouldShowMigrationNotice(isDesktop: boolean) {
  if (!isDesktop || typeof window === "undefined") return false;
  if (localStorage.getItem(CURRENT_BRAND_MARKER_KEY) === "tomo-node") return false;
  if (!hasExistingFrontendState()) {
    // Record a fresh TomoNode launch in the existing frontend storage area so
    // its automatically-created settings cannot look like an old install on
    // the next launch.
    localStorage.setItem(CURRENT_BRAND_MARKER_KEY, "tomo-node");
    return false;
  }
  return hasExistingFrontendState() && readAppUpdatePreferences().migrationNoticeDismissed !== true;
}

export function dismissMigrationNotice() {
  const current = readAppUpdatePreferences();
  storeAppUpdatePreferences({ ...current, migrationNoticeDismissed: true });
  localStorage.setItem(CURRENT_BRAND_MARKER_KEY, "tomo-node");
}

export function isValidUpdateEndpoint(value: string) {
  if (!value.trim()) return true;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}
