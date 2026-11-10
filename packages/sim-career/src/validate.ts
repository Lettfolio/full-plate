/**
 * Round 11: the CareerState schema for loaded saves (red-team S3). Applied by the game to `deserializeCareer`'s result;
 * see sim-core/validate.ts for the rules. Throws a SchemaError.
 */
import { arr, BIG, bool, day, id, money, name, num, obj, oneOf, opt, pct100, text } from "@full-plate/sim-core/schema";
import { dayResultSchema, staffSchema } from "@full-plate/sim-core/validate";
import { LOG_MAX } from "./constants";
import type { CareerState } from "./types";

const n = num();
const track = oneOf("chef", "bar", "waiter", "manager");
const strategy = oneOf("balanced", "cheap", "premium");
const role = oneOf("chef", "server", "bar", "porter", "manager");
const difficulty = oneOf("cosy", "normal", "hard");
const many = 2000;

const handover = obj({
  day, restaurantName: name(40), districtId: id, track, rungTitle: name(80), savingsIn: money, loan: money, cashAtOpening: money,
  perks: arr(obj({
    id: oneOf("colleague", "drinks_menu", "hire_rebate", "regulars", "reputation", "savings", "owner_skills"),
    label: text, detail: text, via: oneOf("command", "state", "wrapper", "needs_hook"),
  }), 50),
  colleague: opt(obj({ staffId: id, name: name(40), role, wage: money, discountPct: num(0, 1) })),
  hireRebates: n, hireRebateEach: money,
});

export const ownerPerksSchema = obj({ hireRebatesLeft: n, hireRebateEach: money });
export const handoverSchema = handover;

const careerState = obj<CareerState>({
  version: oneOf(1),
  seed: num(-BIG, BIG),
  track, role,
  rung: num(0, 100),
  playerStaffId: id,
  playerName: name(40),
  look: opt(num(0, 1000)),
  day,
  stats: obj({ skill: pct100, speed: pct100, charm: pct100 }),
  mood: pct100, stress: pct100, fatigue: pct100,
  savings: money, wage: money, reputation: n,
  relationships: arr(obj({
    staffId: id, name: name(40), role, bond: n, tag: opt(oneOf("mentor", "rival")), employer: name(80), current: bool,
    sharedShifts: n, snapshot: staffSchema, wasHeadChef: opt(bool),
  }), many),
  mentor: opt(id),
  rival: opt(id),
  weeklyReview: arr(obj({
    day, week: n, score: n, reviewer: name(80), reviewerRole: oneOf("owner", "mentor"), notes: arr(text, 100),
    breakdown: obj({ rating: n, reliability: n, growth: n, business: n, incidents: n }),
    shifts: n, contractShifts: n, statGain: n, tips: money, mood: n, fatigue: n, incidentsHandled: n,
  }), 1000),
  payslips: arr(obj({ day, wages: money, tips: money, bonus: money, tax: money, ni: money, living: money, saved: money }), 1000),
  offers: arr(obj({
    id, restaurantName: name(40), ownerName: name(40), strategy, districtId: id, track, rung: num(0, 100), wage: money,
    madeDay: day, expiresDay: day, seed: num(-BIG, BIG), pitch: text,
  }), 100),
  shiftsWorked: n, shiftsAtRung: n, promotionsEarned: n, promotionsLost: n,
  shiftPlan: arr(bool, 7),
  burnoutUntil: opt(day),
  canOpenOwn: bool,
  canOpenSinceDay: opt(day),
  owner: obj({ name: name(40), strategy, mood: pct100 }),
  employer: obj({ restaurantName: name(40), districtId: id, seed: num(-BIG, BIG), difficulty, status: oneOf("employed", "closed", "fired", "left") }),
  week: obj({
    startDay: day, statStart: n, workedDays: arr(n, 400), results: arr(dayResultSchema, 400), workedSimDays: arr(n, 400),
    contractShifts: n, contractDeclined: n, excused: n, weekendShifts: n, wagesGross: money, tips: money, profit: money,
    incidentsHandled: n, incidentsIgnored: n, mentorShifts: n, peakStress: n,
    handsOn: opt(obj({ shifts: n, stars: n, quality: n })),
  }),
  cooldowns: obj({ promotionAsk: opt(day), raise: opt(day), mentorSession: opt(day), poach: opt(day) }),
  lastTrainedDay: opt(day),
  trainingSimDay: opt(day),
  jobs: arr(obj({
    restaurantName: name(40), ownerName: name(40), strategy, districtId: id, fromDay: day, toDay: opt(day), fromRung: n, toRung: opt(n),
    leftBecause: opt(oneOf("offer", "closed", "fired", "opened_own")),
  }), many),
  lifetime: obj({
    wages: money, tips: money, bonus: money, tax: money, ni: money, living: money, incidentsHandled: n, weekendShifts: n,
    declinedShifts: n, trainingDays: n, mentorSessions: n,
  }),
  log: arr(obj({ day, text, kind: oneOf("info", "good", "bad", "money") }), LOG_MAX * 5),
  handover: opt(handover),
  ownerPerks: opt(ownerPerksSchema),
}, false);

/** A loaded CareerState, checked and cleaned (throws SchemaError). */
export function validateCareerState(raw: unknown): CareerState {
  return careerState(raw, "career");
}
