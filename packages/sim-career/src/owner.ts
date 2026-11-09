/**
 * The AI owner: runs the employer's sim-core GameState through public commands only (menu, hiring, rota,
 * training, tables, stock, events, incidents). A re-implementation of sim-core's scripted headless owners
 * (headless.ts is not part of sim-core's public API) with three personalities from OWNERS.
 *
 * The player is a Staff member (id PLAYER_ID) the owner rosters from the player's shift plan. Inserting and
 * syncing that record is the one direct state edit the career layer makes (sim-core HIRE only hires from the
 * day's candidate pool).
 */
import type { Candidate, Command, ContentPack, DishDef, GameState, Staff, StaffRole } from "@full-plate/sim-core";
import { applyCommand, candidates, newGame, RECRUITMENT_FEE, suggestedOrder, tick, TRAINING_FEE, weekdayOf } from "@full-plate/sim-core";
import { ESTABLISHED_CASH, OWNER_CASH_FLOOR, OWNERS, SIM_MOOD_FLOOR, WARMUP_DAYS, type OwnerProfile } from "./constants";
import { rungDef } from "./ladder";
import { PLAYER_ID } from "./money";
import type { CareerState, CareerTrack, OwnerStrategy } from "./types";

type Step = (s: GameState, cmd: Command) => GameState;
type CoRole = "chef" | "server" | "bar" | "porter";

/** Applies commands in order and records the ones that changed state (rejected commands leave state as it was apart from the log). */
function recorder(content: ContentPack): { step: Step; issued: Command[] } {
  const issued: Command[] = [];
  const step: Step = (s, cmd) => {
    const r = applyCommand(content, s, cmd);
    const bad =
      r.events.some((e) => e.type === "LOG" && e.entry.kind === "bad") &&
      r.state.cash === s.cash && r.state.staff === s.staff && r.state.menu === s.menu && r.state.tables === s.tables && r.state.orders === s.orders;
    if (!bad) issued.push(cmd);
    return r.state;
  };
  return { step, issued };
}

// ── menu ──
function segmentAppeal(content: ContentPack, state: GameState, dish: DishDef): number {
  const district = content.districts.find((d) => d.id === state.districtId) ?? content.districts[0]!;
  return Object.entries(district.segmentMix).reduce((a, [seg, w]) => a + w * (dish.baseAppeal[seg] ?? 0), 0);
}

/** The owner's menu: best-appeal mains first, then the rest; premium owners lean to high quality-ceiling dishes. Bar starts get drinks to pour. */
export function chooseMenu(content: ContentPack, state: GameState, p: OwnerProfile, track: CareerTrack | undefined): { dishId: string; price: number }[] {
  const score = (d: DishDef) => segmentAppeal(content, state, d) * (1 + (p.qualityBias * (d.qualityCeiling - 60)) / 40);
  const cookable = content.dishes.filter((d) => d.skillRequired <= p.maxDishSkill);
  const pool = cookable.some((d) => d.course === "main") ? cookable : content.dishes;
  const by = (course: (d: DishDef) => boolean) => pool.filter(course).sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
  const mains = by((d) => d.course === "main");
  const drinks = by((d) => d.course === "drink");
  const others = by((d) => d.course !== "main" && d.course !== "drink");
  const nMains = Math.max(1, Math.ceil(p.menuSize / 2));
  const nDrinks = track === "bar" ? 3 : 1;
  const picks = [...mains.slice(0, nMains), ...drinks.slice(0, nDrinks), ...others].slice(0, p.menuSize + (track === "bar" ? 2 : 0));
  return picks.map((d) => ({ dishId: d.id, price: Math.round((d.suggestedPrice * p.priceMult) / 10) * 10 }));
}

// ── hiring ──
function scoreCandidate(c: Candidate, by: OwnerProfile["hireBy"]): number {
  const craft = c.role === "server" || c.role === "bar" ? c.charm : c.speed;
  if (by === "skill") return c.skill + craft / 2;
  if (by === "wage") return -c.wage + c.skill;
  return (c.skill + craft) / (c.wage / 1000);
}

/** `essential`: replacing a missing core role is attempted whenever sim-core's own cash check allows it. */
function hireRole(content: ContentPack, s: GameState, role: StaffRole, by: OwnerProfile["hireBy"], step: Step, essential: boolean): GameState {
  const pool = candidates(content, s)
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.role === role && !x.c.hired)
    .sort((a, b) => scoreCandidate(b.c, by) - scoreCandidate(a.c, by) || a.i - b.i);
  const best = pool[0];
  if (!best || (!essential && s.cash < OWNER_CASH_FLOOR + RECRUITMENT_FEE)) return s;
  return step(s, { type: "HIRE", candidateIndex: best.i });
}

function recentProfit(s: GameState, days: number): number {
  const h = s.history.slice(-days);
  return h.length ? h.reduce((a, d) => a + d.profit, 0) / h.length : 0;
}

/**
 * Co-workers the owner wants per role, as { base, total }. The player fills a slot of their own sim role: a waiter
 * is one of the servers. A commis works under a head chef, so the chef slot stays. Extra hands (cover for days off,
 * weekends) only while cash clears `extraCash` and the last fortnight paid; a bar start then also gets a senior
 * bartender to learn from.
 */
export function teamTarget(p: OwnerProfile, s: GameState, track: CareerTrack | undefined, playerRole?: StaffRole): Record<CoRole, { base: number; total: number }> {
  const extra = s.cash > p.extraCash && recentProfit(s, 14) >= 0;
  const want = {} as Record<CoRole, { base: number; total: number }>;
  for (const r of ["chef", "server", "bar", "porter"] as const) {
    let base = p.baseTeam[r] ?? 0;
    if (playerRole === r && r !== "chef") base = Math.max(0, base - 1);
    let more = extra ? p.extraTeam[r] ?? 0 : 0;
    if (track === "bar" && r === "bar" && extra) more += 1;
    want[r] = { base, total: base + more };
  }
  return want;
}

const coworkers = (s: GameState, role: StaffRole): Staff[] =>
  s.staff.filter((x) => x.role === role && x.id !== PLAYER_ID).sort((a, b) => a.hiredDay - b.hiredDay || a.id.localeCompare(b.id));

function staffing(content: ContentPack, s: GameState, p: OwnerProfile, track: CareerTrack | undefined, playerRole: StaffRole | undefined, step: Step): GameState {
  let cur = s;
  const want = teamTarget(p, cur, track, playerRole);
  for (const role of ["chef", "server", "bar", "porter"] as const) {
    const have = coworkers(cur, role).length;
    // The first chef working beside a commis is the head chef: hire on skill unless the owner is cheap.
    const by = role === "chef" && have === 0 && p.hireBy !== "wage" ? "skill" : p.hireBy;
    if (have < want[role].total) cur = hireRole(content, cur, role, by, step, have < want[role].base);
  }
  return cur;
}

// ── rotas ──
const FIVE_DAY: readonly boolean[] = [false, false, true, true, true, true, true]; // Wed–Sun
const SIX_DAY: readonly boolean[] = [false, true, true, true, true, true, true]; // Tue–Sun
const same = (a: readonly boolean[], b: readonly boolean[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The player's rota from their shift plan; today is off during a burnout or when the plan says no. */
export function playerRota(career: CareerState, simDay: number): boolean[] {
  const rota = career.shiftPlan.slice();
  if (career.burnoutUntil !== undefined && career.day < career.burnoutUntil) rota[weekdayOf(simDay)] = false;
  return rota;
}

function rotas(s: GameState, p: OwnerProfile, career: CareerState | undefined, step: Step): GameState {
  let cur = s;
  const profitable = recentProfit(cur, 14) >= 0;
  for (const role of ["chef", "server", "bar", "porter"] as const) {
    const team = coworkers(cur, role);
    const core = p.coreDays === 6 ? SIX_DAY : FIVE_DAY;
    team.forEach((m, i) => {
      // First of each role: the core rota. Others cover the core's days off, plus the weekend while it pays.
      const rota = i === 0 ? core.slice() : core.map((on, d) => !on || (profitable && d >= 4));
      if (!same(m.rota, rota)) cur = step(cur, { type: "SET_ROTA", staffId: m.id, rota });
    });
  }
  if (career) {
    const me = cur.staff.find((x) => x.id === PLAYER_ID);
    const rota = playerRota(career, cur.day);
    if (me && !same(me.rota, rota)) cur = step(cur, { type: "SET_ROTA", staffId: PLAYER_ID, rota });
  }
  return cur;
}

function isBusy(s: GameState): boolean {
  const recent = s.history.slice(-7);
  return recent.length >= 4 && recent.reduce((a, h) => a + h.walkouts, 0) / recent.length > 4;
}

/** Player record as sim-core Staff, built from the career (the career is the source of truth for stats and wage). */
export function playerStaff(career: CareerState, simDay: number, prev?: Staff): Staff {
  return {
    id: PLAYER_ID,
    name: career.playerName,
    role: career.role,
    skill: Math.round(career.stats.skill * 100) / 100,
    speed: Math.round(career.stats.speed * 100) / 100,
    charm: Math.round(career.stats.charm * 100) / 100,
    wage: career.wage,
    mood: Math.max(SIM_MOOD_FLOOR, Math.round(career.mood * 100) / 100),
    fatigue: Math.round(career.fatigue * 100) / 100,
    traits: [],
    hiredDay: prev?.hiredDay ?? simDay,
    potential: 100,
    rota: prev?.rota ?? playerRota(career, simDay),
    ...(prev?.trainingDay !== undefined ? { trainingDay: prev.trainingDay } : {}),
    ...(prev?.breakUntilTick !== undefined ? { breakUntilTick: prev.breakUntilTick } : {}),
  };
}

/** State edit: inserts or refreshes the player's Staff record. Returns the input when nothing changed. */
export function syncPlayer(career: CareerState, state: GameState): GameState {
  const prev = state.staff.find((s) => s.id === PLAYER_ID);
  const next = playerStaff(career, state.day, prev);
  if (prev && (Object.keys(next) as (keyof Staff)[]).every((k) => JSON.stringify(prev[k]) === JSON.stringify(next[k]))) return state;
  return { ...state, staff: prev ? state.staff.map((s) => (s.id === PLAYER_ID ? next : s)) : [...state.staff, next] };
}

/** True when the owner sends the player on a paid course today. */
export function wantsTraining(career: CareerState, state: GameState): boolean {
  const p = OWNERS[career.owner.strategy];
  if (!p.trainEveryDays) return false;
  const me = state.staff.find((s) => s.id === PLAYER_ID);
  if (!me || me.rota[weekdayOf(state.day)] !== true) return false;
  if (career.lastTrainedDay !== undefined && career.day - career.lastTrainedDay < p.trainEveryDays) return false;
  if (career.day < 7) return false;
  return state.cash > OWNER_CASH_FLOOR + TRAINING_FEE * 3;
}

/**
 * Planning-phase owner turn. Applies the owner's commands to `state` and returns the result plus the commands that
 * took effect (so a UI can show "the owner changed the rota"). `career` undefined = warm-up (no player yet).
 */
export function ownerPlanning(
  content: ContentPack,
  strategy: OwnerStrategy,
  state: GameState,
  career?: CareerState,
  /** Warm-up only: the role the joining player will fill (its slot is left open, the owner covers it meanwhile). */
  joiningRole?: StaffRole,
): { state: GameState; commands: Command[]; trained: boolean } {
  if (state.phase !== "planning") return { state, commands: [], trained: false };
  const p = OWNERS[strategy];
  const { step, issued } = recorder(content);
  let s = state;
  if (s.menu.length === 0) for (const m of chooseMenu(content, s, p, career?.track)) s = step(s, { type: "ADD_MENU_ITEM", ...m });
  s = staffing(content, s, p, career?.track, career?.role ?? joiningRole, step);
  s = rotas(s, p, career, step);
  if (isBusy(s) && s.cash > p.tableCash && s.tables.length < content.balance.maxTables) s = step(s, { type: "BUY_TABLE" });
  let trained = false;
  if (career && wantsTraining(career, s)) {
    const before = s;
    s = step(s, { type: "TRAIN", staffId: PLAYER_ID });
    trained = s !== before && s.staff.find((x) => x.id === PLAYER_ID)?.trainingDay === s.day;
  }
  return { state: s, commands: issued, trained };
}

/** Pure: the planning commands the owner would issue (same as ownerPlanning(...).commands). */
export function planOwnerDay(content: ContentPack, career: CareerState, state: GameState): Command[] {
  return ownerPlanning(content, career.owner.strategy, syncPlayer(career, state), career).commands;
}

/** Evening owner turn: tomorrow's stock (sim-core's forecast × the owner's appetite for stock). */
export function ownerEveningCommands(content: ContentPack, strategy: OwnerStrategy, state: GameState): Command[] {
  if (state.phase !== "evening" && state.phase !== "event") return [];
  const mult = OWNERS[strategy].stockMult;
  return suggestedOrder(content, state)
    .map((o) => ({ type: "ORDER_STOCK" as const, ingredientId: o.ingredientId, qty: Math.max(1, Math.round(o.qty * mult)) }))
    .filter((o) => o.qty > 0);
}

/** The owner's answer to the morning event card: first choice it can afford, else the last. */
export function ownerEventChoice(content: ContentPack, state: GameState): Command | undefined {
  const ev = content.events.find((e) => e.id === state.activeEvent?.eventId);
  if (state.phase !== "event") return undefined;
  if (!ev) return { type: "RESOLVE_EVENT", choiceId: "dismiss" };
  const affordable = ev.choices.find((c) => (c.effects.cash ?? 0) >= 0 || state.cash + (c.effects.cash ?? 0) > 500_000);
  return { type: "RESOLVE_EVENT", choiceId: (affordable ?? ev.choices.at(-1)!).id };
}

/** Commands that close the evening: the event answer, or END_DAY. */
export function closingCommand(content: ContentPack, state: GameState): Command | undefined {
  if (state.phase === "event") return ownerEventChoice(content, state);
  if (state.phase === "evening") return { type: "END_DAY" };
  return undefined;
}

/** During service: the owner's responses to live incidents (their personality's preference list). */
export function ownerIncidentResponses(content: ContentPack, strategy: OwnerStrategy, state: GameState): Command[] {
  const p = OWNERS[strategy];
  const out: Command[] = [];
  for (const inc of state.incidents ?? []) {
    if (inc.resolution) continue;
    const opt = (p.incidentPolicy[inc.kind] ?? [])
      .map((id) => inc.options.find((o) => o.id === id))
      .find((o) => o && !o.disabled && (o.cost ?? 0) <= p.maxIncidentSpend && (o.cost ?? 0) <= state.cash - OWNER_CASH_FLOOR);
    if (opt) out.push({ type: "RESPOND_INCIDENT", incidentId: inc.id, optionId: opt.id });
  }
  return out;
}

/** One whole service with the owner reacting to incidents as they start. */
export function runService(content: ContentPack, strategy: OwnerStrategy, s0: GameState): GameState {
  let s = s0.phase === "planning" ? applyCommand(content, s0, { type: "START_SERVICE" }).state : s0;
  while (s.phase === "service") {
    if ((s.incidents ?? []).some((i) => !i.resolution)) for (const cmd of ownerIncidentResponses(content, strategy, s)) s = applyCommand(content, s, cmd).state;
    s = tick(content, s).state;
  }
  return s;
}

/** Evening → next planning (stock, then the event or END_DAY). */
export function ownerCloseDay(content: ContentPack, strategy: OwnerStrategy, s0: GameState): GameState {
  let s = s0;
  for (const cmd of ownerEveningCommands(content, strategy, s)) s = applyCommand(content, s, cmd).state;
  const close = closingCommand(content, s);
  return close ? applyCommand(content, s, close).state : s;
}

/** Content for newGame of an established employer: no loan, the fit-out and deposit already paid, ESTABLISHED_CASH in hand. */
export function establishedPack(content: ContentPack, districtId: string): ContentPack {
  const d = content.districts.find((x) => x.id === districtId) ?? content.districts[0]!;
  const b = content.balance;
  return { ...content, balance: { ...b, loanPrincipal: 0, startingCash: b.fitOutCost + d.monthlyRent * d.depositMonths + ESTABLISHED_CASH } };
}

export interface EmployerSpec {
  seed: number;
  districtId: string;
  strategy: OwnerStrategy;
  restaurantName: string;
  difficulty?: GameState["difficulty"];
  /** Track and rung of the player about to join (bar starts get a drinks list; their slot is kept for them). */
  track?: CareerTrack;
  rung?: number;
}

/**
 * A running restaurant to work at: sim-core newGame, the owner's menu and team, then WARMUP_DAYS of trading so the
 * player joins an established place. Returns the state in the planning phase of the player's first day.
 */
export function newEmployer(content: ContentPack, spec: EmployerSpec): GameState {
  let s = newGame(establishedPack(content, spec.districtId), { type: "NEW_GAME", seed: spec.seed, districtId: spec.districtId, restaurantName: spec.restaurantName, difficulty: spec.difficulty ?? "normal" });
  const p = OWNERS[spec.strategy];
  const { step } = recorder(content);
  for (const m of chooseMenu(content, s, p, spec.track)) s = step(s, { type: "ADD_MENU_ITEM", ...m });
  for (let d = 0; d < WARMUP_DAYS && s.phase !== "gameover"; d++) {
    s = ownerPlanning(content, spec.strategy, s, undefined, spec.track ? rungDef(spec.track, spec.rung ?? 0).simRole : undefined).state;
    s = runService(content, spec.strategy, s);
    s = ownerCloseDay(content, spec.strategy, s);
  }
  return s;
}

/** Sim role of a career at a rung (re-exported for callers building a player record). */
export const simRoleOf = (track: CareerTrack, rung: number): StaffRole => rungDef(track, rung).simRole;
