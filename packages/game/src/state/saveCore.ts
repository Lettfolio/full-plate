/**
 * Round 9: the save store itself (a chunk the main-chunk facade in saveStore.ts loads at startup). Device copy here;
 * the account half (saveCloud.ts), packing (saveCodec.ts) and slot housekeeping + files (saveFiles.ts) load on use.
 * A closure rather than a class so the minifier can shorten its names. docs/SAVES.md has the design.
 */
import type { GameState } from "@full-plate/sim-core";
import { encodeSave } from "./save";
import type { PathMeta } from "./paths";
import { tryDecode } from "./saveCheck";
import {
  CLOUD_DEBOUNCE_MS, defaultSlotName, defaultStorage, fnv1a, hasCompression, INDEX_KEY, lastOwner, MAX_OWN_UNPACKED, MAX_SLOTS, migrateLegacy, newSlotId, pickSummary, runtime, slotKey, summarize, visibleTo,
  type CloudPart, type Core, type Encoding, type LoadOptions, type LoadResult, type LocalEntry, type PrefsBridge, type SaveStore, type SlotView, type StoreDeps, type StoreStatus,
} from "./saveStore";

/** gzip/base64 live in a lazy chunk (saveCodec.ts); the device copy needs them only after the first save. */
const codec = () => import("./saveCodec");

export function createSaveStore(deps: StoreDeps = {}): SaveStore & { core: Core } {
  const now = deps.now ?? Date.now;
  const d: Core["d"] = {
    storage: deps.storage === undefined ? defaultStorage() : deps.storage,
    cloud: deps.cloud,
    now,
    debounceMs: deps.debounceMs ?? CLOUD_DEBOUNCE_MS,
    compress: deps.compress ?? hasCompression(),
    newId: deps.newId ?? (() => `s${Math.floor(Math.random() * 36 ** 6).toString(36)}${(now() % 1296).toString(36)}`),
    retryMs: deps.retryMs ?? (() => 400 + Math.random() * 800),
  };
  const storage = d.storage;
  const index = new Map<string, LocalEntry>();
  const memory: Core["memory"] = new Map();
  const synced = new Map<string, string>();
  const chains = new Map<string, Promise<unknown>>();
  const renameNext = new Map<string, string | undefined>();
  const listeners = new Set<() => void>();
  let snapshot: { slots: SlotView[]; status: StoreStatus } | null = null;

  const iso = (t = now()) => new Date(t).toISOString();
  const emit = () => { snapshot = null; for (const l of listeners) l(); };
  const writeIndex = () => {
    const slots = [...index.values()].map((e) => ({ ...e, syncedHash: synced.get(e.slotId) ?? null }));
    try { storage?.setItem(INDEX_KEY, JSON.stringify({ v: 1, slots })); } catch { /* full or blocked */ }
  };
  const writeBlob = (slotId: string, encoding: Encoding, data: string) => {
    if (!storage) return false;
    try { storage.setItem(slotKey(slotId), `${encoding}:${data}`); core.st.localFailed = false; return true; } catch { core.st.localFailed = true; return false; }
  };
  const readBlob = async (slotId: string) => {
    try {
      const v = storage?.getItem(slotKey(slotId));
      if (!v) return null;
      const i = v.indexOf(":");
      const enc = v.slice(0, i) as Encoding, data = v.slice(i + 1);
      return enc === "json" ? data : await (await codec()).unpack(enc, data, MAX_OWN_UNPACKED);
    } catch { return null; }
  };
  const dropLocal = (slotId: string) => {
    index.delete(slotId); synced.delete(slotId); core.blocked.delete(slotId); core.failed.delete(slotId); writeIndex();
    try { storage?.removeItem(slotKey(slotId)); } catch { /* ignore */ }
  };
  const serial = <T,>(key: string, fn: () => Promise<T>): Promise<T> => {
    const next = (chains.get(key) ?? Promise.resolve()).then(fn, fn);
    chains.set(key, next.catch(() => {}));
    return next;
  };
  const markSynced = (slotId: string, hash: string) => {
    if (synced.get(slotId) !== hash) { synced.set(slotId, hash); writeIndex(); }
    core.dirty.delete(slotId);
  };
  const schedulePush = (slotId: string) => {
    if (core.st.cloud === "off") { core.dirty.delete(slotId); return; }
    if (!core.part) return; // pushed when the account connects
    clearTimeout(core.timers.get(slotId));
    core.timers.set(slotId, setTimeout(() => { core.timers.delete(slotId); void core.part?.push(slotId); }, d.debounceMs));
  };

  /** Every slot, newest first. */
  const list = (): SlotView[] => {
    const out = new Map<string, SlotView>(), hashes = new Map<string, string>();
    const localOk = !!storage && !core.st.localFailed;
    // Round 11 (S5): another account's games on a shared browser stay hidden (and are never pushed or deleted).
    const mine = (id: string) => visibleTo({ owner: memory.has(id) ? memory.get(id)!.owner : index.get(id)?.owner }, core.viewer);
    for (const e of index.values()) if (mine(e.slotId)) { out.set(e.slotId, { ...pickSummary(e), where: "device" }); hashes.set(e.slotId, e.hash); }
    // This visit's saves are newer than the index (which is written after packing).
    for (const m of memory.values()) {
      const id = m.summary.slotId;
      if (!mine(id)) continue;
      out.set(id, { ...m.summary, where: localOk || index.get(id)?.hash === m.hash ? "device" : "memory" });
      hashes.set(id, m.hash);
    }
    if (core.st.cloud === "on") core.part?.merge(out, hashes, localOk);
    for (const id of core.blocked.keys()) { const v = out.get(id); if (v) { v.cantSync = true; if (v.where === "account") v.where = localOk ? "device" : "memory"; } }
    return [...out.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  };
  const uniqueId = () => { let id = d.newId(); while (list().some((s) => s.slotId === id)) id = d.newId(); return id; };
  const freeCount = () => Math.max(0, MAX_SLOTS - list().length);

  const putRaw = (slotId: string, raw: string, game: GameState, meta: PathMeta, nameOverride?: string, updatedAt?: string, backupOf?: string): Promise<void> => {
    const hash = fnv1a(raw);
    const old = memory.get(slotId);
    const fresh = renameNext.has(slotId);
    const name = nameOverride ?? (fresh ? renameNext.get(slotId) : (old?.summary ?? index.get(slotId) ?? core.headers.get(slotId))?.name) ?? defaultSlotName(game, meta);
    renameNext.delete(slotId);
    if (old && old.hash === hash && old.summary.name === name) return Promise.resolve();
    const of = backupOf ?? (fresh ? undefined : (old?.summary ?? index.get(slotId))?.backupOf);
    const summary = { ...summarize(slotId, name, game, meta, updatedAt ?? iso()), ...(of ? { backupOf: of } : {}) };
    // Round 11 (S5): tied to the account this visit reached (else the slot's existing tie, else untied for now).
    const owner = core.st.as ?? old?.owner ?? index.get(slotId)?.owner;
    memory.set(slotId, { raw, hash, summary, owner });
    core.dirty.add(slotId);
    emit();
    return serial(`local:${slotId}`, async () => {
      if (memory.get(slotId)?.hash !== hash) return; // a newer save is queued behind this one
      if (storage) {
        const p = await codec().then((m) => m.pack(raw, d.compress), () => ({ encoding: "json" as const, data: raw }));
        if (memory.get(slotId)?.hash !== hash) return;
        const hw = index.get(slotId)?.hw;
        if (writeBlob(slotId, p.encoding, p.data)) { index.set(slotId, { ...summary, hash, syncedHash: null, ...(owner ? { owner } : {}), ...(hw ? { hw } : {}) }); writeIndex(); }
      }
      schedulePush(slotId);
      emit();
    });
  };

  const core: Core = {
    d, index, memory, headers: new Map(), synced, dirty: new Set(), inflight: new Set(), stalled: new Set(), blocked: new Map(), failed: new Set(), viewer: lastOwner(storage), timers: new Map(),
    st: { cloud: "waiting", localFailed: false, prefsEarly: false }, prefs: null, part: null,
    emit, writeIndex, writeBlob, readBlob, dropLocal, serial, putRaw, markSynced, schedulePush, uniqueId, list, renameNext, connecting: null,
  };

  // The round 1–8 saves become slots 1 and 2 (once; the facade has usually done it already), then the local index.
  migrateLegacy(storage, now(), uniqueId);
  try {
    const raw = storage?.getItem(INDEX_KEY);
    for (const e of raw ? (JSON.parse(raw) as { slots?: LocalEntry[] }).slots ?? [] : []) {
      if (!e || typeof e.slotId !== "string" || typeof e.hash !== "string") continue;
      // Round 11 (S1): every field coerced to its type before anything renders it.
      const syncedHash = typeof e.syncedHash === "string" ? e.syncedHash : null;
      index.set(e.slotId, { ...pickSummary(e), hash: e.hash, syncedHash, ...(typeof e.owner === "string" ? { owner: e.owner } : {}), ...(Number.isInteger(e.hw) ? { hw: e.hw } : {}) });
      if (syncedHash) synced.set(e.slotId, syncedHash);
    }
  } catch { /* unreadable index: start empty */ }
  const ops = () => import("./saveFiles");

  return {
    /** Internals for saveCloud.ts / tests. */
    core,
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => (snapshot ??= { slots: list(), status: status() }),
    status,
    list,
    freeCount,
    /** A new slot id if one of the six is free. */
    freeSlotId: () => (freeCount() ? uniqueId() : null),
    /** The next save to this slot is a new game: it takes `name` (or the restaurant's name). */
    beginNew: (slotId: string, name?: string) => { renameNext.set(slotId, name?.trim() || undefined); },

    /**
     * Autosave: the device copy is written at once (after packing, a few ms); the account copy follows after
     * `debounceMs` of quiet, and only if the save changed. Round 11: a game that has ended is kept too (its summary is
     * `archived`, "Lost — day N" in Your games) — save never removes a slot.
     */
    save(slotId: string, game: GameState, meta: PathMeta): Promise<void> {
      // Round 11 (G10): a state that can't be packed (a NaN from a junk command) must never break autosave; the save
      // mark says "Couldn't save" until a save works again.
      let raw: string;
      try { raw = encodeSave(game, meta); } catch {
        if (!core.failed.has(slotId)) { core.failed.add(slotId); emit(); }
        return Promise.resolve();
      }
      if (core.failed.delete(slotId)) emit();
      return putRaw(slotId, raw, game, meta);
    },

    /** Push now (Save & quit). Resolves with where the game is now kept. */
    async flush(slotId: string): Promise<"account" | "device" | "memory" | "none"> {
      await chains.get(`local:${slotId}`);
      clearTimeout(core.timers.get(slotId)); core.timers.delete(slotId);
      if (core.st.cloud === "waiting") await core.connecting;
      if (core.part && core.st.cloud === "on") await core.part.push(slotId);
      if (core.st.cloud === "on" && !core.dirty.has(slotId) && core.headers.has(slotId)) return "account";
      const m = memory.get(slotId), e = index.get(slotId);
      if (e && (!m || e.hash === m.hash)) return "device";
      return m ? "memory" : "none";
    },

    /**
     * Reach the account (call after the first paint: the first db call may show a consent prompt). Idempotent. A
     * refusal or no viewer turns the cloud off for this visit; nothing retries in a loop.
     */
    connect(): Promise<void> {
      return (core.connecting ??= runtime() || d.cloud ? import("./saveCloud").then((m) => m.connect(core), () => {}) : Promise.resolve().then(() => {
        // Outside claude.ai there is no window.claude: no account, and no need to load its chunk.
        core.st.cloud = "off"; core.st.reason = "none"; core.dirty.clear(); emit();
      }));
    },

    /**
     * The game in a slot, settling device vs account (saveCloud.ts): the same game → the device copy; only one side
     * changed since they last agreed → that side; both changed → `choose` (default: the newer), and the other copy is
     * kept as "Backup of <name>". Null when no copy can be read.
     */
    async load(slotId: string, opts: LoadOptions = {}): Promise<LoadResult | null> {
      // Don't keep a child waiting on a slow account: a few seconds, then the device copy (a later push settles it).
      if (core.st.cloud === "waiting" && core.connecting) await Promise.race([core.connecting, new Promise((r) => setTimeout(r, 4000))]);
      const m = memory.get(slotId), e = index.get(slotId);
      const local = { raw: m?.raw ?? (e ? await readBlob(slotId) : null), summary: m?.summary ?? (e ? pickSummary(e) : null), from: m ? "memory" as const : "device" as const };
      if (core.part && core.st.cloud === "on" && !opts.peek) return core.part.load(slotId, local, opts);
      if (!local.raw || !local.summary) return null;
      const loaded = tryDecode(local.raw);
      return loaded ? { loaded, summary: local.summary, from: local.from } : null;
    },

    /** Rename (saveFiles.ts; the account's header too). */
    rename: async (slotId: string, name: string) => (await ops()).rename(core, slotId, name),
    /** Delete everywhere: on the account the header goes first (so it stops listing), then its chunks. */
    remove: async (slotId: string) => (await ops()).remove(core, slotId),

    /** A save file for the slot: its text and suggested file name (saveFiles.ts). */
    exportFile: async (slotId: string) => (await ops()).exportFile(core, slotId),
    /** Export, then offer it (the `downloads` capability inside claude.ai, else an `<a download>` link). */
    saveToFile: async (slotId: string) => (await ops()).saveToFile(core, slotId),
    /** Reads a save file into a free slot (or `intoSlotId`). Throws a child-readable message when it can't. */
    importFile: async (text: string, intoSlotId?: string) => (await ops()).importFile(core, text, intoSlotId),

    // ── prefs (settings + onboarding flags), one small doc ──
    attachPrefs(bridge: PrefsBridge) { core.prefs = bridge; },
    /** Settings or an onboarding flag changed: mirror to the account (debounced). */
    prefsChanged() { if (core.st.cloud === "waiting") core.st.prefsEarly = true; else core.part?.prefsChanged(); },

    /** Tests: stop timers. */
    dispose() { for (const t of core.timers.values()) clearTimeout(t); core.timers.clear(); core.part?.dispose(); },
  };

  function status(): StoreStatus {
    return {
      cloud: core.st.cloud, ...(core.st.reason ? { reason: core.st.reason } : {}), local: !!storage && !core.st.localFailed,
      pending: [...new Set([...core.dirty, ...core.inflight])].filter((id) => !core.stalled.has(id) && !core.blocked.has(id)),
      stalled: [...core.stalled], ...(core.blocked.size ? { blocked: [...core.blocked.keys()] } : {}), ...(core.failed.size ? { failed: [...core.failed] } : {}),
    };
  }
}

