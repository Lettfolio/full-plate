/**
 * Round 10: the decor on the owner's floor. RestaurantView asks `roomLook` what each slot holds (and how worn it is)
 * once per frame — memoised on the decor object and day — puts `look.key` in its static-layer key, and calls the
 * painters below from its cached scene layer (floor, walls, lamps, chairs, tables, sign, plants, window, music) and
 * live (closed-table dust sheets, the music note). The starter kit paints nothing here: the round-8 picture is kept.
 *
 * A worn item's colours fade a little toward DECOR_ART.worn, a tired one more, with scuffs, so the child can see why
 * the Decorate tab says "looking tired".
 */
import type { ContentPack, DecorSlot, GameState } from "@full-plate/sim-core";
import { closedTableIds, DECOR_SLOTS, decorWear, installedDecor } from "../sim";
import type { FloorPalette } from "./floorPalette";
import { DECOR_ART as A } from "./decorPalette";

export interface RoomLook {
  /** Item id per slot (the starter's id when nothing is bought). */
  items: Record<DecorSlot, string>;
  /** 0 fresh, 1 worn, 2 tired. */
  wear: Record<DecorSlot, 0 | 1 | 2>;
  /** Everything that changes the cached picture. */
  key: string;
  /** Tables the fitters have tonight (drawn live). */
  closed: string[];
}

interface Pt { x: number; y: number }
/** The parts of RestaurantView's Layout the painters use. */
export interface DecorLayout {
  w: number; h: number; wallY: number;
  kitchen: { h: number };
  dining: { x: number; y: number; w: number; h: number };
  door: { x: number; w: number };
  pavement: { h: number };
  aisles: number[];
  tables: Map<string, { id: string; x: number; y: number; r: number }>;
  bar?: { x: number; y: number; w: number; h: number };
}

const STARTER: Record<DecorSlot, string> = {
  floor: "floor_oak", walls: "walls_cream", lighting: "light_bulbs", seating: "seat_wood", tables: "table_pine",
  signage: "sign_board", plants: "plant_pots", music: "music_none", window: "window_planters",
};

export const PLAIN_LOOK: RoomLook = { items: { ...STARTER }, wear: Object.fromEntries(Object.keys(STARTER).map((k) => [k, 0])) as RoomLook["wear"], key: "", closed: [] };

const memo = new WeakMap<object, { day: number; tables: number; look: RoomLook }>();

/** What the room looks like for `game` (the plain look when it has never been decorated). */
export function roomLook(content: ContentPack, game: Pick<GameState, "decor" | "day" | "tables">): RoomLook {
  const d = game.decor;
  if (!d || !content.decor) return PLAIN_LOOK;
  const hit = memo.get(d);
  if (hit && hit.day === game.day && hit.tables === game.tables.length) return hit.look;
  const items = { ...STARTER };
  const wear = { ...PLAIN_LOOK.wear };
  for (const slot of DECOR_SLOTS) {
    const it = installedDecor(content, game, slot);
    if (!it) continue;
    items[slot] = it.item.id;
    const w = decorWear(it.item, it.since, game.day);
    wear[slot] = w === "tired" ? 2 : w === "worn" ? 1 : 0;
  }
  const key = DECOR_SLOTS.filter((s) => items[s] !== STARTER[s]).map((s) => `${items[s]}${wear[s]}`).join(".");
  const look: RoomLook = { items, wear, key, closed: closedTableIds(game) };
  memo.set(d, { day: game.day, tables: game.tables.length, look });
  return look;
}

// ── small helpers (RestaurantView keeps its own; these stay private to the decor art) ──
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round((((pa >> s) & 255) * (1 - t)) + (((pb >> s) & 255) * t));
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}
function alpha(hex: string, a: number): string {
  const p = parseInt(hex.slice(1), 16);
  return `rgba(${(p >> 16) & 255},${(p >> 8) & 255},${p & 255},${a})`;
}
function noise(i: number, j = 0): number {
  let h = (i * 374761393 + j * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const q = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + q, y); ctx.arcTo(x + w, y, x + w, y + h, q); ctx.arcTo(x + w, y + h, x, y + h, q);
  ctx.arcTo(x, y + h, x, y, q); ctx.arcTo(x, y, x + w, y, q); ctx.closePath();
}
function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string) {
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}
const tableIndex = (id: string) => Number(id.replace(/\D/g, "")) || 0;

/** Colour as this slot's wear shows it: worn fades a little, tired more. */
export function faded(look: RoomLook, slot: DecorSlot, col: string): string {
  const w = look.wear[slot];
  return w ? mix(col, A.worn, w === 2 ? 0.55 : 0.22) : col;
}
/** A few scuffs over an area when the slot is tired (deterministic per spot). */
function scuffs(ctx: CanvasRenderingContext2D, look: RoomLook, slot: DecorSlot, x: number, y: number, w: number, h: number, n = 3) {
  if (look.wear[slot] < 2) return;
  ctx.strokeStyle = alpha(A.scuff, 0.45); ctx.lineWidth = 1.6; ctx.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const px = x + noise(i + Math.round(x), 31) * w, py = y + noise(i + Math.round(y), 47) * h;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + 4, py - 3, px + 9, py + 1); ctx.stroke();
  }
  ctx.lineCap = "butt";
}

// ───────── floor ─────────
/** Paints the dining floor for a bought floor (true), or leaves the oak planks to RestaurantView (false). Rugs go on top. */
export function paintDecorFloor(ctx: CanvasRenderingContext2D, L: DecorLayout, look: RoomLook, top: number, bottom: number): boolean {
  const f = look.items.floor;
  if (f === "floor_oak" || f === "floor_rugs") return false;
  const c = (col: string) => faded(look, "floor", col);
  ctx.save(); ctx.beginPath(); ctx.rect(0, top, L.w, bottom - top); ctx.clip();
  if (f === "floor_checker") {
    const q = 22;
    for (let j = 0, y = top; y < bottom; j++, y += q) for (let i = 0, x = 0; x < L.w; i++, x += q) {
      ctx.fillStyle = c((i + j) & 1 ? A.checkDark : A.checkLight); ctx.fillRect(x, y, q, q);
    }
  } else if (f === "floor_terrazzo") {
    ctx.fillStyle = c(A.terrazzo); ctx.fillRect(0, top, L.w, bottom - top);
    const chips = [A.rugA, A.rugB, A.palm, A.checkDark, A.crystalEdge];
    for (let i = 0; i < (L.w * (bottom - top)) / 260; i++) {
      dot(ctx, noise(i, 1) * L.w, top + noise(i, 2) * (bottom - top), 1 + noise(i, 3) * 1.8, c(chips[i % chips.length]!));
    }
    ctx.fillStyle = "rgba(255,255,255,0.18)"; for (let y = top + 40; y < bottom; y += 80) ctx.fillRect(0, y, L.w, 1);
  } else if (f === "floor_parquet") {
    const pw = 26, ph = 9;
    for (let j = 0, y = top - ph; y < bottom + ph; j++, y += ph * 2) for (let i = 0, x = -pw; x < L.w + pw; i++, x += pw) {
      ctx.fillStyle = c(noise(i, j) > 0.5 ? A.parquetA : A.parquetB);
      ctx.beginPath();
      if (i & 1) { ctx.moveTo(x, y); ctx.lineTo(x + pw, y + ph); ctx.lineTo(x + pw, y + ph * 3); ctx.lineTo(x, y + ph * 2); }
      else { ctx.moveTo(x, y + ph); ctx.lineTo(x + pw, y); ctx.lineTo(x + pw, y + ph * 2); ctx.lineTo(x, y + ph * 3); }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = alpha(A.parquetLine, 0.35); ctx.lineWidth = 1; ctx.stroke();
    }
  }
  ctx.restore();
  scuffs(ctx, look, "floor", 20, top + 10, L.w - 40, bottom - top - 20, 9);
  return true;
}

/** Big rugs under each table (floor_rugs), over the planks. */
export function paintRugs(ctx: CanvasRenderingContext2D, L: DecorLayout, look: RoomLook) {
  if (look.items.floor !== "floor_rugs") return;
  for (const s of L.tables.values()) {
    const R = s.r * 2.05;
    ctx.fillStyle = faded(look, "floor", A.rugFringe); rr(ctx, s.x - R - 3, s.y - R * 0.86, R * 2 + 6, R * 1.72, 10); ctx.fill();
    ctx.fillStyle = faded(look, "floor", A.rugA); rr(ctx, s.x - R, s.y - R * 0.82, R * 2, R * 1.64, 9); ctx.fill();
    ctx.strokeStyle = faded(look, "floor", A.rugB); ctx.lineWidth = 3; rr(ctx, s.x - R + 6, s.y - R * 0.82 + 6, R * 2 - 12, R * 1.64 - 12, 6); ctx.stroke();
    scuffs(ctx, look, "floor", s.x - R, s.y - R * 0.7, R * 2, R * 1.4, 3);
  }
}

// ───────── walls ─────────
/** Wall-band colours (cap, body, face) for the room's walls; undefined = the round-8 brown. */
export function wallColours(look: RoomLook): { top: string; wall: string; face: string } | undefined {
  const w = look.items.walls;
  const f = (c: string) => faded(look, "walls", c);
  if (w === "walls_sunny") return { top: f(A.sunnyTop), wall: f(A.sunny), face: f(A.sunnyFace) };
  if (w === "walls_stripes") return { top: f(A.stripeA), wall: f(A.stripeB), face: f(mix(A.stripeB, A.scuff, 0.4)) };
  if (w === "walls_panels") return { top: f(A.panelTop), wall: f(A.panel), face: f(A.panelFace) };
  if (w === "walls_damask") return { top: f(A.damaskTop), wall: f(A.damask), face: f(A.damaskFace) };
  return undefined;
}

/** The dining room's side walls (left and right edges), papered or painted. Nothing for the starter cream. */
export function paintSideWalls(ctx: CanvasRenderingContext2D, L: DecorLayout, look: RoomLook) {
  const col = wallColours(look);
  if (!col) return;
  const y0 = L.kitchen.h + 7, y1 = L.wallY - 5, w = 14;
  for (const x of [0, L.w - w]) {
    ctx.fillStyle = col.wall; ctx.fillRect(x, y0, w, y1 - y0);
    ctx.fillStyle = col.top; ctx.fillRect(x === 0 ? 0 : x + 5, y0, 9, y1 - y0);
    const it = look.items.walls;
    if (it === "walls_stripes") { ctx.fillStyle = faded(look, "walls", mix(A.stripeB, A.scuff, 0.2)); for (let k = 0; k < 3; k++) ctx.fillRect(x + 2 + k * 4.5, y0, 2, y1 - y0); }
    if (it === "walls_panels") { ctx.strokeStyle = col.face; ctx.lineWidth = 1; for (let y = y0 + 6; y < y1 - 30; y += 44) ctx.strokeRect(x + 2, y, w - 4, 36); }
    if (it === "walls_damask") for (let y = y0 + 8; y < y1; y += 14) { dot(ctx, x + w / 2, y, 2.6, faded(look, "walls", A.gilt)); dot(ctx, x + w / 2, y + 7, 1.2, faded(look, "walls", A.gilt)); }
    if (it === "walls_sunny") { ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(x + (x === 0 ? 1 : 5), y0, 2, y1 - y0); }
    ctx.fillStyle = "rgba(52,32,14,0.22)"; ctx.fillRect(x === 0 ? w : x - 3, y0, 3, y1 - y0);
    scuffs(ctx, look, "walls", x, y0 + 20, w, y1 - y0 - 40, 4);
  }
}

// ───────── lighting ─────────
/** The colour and size of the pool of light under each table. */
export function lightPool(look: RoomLook, fallback: string): { colour: string; scale: number; evening: string } {
  switch (look.items.lighting) {
    case "light_lanterns": return { colour: "rgba(255,170,100,0.3)", scale: 2.5, evening: "255,170,100" };
    case "light_fairy": return { colour: "rgba(255,226,170,0.2)", scale: 2.4, evening: "255,226,170" };
    case "light_brass": return { colour: "rgba(255,200,120,0.3)", scale: 2.5, evening: "255,196,118" };
    case "light_chandelier": return { colour: "rgba(255,238,196,0.36)", scale: 2.9, evening: "255,236,190" };
    default: return { colour: fallback, scale: 2.4, evening: "255,190,110" };
  }
}

/** Where the pendant lamps hang: between neighbouring tables in a row (or beside a lone one), at table height. */
export function lampSpots(L: DecorLayout): { x: number; y: number }[] {
  const rows = new Map<number, number[]>();
  let r = 0;
  for (const s of L.tables.values()) { const k = Math.round(s.y); rows.set(k, [...(rows.get(k) ?? []), s.x]); r = Math.max(r, s.r); }
  const out: { x: number; y: number }[] = [];
  for (const [y, xs] of rows) {
    xs.sort((a, b) => a - b);
    if (xs.length === 1) { out.push({ x: xs[0]! - r * 1.9, y }, { x: xs[0]! + r * 1.9, y }); continue; }
    for (let i = 1; i < xs.length; i++) out.push({ x: (xs[i - 1]! + xs[i]!) / 2, y });
  }
  return out;
}

/** Light fittings: pendants between the tables, or strings of fairy lights over the aisles. */
export function paintLamps(ctx: CanvasRenderingContext2D, L: DecorLayout, look: RoomLook, C: FloorPalette) {
  const kind = look.items.lighting;
  if (kind === "light_bulbs") return;
  const f = (c: string) => faded(look, "lighting", c);
  if (kind === "light_fairy") {
    const x0 = L.dining.x + 14, x1 = (L.bar ? L.bar.x - 20 : L.dining.x + L.dining.w - 14);
    const cols = [C.tomato, C.amber, C.basil, C.sky, C.plum];
    for (const y of L.aisles.slice(0, -1)) {
      ctx.strokeStyle = alpha(C.outline, 0.5); ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 4) { const t = ((x - x0) % 120) / 120; const yy = y + Math.sin(t * Math.PI) * 9; if (x === x0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy); }
      ctx.stroke();
      for (let x = x0 + 6, i = 0; x < x1; x += 13, i++) {
        const t = ((x - x0) % 120) / 120, yy = y + Math.sin(t * Math.PI) * 9 + 2;
        dot(ctx, x, yy, 5, alpha(look.wear.lighting === 2 ? A.worn : "#fff3c4", 0.35));
        dot(ctx, x, yy, 3, f(cols[i % cols.length]!));
      }
    }
    return;
  }
  for (const { x, y } of lampSpots(L)) {
    if (kind === "light_lanterns") {
      dot(ctx, x, y, 15, alpha(A.lanternGlow, 0.35));
      dot(ctx, x + 2, y + 3, 10, "rgba(52,32,14,0.2)");
      dot(ctx, x, y, 10, f(A.lantern));
      ctx.strokeStyle = alpha(mix(A.lantern, A.scuff, 0.45), 0.8); ctx.lineWidth = 1.2;
      for (const k of [-0.55, 0, 0.55]) { ctx.beginPath(); ctx.ellipse(x, y, 10 * Math.cos(k), 10, 0, Math.PI * 0.5, Math.PI * 1.5); ctx.stroke(); ctx.beginPath(); ctx.ellipse(x, y, 10 * Math.cos(k), 10, 0, -Math.PI * 0.5, Math.PI * 0.5); ctx.stroke(); }
      dot(ctx, x - 3, y - 3, 3.5, alpha(A.lanternGlow, 0.9));
      ctx.fillStyle = C.outline; ctx.fillRect(x - 4, y - 11.5, 8, 3); ctx.fillRect(x - 4, y + 8.5, 8, 3);
    } else if (kind === "light_brass") {
      dot(ctx, x, y, 14, alpha("#ffe0a0", 0.3));
      dot(ctx, x + 2, y + 3, 9, "rgba(52,32,14,0.22)");
      dot(ctx, x, y, 9, f(A.brassDeep)); dot(ctx, x - 0.5, y - 0.5, 7, f(A.brass));
      ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 5.5, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
      dot(ctx, x, y, 2.6, "#fff3cf");
    } else {
      // a chandelier: gold arms, a crystal on each, a sparkle
      dot(ctx, x, y, 20, alpha("#fff6dc", 0.4));
      dot(ctx, x + 3, y + 4, 14, "rgba(52,32,14,0.16)");
      ctx.strokeStyle = f(A.brassDeep); ctx.lineWidth = 2;
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12); ctx.stroke(); }
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2, cx = x + Math.cos(a) * 12, cy = y + Math.sin(a) * 12;
        dot(ctx, cx, cy, 3.6, f(A.crystal)); ctx.strokeStyle = f(A.crystalEdge); ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, 3.6, 0, Math.PI * 2); ctx.stroke();
      }
      dot(ctx, x, y, 5, f(A.brass)); dot(ctx, x - 1, y - 1, 2, "#fffbe8");
      if (look.wear.lighting < 2) { ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x + 9, y - 14); ctx.lineTo(x + 9, y - 8); ctx.moveTo(x + 6, y - 11); ctx.lineTo(x + 12, y - 11); ctx.stroke(); }
    }
    scuffs(ctx, look, "lighting", x - 8, y - 6, 16, 12, 1);
  }
}

// ───────── seating and tables ─────────
let seatCount = 0;
/** Resets the per-paint chair counter (rainbow chairs cycle colours round the room). */
export function startSeats() { seatCount = 0; }

/** Draws a bought chair style (true), or leaves the wooden chair to RestaurantView (false). */
export function paintDecorChair(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, s: number, look: RoomLook, C: FloorPalette, shadow: string): boolean {
  const kind = look.items.seating;
  const i = seatCount++;
  if (kind === "seat_wood") return false;
  const f = (c: string) => faded(look, "seating", c);
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  if (kind === "seat_cushions" || kind === "seat_rainbow") {
    const body = kind === "seat_rainbow" ? f([C.tomato, C.amber, C.basil, C.sky, C.plum, C.gold][i % 6]!) : C.chair;
    ctx.fillStyle = shadow; rr(ctx, -s * 0.85 + 2, -s * 0.85 + 3, s * 1.7, s * 1.7, s * 0.4); ctx.fill();
    ctx.fillStyle = body; rr(ctx, -s * 0.85, -s * 0.85, s * 1.7, s * 1.7, s * 0.4); ctx.fill();
    ctx.fillStyle = kind === "seat_rainbow" ? mix(body, "#ffffff", 0.25) : C.chairTop; rr(ctx, -s * 0.7, -s * 0.7, s * 1.3, s * 1.4, s * 0.32); ctx.fill();
    ctx.fillStyle = mix(body, C.outline, 0.35); rr(ctx, s * 0.55, -s * 0.85, s * 0.32, s * 1.7, s * 0.14); ctx.fill();
    if (kind === "seat_cushions") { ctx.fillStyle = f(i & 1 ? A.cushionA : A.cushionB); rr(ctx, -s * 0.62, -s * 0.6, s * 1.08, s * 1.2, s * 0.5); ctx.fill(); ctx.fillStyle = "rgba(255,255,255,0.35)"; dot(ctx, -s * 0.2, -s * 0.25, s * 0.18, "rgba(255,255,255,0.35)"); }
  } else {
    const big = kind === "seat_velvet" ? 1.18 : 1.08;
    const body = f(kind === "seat_velvet" ? A.velvet : A.leather), top = f(kind === "seat_velvet" ? A.velvetTop : A.leatherTop);
    const q = s * big;
    ctx.fillStyle = shadow; rr(ctx, -q * 0.9 + 2, -q * 0.9 + 3, q * 1.8, q * 1.8, q * 0.6); ctx.fill();
    ctx.fillStyle = body; rr(ctx, -q * 0.9, -q * 0.9, q * 1.8, q * 1.8, q * 0.6); ctx.fill();
    ctx.fillStyle = top; rr(ctx, -q * 0.62, -q * 0.6, q * 1.15, q * 1.2, q * 0.45); ctx.fill();
    ctx.fillStyle = mix(body, "#000000", 0.25); rr(ctx, q * 0.45, -q * 0.9, q * 0.45, q * 1.8, q * 0.3); ctx.fill();
    if (kind === "seat_banquettes") for (const [dx, dy] of [[-0.2, -0.25], [-0.2, 0.25], [0.15, 0]]) dot(ctx, q * dx!, q * dy!, 1.1, alpha(C.outline, 0.6));
  }
  if (look.wear.seating === 2 && i % 3 === 0) { ctx.strokeStyle = alpha(A.scuff, 0.6); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(-s * 0.3, -s * 0.2); ctx.lineTo(s * 0.15, s * 0.25); ctx.stroke(); }
  ctx.restore();
  return true;
}

/** Draws a bought table top (true), or leaves the pine top to RestaurantView (false). */
export function paintDecorTable(ctx: CanvasRenderingContext2D, id: string, cx: number, cy: number, r: number, look: RoomLook, C: FloorPalette, shadow: string): boolean {
  const kind = look.items.tables;
  if (kind === "table_pine") return false;
  const f = (c: string) => faded(look, "tables", c);
  const i = tableIndex(id);
  const cloth = kind === "table_gingham" || kind === "table_linen";
  const R = cloth ? r + 2 : r;
  ctx.fillStyle = shadow; ctx.beginPath(); ctx.ellipse(cx + 3, cy + 4, R, R * 0.96, 0, 0, Math.PI * 2); ctx.fill();
  const base = kind === "table_gingham" ? A.linen : kind === "table_linen" ? A.linen : kind === "table_marble" ? A.marble : f([C.sky, C.basil, C.amber, C.plum, C.tomato][i % 5]!);
  ctx.fillStyle = f(kind === "table_marble" ? A.marbleRim : cloth ? A.linenFold : mix(base, C.outline, 0.3)); ctx.beginPath(); ctx.arc(cx, cy + 1.5, R, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = f(base); ctx.beginPath(); ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2); ctx.clip();
  if (kind === "table_gingham") {
    const q = Math.max(5, r / 3.2);
    ctx.fillStyle = alpha(f(C.tomato), 0.45);
    for (let x = cx - R; x < cx + R; x += q * 2) ctx.fillRect(x, cy - R, q, R * 2);
    for (let y = cy - R; y < cy + R; y += q * 2) ctx.fillRect(cx - R, y, R * 2, q);
  } else if (kind === "table_linen") {
    ctx.strokeStyle = f(A.linenFold); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  } else if (kind === "table_marble") {
    ctx.strokeStyle = f(A.marbleVein); ctx.lineWidth = 1;
    for (let k = 0; k < 3; k++) { const o = (noise(i, k) - 0.5) * r; ctx.beginPath(); ctx.moveTo(cx - R, cy + o); ctx.bezierCurveTo(cx - r * 0.3, cy + o - r * 0.4, cx + r * 0.2, cy + o + r * 0.3, cx + R, cy + o - r * 0.2); ctx.stroke(); }
  } else {
    for (let k = 0; k < 5; k++) { const a = k * 1.3 + i; dot(ctx, cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, 1.6, "rgba(255,255,255,0.7)"); }
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, R * 0.78, Math.PI * 1.05, Math.PI * 1.45); ctx.stroke();
  if (look.wear.tables === 2) { ctx.strokeStyle = alpha(A.scuff, 0.35); ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(cx + r * 0.3, cy - r * 0.2, r * 0.18, 0, Math.PI * 1.7); ctx.stroke(); }
  return true;
}

/** Fitting night: a dust sheet over a closed table and its chairs, with a cone. Drawn live. */
export function paintDustSheet(ctx: CanvasRenderingContext2D, s: { x: number; y: number; r: number }, person: number) {
  const R = s.r + person * 2;
  ctx.fillStyle = "rgba(52,32,14,0.2)"; ctx.beginPath(); ctx.ellipse(s.x + 3, s.y + 4, R, R * 0.92, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = A.sheet; ctx.beginPath(); ctx.ellipse(s.x, s.y, R, R * 0.92, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = A.sheetFold; ctx.lineWidth = 1.5;
  for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(s.x - R * 0.7, s.y + k * R * 0.35); ctx.quadraticCurveTo(s.x, s.y + k * R * 0.35 + 5, s.x + R * 0.7, s.y + k * R * 0.35); ctx.stroke(); }
  const cx = s.x + R * 0.7, cy = s.y + R * 0.6;
  ctx.fillStyle = A.cone; ctx.beginPath(); ctx.moveTo(cx, cy - 11); ctx.lineTo(cx + 6, cy + 3); ctx.lineTo(cx - 6, cy + 3); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ffffff"; ctx.fillRect(cx - 3.5, cy - 4, 7, 2.5);
}

// ───────── outside: the sign and the window ─────────
/** Colours of the name board over the door. */
export function signColours(look: RoomLook, C: FloorPalette): { board: string; text: string; edge?: string; glow?: string } {
  const f = (c: string) => faded(look, "signage", c);
  switch (look.items.signage) {
    case "sign_chalk": return { board: f(A.chalk), text: f(A.chalkText), edge: f(A.frame) };
    case "sign_painted": return { board: f(C.basilDeep), text: f(A.goldText), edge: f(A.goldText) };
    case "sign_neon": return { board: A.neonBoard, text: look.wear.signage === 2 ? mix(A.neon, A.worn, 0.5) : A.neon, glow: A.neon };
    case "sign_gold": return { board: A.board, text: f(A.goldText), edge: f(A.goldText) };
    default: return { board: C.ink, text: C.cream };
  }
}

/** The chalkboard's A-frame on the pavement (sign_chalk). */
export function paintAFrame(ctx: CanvasRenderingContext2D, L: DecorLayout, look: RoomLook) {
  if (look.items.signage !== "sign_chalk") return;
  const x = L.door.x + L.door.w + 30, y = L.wallY + L.pavement.h - 52;
  ctx.fillStyle = "rgba(52,32,14,0.22)"; rr(ctx, x + 2, y + 3, 26, 32, 3); ctx.fill();
  ctx.fillStyle = faded(look, "signage", A.frame); rr(ctx, x, y, 26, 32, 3); ctx.fill();
  ctx.fillStyle = faded(look, "signage", A.chalk); ctx.fillRect(x + 3, y + 3, 20, 26);
  ctx.strokeStyle = faded(look, "signage", A.chalkText); ctx.lineWidth = 1.2;
  for (let k = 0; k < 4; k++) { ctx.beginPath(); ctx.moveTo(x + 6, y + 8 + k * 6); ctx.lineTo(x + 6 + 8 + noise(k, 9) * 7, y + 8 + k * 6); ctx.stroke(); }
  if (look.wear.signage < 2) { dot(ctx, x + 18, y + 23, 2.5, A.cakeA); }
}

/** The window display on the sill outside one window (x..x1); false = RestaurantView's planters. */
export function paintWindowDisplay(ctx: CanvasRenderingContext2D, x: number, x1: number, wallY: number, look: RoomLook, C: FloorPalette): boolean {
  const kind = look.items.window;
  if (kind === "window_planters" || kind === "window_menu") return false;
  const f = (c: string) => faded(look, "window", c);
  ctx.fillStyle = "rgba(52,32,14,0.24)"; ctx.fillRect(x + 4, wallY + 9, x1 - x - 4, 8);
  ctx.fillStyle = "#7a5636"; ctx.fillRect(x + 2, wallY + 6, x1 - x - 4, 8);
  if (kind === "window_cakes") {
    for (let px = x + 14, k = 0; px < x1 - 8; px += 24, k++) {
      dot(ctx, px, wallY + 9, 7, A.linen); ctx.strokeStyle = "#a99c86"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px, wallY + 9, 7, 0, Math.PI * 2); ctx.stroke();
      dot(ctx, px, wallY + 8, 4.5, f([A.cakeA, A.cakeB, A.cakeC][k % 3]!)); dot(ctx, px - 1, wallY + 6.5, 1.4, C.tomato);
    }
  } else if (kind === "window_train") {
    ctx.strokeStyle = A.track; ctx.lineWidth = 1.5; rr(ctx, x + 6, wallY + 4, x1 - x - 14, 11, 5); ctx.stroke();
    const tx = x + 14 + ((x1 - x) * 0.35);
    ctx.fillStyle = f(A.train); rr(ctx, tx, wallY + 2, 14, 8, 2); ctx.fill();
    ctx.fillStyle = f(C.sky); rr(ctx, tx - 13, wallY + 3, 11, 7, 2); ctx.fill();
    ctx.fillStyle = f(C.amber); rr(ctx, tx - 26, wallY + 3, 11, 7, 2); ctx.fill();
    dot(ctx, tx + 11, wallY + 1, 2.2, C.ink);
  } else {
    const blooms = [A.bloomA, A.bloomB, A.bloomC, C.tomato];
    for (let px = x + 7, k = 0; px < x1 - 4; px += 8, k++) {
      dot(ctx, px, wallY + 9, 4.5, look.wear.window === 2 ? mix(C.leaf, A.scuff, 0.5) : C.leaf);
      if (k % 2 === 0) dot(ctx, px, wallY + 6, look.wear.window === 2 ? 2.4 : 3.6, f(blooms[k % blooms.length]!));
    }
  }
  return true;
}

/** A lit menu case beside the door (window_menu); drawn after the planters. */
export function paintMenuCase(ctx: CanvasRenderingContext2D, L: DecorLayout, look: RoomLook) {
  if (look.items.window !== "window_menu") return;
  const x = L.door.x + L.door.w + 8, y = L.wallY + 8;
  ctx.fillStyle = "rgba(52,32,14,0.22)"; rr(ctx, x + 2, y + 2, 20, 26, 3); ctx.fill();
  ctx.fillStyle = "#3a2c22"; rr(ctx, x, y, 20, 26, 3); ctx.fill();
  ctx.fillStyle = faded(look, "window", A.menuGlow); ctx.fillRect(x + 3, y + 3, 14, 20);
  ctx.fillStyle = "rgba(43,38,34,0.55)"; for (let k = 0; k < 4; k++) ctx.fillRect(x + 5, y + 6 + k * 4.5, 6 + noise(k, 4) * 4, 1.5);
}

// ───────── plants ─────────
/** Bought plants (true), or RestaurantView's two corner pots (false). */
export function paintPlants(ctx: CanvasRenderingContext2D, L: DecorLayout, look: RoomLook, C: FloorPalette, pot: (x: number, y: number, r: number) => void): boolean {
  const kind = look.items.plants;
  if (kind === "plant_pots") return false;
  const tired = look.wear.plants === 2;
  const leaf = tired ? mix(C.leaf, A.scuff, 0.45) : faded(look, "plants", C.leaf);
  const y0 = L.kitchen.h + 30, y1 = L.wallY - 26;
  if (kind === "plant_herbs") {
    pot(22, L.wallY - 24, 12);
    for (let x = 60; x < L.door.x - 30; x += 130) { dot(ctx, x, L.wallY - 12, 5, C.pot); for (let k = 0; k < 5; k++) dot(ctx, x + Math.cos(k * 1.3) * 3, L.wallY - 14 + Math.sin(k * 1.3) * 3, 2.3, tired ? leaf : A.herb); }
  } else if (kind === "plant_baskets") {
    pot(22, L.wallY - 24, 12);
    for (let y = y0; y < y1; y += 74) for (const x of [16, L.w - 16]) {
      if (L.bar && x > L.w / 2 && y > L.bar.y - 10 && y < L.bar.y + L.bar.h + 10) continue;
      dot(ctx, x + 2, y + 3, 8, "rgba(52,32,14,0.2)"); dot(ctx, x, y, 8, "#8a5d33");
      for (let k = 0; k < 7; k++) { const a = k * 0.9; dot(ctx, x + Math.cos(a) * 5, y + Math.sin(a) * 5, 3, k % 2 ? leaf : faded(look, "plants", [A.bloomA, A.bloomB, A.bloomC][k % 3]!)); }
    }
  } else if (kind === "plant_palms") {
    for (const [x, y] of [[24, L.wallY - 28], [24, y0], ...(L.bar ? [] : [[L.w - 24, y0] as const])] as const) {
      dot(ctx, x + 3, y + 4, 12, "rgba(52,32,14,0.22)"); dot(ctx, x, y, 9, C.pot);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + 0.2;
        ctx.fillStyle = k % 2 ? leaf : (tired ? leaf : faded(look, "plants", A.palmDeep));
        ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * 12, y + Math.sin(a) * 12, 13, 4, a, 0, Math.PI * 2); ctx.fill();
      }
    }
  } else {
    // a flower wall down the left side wall
    pot(22, L.wallY - 24, 12);
    for (let y = y0 - 16; y < L.wallY - 44; y += 7) for (let k = 0; k < 2; k++) {
      dot(ctx, 4 + k * 6, y + (k ? 3 : 0), 3.4, leaf);
      dot(ctx, 4 + k * 6, y + (k ? 3 : 0), 2, tired && noise(y, k) > 0.4 ? mix(A.bloomA, A.scuff, 0.5) : faded(look, "plants", [A.bloomA, A.bloomB, A.bloomC, C.tomato][Math.floor(noise(y, k) * 4)]!));
    }
  }
  return true;
}

// ───────── music ─────────
/** Where the music lives: the bottom-left corner, beside the corner plant. */
export function musicSpot(L: DecorLayout): Pt { return { x: 58, y: L.wallY - 30 }; }

/** The radio, speakers, jukebox or piano (static). */
export function paintMusic(ctx: CanvasRenderingContext2D, L: DecorLayout, look: RoomLook, C: FloorPalette) {
  const kind = look.items.music;
  if (kind === "music_none") return;
  const { x, y } = musicSpot(L);
  const f = (c: string) => faded(look, "music", c);
  ctx.fillStyle = "rgba(52,32,14,0.22)";
  if (kind === "music_radio") {
    rr(ctx, x - 9 + 2, y - 6 + 3, 18, 12, 3); ctx.fill();
    ctx.fillStyle = f(A.radio); rr(ctx, x - 9, y - 6, 18, 12, 3); ctx.fill();
    dot(ctx, x - 3, y, 3.5, f(C.cream)); ctx.fillStyle = C.ink; ctx.fillRect(x + 3, y - 3, 4, 2);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 6, y - 6); ctx.lineTo(x + 11, y - 14); ctx.stroke();
  } else if (kind === "music_speakers") {
    for (const [sx, sy] of [[12, L.kitchen.h + 28], [12, L.wallY - 50], [L.w - 12, L.kitchen.h + 28]] as const) {
      ctx.fillStyle = "rgba(52,32,14,0.22)"; rr(ctx, sx - 6 + 2, sy - 8 + 3, 12, 16, 2); ctx.fill();
      ctx.fillStyle = f(A.speaker); rr(ctx, sx - 6, sy - 8, 12, 16, 2); ctx.fill();
      dot(ctx, sx, sy + 2, 3.5, f("#5c534a")); dot(ctx, sx, sy - 4.5, 1.6, f("#5c534a"));
    }
  } else if (kind === "music_jukebox") {
    rr(ctx, x - 12 + 2, y - 15 + 3, 24, 28, 11); ctx.fill();
    ctx.fillStyle = f(A.jukeboxBody); rr(ctx, x - 12, y - 15, 24, 28, 11); ctx.fill();
    const bands = [C.tomato, C.amber, C.basil, C.sky];
    bands.forEach((b, k) => { ctx.strokeStyle = f(b); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y - 3, 9 - k * 2, Math.PI, 0); ctx.stroke(); });
    ctx.fillStyle = f(C.gold); ctx.fillRect(x - 7, y + 3, 14, 6);
  } else {
    // a grand piano from above: the curved case, the lid line and the keys
    ctx.beginPath(); ctx.moveTo(x - 18 + 3, y - 12 + 4); ctx.lineTo(x + 18 + 3, y - 12 + 4); ctx.quadraticCurveTo(x + 22 + 3, y + 14 + 4, x + 2 + 3, y + 16 + 4); ctx.quadraticCurveTo(x - 18 + 3, y + 16 + 4, x - 18 + 3, y + 2 + 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = f(A.piano); ctx.beginPath(); ctx.moveTo(x - 18, y - 12); ctx.lineTo(x + 18, y - 12); ctx.quadraticCurveTo(x + 22, y + 14, x + 2, y + 16); ctx.quadraticCurveTo(x - 18, y + 16, x - 18, y + 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x - 14, y - 6); ctx.lineTo(x + 12, y + 10); ctx.stroke();
    ctx.fillStyle = f(A.pianoKey); ctx.fillRect(x - 18, y - 16, 36, 5);
    ctx.fillStyle = A.piano; for (let k = 0; k < 9; k++) if (k % 3 !== 2) ctx.fillRect(x - 16 + k * 4, y - 16, 2, 3);
  }
  scuffs(ctx, look, "music", x - 10, y - 8, 20, 16, 2);
}

/** A music note floating up from the music while it plays (live; still under reduced motion). */
export function paintNote(ctx: CanvasRenderingContext2D, L: DecorLayout, look: RoomLook, C: FloorPalette, now: number, motion: number) {
  if (look.items.music === "music_none") return;
  const base = look.items.music === "music_speakers" ? { x: 22, y: L.kitchen.h + 26 } : musicSpot(L);
  for (let k = 0; k < (motion ? 2 : 1); k++) {
    const t = motion ? ((now / 1800 + k * 0.5) % 1) : 0.4;
    const x = base.x + 10 + Math.sin(t * Math.PI * 2) * 4 + k * 8, y = base.y - 18 - t * 26;
    ctx.globalAlpha = motion ? Math.min(1, (1 - t) * 1.6) : 1;
    ctx.fillStyle = C.paper; ctx.beginPath(); ctx.ellipse(x, y, 5.5, 4.4, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = C.plum; ctx.beginPath(); ctx.ellipse(x, y, 4, 3, -0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(x + 2.6, y - 13, 1.8, 13);
    ctx.beginPath(); ctx.moveTo(x + 4.4, y - 13); ctx.quadraticCurveTo(x + 10, y - 10, x + 8, y - 5); ctx.quadraticCurveTo(x + 8, y - 9, x + 4.4, y - 9); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
