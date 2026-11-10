/**
 * Round 12 (E): the game's voices — the morning Food Gossip, the rival across the road and the regulars. Game-side text
 * only: the sims never read it. A separate entry (`@full-plate/content/voices`) so the game can load it in a lazy chunk
 * instead of the start-up `content` chunk. Importing it validates the data and throws a list of problems, like the
 * main pack. Writing notes: docs/CONTENT-NOTES.md "Round 12 — E".
 */
import gossipJson from "../data/gossip.json";
import rivalJson from "../data/rival.json";
import regularsJson from "../data/regulars.json";
import { extras, fullContent } from "./index";
import { GROWN_UP_WORDS } from "./softDrinks";

// ───────── types ─────────
export const GOSSIP_REACTIONS = [
  "oneStar", "fiveStar", "rush", "quiet", "walkouts", "ranOut", "hire", "decor", "loan", "bigProfit", "loss", "closed", "bestDish", "incident", "critic",
] as const;
export type GossipReaction = (typeof GOSSIP_REACTIONS)[number];

export interface GossipData {
  /** Radio station name per district id. */
  stations: Record<string, string>;
  opening: string[];
  patter: string[];
  /** Running jokes, told in order. */
  jokes: { critic: string[]; bins: string[] };
  reactions: Record<GossipReaction, string[]>;
  rival: { youWon: string[]; theyWon: string[] };
  clipping: string[];
}

export const RIVAL_POST_KINDS = ["theyLead", "youLead", "close", "yourBadNight", "yourGoodNight"] as const;
export type RivalPostKind = (typeof RIVAL_POST_KINDS)[number];
export interface RivalPersonality {
  id: string;
  label: string;
  bio: string;
  places: string[];
  posts: Record<RivalPostKind, string[]>;
}
export interface RivalData {
  firstNames: string[];
  surnames: string[];
  districtWords: Record<string, string>;
  personalities: RivalPersonality[];
  winningLine: Record<"you" | "them" | "level" | "none" | "forfeit", string>;
  clippingItem: { name: string; caption: string };
}

export interface RegularBeat {
  /** The VIP order: "{name} … {dish} … {weekday}". */
  order: string;
  /** Starter-library dish ids; the order names one of them. */
  dishes: string[];
  good: string;
  /** Present: a poorer night still moves the story on, down this branch (no photo). */
  bad?: string;
  photo: { emoji: string; caption: string };
  gossip: string;
}
export interface RegularDef {
  id: string;
  name: string;
  job: string;
  segment: string;
  favourite: string;
  /** Their clothes colour on the portrait. */
  colour: string;
  intro: string;
  beats: RegularBeat[];
}
export interface RegularsData {
  regulars: RegularDef[];
  lines: Record<"open" | "waiting" | "notOnMenu" | "onMenu" | "tryAgain" | "finished" | "newRegular", string>;
}

export interface Voices { gossip: GossipData; rival: RivalData; regulars: RegularsData }

export const VOICE_PLACEHOLDERS = {
  gossip: ["restaurant", "district", "station", "dish", "staff", "rival", "rivalPlace", "blogger", "covers", "walkouts", "weekday"],
  rival: ["rival", "rivalFirst", "rivalPlace", "restaurant", "district", "dish", "you", "them"],
  regulars: ["name", "dish", "weekday", "restaurant", "district", "blogger"],
} as const;

/** Every regular has an intro and this many VIP beats (five beats in all). */
export const REGULAR_BEATS = 4;

// ───────── validation ─────────
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
function strings(p: string[], at: string, v: unknown, min = 1): void {
  if (!Array.isArray(v) || v.length < min || !v.every(isStr)) p.push(`${at}: expected at least ${min} non-empty strings`);
}
function eachString(v: unknown, at: string, f: (at: string, s: string) => void): void {
  if (typeof v === "string") f(at, v);
  else if (Array.isArray(v)) v.forEach((x, i) => eachString(x, `${at}[${i}]`, f));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!k.startsWith("_")) eachString(x, `${at}.${k}`, f);
}
function words(p: string[], at: string, v: unknown, allowed: readonly string[]): void {
  eachString(v, at, (path, s) => {
    for (const m of s.match(/\{[^}]*\}/g) ?? []) if (!allowed.includes(m.slice(1, -1))) p.push(`${path}: unknown placeholder ${m}`);
    if (/[{}]/.test(s.replace(/\{\w+\}/g, ""))) p.push(`${path}: unbalanced brace`);
    if (GROWN_UP_WORDS.test(s)) p.push(`${path}: names a grown-up drink (the "Hide alcoholic drinks" view can't swap it)`);
    if (/\b86'd\b|\btronc\b|\bfootfall\b|\bwholesalers?\b/i.test(s)) p.push(`${path}: a trade word the content lines don't use`);
  });
}

/** Problems with the voices data (empty when it's good). `dishIds`: the starter library the regulars may order from. */
export function validateVoices(v: Voices, dishIds: ReadonlySet<string>, districtIds: readonly string[]): string[] {
  const p: string[] = [];
  const g = v.gossip;
  for (const d of districtIds) if (!isStr(g.stations?.[d])) p.push(`gossip.stations: missing ${d}`);
  strings(p, "gossip.opening", g.opening);
  strings(p, "gossip.patter", g.patter, 30);
  strings(p, "gossip.jokes.critic", g.jokes?.critic, 6);
  strings(p, "gossip.jokes.bins", g.jokes?.bins, 6);
  for (const k of GOSSIP_REACTIONS) strings(p, `gossip.reactions.${k}`, g.reactions?.[k], 3);
  for (const k of Object.keys(g.reactions ?? {})) if (!(GOSSIP_REACTIONS as readonly string[]).includes(k)) p.push(`gossip.reactions: unknown key ${k}`);
  strings(p, "gossip.rival.youWon", g.rival?.youWon);
  strings(p, "gossip.rival.theyWon", g.rival?.theyWon);
  strings(p, "gossip.clipping", g.clipping);
  words(p, "gossip", g, VOICE_PLACEHOLDERS.gossip);

  const r = v.rival;
  strings(p, "rival.firstNames", r.firstNames, 8);
  strings(p, "rival.surnames", r.surnames, 8);
  for (const d of districtIds) if (!isStr(r.districtWords?.[d])) p.push(`rival.districtWords: missing ${d}`);
  if (r.personalities?.length !== 8) p.push("rival.personalities: expected 8");
  const ids = new Set<string>();
  for (const k of ["you", "them", "level", "none", "forfeit"] as const) if (!isStr(r.winningLine?.[k])) p.push(`rival.winningLine.${k}: expected a string`);
  for (const [i, x] of (r.personalities ?? []).entries()) {
    const at = `rival.personalities[${i}]`;
    if (!isStr(x.id) || ids.has(x.id)) p.push(`${at}.id: missing or repeated`);
    ids.add(x.id);
    if (!isStr(x.label) || !isStr(x.bio)) p.push(`${at}: label and bio are required`);
    strings(p, `${at}.places`, x.places);
    for (const k of RIVAL_POST_KINDS) strings(p, `${at}.posts.${k}`, x.posts?.[k], 2);
  }
  words(p, "rival", r, VOICE_PLACEHOLDERS.rival);

  const rg = v.regulars;
  if ((rg.regulars?.length ?? 0) < 8 || (rg.regulars?.length ?? 0) > 10) p.push("regulars.regulars: expected 8-10 regulars");
  const rids = new Set<string>();
  for (const x of rg.regulars ?? []) {
    const at = `regulars[${x.id}]`;
    if (!isStr(x.id) || rids.has(x.id)) p.push(`${at}.id: missing or repeated`);
    rids.add(x.id);
    for (const k of ["name", "job", "segment", "intro", "colour"] as const) if (!isStr(x[k])) p.push(`${at}.${k}: expected a string`);
    if (!dishIds.has(x.favourite)) p.push(`${at}.favourite: "${x.favourite}" is not a starter-library dish`);
    if (x.beats?.length !== REGULAR_BEATS) p.push(`${at}.beats: expected ${REGULAR_BEATS} (plus the intro: five beats)`);
    for (const [i, b] of (x.beats ?? []).entries()) {
      const bt = `${at}.beats[${i}]`;
      for (const k of ["order", "good", "gossip"] as const) if (!isStr(b[k])) p.push(`${bt}.${k}: expected a string`);
      if (b.bad !== undefined && !isStr(b.bad)) p.push(`${bt}.bad: expected a string`);
      if (!isStr(b.photo?.emoji) || !isStr(b.photo?.caption)) p.push(`${bt}.photo: emoji and caption are required`);
      if (!b.order?.includes("{dish}") || !b.order.includes("{weekday}")) p.push(`${bt}.order: must name {dish} and {weekday}`);
      if (!Array.isArray(b.dishes) || b.dishes.length === 0) p.push(`${bt}.dishes: expected at least one dish id`);
      for (const d of b.dishes ?? []) if (!dishIds.has(d)) p.push(`${bt}.dishes: "${d}" is not a starter-library dish`);
    }
  }
  for (const k of ["open", "waiting", "notOnMenu", "onMenu", "tryAgain", "finished", "newRegular"] as const) if (!isStr(rg.lines?.[k])) p.push(`regulars.lines.${k}: expected a string`);
  words(p, "regulars", rg, VOICE_PLACEHOLDERS.regulars);
  return p;
}

const drop = <T>(x: Record<string, unknown>): T => Object.fromEntries(Object.entries(x).filter(([k]) => !k.startsWith("_"))) as T;

/** The shipped voices (unvalidated). */
export function loadVoices(): Voices {
  return {
    gossip: drop<GossipData>(gossipJson as Record<string, unknown>),
    rival: drop<RivalData>(rivalJson as Record<string, unknown>),
    regulars: drop<RegularsData>(regularsJson as Record<string, unknown>),
  };
}

/** Starter-library dish ids (the pack the game starts with: fast food and fine dining are path content). */
export const starterDishIds = (): Set<string> => {
  const hidden = new Set(extras.libraryHidden);
  return new Set(fullContent.dishes.map((d) => d.id).filter((id) => !hidden.has(id)));
};

const shipped = loadVoices();
{
  const problems = validateVoices(shipped, starterDishIds(), fullContent.districts.map((d) => d.id));
  if (problems.length) throw new Error(`@full-plate/content voices: ${problems.length} problem(s):\n  ${problems.join("\n  ")}`);
}

/** Validated voices data. */
export const voices: Voices = shipped;
