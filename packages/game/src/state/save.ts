import { useEffect, useRef } from "react";
import type { GameState } from "@full-plate/sim-core";
import { serializeCareer, deserializeCareer } from "@full-plate/sim-career";
import { serialize as serializeEmpire, deserialize as deserializeEmpire } from "@full-plate/sim-empire";
import { serializeStars, deserializeStars } from "@full-plate/sim-stars";
import { deserialize, serialize } from "../sim";
import { initialMeta, type PathMeta } from "./paths";

/** The owner game. Round 1–2 saves (a bare sim-core GameState) still load from here. */
export const SAVE_KEY = "full-plate:save:v1";
/** Career (employee start) games save separately, so an owner save and a career can coexist. */
export const CAREER_SAVE_KEY = "full-plate:career:v1";
/** Envelope version. 1 = { v, game, meta } (paths, fork, career). */
export const ENVELOPE_VERSION = 1;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // storage blocked (private mode, sandboxed iframe)
  }
}

/**
 * The save envelope. Each layer keeps its own serialiser, so the envelope stores their strings: sim-core's GameState,
 * sim-career's CareerState, sim-empire's and sim-stars' state. The rest of PathMeta (fork, flags, events) is plain JSON.
 */
interface Envelope {
  kind: "full-plate";
  v: number;
  game: string;
  career?: string;
  empire?: string;
  stars?: string;
  meta: Omit<PathMeta, "career" | "empire" | "stars">;
}

export interface Loaded {
  game: GameState;
  meta: PathMeta;
}

export function encodeSave(game: GameState, meta: PathMeta): string {
  const { career, empire, stars, ...rest } = meta;
  const env: Envelope = {
    kind: "full-plate",
    v: ENVELOPE_VERSION,
    game: serialize(game),
    ...(career ? { career: serializeCareer(career) } : {}),
    ...(empire ? { empire: serializeEmpire(empire) } : {}),
    ...(stars ? { stars: serializeStars(stars) } : {}),
    // Transient UI bits are not saved: a live hands-on session, tonight's event lists.
    // Round 11 (D, U11): a live shift is remembered as "resume hands-on" (role only); load restarts it at the saved tick.
    meta: { ...rest, handsOn: undefined, handsOnResume: game.phase !== "service" ? undefined : meta.handsOn ? { role: meta.handsOn.role, jumpIn: meta.handsOn.jumpIn } : meta.handsOnResume, careerEvents: [], starsEvents: [] },
  };
  return JSON.stringify(env);
}

/** Decodes an envelope, or a bare round 1–2 GameState (meta = a plain owner game). Throws when unreadable. */
export function decodeSave(raw: string): Loaded {
  const parsed = JSON.parse(raw) as Partial<Envelope> & { version?: number; magic?: string; encoding?: string; data?: unknown };
  // Round 9: a save file (saveStore.ts) with an uncompressed body reads here too; a gzip one needs decodeSaveFile (async).
  if (parsed.magic === "full-plate-save-file") {
    if (parsed.encoding === "json" && typeof parsed.data === "string") return decodeSave(parsed.data);
    throw new Error("Compressed save file: read it with decodeSaveFile");
  }
  if (parsed.kind !== "full-plate") return { game: deserialize(raw), meta: initialMeta("owner") };
  if (typeof parsed.v !== "number" || parsed.v > ENVELOPE_VERSION) throw new Error(`Unknown save version ${String(parsed.v)}`);
  const meta: PathMeta = {
    ...initialMeta(parsed.meta?.mode ?? "owner"),
    ...(parsed.meta ?? {}),
    ...(parsed.career ? { career: deserializeCareer(parsed.career) } : {}),
    ...(parsed.empire ? { empire: deserializeEmpire(parsed.empire) } : {}),
    ...(parsed.stars ? { stars: deserializeStars(parsed.stars) } : {}),
  };
  return { game: deserialize(parsed.game!), meta };
}

const keyFor = (meta: PathMeta) => (meta.mode === "career" ? CAREER_SAVE_KEY : SAVE_KEY);

export function saveGame(game: GameState, metaOrStorage?: PathMeta | StorageLike | null, storageArg?: StorageLike | null): boolean {
  // Round 1–2 call shape: saveGame(game, storage).
  const isStorage = (x: unknown): x is StorageLike => !!x && typeof (x as StorageLike).getItem === "function";
  const meta = isStorage(metaOrStorage) || metaOrStorage == null ? initialMeta() : metaOrStorage;
  const storage = isStorage(metaOrStorage) ? metaOrStorage : storageArg === undefined ? defaultStorage() : storageArg;
  if (!storage) return false;
  const key = keyFor(meta);
  try {
    if (game.phase === "gameover" && meta.mode === "owner") storage.removeItem(key); // a finished run is not "continuable"
    else storage.setItem(key, encodeSave(game, meta));
    return true;
  } catch {
    return false;
  }
}

/** Returns null when there is no save, it is unreadable, or the run had ended. */
export function loadSave(key: string = SAVE_KEY, storage: StorageLike | null = defaultStorage()): Loaded | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const l = decodeSave(raw);
    return l.game.phase === "gameover" && l.meta.mode === "owner" ? null : l;
  } catch {
    return null;
  }
}

/** Round 1–2 API: the owner save's GameState. */
export function loadGame(storage: StorageLike | null = defaultStorage()): GameState | null {
  return loadSave(SAVE_KEY, storage)?.game ?? null;
}

export function clearSave(storage: StorageLike | null = defaultStorage(), key: string = SAVE_KEY): void {
  try { storage?.removeItem(key); } catch { /* ignore */ }
}

/**
 * Autosave whenever the phase (or day) changes — never per tick. Entering service saves the
 * tick-0 service state, so closing the tab mid-service and pressing Continue replays that
 * service from 12:00 (ticks are not saved). Path changes (fork chosen, an empire command, a career move) also save.
 */
export function useAutosave(game: GameState | null, storage?: StorageLike | null, meta?: PathMeta) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!game) { last.current = null; return; }
    const m = meta ?? initialMeta();
    const key = `${m.mode}:${game.seed}:${game.day}:${game.phase}:${m.fork.chosen ?? ""}:${m.empire?.nextId ?? ""}:${m.stars?.nextId ?? ""}:${m.stars?.ledger.persistentMult ?? ""}:${m.career?.day ?? ""}:${m.career?.log.length ?? ""}:${m.career?.handover ? 1 : 0}`;
    if (last.current === key) return;
    last.current = key;
    // Once a career becomes the player's own restaurant it is still saved under the career key (its history lives there).
    saveGame(game, m, storage === undefined ? defaultStorage() : storage);
  }, [game, storage, meta]);
}
