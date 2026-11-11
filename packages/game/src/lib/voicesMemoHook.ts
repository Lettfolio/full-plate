import { useEffect } from "react";
import type { GameState } from "@full-plate/sim-core";
import type { PathMeta, VoicesMemo } from "../state/paths";

/**
 * Round 13 (D): after each day ends (an owner's game, any phase but service), the lazy voices chunk folds the new day
 * into the regulars' memo and hands it to the reducer (`voicesMemo`), so the Regulars book and the clipping outlive
 * sim-core's 400-day history. Main chunk: just this. A save without a memo is backfilled the first time it runs.
 */
export function useVoicesMemo(game: GameState | null, meta: PathMeta, put: (memo: VoicesMemo) => void): void {
  const last = game && game.phase !== "service" && meta.mode === "owner" && !meta.challenge ? game.history.at(-1)?.day ?? -1 : -1;
  const have = meta.voices && game && meta.voices.seed === game.seed ? meta.voices.day : -1;
  useEffect(() => {
    if (!game || last < 0 || have >= last) return;
    let live = true;
    void import("./voicesMemo").then((m) => { if (live) put(m.memoFrom(game, meta.voices)); }, () => {});
    return () => { live = false; };
  }, [last, have]); // eslint-disable-line react-hooks/exhaustive-deps
}
