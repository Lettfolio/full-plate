/**
 * Round 3 review: a save made mid-service in each mode (owner, career, Empire, Stars) reloads and continues
 * identically. Saves are written at tick 0 of a service in the real game (useAutosave), but the envelope must also
 * survive an arbitrary mid-service reload (a crash, a tab close during a hands-on shift).
 */
import { describe, expect, it } from "vitest";
import { strategies, STRATEGIES, type GameState } from "@full-plate/sim-core";
import { serializeEmpire } from "./envelopeHelpers";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { decodeSave, encodeSave } from "../state/save";
import { content } from "../sim";
import { FORK_DAY, initialMeta } from "../state/paths";

/** Plays `ticks` ticks, then the rest of the day and the next day, through the reducer. Returns a fingerprint. */
function continueFrom(s0: AppState, days = 2): string {
  let s = s0;
  for (let d = 0; d < days; d++) {
    while (s.game!.phase === "service") s = appReducer(s, { type: "ticks", n: 7 });
    if (s.game!.phase === "event") {
      const ev = content.events.find((e) => e.id === s.game!.activeEvent?.eventId);
      s = appReducer(s, { type: "command", cmd: { type: "RESOLVE_EVENT", choiceId: ev?.choices[0]?.id ?? "" } });
    } else if (s.game!.phase === "evening") s = appReducer(s, { type: "nextDay" });
    if (d < days - 1 && s.game!.phase === "planning") s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
  }
  const { game, meta } = s;
  return encodeSave(game!, { ...meta, careerEvents: [], empireEvents: [], starsEvents: [] }) + serializeEmpire(meta);
}

function midService(s0: AppState, ticks = 37): AppState {
  let s = appReducer(s0, { type: "command", cmd: { type: "START_SERVICE" } });
  expect(s.game!.phase).toBe("service");
  for (let i = 0; i < ticks && s.game!.phase === "service"; i++) s = appReducer(s, { type: "ticks", n: 1 });
  return s;
}

function reload(s: AppState): AppState {
  const l = decodeSave(encodeSave(s.game!, s.meta));
  // The reducer's "load", minus a fresh UI (ticker etc.); handsOn is transient and dropped by the envelope.
  return appReducer(initialAppState, { type: "load", game: l.game, meta: l.meta });
}

/** A year-2 owner with a real history (re-dated), as in round3.test.tsx. */
function yearTwo(): AppState {
  let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 17, districtId: "high_street", restaurantName: "Det", difficulty: "normal" } });
  let g: GameState = s.game!;
  for (let d = 0; d < 24; d++) g = strategies.runStrategyDay(content, g, STRATEGIES.balanced);
  g = { ...g, day: FORK_DAY, history: g.history.map((h) => ({ ...h, profit: Math.max(h.profit, 10_000) })) };
  return { ...s, game: g, meta: { ...initialMeta("owner"), lastPathDay: FORK_DAY - 1, morningDay: FORK_DAY } };
}

describe("envelope save mid-service → reload → continue is identical", () => {
  it("owner", () => {
    let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 9, districtId: "seaside", restaurantName: "Det", difficulty: "normal" } });
    let g = s.game!;
    for (let d = 0; d < 6; d++) g = strategies.runStrategyDay(content, g, STRATEGIES.typical);
    s = midService({ ...s, game: g });
    expect(continueFrom(reload(s))).toBe(continueFrom(s));
  });

  it("career (with the owner answering incidents each tick)", () => {
    let s = appReducer(initialAppState, { type: "newCareer", seed: 12, track: "waiter", strategy: "cheap", playerName: "Robin", difficulty: "normal" });
    for (let d = 0; d < 3; d++) {
      s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
      s = appReducer(s, { type: "skipShift" });
      s = appReducer(s, { type: "nextDay" });
    }
    s = midService(s, 51);
    expect(continueFrom(reload(s), 3)).toBe(continueFrom(s, 3));
  });

  it("Empire", () => {
    let s = appReducer(yearTwo(), { type: "fork", choice: "empire" });
    s = appReducer(s, { type: "empire", cmd: { type: "OPEN_SITE", cityId: "harbourton", districtId: "seaside", ownership: "company", land: "hqLease" } });
    s = midService(s, 44);
    expect(continueFrom(reload(s), 3)).toBe(continueFrom(s, 3));
  });

  it("Stars (with a set menu and sourcing)", () => {
    let s = appReducer(yearTwo(), { type: "fork", choice: "stars" });
    s = { ...s, game: { ...s.game!, cash: 5_000_000 } };
    s = appReducer(s, { type: "stars", cmd: { type: "SIGN_SOURCING", supplierId: "foragers" } });
    s = midService(s, 60);
    expect(continueFrom(reload(s), 3)).toBe(continueFrom(s, 3));
  });
});

describe("reload during a hands-on shift", () => {
  it("clears the sim's hands-on hold so the team carries plates again", () => {
    let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 9, districtId: "seaside", restaurantName: "Det", difficulty: "normal" } });
    let g = s.game!;
    for (let d = 0; d < 3; d++) g = strategies.runStrategyDay(content, g, STRATEGIES.balanced);
    s = midService({ ...s, game: g }, 20);
    s = appReducer(s, { type: "handsOnStart", meta: { role: "server", jumpIn: true } as never });
    expect(s.game!.handsOn?.role).toBe("server");
    const r = reload(s);
    expect(r.meta.handsOn).toBeUndefined();
    expect(r.game!.handsOn).toBeUndefined();
  });
});
