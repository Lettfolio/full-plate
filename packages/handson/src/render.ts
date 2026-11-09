/**
 * Pure canvas draw of a hands-on session. Reads (session, state, view); mutates nothing; keeps no memory. All
 * animation is driven by `session.time` so a paused session draws a still frame. The look follows the game's
 * RestaurantView (same palette, tiles, wood floor, round tables, little people, ticket rail) on a walkable grid.
 *
 * Layout at 1024×600: an 80 px header (ticket rail + timer/score), then the 30×15-tile world at 33 px a tile.
 */
import type { Customer, GameState, KitchenTicket, SegmentId } from "@full-plate/sim-core";
import { nextHint } from "./hints";
import { DOOR, FRONT_WALL_ROW, PASS_ROW, WORLD_H, WORLD_W } from "./layout";
import { summarise } from "./score";
import { courseMarkers, helperAtWork, railView, HELPER_SUFFIX, type CourseMarker, type HelperWork, type RailEntry } from "./crew";
import { isReady, profile, readyGroups, sousName } from "./session";
import { coverDueTick, stationTickets } from "./station";
import { sousLine, sousPose, type SousPending, type SousPose } from "./sous";
import type { ActiveAction, HandsOnSession, Item, Station } from "./types";
import { TUNING } from "./verbs";

export const C = {
  ink: "#2b2622", inkSoft: "#5c534a", inkFaint: "#8f857a", paper: "#fffdf8", cream: "#fbf4e6",
  floorA: "#f1dfbd", floorB: "#ecd7b0", wall: "#8b6a4a", wallTop: "#a8845f", tileA: "#eef1ee", tileB: "#e2e8e3",
  steel: "#c9cfd1", steelDark: "#9aa3a6", table: "#c99a63", tableEdge: "#a2733f", tomato: "#c4412b", tomatoDeep: "#b93c29",
  basil: "#3c7a37", basilDeep: "#376a33", amber: "#e9a23b", amberDeep: "#b97a17", red: "#d9472f", plum: "#8a5a9e",
  sky: "#4f8fb8", gold: "#f2b33d", straw: "#e8cf8a", hob: "#3d3a37", barWood: "#6e4f33", barTop: "#8a6440",
};

export interface HandsOnView {
  /** CSS pixels. */
  width: number;
  height: number;
  /** Device pixel ratio the canvas backing store is scaled by (default 1). */
  dpr?: number;
  /** Draw the tutorial hint even if session.tutorial is off (e.g. a help key held). */
  forceHint?: boolean;
  /** Label for the score screen's continue line. */
  continueLabel?: string;
  /** Round 7: what the "use" control is called on this device ("E" on a keyboard, "USE" on a touch screen). */
  keyLabel?: string;
}

export interface ViewMetrics { T: number; ox: number; oy: number; header: number; w: number; h: number }

export function viewMetrics(view: HandsOnView): ViewMetrics {
  const header = 80; // round 5: room for 13 px ticket slips (was 64)
  const T = Math.max(12, Math.floor(Math.min((view.width - 8) / WORLD_W, (view.height - header - 4) / WORLD_H)));
  const ox = Math.floor((view.width - T * WORLD_W) / 2);
  const oy = header + Math.max(0, Math.floor((view.height - header - T * WORLD_H) / 2));
  return { T, ox, oy, header, w: view.width, h: view.height };
}

const FONT = "Nunito, system-ui, -apple-system, Segoe UI, sans-serif";

export function render(ctx: CanvasRenderingContext2D, session: HandsOnSession, state: GameState, view: HandsOnView): void {
  const m = viewMetrics(view);
  const dpr = view.dpr ?? 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.cream;
  ctx.fillRect(0, 0, m.w, m.h);
  const P = (tx: number, ty: number) => ({ x: m.ox + tx * m.T, y: m.oy + ty * m.T });
  const now = session.time;

  drawFloors(ctx, m, P);
  drawProps(ctx, session, m, P);
  const hint = session.tutorial || view.forceHint ? nextHint(session, state) : undefined;
  // Round 6: the kitchen crew a career commis works with (who has which ticket, the course coming, the sous chef's walk).
  const crew = crewView(session, state, m);
  const key = view.keyLabel ?? "E";
  // station glow first, under the furniture edges
  for (const st of session.stations) drawGlow(ctx, session, st, m, P, now, hint?.stationId === st.id);
  drawYourStation(ctx, session, m, P);
  for (const st of session.stations) drawStation(ctx, session, state, st, m, P, now, crew);
  drawColleagues(ctx, session, state, m, P, now);
  if (crew) drawCrew(ctx, session, state, crew, m, P, now);
  drawPlayer(ctx, session, m, P, now);
  if (hint?.stationId && !session.activeAction) drawArrow(ctx, session, hint.stationId, m, P, now);
  drawToasts(ctx, session, m, P, now, crew?.sous);
  if (crew) drawSousBubble(ctx, session, crew, m, P);
  if (session.activeAction) drawActionWidget(ctx, session, session.activeAction, m, P, key);
  else drawPrompt(ctx, session, m, P, key);
  drawHeader(ctx, session, state, m, now, crew);
  if (crew) drawFlyingSlip(ctx, crew, m, P);
  drawBanner(ctx, session, hint?.text && key !== "E" ? withKey(hint.text, key) : hint?.text, m);
  if (session.shift?.over) drawScoreScreen(ctx, session, m, view.continueLabel ?? "Press E to play again");
  ctx.restore();
}

type PFn = (tx: number, ty: number) => { x: number; y: number };

// ───────────────────────── round 6: the crew view (derived once a frame) ─────────────────────────

/** Header rail geometry (CSS px), shared by the rail and the sous chef's walk to it. */
export const RAIL = { x: 10, hudW: 250, tagW: 160, slipW: 132, gap: 6 } as const;

interface CrewView {
  rail: RailEntry[];
  markers: Map<string, CourseMarker>;
  helper?: HelperWork;
  sous: SousPose;
  sousName: string;
  /** Header x (CSS px) of the centre of rail slot `i`. */
  slotPx: (i: number) => number;
}

function crewView(s: HandsOnSession, state: GameState, m: ViewMetrics): CrewView | undefined {
  if (s.role !== "chef" || !s.opts.station) return undefined;
  const slotPx = (i: number) => RAIL.x + RAIL.tagW + i * (RAIL.slipW + RAIL.gap) + RAIL.slipW / 2;
  // The sous chef stands in the kitchen under the slip he takes (clamped to the walkable strip).
  const railX = (i: number) => clamp((slotPx(i) - m.ox) / m.T, 2.5, 19.5);
  const helper = helperAtWork(s, state);
  const rail = railView(s, state);
  const pending = sousPending(s, state, rail);
  return {
    rail,
    markers: new Map(courseMarkers(s, state).map((k) => [k.tableId, k])),
    ...(helper ? { helper } : {}),
    sous: sousPose(s.sousWalks, s.time, railX, pending),
    sousName: sousName(s, state),
    slotPx,
  };
}

/**
 * Round 7: the slip the sim's sous chef sends at the next tick by its cover age (`coverDueTick`, the rule sim-core's
 * `ticketsToCover` uses) and when it fell due (the session stamps `railSeen.dueSince` when `sousLead` is on), as its slot
 * on the header rail — the same left-to-right party order the session books the walk with. Patience-based covers are
 * left out (no stamp): he walks those the round-6 way, after the cover.
 */
export function sousPending(s: HandsOnSession, state: GameState, rail: readonly RailEntry[]): SousPending | undefined {
  if (!s.opts.sousLead) return undefined;
  const since = new Map((s.railSeen ?? []).map((x) => [x.id, x.dueSince]));
  const parties: string[] = [];
  for (const e of rail) if (e.owner !== "helper" && !parties.includes(e.ticket.customerId)) parties.push(e.ticket.customerId);
  for (const e of rail) {
    const d = since.get(e.ticket.id);
    if (e.owner === "helper" || d === undefined || s.served[e.ticket.id] || coverDueTick(s, state, e.ticket) > state.tick + 1) continue;
    return { slot: Math.max(0, parties.indexOf(e.ticket.customerId)), dueSince: d };
  }
  // A due slip that has just left the rail in this state, before the session's next update books its cover (or stands
  // him down): he keeps waiting under it for that frame.
  const onRail = new Set(rail.map((e) => e.ticket.id));
  const seenParties = [...new Set((s.railSeen ?? []).map((x) => x.customerId))];
  const gone = (s.railSeen ?? []).find((x) => x.dueSince !== undefined && !onRail.has(x.id));
  return gone ? { slot: Math.max(0, seenParties.indexOf(gone.customerId)), dueSince: gone.dueSince! } : undefined;
}

/** Round 7: "E" in the hint lines becomes the touch button's name ("Tap USE as the slider…"). */
export const withKey = (text: string, key: string): string => text.replace(/\bE\b/g, key);

/**
 * Round 7: an NPC drawn where the player stands steps aside (render only; nobody blocks anybody). Returns the NPC's
 * drawn position, pushed out to `r` tiles from the player.
 */
export function avoidPlayer(npc: { x: number; y: number }, player: { x: number; y: number }, r = 0.8): { x: number; y: number } {
  const dx = npc.x - player.x, dy = npc.y - player.y;
  const d = Math.hypot(dx, dy);
  if (d >= r) return npc;
  if (d < 1e-6) return { x: npc.x + r, y: npc.y };
  return { x: player.x + (dx / d) * r, y: player.y + (dy / d) * r };
}

// ───────────────────────── floors and walls ─────────────────────────

function drawFloors(ctx: CanvasRenderingContext2D, m: ViewMetrics, P: PFn) {
  const { T } = m;
  // kitchen tiles (rows 0..PASS_ROW)
  const half = T / 2;
  for (let y = 0; y < PASS_ROW + 1; y++) for (let x = 0; x < WORLD_W; x++) {
    const p = P(x, y);
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = ((x * 2 + (k & 1) + y * 2 + (k >> 1)) & 1) ? C.tileA : C.tileB;
      ctx.fillRect(p.x + (k & 1) * half, p.y + (k >> 1) * half, half + 0.5, half + 0.5);
    }
  }
  // dining planks (rows PASS_ROW+1 .. FRONT_WALL_ROW-1)
  const top = P(0, PASS_ROW + 1).y, bottom = P(0, FRONT_WALL_ROW).y;
  const plank = Math.max(10, T * 0.62);
  for (let y = top, i = 0; y < bottom; y += plank, i++) {
    ctx.fillStyle = i % 2 ? C.floorA : C.floorB;
    ctx.fillRect(m.ox, y, WORLD_W * T, Math.min(plank, bottom - y));
    ctx.fillStyle = "rgba(150,110,60,0.12)";
    const off = (i * 97) % 160;
    for (let x = m.ox + off; x < m.ox + WORLD_W * T; x += 160) ctx.fillRect(x, y, 1.5, plank);
  }
  // rug by the door
  const d = P(DOOR.x - 0.5, FRONT_WALL_ROW - 1.2);
  ctx.fillStyle = "rgba(224,83,61,0.18)";
  roundRect(ctx, d.x, d.y, (DOOR.w + 1) * T, T * 1.1, 8); ctx.fill();
  // bar floor: darker boards behind the counter
  const b = P(25, 6);
  ctx.fillStyle = "rgba(110,79,51,0.16)";
  ctx.fillRect(b.x, b.y, 4 * T, 8 * T);

  // outer walls
  ctx.fillStyle = C.wall;
  ctx.fillRect(m.ox, m.oy, WORLD_W * T, T * 0.55);
  ctx.fillRect(m.ox, m.oy, T * 0.55, WORLD_H * T);
  ctx.fillRect(m.ox + (WORLD_W - 0.55) * T, m.oy, T * 0.55, WORLD_H * T);
  // front wall with windows and the door
  const fw = P(0, FRONT_WALL_ROW).y + T * 0.25;
  ctx.fillRect(m.ox, fw, DOOR.x * T, T * 0.5);
  ctx.fillRect(m.ox + (DOOR.x + DOOR.w) * T, fw, (WORLD_W - DOOR.x - DOOR.w) * T, T * 0.5);
  ctx.fillStyle = "#cfe6ef";
  for (let x = 2; x < WORLD_W - 2; x += 4) if (x + 2 < DOOR.x || x > DOOR.x + DOOR.w) ctx.fillRect(m.ox + x * T, fw + T * 0.17, 2.4 * T, T * 0.16);
  // awning stripes over the door
  const ax = m.ox + (DOOR.x - 0.4) * T, aw = (DOOR.w + 0.8) * T;
  for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? C.paper : C.tomato; ctx.fillRect(ax + (i * aw) / 6, fw + T * 0.5, aw / 6 + 0.5, T * 0.3); }
  label(ctx, "DOOR", m.ox + (DOOR.x + DOOR.w / 2) * T, fw + T * 0.42, { align: "center", size: 13, weight: 900, colour: C.paper, spacing: 1 });
  // kitchen wall with the pass gap and a swing door (x 15-16)
  const kw = P(0, PASS_ROW).y;
  ctx.fillStyle = C.wall;
  ctx.fillRect(m.ox, kw + T * 0.7, 5 * T, T * 0.3);
  ctx.fillRect(m.ox + 19 * T, kw + T * 0.7, 2 * T, T * 0.3);
  ctx.fillStyle = C.wallTop;
  ctx.fillRect(m.ox + 15 * T, kw + T * 0.82, 2 * T, T * 0.08); // swing-door threshold
  label(ctx, "KITCHEN", m.ox + T * 2.6, m.oy + T * 0.5, { size: 13, weight: 900, colour: "rgba(255,253,248,0.85)", spacing: 2 });
  // the office (top right): management lives here
  const o = P(21, 1);
  ctx.fillStyle = "#e7dccb";
  ctx.fillRect(o.x, o.y, 8 * T, 4.7 * T);
  ctx.fillStyle = C.wall;
  ctx.fillRect(o.x - T * 0.2, o.y, T * 0.25, 5 * T);
  ctx.fillRect(o.x, o.y + 4.7 * T, 8 * T, T * 0.3);
  ctx.fillStyle = C.barTop; roundRect(ctx, o.x + 2.2 * T, o.y + 1.2 * T, 3.4 * T, 1.4 * T, 6); ctx.fill();
  ctx.fillStyle = "#3a5c78"; roundRect(ctx, o.x + 3.2 * T, o.y + 1.35 * T, 1.3 * T, 0.8 * T, 3); ctx.fill();
  label(ctx, "OFFICE", o.x + 4 * T, o.y + 3.7 * T, { align: "center", size: 13, weight: 900, colour: C.inkSoft, spacing: 2 });
}

function drawProps(ctx: CanvasRenderingContext2D, s: HandsOnSession, m: ViewMetrics, P: PFn) {
  const { T } = m;
  for (const pr of s.props) {
    const p = P(pr.x, pr.y);
    if (pr.kind === "sink") {
      ctx.fillStyle = C.steel; ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1.5;
      roundRect(ctx, p.x + 2, p.y + 3, pr.w * T - 4, pr.h * T - 6, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#b9d4e0"; roundRect(ctx, p.x + 7, p.y + 8, pr.w * T - 14, pr.h * T - 16, 4); ctx.fill();
    } else if (pr.kind === "shelves") {
      ctx.fillStyle = C.barWood; ctx.fillRect(p.x + 4, p.y, pr.w * T - 8, pr.h * T);
      const cols = [C.basil, C.amber, C.tomato, C.sky, C.plum, C.straw];
      for (let i = 0; i < pr.h * 2; i++) {
        ctx.fillStyle = cols[i % cols.length]!;
        ctx.beginPath(); ctx.arc(p.x + T / 2, p.y + T * 0.25 + i * T * 0.5, T * 0.13, 0, Math.PI * 2); ctx.fill();
      }
    } else if (pr.kind === "plant") plant(ctx, p.x + T / 2, p.y + T / 2, T * 0.42);
  }
}

// ───────────────────────── stations ─────────────────────────

function drawGlow(ctx: CanvasRenderingContext2D, s: HandsOnSession, st: Station, m: ViewMetrics, P: PFn, now: number, hinted: boolean) {
  const prompt = s.prompt;
  const active = s.activeAction?.stationId === st.id;
  const near = prompt?.stationId === st.id;
  if (!near && !active && !hinted) return;
  const p = P(st.x, st.y);
  const pulse = (Math.sin(now * 6) + 1) / 2;
  const enabled = active || (near && prompt!.enabled);
  const col = enabled ? `rgba(242,179,61,${0.35 + 0.3 * pulse})` : hinted ? `rgba(242,179,61,${0.12 + 0.14 * pulse})` : "rgba(143,133,122,0.22)";
  const pad = m.T * 0.22;
  ctx.fillStyle = col;
  if (st.kind === "table") { ctx.beginPath(); ctx.arc(p.x + st.w * m.T / 2, p.y + st.h * m.T / 2, (st.w * m.T) / 2 + m.T * 0.75, 0, Math.PI * 2); ctx.fill(); }
  else { roundRect(ctx, p.x - pad, p.y - pad, st.w * m.T + pad * 2, st.h * m.T + pad * 2, 10); ctx.fill(); }
  if (enabled) {
    ctx.strokeStyle = C.amberDeep; ctx.lineWidth = 2;
    if (st.kind === "table") { ctx.beginPath(); ctx.arc(p.x + st.w * m.T / 2, p.y + st.h * m.T / 2, (st.w * m.T) / 2 + m.T * 0.75, 0, Math.PI * 2); ctx.stroke(); }
    else { roundRect(ctx, p.x - pad, p.y - pad, st.w * m.T + pad * 2, st.h * m.T + pad * 2, 10); ctx.stroke(); }
  }
}

/** Round 7: the appliances her station's dishes cook on (a commis with a station), for the "yours" outline. */
export function yourStations(s: HandsOnSession): string[] {
  const st = s.role === "chef" ? s.opts.station : undefined;
  if (!st) return [];
  const out = new Set<string>();
  for (const d of st.dishIds) {
    const m = profile(s, d).method;
    out.add(m === "stove" || m === "oven" || m === "fryer" ? m : "prep");
  }
  return [...out].filter((id) => s.stations.some((x) => x.id === id));
}

/** Round 7: a dashed tomato outline and a "Yours" tab on her station's appliances (the rail tag's colour). */
function drawYourStation(ctx: CanvasRenderingContext2D, s: HandsOnSession, m: ViewMetrics, P: PFn) {
  for (const id of yourStations(s)) {
    const st = s.stations.find((x) => x.id === id)!;
    const p = P(st.x, st.y);
    const pad = m.T * 0.12;
    ctx.save();
    ctx.setLineDash([6, 4]); ctx.strokeStyle = C.tomato; ctx.lineWidth = 2.5;
    roundRect(ctx, p.x - pad, p.y - pad, st.w * m.T + pad * 2, st.h * m.T + pad * 2, 8); ctx.stroke();
    ctx.restore();
    ctx.font = `900 13px ${FONT}`;
    const w = ctx.measureText("Yours").width + 12;
    const tx = p.x + st.w * m.T / 2 - w / 2, ty = p.y + st.h * m.T + pad + 1;
    ctx.fillStyle = C.tomato; roundRect(ctx, tx, ty, w, 17, 8); ctx.fill();
    label(ctx, "Yours", tx + w / 2, ty + 13, { align: "center", size: 13, weight: 900, colour: C.paper });
  }
}

function drawStation(ctx: CanvasRenderingContext2D, s: HandsOnSession, state: GameState, st: Station, m: ViewMetrics, P: PFn, now: number, crew?: CrewView) {
  const { T } = m;
  const p = P(st.x, st.y);
  const w = st.w * T, h = st.h * T;
  const busy = s.activeAction?.stationId === st.id || crew?.helper?.stationId === st.id;
  switch (st.kind) {
    case "fridge": {
      ctx.fillStyle = C.paper; ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1.5;
      roundRect(ctx, p.x + 2, p.y + 1, w - 4, h - 3, 5); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(p.x + w / 2, p.y + 4); ctx.lineTo(p.x + w / 2, p.y + h - 6); ctx.stroke();
      ctx.fillStyle = C.steelDark; ctx.fillRect(p.x + w / 2 - 5, p.y + h * 0.35, 3, h * 0.3); ctx.fillRect(p.x + w / 2 + 2, p.y + h * 0.35, 3, h * 0.3);
      // veg peeking on top
      dot(ctx, p.x + 9, p.y + 4, 3.5, C.tomato); dot(ctx, p.x + 16, p.y + 3, 3, C.basil); dot(ctx, p.x + w - 10, p.y + 4, 3.5, C.amber);
      break;
    }
    case "prep": {
      ctx.fillStyle = C.steel; ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1.5;
      roundRect(ctx, p.x, p.y + 1, w, h - 2, 5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#d9b27c"; ctx.strokeStyle = "#a9834f";
      roundRect(ctx, p.x + T * 0.5, p.y + 4, w - T, h - 9, 4); ctx.fill(); ctx.stroke();
      // knife
      ctx.fillStyle = "#dfe4e6"; ctx.fillRect(p.x + w * 0.62, p.y + h * 0.36, T * 0.75, 4);
      ctx.fillStyle = C.ink; ctx.fillRect(p.x + w * 0.62 + T * 0.75, p.y + h * 0.36 - 0.5, T * 0.3, 5);
      if (busy) { const chop = Math.abs(Math.sin(now * 14)); dot(ctx, p.x + w * 0.38, p.y + h * 0.5, 4 + chop, C.basil); dot(ctx, p.x + w * 0.48, p.y + h * 0.55, 3.5, C.tomato); }
      break;
    }
    case "stove": case "oven": case "fryer": {
      const on = busy;
      ctx.fillStyle = C.hob; roundRect(ctx, p.x + 1, p.y + 1, w - 2, h - 2, 5); ctx.fill();
      if (st.kind === "stove") {
        for (let i = 0; i < st.w; i++) {
          const cx = p.x + (i + 0.5) * T, cy = p.y + h / 2;
          ctx.beginPath(); ctx.arc(cx, cy, T * 0.27, 0, Math.PI * 2);
          ctx.strokeStyle = on && i === 1 ? (Math.sin(now * 9 + i) > 0 ? "#ff7a45" : C.tomato) : "#6b6662";
          ctx.lineWidth = 3; ctx.stroke();
        }
        if (on) { ctx.fillStyle = "#4a4643"; ctx.beginPath(); ctx.arc(p.x + 1.5 * T, p.y + h / 2, T * 0.32, 0, Math.PI * 2); ctx.fill(); ctx.fillRect(p.x + 1.8 * T, p.y + h / 2 - 2, T * 0.6, 4); }
      } else if (st.kind === "oven") {
        ctx.fillStyle = on ? "#f08a3c" : "#5a5450";
        roundRect(ctx, p.x + 7, p.y + 6, w - 14, h - 12, 4); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(p.x + 9, p.y + 8, w - 18, 3);
      } else {
        ctx.fillStyle = C.steel; roundRect(ctx, p.x + 4, p.y + 4, w - 8, h - 8, 4); ctx.fill();
        ctx.fillStyle = on ? "#f2c45a" : "#d8b45a";
        for (let i = 0; i < 2; i++) { roundRect(ctx, p.x + 7 + i * (w / 2 - 4), p.y + 7, w / 2 - 10, h - 14, 3); ctx.fill(); }
        if (on) for (let i = 0; i < 4; i++) dot(ctx, p.x + 10 + ((i * 13 + now * 30) % (w - 20)), p.y + 9 + (i % 2) * 8, 1.6, C.paper);
      }
      if (on) steam(ctx, p.x + w / 2, p.y - 2, now);
      break;
    }
    case "pass": {
      ctx.fillStyle = C.steel; ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1.5;
      roundRect(ctx, p.x, p.y + T * 0.15, w, h * 0.7, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(255,180,80,0.32)"; ctx.fillRect(p.x + 6, p.y + T * 0.2, w - 12, 4); // heat lamp
      // plates up, grouped by party, with a table tag
      const groups = readyGroups(s, state, "pass");
      let x = p.x + T * 0.4;
      for (const g of groups) {
        if (x > p.x + w - T * 0.6) break;
        const tn = g.tickets[0] ? tableNo(s, state, g.tickets[0].customerId) : undefined;
        g.tickets.slice(0, 3).forEach((_, j) => plate(ctx, x + j * T * 0.5, p.y + h * 0.5, T * 0.2, true));
        if (tn) tag(ctx, `T${tn}`, x + T * 0.2, p.y + h * 0.5 - T * 0.42, C.ink);
        x += Math.min(3, g.tickets.length) * T * 0.5 + T * 0.45;
      }
      // Round 7: at the left end, clear of where the sous chef and the player stand to plate (R6: his tag sat on it).
      label(ctx, "PASS", p.x + 4, p.y - 3, { size: 13, weight: 900, colour: C.inkSoft, spacing: 2 });
      break;
    }
    case "dishReturn": {
      ctx.fillStyle = C.steel; ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1.5;
      roundRect(ctx, p.x, p.y + T * 0.15, w, h * 0.7, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#9ab7c4"; roundRect(ctx, p.x + 6, p.y + T * 0.25, w - 12, h * 0.5, 4); ctx.fill();
      label(ctx, "WASH-UP", p.x + w / 2, p.y - 3, { align: "center", size: 13, weight: 900, colour: C.inkSoft, spacing: 0.5 });
      break;
    }
    case "bar": {
      ctx.fillStyle = C.barWood; roundRect(ctx, p.x, p.y, w, h, 5); ctx.fill();
      ctx.fillStyle = C.barTop; roundRect(ctx, p.x + 3, p.y + 3, w - 6, h - 6, 4); ctx.fill();
      // taps
      for (let i = 0; i < 3; i++) { ctx.fillStyle = C.steel; ctx.fillRect(p.x + w - 7, p.y + T * (0.4 + i * 0.35), 6, 4); }
      // drinks ready on the bar
      const groups = readyGroups(s, state, "bar");
      let y = p.y + T * 1.3;
      for (const g of groups) {
        if (y > p.y + h - T * 0.3) break;
        const tn = g.tickets[0] ? tableNo(s, state, g.tickets[0].customerId) : undefined;
        g.tickets.slice(0, 2).forEach((t, j) => glass(ctx, p.x + w / 2 - 5 + j * 9, y, T * 0.18, drinkColour(t.dishId), 0.8));
        if (tn) tag(ctx, `T${tn}`, p.x - T * 0.55, y, C.plum);
        y += T * 0.75;
      }
      label(ctx, "BAR", p.x + w / 2, p.y - 4, { align: "center", size: 13, weight: 900, colour: C.inkSoft, spacing: 2 });
      break;
    }
    case "till": {
      ctx.fillStyle = C.barWood; roundRect(ctx, p.x, p.y, w, h, 5); ctx.fill();
      ctx.fillStyle = C.ink; roundRect(ctx, p.x + 5, p.y + 5, w - 10, h * 0.5, 3); ctx.fill();
      ctx.fillStyle = "#7fe0a0"; ctx.fillRect(p.x + 8, p.y + 8, w - 16, 5);
      label(ctx, "TILL", p.x + w / 2, p.y + h + 14, { align: "center", size: 13, weight: 900, colour: C.inkSoft, spacing: 2 });
      break;
    }
    case "table": drawTable(ctx, s, state, st, m, P, now, crew); break;
  }
}

function drawTable(ctx: CanvasRenderingContext2D, s: HandsOnSession, state: GameState, st: Station, m: ViewMetrics, P: PFn, now: number, crew?: CrewView) {
  const { T } = m;
  const table = state.tables.find((t) => t.id === st.tableId);
  if (!table) return;
  const p = P(st.x, st.y);
  const cx = p.x + (st.w * T) / 2, cy = p.y + (st.h * T) / 2;
  const r = (st.w * T) / 2 - 3;
  const c = table.occupiedBy ? state.customers.find((x) => x.id === table.occupiedBy) : undefined;
  const person = Math.max(5, T * 0.24);
  const seatR = r + person * 1.15;
  const seats = Array.from({ length: table.seats }, (_, k) => {
    const a = -Math.PI / 2 + (k / table.seats) * Math.PI * 2 + (table.seats === 2 ? Math.PI / 2 : Math.PI / table.seats);
    return { x: cx + Math.cos(a) * seatR, y: cy + Math.sin(a) * seatR };
  });
  for (const seat of seats) dot(ctx, seat.x, seat.y, person * 0.95, "#9b6d3e");
  // stage halo + patience arc
  if (c) {
    const col = c.stage === "eating" ? C.basil : c.stage === "paying" ? C.gold : patienceColour(c.patience);
    ctx.fillStyle = col + "33";
    ctx.beginPath(); ctx.arc(cx, cy, seatR + person * 1.3, 0, Math.PI * 2); ctx.fill();
    if (c.stage === "seated" || c.stage === "ordered") {
      // Round 7: a thicker ring over a faint full track, so "how long they'll wait" reads without a number.
      ctx.strokeStyle = "rgba(43,38,34,0.12)"; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(cx, cy, seatR + person * 1.3 - 2, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.lineCap = "round";
      ctx.beginPath(); ctx.arc(cx, cy, seatR + person * 1.3 - 2, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.max(0, Math.min(100, c.patience))) / 100); ctx.stroke();
      ctx.lineCap = "butt";
    }
  }
  ctx.fillStyle = "rgba(90,60,25,0.18)";
  ctx.beginPath(); ctx.ellipse(cx + 2, cy + 3, r, r * 0.95, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = c ? mix(C.table, c.stage === "eating" ? C.basil : c.stage === "paying" ? C.gold : patienceColour(c.patience), 0.3) : C.table;
  ctx.strokeStyle = C.tableEdge; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  const dirty = table.dirtyTicks > 0 && !c && !s.cleared[table.id];
  if (dirty) {
    for (let k = 0; k < Math.min(3, table.seats); k++) {
      const a = k * 2.1;
      dot(ctx, cx + Math.cos(a) * r * 0.45, cy + Math.sin(a) * r * 0.45, r * 0.24, "#e7e1d6");
      dot(ctx, cx + Math.cos(a) * r * 0.45 + 1, cy + Math.sin(a) * r * 0.45, 1.8, "#b3a58f");
    }
  } else if (c) {
    const n = Math.min(c.partySize, seats.length);
    const served = c.platesReady ?? 0;
    seats.slice(0, n).forEach((seat, k) => {
      const px = cx + (seat.x - cx) * 0.5, py = cy + (seat.y - cy) * 0.5;
      if (c.stage === "seated") { ctx.fillStyle = C.paper; ctx.strokeStyle = C.tomatoDeep; ctx.lineWidth = 1; ctx.fillRect(px - 3.5, py - 4.5, 7, 9); ctx.strokeRect(px - 3.5, py - 4.5, 7, 9); }
      else if (c.stage === "eating" || (c.stage === "ordered" && k < served)) plate(ctx, px, py, Math.max(4, r * 0.22), true);
    });
    if (c.stage === "paying") {
      const bob = Math.sin(now * 4) * 1.5;
      ctx.fillStyle = C.gold; ctx.strokeStyle = C.amberDeep; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy + bob, Math.max(7, r * 0.36), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      label(ctx, "£", cx, cy + bob + 4.5, { align: "center", size: Math.max(13, r * 0.45), weight: 900, colour: C.amberDeep });
    }
    // little people (drawn after the top so heads overlap the table edge like RestaurantView)
    seats.slice(0, n).forEach((seat, k) => person_(ctx, seat.x, seat.y, person, c.segment, `${c.id}:${k}`, c.partySize >= 3 && k >= 2 && /famil/.test(c.segment)));
    if (c.stage === "ordered" && served < c.order.length) {
      // thought bubble: how many plates they're still waiting for
      const bx = cx - r * 0.9, by = cy - r - person * 1.6;
      ctx.fillStyle = "rgba(255,253,248,0.95)"; ctx.strokeStyle = C.inkFaint; ctx.lineWidth = 1;
      roundRect(ctx, bx - 17, by - 11, 34, 18, 9); ctx.fill(); ctx.stroke();
      label(ctx, `${served}/${c.order.length}`, bx, by + 3.5, { align: "center", size: 13, weight: 900, colour: C.inkSoft });
    }
  }
  // Round 6: their own course is coming (her dessert/side/starter while they eat the mains)
  const course = c && table ? crew?.markers.get(table.id) : undefined;
  if (course) drawCourseMarker(ctx, s, course, cx - r * 0.78, cy - r * 0.78, now);
  // Round 7: a face for how they feel while they wait (happy, fed up, cross), bottom-left of the table.
  if (c && (c.stage === "seated" || c.stage === "ordered")) moodFace(ctx, cx - r * 0.78, cy + r * 0.78, 9, c.patience);
  // table number badge: big and always visible
  const tx = cx + r * 0.75, ty = cy - r * 0.75;
  dot(ctx, tx, ty, 11, c ? C.ink : "rgba(43,38,34,0.6)");
  label(ctx, String(st.number ?? ""), tx, ty + 4.5, { align: "center", size: 13, weight: 900, colour: C.paper });
}

/** Round 7: waiting mood as a face: smile above 60% patience, flat to 30%, frown and red below. */
export function moodOf(patience: number): "happy" | "meh" | "cross" {
  return patience > 60 ? "happy" : patience > 30 ? "meh" : "cross";
}
function moodFace(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, patience: number) {
  const mood = moodOf(patience);
  dot(ctx, x, y, r + 1.5, C.ink);
  dot(ctx, x, y, r, mood === "happy" ? "#f6d77a" : mood === "meh" ? C.amber : C.red);
  dot(ctx, x - r * 0.35, y - r * 0.2, Math.max(1.2, r * 0.13), C.ink);
  dot(ctx, x + r * 0.35, y - r * 0.2, Math.max(1.2, r * 0.13), C.ink);
  ctx.strokeStyle = C.ink; ctx.lineWidth = 1.6; ctx.lineCap = "round";
  ctx.beginPath();
  if (mood === "happy") ctx.arc(x, y + r * 0.05, r * 0.45, Math.PI * 0.15, Math.PI * 0.85);
  else if (mood === "meh") { ctx.moveTo(x - r * 0.4, y + r * 0.35); ctx.lineTo(x + r * 0.4, y + r * 0.35); }
  else ctx.arc(x, y + r * 0.7, r * 0.42, Math.PI * 1.2, Math.PI * 1.8);
  ctx.stroke(); ctx.lineCap = "butt";
}

// ───────────────────────── characters ─────────────────────────

function drawColleagues(ctx: CanvasRenderingContext2D, s: HandsOnSession, state: GameState, m: ViewMetrics, P: PFn, now: number) {
  // AI colleagues stand at their posts (cosmetic). They never block the player.
  const named = (role: string) => state.staff.find((x) => x.role === role)?.name.split(" ")[0];
  const posts: { role: "chef" | "server" | "bar"; x: number; y: number }[] = [];
  if (s.role !== "chef") posts.push({ role: "chef", x: 9.5, y: 2.55 });
  if (s.role !== "bar") posts.push({ role: "bar", x: 26.2, y: 8.6 });
  if (s.role !== "server" && s.role !== "bar") posts.push({ role: "server", x: 15.7, y: 6.6 });
  for (const p0 of posts) {
    const p = { ...p0, ...avoidPlayer(p0, s.player) };
    const q = P(p.x, p.y);
    const bob = Math.sin(now * 5 + p.x) * 1.2;
    character(ctx, q.x, q.y + bob, m.T, p.role, "down", 0.85);
    const nm = named(p.role);
    if (nm) nameTag(ctx, nm, q.x, q.y + m.T * 0.55);
  }
}

function drawPlayer(ctx: CanvasRenderingContext2D, s: HandsOnSession, m: ViewMetrics, P: PFn, now: number) {
  const p = P(s.player.x, s.player.y);
  const moving = Math.hypot(s.player.vx, s.player.vy) > 0.3;
  const bob = moving ? Math.sin(now * 16) * 1.6 : 0;
  const wob = s.player.wobble;
  // "you" ring
  ctx.strokeStyle = "rgba(242,179,61,0.9)"; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.ellipse(p.x, p.y + m.T * 0.32, m.T * 0.42, m.T * 0.17, 0, 0, Math.PI * 2); ctx.stroke();
  character(ctx, p.x, p.y + bob, m.T, s.role, s.player.facing, 1, true);
  if (s.carrying) carried(ctx, s.carrying, p.x, p.y + bob, m.T, s.player.facing, wob, now, s);
}

/** A staff character seen from above-front: shoulders, head, role hat, face toward `facing`. */
function character(ctx: CanvasRenderingContext2D, x: number, y: number, T: number, role: "chef" | "server" | "bar", facing: string, scale = 1, you = false, jacket?: string) {
  const r = T * 0.3 * scale;
  ctx.fillStyle = "rgba(60,40,20,0.2)";
  ctx.beginPath(); ctx.ellipse(x + 1, y + r * 1.05, r * 1.15, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  const body = jacket ?? (role === "chef" ? C.paper : role === "server" ? "#2f3a33" : C.plum);
  ctx.fillStyle = body; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.35, r * 1.1, r * 0.85, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (role === "chef") { ctx.fillStyle = C.tomato; ctx.fillRect(x - r * 0.15, y + r * 0.1, r * 0.3, r * 0.9); } // apron tie
  if (role === "server") { // white shirt + bow tie
    ctx.fillStyle = C.paper; ctx.beginPath(); ctx.moveTo(x - r * 0.35, y - r * 0.05); ctx.lineTo(x + r * 0.35, y - r * 0.05); ctx.lineTo(x, y + r * 0.8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.tomato; ctx.beginPath(); ctx.moveTo(x, y + r * 0.15); ctx.lineTo(x - r * 0.3, y); ctx.lineTo(x - r * 0.3, y + r * 0.3); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y + r * 0.15); ctx.lineTo(x + r * 0.3, y); ctx.lineTo(x + r * 0.3, y + r * 0.3); ctx.closePath(); ctx.fill();
  }
  if (role === "bar") { ctx.fillStyle = C.ink; ctx.fillRect(x - r * 0.9, y + r * 0.45, r * 1.8, r * 0.2); } // waistcoat line
  // head
  const hx = x + (facing === "left" ? -r * 0.12 : facing === "right" ? r * 0.12 : 0);
  const hy = y - r * 0.45;
  ctx.fillStyle = you ? "#f1c9a5" : "#d9a77c"; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(hx, hy, r * 0.68, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // eyes show facing
  if (facing !== "up") {
    const ex = facing === "left" ? -r * 0.22 : facing === "right" ? r * 0.22 : 0;
    ctx.fillStyle = C.ink;
    dot(ctx, hx + ex - r * 0.2, hy + r * 0.08, Math.max(1.2, r * 0.09), C.ink);
    dot(ctx, hx + ex + r * 0.2, hy + r * 0.08, Math.max(1.2, r * 0.09), C.ink);
  }
  // role hat
  ctx.lineWidth = 1.4; ctx.strokeStyle = C.ink;
  if (role === "chef") {
    ctx.fillStyle = C.paper;
    ctx.fillRect(hx - r * 0.55, hy - r * 0.95, r * 1.1, r * 0.45); ctx.strokeRect(hx - r * 0.55, hy - r * 0.95, r * 1.1, r * 0.45);
    for (const dx of [-0.42, 0, 0.42]) { ctx.beginPath(); ctx.arc(hx + dx * r, hy - r * 1.2, r * 0.38, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  } else if (role === "server") {
    ctx.fillStyle = C.basil; // side cap
    ctx.beginPath(); ctx.ellipse(hx, hy - r * 0.55, r * 0.72, r * 0.32, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else {
    ctx.fillStyle = C.ink; // flat cap
    ctx.beginPath(); ctx.arc(hx, hy - r * 0.15, r * 0.7, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fill();
    ctx.fillRect(hx - r * 0.1, hy - r * 0.55, r * 0.85, r * 0.16);
  }
}

function carried(ctx: CanvasRenderingContext2D, item: Item, x: number, y: number, T: number, facing: string, wobble: number, now: number, s: HandsOnSession) {
  const off = facing === "left" ? -1 : facing === "right" ? 1 : 0;
  const ix = x + off * T * 0.45, iy = y - T * 0.95;
  const shake = wobble > 0 ? Math.sin(now * 40) * wobble * 4 : 0;
  ctx.save();
  ctx.translate(ix + shake, iy);
  // backing bubble so the icon reads on any floor
  ctx.fillStyle = "rgba(255,253,248,0.92)"; ctx.strokeStyle = wobble > 0.3 ? C.tomato : C.inkFaint; ctx.lineWidth = wobble > 0.3 ? 2 : 1;
  roundRect(ctx, -T * 0.55, -T * 0.32, T * 1.1, T * 0.6, 8); ctx.fill(); ctx.stroke();
  switch (item.kind) {
    case "raw": { // basket of veg
      ctx.fillStyle = "#c9a26b"; roundRect(ctx, -T * 0.32, -T * 0.05, T * 0.64, T * 0.24, 4); ctx.fill();
      dot(ctx, -T * 0.15, -T * 0.08, T * 0.11, C.tomato); dot(ctx, T * 0.05, -T * 0.12, T * 0.1, C.basil); dot(ctx, T * 0.2, -T * 0.06, T * 0.09, C.amber);
      break;
    }
    case "prepped": { // bowl of chopped
      ctx.fillStyle = C.paper; ctx.strokeStyle = C.steelDark; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, T * 0.22, 0, Math.PI); ctx.closePath(); ctx.fill(); ctx.stroke();
      for (let i = 0; i < 5; i++) ctx.fillRect(-T * 0.15 + i * T * 0.07, -T * 0.06 - (i % 2) * 3, 3, 3);
      break;
    }
    case "cooked": { // pan
      ctx.fillStyle = "#4a4643"; ctx.beginPath(); ctx.arc(-T * 0.06, 0, T * 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(T * 0.12, -2, T * 0.3, 4);
      dot(ctx, -T * 0.06, 0, T * 0.12, item.burnt ? "#3a2a1e" : C.amber);
      break;
    }
    case "plates": {
      const n = item.plates.length;
      for (let i = 0; i < n; i++) plate(ctx, -T * 0.22 + i * T * 0.22, -i * 2, T * 0.17, true, item.plates[i]!.glass ? drinkColour(item.plates[i]!.dishId) : undefined);
      break;
    }
    case "dirty": {
      ctx.fillStyle = "#9ab7c4"; roundRect(ctx, -T * 0.32, -T * 0.12, T * 0.64, T * 0.3, 4); ctx.fill();
      for (let i = 0; i < 3; i++) dot(ctx, -T * 0.15 + i * T * 0.15, -T * 0.12, T * 0.1, "#e7e1d6");
      break;
    }
  }
  ctx.restore();
  if (item.kind !== "plates" && item.kind !== "dirty") {
    label(ctx, profile(s, item.dishId).short, ix + shake, iy - T * 0.42, { align: "center", size: 13, weight: 900, colour: C.ink, stroke: C.paper });
  }
}

function nameTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
  ctx.font = `800 13px ${FONT}`;
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = "rgba(255,253,248,0.9)";
  roundRect(ctx, x - w / 2, y, w, 16, 7); ctx.fill();
  label(ctx, text, x, y + 12.5, { align: "center", size: 13, weight: 800, colour: C.ink });
}

// ───────────────────────── prompts, hints, action widgets ─────────────────────────

function drawPrompt(ctx: CanvasRenderingContext2D, s: HandsOnSession, m: ViewMetrics, P: PFn, keyName = "E") {
  const pr = s.prompt;
  if (!pr) return;
  const p = P(s.player.x, s.player.y);
  const text = pr.label;
  ctx.font = `800 13px ${FONT}`;
  const tw = ctx.measureText(text).width;
  const key = pr.enabled ? (pr.verb === "cook" || pr.verb === "pour" ? `Hold ${keyName}` : keyName) : "";
  ctx.font = `900 13px ${FONT}`;
  const kw = key ? ctx.measureText(key).width + 12 : 0;
  const w = tw + kw + (key ? 22 : 16), h = 26;
  const x = clamp(p.x - w / 2, 4, m.w - w - 4);
  const y = clamp(p.y + m.T * 0.62, m.header + 2, m.h - h - 4);
  ctx.fillStyle = pr.enabled ? "rgba(43,38,34,0.88)" : "rgba(255,253,248,0.92)";
  roundRect(ctx, x, y, w, h, 13); ctx.fill();
  if (!pr.enabled) { ctx.strokeStyle = C.inkFaint; ctx.lineWidth = 1; ctx.stroke(); }
  if (key) {
    ctx.fillStyle = C.gold; roundRect(ctx, x + 5, y + 4, kw, h - 8, 6); ctx.fill();
    label(ctx, key, x + 5 + kw / 2, y + 17.5, { align: "center", size: 13, weight: 900, colour: C.ink });
  }
  label(ctx, text, x + (key ? kw + 12 : 8), y + 17.5, { size: 13, weight: 800, colour: pr.enabled ? C.paper : C.inkSoft });
}

function drawArrow(ctx: CanvasRenderingContext2D, s: HandsOnSession, stationId: string, m: ViewMetrics, P: PFn, now: number) {
  const st = s.stations.find((x) => x.id === stationId);
  if (!st) return;
  const p = P(st.x + st.w / 2, st.y);
  const bob = Math.sin(now * 5) * 4;
  const y = p.y - m.T * 0.35 + bob - (st.kind === "table" ? m.T * 0.5 : 0);
  ctx.fillStyle = C.gold; ctx.strokeStyle = C.amberDeep; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p.x, y); ctx.lineTo(p.x - 10, y - 12); ctx.lineTo(p.x - 4, y - 12); ctx.lineTo(p.x - 4, y - 22);
  ctx.lineTo(p.x + 4, y - 22); ctx.lineTo(p.x + 4, y - 12); ctx.lineTo(p.x + 10, y - 12); ctx.closePath();
  ctx.fill(); ctx.stroke();
}

function drawBanner(ctx: CanvasRenderingContext2D, s: HandsOnSession, hint: string | undefined, m: ViewMetrics) {
  const msg = s.message?.text;
  const text = msg ?? hint;
  if (!text || s.shift?.over) return;
  ctx.font = `800 15px ${FONT}`;
  const w = Math.min(m.w - 24, ctx.measureText(text).width + 40);
  const x = (m.w - w) / 2, y = m.oy + m.T * (FRONT_WALL_ROW - 0.15) - 2;
  ctx.fillStyle = msg ? "rgba(185,60,41,0.94)" : "rgba(43,38,34,0.86)";
  roundRect(ctx, x, y, w, 30, 15); ctx.fill();
  if (!msg) dot(ctx, x + 16, y + 15, 5, C.gold);
  label(ctx, text, x + (msg ? w / 2 : 28), y + 20.5, { align: msg ? "center" : "left", size: 15, weight: 800, colour: C.paper, maxW: w - 36 });
}

function drawToasts(ctx: CanvasRenderingContext2D, s: HandsOnSession, m: ViewMetrics, P: PFn, now: number, sous?: SousPose) {
  for (const t of s.toasts) {
    const age = (now - t.born) / 1.6;
    // Round 7: a toast born on someone (the sous chef at the pass, or her) rises beside them, not through their heads.
    const onHead = [s.player, ...(sous ? [sous] : [])].some((q) => Math.abs(q.x - t.x) < 1.6 && t.y - q.y < 1.8 && t.y - q.y > -0.6) && t.text.length > 12;
    const p = P(t.x + (onHead ? 3.2 : 0), t.y);
    ctx.globalAlpha = 1 - age * age;
    const col = t.tone === "good" ? C.basilDeep : t.tone === "bad" ? C.tomatoDeep : t.tone === "money" ? C.amberDeep : C.inkSoft;
    label(ctx, t.text, p.x, p.y - age * m.T * 0.9, { align: "center", size: 16, weight: 900, colour: col, stroke: C.paper });
  }
  ctx.globalAlpha = 1;
}

/** The timing widget for the verb in progress: a card above the player, big enough to read at a glance. */
function drawActionWidget(ctx: CanvasRenderingContext2D, s: HandsOnSession, a: ActiveAction, m: ViewMetrics, P: PFn, keyName = "E") {
  const p = P(s.player.x, s.player.y);
  const timed = a.verb === "chop" || a.verb === "cook" || a.verb === "pour" || a.verb === "clear";
  if (!timed) {
    // short fixed verbs: a progress ring round the player
    const t = Math.min(1, a.t / a.dur);
    ctx.strokeStyle = "rgba(43,38,34,0.25)"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(p.x, p.y, m.T * 0.62, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = C.basil; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(p.x, p.y, m.T * 0.62, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2); ctx.stroke(); ctx.lineCap = "butt";
    const word = VERB_WORD[a.verb] ?? a.verb;
    label(ctx, word, p.x, p.y - m.T * 0.85, { align: "center", size: 13, weight: 900, colour: C.ink, stroke: C.paper });
    return;
  }
  const W = 250, H = a.verb === "pour" ? 96 : 74;
  const x = clamp(p.x - W / 2, 6, m.w - W - 6);
  const y = clamp(p.y - m.T * 1.2 - H, m.header + 4, m.h - H - 6);
  ctx.fillStyle = "rgba(255,253,248,0.97)"; ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
  ctx.shadowColor = "rgba(0,0,0,0.18)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
  roundRect(ctx, x, y, W, H, 12); ctx.fill();
  ctx.shadowColor = "transparent"; ctx.stroke();
  const bx = x + 16, bw = W - 32, by = y + 32, bh = 20;
  if (a.verb === "chop") {
    label(ctx, `CHOP — tap ${keyName} on each mark`, x + W / 2, y + 21, { align: "center", size: 13, weight: 900, colour: C.ink });
    ctx.fillStyle = "#d9b27c"; roundRect(ctx, bx, by, bw, bh, 6); ctx.fill();
    (a.marks ?? []).forEach((mk, i) => {
      const res = a.marked?.[i] ?? 0;
      const mx = bx + mk * bw;
      ctx.fillStyle = res > 0 ? "rgba(60,122,55,0.35)" : res < 0 ? "rgba(217,71,47,0.3)" : "rgba(255,253,248,0.55)";
      ctx.fillRect(mx - TUNING.chopWindow * bw, by, TUNING.chopWindow * bw * 2, bh);
      ctx.fillStyle = res > 0 ? C.basilDeep : res < 0 ? C.red : C.ink;
      ctx.fillRect(mx - 1.5, by - 4, 3, bh + 8);
    });
    const cx = bx + Math.min(1, a.t / a.dur) * bw;
    knife(ctx, cx, by + bh / 2);
    const hits = (a.marked ?? []).filter((v) => v > 0).length;
    label(ctx, `${hits}/${a.marks?.length ?? 0}`, x + W - 14, y + H - 9, { align: "right", size: 13, weight: 800, colour: C.inkSoft });
  } else if (a.verb === "cook") {
    const needle = Math.min(1, a.t / a.dur);
    const [lo, hi] = a.band ?? [0.6, 0.75];
    label(ctx, "COOK — let go in the green", x + W / 2, y + 21, { align: "center", size: 13, weight: 900, colour: C.ink });
    const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    g.addColorStop(0, "#f3e3b8"); g.addColorStop(lo, C.amber); g.addColorStop(1, "#5a3a24");
    ctx.fillStyle = g; roundRect(ctx, bx, by, bw, bh, 6); ctx.fill();
    ctx.fillStyle = C.basil; ctx.fillRect(bx + lo * bw, by - 2, (hi - lo) * bw, bh + 4);
    ctx.strokeStyle = C.basilDeep; ctx.lineWidth = 2; ctx.strokeRect(bx + lo * bw, by - 2, (hi - lo) * bw, bh + 4);
    const nx = bx + needle * bw;
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.moveTo(nx, by + bh + 2); ctx.lineTo(nx - 6, by + bh + 10); ctx.lineTo(nx + 6, by + bh + 10); ctx.closePath(); ctx.fill();
    ctx.fillRect(nx - 1.5, by - 5, 3, bh + 8);
    label(ctx, "raw", bx, y + H - 4, { size: 13, weight: 800, colour: C.inkSoft });
    label(ctx, "burnt", bx + bw, y + H - 4, { align: "right", size: 13, weight: 800, colour: C.inkSoft });
  } else if (a.verb === "pour") {
    const level = Math.min(1, a.t / a.dur);
    const line = a.line ?? 0.78;
    label(ctx, "POUR — let go on the line", x + W / 2, y + 21, { align: "center", size: 13, weight: 900, colour: C.ink });
    const gx = x + W / 2 - 22, gy = y + 30, gw = 44, gh = H - 40;
    ctx.fillStyle = "rgba(207,230,239,0.6)"; ctx.strokeStyle = C.inkSoft; ctx.lineWidth = 2;
    roundRect(ctx, gx, gy, gw, gh, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = drinkColour(a.dishId ?? "");
    ctx.fillRect(gx + 2, gy + gh - 2 - level * (gh - 4), gw - 4, level * (gh - 4));
    const ly = gy + gh - 2 - line * (gh - 4);
    ctx.setLineDash([4, 3]); ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(gx - 10, ly); ctx.lineTo(gx + gw + 10, ly); ctx.stroke(); ctx.setLineDash([]);
    label(ctx, "line", gx + gw + 14, ly + 4, { size: 13, weight: 800, colour: C.inkSoft });
  } else if (a.verb === "clear") {
    label(ctx, `CLEAR — tap ${keyName} to stack`, x + W / 2, y + 21, { align: "center", size: 13, weight: 900, colour: C.ink });
    const need = a.need ?? 3;
    for (let i = 0; i < need; i++) {
      const done = (a.taps ?? 0) > i;
      plate(ctx, x + W / 2 + (i - (need - 1) / 2) * 40, by + bh / 2, 13, !done);
      if (done) { ctx.strokeStyle = C.basil; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x + W / 2 + (i - (need - 1) / 2) * 40, by + bh / 2, 15, 0, Math.PI * 2); ctx.stroke(); }
    }
  }
}

const VERB_WORD: Record<string, string> = { grab: "Grabbing…", plate: "Plating…", pickup: "Picking up…", serve: "Serving…", dropoff: "Dropping off…", payment: "Taking payment…" };

// ───────────────────────── header: ticket rail, timer, score ─────────────────────────

function drawHeader(ctx: CanvasRenderingContext2D, s: HandsOnSession, state: GameState, m: ViewMetrics, now: number, crew?: CrewView) {
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, m.w, m.header);
  ctx.fillStyle = "rgba(43,38,34,0.12)"; ctx.fillRect(0, m.header - 2, m.w, 2);
  // rail
  const hudW = RAIL.hudW;
  const railX = RAIL.x, railW = m.w - hudW - 20;
  ctx.strokeStyle = C.inkSoft; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(railX, 8); ctx.lineTo(railX + railW, 8); ctx.stroke();
  // Round 4: a career chef with a station sees only their own rail, behind a station tag.
  const station = s.role === "chef" ? s.opts.station : undefined;
  const mine = station ? new Set(stationTickets(s, state).map((t) => t.id)) : undefined;
  const relevant = (t: KitchenTicket) => {
    if (mine) return mine.has(t.id);
    const drink = profile(s, t.dishId).method === "pour";
    return s.role === "chef" ? !drink : s.role === "bar" ? true : true;
  };
  const tagW = station ? RAIL.tagW : 0;
  if (station) {
    const tx = railX, ty = 10, th = m.header - 20;
    ctx.fillStyle = C.tomato; roundRect(ctx, tx, ty, tagW - 8, th, 9); ctx.fill();
    label(ctx, station.title.toUpperCase(), tx + 8, ty + 17, { size: 13, weight: 900, colour: C.paper, spacing: 0.5, maxW: tagW - 18 });
    wrap(ctx, station.label, tx + 8, ty + 35, tagW - 22, 16, { size: 14, weight: 800, colour: C.paper });
  }
  // Round 6: with a station, slips come from the crew view: hers first (tomato band), then the sous chef's about-to-go
  // (amber, his name) and her station's dishes another cook has (sky, "HELPER") — one slip per party and owner.
  const groups = new Map<string, KitchenTicket[]>();
  const owners = new Map<string, RailEntry[]>();
  if (crew) {
    for (const e of crew.rail) {
      if (s.served[e.ticket.id]) continue;
      const key = `${e.ticket.customerId}|${e.owner === "helper" ? "h" : "m"}`;
      groups.set(key, [...(groups.get(key) ?? []), e.ticket]);
      owners.set(key, [...(owners.get(key) ?? []), e]);
    }
  } else {
    for (const t of [...state.tickets].sort((a, b) => a.createdTick - b.createdTick || (a.id < b.id ? -1 : 1))) {
      if (!relevant(t) || s.served[t.id]) continue;
      const g = groups.get(t.customerId) ?? [];
      g.push(t);
      groups.set(t.customerId, g);
    }
  }
  const slipW = RAIL.slipW, gap = RAIL.gap;
  const max = Math.max(1, Math.floor((railW - tagW + gap) / (slipW + gap)));
  const list = [...groups.entries()];
  list.slice(0, max).forEach(([key, tks], i) => {
    const cid = tks[0]?.customerId ?? key;
    const es = owners.get(key);
    const x = railX + tagW + i * (slipW + gap);
    const ageSecs = s.time - Math.min(...tks.map((t) => s.seenAt[`t:${t.id}`] ?? s.time));
    const ageTicks = state.tick - (tks[0]?.createdTick ?? state.tick);
    const age = Math.max(ageSecs / 1.5, ageTicks);
    const head = age < 14 ? C.basil : age < 30 ? C.amber : C.red;
    const sway = Math.sin(now * 1.6 + i) * 0.012;
    ctx.save();
    ctx.translate(x + slipW / 2, 8); ctx.rotate(sway);
    const h = 20 + Math.min(3, tks.length) * 15 + 8;
    ctx.fillStyle = C.paper; ctx.strokeStyle = C.inkSoft; ctx.lineWidth = 1;
    ctx.shadowColor = "rgba(0,0,0,0.12)"; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
    ctx.fillRect(-slipW / 2, 0, slipW, h);
    ctx.shadowColor = "transparent"; ctx.strokeRect(-slipW / 2, 0, slipW, h);
    ctx.fillStyle = head; ctx.fillRect(-slipW / 2, 0, slipW, 4);
    const own = es ? slipOwner(es) : undefined;
    if (own) { ctx.fillStyle = OWNER_COLOUR[own]; ctx.fillRect(-slipW / 2, 0, 5, h); } // whose slip: the band down the left
    const tx0 = -slipW / 2 + (own ? 9 : 6);
    const tn = tableNo(s, state, cid);
    label(ctx, tn ? `TABLE ${tn}` : "—", tx0, 19, { size: 13, weight: 900, colour: C.ink, spacing: 0.5 });
    if (es && own === "helper") pill(ctx, es[0]!.cook?.endsWith(HELPER_SUFFIX) ? "HELPER" : cookName(state, es[0]!.cook).toUpperCase(), slipW / 2 - 4, 12, OWNER_COLOUR.helper);
    else if (es && own === "sous") pill(ctx, crew!.sousName.toUpperCase(), slipW / 2 - 4, 12, C.amberDeep);
    else if (es?.some((e) => e.course)) cloche(ctx, slipW / 2 - 12, 15, 7, C.tomato);
    tks.slice(0, 3).forEach((t, j) => {
      const yy = 34 + j * 15;
      const st = ticketStatus(s, t);
      const col = st === "ready" ? C.basil : st === "mine" ? C.amber : st === "ai" ? C.steelDark : C.inkFaint;
      if (st === "open") { ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(tx0 + 4, yy - 4.5, 4, 0, Math.PI * 2); ctx.stroke(); }
      else dot(ctx, tx0 + 4, yy - 4.5, 4.4, col);
      label(ctx, profile(s, t.dishId).short, tx0 + 14, yy, { size: 14, weight: 800, colour: st === "ready" ? C.basilDeep : C.ink, maxW: slipW - 20 - (tx0 + slipW / 2) });
    });
    if (tks.length > 3 && (!own || own === "hers")) label(ctx, `+${tks.length - 3}`, slipW / 2 - 5, 19, { align: "right", size: 13, weight: 900, colour: C.tomatoDeep });
    // Round 7: a draining bar along the bottom — how long the slip can still wait, without reading a number.
    const left = slipTimeLeft(age);
    ctx.fillStyle = "rgba(43,38,34,0.1)"; ctx.fillRect(-slipW / 2 + 1, h - 6, slipW - 2, 5);
    ctx.fillStyle = head; ctx.fillRect(-slipW / 2 + 1, h - 6, (slipW - 2) * left, 5);
    ctx.restore();
    dot(ctx, x + slipW / 2, 8, 2.5, C.tomato);
  });
  if (list.length > max) label(ctx, `+${list.length - max} more`, railX + railW, 68, { align: "right", size: 13, weight: 900, colour: C.tomatoDeep });
  if (!list.length) label(ctx, station ? "Your station is clear — next ticket coming…" : "No tickets on the rail", railX + tagW + 4, 40, { size: 14, weight: 800, colour: C.inkSoft });

  // HUD
  const hx = m.w - hudW - 6;
  ctx.fillStyle = C.ink; roundRect(ctx, hx, 6, hudW, m.header - 14, 12); ctx.fill();
  const roleName = s.role === "chef" ? "CHEF" : s.role === "server" ? "SERVER" : "BAR";
  ctx.fillStyle = s.role === "chef" ? C.tomato : s.role === "server" ? C.basil : C.plum;
  roundRect(ctx, hx + 8, 14, 72, 22, 11); ctx.fill();
  label(ctx, roleName, hx + 44, 30, { align: "center", size: 13, weight: 900, colour: C.paper, spacing: 1 });
  label(ctx, `${s.score.points}`, hx + 40, 58, { align: "center", size: 20, weight: 900, colour: C.gold });
  label(ctx, "pts", hx + 64, 58, { size: 13, weight: 800, colour: C.straw });
  const plates = s.role === "chef" ? s.score.plates : s.score.served;
  label(ctx, `${plates}`, hx + 116, 38, { align: "center", size: 20, weight: 900, colour: C.paper });
  label(ctx, s.role === "chef" ? "plates" : "served", hx + 116, 57, { align: "center", size: 13, weight: 800, colour: C.straw });
  if (s.shift) {
    const left = Math.max(0, s.shift.duration - s.time);
    const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
    const low = left < 20;
    label(ctx, `${mm}:${String(ss).padStart(2, "0")}`, hx + hudW - 12, 40, { align: "right", size: 26, weight: 900, colour: low && Math.floor(now * 2) % 2 ? C.red : C.paper });
    label(ctx, "left in shift", hx + hudW - 12, 58, { align: "right", size: 13, weight: 800, colour: C.straw });
  } else {
    label(ctx, clockOf(state.tick), hx + hudW - 12, 45, { align: "right", size: 22, weight: 900, colour: C.paper });
  }
}

/** Round 7: share of a slip's wait left, from its age in ticks (green under 14, amber to 30, red after: the head colours). */
export const slipTimeLeft = (ageTicks: number): number => clamp(1 - ageTicks / 30, 0, 1);

/** Round 6: whose slip it is — the band down its left and the pill. A slip with any of hers is hers unless all are going. */
const OWNER_COLOUR: Record<RailEntry["owner"], string> = { hers: C.tomato, sous: C.amber, helper: C.sky };
function slipOwner(es: readonly RailEntry[]): RailEntry["owner"] {
  if (es.some((e) => e.owner === "hers")) return "hers";
  return es.some((e) => e.owner === "sous") ? "sous" : "helper";
}

function cookName(state: GameState, cook: string | undefined): string {
  const st = cook ? state.staff.find((x) => x.id === cook) : undefined;
  return st ? st.name.split(" ")[0]! : "Chef";
}

/** A small right-aligned pill (13 px caps) ending at x, centred on y. */
function pill(ctx: CanvasRenderingContext2D, text: string, right: number, y: number, bg: string) {
  ctx.font = `900 13px ${FONT}`;
  const w = Math.min(64, ctx.measureText(text).width + 10);
  ctx.fillStyle = bg; roundRect(ctx, right - w, y - 8, w, 16, 8); ctx.fill();
  label(ctx, text, right - w / 2, y + 4.5, { align: "center", size: 13, weight: 900, colour: C.paper, maxW: w - 6 });
}

/** A serving cloche (dome, knob, base) centred on (x, y) with radius r. */
function cloche(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, accent: string) {
  ctx.fillStyle = "#dfe4e6"; ctx.strokeStyle = C.inkSoft; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.arc(x, y + r * 0.35, r, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.05, r * 0.22, 0, Math.PI * 2); ctx.fill();
  dot(ctx, x, y + r * 0.35 - r - r * 0.12, Math.max(1.6, r * 0.2), accent);
  ctx.fillStyle = C.inkSoft; ctx.fillRect(x - r * 1.2, y + r * 0.35, r * 2.4, Math.max(1.5, r * 0.18));
}

/**
 * Round 6: "dessert coming" on a table eating its mains while its own course cooks. A cloche on a paper disc with a ring
 * that fills through the mains (it is due as they finish); tomato when it's on her rail, sky when a helper has it.
 */
function drawCourseMarker(ctx: CanvasRenderingContext2D, s: HandsOnSession, k: CourseMarker, x: number, y: number, now: number) {
  const col = k.owner === "hers" ? C.tomato : C.sky;
  const held = s.carrying && "ticketId" in s.carrying && k.ticketIds.includes(s.carrying.ticketId);
  const R = 13 + (held ? Math.sin(now * 6) * 1.2 : 0);
  dot(ctx, x, y, R + 2, "rgba(255,253,248,0.96)");
  ctx.strokeStyle = "rgba(43,38,34,0.18)"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke();
  if (k.progress > 0) {
    ctx.strokeStyle = col; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k.progress); ctx.stroke(); ctx.lineCap = "butt";
  }
  cloche(ctx, x, y - 1, 7.5, col);
}

/** Round 6: the sous chef (charcoal jacket, at his post or acting out a cover) and the commis's AI hands at her station. */
function drawCrew(ctx: CanvasRenderingContext2D, s: HandsOnSession, state: GameState, crew: CrewView, m: ViewMetrics, P: PFn, now: number) {
  const { T } = m;
  if (crew.helper) {
    const st = s.stations.find((x) => x.id === crew.helper!.stationId);
    if (st) {
      const at = avoidPlayer({ x: st.x + st.w / 2, y: st.y + st.h + 0.3 }, s.player, 0.95); // make room for her
      const q = P(at.x, at.y);
      const bob = Math.sin(now * 7) * 1;
      character(ctx, q.x, q.y + bob, T, "chef", "up", 0.82, false, "#cfe2ef");
      // the "helping" badge: subtle, under the sprite
      ctx.font = `800 13px ${FONT}`;
      const w = ctx.measureText("helping").width + 10;
      ctx.fillStyle = "rgba(79,143,184,0.92)";
      roundRect(ctx, q.x - w / 2, q.y + T * 0.5, w, 16, 8); ctx.fill();
      label(ctx, "helping", q.x, q.y + T * 0.5 + 12.5, { align: "center", size: 13, weight: 800, colour: C.paper });
    }
  }
  const sp = crew.sous;
  const at = avoidPlayer(sp, s.player);
  const q = P(at.x, at.y);
  const bob = sp.moving ? Math.sin(now * 14) * 1.5 : Math.sin(now * 3) * 0.8;
  character(ctx, q.x, q.y + bob, T, "chef", sp.facing, 0.92, false, "#3b4650");
  nameTag(ctx, crew.sousName, q.x, q.y + T * 0.55);
  if (sp.carrying) {
    // the plate (and its slip) held up, like the player's carried items
    const ix = q.x + (sp.facing === "left" ? -1 : sp.facing === "right" ? 1 : 0) * T * 0.4, iy = q.y + bob - T * 0.9;
    ctx.fillStyle = "rgba(255,253,248,0.92)"; ctx.strokeStyle = C.inkFaint; ctx.lineWidth = 1;
    roundRect(ctx, ix - T * 0.4, iy - T * 0.28, T * 0.8, T * 0.52, 8); ctx.fill(); ctx.stroke();
    plate(ctx, ix - T * 0.06, iy, T * 0.19, true);
    ctx.fillStyle = C.paper; ctx.strokeStyle = C.inkSoft; ctx.fillRect(ix + T * 0.12, iy - T * 0.2, T * 0.2, T * 0.26); ctx.strokeRect(ix + T * 0.12, iy - T * 0.2, T * 0.2, T * 0.26);
    ctx.fillStyle = C.tomato; ctx.fillRect(ix + T * 0.12, iy - T * 0.2, T * 0.2, 3);
  }
  // the plate he set down stays on the pass a moment
  if ((sp.phase === "set" && sp.t >= 0.5) || (sp.phase === "back" && sp.t < 0.35)) {
    const pp = P(sp.phase === "set" ? sp.x : 9.5, 5.5);
    plate(ctx, pp.x, pp.y, T * 0.2, true);
  }
}

/** Round 6: the sous chef's speech bubble ("I've got table 3's Chips!"), drawn over the toasts. */
function drawSousBubble(ctx: CanvasRenderingContext2D, s: HandsOnSession, crew: CrewView, m: ViewMetrics, P: PFn) {
  const sp = crew.sous;
  if (!sp.talking || !sp.walk) return;
  const text = sousLine(sp.walk.items, (d) => profile(s, d).short);
  const at = avoidPlayer(sp, s.player);
  const q = P(at.x, at.y);
  ctx.font = `800 14px ${FONT}`;
  const w = Math.min(m.w - 16, ctx.measureText(text).width + 20), h = 26;
  const x = clamp(q.x - w / 2, 8, m.w - w - 8);
  const y = Math.max(m.header + 4, q.y - m.T * (sp.carrying ? 1.75 : 1.35) - h);
  ctx.fillStyle = C.paper; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 12); ctx.fill(); ctx.stroke();
  const tx = clamp(q.x, x + 14, x + w - 14);
  ctx.beginPath(); ctx.moveTo(tx - 6, y + h - 1); ctx.lineTo(tx, y + h + 8); ctx.lineTo(tx + 6, y + h - 1); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(tx - 6, y + h); ctx.lineTo(tx, y + h + 8); ctx.lineTo(tx + 6, y + h); ctx.stroke();
  label(ctx, text, x + w / 2, y + 18, { align: "center", size: 14, weight: 800, colour: C.ink, maxW: w - 14 });
}

/** Round 6: while the sous chef takes it, the slip drops from its place on the header rail into his hand. */
function drawFlyingSlip(ctx: CanvasRenderingContext2D, crew: CrewView, m: ViewMetrics, P: PFn) {
  const sp = crew.sous;
  if (sp.phase !== "take" || !sp.walk || sp.t >= 0.5) return;
  const k = sp.t / 0.5;
  const e = k * k * (3 - 2 * k);
  const from = { x: crew.slotPx(sp.walk.slot), y: 30 };
  const q = P(sp.x, sp.y);
  const to = { x: q.x, y: q.y - m.T * 0.9 };
  const x = lerp(from.x, to.x, e), y = lerp(from.y, to.y, e);
  ctx.save();
  ctx.translate(x, y); ctx.rotate((1 - e) * 0.25);
  ctx.fillStyle = C.paper; ctx.strokeStyle = C.inkSoft; ctx.lineWidth = 1;
  ctx.shadowColor = "rgba(0,0,0,0.2)"; ctx.shadowBlur = 4;
  ctx.fillRect(-14, -10, 28, 20); ctx.shadowColor = "transparent"; ctx.strokeRect(-14, -10, 28, 20);
  ctx.fillStyle = C.amber; ctx.fillRect(-14, -10, 4, 20);
  ctx.fillStyle = C.inkFaint; ctx.fillRect(-6, -4, 16, 2); ctx.fillRect(-6, 1, 12, 2);
  ctx.restore();
}

function ticketStatus(s: HandsOnSession, t: KitchenTicket): "ready" | "mine" | "ai" | "open" {
  if (isReady(s, t) || s.picked[t.id]) return "ready";
  if (s.claimed[t.id]) return "mine";
  if (t.chefId && t.chefId !== s.opts.playerStaffId) return "ai";
  return "open";
}

function clockOf(tick: number) {
  const mins = 12 * 60 + tick * 5;
  return `${Math.floor(mins / 60) % 24}:${String(mins % 60).padStart(2, "0")}`;
}

// ───────────────────────── score screen ─────────────────────────

function drawScoreScreen(ctx: CanvasRenderingContext2D, s: HandsOnSession, m: ViewMetrics, cont: string) {
  const sum = summarise(s);
  ctx.fillStyle = "rgba(43,38,34,0.55)"; ctx.fillRect(0, 0, m.w, m.h);
  const W = Math.min(520, m.w - 32), H = Math.min(420, m.h - 32);
  const x = (m.w - W) / 2, y = (m.h - H) / 2;
  ctx.fillStyle = C.paper; ctx.strokeStyle = C.ink; ctx.lineWidth = 3;
  roundRect(ctx, x, y, W, H, 18); ctx.fill(); ctx.stroke();
  ctx.fillStyle = s.role === "chef" ? C.tomato : s.role === "server" ? C.basil : C.plum;
  roundRect(ctx, x, y, W, 54, 18); ctx.fill(); ctx.fillRect(x, y + 36, W, 18);
  label(ctx, "Shift over!", x + W / 2, y + 36, { align: "center", size: 24, weight: 900, colour: C.paper });
  // stars
  for (let i = 0; i < 3; i++) star(ctx, x + W / 2 + (i - 1) * 50, y + 92, 20, i < sum.stars);
  label(ctx, `${sum.points} points`, x + W / 2, y + 140, { align: "center", size: 22, weight: 900, colour: C.ink });
  // Round 4: three big one-line notes ("Fast on the pass!", "Two plates went cold") instead of a stats table.
  const notes = sum.notes ?? [];
  notes.forEach((nt, i) => {
    const ry = y + 180 + i * 34;
    dot(ctx, x + 66, ry - 6, 9, nt.tone === "good" ? C.basil : C.amber);
    label(ctx, nt.tone === "good" ? "✓" : "!", x + 66, ry - 1.5, { align: "center", size: 13, weight: 900, colour: C.paper });
    label(ctx, nt.text, x + 86, ry, { size: 18, weight: 900, colour: C.ink, maxW: W - 130 });
  });
  const ty = y + 180 + notes.length * 34 - 4;
  ctx.fillStyle = "#fbefd2"; roundRect(ctx, x + 28, ty, W - 56, 58, 10); ctx.fill();
  label(ctx, "COACH'S TIP", x + 42, ty + 17, { size: 13, weight: 900, colour: C.amberDeep, spacing: 1.5 });
  wrap(ctx, sum.tip, x + 42, ty + 35, W - 84, 16, { size: 13, weight: 700, colour: C.ink });
  label(ctx, cont, x + W / 2, y + H - 16, { align: "center", size: 13, weight: 800, colour: C.inkSoft });
}

// ───────────────────────── small helpers ─────────────────────────

function tableNo(s: HandsOnSession, state: GameState, customerId: string): number | undefined {
  const c: Customer | undefined = state.customers.find((x) => x.id === customerId);
  return c?.tableId ? s.tableNumbers[c.tableId] : undefined;
}

function drinkColour(dishId: string): string {
  if (/wine|red/.test(dishId)) return "#8e2b3a";
  if (/lager|ale|beer/.test(dishId)) return "#e8b23a";
  if (/prosecco|gin|tonic|lemonade/.test(dishId)) return "#f3e7a6";
  if (/cola|soft/.test(dishId)) return "#5a3320";
  if (/juice/.test(dishId)) return "#f2a03a";
  if (/milkshake|white|chocolate/.test(dishId)) return "#d8b892";
  return "#f3e7a6";
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(lerp((pa >> 16) & 255, (pb >> 16) & 255, t));
  const g = Math.round(lerp((pa >> 8) & 255, (pb >> 8) & 255, t));
  const bl = Math.round(lerp(pa & 255, pb & 255, t));
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}
export function patienceColour(p: number): string {
  const t = clamp(p / 100, 0, 1);
  if (t > 0.5) return mix(C.amber, C.basil, (t - 0.5) * 2);
  return mix(C.red, C.amber, t * 2);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2); ctx.fill();
}

interface LabelOpts { align?: CanvasTextAlign; size?: number; weight?: number; colour?: string; spacing?: number; stroke?: string; maxW?: number }
/** Round 5 (game UI-NOTES "Type scale"): no canvas text below 13 CSS px; the canvas draws in CSS pixels. */
export const MIN_TEXT_PX = 13;

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, o: LabelOpts = {}) {
  ctx.font = `${o.weight ?? 700} ${Math.max(MIN_TEXT_PX, o.size ?? 13)}px ${FONT}`;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  const ls = "letterSpacing" in ctx;
  if (ls) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${o.spacing ?? 0}px`;
  if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = 3.5; ctx.lineJoin = "round"; ctx.strokeText(text, x, y, o.maxW); }
  ctx.fillStyle = o.colour ?? C.ink;
  ctx.fillText(text, x, y, o.maxW);
  if (ls) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, o: LabelOpts) {
  ctx.font = `${o.weight ?? 700} ${Math.max(MIN_TEXT_PX, o.size ?? 13)}px ${FONT}`;
  const words = text.split(" ");
  let line = "";
  let yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { label(ctx, line, x, yy, o); line = w; yy += lh; }
    else line = test;
  }
  if (line) label(ctx, line, x, yy, o);
}

function tag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, bg: string) {
  ctx.font = `900 13px ${FONT}`;
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = bg; roundRect(ctx, x - w / 2, y - 9, w, 18, 9); ctx.fill();
  label(ctx, text, x, y + 4.5, { align: "center", size: 13, weight: 900, colour: C.paper });
}

function plate(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, food: boolean, glassColour?: string) {
  if (glassColour) { glass(ctx, x, y, r, glassColour, 0.8); return; }
  ctx.fillStyle = C.paper; ctx.strokeStyle = "#cbbfa9"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (food) { dot(ctx, x - r * 0.2, y, r * 0.42, C.amber); dot(ctx, x + r * 0.3, y - r * 0.15, r * 0.25, C.basil); dot(ctx, x + r * 0.15, y + r * 0.3, r * 0.22, C.tomato); }
}

function glass(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string, fill: number) {
  ctx.fillStyle = "rgba(207,230,239,0.8)"; ctx.strokeStyle = C.inkSoft; ctx.lineWidth = 1;
  roundRect(ctx, x - r * 0.7, y - r, r * 1.4, r * 2, 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = colour; ctx.fillRect(x - r * 0.6, y + r - fill * r * 1.9, r * 1.2, fill * r * 1.85);
}

function knife(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = "#dfe4e6"; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x - 4, y - 16); ctx.lineTo(x + 4, y - 16); ctx.lineTo(x + 2, y + 6); ctx.lineTo(x - 2, y + 2); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = C.ink; ctx.fillRect(x - 3, y - 26, 6, 10);
}

function steam(ctx: CanvasRenderingContext2D, x: number, y: number, now: number) {
  ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    const t = (now * 0.9 + i / 3) % 1;
    ctx.globalAlpha = 1 - t;
    ctx.beginPath(); ctx.arc(x - 8 + i * 8 + Math.sin(now * 4 + i) * 2, y - t * 16, 3 + t * 3, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, on: boolean) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = on ? C.gold : "#e7dccb"; ctx.fill();
  ctx.strokeStyle = on ? C.amberDeep : C.inkFaint; ctx.lineWidth = 2; ctx.stroke();
}

function plant(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  dot(ctx, x, y, r * 0.75, "#b5703d");
  ctx.fillStyle = C.basil;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, r * 0.28, a, 0, Math.PI * 2); ctx.fill();
  }
  dot(ctx, x, y, r * 0.3, C.basilDeep);
}

// little customers, in the spirit of RestaurantView's segment looks
const LOOKS: Record<string, { body: string; hat: "beanie" | "none" | "parting" | "beret" | "sunhat"; hatColour: string }> = {
  student: { body: C.sky, hat: "beanie", hatColour: C.tomato },
  famil: { body: C.amber, hat: "none", hatColour: C.tomato },
  business: { body: "#4a4540", hat: "parting", hatColour: "#3a2a1e" },
  foodie: { body: C.plum, hat: "beret", hatColour: "#2b2622" },
  tourist: { body: C.basil, hat: "sunhat", hatColour: C.straw },
};
const SKIN = ["#f1c9a5", "#d9a77c", "#a8714a", "#7a4b2e", "#f5d6bd", "#c48a5f"];
function hashStr(s: string) { let h = 0; for (const ch of s) h = (h * 33 + ch.charCodeAt(0)) | 0; return Math.abs(h); }

function person_(ctx: CanvasRenderingContext2D, x: number, y: number, r0: number, seg: SegmentId, key: string, kid: boolean) {
  const k = seg.toLowerCase();
  const look = Object.entries(LOOKS).find(([n]) => k.includes(n))?.[1] ?? { body: C.sky, hat: "none" as const, hatColour: C.ink };
  const r = r0 * (kid ? 0.75 : 1);
  ctx.fillStyle = look.body; ctx.strokeStyle = C.ink; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.25, r * 1.05, r * 0.8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = SKIN[hashStr(key) % SKIN.length]!;
  ctx.beginPath(); ctx.arc(x, y - r * 0.2, r * 0.62, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  const hy = y - r * 0.2, hr = r * 0.62;
  ctx.fillStyle = look.hatColour;
  if (kid) return;
  if (look.hat === "beanie") { ctx.beginPath(); ctx.arc(x, hy, hr, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); dot(ctx, x, hy - hr, hr * 0.3, C.paper); }
  else if (look.hat === "parting") { ctx.beginPath(); ctx.arc(x, hy, hr, Math.PI * 1.05, Math.PI * 1.95); ctx.closePath(); ctx.fill(); }
  else if (look.hat === "beret") { ctx.beginPath(); ctx.ellipse(x - hr * 0.15, hy - hr * 0.45, hr * 1.05, hr * 0.5, -0.25, 0, Math.PI * 2); ctx.fill(); }
  else if (look.hat === "sunhat") { ctx.beginPath(); ctx.ellipse(x, hy - hr * 0.1, hr * 1.5, hr * 1.05, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); dot(ctx, x, hy - hr * 0.1, hr * 0.7, C.tomato); dot(ctx, x, hy - hr * 0.1, hr * 0.56, look.hatColour); }
  else if (/famil/.test(k)) { dot(ctx, x - hr * 0.6, hy - hr * 0.8, hr * 0.3, C.tomato); dot(ctx, x + hr * 0.6, hy - hr * 0.8, hr * 0.3, C.tomato); }
}
