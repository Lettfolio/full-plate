/**
 * Round 12 (G): what a visit draws, built from a friend's (already checked) snapshot.
 *
 * The floor renderer takes a GameState, so the visit makes a throwaway one: a fresh `newGame` (fixed seed, never saved,
 * never ticked) with the friend's tables, decor, menu, staff and name laid over it. It only feeds the canvas's empty-room
 * preview; nothing here reaches the visitor's own game or the sim's RNG.
 */
import type { GameState, Staff } from "@full-plate/sim-core";
import { content, findDecorItem, newGame } from "../sim";
import { cleanLabel, LIMITS, type Known, type ShareSnapshot } from "../state/share";

/**
 * Round 14 (B): is `text` a review line the game itself writes — one of the review templates for this rating (or the
 * "rough night" set) with {dish}, {restaurant} and {segment} filled exactly as the sim fills them? Snapshot review lines
 * are shown only if so: a share's owner can no longer put words of their own on a visitor's screen.
 */
export function gameLine(text: string, rating: number, dishId: string | undefined, restaurant: string): boolean {
  const pools = content.reviewTemplates ?? {};
  const dish = (dishId && content.dishes.find((d) => d.id === dishId)?.name) || "food";
  const segs = ["guest", ...content.segments.map((x) => x.name)];
  for (const key of [String(rating), ...(rating >= 4 ? ["rough"] : [])]) {
    for (const t of pools[key] ?? []) {
      const base = t.replaceAll("{dish}", dish).replaceAll("{restaurant}", restaurant);
      for (const seg of base.includes("{segment}") ? segs : [""]) {
        if (cleanLabel(base.replaceAll("{segment}", seg), LIMITS.text) === text) return true;
      }
    }
  }
  return false;
}

/** Content lookups `checkSnapshot` filters ids against (and, R14, the review-line check). */
export const known: Known & { line: NonNullable<Known["line"]> } = {
  dish: (id: string) => content.dishes.some((d) => d.id === id),
  decor: (id: string) => !!findDecorItem(content, id),
  district: (id: string) => content.districts.some((d) => d.id === id),
  line: gameLine,
};

export const dishName = (id: string): string => content.dishes.find((d) => d.id === id)?.name ?? "A dish";
export const districtName = (id: string): string => content.districts.find((d) => d.id === id)?.name ?? "";

/** The room as the canvas draws it (preview mode: no people, no tickets). */
export function roomState(s: ShareSnapshot): GameState {
  const base = newGame(content, { type: "NEW_GAME", seed: 1, districtId: s.districtId || content.districts[0]!.id, restaurantName: s.name, difficulty: s.difficulty });
  return {
    ...base,
    day: s.day,
    restaurantName: s.name,
    tables: s.tables.map((seats, i) => ({ id: `t${i + 1}`, seats, dirtyTicks: 0 })),
    decor: { slots: { ...s.decor } },
    menu: s.menu.map((m) => ({ dishId: m.dishId, price: m.price, active: m.active, sold7d: 0, margin7d: 0 })),
    staff: s.staff.map((p, i): Staff => ({ id: `v${i}`, name: p.name, role: p.role, skill: p.skill, speed: 50, charm: 50, wage: 0, mood: 70, fatigue: 0, traits: [], hiredDay: 0, potential: p.skill, rota: [true, true, true, true, true, true, true] })),
    customers: [],
    tickets: [],
  };
}

export const ROLE_WORD: Record<string, string> = { chef: "Chef", server: "Server", bar: "Bar", porter: "Kitchen porter", manager: "Manager" };

/** The week in four numbers (nights open only). */
export function weekTotals(s: ShareSnapshot): { nights: number; covers: number; revenue: number; profit: number; rating: number } {
  const open = s.week.filter((d) => !d.closed);
  const covers = open.reduce((a, d) => a + d.covers, 0);
  const rated = open.filter((d) => d.rating > 0);
  return {
    nights: open.length,
    covers,
    revenue: open.reduce((a, d) => a + d.revenue, 0),
    profit: open.reduce((a, d) => a + d.profit, 0),
    rating: rated.length ? Math.round((rated.reduce((a, d) => a + d.rating, 0) / rated.length) * 10) / 10 : 0,
  };
}
