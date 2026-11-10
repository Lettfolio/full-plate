import { getSettings, subscribeSettings } from "./settings";

/**
 * Round 7: tiny UI sounds, synthesised with Web Audio (no files, no network). Round 12 (A): the same front door for
 * the soundtrack. This file stays small (it is in the main chunk); the synthesiser — every effect and the three
 * pieces of music — is `music.ts`, loaded the first time sound is needed after a tap or a key (autoplay rules).
 *
 * Settings › Sound is the master switch; Music and Sound effects have their own volumes. Wherever Web Audio is
 * missing (tests, old browsers) every call is a no-op, and nothing here ever throws. Never touches the sim.
 */
export type Sfx = "tap" | "good" | "win" | "open" | "orderUp" | "paid" | "review" | "eightySix" | "rushOn" | "rushOff";

/** Which piece plays: the morning's planning (calm), service (brisk), the evening (warm); "off" for none. */
export type Scene = "off" | "planning" | "service" | "evening";

/** What the game wants to hear right now. `palette` is the Music decor item id (the room's instrument palette). */
export interface MusicWant { scene: Scene; rush: boolean; palette: string }

const want: MusicWant = { scene: "off", rush: false, palette: "music_none" };
let ctx: AudioContext | null = null;
let engine: typeof import("./music") | null = null;
let loading = false;
let gestured = false;
const pending: Sfx[] = [];

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  if (!gestured || typeof window === "undefined") return null;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  } catch { ctx = null; }
  return ctx;
}

/** Load the synthesiser (once) and hand it the current wishes. */
function boot(): void {
  const c = audioContext();
  if (!c || !getSettings().sound) return;
  if (engine) { engine.sync(c, want); return; }
  if (loading) return;
  loading = true;
  import("./music").then((m) => {
    engine = m;
    m.sync(c, want);
    for (const k of pending.splice(0)) m.sfx(c, k);
  }).catch(() => { loading = false; });
}

function onGesture(): void {
  gestured = true;
  const c = audioContext();
  try { if (c && c.state !== "running") void c.resume(); } catch { /* ignore */ }
  boot();
}

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pointerdown", onGesture, { capture: true, passive: true });
  window.addEventListener("keydown", onGesture, { capture: true });
  subscribeSettings(() => { if (gestured) boot(); });
}

export function playSfx(kind: Sfx): void {
  try {
    const s = getSettings();
    if (!s.sound || s.sfxVolume <= 0) return;
    const c = audioContext();
    if (!c) return;
    if (engine) engine.sfx(c, kind);
    else { if (pending.length < 3) pending.push(kind); boot(); }
  } catch { /* sound is a nicety: never break the game */ }
}

/** Round 12 (A): the soundtrack follows the day (App) and the room's Music decor item. */
export function setSoundtrack(scene: Scene, palette = want.palette): void {
  if (want.scene === scene && want.palette === palette) return;
  want.scene = scene; want.palette = palette;
  if (scene !== "service") want.rush = false;
  if (gestured) boot();
}

/** Round 12 (A): a service rush raises the tempo and adds a hat line. */
export function setRush(on: boolean): void {
  if (want.rush === on) return;
  want.rush = on;
  if (engine && ctx) engine.sync(ctx, want);
}
