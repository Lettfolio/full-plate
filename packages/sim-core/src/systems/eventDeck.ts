/**
 * EventDeck (evening) — with EVENT_CHANCE_PER_DAY, draws a weighted eligible event card for
 * tomorrow morning (phase "event"). Cards respect their `when` conditions, a minimum gap
 * between events and a per-card cooldown. Also provides choice resolution.
 */
import {
  EVENT_CHANCE_PER_DAY,
  EVENT_HISTORY_MAX,
  EVENT_MIN_GAP_DAYS,
  EVENT_REPEAT_COOLDOWN_DAYS,
} from "../constants";
import type { Rng } from "../rng";
import type { ContentPack, EventChoiceDef, EventDef, GameState, SimEvent } from "../types";
import { clamp, logEvent, monthOf, round2 } from "../util";
import type { SystemResult } from "./system";

/** Event conditions are checked against tomorrow (the morning the card is shown). */
export function eventEligible(ev: EventDef, state: GameState, day: number): boolean {
  if (ev.weight <= 0) return false;
  const w = ev.when ?? {};
  if (w.minDay !== undefined && day < w.minDay) return false;
  if (w.maxDay !== undefined && day > w.maxDay) return false;
  if (w.minCash !== undefined && state.cash < w.minCash) return false;
  if (w.maxCash !== undefined && state.cash > w.maxCash) return false;
  if (w.minPopularity !== undefined && state.reputation.popularity < w.minPopularity) return false;
  if (w.minPrestige !== undefined && state.reputation.prestige < w.minPrestige) return false;
  if (w.month && !w.month.includes(monthOf(day))) return false;
  const last = (state.eventHistory ?? []).filter((h) => h.eventId === ev.id).at(-1);
  return !last || day - last.day >= EVENT_REPEAT_COOLDOWN_DAYS;
}

export function drawEvent(content: ContentPack, state: GameState, rng: Rng): EventDef | undefined {
  const day = state.day + 1;
  const lastAny = (state.eventHistory ?? []).at(-1);
  if (lastAny && day - lastAny.day < EVENT_MIN_GAP_DAYS) return undefined;
  if (!rng.chance(EVENT_CHANCE_PER_DAY)) return undefined;
  const pool = content.events.filter((e) => eventEligible(e, state, day));
  return rng.weighted(pool, pool.map((e) => e.weight));
}

export function eventDeckSystem(content: ContentPack, state: GameState, rng: Rng): SystemResult {
  if (state.phase === "gameover") return { state, events: [] };
  const ev = drawEvent(content, state, rng);
  if (!ev) return { state, events: [] };
  const history = [...(state.eventHistory ?? []), { eventId: ev.id, day: state.day + 1 }].slice(-EVENT_HISTORY_MAX);
  return {
    state: { ...state, activeEvent: { eventId: ev.id }, eventHistory: history },
    events: [{ type: "EVENT_TRIGGERED", eventId: ev.id }],
  };
}

/** Applies a choice's immediate effects. */
export function applyChoice(state: GameState, choice: EventChoiceDef): { state: GameState; events: SimEvent[] } {
  const e = choice.effects;
  const rep = state.reputation;
  const next: GameState = {
    ...state,
    cash: state.cash + Math.round(e.cash ?? 0),
    reputation: {
      popularity: round2(clamp(rep.popularity + (e.popularity ?? 0), 0, 100)),
      prestige: round2(clamp(rep.prestige + (e.prestige ?? 0), 0, 100)),
    },
    staff: e.staffMood ? state.staff.map((s) => ({ ...s, mood: round2(clamp(s.mood + e.staffMood!, 0, 100)) })) : state.staff,
    footfallMods: e.footfallMultDays && e.footfallMultDays.days > 0
      ? [...state.footfallMods, { mult: e.footfallMultDays.mult, daysRemaining: e.footfallMultDays.days }]
      : state.footfallMods,
  };
  return { state: next, events: [logEvent(state, `You chose: ${choice.label}.`, "info")] };
}
