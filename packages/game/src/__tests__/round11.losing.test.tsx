/**
 * Round 11 (B): stop silent losing — the bank chip and evening card, archive (not delete) on game over, the "are you
 * sure?" before a big spend, visible "Needs £X", greyed advice and morning-post options she can't afford, stale toasts,
 * no "Dog" before a week of sales, and reviews that match the night. Real sim states throughout.
 */
import { afterEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Command, GameState } from "@full-plate/sim-core";
import { applyCommand, bankStatus, candidates, content, INSOLVENCY_DAYS, newGame, runDay, spendCheck, STARTER_LOAN, starterLoanOffer, TABLE_COST } from "../sim";
import { reviewText, Rng, roughNight, strategies } from "@full-plate/sim-core";
import { baseGame } from "./fixtures/round2";
import { BankChip, hirePromptText } from "../components/Bank";
import { BankBanner, raisePrices } from "../components/BankCards";
import { Evening } from "../screens/Evening";
import { EventModal } from "../screens/EventModal";
import { DecorateTab } from "../screens/planning/DecorateTab";
import { CandidateCard } from "../screens/planning/StaffTab";
import { MenuTab } from "../screens/planning/MenuTab";
import { Planning } from "../screens/Planning";
import { GameOver } from "../screens/GameOver";
import { SlotPicker } from "../screens/SlotPicker";
import { TitleScreen } from "../screens/TitleScreen";
import { createSaveStore } from "../state/saveCore";
import { defaultSlotName, isLost, isOver, type CloudConn } from "../state/saveStore";
import { appReducer, initialAppState } from "../state/gameReducer";
import { initialMeta } from "../state/paths";

afterEach(cleanup);
const noop = () => {};

class FakeStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
}
const offline = async (): Promise<CloudConn> => ({ off: "none" });
const store = () => createSaveStore({ storage: new FakeStorage(), cloud: offline, now: () => Date.parse("2026-11-10T12:00:00Z"), debounceMs: 20, compress: false, retryMs: () => 1 });

const withMenu = (g: GameState) => content.dishes.slice(0, 6).reduce((s, d) => applyCommand(content, s, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice }).state, g);
/** A real evening (one day played, nobody hired) with cash pushed under the bank's line for `below` evenings. */
function inTrouble(below: number, difficulty: GameState["difficulty"] = "hard"): GameState {
  const g0 = withMenu(newGame(content, { type: "NEW_GAME", seed: 31, districtId: content.districts[1]!.id, restaurantName: "Mia's Diner", difficulty }));
  const e = runDay(content, g0).state;
  const line = bankStatus(content, e).line;
  return { ...e, cash: line - 50_000, distressDays: below };
}

describe("the bank's countdown (U3)", () => {
  it("header chip: 'Bank: N days left', red at ≤ 5, absent above the line and on Cosy", () => {
    const g = inTrouble(2);
    const { unmount } = render(<BankChip game={g} />);
    expect(screen.getByTestId("bank-chip").textContent).toBe(`Bank: ${INSOLVENCY_DAYS - 2} days left`);
    expect(screen.getByTestId("bank-chip").className).not.toMatch(/red/);
    unmount();
    render(<BankChip game={inTrouble(INSOLVENCY_DAYS - 5)} />);
    expect(screen.getByTestId("bank-chip").className).toMatch(/bankchip--red/);
    cleanup();
    render(<BankChip game={{ ...inTrouble(2), cash: 1_000_000, distressDays: 0 }} />);
    expect(screen.queryByTestId("bank-chip")).toBeNull();
    cleanup();
    render(<BankChip game={{ ...inTrouble(0, "cosy"), cash: -5_000_000 }} />);
    expect(screen.queryByTestId("bank-chip")).toBeNull();
  });

  it("evening card from the first night below: what to do, with one-tap actions (raise prices, starter loan)", async () => {
    const g = inTrouble(1);
    const sent: Command[] = [];
    const acts: Command[][] = [];
    render(<Evening game={g} result={g.history.at(-1)!} onNext={noop} onGoTo={noop} onAct={(c) => acts.push(c)} nextLabel="Next day →" send={(c) => sent.push(c)} />);
    const card = await screen.findByTestId("bank-card");
    expect(card.textContent).toMatch(new RegExp(`The bank is worried: ${INSOLVENCY_DAYS - 1} days left`));
    expect(card.textContent).toMatch(/Raise your prices/);
    expect(card.textContent).toMatch(/cheaper stock/);
    fireEvent.click(within(card).getByRole("button", { name: /Raise prices 10%/ }));
    expect(acts[0]).toEqual(raisePrices(g));
    expect(raisePrices(g).every((c) => c.type === "SET_MENU_ITEM" && c.price! > g.menu.find((m) => m.dishId === c.dishId)!.price)).toBe(true);
    // Under the line the hole is deeper than any starter loan: the card says to stop spending instead.
    expect(within(card).queryByRole("button", { name: /Borrow/ })).toBeNull();
    expect(card.textContent).toMatch(/Don't buy anything new/);
    expect(sent).toEqual([]);
  });

  it("evening: a staffless owner who can't afford a chef is offered the starter loan (tip + goal), one tap", async () => {
    const g0 = withMenu(newGame(content, { type: "NEW_GAME", seed: 31, districtId: content.districts[1]!.id, restaurantName: "Broke", difficulty: "hard" }));
    const e = runDay(content, g0).state;
    const g = { ...e, cash: 2_500 };
    const sent: Command[] = [];
    render(<Evening game={g} result={g.history.at(-1)!} onNext={noop} onGoTo={noop} nextLabel="Next day →" send={(c) => sent.push(c)} />);
    const tip = await screen.findByTestId("starter-loan");
    expect(tip.textContent).toMatch(/The bank will lend you a first wage/);
    fireEvent.click(within(tip).getByRole("button", { name: /^Borrow £[\d,]+$/ }));
    expect(sent).toEqual([{ type: "STARTER_LOAN" }]);
    expect(screen.queryByTestId("bank-card")).toBeNull();
  });

  it("morning banner only on the last 3 days", () => {
    const morning = (n: number) => ({ ...inTrouble(n), phase: "planning" as const });
    const { unmount } = render(<BankBanner game={morning(INSOLVENCY_DAYS - 4)} />);
    expect(screen.queryByTestId("bank-banner")).toBeNull();
    unmount();
    render(<BankBanner game={morning(INSOLVENCY_DAYS - 1)} />);
    expect(screen.getByTestId("bank-banner").textContent).toMatch(/Last day with the bank!/);
  });

  it("the starter loan gets a staffless owner a chef she can afford", () => {
    let g = { ...withMenu(newGame(content, { type: "NEW_GAME", seed: 31, districtId: content.districts[1]!.id, restaurantName: "Broke", difficulty: "hard" })), cash: 2_500 };
    expect(hirePromptText(g).can).toBe(false);
    expect(hirePromptText(g).text).toMatch(/^Save £[\d,]+ to hire a chef$/);
    const lent = starterLoanOffer(content, g)!;
    expect(lent).toBeGreaterThanOrEqual(STARTER_LOAN);
    g = applyCommand(content, g, { type: "STARTER_LOAN" }).state;
    expect(g.cash).toBe(2_500 + lent);
    expect(hirePromptText(g)).toEqual({ can: true, text: "Hire →" });
  });
});

describe("archive, don't delete (U3)", () => {
  it("a lost game stays as 'Lost — day N'; Start over is offered; Continue skips it", async () => {
    const s = store();
    const g = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 9, districtId: content.districts[0]!.id, restaurantName: "Gone Bust", difficulty: "normal" } });
    const over = { ...g.game!, day: 40, phase: "gameover" as const };
    expect(isOver(over, g.meta)).toBe(false);
    expect(isLost(over, g.meta)).toBe(true);
    await s.save("s1", over, g.meta);
    expect(s.list()[0]).toMatchObject({ slotId: "s1", archived: true, day: 40 });
    const restarted: string[] = [];
    render(<SlotPicker mode="browse" store={s} onContinue={noop} onClose={noop} onRestart={(id) => restarted.push(id)} />);
    expect(screen.getByTestId("slot-lost").textContent).toBe("Lost — day 41");
    fireEvent.click(screen.getByRole("button", { name: "Start Gone Bust over" }));
    expect(restarted).toEqual(["s1"]);
    expect(screen.getByRole("button", { name: "What happened to Gone Bust" })).toBeTruthy();
    cleanup();
    render(<TitleScreen saved={null} slots={s.list()} onNew={noop} onContinue={noop} onYourGames={noop} />);
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
    expect(screen.getByRole("button", { name: /Your games/ })).toBeTruthy();
    s.dispose();
  });

  it("the game-over screen says it's kept and offers the same restaurant again", () => {
    const g = { ...inTrouble(INSOLVENCY_DAYS), phase: "gameover" as const };
    render(<GameOver game={g} reason="Cash stayed below the bank's limit for 14 days." onRetrySameSeed={noop} onNewSeed={noop} onTitle={noop} />);
    expect(screen.getByTestId("gameover-kept").textContent).toMatch(/Lost — day/);
    expect(screen.getByRole("button", { name: "Start over with the same restaurant" })).toBeTruthy();
  });

  it("career slot names: blank name → 'Your career'", () => {
    const c = appReducer(initialAppState, { type: "newCareer", seed: 5, track: "chef", strategy: "balanced", playerName: "", difficulty: "cosy" });
    expect(defaultSlotName(c.game!, c.meta)).toBe("Your career");
    const m = appReducer(initialAppState, { type: "newCareer", seed: 5, track: "chef", strategy: "balanced", playerName: "Mia", difficulty: "cosy" });
    expect(defaultSlotName(m.game!, m.meta)).toBe("Mia's career");
  });
});

describe("never spend into a hole (U2, U6)", () => {
  function Harness({ start }: { start: GameState }) {
    const [game, setGame] = useState(start);
    return <><DecorateTab game={game} send={(c) => setGame((g) => applyCommand(content, g, c).state)} /><output data-testid="cash">{game.cash}</output></>;
  }

  it("a decor buy that leaves under 3 days of running costs asks first; 'Keep my money' keeps it; yes buys and says so", () => {
    const g = { ...baseGame(31), cash: 450_000 };
    const parquet = 380_000;
    expect(spendCheck(content, g, parquet).risky).toBe(true);
    render(<Harness start={g} />);
    const buy = screen.getAllByRole("button", { name: /Buy · fit tomorrow/ }).at(-1)!;
    fireEvent.click(buy);
    expect(screen.getByTestId("spend-confirm")).toBeTruthy();
    expect(screen.getByRole("alertdialog").textContent).toMatch(/This leaves you with £700 — are you sure\?/);
    fireEvent.click(screen.getByRole("button", { name: "Keep my money" }));
    expect(screen.getByTestId("cash").textContent).toBe("450000");
    fireEvent.click(screen.getAllByRole("button", { name: /Buy · fit tomorrow/ }).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: "Yes, buy it" }));
    expect(screen.getByTestId("cash").textContent).toBe(String(450_000 - parquet));
    // the live caption tells the truth about what happened
    fireEvent.mouseEnter(screen.getByText("Herringbone parquet").closest("li")!);
    expect(document.querySelector(".decorate__caption")!.textContent).toMatch(/^Bought Herringbone parquet — the fitters come tomorrow/);
  });

  it("a cheap buy with plenty in the bank goes straight through", () => {
    render(<Harness start={{ ...baseGame(31), cash: 5_000_000 }} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Buy · fit tomorrow/ })[0]!);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("a disabled Hire says 'Needs £X in the bank' as text, not a title", () => {
    const g = { ...baseGame(31), cash: 1_000 };
    const c = candidates(content, g)[0]!;
    render(<CandidateCard c={c} game={g} onHire={noop} />);
    const hire = screen.getByRole("button", { name: /Hire ·/ });
    expect((hire as HTMLButtonElement).disabled).toBe(true);
    expect(hire.getAttribute("title")).toBeNull();
    expect(screen.getByTestId("hire-needs").textContent).toMatch(/^Needs £[\d,]+ in the bank \(you have £10\)$/);
  });

  it("the dock's 'Hire a chef' becomes 'Save £X to hire a chef' when nobody is affordable", () => {
    const g = { ...withMenu(baseGame(31)), cash: 1_000, day: 3 };
    render(<Planning game={g} send={noop} tab="menu" onTab={noop} />);
    expect(screen.getByRole("button", { name: /^Save £[\d,]+ to hire a chef/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Hire a chef/ })).toBeNull();
  });

  it("evening: the table tip says 'Can't afford' when she can't; the Hire prompt says how far off", () => {
    const g0 = withMenu(newGame(content, { type: "NEW_GAME", seed: 31, districtId: content.districts[1]!.id, restaurantName: "Mia's Diner", difficulty: "hard" }));
    const e = runDay(content, g0).state;
    const r = { ...e.history.at(-1)!, walkouts: 25 };
    const g = { ...e, cash: -51_600 };
    render(<Evening game={g} result={r} onNext={noop} onGoTo={noop} nextLabel="Next day →" send={noop} />);
    expect(screen.getByTestId("table-tip").textContent).toMatch(/Can't afford/);
    expect(within(screen.getByTestId("table-tip")).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hire →" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Save £[\d,]+ to hire a chef$/ }).length).toBeGreaterThan(0);
    expect(spendCheck(content, g, TABLE_COST).risky).toBe(true);
  });

  it("morning post: options she can't pay for are greyed 'Can't afford' (one is always left)", () => {
    const ev = content.events.find((x) => x.choices.some((c) => (c.effects.cash ?? 0) < 0) && x.choices.some((c) => !(c.effects.cash ?? 0)))!;
    const g = { ...baseGame(31), phase: "event" as const, activeEvent: { eventId: ev.id }, cash: -250_300 } as GameState;
    const sent: Command[] = [];
    render(<EventModal game={g} send={(c) => sent.push(c)} />);
    for (const c of ev.choices) {
      const b = screen.getByText(c.label).closest("button")!;
      const cant = (c.effects.cash ?? 0) < 0;
      expect(b.disabled).toBe(cant);
      expect(b.textContent!.includes("Can't afford")).toBe(cant);
    }
    // with money in the bank every option is open
    cleanup();
    render(<EventModal game={{ ...g, cash: 5_000_000 }} send={noop} />);
    expect(screen.queryByText(/Can't afford/)).toBeNull();
  });
});

describe("stale toasts (U4)", () => {
  it("a toast raised in service is gone when the evening starts; a goal toast made by the change stays", () => {
    let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 3, districtId: content.districts[0]!.id, restaurantName: "Toasty", difficulty: "cosy", starterChef: true } });
    for (const d of content.dishes.slice(0, 4)) s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice } });
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    s = appReducer(s, { type: "toast", text: "A big group at the door — choose what to do on its card.", tone: "info" });
    expect(s.toast).not.toBeNull();
    // ticks stop at each incident; the toast stays through service (same phase) …
    s = appReducer(s, { type: "ticks", n: 1 });
    if (s.game!.phase === "service") expect(s.toast?.text).toMatch(/big group/);
    for (let i = 0; i < 300 && s.game!.phase === "service"; i++) s = appReducer(s, { type: "ticks", n: 200 });
    // … and goes with it
    expect(["evening", "event"]).toContain(s.game!.phase);
    expect(s.toast?.text ?? "").not.toMatch(/big group/);
    // the reducer still keeps a toast that the phase change itself raised
    const t = appReducer({ ...s, toast: null }, { type: "toast", text: "x" });
    expect(t.toast?.text).toBe("x");
  });
});

describe("no 'Dog' on day 1 (U5)", () => {
  it("no quadrant label until a dish has a week of sales; then the hint is visible text", () => {
    const g = withMenu(baseGame(31));
    const { unmount } = render(<MenuTab game={g} send={noop} />);
    expect(screen.queryByText("Dog")).toBeNull();
    expect(screen.queryByText("Star")).toBeNull();
    expect(screen.getAllByTestId("dish-hint")[0]!.textContent).toBe("New: judged after 7 days of sales");
    unmount();
    const week = { ...g, menu: g.menu.map((m, i) => ({ ...m, recent: Array.from({ length: 7 }, () => ({ sold: i === 0 ? 0 : 20, margin: i === 0 ? 0 : 5000 })), sold7d: i === 0 ? 0 : 140, margin7d: i === 0 ? 0 : 35_000 })) };
    render(<MenuTab game={week} send={noop} />);
    expect(screen.getAllByText("Dog").length).toBeGreaterThan(0);
    expect(document.querySelector(".pill--dog")!.getAttribute("title")).toBeNull();
    expect(screen.getAllByTestId("dish-hint").map((h) => h.textContent)).toContain("Think about taking it off");
  });
});

const fiveStarText = (t: string) => content.reviewTemplates!["5"]!.some((p) => t.startsWith(p.split("{")[0]!));

describe("mixed signals (U12)", () => {
  it("no 'Five stars isn't enough!'-style review on a night of walk-outs", () => {
    const fiveStar = new Set(content.reviewTemplates!["5"]!.map((t) => t.split("{")[0]!.slice(0, 18)));
    for (let seed = 1; seed <= 6; seed++) {
      let s = strategies.setUpMenu(content, newGame(content, { type: "NEW_GAME", seed, districtId: content.districts[1]!.id, restaurantName: "R", difficulty: "hard" }), strategies.STRATEGIES.nohire, (g, c) => applyCommand(content, g, c).state);
      for (let d = 0; d < 10 && s.phase !== "gameover"; d++) {
        s = runDay(content, s).state;
        const h = s.history.at(-1)!;
        if (h.walkouts > h.covers) {
          for (const rv of h.reviews) if (rv.rating >= 4) { for (const p of fiveStar) expect(rv.text.startsWith(p)).toBe(false); }
        }
        s = s.phase === "event" ? applyCommand(content, s, { type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === s.activeEvent!.eventId)!.choices.at(-1)!.id }).state : applyCommand(content, s, { type: "END_DAY" }).state;
      }
    }
    expect(content.reviewTemplates!.rough!.length).toBeGreaterThan(3);
    // the words themselves: a 5★ guest on a rough night speaks from the "rough" pool, on a good night from the 5★ one
    const g = baseGame(31);
    for (let k = 0; k < 20; k++) {
      expect(content.reviewTemplates!.rough!.map((t) => t.split("{")[0])).toContain(reviewText(content, g, Rng.fromSeed(k), 5, content.dishes[0]!.id, undefined, true).split(content.dishes[0]!.name)[0]!.split(g.restaurantName)[0]);
      expect(fiveStarText(reviewText(content, g, Rng.fromSeed(k), 5, content.dishes[0]!.id, undefined, false))).toBe(true);
    }
    expect(roughNight(31, 15, 2.7)).toBe(true);
  });

  it("the evening's mood reason only shows when it points the same way as the change", () => {
    const g0 = withMenu(baseGame(31));
    const hired = applyCommand(content, g0, { type: "HIRE", candidateIndex: candidates(content, g0).findIndex((c) => c.role === "chef") }).state;
    const e = runDay(content, hired).state;
    const id = e.staff[0]!.id;
    const r = { ...e.history.at(-1)!, staffMoodDelta: { [id]: 3 } };
    const g = { ...e, staff: e.staff.map((p) => ({ ...p, moodWhy: { text: "stuck on a shift with Nikhil", delta: -1 } })) };
    const { unmount } = render(<Evening game={g} result={r} onNext={noop} nextLabel="Next" send={noop} />);
    expect(screen.queryByTestId("mood-why")).toBeNull();
    unmount();
    render(<Evening game={{ ...g, staff: g.staff.map((p) => ({ ...p, moodWhy: { text: "the guests loved it", delta: 3 } })) }} result={r} onNext={noop} nextLabel="Next" send={noop} />);
    expect(screen.getByTestId("mood-why").textContent).toBe("the guests loved it");
  });
});

describe("starter chef (G2)", () => {
  it("a new owner game from the app opens with one chef", () => {
    const s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 9, districtId: content.districts[0]!.id, restaurantName: "Chefs", difficulty: "normal", starterChef: true } });
    expect(s.game!.staff.map((p) => p.role)).toEqual(["chef"]);
    expect(initialMeta("owner").mode).toBe("owner");
  });
});
