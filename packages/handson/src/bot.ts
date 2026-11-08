/**
 * A simple deterministic player that follows the tutorial hints. Used by tests (a full shift is completable for every
 * role), by the demo's `?auto=1` screenshot mode, and usable by the game as an "attract mode" or to keep a station
 * ticking while a parent and child swap the controller.
 *
 * `skill` 0..1 sets how close to the centre of each timing window it releases (1 = perfect).
 */
import type { GameState } from "@full-plate/sim-core";
import { nextHint } from "./hints";
import { steerToward } from "./nav";
import type { HandsOnInput, HandsOnSession } from "./types";

const NONE: HandsOnInput = { up: false, down: false, left: false, right: false, interact: false, cancel: false };

export function botInput(session: HandsOnSession, state: GameState, skill = 1): HandsOnInput {
  const a = session.activeAction;
  const frame = Math.floor(session.time * 60);
  const err = (1 - skill) * 0.18; // how far past the target it releases
  if (a) {
    const p = a.t / a.dur;
    switch (a.verb) {
      case "cook": return { ...NONE, interact: p < ((a.band![0] + a.band![1]) / 2) + err };
      case "pour": return { ...NONE, interact: p < (a.line ?? 0.78) + err * 0.5 };
      case "chop": {
        const i = a.marked!.findIndex((m) => m === 0);
        return { ...NONE, interact: i >= 0 && p >= a.marks![i]! + err * 0.4 && frame % 2 === 0 };
      }
      case "clear": return { ...NONE, interact: frame % 8 < 4 };
      default: return NONE;
    }
  }
  if (session.shift?.over) return NONE;
  const h = nextHint(session, state);
  if (!h?.stationId) return NONE;
  if (session.prompt?.stationId === h.stationId && session.prompt.enabled) return { ...NONE, interact: frame % 4 < 2 };
  const s = steerToward(session, h.stationId);
  if (s.arrived) {
    // at the right tile but facing elsewhere: a gentle nudge toward the station turns us without a bump
    const n = 0.3;
    const mv = s.face === "up" ? { moveX: 0, moveY: -n } : s.face === "down" ? { moveX: 0, moveY: n } : s.face === "left" ? { moveX: -n, moveY: 0 } : { moveX: n, moveY: 0 };
    return { ...NONE, ...mv };
  }
  return { ...NONE, moveX: s.moveX, moveY: s.moveY };
}
