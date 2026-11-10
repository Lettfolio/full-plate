/**
 * Round 12 (G): what a visit draws, built from a friend's (already checked) snapshot.
 *
 * The floor renderer takes a GameState, so the visit makes a throwaway one: a fresh `newGame` (fixed seed, never saved,
 * never ticked) with the friend's tables, decor, menu, staff and name laid over it. It only feeds the canvas's empty-room
 * preview; nothing here reaches the visitor's own game or the sim's RNG.
 */
import type { GameState, Staff } from "@full-plate/sim-core";
import { content, findDecorItem, newGame } from "../sim";
import type { ShareSnapshot } from "../state/share";

/** Content lookups `checkSnapshot` filters ids against. */
export const known = {
  dish: (id: string) => content.dishes.some((d) => d.id === id),
  decor: (id: string) => !!findDecorItem(content, id),
  district: (id: string) => content.districts.some((d) => d.id === id),
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
