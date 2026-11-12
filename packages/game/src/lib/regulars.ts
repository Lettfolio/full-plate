/**
 * Round 12 (E): the regulars. Ten people (regulars.json) join one by one in an order and on days set by the seed —
 * the first on day 1, then every 4–7 days — each on their first open day. After the intro, each has a VIP order: one
 * dish on one weekday. It is met on that weekday when the dish sold and the night averaged 3.5★ or better: the story
 * moves on a beat and a photo goes in the Regulars book. A beat with a `bad` branch also moves on after a poorer night
 * (no photo); one without waits for the next matching weekday.
 *
 * All of it is a fold over the day results in the save (GameState.history), so the same save always gives the same
 * book. Limit: the sim keeps the last 400 days of results (sim-core HISTORY_MAX); Round 13 (D) keeps the fold in a
 * PathMeta memo (`meta.voices`, lib/voicesMemo.ts writes it after each day), so the fold resumes from the memo and a
 * beat earned on day 30 is still in the book on day 900.
 *
 * Round 14 (F, G4): an order names a dish she is cooking — one of the beat's dishes that was ordered that day, else
 * one of hers from the same course, and only when none of hers fits the seed's pick. An order that passes three of
 * its weekdays unmet (dish off, a poor night, or shut) lapses: "they went elsewhere that night" — no photo, the story
 * moves on to the next beat. In the memo a lapsed beat is `[beat, day, 0]` with no dish (nothing was served), which
 * the R13 memo format already allows; R13 memos always stored the dish for a bad beat, so old saves read the same.
 */
import type { Customer, CustomerId, DayResult, GameState } from "@full-plate/sim-core";
import type { VoicesMemo } from "../state/paths";
import type { RegularBeat, RegularDef } from "@full-plate/content/voices";
import { weekdayIndex } from "./calendar";
import { visitsOn, blogger } from "./blogger";
import { dishLabel, districtName, fill, h32, sold, voices, wasOpen, weekdayName } from "./voiceKit";
import { content } from "../sim";

/** A night at or above this average counts as "a good review" for a VIP order. */
export const GOOD_NIGHT = 3.5;
/** The first regular's planned day, and the gap to the next (4 + 0..3 days). */
export const FIRST_JOIN = 1;
export const JOIN_GAP = [4, 7] as const;
/** At most this many stories run at once: the next regular waits for a story to finish (pacing; the book fills over months). */
export const ACTIVE_MAX = 3;
/** A VIP order is for a weekday 5–8 days after it is set, so a story moves on about once a week at most. */
export const ORDER_LEAD = [5, 8] as const;
/** Round 14 (F, G4): an order lapses on its third weekday unmet (or the first open day after it). */
export const LAPSE_AFTER = 3;

export interface BeatDone {
  /** 0 = the intro; 1..4 the VIP beats. */
  beat: number;
  day: number;
  good: boolean;
  /** Round 13 (D): the beat's dish that sold that night (the story's {dish}), kept so the words survive the history cap. */
  dishId?: string | undefined;
  /** Round 14 (F): the order lapsed — they went elsewhere that night (good is false; no dish). */
  lapsed?: true;
}
export interface VipOrder {
  /** The beat it unlocks (1..4). */
  beat: number;
  dishId: string;
  /** 0 = Monday … 6 = Sunday. */
  weekday: number;
  /** The day it was set. */
  since: number;
  /** The first day it can be met (its weekday, 5–8 days after `since`); after that, any later day on that weekday. */
  from: number;
  /** Last matching day they came and the night wasn't good enough (a beat with no bad branch). */
  triedDay?: number;
}
export interface RegularState {
  def: RegularDef;
  /** Planned first day (they join on the first open day from here). */
  plannedDay: number;
  joined?: number;
  done: BeatDone[];
  open?: VipOrder;
}

/** The cast in this game's order, with each one's planned first day. */
export function cast(seed: number): { def: RegularDef; plannedDay: number }[] {
  const defs = [...voices.regulars.regulars].sort((a, b) => h32(seed, "reg:order", a.id) - h32(seed, "reg:order", b.id));
  let day = FIRST_JOIN;
  return defs.map((def, i) => {
    if (i > 0) day += JOIN_GAP[0] + (h32(seed, "reg:gap", def.id) % (JOIN_GAP[1] - JOIN_GAP[0] + 1));
    return { def, plannedDay: day };
  });
}

const courseOf = (id: string): string | undefined => content.dishes.find((x) => x.id === id)?.course;
/** Ordered on that day (on her menu); old results without per-dish lines fall back to "sold". */
const onMenuThen = (d: DayResult, id: string): boolean => (d.perDish ? id in d.perDish : sold(d, id));

/** Round 14 (F, G4): the dish for a new order — the beat's own if she cooks one, else one of hers from that course. */
export function orderDish(seed: number, def: RegularDef, beat: number, d: DayResult): string {
  const b = def.beats[beat - 1]!;
  const rot = h32(seed, "reg:dish", def.id, beat) % b.dishes.length;
  const dishes = [...b.dishes.slice(rot), ...b.dishes.slice(0, rot)];
  const own = dishes.find((x) => sold(d, x)) ?? dishes.find((x) => onMenuThen(d, x));
  if (own) return own;
  const course = courseOf(dishes[0]!);
  const lines = d.perDish ?? {};
  const mine = Object.keys(lines)
    .filter((id) => courseOf(id) === course && dishLabel(id) !== undefined)
    .sort((x, y) => (lines[y]!.sold - lines[x]!.sold) || (h32(seed, "reg:mine", def.id, beat, x) - h32(seed, "reg:mine", def.id, beat, y)));
  return mine[0] ?? dishes[0]!;
}

function orderAfter(seed: number, def: RegularDef, beat: number, d: DayResult): VipOrder {
  const dishId = orderDish(seed, def, beat, d);
  const from = d.day + ORDER_LEAD[0] + (h32(seed, "reg:day", def.id, beat) % (ORDER_LEAD[1] - ORDER_LEAD[0] + 1));
  return { beat, dishId, weekday: weekdayIndex(from), since: d.day, from };
}

/** Round 14 (F): the order's last chance — its LAPSE_AFTER-th weekday. */
export const lapseDay = (o: VipOrder): number => o.from + 7 * (LAPSE_AFTER - 1);

/** A memo this game can resume from: same seed, and not ahead of the history (else the fold starts from scratch). */
export const usableMemo = (seed: number, history: readonly DayResult[], memo: VoicesMemo | undefined): VoicesMemo | undefined =>
  memo && memo.v === 1 && memo.seed === seed && memo.day <= (history.at(-1)?.day ?? -1) ? memo : undefined;

/**
 * Every regular's story so far, from the results in `history` (oldest first). Round 13 (D): with a memo, the fold
 * starts from the memo's states and reads only the days after `memo.day` (the same answer while the history still
 * holds every day; the memo's answer once it doesn't).
 */
/** The beat is done (met, a bad night, or lapsed): the next order, or the end of the story. */
function next(seed: number, s: RegularState, d: DayResult): void {
  const o = s.open!;
  if (o.beat < s.def.beats.length) s.open = orderAfter(seed, s.def, o.beat + 1, d);
  else delete s.open;
}

export function regularsFrom(seed: number, history: readonly DayResult[], memo?: VoicesMemo): RegularState[] {
  const states: RegularState[] = cast(seed).map(({ def, plannedDay }) => ({ def, plannedDay, done: [] }));
  const m = usableMemo(seed, history, memo);
  for (const r of m?.regs ?? []) {
    const s = states.find((x) => x.def.id === r.id);
    if (!s) continue;
    if (r.joined !== undefined) s.joined = r.joined;
    s.done = r.done.map(([beat, day, good, dishId]) => ({ beat, day, good: good === 1, ...(dishId ? { dishId } : beat > 0 && good !== 1 ? { lapsed: true as const } : {}) }));
    if (r.open) s.open = { ...r.open };
  }
  const from = m ? m.day : -Infinity;
  for (const d of history) {
    if (d.day <= from || !wasOpen(d)) continue;
    for (const s of states) {
      if (s.joined === undefined) {
        if (d.day < s.plannedDay) continue;
        // One newcomer a day, in cast order, and only while fewer than ACTIVE_MAX stories are running.
        if (states.find((x) => x.joined === undefined) !== s || states.filter((x) => x.open).length >= ACTIVE_MAX || states.some((x) => x.joined === d.day)) continue;
        s.joined = d.day;
        s.done.push({ beat: 0, day: d.day, good: true });
        s.open = orderAfter(seed, s.def, 1, d);
        continue;
      }
      const o = s.open;
      if (!o || d.day < o.from) continue;
      const match = weekdayIndex(d.day) === o.weekday;
      if (match && sold(d, o.dishId)) {
        const good = d.averageRating >= GOOD_NIGHT;
        const beat = s.def.beats[o.beat - 1]!;
        if (good || beat.bad !== undefined) {
          s.done.push({ beat: o.beat, day: d.day, good, dishId: o.dishId });
          next(seed, s, d);
          continue;
        }
        s.open = { ...o, triedDay: d.day };
      }
      // Round 14 (F, G4): the third weekday has come and gone — they went elsewhere that night; the story moves on.
      if (match ? d.day >= lapseDay(o) : d.day > lapseDay(o)) {
        s.done.push({ beat: o.beat, day: d.day, good: false, lapsed: true });
        next(seed, s, d);
      }
    }
  }
  return states;
}

export const regularsOf = (game: GameState, memo?: VoicesMemo): RegularState[] => regularsFrom(game.seed, game.history, memo);

// ───────── words ─────────
const first = (def: RegularDef) => def.name.split(" ")[0]!;

export function vars(game: Pick<GameState, "restaurantName" | "districtId">, def: RegularDef, dishId?: string, weekday?: number): Record<string, string | undefined> {
  return {
    name: first(def),
    dish: dishLabel(dishId) ?? "special",
    weekday: weekday === undefined ? undefined : WEEKDAY[weekday],
    restaurant: game.restaurantName,
    district: districtName(game.districtId),
    blogger: blogger().name,
  };
}
const WEEKDAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface BeatText { beat: number; day: number; good: boolean; text: string; photo?: { emoji: string; caption: string }; dishId?: string; lapsed?: true }

/** Round 14 (F, G4): the words for a lapsed order (a seeded pick; {name} only). */
export function lapsedLine(game: Pick<GameState, "seed" | "restaurantName" | "districtId">, def: RegularDef, beat: number): string {
  const pool = voices.regulars.lapsed ?? [];
  if (!pool.length) return `${first(def)} went elsewhere that night.`;
  return fill(pool[h32(game.seed, "reg:lapsed", def.id, beat) % pool.length]!, vars(game, def));
}

/** The story so far, in words: the intro, then each beat's good or bad line. */
export function storyOf(game: GameState, s: RegularState): BeatText[] {
  const days = new Map(game.history.map((d) => [d.day, d]));
  return s.done.map((b) => {
    if (b.beat === 0) return { beat: 0, day: b.day, good: true, text: s.def.intro };
    if (b.lapsed) return { beat: b.beat, day: b.day, good: false, lapsed: true, text: lapsedLine(game, s.def, b.beat) };
    const beat: RegularBeat = s.def.beats[b.beat - 1]!;
    const dishId = b.dishId ?? beat.dishes.find((x) => { const d = days.get(b.day); return d ? sold(d, x) : false; }) ?? beat.dishes[0];
    const v = vars(game, s.def, dishId, weekdayIndex(b.day));
    return {
      beat: b.beat, day: b.day, good: b.good, dishId,
      text: fill(b.good ? beat.good : beat.bad!, v),
      ...(b.good ? { photo: { emoji: beat.photo.emoji, caption: fill(beat.photo.caption, v) } } : {}),
    };
  });
}

/** The open VIP order as a sentence ("Priya has a first date on Friday and wants the Chicken katsu curry…"). */
export function orderText(game: GameState, s: RegularState): string | undefined {
  if (!s.open) return undefined;
  return fill(s.def.beats[s.open.beat - 1]!.order, vars(game, s.def, s.open.dishId, s.open.weekday));
}

/** Gossip for a beat that was met well on `day` (the morning after reads it out). */
export function beatGossip(game: GameState, regulars: readonly RegularState[], day: number): string | undefined {
  for (const s of regulars) {
    const b = s.done.find((x) => x.day === day && x.beat > 0 && x.good);
    if (!b) continue;
    const beat = s.def.beats[b.beat - 1]!;
    const d = game.history.find((x) => x.day === day);
    const dishId = b.dishId ?? beat.dishes.find((x) => (d ? sold(d, x) : false)) ?? beat.dishes[0];
    return fill(beat.gossip, vars(game, s.def, dishId, weekdayIndex(day)));
  }
  return undefined;
}

export const lines = () => voices.regulars.lines;
export { weekdayName };

// ───────── names on the floor ─────────
const seated = (c: Customer) => c.stage !== "queue" && c.stage !== "left";
const byArrival = (a: Customer, b: Customer) => a.arrivedTick - b.arrivedTick || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Names stay on the party they were first given to for the rest of the day (and a new day starts afresh). */
let memo: { key: string; names: Map<CustomerId, string>; given: Set<string>; regs?: RegularState[] } = { key: "", names: new Map(), given: new Set() };
/** Tests: forget the floor names. */
export function resetFloorNames(): void { memo = { key: "", names: new Map(), given: new Set() }; }

/**
 * Today's named guests during service: a regular whose VIP order is for today sits with the first party that ordered
 * the dish; a regular joining today with the first party of their kind; Ruth Lessley on a visit day with the first small
 * party seated after mid-afternoon. A name tag shows when the table is tapped (canvas `guestNames`).
 */
export function floorNames(game: GameState): ReadonlyMap<CustomerId, string> {
  const key = `${game.seed}:${game.day}:${game.history.length}`;
  if (memo.key !== key) memo = { key, names: new Map(), given: new Set() };
  if (game.phase !== "service" || !game.customers.length) return memo.names;
  const today = weekdayIndex(game.day);
  const menu = new Set(game.menu.filter((m) => m.active).map((m) => m.dishId));
  const wants: { who: string; ok: (c: Customer) => boolean }[] = [];
  const regs = (memo.regs ??= regularsOf(game));
  const joining = regs.find((s) => s.joined === undefined && s.plannedDay <= game.day);
  for (const s of regs) {
    const o = s.open;
    if (o && o.weekday === today && o.from <= game.day && menu.has(o.dishId)) wants.push({ who: s.def.name, ok: (c) => c.order.includes(o.dishId) });
  }
  if (joining) wants.push({ who: joining.def.name, ok: (c) => c.segment === joining.def.segment });
  if (visitsOn(game.seed, game.day)) {
    const after = 40 + (h32(game.seed, "blogger:tick", game.day) % 60);
    wants.push({ who: `${blogger().name} (food blogger)`, ok: (c) => c.arrivedTick >= after && c.partySize <= 2 });
  }
  const free = [...game.customers].filter(seated).sort(byArrival);
  for (const w of wants) {
    if (memo.given.has(w.who)) continue;
    const c = free.find((x) => !memo.names.has(x.id) && w.ok(x));
    if (!c) continue;
    memo.names.set(c.id, w.who);
    memo.given.add(w.who);
  }
  return memo.names;
}

// ───────── Round 13 (D): thank-you notes and the regular of the month ─────────
/** The story is over: the last VIP beat is done (good or bad). */
export const storyDone = (s: RegularState): boolean => s.done.some((b) => b.beat === s.def.beats.length);

/** The note a regular leaves when their story finishes (a seeded pick from `thanks`), or undefined while it runs. */
export function thanksNote(game: Pick<GameState, "seed" | "restaurantName" | "districtId">, s: RegularState): { day: number; text: string } | undefined {
  const last = s.done.find((b) => b.beat === s.def.beats.length);
  const pool = voices.regulars.thanks ?? [];
  if (!last || !pool.length) return undefined;
  return { day: last.day, text: fill(pool[h32(game.seed, "reg:thanks", s.def.id) % pool.length]!, vars(game, s.def, s.def.favourite)) };
}

/**
 * The chapter card's "Regular of the month": whoever's story moved on most in days `from`–`to` (good beats count
 * double, a newcomer's intro once); ties go to the one whose last beat was later. Undefined when nobody's did.
 */
export function regularOfMonth(regs: readonly RegularState[], from: number, to: number): { s: RegularState; beats: number } | undefined {
  let best: { s: RegularState; score: number; beats: number; last: number } | undefined;
  for (const s of regs) {
    const inside = s.done.filter((b) => b.day >= from && b.day <= to && !b.lapsed);
    if (!inside.length) continue;
    const score = inside.reduce((a, b) => a + (b.beat === 0 ? 1 : b.good ? 2 : 1), 0);
    const last = Math.max(...inside.map((b) => b.day));
    if (!best || score > best.score || (score === best.score && last > best.last)) best = { s, score, beats: inside.length, last };
  }
  return best && { s: best.s, beats: best.beats };
}
