/**
 * Round 12 (E): a voice with an edge (Food Gossip), the rival across the road, the food blogger and the regulars.
 * Everything is derived from the seed, the day and the sim's own results, so a save says the same thing on every load.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { strategies, STRATEGIES, type DayResult, type GameState } from "@full-plate/sim-core";
import { appReducer, initialAppState } from "../state/gameReducer";
import { decodeSave, encodeSave } from "../state/save";
import { initialMeta } from "../state/paths";
import { content } from "../sim";
import { weekdayIndex } from "../lib/calendar";
import { gossipFor, gossipWeek } from "../lib/gossip";
import { cast, floorNames, orderText, regularsFrom, regularsOf, resetFloorNames, storyOf, GOOD_NIGHT } from "../lib/regulars";
import { clippingDay, feed, rivalFor, rivalScore, weekScores, winningLine, type WeekScore } from "../lib/rival";
import { bloggerRating, reviewOn, visitDays, visitsOn } from "../lib/blogger";
import { GossipTicker } from "../components/GossipTicker";
import { RivalCard } from "../components/RivalCard";
import { RegularsBook } from "../components/RegularsBook";
import { EveningExtras } from "../components/EveningExtras";
import { resetTermsSeen } from "../components/Term";

afterEach(() => { cleanup(); resetTermsSeen(); resetFloorNames(); });

const SEED = 9;
function played(days: number, seed = SEED): GameState {
  const s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed, districtId: "seaside", restaurantName: "The Gull", difficulty: "normal" } });
  let g: GameState = s.game!;
  for (let d = 0; d < days; d++) g = strategies.runStrategyDay(content, g, STRATEGIES.typical);
  return g;
}
/** Everything the voices say about a game, as one string. */
function voiceprint(g: GameState): string {
  const rival = rivalFor(g.seed, g.districtId);
  const regs = regularsOf(g);
  return JSON.stringify({
    gossip: gossipWeek(g, g.day, undefined, 30),
    rival: [rival.name, rival.place, winningLine(rival, weekScores(g)), feed(g, rival, g.day, 6)],
    blogger: visitDays(g.seed, g.day).map((d) => reviewOn(g, d)),
    regulars: regs.map((s) => [s.def.id, storyOf(g, s), orderText(g, s)]),
  });
}
const reload = (g: GameState) => decodeSave(encodeSave(g, initialMeta("owner"))).game;

let g40: GameState;
beforeAll(() => { g40 = played(40); });

describe("determinism: the same save says the same thing", () => {
  it("two reloads of a seeded save produce identical gossip, rival, blogger and regulars text", () => {
    const a = voiceprint(reload(g40));
    const b = voiceprint(reload(reload(g40)));
    expect(a).toBe(voiceprint(g40));
    expect(b).toBe(a);
    expect(a).toContain("Ruth Lessley");
  });

  it("a past morning's line, a past week's scores and a finished beat never change as the game goes on", () => {
    const later = played(70);
    const day = 30;
    expect(gossipFor(later, day)).toEqual(gossipFor(g40, day));
    const early = weekScores(g40);
    expect(weekScores(later).slice(0, early.length)).toEqual(early);
    const story = (g: GameState) => regularsOf(g).map((s) => s.done.filter((b) => b.day < 39));
    expect(story(later)).toEqual(story(g40));
  });

  it("reading the voices never touches the game", () => {
    const before = JSON.stringify(g40);
    voiceprint(g40);
    floorNames({ ...g40, phase: "service" });
    expect(JSON.stringify(g40)).toBe(before);
  });
});

/** A one-day game whose yesterday is `y` (history = [y]), for the fact checks. */
function withYesterday(y: Partial<DayResult>, extra: Partial<GameState> = {}): GameState {
  const base = played(0);
  const day: DayResult = { ...(g40.history[5]!), day: 5, closed: false, reviews: [], walkouts: 0, covers: 30, profit: 1000, averageRating: 3.6, ...y };
  return { ...base, day: 6, history: [day], log: [], ...extra };
}

describe("Food Gossip reacts only to what happened", () => {
  it("a 1★ review, a closed day, a hire and a big rush each get their own line, with the real numbers", () => {
    const one = gossipFor(withYesterday({ reviews: [{ day: 5, source: "online", rating: 1, text: "x", dishId: "margherita" }] }));
    expect(one.kind).toBe("oneStar");
    expect(gossipFor(withYesterday({ closed: true, covers: 0 })).kind).toBe("closed");
    const hire = withYesterday({}, { staff: [{ ...played(0).staff[0] ?? g40.staff[0]!, id: "s-new", name: "Zara Quill", hiredDay: 5 }] });
    const h = gossipFor(hire);
    expect(h.kind).toBe("hire");
    expect(h.text).toContain("Zara Quill");
  });

  it("soft news never contradicts the night: a rush line names the real covers, and a quiet line never follows a busy night", () => {
    for (let s = 1; s <= 40; s++) {
      const g = { ...withYesterday({ covers: 120, walkouts: 0 }), seed: s };
      const line = gossipFor(g);
      expect(line.kind).not.toBe("quiet");
      if (line.kind === "rush") expect(line.text).toContain("120");
    }
  });

  it("over 40 days the ticker uses reactions, the running jokes and patter, and the 7-day list is newest first", () => {
    const kinds = new Set(gossipWeek(g40, g40.day, undefined, 41).map((l) => l.kind));
    for (const k of ["opening", "joke", "patter", "regular", "blogger"]) expect(kinds.has(k as never), k).toBe(true);
    const week = gossipWeek(g40);
    expect(week).toHaveLength(7);
    expect(week[0]!.day).toBe(g40.day);
  });
});

describe("the rival", () => {
  it("is named from the seed and district, and their score is a mirror (district, week, the player's standing)", () => {
    const r = rivalFor(SEED, "seaside");
    expect(rivalFor(SEED, "seaside")).toEqual(r);
    expect(r.personality.id).toBeTruthy();
    const ids = new Set(Array.from({ length: 60 }, (_, i) => rivalFor(i, "high_street").personality.id));
    expect(ids.size).toBe(8);
    for (const w of weekScores(g40)) expect(rivalScore(g40, w.start)).toBe(w.them);
  });

  it("three weeks running ahead earns the clipping once, on the Monday after", () => {
    const w = (start: number, result: WeekScore["result"]): WeekScore => ({ start, you: 4, them: 3, result });
    expect(clippingDay([w(0, "you"), w(7, "you"), w(14, "them"), w(21, "you")])).toBeUndefined();
    expect(clippingDay([w(0, "them"), w(7, "you"), w(14, "you"), w(21, "you"), w(28, "you")])).toBe(28);
  });

  it("posts two or three times a week, reacting to last night or last week", () => {
    const posts = feed(g40, rivalFor(g40.seed, g40.districtId), g40.day, 20);
    expect(posts.length).toBeGreaterThanOrEqual(10);
    for (const p of posts) expect(p.text.length).toBeGreaterThan(10);
  });
});

describe("the food blogger", () => {
  it("visits first on day 8-12, then every 18-24 days; rude but fair stars", () => {
    for (let s = 0; s < 30; s++) {
      const v = visitDays(s, 200);
      expect(v[0]).toBeGreaterThanOrEqual(8);
      expect(v[0]).toBeLessThanOrEqual(12);
      for (let i = 1; i < v.length; i++) { expect(v[i]! - v[i - 1]!).toBeGreaterThanOrEqual(18); expect(v[i]! - v[i - 1]!).toBeLessThanOrEqual(24); }
    }
    const night = g40.history[10]!;
    expect(bloggerRating({ ...night, averageRating: 4.0, covers: 40, walkouts: 0 })).toBe(4); // 3.75 → 4
    expect(bloggerRating({ ...night, averageRating: 4.0, covers: 40, walkouts: 10 })).toBe(3); // a queue out of the door: 3.25 → 3
    expect(bloggerRating({ ...night, averageRating: 4.0, covers: 40, walkouts: 2 })).toBe(4); // two walk-outs don't count
    expect(bloggerRating({ ...night, averageRating: 1.1, walkouts: 0 })).toBe(1);
  });

  it("sits on the floor as a named guest on her visit day", () => {
    const day = visitDays(SEED, 40)[0]!;
    let g = played(day);
    expect(visitsOn(SEED, g.day)).toBe(true);
    g = { ...g, phase: "service" };
    // a seated small party after her arrival time
    // seated parties of every kind after her arrival time (a regular joining today may take one of them first)
    const customers = ["students", "families", "business", "foodies", "tourists", "foodies"].map((segment, i) => ({
      id: `c${i}`, segment, partySize: 2, arrivedTick: 105 + i, stage: "seated" as const, tableId: g.tables[0]!.id, order: [],
      patience: 80, satisfaction: 70, spend: 0, tip: 0,
    }));
    const names = floorNames({ ...g, customers });
    expect([...names.values()].some((n) => n.startsWith("Ruth Lessley"))).toBe(true);
  });
});

describe("the regulars", () => {
  it("the cast joins in a seeded order from day 1; a VIP order is met on its weekday with the dish sold and a good night", () => {
    const c = cast(SEED);
    expect(c[0]!.plannedDay).toBe(1);
    const first = regularsOf(g40).find((s) => s.def.id === c[0]!.def.id)!;
    expect(first.joined).toBeGreaterThanOrEqual(1);
    expect(first.done[0]!.beat).toBe(0);
    // Build a history by hand: open day 1 (intro), then the order's weekday with the dish sold.
    const day1 = { ...g40.history[1]!, day: 1, closed: false, covers: 20 };
    const after1 = regularsFrom(SEED, [day1])[regularsFrom(SEED, [day1]).findIndex((s) => s.def.id === c[0]!.def.id)]!;
    const o = after1.open!;
    expect(o.beat).toBe(1);
    expect(o.from - 1).toBeGreaterThanOrEqual(5);
    const meet = (rating: number): DayResult => ({ ...day1, day: o.from, averageRating: rating, perDish: { [o.dishId]: { sold: 2, plated: 2, qualityMean: 70, revenue: 2000, foodCost: 500 } } });
    expect(weekdayIndex(o.from)).toBe(o.weekday);
    const good = regularsFrom(SEED, [day1, meet(GOOD_NIGHT)]).find((s) => s.def.id === c[0]!.def.id)!;
    expect(good.done.map((b) => [b.beat, b.good])).toEqual([[0, true], [1, true]]);
    const poor = regularsFrom(SEED, [day1, meet(2.5)]).find((s) => s.def.id === c[0]!.def.id)!;
    const beat = c[0]!.def.beats[0]!;
    if (beat.bad) expect(poor.done.map((b) => [b.beat, b.good])).toEqual([[0, true], [1, false]]);
    else { expect(poor.done).toHaveLength(1); expect(poor.open!.triedDay).toBe(o.from); }
  });

  it("no more than three stories run at once", () => {
    const g = played(80);
    for (let d = 0; d <= g.day; d++) {
      const regs = regularsFrom(g.seed, g.history.filter((x) => x.day <= d));
      expect(regs.filter((s) => s.open).length).toBeLessThanOrEqual(3);
    }
  });
});

describe("on screen", () => {
  it("the ticker shows this morning's line and 'More' lists the last seven mornings", async () => {
    render(<GossipTicker game={g40} />);
    expect(screen.getByTestId("gossip-line").textContent).toBe(gossipFor(g40).text);
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("list", { name: "The last seven mornings" }).querySelectorAll("li")).toHaveLength(7);
  });

  it("the rival card says who's winning on reviews and shows their posts", () => {
    render(<RivalCard game={g40} />);
    const rival = rivalFor(g40.seed, g40.districtId);
    expect(screen.getByTestId("rival-score").textContent).toContain(winningLine(rival, weekScores(g40)));
    expect(screen.getByTestId("rival-feed").querySelectorAll("li").length).toBeGreaterThan(0);
  });

  it("the Regulars book shows an open VIP order and the story so far", () => {
    const g = played(5);
    render(<RegularsBook game={g} onClose={() => {}} />);
    expect(screen.getAllByTestId("vip-order").length).toBeGreaterThan(0);
    expect(screen.getByRole("list", { name: /story so far/ }).querySelectorAll("li").length).toBeGreaterThanOrEqual(1);
  });

  it("on her visit night the Evening shows the blogger's review with a headline", async () => {
    const day = visitDays(SEED, 40)[0]!;
    const g = played(day + 1);
    const r = g.history.find((d) => d.day === day)!;
    render(<EveningExtras game={{ ...g, day }} result={r} />);
    const rv = reviewOn(g, day)!;
    expect(screen.getByTestId("blogger-review").textContent).toContain(rv.headline);
    await waitFor(() => expect(screen.getByTestId("gossip-tomorrow").textContent).toBe(gossipFor(g, day + 1).text));
  });
});
