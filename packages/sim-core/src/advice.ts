/**
 * Round 5 review: the "trim the rota" advice (game Evening tip; the typical headless owner acts on it once noticed).
 *
 * Owner year 1 on hard: the typical script survived 0/100 since round 2 (balanced 45%). Diagnosis (50 seeds each): with
 * its rota trimming, incident answers and owner-cover noticing restored it survives 44%; with only hiring/table
 * thresholds like balanced, 28%; leaner menu or stock, 4–8%. The killer is doubled-up shifts kept through losing
 * weeks — and nothing in the game ever said so. This is the sentence the game now says.
 *
 * Round 6: `eveningAdvice` generalises it to the owner's other levers — over-stock (spoilage), a dud on the menu, an
 * idle second chef and under-pricing. At most one tip an evening, in priority order; every tip except the rota one
 * rests for `cooldownDays` after it is shown (the rota tip keeps its round-5 behaviour: every losing evening). What
 * was shown is recorded at END_DAY in `GameState.adviceLog` (see `recordAdvice`), which is also what the headless
 * `learner-*` owners read. Thresholds and words come from the content pack (`ContentPack.adviceText`), with the
 * defaults below. Everything here is pure.
 */
import { formatPence, formatPounds } from "./money";
import { VAT_RATE } from "./constants";
import { suggestedOrder } from "./forecast";
import { shiftCost } from "./systems/finance";
import type { AdviceKind, AdviceLog, AdviceRules, AdviceTextPack, Command, ContentPack, DishCourse, DishId, GameState, IngredientId, Staff, StaffRole } from "./types";
import { findDish, findIngredient, weekdayOf } from "./util";

/** Days of history the advice averages profit over. */
export const ROTA_ADVICE_DAYS = 14;

export interface RotaAdvice {
  staffId: string;
  name: string;
  role: StaffRole;
  /** Weekday indexes (0 = Monday) this person works alongside someone else in the same role. */
  doubledDays: number[];
  /** What those shifts cost a week, pence. */
  weeklyCost: number;
  /** Mean daily profit over the last ROTA_ADVICE_DAYS days (negative), pence. */
  dailyLoss: number;
}

/** Mean daily profit over the `days` ending at history index `end` (exclusive); undefined with too little history. */
export function meanProfit(history: GameState["history"], days = ROTA_ADVICE_DAYS, end = history.length): number | undefined {
  if (end < days) return undefined;
  const h = history.slice(end - days, end);
  return h.reduce((a, d) => a + d.profit, 0) / h.length;
}

/**
 * When the last fortnight lost money and someone works days a colleague in the same role already covers, the most
 * expensive such doubled-up rota (the later hire on ties). Undefined otherwise. Pure.
 */
export function rotaAdvice(state: Pick<GameState, "history" | "staff">, end = state.history.length): RotaAdvice | undefined {
  const profit = meanProfit(state.history, ROTA_ADVICE_DAYS, end);
  if (profit === undefined || profit >= 0) return undefined;
  let best: RotaAdvice | undefined;
  const byRole = new Map<StaffRole, Staff[]>();
  for (const s of state.staff) byRole.set(s.role, [...(byRole.get(s.role) ?? []), s]);
  for (const team of byRole.values()) {
    if (team.length < 2) continue;
    team.forEach((s, i) => {
      if (i === 0) return; // the first of a role is the one being covered, not the extra
      const doubled = s.rota.flatMap((on, d) => (on && team.some((o) => o !== s && o.rota[d]) ? [d] : []));
      if (!doubled.length) return;
      const weeklyCost = shiftCost(s) * doubled.length;
      if (!best || weeklyCost >= best.weeklyCost) best = { staffId: s.id, name: s.name, role: s.role, doubledDays: doubled, weeklyCost, dailyLoss: Math.round(profit) };
    });
  }
  return best;
}

// ───────────────────────── round 6: the evening's one tip ─────────────────────────

/** Default thresholds (content may override any of them: ContentPack.adviceText.rules). */
export const ADVICE_RULES: AdviceRules = {
  priority: ["rota", "idleChef", "overstock", "underpriced", "dog"],
  cooldownDays: 7,
  rotaRestAfter: 2,
  overstockDays: 7,
  overstockMinCost: 1_500,
  overstockMinShare: 0.25,
  dogDays: 14,
  dogSoldShare: 0.5,
  dogMinCourse: 3,
  idleChefDays: 7,
  idleChefMinDays: 2,
  idleChefRatio: 1,
  underpricedDays: 14,
  underpricedPopularity: 70,
  underpricedWalkouts: 4,
  underpricedMaxMargin: 0.05,
  underpricedMaxPriceIndex: 1.05,
  underpricedRaise: 0.1,
};

/** The thresholds in force for this content pack. */
export function adviceRulesOf(content: Pick<ContentPack, "adviceText"> | undefined): AdviceRules {
  const over = content?.adviceText?.rules;
  return over ? { ...ADVICE_RULES, ...over } : ADVICE_RULES;
}

/** One tip: what it is about, the numbers behind it, and what one tap does. */
export interface Advice {
  kind: AdviceKind;
  /** What the tip is about (staff, dish or ingredient id; "menu" for prices). Recorded in the advice log. */
  subject: string;
  /** Values for the content templates ({name}, {cost}, …); money is already "£1,234". */
  vars: Record<string, string>;
  /** Commands the one-tap button issues (planning-phase commands are applied tomorrow morning). Empty = deep link. */
  commands: Command[];
  /** Planning tab the button opens. */
  tab: "menu" | "staff" | "stock" | "restaurant";
  /**
   * [round 6 review] The commands apply tonight and the evening stays up (the over-stock tip trims tomorrow's pending
   * order, which a morning command would be too late for). The button reads the `fix` words instead of `action`.
   */
  now?: true;
}

/** "£1,234" (whole pounds, en-GB grouping); negatives as "−£12" (round 11: the one formatter, money.ts). */
export function poundsText(pence: number): string {
  return formatPounds(pence);
}
/** "80p" under a pound, "£1.20" above. */
export function penceText(pence: number): string {
  const p = Math.round(pence);
  return Math.abs(p) < 100 ? `${p}p` : formatPence(p);
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
/** "Friday, Saturday and Sunday" */
export function weekdayList(days: readonly number[]): string {
  const n = days.map((d) => WEEKDAYS[d]!);
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
}

const ROLE_WORD: Record<string, string> = { chef: "chef", server: "waiter", bar: "bartender", porter: "porter", manager: "manager" };
const COURSE_WORD: Record<DishCourse, string> = { starter: "starter", main: "main", dessert: "pudding", drink: "drink", side: "side" };

type AdviceState = Pick<GameState, "history" | "staff" | "menu" | "reputation"> & Partial<Pick<GameState, "adviceLog" | "day">>;
type Rule = (state: AdviceState, content: ContentPack, rules: AdviceRules) => Advice | undefined;

const lastDays = (state: AdviceState, n: number) => state.history.slice(-n);
const rotaWithout = (s: Staff, days: readonly number[]) => s.rota.map((on, d) => on && !days.includes(d));

/** The round-5 rota tip as an Advice (same rule, same numbers). */
const rotaRule: Rule = (state) => {
  const a = rotaAdvice(state);
  if (!a) return undefined;
  const s = state.staff.find((x) => x.id === a.staffId)!;
  const total = state.history.slice(-ROTA_ADVICE_DAYS).reduce((t, d) => t + d.profit, 0);
  return {
    kind: "rota",
    subject: a.staffId,
    vars: {
      name: a.name, role: ROLE_WORD[a.role] ?? a.role, days: weekdayList(a.doubledDays), weeklyCost: poundsText(a.weeklyCost),
      dailyLoss: poundsText(-a.dailyLoss), totalLoss: poundsText(-total), shifts: String(a.doubledDays.length), shiftCost: poundsText(shiftCost(s)),
    },
    commands: [{ type: "SET_ROTA", staffId: a.staffId, rota: rotaWithout(s, a.doubledDays) }],
    tab: "staff",
  };
};

/** Portions of each ingredient that went into plates over `days` (perDish.plated × recipe). */
function ingredientUse(content: ContentPack, days: GameState["history"]): Map<IngredientId, number> {
  const out = new Map<IngredientId, number>();
  for (const h of days) {
    for (const [dishId, line] of Object.entries(h.perDish ?? {})) {
      const dish = findDish(content, dishId);
      if (!dish) continue;
      for (const ing of dish.ingredients) out.set(ing.id, (out.get(ing.id) ?? 0) + ing.qty * line.plated);
    }
  }
  return out;
}

/**
 * Over-stock: over the last week an ingredient's spoilage cost at least `overstockMinCost` and the portions binned were
 * at least `overstockMinShare` of the portions used — the owner orders far more than the week uses before it goes
 * off. Names the costliest such ingredient (ties: id order).
 */
const overstockRule: Rule = (state, content, r) => {
  const days = lastDays(state, r.overstockDays);
  if (days.length < r.overstockDays) return undefined;
  const binned = new Map<IngredientId, { qty: number; cost: number }>();
  for (const h of days) {
    for (const [id, b] of Object.entries(h.spoiled ?? {})) {
      const cur = binned.get(id) ?? { qty: 0, cost: 0 };
      binned.set(id, { qty: cur.qty + b.qty, cost: cur.cost + b.cost });
    }
  }
  const used = ingredientUse(content, days);
  let best: { id: IngredientId; qty: number; cost: number; used: number } | undefined;
  for (const id of [...binned.keys()].sort()) {
    const b = binned.get(id)!;
    const u = used.get(id) ?? 0;
    if (b.cost < r.overstockMinCost || b.qty < r.overstockMinShare * u) continue;
    if (!best || b.cost > best.cost) best = { id, ...b, used: u };
  }
  if (!best) return undefined;
  const ing = findIngredient(content, best.id);
  const name = ing?.name ?? best.id;
  const cut = isFullState(state) ? overOrdered(content, state, best.id) : 0;
  return {
    kind: "overstock",
    subject: best.id,
    vars: {
      ingredient: name, ingredientLower: name.toLowerCase(), used: String(Math.round(best.used)), binned: String(Math.round(best.qty)),
      cost: poundsText(best.cost), shelfLife: String(ing?.shelfLifeDays ?? "?"), days: String(r.overstockDays), cut: String(cut),
    },
    commands: cut > 0 ? [{ type: "CANCEL_ORDER", ingredientId: best.id, qty: cut }] : [],
    tab: "stock",
    ...(cut > 0 ? { now: true as const } : {}),
  };
};

const isFullState = (s: AdviceState): s is GameState =>
  Array.isArray((s as Partial<GameState>).orders) && Array.isArray((s as Partial<GameState>).stock) && typeof (s as Partial<GameState>).districtId === "string";

/**
 * [round 6 review] Portions of `id` on tomorrow's order beyond what tomorrow's service needs (the same forecast as the
 * Evening's "Order what tomorrow needs": `suggestedOrder` with this ingredient's pending lines left out). 0 = nothing
 * to trim (nothing on order, or all of it is needed).
 */
export function overOrdered(content: ContentPack, state: GameState, id: IngredientId): number {
  const pending = state.orders.reduce((a, o) => a + (o.ingredientId === id ? o.qty : 0), 0);
  if (!pending) return 0;
  const without = { ...state, orders: state.orders.filter((o) => o.ingredientId !== id) };
  const need = suggestedOrder(content, without).find((l) => l.ingredientId === id)?.qty ?? 0;
  return Math.max(0, pending - need);
}

/** Per-dish sold and margin per plate (ex-VAT revenue − food cost) over some days. */
function dishStats(days: GameState["history"]): Map<DishId, { sold: number; margin: number }> {
  const out = new Map<DishId, { sold: number; margin: number }>();
  for (const h of days) {
    for (const [id, l] of Object.entries(h.perDish ?? {})) {
      const cur = out.get(id) ?? { sold: 0, margin: 0 };
      out.set(id, { sold: cur.sold + l.sold, margin: cur.margin + l.revenue / (1 + VAT_RATE) - l.foodCost });
    }
  }
  return out;
}

/** Dishes of `course` that are a dud (Kasavana–Smith dog within their course) over `days`. */
function dudsIn(content: ContentPack, dishes: readonly DishId[], days: GameState["history"], r: AdviceRules) {
  const st = dishStats(days);
  const sold = dishes.map((id) => st.get(id)?.sold ?? 0);
  const totalSold = sold.reduce((a, b) => a + b, 0);
  const totalMargin = dishes.reduce((a, id) => a + (st.get(id)?.margin ?? 0), 0);
  const meanSold = totalSold / dishes.length;
  const meanMargin = totalSold ? totalMargin / totalSold : 0;
  return {
    meanSold,
    meanMargin,
    duds: dishes.flatMap((id, i) => {
      const s = sold[i]!;
      const m = s ? st.get(id)!.margin / s : 0;
      return s < r.dogSoldShare * meanSold && m < meanMargin ? [{ id, sold: s, margin: m }] : [];
    }),
  };
}

/**
 * A dud on the menu: a dish that sold under `dogSoldShare` of its course's average and made less per plate than the
 * course's average, in each of the last two weeks (so for `dogDays` days). Only where the course has at least
 * `dogMinCourse` dishes, so dropping it never empties a course. The weakest seller is named (ties: menu order).
 */
const dogRule: Rule = (state, content, r) => {
  if (state.history.length < r.dogDays) return undefined;
  const half = Math.floor(r.dogDays / 2);
  const recent = lastDays(state, r.dogDays);
  const [older, newer] = [recent.slice(0, recent.length - half), recent.slice(-half)];
  const active = state.menu.filter((m) => m.active).map((m) => m.dishId);
  // The dish must have been on the menu the whole time: it sold in the first week (a dish added last week isn't judged).
  const oldSold = dishStats(older);
  let best: { id: DishId; sold: number; margin: number; meanSold: number; meanMargin: number; course: DishCourse } | undefined;
  const courses = new Map<DishCourse, DishId[]>();
  for (const id of active) {
    const d = findDish(content, id);
    if (d) courses.set(d.course, [...(courses.get(d.course) ?? []), id]);
  }
  for (const [course, ids] of courses) {
    if (ids.length < r.dogMinCourse) continue;
    const a = dudsIn(content, ids, older, r);
    const b = dudsIn(content, ids, newer, r);
    const both = new Set(a.duds.map((x) => x.id));
    const all = dudsIn(content, ids, recent, r);
    for (const d of all.duds) {
      if (!both.has(d.id) || !b.duds.some((x) => x.id === d.id) || !(oldSold.get(d.id)?.sold)) continue;
      if (!best || d.sold < best.sold) best = { ...d, meanSold: all.meanSold, meanMargin: all.meanMargin, course };
    }
  }
  if (!best) return undefined;
  const name = findDish(content, best.id)?.name ?? best.id;
  return {
    kind: "dog",
    subject: best.id,
    vars: {
      dish: name, sold: String(best.sold), days: String(r.dogDays), course: COURSE_WORD[best.course], courseSold: String(Math.round(best.meanSold)),
      margin: penceText(best.margin), courseMargin: penceText(best.meanMargin),
    },
    commands: [{ type: "REMOVE_MENU_ITEM", dishId: best.id }],
    tab: "menu",
  };
};

/**
 * An idle second chef: over the last week, on at least `idleChefMinDays` days two or more chefs cooked, and on every
 * one of them they plated no more between them than one chef has managed alone in the last fortnight (× ratio).
 * Names the later hire who is rostered on those weekdays alongside a colleague.
 */
const idleChefRule: Rule = (state, _content, r) => {
  const chefs = state.staff.filter((s) => s.role === "chef");
  if (chefs.length < 2) return undefined;
  const ids = new Set(chefs.map((c) => c.id));
  const week = lastDays(state, r.idleChefDays);
  if (week.length < r.idleChefDays) return undefined;
  let soloPeak = 0;
  let soloDay = -1;
  let soloId = "";
  for (const h of lastDays(state, 2 * r.idleChefDays)) {
    const cooks = Object.entries(h.perChef ?? {}).filter(([id]) => ids.has(id));
    if (cooks.length === 1 && cooks[0]![1].plates > soloPeak) [soloPeak, soloDay, soloId] = [cooks[0]![1].plates, h.day, cooks[0]![0]];
  }
  if (!soloPeak) return undefined;
  const doubled = week.filter((h) => Object.keys(h.perChef ?? {}).filter((id) => ids.has(id)).length >= 2);
  if (doubled.length < r.idleChefMinDays) return undefined;
  const plates = doubled.map((h) => Object.entries(h.perChef ?? {}).filter(([id]) => ids.has(id)).reduce((a, [, c]) => a + c.plates, 0));
  if (plates.some((p) => p > soloPeak * r.idleChefRatio)) return undefined;
  const weekdays = [...new Set(doubled.map((h) => weekdayOf(h.day)))].sort((a, b) => a - b);
  // The extra: the latest-listed chef rostered on those weekdays alongside another chef.
  for (let i = chefs.length - 1; i >= 1; i--) {
    const s = chefs[i]!;
    const days = weekdays.filter((d) => s.rota[d] && chefs.some((o) => o !== s && o.rota[d]));
    if (!days.length) continue;
    const solo = state.staff.find((x) => x.id === soloId);
    return {
      kind: "idleChef",
      subject: s.id,
      vars: {
        name: s.name, days: weekdayList(days), weeklyCost: poundsText(shiftCost(s) * days.length), plates: String(Math.max(...plates)),
        soloName: solo?.name ?? "one chef", soloPeak: String(soloPeak), soloDay: WEEKDAYS[weekdayOf(soloDay)]!,
      },
      commands: [{ type: "SET_ROTA", staffId: s.id, rota: rotaWithout(s, days) }],
      tab: "staff",
    };
  }
  return undefined;
};

/** Menu price ÷ suggested over active dishes (1 = suggested). */
function priceIndex(content: ContentPack, state: AdviceState): number {
  let p = 0;
  let s = 0;
  for (const m of state.menu) {
    const d = m.active ? findDish(content, m.dishId) : undefined;
    if (!d) continue;
    p += m.price;
    s += d.suggestedPrice;
  }
  return s ? p / s : 1;
}

/**
 * Under-pricing: very popular (≥ `underpricedPopularity`), turning people away (mean walk-outs ≥
 * `underpricedWalkouts` over the last week) and still keeping under `underpricedMaxMargin` of takings over
 * `underpricedDays`, with prices not already above `underpricedMaxPriceIndex` × suggested. One tap raises every
 * active dish by `underpricedRaise` (to the nearest 10p).
 */
const underpricedRule: Rule = (state, content, r) => {
  if (state.history.length < r.underpricedDays || state.reputation.popularity < r.underpricedPopularity) return undefined;
  const week = lastDays(state, 7).filter((h) => !h.closed);
  if (!week.length) return undefined;
  const walkouts = week.reduce((a, h) => a + h.walkouts, 0) / week.length;
  if (walkouts < r.underpricedWalkouts) return undefined;
  const span = lastDays(state, r.underpricedDays);
  const revenue = span.reduce((a, h) => a + h.revenue, 0);
  const profit = span.reduce((a, h) => a + h.profit, 0);
  if (revenue <= 0 || profit / revenue >= r.underpricedMaxMargin) return undefined;
  const index = priceIndex(content, state);
  if (index > r.underpricedMaxPriceIndex) return undefined;
  const commands: Command[] = state.menu
    .filter((m) => m.active)
    .map((m) => ({ type: "SET_MENU_ITEM", dishId: m.dishId, price: Math.round((m.price * (1 + r.underpricedRaise)) / 10) * 10 }));
  return {
    kind: "underpriced",
    subject: "menu",
    vars: {
      walkouts: String(Math.round(walkouts)), popularity: String(Math.round(state.reputation.popularity)), raise: `${Math.round(r.underpricedRaise * 100)}%`,
      keep: profit > 0 ? `kept only ${penceText((100 * profit) / revenue)} from every pound` : "lost money overall", days: String(r.underpricedDays),
    },
    commands,
    tab: "menu",
  };
};

const RULES: Record<AdviceKind, Rule> = { rota: rotaRule, overstock: overstockRule, dog: dogRule, idleChef: idleChefRule, underpriced: underpricedRule };
export const ADVICE_KINDS: readonly AdviceKind[] = ["rota", "overstock", "dog", "idleChef", "underpriced"];

/** True while `kind` is resting after being shown (the rota tip never rests: round-5 behaviour). */
export function onCooldown(log: AdviceLog | undefined, kind: AdviceKind, day: number, rules: AdviceRules = ADVICE_RULES): boolean {
  if (kind === "rota") return false;
  const last = log?.[kind];
  return !!last && day - last.day < rules.cooldownDays;
}

/**
 * Every tip whose rule holds tonight, in priority order, ignoring cooldowns (tests, the headless learners' "what
 * would it say"). `only` restricts to some kinds.
 */
export function allAdvice(state: AdviceState, content: ContentPack, only?: readonly AdviceKind[]): Advice[] {
  const rules = adviceRulesOf(content);
  return rules.priority.filter((k) => RULES[k] && (!only || only.includes(k))).flatMap((k) => RULES[k](state, content, rules) ?? []);
}

/**
 * The evening's one tip: the first kind in priority order that is off cooldown and whose rule holds. Undefined on a
 * quiet evening. Deterministic and pure (frozen input is fine). `state.day` is tonight; `adviceLog` holds what earlier
 * evenings showed.
 */
export function eveningAdvice(state: AdviceState, content: ContentPack): Advice | undefined {
  const rules = adviceRulesOf(content);
  const day = state.day ?? state.history.at(-1)?.day ?? 0;
  // Round 6 review: the rota tip never cools down, so on a losing streak it would crowd out every other tip. After
  // `rotaRestAfter` showings in a row it steps aside for one evening — if another tip is due; otherwise it shows.
  let rested = false;
  for (const k of rules.priority) {
    const rule = RULES[k];
    if (!rule || onCooldown(state.adviceLog, k, day, rules)) continue;
    if (k === "rota" && rotaRests(state.adviceLog, day, rules)) { rested = true; continue; }
    const a = rule(state, content, rules);
    if (a) return a;
  }
  return rested ? RULES.rota(state, content, rules) : undefined;
}

/**
 * [round 6 review] Tonight the rota tip steps aside: it was shown last night and its showings so far are a multiple of
 * `rotaRestAfter` (so: rota, rota, another tip, rota, rota, …). The log keeps no streak, but a rested night breaks
 * "shown last night", so it never rests twice running. 0 = never rests (round 6 as first shipped).
 */
export function rotaRests(log: AdviceLog | undefined, day: number, rules: AdviceRules = ADVICE_RULES): boolean {
  const e = log?.rota;
  return rules.rotaRestAfter > 0 && !!e && e.day === day - 1 && e.count % rules.rotaRestAfter === 0;
}

/**
 * The advice log after tonight: END_DAY (and RESOLVE_EVENT) call this on the evening state so the cooldown and the
 * learners know what was shown. Returns the same log object when nothing was shown.
 */
export function recordAdvice(state: GameState, content: ContentPack): AdviceLog | undefined {
  if (state.phase !== "evening" && state.phase !== "event") return state.adviceLog;
  const a = eveningAdvice(state, content);
  if (!a) return state.adviceLog;
  const prev = state.adviceLog?.[a.kind];
  return { ...state.adviceLog, [a.kind]: { day: state.day, count: (prev?.count ?? 0) + 1, subject: a.subject } };
}

// ───────────────────────── words (content templates) ─────────────────────────

/** Built-in words; ContentPack.adviceText.text replaces any of them key by key. `[[termId|label]]` marks a glossary word. */
export const ADVICE_TEXT: Record<AdviceKind, { icon: string; title: string; body: string; why: string; action: string; fix?: string }> = {
  rota: {
    icon: "📅",
    title: "Two weeks of losing money (about {dailyLoss} a day).",
    body: "{name} works {days}, when another {role} is already on. Those shifts cost {weeklyCost} a week. Take them off the [[rota|rota]] until things pick up?",
    why: "The last 14 days lost {totalLoss} in all. {name} is booked for {shifts} doubled-up shifts a week at {shiftCost} each.",
    action: "Give {name} {days} off",
  },
  overstock: {
    icon: "🗑️",
    title: "You're buying more {ingredientLower} than you can use.",
    body: "Order less of it, so less of it [[spoilage|goes off]].",
    why: "In the last {days} days your kitchen used {used} portions of {ingredientLower} and threw away {binned}: {cost} in the bin. It keeps for {shelfLife} days.",
    action: "Check the larder",
    fix: "Take {cut} {ingredientLower} off tomorrow's order",
  },
  dog: {
    icon: "🥀",
    title: "Hardly anyone orders the {dish}.",
    body: "It's a [[mmDog|dud]]: take it off the menu (fewer things to buy, fewer to go off), or change its price.",
    why: "In {days} days it sold {sold} plates; your other {course}s sold about {courseSold} each. It makes {margin} a plate, they make about {courseMargin}.",
    action: "Take the {dish} off the menu",
  },
  idleChef: {
    icon: "🧑‍🍳",
    title: "{name} isn't needed on {days}.",
    body: "Two chefs cooked fewer plates than one chef manages alone. Give {name} those days off and save {weeklyCost} a week.",
    why: "On those days the two chefs cooked at most {plates} plates between them. On {soloDay}, {soloName} cooked {soloPeak} alone.",
    action: "Give {name} {days} off",
  },
  underpriced: {
    icon: "🏷️",
    title: "Everyone wants to eat here, but you keep very little.",
    body: "Put your prices up a little, about {raise}. Busy places can charge a bit more.",
    why: "This week about {walkouts} people a night couldn't get a table, and you're very [[popularity|popular]] ({popularity}/100). But over {days} days you {keep}.",
    action: "Raise prices {raise}",
  },
};

/** The words in force for a kind (content over built-in, key by key). */
export function adviceTextOf(content: Pick<ContentPack, "adviceText"> | undefined, kind: AdviceKind): (typeof ADVICE_TEXT)[AdviceKind] {
  const over = content?.adviceText?.text?.[kind];
  return over ? { ...ADVICE_TEXT[kind], ...over } : ADVICE_TEXT[kind];
}

/** Fills `{name}` placeholders and reduces `[[term|label]]` to its label: the plain sentence. */
export function fillAdvice(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m).replace(/\[\[[\w]+\|([^\]]*)\]\]/g, "$1");
}

/** The tip as plain sentences (headless reports, tests). */
export function adviceSentences(a: Advice, content?: Pick<ContentPack, "adviceText">): { title: string; body: string; why: string; action: string } {
  const t = adviceTextOf(content, a.kind);
  return { title: fillAdvice(t.title, a.vars), body: fillAdvice(t.body, a.vars), why: fillAdvice(t.why, a.vars), action: fillAdvice(actionWords(a, t), a.vars) };
}

/** The button's words: `fix` when the tip's commands apply tonight (and the pack has them), else `action`. */
export function actionWords(a: Pick<Advice, "now">, t: { action: string; fix?: string }): string {
  return a.now && t.fix ? t.fix : t.action;
}

export type { AdviceKind, AdviceLog, AdviceRules, AdviceTextPack };
