/**
 * Top-down restaurant renderer. Plain canvas 2D, no React.
 *
 * `render(game, opts)` draws a frame from the current GameState. The only memory the view keeps
 * is cosmetic: where each little person is *drawn* right now, so they can walk smoothly between
 * the positions the sim implies (queue → door → seat → door → away) instead of teleporting each
 * tick. Nothing here feeds back into the simulation.
 *
 * Layout (top → bottom): kitchen strip with stoves and the pass (ticket rail), dining room with
 * round tables (and a bar on the right when there's room), front wall with windows and a door, pavement with the queue.
 *
 * Round 8 (art pass): the same visual language as the hands-on kitchen — clean top-down with a 3/4 tilt, light from the
 * top-left, one warm outline weight, the shared character sprite (`@full-plate/handson/sprites`). Static art (floors,
 * walls, counters, tables and chairs, the shopfront) is painted once per resize into cached layers and blitted each
 * frame; only people, tickets, plates, flames, rings and the evening light are drawn per frame. Colours come from
 * `floorPalette.ts` (theme tokens read from the canvas on resize + art colours).
 */
import type { ContentPack, Customer, CustomerId, GameState, Staff, TableId } from "@full-plate/sim-core";
import { facingFrom, guestLook, SpriteCache, type Look } from "@full-plate/handson/sprites";
import { LayerCache, layerKey } from "@full-plate/handson/layers";
import { formatPence } from "../lib/format";
import { weekdayIndex } from "../lib/calendar";
import { readFloorPalette } from "./floorPalette";
import type { RoomLook } from "./decorArt";
import { art, C, D, loadDecorArt, motion, PLAIN, setFrame, setPalette } from "./frame";
import { aislePath, clamp, computeLayout, dist, layoutKey, lerp, type FloorDensity, type Layout, type Pt, type TableSlot } from "./layout";
import { L_PERSON_STAFF, SEATED, staffLook, type Floaty, type Sprite, type StaffSprite } from "./people";
import { pickTable } from "./interaction";
import { brandLook, canvasBrand, type CanvasBrand } from "./brand";
import { alpha, label, menu, moodFace, patienceColour, plate, radial, roundRect, setting, tableTop } from "./paint";
import { paintFloor, paintFurniture, paintLight } from "./scene";
import { breathe, drawBeats, idHash, lookAbout, sizzle, steam, stepUpDelay, type Beat } from "./juice";

/*
 * Round 11 (pipeline): this file was 1,217 lines; it is now the coordinator (the class: frame order, people movement,
 * per-frame drawing). Geometry lives in layout.ts, the shared per-frame state in frame.ts, sprite records and staff
 * looks in people.ts, colour maths and drawing helpers in paint.ts, the static scene and its decor hooks in scene.ts,
 * hit-testing in interaction.ts. Everything this module exported before is still exported from here.
 */
export { loadDecorArt } from "./frame";
export { aislePath, computeLayout, type Layout } from "./layout";
export { CANVAS_MIN_PX, patienceColour } from "./paint";

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
  /** Round 8: prefers-reduced-motion — no bob, sway, pulse or flicker. */
  reducedMotion?: boolean;
  /** Round 10: the Decorate tab's empty-room preview — no kitchen tickets, staff or "you're cooking" signs. */
  preview?: boolean;
  /** Round 10 review: the career player (staff id) wears the look they picked (sim-core `playerAvatar`), as on My shift. */
  playerLook?: { id: string; skin: string; hair: string };
  /** Round 12 (B): the house uniform; omitted = the page's brand (canvas/brand.ts), null = none. */
  brand?: CanvasBrand | null;
  /** Round 12 (E): named guests (regulars, the food blogger); the selected party's name shows as a tag over its table. */
  guestNames?: ReadonlyMap<CustomerId, string>;
  /** Round 13 (B): "phone" lays the room out for an upright phone (layout.ts: two tables a row, bigger people). */
  density?: FloorDensity;
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
  /** Round 12 (A): the paid beats and five-star glows in flight (juice.ts). */
  private beats: Beat[] = [];
  private prevStage = new Map<CustomerId, Customer["stage"]>();
  private servedAt = new Map<CustomerId, number>();
  private lastNow = 0;
  private firstFrame = true;
  private layers = new LayerCache();
  /** Round 8: pre-drawn people (one small blit each). */
  private people = new SpriteCache();
  private paletteVersion = 0;
  private name = "";
  /** The static-layer key, recomputed only when the layout, name or palette changes. */
  private key = "";
  private keyFor: Layout | null = null;
  private keyName = "";
  private keyPalette = -1;
  private keyDecor = "";
  /** Round 13 (B): the last frame's RenderOptions.density (pick() lays out the same room). */
  private density: FloorDensity | undefined;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D not available");
    this.ctx = ctx;
  }

  resize(cssW: number, cssH: number, dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1) {
    this.w = Math.max(320, Math.floor(cssW));
    this.h = Math.max(320, Math.floor(cssH));
    this.dpr = Math.min(2, Math.max(1, dpr)); // round 8: capped at 2
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.layout = null;
    // Round 8: theme tokens, once per resize
    setPalette(readFloorPalette(this.canvas));
    this.paletteVersion++;
  }

  /** Which seated party (if any) is under a point in CSS pixels. */
  pick(game: GameState, x: number, y: number): { tableId: TableId; customerId?: CustomerId } | null {
    return pickTable(game, this.ensureLayout(game), x, y);
  }

  /** Round 8: how many times the static layers were painted (tests: rebuilt on resize, not per frame). */
  get layerBuilds(): number { return this.layers.builds; }

  private ensureLayout(game: GameState): Layout {
    const key = layoutKey(game.tables, this.density);
    if (!this.layout || this.layout.tablesKey !== key || this.layout.w !== this.w || this.layout.h !== this.h) {
      this.layout = computeLayout(this.w, this.h, game.tables, this.density);
    }
    return this.layout;
  }

  render(game: GameState, opts: RenderOptions) {
    this.density = opts.density;
    const L = this.ensureLayout(game);
    const dt = this.firstFrame ? 0 : clamp((opts.now - this.lastNow) / 1000, 0, 0.1);
    this.lastNow = opts.now;
    const m = opts.reducedMotion ? 0 : 1;
    this.name = game.restaurantName;
    if (game.decor && !art) void loadDecorArt();
    setFrame(art && game.decor ? art.roomLook(opts.content, game) : (PLAIN as RoomLook), m);
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.updateSprites(game, L, dt, opts);

    if (this.keyFor !== L || this.keyName !== this.name || this.keyPalette !== this.paletteVersion || this.keyDecor !== D.key) {
      this.keyFor = L; this.keyName = this.name; this.keyPalette = this.paletteVersion; this.keyDecor = D.key;
      // Round 10: the decor (items and how worn they look) is part of the picture, so it is part of the key.
      this.key = layerKey(this.w, this.h, this.dpr, this.paletteVersion, `${L.tablesKey}|${this.name}|${D.key}`);
    }
    const key = this.key;
    // one cached, opaque scene layer: one full blit a frame and no clear (the blit is the costly part in software raster)
    this.layers.draw(ctx, "scene", key, this.w, this.h, this.dpr, (c) => { paintFloor(c, L); paintFurniture(c, L, this.name); });
    this.drawTableGlows(game, L, opts);
    this.beats = drawBeats(ctx, this.beats, opts.now, motion, "glow");
    if (!opts.preview) this.drawKitchen(game, L, opts);
    this.drawTables(game, L, opts);
    if (!opts.preview) this.drawStaff(game, L, opts, dt);
    this.drawPeople(game, L, opts);
    this.drawLighting(game, L);
    if (D.key) art?.paintNote(ctx, L, D, C, opts.now, motion);
    this.drawTableNumbers(game, L);
    this.drawQueueBadges(game, L);
    this.drawHighlights(game, L, opts);
    this.beats = drawBeats(ctx, this.beats, opts.now, motion, "paid");
    this.drawGuestTag(game, L, opts);
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
    // round 8: quicker than before: the aisle routes are ~30% longer than the old beelines, and a
    // party shouldn't still be walking in when its food lands
    const speed = (80 + L.person * 6) * 1.8 * Math.max(1, opts.speed);
    const moving = opts.speed > 0 ? dt : 0;
    const spots = this.queueSpots(game, L);
    const rank = new Map<string, number>();
    { let i = 0; for (const k of spots.keys()) rank.set(k, i++); }
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
          s = { key, customerId: c.id, segment: c.segment, member: m, x: start.x, y: start.y, path: [], target: null, leaving: false, walkedOut: false, phase: (m * 1.7 + c.arrivedTick) % 6.28, facing: "right" };
          this.sprites.set(key, s);
        }
        if (!s.target || s.target.x !== target.x || s.target.y !== target.y) {
          // Round 12 (A): a line stepping up moves front to back, a beat apart, rather than all at once.
          if (s.target && c.stage === "queue" && s.y > L.wallY && !s.path.length) s.wait = opts.now + stepUpDelay(rank.get(key) ?? 0, opts.speed, motion);
          s.target = target;
          const outside = s.y > L.wallY, goingOutside = target.y > L.wallY;
          // Round 8: indoors, guests walk to their seat along an aisle rather than through the tables.
          s.path = outside !== goingOutside
            ? outside ? [L.doorOut, L.doorIn, ...aislePath(L, L.doorIn, target)] : [...aislePath(L, s, L.doorIn), L.doorOut, target]
            : outside ? [target] : aislePath(L, s, target);
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
        s.path = s.y < L.wallY ? [...aislePath(L, s, L.doorIn), L.doorOut, off] : [off];
        if (!c) this.prevStage.delete(s.customerId);
      }
      // walk
      let budget = speed * moving * (s.leaving ? 1.3 : 1);
      if (s.wait !== undefined) { if (opts.now < s.wait && !s.leaving) budget = 0; else s.wait = undefined; }
      while (budget > 0 && s.path.length) {
        const p = s.path[0]!;
        const d = dist(s, p);
        if (d > 0.5) s.facing = facingFrom(p.x - s.x, p.y - s.y, s.facing);
        if (d <= budget) { s.x = p.x; s.y = p.y; budget -= d; s.path.shift(); }
        else { s.x += ((p.x - s.x) / d) * budget; s.y += ((p.y - s.y) / d) * budget; budget = 0; }
      }
      if (this.firstFrame && s.path.length && !s.leaving) { const p = s.path.at(-1)!; s.x = p.x; s.y = p.y; s.path = []; }
      if (!s.path.length && !s.leaving && s.y > L.wallY) s.facing = "right"; // queueing: facing the door
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
    // Round 12 (A): the till's beat (a coin off the table), and a warm glow where a party left five stars.
    if (!c.walkedOut && slot && this.beats.length < 24) {
      this.beats.push({ kind: "paid", x: slot.x, y: slot.y, r: slot.r, born: now });
      if ((c.rating ?? 0) >= 5) this.beats.push({ kind: "glow", x: slot.x, y: slot.y, r: slot.r + L.person * 1.6, born: now });
    }
    if (c.walkedOut) this.floaties.push({ ...at, text: "Hmph!", colour: C.tomatoDeep, born: now, life: 1600 });
    else if (c.spend > 0 || c.tip > 0) this.floaties.push({ ...at, text: formatPence(c.spend + c.tip, { signed: true }), colour: C.basilDeep, born: now + (motion ? 250 : 0), life: 1400 });
    else this.floaties.push({ ...at, text: "Thank you!", colour: C.amberDeep, born: now, life: 1400 });
  }

  // ───────── drawing ─────────

  /** Live kitchen: lit burners and pans, the ticket rail, plates under the heat lamps. */
  private drawKitchen(game: GameState, L: Layout, opts: RenderOptions) {
    const ctx = this.ctx;
    const working = new Set(game.tickets.filter((t) => t.ticksRemaining > 0 && t.chefId).map((t) => t.chefId));
    L.stoves.forEach((s, i) => {
      if (working.size <= i) return;
      for (const dx of [-10, 10]) {
        const flick = motion ? 0.75 + 0.25 * Math.sin(opts.now / 70 + i * 2 + dx) : 0.85;
        ctx.fillStyle = radial(ctx, s.x + dx, s.y, 13, alpha(C.flame, 0.55 * flick), alpha(C.flame, 0));
        ctx.fillRect(s.x + dx - 13, s.y - 13, 26, 26);
        ctx.strokeStyle = C.flame; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(s.x + dx, s.y, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = C.flameCore; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(s.x + dx, s.y, 7, 0, Math.PI * 2); ctx.stroke();
      }
      // a pan on the left burner
      ctx.fillStyle = C.shadow; ctx.beginPath(); ctx.arc(s.x - 8, s.y + 2, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#2f2c2a"; ctx.beginPath(); ctx.arc(s.x - 10, s.y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(s.x - 3, s.y - 1.5, 9, 3);
      ctx.fillStyle = [C.amber, C.tomato, "#7a4a2a", C.basil][i % 4]!; ctx.beginPath(); ctx.arc(s.x - 10, s.y, 5, 0, Math.PI * 2); ctx.fill();
      // Round 12 (A): a sizzle in the pan and steam off it
      sizzle(ctx, s.x - 10, s.y, opts.now, motion, i);
      steam(ctx, s.x - 10, s.y - 6, opts.now, motion, 0.9, i);
    });
    // Round 12 (A): no chef, but you're cooking — steam off the first hob while any ticket is on
    if (!working.size && game.tickets.some((t) => t.ticksRemaining > 0)) steam(ctx, L.stoves[0]!.x - 10, L.stoves[0]!.y - 4, opts.now, motion, 0.7, 9);
    this.drawTickets(game, L, opts);
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
    // the rail itself: a steel bar with end brackets
    ctx.fillStyle = C.steelDeep; ctx.fillRect(p.x + 4, p.y - 42, p.w - 8, 3);
    ctx.fillStyle = C.steelTop; ctx.fillRect(p.x + 4, p.y - 42, p.w - 8, 1);
    groups.slice(0, max).forEach(([cid, tks], i) => {
      const x = p.x + 8 + i * (cw + gap);
      const y = p.y - 40;
      const age = game.tick - (tks[0]?.createdTick ?? game.tick);
      const head = age < 6 ? C.basil : age < 12 ? C.amber : C.red;
      const sway = Math.sin(opts.now / 600 + i) * 1.2 * motion;
      ctx.save();
      ctx.translate(x + cw / 2, y);
      ctx.rotate((sway * Math.PI) / 180);
      ctx.fillStyle = C.shadow; ctx.fillRect(-cw / 2 + 2, 2, cw, ch);
      ctx.fillStyle = C.paper; ctx.strokeStyle = alpha(C.inkSoft, 0.6); ctx.lineWidth = 1;
      ctx.fillRect(-cw / 2, 0, cw, ch);
      ctx.strokeRect(-cw / 2, 0, cw, ch);
      ctx.fillStyle = head; ctx.fillRect(-cw / 2, 0, cw, 5);
      const c = game.customers.find((x) => x.id === cid);
      const tn = c?.tableId ? tableNo.get(c.tableId) : undefined;
      label(ctx, tn ? `T${tn}` : "—", 0, 19, { align: "center", size: 13, weight: 800, colour: C.ink });
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
      // plated food waiting under the heat lamps
      const ready = tks.filter((t) => t.ticksRemaining <= 0).length;
      for (let j = 0; j < Math.min(ready, 3); j++) plate(ctx, x + 9 + j * 11, p.y + p.h * 0.42, 6, [C.tomato, C.amber, "#7a4a2a"][(j + i) % 3]!);
      // Round 12 (A): food on the pass steams under the lamps while the rest of the ticket cooks
      if (ready > 0) steam(ctx, x + 9 + (Math.min(ready, 3) - 1) * 5.5, p.y + p.h * 0.42 - 4, opts.now, motion, ready < tks.length ? 0.8 : 0.5, i + 5);
    });
    if (groups.length > max) label(ctx, `+${groups.length - max}`, p.x + p.w - 6, p.y - 18, { align: "right", size: 14, weight: 800, colour: C.tomatoDeep });
    if (!groups.length) label(ctx, "no tickets", p.x + 10, p.y - 18, { size: 13, colour: C.inkFaint, weight: 700 });
  }

  /** Under the furniture: each occupied table's mood halo, the selected table's floor glow and the hover ring. */
  private drawTableGlows(game: GameState, L: Layout, opts: RenderOptions) {
    const ctx = this.ctx;
    const byId = new Map(game.customers.map((c) => [c.id, c]));
    for (const t of game.tables) {
      const s = L.tables.get(t.id);
      if (!s) continue;
      const c = t.occupiedBy ? byId.get(t.occupiedBy) : undefined;
      if (c) {
        // a band round the table, under the guests: their mood at a glance
        const col = c.stage === "eating" ? C.basil : c.stage === "paying" ? C.gold : patienceColour(c.patience);
        ctx.strokeStyle = alpha(col, opts.selected === c.id ? 0.42 : 0.26); ctx.lineWidth = L.person * 2.4;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r + L.person * 1.3, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  /** Live tables: occupied tops (so far-side guests sit behind them), seated guests, place settings, rings. */
  private drawTables(game: GameState, L: Layout, opts: RenderOptions) {
    const ctx = this.ctx;
    const byId = new Map(game.customers.map((c) => [c.id, c]));
    game.tables.forEach((t) => {
      const s = L.tables.get(t.id);
      if (!s) return;
      const c = t.occupiedBy ? byId.get(t.occupiedBy) : undefined;
      // Round 10: on a fitting night the fitters' tables are under dust sheets.
      if (!c && D.closed.includes(t.id)) { art?.paintDustSheet(ctx, s, L.person); return; }
      const waiting = c && (c.stage === "seated" || c.stage === "ordered");
      if (opts.hoverTable === t.id && c) {
        ctx.strokeStyle = alpha(C.paper, 0.9); ctx.lineWidth = 2.5; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r + L.person * 3, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      if (c && opts.selected === c.id) this.drawSelection(s, L, opts.now);
      // guests seated on the far side sit behind the table top
      const seated = c ? this.seatedSprites(c, s) : [];
      for (const sp of seated) if (sp.y < s.y - 1) this.drawGuest(sp, L, c!);
      if (c) tableTop(ctx, s.x, s.y, s.r, s.id);
      if (waiting) {
        ctx.strokeStyle = "rgba(43,38,34,0.14)"; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r + L.person * 2.6 - 2, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = patienceColour(c.patience); ctx.lineWidth = 4; ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r + L.person * 2.6 - 2, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * clamp(c.patience, 0, 100)) / 100);
        ctx.stroke(); ctx.lineCap = "butt";
      }
      // contents
      if (t.dirtyTicks > 0 && !c) {
        for (let k = 0; k < Math.min(3, t.seats); k++) {
          const a = k * 2.1;
          const px = s.x + Math.cos(a) * s.r * 0.45, py = s.y + Math.sin(a) * s.r * 0.45;
          ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.beginPath(); ctx.arc(px + 1, py + 1.5, s.r * 0.22, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#ece6da"; ctx.beginPath(); ctx.arc(px, py, s.r * 0.22, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#a8875c"; ctx.beginPath(); ctx.arc(px + 1, py, 1.5, 0, Math.PI * 2); ctx.fill();
        }
      } else if (!c) {
        for (const seat of s.seats) setting(ctx, lerp(s.x, seat.x, 0.52), lerp(s.y, seat.y, 0.52), seat.a, Math.max(3, s.r * 0.16));
      } else {
        const n = c.partySize;
        s.seats.slice(0, n).forEach((seat, k) => {
          const px = lerp(s.x, seat.x, 0.52), py = lerp(s.y, seat.y, 0.52);
          if (c.stage === "seated") menu(ctx, px, py, seat.a, s.r);
          else if (c.stage === "eating" || c.stage === "ordered") plate(ctx, px, py, Math.max(3.5, s.r * 0.2), c.stage === "eating" ? [C.tomato, C.basil, C.amber, "#7a4a2a"][(n + k) % 4]! : undefined);
        });
        if (c.stage === "paying") {
          const bob = Math.sin(opts.now / 250) * 1.2 * motion;
          const R = Math.max(6, s.r * 0.32);
          ctx.fillStyle = C.shadow; ctx.beginPath(); ctx.arc(s.x + 1.5, s.y + 2 + bob, R, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = C.gold; ctx.strokeStyle = C.goldEdge; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(s.x, s.y + bob, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          label(ctx, "£", s.x, s.y + 4 + bob, { align: "center", size: Math.max(13, s.r * 0.4), weight: 900, colour: C.amberDeep });
        }
      }
      for (const sp of seated) if (sp.y >= s.y - 1) this.drawGuest(sp, L, c!);
      if (waiting) moodFace(ctx, s.x, s.y + s.r * 0.7, Math.max(6, Math.min(9, s.r * 0.3)), c.patience);
    });
  }

  /** Round 12 (E): the tapped party's name ("Priya Nair") in an ink pill above its table, when it is a named guest. */
  private drawGuestTag(game: GameState, L: Layout, opts: RenderOptions) {
    const name = opts.selected ? opts.guestNames?.get(opts.selected) : undefined;
    const c = name ? game.customers.find((x) => x.id === opts.selected) : undefined;
    const s = c?.tableId ? L.tables.get(c.tableId) : undefined;
    if (!name || !s) return;
    const ctx = this.ctx;
    ctx.font = "800 14px Nunito, system-ui, sans-serif";
    const w = ctx.measureText(name).width + 18;
    const x = Math.max(4, Math.min(this.w - w - 4, s.x - w / 2)), y = Math.max(4, s.y - s.r - L.person * 3.2 - 30);
    ctx.fillStyle = alpha(C.ink, 0.9);
    roundRect(ctx, x, y, w, 24, 12); ctx.fill();
    label(ctx, name, x + w / 2, y + 17, { align: "center", size: 14, weight: 800, colour: C.paper });
  }

  /** Round 8: the selected table — a gold ring with four corner brackets, turning slowly (still under reduced motion). */
  private drawSelection(s: TableSlot, L: Layout, now: number) {
    const ctx = this.ctx;
    const R = s.r + L.person * 3.2;
    const spin = motion ? now / 2400 : 0;
    ctx.strokeStyle = alpha(C.gold, 0.9); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(s.x, s.y, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = C.outline; ctx.lineWidth = 6; ctx.lineCap = "round";
    for (let k = 0; k < 4; k++) { const a = spin + k * Math.PI / 2 + Math.PI / 4; ctx.beginPath(); ctx.arc(s.x, s.y, R + 2, a - 0.32, a + 0.32); ctx.stroke(); }
    ctx.strokeStyle = C.gold; ctx.lineWidth = 3.5;
    for (let k = 0; k < 4; k++) { const a = spin + k * Math.PI / 2 + Math.PI / 4; ctx.beginPath(); ctx.arc(s.x, s.y, R + 2, a - 0.3, a + 0.3); ctx.stroke(); }
    ctx.lineCap = "butt";
  }

  /** The party's sprites that are sitting down (arrived at their seat, not walking). */
  private seatedSprites(c: Customer, s: TableSlot): Sprite[] {
    if (!SEATED.has(c.stage)) return [];
    const out: Sprite[] = [];
    for (let m = 0; m < c.partySize; m++) {
      const sp = this.sprites.get(`${c.id}:${m}`);
      if (sp && !sp.leaving && !sp.path.length) {
        const seat = s.seats[m % s.seats.length]!;
        if (Math.abs(sp.x - seat.x) < 1 && Math.abs(sp.y - seat.y) < 1) { sp.facing = facingFrom(s.x - seat.x, s.y - seat.y, sp.facing); out.push(sp); }
      }
    }
    return out;
  }

  private drawGuest(s: Sprite, L: Layout, c: Customer | undefined, walking = false, now = 0) {
    const look = this.lookOf(s);
    const seated = !walking && !!c && SEATED.has(c.stage) && !s.leaving;
    this.people.draw(this.ctx, s.x, s.y - (seated ? L.person * 0.25 : 0), L.person, look, {
      facing: s.facing, seated, moving: walking && !!motion, phase: walking ? now / 90 + s.phase : 0, outline: C.outline, shadow: C.shadow,
    }, this.dpr);
  }

  private lookOf(s: Sprite): Look {
    const kid = /famil/i.test(s.segment) && s.member >= 2;
    return guestLook(s.segment, s.key, kid, C);
  }

  /**
   * Round 5 review: table numbers drawn after the guests and staff (they used to sit under the guest sprites, so a
   * full room hid most of them), with a paper ring so they read on top of a hat. Round 8: on the rim at the top centre,
   * between the seats.
   */
  private drawTableNumbers(game: GameState, L: Layout) {
    const ctx = this.ctx;
    game.tables.forEach((t, i) => {
      const s = L.tables.get(t.id);
      if (!s) return;
      const tx = s.x, ty = s.y - s.r * 0.62;
      ctx.fillStyle = C.shadow; ctx.beginPath(); ctx.arc(tx + 1, ty + 1.5, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.paper;
      ctx.beginPath(); ctx.arc(tx, ty, 12, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = t.occupiedBy ? C.ink : alpha(C.ink, 0.55);
      ctx.beginPath(); ctx.arc(tx, ty, 10, 0, Math.PI * 2); ctx.fill();
      label(ctx, String(i + 1), tx, ty + 4.5, { align: "center", size: 13, weight: 900, colour: C.paper });
    });
  }

  private drawPeople(game: GameState, L: Layout, opts: RenderOptions) {
    const ctx = this.ctx;
    const families = new Map(game.customers.map((c) => [c.id, c]));
    const sprites = [...this.sprites.values()].sort((a, b) => a.y - b.y);
    for (const s of sprites) {
      const c = families.get(s.customerId);
      const slot = c?.tableId ? L.tables.get(c.tableId) : undefined;
      if (c && slot && SEATED.has(c.stage) && !s.leaving && !s.path.length) {
        const seat = slot.seats[s.member % slot.seats.length]!;
        if (Math.abs(s.x - seat.x) < 1 && Math.abs(s.y - seat.y) < 1) continue; // drawn with their table
      }
      const walking = s.path.length > 0 && opts.speed > 0;
      ctx.globalAlpha = s.leaving && s.walkedOut ? 0.85 : 1;
      this.drawGuest(s, L, c, walking, opts.now);
      ctx.globalAlpha = 1;
      const r = L.person;
      // walkout: little storm cloud above the lead member
      if (s.leaving && s.walkedOut && s.member === 0) {
        ctx.fillStyle = "#7d7f86";
        for (const [dx, dy, rr] of [[-4, 0, 4], [0, -2, 5], [4, 0, 4]] as const) { ctx.beginPath(); ctx.arc(s.x + dx, s.y - r * 2.2 + dy, rr, 0, Math.PI * 2); ctx.fill(); }
      }
      // queue patience pip on the lead member
      if (c && c.stage === "queue" && s.member === 0 && !walking) {
        ctx.fillStyle = patienceColour(c.patience); ctx.strokeStyle = C.paper; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(s.x, s.y - r * 2.1, 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
  }

  /** Round 8: evening comes in from 18:00 — the street darkens, lamps and windows glow (one cached light layer). */
  private drawLighting(game: GameState, L: Layout) {
    const dusk = clamp((game.tick - 72) / 36, 0, 1);
    if (dusk <= 0) return;
    const ctx = this.ctx;
    ctx.fillStyle = alpha(C.night, 0.34 * dusk); ctx.fillRect(0, L.wallY + 5, L.w, L.h - L.wallY - 5);
    ctx.fillStyle = alpha(C.night, 0.16 * dusk); ctx.fillRect(0, 0, L.w, L.wallY + 5);
    // lamp pools drawn directly (a handful of gradients is cheaper than another full-canvas blit)
    ctx.save();
    ctx.globalAlpha = dusk;
    ctx.globalCompositeOperation = "lighter";
    paintLight(ctx, L);
    ctx.restore();
  }

  /** Pulsing tomato rings around an incident's table / waiting party / staff member. */
  private drawHighlights(game: GameState, L: Layout, opts: RenderOptions) {
    const h = opts.highlight;
    if (!h || (!h.tableIds.length && !h.customerIds.length && !h.staffIds.length)) return;
    const ctx = this.ctx;
    const t = motion ? (Math.sin(opts.now / 220) + 1) / 2 : 0.6; // 0..1
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
    const x = 8, y = L.pavement.y + 10;
    ctx.fillStyle = alpha(C.ink, 0.82);
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
      const home = { x: stove.x + (i >= L.stoves.length ? 14 : 0), y: stove.y + 32 };
      const target = plated && !busy ? { x: clamp(stove.x, L.pass.x + 20, L.pass.x + L.pass.w - 20), y: L.pass.y - 8 } : home;
      const sp = this.moveStaff(s.id, target, dt, opts, L, home, undefined, false);
      const h = idHash(s.id);
      // Round 12 (A): a chef with nothing on looks round the kitchen (and everyone breathes)
      if (!sp.moving) sp.facing = sp.y > home.y + 4 ? "down" : busy ? "up" : lookAbout(opts.now, motion, h, "up");
      const stir = busy && motion ? Math.sin(opts.now / 140 + i) * 1.5 : 0;
      this.drawStaffMarker(s, sp.x + stir, sp.y + (sp.moving ? 0 : breathe(opts.now, motion, h)), sp, opts, false, false, true);
    });

    // front of house: serve tables that need someone (paying > needs order > food just ready)
    const passPoint = (i: number) => ({ x: L.pass.x + L.pass.w * (0.55 + 0.12 * i), y: L.kitchen.h + 16 });
    const needs: { tableId: TableId; pri: number; viaPass: boolean; plates?: number }[] = [];
    for (const c of game.customers) {
      if (!c.tableId) continue;
      if (c.stage === "paying") needs.push({ tableId: c.tableId, pri: 0, viaPass: false });
      else if (c.stage === "seated") needs.push({ tableId: c.tableId, pri: 1, viaPass: false });
      else if (c.stage === "eating" && opts.now - (this.servedAt.get(c.id) ?? -1e9) < 2500 / Math.max(1, opts.speed)) needs.push({ tableId: c.tableId, pri: 2, viaPass: true, plates: Math.max(1, Math.min(3, c.order.length || c.partySize)) });
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
      const m = this.moveStaff(s.id, stand, dt, opts, L, idle, job?.viaPass ? passPoint(i) : undefined, true);
      m.task = job?.tableId;
      if (job && m.until < opts.now) m.until = opts.now + 1600 / Math.max(1, opts.speed);
      if (!m.moving && slot) m.facing = facingFrom(slot.x - m.x, slot.y - m.y, m.facing);
      else if (!m.moving) m.facing = lookAbout(opts.now, motion, idHash(s.id), "down"); // R12-A: idle at the pass, looking about
      const carrying = !!job?.viaPass && !!m.via && !m.path.includes(m.via);
      this.drawStaffMarker(s, m.x, m.y + (m.moving ? 0 : breathe(opts.now, motion, idHash(s.id))), m, opts, carrying, job?.pri === 0, false, job?.plates ?? 1);
    });
    // nobody front-of-house: a little sign on the pass
    if (!front.length) label(ctx, "No server: you’re serving!", L.pass.x + L.pass.w + 12, L.kitchen.h + 20, { size: 14, weight: 800, colour: C.tomatoDeep, stroke: C.paper });
    if (!chefs.length) label(ctx, "No chef: you’re cooking!", L.stoves[0]!.x - 20, 64, { size: 14, weight: 900, colour: C.tomatoDeep, stroke: C.paper });
  }

  private moveStaff(id: string, target: Pt, dt: number, opts: RenderOptions, L: Layout, start: Pt, via: Pt | undefined, aisles: boolean): StaffSprite {
    let s = this.staffSprites.get(id);
    if (!s) { s = { id, x: start.x, y: start.y, path: [], target: null, until: 0, facing: "down", moving: false }; this.staffSprites.set(id, s); }
    if (!s.target || s.target.x !== target.x || s.target.y !== target.y) {
      s.target = target;
      // Round 8: front-of-house walks the aisles (via the pass for food), so their routes read
      if (via && dist(s, via) > 4) { s.via = via; s.path = [...(aisles ? aislePath(L, s, via) : [via]), ...(aisles ? aislePath(L, via, target) : [target])]; }
      else { s.via = undefined; s.path = aisles ? aislePath(L, s, target) : [target]; }
    }
    let budget = (110 + L.person * 8) * Math.max(1, opts.speed) * (opts.speed > 0 ? dt : 0);
    s.moving = false;
    while (budget > 0 && s.path.length) {
      const p = s.path[0]!;
      const d = dist(s, p);
      if (d > 0.5) { s.facing = facingFrom(p.x - s.x, p.y - s.y, s.facing); s.moving = true; }
      if (d <= budget) { s.x = p.x; s.y = p.y; budget -= d; s.path.shift(); }
      else { s.x += ((p.x - s.x) / d) * budget; s.y += ((p.y - s.y) / d) * budget; budget = 0; }
    }
    return s;
  }

  private drawStaffMarker(s: Staff, x: number, y: number, sp: StaffSprite, opts: RenderOptions, carrying: boolean, bill = false, tagBeside = false, plates = 1) {
    const ctx = this.ctx;
    const r = clamp(L_PERSON_STAFF * (this.layout?.person ?? 8), 7, 11);
    const look = brandLook(staffLook(s, opts.playerLook?.id === s.id ? opts.playerLook : undefined), s.role, opts.brand === undefined ? canvasBrand() : opts.brand);
    const walking = sp.moving && !!motion;
    const hy = this.people.draw(ctx, x, y, r, look, { facing: sp.facing, moving: walking, phase: walking ? opts.now / 85 : 0, carrying: carrying || bill, outline: C.outline, shadow: C.shadow }, this.dpr);
    if (carrying || bill) {
      const fx = sp.facing === "left" ? -1 : sp.facing === "right" ? 1 : 0;
      const ix = x + fx * r * 1.05, iy = sp.facing === "up" ? hy - r * 0.4 : hy;
      // Round 12 (A): a server carries the party's plates (up to three: one in hand, two up the arm)
      if (carrying) for (let k = Math.min(3, plates) - 1; k >= 0; k--) plate(ctx, ix + (sp.facing === "left" ? -1 : 1) * k * r * 0.5, iy - k * r * 0.35, r * 0.62, [C.tomato, C.basil, C.amber][k]!);
      else { ctx.fillStyle = C.paper; ctx.strokeStyle = C.outline; ctx.lineWidth = 1; ctx.fillRect(ix - 3.5, iy - 4.5, 7, 9); ctx.strokeRect(ix - 3.5, iy - 4.5, 7, 9); ctx.fillStyle = C.gold; ctx.fillRect(ix - 2, iy - 2, 4, 1.5); }
    }
    const first = s.name.split(" ")[0] ?? s.name;
    ctx.font = "800 13px Nunito, system-ui, sans-serif";
    const w = ctx.measureText(first).width + 10;
    // chefs in the narrow kitchen wear their tag beside them, clear of the ticket rail below
    const tx = tagBeside ? x + r * 1.3 + w / 2 : x, ty = tagBeside ? y - 8 : y + r * 1.25 + 2;
    ctx.fillStyle = C.shadow; roundRect(ctx, tx - w / 2 + 1, ty + 1.5, w, 16, 8); ctx.fill();
    ctx.fillStyle = alpha(C.paper, 0.95);
    roundRect(ctx, tx - w / 2, ty, w, 16, 8); ctx.fill();
    label(ctx, first, tx, ty + 12.5, { align: "center", size: 13, weight: 800, colour: C.ink });
  }

  private drawFloaties(now: number) {
    const ctx = this.ctx;
    this.floaties = this.floaties.filter((f) => now - f.born < f.life);
    for (const f of this.floaties) {
      if (now < f.born) continue; // R12-A: the "+£" waits for the coin
      const t = (now - f.born) / f.life;
      ctx.globalAlpha = 1 - t * t;
      label(ctx, f.text, f.x, f.y - 6 - t * 28 * (motion || 0.3), { align: "center", size: 14, weight: 900, colour: f.colour, stroke: C.paper });
    }
    ctx.globalAlpha = 1;
  }
}
