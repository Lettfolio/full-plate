/**
 * Round 4 review: the new seams under deep-frozen inputs. Every AppState / GameState handed to the reducer or to a
 * round-4 helper is frozen first, so a write into an input throws. Covers the commis station (handsOnStart, the bot's
 * results, RAIL_RESIZED, the sous chef's covers), sim-core's capacity model, starsHints and the short-menu evening,
 * and Empire's newGameFromSite (focusSite) + calibrate.
 */
import { describe, expect, it } from "vitest";
import { botInput, commisStation, createSession, NO_INPUT, shiftTempo, stationTickets, updateSession } from "@full-plate/handson";
import { PLAYER_ID } from "@full-plate/sim-career";
import { capacityCovers, expectedDemand, serviceCapacity, strategies, STRATEGIES, type GameState } from "@full-plate/sim-core";
import { starsHints } from "@full-plate/sim-stars";
import { calibrate } from "@full-plate/sim-empire";
import { appReducer, initialAppState, type AppAction, type AppState } from "../state/gameReducer";
import { content, SERVICE_TICKS } from "../sim";
import { FORK_DAY, initialMeta } from "../state/paths";
import { careerChefStart } from "./handsOnHarness";
import { secondsPerTick } from "../screens/HandsOnShift";

function deepFreeze<T>(x: T): T {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
  }
  return x;
}
const step = (s: AppState, a: AppAction): AppState => appReducer(deepFreeze(s), deepFreeze(a));

function yearTwo(seed = 17): AppState {
  const s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed, districtId: "high_street", restaurantName: "Ice", difficulty: "normal" } });
  let g: GameState = s.game!;
  for (let d = 0; d < 24; d++) g = strategies.runStrategyDay(content, g, STRATEGIES.balanced);
  g = { ...g, day: FORK_DAY, history: g.history.map((h) => ({ ...h, profit: Math.max(h.profit, 10_000) })) };
  return { ...s, game: g, meta: { ...initialMeta("owner"), lastPathDay: FORK_DAY - 1, morningDay: FORK_DAY } };
}

describe("round 4 seams with deep-frozen inputs", () => {
  it("a whole commis-station shift (bot at a child's pace with an idle stretch, so the sous chef covers) writes into nothing", () => {
    let s = step(careerChefStart(3), { type: "command", cmd: { type: "START_SERVICE" } });
    s = step(s, { type: "handsOnStart", meta: { role: "chef", jumpIn: false } });
    const station = s.meta.handsOn!.station!;
    expect(commisStation(deepFreeze(s.game!), content, 0)).toEqual(station);
    let session = createSession(deepFreeze(s.game!), "chef", { content, tutorial: true, playerStaffId: PLAYER_ID, station });
    let acc = 0;
    let covered = 0;
    let t = 0;
    while (s.game!.phase === "service" && t < 900) {
      // An idle stretch in the middle so the sous chef has to cover.
      const idle = t > 60 && t < 140;
      const inp = idle ? NO_INPUT : botInput(deepFreeze(session), s.game!, 0.55, 0.5);
      const r = updateSession(deepFreeze(session), deepFreeze(s.game!), deepFreeze(inp), 1 / 60);
      session = r.session;
      covered += r.results.filter((x) => x.type === "PLATE_COOKED" && x.covered).length;
      if (r.results.length) s = step(s, { type: "handsOnResults", results: r.results });
      stationTickets(deepFreeze(session), s.game!);
      shiftTempo(session, s.game!);
      acc += 1 / 60;
      t += 1 / 60;
      const spt = secondsPerTick(session, s.game!);
      if (acc >= spt) { acc -= spt; s = step(s, { type: "ticks", n: 1 }); }
    }
    expect(["evening", "event"]).toContain(s.game!.phase);
    expect(covered).toBeGreaterThan(0);
    expect(session.score.plates).toBeGreaterThan(0);
  });

  it("capacity model, starsHints and a short-menu Stars evening", () => {
    const y2 = yearTwo();
    const g = deepFreeze(y2.game!);
    expect(serviceCapacity(content, g)).toBeGreaterThan(0);
    expect(expectedDemand(content, g).covers).toBeGreaterThan(0);
    expect(capacityCovers(deepFreeze({ tables: 8, meanParty: 2.4, crewUnits: 2, crewSkill: 60 }))).toBeGreaterThan(0);
    let s = step(y2, { type: "fork", choice: "stars" });
    expect(starsHints(content, deepFreeze(s.meta.stars!), deepFreeze(s.game!)).length).toBeGreaterThan(0);
    s = { ...s, game: { ...s.game!, stock: [], orders: [] } };
    s = step(s, { type: "command", cmd: { type: "START_SERVICE" } });
    for (let i = 0; i <= SERVICE_TICKS && s.game!.phase === "service"; i++) s = step(s, { type: "ticks", n: 20 });
    expect(s.meta.starsEvents.some((e) => e.type === "SHORT_MENU")).toBe(true);
  });

  it("Empire: calibrate and Run it hands-on (newGameFromSite)", () => {
    const y2 = yearTwo(21);
    calibrate(content, deepFreeze(y2.game!.history), { state: deepFreeze(y2.game!) } as never);
    let s = step(y2, { type: "fork", choice: "empire", brandName: "Ice Burgers" });
    s = step(s, { type: "empire", cmd: { type: "SET_FORMULA", locked: true } });
    const e = s.meta.empire!;
    const site = { ...e.sites[0]!, id: "s2", name: "Ice Campus", districtId: "student_quarter", focused: false, staffQuality: 45, opened: e.hq.day - 200 };
    delete site.tables;
    s = { ...s, meta: { ...s.meta, empire: { ...e, sites: [...e.sites, site] } } };
    const f = step(s, { type: "focusSite", siteId: "s2" });
    expect(f.game!.restaurantName).toBe("Ice Campus");
    const back = step(f, { type: "focusSite", siteId: "s1" });
    expect(back.game!.restaurantName).toBe("Ice");
  });
});
