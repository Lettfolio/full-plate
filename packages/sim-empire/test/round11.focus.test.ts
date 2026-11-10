/**
 * Round 11 (red-team G1, G5–G8): the hands-on site's money and memory (src/focus.ts), HQ → till transfers and the
 * board's debt question.
 */
import { describe, expect, it } from "vitest";
import { serialize as serializeGame, type GameState } from "@full-plate/sim-core";
import {
  applyEmpireCommand, backTill, buildBoardMeeting, closeAndMoveOn, debtOptions, switchSite, emptyBook, empireOutcome, forkFromGameState, hqSinkingPerDay, larderCost, newGameFromSite, openTill,
  parkSite, pruneParked, restoreSite, settleTill, spendable, sweepable, tillCover, tillFloat, EMPIRE, PARKED_HISTORY_DAYS,
  type EmpireState, type ParkedSite, type SiteSummary,
} from "../src/index";
import { Rng } from "../src/rng";
import { content, focusedRun, must, rejected, withApplicant } from "./helpers";

const run = focusedRun(5, 120);
const forked = () => forkFromGameState(content, run.state, { brandName: "Round Eleven" });

/** A second open company site (built long ago) and a franchised one. */
function withSites(e: EmpireState): EmpireState {
  const base = e.sites[0]!;
  const co: SiteSummary = { ...base, id: "s7", name: "Campus", districtId: "student_quarter", focused: false, opened: e.hq.day - 400 };
  const fr: SiteSummary = { ...base, id: "s8", name: "Seafront", districtId: "seaside", focused: false, ownership: "franchise", franchisee: "f1", opened: e.hq.day - 400 };
  for (const s of [co, fr]) { delete s.popularity; delete s.prestige; delete s.tables; }
  return { ...e, sites: [...e.sites, co, fr] };
}

describe("G1: HQ backs the hands-on till", () => {
  it("tillCover covers an overdraft up to what HQ can spend, and nothing when the till is in credit or HQ is bust", () => {
    const e = forked();
    const g: GameState = { ...run.state, cash: -500_000 };
    expect(tillCover(e, g)).toBe(500_000);
    expect(tillCover(e, { ...g, cash: 10 })).toBe(0);
    const poor = { ...e, hq: { ...e.hq, cash: -developmentFacilityOf(e) + 200_000 } };
    expect(spendable(poor)).toBe(200_000);
    expect(tillCover(poor, g)).toBe(200_000);
    expect(tillCover({ ...e, status: "bankrupt" }, g)).toBe(0);
  });

  it("TRANSFER_TO_FOCUSED debits HQ, refuses more than HQ can spend (except to settle a closing till) and junk amounts", () => {
    const e = forked();
    const r = applyEmpireCommand(content, e, { type: "TRANSFER_TO_FOCUSED", amount: 123_456, why: "topUp" });
    expect(r.empire.hq.cash).toBe(e.hq.cash - 123_456);
    expect(r.events.find((x) => x.kind === "topUp")!.text).toBe("HQ topped up the till £1,235.");
    const big = spendable(e) + 1;
    expect(rejected(e, { type: "TRANSFER_TO_FOCUSED", amount: big })).toMatch(/HQ can only spend/);
    expect(must(e, { type: "TRANSFER_TO_FOCUSED", amount: big, why: "close" }).hq.cash).toBe(e.hq.cash - big);
    for (const amount of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(rejected(e, { type: "TRANSFER_TO_FOCUSED", amount })).toBeTruthy();
    const { focusedSiteId: _f, ...unfocused } = e;
    expect(rejected(unfocused as EmpireState, { type: "TRANSFER_TO_FOCUSED", amount: 100 })).toMatch(/No restaurant/);
  });

  it("the sweep leaves a week's rent and wages; leaving a site settles its till and tomorrow's paid-for deliveries", () => {
    const g = run.state;
    const float = tillFloat(content, g);
    expect(float).toBeGreaterThan(50_000);
    expect(sweepable(content, { ...g, cash: float + 999 })).toBe(999);
    expect(sweepable(content, { ...g, cash: float - 1 })).toBe(0);
    expect(settleTill({ ...g, cash: -1_000, orders: [{ ingredientId: "x", qty: 1, cost: 400 }] })).toBe(-600);
  });
});

describe("G6: HQ pays for a visited till (no free £20,000)", () => {
  it("openTill: a week's float plus the larder from HQ; a short HQ gets a smaller float; a broke one is refused", () => {
    const e = withSites(forked());
    const site = e.sites.find((s) => s.id === "s7")!;
    const g = newGameFromSite(content, e, site, new Rng([1, 2, 3, 4]), { cash: 0 });
    const plan = openTill(content, e, g);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.cash).toBe(tillFloat(content, g));
    expect(plan.larder).toBe(larderCost(content, g.stock));
    expect(plan.larder).toBeGreaterThan(0);
    expect(plan.hqPays).toBe(plan.cash + plan.larder);
    // HQ can spend only the larder and two days: a smaller float.
    const can = plan.larder + Math.round((2 * plan.float) / 7);
    const short = { ...e, hq: { ...e.hq, cash: can - developmentFacilityOf(e) } };
    const p2 = openTill(content, short, g);
    expect(p2.ok && p2.short && p2.cash).toBe(can - plan.larder);
    // HQ can't even cover the larder and a day: refused with the reason (unless forced after a bust).
    const broke = { ...e, hq: { ...e.hq, cash: -developmentFacilityOf(e) } };
    const p3 = openTill(content, broke, g);
    expect(p3.ok).toBe(false);
    if (!p3.ok) expect(p3.reason).toMatch(/HQ can't open the till at Campus: it needs £[\d,]+ .* and can spend £0\./);
    const p4 = openTill(content, broke, g, true);
    expect(p4.ok && p4.cash).toBe(0);
    expect(p4.ok && p4.hqPays).toBe(plan.larder);
  });
});

describe("G7: parked sites are small, pruned and migrated", () => {
  it("parkSite keeps the room, menu, crew and the last 90 days without reviews; restoreSite brings them back", () => {
    const e = withSites(forked());
    const p = parkSite(run.state);
    expect(p.history).toHaveLength(Math.min(PARKED_HISTORY_DAYS, run.state.history.length));
    expect(p.history.every((d) => d.reviews.length === 0 && d.perDish === undefined)).toBe(true);
    expect(p.history.at(-1)!.profit).toBe(run.state.history.at(-1)!.profit);
    expect(JSON.stringify(p).length).toBeLessThan(serializeGame(run.state).length / 5);
    const site = e.sites.find((s) => s.id === "s7")!;
    const back = restoreSite(content, e, site, p, new Rng([4, 3, 2, 1]));
    expect(back.staff).toEqual(run.state.staff);
    expect(back.menu).toEqual(run.state.menu);
    expect(back.tables.length).toBe(run.state.tables.length);
    expect(back.reputation).toEqual(run.state.reputation);
    expect(back.cash).toBe(0);
    expect(back.stock.length).toBeGreaterThan(0);
    expect(back.phase).toBe("planning");
  });

  it("pruneParked drops closed, sold, franchised and focused sites, migrates old whole-GameState strings, keeps the same object when clean", () => {
    let e = withSites(forked());
    const slim = parkSite(run.state);
    const clean = { s7: slim };
    expect(pruneParked(clean, e)).toBe(clean);
    expect(pruneParked(undefined, e)).toBeUndefined();
    const old: Record<string, ParkedSite | string> = { s7: serializeGame(run.state), s8: slim, s1: slim, gone: slim };
    const pruned = pruneParked(old, e)!;
    expect(Object.keys(pruned)).toEqual(["s7"]);
    expect(pruned.s7!.v).toBe(1);
    expect(pruned.s7!.staff).toEqual(run.state.staff);
    e = must(e, { type: "CLOSE_SITE", siteId: "s7" });
    expect(pruneParked({ s7: slim }, e)).toEqual({});
  });

  it("ten parked sites stay well under 1 MB (the red-team's 16.5 MB → target < 1 MB)", () => {
    const parked: Record<string, ParkedSite> = {};
    const long = focusedRun(9, 400).state;
    for (let i = 0; i < 10; i++) parked[`s${100 + i}`] = parkSite(long);
    const before = serializeGame(long).length * 10;
    const after = JSON.stringify(parked).length;
    expect(before).toBeGreaterThan(10_000_000);
    expect(after).toBeLessThan(1_000_000);
  });
});

describe("G8: bankruptcy is visible, and the board offers a way out of debt", () => {
  it("empireOutcome: running, sinking (can't spend and losing money) and bankrupt", () => {
    const e = forked();
    expect(empireOutcome(e).status).toBe("running");
    const sinking = { ...e, hq: { ...e.hq, cash: -developmentFacilityOf(e) - 1_000_000, income30d: -3_000_000 } };
    expect(hqSinkingPerDay(sinking)).toBe(100_000);
    expect(empireOutcome(sinking)).toMatchObject({ status: "sinking", sinkPerDay: 100_000 });
    expect(empireOutcome({ ...sinking, status: "bankrupt" }).status).toBe("bankrupt");
    expect(empireOutcome(sinking).headroom).toBe(Math.round(sinking.hq.cash + EMPIRE.HQ_CREDIT_LINE * e.hq.priceLevel));
  });

  it("when HQ can't spend and is losing money, the board's only question is the debt: sell a shop to an applicant or close a loss-maker", () => {
    let e = withApplicant(withSites(forked()), "a1", { cash: 90_000_000 });
    e = { ...e, sites: e.sites.map((s) => (s.id === "s7" ? { ...s, margin7d: -700_000 } : s)), hq: { ...e.hq, cash: -developmentFacilityOf(e) - 5_000_000, income30d: -900_000 } };
    expect(spendable(e)).toBeLessThan(0);
    const opts = debtOptions(e);
    expect(opts.map((o) => o.id)).toEqual(["sell", "close"]);
    expect(opts[0]!.cmd).toEqual({ type: "SELL_FRANCHISE", siteId: "s7", applicantId: "a1" });
    expect(opts[0]!.label).toBe("Sell Campus to Applicant");
    expect(opts[1]!.label).toBe("Close Campus");
    const m = buildBoardMeeting(content, e, emptyBook(), e.hq.day);
    expect(m.decision.kind).toBe("debt");
    expect(m.decision.options.map((o) => o.id)).toEqual(["sell", "close", "hold"]);
    expect(m.decision.advice).toBe("sell");
    // Taking the sale pays HQ the fee and the building.
    const sold = must(e, opts[0]!.cmd);
    expect(sold.hq.cash - e.hq.cash).toBe(opts[0]!.gain);
    // With money to spend, or borrowed to the limit while still earning (a growing chain), it never comes up.
    expect(buildBoardMeeting(content, forked(), emptyBook(), e.hq.day).decision.kind).not.toBe("debt");
    expect(buildBoardMeeting(content, { ...e, hq: { ...e.hq, income30d: 900_000 } }, emptyBook(), e.hq.day).decision.kind).not.toBe("debt");
  });
});

describe("switching restaurants (switchSite / closeAndMoveOn / backTill)", () => {
  it("are pure (deep-frozen inputs), deterministic, refuse franchises, and move the till's money through HQ", () => {
    const e = deepFreeze(withSites(forked()));
    const g = deepFreeze({ ...run.state, cash: 1_234_567 });
    const a = switchSite(content, e, g, undefined, "s7");
    const b = switchSite(content, e, g, undefined, "s7");
    if ("error" in a || "error" in b) throw new Error("refused");
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.empire.focusedSiteId).toBe("s7");
    expect(Object.keys(a.parked)).toEqual(["s1"]);
    const float = a.events.find((x) => x.kind === "topUp")!;
    expect(float.text).toMatch(/^HQ paid £[\d,]+ to open Campus/);
    // HQ: + the flagship's till and tomorrow's deliveries, − the new float and larder.
    const larder = larderCost(content, a.game.stock);
    expect(a.empire.hq.cash).toBe(e.hq.cash + settleTill(g) - a.game.cash - larder);
    expect(switchSite(content, e, g, undefined, "s8")).toEqual({ error: "Seafront belongs to its franchisee: you can only run your own company shops hands-on." });
    // Coming back restores the flagship's crew.
    const back = switchSite(content, a.empire, a.game, a.parked, "s1");
    if ("error" in back) throw new Error(back.error);
    expect(back.game.staff).toEqual(run.state.staff);
    expect(Object.keys(back.parked)).toEqual(["s7"]);
    // A bust till HQ can't save: close it and run the other company shop tomorrow.
    const broke = deepFreeze({ ...e, hq: { ...e.hq, cash: -developmentFacilityOf(e) } });
    const bust = deepFreeze({ ...run.state, phase: "gameover" as const, cash: -5_000_000 });
    expect(backTill(content, broke, bust).game).toBe(bust);
    const moved = closeAndMoveOn(content, broke, bust, undefined);
    if ("error" in moved) throw new Error(moved.error);
    expect(moved.empire.sites.find((x) => x.id === "s1")!.status).toBe("closed");
    expect(moved.game.restaurantName).toBe("Campus");
    expect(moved.game.day).toBe(e.hq.day);
    // With money at HQ the same bust comes back to the evening.
    const saved = backTill(content, e, bust);
    expect(saved.game).toMatchObject({ phase: "evening", cash: 0, distressDays: 0 });
    expect(saved.game.gameOverReason).toBeUndefined();
    expect(saved.empire.hq.cash).toBe(e.hq.cash - 5_000_000);
  });
});

function deepFreeze<T>(x: T): T {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as object)) deepFreeze(v);
  }
  return x;
}

function developmentFacilityOf(e: EmpireState): number {
  return spendable(e) - e.hq.cash;
}
