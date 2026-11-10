import { useSyncExternalStore } from "react";

/** Player preferences (not part of the save). Stored in localStorage; every read/write survives blocked storage. */
export interface Settings {
  /** Pause automatically when an incident starts at 1x/2x (at 4x a toast is shown instead). */
  autoPause: boolean;
  /** Speed a service starts at. */
  defaultSpeed: 1 | 2 | 4;
  /** Round 7: little UI sounds (Web Audio blips, made on the fly; no files). */
  sound: boolean;
  /** Round 7: "large" sets `data-text="large"` on <html>, which bumps the type scale ~12% (theme.css R7-C). */
  textSize: TextSize;
  /**
   * Round 11 (D, red-team U8): "Hide alcoholic drinks" (the field keeps its R11-D name so stored prefs still load). The
   * content view swaps alcoholic drinks (and the Stars wine list) for soft drinks of the same price and shape (content
   * `applySoftDrinks`; ids and numbers unchanged). Round 11b: off by default (the player is 14; a parent can switch it
   * on). A stored `true` or `false` is kept; only the default changed.
   */
  noGrownUpDrinks: boolean;
  /** Round 11 (D, U10): the player has picked a service speed (Settings or the speed deck); until then Cosy starts at 4×. */
  speedPicked: boolean;
  /**
   * Round 11b: glossary words get the dotted underline the first time each appears in a session ("first"), or every
   * time ("always"). Either way every term stays tappable and keeps its tip (components/Term.tsx).
   */
  underlineTerms: UnderlineTerms;
}

export type UnderlineTerms = "first" | "always";

export type TextSize = "normal" | "large";

export const SETTINGS_KEY = "full-plate:settings:v1";
export const DEFAULT_SETTINGS: Settings = { autoPause: true, defaultSpeed: 1, sound: true, textSize: "normal", noGrownUpDrinks: false, speedPicked: false, underlineTerms: "first" };

function read(): Settings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return normalize(JSON.parse(raw) as Partial<Settings>);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function normalize(p: Partial<Settings>): Settings {
  return {
      autoPause: typeof p.autoPause === "boolean" ? p.autoPause : DEFAULT_SETTINGS.autoPause,
      defaultSpeed: p.defaultSpeed === 1 || p.defaultSpeed === 2 || p.defaultSpeed === 4 ? p.defaultSpeed : DEFAULT_SETTINGS.defaultSpeed,
      sound: typeof p.sound === "boolean" ? p.sound : DEFAULT_SETTINGS.sound,
      textSize: p.textSize === "large" ? "large" : "normal",
      noGrownUpDrinks: typeof p.noGrownUpDrinks === "boolean" ? p.noGrownUpDrinks : DEFAULT_SETTINGS.noGrownUpDrinks,
      speedPicked: p.speedPicked === true,
      underlineTerms: p.underlineTerms === "always" ? "always" : "first",
    };
}

let current: Settings | null = null;
const listeners = new Set<() => void>();
/** Round 9: the save store mirrors settings to the player's account (lib/prefsSync.ts). */
let changeHook: (() => void) | null = null;
export function onSettingsChange(fn: (() => void) | null): void { changeHook = fn; }

export function getSettings(): Settings {
  if (!current) {
    current = typeof window === "undefined" ? DEFAULT_SETTINGS : read();
    applyTextSize(current.textSize);
  }
  return current;
}

export function setSettings(patch: Partial<Settings>): void {
  current = { ...getSettings(), ...patch };
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(current)); } catch { /* storage blocked: keep in memory */ }
  applyTextSize(current.textSize);
  for (const l of listeners) l();
  changeHook?.();
}

/** Round 9: settings from the player's account replace these (cached locally), without echoing back. */
export function adoptSettings(p: Partial<Settings>): void {
  const next = normalize({ ...getSettings(), ...p });
  if (JSON.stringify(next) === JSON.stringify(getSettings())) return;
  current = next;
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(current)); } catch { /* keep in memory */ }
  applyTextSize(current.textSize);
  for (const l of listeners) l();
}

/** Round 7: the root attribute the R7-C type tokens hang off. "normal" removes it. */
export function applyTextSize(size: TextSize): void {
  if (typeof document === "undefined") return;
  if (size === "large") document.documentElement.setAttribute("data-text", "large");
  else document.documentElement.removeAttribute("data-text");
}

/** For tests: forget the cached value so the next read goes back to storage. */
export function resetSettingsCache(): void {
  current = null;
}

/** Round 11 (D): the speed a service starts at — the remembered one, or 4× on Cosy until the player picks one. */
export function startSpeed(s: Settings, difficulty: string | undefined): 1 | 2 | 4 {
  return !s.speedPicked && difficulty === "cosy" ? 4 : s.defaultSpeed;
}

/** Round 11 (D): non-React listeners (the soft-drinks content view in sim.ts). */
export function subscribeSettings(l: () => void): () => void { return subscribe(l); }

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const s = useSyncExternalStore(subscribe, getSettings, () => DEFAULT_SETTINGS);
  return [s, setSettings];
}
