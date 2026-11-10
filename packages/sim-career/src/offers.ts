/**
 * Job offers from other restaurants. Rolled once a day from (career.seed, day); more frequent with reputation and
 * when out of work. An offer is the same rung (a better wage, a different owner and district) or a rung up when
 * your reputation and skill are close to the next rung's criteria.
 */
import type { ContentPack } from "@full-plate/sim-core";
import {
  JOB_HUNT_CHANCE,
  MAX_OFFERS,
  OFFER_BASE_CHANCE,
  OFFER_REPUTATION_DIV,
  OFFER_STEP_UP_REPUTATION,
  OFFER_STEP_UP_SLACK,
  OFFER_TTL_DAYS,
  OWNER_NAMES,
  RESTAURANT_NAMES,
} from "./constants";
import { rungDef, rungWage, topRung, trackStat } from "./ladder";
import { hashSeed, Rng } from "./rng";
import type { CareerState, Offer, OwnerStrategy } from "./types";

const OFFER_SALT = 0x0ffe;
export const TRACK_SALT: Record<CareerState["track"], number> = { chef: 11, bar: 23, waiter: 37, manager: 51 };
/** Unemployed this many days ⇒ an offer is guaranteed. */
export const GUARANTEED_OFFER_IDLE_DAYS = 4;

const STRATEGIES: readonly OwnerStrategy[] = ["balanced", "cheap", "premium"];

const PITCHES: Record<OwnerStrategy, string[]> = {
  balanced: ["A friendly local place that's always busy.", "We heard good things about you from a regular.", "Steady hours, fair shared tips, a team that sticks around."],
  cheap: ["Long hours, but there's plenty of overtime.", "We're busy and we need hands now.", "Not fancy, but it's cash in your pocket."],
  premium: ["We want people who care about every plate.", "High standards, great tips, serious training.", "A kitchen people talk about. Come and learn."],
};

/** Chance of an offer today. */
export function offerChance(career: CareerState, idleDays: number): number {
  if (career.employer.status !== "employed") return idleDays >= GUARANTEED_OFFER_IDLE_DAYS ? 1 : JOB_HUNT_CHANCE;
  return OFFER_BASE_CHANCE + career.reputation / OFFER_REPUTATION_DIV;
}

/** Rung an employer would hire you at: a step up when you're nearly ready for it and well known. */
export function offerRung(career: CareerState): number {
  const next = career.rung + 1;
  if (next > topRung(career.track)) return career.rung;
  const c = rungDef(career.track, next).criteria!;
  const close = trackStat(career.track, career.stats) >= c.stat - OFFER_STEP_UP_SLACK;
  return close && career.reputation >= Math.max(OFFER_STEP_UP_REPUTATION, c.reputation ?? 0) ? next : career.rung;
}

/** Builds today's offer (deterministic). */
export function makeOffer(content: ContentPack, career: CareerState): Offer {
  const rng = Rng.fromSeed(hashSeed(career.seed, career.day, OFFER_SALT, 1, TRACK_SALT[career.track]));
  const others = STRATEGIES.filter((s) => s !== career.owner.strategy || career.employer.status !== "employed");
  const strategy = rng.weighted(others, others.map((s) => (s === "cheap" ? 0.8 : s === "premium" ? 1 + career.reputation / 50 : 1.2))) ?? "balanced";
  const districts = content.districts.filter((d) => d.id !== career.employer.districtId);
  const districtId = (districts.length ? rng.pick(districts) : content.districts[0]!).id;
  const rung = offerRung(career);
  const base = rungWage(career.track, rung, strategy);
  const premium = rung > career.rung ? 1 : 1.03 + rng.int(0, 4) / 100;
  const wage = Math.max(base, Math.round(Math.max(base, career.wage) * premium));
  const restaurantName = rng.pick(RESTAURANT_NAMES.filter((n) => n !== career.employer.restaurantName));
  return {
    id: `o${career.day}`,
    restaurantName,
    ownerName: rng.pick(OWNER_NAMES.filter((n) => n !== career.owner.name)),
    strategy,
    districtId,
    track: career.track,
    rung,
    wage,
    madeDay: career.day,
    expiresDay: career.day + OFFER_TTL_DAYS,
    seed: hashSeed(career.seed, career.day, OFFER_SALT, 2, TRACK_SALT[career.track]),
    pitch: `${rng.pick(PITCHES[strategy])} ${rung > career.rung ? `They'd take you on as ${rungDef(career.track, rung).title.toLowerCase()}.` : ""}`.trim(),
  };
}

/** Today's offer roll: expired offers drop off; at most MAX_OFFERS are open. */
export function rollOffers(content: ContentPack, career: CareerState, idleDays: number): { offers: Offer[]; expired: Offer[]; made?: Offer } {
  const expired = career.offers.filter((o) => o.expiresDay <= career.day);
  let offers = career.offers.filter((o) => o.expiresDay > career.day);
  const rng = Rng.fromSeed(hashSeed(career.seed, career.day, OFFER_SALT, 0, TRACK_SALT[career.track]));
  if (offers.length >= MAX_OFFERS || career.handover || !rng.chance(offerChance(career, idleDays))) return { offers, expired };
  const made = makeOffer(content, career);
  offers = [...offers, made];
  return { offers, expired, made };
}

/** Is this offer an improvement worth taking (used by auto-play and as a UI hint)? */
export function offerIsBetter(career: CareerState, o: Offer): boolean {
  if (career.employer.status !== "employed") return true;
  if (o.rung > career.rung) return true;
  return o.wage >= Math.round(career.wage * 1.08) && !(o.strategy === "cheap" && career.owner.strategy !== "cheap");
}
