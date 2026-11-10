/** The rung ladder: track stats, rung lookups, wages and the visible promotion checklist. */
import { formatPence, formatPounds } from "@full-plate/sim-core";
import type { Staff, StaffRole } from "@full-plate/sim-core";
import { LADDER, NLW, OWNERS, PROMOTION_ASK_COOLDOWN, REVIEWS_FOR_AVG, START_STATS } from "./constants";
import type { CareerState, CareerTrack, ChecklistItem, PlayerStats, PromotionChecklist, PromotionCriteria, RungDef } from "./types";

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const round2 = (x: number): number => Math.round(x * 100) / 100;
export const pounds = (p: number): string => formatPounds(p);
export const perHour = (p: number): string => `${formatPence(p)}/h`;

export function rungsOf(track: CareerTrack): readonly RungDef[] {
  return LADDER[track];
}

export function rungDef(track: CareerTrack, rung: number): RungDef {
  const rungs = LADDER[track];
  return rungs[clamp(rung, 0, rungs.length - 1)]!;
}

export const topRung = (track: CareerTrack): number => LADDER[track].length - 1;

/** What the track rewards: chefs cook (skill), waiters charm, bar and management need both. */
export function trackStat(track: CareerTrack, s: Pick<PlayerStats, "skill" | "charm">): number {
  if (track === "chef") return s.skill;
  if (track === "waiter") return s.charm;
  return (s.skill + s.charm) / 2;
}

export const trackStatName = (track: CareerTrack): string =>
  track === "chef" ? "Cooking skill" : track === "waiter" ? "Hospitality (charm)" : track === "bar" ? "Bar craft (skill + charm)" : "Leadership (skill + charm)";

/** Roles that work beside you and compete with you for the same promotions. */
export function departmentRoles(track: CareerTrack): readonly StaffRole[] {
  if (track === "chef") return ["chef"];
  if (track === "waiter") return ["server", "manager"];
  if (track === "bar") return ["bar", "manager"];
  return ["manager"];
}

/** A co-worker's standing on your track's stat (they are judged the same way you are). */
export const coworkerStat = (track: CareerTrack, s: Pick<Staff, "skill" | "charm">): number => trackStat(track, s);

/** Rung wage at an owner, never below the National Living Wage. */
export function rungWage(track: CareerTrack, rung: number, strategy: CareerState["owner"]["strategy"]): number {
  return Math.max(NLW, Math.round(rungDef(track, rung).wage * OWNERS[strategy].wageMult));
}

/** The stat a rung expects you to have (its criteria, or the start stat for rung 0). */
export function rungFloorStat(track: CareerTrack, rung: number): number {
  return rungDef(track, rung).criteria?.stat ?? trackStat(track, START_STATS[track]);
}

/** Mean of the last REVIEWS_FOR_AVG weekly review scores (0 with none). */
export function reviewAverage(career: Pick<CareerState, "weeklyReview">): number {
  const last = career.weeklyReview.slice(-REVIEWS_FOR_AVG);
  return last.length ? round2(last.reduce((a, r) => a + r.score, 0) / last.length) : 0;
}

const LABELS: Record<keyof PromotionCriteria, string> = {
  stat: "Skill",
  shiftsAtRung: "Shifts at this rung",
  reviewAvg: `Average review (last ${REVIEWS_FOR_AVG})`,
  ownerMood: "Owner's confidence",
  reputation: "Industry reputation",
};

/** The visible promotion checklist for the next rung. */
export function promotionChecklist(career: CareerState): PromotionChecklist {
  const next = career.rung + 1;
  const rungs = LADDER[career.track];
  if (next >= rungs.length) return { items: [], ready: false, note: "Top of the ladder here. Next step: your own place." };
  const def = rungs[next]!;
  const c = def.criteria!;
  const values: Record<keyof PromotionCriteria, number> = {
    stat: round2(trackStat(career.track, career.stats)),
    shiftsAtRung: career.shiftsAtRung,
    reviewAvg: reviewAverage(career),
    ownerMood: round2(career.owner.mood),
    reputation: round2(career.reputation),
  };
  const items: ChecklistItem[] = [];
  for (const key of Object.keys(LABELS) as (keyof PromotionCriteria)[]) {
    const target = c[key];
    if (target === undefined) continue;
    const label = key === "stat" ? trackStatName(career.track) : LABELS[key];
    items.push({ key, label, current: values[key], target, met: values[key] >= target });
  }
  const ready = items.every((i) => i.met) && career.employer.status === "employed";
  const note =
    career.employer.status !== "employed"
      ? "You need a job to be promoted."
      : career.cooldowns.poach !== undefined && career.day < career.cooldowns.poach
        ? `The last promotion went to someone else. The owner will look again from day ${career.cooldowns.poach + 1}.`
        : undefined;
  return { nextRung: next, nextTitle: def.title, items, ready: ready && !note, ...(note ? { note } : {}) };
}

export const canAskPromotion = (career: CareerState): boolean =>
  career.cooldowns.promotionAsk === undefined || career.day >= career.cooldowns.promotionAsk + PROMOTION_ASK_COOLDOWN;
