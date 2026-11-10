/**
 * Round 12 (B): postcards — a 1200×630 (or 1080×1350 portrait) PNG of the restaurant: the logo, the name in the brand's
 * lettering, the room (the floor canvas's own picture, staff in uniform), tonight's headline numbers, the best review
 * line and the date, in one of three layouts that match the menu styles (classic, modern, chalkboard). Also the win
 * screen's picture (moved here from WinScreen.tsx's `savePicture`). Saved through the save-file path (`offerFile`: the
 * `downloads` capability inside claude.ai, else a plain download link).
 *
 * Nothing personal goes on a card: the restaurant's name, the game's own numbers and a guest review written by the sim.
 * A lazy module: Evening, the Restaurant tab and the win screen import it on click.
 */
import type { DayResult, GameState, Review } from "@full-plate/sim-core";
import { content } from "../sim";
import { dateLabel } from "./calendar";
import { formatPounds } from "./format";
import { contrast, currentBrand, letterFont, logoDataUrl, onColour, resolveBrand, type Brand, type MenuStyle } from "./brand";

export type PostcardSize = "landscape" | "portrait";
export const POSTCARD_PX: Record<PostcardSize, [number, number]> = { landscape: [1200, 630], portrait: [1080, 1350] };

export interface PostcardInfo {
  brand: Brand;
  name: string;
  /** Sim day the card is about (0-based). */
  day: number;
  /** "District · date" style line under the name. */
  where: string;
  headline: string;
  /** Three headline numbers. */
  numbers: { label: string; value: string }[];
  review?: { text: string; rating: number } | undefined;
}

const INK = "#2b2622", SOFT = "#5c534a", PAPER = "#fffdf8", CREAM = "#fbf4e6";
const CHALK = "#f7f3ea", CHALK_SOFT = "#ddd6c6", BOARD = "#26302b", WOOD = "#8a5a35";

// ── what goes on the card ──
/** The day's best review (highest rating, then the longest line), if any. */
export function bestReview(reviews: readonly Review[] | undefined): { text: string; rating: number } | undefined {
  const r = (reviews ?? []).filter((x) => x.text.trim()).sort((a, b) => b.rating - a.rating || b.text.length - a.text.length)[0];
  return r ? { text: r.text, rating: r.rating } : undefined;
}

/** The card for a finished day (the Evening), or — with no day played yet — the room ready to open (Restaurant tab). */
export function postcardInfo(game: GameState, brand: Brand, result?: DayResult | null): PostcardInfo {
  const district = content.districts.find((d) => d.id === game.districtId)?.name ?? "";
  const r = result ?? game.history.at(-1);
  if (!r) {
    return {
      brand, name: game.restaurantName, day: game.day, where: [district, dateLabel(game.day)].filter(Boolean).join(" · "),
      headline: "Ready for our first night",
      numbers: [
        { label: "Tables", value: String(game.tables.length) },
        { label: "Seats", value: String(game.tables.reduce((a, t) => a + t.seats, 0)) },
        { label: "Dishes", value: String(game.menu.filter((m) => m.active).length) },
      ],
    };
  }
  const headline = r.closed ? "Closed for the day" : r.profit >= 0 ? (r.averageRating >= 4 ? "What a night!" : "Doors closed, money in the till") : "A tough night, but we're open tomorrow";
  return {
    brand, name: game.restaurantName, day: r.day, where: [district, `Day ${r.day + 1}`, dateLabel(r.day)].filter(Boolean).join(" · "),
    headline,
    numbers: [
      { label: "Guests fed", value: String(r.covers) },
      { label: "Takings", value: formatPounds(r.revenue) },
      { label: "Rating", value: r.covers ? `${r.averageRating.toFixed(1)}★` : "—" },
    ],
    review: bestReview(r.reviews),
  };
}

// ── drawing helpers ──
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ok(null);
    img.src = src;
  });
}

/** Sets the largest font (down to `min`) at which `text` fits `maxW`; returns the size. */
function fitFont(x: CanvasRenderingContext2D, text: string, maxW: number, font: (px: number) => string, start: number, min: number): number {
  let px = start;
  for (; px > min; px -= 2) { x.font = font(px); if (x.measureText(text).width <= maxW) return px; }
  x.font = font(min);
  return min;
}

/** Word-wraps `text` into at most `lines` lines of `maxW` (the last one ends in "…" if cut). */
export function wrapLines(measure: (s: string) => number, text: string, maxW: number, lines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < words.length; i++) {
    const next = cur ? `${cur} ${words[i]}` : words[i]!;
    if (measure(next) <= maxW || !cur) { cur = next; continue; }
    out.push(cur); cur = words[i]!;
    if (out.length === lines) { cur = ""; break; }
  }
  if (cur) out.push(cur);
  if (out.length > lines || (out.length === lines && words.join(" ") !== out.join(" "))) {
    const last = out.slice(0, lines);
    let l = last[lines - 1]!;
    while (l && measure(`${l}…`) > maxW) l = l.slice(0, -1);
    last[lines - 1] = `${l.trimEnd()}…`;
    return last;
  }
  return out;
}

function rr(x: CanvasRenderingContext2D, X: number, Y: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r);
  x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath();
}

/**
 * The room as the floor canvas draws it (RestaurantView, staff in the house uniform), `w`×`h` CSS px at 2×. The canvas is
 * put in the page for a moment (hidden) so it reads the theme and the brand's awning; null when there is no 2D canvas.
 */
export async function roomPicture(game: GameState, w: number, h: number): Promise<HTMLCanvasElement | null> {
  try {
    const { RestaurantView, loadDecorArt } = await import("../canvas/RestaurantView");
    if (game.decor) await loadDecorArt().catch(() => {});
    const c = document.createElement("canvas");
    Object.assign(c.style, { position: "fixed", left: "-10000px", top: "0", width: `${w}px`, height: `${h}px`, visibility: "hidden" });
    document.body.appendChild(c);
    try {
      const view = new RestaurantView(c);
      view.resize(w, h, 2);
      view.render(game, { content, speed: 0, now: 1000, reducedMotion: true });
    } finally { c.remove(); }
    return c;
  } catch { return null; }
}

interface Look { bg: string; ink: string; soft: string; head: string; headInk: string; headSoft: string; tile: string; tileInk: string; tileSoft: string; star: string }
function looks(b: Brand, m: MenuStyle): Look {
  if (m === "chalkboard") {
    const star = contrast(b.accent, BOARD) >= 3 ? b.accent : "#f2b33d";
    return { bg: BOARD, ink: CHALK, soft: CHALK_SOFT, head: BOARD, headInk: CHALK, headSoft: CHALK_SOFT, tile: "rgba(255,255,255,0.07)", tileInk: CHALK, tileSoft: CHALK_SOFT, star };
  }
  const star = contrast(b.primary, PAPER) >= 3 ? b.primary : INK;
  if (m === "modern") {
    const on = onColour(b.primary);
    return { bg: PAPER, ink: INK, soft: SOFT, head: b.primary, headInk: on, headSoft: on, tile: b.primary, tileInk: on, tileSoft: on, star };
  }
  return { bg: CREAM, ink: INK, soft: SOFT, head: CREAM, headInk: INK, headSoft: SOFT, tile: PAPER, tileInk: INK, tileSoft: SOFT, star };
}

/** Draws a postcard onto a new canvas. `room` is a picture of the dining room (or null: a plain panel). */
export async function drawPostcard(info: PostcardInfo, size: PostcardSize, room: CanvasImageSource | null): Promise<HTMLCanvasElement> {
  const [W, H] = POSTCARD_PX[size];
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  if (!x) return c;
  const b = info.brand, m = b.menu, L = looks(b, m);
  const portrait = size === "portrait";
  const pad = portrait ? 60 : 48;
  const headH = portrait ? 230 : 170;
  const logo = await loadImage(logoDataUrl(b));
  try { await document.fonts?.ready; } catch { /* draw with what's there */ }

  // background and the style's frame
  x.fillStyle = L.bg; x.fillRect(0, 0, W, H);
  if (m === "modern") {
    x.fillStyle = L.head; x.fillRect(0, 0, W, headH);
    x.fillStyle = b.accent; x.fillRect(0, headH, W, 12);
    x.fillStyle = b.primary; x.fillRect(0, H - 14, W, 14);
  } else if (m === "classic") {
    x.strokeStyle = b.primary; x.lineWidth = 8; x.strokeRect(18, 18, W - 36, H - 36);
    x.lineWidth = 2.5; x.strokeRect(32, 32, W - 64, H - 64);
  } else {
    x.strokeStyle = WOOD; x.lineWidth = 28; x.strokeRect(14, 14, W - 28, H - 28);
    x.strokeStyle = "rgba(0,0,0,0.25)"; x.lineWidth = 3; x.strokeRect(28, 28, W - 56, H - 56);
    // a little chalk dust
    x.fillStyle = "rgba(255,255,255,0.035)";
    for (let i = 0; i < 90; i++) { const px = (i * 397) % W, py = (i * 211) % H; x.fillRect(px, py, 40 + (i % 5) * 20, 2); }
  }

  // logo and name
  const lg = portrait ? 150 : 118, ly = portrait ? 40 : 26, lx = pad + 6;
  if (m !== "classic") { x.fillStyle = PAPER; x.beginPath(); x.arc(lx + lg / 2, ly + lg / 2, lg / 2 + 8, 0, Math.PI * 2); x.fill(); }
  if (logo) x.drawImage(logo, lx, ly, lg, lg);
  const nx = lx + lg + 30, nMax = W - nx - pad;
  const shown = b.letter === "caps" ? info.name.toUpperCase() : info.name;
  x.fillStyle = L.headInk; x.textBaseline = "alphabetic";
  fitFont(x, shown, nMax, (px) => letterFont(b.letter, px), portrait ? 70 : 62, 30);
  x.fillText(shown, nx, ly + lg * 0.55);
  x.fillStyle = L.headSoft;
  fitFont(x, info.where, nMax, (px) => `700 ${px}px Nunito, system-ui, sans-serif`, portrait ? 30 : 26, 18);
  x.fillText(info.where, nx, ly + lg * 0.55 + (portrait ? 50 : 42));

  // the room
  const rx = portrait ? pad : 610, ry = portrait ? headH + 40 : headH + 30;
  const rw = portrait ? W - pad * 2 : W - 610 - pad, rh = portrait ? 520 : H - ry - pad - 10;
  x.save();
  if (m === "chalkboard") { x.translate(rx + rw / 2, ry + rh / 2); x.rotate(-0.025); x.translate(-(rx + rw / 2), -(ry + rh / 2)); }
  const frame = m === "modern" ? 0 : 12;
  if (frame) { x.fillStyle = PAPER; x.shadowColor = "rgba(0,0,0,0.25)"; x.shadowBlur = 16; x.shadowOffsetY = 6; x.fillRect(rx - frame, ry - frame, rw + frame * 2, rh + frame * 2 + (m === "chalkboard" ? 30 : 0)); x.shadowColor = "transparent"; }
  rr(x, rx, ry, rw, rh, m === "modern" ? 18 : 4); x.clip();
  if (room) {
    // cover-fit the room picture
    const sw = (room as HTMLCanvasElement).width || rw, sh = (room as HTMLCanvasElement).height || rh;
    const k = Math.max(rw / sw, rh / sh), dw = sw * k, dh = sh * k;
    x.drawImage(room, rx + (rw - dw) / 2, ry + (rh - dh) / 2, dw, dh);
  } else { x.fillStyle = "#e9cfa3"; x.fillRect(rx, ry, rw, rh); }
  x.restore();
  if (m === "modern") { x.strokeStyle = INK; x.lineWidth = 4; rr(x, rx, ry, rw, rh, 18); x.stroke(); }

  // headline, numbers, review
  const cx = pad + 6, cw = portrait ? W - pad * 2 - 12 : 610 - pad - 40;
  let y = portrait ? ry + rh + (m === "chalkboard" ? 120 : 90) : headH + 78;
  x.fillStyle = L.ink;
  fitFont(x, info.headline, cw, (px) => `600 ${px}px Fredoka, Nunito, sans-serif`, portrait ? 54 : 42, 26);
  x.fillText(info.headline, cx, y);
  if (m === "chalkboard") { x.strokeStyle = L.star; x.lineWidth = 4; x.beginPath(); x.moveTo(cx, y + 12); x.lineTo(cx + Math.min(cw, x.measureText(info.headline).width), y + 10); x.stroke(); }
  y += portrait ? 34 : 26;
  const n = info.numbers.length, gap = 14, tw = (cw - gap * (n - 1)) / n, th = portrait ? 140 : 108;
  info.numbers.forEach((num, i) => {
    const tx = cx + i * (tw + gap);
    x.fillStyle = L.tile; rr(x, tx, y, tw, th, 14); x.fill();
    if (m === "classic") { x.strokeStyle = b.primary; x.lineWidth = 3; x.stroke(); }
    x.fillStyle = L.tileInk;
    fitFont(x, num.value, tw - 24, (px) => `600 ${px}px Fredoka, Nunito, sans-serif`, portrait ? 60 : 46, 22);
    x.fillText(num.value, tx + 14, y + th * 0.55);
    x.fillStyle = L.tileSoft; x.font = `700 ${portrait ? 26 : 21}px Nunito, system-ui, sans-serif`;
    x.fillText(num.label, tx + 14, y + th - (portrait ? 22 : 18));
  });
  y += th + (portrait ? 64 : 48);
  if (info.review) {
    x.fillStyle = L.star; x.font = `${portrait ? 34 : 28}px Nunito, system-ui, sans-serif`;
    const rating = Math.max(0, Math.min(5, Math.round(info.review.rating)));
    x.fillText("★".repeat(rating) + "☆".repeat(5 - rating), cx, y);
    y += portrait ? 46 : 36;
    x.fillStyle = L.ink; x.font = `italic 700 ${portrait ? 30 : 24}px Nunito, system-ui, sans-serif`;
    const maxLines = portrait ? 2 : Math.max(1, Math.floor((H - pad - 40 - y) / 32) + 1);
    wrapLines((s) => x.measureText(s).width, `“${info.review.text}”`, cw, Math.min(3, maxLines)).forEach((l, i) => x.fillText(l, cx, y + i * (portrait ? 40 : 32)));
  }
  // footer: the game's name, small
  x.fillStyle = m === "modern" ? SOFT : L.soft; x.font = `600 ${portrait ? 26 : 20}px Fredoka, Nunito, sans-serif`;
  x.textAlign = "right";
  x.fillText("Full Plate", W - pad, H - (m === "modern" ? 30 : pad - 6));
  x.textAlign = "left";
  return c;
}

/** A file-safe slug of the restaurant name. */
export const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "restaurant";
export const postcardFileName = (name: string, day: number, size: PostcardSize): string => `full-plate-${slug(name)}-day${day + 1}${size === "portrait" ? "-portrait" : ""}.png`;

const toBlob = (c: HTMLCanvasElement): Promise<Blob | null> => new Promise((ok) => { try { c.toBlob((b) => ok(b), "image/png"); } catch { ok(null); } });

/** Offers the PNG through the save-file path (downloads capability, else a link). */
export async function offerPng(c: HTMLCanvasElement, filename: string): Promise<"saved" | "declined" | "failed"> {
  const blob = await toBlob(c);
  if (!blob) return "failed";
  const { offerFile } = await import("../state/saveFiles");
  return offerFile(filename, blob);
}

/** The whole postcard for a game: its brand (the page's, else the name's default), the room and the day's numbers. */
export async function makePostcard(game: GameState, size: PostcardSize, result?: DayResult | null, brand?: Brand): Promise<HTMLCanvasElement> {
  const b = brand ?? currentBrand() ?? resolveBrand(undefined, game.restaurantName);
  const info = postcardInfo(game, b, result);
  const portrait = size === "portrait";
  const room = await roomPicture(game, portrait ? 960 : 540, portrait ? 520 : 400);
  return drawPostcard(info, size, room);
}

// ── the win screen's picture (round 11's WinScreen `savePicture`, moved here; now with the logo) ──
export async function saveWinPicture(game: GameState, win: { title: string; day: number }, figure: { big: string; label: string }, steps: { day: number; text: string }[]): Promise<"saved" | "declined" | "failed"> {
  const c = document.createElement("canvas");
  c.width = 1200; c.height = 630;
  const x = c.getContext("2d");
  if (!x) return "failed";
  const b = currentBrand() ?? resolveBrand(undefined, game.restaurantName);
  const css = getComputedStyle(document.documentElement);
  const v = (n: string, f: string) => css.getPropertyValue(n).trim() || f;
  x.fillStyle = v("--cream", "#fbf4e6"); x.fillRect(0, 0, 1200, 630);
  for (let i = 0; i < 1200; i += 60) { x.fillStyle = (i / 60) % 2 ? b.accent : b.primary; x.fillRect(i, 0, 60, 22); }
  const logo = await loadImage(logoDataUrl(b));
  if (logo) x.drawImage(logo, 1200 - 70 - 120, 50, 120, 120);
  x.fillStyle = v("--ink", "#2b2622");
  fitFont(x, win.title, 1200 - 140 - 140, (px) => `600 ${px}px Fredoka, sans-serif`, 64, 32); x.fillText(win.title, 70, 140);
  x.font = letterFont(b.letter, 30); x.fillStyle = v("--ink-soft", "#5c534a"); x.fillText(`${game.restaurantName} · ${dateLabel(win.day)}`, 70, 190);
  x.font = "600 96px Fredoka, sans-serif"; x.fillStyle = v("--tomato-deep", "#b93c29"); x.fillText(figure.big, 70, 320);
  x.font = "700 30px Nunito, sans-serif"; x.fillStyle = v("--ink", "#2b2622"); x.fillText(figure.label, 70, 365);
  x.font = "700 26px Nunito, sans-serif";
  steps.slice(-5).forEach((st, i) => x.fillText(`Day ${st.day + 1}: ${st.text}`, 640, 270 + i * 46, 520));
  x.font = "600 30px Fredoka, sans-serif"; x.fillStyle = v("--ink", "#2b2622"); x.fillText("Full Plate", 70, 580);
  return offerPng(c, `full-plate-${slug(game.restaurantName)}.png`);
}
