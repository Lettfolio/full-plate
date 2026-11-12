/**
 * Round 14 (F, G4): the regulars' VIP orders name a dish she cooks, lapse after three missed weekdays into a "went
 * elsewhere that night" beat (no photo, the story moves on), and a stalled order no longer blocks the newcomers.
 * On master the reviewer's 1,000-day games had 3–4 of 10 regulars ever join and none finish.
 */
import { describe, expect, it } from "vitest";
import type { DayResult, GameState } from "@full-plate/sim-core";
import { content, newGame, runStrategyDay, STRATEGIES } from "../sim";
import { memoFrom } from "../lib/voicesMemo";
import { cast, lapseDay, LAPSE_AFTER, regularsFrom, storyOf } from "../lib/regulars";
import { weekdayIndex } from "../lib/calendar";
import type { VoicesMemo } from "../state/paths";
import { voices } from "@full-plate/content/voices";

const sum = (n: number, sold = 1) => ({ sold, plated: sold, qualityMean: 70, revenue: 1000, foodCost: 300, n });
/** A minimal open night: `dishes` ordered (and sold), average `rating`. */
function night(day: number, dishes: string[], rating = 4.5): DayResult {
  return {
    day, covers: 40, walkouts: 0, revenue: 100000, tips: 0, foodCost: 30000, labourCost: 20000, rent: 10000, loanPayment: 0,
    waste: { prep: 0, plate: 0, spoil: 0 }, profit: 40000, averageSpend: 2500, averageRating: rating, popularityDelta: 0, prestigeDelta: 0,
    reviews: [], staffMoodDelta: {},
    perDish: Object.fromEntries(dishes.map((d) => { const { n: _n, ...line } = sum(0); return [d, line]; })),
  };
}

describe("Round 14 F — G4 regulars", () => {
  for (const [strat, seed, district] of [["typical", 11, "high_street"], ["balanced", 12, "seaside"], ["cheap", 13, "student_quarter"]] as const) {
    it(`${strat}: in a 1,000-day game at least 8 of 10 regulars join and at least 5 finish; memo = fold`, () => {
      let g: GameState = newGame(content, { type: "NEW_GAME", seed, districtId: district, restaurantName: "Long Table", difficulty: "normal" });
      let memo: VoicesMemo | undefined;
      const mismatch: number[] = [];
      while (g.day < 1000 && g.phase !== "gameover") {
        g = runStrategyDay(content, g, STRATEGIES[strat]);
        memo = memoFrom(g, JSON.parse(JSON.stringify(memo ?? null)) ?? undefined);
        if (g.history.length < 400 && g.day % 40 === 0) {
          const a = JSON.stringify(regularsFrom(g.seed, g.history, memo).map((s) => [s.def.id, s.joined, s.done, s.open]));
          const b = JSON.stringify(regularsFrom(g.seed, g.history).map((s) => [s.def.id, s.joined, s.done, s.open]));
          if (a !== b) mismatch.push(g.day);
        }
      }
      const regs = regularsFrom(g.seed, g.history, memo);
      const joined = regs.filter((s) => s.joined !== undefined).length;
      const finished = regs.filter((s) => s.done.some((b) => b.beat === s.def.beats.length)).length;
      expect(mismatch).toEqual([]);
      expect(joined).toBeGreaterThanOrEqual(8);
      expect(finished).toBeGreaterThanOrEqual(5);
      // Most beats are met, not lapsed, when she runs a real menu.
      const met = regs.flatMap((s) => s.done.filter((b) => b.beat > 0 && !b.lapsed)).length;
      const lapsed = regs.flatMap((s) => s.done.filter((b) => b.lapsed)).length;
      expect(met).toBeGreaterThan(lapsed * 3);
      // No order is left open longer than its lapse window plus a week of closures.
      for (const s of regs) if (s.open) expect(g.day - s.open.since).toBeLessThanOrEqual(8 + 7 * LAPSE_AFTER + 7);
    }, 600_000);
  }

  it("an order names one of the beat's dishes she cooks, else one of hers from the same course", () => {
    const seed = 5;
    const first = cast(seed)[0]!;
    const beat1 = first.def.beats[0]!.dishes;
    // Day 1: she cooks only the last of the beat's dishes (plus an unrelated one).
    const other = content.dishes.find((d) => !beat1.includes(d.id) && d.course === content.dishes.find((x) => x.id === beat1[0])!.course && !d.id.startsWith("f"))!;
    let regs = regularsFrom(seed, [night(1, [beat1.at(-1)!, other.id])]);
    expect(regs.find((s) => s.def.id === first.def.id)!.open!.dishId).toBe(beat1.at(-1));
    // None of the beat's dishes: one of hers from that course.
    regs = regularsFrom(seed, [night(1, [other.id])]);
    expect(regs.find((s) => s.def.id === first.def.id)!.open!.dishId).toBe(other.id);
  });

  it("an unmet order lapses on its third weekday: no dish, no photo, the next order is set, and the memo keeps it", () => {
    const seed = 5;
    const reg = cast(seed)[0]!;
    const dish0 = reg.def.beats[0]!.dishes[0]!;
    const hist: DayResult[] = [night(1, [dish0])];
    const o = regularsFrom(seed, hist).find((s) => s.def.id === reg.def.id)!.open!;
    // Every night until well past the lapse day she cooks something else entirely.
    const elsewhere = content.dishes.find((d) => d.course !== content.dishes.find((x) => x.id === dish0)!.course)!.id;
    for (let d = 2; d <= lapseDay(o) + 1; d++) hist.push(night(d, [elsewhere]));
    const s = regularsFrom(seed, hist).find((x) => x.def.id === reg.def.id)!;
    const lapsed = s.done.find((b) => b.beat === 1)!;
    expect(lapsed).toMatchObject({ beat: 1, good: false, lapsed: true, day: lapseDay(o) });
    expect(weekdayIndex(lapsed.day)).toBe(o.weekday);
    expect(lapsed.dishId).toBeUndefined();
    expect(s.open?.beat).toBe(2);
    const g = { seed, history: hist, restaurantName: "Long Table", districtId: "high_street" } as unknown as GameState;
    const words = storyOf(g, s).find((b) => b.beat === 1)!;
    expect(words.photo).toBeUndefined();
    expect(voices.regulars.lapsed!.map((t) => t.replace("{name}", reg.def.name.split(" ")[0]!))).toContain(words.text);
    // The memo stores it as [beat, day, 0] — the R13 format — and reads back as lapsed.
    const memo = memoFrom({ seed, history: hist, districtId: "high_street" });
    const row = memo.regs.find((r) => r.id === reg.def.id)!.done.find((b) => b[0] === 1)!;
    expect(row).toEqual([1, lapseDay(o), 0]);
    const back = regularsFrom(seed, hist, memo).find((x) => x.def.id === reg.def.id)!;
    expect(back.done.find((b) => b.beat === 1)!.lapsed).toBe(true);
  });

  it("a shut weekday doesn't stall an order: it lapses on the first open day after its last chance", () => {
    const seed = 5;
    const reg = cast(seed)[0]!;
    const dish0 = reg.def.beats[0]!.dishes[0]!;
    const hist: DayResult[] = [night(1, [dish0])];
    const o = regularsFrom(seed, hist).find((s) => s.def.id === reg.def.id)!.open!;
    // She never opens on the order's weekday (and never cooks the dish either).
    for (let d = 2; d <= lapseDay(o) + 7; d++) if (weekdayIndex(d) !== o.weekday) hist.push(night(d, ["garlic_bread"]));
    const s = regularsFrom(seed, hist).find((x) => x.def.id === reg.def.id)!;
    expect(s.done.find((b) => b.beat === 1)).toMatchObject({ lapsed: true, day: lapseDay(o) + 1 });
  });

  it("an R13 memo with an order stuck since day 1 resumes and lapses (old saves move on)", () => {
    const seed = 5;
    const reg = cast(seed)[0]!;
    const stuck: VoicesMemo = { v: 1, seed, day: 300, regs: [{ id: reg.def.id, joined: 1, done: [[0, 1, 1]], open: { beat: 1, dishId: "potato_skins", weekday: 3, since: 1, from: 10 } }] };
    const hist = [night(300, ["margherita"]), night(301, ["margherita"])];
    const s = regularsFrom(seed, hist, stuck).find((x) => x.def.id === reg.def.id)!;
    expect(s.done.find((b) => b.beat === 1)).toMatchObject({ lapsed: true, day: 301 });
    expect(s.open?.beat).toBe(2);
    // A bad beat stored by R13 (with its dish) still reads as a bad night, not a lapse.
    const bad: VoicesMemo = { ...stuck, regs: [{ id: reg.def.id, joined: 1, done: [[0, 1, 1], [1, 12, 0, "margherita"]] }] };
    expect(regularsFrom(seed, hist, bad).find((x) => x.def.id === reg.def.id)!.done[1]!.lapsed).toBeUndefined();
  });
});
