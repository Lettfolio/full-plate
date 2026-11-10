/**
 * Round 12 (B): the brand kit — palette, the default brand every restaurant gets from its name, contrast, the logo
 * (an SVG string: shape + motif in the two house colours; the lettering is the restaurant's name in the brand's
 * font, set beside it) and `applyBrand`, which puts the brand on the page as CSS variables so the header, menu card,
 * evening report, Empire strip and guide envelope pick it up with no code of their own.
 *
 * A lazy module (the brand chunk): the main chunk only calls `import("./brand")` from `brandHook.ts`.
 */
import { useSyncExternalStore } from "react";
import type { StaffRole } from "@full-plate/sim-core";
import {
  dress, encodeBrand, LETTERS, MENUS, MOTIFS, parseBrand, SHAPES, UNIFORMS, uniformPatch,
  type Brand, type Letter, type Motif, type Shape, type UniformPatch,
} from "./brandCode";
import { setCanvasBrand } from "../canvas/brand";
import "./brand.css";

export * from "./brandCode";

// ── palette ──
/** The curated house colours (name for the swatch's label, hex). Dark-to-light within families. */
export const PALETTE: readonly { name: string; hex: string }[] = [
  { name: "Tomato", hex: "#c4412b" }, { name: "Cherry", hex: "#9e2a3a" }, { name: "Coral", hex: "#f07a4f" },
  { name: "Mustard", hex: "#e0a41f" }, { name: "Butter", hex: "#f5d77a" }, { name: "Olive", hex: "#6f7a2a" },
  { name: "Basil", hex: "#3f7d4e" }, { name: "Mint", hex: "#9fd8b8" }, { name: "Teal", hex: "#1f7a7a" },
  { name: "Sky", hex: "#4f8fc0" }, { name: "Navy", hex: "#24345c" }, { name: "Plum", hex: "#7a3e6c" },
  { name: "Lilac", hex: "#b9a3e3" }, { name: "Rose", hex: "#e58fa5" }, { name: "Cocoa", hex: "#5b3a29" },
  { name: "Charcoal", hex: "#2f3133" }, { name: "Cream", hex: "#f6ead2" }, { name: "Snow", hex: "#fbfaf6" },
];
const DEEP = ["#c4412b", "#9e2a3a", "#6f7a2a", "#3f7d4e", "#1f7a7a", "#24345c", "#7a3e6c", "#5b3a29", "#2f3133", "#4f8fc0"];
const LIGHT = ["#e0a41f", "#f5d77a", "#9fd8b8", "#b9a3e3", "#e58fa5", "#f6ead2", "#f07a4f", "#fbfaf6"];
const UNIFORM_COLOURS = ["#2f3133", "#24345c", "#3f7d4e", "#9e2a3a", "#5b3a29", "#1f7a7a", "#7a3e6c", "#c4412b"];

export const SHAPE_NAMES: Record<Shape, string> = { circle: "Circle", shield: "Shield", badge: "Rosette", plate: "Plate", square: "Tile", ribbon: "Ribbon", hexagon: "Hexagon", arch: "Arch" };
export const MOTIF_NAMES: Record<Motif, string> = { cutlery: "Knife and fork", chefhat: "Chef's hat", flame: "Flame", leaf: "Leaf", star: "Star", fish: "Fish", cup: "Coffee cup", chilli: "Chilli", noodles: "Noodle bowl", glass: "Glass", whisk: "Whisk", pizza: "Pizza slice", cake: "Cupcake", bread: "Loaf" };
export const LETTER_NAMES: Record<Letter, string> = { rounded: "Rounded", strong: "Strong", caps: "Sign caps", slanted: "Slanted" };
export const UNIFORM_NAMES: Record<Brand["uniform"], string> = { apron: "Apron", tee: "T-shirt", shirt: "Shirt", waistcoat: "Waistcoat" };
export const MENU_NAMES: Record<Brand["menu"], string> = { classic: "Classic", modern: "Modern", chalkboard: "Chalkboard" };

// ── colour maths ──
const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
};
const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export const luminance = (hex: string): number => { const [r, g, b] = rgb(hex).map(lin) as [number, number, number]; return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a: string, b: string): number => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const isHex = (s: string): boolean => /^#?[0-9a-fA-F]{6}$/.test(s.trim());
export const normHex = (s: string): string => `#${s.trim().replace("#", "").toLowerCase()}`;

const INK = "#2b2622", WHITE = "#ffffff", BLACK = "#000000", CREAM = "#fffdf8";
/**
 * Text on a brand colour: cream or ink, whichever reads better; if neither reaches 4.5:1 (a mid tone), pure white or
 * black (the better of those is always ≥ 4.58:1). So any colour she picks keeps the audit at zero failures.
 */
export function onColour(bg: string): string {
  const best = [CREAM, INK].sort((a, b) => contrast(bg, b) - contrast(bg, a))[0]!;
  if (contrast(bg, best) >= 4.5) return best;
  return contrast(bg, WHITE) >= contrast(bg, BLACK) ? WHITE : BLACK;
}
/** The motif's colour: the accent, unless it nearly vanishes on the shape (then the readable text colour). */
export const motifColour = (b: Brand): string => (contrast(b.primary, b.accent) >= 1.6 ? b.accent : onColour(b.primary));

// ── the default brand ──
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** Words in a name that suggest a motif ("Noodle Bar" gets a bowl). */
const MOTIF_WORDS: [RegExp, Motif][] = [
  [/noodle|ramen|pho|wok|udon/i, "noodles"], [/fish|chip|sea|oyster|crab|catch/i, "fish"], [/caf[eé]|coffee|bean|brew|espresso/i, "cup"],
  [/pizz|slice/i, "pizza"], [/chill?i|spice|hot|fire|burn/i, "chilli"], [/grill|flame|smoke|bbq|ember/i, "flame"],
  [/green|garden|leaf|herb|veg/i, "leaf"], [/bak|bread|loaf|crust|dough/i, "bread"], [/cake|sweet|sugar|bun/i, "cake"],
  [/bar|cocktail|tap|glass/i, "glass"], [/star/i, "star"], [/kitchen|chef|cook/i, "chefhat"],
];

/**
 * The brand a restaurant has before anyone opens the editor: the name, hashed, picks every part (a word like "Noodle"
 * or "Grill" picks the motif). Deterministic, so every existing save looks branded on first load with no sheet.
 */
export function defaultBrand(name: string): Brand {
  const h = hash(name.trim().toLowerCase() || "full plate");
  const at = (n: number, shift: number) => Math.floor(h / 7 ** shift) % n;
  const primary = DEEP[at(DEEP.length, 0)]!;
  const lights = LIGHT.filter((c) => contrast(primary, c) >= 2.2);
  const motif = MOTIF_WORDS.find(([re]) => re.test(name))?.[1] ?? MOTIFS[at(MOTIFS.length, 1)]!;
  return {
    shape: SHAPES[at(SHAPES.length, 2)]!,
    motif,
    letter: LETTERS[at(LETTERS.length, 3)]!,
    primary,
    accent: lights[at(lights.length, 4)] ?? "#f6ead2",
    uniform: UNIFORMS[at(UNIFORMS.length, 5)]!,
    uniformColour: UNIFORM_COLOURS[at(UNIFORM_COLOURS.length, 6)]!,
    menu: MENUS[at(MENUS.length, 7)]!,
  };
}

/** The brand to show: the stored code (her choice) over the name's default. A career employer's is always its default. */
export function resolveBrand(code: string | undefined, name: string, readOnly = false): Brand {
  const d = defaultBrand(name);
  return readOnly ? d : parseBrand(code, d);
}

/** "Randomise": a fresh, decent-looking brand from a number (the sheet passes a click count, never Math.random in the sim). */
export function randomBrand(n: number): Brand {
  return defaultBrand(`shuffle-${n}-${n * 7919}`);
}

export { encodeBrand };

// ── the logo ──
interface MotifArt { fill?: string[]; line?: string[]; dots?: [number, number, number, "ink" | "primary"][] }
const star = (cx: number, cy: number, R: number, r: number): string =>
  Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? r : R; return `${i ? "L" : "M"}${(cx + k * Math.cos(a)).toFixed(1)} ${(cy + k * Math.sin(a)).toFixed(1)}`; }).join("") + "Z";
const poly = (n: number, R: number, r: number, rot = 0): string =>
  Array.from({ length: n * 2 }, (_, i) => { const a = rot + (i * Math.PI) / n, k = i % 2 ? r : R; return `${i ? "L" : "M"}${(50 + k * Math.cos(a)).toFixed(1)} ${(50 + k * Math.sin(a)).toFixed(1)}`; }).join("") + "Z";

const MOTIF_ART: Record<Motif, MotifArt> = {
  cutlery: { line: ["M36 26V42Q36 50 42 50Q48 50 48 42V26", "M42 26V42", "M42 50V76", "M62 54V76"], fill: ["M58 24C70 32 71 46 66 56H58Z"] },
  chefhat: { fill: ["M34 60C22 58 22 40 36 41C36 28 54 26 57 35C66 28 80 38 70 50C77 56 72 62 66 60V72H34Z"], line: ["M36 64H64"] },
  flame: { fill: ["M50 20C58 34 70 44 68 60C66 74 57 80 50 80C42 80 32 74 32 60C32 50 40 46 42 37C46 43 46 50 50 53C55 45 53 32 50 20Z"] },
  leaf: { fill: ["M26 74C26 44 46 27 76 25C76 55 58 74 28 74Z"], line: ["M28 72L60 40"] },
  star: { fill: [star(50, 52, 28, 12)] },
  fish: { fill: ["M66 50L80 38V62Z", "M22 50C32 35 56 33 68 50C56 67 32 65 22 50Z"], dots: [[34, 47, 3.4, "ink"]] },
  cup: { fill: ["M28 42H66V58C66 69 57 76 47 76C37 76 28 69 28 58Z"], line: ["M66 47C77 47 77 61 66 61", "M40 22Q35 28 40 34", "M53 22Q48 28 53 34"] },
  chilli: { fill: ["M68 32C76 38 76 50 70 58C60 70 44 78 24 78C40 70 52 58 56 44C58 36 62 31 68 32Z", "M56 36C58 29 70 26 74 33C70 38 62 39 56 36Z"], line: ["M66 30C65 24 68 20 74 19"] },
  noodles: { line: ["M66 18L50 46", "M76 22L56 48", "M34 49Q38 40 42 49Q46 40 50 49Q54 40 58 49"], fill: ["M22 50H78C78 67 65 78 50 78C35 78 22 67 22 50Z"] },
  glass: { fill: ["M26 28H74L50 54Z"], line: ["M50 54V74", "M36 76H64", "M66 18L56 34"], dots: [[56, 36, 4.5, "primary"]] },
  whisk: { fill: ["M50 60C35 49 37 20 50 18C63 20 65 49 50 60Z"], line: ["M50 60V82", "M50 22V56", "M43 26Q42 44 50 58", "M57 26Q58 44 50 58"] },
  pizza: { fill: ["M50 80L24 30Q50 16 76 30Z"], dots: [[44, 38, 5, "primary"], [57, 44, 5, "primary"], [49, 58, 4.5, "primary"]] },
  cake: { fill: ["M31 52H69L63 78H37Z", "M28 53C28 34 72 34 72 53Z"], dots: [[50, 30, 5.5, "primary"]] },
  bread: { fill: ["M22 62C22 38 78 38 78 62V72H22Z"], line: ["M38 46L34 58", "M52 44L48 58", "M66 46L62 58"] },
};

const SHAPE_ART: Record<Shape, string> = {
  circle: "M50 5A45 45 0 1 1 49.99 5Z",
  shield: "M50 5L89 17V47C89 72 71 88 50 96C29 88 11 72 11 47V17Z",
  badge: poly(12, 47, 40),
  plate: "M50 5A45 45 0 1 1 49.99 5Z",
  square: "M24 7H76Q93 7 93 24V76Q93 93 76 93H24Q7 93 7 76V24Q7 7 24 7Z",
  ribbon: "M4 16H96L84 50L96 84H4L16 50Z",
  hexagon: poly(3, 47, 47, Math.PI / 6),
  arch: "M12 94V46A38 38 0 0 1 88 46V94Z",
};

/** The logo as an SVG document (viewBox 0 0 100 100). Pure: the same brand gives the same string. */
export function logoSvg(b: Brand, size = 100): string {
  const m = MOTIF_ART[b.motif];
  const mc = motifColour(b);
  const shape = SHAPE_ART[b.shape];
  const ring = b.shape === "plate" ? `<circle cx="50" cy="50" r="32" fill="none" stroke="${onColour(b.primary)}" stroke-opacity="0.45" stroke-width="3"/>` : "";
  const g = (scale: number) => `<g transform="translate(50 50) scale(${scale}) translate(-50 -50)">`;
  const inner = b.shape === "ribbon" ? 0.72 : b.shape === "plate" ? 0.66 : 0.82;
  const lines = (m.line ?? []).map((d) => `<path d="${d}" stroke="${INK}" stroke-width="11" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join("")
    + (m.line ?? []).map((d) => `<path d="${d}" stroke="${mc}" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
  const fills = (m.fill ?? []).map((d) => `<path d="${d}" fill="${mc}" stroke="${INK}" stroke-width="3.5" stroke-linejoin="round"/>`).join("");
  const dots = (m.dots ?? []).map(([cx, cy, r, c]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c === "ink" ? INK : b.primary}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">`
    + `<path d="${shape}" fill="${b.primary}" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>${ring}`
    + `${g(inner)}${lines}${fills}${dots}</g></svg>`;
}
export const logoDataUrl = (b: Brand): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvg(b))}`;

/** The lettering: a font stack, weight, style, case and spacing for the restaurant's name. */
export function lettering(l: Letter): { family: string; weight: number; style: "normal" | "italic"; transform: "none" | "uppercase"; spacing: string } {
  switch (l) {
    case "rounded": return { family: "Fredoka, Nunito, system-ui, sans-serif", weight: 600, style: "normal", transform: "none", spacing: "0.01em" };
    case "strong": return { family: "Nunito, system-ui, sans-serif", weight: 800, style: "normal", transform: "none", spacing: "-0.01em" };
    case "caps": return { family: "Nunito, system-ui, sans-serif", weight: 800, style: "normal", transform: "uppercase", spacing: "0.08em" };
    case "slanted": return { family: "Nunito, system-ui, sans-serif", weight: 700, style: "italic", transform: "none", spacing: "0" };
  }
}
/** The canvas `font` string for the lettering at a size (postcard). */
export const letterFont = (l: Letter, px: number): string => { const f = lettering(l); return `${f.style === "italic" ? "italic " : ""}${f.weight} ${px}px ${f.family}`; };

/** The brand's CSS variables (the editor sets them on its preview box; `applyBrand` on the page). */
export function brandVars(b: Brand): Record<string, string> {
  const f = lettering(b.letter);
  return {
    "--brand-primary": b.primary,
    "--brand-accent": b.accent,
    "--on-brand-primary": onColour(b.primary),
    "--on-brand-accent": onColour(b.accent),
    "--brand-uniform": b.uniformColour,
    "--brand-logo": `url("${logoDataUrl(b)}")`,
    // the header's awning stripe and the floor canvas's awning (handson awningColours reads it on resize)
    "--awning": `repeating-linear-gradient(90deg, ${b.primary} 0 28px, ${b.accent} 28px 56px)`,
    "--brand-font": f.family,
    "--brand-weight": String(f.weight),
    "--brand-style": f.style,
    "--brand-transform": f.transform,
    "--brand-spacing": f.spacing,
  };
}

// ── the live brand (one per page) ──
let current: Brand | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const currentBrand = (): Brand | null => current;
/** The brand on screen now (null on the title screen); re-renders when it changes. */
export const useBrand = (): Brand | null => useSyncExternalStore(subscribe, currentBrand, currentBrand);

/** Put a brand on the page (or take it off with null): CSS variables, `data-brand`/`data-menu-style`, the floor canvas. */
export function applyBrand(b: Brand | null): void {
  if (current && b && encodeBrand(current) === encodeBrand(b)) return;
  current = b;
  setCanvasBrand(b ? { uniform: b.uniform, colour: b.uniformColour, accent: b.accent } : null);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    const vars = brandVars(b ?? defaultBrand(""));
    for (const k of Object.keys(vars)) { if (b) root.style.setProperty(k, vars[k]!); else root.style.removeProperty(k); }
    if (b) { root.dataset.brand = "on"; root.dataset.menuStyle = b.menu; } else { delete root.dataset.brand; delete root.dataset.menuStyle; }
  }
  listeners.forEach((l) => l());
}

/** A staff portrait's uniform (the Staff tab's cards). */
export function avatarUniform(b: Brand | null, role: StaffRole): UniformPatch | undefined {
  return b ? uniformPatch(role, b.uniform, b.uniformColour, b.accent) : undefined;
}
export { dress };
