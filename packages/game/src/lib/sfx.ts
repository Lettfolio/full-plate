import { getSettings } from "./settings";

/**
 * Round 7: tiny UI sounds, synthesised with Web Audio (no files, no network). Off when Settings › Sound is off, and a
 * no-op wherever Web Audio is missing (tests, old browsers). Never touches the sim, so determinism is unaffected.
 */
export type Sfx = "tap" | "good" | "win" | "open";

const NOTES: Record<Sfx, [number, number][]> = {
  // [frequency Hz, start offset s]
  tap: [[660, 0]],
  good: [[523.25, 0], [783.99, 0.09]],
  open: [[392, 0], [523.25, 0.08], [659.25, 0.16]],
  win: [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.38]],
};

let ctx: AudioContext | null = null;

export function playSfx(kind: Sfx): void {
  if (!getSettings().sound) return;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    const t0 = ctx.currentTime;
    for (const [f, at] of NOTES[kind]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(kind === "tap" ? 0.05 : 0.09, t0 + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + (kind === "win" ? 0.5 : 0.22));
      o.connect(g).connect(ctx.destination);
      o.start(t0 + at);
      o.stop(t0 + at + 0.6);
    }
  } catch { /* sound is a nicety: never break the game */ }
}
