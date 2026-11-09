/** Versioned save/load for EmpireState. Canonical (sorted keys) so equal states give equal strings. */
import { EMPIRE_SAVE_VERSION } from "./constants";
import type { EmpireState } from "./types";

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[n] turns a version-n save into version n+1; MIGRATIONS[current] normalises the current shape. */
export const MIGRATIONS: Record<number, Migration> = {
  1: (raw) => backfillFlagship(raw),
};

/**
 * [round 6] R5 P3: the founder's flagship had no `openedTrading`, so it never matured and stayed the richest site.
 * Saves from before round 6 get the game's start (day 0) — the flagship is the restaurant the player opened then.
 * Idempotent: a flagship that already has the field (every new empire) is left alone, so new saves round-trip
 * byte-identically.
 */
function backfillFlagship(raw: Record<string, unknown>): Record<string, unknown> {
  const sites = raw.sites;
  if (!Array.isArray(sites)) return raw;
  const i = sites.findIndex((s) => s && typeof s === "object" && (s as { id?: unknown }).id === FLAGSHIP_ID);
  if (i < 0 || (sites[i] as { openedTrading?: unknown }).openedTrading !== undefined) return raw;
  const next = sites.slice();
  next[i] = { ...(sites[i] as object), openedTrading: 0 };
  return { ...raw, sites: next };
}

/** newEmpire's id for the founder's restaurant. */
const FLAGSHIP_ID = "s1";

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
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("EmpireState contains a non-finite number");
  return value;
}

export function serialize(empire: EmpireState): string {
  return JSON.stringify(canonical(empire));
}

export function deserialize(json: string): EmpireState {
  let raw = JSON.parse(json) as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || typeof raw.version !== "number") throw new Error("Not an Empire save");
  let v = raw.version as number;
  if (v > EMPIRE_SAVE_VERSION) throw new Error(`Empire save version ${v} is newer than this build (${EMPIRE_SAVE_VERSION})`);
  while (v < EMPIRE_SAVE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`No migration from Empire save version ${v}`);
    raw = m(raw);
    v = raw.version as number;
  }
  raw = MIGRATIONS[EMPIRE_SAVE_VERSION]!(raw);
  for (const k of ["brand", "contract", "sites", "franchisees", "cities", "regions", "hq", "calibration", "rngState"]) {
    if (!(k in raw)) throw new Error(`Empire save is missing ${k}`);
  }
  return raw as unknown as EmpireState;
}
