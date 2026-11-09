/**
 * Round 8: the owner's floor canvas (RestaurantView) palette — one module so the theme reviewer can tune it.
 *
 * Tokens are read from theme.css custom properties on the canvas once per resize (`readFloorPalette`); a missing or
 * unparseable variable keeps the default below. Art colours (wood, steel, paving, glass) are not tokens.
 * The shared character sprite and the hands-on kitchen use the same art colours (handson/src/palette.ts).
 */
import { awningColours, readTokens, type VarSource } from "@full-plate/handson/palette";

export const FLOOR_DEFAULTS = {
  // ── tokens ──
  ink: "#2b2622", inkSoft: "#5c534a", inkFaint: "#6a5f54", paper: "#fffdf8", cream: "#fbf4e6",
  tomato: "#c4412b", tomatoDeep: "#b93c29", basil: "#3c7a37", basilDeep: "#376a33", amber: "#e9a23b", amberDeep: "#9a5c0c",
  plum: "#8a5a9e", sky: "#4f8fb8", skyDeep: "#3a7398", gold: "#f2b33d", goldEdge: "#c98b1a", cheer: "#fdf0c9",
  awningA: "#c4412b", awningB: "#fffdf8",
  // ── art ──
  red: "#d9472f", straw: "#e8cf8a", outline: "#3a2c22", shadow: "rgba(52,32,14,0.24)",
  floorA: "#e9cfa3", floorB: "#e2c696", floorGrain: "rgba(120,80,40,0.16)", floorJoint: "rgba(96,62,30,0.28)",
  tileA: "#e3e7e1", tileB: "#d7ddd6", grout: "#bcc4bc",
  wall: "#7d5b3d", wallTop: "#a07a55", wallFace: "#5e4330", splash: "#f4f1ea", splashGrout: "#d9d3c6",
  steel: "#cfd5d8", steelTop: "#e3e8ea", steelDark: "#97a1a6", steelFace: "#a9b2b6", steelDeep: "#6f797e",
  hobTop: "#45413e", flame: "#ff8a3d", flameCore: "#ffd27a",
  table: "#c4935b", tableTop: "#d3a670", tableEdge: "#94642f", chair: "#8a5d33", chairTop: "#a8723f",
  barTop: "#80593a", barFace: "#4a321f",
  glass: "#cfe6ef", glassShine: "rgba(255,255,255,0.65)", water: "#9cc8db",
  paving: "#d6d0c4", pavingAlt: "#cec7ba", pavingJoint: "#bdb5a6", kerb: "#b3ab9c", road: "#77746f", roadLine: "#e9e3d4",
  leaf: "#4f8a45", leafDeep: "#356a31", pot: "#b5703d", lamp: "rgba(255,206,130,0.22)", night: "#1c2246",
};

export type FloorPalette = { -readonly [K in keyof typeof FLOOR_DEFAULTS]: string };

/** Palette key → theme.css custom property. */
export const FLOOR_TOKENS: Partial<Record<keyof FloorPalette, string>> = {
  ink: "--ink", inkSoft: "--ink-soft", inkFaint: "--ink-faint", paper: "--paper", cream: "--cream",
  tomato: "--tomato", tomatoDeep: "--tomato-deep", basil: "--basil", basilDeep: "--basil-deep", amber: "--amber",
  amberDeep: "--amber-deep", plum: "--plum", sky: "--sky", skyDeep: "--sky-deep", gold: "--star", goldEdge: "--star-edge",
  cheer: "--cheer",
};

export function readFloorPalette(source: VarSource): FloorPalette {
  const p = readTokens<FloorPalette>(source, { ...FLOOR_DEFAULTS }, FLOOR_TOKENS);
  [p.awningA, p.awningB] = awningColours(source, p.tomato, p.paper);
  return p;
}

// Round 10: the decor items' art colours live in decorPalette.ts (they load with the decor art chunk, not this one).
