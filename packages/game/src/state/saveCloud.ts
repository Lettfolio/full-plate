/**
 * Round 9: the account half of the save store (a lazy chunk, loaded by `connect()` once the title has painted).
 *
 * Layout, all inside the viewer's private collection `data/users/<id>` (db.d.ts: private even from the artifact's
 * owner; documents ≤ 256 KiB; one write at a time per document):
 *   data/users/<id>/save-<slotId>                  header (CloudHeader) — written LAST, deleted FIRST
 *   data/users/<id>/save-<slotId>/chunks/<bank>-<n>  { slotId, bank, n, data } — ≤ 180,000 base64 characters each
 *   data/users/<id>/prefs                          { kind: "prefs", settings, onboard }
 * Two chunk banks (a/b) alternate, so the old header always points at complete chunks while a new save is written.
 */
import { decodeSave } from "./save";
import { pack, unpack } from "./saveCodec";
import { fnv1a, pickSummary, runtime, type CloudConn, type CloudHeader, type CloudOffReason, type CloudPart, type Core, type MiniCollection, type MiniDb, type MiniSnap, type SlotSummary } from "./saveStore";

/** Characters of base64 per chunk document (well under the 256 KiB document cap once wrapped in JSON). */
export const CHUNK_SIZE = 180_000;
export const APP_VERSION = "r9";
export const PREFS_DOC = "prefs";
export const headerDocId = (slotId: string): string => `save-${slotId}`;

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
const TERMINAL = new Set(["invalid_argument", "revoked", "not_granted", "capability_disabled", "capability_removed", "transform_error", "quota_exceeded"]);

/** Connects (the first read — may show the consent prompt); null when it is refused. */
export async function startCloud(c: Core, conn: { db: MiniDb; uid: string }): Promise<CloudPart | null> {
  const { d, index, memory, synced, dirty, inflight, st } = c;
  const col = (): MiniCollection => conn.db.collection(`data/users/${conn.uid}`);
  const headerRef = (slotId: string) => col().doc(headerDocId(slotId));
  const chunkRef = (slotId: string, bank: "a" | "b", n: number) => headerRef(slotId).collection("chunks").doc(`${bank}-${n}`);
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
  const takeDocs = (docs: MiniSnap[]) => {
    const seen = new Map<string, CloudHeader>();
    for (const s of docs) {
      const b = s.exists ? s.data() : undefined;
      if (b?.kind === "save" && typeof b.slotId === "string" && typeof b.hash === "string") seen.set(b.slotId, b as unknown as CloudHeader);
    }
    // Keep our own in-flight header writes, which a snapshot may not show yet.
    for (const id of inflight) { const h = c.headers.get(id); if (h && !seen.has(id)) seen.set(id, h); }
    c.headers = seen;
  };

  /** Header (always fresh) then chunks — unless the header says it's the game `sameAs` already holds (raw ""). */
  const fetch = async (slotId: string, sameAs?: string | null): Promise<{ raw: string; header: CloudHeader } | null> => {
    if (st.cloud !== "on") return null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const hs = await call(() => headerRef(slotId).get());
        const h = hs.exists ? (hs.data() as unknown as CloudHeader) : undefined;
        if (h?.kind !== "save") { c.headers.delete(slotId); return null; }
        c.headers.set(slotId, h);
        if (sameAs && h.hash === sameAs) return { raw: "", header: h };
        const parts = await Promise.all(Array.from({ length: h.chunkCount }, (_, n) => call(() => chunkRef(slotId, h.bank, n).get())));
        if (parts.some((s) => !s.exists)) continue; // overwritten mid-read: once more
        const data = parts.map((s) => String(s.data()?.data ?? "")).join("");
        if (data.length !== h.packedLength) continue;
        const raw = await unpack(h.encoding, data);
        if (fnv1a(raw) === h.hash) return { raw, header: h };
      } catch (e) { failed(e); return null; }
    }
    return null;
  };

  /** Never lose a save: a backup takes a free slot, or a seventh one if all six are full (the picker shows it). */
  const keepBackup = async (raw: string, s: SlotSummary): Promise<string | undefined> => {
    const id = c.uniqueId();
    try {
      const l = decodeSave(raw);
      // It keeps its own "last played" (a second earlier at most), so it sorts below the game being played.
      const t = new Date(d.now() - 1000).toISOString();
      await c.putRaw(id, raw, l.game, l.meta, `Backup of ${s.name}`.slice(0, 40), s.updatedAt < t ? s.updatedAt : t);
      return id;
    } catch { return undefined; }
  };

  const push = (slotId: string): Promise<void> => c.serial(`cloud:${slotId}`, async () => {
    if (st.cloud !== "on") return;
    const mem = memory.get(slotId), entry = index.get(slotId);
    const raw = mem?.raw ?? (entry ? await c.readBlob(slotId) : null);
    const summary = mem?.summary ?? (entry ? pickSummary(entry) : undefined);
    if (!raw || !summary) { dirty.delete(slotId); c.emit(); return; }
    const hash = fnv1a(raw);
    const prev = c.headers.get(slotId);
    if (prev?.hash === hash && prev.name === summary.name) { c.markSynced(slotId, hash); c.stalled.delete(slotId); c.emit(); return; }
    dirty.delete(slotId); inflight.add(slotId); c.emit();
    try {
      // The account's copy moved on since we last agreed (played on another device while this one was offline):
      // keep it as a backup before writing over it.
      if (prev && prev.hash !== hash && prev.hash !== synced.get(slotId)) {
        const theirs = await fetch(slotId);
        if (st.cloud !== "on") throw { code: "unavailable" };
        if (theirs && theirs.header.hash !== hash) await keepBackup(theirs.raw, pickSummary(theirs.header));
      }
      const p = await pack(raw, d.compress);
      const cur = c.headers.get(slotId) ?? prev;
      const bank = cur?.bank === "a" ? "b" : "a";
      const chunks = splitChunks(p.data);
      for (const [n, data] of chunks.entries()) await call(() => chunkRef(slotId, bank, n).set({ slotId, bank, n, data }));
      const header: CloudHeader = { ...pickSummary(summary), kind: "save", chunkCount: chunks.length, encoding: p.encoding, bytes: raw.length, packedLength: p.data.length, hash, bank, appVersion: APP_VERSION };
      await call(() => headerRef(slotId).set({ ...header }));
      c.headers.set(slotId, header);
      if (cur) for (let n = 0; n < cur.chunkCount; n++) await call(() => chunkRef(slotId, cur.bank, n).delete()).catch(() => {});
      c.markSynced(slotId, hash);
      c.stalled.delete(slotId);
    } catch (e) {
      dirty.add(slotId);
      c.stalled.add(slotId);
      failed(e);
    } finally {
      inflight.delete(slotId);
      c.emit();
    }
  });

  const pushPrefs = async () => {
    if (st.cloud !== "on" || !c.prefs) return;
    const p = c.prefs.read();
    const body = { kind: "prefs", settings: p.settings ?? {}, onboard: [...new Set(p.onboard ?? [])].sort() };
    const json = JSON.stringify(body);
    if (json === lastPrefs) return;
    await c.serial("cloud:prefs", () => call(() => col().doc(PREFS_DOC).set(body))).then(() => { lastPrefs = json; }, failed);
  };

  // ── connect: the first read ──
  let docs: MiniSnap[];
  try { docs = (await call(() => col().get())).docs; } catch { st.reason = "refused"; return null; }
  st.cloud = "on";
  takeDocs(docs);

  // Reconcile this device's slots with the account's.
  for (const e of [...index.values()]) {
    const h = c.headers.get(e.slotId), s = synced.get(e.slotId);
    const hash = memory.get(e.slotId)?.hash ?? e.hash;
    if (!h) {
      // Synced once and unchanged here, gone from the account: it was deleted on another device.
      if (s && hash === s && !memory.has(e.slotId)) { c.dropLocal(e.slotId); continue; }
      dirty.add(e.slotId);
    } else if (h.hash === hash) c.markSynced(e.slotId, hash);
    else if (h.hash === s) dirty.add(e.slotId); // played offline here: push it
    else if (hash !== s && !memory.has(e.slotId)) dirty.delete(e.slotId); // both changed: settled on Continue
    // Otherwise only the account moved on: the device copy is refreshed on Continue.
  }
  for (const id of memory.keys()) if (!index.has(id)) dirty.add(id);

  const part: CloudPart = {
    push,
    fetch,
    async load(slotId, local, opts) {
      const localHash = local.raw ? fnv1a(local.raw) : null;
      const sync = synced.get(slotId) ?? null;
      let cloud = await fetch(slotId, localHash);
      if (cloud && !cloud.raw) { c.markSynced(slotId, localHash!); cloud = null; } // the same game in both places
      const useLocal = () => {
        if (!local.raw || !local.summary) return null;
        try { return { loaded: decodeSave(local.raw), summary: local.summary, from: local.from }; } catch { return null; }
      };
      const useCloud = () => {
        if (!cloud) return null;
        try {
          const loaded = decodeSave(cloud.raw);
          const summary = pickSummary(cloud.header), raw = cloud.raw, hash = cloud.header.hash;
          memory.set(slotId, { raw, hash, summary });
          if (c.writeBlob(slotId, "json", raw)) {
            index.set(slotId, { ...summary, hash, syncedHash: hash });
            // Repack the device copy in the background (the json copy stays if that fails).
            void pack(raw, d.compress).then((p) => { if (memory.get(slotId)?.raw === raw) c.writeBlob(slotId, p.encoding, p.data); }, () => {});
          }
          c.markSynced(slotId, hash);
          c.writeIndex();
          c.emit();
          return { loaded, summary, from: "account" as const };
        } catch { return null; }
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
      const backupSlotId = await keepBackup(pick === "local" ? theirs.raw : local.raw, pick === "local" ? cloudSum : local.summary!);
      if (pick === "local") { synced.set(slotId, theirs.header.hash); dirty.add(slotId); void push(slotId); }
      return { ...result, ...(backupSlotId ? { backupSlotId } : {}) };
    },
    async rename(slotId, name) {
      await c.serial(`cloud:${slotId}`, () => call(() => headerRef(slotId).update({ name }))).catch((e) => { if (errCode(e) === "revoked") failed(e); });
    },
    async remove(slotId) {
      const h = c.headers.get(slotId);
      c.headers.delete(slotId);
      await c.serial(`cloud:${slotId}`, async () => {
        try {
          const live = h ?? ((await call(() => headerRef(slotId).get())).data() as unknown as CloudHeader | undefined);
          await call(() => headerRef(slotId).delete());
          const count = Math.max(live?.chunkCount ?? 0, 1);
          for (const bank of ["a", "b"] as const) for (let n = 0; n < count; n++) await call(() => chunkRef(slotId, bank, n).delete()).catch(() => {});
        } catch (e) { failed(e); }
      });
      c.emit();
    },
    merge(out, hashes, localOk) {
      for (const h of c.headers.values()) {
        const mine = out.get(h.slotId);
        if (mine && h.hash === hashes.get(h.slotId)) mine.where = "account";
        else if (!mine || h.updatedAt > mine.updatedAt) out.set(h.slotId, { ...pickSummary(h), where: "account" });
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
  // onboarding flags are the union of both.
  const pdoc = docs.find((x) => x.id === PREFS_DOC);
  if (c.prefs) {
    const cloudPrefs = pdoc?.exists ? (pdoc.data() as { settings?: Record<string, unknown>; onboard?: string[] }) : undefined;
    if (cloudPrefs) {
      c.prefs.adopt({ ...(st.prefsEarly || !cloudPrefs.settings ? {} : { settings: cloudPrefs.settings }), onboard: [...new Set([...(cloudPrefs.onboard ?? []), ...(c.prefs.read().onboard ?? [])])] });
      lastPrefs = JSON.stringify({ kind: "prefs", settings: cloudPrefs.settings ?? {}, onboard: [...new Set(cloudPrefs.onboard ?? [])].sort() });
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
