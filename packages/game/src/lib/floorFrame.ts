import type { GameState } from "@full-plate/sim-core";

/**
 * Round 14 (E, U18): the postcard's room shows the night's guests and plates. The evening's state has an empty room
 * (service is over), so Service hands each frame here and the busiest one of the day is kept — a reference to that
 * tick's state (the reducer makes a new one each tick, so nothing is copied). The postcard draws it paused.
 * Memory only: after a reload the postcard falls back to the room as it stands (the R12 picture).
 */
let kept: { day: number; busy: number; game: GameState } | null = null;

/** Guests in the room at this tick: seated, waiting, eating or paying (not the queue outside). */
export function busyness(game: GameState): number {
  let n = 0;
  for (const c of game.customers) if (c.stage !== "queue" && c.stage !== "left") n++;
  return n;
}

/** Called by Service on every frame; keeps the day's busiest. Cheap (one pass over the guests). */
export function noteFloorFrame(game: GameState): void {
  if (game.phase !== "service") return;
  const busy = busyness(game);
  if (!kept || kept.day !== game.day || busy > kept.busy) kept = { day: game.day, busy, game };
}

/** The busiest frame of `day`'s service, if this session saw one with anyone in. */
export function floorFrameFor(day: number): GameState | null {
  return kept && kept.day === day && kept.busy > 0 ? kept.game : null;
}

/** For tests. */
export function resetFloorFrame(): void { kept = null; }
