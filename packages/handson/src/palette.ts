/**
 * Round 8: the hands-on canvas palette — one module so the theme reviewer can tune it.
 *
 * Two kinds of colour live here:
 * - **Tokens** (`TOKEN_VARS`): read from the game's CSS custom properties (theme.css) on the canvas element, once per
 *   resize, via `readPalette`. A variable that is missing or unparseable keeps its hard-coded default, so the package
 *   (demo, tests, node) renders the same without any CSS.
 * - **Art colours** (wood, steel, tile, glass…): not theme tokens; an artist replaces these (or the whole tile set).
 *
 * `C` is the live palette the renderer reads. `applyPalette` swaps it (and bumps `paletteVersion`, which keys the static
 * layer cache) only when a different palette object is passed.
 */

export const DEFAULT_PALETTE = {
  // ── tokens (theme.css) ──
  ink: "#2b2622", inkSoft: "#5c534a", inkFaint: "#8f857a", paper: "#fffdf8", cream: "#fbf4e6", creamDeep: "#f3e7cf",
  tomato: "#c4412b", tomatoDeep: "#b93c29", basil: "#3c7a37", basilDeep: "#376a33", amber: "#e9a23b", amberDeep: "#b97a17",
  plum: "#8a5a9e", sky: "#4f8fb8", skyDeep: "#3a7398", gold: "#f2b33d", goldEdge: "#c98b1a", cheer: "#fdf0c9",
  awningA: "#c4412b", awningB: "#fffdf8",
  // ── art (not tokens) ──
  red: "#d9472f", straw: "#e8cf8a",
  outline: "#3a2c22",             // character and prop outline: a warm near-black, not pure ink
  shadow: "rgba(52,32,14,0.24)",   // drop shadows (light from the top-left)
  floorA: "#e9cfa3", floorB: "#e2c696", floorGrain: "rgba(120,80,40,0.16)", floorJoint: "rgba(96,62,30,0.28)",
  tileA: "#e3e7e1", tileB: "#d7ddd6", grout: "#bcc4bc",
  wall: "#7d5b3d", wallTop: "#a07a55", wallFace: "#5e4330", splash: "#f4f1ea", splashGrout: "#d9d3c6",
  steel: "#cfd5d8", steelTop: "#e3e8ea", steelDark: "#97a1a6", steelFace: "#a9b2b6", steelDeep: "#6f797e",
  hob: "#34312f", hobTop: "#45413e", flame: "#ff8a3d", flameCore: "#ffd27a",
  table: "#c4935b", tableTop: "#d3a670", tableEdge: "#94642f", chair: "#8a5d33", chairTop: "#a8723f",
  barWood: "#5e412a", barTop: "#80593a", barFace: "#4a321f",
  glass: "#cfe6ef", glassShine: "rgba(255,255,255,0.65)", water: "#9cc8db", oil: "#e0b04a",
  board: "#d8ac72", boardGrain: "rgba(130,85,40,0.35)", carpet: "#dccdb6", carpetDot: "rgba(120,96,70,0.12)",
  leaf: "#4f8a45", leafDeep: "#356a31", pot: "#b5703d", lamp: "rgba(255,206,130,0.20)",
  hair: "#4a3324",
};

export type Palette = { -readonly [K in keyof typeof DEFAULT_PALETTE]: string };

/** Palette key → the theme.css custom property it is read from. */
export const TOKEN_VARS: Partial<Record<keyof Palette, string>> = {
  ink: "--ink", inkSoft: "--ink-soft", inkFaint: "--ink-faint", paper: "--paper", cream: "--cream", creamDeep: "--cream-deep",
  tomato: "--tomato", tomatoDeep: "--tomato-deep", basil: "--basil", basilDeep: "--basil-deep", amber: "--amber",
  amberDeep: "--amber-deep", plum: "--plum", sky: "--sky", skyDeep: "--sky-deep", gold: "--star", goldEdge: "--star-edge",
  cheer: "--cheer",
};

/** The live palette (mutated in place by applyPalette so every `C.x` read sees it). */
export const C: Palette = { ...DEFAULT_PALETTE };
let applied: Partial<Palette> | undefined;
/** Bumped whenever the live palette changes; part of the static-layer cache key. */
export let paletteVersion = 0;

export function applyPalette(p: Partial<Palette> | undefined): number {
  if (p === applied) return paletteVersion;
  applied = p;
  Object.assign(C, DEFAULT_PALETTE, p ?? {});
  paletteVersion++;
  return paletteVersion;
}

/** "#abc", "#aabbcc", "rgb(…)"/"rgba(…)" → "#rrggbb" (alpha dropped); anything else → undefined. */
export function toHex(v: string | undefined | null): string | undefined {
  if (!v) return undefined;
  const s = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return `#${[...m[1]!].map((c) => c + c).join("")}`;
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s);
  if (m) return `#${m[1]}`;
  const r = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/.exec(s);
  if (r) return `#${[r[1], r[2], r[3]].map((x) => Math.max(0, Math.min(255, Math.round(Number(x)))).toString(16).padStart(2, "0")).join("")}`;
  return undefined;
}

export type VarSource = Element | ((name: string) => string) | null | undefined;

/** A `name → value` reader for a canvas's custom properties (or the getter itself); undefined when there's no CSS. */
export function varReader(source: VarSource): ((name: string) => string) | undefined {
  if (typeof source === "function") return (n) => safe(source, n);
  if (source && typeof getComputedStyle === "function") {
    try { const cs = getComputedStyle(source); return (n) => safe((x) => cs.getPropertyValue(x), n); } catch { return undefined; }
  }
  return undefined;
}

/**
 * Generic token read: `defaults` with every key in `vars` replaced by its CSS custom property when it parses as a
 * colour. Shared by this palette and the game's floor palette (RestaurantView).
 */
export function readTokens<T extends Record<string, string>>(source: VarSource, defaults: T, vars: Partial<Record<keyof T, string>>): T {
  const out = { ...defaults };
  const get = varReader(source);
  if (!get) return out;
  for (const [k, name] of Object.entries(vars) as [keyof T, string][]) {
    const hex = toHex(get(name));
    if (hex) out[k] = hex as T[keyof T];
  }
  return out;
}

/** The two stripe colours of the `--awning` gradient (else `a`/`b`). */
export function awningColours(source: VarSource, a: string, b: string): [string, string] {
  const get = varReader(source);
  const awning = get ? get("--awning") : "";
  const cols = [...awning.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)].map((x) => toHex(x[0])).filter((x): x is string => !!x);
  const first = cols[0] ?? a;
  return [first, cols.find((c) => c !== first) ?? b];
}

/**
 * Reads the theme tokens for a canvas: `source` is the canvas (its computed style resolves the custom properties) or a
 * `name → value` getter (tests). Missing, empty or unparseable variables fall back to DEFAULT_PALETTE. The awning's two
 * stripe colours come from `--awning` (a repeating gradient), else tomato/paper.
 */
export function readPalette(source: VarSource): Palette {
  const out = readTokens<Palette>(source, { ...DEFAULT_PALETTE }, TOKEN_VARS);
  [out.awningA, out.awningB] = awningColours(source, out.tomato, out.paper);
  return out;
}

function safe(get: (n: string) => string, name: string): string {
  try { return String(get(name) ?? ""); } catch { return ""; }
}
