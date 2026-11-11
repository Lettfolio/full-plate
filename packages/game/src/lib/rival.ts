/**
 * Round 12 (E): the chef across the road. Their name, restaurant and personality come from the seed and the district;
 * their weekly review score is a mirror — a function of the district, the week and the player's popularity — not a
 * sim (BRIEF: the sim is untouched). The player's score is the real average of their nights that week. Posts (2–3 a
 * week) react to what really happened: last week's result, or last night's.
 */
import type { GameState } from "@full-plate/sim-core";
import type { VoicesMemo } from "../state/paths";
import type { RivalPersonality, RivalPostKind } from "@full-plate/content/voices";
import { byDay, dishLabel, fill, h32, pickBy, voices, wasOpen, weekStart, weekdayName } from "./voiceKit";

export interface Rival {
  first: string;
  name: string;
  place: string;
  personality: RivalPersonality;
  /** A stable id for their portrait. */
  id: string;
}

/** Each district's lean (their regulars are a bit kinder by the sea, a bit tougher in the student quarter). */
const DISTRICT_LEAN: Record<string, number> = { student_quarter: -0.1, high_street: 0.05, business_park: 0, seaside: 0.1 };
const BASE = 3.3;
/** How far the rival rises with the player's standing: a 4★ month (80) lifts them +0.18, a 3★ month (60) +0.06. */
const MIRROR = 0.006;
/** Scores closer than this are "level". */
export const LEVEL = 0.05;

export function rivalFor(seed: number, districtId: string): Rival {
  const r = voices.rival;
  const first = pickBy(r.firstNames, seed, districtId, "rival:first");
  const surname = pickBy(r.surnames, seed, districtId, "rival:surname");
  const personality = pickBy(r.personalities, seed, districtId, "rival:who");
  const place = fill(pickBy(personality.places, seed, "rival:place"), { rivalFirst: first, district: r.districtWords[districtId] ?? "Town" });
  return { first, name: `${first} ${surname}`, place, personality, id: `rival-${seed}-${districtId}` };
}

export interface WeekScore {
  /** Monday of the week. */
  start: number;
  /** The player's mean nightly rating over the week's open days (undefined: shut all week — a forfeit). */
  you?: number;
  them: number;
  result: "you" | "them" | "level";
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/**
 * The player's standing going into a week, 0-100: twenty times their average night over the four weeks before it (the
 * same pull the sim's popularity follows), 50 before the first night. Worked out from the saved results only, so a
 * week's score never changes after the fact.
 */
export function standingBefore(game: GameState, start: number): number {
  const xs = game.history.filter((d) => d.day < start && d.day >= start - 28 && wasOpen(d));
  return xs.length ? (20 * xs.reduce((a, d) => a + d.averageRating, 0)) / xs.length : 50;
}

/** Their score for a week (rounded to 0.1): district + week wobble (±0.3) + a mirror of the player's standing. */
export function rivalScore(game: GameState, start: number): number {
  const wobble = ((h32(game.seed, game.districtId, "rival:week", start) % 61) - 30) / 100;
  return r1(Math.max(2.2, Math.min(4.8, BASE + (DISTRICT_LEAN[game.districtId] ?? 0) + wobble + MIRROR * (standingBefore(game, start) - 50))));
}

/** Every complete week in the history (its Sunday has been played), oldest first. */
export function weekScores(game: GameState): WeekScore[] {
  const days = byDay(game.history);
  const last = game.history.at(-1)?.day ?? -1;
  const first = game.history[0]?.day ?? 0;
  const out: WeekScore[] = [];
  for (let s = weekStart(first); s + 6 <= last; s += 7) {
    const open = [0, 1, 2, 3, 4, 5, 6].map((i) => days.get(s + i)).filter(wasOpen);
    const them = rivalScore(game, s);
    const you = open.length ? r1(open.reduce((a, d) => a + d.averageRating, 0) / open.length) : undefined;
    const result = you === undefined ? "them" : Math.abs(you - them) < LEVEL ? "level" : you > them ? "you" : "them";
    out.push({ start: s, ...(you !== undefined ? { you } : {}), them, result });
  }
  return out;
}

/** Consecutive weeks the player has won, counting back from the latest complete week. */
export function winStreak(weeks: readonly WeekScore[]): number {
  let n = 0;
  for (let i = weeks.length - 1; i >= 0 && weeks[i]!.result === "you"; i--) n++;
  return n;
}

export const CLIPPING_WEEKS = 3;

/** The morning the framed clipping was earned: the Monday after the first three-week winning run (once only). */
export function clippingDay(weeks: readonly WeekScore[]): number | undefined {
  let n = 0;
  for (const w of weeks) {
    n = w.result === "you" ? n + 1 : 0;
    if (n === CLIPPING_WEEKS) return w.start + 7;
  }
  return undefined;
}

/** Round 13 (D): the clipping's morning — the memo's once it's set (it outlives the history), else from the weeks. */
export const clipFrom = (memo: VoicesMemo | undefined, seed: number, weeks: readonly WeekScore[]): number | undefined =>
  (memo && memo.seed === seed ? memo.clip : undefined) ?? clippingDay(weeks);

export interface RivalPost { day: number; weekday: string; kind: RivalPostKind; text: string }

/** Which mornings of the week starting `start` they post on (two or three of them). */
export function postDays(game: GameState, start: number): number[] {
  const n = 2 + (h32(game.seed, "rival:posts", start) % 2);
  const offsets = [0, 1, 2, 3, 4, 5, 6].sort((a, b) => h32(game.seed, "rival:post", start, a) - h32(game.seed, "rival:post", start, b)).slice(0, n);
  return offsets.sort((a, b) => a - b).map((o) => start + o);
}

/** What they post on the morning of `day`, reacting to last night (if it stood out) or last week's reviews. */
export function postFor(game: GameState, rival: Rival, day: number, weeks: readonly WeekScore[] = weekScores(game)): RivalPost {
  const y = game.history.find((d) => d.day === day - 1);
  const lastWeek = [...weeks].reverse().find((w) => w.start + 6 < day);
  const avg = (() => {
    const xs = game.history.filter((d) => d.day < day - 1 && d.day >= day - 8 && wasOpen(d));
    return xs.length ? xs.reduce((a, d) => a + d.covers, 0) / xs.length : undefined;
  })();
  let kind: RivalPostKind;
  if (wasOpen(y) && (y.walkouts >= 4 || y.averageRating < 3)) kind = "yourBadNight";
  else if (wasOpen(y) && (y.averageRating >= 4.3 || (avg !== undefined && y.covers >= avg * 1.3 && y.covers >= 20))) kind = "yourGoodNight";
  else if (!lastWeek || lastWeek.result === "level" || lastWeek.you === undefined) kind = "close";
  else kind = lastWeek.result === "you" ? "youLead" : "theyLead";
  const dish = dishLabel(y?.bestDish);
  const text = fill(pickBy(rival.personality.posts[kind], game.seed, "rival:text", day), {
    rival: rival.name, rivalFirst: rival.first, rivalPlace: rival.place, restaurant: game.restaurantName,
    district: voices.rival.districtWords[game.districtId] ?? "town",
    dish: dish ?? "special",
    you: lastWeek?.you?.toFixed(1) ?? "—", them: lastWeek?.them.toFixed(1) ?? "—",
  });
  return { day, weekday: weekdayName(day), kind, text };
}

/** The feed up to and including `today`'s morning, newest first (`limit` posts). */
export function feed(game: GameState, rival: Rival, today: number, limit = 3): RivalPost[] {
  const weeks = weekScores(game);
  const out: RivalPost[] = [];
  for (let s = weekStart(today); out.length < limit && s >= weekStart(0) - 7; s -= 7) {
    for (const d of postDays(game, s).reverse()) {
      if (d > today || d < 1 || out.length >= limit) continue;
      out.push(postFor(game, rival, d, weeks));
    }
  }
  return out;
}

/** The weekly "who's winning on reviews" line, from the latest complete week. */
export function winningLine(rival: Rival, weeks: readonly WeekScore[]): string {
  const w = weeks.at(-1);
  const l = voices.rival.winningLine;
  if (!w) return fill(l.none, { rivalFirst: rival.first });
  const vars = { rivalFirst: rival.first, you: w.you?.toFixed(1) ?? "—", them: w.them.toFixed(1) };
  return fill(w.you === undefined ? l.forfeit : w.result === "you" ? l.you : w.result === "level" ? l.level : l.them, vars);
}
