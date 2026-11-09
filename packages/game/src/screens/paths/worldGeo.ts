/**
 * Round 8 (maps): the invented world's geography for the Empire world map, the city maps and the Stars map.
 *
 * Everything here is presentation: coastlines, terrain, label spots and the pan/zoom maths. Ids, countries and every
 * number the sims use stay where they were. City positions live in content `cities.json` (mirrored in sim-empire
 * `world.ts`); the map reads them from content by id so an old save (which stored the old x/y in its cities) still
 * lands on the new coasts.
 *
 * Space: a 1000 × 500 viewBox (the same space `City.x/y` documents). Westland bleeds off the left edge, the Mainland
 * off the top and the Sunrise Coast off the right, so the five regions read as part of a bigger world.
 *
 * Coastlines are a short hand-drawn polygon per landmass, roughened by three rounds of seeded midpoint displacement
 * (mulberry32, a fixed seed per landmass — never Math.random) and smoothed with Catmull-Rom curves. Same output on
 * every load.
 */
import { extras } from "../../sim";

export const MAP_W = 1000;
export const MAP_H = 500;

export type Pt = readonly [number, number];

// ─────────── seeded helpers ───────────

/** mulberry32: a tiny deterministic PRNG for the coast wiggles and the tree/dune scatter. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a: a stable 32-bit hash of a string (Stars map placement, decorative variety). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** Three rounds of midpoint displacement on a closed polygon: a believable, crinkled coast from a dozen points. */
function roughen(pts: Pt[], seed: number, amp = 0.16): Pt[] {
  const rnd = prng(seed);
  let out = pts.slice();
  for (const a of [amp, amp * 0.7, amp * 0.5]) {
    const next: Pt[] = [];
    for (let i = 0; i < out.length; i++) {
      const p = out[i]!, q = out[(i + 1) % out.length]!;
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const len = Math.hypot(dx, dy);
      const n = (rnd() * 2 - 1) * a * len;
      next.push(p, [(p[0] + q[0]) / 2 - (dy / (len || 1)) * n, (p[1] + q[1]) / 2 + (dx / (len || 1)) * n]);
    }
    out = next;
  }
  return out;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** A closed Catmull-Rom spline through the points, as cubic Béziers. */
export function smoothClosed(pts: readonly Pt[]): string {
  const n = pts.length;
  let d = `M${r1(pts[0]![0])} ${r1(pts[0]![1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]!, p1 = pts[i]!, p2 = pts[(i + 1) % n]!, p3 = pts[(i + 2) % n]!;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${r1(c1x)} ${r1(c1y)} ${r1(c2x)} ${r1(c2y)} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return `${d}Z`;
}

/** Ray-cast point-in-polygon. */
export function inside(p: Pt, poly: readonly Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

// ─────────── landmasses ───────────

interface LandSeed { id: string; regionId: string; pts: Pt[]; amp?: number }

const LAND_SEEDS: LandSeed[] = [
  // Westland: a big continent, a deep bay on its east coast (Bayview), the sierra down its spine.
  { id: "westland", regionId: "westland", pts: [[-40, 36], [60, 28], [140, 46], [215, 38], [285, 60], [314, 98], [300, 132], [262, 140], [222, 152], [206, 170], [214, 198], [252, 212], [300, 216], [334, 240], [320, 268], [278, 278], [262, 314], [280, 360], [258, 410], [216, 464], [178, 448], [160, 402], [124, 376], [80, 384], [30, 364], [-40, 356]] },
  { id: "westland-cay", regionId: "westland", pts: [[336, 160], [352, 154], [362, 168], [350, 182], [336, 178]], amp: 0.1 },
  { id: "westland-key", regionId: "westland", pts: [[300, 300], [318, 296], [324, 312], [308, 322]], amp: 0.1 },
  // The Isles: Albrenn (Harbourton on its south harbour, Kingsbridge to the east), Caledh to the north, some skerries.
  { id: "albrenn", regionId: "isles", pts: [[440, 116], [468, 110], [494, 130], [510, 166], [496, 196], [516, 230], [502, 262], [478, 272], [456, 286], [430, 274], [406, 262], [400, 236], [422, 212], [396, 188], [402, 152], [420, 128]], amp: 0.13 },
  { id: "caledh", regionId: "isles", pts: [[400, 34], [432, 20], [464, 32], [478, 58], [460, 86], [430, 98], [402, 86], [390, 60]], amp: 0.13 },
  { id: "isles-skerry1", regionId: "isles", pts: [[370, 138], [386, 132], [394, 146], [380, 154]], amp: 0.08 },
  { id: "isles-skerry2", regionId: "isles", pts: [[526, 96], [540, 92], [544, 106], [530, 112]], amp: 0.08 },
  { id: "isles-skerry3", regionId: "isles", pts: [[384, 288], [398, 284], [404, 298], [390, 302]], amp: 0.08 },
  // The Mainland: off the top edge, a southern peninsula, Port Sarn on the west coast facing the Isles.
  { id: "mainland", regionId: "mainland", pts: [[540, -30], [810, -30], [800, 26], [770, 60], [780, 100], [752, 136], [766, 180], [740, 214], [738, 256], [712, 278], [694, 248], [664, 240], [636, 262], [610, 250], [596, 218], [572, 198], [584, 164], [562, 140], [570, 108], [552, 82], [546, 40]] },
  // The Crescent: a horn of land round a warm gulf, opening north towards the Mainland.
  { id: "crescent", regionId: "crescent", pts: [[530, 316], [526, 362], [550, 414], [598, 454], [660, 476], [730, 468], [782, 432], [802, 380], [794, 326], [772, 320], [768, 372], [740, 414], [692, 432], [636, 424], [592, 392], [568, 352], [560, 314]], amp: 0.1 },
  { id: "crescent-islet", regionId: "crescent", pts: [[712, 360], [728, 354], [736, 368], [722, 376]], amp: 0.08 },
  // The Sunrise Coast: off the right edge, a desert heart, Isla Verde (Manara) to the south.
  { id: "sunrise", regionId: "sunrise", pts: [[826, -30], [1040, -30], [1040, 340], [988, 352], [960, 330], [930, 340], [902, 318], [870, 326], [844, 300], [826, 268], [848, 236], [822, 206], [836, 172], [812, 138], [832, 104], [816, 64], [830, 24]] },
  { id: "isla-verde", regionId: "sunrise", pts: [[878, 384], [912, 370], [952, 382], [976, 410], [962, 446], [920, 460], [884, 444], [868, 412]], amp: 0.12 },
  { id: "sunrise-islet", regionId: "sunrise", pts: [[990, 380], [1004, 374], [1012, 390], [998, 396]], amp: 0.08 },
];

export interface Land { id: string; regionId: string; poly: Pt[]; d: string }

export const LANDS: Land[] = LAND_SEEDS.map((l, i) => {
  const poly = roughen(l.pts, 0x9e37 + i * 7919 + hash32(l.id), l.amp);
  return { id: l.id, regionId: l.regionId, poly, d: smoothClosed(poly) };
});

export const landAt = (p: Pt): Land | undefined => LANDS.find((l) => inside(p, l.poly));

// ─────────── terrain (restrained, flat-vector hints) ───────────

/** Scatter points in a box, kept when inside both the patch and its landmass (seeded jittered grid). */
function scatter(box: [number, number, number, number], step: number, patch: readonly Pt[], land: readonly Pt[], seed: number): Pt[] {
  const rnd = prng(seed);
  const out: Pt[] = [];
  for (let y = box[1]; y <= box[3]; y += step * 0.86) {
    const row = Math.round((y - box[1]) / (step * 0.86));
    for (let x = box[0] + (row % 2 ? step / 2 : 0); x <= box[2]; x += step) {
      const p: Pt = [r1(x + (rnd() - 0.5) * step * 0.6), r1(y + (rnd() - 0.5) * step * 0.5)];
      if (inside(p, patch) && inside(p, land)) out.push(p);
    }
  }
  return out;
}

const land = (id: string) => LANDS.find((l) => l.id === id)!.poly;
const blob = (pts: Pt[], seed: number) => { const poly = roughen(pts, seed, 0.12); return { poly, d: smoothClosed(poly) }; };

const W_FOREST = blob([[40, 54], [130, 56], [210, 60], [240, 86], [190, 108], [110, 104], [52, 110], [20, 90]], 11);
const M_FOREST = blob([[600, 196], [650, 186], [704, 196], [722, 230], [690, 238], [650, 232], [612, 236]], 12);
const S_FOREST = blob([[840, 268], [880, 282], [912, 302], [880, 318], [852, 306]], 13);
const V_FOREST = blob([[890, 392], [940, 386], [962, 414], [940, 444], [896, 436]], 14);
const S_DESERT = blob([[930, 150], [1000, 140], [1030, 190], [1020, 300], [960, 316], [930, 280], [948, 230], [920, 196]], 15);
const C_DESERT = blob([[540, 380], [580, 430], [640, 462], [720, 460], [780, 420], [796, 360], [784, 340], [760, 420], [700, 450], [630, 442], [580, 410], [548, 360]], 16);

export interface Patch { d: string; kind: "forest" | "desert"; landId: string }
export const PATCHES: Patch[] = [
  { d: W_FOREST.d, kind: "forest", landId: "westland" },
  { d: M_FOREST.d, kind: "forest", landId: "mainland" },
  { d: S_FOREST.d, kind: "forest", landId: "sunrise" },
  { d: V_FOREST.d, kind: "forest", landId: "isla-verde" },
  { d: S_DESERT.d, kind: "desert", landId: "sunrise" },
  { d: C_DESERT.d, kind: "desert", landId: "crescent" },
];

export const TREES: Pt[] = [
  ...scatter([20, 50, 250, 112], 14, W_FOREST.poly, land("westland"), 21),
  ...scatter([598, 184, 724, 240], 13, M_FOREST.poly, land("mainland"), 22),
  ...scatter([838, 266, 914, 320], 12, S_FOREST.poly, land("sunrise"), 23),
  ...scatter([888, 384, 966, 446], 12, V_FOREST.poly, land("isla-verde"), 24),
];
export const DUNES: Pt[] = [
  ...scatter([920, 140, 1030, 316], 26, S_DESERT.poly, land("sunrise"), 31),
  ...scatter([540, 340, 800, 466], 24, C_DESERT.poly, land("crescent"), 32),
];
/** Mountain peaks: the Westland sierra, the Caledh highlands, the Mainland's eastern range, the Sunrise north. */
export const PEAKS: Pt[] = [
  [100, 128], [112, 146], [122, 166], [132, 186], [138, 208], [146, 230], [150, 254], [148, 278], [142, 302],
  [418, 46], [440, 40], [452, 66],
  [730, 44], [750, 64], [736, 92], [742, 122],
  [872, 40], [896, 52], [922, 40], [948, 58],
];
/** Rolling hills. */
export const HILLS: Pt[] = [[430, 176], [462, 222], [424, 238], [470, 148], [650, 118], [690, 128], [626, 160], [210, 250], [234, 290], [604, 300], [770, 354]];
/** Rivers (open Béziers). */
export const RIVERS: string[] = [
  "M150 156C172 166 188 150 210 166",
  "M742 98C716 122 694 150 668 154S610 146 568 140",
  "M950 64C926 96 900 92 878 120S850 150 822 152",
];

// ─────────── regions: label spots, recognition halos ───────────

export interface RegionGeo { label: Pt; halo: { cx: number; cy: number; rx: number; ry: number } }
export const REGION_GEO: Record<string, RegionGeo> = {
  westland: { label: [86, 236], halo: { cx: 170, cy: 230, rx: 200, ry: 240 } },
  isles: { label: [334, 214], halo: { cx: 452, cy: 160, rx: 110, ry: 160 } },
  mainland: { label: [660, 40], halo: { cx: 680, cy: 130, rx: 150, ry: 150 } },
  crescent: { label: [664, 344], halo: { cx: 664, cy: 398, rx: 160, ry: 100 } },
  sunrise: { label: [904, 186], halo: { cx: 920, cy: 240, rx: 120, ry: 240 } },
};

/** Which side of its pin a city's name sits (keeps the Isles' three names apart). */
export const LABEL_SIDE: Record<string, "r" | "l" | "b" | "t"> = {
  harbourton: "b", kingsbridge: "r", glenmoor: "r", velmont: "b", port_sarn: "t", bayview: "l", sierra_vista: "b",
  kaito: "l", manara: "b", vasant: "b", qamar: "b", seren: "l",
};

/** A city's map position: content's coordinates by id (so old saves follow the new coasts), else what the save holds. */
export function cityPos(c: { id: string; x: number; y: number }): Pt {
  const def = extras.world.cities.find((x) => x.id === c.id);
  return def ? [def.x, def.y] : [c.x, c.y];
}

// ─────────── pan / zoom ───────────

/** The map's view: screen = world × k + (tx, ty), all in viewBox units. */
export interface View { k: number; tx: number; ty: number }
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const HOME_VIEW: View = { k: 1, tx: 0, ty: 0 };

/** Clamp zoom to [1, 4] and the pan so the map always fills the frame — it can never be lost off-screen. */
export function clampView(v: View): View {
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(v.k) ? v.k : 1));
  const clamp = (t: number, min: number) => Math.min(0, Math.max(min, Number.isFinite(t) ? t : 0));
  return { k, tx: clamp(v.tx, MAP_W * (1 - k)), ty: clamp(v.ty, MAP_H * (1 - k)) };
}

/** Zoom by `factor` keeping the viewBox point `at` (screen space) still. */
export function zoomAt(v: View, factor: number, at: Pt = [MAP_W / 2, MAP_H / 2]): View {
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * factor));
  const s = k / v.k;
  return clampView({ k, tx: at[0] - (at[0] - v.tx) * s, ty: at[1] - (at[1] - v.ty) * s });
}

/** Pan so a world point sits in the middle of the frame (clamped). */
export const centreOn = (v: View, p: Pt): View => clampView({ k: v.k, tx: MAP_W / 2 - p[0] * v.k, ty: MAP_H / 2 - p[1] * v.k });

/** A world point on screen, as a percentage of the frame. */
export const toScreenPct = (v: View, p: Pt): Pt => [((p[0] * v.k + v.tx) / MAP_W) * 100, ((p[1] * v.k + v.ty) / MAP_H) * 100];

/** A gentle curved supply route between two points (a quadratic arc bowed to one side). */
export function routePath(a: Pt, b: Pt): string {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const bow = 0.18;
  return `M${r1(a[0])} ${r1(a[1])}Q${r1(mx - dy * bow)} ${r1(my + dx * bow)} ${r1(b[0])} ${r1(b[1])}`;
}
