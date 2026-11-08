/** Common shapes and staff-effect helpers for systems. */
import {
  MOOD_EFFECT_RANGE,
  OWNER,
  SERVER_ACTIONS_BASE,
  SERVER_ACTIONS_SPEED_DIV,
  MANAGER_EXTRA_ACTIONS,
} from "../constants";
import type { Rng } from "../rng";
import type { ContentPack, GameState, SimEvent, Staff } from "../types";
import { onShift, traitMult } from "../util";

export interface SystemResult {
  state: GameState;
  events: SimEvent[];
}

export type System = (content: ContentPack, state: GameState, rng: Rng) => SystemResult;

export const unchanged = (state: GameState): SystemResult => ({ state, events: [] });

/** Mood 0 ⇒ MOOD_EFFECT_RANGE[0], mood 100 ⇒ MOOD_EFFECT_RANGE[1]. */
export function moodMult(mood: number): number {
  const [lo, hi] = MOOD_EFFECT_RANGE;
  return lo + (hi - lo) * (mood / 100);
}

export const effectiveSkill = (c: ContentPack, s: Staff): number =>
  s.skill * moodMult(s.mood) * traitMult(c, s.traits, "skill");
export const effectiveSpeed = (c: ContentPack, s: Staff): number =>
  s.speed * moodMult(s.mood) * traitMult(c, s.traits, "speed");
export const effectiveCharm = (c: ContentPack, s: Staff): number =>
  s.charm * moodMult(s.mood) * traitMult(c, s.traits, "charm");

/** Front-of-house actions available per tick (servers, plus managers helping). Owner covers when nobody is on. */
export function serverActionsPerTick(content: ContentPack, state: GameState): number {
  const servers = onShift(state, "server");
  const managers = onShift(state, "manager").length;
  if (servers.length === 0) return OWNER.serverActions + managers * MANAGER_EXTRA_ACTIONS;
  let actions = managers * MANAGER_EXTRA_ACTIONS;
  for (const s of servers) {
    actions += SERVER_ACTIONS_BASE + effectiveSpeed(content, s) / SERVER_ACTIONS_SPEED_DIV;
  }
  return actions;
}

/** Mean charm of front-of-house on shift (owner when nobody). */
export function frontCharm(content: ContentPack, state: GameState): number {
  const foh = onShift(state).filter((s) => s.role === "server" || s.role === "bar" || s.role === "manager");
  if (foh.length === 0) return OWNER.charm;
  let total = 0;
  for (const s of foh) total += effectiveCharm(content, s);
  return total / foh.length;
}
