/**
 * Leaving to open your own place. `openingBudget` says what it costs; `handoverToOwner` builds the player's own
 * restaurant with sim-core `newGame` (savings become starting cash, a bank loan sized to the savings) and applies
 * the carry-over perks using only public sim-core commands and existing GameState fields:
 *
 * - colleague (all starts; chef starts look for their old head chef): their Staff record is added on day 1 at a
 *   wage discount and with no recruitment fee — a direct `staff` edit (HIRE only takes today's candidates).
 * - drinks_menu (bar start): the best-margin drinks go on the menu via ADD_MENU_ITEM, priced up.
 * - hire_rebate (manager start): `applyWithPerks` wraps applyCommand and refunds part of RECRUITMENT_FEE on the
 *   next few HIREs (a cash edit). A per-game recruitment fee would need a sim-core hook.
 * - regulars (waiter start): a `footfallMods` entry (regulars follow you for six weeks).
 * - reputation (all): popularity/prestige head start from industry reputation (a `reputation` edit).
 * - owner_skills (all): needs a sim-core hook — the owner's cover stats are the OWNER constant.
 */
import type { Command, ContentPack, DistrictId, GameState, StepResult } from "@full-plate/sim-core";
import { applyCommand, newGame, RECRUITMENT_FEE } from "@full-plate/sim-core";
import {
  BAR_DRINK_PRICE_MULT,
  BAR_DRINKS,
  COLLEAGUE_DISCOUNT_BASE,
  COLLEAGUE_DISCOUNT_MAX,
  COLLEAGUE_DISCOUNT_PER_BOND,
  COLLEAGUE_MIN_BOND,
  LADDER,
  LOAN_TO_SAVINGS,
  MANAGER_HIRE_REBATE_SHARE,
  MANAGER_HIRE_REBATES,
  NLW,
  OPEN_RUNG,
  OPENING_RESERVE,
  REPUTATION_TO_POPULARITY,
  REPUTATION_TO_PRESTIGE,
  WAITER_REGULARS,
} from "./constants";
import { clamp, pounds, rungDef } from "./ladder";
import type { CareerState, HandoverPerk, HandoverSummary, OpeningBudget, OwnerPerks, Relationship } from "./types";

/** What opening in a district costs and how much of it savings must cover. */
export function openingBudget(content: ContentPack, career: CareerState, districtId?: DistrictId): OpeningBudget {
  const d = content.districts.find((x) => x.id === districtId) ?? cheapestDistrict(content);
  const fitOut = content.balance.fitOutCost;
  const deposit = d.monthlyRent * d.depositMonths;
  const reserve = OPENING_RESERVE;
  const loan = loanFor(content, career.savings);
  const needed = fitOut + deposit + reserve;
  // Smallest savings s with s + min(cap, k·s) ≥ needed.
  const cap = content.balance.loanPrincipal;
  const savingsNeeded = Math.max(0, Math.ceil(Math.max(needed - cap, needed / (1 + LOAN_TO_SAVINGS))));
  const shortfall = Math.max(0, savingsNeeded - career.savings);
  const rungNeeded = LADDER[career.track][OPEN_RUNG[career.track]]!.title;
  return { districtId: d.id, fitOut, deposit, reserve, loan, savingsNeeded, shortfall, rungOk: career.rung >= OPEN_RUNG[career.track], rungNeeded };
}

/** The bank lends up to LOAN_TO_SAVINGS × savings, capped at the content's standard loan. */
export const loanFor = (content: ContentPack, savings: number): number =>
  Math.max(0, Math.min(content.balance.loanPrincipal, Math.round(savings * LOAN_TO_SAVINGS)));

export function cheapestDistrict(content: ContentPack) {
  return [...content.districts].sort((a, b) => a.monthlyRent * a.depositMonths - b.monthlyRent * b.depositMonths || a.id.localeCompare(b.id))[0]!;
}

/** True when the rung allows it and savings + the loan cover fit-out, deposit and the reserve somewhere. */
export function canOpenOwn(content: ContentPack, career: CareerState): boolean {
  const b = openingBudget(content, career);
  return b.rungOk && b.shortfall === 0 && !career.handover;
}

/** The colleague who'd follow you: your old head chef if you liked them, else your best bond (≥ COLLEAGUE_MIN_BOND). */
export function pickColleague(career: CareerState): Relationship | undefined {
  const ok = career.relationships.filter((r) => r.bond >= COLLEAGUE_MIN_BOND && r.snapshot.role !== "porter");
  const byBond = (a: Relationship, b: Relationship) => b.bond - a.bond || a.staffId.localeCompare(b.staffId);
  const chefs = ok.filter((r) => r.wasHeadChef).sort(byBond);
  if (career.track === "chef" && chefs[0]) return chefs[0];
  return [...ok].sort(byBond)[0];
}

export const colleagueDiscount = (bond: number): number =>
  clamp(COLLEAGUE_DISCOUNT_BASE + bond * COLLEAGUE_DISCOUNT_PER_BOND, COLLEAGUE_DISCOUNT_BASE, COLLEAGUE_DISCOUNT_MAX);

/** Best-margin drinks for a bar start's opening list. */
export function barDrinks(content: ContentPack): { dishId: string; price: number }[] {
  const cost = new Map(content.ingredients.map((i) => [i.id, i.unitCost]));
  // Pence of margin per serve: wine and cocktails beat squash (what a bar person knows how to sell).
  const margin = (d: (typeof content.dishes)[number]) => d.suggestedPrice - d.ingredients.reduce((a, x) => a + (cost.get(x.id) ?? 0) * x.qty, 0);
  return content.dishes
    .filter((d) => d.course === "drink")
    .sort((a, b) => margin(b) - margin(a) || a.id.localeCompare(b.id))
    .slice(0, BAR_DRINKS)
    .map((d) => ({ dishId: d.id, price: Math.round((d.suggestedPrice * BAR_DRINK_PRICE_MULT) / 10) * 10 }));
}

export interface HandoverOptions {
  districtId?: DistrictId;
  restaurantName?: string;
  difficulty?: GameState["difficulty"];
  /** Day of the handover (career day); defaults to career.day. */
  day?: number;
}

export interface HandoverResult {
  state: GameState;
  /** One line per perk (the ROUND3 contract). */
  perks: string[];
  summary: HandoverSummary;
  ownerPerks: OwnerPerks;
}

/**
 * Builds the player's own restaurant. Pure; does not check canOpenOwn (OPEN_OWN_PLACE does), so the UI can preview
 * the perks at any time. `employer` (the current employer state) refreshes the colleague's record if they still work there.
 */
export function handoverToOwner(content: ContentPack, career: CareerState, employer?: GameState, opts: HandoverOptions = {}): HandoverResult {
  const budget = openingBudget(content, career, opts.districtId);
  const loan = budget.loan;
  const name = opts.restaurantName?.trim() || `${career.playerName.split(" ")[0]}'s`;
  // newGame takes its starting cash and loan from the content pack: a derived pack carries the player's savings.
  const pack: ContentPack = { ...content, balance: { ...content.balance, startingCash: career.savings, loanPrincipal: loan } };
  let s = newGame(pack, { type: "NEW_GAME", seed: career.seed ^ 0x0a11, districtId: budget.districtId, restaurantName: name, difficulty: opts.difficulty ?? "normal" });
  const perks: HandoverPerk[] = [];
  const step = (st: GameState, cmd: Command) => applyCommand(content, st, cmd).state;

  perks.push({ id: "savings", label: "Your savings", detail: `${pounds(career.savings)} saved, plus a ${pounds(loan)} bank loan.`, via: "command" });

  // Colleague
  let colleague: HandoverSummary["colleague"];
  const rel = pickColleague(career);
  if (rel) {
    const live = employer?.staff.find((x) => x.id === rel.staffId && rel.current) ?? rel.snapshot;
    const discountPct = Math.round(colleagueDiscount(rel.bond) * 100) / 100;
    const wage = Math.max(NLW, Math.round(live.wage * (1 - discountPct)));
    const { trainingDay: _t, breakUntilTick: _b, ...base } = live;
    const hired = { ...base, id: `alumni-${rel.staffId}`, wage, mood: 78, fatigue: 0, hiredDay: 0, rota: [false, false, true, true, true, true, true] };
    s = { ...s, staff: [...s.staff, hired] };
    colleague = { staffId: hired.id, name: hired.name, role: hired.role, wage, discountPct };
    const who = rel.wasHeadChef ? `Your old head chef ${hired.name}` : `${hired.name} (${hired.role})`;
    perks.push({ id: "colleague", label: rel.wasHeadChef ? "Old head chef joins" : "A friend joins", detail: `${who} starts on day 1 at ${Math.round(discountPct * 100)}% below their old wage, no agency fee.`, via: "state" });
  }

  // Track perks
  let hireRebates = 0;
  const hireRebateEach = Math.round(RECRUITMENT_FEE * MANAGER_HIRE_REBATE_SHARE);
  if (career.track === "bar") {
    const drinks = barDrinks(content);
    for (const d of drinks) s = step(s, { type: "ADD_MENU_ITEM", dishId: d.dishId, price: d.price });
    const names = drinks.map((d) => content.dishes.find((x) => x.id === d.dishId)?.name ?? d.dishId);
    perks.push({ id: "drinks_menu", label: "A better drinks list", detail: `${names.join(", ")} go on the menu at ${Math.round((BAR_DRINK_PRICE_MULT - 1) * 100)}% above the usual price: you know how to sell them.`, via: "command" });
  }
  if (career.track === "manager" || (career.track === "waiter" && career.rung >= 2) || (career.track === "bar" && career.rung >= 3)) {
    hireRebates = MANAGER_HIRE_REBATES;
    perks.push({ id: "hire_rebate", label: "Cheaper hiring", detail: `You know people: your first ${hireRebates} hires cost ${pounds(RECRUITMENT_FEE - hireRebateEach)} instead of ${pounds(RECRUITMENT_FEE)}.`, via: "wrapper" });
  }
  if (career.track === "waiter") {
    s = { ...s, footfallMods: [...s.footfallMods, { ...WAITER_REGULARS }] };
    perks.push({ id: "regulars", label: "Your regulars follow you", detail: `+${Math.round((WAITER_REGULARS.mult - 1) * 100)}% passing trade for the first ${WAITER_REGULARS.daysRemaining} days.`, via: "state" });
  }

  // Reputation
  const pop = Math.round(career.reputation * REPUTATION_TO_POPULARITY * 100) / 100;
  const pres = Math.round(career.reputation * REPUTATION_TO_PRESTIGE * 100) / 100;
  if (pop > 0 || pres > 0) {
    s = { ...s, reputation: { popularity: clamp(s.reputation.popularity + pop, 0, 100), prestige: clamp(s.reputation.prestige + pres, 0, 100) } };
    perks.push({ id: "reputation", label: "People know your name", detail: `Popularity +${pop.toFixed(1)}, prestige +${pres.toFixed(1)} from your industry reputation.`, via: "state" });
  }
  perks.push({
    id: "owner_skills",
    label: "Your own skills (needs sim-core hook)",
    detail: `When you cover a shift yourself you still cook and serve like sim-core's default owner. Using your ${career.track} skills needs an owner-stats hook.`,
    via: "needs_hook",
  });
  s = { ...s, log: [...s.log, { day: 0, tick: 0, text: `From ${rungDef(career.track, career.rung).title.toLowerCase()} to owner. Good luck!`, kind: "good" }] };

  const summary: HandoverSummary = {
    day: opts.day ?? career.day,
    restaurantName: s.restaurantName,
    districtId: s.districtId,
    track: career.track,
    rungTitle: rungDef(career.track, career.rung).title,
    savingsIn: career.savings,
    loan,
    cashAtOpening: s.cash,
    perks,
    ...(colleague ? { colleague } : {}),
    hireRebates,
    hireRebateEach,
  };
  return { state: s, perks: perks.map((p) => `${p.label}: ${p.detail}`), summary, ownerPerks: { hireRebatesLeft: hireRebates, hireRebateEach } };
}

/**
 * applyCommand for the player's own restaurant with handover perks: a successful HIRE refunds part of the
 * recruitment fee while rebates last.
 */
export function applyWithPerks(content: ContentPack, state: GameState, perks: OwnerPerks, cmd: Command): StepResult & { perks: OwnerPerks } {
  const r = applyCommand(content, state, cmd);
  if (cmd.type !== "HIRE" || perks.hireRebatesLeft <= 0 || r.state.staff.length <= state.staff.length) return { ...r, perks };
  return {
    state: { ...r.state, cash: r.state.cash + perks.hireRebateEach },
    events: [...r.events, { type: "LOG", entry: { day: r.state.day, tick: r.state.tick, text: `Hiring through your contacts saved ${pounds(perks.hireRebateEach)}.`, kind: "money" } }],
    perks: { ...perks, hireRebatesLeft: perks.hireRebatesLeft - 1 },
  };
}
