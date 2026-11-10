/**
 * Per-frame drawing state shared by the RestaurantView modules (split out of RestaurantView.ts in round 11, no
 * behaviour change). These are ES live bindings: `RestaurantView` sets them (palette on resize, decor and motion each
 * frame) and the scene/paint modules read them while that frame is drawn.
 */
import { FLOOR_DEFAULTS, type FloorPalette } from "./floorPalette";
import type { RoomLook } from "./decorArt";

/** The live palette (replaced on resize from the canvas's CSS variables). */
export let C: FloorPalette = { ...FLOOR_DEFAULTS };

/**
 * Round 10: the decor art (decorArt.ts) is its own small chunk, loaded the first time a decorated room is drawn (or
 * by the Decorate tab). Until it lands — and always for a room that was never decorated — the round-8 picture is
 * drawn; `D.key` joins the static-layer key, so the scene rebuilds once when it arrives.
 */
export let art: typeof import("./decorArt") | null = null;
let artLoad: Promise<void> | null = null;
export function loadDecorArt(): Promise<void> {
  return (artLoad ??= import("./decorArt").then((m) => { art = m; }));
}
export const PLAIN: Pick<RoomLook, "key" | "closed"> & { items: Partial<RoomLook["items"]> } = { key: "", closed: [], items: {} };
/** What the room is decorated with (set per frame). */
export let D: RoomLook = PLAIN as RoomLook;
/** 1, or 0 under reduced motion (no bob, sway, pulse or flicker). Set per frame. */
export let motion = 1;

/** Round 11 split: the setters RestaurantView uses (an imported binding can't be assigned from outside). */
export function setPalette(p: FloorPalette) { C = p; }
export function setFrame(look: RoomLook, m: number) { D = look; motion = m; }
