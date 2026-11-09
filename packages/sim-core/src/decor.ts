/**
 * Round 10: decorating. The dining room has DECOR_SLOTS (floor, walls, lighting, …), each holding one item from
 * `ContentPack.decor`. A slot not in `GameState.decor.slots` holds its starter item (no effects, never tires), so a
 * game that never decorates — every old save — plays exactly as before and serialises byte-identically.
 *
 * Effects are summed over the room and capped (DECOR_CAPS): prestige and popularity shift where those scores settle
 * (reputation.ts), comfort adds satisfaction points (payment.ts), stay adds eating ticks (service.ts), spend nudges
 * extra courses (order.ts), upkeep goes in overheads (finance.ts), and the dominant style nudges each segment's entry
 * (arrival.ts) and critics' verdicts. Items wear: worn from DECOR_WORN_SHARE of lifeDays, tired at 100% (half the
 * good effects and a small prestige drag) until REFRESH_DECOR. Pure, integer pence, deterministic.
 */
import {
  DECOR_CAPS,
  DECOR_MIN_OPEN_TABLES,
  DECOR_SLOTS,
  DECOR_STYLE_MIN,
  DECOR_TIRED_DRAG,
  DECOR_TIRED_DRAG_CAP,
  DECOR_WORN_SHARE,
} from "./constants";
import type { ContentPack, DayDecor, DecorItemDef, DecorSlot, DecorState, DecorTag, GameState, SegmentId } from "./types";

export type DecorWear = "fresh" | "worn" | "tired";

/** The room's summed effects (after wear and caps) and its dominant style. */
export interface DecorEffects {
  prestige: number;
  popularity: number;
  comfort: number;
  stay: number;
  spend: number;
  upkeep: number;
  /** The dominant tag (DECOR_STYLE_MIN bought items share it, more than any other tag), or null. */
  style: DecorTag | null;
  /** Entry-logit nudge per segment from the style. */
  segments: Readonly<Record<SegmentId, number>>;
  /** Satisfaction points for a VIP (critic) party from the style. */
  critic: number;
}

export const NO_DECOR_EFFECTS: DecorEffects = Object.freeze({
  prestige: 0, popularity: 0, comfort: 0, stay: 0, spend: 0, upkeep: 0, style: null, segments: Object.freeze({}), critic: 0,
});

export const isDecorSlot = (x: unknown): x is DecorSlot => typeof x === "string" && (DECOR_SLOTS as readonly string[]).includes(x);

export function findDecorItem(content: ContentPack, itemId: string): DecorItemDef | undefined {
  return content.decor?.items.find((i) => i.id === itemId);
}

/** The catalogue for one slot, cheapest first (starter first). */
export function decorCatalogue(content: ContentPack, slot: DecorSlot): DecorItemDef[] {
  return (content.decor?.items ?? []).filter((i) => i.slot === slot).sort((a, b) => a.price - b.price || (a.starter ? -1 : b.starter ? 1 : 0));
}

export function starterItem(content: ContentPack, slot: DecorSlot): DecorItemDef | undefined {
  return content.decor?.items.find((i) => i.slot === slot && i.starter);
}

/** What a slot holds now: the bought item and the day it was fitted/refreshed, or the starter (since 0). */
export function installed(content: ContentPack, state: Pick<GameState, "decor">, slot: DecorSlot): { item: DecorItemDef; since: number; bought: boolean } | undefined {
  const s = state.decor?.slots[slot];
  const bought = s ? findDecorItem(content, s.itemId) : undefined;
  if (bought && s) return { item: bought, since: s.since, bought: !bought.starter };
  const starter = starterItem(content, slot);
  return starter ? { item: starter, since: 0, bought: false } : undefined;
}

/** How tired an item looks on `day` (fitted or refreshed on `since`). Starter items and lifeDays 0 never tire. */
export function wearOf(item: DecorItemDef, since: number, day: number): DecorWear {
  if (item.starter || item.lifeDays <= 0) return "fresh";
  const age = Math.max(0, day - since);
  if (age >= item.lifeDays) return "tired";
  return age >= Math.ceil(item.lifeDays * DECOR_WORN_SHARE) ? "worn" : "fresh";
}

/** 0 (new) … 1 (tired) for the canvas fade; starter items 0. */
export function wearShare(item: DecorItemDef, since: number, day: number): number {
  if (item.starter || item.lifeDays <= 0) return 0;
  return Math.min(1, Math.max(0, day - since) / item.lifeDays);
}

const half = (x: number) => (x > 0 ? Math.floor(x / 2) : x);
const capped = (x: number, cap: number) => Math.max(-cap, Math.min(cap, x));

/** The dominant style among bought items' tags, or null (none bought, too few, or a tie). */
export function decorStyle(content: ContentPack, state: Pick<GameState, "decor">): DecorTag | null {
  if (!state.decor) return null;
  const counts = new Map<DecorTag, number>();
  for (const slot of DECOR_SLOTS) {
    const it = installed(content, state, slot);
    if (!it?.bought) continue;
    for (const t of it.item.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: DecorTag | null = null;
  let n = 0;
  let tie = false;
  for (const [t, c] of [...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (c > n) { best = t; n = c; tie = false; } else if (c === n) tie = true;
  }
  return best && n >= DECOR_STYLE_MIN && !tie ? best : null;
}

/** The style's display name ("Cosy café"), or the plain / mixed name. */
export function decorStyleName(content: ContentPack, state: Pick<GameState, "decor">): string {
  const pack = content.decor;
  if (!pack) return "";
  const style = decorStyle(content, state);
  if (style) return pack.styles[style]?.name ?? style;
  const anyBought = DECOR_SLOTS.some((s) => installed(content, state, s)?.bought);
  return anyBought ? pack.mixedName : pack.plainName;
}

const memo = new WeakMap<DecorState, Map<number, DecorEffects>>();

/** The room's effects on `state.day` (memoised per decor object and day; a game without decor gets NO_DECOR_EFFECTS). */
export function decorEffects(content: ContentPack, state: Pick<GameState, "decor" | "day">): DecorEffects {
  const decor = state.decor;
  if (!decor || !content.decor) return NO_DECOR_EFFECTS;
  let byDay = memo.get(decor);
  const hit = byDay?.get(state.day);
  if (hit) return hit;
  let prestige = 0, popularity = 0, comfort = 0, stay = 0, spend = 0, upkeep = 0, drag = 0;
  for (const slot of DECOR_SLOTS) {
    const it = installed(content, state, slot);
    if (!it?.bought) continue;
    const e = it.item.effects;
    const tired = wearOf(it.item, it.since, state.day) === "tired";
    const f = tired ? half : (x: number) => x;
    prestige += f(e.prestige ?? 0);
    popularity += f(e.popularity ?? 0);
    comfort += f(e.comfort ?? 0);
    stay += f(e.stay ?? 0);
    spend += f(e.spend ?? 0);
    upkeep += e.upkeep ?? 0;
    if (tired) drag += DECOR_TIRED_DRAG;
  }
  const style = decorStyle(content, state);
  const def = style ? content.decor.styles[style] : undefined;
  const out: DecorEffects = Object.freeze({
    prestige: capped(prestige, DECOR_CAPS.prestige) - Math.min(DECOR_TIRED_DRAG_CAP, drag),
    popularity: capped(popularity, DECOR_CAPS.popularity),
    comfort: capped(comfort, DECOR_CAPS.comfort),
    stay: Math.max(0, capped(stay, DECOR_CAPS.stay)),
    spend: Math.max(0, capped(spend, DECOR_CAPS.spend)),
    upkeep: Math.max(0, Math.round(upkeep)),
    style,
    segments: Object.freeze({ ...(def?.segments ?? {}) }),
    critic: def?.critic ?? 0,
  });
  if (!byDay) memo.set(decor, (byDay = new Map()));
  byDay.set(state.day, out);
  return out;
}

/** Tables closed for the fitters tonight (the last ones in the room), leaving at least DECOR_MIN_OPEN_TABLES. */
export function fittingTablesClosed(state: Pick<GameState, "decor" | "day" | "tables">): number {
  const f = state.decor?.fitting;
  if (!f || f.day !== state.day || f.tables <= 0) return 0;
  return Math.max(0, Math.min(f.tables, state.tables.length - DECOR_MIN_OPEN_TABLES));
}

/** Ids of the tables the fitters have closed tonight. */
export function closedTableIds(state: Pick<GameState, "decor" | "day" | "tables">): string[] {
  const n = fittingTablesClosed(state);
  return n ? state.tables.slice(state.tables.length - n).map((t) => t.id) : [];
}

/** Morning (advanceDay): pending items are fitted (since = today) and today becomes their fitting day. */
export function fitPending(decor: DecorState | undefined, day: number): DecorState | undefined {
  if (!decor) return undefined;
  const { pending, fitting: _f, ...rest } = decor;
  if (!pending?.length) return _f && _f.day >= day ? decor : rest;
  const slots = { ...decor.slots };
  for (const p of pending) slots[p.slot] = { itemId: p.itemId, since: day };
  return { ...rest, slots, fitting: { day, tables: Math.max(0, ...pending.map((p) => p.tables)), slots: pending.map((p) => p.slot) } };
}

/** Tonight's DayResult.decor (fitted this morning, tables closed, items that turned tired today), or undefined. */
export function dayDecor(content: ContentPack, state: GameState): DayDecor | undefined {
  if (!state.decor || !content.decor) return undefined;
  const f = state.decor.fitting;
  const fitted = f && f.day === state.day
    ? f.slots.map((slot) => ({ slot, itemId: state.decor!.slots[slot]?.itemId ?? "" })).filter((x) => x.itemId)
    : [];
  const tired: DecorSlot[] = [];
  for (const slot of DECOR_SLOTS) {
    const it = installed(content, state, slot);
    if (it?.bought && wearOf(it.item, it.since, state.day) === "tired" && wearOf(it.item, it.since, state.day - 1) !== "tired") tired.push(slot);
  }
  const tablesClosed = state.todays.closed ? 0 : fittingTablesClosed(state);
  if (!fitted.length && !tired.length && !tablesClosed) return undefined;
  return { fitted, tablesClosed, tired };
}
