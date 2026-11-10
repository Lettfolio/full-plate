/**
 * Goal text and the scripted goal ladder, in one place so the content agent can move it to data later.
 * `{target}` in a title or hint is replaced with the goal's target. Rewards: cash in pence, popularity points.
 * Goals unlock a tier at a time: tier N+1 appears when every tier-N goal is done.
 */
import type { GoalKind, StaffRole } from "../types";

export interface GoalDef {
  id: string;
  kind: GoalKind;
  tier: number;
  title: string;
  hint: string;
  /** A number, or "tablesPlus2" = max(5, startingTables + 2) for the "have N tables" goal. */
  target: number | "tablesPlus2";
  role?: StaffRole;
  reward?: { cash?: number; popularity?: number };
}

export const GOAL_LADDER: readonly GoalDef[] = [
  // tier 0: get the doors open
  { id: "t0-dishes", kind: "add_dishes", tier: 0, target: 6, title: "Put {target} dishes on the menu", hint: "Menu tab: tap a dish to add it. Try a mix of mains, a starter, a pudding and a drink." },
  { id: "t0-chef", kind: "hire_role", role: "chef", tier: 0, target: 1, title: "Hire a chef", hint: "Staff tab: pick a chef. Better chefs cook tastier food, faster." },
  { id: "t0-server", kind: "hire_role", role: "server", tier: 0, target: 1, title: "Hire a server", hint: "Staff tab: pick a server. Charming servers keep guests happy and earn tips." },
  { id: "t0-stock", kind: "order_stock", tier: 0, target: 1, title: "Order some stock", hint: "Stock tab: orders arrive tomorrow morning. Your opening stock covers today." },
  { id: "t0-open", kind: "open_first_day", tier: 0, target: 1, title: "Open your doors", hint: "Press Open for service when you're ready.", reward: { popularity: 1 } },
  // tier 1: a good first week
  { id: "t1-covers", kind: "serve_covers", tier: 1, target: 30, title: "Serve {target} guests in one day", hint: "More tables and quick service mean more guests.", reward: { cash: 10_000 } },
  { id: "t1-rating", kind: "earn_rating", tier: 1, target: 4, title: "Get a {target}★ day", hint: "Good chefs, fresh stock and short waits make guests happy.", reward: { cash: 10_000, popularity: 1 } },
  { id: "t1-profit", kind: "profit_day", tier: 1, target: 1, title: "Make a profit in a day", hint: "Check the evening report: money in must beat money out.", reward: { cash: 15_000 } },
  { id: "t1-incident", kind: "resolve_incident", tier: 1, target: 1, title: "Sort out a problem during service", hint: "When something goes wrong in service, pick an option before time runs out.", reward: { cash: 10_000 } },
  // tier 2: a real business
  { id: "t2-week", kind: "profit_week", tier: 2, target: 1, title: "Make a profit over a whole week", hint: "Add up the last 7 days. Days off for staff need cover.", reward: { cash: 25_000, popularity: 2 } },
  { id: "t2-table", kind: "buy_table", tier: 2, target: 1, title: "Buy a new table", hint: "Restaurant tab. Worth it when people walk out because you're full.", reward: { cash: 15_000 } },
  { id: "t2-pop", kind: "reach_popularity", tier: 2, target: 60, title: "Reach popularity {target}", hint: "Happy guests tell their friends. Walk-outs don't help.", reward: { cash: 20_000 } },
  { id: "t2-survive", kind: "survive_days", tier: 2, target: 30, title: "Stay open for {target} days", hint: "Keep an eye on cash in the evening report.", reward: { cash: 25_000, popularity: 1 } },
  // tier 3: the long game
  { id: "t3-survive", kind: "survive_days", tier: 3, target: 90, title: "Stay open for {target} days", hint: "Winter is quieter: trim the rota if guests are few.", reward: { cash: 50_000, popularity: 3 } },
  { id: "t3-tables", kind: "buy_table", tier: 3, target: "tablesPlus2", title: "Have {target} tables", hint: "A bigger dining room means more guests at busy times.", reward: { cash: 30_000 } },
  { id: "t3-pop", kind: "reach_popularity", tier: 3, target: 75, title: "Reach popularity {target}", hint: "Keep ratings high, day after day.", reward: { cash: 30_000, popularity: 2 } },
  { id: "t3-streak", kind: "profit_day", tier: 3, target: 10, title: "Make a profit {target} days in a row", hint: "A steady team and a menu that sells. Watch your waste.", reward: { cash: 50_000, popularity: 3 } },
];

/** Log lines. */
export const GOAL_LINES = {
  completed: "Goal done: {title}.",
  reward: "Goal done: {title}. Reward: {reward}.",
} as const;
