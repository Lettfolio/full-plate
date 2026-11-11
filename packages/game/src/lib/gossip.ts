/**
 * Round 12 (E): "Food Gossip" — one line of local radio each morning, worked out from the seed, the day and what really
 * happened yesterday. A reaction (a 1★ review, a rush, a dish running out, a hire, new decor, a loan…) only plays when
 * the thing happened, with the real numbers, so it never contradicts the Evening; patter and the two running jokes (Clive
 * Halfway, the critic who never finishes; the council's bin lorry) say nothing about how the restaurant is doing.
 *
 * Order of precedence each morning: opening day → the framed clipping → a regular's story beat → the blogger's verdict
 * → the blogger "spotted" (her visit day) → the guide critic (Stars) → hard news (closed, 1★, hire, ran out, loan, decor;
 * soft instead when the same kind also happened the day before) → Monday's rival result → soft news on about 3 mornings in 5 (walk-outs, 5★, rush, profit, loss, quiet, best dish,
 * a sorted problem) → a running joke on its day → patter.
 */
import type { GameState, Review } from "@full-plate/sim-core";
import type { GossipReaction } from "@full-plate/content/voices";
import type { PathMeta } from "../state/paths";
import { extras } from "../sim";
import { blogger, reviewOn, visitsOn } from "./blogger";
import { beatGossip, regularsOf, type RegularState } from "./regulars";
import { clipFrom, rivalFor, weekScores, type Rival, type WeekScore } from "./rival";
import { dishLabel, districtName, fill, h32, meanCovers, pickBy, station, voices, wasOpen, weekdayName } from "./voiceKit";

export type GossipKind = "opening" | "clipping" | "regular" | "blogger" | "spotted" | "rival" | "joke" | "patter" | GossipReaction;
export interface GossipLine { day: number; kind: GossipKind; text: string }

/** Soft news plays on this share of mornings (out of 100); the rest get a joke or patter. */
export const SOFT_NEWS_PCT = 60;
/** A rush: at least this many guests and 1.3× the recent average. */
export const RUSH_MIN = 20;
export const WALKOUTS_NEWS = 5;

/** What the gossip needs, worked out once for a run of mornings. */
interface Ctx {
  game: GameState;
  meta?: PathMeta | undefined;
  rival: Rival;
  weeks: WeekScore[];
  clipping?: number | undefined;
  regulars: RegularState[];
}

function context(game: GameState, meta?: PathMeta): Ctx {
  const weeks = weekScores(game);
  return { game, meta, rival: rivalFor(game.seed, game.districtId), weeks, clipping: clipFrom(meta?.voices, game.seed, weeks), regulars: regularsOf(game, meta?.voices) };
}

function baseVars(c: Ctx, day: number): Record<string, string | number | undefined> {
  return {
    restaurant: c.game.restaurantName,
    district: districtName(c.game.districtId),
    station: station(c.game.districtId),
    rival: c.rival.name,
    rivalPlace: c.rival.place,
    blogger: blogger().name,
    weekday: weekdayName(day),
  };
}

/** Yesterday's facts that have a reaction pool, in precedence order: `hard` always plays, `soft` on most mornings. */
function facts(c: Ctx, day: number): { hard: [GossipReaction, Record<string, string | number | undefined>][]; soft: [GossipReaction, Record<string, string | number | undefined>][] } {
  const { game } = c;
  const y = game.history.find((d) => d.day === day - 1);
  const hard: [GossipReaction, Record<string, string | number | undefined>][] = [];
  const soft: [GossipReaction, Record<string, string | number | undefined>][] = [];
  if (!y) return { hard, soft };
  if (y.closed) { hard.push(["closed", {}]); return { hard, soft }; }
  const worst = (rs: readonly Review[], n: number) => rs.find((r) => r.rating === n && r.dishId) ?? rs.find((r) => r.rating === n);
  const one = worst(y.reviews, 1);
  if (one) hard.push(["oneStar", { dish: dishLabel(one.dishId ?? y.worstDish) ?? "food" }]);
  const hired = game.staff.filter((s) => s.hiredDay === day - 1).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  if (hired) hard.push(["hire", { staff: hired.name }]);
  const log = game.log.filter((l) => l.day === day - 1);
  const ranOut = log.find((l) => /86'd/.test(l.text));
  if (ranOut) {
    const dish = [...new Set(game.menu.map((m) => m.dishId))].map(dishLabel).find((n) => n && ranOut.text.includes(n));
    if (dish) hard.push(["ranOut", { dish }]);
  }
  if (log.some((l) => l.kind === "money" && /\b(lent you|loan)\b/i.test(l.text))) hard.push(["loan", {}]);
  if (y.decor?.fitted.length) hard.push(["decor", {}]);
  if (!wasOpen(y)) return { hard, soft };
  const avg = meanCovers(game.history, day - 1);
  const profits = game.history.filter((d) => d.day < day - 1 && d.day >= day - 8 && wasOpen(d)).map((d) => d.profit);
  const meanProfit = profits.length ? profits.reduce((a, b) => a + b, 0) / profits.length : undefined;
  if (y.walkouts >= WALKOUTS_NEWS) soft.push(["walkouts", { walkouts: y.walkouts }]);
  const five = worst(y.reviews, 5);
  if (five) soft.push(["fiveStar", { dish: dishLabel(five.dishId ?? y.bestDish) ?? "food" }]);
  if (y.covers >= RUSH_MIN && (avg === undefined ? y.covers >= 30 : y.covers >= avg * 1.3)) soft.push(["rush", { covers: y.covers }]);
  if (y.profit >= 15_000 && (meanProfit === undefined || y.profit >= meanProfit * 1.5)) soft.push(["bigProfit", {}]);
  if (y.profit < 0) soft.push(["loss", {}]);
  if (avg !== undefined && y.covers <= 15 && y.covers < avg * 0.6) soft.push(["quiet", { covers: y.covers }]);
  if (y.bestDish && y.averageRating >= 3.5) soft.push(["bestDish", { dish: dishLabel(y.bestDish) }]);
  if (y.incidents?.some((i) => i.resolution !== "ignored")) soft.push(["incident", {}]);
  return { hard, soft };
}

const JOKE_EVERY = 6;

function lineFor(c: Ctx, day: number): GossipLine {
  const { game, meta } = c;
  const g = voices.gossip;
  const v = baseVars(c, day);
  const say = (kind: GossipKind, pool: readonly string[], extra: Record<string, string | number | undefined> = {}): GossipLine =>
    ({ day, kind, text: fill(pickBy(pool, game.seed, "gossip", kind, day), { ...v, ...extra }) });
  if (day === 0 || game.history.length === 0 || day <= (game.history[0]?.day ?? 0)) return say("opening", g.opening);
  if (c.clipping === day) return say("clipping", g.clipping);
  const beat = beatGossip(game, c.regulars, day - 1);
  if (beat) return { day, kind: "regular", text: beat };
  const review = reviewOn(game, day - 1);
  if (review) {
    const b = blogger();
    return { day, kind: "blogger", text: review.closed ? review.text : `${b.name} on ${b.blog}: “${review.headline}” (${review.rating}★)` };
  }
  if (visitsOn(game.seed, day)) return say("spotted", blogger().spotted);
  const critic = meta?.stars?.guides.localCritic.reviews.find((r) => r.day === day - 1);
  if (critic) {
    const pool = extras.criticText.localCritic[String(critic.rating)] ?? [];
    const y = game.history.find((d) => d.day === day - 1);
    if (pool.length) return say("critic", pool, { critic: critic.critic, dish: dishLabel(y?.bestDish) ?? "food", chef: game.staff.find((s) => s.role === "chef")?.name.split(" ")[0] ?? "the chef", city: districtName(game.districtId) });
  }
  const f = facts(c, day);
  // Hard news that also happened the day before (the same dish running out every night) is demoted to soft news, so
  // the radio doesn't say the same thing every morning.
  const before = new Set(facts(c, day - 1).hard.map(([k]) => k));
  const fresh = f.hard.filter(([k]) => !before.has(k));
  f.soft.unshift(...f.hard.filter(([k]) => before.has(k)));
  if (fresh.length) { const [k, x] = fresh[0]!; return say(k, g.reactions[k], x); }
  const lastWeek = c.weeks.find((w) => w.start + 7 === day);
  if (lastWeek && lastWeek.result !== "level") return say("rival", lastWeek.result === "you" ? g.rival.youWon : g.rival.theyWon);
  if (f.soft.length && h32(game.seed, "gossip:soft", day) % 100 < SOFT_NEWS_PCT) {
    const [k, x] = f.soft[0]!;
    return say(k, g.reactions[k], x);
  }
  const j = (day + game.seed) % JOKE_EVERY;
  if (j === 0 || j === 3) {
    const pool = j === 0 ? g.jokes.critic : g.jokes.bins;
    const episode = Math.floor(day / JOKE_EVERY) % pool.length;
    return { day, kind: "joke", text: fill(pool[episode]!, v) };
  }
  return say("patter", g.patter);
}

/** The morning line for `day` (played before that day's service; it reads results up to `day − 1`). */
export function gossipFor(game: GameState, day: number = game.day, meta?: PathMeta): GossipLine {
  return lineFor(context(game, meta), day);
}

/** The last `n` mornings up to `day`, newest first (the ticker's "more"). */
export function gossipWeek(game: GameState, day: number = game.day, meta?: PathMeta, n = 7): GossipLine[] {
  const c = context(game, meta);
  const out: GossipLine[] = [];
  for (let d = day; d >= Math.max(0, day - n + 1); d--) out.push(lineFor(c, d));
  return out;
}
