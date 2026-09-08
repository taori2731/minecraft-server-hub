const STORAGE_KEY = "server-hub:app-update:v1";

export type AppUpdatePreferences = {
  autoCheck: boolean;
  endpoint: string;
};

export const defaultAppUpdatePreferences: AppUpdatePreferences = {
  autoCheck: true,
  endpoint: "",
};

export function readAppUpdatePreferences(): AppUpdatePreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<AppUpdatePreferences> | null;
    return {
      autoCheck: parsed?.autoCheck !== false,
      endpoint: typeof parsed?.endpoint === "string" ? parsed.endpoint.trim() : "",
    };
  } catch {
    return defaultAppUpdatePreferences;
  }
}

export function storeAppUpdatePreferences(preferences: AppUpdatePreferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    autoCheck: preferences.autoCheck,
    endpoint: preferences.endpoint.trim(),
  }));
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
