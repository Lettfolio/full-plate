/**
 * Round 8: the hands-on scene's static art, painted once per resize into two cached layers (layers.ts):
 *
 * - **floor**: floors, walls, rugs, light pools — everything under the station glows and table halos;
 * - **furniture**: counters with front faces, appliances at rest, the pass gantry, bar, till, office, tables and chairs,
 *   and the fixed labels (PASS, BAR…).
 *
 * Style (one rule, everywhere): clean top-down with a 3/4 tilt. Every solid object shows its top and a darker south
 * face (`FACE` of a tile deep); light comes from the top-left, so shadows fall down-right; outlines are one warm
 * near-black weight (`C.outline`) on characters and small props, and a darker tone of the material on furniture.
 * Live state (hob flames, oven glow, plates, drinks, guests) is drawn per frame by render.ts on top.
 */
import type { GameState, Table } from "@full-plate/sim-core";
import { alpha, dot, label, linear, mix, noise, radial, roundRect } from "./draw";
import { DOOR, FRONT_WALL_ROW, PASS_ROW, WORLD_W } from "./layout";
import { C } from "./palette";
import type { HandsOnSession, Station } from "./types";

export interface ArtMetrics { T: number; ox: number; oy: number; w: number; h: number }
type PFn = (tx: number, ty: number) => { x: number; y: number };

/** Depth of a counter's front face, in tiles. */
export const FACE = 0.3;

/** Key for the static layers: the station/prop layout and table sizes. */
export function artKey(s: HandsOnSession, state: GameState): string {
  let k = "";
  for (const st of s.stations) k += `${st.id}${st.x},${st.y},${st.w},${st.h};`;
  for (const p of s.props) k += `${p.kind}${p.x},${p.y};`;
  for (const t of state.tables) k += `${t.id}:${t.seats};`;
  return k;
}

/** Seat positions round a table (CSS px) — shared by the static chairs and the live guests. */
export function seatsOf(st: Station, seats: number, m: ArtMetrics, P: PFn): { cx: number; cy: number; r: number; person: number; seats: { x: number; y: number; a: number }[] } {
  const { T } = m;
  const p = P(st.x, st.y);
  const cx = p.x + (st.w * T) / 2, cy = p.y + (st.h * T) / 2;
  const r = (st.w * T) / 2 - 3;
  const person = Math.max(5, T * 0.24);
  const seatR = r + person * 1.15;
  const out = Array.from({ length: seats }, (_, k) => {
    const a = -Math.PI / 2 + (k / seats) * Math.PI * 2 + (seats === 2 ? Math.PI / 2 : Math.PI / seats);
    return { x: cx + Math.cos(a) * seatR, y: cy + Math.sin(a) * seatR, a };
  });
  return { cx, cy, r, person, seats: out };
}

// ───────────────────────── floor layer ─────────────────────────

export function paintFloor(ctx: CanvasRenderingContext2D, s: HandsOnSession, m: ArtMetrics, P: PFn) {
  const { T } = m;
  ctx.fillStyle = C.cream; ctx.fillRect(0, 0, m.w, m.h);
  const X = (tx: number) => m.ox + tx * T, Y = (ty: number) => m.oy + ty * T;

  // kitchen: small non-slip tiles with grout (rows 0..PASS_ROW, x 0..21)
  const kx1 = 21;
  ctx.fillStyle = C.grout; ctx.fillRect(X(0), Y(0), kx1 * T, (PASS_ROW + 1) * T);
  const q = T / 2;
  for (let j = 0; j < (PASS_ROW + 1) * 2; j++) for (let i = 0; i < kx1 * 2; i++) {
    const n = noise(i, j);
    ctx.fillStyle = (i + j) & 1 ? C.tileA : C.tileB;
    if (n > 0.86) ctx.fillStyle = mix(C.tileB, C.grout, 0.25);
    ctx.fillRect(X(0) + i * q + 0.5, Y(0) + j * q + 0.5, q - 1, q - 1);
  }
  // a floor drain by the sink
  const dr = P(17.5, 3.6);
  dot(ctx, dr.x, dr.y, T * 0.2, C.steelDark); dot(ctx, dr.x, dr.y, T * 0.16, C.steel);
  ctx.strokeStyle = C.steelDeep; ctx.lineWidth = 1;
  for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(dr.x - T * 0.1, dr.y + k * T * 0.05); ctx.lineTo(dr.x + T * 0.1, dr.y + k * T * 0.05); ctx.stroke(); }

  // office: carpet (x 21..29, rows 1..5)
  ctx.fillStyle = C.carpet; ctx.fillRect(X(21), Y(0), 9 * T, 6 * T);
  ctx.fillStyle = C.carpetDot;
  for (let j = 0; j < 12; j++) for (let i = 0; i < 18; i++) if ((i + j) % 2 === 0) ctx.fillRect(X(21) + i * q + q * 0.4, Y(0) + j * q + q * 0.4, 2, 2);

  // dining room: staggered oak planks (rows PASS_ROW+1 .. FRONT_WALL_ROW)
  const top = Y(PASS_ROW + 1), bottom = Y(FRONT_WALL_ROW + 1);
  const ph = Math.max(8, T * 0.5);
  ctx.save();
  ctx.beginPath(); ctx.rect(X(0), top, WORLD_W * T, bottom - top); ctx.clip();
  for (let row = 0, y = top; y < bottom; row++, y += ph) {
    const h = Math.min(ph, bottom - y);
    let x = X(0) - noise(row, 7) * T * 2;
    for (let k = 0; x < X(WORLD_W); k++) {
      const len = T * (2.4 + noise(row, k) * 2.2);
      const tone = noise(k, row + 99);
      ctx.fillStyle = mix(C.floorA, C.floorB, tone);
      ctx.fillRect(x, y, len, h);
      ctx.fillStyle = C.floorGrain;
      const g1 = y + h * (0.3 + 0.4 * noise(k + 3, row));
      ctx.fillRect(x + len * 0.1, g1, len * 0.55, 1);
      if (tone > 0.5) ctx.fillRect(x + len * 0.45, y + h * 0.7, len * 0.4, 1);
      ctx.fillStyle = C.floorJoint; ctx.fillRect(x, y, 1, h); // butt joint
      x += len;
    }
    ctx.fillStyle = C.floorJoint; ctx.fillRect(X(0), y + h - 1, WORLD_W * T, 1);
  }
  // behind the bar: narrower, darker boards (staff side)
  const bm = P(25, PASS_ROW + 1);
  const bh = (FRONT_WALL_ROW - PASS_ROW - 1) * T;
  for (let i = 0, x = bm.x; x < X(WORLD_W); i++, x += T * 0.36) {
    ctx.fillStyle = mix(C.barTop, C.floorB, 0.18 + noise(i, 3) * 0.12);
    ctx.fillRect(x, bm.y, T * 0.36, bh);
    ctx.fillStyle = "rgba(40,25,10,0.28)"; ctx.fillRect(x, bm.y, 1, bh);
    ctx.fillStyle = "rgba(40,25,10,0.18)"; ctx.fillRect(x, bm.y + noise(i, 9) * bh, T * 0.36, 1);
  }
  ctx.restore();
  // door mat inside the door
  const d = P(DOOR.x - 0.4, FRONT_WALL_ROW - 1.05);
  ctx.fillStyle = mix(C.tomato, C.floorB, 0.55);
  roundRect(ctx, d.x, d.y, (DOOR.w + 0.8) * T, T * 0.95, 6); ctx.fill();
  ctx.strokeStyle = alpha(C.paper, 0.35); ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
  roundRect(ctx, d.x + 4, d.y + 4, (DOOR.w + 0.8) * T - 8, T * 0.95 - 8, 4); ctx.stroke(); ctx.setLineDash([]);

  // warm light pools under the pendant lamps (one per table) — the dining room's soft lighting
  for (const st of s.stations) {
    if (st.kind !== "table") continue;
    const c = P(st.x + st.w / 2, st.y + st.h / 2);
    const R = T * (st.w > 1 ? 2.1 : 1.5);
    ctx.fillStyle = radial(ctx, c.x, c.y, R, C.lamp, "rgba(255,206,130,0)");
    ctx.fillRect(c.x - R, c.y - R, R * 2, R * 2);
  }
  // heat-lamp spill in front of the pass, cool daylight from the front windows
  const ps = P(5, PASS_ROW + 1);
  ctx.fillStyle = linear(ctx, 0, ps.y, 0, ps.y + T * 1.2, [[0, "rgba(255,170,80,0.16)"], [1, "rgba(255,170,80,0)"]]);
  ctx.fillRect(ps.x, ps.y, 9 * T, T * 1.2);
  const fw = Y(FRONT_WALL_ROW);
  ctx.fillStyle = linear(ctx, 0, fw - T * 1.4, 0, fw, [[0, "rgba(200,230,245,0)"], [1, "rgba(200,230,245,0.22)"]]);
  ctx.fillRect(X(0), fw - T * 1.4, WORLD_W * T, T * 1.4);

  // ambient occlusion along the walls (darker where floor meets wall)
  const ao = (x: number, y: number, w: number, h: number, dir: "down" | "right" | "left" | "up") => {
    const g = dir === "down" ? linear(ctx, 0, y, 0, y + h, [[0, "rgba(40,25,10,0.18)"], [1, "rgba(40,25,10,0)"]])
      : dir === "up" ? linear(ctx, 0, y + h, 0, y, [[0, "rgba(40,25,10,0.14)"], [1, "rgba(40,25,10,0)"]])
      : dir === "right" ? linear(ctx, x, 0, x + w, 0, [[0, "rgba(40,25,10,0.16)"], [1, "rgba(40,25,10,0)"]])
      : linear(ctx, x + w, 0, x, 0, [[0, "rgba(40,25,10,0.12)"], [1, "rgba(40,25,10,0)"]]);
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
  };
  ao(X(0), Y(1), 21 * T, T * 0.5, "down");
  ao(X(0), Y(PASS_ROW + 1), WORLD_W * T, T * 0.45, "down");
  ao(X(0.55), Y(0), T * 0.5, 15 * T, "right");
  ao(X(WORLD_W - 1.05), Y(0), T * 0.5, 15 * T, "left");

  paintWalls(ctx, s, m, P);
}

function paintWalls(ctx: CanvasRenderingContext2D, _s: HandsOnSession, m: ArtMetrics, P: PFn) {
  const { T } = m;
  const X = (tx: number) => m.ox + tx * T, Y = (ty: number) => m.oy + ty * T;
  // back wall of the kitchen (row 0): a cap, then a white tiled splash-back face
  const cap = T * 0.26;
  ctx.fillStyle = C.splash; ctx.fillRect(X(0), Y(0) + cap, 21 * T, T - cap);
  ctx.strokeStyle = C.splashGrout; ctx.lineWidth = 1;
  const sh = (T - cap) / 3, sw = T * 0.5;
  for (let j = 0; j < 3; j++) {
    const yy = Y(0) + cap + j * sh;
    ctx.beginPath(); ctx.moveTo(X(0), yy + sh); ctx.lineTo(X(21), yy + sh); ctx.stroke();
    for (let x = X(0) + (j % 2 ? sw / 2 : 0); x < X(21); x += sw) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x, yy + sh); ctx.stroke(); }
  }
  ctx.fillStyle = linear(ctx, 0, Y(0) + cap, 0, Y(1), [[0, "rgba(0,0,0,0.10)"], [1, "rgba(0,0,0,0)"]]);
  ctx.fillRect(X(0), Y(0) + cap, 21 * T, T - cap);
  // office back wall (plaster) with a notice board
  ctx.fillStyle = "#efe4d2"; ctx.fillRect(X(21), Y(0) + cap, 9 * T, T - cap);
  const nb = P(25.4, 0.36);
  ctx.fillStyle = "#b98b5c"; roundRect(ctx, nb.x, nb.y, 2.2 * T, T * 0.56, 3); ctx.fill();
  const notes = [C.paper, C.cheer, "#dfeef7", C.paper];
  notes.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(nb.x + 4 + i * T * 0.52, nb.y + 4 + (i % 2) * 3, T * 0.38, T * 0.32); dot(ctx, nb.x + 4 + i * T * 0.52 + T * 0.19, nb.y + 6 + (i % 2) * 3, 1.6, C.tomato); });
  // wall caps (the top of every wall): outer walls, kitchen partition, office walls
  const capCol = C.wallTop, faceCol = C.wall;
  const wallH = (x: number, y: number, w: number, depth: number) => {
    ctx.fillStyle = capCol; ctx.fillRect(x, y, w, depth);
    ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(x, y, w, 1.5);
    ctx.fillStyle = C.wallFace; ctx.fillRect(x, y + depth - 1.5, w, 1.5);
  };
  wallH(X(0), Y(0), WORLD_W * T, cap);
  ctx.fillStyle = faceCol; ctx.fillRect(X(0), Y(0), T * 0.55, 15 * T); ctx.fillRect(X(WORLD_W - 0.55), Y(0), T * 0.55, 15 * T);
  ctx.fillStyle = capCol; ctx.fillRect(X(0), Y(0), T * 0.42, 15 * T); ctx.fillRect(X(WORLD_W - 0.42), Y(0), T * 0.42, 15 * T);
  ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.fillRect(X(0), Y(0), 1.5, 15 * T); ctx.fillRect(X(WORLD_W - 0.42), Y(0), 1.5, 15 * T);
  // kitchen partition along the pass row: solid at x 0..5, 14, 19..21 (the pass, swing door and wash-up fill the rest)
  const kw = Y(PASS_ROW);
  const part = (x0: number, x1: number) => {
    const x = X(x0), w = (x1 - x0) * T;
    ctx.fillStyle = capCol; ctx.fillRect(x, kw + T * 0.3, w, T * 0.42);
    ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.fillRect(x, kw + T * 0.3, w, 1.5);
    ctx.fillStyle = faceCol; ctx.fillRect(x, kw + T * 0.72, w, T * 0.28);
  };
  part(0.42, 5); part(14, 15); part(19, 21);
  // swing doors (x 15..17): two leaves, propped open, and a threshold strip
  const sd = P(15, PASS_ROW);
  ctx.fillStyle = C.steelDark; ctx.fillRect(sd.x, sd.y + T * 0.84, 2 * T, T * 0.08);
  ctx.fillStyle = mix(C.wallTop, C.paper, 0.35); ctx.strokeStyle = C.wallFace; ctx.lineWidth = 1;
  roundRect(ctx, sd.x + 1, sd.y + T * 0.32, T * 0.16, T * 0.62, 2); ctx.fill(); ctx.stroke();
  roundRect(ctx, sd.x + 2 * T - T * 0.16 - 1, sd.y + T * 0.32, T * 0.16, T * 0.62, 2); ctx.fill(); ctx.stroke();
  // office walls: west side and the south wall with a door gap
  const o = P(21, 0);
  ctx.fillStyle = faceCol; ctx.fillRect(o.x - T * 0.2, o.y, T * 0.24, 6 * T);
  ctx.fillStyle = capCol; ctx.fillRect(o.x - T * 0.2, o.y, T * 0.18, 6 * T);
  ctx.fillStyle = capCol; ctx.fillRect(o.x, Y(PASS_ROW) + T * 0.3, 8 * T, T * 0.42);
  ctx.fillStyle = faceCol; ctx.fillRect(o.x, Y(PASS_ROW) + T * 0.72, 8 * T, T * 0.28);

  // front wall: cap with big windows; the door gap with an open door; the awning outside
  const fw = Y(FRONT_WALL_ROW) + T * 0.2;
  const seg = (x0: number, x1: number) => {
    ctx.fillStyle = faceCol; ctx.fillRect(X(x0), fw, (x1 - x0) * T, T * 0.62);
    ctx.fillStyle = capCol; ctx.fillRect(X(x0), fw, (x1 - x0) * T, T * 0.42);
    ctx.fillStyle = "rgba(255,255,255,0.16)"; ctx.fillRect(X(x0), fw, (x1 - x0) * T, 1.5);
  };
  seg(0, DOOR.x); seg(DOOR.x + DOOR.w, WORLD_W);
  for (let x = 1.4; x < WORLD_W - 1.5; x += 3.2) {
    const x1 = Math.min(x + 2.6, WORLD_W - 1);
    if (!(x1 < DOOR.x - 0.2 || x > DOOR.x + DOOR.w + 0.2)) continue;
    const gx = X(x), gw = (x1 - x) * T, gy = fw + T * 0.1, gh = T * 0.22;
    ctx.fillStyle = C.glass; ctx.fillRect(gx, gy, gw, gh);
    ctx.fillStyle = C.glassShine; ctx.fillRect(gx + gw * 0.12, gy + 1, gw * 0.18, 2);
    ctx.fillStyle = C.wallFace; ctx.fillRect(gx + gw / 2 - 1, gy, 2, gh); // mullion
    ctx.strokeStyle = C.wallFace; ctx.lineWidth = 1.2; ctx.strokeRect(gx, gy, gw, gh);
  }
  // the door: frame posts and an open glazed leaf
  const dx = X(DOOR.x), dw = DOOR.w * T;
  ctx.fillStyle = C.wallFace; ctx.fillRect(dx - 3, fw - 2, 4, T * 0.66); ctx.fillRect(dx + dw - 1, fw - 2, 4, T * 0.66);
  ctx.fillStyle = C.steelDark; ctx.fillRect(dx, fw + T * 0.42, dw, T * 0.08);
  // awning over the door and windows, outside (scalloped stripes in the awning colours)
  const ay = Y(FRONT_WALL_ROW) + T * 0.78, ah = T * 0.2;
  const ax0 = X(DOOR.x - 1.2), aw = (DOOR.w + 2.4) * T, n = 8;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 ? C.awningB : C.awningA;
    ctx.fillRect(ax0 + (i * aw) / n, ay, aw / n + 0.5, ah);
    ctx.beginPath(); ctx.arc(ax0 + (i + 0.5) * aw / n, ay + ah, aw / n / 2, 0, Math.PI); ctx.fill();
  }
  ctx.strokeStyle = alpha(C.outline, 0.35); ctx.lineWidth = 1; ctx.strokeRect(ax0, ay, aw, ah);
}

// ───────────────────────── furniture layer ─────────────────────────

/** A counter on a footprint (CSS px): top surface, darker front face, floor shadow down-right. */
export function counter(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, T: number, top: string, face: string, edge: string, rad = 4) {
  const d = T * FACE;
  // shadow on the floor (light from the top-left)
  ctx.fillStyle = C.shadow;
  roundRect(ctx, x + 4, y + 4, w, h, rad); ctx.fill();
  // face
  ctx.fillStyle = face;
  roundRect(ctx, x + 1, y + h - d - 2, w - 2, d + 1, rad); ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fillRect(x + 2, y + h - 2.5, w - 4, 1.5); // kick plate shadow
  // top
  ctx.fillStyle = top;
  roundRect(ctx, x + 1, y + 1, w - 2, h - d - 1, rad); ctx.fill();
  ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.fillRect(x + rad, y + 2, w - rad * 2, 1);
}

export function paintFurniture(ctx: CanvasRenderingContext2D, s: HandsOnSession, state: GameState, m: ArtMetrics, P: PFn) {
  const { T } = m;
  // office furniture first (behind everything else)
  paintOffice(ctx, m, P);
  for (const pr of s.props) {
    const p = P(pr.x, pr.y);
    const w = pr.w * T, h = pr.h * T;
    if (pr.kind === "sink") {
      counter(ctx, p.x, p.y, w, h, T, C.steelTop, C.steelFace, C.steelDark);
      const bw = w * 0.56, bh = (h - T * FACE) * 0.72;
      const bx = p.x + w * 0.08, by = p.y + T * 0.08;
      ctx.fillStyle = C.steelDeep; roundRect(ctx, bx - 1, by - 1, bw + 2, bh + 2, 5); ctx.fill();
      ctx.fillStyle = linear(ctx, 0, by, 0, by + bh, [[0, mix(C.water, C.ink, 0.15)], [1, C.water]]);
      roundRect(ctx, bx + 1, by + 1, bw - 2, bh - 2, 4); ctx.fill();
      ctx.strokeStyle = C.glassShine; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(bx + bw * 0.6, by + bh * 0.55, bh * 0.22, 0.2, 2.2); ctx.stroke();
      // drainboard ridges and a gooseneck tap
      ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) { const xx = bx + bw + 5 + i * 4; ctx.beginPath(); ctx.moveTo(xx, by + 2); ctx.lineTo(xx, by + bh - 2); ctx.stroke(); }
      ctx.strokeStyle = C.steelDeep; ctx.lineWidth = 2.5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(bx + bw / 2, p.y + 1); ctx.quadraticCurveTo(bx + bw / 2, by + bh * 0.45, bx + bw / 2 + 4, by + bh * 0.4); ctx.stroke(); ctx.lineCap = "butt";
    } else if (pr.kind === "shelves") {
      // back-bar shelving against the east wall, bottles in two rows
      ctx.fillStyle = C.shadow; ctx.fillRect(p.x + 2, p.y + 4, w, h);
      ctx.fillStyle = C.barFace; roundRect(ctx, p.x + 3, p.y, w - 4, h, 3); ctx.fill();
      ctx.fillStyle = C.barTop; roundRect(ctx, p.x + 5, p.y + 2, w - 8, h - 4, 2); ctx.fill();
      const cols = [C.basil, C.amber, C.tomato, C.sky, C.plum, C.straw, "#8e2b3a", "#2f6b52"];
      for (let i = 0; i < pr.h * 3; i++) {
        const by = p.y + T * 0.2 + i * (T / 3);
        for (let c = 0; c < 2; c++) {
          const col = cols[(i * 2 + c * 3) % cols.length]!;
          const bx = p.x + w * (0.33 + c * 0.34);
          dot(ctx, bx + 1, by + 1, T * 0.11, "rgba(0,0,0,0.25)");
          dot(ctx, bx, by, T * 0.11, col);
          dot(ctx, bx, by, T * 0.04, mix(col, C.ink, 0.5));
          dot(ctx, bx - T * 0.04, by - T * 0.04, T * 0.03, "rgba(255,255,255,0.6)");
        }
      }
    } else if (pr.kind === "plant") plant(ctx, p.x + T / 2, p.y + T / 2, T * 0.46);
  }
  for (const st of s.stations) paintStation(ctx, s, state, st, m, P);
  // fixed labels
  label(ctx, "KITCHEN", m.ox + T * 4.2, m.oy + T * 0.72, { size: 13, weight: 900, colour: alpha(C.ink, 0.5), spacing: 2 });
  const o = P(21, 1);
  label(ctx, "OFFICE", o.x + 4 * T, o.y + 3.95 * T, { align: "center", size: 13, weight: 900, colour: C.inkSoft, spacing: 2 });
  const fw = m.oy + FRONT_WALL_ROW * T + T * 0.2;
  label(ctx, "DOOR", m.ox + (DOOR.x + DOOR.w / 2) * T, fw + T * 0.6, { align: "center", size: 13, weight: 900, colour: C.paper, spacing: 1, stroke: alpha(C.outline, 0.6) });
}

function paintOffice(ctx: CanvasRenderingContext2D, m: ArtMetrics, P: PFn) {
  const { T } = m;
  const o = P(21, 1);
  // desk with a monitor, keyboard and a mug
  const dx = o.x + 2.2 * T, dy = o.y + 0.9 * T;
  counter(ctx, dx, dy, 3.4 * T, 1.3 * T, T, "#9a6d45", "#6e4a2c", "#5e3f25");
  ctx.fillStyle = "#2a2f36"; roundRect(ctx, dx + 1.1 * T, dy + 0.1 * T, 1.3 * T, 0.6 * T, 3); ctx.fill();
  ctx.fillStyle = "#4f86b4"; roundRect(ctx, dx + 1.16 * T, dy + 0.15 * T, 1.18 * T, 0.48 * T, 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(dx + 1.2 * T, dy + 0.2 * T, 0.5 * T, 3);
  ctx.fillStyle = "#d9d4cc"; roundRect(ctx, dx + 1.2 * T, dy + 0.74 * T, 1.1 * T, 0.14 * T, 2); ctx.fill();
  dot(ctx, dx + 2.9 * T, dy + 0.45 * T, T * 0.12, C.paper); dot(ctx, dx + 2.9 * T, dy + 0.45 * T, T * 0.08, "#6b4426");
  // papers
  ctx.fillStyle = C.paper; ctx.save(); ctx.translate(dx + 0.55 * T, dy + 0.42 * T); ctx.rotate(-0.15); ctx.fillRect(-T * 0.25, -T * 0.18, T * 0.5, T * 0.36); ctx.restore();
  // office chair
  const cx = dx + 1.75 * T, cy = dy + 1.75 * T;
  dot(ctx, cx + 2, cy + 3, T * 0.32, C.shadow); dot(ctx, cx, cy, T * 0.32, "#3d4249"); dot(ctx, cx, cy - T * 0.05, T * 0.24, "#555b63");
  // filing cabinet and a plant
  counter(ctx, o.x + 6.5 * T, o.y + 0.1 * T, 1 * T, 1.1 * T, T, "#9aa4ab", "#78828a", "#6a737a", 3);
  ctx.fillStyle = C.steelDeep; ctx.fillRect(o.x + 6.85 * T, o.y + 0.35 * T, 0.3 * T, 3);
  plant(ctx, o.x + 0.6 * T, o.y + 0.5 * T, T * 0.4);
}

function paintStation(ctx: CanvasRenderingContext2D, s: HandsOnSession, state: GameState, st: Station, m: ArtMetrics, P: PFn) {
  const { T } = m;
  const p = P(st.x, st.y);
  const w = st.w * T, h = st.h * T;
  const topH = h - T * FACE - 1;
  switch (st.kind) {
    case "fridge": {
      // a tall double-door fridge: its top stands over the splash-back, the doors face the cook
      const y0 = p.y - T * 0.5, H = h + T * 0.45;
      ctx.fillStyle = C.shadow; roundRect(ctx, p.x + 5, y0 + 5, w - 4, H, 5); ctx.fill();
      ctx.fillStyle = C.steelFace; roundRect(ctx, p.x + 2, y0, w - 4, H, 5); ctx.fill();
      ctx.fillStyle = C.steelTop; roundRect(ctx, p.x + 2, y0, w - 4, T * 0.24, 4); ctx.fill();
      ctx.fillStyle = linear(ctx, p.x, 0, p.x + w, 0, [[0, "#eef1f2"], [0.5, "#dde2e4"], [1, "#c9d0d3"]]);
      roundRect(ctx, p.x + 4, y0 + T * 0.26, w / 2 - 5, H - T * 0.34, 3); ctx.fill();
      roundRect(ctx, p.x + w / 2 + 1, y0 + T * 0.26, w / 2 - 5, H - T * 0.34, 3); ctx.fill();
      ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1;
      roundRect(ctx, p.x + 2, y0, w - 4, H, 5); ctx.stroke();
      ctx.fillStyle = C.steelDeep;
      ctx.fillRect(p.x + w / 2 - 5, y0 + H * 0.38, 2.5, H * 0.32); ctx.fillRect(p.x + w / 2 + 2.5, y0 + H * 0.38, 2.5, H * 0.32);
      ctx.fillStyle = "#1f2a24"; roundRect(ctx, p.x + w * 0.14, y0 + T * 0.36, T * 0.4, T * 0.18, 2); ctx.fill();
      ctx.fillStyle = "#7fe0a0"; ctx.fillRect(p.x + w * 0.14 + 2, y0 + T * 0.4, T * 0.22, 2);
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(p.x + 6, y0 + T * 0.3, 2, H * 0.5);
      break;
    }
    case "prep": {
      counter(ctx, p.x, p.y, w, h, T, C.steelTop, C.steelFace, C.steelDark);
      // end-grain chopping board
      const bx = p.x + T * 0.45, by = p.y + T * 0.07, bw = w - T * 1.15, bh = topH - T * 0.1;
      ctx.fillStyle = "rgba(0,0,0,0.18)"; roundRect(ctx, bx + 2, by + 2, bw, bh, 4); ctx.fill();
      ctx.fillStyle = C.board; roundRect(ctx, bx, by, bw, bh, 4); ctx.fill();
      ctx.strokeStyle = C.boardGrain; ctx.lineWidth = 1;
      for (let i = 1; i < 6; i++) { const yy = by + (bh * i) / 6; ctx.beginPath(); ctx.moveTo(bx + 3, yy); ctx.bezierCurveTo(bx + bw * 0.3, yy - 2, bx + bw * 0.6, yy + 2, bx + bw - 3, yy); ctx.stroke(); }
      ctx.strokeStyle = mix(C.board, C.ink, 0.35); roundRect(ctx, bx, by, bw, bh, 4); ctx.stroke();
      // knife and a tomato and a carrot waiting
      ctx.fillStyle = "#e9edef"; ctx.fillRect(p.x + w - T * 0.62, p.y + topH * 0.3, T * 0.42, 3.5);
      ctx.fillStyle = C.outline; ctx.fillRect(p.x + w - T * 0.24, p.y + topH * 0.3 - 0.5, T * 0.18, 4.5);
      dot(ctx, bx + bw * 0.18, by + bh * 0.4, T * 0.11, C.tomato); dot(ctx, bx + bw * 0.18 - 1, by + bh * 0.4 - T * 0.11, 2, C.basil);
      ctx.save(); ctx.translate(bx + bw * 0.82, by + bh * 0.55); ctx.rotate(-0.4);
      ctx.fillStyle = "#e8873a"; ctx.beginPath(); ctx.moveTo(-T * 0.18, -2.5); ctx.lineTo(T * 0.16, 0); ctx.lineTo(-T * 0.18, 2.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = C.basil; ctx.fillRect(-T * 0.24, -1.5, T * 0.07, 3); ctx.restore();
      break;
    }
    case "stove": {
      counter(ctx, p.x, p.y, w, h, T, C.hobTop, C.steelFace, "#1f1d1c");
      for (let i = 0; i < st.w; i++) {
        const cx = p.x + (i + 0.5) * T, cy = p.y + topH / 2 + 1;
        burner(ctx, cx, cy, T * 0.3);
        dot(ctx, cx, p.y + h - T * FACE * 0.55, T * 0.07, C.outline); // knob on the face
        ctx.fillStyle = C.steelTop; ctx.fillRect(cx - 0.75, p.y + h - T * FACE * 0.55 - T * 0.07, 1.5, T * 0.06);
      }
      break;
    }
    case "oven": {
      counter(ctx, p.x, p.y, w, h, T, C.steelTop, C.steelFace, C.steelDark);
      ovenWindow(ctx, p.x, p.y, w, topH, false);
      ctx.fillStyle = C.steelDeep; ctx.fillRect(p.x + 8, p.y + h - T * FACE * 0.6, w - 16, 2.5); // door handle
      break;
    }
    case "fryer": {
      counter(ctx, p.x, p.y, w, h, T, C.steelTop, C.steelFace, C.steelDark);
      for (let i = 0; i < 2; i++) {
        const fx = p.x + 6 + i * (w / 2 - 3), fw = w / 2 - 9, fy = p.y + 5, fh = topH - 8;
        ctx.fillStyle = C.steelDeep; roundRect(ctx, fx - 1.5, fy - 1.5, fw + 3, fh + 3, 4); ctx.fill();
        ctx.fillStyle = C.oil; roundRect(ctx, fx, fy, fw, fh, 3); ctx.fill();
        ctx.strokeStyle = "rgba(90,60,20,0.45)"; ctx.lineWidth = 1;
        for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(fx + (fw * k) / 4, fy + 1); ctx.lineTo(fx + (fw * k) / 4, fy + fh - 1); ctx.stroke(); }
        ctx.strokeStyle = C.outline; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(fx + fw / 2, fy + fh); ctx.lineTo(fx + fw / 2, p.y + h - T * FACE + 2); ctx.stroke(); // basket handle
      }
      break;
    }
    case "pass": {
      counter(ctx, p.x, p.y + T * 0.08, w, h - T * 0.08, T, C.steelTop, C.steelFace, C.steelDark, 5);
      // heat-lamp gantry along the back edge: housings with a warm spot under each
      const gy = p.y + T * 0.1;
      ctx.fillStyle = "rgba(255,176,90,0.13)"; roundRect(ctx, p.x + 4, gy + 2, w - 8, h - T * FACE - T * 0.16, 4); ctx.fill();
      ctx.fillStyle = C.steelDeep; ctx.fillRect(p.x + 6, gy, w - 12, 3);
      for (let x = p.x + T * 1.2; x < p.x + w - T * 0.8; x += T * 2.2) {
        ctx.fillStyle = C.outline; roundRect(ctx, x - T * 0.5, gy - 2, T, 5, 2); ctx.fill();
        ctx.fillStyle = "#ffb067"; ctx.fillRect(x - T * 0.42, gy + 1, T * 0.84, 1.5);
      }
      label(ctx, "PASS", p.x + 4, p.y - 3, { size: 13, weight: 900, colour: C.inkSoft, spacing: 2 });
      break;
    }
    case "dishReturn": {
      counter(ctx, p.x, p.y + T * 0.08, w, h - T * 0.08, T, C.steelTop, C.steelFace, C.steelDark, 5);
      const rx = p.x + 5, ry = p.y + T * 0.18, rw = w - 10, rh = topH - T * 0.2;
      ctx.fillStyle = "#b4c7cf"; roundRect(ctx, rx, ry, rw, rh, 3); ctx.fill();
      ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1;
      for (let k = 1; k < 6; k++) { ctx.beginPath(); ctx.moveTo(rx + (rw * k) / 6, ry + 1); ctx.lineTo(rx + (rw * k) / 6, ry + rh - 1); ctx.stroke(); }
      for (let k = 0; k < 3; k++) dot(ctx, rx + rw * 0.25 + k * 2, ry + rh / 2 - k * 2, T * 0.15, k === 2 ? C.paper : "#e7e1d6");
      label(ctx, "WASH-UP", p.x + w / 2, p.y - 3, { align: "center", size: 13, weight: 900, colour: C.inkSoft, spacing: 0.5 });
      break;
    }
    case "bar": {
      // a long oak counter: the guests' side has a brass foot rail; taps on the bartender's side
      ctx.fillStyle = C.shadow; roundRect(ctx, p.x + 4, p.y + 4, w, h, 5); ctx.fill();
      ctx.fillStyle = C.barFace; roundRect(ctx, p.x, p.y, w, h, 5); ctx.fill();
      ctx.fillStyle = C.barTop; roundRect(ctx, p.x + 2, p.y + 1, w - 4, h - T * FACE, 4); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fillRect(p.x + 4, p.y + 3, 2, h - T * FACE - 6);
      ctx.strokeStyle = "rgba(40,25,10,0.25)"; ctx.lineWidth = 1;
      for (let k = 1; k < st.h; k++) { ctx.beginPath(); ctx.moveTo(p.x + 3, p.y + k * T); ctx.lineTo(p.x + w - 3, p.y + k * T); ctx.stroke(); }
      ctx.fillStyle = "#c9a14a"; ctx.fillRect(p.x - 3, p.y + 4, 2, h - 8); // brass foot rail
      for (let i = 0; i < 3; i++) {
        const ty = p.y + T * (0.45 + i * 0.36);
        ctx.fillStyle = C.steelDark; roundRect(ctx, p.x + w - 9, ty - 2.5, 7, 5, 2); ctx.fill();
        ctx.fillStyle = [C.amber, C.tomato, C.basil][i]!; ctx.fillRect(p.x + w - 4, ty - 4, 3, 8);
      }
      label(ctx, "BAR", p.x + w / 2, p.y - 4, { align: "center", size: 13, weight: 900, colour: C.inkSoft, spacing: 2 });
      break;
    }
    case "till": {
      counter(ctx, p.x, p.y, w, h, T, C.barTop, C.barFace, "#3a2716");
      ctx.fillStyle = C.outline; roundRect(ctx, p.x + 4, p.y + 3, w - 8, topH * 0.62, 3); ctx.fill();
      ctx.fillStyle = "#2c4a3a"; ctx.fillRect(p.x + 6, p.y + 5, w - 12, topH * 0.3);
      ctx.fillStyle = "#cfc7b8"; ctx.fillRect(p.x + 6, p.y + 5 + topH * 0.36, w - 12, topH * 0.18);
      label(ctx, "TILL", p.x + w / 2, p.y + h + 14, { align: "center", size: 13, weight: 900, colour: C.inkSoft, spacing: 2 });
      break;
    }
    case "table": paintTable(ctx, s, state, st, m, P); break;
  }
}

function paintTable(ctx: CanvasRenderingContext2D, _s: HandsOnSession, state: GameState, st: Station, m: ArtMetrics, P: PFn) {
  const table: Table | undefined = state.tables.find((t) => t.id === st.tableId);
  if (!table) return;
  const g = seatsOf(st, table.seats, m, P);
  for (const seat of g.seats) chair(ctx, seat.x, seat.y, seat.a, g.person);
  tableTop(ctx, g.cx, g.cy, g.r);
}

/** A round wooden table top with a rim, a soft drop shadow and a highlight from the top-left. */
export function tableTop(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.fillStyle = C.shadow; ctx.beginPath(); ctx.ellipse(cx + 3, cy + 4, r, r * 0.96, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.tableEdge; ctx.beginPath(); ctx.arc(cx, cy + 1.5, r, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.table; ctx.beginPath(); ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.tableTop; ctx.beginPath(); ctx.arc(cx - r * 0.06, cy - r * 0.06, r * 0.86, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(120,80,40,0.16)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.55, 0.3, 2.6); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.32, 3.4, 5.4); ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.78, Math.PI * 1.05, Math.PI * 1.45); ctx.stroke();
}

/** A chair at (x, y) whose seat faces angle `a` + π (toward the table); the backrest is on the outside. */
export function chair(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, s: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(a);
  ctx.fillStyle = C.shadow; roundRect(ctx, -s * 0.85 + 2, -s * 0.85 + 3, s * 1.7, s * 1.7, s * 0.4); ctx.fill();
  ctx.fillStyle = C.chair; roundRect(ctx, -s * 0.85, -s * 0.85, s * 1.7, s * 1.7, s * 0.4); ctx.fill();
  ctx.fillStyle = C.chairTop; roundRect(ctx, -s * 0.7, -s * 0.7, s * 1.3, s * 1.4, s * 0.32); ctx.fill();
  ctx.fillStyle = mix(C.chair, C.outline, 0.35); roundRect(ctx, s * 0.55, -s * 0.85, s * 0.32, s * 1.7, s * 0.14); ctx.fill(); // backrest (outer side)
  ctx.restore();
}

export function burner(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  dot(ctx, cx, cy, r, "#24211f");
  ctx.strokeStyle = "#6b6662"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.72, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke();
  dot(ctx, cx, cy, r * 0.22, "#4a4643");
}

export function ovenWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, topH: number, on: boolean) {
  const wx = x + 7, wy = y + 5, ww = w - 14, wh = topH - 9;
  ctx.fillStyle = C.steelDeep; roundRect(ctx, wx - 1.5, wy - 1.5, ww + 3, wh + 3, 4); ctx.fill();
  ctx.fillStyle = on ? linear(ctx, 0, wy, 0, wy + wh, [[0, "#ffcf6e"], [1, "#e0662c"]]) : "#2a2624";
  roundRect(ctx, wx, wy, ww, wh, 3); ctx.fill();
  ctx.fillStyle = on ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.16)";
  ctx.beginPath(); ctx.moveTo(wx + 3, wy + wh - 2); ctx.lineTo(wx + ww * 0.35, wy + 2); ctx.lineTo(wx + ww * 0.45, wy + 2); ctx.lineTo(wx + ww * 0.1 + 3, wy + wh - 2); ctx.closePath(); ctx.fill();
}

export function plant(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  dot(ctx, x + 3, y + 4, r * 0.8, C.shadow);
  dot(ctx, x, y, r * 0.72, mix(C.pot, C.outline, 0.25));
  dot(ctx, x, y, r * 0.6, C.pot);
  dot(ctx, x, y, r * 0.48, "#5a3a22");
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.3;
    ctx.fillStyle = i % 2 ? C.leaf : C.leafDeep;
    ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5 - r * 0.1, r * 0.52, r * 0.24, a, 0, Math.PI * 2); ctx.fill();
  }
  dot(ctx, x - r * 0.1, y - r * 0.2, r * 0.22, mix(C.leaf, "#ffffff", 0.2));
}
