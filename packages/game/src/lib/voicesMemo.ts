/**
 * Round 13 (D, R12.11 item 5): the memo that keeps the regulars' stories and the framed clipping past sim-core's
 * 400-day history. A lazy module (it needs the voices data, which is its own chunk): App's `useVoicesMemo` imports it
 * after a day ends and dispatches the reducer's `voicesMemo` action with what `memoFrom` returns. A save without a memo
 * is backfilled from its history the first time (whatever the history still holds).
 */
import type { GameState } from "@full-plate/sim-core";
import type { VoicesMemo } from "../state/paths";
import { regularsFrom, usableMemo } from "./regulars";
import { clippingDay, weekScores } from "./rival";
export { clipFrom } from "./rival";

/** The memo as of the last day in the history, resumed from `prev` when it is usable. */
export function memoFrom(game: Pick<GameState, "seed" | "history" | "districtId">, prev?: VoicesMemo): VoicesMemo {
  const m = usableMemo(game.seed, game.history, prev);
  const regs = regularsFrom(game.seed, game.history, m);
  const clip = m?.clip ?? clippingDay(weekScores(game as GameState));
  return {
    v: 1,
    seed: game.seed,
    day: game.history.at(-1)?.day ?? -1,
    ...(clip !== undefined ? { clip } : {}),
    regs: regs.filter((s) => s.joined !== undefined).map((s) => ({
      id: s.def.id,
      joined: s.joined,
      done: s.done.map((b): [number, number, number, string?] => (b.dishId ? [b.beat, b.day, b.good ? 1 : 0, b.dishId] : [b.beat, b.day, b.good ? 1 : 0])),
      ...(s.open ? { open: { ...s.open } } : {}),
    })),
  };
}
