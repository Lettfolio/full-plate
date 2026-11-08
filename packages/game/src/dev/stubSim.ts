/**
 * A tiny fake implementation of the sim-core public API, for UI development only.
 * It is NOT the real simulation and makes no attempt at balance or determinism
 * beyond "same seed → roughly the same day". Selected by VITE_USE_STUBS=1 (src/sim.ts).
 *
 * Mirrors: newGame, applyCommand, tick, runDay, candidates, classifyMenu, serialize, deserialize.
 */
import type {
  Candidate, Command, ContentPack, Customer, DayResult, DishId, GameState, KitchenTicket,
  LogEntry, MenuQuadrant, Review, SimEvent, StepResult, Table,
} from "@full-plate/sim-core";

const TICKS = 120;

// ── rng (mulberry32, state in rngState[0]) ──
function rng(state: GameState): () => number {
  let a = state.rngState[0] ?? 1;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  (next as { save?: () => void }).save = () => { state.rngState = [a]; };
  return next;
}
function save(r: () => number) { (r as { save?: () => void }).save?.(); }
function pick<T>(r: () => number, xs: readonly T[]): T { return xs[Math.floor(r() * xs.length)] as T; }
function weighted(r: () => number, ws: number[]): number {
  const total = ws.reduce((a, b) => a + b, 0) || 1;
  let x = r() * total;
  for (let i = 0; i < ws.length; i++) { x -= ws[i] ?? 0; if (x <= 0) return i; }
  return ws.length - 1;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clone = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;

function dishCost(content: ContentPack, dishId: DishId): number {
  const d = content.dishes.find((x) => x.id === dishId);
  if (!d) return 0;
  return d.ingredients.reduce((sum, i) => sum + (content.ingredients.find((x) => x.id === i.id)?.unitCost ?? 0) * i.qty, 0);
}

function log(s: GameState, events: SimEvent[], text: string, kind: LogEntry["kind"]) {
  const entry: LogEntry = { day: s.day, tick: s.tick, text, kind };
  s.log = [...s.log.slice(-199), entry];
  events.push({ type: "LOG", entry });
}

function freshToday(): GameState["todays"] {
  return { covers: 0, walkouts: 0, revenue: 0, tips: 0, foodCost: 0, reviews: [] };
}

// ── API ──
export function newGame(content: ContentPack, cmd: Extract<Command, { type: "NEW_GAME" }>): GameState {
  const b = content.balance;
  const tables: Table[] = Array.from({ length: b.startingTables }, (_, i) => ({ id: `t${i + 1}`, seats: i % 3 === 0 ? 2 : b.seatsPerTable, dirtyTicks: 0 }));
  const firstDishes = content.dishes.slice(0, 5);
  const s: GameState = {
    version: 1, seed: cmd.seed, rngState: [cmd.seed | 0 || 1], difficulty: cmd.difficulty,
    day: 0, tick: 0, phase: "planning", restaurantName: cmd.restaurantName || "The Little Kitchen", districtId: cmd.districtId,
    cash: b.startingCash + b.loanPrincipal - b.fitOutCost,
    loan: { principal: b.loanPrincipal, remaining: b.loanPrincipal, dailyPayment: Math.round((b.loanPrincipal * (1 + b.loanApr * 2)) / b.loanTermDays), daysRemaining: b.loanTermDays },
    reputation: { popularity: 40, prestige: 25 },
    menu: firstDishes.map((d) => ({ dishId: d.id, price: d.suggestedPrice, active: true, sold7d: 0, margin7d: 0 })),
    staff: [
      { id: "s1", name: "Priya", role: "chef", skill: 48, speed: 55, charm: 22, wage: 1350, mood: 72, fatigue: 0, traits: ["steady"], hiredDay: 0, potential: 70, rota: [true, true, true, true, true, false, false] },
      { id: "s2", name: "Finn", role: "server", skill: 35, speed: 62, charm: 70, wage: 1271, mood: 80, fatigue: 0, traits: ["charming", "chatty"], hiredDay: 0, potential: 55, rota: [true, true, false, true, true, true, true] },
    ],
    tables,
    stock: content.ingredients.map((i) => ({ ingredientId: i.id, qty: 30, oldestDay: 0 })),
    orders: [], customers: [], tickets: [], todays: freshToday(), history: [], footfallMods: [], log: [],
    stats: { totalCovers: 0, totalRevenue: 0, daysOpen: 0 },
  };
  return s;
}

export function candidates(content: ContentPack, state: GameState): Candidate[] {
  const r = rng({ ...state, rngState: [state.seed * 31 + state.day * 7 + 3] });
  return content.staffArchetypes.slice(0, 3).flatMap((a) => [0, 1].map(() => {
    const between = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));
    const skill = between(...a.skillRange);
    return {
      name: pick(r, a.nameSamples), role: a.role,
      skill, speed: between(...a.speedRange), charm: between(...a.charmRange),
      wage: between(...a.wageRange), traits: [pick(r, a.traits), pick(r, a.traits)].filter((t, i, xs) => xs.indexOf(t) === i),
      potentialHint: pick(r, ["raw", "promising", "solid", "a real find"]),
    };
  }));
}

export function classifyMenu(_content: ContentPack, state: GameState): Record<DishId, MenuQuadrant> {
  const items = state.menu.filter((m) => m.active);
  const out: Record<DishId, MenuQuadrant> = {};
  if (!items.length) return out;
  const meanSold = items.reduce((a, m) => a + m.sold7d, 0) / items.length;
  const unit = (m: (typeof items)[number]) => (m.sold7d ? m.margin7d / m.sold7d : m.price);
  const meanMargin = items.reduce((a, m) => a + unit(m), 0) / items.length;
  for (const m of items) {
    const pop = m.sold7d >= meanSold, mar = unit(m) >= meanMargin;
    out[m.dishId] = pop && mar ? "star" : pop ? "ploughhorse" : mar ? "puzzle" : "dog";
  }
  return out;
}

export function applyCommand(content: ContentPack, prev: GameState, cmd: Command): StepResult {
  const s = clone(prev);
  const events: SimEvent[] = [];
  switch (cmd.type) {
    case "NEW_GAME": return { state: newGame(content, cmd), events };
    case "SET_MENU_ITEM": s.menu = s.menu.map((m) => (m.dishId === cmd.dishId ? { ...m, price: cmd.price ?? m.price, active: cmd.active ?? m.active } : m)); break;
    case "ADD_MENU_ITEM": if (!s.menu.some((m) => m.dishId === cmd.dishId)) s.menu.push({ dishId: cmd.dishId, price: cmd.price, active: true, sold7d: 0, margin7d: 0 }); break;
    case "REMOVE_MENU_ITEM": s.menu = s.menu.filter((m) => m.dishId !== cmd.dishId); break;
    case "HIRE": {
      const c = candidates(content, prev)[cmd.candidateIndex];
      if (!c) break;
      s.staff.push({ id: `s${s.staff.length + 1}-${s.day}`, name: c.name, role: c.role, skill: c.skill, speed: c.speed, charm: c.charm, wage: c.wage, mood: 75, fatigue: 0, traits: c.traits, hiredDay: s.day, potential: 60, rota: [true, true, true, true, true, false, false] });
      log(s, events, `${c.name} joined the team.`, "good");
      break;
    }
    case "FIRE": { const who = s.staff.find((x) => x.id === cmd.staffId); s.staff = s.staff.filter((x) => x.id !== cmd.staffId); if (who) log(s, events, `${who.name} has left.`, "bad"); break; }
    case "SET_ROTA": s.staff = s.staff.map((x) => (x.id === cmd.staffId ? { ...x, rota: cmd.rota.slice(0, 7) } : x)); break;
    case "ORDER_STOCK": {
      const def = content.ingredients.find((i) => i.id === cmd.ingredientId);
      if (!def || cmd.qty <= 0) break;
      const cost = def.unitCost * cmd.qty;
      s.orders.push({ ingredientId: cmd.ingredientId, qty: cmd.qty, cost });
      s.cash -= cost;
      break;
    }
    case "BUY_TABLE":
      if (s.tables.length < content.balance.maxTables) { s.tables.push({ id: `t${s.tables.length + 1}`, seats: content.balance.seatsPerTable, dirtyTicks: 0 }); s.cash -= 60000; log(s, events, "A new table arrives.", "money"); }
      break;
    case "START_SERVICE":
      if (s.phase !== "planning") break;
      s.phase = "service"; s.tick = 0; s.customers = []; s.tickets = []; s.todays = freshToday();
      log(s, events, `Doors open at ${s.restaurantName}!`, "info");
      break;
    case "COMP_TABLE": {
      const c = s.customers.find((x) => x.id === cmd.customerId);
      if (c && c.stage !== "left") { c.satisfaction = clamp(c.satisfaction + 30, 0, 100); c.patience = 100; c.comped = true; log(s, events, `You comped a table of ${c.partySize}. They're delighted.`, "money"); }
      break;
    }
    case "EIGHTY_SIX": { const d = content.dishes.find((x) => x.id === cmd.dishId); log(s, events, `86 ${d?.name ?? cmd.dishId}! Pulled for today.`, "bad"); s.eightySixed = [...(s.eightySixed ?? []), cmd.dishId]; break; }
    case "END_DAY": {
      if (s.phase !== "evening") break;
      s.day += 1; s.tick = 0; s.customers = []; s.tickets = []; s.todays = freshToday();
      s.eightySixed = [];
      for (const o of s.orders) { const st = s.stock.find((x) => x.ingredientId === o.ingredientId); if (st) st.qty += o.qty; }
      s.orders = [];
      const r = rng(s);
      const roll = r(); save(r);
      const pool = content.events.filter((e) => e.weight > 0);
      if (pool.length && roll < 0.35) {
        const ev = pool[weighted(rng(s), pool.map((e) => e.weight))]!;
        s.activeEvent = { eventId: ev.id }; s.phase = "event";
        events.push({ type: "EVENT_TRIGGERED", eventId: ev.id });
      } else s.phase = "planning";
      break;
    }
    case "RESOLVE_EVENT": {
      const ev = content.events.find((e) => e.id === s.activeEvent?.eventId);
      const ch = ev?.choices.find((c) => c.id === cmd.choiceId);
      if (ch) {
        s.cash += ch.effects.cash ?? 0;
        s.reputation.popularity = clamp(s.reputation.popularity + (ch.effects.popularity ?? 0), 0, 100);
        s.reputation.prestige = clamp(s.reputation.prestige + (ch.effects.prestige ?? 0), 0, 100);
        if (ch.effects.staffMood) s.staff = s.staff.map((x) => ({ ...x, mood: clamp(x.mood + ch.effects.staffMood!, 0, 100) }));
        if (ch.effects.footfallMultDays) s.footfallMods.push({ mult: ch.effects.footfallMultDays.mult, daysRemaining: ch.effects.footfallMultDays.days });
        log(s, events, `${ev!.title}: ${ch.label}.`, "info");
      }
      s.activeEvent = undefined; s.phase = "planning";
      break;
    }
  }
  return { state: s, events };
}

export function tick(content: ContentPack, prev: GameState): StepResult {
  if (prev.phase !== "service") return { state: prev, events: [] };
  const s = clone(prev);
  const events: SimEvent[] = [];
  const r = rng(s);
  const district = content.districts.find((d) => d.id === s.districtId) ?? content.districts[0]!;
  const t = s.tick;
  const banned = new Set(s.eightySixed ?? []);
  const menu = s.menu.filter((m) => m.active && !banned.has(m.dishId));
  const today = s.todays as Required<Pick<DayResult, "covers" | "walkouts" | "revenue" | "tips" | "foodCost">> & GameState["todays"];

  // arrivals
  for (const seg of content.segments) {
    const mix = district.segmentMix[seg.id] ?? 0;
    const expected = (district.footfall / 9) * mix * (seg.arrivalCurve[t] ?? 0) * (0.5 + s.reputation.popularity / 100) * 0.55;
    if (r() < expected) {
      const c: Customer = { id: `c${s.day}-${t}-${seg.id}`, segment: seg.id, partySize: weighted(r, seg.partySizeWeights) + 1, arrivedTick: t, stage: "queue", order: [], patience: 100, satisfaction: 70, spend: 0, tip: 0 };
      s.customers.push(c);
      events.push({ type: "CUSTOMER_ARRIVED", customerId: c.id });
    }
  }

  // tables clearing
  for (const tb of s.tables) if (!tb.occupiedBy && tb.dirtyTicks > 0) tb.dirtyTicks -= 1;

  // seating (FIFO)
  for (const c of s.customers.filter((x) => x.stage === "queue")) {
    const tb = s.tables.find((x) => !x.occupiedBy && x.dirtyTicks === 0 && x.seats >= c.partySize);
    if (!tb) continue;
    tb.occupiedBy = c.id; c.tableId = tb.id; c.stage = "seated";
    events.push({ type: "CUSTOMER_SEATED", customerId: c.id, tableId: tb.id });
  }

  // ordering
  for (const c of s.customers.filter((x) => x.stage === "seated" && t - x.arrivedTick >= 1)) {
    if (!menu.length) continue;
    c.order = Array.from({ length: c.partySize }, () => pick(r, menu).dishId);
    c.stage = "ordered";
    c.order.forEach((dishId, i) => {
      const d = content.dishes.find((x) => x.id === dishId);
      const tk: KitchenTicket = { id: `${c.id}-${i}`, customerId: c.id, dishId, createdTick: t, ticksRemaining: d?.prepTicks ?? 2, quality: 0 };
      s.tickets.push(tk);
    });
  }

  // kitchen: each chef on rota works the oldest ticket
  const chefs = s.staff.filter((x) => x.role === "chef" && x.rota[s.day % 7]);
  const open = s.tickets.filter((x) => x.ticksRemaining > 0);
  chefs.forEach((chef, i) => {
    for (const tk of open.slice(i * 3, i * 3 + 3)) {
      tk.chefId = chef.id; tk.ticksRemaining -= 1;
      if (tk.ticksRemaining <= 0) {
        tk.quality = Math.round(clamp(chef.skill + 20 + (r() - 0.5) * 20, 0, 100));
        events.push({ type: "DISH_PLATED", ticketId: tk.id, quality: tk.quality });
      }
    }
  });

  // patience & stage progression
  for (const c of s.customers) {
    const seg = content.segments.find((x) => x.id === c.segment);
    if (c.stage === "queue" || c.stage === "ordered") c.patience = clamp(c.patience - (1.5 + (seg?.speedWeight ?? 0.5) * 2.5) * (0.6 + r() * 0.8), 0, 100);
    if ((c.stage === "queue" || c.stage === "ordered") && c.patience <= 0) {
      if (c.tableId) { const tb = s.tables.find((x) => x.id === c.tableId); if (tb) { tb.occupiedBy = undefined; tb.dirtyTicks = 1; } }
      c.stage = "left"; c.walkedOut = true; today.walkouts += c.partySize;
      events.push({ type: "CUSTOMER_WALKED_OUT", customerId: c.id });
      log(s, events, `A party of ${c.partySize} ${seg?.name.toLowerCase() ?? ""} gave up and walked out.`, "bad");
      s.reputation.popularity = clamp(s.reputation.popularity - 0.4, 0, 100);
      continue;
    }
    if (c.stage === "ordered") {
      const mine = s.tickets.filter((x) => x.customerId === c.id);
      if (mine.length && mine.every((x) => x.ticksRemaining <= 0)) {
        const q = mine.reduce((a, x) => a + x.quality, 0) / mine.length;
        c.satisfaction = Math.round(clamp(q * 0.6 + c.patience * 0.4 + (r() - 0.5) * 10, 0, 100));
        c.stage = "eating"; c.eatUntil = t + 4 + Math.floor(r() * 4);
      }
    } else if (c.stage === "eating" && t >= (c.eatUntil ?? 0)) {
      c.stage = "paying";
    } else if (c.stage === "paying") {
      const comped = c.comped;
      const spend = comped ? 0 : c.order.reduce((a, id) => a + (s.menu.find((m) => m.dishId === id)?.price ?? 0), 0);
      const food = c.order.reduce((a, id) => a + dishCost(content, id), 0);
      const tip = comped ? 0 : Math.round(spend * (seg?.tipRate ?? 0.05) * (c.satisfaction / 70));
      const rating = clamp(Math.round(c.satisfaction / 20 + 0.4), 1, 5);
      c.spend = spend; c.tip = tip; c.stage = "left";
      today.covers += c.partySize; today.revenue += spend; today.tips += tip; today.foodCost += food;
      for (const id of c.order) { const m = s.menu.find((x) => x.dishId === id); if (m) { m.sold7d += 1; m.margin7d += m.price - dishCost(content, id); } }
      const tb = s.tables.find((x) => x.id === c.tableId); if (tb) { tb.occupiedBy = undefined; tb.dirtyTicks = 2; }
      events.push({ type: "CUSTOMER_PAID", customerId: c.id, spend, tip, rating });
      if (rating >= 5) log(s, events, `Table ${c.tableId?.slice(1)} loved it! ★★★★★`, "good");
      else if (rating <= 2) log(s, events, `Table ${c.tableId?.slice(1)} left unhappy.`, "bad");
      else if (r() < 0.3) log(s, events, `Table ${c.tableId?.slice(1)} paid ${(spend / 100).toFixed(2)} + tip.`, "money");
      if (r() < 0.25) {
        const dish = content.dishes.find((x) => x.id === c.order[0]);
        const lines: Record<number, string> = { 1: "Waited forever. Never again.", 2: "Food was cold by the time it came.", 3: "Fine. Nothing special.", 4: "Lovely spot, friendly staff.", 5: `The ${dish?.name.toLowerCase() ?? "food"} was incredible!` };
        today.reviews.push({ day: s.day, source: pick(r, ["walkin", "online", "wordofmouth"] as Review["source"][]), rating, text: lines[rating] ?? "", dishId: dish?.id });
      }
    }
  }
  s.tickets = s.tickets.filter((x) => { const c = s.customers.find((y) => y.id === x.customerId); return c && c.stage !== "left"; });

  s.tick += 1;
  if (s.tick >= TICKS) endService(content, s, events, r);
  save(r);
  return { state: s, events };
}

function endService(content: ContentPack, s: GameState, events: SimEvent[], r: () => number) {
  // anyone still in the building leaves happy-ish (doors close)
  for (const c of s.customers) if (c.stage !== "left") { c.stage = "left"; }
  for (const tb of s.tables) { tb.occupiedBy = undefined; tb.dirtyTicks = 0; }
  s.tickets = [];
  const t = s.todays;
  const covers = t.covers ?? 0, revenue = t.revenue ?? 0, food = t.foodCost ?? 0;
  const labour = s.staff.filter((x) => x.rota[s.day % 7]).reduce((a, x) => a + x.wage * 10, 0);
  const district = content.districts.find((d) => d.id === s.districtId);
  const rent = Math.round((district?.monthlyRent ?? 0) / 30);
  const loanPayment = Math.min(s.loan.remaining, s.loan.dailyPayment);
  const waste = { prep: Math.round(food * 0.06), plate: Math.round(food * 0.04), spoil: Math.round(r() * 1500) };
  const profit = revenue + (t.tips ?? 0) - food - labour - rent - loanPayment - waste.prep - waste.plate - waste.spoil;
  const paid = s.customers.filter((c) => !c.walkedOut && c.spend >= 0 && c.order.length);
  const avgRating = paid.length ? paid.reduce((a, c) => a + clamp(c.satisfaction / 20 + 0.4, 1, 5), 0) / paid.length : 3;
  const counts = new Map<string, number>();
  for (const c of paid) for (const d of c.order) counts.set(d, (counts.get(d) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const popBefore = s.reputation.popularity, presBefore = s.reputation.prestige;
  s.reputation.popularity = clamp(s.reputation.popularity + (avgRating * 20 - s.reputation.popularity) * 0.1, 0, 100);
  s.reputation.prestige = clamp(s.reputation.prestige + (avgRating >= 4 ? 1.5 : -0.5), 0, 100);
  const moodDelta: Record<string, number> = {};
  s.staff = s.staff.map((x) => { const d = Math.round((avgRating - 3.2) * 4 + (r() - 0.5) * 4); moodDelta[x.id] = d; return { ...x, mood: clamp(x.mood + d, 0, 100) }; });
  const result: DayResult = {
    day: s.day, covers, walkouts: t.walkouts ?? 0, revenue, tips: t.tips ?? 0, foodCost: food, labourCost: labour, rent, loanPayment, waste, profit,
    averageSpend: covers ? Math.round(revenue / covers) : 0, averageRating: Math.round(avgRating * 10) / 10,
    bestDish: sorted[0]?.[0], worstDish: sorted[sorted.length - 1]?.[0],
    popularityDelta: Math.round((s.reputation.popularity - popBefore) * 10) / 10, prestigeDelta: Math.round((s.reputation.prestige - presBefore) * 10) / 10,
    reviews: t.reviews, staffMoodDelta: moodDelta,
  };
  s.cash += profit;
  s.loan = { ...s.loan, remaining: s.loan.remaining - loanPayment, daysRemaining: Math.max(0, s.loan.daysRemaining - 1) };
  s.history = [...s.history, result];
  s.todays = { ...result };
  s.stats = { totalCovers: s.stats.totalCovers + covers, totalRevenue: s.stats.totalRevenue + revenue, daysOpen: s.stats.daysOpen + 1 };
  s.tick = TICKS;
  events.push({ type: "SERVICE_ENDED", result });
  log(s, events, `Service over: ${covers} covers, profit ${(profit / 100).toFixed(2)}.`, profit >= 0 ? "good" : "bad");
  if (s.cash < 0) events.push({ type: "CASH_LOW", cash: s.cash });
  if (s.difficulty !== "cosy" && s.cash < -500000) {
    s.phase = "gameover";
    s.gameOverReason = "The bank has called in the loan. You ran out of cash.";
    events.push({ type: "GAME_OVER", reason: s.gameOverReason });
  } else {
    if (s.difficulty === "cosy" && s.cash < 0) s.cash = 0;
    s.phase = "evening";
  }
}

export function runDay(content: ContentPack, state: GameState): StepResult {
  let res = applyCommand(content, state, { type: "START_SERVICE" });
  const events = [...res.events];
  while (res.state.phase === "service") { res = tick(content, res.state); events.push(...res.events); }
  return { state: res.state, events };
}

export function serialize(state: GameState): string { return JSON.stringify(state); }
export function deserialize(json: string): GameState {
  const s = JSON.parse(json) as GameState;
  if (s?.version !== 1) throw new Error("Unsupported save version");
  return s;
}
