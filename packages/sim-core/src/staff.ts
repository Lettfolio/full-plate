/** Candidate generation (deterministic from seed + day) and hiring. */
import {
  CANDIDATE_CORE_ROLES,
  CANDIDATES_MAX,
  CANDIDATES_MIN,
  DEFAULT_ROTA,
  POTENTIAL_HEADROOM,
  POTENTIAL_HINTS,
  START_MOOD,
} from "./constants";
import { hashSeed, Rng } from "./rng";
import type { Candidate, ContentPack, GameState, Staff, StaffArchetypeDef } from "./types";
import { findTrait, traitMult } from "./util";

/** Salt so candidate draws never correlate with the main game stream. */
const CANDIDATE_SALT = 0x5ca1ab1e;

export const potentialHint = (potential: number): string =>
  POTENTIAL_HINTS.find((h) => potential >= h.min)?.label ?? "limited";

function drawTraits(rng: Rng, content: ContentPack, pool: readonly string[]): string[] {
  const valid = pool.filter((id) => findTrait(content, id));
  return rng.shuffle(valid).slice(0, Math.min(valid.length, rng.int(1, 3)));
}

interface Drawn {
  candidate: Candidate;
  potential: number;
}

function drawCandidate(rng: Rng, content: ContentPack, a: StaffArchetypeDef): Drawn {
  const traits = drawTraits(rng, content, a.traits);
  const skill = rng.int(a.skillRange[0], a.skillRange[1]);
  const wageBase = rng.int(a.wageRange[0], a.wageRange[1]);
  const potential = Math.min(100, skill + rng.int(0, POTENTIAL_HEADROOM));
  return {
    potential,
    candidate: {
      name: rng.pick(a.nameSamples.length ? a.nameSamples : ["Sam"]),
      role: a.role,
      skill,
      speed: rng.int(a.speedRange[0], a.speedRange[1]),
      charm: rng.int(a.charmRange[0], a.charmRange[1]),
      wage: Math.max(a.wageRange[0], Math.round(wageBase * traitMult(content, traits, "wageDemand"))),
      traits,
      potentialHint: potentialHint(potential),
    },
  };
}

/** Archetypes for each candidate slot: core roles first (if present), then random. */
function slotArchetypes(rng: Rng, content: ContentPack, count: number): StaffArchetypeDef[] {
  const all = content.staffArchetypes;
  const slots: StaffArchetypeDef[] = [];
  for (const role of CANDIDATE_CORE_ROLES) {
    const ofRole = all.filter((a) => a.role === role);
    if (ofRole.length && slots.length < count) slots.push(rng.pick(ofRole));
  }
  while (slots.length < count) slots.push(rng.pick(all));
  return slots;
}

function drawAll(content: ContentPack, state: GameState): Drawn[] {
  if (content.staffArchetypes.length === 0) return [];
  const rng = Rng.fromSeed(hashSeed(state.seed, state.day, CANDIDATE_SALT));
  const count = rng.int(CANDIDATES_MIN, CANDIDATES_MAX);
  return slotArchetypes(rng, content, count).map((a) => drawCandidate(rng, content, a));
}

/** Today's candidate pool; indices are stable all day, hired ones are flagged. */
export function candidates(content: ContentPack, state: GameState): Candidate[] {
  const hired = state.hiredCandidates ?? [];
  return drawAll(content, state).map((d, i) => (hired.includes(i) ? { ...d.candidate, hired: true } : d.candidate));
}

/** Converts candidate `index` into a Staff member (no validation). */
export function staffFromCandidate(content: ContentPack, state: GameState, index: number): Staff | undefined {
  const d = drawAll(content, state)[index];
  if (!d) return undefined;
  const c = d.candidate;
  return {
    id: `s${state.day}-${index}`,
    name: c.name,
    role: c.role,
    skill: c.skill,
    speed: c.speed,
    charm: c.charm,
    wage: c.wage,
    mood: START_MOOD,
    fatigue: 0,
    traits: c.traits,
    hiredDay: state.day,
    potential: d.potential,
    rota: DEFAULT_ROTA.slice(),
  };
}
