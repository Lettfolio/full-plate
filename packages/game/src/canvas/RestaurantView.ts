/**
 * Top-down restaurant renderer. Plain canvas 2D, no React.
 *
 * `render(game, opts)` draws a frame from the current GameState. The only memory the view keeps
 * is cosmetic: where each little person is *drawn* right now, so they can walk smoothly between
 * the positions the sim implies (queue → door → seat → door → away) instead of teleporting each
 * tick. Nothing here feeds back into the simulation.
 *
 * Layout (top → bottom): kitchen strip with stoves and the pass (ticket rail), dining room with
 * round tables, front wall with a door, pavement with the queue.
 */
import type { ContentPack, Customer, CustomerId, GameState, SegmentId, Staff, Table, TableId } from "@full-plate/sim-core";
import { weekdayIndex } from "../lib/calendar";

// ───────────────────────── palette (mirrors theme.css) ─────────────────────────
const C = {
  ink: "#2b2622",
  inkSoft: "#5c534a",
  inkFaint: "#6a5f54", // round 5: was #8f857a (3.3:1 on the floor tiles); now ≥ 4.5:1 as text
  paper: "#fffdf8",
  cream: "#fbf4e6",
  floorA: "#f1dfbd",
  floorB: "#ecd7b0",
  wall: "#8b6a4a",
  wallTop: "#a8845f",
  tileA: "#eef1ee",
  tileB: "#e2e8e3",
  steel: "#c9cfd1",
  steelDark: "#9aa3a6",
  pavement: "#d9d3c7",
  pavementLine: "#c8c0b1",
  kerb: "#b9b1a2",
  road: "#8d8a84",
  table: "#c99a63",
  tableEdge: "#a2733f",
  tomato: "#c4412b",
  tomatoDeep: "#b93c29",
  basil: "#3c7a37",
  basilDeep: "#376a33",
  amber: "#e9a23b",
  amberDeep: "#b97a17",
  red: "#d9472f",
  plum: "#8a5a9e",
  sky: "#4f8fb8",
  gold: "#f2b33d",
  straw: "#e8cf8a",
};

// ───────────────────────── geometry ─────────────────────────
interface Pt { x: number; y: number }
interface TableSlot { id: TableId; x: number; y: number; r: number; seats: Pt[] }

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
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function dist(a: Pt, b: Pt) { return Math.hypot(a.x - b.x, a.y - b.y); }

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
      return { x: x + Math.cos(a) * seatR, y: y + Math.sin(a) * seatR };
    });
    slots.set(t.id, { id: t.id, x, y, r, seats });
  });
  return {
    w, h, kitchen, pass, stoves, dining, wallY, door, doorIn, doorOut,
    pavement: { y: wallY, h: paveH }, tables: slots, person,
    tablesKey: tables.map((t) => `${t.id}:${t.seats}`).join(","),
  };
}

// ───────────────────────── segment look ─────────────────────────
type Hat = "beanie" | "none" | "parting" | "beret" | "sunhat";
interface SegLook { body: string; hat: Hat; hatColour: string; extra?: "backpack" | "briefcase" | "camera" | "kids" }

const KNOWN: Record<string, SegLook> = {
  student: { body: C.sky, hat: "beanie", hatColour: C.tomato, extra: "backpack" },
  famil: { body: C.amber, hat: "none", hatColour: C.tomato, extra: "kids" },
  business: { body: "#4a4540", hat: "parting", hatColour: "#3a2a1e", extra: "briefcase" },
  foodie: { body: C.plum, hat: "beret", hatColour: "#2b2622" },
  tourist: { body: C.basil, hat: "sunhat", hatColour: C.straw, extra: "camera" },
};
const FALLBACK = [C.sky, C.amber, C.plum, C.basil, "#c46b8c", "#5a8f8a"];

function segLook(seg: SegmentId): SegLook {
  const k = seg.toLowerCase();
  for (const [key, v] of Object.entries(KNOWN)) if (k.includes(key)) return v;
  let hsh = 0;
  for (const ch of k) hsh = (hsh * 31 + ch.charCodeAt(0)) | 0;
  return { body: FALLBACK[Math.abs(hsh) % FALLBACK.length]!, hat: "none", hatColour: C.ink };
}

const SKIN = ["#f1c9a5", "#d9a77c", "#a8714a", "#7a4b2e", "#f5d6bd", "#c48a5f"];
function skinFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 33 + ch.charCodeAt(0)) | 0;
  return SKIN[Math.abs(h) % SKIN.length]!;
}

/** Green (full) → amber → red (empty). */
export function patienceColour(p: number): string {
  const t = clamp(p / 100, 0, 1);
  if (t > 0.5) return mix(C.amber, C.basil, (t - 0.5) * 2);
  return mix(C.red, C.amber, t * 2);
}
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

// ───────────────────────── sprites ─────────────────────────
interface Sprite {
  key: string;
  customerId: CustomerId;
  segment: SegmentId;
  member: number;
  x: number; y: number;
  path: Pt[];
  target: Pt | null;
  leaving: boolean;
  walkedOut: boolean;
  phase: number;
}
interface StaffSprite { id: string; x: number; y: number; path: Pt[]; target: Pt | null; task?: string; until: number }
interface Floaty { x: number; y: number; text: string; colour: string; born: number; life: number }

/** Things to ring with a pulsing halo (live incidents). `strong` ids pulse harder (hovered incident card). */
export interface Highlight {
  tableIds: TableId[];
  customerIds: CustomerId[];
  staffIds: string[];
  strong?: string[];
}

export interface RenderOptions {
  content: ContentPack;
  highlight?: Highlight;
  /** Sim speed multiplier (0 = paused). Scales walking speed so people keep up at 4x. */
  speed: number;
  selected?: CustomerId | null;
  hoverTable?: TableId | null;
  /** performance.now() */
  now: number;
}

export class RestaurantView {
  private ctx: CanvasRenderingContext2D;
  private layout: Layout | null = null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private sprites = new Map<string, Sprite>();
  private staffSprites = new Map<string, StaffSprite>();
  private floaties: Floaty[] = [];
  private prevStage = new Map<CustomerId, Customer["stage"]>();
  private servedAt = new Map<CustomerId, number>();
  private lastNow = 0;
  private firstFrame = true;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D not available");
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number, dpr = window.devicePixelRatio || 1) {
    this.w = Math.max(320, Math.floor(cssW));
    this.h = Math.max(320, Math.floor(cssH));
    this.dpr = dpr;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.layout = null;
  }

  /** Which seated party (if any) is under a point in CSS pixels. */
  pick(game: GameState, x: number, y: number): { tableId: TableId; customerId?: CustomerId } | null {
    const L = this.ensureLayout(game);
    for (const t of game.tables) {
      const s = L.tables.get(t.id);
      if (!s) continue;
      if (Math.hypot(x - s.x, y - s.y) <= s.r + L.person * 2.4) return { tableId: t.id, customerId: t.occupiedBy };
    }
    return null;
  }

  private ensureLayout(game: GameState): Layout {
    const key = game.tables.map((t) => `${t.id}:${t.seats}`).join(",");
    if (!this.layout || this.layout.tablesKey !== key || this.layout.w !== this.w || this.layout.h !== this.h) {
      this.layout = computeLayout(this.w, this.h, game.tables);
    }
    return this.layout;
  }

  render(game: GameState, opts: RenderOptions) {
    const L = this.ensureLayout(game);
    const dt = this.firstFrame ? 0 : clamp((opts.now - this.lastNow) / 1000, 0, 0.1);
    this.lastNow = opts.now;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    this.updateSprites(game, L, dt, opts);

    this.drawKitchen(game, L, opts);
    this.drawDining(L);
    this.drawPavement(game, L);
    this.drawTables(game, L, opts);
    this.drawStaff(game, L, opts, dt);
    this.drawPeople(game, L, opts);
    this.drawTableNumbers(game, L);
    this.drawQueueBadges(game, L);
    this.drawHighlights(game, L, opts);
    this.drawFloaties(opts.now);
    this.firstFrame = false;
  }

  // ───────── people movement ─────────

  private queueSpots(game: GameState, L: Layout): Map<string, Pt> {
    const spots = new Map<string, Pt>();
    const step = L.person * 2.3;
    const gap = L.person * 1.6;
    const lanes = [L.pavement.y + L.pavement.h * 0.38, L.pavement.y + L.pavement.h * 0.66];
    let x = L.door.x - L.person * 1.5;
    let lane = 0;
    const queue = game.customers.filter((c) => c.stage === "queue").sort((a, b) => a.arrivedTick - b.arrivedTick);
    for (const c of queue) {
      const need = c.partySize * step;
      if (x - need < L.person * 2) {
        if (lane === 1) break; // pavement full: the rest are counted in the "N waiting" badge, not drawn
        lane = 1; x = L.door.x - L.person * 1.5;
      }
      for (let m = 0; m < c.partySize; m++) {
        const px = Math.max(L.person * 1.5, x - m * step);
        spots.set(`${c.id}:${m}`, { x: px, y: (lanes[lane] ?? lanes[1]!) + (m % 2 ? 2 : -2) });
      }
      x -= need + gap;
    }
    return spots;
  }

  private updateSprites(game: GameState, L: Layout, dt: number, opts: RenderOptions) {
    const speed = (80 + L.person * 6) * Math.max(1, opts.speed);
    const moving = opts.speed > 0 ? dt : 0;
    const spots = this.queueSpots(game, L);
    const alive = new Set<string>();
    const spawn: Pt = { x: -L.person * 4, y: L.pavement.y + L.pavement.h * 0.5 };

    for (const c of game.customers) {
      const prev = this.prevStage.get(c.id);
      if (prev !== c.stage) {
        if (c.stage === "eating") this.servedAt.set(c.id, opts.now);
        if (c.stage === "left" && prev && prev !== "left") this.onLeft(c, L, opts.now);
        this.prevStage.set(c.id, c.stage);
      }
      if (c.stage === "left") continue;
      const slot = c.tableId ? L.tables.get(c.tableId) : undefined;
      for (let m = 0; m < c.partySize; m++) {
        const key = `${c.id}:${m}`;
        alive.add(key);
        let target: Pt | undefined;
        if (c.stage === "queue") {
          target = spots.get(key);
          if (!target && !this.sprites.has(key)) { alive.add(key); continue; } // off-screen overflow
        }
        else if (slot) target = slot.seats[m % slot.seats.length];
        if (!target) target = L.doorIn;
        let s = this.sprites.get(key);
        if (!s) {
          const start = this.firstFrame || c.stage !== "queue" ? target : { x: spawn.x - m * L.person * 2.2, y: spawn.y };
          s = { key, customerId: c.id, segment: c.segment, member: m, x: start.x, y: start.y, path: [], target: null, leaving: false, walkedOut: false, phase: (m * 1.7 + c.arrivedTick) % 6.28 };
          this.sprites.set(key, s);
        }
        if (!s.target || s.target.x !== target.x || s.target.y !== target.y) {
          s.target = target;
          const outside = s.y > L.wallY, goingOutside = target.y > L.wallY;
          s.path = outside !== goingOutside
            ? outside ? [L.doorOut, L.doorIn, target] : [L.doorIn, L.doorOut, target]
            : [target];
        }
      }
    }

    for (const s of this.sprites.values()) {
      if (!alive.has(s.key) && !s.leaving) {
        // gone from state (or stage "left"): walk out the door and off to the right
        const c = game.customers.find((x) => x.id === s.customerId);
        s.leaving = true;
        s.walkedOut = !!c?.walkedOut;
        const off = { x: this.w + L.person * 6, y: L.pavement.y + L.pavement.h * (0.5 + (s.member % 2) * 0.12) };
        s.path = s.y < L.wallY ? [L.doorIn, L.doorOut, off] : [off];
        if (!c) this.prevStage.delete(s.customerId);
      }
      // walk
      let budget = speed * moving * (s.leaving ? 1.3 : 1);
      while (budget > 0 && s.path.length) {
        const p = s.path[0]!;
        const d = dist(s, p);
        if (d <= budget) { s.x = p.x; s.y = p.y; budget -= d; s.path.shift(); }
        else { s.x += ((p.x - s.x) / d) * budget; s.y += ((p.y - s.y) / d) * budget; budget = 0; }
      }
      if (this.firstFrame && s.path.length && !s.leaving) { const p = s.path.at(-1)!; s.x = p.x; s.y = p.y; s.path = []; }
      if (s.leaving && !s.path.length) this.sprites.delete(s.key);
    }
    // bound memory for long sessions
    if (this.prevStage.size > 600) {
      const live = new Set(game.customers.map((c) => c.id));
      for (const id of this.prevStage.keys()) if (!live.has(id)) this.prevStage.delete(id);
      for (const id of this.servedAt.keys()) if (!live.has(id)) this.servedAt.delete(id);
    }
  }

  private onLeft(c: Customer, L: Layout, now: number) {
    const slot = c.tableId ? L.tables.get(c.tableId) : undefined;
    const at = slot ? { x: slot.x, y: slot.y - slot.r } : { x: L.door.x, y: L.pavement.y + 20 };
    if (c.walkedOut) this.floaties.push({ ...at, text: "Hmph!", colour: C.tomatoDeep, born: now, life: 1600 });
    else if (c.spend > 0 || c.tip > 0) this.floaties.push({ ...at, text: `+£${((c.spend + c.tip) / 100).toFixed(2)}`, colour: C.basilDeep, born: now, life: 1400 });
    else this.floaties.push({ ...at, text: "Thank you!", colour: C.amberDeep, born: now, life: 1400 });
  }

  // ───────── drawing ─────────

  private drawKitchen(game: GameState, L: Layout, opts: RenderOptions) {
    const ctx = this.ctx;
    const k = L.kitchen;
    // tiles
    const tile = 18;
    for (let y = 0; y < k.h; y += tile) for (let x = 0; x < k.w; x += tile) {
      ctx.fillStyle = ((x / tile + y / tile) & 1) ? C.tileA : C.tileB;
      ctx.fillRect(x, y, tile, tile);
    }
    // back counter + stoves
    ctx.fillStyle = C.steel;
    roundRect(ctx, 8, 6, k.w * 0.68, 40, 6); ctx.fill();
    ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1.5; ctx.stroke();
    const working = new Set(game.tickets.filter((t) => t.ticksRemaining > 0 && t.chefId).map((t) => t.chefId));
    L.stoves.forEach((s, i) => {
      ctx.fillStyle = "#3d3a37";
      roundRect(ctx, s.x - 22, s.y - 14, 44, 28, 5); ctx.fill();
      for (const dx of [-10, 10]) {
        const on = working.size > i;
        ctx.beginPath(); ctx.arc(s.x + dx, s.y, 7, 0, Math.PI * 2);
        ctx.strokeStyle = on ? (Math.sin(opts.now / 120 + i + dx) > 0 ? "#ff7a45" : C.tomato) : "#6b6662";
        ctx.lineWidth = 2.5; ctx.stroke();
      }
    });
    // fridge and sink on the right of the kitchen
    ctx.fillStyle = C.paper; ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1.5;
    roundRect(ctx, k.w * 0.74, 8, 40, 54, 5); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(k.w * 0.74 + 32, 20); ctx.lineTo(k.w * 0.74 + 32, 34); ctx.stroke();
    ctx.fillStyle = C.steel; roundRect(ctx, k.w * 0.74 + 52, 10, 56, 34, 6); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#b9d4e0"; roundRect(ctx, k.w * 0.74 + 58, 15, 44, 24, 5); ctx.fill();
    label(ctx, "KITCHEN", k.w - 12, 20, { align: "right", size: 13, colour: C.inkFaint, weight: 800, spacing: 2 });

    // the pass
    const p = L.pass;
    ctx.fillStyle = C.steel;
    roundRect(ctx, p.x, p.y, p.w, p.h, 6); ctx.fill();
    ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = "rgba(255,180,80,0.25)"; // heat lamp glow
    ctx.fillRect(p.x + 6, p.y + 3, p.w - 12, 4);
    // ticket rail
    ctx.strokeStyle = C.inkSoft; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.x + 4, p.y - 34); ctx.lineTo(p.x + p.w - 4, p.y - 34); ctx.stroke();
    this.drawTickets(game, L, opts);
    // wall between kitchen and dining with a gap behind the pass
    ctx.fillStyle = C.wall;
    ctx.fillRect(0, k.h, p.x, 6);
    ctx.fillRect(p.x + p.w, k.h, k.w - p.x - p.w, 6);
    ctx.fillStyle = C.wallTop;
    ctx.fillRect(p.x, k.h, p.w, 3);
  }

  private drawTickets(game: GameState, L: Layout, opts: RenderOptions) {
    const ctx = this.ctx;
    const p = L.pass;
    const tableNo = new Map(game.tables.map((t, i) => [t.id, i + 1]));
    const byCustomer = new Map<CustomerId, typeof game.tickets>();
    for (const t of game.tickets) {
      const list = byCustomer.get(t.customerId) ?? [];
      list.push(t);
      byCustomer.set(t.customerId, list);
    }
    const groups = [...byCustomer.entries()].sort((a, b) => (a[1][0]?.createdTick ?? 0) - (b[1][0]?.createdTick ?? 0));
    const cw = 40, ch = 34, gap = 6; // round 5: 13 px table numbers need a bigger card
    const max = Math.max(1, Math.floor((p.w - 12) / (cw + gap)));
    groups.slice(0, max).forEach(([cid, tks], i) => {
      const x = p.x + 8 + i * (cw + gap);
      const y = p.y - 40;
      const age = game.tick - (tks[0]?.createdTick ?? game.tick);
      const head = age < 6 ? C.basil : age < 12 ? C.amber : C.red;
      const sway = Math.sin(opts.now / 600 + i) * 1.2;
      ctx.save();
      ctx.translate(x + cw / 2, y);
      ctx.rotate((sway * Math.PI) / 180);
      ctx.fillStyle = C.paper; ctx.strokeStyle = C.inkSoft; ctx.lineWidth = 1;
      ctx.shadowColor = "rgba(0,0,0,0.12)"; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
      ctx.fillRect(-cw / 2, 0, cw, ch);
      ctx.shadowColor = "transparent";
      ctx.strokeRect(-cw / 2, 0, cw, ch);
      ctx.fillStyle = head; ctx.fillRect(-cw / 2, 0, cw, 5);
      const c = game.customers.find((x) => x.id === cid);
      const tn = c?.tableId ? tableNo.get(c.tableId) : undefined;
      label(ctx, tn ? `T${tn}` : "—", 0, 18, { align: "center", size: 13, weight: 800, colour: C.ink });
      // one dot per dish; filled when plated
      const n = tks.length;
      const dotW = Math.min(6, (cw - 6) / n);
      tks.forEach((t, j) => {
        ctx.beginPath();
        ctx.arc(-((n - 1) * dotW) / 2 + j * dotW, 27, Math.max(1.6, dotW / 2 - 0.6), 0, Math.PI * 2);
        if (t.ticksRemaining <= 0) { ctx.fillStyle = C.basil; ctx.fill(); }
        else { ctx.strokeStyle = C.inkFaint; ctx.lineWidth = 1; ctx.stroke(); }
      });
      ctx.restore();
      // pin
      ctx.fillStyle = C.tomato; ctx.beginPath(); ctx.arc(x + cw / 2, y, 2.5, 0, Math.PI * 2); ctx.fill();
      // plated food waiting on the pass
      const ready = tks.filter((t) => t.ticksRemaining <= 0).length;
      for (let j = 0; j < Math.min(ready, 3); j++) {
        const px = x + 8 + j * 9, py = p.y + p.h / 2 + 2;
        ctx.fillStyle = C.paper; ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = C.tomato; ctx.beginPath(); ctx.arc(px, py, 2.2, 0, Math.PI * 2); ctx.fill();
      }
    });
    if (groups.length > max) label(ctx, `+${groups.length - max}`, p.x + p.w - 6, p.y - 18, { align: "right", size: 14, weight: 800, colour: C.tomatoDeep });
    if (!groups.length) label(ctx, "no tickets", p.x + 10, p.y - 18, { size: 13, colour: C.inkFaint, weight: 700 });
  }

  private drawDining(L: Layout) {
    const ctx = this.ctx;
    const top = L.kitchen.h + 6;
    const plank = 22;
    for (let y = top, i = 0; y < L.wallY; y += plank, i++) {
      ctx.fillStyle = i % 2 ? C.floorA : C.floorB;
      ctx.fillRect(0, y, L.w, Math.min(plank, L.wallY - y));
      ctx.fillStyle = "rgba(150,110,60,0.12)";
      const off = (i * 97) % 160;
      for (let x = off; x < L.w; x += 160) ctx.fillRect(x, y, 1.5, plank);
    }
    // rug by the door
    ctx.fillStyle = "rgba(224,83,61,0.18)";
    roundRect(ctx, L.door.x - 6, L.wallY - 46, L.door.w + 12, 40, 8); ctx.fill();
    // plants in the corners
    plant(ctx, 22, L.wallY - 22, 12);
    plant(ctx, L.w - 22, top + 22, 12);
  }

  private drawPavement(game: GameState, L: Layout) {
    const ctx = this.ctx;
    const pv = L.pavement;
    ctx.fillStyle = C.pavement;
    ctx.fillRect(0, pv.y, L.w, pv.h);
    ctx.strokeStyle = C.pavementLine; ctx.lineWidth = 1;
    for (let x = 0; x < L.w; x += 36) { ctx.beginPath(); ctx.moveTo(x, pv.y + 8); ctx.lineTo(x, pv.y + pv.h - 14); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(0, pv.y + pv.h * 0.52); ctx.lineTo(L.w, pv.y + pv.h * 0.52); ctx.stroke();
    ctx.fillStyle = C.kerb; ctx.fillRect(0, L.h - 14, L.w, 4);
    ctx.fillStyle = C.road; ctx.fillRect(0, L.h - 10, L.w, 10);

    // evening: dusk tint outside from 18:00, lamp glow
    const dusk = clamp((game.tick - 72) / 36, 0, 1);
    if (dusk > 0) {
      ctx.fillStyle = `rgba(40,50,90,${0.22 * dusk})`;
      ctx.fillRect(0, pv.y, L.w, pv.h);
    }
    for (const lx of [L.w * 0.18, L.w * 0.52]) {
      if (dusk > 0) {
        const g = ctx.createRadialGradient(lx, pv.y + pv.h * 0.4, 2, lx, pv.y + pv.h * 0.4, 60);
        g.addColorStop(0, `rgba(255,214,140,${0.55 * dusk})`); g.addColorStop(1, "rgba(255,214,140,0)");
        ctx.fillStyle = g; ctx.fillRect(lx - 60, pv.y, 120, pv.h);
      }
      ctx.fillStyle = C.inkSoft; ctx.beginPath(); ctx.arc(lx, pv.y + pv.h - 20, 4, 0, Math.PI * 2); ctx.fill();
    }

    // front wall with windows and the door
    ctx.fillStyle = C.wall;
    ctx.fillRect(0, L.wallY - 5, L.door.x, 10);
    ctx.fillRect(L.door.x + L.door.w, L.wallY - 5, L.w - L.door.x - L.door.w, 10);
    ctx.fillStyle = "#cfe6ef";
    for (let x = 40; x < L.door.x - 60; x += 130) { ctx.fillRect(x, L.wallY - 2, 80, 4); }
    // door + awning
    ctx.fillStyle = "#6e4f33";
    ctx.fillRect(L.door.x - 3, L.wallY - 7, 3, 14);
    ctx.fillRect(L.door.x + L.door.w, L.wallY - 7, 3, 14);
    const aw = L.door.w + 36, ax = L.door.x - 18, ay = L.wallY + 4;
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? C.paper : C.tomato;
      ctx.fillRect(ax + (i * aw) / 6, ay, aw / 6 + 0.5, 12);
    }
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) ctx.arc(ax + (i * aw) / 6 + aw / 12, ay + 12, aw / 12, 0, Math.PI);
    ctx.fillStyle = C.tomato; ctx.fill();
    // name board
    const nm = game.restaurantName.toUpperCase();
    ctx.font = `800 13px Nunito, system-ui, sans-serif`;
    const tw = Math.min(ctx.measureText(nm).width + 18, L.w * 0.4);
    ctx.fillStyle = C.ink;
    roundRect(ctx, L.door.x + L.door.w / 2 - tw / 2, L.wallY + pv.h - 42, tw, 20, 5); ctx.fill();
    label(ctx, nm, L.door.x + L.door.w / 2, L.wallY + pv.h - 27, { align: "center", size: 13, weight: 800, colour: C.cream, spacing: 1, maxW: tw - 10 });
    label(ctx, "OPEN", L.door.x - 26, L.wallY - 14, { align: "right", size: 13, weight: 900, colour: C.basilDeep, spacing: 2 });
  }

  private drawTables(game: GameState, L: Layout, opts: RenderOptions) {
    const ctx = this.ctx;
    const byId = new Map(game.customers.map((c) => [c.id, c]));
    game.tables.forEach((t, i) => {
      const s = L.tables.get(t.id);
      if (!s) return;
      const c = t.occupiedBy ? byId.get(t.occupiedBy) : undefined;
      // chairs
      for (const seat of s.seats) {
        ctx.fillStyle = "#9b6d3e";
        ctx.beginPath(); ctx.arc(seat.x, seat.y, L.person * 0.95, 0, Math.PI * 2); ctx.fill();
      }
      // patience halo for waiting parties
      const waiting = c && (c.stage === "seated" || c.stage === "ordered");
      if (c) {
        const col = c.stage === "eating" ? C.basil : c.stage === "paying" ? C.gold : patienceColour(c.patience);
        ctx.fillStyle = col + "33";
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r + L.person * 2.6, 0, Math.PI * 2); ctx.fill();
        if (waiting) {
          ctx.strokeStyle = col; ctx.lineWidth = 4; ctx.lineCap = "round";
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r + L.person * 2.6 - 2, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * clamp(c.patience, 0, 100)) / 100);
          ctx.stroke(); ctx.lineCap = "butt";
        }
      }
      if (opts.hoverTable === t.id && c) {
        ctx.strokeStyle = C.inkSoft; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r + L.person * 3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      if (c && opts.selected === c.id) {
        ctx.strokeStyle = C.amber; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
        ctx.lineDashOffset = -opts.now / 40;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r + L.person * 3.2, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]); ctx.lineDashOffset = 0;
      }
      // table top
      ctx.fillStyle = "rgba(90,60,25,0.18)";
      ctx.beginPath(); ctx.ellipse(s.x + 2, s.y + 4, s.r, s.r * 0.95, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c ? mix(C.table, c.stage === "eating" ? C.basil : c.stage === "paying" ? C.gold : patienceColour(c.patience), 0.35) : C.table;
      ctx.strokeStyle = C.tableEdge; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // contents
      if (t.dirtyTicks > 0 && !c) {
        for (let k = 0; k < Math.min(3, t.seats); k++) {
          const a = k * 2.1;
          ctx.fillStyle = "#e7e1d6"; ctx.beginPath(); ctx.arc(s.x + Math.cos(a) * s.r * 0.45, s.y + Math.sin(a) * s.r * 0.45, s.r * 0.22, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#b3a58f"; ctx.beginPath(); ctx.arc(s.x + Math.cos(a) * s.r * 0.45 + 1, s.y + Math.sin(a) * s.r * 0.45, 1.5, 0, Math.PI * 2); ctx.fill();
        }
      } else if (c) {
        const n = c.partySize;
        s.seats.slice(0, n).forEach((seat) => {
          const px = lerp(s.x, seat.x, 0.5), py = lerp(s.y, seat.y, 0.5);
          if (c.stage === "seated") { // menus
            ctx.fillStyle = C.paper; ctx.strokeStyle = C.tomatoDeep; ctx.lineWidth = 1;
            ctx.fillRect(px - 3.5, py - 4.5, 7, 9); ctx.strokeRect(px - 3.5, py - 4.5, 7, 9);
          } else if (c.stage === "eating" || c.stage === "ordered") {
            ctx.fillStyle = C.paper; ctx.strokeStyle = "#d7cdbd"; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(px, py, Math.max(3.5, s.r * 0.2), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            if (c.stage === "eating") {
              ctx.fillStyle = [C.tomato, C.basil, C.amber][(n + Math.round(px)) % 3]!;
              ctx.beginPath(); ctx.arc(px, py, Math.max(1.8, s.r * 0.1), 0, Math.PI * 2); ctx.fill();
            }
          }
        });
        if (c.stage === "paying") {
          ctx.fillStyle = C.gold; ctx.strokeStyle = C.amberDeep; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(6, s.r * 0.32), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          label(ctx, "£", s.x, s.y + 4, { align: "center", size: Math.max(13, s.r * 0.4), weight: 900, colour: C.amberDeep });
        }
      }
    });
  }

  /**
   * Round 5 review: table numbers drawn after the guests and staff (they used to sit under the guest sprites, so a
   * full room hid most of them), with a paper ring so they read on top of a hat.
   */
  private drawTableNumbers(game: GameState, L: Layout) {
    const ctx = this.ctx;
    game.tables.forEach((t, i) => {
      const s = L.tables.get(t.id);
      if (!s) return;
      const tx = s.x + s.r * 0.72, ty = s.y - s.r * 0.72;
      ctx.fillStyle = C.paper;
      ctx.beginPath(); ctx.arc(tx, ty, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = t.occupiedBy ? C.ink : "rgba(43,38,34,0.55)";
      ctx.beginPath(); ctx.arc(tx, ty, 10, 0, Math.PI * 2); ctx.fill();
      label(ctx, String(i + 1), tx, ty + 4.5, { align: "center", size: 13, weight: 900, colour: C.paper });
    });
  }

  private drawPeople(game: GameState, L: Layout, opts: RenderOptions) {
    const ctx = this.ctx;
    const sprites = [...this.sprites.values()].sort((a, b) => a.y - b.y);
    const families = new Map(game.customers.map((c) => [c.id, c]));
    for (const s of sprites) {
      const look = segLook(s.segment);
      const c = families.get(s.customerId);
      const kid = look.extra === "kids" && s.member >= 2;
      const r = L.person * (kid ? 0.72 : 1);
      const walking = s.path.length > 0 && opts.speed > 0;
      const bob = walking ? Math.sin(opts.now / 90 + s.phase) * 1.4 : 0;
      const x = s.x, y = s.y + bob;
      ctx.globalAlpha = s.leaving && s.walkedOut ? 0.85 : 1;
      // shadow
      ctx.fillStyle = "rgba(60,40,20,0.18)";
      ctx.beginPath(); ctx.ellipse(x + 1, s.y + r * 0.9, r * 1.05, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      // accessories behind
      if (look.extra === "backpack" && !kid) { ctx.fillStyle = C.tomatoDeep; roundRect(ctx, x - r * 0.7, y + r * 0.1, r * 1.4, r * 0.9, 2); ctx.fill(); }
      // body (shoulders)
      ctx.fillStyle = look.body; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(x, y + r * 0.25, r * 1.05, r * 0.8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // head
      ctx.fillStyle = skinFor(s.key);
      ctx.beginPath(); ctx.arc(x, y - r * 0.2, r * 0.62, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // hat
      drawHat(ctx, look, x, y - r * 0.2, r * 0.62, kid);
      if (look.extra === "briefcase" && walking) { ctx.fillStyle = "#6e4f33"; ctx.fillRect(x + r * 0.9, y + r * 0.2, r * 0.6, r * 0.5); }
      if (look.extra === "camera" && !kid) { ctx.fillStyle = C.ink; ctx.fillRect(x - r * 0.35, y + r * 0.45, r * 0.7, r * 0.35); }
      ctx.globalAlpha = 1;
      // walkout: little storm cloud above the lead member
      if (s.leaving && s.walkedOut && s.member === 0) {
        ctx.fillStyle = "#7d7f86";
        for (const [dx, dy, rr] of [[-4, 0, 4], [0, -2, 5], [4, 0, 4]] as const) { ctx.beginPath(); ctx.arc(x + dx, y - r * 1.8 + dy, rr, 0, Math.PI * 2); ctx.fill(); }
      }
      // queue patience pip on the lead member
      if (c && c.stage === "queue" && s.member === 0 && !walking) {
        ctx.fillStyle = patienceColour(c.patience); ctx.strokeStyle = C.paper; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y - r * 1.55, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
  }

  /** Pulsing tomato rings around an incident's table / waiting party / staff member. */
  private drawHighlights(game: GameState, L: Layout, opts: RenderOptions) {
    const h = opts.highlight;
    if (!h || (!h.tableIds.length && !h.customerIds.length && !h.staffIds.length)) return;
    const ctx = this.ctx;
    const t = (Math.sin(opts.now / 220) + 1) / 2; // 0..1
    const ring = (x: number, y: number, r: number, id: string) => {
      const strong = h.strong?.includes(id);
      ctx.save();
      ctx.strokeStyle = C.tomato;
      ctx.globalAlpha = 0.45 + 0.5 * t;
      ctx.lineWidth = strong ? 5 : 3.5;
      ctx.beginPath(); ctx.arc(x, y, r + t * (strong ? 7 : 4), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.18 * (1 - t);
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(x, y, r + 8 + t * 10, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // a "!" badge so it reads without colour too
      ctx.fillStyle = C.tomatoDeep;
      ctx.beginPath(); ctx.arc(x + r * 0.75, y - r * 0.75, 8, 0, Math.PI * 2); ctx.fill();
      label(ctx, "!", x + r * 0.75, y - r * 0.75 + 5, { align: "center", size: 14, weight: 900, colour: C.paper });
    };
    for (const id of new Set(h.tableIds)) {
      const s = L.tables.get(id);
      if (s) ring(s.x, s.y, s.r + L.person * 2.8, id);
    }
    for (const id of new Set(h.customerIds)) {
      const sp = this.sprites.get(`${id}:0`);
      if (sp) ring(sp.x, sp.y, L.person * 2, id);
    }
    for (const id of new Set(h.staffIds)) {
      const sp = this.staffSprites.get(id);
      if (sp) ring(sp.x, sp.y, 16, id);
    }
  }

  private drawQueueBadges(game: GameState, L: Layout) {
    const queue = game.customers.filter((c) => c.stage === "queue");
    if (!queue.length) return;
    const people = queue.reduce((a, c) => a + c.partySize, 0);
    const text = `${people} waiting`;
    const ctx = this.ctx;
    ctx.font = "800 13px Nunito, system-ui, sans-serif";
    const w = ctx.measureText(text).width + 14;
    const x = 8, y = L.pavement.y + 6;
    ctx.fillStyle = "rgba(43,38,34,0.78)";
    roundRect(ctx, x, y, w, 20, 9); ctx.fill();
    label(ctx, text, x + 7, y + 14.5, { size: 13, weight: 800, colour: C.paper });
  }

  private drawStaff(game: GameState, L: Layout, opts: RenderOptions, dt: number) {
    const ctx = this.ctx;
    const shift = weekdayIndex(game.day);
    const onShift = game.staff.filter((s) => s.rota[shift]);
    const chefs = onShift.filter((s) => s.role === "chef");
    const front = onShift.filter((s) => s.role !== "chef");
    const live = new Set(onShift.map((s) => s.id));
    for (const id of this.staffSprites.keys()) if (!live.has(id)) this.staffSprites.delete(id);

    // chefs stand at stoves and step to the pass when one of their tickets is plated
    chefs.forEach((s, i) => {
      const stove = L.stoves[i % L.stoves.length]!;
      const busy = game.tickets.some((t) => t.chefId === s.id && t.ticksRemaining > 0);
      const plated = game.tickets.some((t) => t.chefId === s.id && t.ticksRemaining <= 0);
      const home = { x: stove.x + (i >= L.stoves.length ? 14 : 0), y: stove.y + 30 };
      const target = plated && !busy ? { x: clamp(stove.x, L.pass.x + 20, L.pass.x + L.pass.w - 20), y: L.pass.y - 6 } : home;
      const sp = this.moveStaff(s.id, target, dt, opts, L, home);
      this.drawStaffMarker(s, sp.x + (busy ? Math.sin(opts.now / 140 + i) * 2 : 0), sp.y, opts);
    });

    // front of house: serve tables that need someone (paying > needs order > food just ready)
    const passPoint = (i: number) => ({ x: L.pass.x + L.pass.w * (0.55 + 0.12 * i), y: L.kitchen.h + 16 });
    const needs: { tableId: TableId; pri: number; viaPass: boolean }[] = [];
    for (const c of game.customers) {
      if (!c.tableId) continue;
      if (c.stage === "paying") needs.push({ tableId: c.tableId, pri: 0, viaPass: false });
      else if (c.stage === "seated") needs.push({ tableId: c.tableId, pri: 1, viaPass: false });
      else if (c.stage === "eating" && opts.now - (this.servedAt.get(c.id) ?? -1e9) < 2500 / Math.max(1, opts.speed)) needs.push({ tableId: c.tableId, pri: 2, viaPass: true });
    }
    needs.sort((a, b) => a.pri - b.pri);
    const taken = new Set<string>();
    front.forEach((s, i) => {
      const sp = this.staffSprites.get(s.id);
      // keep the current job if it is still needed
      let job = sp?.task ? needs.find((n) => n.tableId === sp.task && !taken.has(n.tableId)) : undefined;
      if (!job || (sp && opts.now > sp.until && !sp.path.length)) job = needs.find((n) => !taken.has(n.tableId)) ?? job;
      if (job) taken.add(job.tableId);
      const slot = job ? L.tables.get(job.tableId) : undefined;
      const idle = passPoint(i);
      const stand = slot ? { x: slot.x + (slot.x > L.w / 2 ? -1 : 1) * (slot.r + L.person * 3.2), y: slot.y + slot.r * 0.4 } : idle;
      const m = this.moveStaff(s.id, stand, dt, opts, L, idle, job?.viaPass ? passPoint(i) : undefined);
      m.task = job?.tableId;
      if (job && m.until < opts.now) m.until = opts.now + 1600 / Math.max(1, opts.speed);
      this.drawStaffMarker(s, m.x, m.y, opts);
    });
    // nobody front-of-house: a little sign on the pass
    if (!front.length) label(ctx, "No server: you’re serving!", L.pass.x + L.pass.w + 12, L.kitchen.h + 20, { size: 14, weight: 800, colour: C.tomatoDeep });
    if (!chefs.length) label(ctx, "No chef: you’re cooking!", L.stoves[0]!.x - 20, 64, { size: 14, weight: 900, colour: C.tomatoDeep });
  }

  private moveStaff(id: string, target: Pt, dt: number, opts: RenderOptions, L: Layout, start: Pt, via?: Pt): StaffSprite {
    let s = this.staffSprites.get(id);
    if (!s) { s = { id, x: start.x, y: start.y, path: [], target: null, until: 0 }; this.staffSprites.set(id, s); }
    if (!s.target || s.target.x !== target.x || s.target.y !== target.y) {
      s.target = target;
      s.path = via && dist(s, via) > 4 ? [via, target] : [target];
    }
    let budget = (110 + L.person * 8) * Math.max(1, opts.speed) * (opts.speed > 0 ? dt : 0);
    while (budget > 0 && s.path.length) {
      const p = s.path[0]!;
      const d = dist(s, p);
      if (d <= budget) { s.x = p.x; s.y = p.y; budget -= d; s.path.shift(); }
      else { s.x += ((p.x - s.x) / d) * budget; s.y += ((p.y - s.y) / d) * budget; budget = 0; }
    }
    return s;
  }

  private drawStaffMarker(s: Staff, x: number, y: number, _opts: RenderOptions) {
    const ctx = this.ctx;
    const size = 20;
    const chef = s.role === "chef";
    const colour = chef ? C.paper : s.role === "server" ? C.basil : s.role === "bar" ? C.plum : s.role === "porter" ? C.sky : C.inkSoft;
    ctx.fillStyle = "rgba(60,40,20,0.2)";
    ctx.beginPath(); ctx.ellipse(x + 1, y + size * 0.55, size * 0.55, size * 0.22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = colour; ctx.strokeStyle = chef ? C.tomato : C.ink; ctx.lineWidth = 2.5;
    roundRect(ctx, x - size / 2, y - size / 2, size, size, 6); ctx.fill(); ctx.stroke();
    label(ctx, s.name.slice(0, 1).toUpperCase(), x, y + 5, { align: "center", size: 13, weight: 900, colour: chef ? C.tomatoDeep : C.paper });
    if (chef) { // toque
      ctx.fillStyle = C.paper; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
      ctx.fillRect(x - 6, y - size / 2 - 6, 12, 6); ctx.strokeRect(x - 6, y - size / 2 - 6, 12, 6);
      for (const dx of [-5, 0, 5]) { ctx.beginPath(); ctx.arc(x + dx, y - size / 2 - 9, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
    } else if (s.role === "server") { // bow tie
      ctx.fillStyle = C.ink;
      ctx.beginPath(); ctx.moveTo(x, y + 7); ctx.lineTo(x - 5, y + 4); ctx.lineTo(x - 5, y + 10); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, y + 7); ctx.lineTo(x + 5, y + 4); ctx.lineTo(x + 5, y + 10); ctx.closePath(); ctx.fill();
    }
    const first = s.name.split(" ")[0] ?? s.name;
    ctx.font = "800 13px Nunito, system-ui, sans-serif";
    const w = ctx.measureText(first).width + 8;
    ctx.fillStyle = "rgba(255,253,248,0.9)";
    roundRect(ctx, x - w / 2, y + size / 2 + 3, w, 16, 7); ctx.fill();
    label(ctx, first, x, y + size / 2 + 15.5, { align: "center", size: 13, weight: 800, colour: C.ink });
  }

  private drawFloaties(now: number) {
    const ctx = this.ctx;
    this.floaties = this.floaties.filter((f) => now - f.born < f.life);
    for (const f of this.floaties) {
      const t = (now - f.born) / f.life;
      ctx.globalAlpha = 1 - t * t;
      label(ctx, f.text, f.x, f.y - 6 - t * 28, { align: "center", size: 14, weight: 900, colour: f.colour, stroke: C.paper });
    }
    ctx.globalAlpha = 1;
  }
}

// ───────────────────────── small drawing helpers ─────────────────────────
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Round 5 type scale: no canvas text below 13 CSS px (the canvas draws in CSS pixels; see UI-NOTES "Type scale"). */
export const CANVAS_MIN_PX = 13;

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: { align?: CanvasTextAlign; size?: number; weight?: number; colour?: string; spacing?: number; stroke?: string; maxW?: number } = {}) {
  ctx.font = `${o.weight ?? 700} ${Math.max(CANVAS_MIN_PX, o.size ?? 13)}px Nunito, system-ui, sans-serif`;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${o.spacing ?? 0}px`;
  if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = 3.5; ctx.lineJoin = "round"; ctx.strokeText(text, x, y, o.maxW); }
  ctx.fillStyle = o.colour ?? C.ink;
  ctx.fillText(text, x, y, o.maxW);
  if ("letterSpacing" in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
}

function drawHat(ctx: CanvasRenderingContext2D, look: SegLook, x: number, y: number, r: number, kid: boolean) {
  ctx.lineWidth = 1.2; ctx.strokeStyle = C.ink;
  switch (kid ? "none" : look.hat) {
    case "beanie":
      ctx.fillStyle = look.hatColour;
      ctx.beginPath(); ctx.arc(x, y, r, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.paper; ctx.beginPath(); ctx.arc(x, y - r, r * 0.3, 0, Math.PI * 2); ctx.fill();
      break;
    case "parting":
      ctx.fillStyle = look.hatColour;
      ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 1.05, Math.PI * 1.95); ctx.closePath(); ctx.fill();
      break;
    case "beret":
      ctx.fillStyle = look.hatColour;
      ctx.beginPath(); ctx.ellipse(x - r * 0.15, y - r * 0.45, r * 1.05, r * 0.5, -0.25, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(x - r * 0.1, y - r * 1.05, r * 0.2, r * 0.3);
      break;
    case "sunhat":
      ctx.fillStyle = look.hatColour;
      ctx.beginPath(); ctx.ellipse(x, y - r * 0.1, r * 1.55, r * 1.1, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = C.tomato; ctx.beginPath(); ctx.arc(x, y - r * 0.1, r * 0.75, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = look.hatColour; ctx.beginPath(); ctx.arc(x, y - r * 0.1, r * 0.6, 0, Math.PI * 2); ctx.fill();
      break;
    default:
      if (look.extra === "kids") { // families: a hair bow on the grown-ups, plain heads on kids
        ctx.fillStyle = kid ? "#5a3a24" : C.tomato;
        if (kid) { ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 1.1, Math.PI * 1.9); ctx.closePath(); ctx.fill(); }
        else { ctx.beginPath(); ctx.arc(x - r * 0.6, y - r * 0.8, r * 0.3, 0, Math.PI * 2); ctx.arc(x + r * 0.6 - r * 0.6 * 2 + r * 1.2, y - r * 0.8, r * 0.3, 0, Math.PI * 2); ctx.fill(); }
      }
  }
}

function plant(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = "#b5703d"; ctx.beginPath(); ctx.arc(x, y, r * 0.75, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.basil;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.28, a, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = C.basilDeep; ctx.beginPath(); ctx.arc(x, y, r * 0.3, 0, Math.PI * 2); ctx.fill();
}
