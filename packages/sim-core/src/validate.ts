/**
 * Round 11: the GameState schema for loaded saves (red-team S1/S3). `validateGameState(raw)` type-checks every field,
 * bounds every number and list, strips unsafe characters from names and drops unknown top-level keys; it throws a
 * SchemaError when the save can't be a real game. The game applies it wherever a save comes in (state/saveCheck.ts):
 * a save file, the account copy, the device cache and parked Empire sites.
 *
 * Bounds are wide on purpose (a real save must always pass; docs/SAVES.md lists the ones widened for the corpus): the
 * point is that every value has the type the sim expects, is finite, and every list has a ceiling.
 */
import { HISTORY_MAX, LOG_MAX, MAX_STAFF } from "./constants";
import {
  anyJson, arr, BIG, bool, day, DAYS, id, int, money, MONEY, name, num, obj, oneOf, opt, pct100, rec, rngState, str, text,
  type Check,
} from "./schema";
import type { GameState } from "./types";

const ROLES = ["chef", "server", "bar", "porter", "manager"] as const;
const role = oneOf(...ROLES);
const n = num();
const qty = num(-1, 1e9);
const tick = num(-1000, DAYS);

const review = obj({ day, source: oneOf("walkin", "online", "critic", "wordofmouth"), rating: num(0, 5), text, dishId: opt(id), quality: opt(n) });

const staff = obj({
  id, name: name(40), role,
  skill: pct100, speed: pct100, charm: pct100,
  wage: num(0, 1e8), mood: pct100, fatigue: pct100,
  traits: arr(id, 30), hiredDay: day, potential: pct100,
  rota: arr(bool, 7),
  trainingDay: opt(day), breakUntilTick: opt(tick),
  tracks: opt(rec(num(0, 100), 10, oneOf("knife", "plating", "charm", "pass"))),
  trainingTrack: opt(oneOf("knife", "plating", "charm", "pass")),
  moodWhy: opt(obj({ text, delta: n })),
});

const menuItem = obj({ dishId: id, price: num(0, MONEY), active: bool, sold7d: opt(n), margin7d: opt(money), recent: opt(arr(obj({ sold: n, margin: money }), 60)) });

const dayResult = (partial: boolean) => {
  const f = <T,>(c: Check<T>) => (partial ? opt(c) : c);
  return obj({
    closed: opt(bool),
    perDish: opt(rec(obj({ sold: n, plated: n, qualityMean: n, revenue: money, foodCost: money }), 1000)),
    perChef: opt(rec(obj({ plates: n, qualityMean: n }), 100)),
    freshnessMean: opt(n),
    decor: opt(anyJson),
    incidents: opt(arr(obj({ kind: id, resolution: text, outcome: text }), 500)),
    ownerCovered: opt(arr(role, 10)),
    day: f(day), covers: f(n), walkouts: f(n),
    revenue: f(money), tips: f(money), foodCost: f(money), labourCost: f(money), rent: f(money), loanPayment: f(money),
    overheads: opt(money), vat: opt(money), incidentCosts: opt(money),
    waste: f(obj({ prep: money, plate: money, spoil: money })),
    spoiled: opt(rec(obj({ qty, cost: money }), 1000)),
    profit: f(money), averageSpend: f(money), averageRating: f(num(0, 5)),
    bestDish: opt(id), worstDish: opt(id),
    popularityDelta: f(n), prestigeDelta: f(n),
    reviews: partial ? arr(review, 2000) : opt(arr(review, 2000)),
    staffMoodDelta: f(rec(n, 200)),
  });
};

const customer = obj({
  id, segment: id, partySize: num(0, 100), arrivedTick: tick,
  stage: oneOf("queue", "seated", "ordered", "eating", "paying", "left"),
  tableId: opt(id), order: arr(id, 200), patience: n, satisfaction: n, spend: money, tip: money,
  walkedOut: opt(bool), stageTick: opt(tick), platesReady: opt(n), qualitySum: opt(n), servedTick: opt(tick), eatUntil: opt(tick),
  leftTick: opt(tick), foodCost: opt(money), comped: opt(bool), rating: opt(n), satisfactionBonus: opt(n), vip: opt(bool),
  setMenu: opt(bool), courseOut: opt(bool), dueTick: opt(tick),
});

const ticket = obj({
  id, customerId: id, dishId: id, createdTick: tick, ticksRemaining: n, chefId: opt(id), quality: n,
  freshness: opt(n), remakeOf: opt(n), atPass: opt(bool), platedAtTick: opt(tick), claimedAtTick: opt(tick),
});

const incident = obj({
  id, kind: id, startedTick: tick, ticksLeft: n, title: text, body: text,
  options: arr(obj({ id, label: text, description: text, cost: opt(money), disabled: opt(text) }), 20),
  customerId: opt(id), tableId: opt(id), staffId: opt(id), dishId: opt(id), value: opt(n), resolution: opt(text), outcome: opt(text),
});

const goal = obj({
  id, kind: id, title: text, hint: text, target: n, progress: n, done: bool,
  reward: opt(obj({ cash: opt(money), popularity: opt(n) })), tier: n, role: opt(role),
});

const service = obj({
  parties: n, ratingSum: n, satisfactionSum: n, ratedCovers: n, qualitySum: n, plates: n,
  dishes: rec(obj({ sold: n, plated: n, qualitySum: n, margin: money, revenue: opt(money), foodCost: opt(money) }), 1000),
  potentialParties: n,
  arrivals: arr(obj({ segment: id, potentialParties: n, entryLogit: n }), 100),
  nextCustomer: n, nextTicket: n, actionsPerTick: n, actionsLeft: n,
  plateWaste: money, walkoutParties: n, serverTips: money,
  ingredientsUsed: rec(n, 2000),
  paid: arr(obj({ segment: id, partySize: n, rating: n, quality: n, dishId: opt(id) }), 20_000),
  mods: opt(arr(obj({ kind: oneOf("actions", "kitchen", "arrivals"), value: n, untilTick: tick, source: opt(id) }), 500)),
  chefs: opt(rec(obj({ plates: n, qualitySum: n }), 100)),
});

const loan = obj({ principal: money, remaining: money, dailyPayment: money, daysRemaining: n });
const reputation = obj({ popularity: pct100, prestige: pct100 });
const table = obj({ id, seats: num(0, 1000), occupiedBy: opt(id), dirtyTicks: n });
const stats = obj({ totalCovers: n, totalRevenue: money, daysOpen: n });
const setMenu = obj({ dishIds: arr(id, 200), price: num(0, MONEY), active: bool });
const decor = obj({
  slots: rec(obj({ itemId: id, since: day }), 50),
  pending: opt(arr(obj({ slot: id, itemId: id, paid: money, tables: n }), 100)),
  fitting: opt(obj({ day, tables: n, slots: arr(id, 50) })),
});

const gameState = obj<GameState>({
  version: oneOf(1),
  seed: num(-BIG, BIG),
  rngState,
  difficulty: oneOf("cosy", "normal", "hard"),
  day: int(0, DAYS),
  tick: num(0, DAYS),
  phase: oneOf("planning", "service", "evening", "event", "gameover"),
  restaurantName: name(40),
  districtId: id,
  cash: int(-MONEY, MONEY),
  loan,
  reputation,
  menu: arr(menuItem, 500),
  staff: arr(staff, MAX_STAFF),
  tables: arr(table, 500),
  stock: arr(obj({ ingredientId: id, qty, oldestDay: day, batches: opt(arr(obj({ qty, day, cost: opt(money) }), 5000)) }), 2000),
  orders: arr(obj({ ingredientId: id, qty, cost: money }), 5000),
  customers: arr(customer, 20_000),
  tickets: arr(ticket, 50_000),
  todays: dayResult(true),
  history: arr(dayResult(false), HISTORY_MAX),
  activeEvent: opt(obj({ eventId: id, chosen: opt(id) })),
  footfallMods: arr(obj({ mult: num(0, 1000), daysRemaining: n, source: opt(id) }), 1000),
  log: arr(obj({ day, tick, text, kind: oneOf("info", "good", "bad", "money") }), LOG_MAX * 5),
  stats,
  eightySixed: opt(arr(id, 1000)),
  hiredCandidates: opt(arr(int(0, 1000), 1000)),
  distressDays: opt(n),
  starterLoan: opt(bool),
  service: opt(service),
  eventHistory: opt(arr(obj({ eventId: id, day }), 1000)),
  gameOverReason: opt(text),
  incidents: opt(arr(incident, 1000)),
  goals: opt(arr(goal, 500)),
  ownerCovering: opt(arr(role, 10)),
  ownerFatigue: opt(pct100),
  shortDelivery: opt(obj({ ingredientId: id, missing: qty })),
  incidentsHandled: opt(n),
  handsOn: opt(obj({ role, since: tick, staffId: opt(id), station: opt(obj({ dishIds: arr(id, 200), cap: num(0, 1000), coverTicks: opt(n) })) })),
  setMenu: opt(setMenu),
  ownerProfile: opt(obj({ skill: pct100, speed: pct100, charm: pct100 })),
  recruitmentFee: opt(money),
  adviceLog: opt(rec(obj({ day, count: n, subject: str(400) }), 50)),
  decor: opt(decor),
}, false);

/** Shared with sim-career (a relationship keeps a Staff snapshot; a week keeps its DayResults). */
export const staffSchema = staff;
export const dayResultSchema = dayResult(false);
/** Round 11 review: the GameState pieces an Empire's parked site keeps (sim-empire validateParkedSite). */
export { HISTORY_MAX, MAX_STAFF };
export const gameStateParts = { menuItem, staff, table, loan, reputation, stats, decor, setMenu, dayResult: dayResultSchema };

/** A loaded GameState, checked and cleaned (throws SchemaError). */
export function validateGameState(raw: unknown): GameState {
  return gameState(raw, "game");
}
