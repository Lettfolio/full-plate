/** Round 4: the career hands-on chef owns a commis station; flow and pacing for a slow child. */
import { describe, expect, it } from "vitest";
import { PLAYER_ID } from "@full-plate/sim-career";
import { isCoursed, stationRailTickets } from "@full-plate/sim-core";
import { content } from "../sim";
import { appReducer } from "../state/gameReducer";
import { careerChefStart, playBotDays, playBotShift } from "./handsOnHarness";

describe("commis station (round 4)", () => {
  it("handsOnStart gives an employee chef a station; the sim reserves its rail and AI cooks never cook it", () => {
    let s = careerChefStart(5);
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    s = appReducer(s, { type: "handsOnStart", meta: { role: "chef", jumpIn: false } });
    const st = s.meta.handsOn!.station!;
    expect(st.dishIds.length).toBeGreaterThan(0);
    expect(st.title).toBe("Commis station");
    expect(s.game!.handsOn).toMatchObject({ role: "chef", staffId: PLAYER_ID, station: { dishIds: st.dishIds, cap: st.cap, coverTicks: st.coverTicks } });
    // Without the player doing anything, the rail's tickets sit unassigned until the sim's sous chef covers them
    // (round 5: by age in ticks, or as their party finishes its mains).
    let held = 0;
    for (let i = 0; i < 30; i++) {
      s = appReducer(s, { type: "ticks", n: 1 });
      const g = s.game!;
      const rail = stationRailTickets(content, g, g.handsOn!.station!);
      expect(rail.length).toBeLessThanOrEqual(st.cap);
      for (const t of rail) {
        expect(t.chefId).toBeUndefined();
        // a main is covered by age (+1: it can join the rail in the tick another leaves); a dessert is its own course,
        // due as its party finishes the mains
        if (!isCoursed(content, g.handsOn!.station!, t.dishId)) expect(g.tick - t.createdTick).toBeLessThanOrEqual(st.coverTicks! + 1);
        held++;
      }
    }
    expect(held).toBeGreaterThan(10);
  });

  it("an owner jump-in has no station (shares the rail as before)", () => {
    let s = careerChefStart(5);
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    s = appReducer(s, { type: "handsOnStart", meta: { role: "chef", jumpIn: true } });
    expect(s.meta.handsOn!.station).toBeUndefined();
    expect(s.game!.handsOn!.station).toBeUndefined();
  });

  it("a child who never touches the controls doesn't stall service: the sous chef covers every rail ticket", () => {
    const r = playBotShift(careerChefStart(5), { idle: true });
    expect(["evening", "event"]).toContain(r.app.game!.phase);
    expect(r.summary.plates).toBe(0);
    expect(r.summary.covered).toBeGreaterThan(3);
    const day = r.app.game!.history.at(-1)!;
    expect(day.covers).toBeGreaterThan(30);
    // Round 5: covered plates are booked to the cook who covered (the sim's sous chef), not the player.
    expect(day.perChef?.[PLAYER_ID]?.plates ?? 0).toBe(0);
    expect(r.summary.covered).toBeLessThanOrEqual(Object.values(day.perChef ?? {}).reduce((a, x) => a + x.plates, 0));
  });

  it("a bot commis cooks 10+ plates of its own on the first shift", () => {
    const r = playBotShift(careerChefStart(5), { skill: 0.55 });
    expect(r.summary.plates).toBeGreaterThanOrEqual(10);
    // Round 5: the sim's sous chef sends what the player can't reach in time (desserts as their party finishes the
    // mains, a ticket 8 ticks old), but never because a busy player "idled".
    expect(r.session.score.idleCovers ?? 0).toBe(0);
  });

  it("round 4 review: a slow child's station no longer empties the dining room (patience-aware sous chef)", () => {
    // Before the fix a half-speed child averaged 12.6 walked-out covers a shift (skip: 1.4) and the place lost £95.
    let walk = 0;
    const N = 6;
    for (let seed = 1; seed <= N; seed++) walk += playBotShift(careerChefStart(seed), { skill: 0.55, pace: 0.5 }).app.game!.history.at(-1)!.walkouts;
    expect(walk / N).toBeLessThan(9);
  });
});

describe("a steady flow at the station (round 4 pacing)", () => {
  it("a bot gets 10+ plates every shift of a week and a half-speed bot still gets 5+; the rail is rarely dry", () => {
    for (const [bot, min] of [[{ skill: 0.55, pace: 1 }, 10], [{ skill: 0.55, pace: 0.5 }, 5]] as const) {
      const days = playBotDays(7, bot, 7);
      expect(days.length).toBeGreaterThanOrEqual(4);
      for (const d of days) {
        expect(d.summary.plates, `day ${d.day} pace ${bot.pace}`).toBeGreaterThanOrEqual(min);
        expect(d.drySeconds).toBeLessThan(30);
        // one plate every ~10–33 s of real time, and a shift of 2–5 minutes (round 5: the restaurant slows to the
        // child's pace while they cook — PACING.workSpt — so a half-speed child's shift runs a little longer)
        expect(d.seconds / d.summary.plates).toBeLessThan(33);
        expect(d.seconds).toBeGreaterThan(120);
        expect(d.seconds).toBeLessThan(300);
      }
    }
  }, 120_000);

  it("the station's rail can grow mid-shift (RAIL_RESIZED re-sends SET_HANDS_ON, keeping `since`)", () => {
    let s = careerChefStart(5);
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    s = appReducer(s, { type: "handsOnStart", meta: { role: "chef", jumpIn: false } });
    const since = s.game!.handsOn!.since;
    s = appReducer(s, { type: "handsOnResults", results: [{ type: "RAIL_RESIZED", cap: 3 }] });
    expect(s.game!.handsOn).toMatchObject({ since, station: { cap: 3 } });
  });
});

describe("?autopilot (round 4)", () => {
  it("takes a skill and an optional pace", async () => {
    const { parseAutopilot } = await import("../screens/HandsOnShift");
    expect(parseAutopilot(null)).toBeUndefined();
    expect(parseAutopilot("0.55")).toEqual({ skill: 0.55, pace: 1 });
    expect(parseAutopilot("0.55,0.5")).toEqual({ skill: 0.55, pace: 0.5 });
    expect(parseAutopilot("2,-1")).toEqual({ skill: 1, pace: 0 });
  });
});
