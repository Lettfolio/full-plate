/**
 * Round 9: save slots that survive a reload, a cleared browser and a change of device.
 *
 * Three layers behind one async store (docs/SAVES.md has the full design):
 *   1. account saves — the artifact runtime's `db` capability, in the viewer's private `data/users/<id>/` collection,
 *      gzip + base64 and chunked (saveCloud.ts, a lazy chunk loaded by `connect()`);
 *   2. a local cache in localStorage (the same packed blob, unchunked) so a reload while offline still continues (here);
 *   3. save files (`fullplate-<name>-day<N>.fpsave.json`) that work everywhere, by hand (saveFiles.ts, lazy).
 * Every layer is optional: with no `window.claude`, no localStorage and no CompressionStream the store still keeps the
 * slots in memory for the visit and says so truthfully (`status()`).
 *
 * Nothing here feeds the sim: `updatedAt` is wall-clock UI metadata ("played 2 days ago") and conflict ordering only.
 * This file is the main-chunk part: the types, the legacy migration, and a facade that shows the slot list at first paint
 * (from the local index) while the store itself (saveCore.ts) loads as a chunk right away; every call waits for it.
 */
import type { GameState } from "@full-plate/sim-core";
import { CAREER_SAVE_KEY, decodeSave, SAVE_KEY, type Loaded } from "./save";
import type { PathMeta } from "./paths";

export const MAX_SLOTS = 6;
/** Cloud writes are trailing-debounced by this much; local writes are not. */
export const CLOUD_DEBOUNCE_MS = 3000;
export const INDEX_KEY = "full-plate:slots:v1";
export const MIGRATED_KEY = "full-plate:slots-migrated:v1";
export const slotKey = (slotId: string): string => `full-plate:slot:v1:${slotId}`;
/** Round 11 (S5): a hash of the last account seen on this device, so another account's games stay hidden from first paint. */
export const OWNER_KEY = "full-plate:owner:v1";

// ── round 11 limits (red-team S2, S4, S6, S10) ──
/** Characters of base64 per chunk document (well under the 256 KiB document cap once wrapped in JSON). */
export const CHUNK_SIZE = 180_000;
/** Chunks per slot: a header saying more is damaged. */
export const MAX_CHUNKS = 8;
/** Packed size of one slot on the account (~1 MB): a bigger game stays on this device ("can't sync"). */
export const MAX_PACKED = 1_000_000;
/** Save files bigger than this are refused before they are read. */
export const MAX_FILE_BYTES = 5_000_000;
/** A save file inflates to at most this much (a gzip bomb stops here). */
export const MAX_UNPACKED = 8 * 1024 * 1024;
/** This device's and this account's own copies may be bigger (old Empire saves with many parked sites). */
export const MAX_OWN_UNPACKED = 96 * 1024 * 1024;
/** Backups kept per game: the two newest. */
export const MAX_BACKUPS = 2;

export type SlotPath = "owner" | "career" | "empire" | "stars";
/** How a blob is packed: gzip then base64; plain base64 of UTF-8 (no CompressionStream); or the raw envelope (local only). */
export type Encoding = "gzip-b64" | "b64" | "json";

/** What the slot picker shows. */
export interface SlotSummary {
  slotId: string;
  name: string;
  mode: PathMeta["mode"];
  restaurantName: string;
  /** Sim day (0-based; the game shows day + 1). */
  day: number;
  /** Pence: the restaurant's cash, or a career's savings. */
  cash: number;
  path: SlotPath;
  difficulty: GameState["difficulty"];
  /** ISO wall-clock time of the last save. UI metadata only. */
  updatedAt: string;
  /** Round 11: a "Backup of …" slot remembers which game it backs up (at most MAX_BACKUPS each). */
  backupOf?: string;
  /** Round 11: the game has ended (the bank closed it). Kept, greyed, as "Lost — day N"; absent = still playing. */
  archived?: boolean;
}

/** The header document `data/users/<id>/save-<slotId>`. Written after its chunks, so a half-written save never lists. */
export interface CloudHeader extends SlotSummary {
  kind: "save";
  chunkCount: number;
  encoding: "gzip-b64" | "b64";
  /** Length of the raw envelope (characters). */
  bytes: number;
  /** Length of the packed base64 text across all chunks. */
  packedLength: number;
  /** FNV-1a of the raw envelope: equal hashes = the same game. */
  hash: string;
  /** Chunk bank: chunks live at `save-<slotId>/chunks/<bank>-<n>`; each write uses the other bank. */
  bank: "a" | "b";
  appVersion: string;
  /** Round 11 (S6): the most chunks either bank of this slot has ever been given; delete up to here (orphans). */
  hw?: number;
}

export interface LocalEntry extends SlotSummary {
  hash: string;
  /** The hash this device and the account last agreed on (null = never synced). */
  syncedHash: string | null;
  /** Round 11 (S5): hash of the account this game belongs to (absent = not yet tied to one: the next account claims it). */
  owner?: string;
  /** Round 11 (S6): most chunks this device has started writing for the slot (a push that failed half-way). */
  hw?: number;
}

export interface SlotView extends SlotSummary {
  /** Where the newest copy is known to be. */
  where: "account" | "device" | "memory";
  /** Round 11 (S2): the account refused this game (too big or damaged), so it stays on this device. */
  cantSync?: true;
}

export type CloudState = "waiting" | "on" | "off";
/**
 * none = not inside claude.ai; signed-out = no viewer id; refused = the first call was refused; error = a later write was;
 * full = quota; slot = (round 11, per slot) the account refused this one game, the others still sync.
 */
export type CloudOffReason = "none" | "signed-out" | "refused" | "error" | "full" | "slot";

export interface StoreStatus {
  cloud: CloudState;
  reason?: CloudOffReason;
  /** localStorage works. */
  local: boolean;
  /** Slots with a cloud write queued or in flight. */
  pending: string[];
  /** Slots whose last cloud write failed for now (they go up with the next save): only on this device meanwhile. */
  stalled?: string[];
  /** Round 11 (S2): slots the account refused outright (too big / damaged): kept on this device, the rest still sync. */
  blocked?: string[];
  /** Round 11 (G10): slots whose last autosave couldn't be written at all (the game couldn't be packed). */
  failed?: string[];
}

// ── the subset of the db capability the store uses (db.d.ts) ──
export interface MiniSnap { id: string; exists: boolean; data(): Record<string, unknown> | undefined }
export interface MiniDocRef {
  get(): Promise<MiniSnap>;
  set(data: Record<string, unknown>): Promise<void>;
  update(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  collection(path: string): MiniCollection;
}
export interface MiniCollection {
  doc(id: string): MiniDocRef;
  get(): Promise<{ docs: MiniSnap[] }>;
  onSnapshot(next: (s: { docs: MiniSnap[] }) => void, error?: (e: { code: string }) => void): () => void;
}
export interface MiniDb { collection(path: string): MiniCollection }
export type CloudConn = { db: MiniDb; uid: string } | { off: CloudOffReason };

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface ClaudeRuntime { use(name: string): Promise<unknown> }
/** `window.claude` when the page runs inside claude.ai (it carries only `use`), else null. */
export const runtime = (): ClaudeRuntime | null => {
  try {
    const c = (window as unknown as { claude?: ClaudeRuntime }).claude;
    return c && typeof c.use === "function" ? c : null;
  } catch { return null; }
};

export function defaultStorage(): StorageLike | null {
  try {
    const s = window.localStorage, k = "full-plate:probe";
    s.setItem(k, "1"); s.removeItem(k);
    return s;
  } catch { return null; }
}

// ── packing ──
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0") + s.length.toString(36);
}
export const hasCompression = (): boolean => typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";

// ── summaries ──
export function slotPath(meta: PathMeta): SlotPath {
  return meta.mode === "career" && meta.career && !meta.career.handover ? "career" : meta.empire ? "empire" : meta.stars ? "stars" : "owner";
}
export function defaultSlotName(game: GameState, meta: PathMeta): string {
  // Round 11 (U12): a blank career name is "You" in sim-career — "Your career", never "You's career".
  const who = slotPath(meta) === "career" ? meta.career!.playerName?.trim() : "";
  return who ? (who === "You" ? "Your career" : `${who}'s career`) : game.restaurantName || "My restaurant";
}
export function summarize(slotId: string, name: string, game: GameState, meta: PathMeta, updatedAt: string): SlotSummary {
  const path = slotPath(meta);
  return pickSummary({ slotId, name, mode: meta.mode, restaurantName: game.restaurantName, day: game.day, cash: path === "career" ? meta.career!.savings : game.cash, path, difficulty: game.difficulty, updatedAt, ...(isLost(game, meta) ? { archived: true } : {}) });
}
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
/** Round 11 (S1, S12): text for the picker, whatever the index or a header holds: a string, safe characters, ≤ 40. */
export const safeName = (v: unknown, max = 40): string => (typeof v === "string" ? v.replace(UNSAFE, "").slice(0, max) : "");
const fin = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** A summary's fields, coerced to their types (round 11: a damaged index entry or header can't reach the UI as an object). */
export const pickSummary = (s: SlotSummary): SlotSummary => ({
  slotId: String(s.slotId),
  name: safeName(s.name) || "My game",
  mode: s.mode === "career" ? "career" : "owner",
  restaurantName: safeName(s.restaurantName),
  day: Math.max(0, Math.floor(fin(s.day))),
  cash: fin(s.cash),
  path: s.path === "career" || s.path === "empire" || s.path === "stars" ? s.path : "owner",
  difficulty: s.difficulty === "cosy" || s.difficulty === "hard" ? s.difficulty : "normal",
  updatedAt: typeof s.updatedAt === "string" ? s.updatedAt.slice(0, 40) : "",
  ...(typeof s.backupOf === "string" ? { backupOf: s.backupOf.slice(0, 80) } : {}),
  ...(s.archived === true ? { archived: true } : {}),
});
/** Round 11 (S5): the device's last account, as a hash (null outside an account). */
export function lastOwner(storage: StorageLike | null): string | null {
  try { return storage?.getItem(OWNER_KEY) ?? null; } catch { return null; }
}
/** Is this index entry visible to `viewer` (an owner hash)? Untied entries are everyone's until an account claims them. */
export const visibleTo = (e: { owner?: string | undefined }, viewer: string | null): boolean => !viewer || !e.owner || e.owner === viewer;
/**
 * Round 11 (U3): a finished game is never deleted. The bank closed it (any path but a career that's still running —
 * an employer going bust isn't her game ending): it is archived, kept and greyed as "Lost — day N" in Your games.
 */
export const isLost = (game: GameState, meta: PathMeta): boolean => {
  if (slotPath(meta) === "career") return false;
  // Round 11 (G1, C): an Empire ends only when it is bankrupt — a bust hands-on shop while it runs is HQ's to cover
  // (pathEngine backTill / "Close this shop and move on"). Same rule as pathEngine.runIsOver, kept here so the main
  // chunk doesn't import pathEngine. "Try again from the last board meeting" saves a running Empire: un-archived.
  if (meta.empire) return meta.empire.status === "bankrupt";
  return game.phase === "gameover";
};
/** Round 9 removed an ended owner game on save; round 11 keeps every game (archived), so nothing is "over" enough to drop. */
export const isOver = (_game: GameState, _meta: PathMeta) => false;

// ── the store ──
export interface StoreDeps {
  /** localStorage (default) — `null` for none. */
  storage?: StorageLike | null;
  /** How to reach the account store. Default: `window.claude.use("db"/"user")` (saveCloud.ts `defaultCloud`). */
  cloud?: () => Promise<CloudConn>;
  now?: () => number;
  debounceMs?: number;
  /** Use CompressionStream (default: when the browser has it). */
  compress?: boolean;
  newId?: () => string;
  /** Wait before the one retry of an `unavailable` cloud call. */
  retryMs?: () => number;
}

export interface LoadOptions {
  /** Both copies changed since they last agreed: which one to play. Default: the newer one. */
  choose?: (local: SlotSummary, cloud: SlotSummary) => Promise<"local" | "cloud">;
}
export interface LoadResult {
  loaded: Loaded;
  summary: SlotSummary;
  from: "memory" | "device" | "account";
  /** When the two copies had both changed, the one not picked was kept here. */
  backupSlotId?: string;
}

export interface Prefs { settings?: Record<string, unknown>; onboard?: string[] }
export interface PrefsBridge {
  /** Current local prefs. */
  read(): Prefs;
  /** Prefs from the account (applied without writing back). */
  adopt(p: Prefs): void;
  /** Round 11 (S5): this device's cached prefs belonged to another account: drop them (defaults until the account's arrive). */
  forget?(): void;
}

/** The account half (saveCloud.ts), loaded by connect(). */
export interface CloudPart {
  push(slotId: string): Promise<void>;
  load(slotId: string, local: { raw: string | null; summary: SlotSummary | null; from: "memory" | "device" }, opts: LoadOptions): Promise<LoadResult | null>;
  rename(slotId: string, name: string): Promise<void>;
  /** `hwHint`: chunks this device may have written (the local entry is gone by the time this runs). */
  remove(slotId: string, hwHint?: number): Promise<void>;
  fetch(slotId: string): Promise<{ raw: string; header: CloudHeader } | null>;
  prefsChanged(): void;
  /** The account's side of list(): headers merged over this device's slots. */
  merge(out: Map<string, SlotView>, hashes: Map<string, string>, localOk: boolean): void;
  dispose(): void;
}

/** The store's working parts, shared with its lazy halves. Not for UI code. */
export interface Core {
  d: Required<Omit<StoreDeps, "storage" | "cloud">> & { storage: StorageLike | null; cloud: (() => Promise<CloudConn>) | undefined };
  index: Map<string, LocalEntry>;
  /** Raw envelopes this visit (also the only copy when nothing else works). `owner`: as LocalEntry.owner. */
  memory: Map<string, { raw: string; hash: string; summary: SlotSummary; owner?: string | undefined }>;
  headers: Map<string, CloudHeader>;
  /** Per slot: the hash this device and the account last agreed on. */
  synced: Map<string, string>;
  dirty: Set<string>;
  inflight: Set<string>;
  stalled: Set<string>;
  /** Round 11 (S2): slots the account refused outright (slot → why); the account stays on for the others. */
  blocked: Map<string, string>;
  /** Round 11 (G10): slots whose last autosave couldn't be packed. */
  failed: Set<string>;
  /** Round 11 (S5): the connected account's owner hash (or the device's last one before connect). */
  viewer: string | null;
  timers: Map<string, ReturnType<typeof setTimeout>>;
  /** `as`: (round 11) the owner hash of the account this visit connected to; new saves are tied to it. */
  st: { cloud: CloudState; reason?: CloudOffReason | undefined; localFailed: boolean; prefsEarly: boolean; as?: string };
  prefs: PrefsBridge | null;
  /** The account half, once connected. */
  part: CloudPart | null;
  emit(): void;
  writeIndex(): void;
  writeBlob(slotId: string, encoding: Encoding, data: string): boolean;
  readBlob(slotId: string): Promise<string | null>;
  dropLocal(slotId: string): void;
  serial<T>(key: string, fn: () => Promise<T>): Promise<T>;
  putRaw(slotId: string, raw: string, game: GameState, meta: PathMeta, name?: string, updatedAt?: string, backupOf?: string): Promise<void>;
  markSynced(slotId: string, hash: string): void;
  schedulePush(slotId: string): void;
  uniqueId(): string;
  list(): SlotView[];
  /** Slots whose next save is a new game (beginNew): slot → name. */
  renameNext: Map<string, string | undefined>;
  connecting: Promise<void> | null;
}

/** The store's API (saveCore.ts `createSaveStore`; `getSaveStore()` hands out a facade with the same shape). */
export interface SaveStore {
  subscribe(fn: () => void): () => void;
  getSnapshot(): { slots: SlotView[]; status: StoreStatus };
  status(): StoreStatus;
  /** Every slot, newest first. */
  list(): SlotView[];
  freeCount(): number;
  /** A new slot id if one of the six is free. */
  freeSlotId(): string | null;
  /** The next save to this slot is a new game: it takes `name` (or the restaurant's name). */
  beginNew(slotId: string, name?: string): void;
  save(slotId: string, game: GameState, meta: PathMeta): Promise<void>;
  flush(slotId: string): Promise<"account" | "device" | "memory" | "none">;
  connect(): Promise<void>;
  load(slotId: string, opts?: LoadOptions): Promise<LoadResult | null>;
  rename(slotId: string, name: string): Promise<void>;
  remove(slotId: string): Promise<void>;
  exportFile(slotId: string): Promise<{ filename: string; text: string } | null>;
  saveToFile(slotId: string): Promise<"saved" | "declined" | "failed">;
  importFile(text: string, intoSlotId?: string): Promise<SlotView>;
  attachPrefs(bridge: PrefsBridge): void;
  prefsChanged(): void;
  dispose(): void;
}

export const newSlotId = (): string => `s${Math.floor(Math.random() * 36 ** 6).toString(36)}${(Date.now() % 1296).toString(36)}`;

/** Round 9: the two pre-slot saves become slots 1 and 2, once (owner first). The old keys are left as they were. */
export function migrateLegacy(storage: StorageLike | null, now: number, newId: () => string = newSlotId): void {
  try {
    if (!storage || storage.getItem(INDEX_KEY) || storage.getItem(MIGRATED_KEY)) return;
    const slots: LocalEntry[] = [];
    for (const [key, ago] of [[SAVE_KEY, 0], [CAREER_SAVE_KEY, 60_000]] as const) {
      try {
        const raw = storage.getItem(key);
        if (!raw) continue;
        const l = decodeSave(raw);
        if (isOver(l.game, l.meta)) continue;
        const id = newId();
        storage.setItem(slotKey(id), `json:${raw}`);
        slots.push({ ...summarize(id, defaultSlotName(l.game, l.meta), l.game, l.meta, new Date(now - ago).toISOString()), hash: fnv1a(raw), syncedHash: null });
      } catch { /* unreadable legacy save: skip it */ }
    }
    storage.setItem(INDEX_KEY, JSON.stringify({ v: 1, slots }));
    storage.setItem(MIGRATED_KEY, "1");
  } catch { /* blocked or full */ }
}

/** The local index as the picker shows it (the facade's first-paint list). */
function peekSlots(storage: StorageLike | null): SlotView[] {
  try {
    const raw = storage?.getItem(INDEX_KEY);
    const viewer = lastOwner(storage);
    const list = (raw ? (JSON.parse(raw) as { slots?: LocalEntry[] }).slots ?? [] : []).filter((e) => e && typeof e.slotId === "string" && visibleTo(e, viewer));
    return list.map((e) => ({ ...pickSummary(e), where: "device" as const })).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  } catch { return []; }
}

/** First paint shows the local index; the real store (a chunk, loaded at once) takes over and every call waits for it. */
function createFacade(): SaveStore {
  const storage = defaultStorage();
  migrateLegacy(storage, Date.now());
  const peek = { slots: peekSlots(storage), status: { cloud: "waiting" as const, local: !!storage, pending: [] } };
  const listeners = new Set<() => void>();
  const pendingNew = new Map<string, string | undefined>();
  let real: SaveStore | null = null;
  let prefs: PrefsBridge | null = null;
  let prefsEarly = false;
  const ping = () => { for (const l of listeners) l(); };
  const ready = import("./saveCore").then((m) => {
    const s = m.createSaveStore({ storage });
    s.subscribe(ping);
    if (prefs) s.attachPrefs(prefs);
    for (const [id, name] of pendingNew) s.beginNew(id, name);
    if (prefsEarly) s.prefsChanged();
    real = s;
    ping();
    return s;
  });
  const via = <A extends unknown[], R>(f: (s: SaveStore, ...a: A) => Promise<R>) => (...a: A) => ready.then((s) => f(s, ...a));
  return {
    subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => real?.getSnapshot() ?? peek,
    status: () => real?.status() ?? peek.status,
    list: () => real?.list() ?? peek.slots,
    freeCount: () => real?.freeCount() ?? Math.max(0, MAX_SLOTS - peek.slots.length),
    freeSlotId: () => (real ? real.freeSlotId() : peek.slots.length < MAX_SLOTS ? newSlotId() : null),
    beginNew: (id, name) => { if (real) real.beginNew(id, name); else pendingNew.set(id, name); },
    save: via((s, id: string, g: GameState, m: PathMeta) => s.save(id, g, m)),
    flush: via((s, id: string) => s.flush(id)),
    connect: via((s) => s.connect()),
    load: via((s, id: string, o?: LoadOptions) => s.load(id, o)),
    rename: via((s, id: string, n: string) => s.rename(id, n)),
    remove: via((s, id: string) => s.remove(id)),
    exportFile: via((s, id: string) => s.exportFile(id)),
    saveToFile: via((s, id: string) => s.saveToFile(id)),
    importFile: via((s, t: string, id?: string) => s.importFile(t, id)),
    attachPrefs: (b) => { prefs = b; real?.attachPrefs(b); },
    prefsChanged: () => { if (real) real.prefsChanged(); else prefsEarly = true; },
    dispose: () => real?.dispose(),
  };
}

let shared: SaveStore | null = null;
export function getSaveStore(): SaveStore { return (shared ??= createFacade()); }
/** Tests and the playtest harness: swap the shared store. */
export function setSaveStore(s: SaveStore | null) { shared = s; }
