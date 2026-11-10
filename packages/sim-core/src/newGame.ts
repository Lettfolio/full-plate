/**
 * Builds the opening state: lease deposit, fit-out, loan, tables and the first goals. The larder starts empty:
 * the opening stock allowance (BalanceDef.openingStockBudget) is spent at the first START_SERVICE (forecast.ts).
 */
import {
  DIFFICULTY,
  SAVE_VERSION,
  STARTING_POPULARITY,
  STARTING_PRESTIGE,
} from "./constants";
import { seedState } from "./rng";
import { goalsForTier } from "./systems/goals";
import { newLoan } from "./systems/finance";
import { candidates, staffFromCandidate } from "./staff";
import type { Command, ContentPack, GameState, Table } from "./types";

type NewGameCmd = Extract<Command, { type: "NEW_GAME" }>;

function starterTables(content: ContentPack): Table[] {
  return Array.from({ length: content.balance.startingTables }, (_, i) => ({
    id: `T${i + 1}`,
    seats: content.balance.seatsPerTable,
    dirtyTicks: 0,
  }));
}

/**
 * Round 11 (G2): the brief's "two staff and a bank loan" — with `starterChef` the restaurant opens with one chef already
 * hired: day 0's best-value chef candidate ((skill + speed) per pound of wage, ties to the lower index), no agency fee.
 * Their "Hire a chef" goal is already done (quietly: nothing to celebrate). Candidates are seeded per day, so the RNG
 * stream is untouched.
 */
function withStarterChef(content: ContentPack, s: GameState): GameState {
  const pool = candidates(content, s).map((c, i) => ({ c, i })).filter((x) => x.c.role === "chef");
  const best = pool.sort((a, b) => (b.c.skill + b.c.speed) / b.c.wage - (a.c.skill + a.c.speed) / a.c.wage || a.i - b.i)[0];
  const staff = best && staffFromCandidate(content, s, best.i);
  if (!best || !staff) return s;
  const goals = s.goals?.map((g) => (g.kind === "hire_role" && g.role === "chef" ? { ...g, progress: g.target, done: true } : g));
  return { ...s, staff: [staff], hiredCandidates: [best.i], ...(goals ? { goals } : {}), log: [...s.log, { day: 0, tick: 0, text: `${staff.name} is your first chef.`, kind: "good" }] };
}

export function newGame(content: ContentPack, cmd: NewGameCmd): GameState {
  const s = openingState(content, cmd);
  return cmd.starterChef ? withStarterChef(content, s) : s;
}

function openingState(content: ContentPack, cmd: NewGameCmd): GameState {
  const district = content.districts.find((d) => d.id === cmd.districtId) ?? content.districts[0];
  if (!district) throw new Error("Content has no districts");
  const difficulty = DIFFICULTY[cmd.difficulty] ? cmd.difficulty : "normal";
  const b = content.balance;
  const costMult = DIFFICULTY[difficulty].costMult;
  const deposit = Math.round(district.monthlyRent * district.depositMonths * costMult);
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
    cash: b.startingCash + b.loanPrincipal - b.fitOutCost - deposit,
    loan: newLoan(b.loanPrincipal, b.loanApr, b.loanTermDays),
    reputation: { popularity: STARTING_POPULARITY, prestige: STARTING_PRESTIGE },
    menu: [], // the player builds the menu in planning
    staff: [],
    tables: starterTables(content),
    stock: [],
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
    incidents: [],
    goals: goalsForTier(content, 0),
    ownerFatigue: 0,
    incidentsHandled: 0,
  };
}
