/**
 * The static scene layers — floors, walls, shopfront, furniture, the evening light — painted once per resize into the
 * cached layer, with the round-10 decor hooks (`art.*`). Split out of RestaurantView.ts in round 11, no behaviour change.
 */
import { C, D, art } from "./frame";
import type { Layout } from "./layout";
import { alpha, chair, counter, label, linear, mix, noise, plant, radial, roundRect, tableTop } from "./paint";

// ───────────────────────── static layers ─────────────────────────

/** Floors, walls, pavement and road, light pools: under the glows. */
export function paintFloor(ctx: CanvasRenderingContext2D, L: Layout) {
  const k = L.kitchen;
  ctx.fillStyle = C.cream; ctx.fillRect(0, 0, L.w, L.h);
  // kitchen: small non-slip tiles with grout
  ctx.fillStyle = C.grout; ctx.fillRect(0, 0, k.w, k.h + 6);
  const q = 16;
  for (let j = 0, y = 0; y < k.h + 6; j++, y += q) for (let i = 0, x = 0; x < k.w; i++, x += q) {
    ctx.fillStyle = (i + j) & 1 ? C.tileA : C.tileB;
    if (noise(i, j) > 0.88) ctx.fillStyle = mix(C.tileB, C.grout, 0.25);
    ctx.fillRect(x + 0.5, y + 0.5, q - 1, q - 1);
  }
  // back wall: cap and a tiled splash-back
  ctx.fillStyle = C.splash; ctx.fillRect(0, 4, k.w, 12);
  ctx.strokeStyle = C.splashGrout; ctx.lineWidth = 1;
  for (let j = 0; j < 2; j++) {
    const yy = 4 + j * 6;
    ctx.beginPath(); ctx.moveTo(0, yy + 6); ctx.lineTo(k.w, yy + 6); ctx.stroke();
    for (let x = j % 2 ? 7 : 0; x < k.w; x += 14) { ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x, yy + 6); ctx.stroke(); }
  }
  ctx.fillStyle = C.wallTop; ctx.fillRect(0, 0, k.w, 4);
  ctx.fillStyle = linear(ctx, 0, 16, 0, 26, [[0, "rgba(40,25,10,0.16)"], [1, "rgba(40,25,10,0)"]]); ctx.fillRect(0, 16, k.w, 10);

  // dining: staggered oak planks
  const top = k.h + 6, bottom = L.wallY;
  const ph = 18;
  const decorFloor = !!D.key && !!art?.paintDecorFloor(ctx, L, D, top, bottom);
  ctx.save(); ctx.beginPath(); ctx.rect(0, top, L.w, decorFloor ? 0 : bottom - top); ctx.clip();
  for (let row = 0, y = top; !decorFloor && y < bottom; row++, y += ph) {
    let x = -noise(row, 7) * 60;
    for (let i = 0; x < L.w; i++) {
      const len = 70 + noise(row, i) * 70;
      const tone = noise(i, row + 99);
      ctx.fillStyle = mix(C.floorA, C.floorB, tone); ctx.fillRect(x, y, len, ph);
      ctx.fillStyle = C.floorGrain;
      ctx.fillRect(x + len * 0.1, y + ph * (0.3 + 0.4 * noise(i + 3, row)), len * 0.55, 1);
      if (tone > 0.5) ctx.fillRect(x + len * 0.45, y + ph * 0.72, len * 0.4, 1);
      ctx.fillStyle = C.floorJoint; ctx.fillRect(x, y, 1, ph);
      x += len;
    }
    ctx.fillStyle = C.floorJoint; ctx.fillRect(0, y + ph - 1, L.w, 1);
  }
  ctx.restore();
  if (D.key) art?.paintRugs(ctx, L, D);
  // warm pools under the pendant lamps, a rug at the door, the heat-lamp spill in front of the pass
  const pool = (D.key && art?.lightPool(D, C.lamp)) || { colour: C.lamp, scale: 2.4, evening: "255,190,110" };
  for (const s of L.tables.values()) {
    const R = s.r * pool.scale;
    ctx.fillStyle = radial(ctx, s.x, s.y, R, pool.colour, "rgba(255,206,130,0)");
    ctx.fillRect(s.x - R, s.y - R, R * 2, R * 2);
  }
  ctx.fillStyle = mix(C.tomato, C.floorB, 0.55);
  roundRect(ctx, L.door.x - 8, L.wallY - 44, L.door.w + 16, 38, 6); ctx.fill();
  ctx.strokeStyle = alpha(C.paper, 0.35); ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
  roundRect(ctx, L.door.x - 4, L.wallY - 40, L.door.w + 8, 30, 4); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = linear(ctx, 0, top, 0, top + 26, [[0, "rgba(40,25,10,0.18)"], [1, "rgba(40,25,10,0)"]]); ctx.fillRect(0, top, L.w, 26);
  ctx.fillStyle = linear(ctx, 0, L.wallY - 40, 0, L.wallY, [[0, "rgba(200,230,245,0)"], [1, "rgba(200,230,245,0.22)"]]); ctx.fillRect(0, L.wallY - 40, L.w, 40);

  // pavement: paving slabs, kerb, road
  const pv = L.pavement;
  ctx.fillStyle = C.pavingJoint; ctx.fillRect(0, pv.y, L.w, pv.h);
  const sh = 22, sw = 40;
  for (let j = 0, y = pv.y + 4; y < L.h - 14; j++, y += sh) for (let x = j % 2 ? -sw / 2 : 0, i = 0; x < L.w; x += sw, i++) {
    ctx.fillStyle = noise(i, j + 40) > 0.6 ? C.pavingAlt : C.paving;
    ctx.fillRect(x + 1, y + 1, sw - 2, Math.min(sh - 2, L.h - 14 - y - 1));
  }
  ctx.fillStyle = C.kerb; ctx.fillRect(0, L.h - 14, L.w, 4);
  ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.fillRect(0, L.h - 14, L.w, 1);
  ctx.fillStyle = C.road; ctx.fillRect(0, L.h - 10, L.w, 10);
  ctx.fillStyle = C.roadLine; for (let x = 10; x < L.w; x += 46) ctx.fillRect(x, L.h - 5, 22, 2);
  // shade from the shopfront onto the pavement
  ctx.fillStyle = linear(ctx, 0, pv.y + 5, 0, pv.y + 20, [[0, "rgba(40,25,10,0.18)"], [1, "rgba(40,25,10,0)"]]); ctx.fillRect(0, pv.y + 5, L.w, 15);
  // street lamps
  for (const lx of [L.w * 0.18, L.w * 0.52]) {
    ctx.fillStyle = C.shadow; ctx.beginPath(); ctx.ellipse(lx + 9, L.h - 17, 12, 3, 0.15, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3d3a37"; ctx.beginPath(); ctx.arc(lx, L.h - 20, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#2f2c2a"; ctx.fillRect(lx - 1.5, L.h - 34, 3, 14);
    ctx.fillStyle = "#3d3a37"; roundRect(ctx, lx - 6, L.h - 40, 12, 7, 3); ctx.fill();
    ctx.fillStyle = "#ffe3a8"; ctx.fillRect(lx - 4, L.h - 35, 8, 2);
  }

  // walls: kitchen partition (gap behind the pass), front wall with windows and the door gap
  const p = L.pass;
  if (D.key) art?.paintSideWalls(ctx, L, D);
  wallBand(ctx, 0, k.h, p.x, 7);
  wallBand(ctx, p.x + p.w, k.h, k.w - p.x - p.w, 7);
  wallBand(ctx, 0, L.wallY - 5, L.door.x, 11);
  wallBand(ctx, L.door.x + L.door.w, L.wallY - 5, L.w - L.door.x - L.door.w, 11);
  // windows: glazing with mullions, a sill and a shine
  for (let x = 30; x < L.w - 60; x += 130) {
    const x1 = Math.min(x + 96, L.w - 20);
    if (!(x1 < L.door.x - 14 || x > L.door.x + L.door.w + 14)) continue;
    ctx.fillStyle = C.glass; ctx.fillRect(x, L.wallY - 3, x1 - x, 5);
    ctx.fillStyle = C.glassShine; ctx.fillRect(x + 8, L.wallY - 2, 14, 1.5);
    ctx.fillStyle = C.wallFace; for (let m = x; m <= x1; m += (x1 - x) / 3) ctx.fillRect(m - 1, L.wallY - 4, 2, 7);
    ctx.strokeStyle = C.wallFace; ctx.lineWidth = 1; ctx.strokeRect(x, L.wallY - 3, x1 - x, 5);
  }
  // door frame and threshold
  ctx.fillStyle = C.wallFace;
  ctx.fillRect(L.door.x - 4, L.wallY - 8, 4, 16); ctx.fillRect(L.door.x + L.door.w, L.wallY - 8, 4, 16);
  ctx.fillStyle = C.steelDark; ctx.fillRect(L.door.x, L.wallY - 1, L.door.w, 3);
}

/** A wall seen from above-front: a lit cap and a darker face below it. */
export function wallBand(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  if (w <= 0) return;
  const col = D.key ? art?.wallColours(D) : undefined; // round 10: painted or papered walls
  ctx.fillStyle = col?.wall ?? C.wall; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = col?.top ?? C.wallTop; ctx.fillRect(x, y, w, h * 0.55);
  ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = C.shadow; ctx.fillRect(x, y + h, w, 3);
}

/** Counters, stoves at rest, fridge, sink, pass, bar, tables and chairs, plants, the shopfront. */
export function paintFurniture(ctx: CanvasRenderingContext2D, L: Layout, name: string) {
  const k = L.kitchen;
  // back counter with the stoves set into it
  counter(ctx, 8, 12, k.w * 0.68, 40, C.steelTop, C.steelFace, C.steelDark);
  for (const s of L.stoves) {
    ctx.fillStyle = C.hobTop; roundRect(ctx, s.x - 22, s.y - 12, 44, 24, 4); ctx.fill();
    ctx.strokeStyle = "#1f1d1c"; ctx.lineWidth = 1; ctx.stroke();
    for (const dx of [-10, 10]) {
      ctx.fillStyle = "#24211f"; ctx.beginPath(); ctx.arc(s.x + dx, s.y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#6b6662"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(s.x + dx, s.y, 6, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s.x + dx - 8, s.y); ctx.lineTo(s.x + dx + 8, s.y); ctx.moveTo(s.x + dx, s.y - 8); ctx.lineTo(s.x + dx, s.y + 8); ctx.stroke();
    }
    for (const dx of [-10, 10]) { ctx.fillStyle = C.outline; ctx.beginPath(); ctx.arc(s.x + dx, 47, 2.2, 0, Math.PI * 2); ctx.fill(); }
  }
  // tall fridge and the sink
  const fx = k.w * 0.74;
  ctx.fillStyle = C.shadow; roundRect(ctx, fx + 4, 8, 40, 56, 5); ctx.fill();
  ctx.fillStyle = C.steelFace; roundRect(ctx, fx, 4, 40, 56, 5); ctx.fill();
  ctx.fillStyle = C.steelTop; roundRect(ctx, fx, 4, 40, 10, 4); ctx.fill();
  ctx.fillStyle = linear(ctx, fx, 0, fx + 40, 0, [[0, "#eef1f2"], [1, "#c9d0d3"]]);
  roundRect(ctx, fx + 2, 15, 17, 43, 3); ctx.fill(); roundRect(ctx, fx + 21, 15, 17, 43, 3); ctx.fill();
  ctx.fillStyle = C.steelDeep; ctx.fillRect(fx + 16, 28, 2, 14); ctx.fillRect(fx + 22, 28, 2, 14);
  ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1; roundRect(ctx, fx, 4, 40, 56, 5); ctx.stroke();
  counter(ctx, fx + 52, 12, 56, 38, C.steelTop, C.steelFace, C.steelDark);
  ctx.fillStyle = C.steelDeep; roundRect(ctx, fx + 57, 16, 32, 20, 4); ctx.fill();
  ctx.fillStyle = C.water; roundRect(ctx, fx + 58.5, 17.5, 29, 17, 3); ctx.fill();
  ctx.strokeStyle = C.glassShine; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(fx + 76, 27, 4, 0.2, 2.2); ctx.stroke();
  ctx.strokeStyle = C.steelDeep; ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(fx + 73, 13); ctx.quadraticCurveTo(fx + 73, 22, fx + 77, 21); ctx.stroke(); ctx.lineCap = "butt";
  ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(fx + 93 + i * 3.5, 17); ctx.lineTo(fx + 93 + i * 3.5, 35); ctx.stroke(); }
  label(ctx, "KITCHEN", k.w - 12, 64, { align: "right", size: 13, colour: alpha(C.ink, 0.5), weight: 900, spacing: 2 });

  // the pass: a steel shelf under heat lamps
  const p = L.pass;
  counter(ctx, p.x, p.y, p.w, p.h, C.steelTop, C.steelFace, C.steelDark);
  ctx.fillStyle = "rgba(255,176,90,0.16)"; ctx.fillRect(p.x + 4, p.y + 3, p.w - 8, p.h - 10);
  ctx.fillStyle = C.steelDeep; ctx.fillRect(p.x + 6, p.y + 1, p.w - 12, 2);
  for (let x = p.x + 30; x < p.x + p.w - 20; x += 70) { ctx.fillStyle = C.outline; roundRect(ctx, x - 14, p.y - 1, 28, 4, 2); ctx.fill(); ctx.fillStyle = "#ffb067"; ctx.fillRect(x - 11, p.y + 1, 22, 1.5); }

  // the bar (when there's room): oak counter, taps, stools, a back shelf of bottles
  if (L.bar) {
    const b = L.bar;
    ctx.fillStyle = C.shadow; ctx.fillRect(L.w - 18, b.y - 2, 10, b.h + 10);
    ctx.fillStyle = C.barFace; ctx.fillRect(L.w - 20, b.y - 4, 10, b.h + 6);
    const cols = [C.basil, C.amber, C.tomato, C.sky, C.plum, C.straw, "#8e2b3a"];
    for (let y = b.y + 4, i = 0; y < b.y + b.h - 4; y += 9, i++) { ctx.fillStyle = cols[i % cols.length]!; ctx.beginPath(); ctx.arc(L.w - 15, y, 3, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = C.shadow; roundRect(ctx, b.x + 4, b.y + 4, b.w, b.h, 5); ctx.fill();
    ctx.fillStyle = C.barFace; roundRect(ctx, b.x, b.y, b.w, b.h, 5); ctx.fill();
    ctx.fillStyle = C.barTop; roundRect(ctx, b.x + 2, b.y + 1, b.w - 4, b.h - 8, 4); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.14)"; ctx.fillRect(b.x + 4, b.y + 3, 2, b.h - 14);
    ctx.fillStyle = "#c9a14a"; ctx.fillRect(b.x - 3, b.y + 4, 2, b.h - 10);
    for (let i = 0; i < 3; i++) { const ty = b.y + 16 + i * 14; ctx.fillStyle = C.steelDark; roundRect(ctx, b.x + b.w - 10, ty - 2.5, 7, 5, 2); ctx.fill(); ctx.fillStyle = [C.amber, C.tomato, C.basil][i]!; ctx.fillRect(b.x + b.w - 5, ty - 4, 3, 8); }
    for (let y = b.y + 18; y < b.y + b.h - 10; y += 30) {
      ctx.fillStyle = C.shadow; ctx.beginPath(); ctx.arc(b.x - 11, y + 3, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.barFace; ctx.beginPath(); ctx.arc(b.x - 13, y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.chairTop; ctx.beginPath(); ctx.arc(b.x - 13.5, y - 0.5, 5.5, 0, Math.PI * 2); ctx.fill();
    }
    label(ctx, "BAR", b.x + b.w / 2, b.y + b.h + 16, { align: "center", size: 13, weight: 900, colour: C.inkSoft, spacing: 2 });
  }

  // tables and chairs (tops of occupied tables are redrawn live, so far-side guests sit behind them)
  const decor = D.key ? art : null;
  decor?.startSeats();
  for (const s of L.tables.values()) {
    for (const seat of s.seats) if (!decor?.paintDecorChair(ctx, seat.x, seat.y, seat.a, L.person, D, C, C.shadow)) chair(ctx, seat.x, seat.y, seat.a, L.person);
    tableTop(ctx, s.x, s.y, s.r, s.id);
  }
  // round 10: light fittings over the aisles, then plants (two corner pots unless bought) and the music
  decor?.paintLamps(ctx, L, D, C);
  if (!decor?.paintPlants(ctx, L, D, C, (x, y, r) => plant(ctx, x, y, r))) {
    plant(ctx, 22, L.wallY - 24, 12);
    if (!L.bar) plant(ctx, L.w - 22, L.kitchen.h + 30, 12);
  }
  decor?.paintMusic(ctx, L, D, C);

  // the shopfront outside: planters under the windows, the awning over the door, the name board, the OPEN sign
  for (let x = 30; x < L.w - 60; x += 130) {
    const x1 = Math.min(x + 96, L.w - 20);
    if (!(x1 < L.door.x - 14 || x > L.door.x + L.door.w + 14)) continue;
    if (decor?.paintWindowDisplay(ctx, x, x1, L.wallY, D, C)) continue;
    ctx.fillStyle = C.shadow; ctx.fillRect(x + 4, L.wallY + 9, x1 - x - 4, 7);
    ctx.fillStyle = "#7a5636"; ctx.fillRect(x + 2, L.wallY + 6, x1 - x - 4, 7);
    for (let px = x + 8; px < x1 - 4; px += 9) { ctx.fillStyle = noise(px, 3) > 0.5 ? C.leaf : C.leafDeep; ctx.beginPath(); ctx.arc(px, L.wallY + 7, 4, 0, Math.PI * 2); ctx.fill(); }
    for (let px = x + 12; px < x1 - 8; px += 22) { ctx.fillStyle = noise(px, 5) > 0.5 ? C.tomato : C.gold; ctx.beginPath(); ctx.arc(px, L.wallY + 6, 1.8, 0, Math.PI * 2); ctx.fill(); }
  }
  const aw = L.door.w + 36, ax = L.door.x - 18, ay = L.wallY + 4;
  ctx.fillStyle = C.shadow; ctx.fillRect(ax + 3, ay + 4, aw, 16);
  for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? C.awningB : C.awningA; ctx.fillRect(ax + (i * aw) / 6, ay, aw / 6 + 0.5, 12); }
  for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? C.awningB : C.awningA; ctx.beginPath(); ctx.arc(ax + (i * aw) / 6 + aw / 12, ay + 12, aw / 12, 0, Math.PI); ctx.fill(); }
  ctx.strokeStyle = alpha(C.outline, 0.35); ctx.lineWidth = 1; ctx.strokeRect(ax, ay, aw, 12);
  const nm = name.toUpperCase();
  ctx.font = `800 13px Nunito, system-ui, sans-serif`;
  const tw = Math.min(ctx.measureText(nm).width + 18, L.w * 0.4);
  const by = L.wallY + L.pavement.h - 42;
  const sign: { board: string; text: string; edge?: string; glow?: string } = decor?.signColours(D, C) ?? { board: C.ink, text: C.cream }; // round 10
  ctx.fillStyle = C.shadow; roundRect(ctx, L.door.x + L.door.w / 2 - tw / 2 + 2, by + 2, tw, 20, 5); ctx.fill();
  ctx.fillStyle = sign.board; roundRect(ctx, L.door.x + L.door.w / 2 - tw / 2, by, tw, 20, 5); ctx.fill();
  if (sign.edge) { ctx.strokeStyle = sign.edge; ctx.lineWidth = 1.5; roundRect(ctx, L.door.x + L.door.w / 2 - tw / 2 + 2, by + 2, tw - 4, 16, 4); ctx.stroke(); }
  if (sign.glow) { ctx.shadowColor = sign.glow; ctx.shadowBlur = 8; }
  label(ctx, nm, L.door.x + L.door.w / 2, by + 15, { align: "center", size: 13, weight: 800, colour: sign.text, spacing: 1, maxW: tw - 10 });
  ctx.shadowBlur = 0; ctx.shadowColor = "transparent";
  decor?.paintAFrame(ctx, L, D);
  decor?.paintMenuCase(ctx, L, D);
  ctx.font = `900 13px Nunito, system-ui, sans-serif`;
  const ow = ctx.measureText("OPEN").width + 14;
  const ox = L.door.x - 26 - ow, oy = L.wallY - 30;
  ctx.fillStyle = C.shadow; roundRect(ctx, ox + 2, oy + 2, ow, 19, 5); ctx.fill();
  ctx.fillStyle = C.paper; roundRect(ctx, ox, oy, ow, 19, 5); ctx.fill();
  ctx.strokeStyle = C.basilDeep; ctx.lineWidth = 1.5; ctx.stroke();
  label(ctx, "OPEN", ox + ow / 2, oy + 14, { align: "center", size: 13, weight: 900, colour: C.basilDeep, spacing: 2 });
}

/** The evening light layer (drawn with "lighter" at dusk strength): table lamps, street lamps, windows on the pavement. */
export function paintLight(ctx: CanvasRenderingContext2D, L: Layout) {
  const pool = (x: number, y: number, r: number, a: number, rgb = "255,190,110") => {
    ctx.fillStyle = radial(ctx, x, y, r, `rgba(${rgb},${a})`, `rgba(${rgb},0)`);
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  const lamps = (D.key && art?.lightPool(D, C.lamp)) || { scale: 2.4, evening: "255,190,110" }; // round 10: the lamps' colour and reach
  for (const s of L.tables.values()) pool(s.x, s.y, s.r * lamps.scale, 0.1, lamps.evening);
  if (D.key && D.items.signage === "sign_neon") pool(L.door.x + L.door.w / 2, L.wallY + L.pavement.h - 32, 70, 0.22, "255,111,174");
  for (const lx of [L.w * 0.18, L.w * 0.52]) pool(lx, L.h - 22, 70, 0.32);
  pool(L.door.x + L.door.w / 2, L.wallY + 18, 60, 0.2);
  for (let x = 30; x < L.w - 60; x += 130) pool(x + 48, L.wallY + 14, 56, 0.12);
  if (L.bar) pool(L.bar.x + L.bar.w / 2, L.bar.y + L.bar.h / 2, L.bar.h * 0.6, 0.16);
}
