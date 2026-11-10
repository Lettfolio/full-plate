/**
 * Round 11 (red-team S1–S4, S10): every save that comes in — a save file, the account copy, the device cache — goes
 * through one schema per save type before the game touches it: sim-core's GameState, sim-career's, sim-empire's and
 * sim-stars' states, and the envelope's PathMeta here (parked Empire sites are GameStates too). A save that fails is
 * refused with the child-readable "That save file is damaged."; one that passes comes back cleaned (names stripped of
 * bidi / zero-width / control characters and capped, unknown top-level keys dropped).
 *
 * Also here: the account header's schema (saveCloud.ts drops headers that fail it) and the size limits. A lazy module
 * (the "saveCheck" chunk, with the validators): the main chunk never carries it.
 */
import {
  anyJson, arr, bool, day, fail, id, int, money, name, num, obj, oneOf, opt, rec, SchemaError, str, text, type Check,
} from "@full-plate/sim-core/schema";
import { validateGameState } from "@full-plate/sim-core/validate";
import { handoverSchema, ownerPerksSchema, validateCareerState } from "@full-plate/sim-career/validate";
import { validateEmpireState, validateParkedSite } from "@full-plate/sim-empire/validate";
import { starsGuideResult, starsVisit, validateStarsState } from "@full-plate/sim-stars/validate";
import { deserialize, serialize } from "../sim";
import { decodeSave, type Loaded } from "./save";
import { BRAND_RE } from "../lib/brandCode";
import { FORK_DAY, QUICK_FORK_DAY, type PathMeta } from "./paths";
import { CHUNK_SIZE, MAX_CHUNKS, MAX_PACKED, type CloudHeader } from "./saveStore";

export { SchemaError };
export const DAMAGED = "That save file is damaged.";

const n = num();
const command: Check = obj({ type: id }, anyJson);
const empireEvent = obj({ day, kind: id, text, tone: oneOf("good", "bad", "info", "money"), siteId: opt(id), cityId: opt(id), regionId: opt(id) });

/** PathMeta without the three sims' states (they have their own schemas). */
const metaSchema = obj<Omit<PathMeta, "career" | "empire" | "stars">>({
  mode: oneOf("owner", "career"),
  careerEvents: arr(anyJson, 1000),
  ownerCommands: arr(command, 1000),
  ownerMorning: arr(command, 1000),
  ownerPerks: opt(ownerPerksSchema),
  handover: opt(handoverSchema),
  handoverSeen: opt(bool),
  fork: obj({ offered: bool, firstOfferDay: opt(day), snoozeUntil: opt(day), chosen: opt(oneOf("empire", "stars")), chosenDay: opt(day) }),
  empireEvents: arr(empireEvent, 1000),
  // Round 11: a parked site is sim-empire's ParkedSite (C), or in older saves a whole serialised GameState; each is
  // checked below by its own schema.
  parked: opt(rec((v, at) => (typeof v === "string" ? str(8_000_000)(v, at) : obj({ v: oneOf(1) }, anyJson)(v, at)), 1000)),
  starsEvents: arr(anyJson, 1000),
  pendingGuide: opt(obj({ result: starsGuideResult, visits: arr(starsVisit, 500) })),
  win: opt(obj({
    kind: oneOf("empire_meals", "empire_regions", "dynasty", "el_bulli", "handed_back"), won: bool, day, title: text,
    text: arr(text, 100), dismissed: opt(bool),
  })),
  handsOn: opt(anyJson),
  // Round 11 (D, U11): a save made mid-shift while playing hands-on goes back into hands-on play on load.
  handsOnResume: opt(obj({ role: oneOf("chef", "server", "bar"), jumpIn: bool })),
  shiftSummary: opt(obj({
    role: oneOf("chef", "server", "bar"), points: n, stars: oneOf(0, 1, 2, 3), plates: n, meanQuality: n, speedPct: n,
    served: n, cleared: n, payments: n, drops: n, dropCost: money, lines: arr(obj({ label: text, value: text }), 100), tip: text,
  })),
  lastPathDay: day,
  morningDay: opt(day),
  // Round 12 (B): the brand code; a malformed one is dropped below (the name's default brand shows instead).
  brand: opt(str(80)),

  // Round 12 (C): Quick year, the chapter cards, a daily challenge's start.
  forkDay: opt(int(QUICK_FORK_DAY, FORK_DAY)),
  chapterSeen: opt(int(0, 12)),
  challenge: opt(obj({ date: (v, at) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fail(at, "not a date")), startDay: day, startCash: money, startPopularity: n, target: n })),
}, false);

/** A decoded save, checked and cleaned. Throws a SchemaError naming the first bad field. */
export function validateLoaded(l: Loaded): Loaded {
  const game = validateGameState(l.game);
  const { career, empire, stars, ...rest } = l.meta;
  const meta = metaSchema(rest, "meta") as PathMeta;
  if (meta.brand !== undefined && !BRAND_RE.test(meta.brand)) delete meta.brand;
  if (career) meta.career = validateCareerState(career);
  if (empire) meta.empire = validateEmpireState(empire);
  if (stars) meta.stars = validateStarsState(stars);
  if (meta.parked) {
    for (const [site, s] of Object.entries(meta.parked)) {
      if (typeof s !== "string") { meta.parked[site] = validateParkedSite(s, `meta.parked.${site}`); continue; }
      let g;
      try { g = deserialize(s); } catch { return fail(`meta.parked.${site}`, "unreadable"); }
      meta.parked[site] = serialize(validateGameState(g));
    }
  }
  return { game, meta };
}

/** `decodeSave` + `validateLoaded`: the only way the save store turns text into a game. Throws. */
export const checkedDecode = (raw: string): Loaded => validateLoaded(decodeSave(raw));

/** The same, null instead of throwing. */
export function tryDecode(raw: string | null | undefined): Loaded | null {
  if (!raw) return null;
  try { return checkedDecode(raw); } catch { return null; }
}

const headerSchema = obj<CloudHeader>({
  kind: oneOf("save"),
  slotId: id,
  name: name(40),
  mode: oneOf("owner", "career"),
  restaurantName: name(40),
  day: int(0, 1e6),
  cash: money,
  path: oneOf("owner", "career", "empire", "stars"),
  difficulty: oneOf("cosy", "normal", "hard"),
  updatedAt: str(40),
  chunkCount: int(1, MAX_CHUNKS),
  encoding: oneOf("gzip-b64", "b64"),
  bytes: int(0, 1e9),
  packedLength: int(0, MAX_PACKED),
  hash: str(40),
  bank: oneOf("a", "b"),
  appVersion: str(20),
  hw: opt(int(0, MAX_CHUNKS)),
  backupOf: opt(id),
  archived: opt(bool),
  brand: opt(str(80)),
}, false);

/**
 * An account header, checked (S1/S10): every field its type, `chunkCount` = ⌈packedLength / CHUNK_SIZE⌉ (≥ 1, ≤ 8).
 * Null when it isn't a usable header (saveCloud.ts then ignores it and this device's copy, if any, goes back up).
 */
export function checkHeader(raw: unknown): CloudHeader | null {
  try {
    const h = headerSchema(raw, "header");
    if (h.chunkCount !== Math.max(1, Math.ceil(h.packedLength / CHUNK_SIZE))) return null;
    return h;
  } catch { return null; }
}
