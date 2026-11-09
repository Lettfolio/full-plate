/** Round 4: the career hands-on chef owns a commis station; flow and pacing for a slow child. */
import { describe, expect, it } from "vitest";
import { PLAYER_ID } from "@full-plate/sim-career";
import { HANDS_ON } from "@full-plate/sim-core";
import { appReducer } from "../state/gameReducer";
import { careerChefStart, playBotShift } from "./handsOnHarness";

describe("commis station (round 4)", () => {
  it("handsOnStart gives an employee chef a station; the sim reserves its rail and AI cooks never cook it", () => {
    let s = careerChefStart(5);
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    s = appReducer(s, { type: "handsOnStart", meta: { role: "chef", jumpIn: false } });
    const st = s.meta.handsOn!.station!;
    expect(st.dishIds.length).toBeGreaterThan(0);
    expect(st.title).toBe("Commis station");
    expect(s.game!.handsOn).toMatchObject({ role: "chef", staffId: PLAYER_ID, station: { dishIds: st.dishIds, cap: st.cap } });
    // Without the player doing anything, the rail's tickets sit unassigned (the session's sous chef covers them).
    let held = 0;
    for (let i = 0; i < 30; i++) {
      s = appReducer(s, { type: "ticks", n: 1 });
      const g = s.game!;
      const rail = g.tickets.filter((t) => st.dishIds.includes(t.dishId) && !t.atPass && t.ticksRemaining > 0).slice(0, st.cap);
      for (const t of rail) if (g.tick - t.createdTick < HANDS_ON.stationFallbackTicks) { expect(t.chefId).toBeUndefined(); held++; }
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
    expect(day.perChef?.[PLAYER_ID]?.plates ?? 0).toBe(r.summary.covered); // covered plates are booked to the station
  });

  it("a bot commis cooks 10+ plates of its own on the first shift", () => {
    const r = playBotShift(careerChefStart(5), { skill: 0.55 });
    expect(r.summary.plates).toBeGreaterThanOrEqual(10);
    expect(r.summary.covered).toBe(0);
  });
});
