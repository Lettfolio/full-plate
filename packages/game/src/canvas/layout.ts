/** Floor-plan geometry for the owner's restaurant canvas (split out of RestaurantView.ts in round 11). */
import type { Table, TableId } from "@full-plate/sim-core";

// ───────────────────────── geometry ─────────────────────────
export interface Pt { x: number; y: number }
export interface TableSlot { id: TableId; x: number; y: number; r: number; seats: (Pt & { a: number })[] }

export interface Layout {
  w: number;
  h: number;
  kitchen: { x: number; y: number; w: number; h: number };
  pass: { x: number; y: number; w: number; h: number };
  stoves: Pt[];
  dining: { x: number; y: number; w: number; h: number };
  wallY: number;
  door: { x: number; w: number };
  doorIn: Pt;
  doorOut: Pt;
  pavement: { y: number; h: number };
  tables: Map<TableId, TableSlot>;
  person: number; // person radius
  tablesKey: string;
  /** Round 8: walkways (y) between table rows — staff and guests walk along these. */
  aisles: number[];
  /** Round 8: a bar counter on the right of the dining room when the tables leave room for it. */
  bar?: { x: number; y: number; w: number; h: number };
}

export function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
export function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
export function dist(a: Pt, b: Pt) { return Math.hypot(a.x - b.x, a.y - b.y); }

export function computeLayout(w: number, h: number, tables: Table[]): Layout {
  const kitchenH = clamp(h * 0.2, 96, 136);
  const paveH = clamp(h * 0.18, 84, 120);
  const wallY = h - paveH;
  const passH = 22;
  const kitchen = { x: 0, y: 0, w, h: kitchenH };
  const pass = { x: w * 0.06, y: kitchenH - passH, w: w * 0.62, h: passH };
  const stoveCount = 4;
  const stoves = Array.from({ length: stoveCount }, (_, i) => ({ x: w * 0.12 + i * (w * 0.5 / (stoveCount - 1)), y: 26 }));
  const door = { x: w * 0.8, w: Math.max(54, w * 0.07) };
  const dining = { x: 16, y: kitchenH + 18, w: w - 32, h: wallY - kitchenH - 30 };
  const doorIn = { x: door.x + door.w / 2, y: wallY - 26 };
  const doorOut = { x: door.x + door.w / 2, y: wallY + 22 };

  // table grid — leave a walkway column in front of the door
  const n = Math.max(1, tables.length);
  const usableW = dining.w * 0.86;
  const cols = clamp(Math.round(Math.sqrt((n * usableW) / Math.max(1, dining.h))), 1, n);
  const rows = Math.ceil(n / cols);
  const cellW = usableW / cols;
  const cellH = dining.h / rows;
  const maxSeats = Math.max(2, ...tables.map((t) => t.seats));
  const baseR = clamp(Math.min(cellW, cellH) * 0.21, 14, 40);
  const person = clamp(baseR * 0.36, 5, 10);
  const slots = new Map<TableId, TableSlot>();
  let right = 0;
  tables.forEach((t, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const offset = ((cols - inRow) * cellW) / 2; // centre a short last row
    const x = dining.x + offset + cellW * (col + 0.5);
    const y = dining.y + cellH * (row + 0.5);
    const r = baseR * (0.72 + 0.28 * (t.seats / maxSeats));
    const seatR = r + person * 1.25;
    const seats = Array.from({ length: t.seats }, (_, k) => {
      const a = -Math.PI / 2 + (k / t.seats) * Math.PI * 2 + (t.seats === 2 ? Math.PI / 2 : Math.PI / t.seats);
      return { x: x + Math.cos(a) * seatR, y: y + Math.sin(a) * seatR, a };
    });
    slots.set(t.id, { id: t.id, x, y, r, seats });
    right = Math.max(right, x + r + person * 3.4);
  });
  const aisles = [kitchenH + 16];
  for (let k = 1; k < rows; k++) aisles.push(dining.y + cellH * k);
  aisles.push(wallY - 26);
  const barW = 30;
  const barX = w - 16 - barW - 12;
  const bar = barX - right >= 44 ? { x: barX, y: dining.y + 4, w: barW, h: Math.min(dining.h * 0.55, 170) } : undefined;
  return {
    w, h, kitchen, pass, stoves, dining, wallY, door, doorIn, doorOut,
    pavement: { y: wallY, h: paveH }, tables: slots, person,
    tablesKey: tables.map((t) => `${t.id}:${t.seats}`).join(","),
    aisles, ...(bar ? { bar } : {}),
  };
}

/**
 * Round 8: a walk that reads — along the nearest aisle, then straight to the spot — instead of a beeline through the
 * tables. `from` and `to` in CSS px; returns the waypoints after `from`.
 */
export function aislePath(L: Layout, from: Pt, to: Pt): Pt[] {
  if (Math.abs(from.y - to.y) < 6 || Math.abs(from.x - to.x) < 6) return [to];
  let a = L.aisles[0]!;
  for (const y of L.aisles) if (Math.abs(y - from.y) < Math.abs(a - from.y)) a = y;
  return [{ x: from.x, y: a }, { x: to.x, y: a }, to];
}
