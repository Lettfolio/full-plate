/** Test helpers: build states quickly without going through the UI flow. */
import { applyCommand, candidates, newGame, tick } from "../src/index";
import { Rng } from "../src/rng";
import { addStock } from "../src/stock";
import { newCustomer } from "../src/systems/arrival";
import type { Command, ContentPack, Customer, GameState, Staff } from "../src/types";
import { emptyTally } from "../src/util";
import { fixtureContent } from "./fixtureContent";

export const C: ContentPack = fixtureContent;

export function fresh(seed = 1, difficulty: GameState["difficulty"] = "normal"): GameState {
  return newGame(C, { type: "NEW_GAME", seed, districtId: "highstreet", restaurantName: "Test Kitchen", difficulty });
}

export function step(state: GameState, ...cmds: Command[]): GameState {
  return cmds.reduce((s, cmd) => applyCommand(C, s, cmd).state, state);
}

/** `qty` portions of every fixture ingredient (delivered on the state's day, base unit cost). */
export function stocked(s: GameState, qty = 40): GameState {
  let stock = s.stock;
  for (const ing of C.ingredients) stock = addStock(stock, ing.id, qty, s.day, ing.unitCost);
  return { ...s, stock };
}

/**
 * A playable restaurant: full menu at suggested prices, one chef and one server hired, and (unlike a real new game,
 * which buys opening stock at the first START_SERVICE) 40 portions of everything in the larder for unit tests.
 */
export function ready(seed = 1, difficulty: GameState["difficulty"] = "normal"): GameState {
  return stocked(readyEmpty(seed, difficulty));
}

/** As `ready`, but with the empty larder a new game really starts with. */
export function readyEmpty(seed = 1, difficulty: GameState["difficulty"] = "normal"): GameState {
  let s = fresh(seed, difficulty);
  for (const d of C.dishes) s = step(s, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice });
  const pool = candidates(C, s);
  s = step(s, { type: "HIRE", candidateIndex: pool.findIndex((c) => c.role === "chef") });
  s = step(s, { type: "HIRE", candidateIndex: pool.findIndex((c) => c.role === "server") });
  return s;
}

/** Puts a state into service with an empty tally and `actions` FOH actions available (for system unit tests). */
export function inService(s: GameState, actions = 3): GameState {
  return { ...s, phase: "service", tick: 10, customers: [], tickets: [], service: { ...emptyTally(), actionsPerTick: actions, actionsLeft: actions } };
}

export function customer(id: string, over: Partial<Customer> = {}): Customer {
  return { ...newCustomer(id, C.segments[0]!, 2, 0), ...over };
}

export function staffMember(over: Partial<Staff> = {}): Staff {
  return {
    id: "s-test",
    name: "Test",
    role: "chef",
    skill: 60,
    speed: 60,
    charm: 50,
    wage: 1300,
    mood: 70,
    fatigue: 0,
    traits: [],
    hiredDay: 0,
    potential: 80,
    rota: [true, true, true, true, true, true, true],
    ...over,
  };
}

export const rng = (seed = 42) => Rng.fromSeed(seed);

/** Plays `days` full days with a crude restock so the kitchen never runs dry. */
export function playDays(s0: GameState, days: number): GameState {
  let s = s0;
  for (let d = 0; d < days && s.phase !== "gameover"; d++) {
    if (s.phase === "event") {
      const ev = C.events.find((e) => e.id === s.activeEvent?.eventId)!;
      s = step(s, { type: "RESOLVE_EVENT", choiceId: ev.choices.at(-1)!.id });
    }
    s = applyCommand(C, s, { type: "START_SERVICE" }).state;
    while (s.phase === "service") s = tickOnce(s);
    if (s.phase === "evening") {
      for (const ing of C.ingredients) {
        const have = s.stock.find((x) => x.ingredientId === ing.id)?.qty ?? 0;
        if (have < 120) s = step(s, { type: "ORDER_STOCK", ingredientId: ing.id, qty: 150 - Math.floor(have) });
      }
      s = step(s, { type: "END_DAY" });
    }
  }
  return s;
}

export const tickOnce = (s: GameState): GameState => tick(C, s).state;
