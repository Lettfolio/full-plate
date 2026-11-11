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
  /**
   * Round 12 (A): the juice — the floor's little beats, counters that tick up, the evening's count-up, screen fades.
   * Off (or the OS's prefers-reduced-motion) makes them instant; `data-motion="off"` on <html> carries it to CSS.
   */
  animations: boolean;
  /** Round 12 (A): soundtrack volume 0..1 (lib/music.ts). Sound (above) is the master: off silences this too. */
  musicVolume: number;
  /** Round 12 (A): sound-effects volume 0..1 (lib/sfx.ts). */
  sfxVolume: number;
  /**
   * Round 13 (C): a short buzz (`navigator.vibrate`, where the phone has it) when you press USE or a plate goes out in
   * the hands-on shift. Only while Sound (above) is on too.
   */
  haptics: boolean;
}

export type UnderlineTerms = "first" | "always";

export type TextSize = "normal" | "large";

export const SETTINGS_KEY = "full-plate:settings:v1";
export const DEFAULT_SETTINGS: Settings = { autoPause: true, defaultSpeed: 1, sound: true, textSize: "normal", noGrownUpDrinks: false, speedPicked: false, underlineTerms: "first", animations: true, musicVolume: 0.4, sfxVolume: 0.8, haptics: true };

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
      animations: typeof p.animations === "boolean" ? p.animations : DEFAULT_SETTINGS.animations,
      musicVolume: volume(p.musicVolume, DEFAULT_SETTINGS.musicVolume),
      sfxVolume: volume(p.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
      haptics: typeof p.haptics === "boolean" ? p.haptics : DEFAULT_SETTINGS.haptics,
    };
}

/** A stored volume: a finite number clamped to 0..1, else the default. */
function volume(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, Math.round(v * 100) / 100)) : d;
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
    applyMotion(current.animations);
  }
  return current;
}

export function setSettings(patch: Partial<Settings>): void {
  current = normalize({ ...getSettings(), ...patch });
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(current)); } catch { /* storage blocked: keep in memory */ }
  applyTextSize(current.textSize);
  applyMotion(current.animations);
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
  applyMotion(current.animations);
  for (const l of listeners) l();
}

/** Round 7: the root attribute the R7-C type tokens hang off. "normal" removes it. */
export function applyTextSize(size: TextSize): void {
  if (typeof document === "undefined") return;
  if (size === "large") document.documentElement.setAttribute("data-text", "large");
  else document.documentElement.removeAttribute("data-text");
}

/** Round 12 (A): `data-motion="off"` on <html> when Settings › Animations is off (theme.css "Round 12 — A" block). */
export function applyMotion(on: boolean): void {
  if (typeof document === "undefined") return;
  if (on) document.documentElement.removeAttribute("data-motion");
  else document.documentElement.setAttribute("data-motion", "off");
}

/** For tests: forget the cached value so the next read goes back to storage. */
export function resetSettingsCache(): void {
  current = null;
}

/** Round 11 (D): the speed a service starts at — the remembered one, or 4× on Cosy until the player picks one. */
export function startSpeed(s: Settings, difficulty: string | undefined): 1 | 2 | 4 {
  return !s.speedPicked && difficulty === "cosy" ? 4 : s.defaultSpeed;
}

/**
 * Round 11b: the drinks view a screen is showing. The content view re-words the pack in place (sim.ts syncSoftDrinks),
 * which React can't see; a screen that caches dish or ingredient names puts this in its memo keys, and calling it
 * re-renders the screen when the player flips "Hide alcoholic drinks" (the Planning screen is under the Settings sheet).
 */
export function useDrinksView(): boolean {
  return useSyncExternalStore(subscribe, () => getSettings().noGrownUpDrinks, () => DEFAULT_SETTINGS.noGrownUpDrinks);
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
