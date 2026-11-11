/**
 * Round 13 (E, red-team S12): every localStorage read and write goes through here.
 *
 * 1. **Namespaced by path.** GitHub Pages serves every project of one account from one origin
 *    (`<owner>.github.io/<repo>/`), so all of them share one localStorage. Keys are prefixed with the page's first path
 *    segment (`full-plate/full-plate:settings:v1` on `/full-plate/`), so a second copy of the game (or anything else
 *    using `full-plate:` keys) at another path can't overwrite this one's saves. At the root of an origin (`vite
 *    preview`, the tests, a custom domain) the scope is empty and the keys are exactly what they always were.
 *    This stops collisions, not reading: a page on the same origin can still read any key (the browser's rule, not
 *    ours); the saves hold no secrets, and the account copy lives in claude.ai, not here.
 * 2. **One-time migration.** The first time a scoped page opens, every un-scoped `full-plate:` key is moved under the
 *    scope (copied, then the old one removed only when the copy landed; a key the scope already has is left alone).
 *    A copy that runs out of room leaves that key where it was and tries again next visit.
 * 3. **Blocked storage.** `deviceStorage()` is null when localStorage throws (Safari private mode, blocked site data):
 *    the save store then keeps its slots in memory and says "Not saved". `prefsStorage()` never fails: it falls
 *    back to one in-memory store for the visit, so settings, onboarding flags, the challenge, the co-op host flag and
 *    the rest keep working until the tab closes.
 */

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** Keys this game owns (legacy and current). Only these are migrated. */
export const KEY_PREFIX = "full-plate:";
const MIGRATED = "full-plate:ns-migrated:v1";

/** The scope for a pathname: its first directory segment, or "" at the root of an origin. */
export function scopeOf(pathname: string): string {
  const dir = pathname.slice(0, pathname.lastIndexOf("/") + 1); // drop "index.html"
  const first = dir.split("/").find(Boolean) ?? "";
  // Keep it readable and bounded; an odd character can't make two scopes collide in a way that matters here.
  return decodeURIComponentSafe(first).replace(/[^\w.-]/g, "_").slice(0, 60);
}
function decodeURIComponentSafe(s: string): string { try { return decodeURIComponent(s); } catch { return s; } }

const currentScope = (): string => { try { return scopeOf(window.location.pathname); } catch { return ""; } };

/** A Storage view that prefixes every key with `<scope>/` and lists only its own keys. */
function scoped(raw: Storage, scope: string): StorageLike {
  const pre = `${scope}/`;
  const own = (): string[] => {
    const out: string[] = [];
    for (let i = 0; i < raw.length; i++) { const k = raw.key(i); if (k !== null && k.startsWith(pre)) out.push(k.slice(pre.length)); }
    return out;
  };
  return {
    getItem: (k) => raw.getItem(pre + k),
    setItem: (k, v) => raw.setItem(pre + k, v),
    removeItem: (k) => raw.removeItem(pre + k),
    key: (i) => own()[i] ?? null,
    get length() { return own().length; },
  };
}

/** Moves the un-scoped `full-plate:` keys under the scope, once. Exported for the tests. */
export function migrateToScope(raw: Storage, scope: string): void {
  if (!scope) return;
  const view = scoped(raw, scope);
  try {
    if (view.getItem(MIGRATED) === "1") return;
    const legacy: string[] = [];
    for (let i = 0; i < raw.length; i++) { const k = raw.key(i); if (k !== null && k.startsWith(KEY_PREFIX)) legacy.push(k); }
    let complete = true;
    for (const k of legacy) {
      const v = raw.getItem(k);
      if (v === null) continue;
      try {
        if (view.getItem(k) === null) view.setItem(k, v);
        raw.removeItem(k);
      } catch { complete = false; /* no room: leave it where it was, try again next visit */ }
    }
    if (complete) view.setItem(MIGRATED, "1");
  } catch { /* blocked mid-way: next visit */ }
}

let cached: { scope: string; raw: Storage; view: StorageLike } | null = null;

/** The device's localStorage, namespaced for this page; null when storage is blocked. */
export function deviceStorage(): StorageLike | null {
  let raw: Storage;
  try { raw = window.localStorage; } catch { return null; }
  const scope = currentScope();
  if (cached && cached.raw === raw && cached.scope === scope) return cached.view;
  try {
    const probe = `${KEY_PREFIX}probe`;
    raw.setItem(probe, "1"); raw.removeItem(probe);
  } catch { return null; }
  migrateToScope(raw, scope);
  cached = { scope, raw, view: scope ? scoped(raw, scope) : raw };
  return cached.view;
}

/** Memory for the visit when the device storage is blocked. */
const memory = new Map<string, string>();
const memoryStorage: StorageLike = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => { memory.set(k, String(v)); },
  removeItem: (k) => { memory.delete(k); },
  key: (i) => [...memory.keys()][i] ?? null,
  get length() { return memory.size; },
};

/** Device storage, or memory for this visit when it is blocked. Never null, never throws on access (writes may: full). */
export function prefsStorage(): StorageLike {
  return deviceStorage() ?? memoryStorage;
}

/** Tests: forget the cached view and the visit's memory. */
export function resetStorageForTests(): void { cached = null; memory.clear(); }
