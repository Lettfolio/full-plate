import { useEffect, useRef } from "react";
import type { GameState } from "@full-plate/sim-core";
import { deserialize, serialize } from "../sim";

export const SAVE_KEY = "full-plate:save:v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // storage blocked (private mode, sandboxed iframe)
  }
}

export function saveGame(game: GameState, storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    if (game.phase === "gameover") storage.removeItem(SAVE_KEY); // a finished run is not "continuable"
    else storage.setItem(SAVE_KEY, serialize(game));
    return true;
  } catch {
    return false;
  }
}

/** Returns null when there is no save, it is unreadable, or the run had ended. */
export function loadGame(storage: StorageLike | null = defaultStorage()): GameState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return null;
    const game = deserialize(raw);
    return game.phase === "gameover" ? null : game;
  } catch {
    return null;
  }
}

export function clearSave(storage: StorageLike | null = defaultStorage()): void {
  try { storage?.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

/**
 * Autosave whenever the phase (or day) changes — never per tick. Entering service saves the
 * tick-0 service state, so closing the tab mid-service and pressing Continue replays that
 * service from 12:00 (ticks are not saved).
 */
export function useAutosave(game: GameState | null, storage?: StorageLike | null) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!game) { last.current = null; return; }
    const key = `${game.seed}:${game.day}:${game.phase}`;
    if (last.current === key) return;
    last.current = key;
    saveGame(game, storage === undefined ? defaultStorage() : storage);
  }, [game, storage]);
}
