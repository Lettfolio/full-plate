/** Builds the opening state: lease deposit, fit-out, loan, starter menu, tables and opening stock. */
import {
  DIFFICULTY,
  OPENING_STOCK_PORTIONS,
  SAVE_VERSION,
  STARTING_POPULARITY,
  STARTING_PRESTIGE,
} from "./constants";
import { seedState } from "./rng";
import { addStock, purchaseCost } from "./stock";
import { newLoan } from "./systems/finance";
import type { Command, ContentPack, GameState, Stock, Table } from "./types";
import { monthOf } from "./util";

type NewGameCmd = Extract<Command, { type: "NEW_GAME" }>;

function starterTables(content: ContentPack): Table[] {
  return Array.from({ length: content.balance.startingTables }, (_, i) => ({
    id: `T${i + 1}`,
    seats: content.balance.seatsPerTable,
    dirtyTicks: 0,
  }));
}

function openingStock(content: ContentPack, costMult: number): { stock: Stock[]; cost: number } {
  let stock: Stock[] = [];
  let cost = 0;
  for (const ing of content.ingredients) {
    stock = addStock(stock, ing.id, OPENING_STOCK_PORTIONS, 0);
    cost += purchaseCost(ing, OPENING_STOCK_PORTIONS, monthOf(0), costMult);
  }
  return { stock, cost };
}

export function newGame(content: ContentPack, cmd: NewGameCmd): GameState {
  const district = content.districts.find((d) => d.id === cmd.districtId) ?? content.districts[0];
  if (!district) throw new Error("Content has no districts");
  const difficulty = DIFFICULTY[cmd.difficulty] ? cmd.difficulty : "normal";
  const b = content.balance;
  const costMult = DIFFICULTY[difficulty].costMult;
  const deposit = Math.round(district.monthlyRent * district.depositMonths * costMult);
  const opening = openingStock(content, costMult);
  const seed = cmd.seed >>> 0;
  const name = cmd.restaurantName.trim() || "The Full Plate";
  return {
    version: SAVE_VERSION,
    seed,
    rngState: seedState(seed),
    difficulty,
    day: 0,
    tick: 0,
    phase: "planning",
    restaurantName: name,
    districtId: district.id,
    cash: b.startingCash + b.loanPrincipal - b.fitOutCost - deposit - opening.cost,
    loan: newLoan(b.loanPrincipal, b.loanApr, b.loanTermDays),
    reputation: { popularity: STARTING_POPULARITY, prestige: STARTING_PRESTIGE },
    menu: [], // the player builds the menu in planning
    staff: [],
    tables: starterTables(content),
    stock: opening.stock,
    orders: [],
    customers: [],
    tickets: [],
    todays: { reviews: [] },
    history: [],
    footfallMods: [],
    log: [{ day: 0, tick: 0, text: `Welcome to ${name}!`, kind: "good" }],
    stats: { totalCovers: 0, totalRevenue: 0, daysOpen: 0 },
    eightySixed: [],
    hiredCandidates: [],
    distressDays: 0,
    eventHistory: [],
  };
}
