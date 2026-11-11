/**
 * Round 13 (A): the floor's slow-frame watch. Service feeds it every rAF timestamp; when the gaps stay long — the
 * device can't draw the floor at 60 fps — it says "lite", and the renderer thins its small effects (RenderOptions.juice:
 * one steam wisp, no sizzle, no steam on the pass, no breathing). Never the sim: the clock, the ticks and what happens
 * are exactly as before (Service's tick maths reads elapsed time, not frames).
 *
 * The rule: over a rolling window of WINDOW frames, if more than SLOW_SHARE of the gaps are over SLOW_MS for
 * SUSTAIN_MS on end, switch to lite. It doesn't switch back within a service (no flicker between the two); a new
 * service starts full again. Paused, hidden-tab and very long gaps (> 250 ms: a tab switch, a sheet opening, GC after
 * a save) are ignored, so only a sustained slow floor counts. No allocation per frame (a fixed ring of booleans).
 *
 * The note ("…small effects eased off…" with a Settings link) is shown once per device: `noteDue()` / `noteShown()`,
 * remembered in device storage (`full-plate:floor-eased-note`, lib/storage.ts: namespaced, memory when blocked), wrapped in try/catch so a blocked storage just shows it
 * again next time.
 */

import { prefsStorage } from "./storage";

export const SLOW_MS = 20; // a 60 Hz frame that missed its slot
export const WINDOW = 90; // ~1.5 s at 60 fps
export const SLOW_SHARE = 0.3;
export const SUSTAIN_MS = 3000;
export const NOTE_KEY = "full-plate:floor-eased-note";

export type Juice = "full" | "lite";

export interface FloorLoad {
  /** Call once a frame with the rAF timestamp; `running` false while paused (gaps then don't count). Returns the level. */
  frame(now: number, running: boolean): Juice;
  readonly level: Juice;
  /** The share of slow frames in the window (0..1), for the perf readout and tests. */
  readonly slowShare: number;
}

export function createFloorLoad(onLite?: () => void): FloorLoad {
  const slow = new Uint8Array(WINDOW);
  let i = 0, n = 0, count = 0, last = 0, since = -1;
  let level: Juice = "full";
  return {
    frame(now, running) {
      const gap = last ? now - last : 0;
      last = now;
      if (level === "lite" || !running || gap <= 0 || gap > 250) return level;
      const s = gap > SLOW_MS ? 1 : 0;
      count += s - slow[i]!;
      slow[i] = s;
      i = (i + 1) % WINDOW; n = Math.min(WINDOW, n + 1);
      const over = n === WINDOW && count / WINDOW > SLOW_SHARE;
      if (!over) { since = -1; return level; }
      if (since < 0) since = now;
      if (now - since >= SUSTAIN_MS) { level = "lite"; onLite?.(); }
      return level;
    },
    get level() { return level; },
    get slowShare() { return n ? count / n : 0; },
  };
}

/** Whether the once-per-device note is still to be shown. */
export function noteDue(): boolean {
  try { return prefsStorage().getItem(NOTE_KEY) !== "1"; } catch { return true; }
}
export function noteShown(): void {
  try { prefsStorage().setItem(NOTE_KEY, "1"); } catch { /* storage full: say it again next time */ }
}

/** The note itself (a toast with a Settings › Animations link). */
export const EASED_NOTE = "This device was struggling to keep up, so the floor's small effects are eased off for now. Animations in Settings turns them off altogether.";
