/**
 * Round 11 review: the seams between the five branches. A's save schemas must keep what B, C and D added to a save
 * (it drops unknown top-level keys); B's archive and C's "over" rule must agree (no game is ever deleted); D's plain
 * words and one formatter must cover B's and C's new screens and lines.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { bankStatus, newGame, type GameState } from "@full-plate/sim-core";
import { buildBoardMeeting, emptyBook, parkSite } from "@full-plate/sim-empire";
import { BankBanner, BankCard } from "../components/BankCards";
import { EmpireEnd } from "../screens/paths/EmpireEnd";
import { appReducer, type AppState } from "../state/gameReducer";
import type { PathMeta } from "../state/paths";
import { encodeSave } from "../state/save";
import { checkedDecode } from "../state/saveCheck";
import { createSaveStore } from "../state/saveCore";
import { applyCommand, content, runDay, serialize } from "../sim";
import { empireGame } from "./fixtures/empire";

afterEach(cleanup);
const noop = () => {};

class FakeStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
}
const store = () => createSaveStore({ storage: new FakeStorage(), cloud: async () => ({ off: "none" }), now: () => 1, debounceMs: 5, compress: false, retryMs: () => 1 });

/** encode → validate → encode is a fixed point, and nothing B/C/D added is dropped on the way. */
const roundTrip = (game: GameState, meta: PathMeta) => {
  const raw = encodeSave(game, meta);
  const back = checkedDecode(raw);
  expect(encodeSave(back.game, back.meta)).toBe(raw);
  return back;
};

describe("A's schemas keep B's, C's and D's save fields", () => {
  it("B: the starter loan flag; D: handsOnResume (a mid-shift reload resumes hands-on)", () => {
    const g0 = newGame(content, { type: "NEW_GAME", seed: 4, districtId: content.districts[0]!.id, restaurantName: "Seam Diner", difficulty: "normal" });
    const g = { ...g0, starterLoan: true } as GameState;
    const s = empireGame();
    const meta: PathMeta = { ...s.meta, empire: undefined, handsOnResume: { role: "chef", jumpIn: true } };
    const back = roundTrip({ ...g, phase: "service" }, meta);
    expect(back.game.starterLoan).toBe(true);
    expect(back.meta.handsOnResume).toEqual({ role: "chef", jumpIn: true });
  });

  it("C: ParkedSite objects and old whole-GameState strings in meta.parked; the board's debt question", () => {
    const s = empireGame();
    const e = s.meta.empire!;
    const meeting = buildBoardMeeting(content, e, emptyBook(), e.hq.day);
    const debt = { ...meeting, decision: { ...meeting.decision, kind: "debt" as const } };
    const meta: PathMeta = { ...s.meta, empire: { ...e, boardMeeting: debt }, parked: { s2: parkSite(s.game!), s3: serialize(s.game!) } };
    const back = roundTrip(s.game!, meta);
    expect(typeof back.meta.parked!.s2).toBe("object");
    expect(typeof back.meta.parked!.s3).toBe("string");
    expect(back.meta.empire!.boardMeeting!.decision.kind).toBe("debt");
    // A damaged parked site is still refused.
    const bad = { ...meta, parked: { s2: { ...parkSite(s.game!), staff: "everyone" } } } as unknown as PathMeta;
    expect(() => checkedDecode(encodeSave(s.game!, bad))).toThrow();
  });

  it("C: the Stars head chef's staysUntil (after a pay rise)", () => {
    const st = appReducer({ ...empireGame(), meta: { ...empireGame().meta, empire: undefined, fork: { offered: true } } }, { type: "fork", choice: "stars" });
    const stars = st.meta.stars!;
    const back = roundTrip(st.game!, { ...st.meta, stars: { ...stars, headChef: { ...stars.headChef, staysUntil: st.game!.day + 730 } } });
    expect(back.meta.stars!.headChef.staysUntil).toBe(st.game!.day + 730);
  });
});

describe("B × C: a finished game is archived, never deleted; a running Empire is never lost", () => {
  it("bankrupt → archived and kept; 'Try again from the last board meeting' saves it back un-archived; a bust shop under a running Empire is not lost", async () => {
    const s: AppState = empireGame();
    const e = s.meta.empire!;
    const st = store();
    const bankrupt: PathMeta = { ...s.meta, empire: { ...e, status: "bankrupt", hq: { ...e.hq, cash: -300_000_000 } } };
    await st.save("e1", s.game!, bankrupt);
    expect(st.list().find((x) => x.slotId === "e1")?.archived).toBe(true);
    await st.save("e1", s.game!, s.meta); // the checkpoint's running Empire
    expect(st.list().find((x) => x.slotId === "e1")?.archived).toBeUndefined();
    const shopBust = { ...s.game!, phase: "gameover" as const, gameOverReason: "x", distressDays: 14 };
    await st.save("e1", shopBust, s.meta);
    expect(st.list().find((x) => x.slotId === "e1")?.archived).toBeUndefined();
    // A plain owner game over: archived, still listed, still loads.
    await st.save("o1", shopBust, { ...s.meta, empire: undefined });
    expect(st.list().find((x) => x.slotId === "o1")?.archived).toBe(true);
    expect((await st.load("o1"))?.loaded.game.phase).toBe("gameover");
  });
});

// Round 11b: trade words are back on screen, each inside a glossary term ("every trade word on screen is a term").
const JARGON = /\b(86'd|footfall|covers|segments?|wholesalers?|royalt(y|ies)|VAT|HMRC|call-out|tronc|sommeliers?|satellites?|comp|comped|franchisees?|HQ)\b/i;
const visible = (el: Element) => { const c = el.cloneNode(true) as Element; c.querySelectorAll(".term__tip").forEach((t) => t.remove()); return (c.textContent ?? "").replace(/\s+/g, " "); };
/** What is left once every glossary term is taken out: no trade word may remain. */
const outsideTerms = (el: Element) => { const c = el.cloneNode(true) as Element; c.querySelectorAll(".term").forEach((t) => t.remove()); return (c.textContent ?? "").replace(/\s+/g, " "); };

describe("D's word check (re-targeted in Round 11b) on B's and C's new screens", () => {
  it("EmpireEnd (bankrupt and bust shop) says HQ, always as a tipped term", () => {
    const s = empireGame();
    const e = s.meta.empire!;
    const a = render(<EmpireEnd game={s.game!} empire={{ ...e, status: "bankrupt" }} kind="bankrupt" checkpointDay={400} onRetry={noop} onNewGame={noop} onTitle={noop} />);
    expect(outsideTerms(a.container)).not.toMatch(JARGON);
    expect(visible(a.container)).toMatch(/HQ spent more than it earned/);
    expect(a.container.querySelector("[data-term-id='hq'] .term__tip")?.textContent).toMatch(/^HQ: headquarters/);
    cleanup();
    const b = render(<EmpireEnd game={s.game!} empire={e} kind="shopBust" onMoveOn={noop} onNewGame={noop} onTitle={noop} />);
    expect(outsideTerms(b.container)).not.toMatch(JARGON);
  });

  it("the bank's evening card and morning banner", () => {
    let g = newGame(content, { type: "NEW_GAME", seed: 31, districtId: content.districts[1]!.id, restaurantName: "Mia's Diner", difficulty: "hard" });
    for (const d of content.dishes.slice(0, 6)) g = applyCommand(content, g, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice }).state;
    const ev = runDay(content, g).state;
    const low = { ...ev, cash: bankStatus(content, ev).line - 50_000, distressDays: 12 };
    const a = render(<BankCard game={low} send={noop} onGoTo={noop} onAct={noop} />);
    expect(outsideTerms(a.container)).not.toMatch(JARGON);
    expect(visible(a.container)).toMatch(/days? left/);
    cleanup();
    const b = render(<BankBanner game={{ ...low, phase: "planning" }} />);
    expect(outsideTerms(b.container)).not.toMatch(JARGON);
  });

  it("B's and C's new files use the one pounds formatter", () => {
    const root = join(__dirname, "..", "..", "..");
    for (const f of [
      "sim-core/src/bank.ts", "sim-empire/src/focus.ts", "game/src/components/Bank.tsx", "game/src/components/BankCards.tsx",
      "game/src/components/SpendGuard.tsx", "game/src/screens/paths/EmpireEnd.tsx", "game/src/canvas/RestaurantView.ts",
    ]) expect(readFileSync(join(root, f), "utf8"), f).not.toMatch(/`[^`]*£\$\{[^`]*(toFixed|toLocaleString|Math\.(round|ceil|floor))/);
  });
});
