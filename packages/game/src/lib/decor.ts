/**
 * Round 10 (decorating): the few decor words the main chunk needs — the header's style badge, the Decorate tab badge
 * and hint, and the evening's lines. The Decorate panel itself is a lazy chunk (screens/planning/DecorateTab.tsx).
 */
import type { DayResult, DecorSlot, DecorTag, GameState } from "@full-plate/sim-core";
import { content, DECOR_SLOTS, decorStyle, decorWear, findDecorItem, installedDecor } from "../sim";
import { formatPence } from "./format";

export const SLOT_LABEL: Record<DecorSlot, string> = {
  floor: "Floor", walls: "Walls", lighting: "Lights", seating: "Seats", tables: "Tables",
  signage: "Sign", plants: "Plants", music: "Music", window: "Window",
};

/** The room's style name when it has one ("Cosy café"), else undefined (the header shows nothing). */
export function styleBadge(game: Pick<GameState, "decor">): { tag: DecorTag; name: string } | undefined {
  const tag = decorStyle(content, game);
  return tag ? { tag, name: content.decor?.styles[tag]?.name ?? tag } : undefined;
}

/** Slots whose bought item looks tired today. */
export function tiredSlots(game: Pick<GameState, "decor" | "day">): DecorSlot[] {
  if (!game.decor) return [];
  return DECOR_SLOTS.filter((s) => {
    const it = installedDecor(content, game, s);
    return !!it?.bought && decorWear(it.item, it.since, game.day) === "tired";
  });
}

/** "Your fairy lights look tired" (plural-aware on the item name). */
export function tiredText(game: Pick<GameState, "decor" | "day">, slot: DecorSlot): string {
  const it = installedDecor(content, game, slot);
  const name = it?.item.name ?? SLOT_LABEL[slot];
  return `Your ${name.charAt(0).toLowerCase()}${name.slice(1)} ${/s$/.test(name) ? "look" : "looks"} tired`;
}

export interface DecorLine { icon: string; title: string; text: string; bad?: boolean }

/** The evening's decor lines: new items' first night, the fitters' closed tables, items that went tired today. */
export function decorLines(r: Pick<DayResult, "decor" | "closed" | "covers">, game: Pick<GameState, "decor" | "day">): DecorLine[] {
  const d = r.decor;
  if (!d) return [];
  const out: DecorLine[] = [];
  for (const f of d.fitted) {
    const item = findDecorItem(content, f.itemId);
    if (!item) continue;
    const name = `${item.name.charAt(0).toLowerCase()}${item.name.slice(1)}`;
    out.push({ icon: "🎨", title: `Your new ${name}`, text: r.closed ? "Fitted while you were closed." : r.covers ? `${cap(item.nightLine ?? "they looked lovely")}.` : "Fitted today — no guests came to see it yet." });
  }
  if (d.tablesClosed > 0) out.push({ icon: "🪜", title: "The fitters were in", text: `${d.tablesClosed} table${d.tablesClosed === 1 ? " was" : "s were"} closed tonight while they worked. Every table is back tomorrow.` });
  for (const slot of d.tired) {
    const it = installedDecor(content, game, slot);
    const cost = it ? formatPence(it.item.refreshCost, { whole: true }) : "";
    out.push({ icon: "🧽", title: tiredText(game, slot), text: `A refresh (${cost}) in Decorate makes it like new.`, bad: true });
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
