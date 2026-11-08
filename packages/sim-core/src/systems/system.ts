/** Common shapes and staff-effect helpers for systems: staff on the floor, the owner as cover, incident mods. */
import {
  MANAGER_EXTRA_ACTIONS,
  MOOD_EFFECT_RANGE,
  OWNER,
  OWNER_BOTH_SPEED_MULT,
  OWNER_FATIGUE_EFFECT,
  SERVER_ACTIONS_BASE,
  SERVER_ACTIONS_SPEED_DIV,
} from "../constants";
import type { Rng } from "../rng";
import type { ContentPack, GameState, ServiceMod, SimEvent, Staff, StaffRole } from "../types";
import { clamp, onShift, traitMult } from "../util";

export interface SystemResult {
  state: GameState;
  events: SimEvent[];
}

export type System = (content: ContentPack, state: GameState, rng: Rng) => SystemResult;

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

// ── the owner ──
/** Roles the owner covers: chef and/or server, whenever nobody of that role is on the floor right now. */
export const OWNER_ROLES: readonly StaffRole[] = ["chef", "server"];

export function coveringRoles(state: GameState): StaffRole[] {
  return OWNER_ROLES.filter((r) => onShift(state, r).length === 0);
}

export interface OwnerStats {
  skill: number;
  speed: number;
  charm: number;
  /** FOH actions per tick when serving. */
  actions: number;
  /** Multiplier on kitchen throughput (1 = full attention; OWNER_BOTH_SPEED_MULT when also serving). */
  focus: number;
  /** Covering kitchen and floor at once. */
  both: boolean;
}

/**
 * The owner as cover: a mediocre generalist (OWNER), worn down by ownerFatigue, and in two places at once
 * when covering both kitchen and floor (kitchen throughput and FOH actions × OWNER_BOTH_SPEED_MULT).
 */
export function ownerStats(state: GameState): OwnerStats {
  const tired = 1 - (OWNER_FATIGUE_EFFECT * clamp(state.ownerFatigue ?? 0, 0, 100)) / 100;
  const both = coveringRoles(state).length >= 2;
  const split = both ? OWNER_BOTH_SPEED_MULT : 1;
  return {
    skill: OWNER.skill * tired,
    speed: OWNER.speed * tired,
    charm: OWNER.charm * tired,
    actions: OWNER.serverActions * tired * split,
    focus: split,
    both,
  };
}

/** Front-of-house actions available per tick (servers, plus managers helping). The owner covers when nobody serves. */
export function serverActionsPerTick(content: ContentPack, state: GameState): number {
  const servers = onShift(state, "server");
  const managers = onShift(state, "manager").length;
  let actions = managers * MANAGER_EXTRA_ACTIONS;
  if (servers.length === 0) return actions + ownerStats(state).actions;
  for (const s of servers) actions += SERVER_ACTIONS_BASE + effectiveSpeed(content, s) / SERVER_ACTIONS_SPEED_DIV;
  return actions;
}

/** Mean charm of front-of-house on the floor (the owner when nobody). */
export function frontCharm(content: ContentPack, state: GameState): number {
  const foh = onShift(state).filter((s) => s.role === "server" || s.role === "bar" || s.role === "manager");
  if (foh.length === 0) return ownerStats(state).charm;
  let total = 0;
  for (const s of foh) total += effectiveCharm(content, s);
  return total / foh.length;
}

/** Best charm on the floor (for VIP tables). */
export function bestCharm(content: ContentPack, state: GameState): number {
  const foh = onShift(state).filter((s) => s.role === "server" || s.role === "bar" || s.role === "manager");
  return foh.length ? Math.max(...foh.map((s) => effectiveCharm(content, s))) : ownerStats(state).charm;
}

/** Recomputes the service tally's staff-derived figures after the floor changes (break, call-in). */
export function refreshFloor(content: ContentPack, state: GameState): GameState {
  if (!state.service) return state;
  return {
    ...state,
    service: { ...state.service, actionsPerTick: serverActionsPerTick(content, state), frontCharm: frontCharm(content, state) },
  };
}

// ── incident modifiers ──
const NO_MODS: readonly ServiceMod[] = [];
const modsOf = (state: GameState): readonly ServiceMod[] => state.service?.mods ?? NO_MODS;

/** Σ of "actions" mods active now. */
export function actionsMod(state: GameState): number {
  let a = 0;
  for (const m of modsOf(state)) if (m.kind === "actions" && state.tick < m.untilTick) a += m.value;
  return a;
}

/** Π of "kitchen" or "arrivals" mods active now. */
export function multMod(state: GameState, kind: "kitchen" | "arrivals"): number {
  let x = 1;
  for (const m of modsOf(state)) if (m.kind === kind && state.tick < m.untilTick) x *= m.value;
  return x;
}
