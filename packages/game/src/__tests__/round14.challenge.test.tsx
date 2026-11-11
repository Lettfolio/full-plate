/**
 * Round 14 (D): a fair daily challenge — RED-TEAM-2 G2, U8, G6, G7, S14-6 (the headless sweep is in
 * round14.challengeFair.*.test.ts, the engine-maths check in round14.challengeEngine.test.ts). Each block below is a
 * reviewer's reproduction turned into a guard: it fails on master 823733b and passes here.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Command, GameState } from "@full-plate/sim-core";
import { strategies } from "@full-plate/sim-core";
import { App } from "../App";
import { initialMeta, type PathMeta } from "../state/paths";
import { setSaveStore } from "../state/saveStore";
import { createSaveStore } from "../state/saveCore";
import { validateLoaded } from "../state/saveCheck";
import { applyCommand, content, newGame, runStrategyDay, serialize, STRATEGIES, syncCustomDishes } from "../sim";
import {
  bestFor, buildChallenge, ceilingOf, CODE_LENGTH, dateOfDayNumber, dayNumber, decodeScore, encodeScore, fingerprintOf, goalOf, MAX_SCORE,
  prettyCode, recordBest, scoreOf, todayKey, whyMissed, type Built,
} from "../lib/challenge";
import { todayLine } from "../lib/challengeToday";
import { ChallengeScore } from "../screens/ChallengeScore";
import { TitleScreen } from "../screens/TitleScreen";
import { NOTHING } from "./challengePlayers";

const now = async () => {};
const builds = new Map<string, Built>();
async function built(date: string, template?: Built["scenario"]["template"]): Promise<Built> {
  const k = `${date}:${template ?? ""}`;
  if (!builds.has(k)) builds.set(k, await buildChallenge(date, undefined, now, template ? { template } : {}));
  return builds.get(k)!;
}
const send = (g: GameState, cmd: Command) => applyCommand(content, g, cmd).state;
const play = (g: GameState, n: number) => { for (let i = 0; i < n && g.phase !== "gameover"; i++) g = runStrategyDay(content, g, STRATEGIES.typical); return g; };

class FakeStorage {
  map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); localStorage.clear(); setSaveStore(null); });

describe("G2: built from the starter library", () => {
  it("no path-only dish (fd_, ff_) reaches a challenge menu, on 60 dates", async () => {
    for (let i = 0; i < 60; i++) {
      const b = await buildChallenge(dateOfDayNumber(dayNumber("2026-11-11") + i), undefined, now);
      expect(b.game.menu.filter((m) => /^(fd|ff)_/.test(m.dishId)).map((m) => m.dishId)).toEqual([]);
    }
  }, 300_000);

  it("the scenario doesn't depend on the invented dishes of the game last opened in this tab (reviewer's test)", async () => {
    const date = "2026-11-12";
    const clean = serialize((await buildChallenge(date, undefined, now)).game);
    syncCustomDishes([
      { id: "custom:aaaaaaa1", name: "Lager buns", course: "main", icon: "🍔", createdDay: 1, ingredients: [{ id: "burger_buns", qty: 3 }, { id: "lager", qty: 3 }] },
      { id: "custom:aaaaaaa2", name: "Sausage berries", course: "main", icon: "🍔", createdDay: 1, ingredients: [{ id: "sausages", qty: 3 }, { id: "strawberries", qty: 3 }] },
    ] as never);
    try {
      expect(serialize((await buildChallenge(date, undefined, now)).game)).toBe(clean);
    } finally { syncCustomDishes([]); }
  }, 120_000);
});

describe("U8: five Skips don't win", () => {
  it("Inspector due on 11 Nov 2026 (the reviewer's date) is missed by five Skips, and the score says why", async () => {
    const b = await built("2026-11-11", "inspector");
    const g = NOTHING(b);
    const c = b.meta.challenge!;
    expect(goalOf(g, c).met).toBe(false);
    expect(whyMissed(g, c)).toMatch(/run out of food/);
    render(<ChallengeScore game={g} meta={b.meta} onAgain={() => {}} onTitle={() => {}} />);
    expect(screen.getByTestId("challenge-why").textContent).toMatch(/^What went wrong: /);
  }, 60_000);

  it("the inspector comes on night 4 or 5, and wants a busy room as well as the stars", async () => {
    for (let i = 0; i < 12; i++) {
      const b = await built(dateOfDayNumber(dayNumber("2026-11-11") + i), "inspector");
      expect([3, 4]).toContain(b.scenario.inspectorNight);
      expect(b.meta.challenge!.guests).toBeGreaterThanOrEqual(20);
      expect(goalOf(b.game, b.meta.challenge!).label).toMatch(/★ or better from at least \d+ guests/);
    }
  }, 120_000);
});

describe("G6: degenerate play doesn't pay", () => {
  it("Rescue 15 Nov (the reviewer's script): fire everyone, ask for the starter loan, stay shut — the bank says no and the goal is missed", async () => {
    const b = await built("2026-11-15", "rescue");
    let g = b.game;
    for (const st of [...g.staff]) g = send(g, { type: "FIRE", staffId: st.id });
    const r = applyCommand(content, g, { type: "STARTER_LOAN" });
    expect(r.state.cash).toBe(g.cash); // the once-only first-wage loan is already spent in a challenge
    g = r.state;
    for (let i = 0; i < 5; i++) {
      g = send(g, { type: "CLOSE_TODAY" });
      if (g.phase === "evening") g = send(g, { type: "END_DAY" });
      if (g.phase === "event") g = strategies.resolveEvent(content, g, send);
    }
    const goal = goalOf(g, b.meta.challenge!);
    expect(goal.value).toBeLessThan(0);
    expect(goal.met).toBe(false);
  }, 60_000);

  it("Rescue's goal is the five days' own profit: cash that arrives from elsewhere doesn't count", async () => {
    const b = await built("2026-11-15", "rescue");
    const g = play(b.game, 5);
    const c = b.meta.challenge!;
    const v = goalOf(g, c).value;
    expect(goalOf({ ...g, cash: g.cash + 500_000 }, c).value).toBe(v);
  }, 60_000);

  it("money borrowed during the run is a loss in the score, and each bill counts up to the fair cap", async () => {
    const b = await built("2026-11-16", "rush");
    const c = b.meta.challenge!;
    const g = play(b.game, 5);
    const s = scoreOf(g, c);
    const borrowed = scoreOf({ ...g, loan: { ...g.loan, principal: g.loan.principal + 100_000 } }, c);
    expect(borrowed.total).toBe(Math.max(0, s.total - 200));
    expect(borrowed.lines.find((l) => l.label === "Losses")!.note).toMatch(/£1,000 borrowed/);
    // Prices ten times over: the takings line is held to `fair` a guest.
    const days = g.history.map((d) => (d.day >= c.startDay ? { ...d, revenue: d.revenue * 10 } : d));
    const gouged = scoreOf({ ...g, history: days }, c);
    const covers = s.lines.find((l) => l.label === "Guests")!.points / 2;
    expect(gouged.lines.find((l) => l.label === "Takings")!.points).toBeLessThanOrEqual(Math.round((covers * c.fair!) / 500) + 1);
  }, 60_000);
});

describe("G7: Rush and Festival send more people", () => {
  it("an ordinary footfall modifier for the five days (gone after the fifth), and nothing for the other four templates", async () => {
    for (const [t, mult] of [["rush", 1.5], ["festival", 1.3], ["rival", 0.85], ["rescue", 0], ["inspector", 0], ["walkout", 0]] as const) {
      const b = await built("2026-11-20", t);
      const mod = b.game.footfallMods.find((m) => m.source === "challenge");
      if (!mult) { expect(mod).toBeUndefined(); continue; }
      expect(mod).toEqual({ mult, daysRemaining: 5, source: "challenge" });
      if (t !== "rush") continue;
      let g = b.game;
      for (let i = 0; i < 4; i++) g = runStrategyDay(content, g, STRATEGIES.typical);
      expect(g.footfallMods.find((m) => m.source === "challenge")?.daysRemaining).toBe(1);
      g = runStrategyDay(content, g, STRATEGIES.typical);
      expect(g.footfallMods.find((m) => m.source === "challenge")).toBeUndefined();
    }
  }, 120_000);

  it("Rush week really is busier than the same restaurant without it", async () => {
    const b = await built("2026-11-16", "rush");
    const calm = { ...b.game, footfallMods: b.game.footfallMods.filter((m) => m.source !== "challenge") };
    const covers = (g: GameState) => g.history.filter((d) => d.day >= b.meta.challenge!.startDay).reduce((a, d) => a + d.covers, 0);
    expect(covers(play(b.game, 5))).toBeGreaterThan(covers(play(calm, 5)));
  }, 60_000);
});

describe("S14-6: score codes", () => {
  const DATE = "2026-11-11";
  it("eight characters carry the version, day, score and the scenario's fingerprint; a wrong letter is caught", () => {
    for (const [score, fp] of [[0, 0], [2117, 77], [99_999, 255], [MAX_SCORE, 1]] as const) {
      const code = encodeScore(DATE, score, fp);
      expect(code).toHaveLength(CODE_LENGTH);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
      expect(decodeScore(code, DATE)).toEqual({ ok: true, score, date: DATE, fp });
      expect(decodeScore(prettyCode(code).toLowerCase(), "2026-12-20")).toEqual({ ok: true, score, date: DATE, fp });
      const typo = code.slice(0, 7) + (code[7] === "0" ? "1" : "0");
      expect(decodeScore(typo, DATE).ok).toBe(false);
    }
  });

  it("an old six-letter code is refused politely", () => {
    const r = decodeScore("FG8 8NC", DATE);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.why).toMatch(/old six-letter code/);
  });

  it("a code above the day's ceiling is refused (the reviewer forged 131,071)", async () => {
    const b = await built(DATE);
    const c = b.meta.challenge!;
    const ceiling = { date: DATE, max: ceilingOf(c) };
    expect(ceiling.max).toBeLessThan(MAX_SCORE);
    const forged = decodeScore(encodeScore(DATE, MAX_SCORE, c.fp), DATE, ceiling);
    expect(forged.ok).toBe(false);
    expect(!forged.ok && forged.why).toMatch(/more than today's challenge can give/);
    expect(decodeScore(encodeScore(DATE, 3_000, c.fp), DATE, ceiling).ok).toBe(true);
  }, 60_000);

  it("the compare line reports their code, and a different build's code (fingerprint) isn't compared", async () => {
    const b = await built(DATE);
    const c = b.meta.challenge!;
    const g = play(b.game, 5);
    const total = scoreOf(g, c).total;
    render(<ChallengeScore game={g} meta={b.meta} onAgain={() => {}} onTitle={() => {}} />);
    expect(screen.getByTestId("challenge-code").textContent!.replace(" ", "")).toBe(encodeScore(DATE, total, c.fp));
    const box = screen.getByRole("textbox", { name: /Compare/ });
    fireEvent.change(box, { target: { value: encodeScore(DATE, total + 150, c.fp) } });
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    const v = screen.getByTestId("challenge-versus").textContent!;
    expect(v).toContain(`Their code says ${(total + 150).toLocaleString("en-GB")}: 150 more than yours.`);
    expect(v).not.toMatch(/win/i);
    fireEvent.change(box, { target: { value: encodeScore(DATE, total + 150, (c.fp! + 1) & 0xff) } });
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByTestId("challenge-versus").textContent).toContain("You two were given different versions of today's challenge");
  }, 60_000);

  it("the fingerprint is stored with the run and passes the save schema; it ignores text a setting rewords", async () => {
    const b = await built(DATE);
    expect(b.meta.challenge!.fp).toBe(fingerprintOf(b.game));
    expect(fingerprintOf({ ...b.game, log: [] })).toBe(b.meta.challenge!.fp);
    const back = validateLoaded(JSON.parse(JSON.stringify({ game: b.game, meta: b.meta })) as never);
    expect(back.meta.challenge).toEqual(b.meta.challenge);
    expect(() => validateLoaded({ game: b.game, meta: { ...b.meta, challenge: { ...b.meta.challenge!, fp: 999 } } })).toThrow();
  }, 60_000);

  it("a run saved before Round 14 (no version, fingerprint or cap) still scores", async () => {
    const b = await built(DATE);
    const { v: _v, template: _t, fair: _f, fp: _p, guests: _g, loan0: _l, prev: _r, ...old } = b.meta.challenge!;
    const s = scoreOf(play(b.game, 5), old);
    expect(s.total).toBeGreaterThan(0);
  }, 60_000);
});

describe("reachability", () => {
  it("the title names today's challenge and her best today", () => {
    const date = todayKey();
    expect(todayLine(date).best).toBeUndefined();
    recordBest({ date, score: 2150, template: "rush", met: true, fp: 3 });
    expect(bestFor(date)?.fp).toBe(3);
    render(<TitleScreen saved={null} slots={[]} onNew={() => {}} onContinue={() => {}} onChallenge={() => {}} />);
    const btn = screen.getByRole("button", { name: "Today's challenge" });
    expect(btn.textContent).toContain(todayLine(date).title);
    expect(btn.textContent).toContain("your best 2,150");
  });

  it("a best from before Round 14 (another restaurant, another scale) isn't today's best", () => {
    const date = todayKey();
    localStorage.setItem(`full-plate:onboard:v1:challenge:${date}:9000`, "1");
    expect(bestFor(date)).toBeUndefined();
    recordBest({ date, score: 1200, template: "rush", met: false });
    expect(bestFor(date)?.score).toBe(1200);
  });

  it("from inside a game: Settings › Today's challenge saves it, and Back returns to the same game", async () => {
    const storage = new FakeStorage();
    const store = createSaveStore({ storage, cloud: async () => ({ off: "none" }), now: () => 1, debounceMs: 5, compress: false, retryMs: () => 1 });
    let g = newGame(content, { type: "NEW_GAME", seed: 4242, districtId: content.districts[0]!.id, restaurantName: "Plum Tree", difficulty: "normal" });
    g = { ...g };
    const meta: PathMeta = initialMeta("owner");
    await store.save("s1", g, meta);
    await store.flush("s1");
    setSaveStore(store);
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }, { timeout: 10_000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Settings" }, { timeout: 10_000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Today's challenge" }, { timeout: 10_000 }));
    const back = await screen.findByRole("button", { name: "Back to Plum Tree" }, { timeout: 10_000 });
    expect(screen.getByRole("heading", { name: "Today's challenge" })).toBeTruthy();
    fireEvent.click(back);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Today's challenge" })).toBeNull(), { timeout: 10_000 });
    expect((await screen.findAllByText(/Plum Tree/, {}, { timeout: 10_000 })).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  }, 60_000);
});
