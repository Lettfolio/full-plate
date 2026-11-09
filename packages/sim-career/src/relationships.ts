/**
 * Co-workers: bonds grow on shared shifts (traits and good services help), a mentor speeds your growth, a rival
 * competes for your promotions. Former colleagues are kept (with a Staff snapshot) so the handover can hire one.
 */
import type { DayResult, GameState, Staff } from "@full-plate/sim-core";
import {
  BOND_NOISE,
  BOND_PER_SHARED_SHIFT,
  BOND_RATING_WEIGHT,
  BOND_RIVAL_DRIFT,
  BOND_TRAIT,
  COMPETITIVE_TRAITS,
  FORMER_BOND_DECAY,
  MENTOR_BOND,
  MENTOR_KEEP_SLACK,
  OWNER_MENTOR_KEEP_MOOD,
  MENTOR_SKILL_GAP,
  OWNER_MENTOR_MOOD,
  RIVAL_BOND,
  RIVAL_SKILL_BAND,
} from "./constants";
import { clamp, coworkerStat, departmentRoles, round2, trackStat } from "./ladder";
import { PLAYER_ID, workedOn } from "./money";
import { hashSeed, Rng } from "./rng";
import type { CareerState, Relationship } from "./types";

const BOND_SALT = 0xb0bd;

/** FNV-1a of a string (deterministic id → number for seeding). */
export function strHash(x: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

/** Adds new co-workers and refreshes snapshots; colleagues who left the restaurant become former. */
export function syncRelationships(career: CareerState, state: GameState): Relationship[] {
  const here = new Map(state.staff.filter((s) => s.id !== PLAYER_ID).map((s) => [s.id, s]));
  const employer = career.employer.restaurantName;
  const out: Relationship[] = [];
  const seen = new Set<string>();
  for (const r of career.relationships) {
    if (r.current) {
      const s = here.get(r.staffId);
      seen.add(r.staffId);
      out.push(s ? { ...r, snapshot: s, role: s.role } : { ...r, current: false, tag: undefined });
    } else out.push(r);
  }
  for (const [id, s] of here) {
    if (seen.has(id)) continue;
    out.push({ staffId: id, name: s.name, role: s.role, bond: 0, employer, current: true, sharedShifts: 0, snapshot: s });
  }
  return out;
}

/** Bond changes from one shared shift (deterministic per career seed, day and co-worker). */
export function bondDelta(career: CareerState, r: Relationship, result: DayResult): number {
  const rng = Rng.fromSeed(hashSeed(career.seed, career.day, BOND_SALT, r.sharedShifts, strHash(r.staffId)));
  let d = BOND_PER_SHARED_SHIFT;
  for (const t of r.snapshot.traits) d += BOND_TRAIT[t] ?? 0;
  if (result.covers > 0) d += (result.averageRating - 3.5) * BOND_RATING_WEIGHT;
  if (r.tag === "rival") d += BOND_RIVAL_DRIFT;
  d += rng.gaussian(0, BOND_NOISE);
  return d;
}

/** Bonds after a day: shared shifts move bonds; former colleagues fade on review days (weekly). */
export function updateBonds(career: CareerState, state: GameState, result: DayResult, playerWorked: boolean, reviewDay: boolean): Relationship[] {
  const working = new Set(workedOn(state, result.day).map((s) => s.id));
  return career.relationships.map((r) => {
    if (r.current && playerWorked && working.has(r.staffId)) {
      return { ...r, bond: round2(clamp(r.bond + bondDelta(career, r, result), -100, 100)), sharedShifts: r.sharedShifts + 1 };
    }
    if (!r.current && reviewDay && r.bond !== 0) return { ...r, bond: round2(r.bond * (1 - FORMER_BOND_DECAY)) };
    return r;
  });
}

/** Your mentor: the best-bonded current co-worker clearly better at your track; the owner mentors managers. */
export function findMentor(career: CareerState): CareerState["mentor"] {
  const me = trackStat(career.track, career.stats);
  const dept = departmentRoles(career.track);
  const ahead = (r: Relationship, gap: number) => coworkerStat(career.track, r.snapshot) >= me + gap;
  const current = career.relationships.find((r) => r.current && r.staffId === career.mentor);
  if (current && current.bond >= MENTOR_BOND - MENTOR_KEEP_SLACK && ahead(current, MENTOR_SKILL_GAP / 2)) return current.staffId;
  const candidates = career.relationships
    .filter((r) => r.current && r.tag !== "rival" && dept.includes(r.role) && r.bond >= MENTOR_BOND && ahead(r, MENTOR_SKILL_GAP))
    .sort((a, b) => b.bond - a.bond || a.staffId.localeCompare(b.staffId));
  if (candidates[0]) return candidates[0].staffId;
  const ownerOk = career.track === "manager" && career.employer.status === "employed";
  if (ownerOk && career.owner.mood >= (career.mentor === "owner" ? OWNER_MENTOR_KEEP_MOOD : OWNER_MENTOR_MOOD)) return "owner";
  return undefined;
}

/** Your rival: a current co-worker in your department at about your level who is ambitious or doesn't like you. */
export function findRival(career: CareerState): string | undefined {
  const me = trackStat(career.track, career.stats);
  const dept = departmentRoles(career.track);
  const candidates = career.relationships
    .filter(
      (r) =>
        r.current &&
        r.staffId !== career.mentor &&
        dept.includes(r.role) &&
        Math.abs(coworkerStat(career.track, r.snapshot) - me) <= RIVAL_SKILL_BAND &&
        (r.snapshot.traits.some((t) => COMPETITIVE_TRAITS.includes(t)) || r.bond < RIVAL_BOND),
    )
    .sort((a, b) => Math.abs(coworkerStat(career.track, a.snapshot) - me) - Math.abs(coworkerStat(career.track, b.snapshot) - me) || a.staffId.localeCompare(b.staffId));
  return candidates[0]?.staffId;
}

/** Re-tags mentor/rival on the relationship list. */
export function tagRelationships(rels: readonly Relationship[], mentor: CareerState["mentor"], rival: string | undefined): Relationship[] {
  return rels.map((r) => {
    const tag = r.staffId === mentor && r.current ? "mentor" : r.staffId === rival && r.current ? "rival" : undefined;
    if (tag === r.tag) return r;
    const { tag: _old, ...rest } = r;
    return tag ? { ...rest, tag } : rest;
  });
}

/** The chef the player answers to: the most skilled chef co-worker (the head chef from the player's point of view). */
export function headChefOf(state: GameState): Staff | undefined {
  return state.staff
    .filter((s) => s.role === "chef" && s.id !== PLAYER_ID)
    .sort((a, b) => b.skill - a.skill || a.id.localeCompare(b.id))[0];
}

export const relationshipName = (career: CareerState, id: string | undefined): string | undefined =>
  id === "owner" ? career.owner.name : career.relationships.find((r) => r.staffId === id)?.name;
