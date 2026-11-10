/**
 * Round 12 (B): the house uniform on the owner's floor. The brand screens set the page's brand once (`setCanvasBrand`,
 * from lib/brand.ts `applyBrand`); RestaurantView dresses each staff sprite with `brandLook` (an explicit
 * `RenderOptions.brand` wins, e.g. a preview). Cosmetic only: nothing here reads or changes the sim.
 */
import type { StaffRole } from "@full-plate/sim-core";
import type { Look } from "@full-plate/handson/sprites";
import { dress, uniformPatch, type UniformStyle } from "../lib/brandCode";

export interface CanvasBrand { uniform: UniformStyle; colour: string; accent: string }

let current: CanvasBrand | null = null;
export const setCanvasBrand = (b: CanvasBrand | null): void => { current = b; };
export const canvasBrand = (): CanvasBrand | null => current;

/** A staff sprite's look in the house uniform (unchanged with no brand). */
export function brandLook(look: Look, role: StaffRole, b: CanvasBrand | null | undefined): Look {
  return b ? dress(look, uniformPatch(role, b.uniform, b.colour, b.accent)) : look;
}
