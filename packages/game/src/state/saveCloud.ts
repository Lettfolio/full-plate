/**
 * Round 9: the account half of the save store (a lazy chunk, loaded by `connect()` once the title has painted).
 *
 * Layout, all inside the viewer's private collection `data/users/<id>` (db.d.ts: private even from the artifact's
 * owner; documents ≤ 256 KiB; one write at a time per document):
 *   data/users/<id>/save-<slotId>                  header (CloudHeader) — written LAST, deleted FIRST
 *   data/users/<id>/save-<slotId>/chunks/<bank>-<n>  { slotId, bank, n, data } — ≤ 180,000 base64 characters each
 *   data/users/<id>/prefs                          { kind: "prefs", settings, onboard }
 * Two chunk banks (a/b) alternate, so the old header always points at complete chunks while a new save is written.
 *
 * Round 11 (red-team S1, S2, S5, S6, S10, S11): headers are schema-checked (a bad one is ignored and this device's copy
 * goes back over it); a write the account refuses as invalid stalls that one slot ("can't sync"), not the account;
 * games belong to the account that made them (another account's never go up or get deleted here); at most two
 * backups per game; chunk deletes reach the high-water mark (no orphans); chunk reads are bounded and batched; a header
 * write that failed is re-read before the next push picks a bank.
 */
import { checkHeader, tryDecode } from "./saveCheck";
import { pack, unpack } from "./saveCodec";
import { remove as removeSlot } from "./saveFiles";
import {
  CHUNK_SIZE, fnv1a, MAX_BACKUPS, MAX_CHUNKS, MAX_OWN_UNPACKED, MAX_PACKED, OWNER_KEY, pickSummary, runtime,
  type CloudConn, type CloudHeader, type CloudOffReason, type CloudPart, type Core, type MiniCollection, type MiniDb, type MiniSnap, type SlotSummary,
} from "./saveStore";

export { CHUNK_SIZE };
export const APP_VERSION = "r11";
export const PREFS_DOC = "prefs";
/** Onboarding flags kept in the account's prefs: the newest 50 (one is added per hands-on game). */
export const MAX_ONBOARD_FLAGS = 50;
/** Chunk reads in flight at once. */
const READ_BATCH = 2;
export const headerDocId = (slotId: string): string => `save-${slotId}`;
/** The owner tag for an account: a hash of its id (the id itself never goes into localStorage). */
export const ownerOf = (uid: string): string => `o${fnv1a(`full-plate:${uid}`)}`;

export function splitChunks(data: string, size = CHUNK_SIZE): string[] {
  const out: string[] = [];
  for (let i = 0; i < data.length; i += size) out.push(data.slice(i, i + size));
  return out.length ? out : [""];
}

/** Resolves the viewer's db + id via `window.claude.use`, or why there is none. Never throws. */
export async function defaultCloud(): Promise<CloudConn> {
  const c = runtime();
  if (!c) return { off: "none" };
  try {
    const [db, user] = (await Promise.all([c.use("db"), c.use("user")])) as [MiniDb | null, { id(): Promise<string | null> } | null];
    if (!db || !user) return { off: "none" };
    const uid = await user.id();
    return uid ? { db, uid } : { off: "signed-out" };
  } catch { return { off: "none" }; }
}

const errCode = (e: unknown): string => (e && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : "unavailable");
/** Account-wide: the capability is gone or full. (`invalid_argument` is about one document: round 11 stalls that slot only.) */
const TERMINAL = new Set(["revoked", "not_granted", "capability_disabled", "capability_removed", "transform_error", "quota_exceeded"]);

/** Connects (the first read — may show the consent prompt); null when it is refused. */
export async function startCloud(c: Core, conn: { db: MiniDb; uid: string }): Promise<CloudPart | null> {
  const { d, index, memory, synced, dirty, inflight, st } = c;
  const col = (): MiniCollection => conn.db.collection(`data/users/${conn.uid}`);
  const headerRef = (slotId: string) => col().doc(headerDocId(slotId));
  const chunkRef = (slotId: string, bank: "a" | "b", n: number) => headerRef(slotId).collection("chunks").doc(`${bank}-${n}`);
  const viewer = ownerOf(conn.uid);
  /** Slots whose account header failed its schema: ignored, and this device's copy (if any) is pushed over it. */
  const badHeaders = new Set<string>();
  /** Slots whose last header write failed (it may or may not have landed): re-read before choosing a bank (S11). */
  const recheck = new Set<string>();
  let unsub: (() => void) | null = null;
  let prefsTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPrefs: string | null = null;

  const call = async <T,>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); } catch (e) {
      if (errCode(e) !== "unavailable") throw e;
      await new Promise((r) => setTimeout(r, d.retryMs()));
      return fn();
    }
  };
  const failed = (e: unknown) => {
    const code = errCode(e);
    if (TERMINAL.has(code)) {
      st.cloud = "off"; st.reason = code === "quota_exceeded" ? "full" : "error";
      unsub?.(); unsub = null;
      for (const t of c.timers.values()) clearTimeout(t);
      c.timers.clear(); dirty.clear();
    }
    c.emit();
  };
  const isMine = (slotId: string): boolean => {
    const owner = memory.has(slotId) ? memory.get(slotId)!.owner : index.get(slotId)?.owner;
    return !owner || owner === viewer;
  };
  const takeDocs = (docs: MiniSnap[]) => {
    const seen = new Map<string, CloudHeader>();
    for (const s of docs) {
      const b = s.exists ? s.data() : undefined;
      if (b?.kind !== "save") continue;
      const h = checkHeader(b);
      if (h && s.id === headerDocId(h.slotId)) { seen.set(h.slotId, h); badHeaders.delete(h.slotId); } else if (s.id.startsWith("save-")) badHeaders.add(s.id.slice(5));
    }
    // Keep our own in-flight header writes, which a snapshot may not show yet.
    for (const id of inflight) { const h = c.headers.get(id); if (h && !seen.has(id)) seen.set(id, h); }
    c.headers = seen;
  };
  const readHeader = async (slotId: string): Promise<CloudHeader | null> => {
    const hs = await call(() => headerRef(slotId).get());
    const b = hs.exists ? hs.data() : undefined;
    const h = b ? checkHeader(b) : null;
    if (h) { c.headers.set(slotId, h); badHeaders.delete(slotId); } else { c.headers.delete(slotId); if (b) badHeaders.add(slotId); }
    return h;
  };

  /** Header (always fresh) then chunks — unless the header says it's the game `sameAs` already holds (raw ""). */
  const fetch = async (slotId: string, sameAs?: string | null): Promise<{ raw: string; header: CloudHeader } | null> => {
    if (st.cloud !== "on") return null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const h = await readHeader(slotId);
        if (!h) return null;
        if (sameAs && h.hash === sameAs) return { raw: "", header: h };
        // Round 11 (S10): the header's count is bounded (checkHeader) and read a couple at a time.
        const parts: MiniSnap[] = [];
        for (let n = 0; n < h.chunkCount; n += READ_BATCH) {
          parts.push(...await Promise.all(Array.from({ length: Math.min(READ_BATCH, h.chunkCount - n) }, (_, i) => call(() => chunkRef(slotId, h.bank, n + i).get()))));
          if (parts.some((s) => !s.exists)) break;
        }
        if (parts.some((s) => !s.exists)) continue; // overwritten mid-read: once more
        const data = parts.map((s) => { const v = s.data()?.data; return typeof v === "string" ? v : ""; }).join("");
        if (data.length !== h.packedLength) continue;
        const raw = await unpack(h.encoding, data, MAX_OWN_UNPACKED).catch(() => null);
        if (raw === null) return null;
        if (fnv1a(raw) === h.hash) return { raw, header: h };
      } catch (e) { failed(e); return null; }
    }
    return null;
  };

  /**
   * Never lose a save silently: a backup takes a free slot, or a seventh one if all six are full (the picker shows it).
   * Round 11 (S6): each game keeps its two newest backups; an older one goes when a third is made.
   */
  const keepBackup = async (raw: string, s: SlotSummary, of: string): Promise<string | undefined> => {
    const l = tryDecode(raw);
    if (!l) return undefined;
    const name = `Backup of ${s.name}`.slice(0, 40);
    const old = c.list().filter((x) => x.slotId !== of && (x.backupOf === of || (!x.backupOf && x.name === name))).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    for (const x of old.slice(MAX_BACKUPS - 1)) await removeSlot(c, x.slotId);
    const id = c.uniqueId();
    // It keeps its own "last played" (a second earlier at most), so it sorts below the game being played.
    const t = new Date(d.now() - 1000).toISOString();
    await c.putRaw(id, raw, l.game, l.meta, name, s.updatedAt < t ? s.updatedAt : t, of);
    return id;
  };

  const push = (slotId: string): Promise<void> => c.serial(`cloud:${slotId}`, async () => {
    if (st.cloud !== "on" || !isMine(slotId)) { dirty.delete(slotId); return; }
    const mem = memory.get(slotId), entry = index.get(slotId);
    const raw = mem?.raw ?? (entry ? await c.readBlob(slotId) : null);
    const summary = mem?.summary ?? (entry ? pickSummary(entry) : undefined);
    if (!raw || !summary) { dirty.delete(slotId); c.emit(); return; }
    const hash = fnv1a(raw);
    // Refused before (too big / damaged): not again until the game changes.
    if (c.blocked.get(slotId) === hash) { dirty.delete(slotId); c.emit(); return; }
    let stage: "read" | "chunks" | "header" | "tidy" = "read";
    dirty.delete(slotId); inflight.add(slotId); c.emit();
    try {
      if (recheck.has(slotId)) { await readHeader(slotId); recheck.delete(slotId); }
      const prev = c.headers.get(slotId);
      if (prev?.hash === hash && prev.name === summary.name) { c.markSynced(slotId, hash); c.stalled.delete(slotId); c.blocked.delete(slotId); return; }
      // The account's copy moved on since we last agreed (played on another device while this one was offline):
      // keep it as a backup before writing over it.
      if (prev && prev.hash !== hash && prev.hash !== synced.get(slotId)) {
        const theirs = await fetch(slotId);
        if (st.cloud !== "on") throw { code: "unavailable" };
        if (theirs && theirs.header.hash !== hash) await keepBackup(theirs.raw, pickSummary(theirs.header), slotId);
      }
      const p = await pack(raw, d.compress);
      if (p.data.length > MAX_PACKED) { c.blocked.set(slotId, hash); c.stalled.delete(slotId); return; }
      const cur = c.headers.get(slotId) ?? prev;
      const bank = cur?.bank === "a" ? "b" : "a";
      const chunks = splitChunks(p.data);
      // Round 11 (S6): the high-water mark goes down before the chunks do, so a push that stops half-way leaves no
      // orphans the next one can't find.
      const hw = Math.min(MAX_CHUNKS, Math.max(chunks.length, cur?.hw ?? 0, cur?.chunkCount ?? 0, entry?.hw ?? 0));
      if (entry && (entry.hw ?? 0) < hw) { entry.hw = hw; c.writeIndex(); }
      stage = "chunks";
      for (const [n, data] of chunks.entries()) await call(() => chunkRef(slotId, bank, n).set({ slotId, bank, n, data }));
      stage = "header";
      const header: CloudHeader = { ...pickSummary(summary), kind: "save", chunkCount: chunks.length, encoding: p.encoding, bytes: raw.length, packedLength: p.data.length, hash, bank, appVersion: APP_VERSION, ...(hw > chunks.length ? { hw } : {}) };
      await call(() => headerRef(slotId).set({ ...header }));
      c.headers.set(slotId, header);
      badHeaders.delete(slotId);
      stage = "tidy";
      // The old bank, and anything in the new bank past this save's chunks, up to the high-water mark.
      if (cur) for (let n = 0; n < Math.max(hw, cur.chunkCount); n++) await call(() => chunkRef(slotId, cur.bank, n).delete()).catch(() => {});
      for (let n = chunks.length; n < hw; n++) await call(() => chunkRef(slotId, bank, n).delete()).catch(() => {});
      c.markSynced(slotId, hash);
      c.stalled.delete(slotId);
      c.blocked.delete(slotId);
    } catch (e) {
      if (stage === "header") recheck.add(slotId);
      if (errCode(e) === "invalid_argument") {
        // Round 11 (S2): the account won't take this one document (too big, too deep, bad data). This slot stays on
        // the device ("can't sync" on its card); every other game keeps syncing.
        c.blocked.set(slotId, hash);
        c.stalled.delete(slotId);
        c.emit();
      } else {
        dirty.add(slotId);
        c.stalled.add(slotId);
        failed(e);
      }
    } finally {
      inflight.delete(slotId);
      c.emit();
    }
  });

  const pushPrefs = async () => {
    if (st.cloud !== "on" || !c.prefs) return;
    const p = c.prefs.read();
    // Round 11 (S12): the newest 50 onboarding flags (one is added per hands-on game, for ever).
    const onboard = [...new Set((p.onboard ?? []).filter((k) => typeof k === "string"))].slice(-MAX_ONBOARD_FLAGS).sort();
    const body = { kind: "prefs", settings: p.settings ?? {}, onboard };
    const json = JSON.stringify(body);
    if (json === lastPrefs) return;
    await c.serial("cloud:prefs", () => call(() => col().doc(PREFS_DOC).set(body))).then(() => { lastPrefs = json; }, failed);
  };

  // ── connect: the first read ──
  let docs: MiniSnap[];
  try { docs = (await call(() => col().get())).docs; } catch { st.reason = "refused"; return null; }
  st.cloud = "on";
  takeDocs(docs);

  // Round 11 (S5): which account this device saw last. Games are tied to the account that saved them; untied ones
  // (made before any account answered) are claimed by this one, except a game an older build synced with some account
  // that isn't in this one (it may be another account's: it stays untied, untouched).
  let prevOwner: string | null = null;
  try { prevOwner = d.storage?.getItem(OWNER_KEY) ?? null; d.storage?.setItem(OWNER_KEY, viewer); } catch { /* blocked */ }
  c.viewer = viewer;
  st.as = viewer;
  let claimed = false;
  for (const e of index.values()) {
    if (e.owner) continue;
    if (synced.has(e.slotId) && !c.headers.has(e.slotId) && !badHeaders.has(e.slotId)) continue;
    e.owner = viewer; claimed = true;
  }
  if (claimed) c.writeIndex();
  for (const [id, m] of memory) if (!m.owner && (!index.has(id) || index.get(id)!.owner === viewer)) m.owner = viewer;

  // Reconcile this device's slots with the account's.
  for (const e of [...index.values()]) {
    if (e.owner !== viewer) continue; // another account's (or untied): never pushed, never deleted here
    const h = c.headers.get(e.slotId), s = synced.get(e.slotId);
    const hash = memory.get(e.slotId)?.hash ?? e.hash;
    if (!h) {
      // Synced once and unchanged here, gone from the account: it was deleted on another device. (A header that
      // failed its schema isn't "gone": this copy goes back over it.)
      if (!badHeaders.has(e.slotId) && s && hash === s && !memory.has(e.slotId)) { c.dropLocal(e.slotId); continue; }
      dirty.add(e.slotId);
    } else if (h.hash === hash) c.markSynced(e.slotId, hash);
    else if (h.hash === s) dirty.add(e.slotId); // played offline here: push it
    else if (hash !== s && !memory.has(e.slotId)) dirty.delete(e.slotId); // both changed: settled on Continue
    // Otherwise only the account moved on: the device copy is refreshed on Continue.
  }
  for (const [id, m] of memory) if (!index.has(id) && m.owner === viewer) dirty.add(id);
  c.emit();

  const part: CloudPart = {
    push,
    fetch,
    async load(slotId, local, opts) {
      const localHash = local.raw ? fnv1a(local.raw) : null;
      const sync = synced.get(slotId) ?? null;
      let cloud = isMine(slotId) ? await fetch(slotId, localHash) : null;
      if (cloud && !cloud.raw) { c.markSynced(slotId, localHash!); cloud = null; } // the same game in both places
      const useLocal = () => {
        if (!local.raw || !local.summary) return null;
        const loaded = tryDecode(local.raw);
        return loaded ? { loaded, summary: local.summary, from: local.from } : null;
      };
      const useCloud = () => {
        if (!cloud) return null;
        const loaded = tryDecode(cloud.raw);
        if (!loaded) return null;
        const summary = pickSummary(cloud.header), raw = cloud.raw, hash = cloud.header.hash;
        memory.set(slotId, { raw, hash, summary, owner: viewer });
        if (c.writeBlob(slotId, "json", raw)) {
          index.set(slotId, { ...summary, hash, syncedHash: hash, owner: viewer });
          // Repack the device copy in the background (the json copy stays if that fails).
          void pack(raw, d.compress).then((p) => { if (memory.get(slotId)?.raw === raw) c.writeBlob(slotId, p.encoding, p.data); }, () => {});
        }
        c.markSynced(slotId, hash);
        c.writeIndex();
        c.emit();
        return { loaded, summary, from: "account" as const };
      };
      if (!cloud) return useLocal();
      if (!local.raw) return useCloud();
      if (localHash === sync) return useCloud() ?? useLocal(); // only the account moved on
      if (cloud.header.hash === sync) { // only this device moved on (offline play): play it and send it up
        const r = useLocal();
        if (r) { dirty.add(slotId); void push(slotId); }
        return r ?? useCloud();
      }
      // Both changed: ask (default: the newer one); the other is kept as a backup.
      const cloudSum = pickSummary(cloud.header);
      const pick = opts.choose ? await opts.choose(local.summary!, cloudSum) : local.summary!.updatedAt >= cloudSum.updatedAt ? "local" : "cloud";
      const theirs = cloud;
      const result = pick === "local" ? useLocal() : useCloud();
      if (!result) return pick === "local" ? useCloud() : useLocal();
      const backupSlotId = await keepBackup(pick === "local" ? theirs.raw : local.raw, pick === "local" ? cloudSum : local.summary!, slotId);
      if (pick === "local") { synced.set(slotId, theirs.header.hash); dirty.add(slotId); void push(slotId); }
      return { ...result, ...(backupSlotId ? { backupSlotId } : {}) };
    },
    async rename(slotId, name) {
      if (!isMine(slotId)) return;
      await c.serial(`cloud:${slotId}`, () => call(() => headerRef(slotId).update({ name }))).catch((e) => { if (errCode(e) === "revoked") failed(e); });
    },
    async remove(slotId, hwHint = 0) {
      const h = c.headers.get(slotId);
      c.headers.delete(slotId);
      badHeaders.delete(slotId);
      await c.serial(`cloud:${slotId}`, async () => {
        try {
          const live = h ?? checkHeader((await call(() => headerRef(slotId).get())).data());
          await call(() => headerRef(slotId).delete());
          // Both banks up to the high-water mark (S6), bounded (S10).
          const count = Math.min(MAX_CHUNKS, Math.max(live?.chunkCount ?? 0, live?.hw ?? 0, hwHint, 1));
          for (const bank of ["a", "b"] as const) for (let n = 0; n < count; n++) await call(() => chunkRef(slotId, bank, n).delete()).catch(() => {});
        } catch (e) { failed(e); }
      });
      c.emit();
    },
    merge(out, hashes, localOk) {
      for (const h of c.headers.values()) {
        const mine = out.get(h.slotId);
        if (mine && h.hash === hashes.get(h.slotId)) mine.where = "account";
        else if (!mine || h.updatedAt > mine.updatedAt) {
          // Another account's game with the same slot id can't be on this account (ids are random); one hidden here stays hidden.
          if (!mine && !isMine(h.slotId)) continue;
          out.set(h.slotId, { ...pickSummary(h), where: "account" });
        }
      }
      // A slot whose newest copy is still waiting to go up is only here for now.
      for (const id of [...dirty, ...inflight]) { const v = out.get(id); if (v?.where === "account") v.where = localOk ? "device" : "memory"; }
    },
    prefsChanged() {
      if (st.cloud !== "on") return;
      clearTimeout(prefsTimer);
      prefsTimer = setTimeout(() => void pushPrefs(), d.debounceMs);
    },
    dispose() { clearTimeout(prefsTimer); unsub?.(); },
  };

  // Settings and onboarding flags: the account's settings win unless they were changed here before it answered;
  // onboarding flags are the union of both. Round 11 (S5): when this device last belonged to another account, its
  // cached settings and flags are that account's, so this account's replace them instead of merging.
  const pdoc = docs.find((x) => x.id === PREFS_DOC);
  if (c.prefs) {
    const sameAccount = !prevOwner || prevOwner === viewer;
    if (!sameAccount) c.prefs.forget?.();
    const raw = pdoc?.exists ? (pdoc.data() as { settings?: unknown; onboard?: unknown }) : undefined;
    const cloudPrefs = raw ? {
      settings: raw.settings && typeof raw.settings === "object" && !Array.isArray(raw.settings) ? raw.settings as Record<string, unknown> : undefined,
      onboard: Array.isArray(raw.onboard) ? raw.onboard.filter((k): k is string => typeof k === "string").slice(-MAX_ONBOARD_FLAGS) : [],
    } : undefined;
    if (cloudPrefs) {
      const early = st.prefsEarly && sameAccount;
      c.prefs.adopt({ ...(early || !cloudPrefs.settings ? {} : { settings: cloudPrefs.settings }), onboard: [...new Set([...cloudPrefs.onboard, ...(c.prefs.read().onboard ?? [])])] });
      lastPrefs = JSON.stringify({ kind: "prefs", settings: cloudPrefs.settings ?? {}, onboard: [...new Set(cloudPrefs.onboard)].sort() });
    }
    await pushPrefs();
  }

  try { unsub = col().onSnapshot((s) => { takeDocs(s.docs); c.emit(); }, () => { unsub = null; }); } catch { /* live updates are a nicety */ }
  return part; // connect() then schedules the pushes reconcile marked (it holds the part by then)
}

/** connect(): reach the account, or turn the cloud off for this visit (no retry loops). */
export async function connect(c: Core): Promise<void> {
  const off = (reason: CloudOffReason) => { c.st.cloud = "off"; c.st.reason ??= reason; c.dirty.clear(); };
  try {
    const conn = await (c.d.cloud ?? defaultCloud)();
    if ("off" in conn) off(conn.off);
    else c.part = await startCloud(c, conn);
  } catch { c.part = null; }
  if (!c.part) off("refused");
  for (const id of [...c.dirty]) c.schedulePush(id);
  c.emit();
}
