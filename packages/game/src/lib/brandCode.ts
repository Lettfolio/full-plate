/**
 * Round 12 (B): the brand kit's data — what a brand is, how it is written into a save (one short code string in
 * `PathMeta.brand` and the slot summary) and how a uniform dresses a person. No React, no DOM, no CSS: the save check,
 * the floor canvas and the brand screens all import it, and none of them pulls the others in.
 *
 * Code: `1.<shape>.<motif>.<letter>.<primary>.<accent>.<uniform>.<uniformColour>.<menu>` — colours are 6 lowercase hex
 * digits. A part that isn't known any more falls back to the restaurant's derived default (`parseBrand`), so a code
 * from a later version still loads.
 */
import type { StaffRole } from "@full-plate/sim-core";

export const SHAPES = ["circle", "shield", "badge", "plate", "square", "ribbon", "hexagon", "arch"] as const;
export const MOTIFS = ["cutlery", "chefhat", "flame", "leaf", "star", "fish", "cup", "chilli", "noodles", "glass", "whisk", "pizza", "cake", "bread"] as const;
export const LETTERS = ["rounded", "strong", "caps", "slanted"] as const;
export const UNIFORMS = ["apron", "tee", "shirt", "waistcoat"] as const;
export const MENUS = ["classic", "modern", "chalkboard"] as const;

export type Shape = (typeof SHAPES)[number];
export type Motif = (typeof MOTIFS)[number];
export type Letter = (typeof LETTERS)[number];
export type UniformStyle = (typeof UNIFORMS)[number];
export type MenuStyle = (typeof MENUS)[number];

export interface Brand {
  shape: Shape;
  motif: Motif;
  letter: Letter;
  /** House colours, `#rrggbb`: the logo, awning, menu header, postcard and header chip. */
  primary: string;
  accent: string;
  uniform: UniformStyle;
  uniformColour: string;
  menu: MenuStyle;
}

/** Any well-formed code (unknown words are allowed: they fall back on parse). The save check uses this. */
export const BRAND_RE = /^1(\.[a-z]{1,12}){3}(\.[0-9a-f]{6}){2}\.[a-z]{1,12}\.[0-9a-f]{6}\.[a-z]{1,12}$/;

const hex6 = (c: string) => c.replace("#", "").toLowerCase();
export const encodeBrand = (b: Brand): string =>
  ["1", b.shape, b.motif, b.letter, hex6(b.primary), hex6(b.accent), b.uniform, hex6(b.uniformColour), b.menu].join(".");

const one = <T extends string>(list: readonly T[], v: string | undefined, d: T): T => (list.includes(v as T) ? (v as T) : d);

/** A code back to a brand; anything missing or unknown comes from `fallback`. Never throws. */
export function parseBrand(code: string | undefined, fallback: Brand): Brand {
  if (typeof code !== "string" || !BRAND_RE.test(code)) return fallback;
  const [, shape, motif, letter, p, a, uniform, u, menu] = code.split(".");
  return {
    shape: one(SHAPES, shape, fallback.shape),
    motif: one(MOTIFS, motif, fallback.motif),
    letter: one(LETTERS, letter, fallback.letter),
    primary: `#${p}`,
    accent: `#${a}`,
    uniform: one(UNIFORMS, uniform, fallback.uniform),
    uniformColour: `#${u}`,
    menu: one(MENUS, menu, fallback.menu),
  };
}

/** The parts of a person (sprite `Look` or portrait `AvatarSpec`) a uniform changes. */
export interface UniformPatch { body?: string; apron?: string; shirt?: boolean; trim?: string; hatColour?: string }

const WHITES = "#f6f1e7";

/**
 * How the house uniform dresses someone. Chefs keep their whites and toque and wear the colour as a neckerchief (and the
 * apron, if the style is an apron); everyone else wears the style in the uniform colour, with the accent as the bow tie
 * or neckerchief.
 */
export function uniformPatch(role: StaffRole, style: UniformStyle, colour: string, accent: string): UniformPatch {
  if (role === "chef") return style === "apron" ? { trim: colour, apron: colour } : { trim: colour };
  const cap = role === "server" || role === "bar" ? { hatColour: colour } : {};
  switch (style) {
    case "apron": return { body: WHITES, shirt: false, apron: colour, trim: accent, ...cap };
    case "tee": return { body: colour, shirt: false, apron: undefined, trim: undefined, ...cap };
    case "shirt": return { body: colour, shirt: false, apron: undefined, trim: accent, ...cap };
    case "waistcoat": return { body: colour, shirt: true, apron: undefined, trim: accent, ...cap };
  }
}

/** A person (sprite look or portrait spec) in the house uniform (front-of-house patches clear their own apron/trim). */
export const dress = <T extends UniformPatch>(person: T, patch: UniformPatch | undefined): T => (patch ? { ...person, ...patch } : person);
