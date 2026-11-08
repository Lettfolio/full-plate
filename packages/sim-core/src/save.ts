/** Save/load with versioned migrations. Serialization is canonical (sorted keys) so equal states give equal strings. */
import { SAVE_VERSION } from "./constants";
import type { GameState } from "./types";

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * MIGRATIONS[n] takes a version-n save. For n < SAVE_VERSION it returns a version n+1 save;
 * MIGRATIONS[SAVE_VERSION] normalises the current shape (identity for version 1).
 */
export const MIGRATIONS: Record<number, Migration> = {
  1: (raw) => raw,
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = canonical(v);
    }
    return out;
  }
  return value;
}

export function serialize(state: GameState): string {
  return JSON.stringify(canonical(state));
}

export function deserialize(json: string): GameState {
  let raw = JSON.parse(json) as Record<string, unknown>;
  if (!raw || typeof raw !== "object") throw new Error("Save is not an object");
  let version = typeof raw.version === "number" ? raw.version : 1;
  if (version > SAVE_VERSION) throw new Error(`Save version ${version} is newer than this game (${SAVE_VERSION})`);
  for (; version <= SAVE_VERSION; version++) {
    const migrate = MIGRATIONS[version];
    if (!migrate) throw new Error(`No migration from save version ${version}`);
    raw = migrate(raw);
  }
  raw.version = SAVE_VERSION;
  const state = raw as unknown as GameState;
  if (!Array.isArray(state.rngState) || state.rngState.length !== 4) throw new Error("Save has invalid RNG state");
  return state;
}
