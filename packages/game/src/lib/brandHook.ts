import { useEffect } from "react";
import type { GameState } from "@full-plate/sim-core";
import type { PathMeta } from "../state/paths";

/**
 * Round 12 (B): keeps the page in the game's brand (main chunk: just this; the brand itself is the lazy lib/brand.ts).
 * The name an Empire's shops share is the brand's; a career employee wears the employer's (read-only) brand.
 */
export function useBrandStyle(game: GameState | null, meta: PathMeta): void {
  const name = game ? meta.empire?.brand.name ?? game.restaurantName : null;
  const ro = meta.mode === "career" && !!meta.career && !meta.career.handover;
  const code = meta.brand;
  useEffect(() => {
    void import("./brand").then((m) => m.applyBrand(name === null ? null : m.resolveBrand(code, name, ro)), () => {});
  }, [name, code, ro]);
}
