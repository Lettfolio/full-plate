/**
 * Round 14 (F, "repetitive from day 6"): the Evening's "one thing to change tomorrow", from tonight's own numbers,
 * shown when the sim's tip (AdviceCard) has nothing to say. First that applies:
 *
 * 1. a dish ran out mid-service (the sim's "… has run out — 86'd for today." log line): restock covers it;
 * 2. a long wait: walk-outs were at least 4 and a tenth of the guests served: one more on the rota, or a smaller menu;
 * 3. the dish that kept the least of each £1 after its stock (3+ sold, from DayResult.perDish; at least 12p behind
 *    the best): its price up 10 %, or swap it.
 *
 * Pure; the one tap is the evening's existing onAct (commands applied tomorrow morning) or a tab.
 */
import type { Command, DayResult, GameState } from "@full-plate/sim-core";
import { MAX_PRICE_PENCE } from "../sim";

export interface OneThing {
  kind: "ranOut" | "waits" | "margin";
  title: string;
  text: string;
  act?: { label: string; tab: "menu" | "staff" | "stock"; commands?: Command[]; done?: string };
}

const pounds = (p: number) => `£${(p / 100).toFixed(2).replace(/\.00$/, "")}`;

export function oneThingTomorrow(game: Pick<GameState, "log" | "menu">, r: DayResult, dishName: (id: string) => string, suggested: (id: string) => number | undefined = () => undefined): OneThing | undefined {
  if (r.closed || r.covers === 0) return undefined;
  const ran = game.log.filter((l) => l.day === r.day && /has run out — 86'd/.test(l.text)).map((l) => l.text.replace(/ has run out — 86'd for today\.$/, ""));
  if (ran.length) {
    const list = ran.length === 1 ? `The ${ran[0]}` : `${ran.length} dishes (${ran.slice(0, 3).join(", ")}${ran.length > 3 ? "…" : ""})`;
    return { kind: "ranOut", title: `${list} ran out tonight.`, text: "Guests who wanted it ordered something else or left. Restock for tomorrow, just below, covers it; it arrives in the morning." };
  }
  if (r.walkouts >= 4 && r.walkouts >= r.covers / 10) {
    return { kind: "waits", title: `${r.walkouts} guests gave up waiting.`, text: "The queue was longer than the team could handle. Put one more person on tomorrow's rota, or take a slow dish off the menu.", act: { label: "Rota →", tab: "staff" } };
  }
  const lines = Object.entries(r.perDish ?? {}).filter(([, l]) => l.sold >= 3 && l.revenue > 0);
  if (lines.length >= 2) {
    const per = lines.map(([id, l]) => ({ id, each: (l.revenue - l.foodCost) / l.sold, share: (l.revenue - l.foodCost) / l.revenue }));
    const worst = per.reduce((a, b) => (b.share < a.share ? b : a));
    const best = per.reduce((a, b) => (b.share > a.share ? b : a));
    const item = game.menu.find((m) => m.dishId === worst.id && m.active);
    // Not once it's already well above its usual price (a tap every evening mustn't ratchet it up).
    const usual = suggested(worst.id);
    if (item && worst.id !== best.id && worst.share < best.share - 0.12 && (usual === undefined || item.price < usual * 1.2)) {
      const price = Math.min(MAX_PRICE_PENCE, Math.round((item.price * 1.1) / 5) * 5);
      return {
        kind: "margin",
        title: `The ${dishName(worst.id)} made the least per plate: ${pounds(Math.round(worst.each))}.`,
        text: `It keeps ${Math.round(worst.share * 100)}p of each £1 after its stock; the ${dishName(best.id)} keeps ${Math.round(best.share * 100)}p. A little more on its price, or swap it for something that pays.`,
        act: { label: `Raise it to ${pounds(price)}`, tab: "menu", commands: [{ type: "SET_MENU_ITEM", dishId: worst.id, price }], done: `Done: the ${dishName(worst.id)} is ${pounds(price)} from tomorrow.` },
      };
    }
  }
  return undefined;
}
