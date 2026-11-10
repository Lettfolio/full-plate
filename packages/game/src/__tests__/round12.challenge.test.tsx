/**
 * Round 12 (C): the daily challenge (lib/challenge.ts, screens/Challenge*.tsx), the chapter cards (paths.ts
 * chapterDue, screens/ChapterCard.tsx) and Quick year (PathMeta.forkDay). The sims are untouched: everything here
 * drives them with ordinary commands.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { GameState } from "@full-plate/sim-core";
import { App } from "../App";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { chapterDue, CHAPTER_DAYS, FORK_DAY, forkDayOf, forkDue, forkMilestone, initialMeta, QUICK_FORK_DAY, type PathMeta } from "../state/paths";
import { encodeSave } from "../state/save";
import { setSaveStore } from "../state/saveStore";
import { createSaveStore } from "../state/saveCore";
import { validateLoaded } from "../state/saveCheck";
import { applyCommand, content, runStrategyDay, serialize, STRATEGIES } from "../sim";
import {
  allBests, buildChallenge, dayNumber, decodeScore, encodeScore, goalOf, peekRun, recordBest, RUN_KEY, saveRun, scenarioFor,
  scoreOf, TEMPLATE_ORDER, todayKey, topBests, type Built,
} from "../lib/challenge";
import { ChallengeScore } from "../screens/ChallengeScore";
import { ChapterCard, chapterScore } from "../screens/ChapterCard";
import { TitleScreen } from "../screens/TitleScreen";
import { weekdayIndex } from "../lib/calendar";

const DATE = "2026-11-10";
const now = async () => {};
const builds = new Map<string, Built>();
async function built(date = DATE): Promise<Built> {
  if (!builds.has(date)) builds.set(date, await buildChallenge(date, undefined, now));
  return builds.get(date)!;
}
/** The scripted owner plays `n` challenge days (planning → next morning). */
function play(g: GameState, n: number): GameState {
  for (let i = 0; i < n && g.phase !== "gameover"; i++) g = runStrategyDay(content, g, STRATEGIES.typical);
  return g;
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); localStorage.clear(); setSaveStore(null); });

describe("the scenario", () => {
  it("one per UTC day, the same on every build, and the six templates rotate", async () => {
    const a = await buildChallenge(DATE, undefined, now);
    const b = await buildChallenge(DATE, undefined, now);
    expect(serialize(a.game)).toBe(serialize(b.game));
    expect(a.meta.challenge).toEqual(b.meta.challenge);
    const six = Array.from({ length: 6 }, (_, i) => scenarioFor(new Date((dayNumber(DATE) + i) * 86_400_000).toISOString().slice(0, 10)).template);
    expect(new Set(six)).toEqual(new Set(TEMPLATE_ORDER));
    expect(todayKey(new Date("2026-11-10T23:59:00Z"), "")).toBe("2026-11-10");
    expect(todayKey(new Date("2026-11-11T00:01:00Z"), "")).toBe("2026-11-11");
  });

  it("starts on the scenario's day in planning, Normal, with the problem set up by commands", async () => {
    for (let i = 0; i < 6; i++) {
      const date = new Date((dayNumber(DATE) + i) * 86_400_000).toISOString().slice(0, 10);
      const b = await built(date);
      const sc = scenarioFor(date);
      expect(b.game.phase).toBe("planning");
      expect(b.game.day).toBe(b.meta.challenge!.startDay);
      expect(b.game.difficulty).toBe("normal");
      expect(b.meta.challenge!.target).toBeGreaterThan(0);
      if (sc.template === "walkout") expect(b.game.staff.length).toBe(1);
      if (sc.template === "festival") expect(weekdayIndex(b.game.day)).toBe(3); // Thursday
    }
  });
});

describe("the score", () => {
  it("goal + takings + reviews − losses, after five days of the scripted owner", async () => {
    const b = await built();
    const g = play(b.game, 5);
    const s = scoreOf(g, b.meta.challenge!);
    expect(s.days).toBe(5);
    expect(s.lines.map((l) => l.label)).toEqual(["Goal", "Takings", "Reviews", "Losses"]);
    expect(s.total).toBe(Math.max(0, s.lines.reduce((a, l) => a + l.points, 0)));
    expect(s.total).toBeGreaterThan(500);
    expect(goalOf(g, b.meta.challenge!).label.length).toBeGreaterThan(5);
  });

  it("the six-character code carries the day and the score, and a wrong letter is caught", () => {
    for (const score of [0, 1, 2117, 99_999, 131_071]) {
      const code = encodeScore(DATE, score);
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{6}$/);
      expect(decodeScore(code, DATE)).toEqual({ ok: true, score, date: DATE });
      // read aloud: lower case, a space, a later day within nine weeks
      expect(decodeScore(`${code.slice(0, 3).toLowerCase()} ${code.slice(3)}`, "2026-12-20")).toEqual({ ok: true, score, date: DATE });
    }
    const code = encodeScore(DATE, 2117);
    const typo = code.slice(0, 5) + (code[5] === "0" ? "1" : "0");
    expect(decodeScore(typo, DATE).ok).toBe(false);
    expect(decodeScore("ABC", DATE).ok).toBe(false);
    expect(decodeScore("UUUUUU", DATE).ok).toBe(false);
  });

  it("a best per day, the all-time list, and a top-five score mirrored as an account flag", () => {
    expect(recordBest({ date: DATE, score: 1500, template: "rush", met: false })).toBe(true);
    expect(recordBest({ date: DATE, score: 1200, template: "rush", met: false })).toBe(false);
    expect(recordBest({ date: "2026-11-09", score: 2500, template: "rescue", met: true })).toBe(true);
    expect(topBests().map((b) => b.score)).toEqual([2500, 1500]);
    expect(localStorage.getItem("full-plate:onboard:v1:challenge:2026-11-09:2500")).toBe("1");
    // A best that arrives only through the account (another device) is read back.
    localStorage.setItem("full-plate:onboard:v1:challenge:2026-11-08:3000", "1");
    expect(allBests().find((b) => b.date === "2026-11-08")?.score).toBe(3000);
  });
});

describe("its own save", () => {
  it("the run saves apart from the slots, and the envelope (meta.challenge, forkDay, chapterSeen) passes the save schema", async () => {
    const b = await built();
    expect(await saveRun(b.game, b.meta)).toBe(true);
    expect(peekRun()?.date).toBe(DATE);
    expect(Object.keys(localStorage).some((k) => k.startsWith("full-plate:slot:"))).toBe(false);
    const meta: PathMeta = { ...b.meta, forkDay: QUICK_FORK_DAY, chapterSeen: 2 };
    const back = validateLoaded(JSON.parse(JSON.stringify({ game: b.game, meta })) as never);
    expect(back.meta.challenge).toEqual(b.meta.challenge);
    expect(back.meta.forkDay).toBe(QUICK_FORK_DAY);
    expect(back.meta.chapterSeen).toBe(2);
    expect(() => validateLoaded({ game: b.game, meta: { ...meta, forkDay: 5 } })).toThrow();
    expect(() => validateLoaded({ game: b.game, meta: { ...meta, challenge: { ...b.meta.challenge!, date: "soon" } } })).toThrow();
    expect(encodeSave(b.game, b.meta)).toContain('"challenge"');
  });
});

describe("Quick year", () => {
  it("a new game can carry forkDay 120; unset reads 365 exactly as before", () => {
    const s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 7, districtId: content.districts[0]!.id, restaurantName: "Q", difficulty: "normal" }, forkDay: QUICK_FORK_DAY });
    expect(s.meta.forkDay).toBe(QUICK_FORK_DAY);
    const plain = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 7, districtId: content.districts[0]!.id, restaurantName: "Q", difficulty: "normal" } });
    expect("forkDay" in plain.meta).toBe(false);
    expect(forkDayOf(plain.meta)).toBe(FORK_DAY);
    expect(serialize(s.game!)).toBe(serialize(plain.game!)); // the sim's state is identical
  });

  it("the fork comes at day 120 in a quick year (and not in a normal one), and both paths start from it", () => {
    let g = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 314159, districtId: content.districts[314159 % content.districts.length]!.id, restaurantName: "Q", difficulty: "normal" } }).game!;
    while (g.day < QUICK_FORK_DAY && g.phase !== "gameover") g = runStrategyDay(content, g, STRATEGIES.typical);
    expect(g.phase).toBe("planning");
    const quick: PathMeta = { ...initialMeta("owner"), forkDay: QUICK_FORK_DAY, lastPathDay: g.day - 1 };
    expect(forkMilestone(g, QUICK_FORK_DAY).met).toBe(true);
    let s: AppState = appReducer(initialAppState, { type: "load", game: g, meta: quick });
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    s = appReducer(s, { type: "skipShift" });
    expect(s.meta.fork.offered).toBe(true);
    // The same evening in a normal game: no card.
    let n: AppState = appReducer(initialAppState, { type: "load", game: g, meta: { ...quick, forkDay: undefined } });
    n = appReducer(n, { type: "command", cmd: { type: "START_SERVICE" } });
    n = appReducer(n, { type: "skipShift" });
    expect(n.meta.fork.offered).toBe(false);
    expect(forkDue(n.game!, n.meta.fork, "owner")).toBe(false);
    for (const choice of ["stars", "empire"] as const) {
      let p = appReducer(s, { type: "fork", choice });
      expect(p.meta.fork.chosen).toBe(choice);
      for (let i = 0; i < 2; i++) {
        p = appReducer(p, { type: "nextDay" });
        if (p.game!.phase === "event") p = appReducer(p, { type: "command", cmd: { type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === p.game!.activeEvent?.eventId)!.choices[0]!.id } });
        if (p.meta.empire?.boardMeeting) break;
        p = appReducer(p, { type: "command", cmd: { type: "START_SERVICE" } });
        p = appReducer(p, { type: "skipShift" });
      }
      expect(p.game!.day).toBeGreaterThan(QUICK_FORK_DAY);
      expect(choice === "stars" ? p.meta.stars : p.meta.empire).toBeTruthy();
    }
  });
});

describe("chapters", () => {
  it("a card on the evening each 30-day chapter ends, once, owners only, in year 1 (four in a quick year)", async () => {
    const b = await built();
    const at = (day: number, phase: GameState["phase"]) => ({ ...b.game, day, phase });
    const owner = initialMeta("owner");
    expect(chapterDue(at(29, "evening"), owner)).toBe(1);
    expect(chapterDue(at(29, "planning"), owner)).toBe(0);
    expect(chapterDue(at(28, "evening"), owner)).toBe(0);
    expect(chapterDue(at(29, "evening"), { ...owner, chapterSeen: 1 })).toBe(0);
    expect(chapterDue(at(359, "event"), owner)).toBe(12);
    expect(chapterDue(at(389, "evening"), owner)).toBe(0);
    expect(chapterDue(at(119, "evening"), { ...owner, forkDay: QUICK_FORK_DAY })).toBe(4);
    expect(chapterDue(at(149, "evening"), { ...owner, forkDay: QUICK_FORK_DAY })).toBe(0);
    expect(chapterDue(at(29, "evening"), initialMeta("career"))).toBe(0);
    expect(chapterDue(at(29, "evening"), b.meta)).toBe(0); // not in a challenge
    const s = appReducer({ ...initialAppState, game: at(29, "evening"), meta: owner }, { type: "chapterSeen", n: 1 });
    expect(s.meta.chapterSeen).toBe(1);
  });

  it("stars 1–5 from the month's results, one next step, one tap to close", async () => {
    const b = await built();
    const sc = chapterScore(b.game.history, 1, 12);
    expect(sc.stars).toBeGreaterThanOrEqual(1);
    expect(sc.stars).toBeLessThanOrEqual(5);
    expect(sc.next).toMatch(/^Next: |^That's the year/);
    expect(chapterScore([], 3, 12).stars).toBe(1);
    let closed = 0;
    render(<ChapterCard game={b.game} n={1} chapters={12} onClose={() => closed++} />);
    expect(screen.getByRole("dialog", { name: "Chapter 1 done" })).toBeTruthy();
    expect(screen.getByRole("img", { name: `${sc.stars} out of 5 stars` })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "On to chapter 2" }));
    expect(closed).toBe(1);
  });
});

describe("screens", () => {
  it("the title has a Today's challenge button", () => {
    let n = 0;
    render(<TitleScreen saved={null} slots={[]} onNew={() => {}} onContinue={() => {}} onChallenge={() => n++} />);
    fireEvent.click(screen.getByRole("button", { name: "Today's challenge" }));
    expect(n).toBe(1);
  });

  it("the score screen: breakdown, code, a best recorded, and a typed code compared side by side", async () => {
    const b = await built();
    const g = play(b.game, 5);
    const total = scoreOf(g, b.meta.challenge!).total;
    render(<ChallengeScore game={g} meta={b.meta} onAgain={() => {}} onTitle={() => {}} />);
    expect(screen.getByTestId("challenge-total").textContent).toBe(total.toLocaleString("en-GB"));
    expect(screen.getByTestId("challenge-code").textContent!.replace(" ", "")).toBe(encodeScore(DATE, total));
    expect(topBests()[0]?.score).toBe(total);
    const theirs = encodeScore(DATE, total + 100);
    fireEvent.change(screen.getByRole("textbox", { name: /Compare/ }), { target: { value: theirs.toLowerCase() } });
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByTestId("challenge-versus").textContent).toContain("They win by 100.");
    fireEvent.change(screen.getByRole("textbox", { name: /Compare/ }), { target: { value: "ZZZZZZ" } });
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(screen.getByRole("alert").textContent).toMatch(/add up/);
  });
});

class FakeStorage {
  map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
}

describe("in the app", () => {
  it("title → Today's challenge → Start plays it with the bar; it never takes a slot; leaving and coming back carries on", async () => {
    const storage = new FakeStorage();
    setSaveStore(createSaveStore({ storage, cloud: async () => ({ off: "none" }), now: () => 1, debounceMs: 5, compress: false, retryMs: () => 1 }));
    const date = todayKey();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Today's challenge" }));
    fireEvent.click(await screen.findByRole("button", { name: /^(Start|Have another go)$/ }, { timeout: 10_000 }));
    const bar = await screen.findByRole("region", { name: "Today's challenge" }, { timeout: 20_000 });
    expect(bar.textContent).toContain("Day 1 of 5");
    expect(bar.textContent).toContain(scenarioFor(date).title);
    await waitFor(() => expect(localStorage.getItem(RUN_KEY)).toBeTruthy());
    expect([...storage.map.keys()].some((k) => k.includes(":slot:"))).toBe(false);
    cleanup();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Today's challenge" }));
    fireEvent.click(await screen.findByRole("button", { name: "Carry on: day 1 of 5" }, { timeout: 10_000 }));
    expect((await screen.findByRole("region", { name: "Today's challenge" }, { timeout: 10_000 })).textContent).toContain("Day 1 of 5");
  }, 60_000);

  it("after the fifth evening, Next day is the score screen", async () => {
    const b = await buildChallenge(todayKey(), undefined, now);
    let g = play(b.game, 4);
    g = applyCommand(content, g, { type: "START_SERVICE" }).state;
    let s: AppState = appReducer(initialAppState, { type: "load", game: g, meta: b.meta });
    s = appReducer(s, { type: "skipShift" });
    expect(s.game!.phase === "evening" || s.game!.phase === "event").toBe(true);
    await saveRun(s.game!, s.meta);
    setSaveStore(createSaveStore({ storage: new FakeStorage(), cloud: async () => ({ off: "none" }), now: () => 1, debounceMs: 5, compress: false, retryMs: () => 1 }));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Today's challenge" }));
    fireEvent.click(await screen.findByRole("button", { name: "Carry on: day 5 of 5" }, { timeout: 10_000 }));
    expect((await screen.findByRole("region", { name: "Today's challenge" }, { timeout: 10_000 })).textContent).toContain("shows your score");
    const next = await screen.findByRole("button", { name: /Next day|Read the morning post/ }, { timeout: 10_000 });
    await act(async () => { fireEvent.click(next); });
    expect(await screen.findByTestId("challenge-total", {}, { timeout: 10_000 })).toBeTruthy();
    expect(peekRun()).toBeNull();
  }, 60_000);
});
