/**
 * Round 6 review seam (c): A's rail bands and course markers against the sim. Over whole bot-played career shifts, at
 * every sim tick: the slips the rail calls hers or the sous chef's are exactly sim-core's station rail
 * (`stationRailTickets`), and every ticket sim-core's sous chef covers on the next tick (`ticketsToCover`) was already
 * amber ("sous"). The helper badge only ever names a `SHADOW_COOK_SUFFIX` cook from sim-core.
 */
import { describe, expect, it } from "vitest";
import { botInput, courseMarkers, createSession, helperAtWork, railView, summarise, updateSession, HELPER_SUFFIX } from "@full-plate/handson";
import { PLAYER_ID } from "@full-plate/sim-career";
import { SHADOW_COOK_SUFFIX, stationRailTickets, ticketsToCover } from "@full-plate/sim-core";
import { appReducer } from "../state/gameReducer";
import { content } from "../sim";
import { secondsPerTick } from "../screens/HandsOnShift";
import { careerChefStart } from "./handsOnHarness";

const STEP = 1 / 60;

function probe(seed: number) {
  let s = careerChefStart(seed);
  s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
  s = appReducer(s, { type: "handsOnStart", meta: { role: "chef", jumpIn: false } });
  const station = s.meta.handsOn!.station!;
  let session = createSession(s.game!, "chef", { content, tutorial: true, playerStaffId: PLAYER_ID, station });
  let acc = 0;
  let t = 0;
  const n = { ticks: 0, railDiff: 0, covered: 0, coveredNotAmber: 0, markers: 0, markerBad: 0, helper: 0, helperBad: 0 };
  while (s.game!.phase === "service" && t < 900) {
    const r = updateSession(session, s.game!, botInput(session, s.game!, 0.55, 0.5), STEP);
    session = r.session;
    if (r.results.length) s = appReducer(s, { type: "handsOnResults", results: r.results });
    t += STEP;
    acc += STEP;
    const secs = secondsPerTick(session, s.game!);
    if (acc < secs) continue;
    acc -= secs;
    const g = s.game!;
    const view = railView(session, g);
    const ours = view.filter((e) => e.owner !== "helper").map((e) => e.ticket.id).sort();
    // The session drops a ticket it has just cooked a frame before the sim sees the plate: compare on the sim's live rail.
    const sim = stationRailTickets(content, g, g.handsOn!.station!).filter((x) => !session.cooked[x.id]).map((x) => x.id).sort();
    n.ticks++;
    if (ours.join() !== sim.join()) n.railDiff++;
    const amber = new Set(view.filter((e) => e.owner === "sous").map((e) => e.ticket.id));
    for (const c of ticketsToCover(content, { ...g, tick: g.tick + 1 }, g.tickets)) {
      if (session.cooked[c.id]) continue;
      n.covered++;
      if (!amber.has(c.id)) n.coveredNotAmber++;
    }
    for (const m of courseMarkers(session, g)) {
      n.markers++;
      const c = g.customers.find((x) => x.id === m.customerId);
      if (!c?.courseOut || c.stage !== "eating") n.markerBad++;
    }
    const h = helperAtWork(session, g);
    if (h) { n.helper++; if (!h.cook.endsWith(SHADOW_COOK_SUFFIX)) n.helperBad++; }
    s = appReducer(s, { type: "handsOnScore", summary: summarise(session) });
    s = appReducer(s, { type: "ticks", n: 1 });
  }
  return n;
}

describe("seam (c): the rail's colours agree with the sim", () => {
  it("imports the shadow-cook suffix from sim-core instead of mirroring it", () => {
    expect(HELPER_SUFFIX).toBe(SHADOW_COOK_SUFFIX);
  });

  it.each([5, 6, 7])("seed %i: every tick, hers+sous = sim-core's rail; every sim cover was amber; markers and helper agree", (seed) => {
    const n = probe(seed);
    expect(n.ticks).toBeGreaterThan(50);
    expect(n.covered).toBeGreaterThan(0);
    expect(n.railDiff).toBe(0);
    expect(n.coveredNotAmber).toBe(0);
    expect(n.markerBad).toBe(0);
    expect(n.helperBad).toBe(0);
  });
});
