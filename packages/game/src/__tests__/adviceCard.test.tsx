/**
 * Round 6: the Evening's one tip (sim-core eveningAdvice) in a child's words — round 5's rota tip (same sentence) and the
 * new over-stock / dud dish / idle chef / under-pricing tips: first on the screen, a "Why?" with the numbers, <Term>s
 * for jargon, and one button that issues the tip's command.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DayResult, GameState, MenuItem, Staff } from "@full-plate/sim-core";
import { AdviceCard, renderTemplate } from "../components/AdviceCard";
import { Evening, dayList } from "../screens/Evening";
import { applyCommand, content, runDay } from "../sim";
import { suggestedStarterMenu } from "../lib/starterMenu";
import { baseGame } from "./fixtures/round2";

afterEach(cleanup);
const noop = () => {};
const staff = [
  { id: "c1", name: "Ana", role: "chef", wage: 1300, rota: [false, false, true, true, true, true, true] },
  { id: "c2", name: "Bo", role: "chef", wage: 1300, rota: [true, true, false, false, true, true, true] },
] as Staff[];
const days = (n: number, f: (i: number) => Partial<DayResult>) =>
  Array.from({ length: n }, (_, day) => ({ day, covers: 50, walkouts: 0, revenue: 100_000, profit: 5_000, waste: { prep: 0, plate: 0, spoil: 0 }, ...f(day) }) as DayResult);
const item = (dishId: string): MenuItem => ({ dishId, price: content.dishes.find((d) => d.id === dishId)!.suggestedPrice, active: true, sold7d: 0, margin7d: 0 });
const game = (over: Partial<GameState>) => ({ day: 13, phase: "evening", staff, menu: [item("fish_and_chips")], reputation: { popularity: 50, prestige: 20 }, history: days(14, () => ({})), ...over }) as unknown as GameState;
const losing = game({ history: days(14, () => ({ profit: -3_000 })) });
const overstocked = game({ staff: [staff[0]!], history: days(14, () => ({ spoiled: { cod: { qty: 4, cost: 400 } } })) });

/** Text a reader sees: tooltips (shown only on hover/focus) left out. */
function seen(el: Element): string {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll('[role="tooltip"]').forEach((t) => t.remove());
  return c.textContent!.replace(/\s+/g, " ").trim();
}

describe("AdviceCard: the round-5 rota tip", () => {
  it("keeps round 5's sentence (names the person, the doubled-up days and the weekly cost)", () => {
    render(<AdviceCard game={losing} />);
    const card = screen.getByLabelText("Tonight's tip");
    expect(seen(card.querySelector(".advice__title")!)).toBe("Two weeks of losing money (about £30 a day).");
    expect(seen(card.querySelector(".advice__body")!)).toMatch(/^Bo works Friday, Saturday and Sunday, when another chef is already on\. Those shifts cost £[\d,]+ a week\. Take them off the rota until things pick up\?$/);
    expect(card.querySelector('[data-term="rota"]')).not.toBeNull();
  });

  it("one tap gives Bo those days off tomorrow and opens the Staff tab", () => {
    const act = vi.fn();
    render(<AdviceCard game={losing} onAct={act} />);
    fireEvent.click(screen.getByRole("button", { name: "Give Bo Friday, Saturday and Sunday off" }));
    expect(act).toHaveBeenCalledWith([{ type: "SET_ROTA", staffId: "c2", rota: [true, true, false, false, false, false, false] }], "staff", "Done: Give Bo Friday, Saturday and Sunday off.", false);
  });

  it("stays quiet in a profitable fortnight with nothing else to say", () => {
    const { container } = render(<AdviceCard game={game({})} onAct={noop} />);
    expect(container.textContent).toBe("");
  });

  it("dayList reads like a sentence", () => {
    expect(dayList([5])).toBe("Saturday");
    expect(dayList([5, 6])).toBe("Saturday and Sunday");
  });
});

describe("AdviceCard: the round-6 tips", () => {
  it("over-stock: names the ingredient; Why? shows the numbers; the button deep-links to the larder", () => {
    const act = vi.fn();
    render(<AdviceCard game={overstocked} onAct={act} />);
    const card = screen.getByLabelText("Tonight's tip");
    expect(card.dataset.advice).toBe("overstock");
    expect(seen(card.querySelector(".advice__title")!)).toBe("You're buying more cod fillet than you can use.");
    expect(card.querySelector('[data-term="spoilage"]')).not.toBeNull();
    const why = screen.getByRole("button", { name: "Why?" });
    const reason = card.querySelector(".advice__reason") as HTMLElement;
    expect(reason.hidden).toBe(true);
    expect(why.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(why);
    expect(reason.hidden).toBe(false);
    expect(why.getAttribute("aria-expanded")).toBe("true");
    expect(seen(reason)).toBe("In the last 7 days your kitchen used 0 portions of cod fillet and threw away 28: £28 in the bin. It keeps for 2 days.");
    fireEvent.click(screen.getByRole("button", { name: "Hide why" }));
    expect(reason.hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Check the larder →" }));
    expect(act).toHaveBeenCalledWith([], "stock", "", false);
  });

  it("over-stock with a pending order beyond tomorrow's need: the button trims it tonight (round 6 review)", () => {
    const a = { kind: "overstock" as const, subject: "cod", vars: { ingredientLower: "cod fillet", cut: "25", ingredient: "Cod fillet", used: "1", binned: "1", cost: "£1", shelfLife: "2", days: "7" }, commands: [{ type: "CANCEL_ORDER" as const, ingredientId: "cod", qty: 25 }], tab: "stock" as const, now: true as const };
    const act = vi.fn();
    render(<AdviceCard advice={a} game={overstocked} onAct={act} />);
    fireEvent.click(screen.getByRole("button", { name: "Take 25 cod fillet off tomorrow's order" }));
    expect(act).toHaveBeenCalledWith(a.commands, "stock", "Done: Take 25 cod fillet off tomorrow's order.", true);
  });

  it("dud dish: the button takes it off the menu", () => {
    const line = (sold: number, price: number, food: number) => ({ sold, plated: sold, qualityMean: 70, revenue: sold * price, foodCost: sold * food });
    const g = game({
      staff: [staff[0]!],
      menu: ["fish_and_chips", "sausage_and_mash", "beef_burger", "steak_frites"].map(item),
      history: days(14, () => ({ perDish: { fish_and_chips: line(12, 1245, 300), sausage_and_mash: line(12, 1200, 300), beef_burger: line(12, 1245, 300), steak_frites: line(1, 1000, 700) } })),
    });
    const act = vi.fn();
    render(<AdviceCard game={g} onAct={act} />);
    expect(seen(screen.getByLabelText("Tonight's tip").querySelector(".advice__title")!)).toBe("Hardly anyone orders the Sirloin steak frites.");
    expect(screen.getByLabelText("Tonight's tip").querySelector('[data-term="Dog"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Take the Sirloin steak frites off the menu/ }));
    expect(act.mock.calls[0]![0]).toEqual([{ type: "REMOVE_MENU_ITEM", dishId: "steak_frites" }]);
    expect(act.mock.calls[0]![1]).toBe("menu");
  });

  it("renderTemplate turns [[term|label]] into a Term and leaves unknown terms as plain words", () => {
    const { container } = render(<p>{renderTemplate("Less [[spoilage|goes off]] and [[nope|plain]] for {who}.", { who: "you" })}</p>);
    expect(seen(container)).toBe("Less goes off and plain for you.");
    expect(container.querySelectorAll("[data-term]")).toHaveLength(1);
  });
});

describe("Evening: the tip is the first thing on the page", () => {
  it("sits straight under the heading, before the larder, the P&L and everything else", () => {
    let g = baseGame(77);
    for (const d of suggestedStarterMenu(content, g)) g = applyCommand(content, g, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice }).state;
    g = runDay(content, g).state;
    const real = g.history.at(-1)!;
    const evening = { ...g, history: Array.from({ length: 14 }, (_, day) => ({ ...real, day, spoiled: { cod: { qty: 4, cost: 400 } } })), day: 13 };
    const act = vi.fn();
    render(<Evening game={evening} result={evening.history.at(-1)!} onNext={noop} onAct={act} nextLabel="Next" send={noop} />);
    const cards = [...document.querySelectorAll(".evening .card")];
    expect(cards[0]!.getAttribute("aria-label")).toBe("Tonight's tip");
    expect(within(cards[0] as HTMLElement).getByRole("button", { name: /larder/ })).toBeTruthy();
  });
});
