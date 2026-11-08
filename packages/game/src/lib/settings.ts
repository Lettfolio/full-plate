import { useSyncExternalStore } from "react";

/** Player preferences (not part of the save). Stored in localStorage; every read/write survives blocked storage. */
export interface Settings {
  /** Pause automatically when an incident starts at 1x/2x (at 4x a toast is shown instead). */
  autoPause: boolean;
  /** Speed a service starts at. */
  defaultSpeed: 1 | 2 | 4;
}

export const SETTINGS_KEY = "full-plate:settings:v1";
export const DEFAULT_SETTINGS: Settings = { autoPause: true, defaultSpeed: 1 };

function read(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      autoPause: typeof p.autoPause === "boolean" ? p.autoPause : DEFAULT_SETTINGS.autoPause,
      defaultSpeed: p.defaultSpeed === 1 || p.defaultSpeed === 2 || p.defaultSpeed === 4 ? p.defaultSpeed : DEFAULT_SETTINGS.defaultSpeed,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current: Settings | null = null;
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  if (!current) current = typeof window === "undefined" ? DEFAULT_SETTINGS : read();
  return current;
}

export function setSettings(patch: Partial<Settings>): void {
  current = { ...getSettings(), ...patch };
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(current)); } catch { /* storage blocked: keep in memory */ }
  for (const l of listeners) l();
}

/** For tests: forget the cached value so the next read goes back to storage. */
export function resetSettingsCache(): void {
  current = null;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const s = useSyncExternalStore(subscribe, getSettings, () => DEFAULT_SETTINGS);
  return [s, setSettings];
}
