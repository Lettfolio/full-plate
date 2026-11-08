/**
 * Round-2 fixture state: a real sim-core game (real content) mid-service, with incidents, goals and
 * owner coverage written in by hand. This is a *fixture*, not a fake sim: every transition in the
 * tests still goes through the real applyCommand / tick.
 */
import type { GameState, Goal, Incident } from "@full-plate/sim-core";
import { content, newGame } from "../../sim";

export function baseGame(seed = 4242): GameState {
  return newGame(content, { type: "NEW_GAME", seed, districtId: content.districts[0]!.id, restaurantName: "Fixture Kitchen", difficulty: "normal" });
}

export const GOALS: Goal[] = [
  { id: "g-menu", kind: "add_dishes", title: "Put 6 dishes on the menu", hint: "Menu tab → add dishes", target: 6, progress: 2, done: false, tier: 0, reward: { cash: 5000 } },
  { id: "g-chef", kind: "hire_role", title: "Hire a chef", hint: "Staff tab → Looking for work", target: 1, progress: 0, done: false, tier: 0 },
  { id: "g-open", kind: "open_first_day", title: "Open your doors", hint: "Open for service →", target: 1, progress: 0, done: false, tier: 0, reward: { popularity: 2 } },
  { id: "g-stock", kind: "order_stock", title: "Order tomorrow's stock", hint: "Evening → Restock", target: 1, progress: 1, done: true, tier: 0, reward: { cash: 2000 } },
  { id: "g-50", kind: "serve_covers", title: "Serve 50 guests", hint: "Keep the queue moving", target: 50, progress: 0, done: false, tier: 1, reward: { cash: 10000, popularity: 3 } },
  { id: "g-sv", kind: "serve_covers", title: "Hidden higher tier", hint: "", target: 1, progress: 0, done: false, tier: 0 },
];

export function sentBack(over: Partial<Incident> = {}): Incident {
  return {
    id: "inc-1",
    kind: "sent_back",
    startedTick: 30,
    ticksLeft: 6,
    title: "Plate sent back",
    body: "Table 3 says the fish is cold.",
    options: [
      { id: "remake", label: "Remake it", description: "Chef loses a few minutes; they'll be happy." },
      { id: "comp", label: "Comp the plate", description: "Free plate, big smile.", cost: 1450 },
      { id: "apologise", label: "Apologise", description: "Depends on your server's charm." },
    ],
    tableId: "t3",
    ...over,
  };
}

/** A game in service with one live incident and goals. Customers/tables come from the real sim. */
export function serviceWithIncident(game: GameState): GameState {
  return { ...game, incidents: [sentBack({ startedTick: Math.max(0, game.tick - 2), tableId: game.tables[2]?.id ?? "t3" })], goals: GOALS, ownerCovering: ["chef"] };
}
