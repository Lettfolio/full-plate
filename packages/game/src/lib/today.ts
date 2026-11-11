/**
 * Round 14 (F, "repetitive from day 6"): the morning's "Today" card. Each row is a decision the game already has,
 * surfaced only when it is live today — nothing here is invented and the sim never sees it:
 *
 * - a regular's VIP order that falls today (lib/regulars.ts), with the one tap that helps if there is one (put the
 *   dish back on, add it at its usual price when the larder can make it, or look at the larder);
 * - the rival's week (lib/rival.ts): on Monday the score they're aiming for (fixed from her last four weeks), on Sunday
 *   where the week stands before the last night.
 *
 * The stock warning already has its own morning card (StockWarning, one-tap order) and is not repeated. Lives in the
 * voices chunk with its data; never import it from main-chunk code.
 */
import type { Command, ContentPack, GameState } from "@full-plate/sim-core";
import type { VoicesMemo } from "../state/paths";
import { lapseDay, regularsOf } from "./regulars";
import { rivalFor, rivalScore } from "./rival";
import { dishLabel, wasOpen, weekStart, weekdayName } from "./voiceKit";
import { weekdayIndex } from "./calendar";

export type TodayTab = "menu" | "stock" | "restaurant";
export interface TodayRow {
  kind: "vip" | "rivalWeek" | "rivalSunday";
  /** Who it's about (a regular's id, or the rival's). */
  who: string;
  title: string;
  text: string;
  /** The one tap: commands to send now, or a tab to open. */
  act?: { label: string; commands?: Command[]; tab?: TodayTab };
}

/** Can the larder plate this dish once right now? */
export function canPlate(content: ContentPack, game: Pick<GameState, "stock">, dishId: string): boolean {
  const d = content.dishes.find((x) => x.id === dishId);
  if (!d) return false;
  const qty = new Map(game.stock.map((s) => [s.ingredientId, s.qty]));
  return d.ingredients.every((i) => (qty.get(i.id) ?? 0) + 1e-9 >= i.qty);
}

const r1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);

export function todayRows(content: ContentPack, game: GameState, memo?: VoicesMemo): TodayRow[] {
  const rows: TodayRow[] = [];
  const today = weekdayIndex(game.day);
  for (const s of regularsOf(game, memo)) {
    const o = s.open;
    if (!o || o.weekday !== today || o.from > game.day) continue;
    const first = s.def.name.split(" ")[0]!;
    const dish = dishLabel(o.dishId) ?? "special";
    const item = game.menu.find((m) => m.dishId === o.dishId);
    const plate = canPlate(content, game, o.dishId);
    const isLast = lapseDay(o) <= game.day;
    const last = isLast ? " It's their last try: miss it and they go elsewhere." : "";
    const later = isLast ? last : ` Order tonight for next ${weekdayName(game.day)}.`;
    const title = `${first}'s order is today: the ${dish}`;
    if (item?.active && plate) rows.push({ kind: "vip", who: s.def.id, title, text: `It's on and in stock. Sell it on a night of 3.5★ or better and the story moves on.${last}` });
    else if (item?.active) rows.push({ kind: "vip", who: s.def.id, title, text: `It's on the menu but out of stock today.${later}`, act: { label: "See the larder", tab: "stock" } });
    else if (item) rows.push({ kind: "vip", who: s.def.id, title, text: `It's switched off on your menu.${last}`, act: { label: `Put the ${dish} back on`, commands: [{ type: "SET_MENU_ITEM", dishId: o.dishId, active: true }] } });
    else {
      const def = content.dishes.find((d) => d.id === o.dishId);
      if (def && plate) rows.push({ kind: "vip", who: s.def.id, title, text: `It isn't on your menu, but the larder can make it today.${last}`, act: { label: `Add it at its usual price`, commands: [{ type: "ADD_MENU_ITEM", dishId: o.dishId, price: def.suggestedPrice }] } });
      else rows.push({ kind: "vip", who: s.def.id, title, text: `It isn't on your menu and the larder can't make it today.${isLast ? last : ` Add it and order its stock for next ${weekdayName(game.day)}.`}`, act: { label: "Open the menu", tab: "menu" } });
    }
  }
  const rival = rivalFor(game.seed, game.districtId);
  const start = weekStart(game.day);
  if (today === 0 && game.history.some(wasOpen)) {
    rows.push({ kind: "rivalWeek", who: rival.id, title: `New week across the road`, text: `${rival.first} at ${rival.place} is aiming for ${r1(rivalScore(game, start))}★ in reviews this week. Beat that on average and the week is yours.`, act: { label: "See the rival", tab: "restaurant" } });
  } else if (today === 6) {
    const nights = game.history.filter((d) => d.day >= start && d.day < game.day && wasOpen(d));
    if (nights.length) {
      const you = nights.reduce((a, d) => a + d.averageRating, 0) / nights.length;
      const them = rivalScore(game, start);
      const ahead = you - them >= 0.05;
      rows.push({ kind: "rivalSunday", who: rival.id, title: `Last night of the week`, text: `You're on ${r1(you)}★ over ${nights.length} night${nights.length === 1 ? "" : "s"}; ${rival.first} is on ${r1(them)}★. ${ahead ? "A good night keeps you ahead." : "A really good night tonight could still turn it."}`, act: { label: "See the rival", tab: "restaurant" } });
    }
  }
  return rows;
}
