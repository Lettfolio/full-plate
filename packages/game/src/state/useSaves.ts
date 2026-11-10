import { useEffect, useRef, useSyncExternalStore } from "react";
import type { GameState } from "@full-plate/sim-core";
import type { PathMeta } from "./paths";
import { MINUTES_PER_TICK } from "../sim";

/** Ticks in one sim-hour of service. */
export const SERVICE_HOUR_TICKS = Math.max(1, Math.round(60 / MINUTES_PER_TICK));
import { getSaveStore, type SaveStore, type StoreStatus } from "./saveStore";

/** Round 9: the slot list and the store's status, live. */
export function useSaves(store: SaveStore = getSaveStore()) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** What the header's save mark says about the game being played. */
export type SaveMark = "account" | "saving" | "device" | "memory" | "failed";
export function saveMark(status: StoreStatus, slotId: string): SaveMark {
  if (status.failed?.includes(slotId)) return "failed";
  if (status.cloud === "on" && !status.stalled?.includes(slotId) && !status.blocked?.includes(slotId)) return status.pending.includes(slotId) ? "saving" : "account";
  return status.local ? "device" : "memory";
}

/** The title screen's one line on where games are kept. */
export function saveNote(status: StoreStatus): { icon: "cloud" | "cloudOff" | "warning"; text: string } {
  if (status.cloud === "on") return { icon: "cloud", text: "Your games are saved to your account ✓" };
  if (!status.local) return { icon: "warning", text: "Not saved — this browser won't keep games. Use Save to a file." };
  return { icon: "cloudOff", text: status.reason === "signed-out" ? "Saved on this device only — sign in to keep it everywhere" : "Saved on this device only" };
}

/**
 * The autosave key: a save on every phase or day change and on path changes — never per tick (as round 1–8).
 * Round 11 (D, U11): during service also once per sim-hour and when a hands-on shift starts or stops, so a reload
 * mid-shift loses at most an hour of the clock and goes back into hands-on play.
 */
export function autosaveKey(game: GameState, m: PathMeta): string {
  const hour = game.phase === "service" ? `:h${Math.floor(game.tick / SERVICE_HOUR_TICKS)}:${m.handsOn?.role ?? ""}` : "";
  return `${m.mode}:${game.seed}:${game.day}:${game.phase}:${m.fork.chosen ?? ""}:${m.empire?.nextId ?? ""}:${m.stars?.nextId ?? ""}:${m.stars?.ledger.persistentMult ?? ""}:${m.career?.day ?? ""}:${m.career?.log.length ?? ""}:${m.career?.handover ? 1 : 0}${hour}`;
}

/**
 * Round 9: autosave into the current slot. Same cadence as round 1–8's useAutosave (phase/day changes); the store
 * writes the device copy at once and the account copy after a quiet spell.
 */
export function useSlotAutosave(store: SaveStore, slotId: string | null, game: GameState | null, meta: PathMeta) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!game || !slotId) { last.current = null; return; }
    const key = `${slotId}:${autosaveKey(game, meta)}`;
    if (last.current === key) return;
    last.current = key;
    void store.save(slotId, game, meta);
  }, [store, slotId, game, meta]);
}
