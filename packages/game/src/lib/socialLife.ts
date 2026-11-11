/**
 * Round 14 (B): what a game leaves in the shared db goes with it. Deleting a game (Your games › Delete) or losing it
 * (game over) stops its share (snapshot, and the "I share" marker if it was the last) and ends a co-op day it was
 * hosting (the host document is deleted). Lazy: loaded only at those two moments. Without the Claude link it does
 * nothing (there is nothing shared). Visitors' reviews are theirs (only they can write their documents): they point
 * at a code that now opens nothing.
 */
import type { GameState } from "@full-plate/sim-core";
import { forgetShare, gameKey, link } from "../state/share";
import type { SaveStore } from "../state/saveStore";
import { endHosting } from "./coop/session";
import { getHostFlag, setHostFlag } from "./coop/hostFlag";

/** Stop sharing this game and end its co-op day, if any. Never throws. */
export async function forgetGameSocial(g: Pick<GameState, "seed" | "districtId" | "restaurantName">): Promise<void> {
  const key = gameKey(g);
  const f = getHostFlag();
  if (f && f.game === key) setHostFlag(null);
  try {
    const l = await link();
    if ("off" in l) return;
    if (f && f.game === key) await endHosting(l, f.code).catch(() => {});
    await forgetShare(l, key).catch(() => {});
  } catch { /* nothing shared, or no db: nothing to do */ }
}

/**
 * Before a slot is deleted: read which game it holds (this device's copy only — `peek` writes nothing), then let the
 * delete go ahead while the shared documents are removed in the background. A slot with no copy on this device (an
 * account-only game deleted on a new device) can't be matched, so its share stays: UI-NOTES "Round 14 — B" has the gap.
 */
export async function forgetSlotSocial(store: Pick<SaveStore, "load">, slotId: string): Promise<void> {
  let game: GameState | null = null;
  try { game = (await store.load(slotId, { peek: true }))?.loaded.game ?? null; } catch { /* unreadable: nothing to match */ }
  if (game) void forgetGameSocial(game);
}
