/**
 * Round 5 review: the seams between A (station in sim time), B (franchise economics) and C (kid-size UI).
 *
 * (a) The commis's AI hands (`<staffId>~ai`) are a derived Cook, never a Staff record: they must not appear in the
 *     staff list, payroll, the save envelope's staff, or survive the end of hands-on / a reload.
 * (b) Coursing × 86: a coursed dessert 86'd while its party eats the mains still goes out once, the party pays, and
 *     the short-menu rule counts the dish once.
 * (d) Save/reload byte-identical mid-shift with the new optional Customer fields (courseOut / dueTick) present.
 */
import { describe, expect, it } from "vitest";
import { botInput, createSession, NO_INPUT, updateSession, type HandsOnSession } from "@full-plate/handson";
import { PLAYER_ID } from "@full-plate/sim-career";
import { deserialize, isCoursed, serialize, type GameState } from "@full-plate/sim-core";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { decodeSave, encodeSave } from "../state/save";
import { content } from "../sim";
import { secondsPerTick } from "../screens/HandsOnShift";
import { careerChefStart, skipBotShift } from "./handsOnHarness";

const AI = "~ai";
const aiTickets = (g: GameState) => g.tickets.filter((t) => (t.chefId ?? "").endsWith(AI));

interface Run { s: AppState; session: HandsOnSession; acc: number; ticks: number }

function start(seed: number): Run {
  let s = appReducer(careerChefStart(seed), { type: "command", cmd: { type: "START_SERVICE" } });
  s = appReducer(s, { type: "handsOnStart", meta: { role: "chef", jumpIn: false } });
  const station = s.meta.handsOn!.station!;
  const session = createSession(s.game!, "chef", { content, tutorial: true, playerStaffId: PLAYER_ID, station });
  return { s, session, acc: 0, ticks: 0 };
}

/** Advances the hands-on loop by one sim tick (bot at a child's pace, or idle). */
function stepTick(r: Run, idle = false): Run {
  let { s, session, acc } = r;
  for (;;) {
    if (s.game!.phase !== "service") return { s, session, acc, ticks: r.ticks };
    const u = updateSession(session, s.game!, idle ? NO_INPUT : botInput(session, s.game!, 0.55, 0.5), 1 / 60);
    session = u.session;
    if (u.results.length) s = appReducer(s, { type: "handsOnResults", results: u.results });
    acc += 1 / 60;
    const spt = secondsPerTick(session, s.game!);
    if (acc >= spt) {
      acc -= spt;
      s = appReducer(s, { type: "ticks", n: 1 });
      return { s, session, acc, ticks: r.ticks + 1 };
    }
  }
}

function runUntil(r: Run, pred: (g: GameState) => boolean, max = 400, idle = false): Run {
  let x = r;
  for (let i = 0; i < max && x.s.game!.phase === "service" && !pred(x.s.game!); i++) x = stepTick(x, idle);
  return x;
}

function finish(r: Run, idle = false): Run {
  let x = r;
  while (x.s.game!.phase === "service") x = stepTick(x, idle);
  return x;
}

describe("round 5 (a): the commis's `~ai` hands are not a Staff record", () => {
  it("never enter state.staff, the save envelope's staff, or payroll; the AI hands do cook", () => {
    let r = start(4);
    let sawAi = false;
    const ids = r.s.game!.staff.map((x) => x.id).sort();
    while (r.s.game!.phase === "service") {
      r = stepTick(r);
      const g = r.s.game!;
      if (aiTickets(g).length) sawAi = true;
      expect(g.staff.some((x) => x.id.includes(AI))).toBe(false);
      if (r.ticks % 25 === 0 && g.phase === "service") {
        const l = decodeSave(encodeSave(g, r.s.meta));
        expect(l.game.staff.map((x) => x.id).sort()).toEqual(ids);
      }
    }
    expect(sawAi).toBe(true);
    const played = r.s.game!.history.at(-1)!;
    const skipped = skipBotShift(careerChefStart(4));
    // Payroll is the rota's, not the cooks': the shadow cook is not paid twice.
    expect(played.labourCost).toBe(skipped.labourCost);
    expect(Object.keys(played.perChef ?? {}).some((k) => k.endsWith(AI))).toBe(true); // booked to the AI hands, by design
    // Staff mood / fatigue run over state.staff only: same people, same order as a day off.
    expect(r.s.game!.staff.map((x) => x.id).sort()).toEqual(ids);
  }, 120_000);

  it("is gone the tick after hands-on stops, and after an envelope reload", () => {
    const r = runUntil(start(4), (g) => aiTickets(g).some((t) => t.ticksRemaining > 1), 200);
    expect(aiTickets(r.s.game!).length).toBeGreaterThan(0);
    // Walk away from the canvas.
    let walked = appReducer(r.s, { type: "handsOnStop" });
    walked = appReducer(walked, { type: "ticks", n: 1 });
    expect(aiTickets(walked.game!)).toEqual([]);
    // Reload mid-shift: the envelope drops hands-on, so the next tick re-homes the tickets too.
    const l = decodeSave(encodeSave(r.s.game!, r.s.meta));
    let re = appReducer(initialAppState, { type: "load", game: l.game, meta: l.meta });
    expect(re.game!.handsOn).toBeUndefined();
    re = appReducer(re, { type: "ticks", n: 1 });
    expect(aiTickets(re.game!)).toEqual([]);
    // Both run the shift out to the evening.
    while (walked.game!.phase === "service") walked = appReducer(walked, { type: "ticks", n: 5 });
    while (re.game!.phase === "service") re = appReducer(re, { type: "ticks", n: 5 });
    expect(walked.game!.phase).toBe("evening");
    expect(re.game!.phase).toBe("evening");
  }, 120_000);
});

/** A party eating its mains while a coursed station plate is still out. */
function coursedOut(g: GameState): { customerId: string; dishId: string } | undefined {
  const station = g.handsOn?.station;
  if (!station) return undefined;
  for (const c of g.customers) {
    if (!c.courseOut) continue;
    const t = g.tickets.find((x) => x.customerId === c.id && !x.atPass && isCoursed(content, station, x.dishId));
    if (t) return { customerId: c.id, dishId: t.dishId };
  }
  return undefined;
}

describe("round 5 (b): coursing × 86", () => {
  for (const seed of [2, 4, 6]) {
    it(`seed ${seed}: a coursed plate 86'd mid-meal still goes out once, the party pays, the dish counts once`, () => {
      let r = runUntil(start(seed), (g) => !!coursedOut(g), 400, true);
      const hit = coursedOut(r.s.game!);
      expect(hit).toBeDefined();
      const { customerId, dishId } = hit!;
      const ticketsOf = new Set<string>();
      const seen = (g: GameState) => g.tickets.filter((t) => t.dishId === dishId).forEach((t) => ticketsOf.add(t.id));
      seen(r.s.game!);
      const platedBefore = r.s.game!.service!.dishes[dishId]?.plated ?? 0;
      r = { ...r, s: appReducer(r.s, { type: "command", cmd: { type: "EIGHTY_SIX", dishId } }) };
      let paid = false;
      expect(r.s.game!.eightySixed).toContain(dishId);
      while (r.s.game!.phase === "service") {
        r = stepTick(r, true);
        if (r.s.game!.phase === "service") seen(r.s.game!);
        const c = r.s.game!.customers.find((x) => x.id === customerId);
        if (c) expect(c.stage === "left" && !!c.courseOut).toBe(false);
        if (c && (c.stage === "paying" || (c.stage === "left" && !c.walkedOut))) paid = true;
      }
      const g = r.s.game!;
      // Round 10: service can end on a random event card before the evening (seed 4 does since staff personalities
      // re-rolled the career warm-up); either way the shift is over.
      expect(["evening", "event"]).toContain(g.phase);
      const d = g.service!.dishes[dishId]!;
      // Every plate of the dish went out at most once (no plate booked by both the human and the sous chef).
      expect(d.plated).toBeLessThanOrEqual(platedBefore + ticketsOf.size);
      expect(d.plated).toBeLessThanOrEqual(d.sold + ticketsOf.size);
      // The party that was mid-meal got its 86'd plate and paid (an 86 never strands a party on its last course).
      expect(paid).toBe(true);
      // 86 list: once.
      expect((g.eightySixed ?? []).filter((x) => x === dishId)).toHaveLength(1);
    }, 120_000);
  }
});

describe("round 5 (d): mid-shift save with courseOut / dueTick round-trips byte-identically", () => {
  it("sim-core serialize and the envelope, then the shift continues identically", () => {
    const r = runUntil(start(6), (g) => g.customers.some((c) => c.courseOut) && g.customers.some((c) => c.dueTick !== undefined), 400);
    const g = r.s.game!;
    expect(g.customers.some((c) => c.courseOut)).toBe(true);
    expect(g.customers.some((c) => c.dueTick !== undefined)).toBe(true);
    const json = serialize(g);
    expect(serialize(deserialize(json))).toBe(json);
    const env = encodeSave(g, r.s.meta);
    expect(encodeSave(decodeSave(env).game, decodeSave(env).meta)).toBe(env);
    // Continue both (the original and the reloaded sim state, same hands-on session) for the rest of the shift.
    const a = finish(r);
    const b = finish({ ...r, s: { ...r.s, game: deserialize(json) } });
    expect(serialize(b.s.game!)).toBe(serialize(a.s.game!));
  }, 120_000);
});
