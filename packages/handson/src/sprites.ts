/**
 * Round 8: one character sprite for both canvases (the hands-on kitchen and the owner's floor), so a cook, a waiter and
 * a guest look like the same game everywhere. Clean top-down with a 3/4 tilt: light from the top-left, a soft drop
 * shadow to the bottom-right, one warm outline weight. Vector-drawn, no images; an artist can replace `drawPerson`
 * with a sprite sheet keyed by (look, facing, walk frame) without touching the callers.
 *
 * Pure drawing: no state, no clock. Callers pass the walk phase (from session time or performance.now) and `walk = 0`
 * when still or under reduced motion.
 */

export type Facing = "up" | "down" | "left" | "right";

/** Facing from a movement vector; a vector shorter than `dead` keeps `fallback` (standing still keeps its facing). */
export function facingFrom(dx: number, dy: number, fallback: Facing, dead = 1e-3): Facing {
  if (Math.hypot(dx, dy) < dead) return fallback;
  return Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
}

export type Headwear = "toque" | "cap" | "beanie" | "beret" | "sunhat" | "bows" | "none";

export interface Look {
  /** Top / jacket. */
  body: string;
  skin: string;
  hair: string;
  hat?: Headwear;
  hatColour?: string;
  /** Neckerchief (chefs), bow tie (servers), scarf (guests). */
  trim?: string;
  /** White shirt V under the jacket (servers, bar). */
  shirt?: boolean;
  /** Apron over the lower body. */
  apron?: string;
  kid?: boolean;
}

export interface Pose {
  facing: Facing;
  /** Walk cycle phase in radians; 0 and `moving: false` = standing. */
  phase?: number;
  moving?: boolean;
  /** Seated guests: no feet, slightly lower. */
  seated?: boolean;
  /** Hands forward (holding something). */
  carrying?: boolean;
  outline: string;
  shadow?: string;
}

export const SKINS = ["#f1c9a5", "#d9a77c", "#a8714a", "#7a4b2e", "#f5d6bd", "#c48a5f"] as const;
export const HAIRS = ["#3b2a1f", "#6b4426", "#a8743a", "#1f1b18", "#c9a36a", "#7a3a22", "#55524e"] as const;

export function hashKey(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0; return Math.abs(h); }

/** Vertical bob for a walk phase (px, before scale); 0 when still. */
export function walkBob(pose: Pose, r: number): number {
  return pose.moving && pose.phase !== undefined ? -Math.abs(Math.sin(pose.phase)) * r * 0.16 : 0;
}

/**
 * A person centred on (x, y) — the middle of the shoulders — with body radius `r` (≈ 0.3 of a tile). Draws shadow,
 * feet, body, hands, head, hair, face and headwear. Returns the y of the hands (for held items).
 */
export function drawPerson(ctx: CanvasRenderingContext2D, x: number, y0: number, r: number, look: Look, pose: Pose): number {
  const k = look.kid ? 0.78 : 1;
  r *= k;
  const f = pose.facing;
  const fx = f === "left" ? -1 : f === "right" ? 1 : 0;
  const fy = f === "up" ? -1 : f === "down" ? 1 : 0;
  const y = y0 + walkBob(pose, r) + (pose.seated ? r * 0.12 : 0);
  // drop shadow on the floor (doesn't bob)
  ctx.fillStyle = pose.shadow ?? "rgba(52,32,14,0.24)";
  ctx.beginPath(); ctx.ellipse(x + r * 0.18, y0 + r * 0.98, r * 1.08, r * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = Math.max(1.2, r * 0.13); ctx.strokeStyle = pose.outline; ctx.lineJoin = "round";
  // feet: two little shoes stepping when walking
  if (!pose.seated) {
    const s = pose.moving && pose.phase !== undefined ? Math.sin(pose.phase) : 0;
    ctx.fillStyle = "#3a2f28";
    for (const side of [-1, 1]) {
      const step = s * side * r * 0.28;
      const px = x + side * r * 0.42 + (fy === 0 ? fx * step : 0);
      const py = y0 + r * 0.82 + (fy !== 0 ? step : 0);
      ctx.beginPath(); ctx.ellipse(px, py, r * 0.26, r * 0.2, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  // hands at the sides (drawn behind the body), or forward when carrying
  const hand = (hx: number, hy: number) => { ctx.fillStyle = look.skin; ctx.beginPath(); ctx.arc(hx, hy, r * 0.22, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); };
  const swing = pose.moving && pose.phase !== undefined ? Math.sin(pose.phase) * r * 0.18 : 0;
  if (!pose.carrying) { hand(x - r * 0.98, y + r * 0.42 + swing); hand(x + r * 0.98, y + r * 0.42 - swing); }
  // body: shoulders + torso, shaded on the lower right
  ctx.fillStyle = look.body;
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.32, r, r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.clip();
  if (look.apron) { ctx.fillStyle = look.apron; ctx.fillRect(x - r * 0.62, y + r * 0.42, r * 1.24, r); }
  if (look.shirt && f !== "up") {
    ctx.fillStyle = "#fbf8f2";
    ctx.beginPath(); ctx.moveTo(x - r * 0.34 + fx * r * 0.2, y - r * 0.2); ctx.lineTo(x + r * 0.34 + fx * r * 0.2, y - r * 0.2); ctx.lineTo(x + fx * r * 0.2, y + r * 0.62); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = "rgba(30,15,5,0.16)";
  ctx.beginPath(); ctx.ellipse(x + r * 0.35, y + r * 0.62, r * 1.05, r * 0.62, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath(); ctx.ellipse(x - r * 0.42, y + r * 0.02, r * 0.42, r * 0.22, -0.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.32, r, r * 0.8, 0, 0, Math.PI * 2); ctx.stroke();
  // collar trim: neckerchief / bow tie
  if (look.trim && f !== "up") {
    const tx = x + fx * r * 0.22, ty = y - r * 0.08;
    ctx.fillStyle = look.trim;
    ctx.beginPath(); ctx.moveTo(tx, ty + r * 0.08); ctx.lineTo(tx - r * 0.3, ty - r * 0.1); ctx.lineTo(tx - r * 0.3, ty + r * 0.24); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(tx, ty + r * 0.08); ctx.lineTo(tx + r * 0.3, ty - r * 0.1); ctx.lineTo(tx + r * 0.3, ty + r * 0.24); ctx.closePath(); ctx.fill();
  }
  // hands forward when carrying (in front of the body)
  let handsY = y + r * 0.55;
  if (pose.carrying) {
    if (f === "up") { handsY = y - r * 0.55; hand(x - r * 0.62, handsY); hand(x + r * 0.62, handsY); }
    else if (f === "down") { handsY = y + r * 0.78; hand(x - r * 0.55, handsY); hand(x + r * 0.55, handsY); }
    else { handsY = y + r * 0.35; hand(x + fx * r * 0.95, handsY); hand(x + fx * r * 0.7, handsY + r * 0.2); }
  }
  // head
  const hx = x + fx * r * 0.12, hy = y - r * 0.44 + (f === "up" ? -r * 0.04 : 0), hr = r * 0.64;
  ctx.fillStyle = look.skin;
  ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.fill();
  // hair: the back of the head when facing away, a fringe cap otherwise, the back half in profile
  ctx.fillStyle = look.hair;
  ctx.beginPath();
  if (f === "up") ctx.arc(hx, hy, hr, 0, Math.PI * 2);
  else if (f === "down") { ctx.arc(hx, hy, hr, Math.PI * 1.02, Math.PI * 1.98); ctx.quadraticCurveTo(hx, hy - hr * 0.35, hx - hr * 0.98, hy - hr * 0.1); }
  else { const a0 = fx > 0 ? Math.PI * 0.55 : Math.PI * 1.55; ctx.arc(hx, hy, hr, a0, a0 + Math.PI * 1.15); ctx.quadraticCurveTo(hx + fx * hr * 0.1, hy - hr * 0.2, hx - fx * hr * 0.1, hy + hr * 0.95); }
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2); ctx.stroke();
  // face
  if (f !== "up") {
    ctx.fillStyle = pose.outline;
    const er = Math.max(1, r * 0.09);
    if (f === "down") { dotP(ctx, hx - hr * 0.34, hy + hr * 0.18, er); dotP(ctx, hx + hr * 0.34, hy + hr * 0.18, er); }
    else dotP(ctx, hx + fx * hr * 0.5, hy + hr * 0.12, er);
    ctx.fillStyle = "rgba(226,110,90,0.35)"; // cheeks
    if (f === "down") { dotP(ctx, hx - hr * 0.52, hy + hr * 0.46, hr * 0.17); dotP(ctx, hx + hr * 0.52, hy + hr * 0.46, hr * 0.17); }
    else dotP(ctx, hx + fx * hr * 0.4, hy + hr * 0.46, hr * 0.17);
  }
  drawHeadwear(ctx, look, hx, hy, hr, fx, pose.outline);
  return handsY;
}

function dotP(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }

function drawHeadwear(ctx: CanvasRenderingContext2D, look: Look, x: number, y: number, r: number, fx: number, outline: string) {
  const hat = look.kid ? "none" : look.hat ?? "none";
  const col = look.hatColour ?? "#fffdf8";
  ctx.fillStyle = col; ctx.strokeStyle = outline;
  switch (hat) {
    case "toque": {
      // band + three puffs, the classic chef's hat seen from above-front
      ctx.beginPath(); ctx.rect(x - r * 0.78, y - r * 0.95, r * 1.56, r * 0.5); ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.arc(x - r * 0.48, y - r * 1.2, r * 0.48, 0, Math.PI * 2);
      ctx.moveTo(x + r * 0.96, y - r * 1.2); ctx.arc(x + r * 0.48, y - r * 1.2, r * 0.48, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - r * 1.38, r * 0.55, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.07)"; ctx.fillRect(x - r * 0.76, y - r * 0.62, r * 1.52, r * 0.16);
      break;
    }
    case "cap": // a side cap / bar cap with a little peak toward the facing side
      ctx.beginPath(); ctx.arc(x, y - r * 0.12, r * 0.98, Math.PI * 1.08, Math.PI * 1.92); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(x + fx * r * 0.55, y - r * 0.38, r * 0.55, r * 0.18, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    case "beanie":
      ctx.beginPath(); ctx.arc(x, y - r * 0.05, r * 1.02, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fffdf8"; ctx.beginPath(); ctx.arc(x, y - r * 1.02, r * 0.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    case "beret":
      ctx.beginPath(); ctx.ellipse(x - r * 0.12, y - r * 0.5, r * 1.05, r * 0.5, -0.25, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    case "sunhat":
      ctx.beginPath(); ctx.ellipse(x, y - r * 0.15, r * 1.5, r * 1.05, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.beginPath(); ctx.arc(x, y - r * 0.2, r * 0.72, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y - r * 0.25, r * 0.62, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    case "bows":
      ctx.beginPath(); ctx.arc(x - r * 0.62, y - r * 0.78, r * 0.26, 0, Math.PI * 2); ctx.arc(x + r * 0.62, y - r * 0.78, r * 0.26, 0, Math.PI * 2); ctx.fill();
      break;
    default: break;
  }
}

/** A stable look for a guest: body colour by segment, skin and hair by person. */
export function guestLook(segment: string, key: string, kid: boolean, colours: { sky: string; amber: string; plum: string; basil: string; tomato: string; straw: string; ink: string }): Look {
  const s = segment.toLowerCase();
  const h = hashKey(key);
  const skin = SKINS[h % SKINS.length]!;
  const hair = HAIRS[(h >> 3) % HAIRS.length]!;
  if (s.includes("student")) return { body: colours.sky, skin, hair, hat: "beanie", hatColour: colours.tomato, kid };
  if (s.includes("famil")) return { body: colours.amber, skin, hair, hat: "bows", hatColour: colours.tomato, kid };
  if (s.includes("business")) return { body: "#4a4540", skin, hair, shirt: true, trim: colours.tomato, kid };
  if (s.includes("foodie")) return { body: colours.plum, skin, hair, hat: "beret", hatColour: colours.ink, kid };
  if (s.includes("tourist")) return { body: colours.basil, skin, hair, hat: "sunhat", hatColour: colours.straw, kid };
  const pool = [colours.sky, colours.amber, colours.plum, colours.basil, "#c46b8c", "#5a8f8a"];
  return { body: pool[hashKey(s) % pool.length]!, skin, hair, kid };
}
