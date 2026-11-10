/** Hit-testing for the owner's canvas: which table a tap or click lands on (split out of RestaurantView.ts in round 11). */
import type { CustomerId, GameState, TableId } from "@full-plate/sim-core";
import type { Layout } from "./layout";

/** Which seated party (if any) is under a point in CSS pixels. */
export function pickTable(game: GameState, L: Layout, x: number, y: number): { tableId: TableId; customerId?: CustomerId } | null {
  for (const t of game.tables) {
    const s = L.tables.get(t.id);
    if (!s) continue;
    if (Math.hypot(x - s.x, y - s.y) <= s.r + L.person * 2.4) return { tableId: t.id, customerId: t.occupiedBy };
  }
  return null;
}
