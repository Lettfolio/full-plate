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
 *    Round 14 (C, red-team S14-7): the saves move before the index (which goes last, and only once every other key
 *    is across), each copy is read back before the old key goes, and until every key is across the page reads through
 *    a **merged view**: the scoped key if there is one, else the old one (and a write to a key still in the old place
 *    goes there, in place, needing no extra room). So no index ever points at a save it can't reach, and with the
 *    storage full the old location stays in charge. `storageFull()` is then true: the save notice says so.
 * 3. **Blocked storage.** `deviceStorage()` is null when localStorage throws (Safari private mode, blocked site data):
 *    the save store then keeps its slots in memory and says "Not saved". `prefsStorage()` never fails: it falls
 *    back to one in-memory store for the visit, so settings, onboarding flags, the challenge, the co-op host flag and
 *    the rest keep working until the tab closes.
 */

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

/** Keys this game owns (legacy and current). Only these are migrated. */
export const KEY_PREFIX = "full-plate:";
const MIGRATED = "full-plate:ns-migrated:v1";
/** The save store's index (state/saveStore.ts INDEX_KEY; not imported: saveStore imports this file). Moves last. */
const INDEX = "full-plate:slots:v1";

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

/** The un-scoped keys this game owns, the index last. */
function legacyKeys(raw: StorageLike): string[] {
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) { const k = raw.key(i); if (k !== null && k.startsWith(KEY_PREFIX) && k !== MIGRATED) out.push(k); }
  return out.sort((a, b) => Number(a === INDEX) - Number(b === INDEX));
}

/**
 * Moves the un-scoped `full-plate:` keys under the scope, once. True when every key is across (or there is no scope).
 * Exported for the tests.
 */
export function migrateToScope(raw: Storage, scope: string): boolean {
  if (!scope) return true;
  const view = scoped(raw, scope);
  try {
    if (view.getItem(MIGRATED) === "1") return true;
    let complete = true;
    for (const k of legacyKeys(raw)) {
      // R14 (S14-7): the index goes only when every save it lists has gone first.
      if (k === INDEX && !complete) break;
      const v = raw.getItem(k);
      if (v === null) continue;
      let copied = false;
      try {
        if (view.getItem(k) === null) {
          view.setItem(k, v); copied = true;
          if (view.getItem(k) !== v) throw new Error("copy didn't land");
        }
        if (raw.getItem(k) === v) raw.removeItem(k); // (another tab may have written it since: then keep both, retry)
        else complete = false;
      } catch {
        complete = false; // no room: the old key stays in charge; next visit tries again
        if (copied) try { raw.removeItem(`${scope}/${k}`); } catch { /* blocked */ }
      }
    }
    if (complete) view.setItem(MIGRATED, "1");
    return complete;
  } catch { return false; /* blocked mid-way: next visit */ }
}

/**
 * R14 (S14-7): until the migration is complete, the scoped key if there is one, else the old one; a write to a key
 * still in the old place stays there; a remove clears both.
 */
function merged(raw: Storage, scope: string): StorageLike {
  const pre = `${scope}/`;
  const view = scoped(raw, scope);
  const old = (k: string) => k.startsWith(KEY_PREFIX) && k !== MIGRATED;
  const all = (): string[] => {
    const out: string[] = [];
    for (let i = 0; i < view.length; i++) { const k = view.key(i); if (k !== null) out.push(k); }
    for (const k of legacyKeys(raw)) if (!out.includes(k)) out.push(k);
    return out;
  };
  return {
    getItem: (k) => raw.getItem(pre + k) ?? (old(k) ? raw.getItem(k) : null),
    setItem: (k, v) => { if (old(k) && raw.getItem(pre + k) === null && raw.getItem(k) !== null) raw.setItem(k, v); else raw.setItem(pre + k, v); },
    removeItem: (k) => { raw.removeItem(pre + k); if (old(k)) raw.removeItem(k); },
    key: (i) => all()[i] ?? null,
    get length() { return all().length; },
  };
}

let cached: { scope: string; raw: Storage; view: StorageLike; full: boolean } | null = null;

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
  const done = migrateToScope(raw, scope);
  cached = { scope, raw, view: !scope ? raw : done ? scoped(raw, scope) : merged(raw, scope), full: !done };
  return cached.view;
}

/** R14 (S14-7): the device's storage was too full to finish moving the saves (they still load, from the old keys). */
export function storageFull(): boolean {
  deviceStorage();
  return !!cached?.full;
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
