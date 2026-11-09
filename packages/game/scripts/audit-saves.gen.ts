/**
 * Builds the save files the type-scale audit (scripts/type-audit.mjs) loads, with the real sim + content.
 * Run through vitest (scripts/vitest.audit.config.ts) so workspace TS resolves exactly as in the game's tests.
 * Output dir: $FP_AUDIT_SAVES (default: scripts/.audit-saves, git-ignored).
 *
 *   owner-planning  day ~20 owner game, planning (menu, staff, stock, restaurant tabs, service)
 *   owner-evening   the same game straight after a service
 *   fork-evening    day 365 evening with the fork card showing
 *   empire          Empire path, planning (Empire tab)
 *   stars           Stars path, planning (Stars tab)
 *   gameover        bust
 *   win             an ending (Stars dynasty)
 */
import { it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GameState } from "@full-plate/sim-core";
import { appReducer, initialAppState, type AppState } from "../src/state/gameReducer";
import { FORK_DAY, initialMeta, type PathMeta } from "../src/state/paths";
import { chooseEmpire, chooseStars } from "../src/state/pathEngine";
import { encodeSave } from "../src/state/save";
import { applyCommand, content, runDay, suggestedOrder } from "../src/sim";

const OUT = process.env.FP_AUDIT_SAVES ?? join(__dirname, ".audit-saves");

function owner(days: number): AppState {
  let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 21, districtId: "high_street", restaurantName: "Rosie's", difficulty: "cosy" } });
  for (const id of ["beef_burger", "chicken_burger", "chunky_chips", "soft_drink", "garden_salad", "brownie"]) {
    const d = content.dishes.find((x) => x.id === id);
    if (d) s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: id, price: d.suggestedPrice } });
  }
  s = appReducer(s, { type: "command", cmd: { type: "HIRE", candidateIndex: 0 } });
  let g = s.game!;
  for (let d = 0; d < days && g.phase !== "gameover"; d++) {
    g = runDay(content, g).state;
    for (const o of suggestedOrder(content, g)) g = applyCommand(content, g, { type: "ORDER_STOCK", ...o }).state;
    if (g.phase === "event") g = applyCommand(content, g, { type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === g.activeEvent?.eventId)!.choices[0]!.id }).state;
    else if (g.phase === "evening") g = applyCommand(content, g, { type: "END_DAY" }).state;
  }
  return { ...s, game: g, meta: { ...s.meta, lastPathDay: g.history.at(-1)?.day ?? -1 } };
}

const write = (name: string, game: GameState, meta: PathMeta) => writeFileSync(join(OUT, `${name}.json`), encodeSave(game, meta));

it("writes the audit saves", () => {
  mkdirSync(OUT, { recursive: true });
  const base = owner(20);
  const g = base.game!;
  write("owner-planning", g, base.meta);

  const eve = runDay(content, g).state;
  write("owner-evening", eve, base.meta);

  // Day 365: an evening with the fork card up.
  const forkDay: GameState = { ...eve, day: FORK_DAY, reputation: { ...eve.reputation, popularity: Math.max(70, eve.reputation.popularity) } };
  write("fork-evening", forkDay, { ...initialMeta("owner"), lastPathDay: FORK_DAY, fork: { offered: true, firstOfferDay: FORK_DAY } });

  const morning: GameState = { ...g, day: FORK_DAY + 1 };
  const m0: PathMeta = { ...initialMeta("owner"), lastPathDay: FORK_DAY };
  write("empire", morning, chooseEmpire(morning, m0, "Rosie's Burgers"));
  const stars = chooseStars(morning, m0);
  write("stars", morning, stars);

  // A finished owner run is never saved, so this one sits under the career key with no career attached: the title's
  // "Continue career" then opens the owner GameOver screen (audit only).
  write("gameover", { ...eve, phase: "gameover", gameOverReason: "The bank called in the loan: cash stayed below zero for too long." }, { ...base.meta, mode: "career" });
  write("win", morning, { ...stars, win: { kind: "dynasty", won: true, day: morning.day, title: "A dynasty", text: ["Three stars, ten years running.", "Your name is on every chef's lips."] } });
});
