/**
 * Round 10 (B): staff with personality. Everything here is derived, deterministic and pure:
 *
 * - `avatarFor(person)`: a portrait spec (skin, hair, hair style, face shape, glasses, freckles, role clothes, a
 *   favourite colour) from the person's id and name. Skin and hair use the same rule as the floor/hands-on sprites
 *   (`hashKey(id)`), so a portrait matches the little person walking about the restaurant.
 * - `personalityOf(person)`: one like and one dislike (from short lists), from id + name. Nothing is stored, so every
 *   save — old ones too — gets personalities with no migration.
 * - `relationBetween(a, b)`: "friends" / "clash" / undefined, from the pair's ids + names (order-free).
 * - `personalityMood(...)`: the small daily mood nudges from likes, dislikes and who you worked with, clamped to
 *   ±PERSONALITY_MOOD_CAP; plus the text of the day's biggest reason.
 * - Training tracks (`TRAINING_TRACKS`): four paths of three levels each (TRAIN with a `track`).
 *
 * No Math.random, no clock: hashes only (source-scan test).
 */
import type { ContentPack, Staff, StaffRole, TrackId } from "./types";

// ───────────────────────── hashing ─────────────────────────

/** Same string hash as handson's sprites.ts `hashKey` (so skin and hair match the sprites). */
export function hashKey(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** FNV-1a 32-bit, then a final avalanche; independent of `hashKey` so features don't correlate with skin/hair. */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Anything with a name and a role; `id` is the staff id (a candidate's future id `s<day>-<index>`). */
export interface PersonKey { id?: string; name: string; role: StaffRole }
const keyOf = (p: PersonKey) => `${p.id ?? ""}|${p.name}`;

// ───────────────────────── portraits ─────────────────────────

/** Same values (and order) as handson sprites.ts SKINS / HAIRS. */
export const AVATAR_SKINS = ["#f1c9a5", "#d9a77c", "#a8714a", "#7a4b2e", "#f5d6bd", "#c48a5f"] as const;
export const AVATAR_HAIRS = ["#3b2a1f", "#6b4426", "#a8743a", "#1f1b18", "#c9a36a", "#7a3a22", "#55524e"] as const;
/** Favourite colours (portrait background ring and a chip in the staff room). */
export const AVATAR_COLOURS = [
  { id: "tomato", name: "tomato red", hex: "#e5715c" },
  { id: "sunflower", name: "sunflower yellow", hex: "#f2c14e" },
  { id: "mint", name: "mint green", hex: "#7cc6a0" },
  { id: "sky", name: "sky blue", hex: "#7fb3d9" },
  { id: "lilac", name: "lilac", hex: "#b99ad4" },
  { id: "peach", name: "peach", hex: "#f4ab84" },
  { id: "teal", name: "teal", hex: "#5fb3b0" },
  { id: "pink", name: "bubblegum pink", hex: "#ee9bbd" },
] as const;

export type HairStyle = "short" | "bob" | "bun" | "curly" | "spiky" | "long" | "buzz";
export const HAIR_STYLES: readonly HairStyle[] = ["short", "bob", "bun", "curly", "spiky", "long", "buzz"];
export type FaceShape = "round" | "oval" | "wide";
export type AvatarHat = "toque" | "cap" | "none";

export interface AvatarSpec {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  face: FaceShape;
  glasses: boolean;
  freckles: boolean;
  /** Role clothes, the same as the floor sprite (RestaurantView staffLook). */
  hat: AvatarHat;
  hatColour: string;
  body: string;
  trim?: string;
  shirt?: boolean;
  apron?: string;
  /** Favourite colour: AVATAR_COLOURS entry. */
  colour: (typeof AVATAR_COLOURS)[number];
}

/** Role clothes: mirrors game/src/canvas/RestaurantView.ts `staffLook` (literal colours, theme defaults). */
const ROLE_CLOTHES: Record<StaffRole, Pick<AvatarSpec, "hat" | "hatColour" | "body" | "trim" | "shirt" | "apron">> = {
  chef: { hat: "toque", hatColour: "#fffdf8", body: "#fbfaf6", trim: "#c4412b", apron: "#ece7dc" },
  server: { hat: "cap", hatColour: "#3c7a37", body: "#2f3a33", trim: "#c4412b", shirt: true, apron: "#1f2622" },
  bar: { hat: "cap", hatColour: "#3a2c22", body: "#8a5a9e", trim: "#2b2622", shirt: true },
  porter: { hat: "none", hatColour: "#fffdf8", body: "#4f8fb8", apron: "#3a7398" },
  manager: { hat: "none", hatColour: "#fffdf8", body: "#5c534a", trim: "#f2b33d", shirt: true },
};

/** A stable portrait for a person. Same input → same portrait, forever. */
export function avatarFor(p: PersonKey): AvatarSpec {
  const h = hashKey(p.id ?? p.name);
  const f = hashStr(`avatar:${keyOf(p)}`);
  return {
    skin: AVATAR_SKINS[h % AVATAR_SKINS.length]!,
    hair: AVATAR_HAIRS[(h >> 3) % AVATAR_HAIRS.length]!,
    hairStyle: HAIR_STYLES[f % HAIR_STYLES.length]!,
    face: (["round", "oval", "wide"] as const)[(f >>> 4) % 3]!,
    glasses: (f >>> 7) % 4 === 0,
    freckles: (f >>> 10) % 5 === 0,
    colour: AVATAR_COLOURS[(f >>> 13) % AVATAR_COLOURS.length]!,
    ...ROLE_CLOTHES[p.role],
  };
}

/** The six looks a career player picks from at the start (index stored as CareerState.look). */
export const PLAYER_LOOKS: readonly Omit<AvatarSpec, "hat" | "hatColour" | "body" | "trim" | "shirt" | "apron">[] = [
  { skin: AVATAR_SKINS[0], hair: AVATAR_HAIRS[1], hairStyle: "bun", face: "round", glasses: false, freckles: true, colour: AVATAR_COLOURS[0] },
  { skin: AVATAR_SKINS[2], hair: AVATAR_HAIRS[3], hairStyle: "curly", face: "oval", glasses: false, freckles: false, colour: AVATAR_COLOURS[2] },
  { skin: AVATAR_SKINS[4], hair: AVATAR_HAIRS[4], hairStyle: "long", face: "oval", glasses: true, freckles: false, colour: AVATAR_COLOURS[4] },
  { skin: AVATAR_SKINS[3], hair: AVATAR_HAIRS[0], hairStyle: "short", face: "wide", glasses: false, freckles: false, colour: AVATAR_COLOURS[3] },
  { skin: AVATAR_SKINS[1], hair: AVATAR_HAIRS[5], hairStyle: "bob", face: "round", glasses: false, freckles: true, colour: AVATAR_COLOURS[7] },
  { skin: AVATAR_SKINS[5], hair: AVATAR_HAIRS[6], hairStyle: "spiky", face: "wide", glasses: true, freckles: false, colour: AVATAR_COLOURS[1] },
];

/** A career player's portrait: their picked look (0-5, wraps) in their job's clothes. */
export function playerAvatar(look: number, role: StaffRole): AvatarSpec {
  const n = PLAYER_LOOKS.length;
  const i = Number.isInteger(look) ? ((look % n) + n) % n : 0;
  return { ...PLAYER_LOOKS[i]!, ...ROLE_CLOTHES[role] };
}

// ───────────────────────── likes and dislikes ─────────────────────────

export type LikeId = "busy_nights" | "quiet_nights" | "weekends_off" | "happy_guests" | "tips" | "learning" | "short_weeks";
export type DislikeId = "mondays" | "long_weeks" | "grumpy_guests" | "mad_rush" | "slow_nights" | "working_tired" | "sunday_shifts";

/** Built-in labels; ContentPack.staffText.likes / dislikes override them (content/data/staffQuotes.json). */
export const LIKE_LABELS: Record<LikeId, string> = {
  busy_nights: "busy nights", quiet_nights: "calm, quiet nights", weekends_off: "weekends off", happy_guests: "happy guests",
  tips: "a full tip jar", learning: "learning new things", short_weeks: "short weeks",
};
export const DISLIKE_LABELS: Record<DislikeId, string> = {
  mondays: "Mondays", long_weeks: "long weeks", grumpy_guests: "grumpy guests", mad_rush: "a mad rush",
  slow_nights: "slow, empty nights", working_tired: "working when tired", sunday_shifts: "Sunday shifts",
};
export const LIKE_IDS = Object.keys(LIKE_LABELS) as LikeId[];
export const DISLIKE_IDS = Object.keys(DISLIKE_LABELS) as DislikeId[];

/** A like and a dislike that would contradict each other are never drawn together. */
const CLASHING_TASTES: readonly [LikeId, DislikeId][] = [["busy_nights", "mad_rush"], ["quiet_nights", "slow_nights"]];
const FOH: readonly StaffRole[] = ["server", "bar"];

export interface Personality { like: LikeId; dislike: DislikeId }

export function personalityOf(p: PersonKey): Personality {
  const h = hashStr(`taste:${keyOf(p)}`);
  const likes = LIKE_IDS.filter((l) => l !== "tips" || FOH.includes(p.role));
  const like = likes[h % likes.length]!;
  const dislikes = DISLIKE_IDS.filter((d) => !CLASHING_TASTES.some(([l, x]) => l === like && x === d));
  return { like, dislike: dislikes[(h >>> 8) % dislikes.length]! };
}

export const likeLabel = (content: ContentPack | undefined, id: LikeId): string => content?.staffText?.likes?.[id] ?? LIKE_LABELS[id];
export const dislikeLabel = (content: ContentPack | undefined, id: DislikeId): string => content?.staffText?.dislikes?.[id] ?? DISLIKE_LABELS[id];

/** A candidate's one-line "why me" (from their archetype's quotes, else a generic one). */
export function quoteFor(content: ContentPack | undefined, archetypeId: string | undefined, p: PersonKey): string {
  const pool = (archetypeId && content?.staffText?.quotes?.[archetypeId]) || content?.staffText?.quotes?.[p.role] || GENERIC_QUOTES;
  return pool.length ? pool[hashStr(`quote:${keyOf(p)}`) % pool.length]! : GENERIC_QUOTES[0]!;
}
const GENERIC_QUOTES = ["I work hard and I'm always on time.", "I'd love to be part of your team!", "Give me a go — you won't regret it."];

// ───────────────────────── relationships ─────────────────────────

export type Relation = "friends" | "clash";
/** Out of 12 pair hashes: 0 = clash, 1-2 = friends (so ~1 in 12 pairs clash and ~1 in 6 get on). */
export function relationBetween(a: PersonKey, b: PersonKey): Relation | undefined {
  const ka = keyOf(a), kb = keyOf(b);
  if (ka === kb) return undefined;
  const r = hashStr(`pair:${ka < kb ? `${ka}&${kb}` : `${kb}&${ka}`}`) % 12;
  return r === 0 ? "clash" : r <= 2 ? "friends" : undefined;
}

/** Everyone `s` gets on with and clashes with, among `team` (in team order). */
export function relationsOf(s: PersonKey, team: readonly PersonKey[]): { friends: PersonKey[]; clashes: PersonKey[] } {
  const friends: PersonKey[] = [], clashes: PersonKey[] = [];
  for (const o of team) {
    const r = relationBetween(s, o);
    if (r === "friends") friends.push(o);
    else if (r === "clash") clashes.push(o);
  }
  return { friends, clashes };
}

// ───────────────────────── daily mood from personality ─────────────────────────

export const PERSONALITY_MOOD = {
  like: 2,
  learning: 3,
  dislike: -2,
  friendOnShift: 1,
  clashOnShift: -1,
  /** Total personality nudge per day is clamped to ±cap. */
  cap: 5,
  /** Covers per working person for a busy night / a mad rush / a slow night. */
  busyPerHead: 18,
  rushPerHead: 26,
  slowPerHead: 8,
  shortWeekDays: 4,
  longWeekDays: 6,
  tiredFatigue: 70,
  happyRating: 4,
  grumpyRating: 3,
} as const;

export const WEEKDAY_FULL_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** One reason for a mood change today. */
export interface MoodFactor { delta: number; text: string }

export interface PersonalityDay {
  worked: boolean;
  training: boolean;
  /** 0 = Monday. */
  weekday: number;
  weekend: boolean;
  coversPerHead: number;
  meanRating: number | undefined;
  /** FOH tips relative to expectation (≥ 0 = at or above). */
  tipsRatio: number;
  fatigue: number;
  /** Colleagues on shift today (excluding `s`). */
  workedWith: readonly Staff[];
}

const firstName = (n: string) => n.split(" ")[0] ?? n;

/** Personality factors for one person today (unclamped; see `personalityMood`). */
export function personalityFactors(content: ContentPack | undefined, s: Staff, d: PersonalityDay): MoodFactor[] {
  const { like, dislike } = personalityOf(s);
  const out: MoodFactor[] = [];
  const P = PERSONALITY_MOOD;
  const days = s.rota.filter(Boolean).length;
  const L = (text: string) => out.push({ delta: like === "learning" ? P.learning : P.like, text });
  const D = (text: string) => out.push({ delta: P.dislike, text });
  if (d.training) {
    if (like === "learning") L("loved the training course");
    return out;
  }
  switch (like) {
    case "busy_nights": if (d.worked && d.coversPerHead >= P.busyPerHead) L("a busy night — loves those"); break;
    case "quiet_nights": if (d.worked && d.coversPerHead > 0 && d.coversPerHead <= P.slowPerHead) L("a nice calm night"); break;
    case "weekends_off": if (!d.worked && d.weekend) L(`had ${WEEKDAY_FULL_NAMES[d.weekday]} off`); break;
    case "happy_guests": if (d.worked && d.meanRating !== undefined && d.meanRating >= P.happyRating) L("the guests were so happy"); break;
    case "tips": if (d.worked && d.tipsRatio >= 0) L("a full tip jar"); break;
    case "short_weeks": if (!d.worked && days <= P.shortWeekDays) L("enjoying a short week"); break;
    case "learning": break;
  }
  switch (dislike) {
    case "mondays": if (d.worked && d.weekday === 0) D("worked on a Monday"); break;
    case "long_weeks": if (d.worked && days >= P.longWeekDays) D(`${days} shifts this week`); break;
    case "grumpy_guests": if (d.worked && d.meanRating !== undefined && d.meanRating < P.grumpyRating) D("rude, grumpy guests"); break;
    case "mad_rush": if (d.worked && d.coversPerHead >= P.rushPerHead) D("a mad rush all night"); break;
    case "slow_nights": if (d.worked && d.coversPerHead > 0 && d.coversPerHead <= P.slowPerHead) D("a slow, empty night"); break;
    case "working_tired": if (d.worked && d.fatigue >= P.tiredFatigue) D("worked while tired"); break;
    case "sunday_shifts": if (d.worked && d.weekday === 6) D("worked on a Sunday"); break;
  }
  if (d.worked) {
    const { friends, clashes } = relationsOf(s, d.workedWith);
    if (friends.length) out.push({ delta: P.friendOnShift * Math.min(2, friends.length), text: `worked with ${friends.map((f) => firstName(f.name)).join(" and ")}` });
    if (clashes.length) out.push({ delta: P.clashOnShift * Math.min(2, clashes.length), text: `stuck on a shift with ${clashes.map((f) => firstName(f.name)).join(" and ")}` });
  }
  return out;
}

/** Sum of the factors, clamped to ±PERSONALITY_MOOD.cap. */
export function personalityMood(factors: readonly MoodFactor[]): number {
  const t = factors.reduce((a, f) => a + f.delta, 0);
  return Math.max(-PERSONALITY_MOOD.cap, Math.min(PERSONALITY_MOOD.cap, t));
}

/** The biggest reason (ties: first), or undefined when nothing moved mood by at least 0.5. */
export function mainReason(factors: readonly MoodFactor[]): MoodFactor | undefined {
  let best: MoodFactor | undefined;
  for (const f of factors) if (Math.abs(f.delta) >= 0.5 && (!best || Math.abs(f.delta) > Math.abs(best.delta))) best = f;
  return best;
}

// ───────────────────────── training tracks ─────────────────────────

export interface TrackDef {
  id: TrackId;
  name: string;
  /** Child-readable one-liner. */
  blurb: string;
  /** Who can take it. */
  roles: readonly StaffRole[];
  /** Stat each level raises (none for the pass: it unlocks sous-chef cover instead). */
  stat?: "skill" | "speed" | "charm";
  /** Per level. */
  gain: number;
  /** Fee for level 1, 2, 3 (pence). */
  fees: readonly [number, number, number];
}
export const TRACK_MAX_LEVEL = 3;
export const TRAINING_TRACKS: readonly TrackDef[] = [
  { id: "knife", name: "Knife skills", blurb: "Faster chopping and clearing: speed goes up.", roles: ["chef", "porter", "bar"], stat: "speed", gain: 4, fees: [12_000, 18_000, 25_000] },
  { id: "plating", name: "Plating", blurb: "Prettier, tastier plates: skill goes up.", roles: ["chef", "bar"], stat: "skill", gain: 4, fees: [12_000, 18_000, 25_000] },
  { id: "charm", name: "Front of house", blurb: "Warmer welcomes and better chats: charm goes up.", roles: ["server", "bar", "manager"], stat: "charm", gain: 4, fees: [12_000, 18_000, 25_000] },
  { id: "pass", name: "Cover the pass", blurb: "Learns to run the pass, so they can cover for you as sous chef.", roles: ["chef"], gain: 0, fees: [15_000, 20_000, 28_000] },
];
export const trackById = (id: string): TrackDef | undefined => TRAINING_TRACKS.find((t) => t.id === id);
export const tracksFor = (role: StaffRole): TrackDef[] => TRAINING_TRACKS.filter((t) => t.roles.includes(role));
export const trackLevel = (s: Pick<Staff, "tracks">, id: TrackId): number => s.tracks?.[id] ?? 0;
/** Fee for the next level of a track, or undefined at the top. */
export function nextTrackFee(s: Pick<Staff, "tracks">, t: TrackDef): number | undefined {
  const lvl = trackLevel(s, t.id);
  return lvl >= TRACK_MAX_LEVEL ? undefined : t.fees[lvl];
}
/** Sous-chef cover quality hit is reduced by this much per "Cover the pass" level. */
export const PASS_COVER_HIT_PER_LEVEL = 3;
