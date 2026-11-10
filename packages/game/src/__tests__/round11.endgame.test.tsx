/**
 * Round 11 (red-team G1, G5, G6, G8): a running Empire never ends at its hands-on shop, HQ funds a visited till,
 * franchised shops aren't run hands-on, bankruptcy is a screen, and the board offers a way out of debt.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GameState } from "@full-plate/sim-core";
import { buildBoardMeeting, emptyBook, spendable, type EmpireState, type SiteSummary } from "@full-plate/sim-empire";
import { App } from "../App";
import { BoardMeeting } from "../screens/paths/BoardMeeting";
import { EmpireTab } from "../screens/paths/EmpireTab";
import { EmpireEnd } from "../screens/paths/EmpireEnd";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { FORK_DAY, initialMeta, type PathMeta } from "../state/paths";
import { runIsOver } from "../state/pathEngine";
import { isLost, isOver, setSaveStore } from "../state/saveStore";
import { createSaveStore } from "../state/saveCore";
import { applyCommand, content, runDay, suggestedOrder } from "../sim";

afterEach(cleanup);

const facility = (e: EmpireState) => spendable(e) - e.hq.cash;

/** A forked Empire (normal difficulty) with a second company shop and a franchised one, as if built 200 days ago. */
function forkedEmpire(): AppState {
  let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 21, districtId: "high_street", restaurantName: "Round Eleven", difficulty: "normal" } });
  for (const id of ["beef_burger", "chicken_burger", "chunky_chips", "soft_drink"]) {
    const d = content.dishes.find((x) => x.id === id)!;
    s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: id, price: d.suggestedPrice } });
  }
  s = appReducer(s, { type: "command", cmd: { type: "HIRE", candidateIndex: 0 } });
  let g = s.game!;
  for (let d = 0; d < 20 && g.phase !== "gameover"; d++) {
    g = runDay(content, g).state;
    for (const o of suggestedOrder(content, g)) g = applyCommand(content, g, { type: "ORDER_STOCK", ...o }).state;
    if (g.phase === "event") g = applyCommand(content, g, { type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === g.activeEvent?.eventId)!.choices[0]!.id }).state;
    else if (g.phase === "evening") g = applyCommand(content, g, { type: "END_DAY" }).state;
  }
  s = { ...s, game: { ...g, day: FORK_DAY }, meta: { ...initialMeta("owner"), lastPathDay: FORK_DAY - 1 } };
  s = appReducer(s, { type: "fork", choice: "empire", brandName: "Eleven Burgers" });
  const e = s.meta.empire!;
  const mk = (over: Partial<SiteSummary>): SiteSummary => {
    const x: SiteSummary = { ...e.sites[0]!, focused: false, staffQuality: 45, opened: e.hq.day - 200, revenueYear: 40_000_000, ...over };
    delete x.tables; delete x.popularity; delete x.prestige;
    return x;
  };
  const sites = [...e.sites, mk({ id: "s2", name: "Eleven Campus", districtId: "student_quarter" }), mk({ id: "s3", name: "Eleven Seafront", districtId: "seaside", ownership: "franchise", franchisee: "f1", contract: { royaltyPct: e.contract.royaltyPct, adFundPct: e.contract.adFundPct, rentPctOfSales: e.contract.rentPctOfSales, signedDay: e.hq.day - 200, termDays: e.contract.termDays, remodelEveryDays: e.contract.remodelEveryDays } })];
  return { ...s, meta: { ...s.meta, empire: { ...e, sites } } };
}

/** The flagship's sim-core game over (14 days below the bank's line) with the Empire still running. */
function bust(s: AppState, hqCash?: number): { game: GameState; meta: PathMeta } {
  const game: GameState = { ...s.game!, phase: "gameover", gameOverReason: "Cash stayed below the bank's limit for 14 days.", cash: -12_000_000, distressDays: 14 };
  const e = s.meta.empire!;
  return { game, meta: { ...s.meta, empire: hqCash === undefined ? e : { ...e, hq: { ...e.hq, cash: hqCash } } } };
}

class FakeStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
}

async function openInApp(game: GameState, meta: PathMeta) {
  const store = createSaveStore({ storage: new FakeStorage(), cloud: async () => ({ off: "none" }), now: () => 1, debounceMs: 5, compress: false, retryMs: () => 1 });
  await store.save("slot1", game, meta);
  setSaveStore(store);
  render(<App />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continue" })); await new Promise((r) => setTimeout(r, 30)); });
}

describe("G1: a bust hands-on shop never ends a running Empire", () => {
  it("runIsOver/isLost: a running Empire isn't over at a shop's game over; a bankrupt one is (archived, never deleted); a plain owner game over still is", () => {
    const s = forkedEmpire();
    const b = bust(s);
    const bankrupt = { ...b.meta, empire: { ...b.meta.empire!, status: "bankrupt" as const } };
    const plain = { ...b.meta, empire: undefined };
    expect(runIsOver(b.game, b.meta)).toBe(false);
    expect(runIsOver(b.game, bankrupt)).toBe(true);
    expect(runIsOver(b.game, plain)).toBe(true);
    expect(runIsOver(b.game, { ...b.meta, mode: "career" })).toBe(false);
    // R11 review: one rule for "over" and "lost" — the save store archives what pathEngine calls over…
    for (const m of [b.meta, bankrupt, plain]) expect(isLost(b.game, m)).toBe(runIsOver(b.game, m));
    // …and never removes a slot for it.
    for (const m of [b.meta, bankrupt, plain]) expect(isOver(b.game, m)).toBe(false);
  });

  it("HQ tops up an overdrawn till each evening (so the bank's countdown never starts) and says so", () => {
    let s = forkedEmpire();
    const hq0 = s.meta.empire!.hq.cash;
    // Tonight the till is £3,000 overdrawn after service.
    s = { ...s, game: { ...s.game!, cash: -300_000 - 1 } };
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    s = appReducer(s, { type: "skipShift" });
    expect(["evening", "event"]).toContain(s.game!.phase);
    expect(s.game!.cash).toBe(0);
    expect(s.game!.distressDays ?? 0).toBe(0);
    const ev = s.meta.empireEvents.filter((x) => x.kind === "topUp").at(-1)!;
    expect(ev.text).toMatch(/^HQ topped up the till £[\d,]+\.$/);
    const paid = Number(ev.text.replace(/[^\d]/g, "")) * 100;
    expect(paid).toBeGreaterThan(0);
    expect(paid).toBeLessThanOrEqual(300_000 + 50); // tonight's takings paid part of the overdraft
    expect(s.meta.empire!.hq.cash).toBeLessThan(hq0 + s.meta.empire!.hq.lastDayNet);
  });

  it("an Empire save that went bust while HQ could pay comes back on the evening, with no GameOver screen", async () => {
    const s = forkedEmpire();
    const b = bust(s);
    const loaded = appReducer(initialAppState, { type: "load", game: b.game, meta: b.meta });
    expect(loaded.game!.phase).toBe("evening");
    expect(loaded.game!.cash).toBe(0);
    expect(loaded.meta.empire!.hq.cash).toBe(b.meta.empire!.hq.cash - 12_000_000);
    try {
      await openInApp(b.game, b.meta);
      expect(screen.queryByText(/has closed its doors/)).toBeNull();
      expect(screen.queryByRole("button", { name: "Play this start again" })).toBeNull();
      expect(document.querySelector(".status__name")!.textContent).toMatch(/Round Eleven/);
    } finally { setSaveStore(null); }
  });

  it("when HQ can't pay: 'Close this shop and move on' instead of game over; it closes the shop and runs the next one", async () => {
    const s = forkedEmpire();
    const b = bust(s, -facility(s.meta.empire!));
    const loaded = appReducer(initialAppState, { type: "load", game: b.game, meta: b.meta });
    expect(loaded.game!.phase).toBe("gameover");
    const moved = appReducer(loaded, { type: "moveOn" });
    expect(moved.meta.empire!.sites.find((x) => x.id === "s1")!.status).toBe("closed");
    expect(moved.meta.empire!.focusedSiteId).toBe("s2");
    expect(moved.game!.restaurantName).toBe("Eleven Campus");
    expect(moved.game!.phase).toBe("planning");
    expect(moved.game!.day).toBe(moved.meta.empire!.hq.day);
    try {
      await openInApp(b.game, b.meta);
      expect(screen.queryByText(/has closed its doors/)).toBeNull();
      expect(await screen.findByRole("dialog", { name: "Your shop went bust" })).toBeTruthy();
      await act(async () => { fireEvent.click(await screen.findByRole("button", { name: "Close this shop and move on" })); await new Promise((r) => setTimeout(r, 10)); });
      expect(document.querySelector(".status__name")!.textContent).toMatch(/Eleven Campus/);
    } finally { setSaveStore(null); }
  });
});

describe("G6, G5: HQ funds a visited till; franchised shops aren't run hands-on", () => {
  it("the first visit's till and larder are paid by HQ; the old till goes back to HQ", () => {
    const s = forkedEmpire();
    const till0 = s.game!.cash;
    const hq0 = s.meta.empire!.hq.cash;
    const t = appReducer(s, { type: "focusSite", siteId: "s2" });
    expect(t.meta.empire!.focusedSiteId).toBe("s2");
    const float = t.game!.cash;
    expect(float).toBeGreaterThan(0);
    expect(float).toBeLessThan(2_000_000); // not the old free £20,000
    const opened = t.meta.empireEvents.find((x) => x.kind === "topUp" && /to open Eleven Campus/.test(x.text))!;
    const paid = Number(opened.text.replace(/[^\d]/g, "")) * 100;
    expect(paid).toBeGreaterThan(float); // float + larder
    expect(Math.abs(t.meta.empire!.hq.cash - (hq0 + till0 - paid))).toBeLessThan(100);
    // Sweeping the whole till straight back can't make money.
    const back = appReducer(t, { type: "empire", cmd: { type: "TRANSFER_FROM_FOCUSED", amount: t.game!.cash } });
    expect(back.meta.empire!.hq.cash).toBeLessThan(hq0 + till0);
  });

  it("a franchised shop can't be run hands-on: no button, and the reducer refuses", () => {
    const s = forkedEmpire();
    const r = appReducer(s, { type: "focusSite", siteId: "s3" });
    expect(r.meta.empire!.focusedSiteId).toBe("s1");
    expect(r.toast!.text).toMatch(/belongs to its franchisee/);
    render(<EmpireTab game={s.game!} meta={s.meta} empire={s.meta.empire!} send={() => {}} onFocusSite={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /My shops/ }));
    const items = [...document.querySelectorAll(".sitelist .site")];
    const seafront = items.find((li) => li.textContent!.includes("Eleven Seafront"))!;
    const campus = items.find((li) => li.textContent!.includes("Eleven Campus"))!;
    expect(seafront.textContent).not.toMatch(/Run it hands-on/);
    expect(campus.textContent).toMatch(/Run it hands-on/);
  });
});

describe("G8: bankruptcy is a screen, and debt has a way out", () => {
  it("a bankrupt Empire shows its own screen; 'Try again from the last board meeting' goes back to the checkpoint", async () => {
    let s = forkedEmpire();
    // A board meeting is called: the reducer keeps that moment as the checkpoint.
    const e = s.meta.empire!;
    s = appReducer(s, { type: "toast", text: "x" });
    s = appReducer({ ...s, meta: { ...s.meta, empire: { ...e, boardMeeting: buildBoardMeeting(content, e, emptyBook(), e.hq.day) } } }, { type: "dismissToast" });
    expect(s.checkpoint?.id).toBe(s.meta.empire!.boardMeeting!.id);
    const dead = appReducer({ ...s, meta: { ...s.meta, empire: { ...s.meta.empire!, status: "bankrupt", hq: { ...e.hq, cash: -300_000_000 } } } }, { type: "toast", text: "y" });
    expect(dead.checkpoint).toBe(s.checkpoint);
    const again = appReducer(dead, { type: "retryCheckpoint" });
    expect(again.meta.empire!.status).toBe("running");
    expect(again.game).toBe(s.checkpoint!.game);
    // The screen: what happened, and the way back while this visit remembers the meeting; a fresh start otherwise.
    let retried = 0;
    render(<EmpireEnd game={dead.game!} empire={dead.meta.empire!} kind="bankrupt" checkpointDay={dead.checkpoint!.day} onRetry={() => retried++} onNewGame={() => {}} onTitle={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Your chain has gone bust" })).toBeTruthy();
    expect(screen.getByText(/Eleven Burgers has gone bust/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again from the last board meeting" }));
    expect(retried).toBe(1);
    cleanup();
    render(<EmpireEnd game={dead.game!} empire={dead.meta.empire!} kind="bankrupt" onNewGame={() => {}} onTitle={() => {}} />);
    expect(screen.getByRole("button", { name: "Start over" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again from the last board meeting" })).toBeNull();
  });

  it("when HQ can't spend, the board offers 'Sell a shop' and the Money panel says how fast HQ is sinking, with one-tap fixes", () => {
    const s = forkedEmpire();
    let e = s.meta.empire!;
    e = {
      ...e,
      applicants: [...e.applicants, { id: "a9", name: "Sam Rich", competence: 60, honesty: 90, cash: 90_000_000, arrivedDay: e.hq.day }],
      hq: { ...e.hq, cash: -facility(e) - 4_000_000, income30d: -1_500_000 },
    };
    const m = buildBoardMeeting(content, e, emptyBook(), e.hq.day);
    const sent: unknown[] = [];
    render(<BoardMeeting empire={e} meeting={m} send={(c) => sent.push(c)} />);
    expect(screen.getByText(/can't borrow any more/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Sell Eleven Campus to Sam/ }));
    expect(sent.at(-1)).toMatchObject({ type: "BOARD_DECIDE", optionId: "sell" });
    cleanup();
    render(<EmpireTab game={s.game!} meta={s.meta} empire={e} send={(c) => sent.push(c)} onFocusSite={() => {}} />);
    const card = screen.getByRole("note", { name: "HQ is sinking" });
    const shown = card.cloneNode(true) as Element;
    shown.querySelectorAll(".term__tip").forEach((t) => t.remove());
    expect(shown.textContent).toMatch(/HQ is sinking £500 a day\./);
    fireEvent.click(screen.getByRole("button", { name: "Sell Eleven Campus to Sam" }));
    expect(sent.at(-1)).toEqual({ type: "SELL_FRANCHISE", siteId: "s2", applicantId: "a9" });
  });
});
