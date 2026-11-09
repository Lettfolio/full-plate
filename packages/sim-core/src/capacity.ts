/**
 * [round 3, Empire calibration] Closed-form demand and capacity of one restaurant, from the sim's own physics.
 *
 * sim-empire's aggregate model uses these so a modelled site produces what this sim would produce for the same
 * district, menu, prices, tables and crew (EMPIRE-NOTES §3). Nothing here is used by the tick pipeline.
 *
 *   demand   = Σ segment: potentialParties × share × sigmoid(entryLogit) × E[party size]   (no queue penalty)
 *   seats    = tables × TURNS × meanParty × (seatsPerTable / 4)
 *   crew     = CREW_COVERS × crewUnits × (1 + SKILL_SLOPE × (skill − 50)/100)
 *   capacity = (seats^−k + crew^−k)^(−1/k) × (0.44 / peakShare)^0.3   (soft minimum; lunch-rush districts turn less)
 *   covers   = demand / √(1 + (demand / capacity)²)        (softCap: queues, walk-outs and turned-away parties)
 *
 * The constants were fitted to the sim itself (a 4-person crew, 6–10 tables, all four districts, saturated demand;
 * RMS error 3%), and test/capacity.test.ts replays the sim to keep them honest when the physics change.
 */
import { COURSE_ORDER_CHANCE, DIFFICULTY } from "./constants";
import { entryLogit, offeredDishes, setOfferFor } from "./systems/arrival";
import { dishWeight } from "./systems/order";
import type { ContentPack, DistrictId, GameState, MenuItem } from "./types";
import { clamp, findDish, findSegment, isWeekend, monthOf, onShift, plateCost, sigmoid } from "./util";

export const CAPACITY = {
  /** Table turns per service, at the content's mean party size (fitted: ~102 seating ticks ÷ ~13-tick dwell). */
  turnsPerService: 7.7,
  /** Covers one chef + one server pair can turn out in a service at skill 50. */
  crewCovers: 136,
  /** Crew capacity per skill point above/below 50 (per 100 points). */
  skillSlope: 0.5,
  /** Sharpness of the soft minimum between seats and crew. */
  softMinK: 3,
  /** Reference table size the fit was made with. */
  refSeatsPerTable: 4,
  /**
   * Arrival peakiness: share of the day's parties arriving in the busiest PEAK_WINDOW ticks. A lunch-rush district
   * (business park ~0.61) turns fewer covers than the high street (~0.44) at the same seats: capacity × (ref/peak)^exp.
   */
  peakWindowTicks: 30,
  refPeakShare: 0.44,
  peakExp: 0.3,
} as const;

/** What a restaurant is, for demand and capacity, without a full GameState. */
export interface DemandSpec {
  districtId: DistrictId;
  menu: readonly MenuItem[];
  day: number;
  popularity: number;
  prestige?: number;
  difficulty?: GameState["difficulty"];
  /** Product of footfall multipliers (events, the Empire's brand pull). Default 1. */
  footfallMult?: number;
  setMenu?: GameState["setMenu"];
}

export interface DemandEstimate {
  /** Expected covers walking in today if there were always a free table. */
  covers: number;
  /** Expected parties walking in. */
  parties: number;
  /** Mean size of the parties that walk in. */
  meanParty: number;
  /** Share of those parties arriving in the busiest CAPACITY.peakWindowTicks ticks. */
  peakShare: number;
  /** Expected menu spend per cover (pence) from the order model: one main plus each course × its order chance. */
  spendPerCover: number;
  /** Expected ingredient cost per cover (pence, base unit costs; no seasonality, waste or plate waste). */
  foodPerCover: number;
}

function meanPartyOf(weights: readonly number[], maxSeats: number): number {
  const w = weights.slice(0, Math.max(1, maxSeats));
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) return 1;
  return w.reduce((a, v, i) => a + v * (i + 1), 0) / total;
}

/** Expected unconstrained demand (no queue penalty, no seat limit) for a restaurant spec on spec.day. */
export function marketDemand(content: ContentPack, spec: DemandSpec): DemandEstimate {
  const district = content.districts.find((d) => d.id === spec.districtId) ?? content.districts[0];
  if (!district) return { covers: 0, parties: 0, meanParty: 1, peakShare: CAPACITY.refPeakShare, spendPerCover: 0, foodPerCover: 0 };
  const pseudo = { menu: spec.menu, eightySixed: [], setMenu: spec.setMenu } as unknown as GameState;
  const offered = offeredDishes(content, pseudo);
  const season = district.seasonCurve[monthOf(spec.day) - 1] ?? 1;
  const weekend = isWeekend(spec.day) ? content.balance.weekendFootfallMult : 1;
  const diff = DIFFICULTY[spec.difficulty ?? "normal"]?.footfallMult ?? 1;
  const potential = district.footfall * season * (0.5 + spec.popularity / 100) * (spec.footfallMult ?? 1) * weekend * diff;
  let parties = 0;
  let covers = 0;
  let spend = 0;
  let food = 0;
  const curve: number[] = [];
  for (const [segId, share] of Object.entries(district.segmentMix)) {
    const seg = findSegment(content, segId);
    if (!seg || share <= 0) continue;
    const set = setOfferFor(content, pseudo, segId);
    const p = sigmoid(entryLogit(seg, offered, spec.prestige ?? 30, set));
    const n = potential * share * p;
    parties += n;
    const segCovers = n * meanPartyOf(seg.partySizeWeights, content.balance.seatsPerTable);
    covers += segCovers;
    const basket = expectedBasket(content, offered, seg);
    spend += segCovers * basket.spend;
    food += segCovers * basket.food;
    const total = seg.arrivalCurve.reduce((a, v) => a + v, 0) || 1;
    seg.arrivalCurve.forEach((v, i) => (curve[i] = (curve[i] ?? 0) + (n * v) / total));
  }
  return {
    covers,
    parties,
    meanParty: parties > 0 ? covers / parties : 1,
    peakShare: peakShareOf(curve, parties),
    spendPerCover: covers > 0 ? spend / covers : 0,
    foodPerCover: covers > 0 ? food / covers : 0,
  };
}

/** Expected spend and ingredient cost of one guest of a segment (the OrderSystem's choice model, in expectation). */
function expectedBasket(content: ContentPack, offered: ReturnType<typeof offeredDishes>, seg: Parameters<typeof dishWeight>[1]): { spend: number; food: number } {
  const pools = new Map<string, typeof offered>();
  for (const o of offered) pools.set(o.dish.course, [...(pools.get(o.dish.course) ?? []), o]);
  const pick = (pool: typeof offered) => {
    let w = 0;
    let p = 0;
    let f = 0;
    for (const o of pool) {
      const x = dishWeight(o, seg);
      w += x;
      p += x * o.item.price;
      f += x * plateCost(content, o.dish);
    }
    return w > 0 ? { spend: p / w, food: f / w } : { spend: 0, food: 0 };
  };
  const mains = pools.get("main") ?? [];
  const first = pick(mains.length ? mains : offered);
  if (!mains.length) return first;
  let spend = first.spend;
  let food = first.food;
  for (const course of Object.keys(COURSE_ORDER_CHANCE)) {
    const pool = pools.get(course);
    if (!pool) continue;
    const c = COURSE_ORDER_CHANCE[course] ?? 0;
    const b = pick(pool);
    spend += c * b.spend;
    food += c * b.food;
  }
  return { spend, food };
}

function peakShareOf(curve: readonly number[], total: number): number {
  if (total <= 0 || curve.length === 0) return CAPACITY.refPeakShare;
  const w = Math.min(CAPACITY.peakWindowTicks, curve.length);
  let run = 0;
  for (let i = 0; i < w; i++) run += curve[i] ?? 0;
  let best = run;
  for (let i = w; i < curve.length; i++) {
    run += (curve[i] ?? 0) - (curve[i - w] ?? 0);
    if (run > best) best = run;
  }
  return clamp(best / total, 0.05, 1);
}

/** Unconstrained expected demand for a live restaurant today (its menu, popularity and footfall mods). */
export function expectedDemand(content: ContentPack, state: GameState): DemandEstimate {
  return marketDemand(content, {
    districtId: state.districtId,
    menu: state.menu.filter((m) => !(state.eightySixed ?? []).includes(m.dishId)),
    day: state.day,
    popularity: state.reputation.popularity,
    prestige: state.reputation.prestige,
    difficulty: state.difficulty,
    footfallMult: state.footfallMods.reduce((m, f) => m * f.mult, 1),
    setMenu: state.setMenu,
  });
}

/** Seats and crew, for capacity. */
export interface CapacitySpec {
  tables: number;
  seatsPerTable?: number;
  meanParty: number;
  /** Front-and-back pairs on shift: (chefs + servers) / 2, the owner covering a missing role counts 0.5. */
  crewUnits: number;
  /** Mean skill of the crew on shift (0–100). */
  crewSkill: number;
  /** Arrival peakiness (DemandEstimate.peakShare); default the reference. */
  peakShare?: number;
}

/** Covers per service the room and crew can turn out when demand never runs dry. */
export function capacityCovers(spec: CapacitySpec): number {
  const seatsPer = spec.seatsPerTable ?? CAPACITY.refSeatsPerTable;
  const seats = Math.max(0, spec.tables) * CAPACITY.turnsPerService * spec.meanParty * (seatsPer / CAPACITY.refSeatsPerTable);
  const crew = CAPACITY.crewCovers * Math.max(0.25, spec.crewUnits) * Math.max(0.3, 1 + (CAPACITY.skillSlope * (clamp(spec.crewSkill, 0, 100) - 50)) / 100);
  if (seats <= 0) return 0;
  const k = CAPACITY.softMinK;
  const peak = (CAPACITY.refPeakShare / clamp(spec.peakShare ?? CAPACITY.refPeakShare, 0.05, 1)) ** CAPACITY.peakExp;
  return (seats ** -k + crew ** -k) ** (-1 / k) * peak;
}

/** Covers served when `demand` meets `capacity`: smooth, ≈ demand when quiet, → capacity when overrun. */
export function softCap(demand: number, capacity: number): number {
  if (demand <= 0 || capacity <= 0) return 0;
  return demand / Math.sqrt(1 + (demand / capacity) ** 2);
}

/** Inverse of softCap: the demand that would produce `covers` (the ratio is clipped at `maxRatio` of capacity). */
export function uncapped(covers: number, capacity: number, maxRatio = 0.92): number {
  if (covers <= 0 || capacity <= 0) return Math.max(0, covers);
  const r = Math.min(maxRatio, covers / capacity);
  return covers / Math.sqrt(1 - r * r);
}

/** Crew units and mean skill on shift today (owner covers a missing chef or server at half a unit, skill 40). */
export function crewOnShift(state: GameState): { crewUnits: number; crewSkill: number } {
  const chefs = onShift(state, "chef");
  const servers = onShift(state, "server");
  const people = [...chefs, ...servers];
  const units = (Math.max(chefs.length, 0.5) + Math.max(servers.length, 0.5)) / 2;
  const skill = people.length ? people.reduce((a, s) => a + s.skill, 0) / people.length : 40;
  return { crewUnits: units, crewSkill: skill };
}

/** Today's closed-form capacity for a live restaurant (its tables, district parties and the crew on shift). */
export function serviceCapacity(content: ContentPack, state: GameState): number {
  const d = expectedDemand(content, state);
  return capacityCovers({ tables: state.tables.length, seatsPerTable: content.balance.seatsPerTable, meanParty: d.meanParty, peakShare: d.peakShare, ...crewOnShift(state) });
}

/** Mean price of the menu relative to suggested (1 = at suggested); handy for model price indices. */
export function menuPriceIndex(content: ContentPack, menu: readonly MenuItem[]): number {
  let p = 0;
  let s = 0;
  for (const m of menu) {
    if (!m.active) continue;
    const d = findDish(content, m.dishId);
    if (!d) continue;
    p += m.price;
    s += d.suggestedPrice;
  }
  return s > 0 ? p / s : 1;
}
