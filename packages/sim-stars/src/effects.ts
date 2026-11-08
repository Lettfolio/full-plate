/**
 * applyStarsEffects — folds what the Stars layer owes the restaurant back into the sim-core GameState:
 * cash (satellite takings, ticketing, minus wages/fees/command costs), prestige and popularity nudges, and footfall
 * multipliers. The game calls it in the evening right after stepStarsDay (before END_DAY / RESOLVE_EVENT).
 *
 * Footfall: sim-core's advanceDay decrements every footfallMods entry at END_DAY and drops it at 0, so
 *  - the persistent multiplier (star bump × prepaid × signatures × rival) is pushed with daysRemaining 2: it is live
 *    for exactly tomorrow's service and expires as tomorrow's evening pushes its replacement;
 *    While shut for a refit/relaunch the multiplier is 0, so a service the game runs anyway serves nobody;
 *  - one-off mods (critic, scandal, burnout) are pushed with daysRemaining = days + 1.
 * The ledger is emptied, so calling it twice in one evening only adds a second (identical) persistent entry — don't.
 */
import type { GameState } from "@full-plate/sim-core";
import { clamp, r2 } from "./proxies";
import type { StarsState } from "./types";

export function applyStarsEffects(state: GameState, stars: StarsState): { state: GameState; stars: StarsState } {
  const l = stars.ledger;
  const footfallMods = [...state.footfallMods];
  if (Math.abs(l.persistentMult - 1) > 1e-9) footfallMods.push({ mult: l.persistentMult, daysRemaining: 2 });
  for (const f of l.pendingFootfall) footfallMods.push({ mult: f.mult, daysRemaining: f.days + 1 });
  const next: GameState = {
    ...state,
    cash: state.cash + Math.round(l.pendingCash),
    reputation: {
      popularity: r2(clamp(state.reputation.popularity + l.pendingPopularity, 0, 100)),
      prestige: r2(clamp(state.reputation.prestige + l.pendingPrestige, 0, 100)),
    },
    footfallMods,
  };
  return {
    state: next,
    stars: { ...stars, ledger: { pendingCash: 0, pendingPrestige: 0, pendingPopularity: 0, pendingFootfall: [], persistentMult: l.persistentMult, pushedMult: l.persistentMult } },
  };
}

/**
 * Planning-phase helper: on a day the restaurant is shut (refit, relaunch, ended), push a one-day ×0 footfall mod so
 * the service the game still has to run (sim-core advances days only through service) serves nobody. Call it just
 * before START_SERVICE / runDay. No-op on open days.
 */
export function prepareService(state: GameState, stars: StarsState): GameState {
  const shut = (stars.refitUntil ?? -1) > state.day || !!stars.ending;
  if (!shut || state.footfallMods.some((m) => m.mult === 0)) return state;
  return { ...state, footfallMods: [...state.footfallMods, { mult: 0, daysRemaining: 1 }] };
}
