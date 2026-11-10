/**
 * Round 9: save slots across visits and devices — the store (state/saveStore.ts) with an in-memory db and a fake
 * localStorage, the slot picker, the title's Continue, the header's save mark and Save & quit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { GameState } from "@full-plate/sim-core";
import { appReducer, initialAppState } from "../state/gameReducer";
import { initialMeta, type PathMeta } from "../state/paths";
import { CAREER_SAVE_KEY, decodeSave, encodeSave, SAVE_KEY } from "../state/save";
import { createSaveStore } from "../state/saveCore";
import {
  fnv1a, hasCompression, INDEX_KEY, MAX_SLOTS,
  type CloudConn, type CloudHeader, type MiniCollection, type MiniDb, type MiniDocRef, type MiniSnap, type SaveStore,
} from "../state/saveStore";
import { CHUNK_SIZE, splitChunks } from "../state/saveCloud";
import { pack, unpack } from "../state/saveCodec";
import { decodeSaveFile, encodeSaveFile, FILE_MAGIC, saveFileName } from "../state/saveFiles";
import { SlotPicker, playedAgo } from "../screens/SlotPicker";
import { TitleScreen } from "../screens/TitleScreen";
import { SaveIndicator } from "../components/SaveIndicator";
import { saveExplain } from "../components/SaveSheet";
import { SettingsMenu } from "../components/Settings";
import { adoptSettings, getSettings, resetSettingsCache, setSettings } from "../lib/settings";
import { adoptOnboardKeys, knownOnboardKeys, onboardKey, onboardSeen } from "../lib/onboarding";
import { attachPrefs } from "../lib/prefsSync";
import { content } from "../sim";

// ── fakes ──
class FakeStorage {
  map = new Map<string, string>();
  throwOnSet = false;
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { if (this.throwOnSet) throw new Error("QuotaExceededError"); this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
}

const MAX_DOC = 256 * 1024;
/** The subset of the `db` capability the store uses, with db.d.ts's rules: path parity, 256 KiB bodies, frozen reads. */
class FakeDb implements MiniDb {
  docs = new Map<string, Record<string, unknown>>();
  writes: { op: "set" | "update" | "delete"; path: string; size: number }[] = [];
  reads = 0;
  failSet: ((path: string) => string | null) | null = null;
  listeners = new Set<{ col: string; fn: (s: { docs: MiniSnap[] }) => void }>();
  private snap(path: string): MiniSnap {
    const d = this.docs.get(path);
    const id = path.split("/").at(-1)!;
    return { id, exists: !!d, data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined) };
  }
  private notify(path: string) {
    const col = path.split("/").slice(0, -1).join("/");
    for (const l of this.listeners) if (l.col === col) l.fn({ docs: this.list(col) });
  }
  private list(col: string): MiniSnap[] {
    const depth = col.split("/").length + 1;
    return [...this.docs.keys()].filter((p) => p.startsWith(col + "/") && p.split("/").length === depth).sort().map((p) => this.snap(p));
  }
  docRef(path: string): MiniDocRef {
    if (path.split("/").length % 2 !== 0) throw new TypeError(`document path needs an even number of segments: ${path}`);
    return {
      get: async () => { this.reads++; return this.snap(path); },
      set: async (data) => {
        const f = this.failSet?.(path);
        if (f) throw { code: f, message: "fake failure" };
        const size = JSON.stringify(data).length;
        if (size > MAX_DOC) throw { code: "invalid_argument", message: "document over 256 KiB" };
        this.docs.set(path, JSON.parse(JSON.stringify(data)));
        this.writes.push({ op: "set", path, size });
        this.notify(path);
      },
      update: async (data) => {
        const d = this.docs.get(path);
        if (!d) throw { code: "invalid_argument", message: "update needs the document to exist" };
        this.docs.set(path, { ...d, ...data });
        this.writes.push({ op: "update", path, size: 0 });
        this.notify(path);
      },
      delete: async () => { this.docs.delete(path); this.writes.push({ op: "delete", path, size: 0 }); this.notify(path); },
      collection: (sub) => this.collection(`${path}/${sub}`),
    };
  }
  collection(path: string): MiniCollection {
    if (path.split("/").length % 2 !== 1) throw new TypeError(`collection path needs an odd number of segments: ${path}`);
    return {
      doc: (id) => this.docRef(`${path}/${id}`),
      get: async () => { this.reads++; return { docs: this.list(path) }; },
      onSnapshot: (fn) => { const l = { col: path, fn }; this.listeners.add(l); queueMicrotask(() => fn({ docs: this.list(path) })); return () => { this.listeners.delete(l); }; },
    };
  }
}

const UID = "u_test1";
const cloudOf = (db: FakeDb): (() => Promise<CloudConn>) => async () => ({ db, uid: UID });
const offline = (reason: "none" | "signed-out" = "none") => async (): Promise<CloudConn> => ({ off: reason });
let clock = Date.parse("2026-11-09T12:00:00Z");
const now = () => clock;
const mk = (o: { storage?: FakeStorage | null; db?: FakeDb; cloud?: () => Promise<CloudConn>; compress?: boolean } = {}) =>
  createSaveStore({ storage: o.storage === undefined ? new FakeStorage() : o.storage, cloud: o.cloud ?? (o.db ? cloudOf(o.db) : offline()), now, debounceMs: 20, compress: o.compress ?? false, retryMs: () => 1 });
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

function owner(name = "Rosie's", seed = 7): { game: GameState; meta: PathMeta } {
  const s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed, districtId: content.districts[0]!.id, restaurantName: name, difficulty: "cosy" } });
  return { game: s.game!, meta: s.meta };
}
const onDay = (g: { game: GameState; meta: PathMeta }, day: number, cash?: number) => ({ game: { ...g.game, day, ...(cash !== undefined ? { cash } : {}) }, meta: g.meta });

const stores: SaveStore[] = [];
const track = (s: SaveStore) => { stores.push(s); return s; };
beforeEach(() => { clock = Date.parse("2026-11-09T12:00:00Z"); try { localStorage.clear(); } catch { /* none */ } resetSettingsCache(); });
afterEach(() => { cleanup(); for (const s of stores.splice(0)) s.dispose(); });

describe("packing", () => {
  it("base64 round-trips (the path with no CompressionStream)", async () => {
    const raw = encodeSave(owner().game, owner().meta) + "é£€😀";
    const p = await pack(raw, false);
    expect(p.encoding).toBe("b64");
    expect(p.data).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(await unpack(p.encoding, p.data)).toBe(raw);
  });

  it.runIf(hasCompression())("gzip round-trips and is much smaller (browser path; Node has CompressionStream too)", async () => {
    const raw = encodeSave(owner().game, owner().meta);
    const p = await pack(raw, true);
    expect(p.encoding).toBe("gzip-b64");
    expect(p.data.length).toBeLessThan((await pack(raw, false)).data.length / 2);
    expect(await unpack("gzip-b64", p.data)).toBe(raw);
  });

  it("a 500 kB blob splits into 3 chunks of at most 180,000 characters", () => {
    const chunks = splitChunks("x".repeat(500_000));
    expect(chunks.map((c) => c.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 500_000 - 2 * CHUNK_SIZE]);
    expect(splitChunks("x".repeat(CHUNK_SIZE))).toHaveLength(1);
    expect(splitChunks("x".repeat(CHUNK_SIZE + 1))).toHaveLength(2);
  });
});

describe("save store: device only", () => {
  it("round-trips a slot through a reload (a new store on the same storage)", async () => {
    const st = new FakeStorage();
    const a = track(mk({ storage: st }));
    const g = owner();
    await a.save("s1", g.game, g.meta);
    const b = track(mk({ storage: st }));
    expect(b.list().map((s) => [s.slotId, s.name, s.where])).toEqual([["s1", "Rosie's", "device"]]);
    const r = await b.load("s1");
    expect(r!.loaded.game).toEqual(g.game);
    expect(r!.from).toBe("device");
  });

  it("no cloud at all: the indicator's status says this device only, and flush says so", async () => {
    const a = track(mk({ cloud: offline("signed-out") }));
    await a.connect();
    const g = owner();
    await a.save("s1", g.game, g.meta);
    expect(a.status()).toMatchObject({ cloud: "off", reason: "signed-out", local: true });
    expect(await a.flush("s1")).toBe("device");
    expect(saveExplain("device", "signed-out")).toBe("Saved on this device only — sign in to keep it everywhere.");
  });

  it("no localStorage and no cloud: the game is kept for the visit, and the store says it is not saved", async () => {
    const a = track(mk({ storage: null }));
    await a.connect();
    const g = owner();
    await a.save("s1", g.game, g.meta);
    expect(a.status().local).toBe(false);
    expect(a.list()[0]!.where).toBe("memory");
    expect((await a.load("s1"))!.loaded.game).toEqual(g.game);
    expect(await a.flush("s1")).toBe("memory");
  });

  it("a localStorage that throws on write is reported truthfully", async () => {
    const st = new FakeStorage();
    st.throwOnSet = true;
    const a = track(mk({ storage: st }));
    await a.connect();
    const g = owner();
    await a.save("s1", g.game, g.meta);
    expect(a.status().local).toBe(false);
    expect(a.list()[0]!.where).toBe("memory");
    expect(await a.flush("s1")).toBe("memory");
  });

  it("an ended owner game is removed (it can't be continued), as before", async () => {
    const a = track(mk());
    const g = owner();
    await a.save("s1", g.game, g.meta);
    await a.save("s1", { ...g.game, phase: "gameover" }, g.meta);
    expect(a.list()).toEqual([]);
  });

  it("caps at six slots", async () => {
    const a = track(mk());
    const g = owner();
    for (let i = 0; i < MAX_SLOTS; i++) { const id = a.freeSlotId()!; await a.save(id, g.game, g.meta); }
    expect(a.freeSlotId()).toBeNull();
    expect(a.freeCount()).toBe(0);
  });
});

describe("save store: legacy migration", () => {
  it("imports the round 1–8 owner and career saves as slots 1 and 2, owner first, and leaves the old keys alone", () => {
    const st = new FakeStorage();
    const o = owner("Old Place");
    const c = appReducer(initialAppState, { type: "newCareer", seed: 5, track: "chef", strategy: "balanced", playerName: "Mia", difficulty: "cosy" });
    const rawO = encodeSave(o.game, o.meta), rawC = encodeSave(c.game!, c.meta);
    st.setItem(SAVE_KEY, rawO); st.setItem(CAREER_SAVE_KEY, rawC);
    const a = track(mk({ storage: st }));
    const list = a.list();
    expect(list.map((s) => [s.name, s.path])).toEqual([["Old Place", "owner"], ["Mia's career", "career"]]);
    expect(st.getItem(SAVE_KEY)).toBe(rawO);
    expect(st.getItem(CAREER_SAVE_KEY)).toBe(rawC);
    // A second visit doesn't import them again (even after the slots are deleted).
    const b = track(mk({ storage: st }));
    expect(b.list()).toHaveLength(2);
  });

  it("a round 1–2 bare GameState migrates; an ended owner run and junk are skipped", async () => {
    const st = new FakeStorage();
    const o = owner("Bare");
    st.setItem(SAVE_KEY, JSON.stringify(o.game));
    st.setItem(CAREER_SAVE_KEY, "{nope");
    const a = track(mk({ storage: st }));
    expect(a.list().map((s) => s.name)).toEqual(["Bare"]);
    expect((await a.load(a.list()[0]!.slotId))!.loaded.game).toEqual(o.game);
    const st2 = new FakeStorage();
    st2.setItem(SAVE_KEY, encodeSave({ ...o.game, phase: "gameover" }, initialMeta("owner")));
    expect(track(mk({ storage: st2 })).list()).toEqual([]);
  });

  it("does nothing when slots already exist", async () => {
    const st = new FakeStorage();
    const a = track(mk({ storage: st }));
    const g = owner("Slotted");
    await a.save("s1", g.game, g.meta);
    st.setItem(SAVE_KEY, encodeSave(owner("Legacy").game, initialMeta()));
    st.removeItem("full-plate:slots-migrated:v1");
    expect(track(mk({ storage: st })).list().map((s) => s.name)).toEqual(["Slotted"]);
  });
});

describe("save store: account saves", () => {
  it("round-trips through the account to a second device (chunks first, header last, private path)", async () => {
    const db = new FakeDb();
    const a = track(mk({ db }));
    await a.connect();
    const g = owner();
    await a.save("s1", g.game, g.meta);
    expect(await a.flush("s1")).toBe("account");
    const paths = db.writes.map((w) => w.path);
    expect(paths).toEqual([`data/users/${UID}/save-s1/chunks/a-0`, `data/users/${UID}/save-s1`]);
    const h = db.docs.get(`data/users/${UID}/save-s1`) as unknown as CloudHeader;
    expect(h).toMatchObject({ kind: "save", slotId: "s1", name: "Rosie's", mode: "owner", day: 0, path: "owner", difficulty: "cosy", chunkCount: 1, encoding: "b64", bank: "a", appVersion: "r11" });
    expect(h.updatedAt).toBe("2026-11-09T12:00:00.000Z");
    // Another device: nothing local.
    const b = track(mk({ db }));
    await b.connect();
    expect(b.list().map((s) => [s.slotId, s.where])).toEqual([["s1", "account"]]);
    const r = await b.load("s1");
    expect(r!.from).toBe("account");
    expect(r!.loaded.game).toEqual(g.game);
  });

  it("chunks a big save at the boundary, every document under 256 KiB; the next write uses the other bank and deletes the old", async () => {
    const db = new FakeDb();
    const a = track(mk({ db }));
    await a.connect();
    const g = owner();
    // ~375 kB of envelope → ~500 kB of base64 → 3 chunks. (Round 11: in a real field — unknown keys are dropped on load.)
    const meta = { ...g.meta, empireEvents: Array.from({ length: 100 }, (_, i) => ({ day: i, kind: "milestone", text: "ab".repeat(1875), tone: "info" })) } as PathMeta;
    await a.save("big", g.game, meta);
    await a.flush("big");
    const h = db.docs.get(`data/users/${UID}/save-big`) as unknown as CloudHeader;
    expect(h.packedLength).toBeGreaterThan(2 * CHUNK_SIZE);
    expect(h.chunkCount).toBe(3);
    expect(db.writes.map((w) => w.path.split("/").at(-1))).toEqual(["a-0", "a-1", "a-2", "save-big"]);
    expect(Math.max(...db.writes.map((w) => w.size))).toBeLessThan(MAX_DOC);
    const b = track(mk({ db }));
    await b.connect();
    expect((await b.load("big"))!.loaded.meta.empireEvents).toEqual(meta.empireEvents);
    // Next save: bank b, header, then bank a's chunks go.
    db.writes = [];
    await a.save("big", { ...g.game, day: 1 }, meta);
    await a.flush("big");
    expect(db.writes.map((w) => `${w.op}:${w.path.split("/").at(-1)}`)).toEqual(["set:b-0", "set:b-1", "set:b-2", "set:save-big", "delete:a-0", "delete:a-1", "delete:a-2"]);
  });

  it("a half-written save (the header write fails) is never listed on another device", async () => {
    const db = new FakeDb();
    db.failSet = (p) => (p.endsWith("/save-s1") ? "unavailable" : null);
    const a = track(mk({ db }));
    await a.connect();
    const g = owner();
    await a.save("s1", g.game, g.meta);
    expect(await a.flush("s1")).toBe("device");
    expect(a.status().stalled).toEqual(["s1"]); // the header mark says "this device only" meanwhile
    expect(a.status().pending).toEqual([]);
    expect([...db.docs.keys()].some((p) => p.includes("/chunks/"))).toBe(true);
    const b = track(mk({ db }));
    await b.connect();
    expect(b.list()).toEqual([]);
    // It goes up on the next try.
    db.failSet = null;
    expect(await a.flush("s1")).toBe("account");
  });

  it("cloud writes are debounced and skipped when the save didn't change", async () => {
    const db = new FakeDb();
    const a = track(mk({ db }));
    await a.connect();
    const g = owner();
    await a.save("s1", g.game, g.meta);
    await a.save("s1", { ...g.game, day: 1 }, g.meta);
    await a.save("s1", { ...g.game, day: 2 }, g.meta);
    expect(db.writes).toHaveLength(0); // trailing debounce: nothing yet
    await settle();
    expect(db.writes.filter((w) => w.path.endsWith("/save-s1"))).toHaveLength(1);
    expect((db.docs.get(`data/users/${UID}/save-s1`) as unknown as CloudHeader).day).toBe(2);
    db.writes = [];
    await a.save("s1", { ...g.game, day: 2 }, g.meta);
    await settle();
    expect(db.writes).toHaveLength(0);
  });

  it("only the account moved on (played on another device): continue takes it, no backup", async () => {
    const db = new FakeDb();
    const stA = new FakeStorage();
    const a = track(mk({ db, storage: stA }));
    await a.connect();
    const g = owner();
    await a.save("s1", g.game, g.meta); await a.flush("s1");
    const b = track(mk({ db }));
    await b.connect();
    await b.load("s1");
    clock += 3_600_000;
    await b.save("s1", onDay(g, 5).game, g.meta); await b.flush("s1");
    const a2 = track(mk({ db, storage: stA })); // device A, next visit
    await a2.connect();
    const r = await a2.load("s1");
    expect(r!.loaded.game.day).toBe(5);
    expect(r!.from).toBe("account");
    expect(r!.backupSlotId).toBeUndefined();
    expect(a2.list()).toHaveLength(1);
  });

  it("only this device moved on (offline play): continue plays it and pushes it", async () => {
    const db = new FakeDb();
    const st = new FakeStorage();
    const a = track(mk({ db, storage: st }));
    await a.connect();
    const g = owner();
    await a.save("s1", g.game, g.meta); await a.flush("s1");
    const off = track(mk({ storage: st, cloud: async () => ({ off: "none" }) }));
    await off.connect();
    clock += 60_000;
    await off.save("s1", onDay(g, 3).game, g.meta);
    const back = track(mk({ db, storage: st }));
    await back.connect(); // reconcile pushes it
    await settle();
    expect((db.docs.get(`data/users/${UID}/save-s1`) as unknown as CloudHeader).day).toBe(3);
    const r = await back.load("s1");
    expect(r!.loaded.game.day).toBe(3);
    expect(r!.backupSlotId).toBeUndefined();
  });

  it("both copies changed: the newer is played by default and the other is kept as “Backup of …”", async () => {
    const db = new FakeDb();
    const stA = new FakeStorage();
    const a = track(mk({ db, storage: stA }));
    await a.connect();
    const g = owner();
    await a.save("s1", g.game, g.meta); await a.flush("s1");
    // Device B plays to day 4 (newer, on the account) …
    const b = track(mk({ db }));
    await b.connect(); await b.load("s1");
    clock += 120_000;
    await b.save("s1", onDay(g, 4, 111).game, g.meta); await b.flush("s1");
    // … while device A played offline to day 2 (older).
    const off = track(mk({ storage: stA }));
    await off.connect();
    clock -= 60_000;
    await off.save("s1", onDay(g, 2, 222).game, g.meta);
    const a2 = track(mk({ db, storage: stA }));
    a2.connect(); // reconcile leaves a true conflict for Continue to settle
    await settle(5);
    const r = await a2.load("s1");
    expect(r!.loaded.game.day).toBe(4);
    expect(r!.backupSlotId).toBeTruthy();
    const backup = a2.list().find((s) => s.slotId === r!.backupSlotId)!;
    expect(backup).toMatchObject({ name: "Backup of Rosie's", day: 2, cash: 222 });
    expect((await a2.load(backup.slotId))!.loaded.game.day).toBe(2);
    expect(a2.list()[0]!.slotId).toBe("s1"); // the played one sorts first
  });

  it("both changed and the player picks the older one: it is played and pushed, the newer kept as a backup", async () => {
    const db = new FakeDb();
    const stA = new FakeStorage();
    const a = track(mk({ db, storage: stA }));
    await a.connect();
    const g = owner();
    await a.save("s1", g.game, g.meta); await a.flush("s1");
    const b = track(mk({ db })); await b.connect(); await b.load("s1");
    clock += 120_000;
    await b.save("s1", onDay(g, 4).game, g.meta); await b.flush("s1");
    const off = track(mk({ storage: stA })); await off.connect();
    await off.save("s1", onDay(g, 2).game, g.meta);
    const a2 = track(mk({ db, storage: stA })); await a2.connect();
    const choose = vi.fn(async () => "local" as const);
    const r = await a2.load("s1", { choose });
    expect(choose).toHaveBeenCalledTimes(1);
    expect(r!.loaded.game.day).toBe(2);
    await a2.flush("s1");
    expect((db.docs.get(`data/users/${UID}/save-s1`) as unknown as CloudHeader).day).toBe(2);
    expect(a2.list().find((s) => s.name === "Backup of Rosie's")!.day).toBe(4);
  });

  it("a push that finds the account moved on keeps the account's copy as a backup first", async () => {
    const db = new FakeDb();
    const stA = new FakeStorage();
    const a = track(mk({ db, storage: stA }));
    await a.connect();
    const g = owner();
    await a.save("s1", g.game, g.meta); await a.flush("s1");
    const b = track(mk({ db })); await b.connect(); await b.load("s1");
    await b.save("s1", onDay(g, 9).game, g.meta); await b.flush("s1");
    // A never re-reads: it plays on and its debounced push meets B's copy.
    await a.save("s1", onDay(g, 1).game, g.meta);
    await a.flush("s1");
    await settle(); // the backup's own (debounced) push
    const c = track(mk({ db })); await c.connect();
    const days = c.list().map((s) => [s.name, s.day]).sort();
    expect(days).toEqual([["Backup of Rosie's", 9], ["Rosie's", 1]]);
  });

  it("rename and delete reach the account; a slot deleted on another device leaves this one too", async () => {
    const db = new FakeDb();
    const stA = new FakeStorage();
    const a = track(mk({ db, storage: stA }));
    await a.connect();
    const g = owner();
    await a.save("s1", g.game, g.meta); await a.flush("s1");
    await a.rename("s1", "Mia's diner");
    expect((db.docs.get(`data/users/${UID}/save-s1`) as unknown as CloudHeader).name).toBe("Mia's diner");
    const b = track(mk({ db })); await b.connect();
    expect(b.list()[0]!.name).toBe("Mia's diner");
    await b.remove("s1");
    expect([...db.docs.keys()].filter((p) => p.includes("save-s1"))).toEqual([]);
    const a2 = track(mk({ db, storage: stA })); await a2.connect();
    expect(a2.list()).toEqual([]);
  });

  it("a refused first call means no cloud saves, without retrying", async () => {
    const st = new FakeStorage();
    const db = new FakeDb();
    const col = db.collection.bind(db);
    let calls = 0;
    db.collection = (p: string) => ({ ...col(p), get: async () => { calls++; throw { code: "not_granted", message: "no" }; } }) as MiniCollection;
    const a = track(mk({ db, storage: st }));
    await a.connect();
    expect(a.status()).toMatchObject({ cloud: "off", reason: "refused" });
    const g = owner();
    await a.save("s1", g.game, g.meta);
    await settle();
    expect(calls).toBe(1);
    expect(await a.flush("s1")).toBe("device");
  });
});

describe("save files", () => {
  it("export → import into a fresh store restores the game; the name and file name come along", async () => {
    const a = track(mk());
    const g = owner("Rosie's Diner!");
    await a.save("s1", onDay(g, 20).game, g.meta);
    const f = (await a.exportFile("s1"))!;
    expect(f.filename).toBe("fullplate-rosies-diner-day21.fpsave.json");
    const env = JSON.parse(f.text);
    expect(env).toMatchObject({ magic: FILE_MAGIC, v: 1, name: "Rosie's Diner!", day: 20, path: "owner", encoding: "json" });
    const b = track(mk());
    const s = await b.importFile(f.text);
    expect(s.name).toBe("Rosie's Diner!");
    expect((await b.load(s.slotId))!.loaded.game).toEqual(onDay(g, 20).game);
  });

  it.runIf(hasCompression())("a compressed save file round-trips", async () => {
    const g = owner();
    const raw = encodeSave(g.game, g.meta);
    const text = await encodeSaveFile(raw, { slotId: "x", name: "Z", mode: "owner", restaurantName: "Z", day: 0, cash: 0, path: "owner", difficulty: "cosy", updatedAt: "" }, "t", true);
    expect(JSON.parse(text).encoding).toBe("gzip-b64");
    expect((await decodeSaveFile(text)).raw).toBe(raw);
  });

  it("decode accepts an old raw envelope (what localStorage held) and a plain-JSON file synchronously too", async () => {
    const g = owner();
    const raw = encodeSave(g.game, g.meta);
    expect((await decodeSaveFile(raw)).loaded.game).toEqual(g.game);
    const plain = JSON.stringify({ magic: FILE_MAGIC, v: 1, name: "n", encoding: "json", data: raw });
    expect(decodeSave(plain).game).toEqual(g.game);
    await expect(decodeSaveFile("hello")).rejects.toThrow(/isn't a Full Plate save/);
    await expect(decodeSaveFile(JSON.stringify({ magic: FILE_MAGIC, encoding: "zip" }))).rejects.toThrow(/damaged/);
  });

  it("an import into full slots says what to do", async () => {
    const a = track(mk());
    const g = owner();
    for (let i = 0; i < MAX_SLOTS; i++) await a.save(a.freeSlotId()!, g.game, g.meta);
    await expect(a.importFile(encodeSave(g.game, g.meta))).rejects.toThrow(/full/);
    expect(saveFileName("", 0)).toBe("fullplate-game-day1.fpsave.json");
  });
});

describe("prefs (settings + onboarding flags)", () => {
  it("adopts the account's settings and merges onboarding flags both ways", async () => {
    const db = new FakeDb();
    db.docs.set(`data/users/${UID}/prefs`, { kind: "prefs", settings: { autoPause: false, defaultSpeed: 4, sound: false, textSize: "normal" }, onboard: [onboardKey(77, "chef")] });
    localStorage.setItem(onboardKey(5, "bar"), "1");
    const a = track(mk({ db }));
    attachPrefs(a);
    await a.connect();
    expect(getSettings()).toMatchObject({ autoPause: false, defaultSpeed: 4, sound: false });
    expect(onboardSeen(localStorage, 77, "chef")).toBe(true);
    const prefs = db.docs.get(`data/users/${UID}/prefs`)!;
    expect(prefs.onboard).toEqual([onboardKey(5, "bar"), onboardKey(77, "chef")].sort());
    db.writes = [];
    setSettings({ sound: true });
    await settle();
    expect((db.docs.get(`data/users/${UID}/prefs`)!.settings as { sound: boolean }).sound).toBe(true);
    expect(knownOnboardKeys()).toContain(onboardKey(77, "chef"));
    adoptSettings({ defaultSpeed: 1 }); adoptOnboardKeys([]);
  });
});

describe("slot picker", () => {
  const seed = async () => {
    const st = new FakeStorage();
    const a = track(mk({ storage: st }));
    const g = owner();
    await a.save("old", onDay(g, 3, 50_000).game, g.meta);
    clock += 2 * 86_400_000;
    const e = appReducer(initialAppState, { type: "newCareer", seed: 5, track: "chef", strategy: "balanced", playerName: "Mia", difficulty: "cosy" });
    await a.save("new", e.game!, e.meta);
    return a;
  };

  it("lists each game with its name, path badge, day, cash and when it was played; Continue opens it", async () => {
    const a = await seed();
    vi.spyOn(Date, "now").mockReturnValue(clock);
    const onContinue = vi.fn();
    render(<SlotPicker mode="browse" store={a} onContinue={onContinue} onClose={() => {}} />);
    const d = screen.getByRole("dialog", { name: "Your games" });
    expect(d.textContent).toMatch(/2 of 6 slots used/);
    const items = within(d).getAllByRole("listitem").filter((li) => li.getAttribute("aria-label") !== "Empty slot");
    expect(items.map((li) => li.getAttribute("aria-label"))).toEqual(["Mia's career", "Rosie's"]);
    expect(items[1]!.textContent).toMatch(/Owner/);
    expect(items[1]!.textContent).toMatch(/Day 4/);
    expect(items[1]!.textContent).toMatch(/£500/);
    expect(items[1]!.textContent).toMatch(/Played 2 days ago · This device only/);
    expect(items[0]!.textContent).toMatch(/Career/);
    expect(within(d).getAllByRole("listitem", { name: "Empty slot" })).toHaveLength(4);
    fireEvent.click(within(items[1]!).getByRole("button", { name: "Continue Rosie's" }));
    expect(onContinue).toHaveBeenCalledWith("old");
    vi.restoreAllMocks();
  });

  it("renames inline and deletes after the confirm (Keep it changes nothing)", async () => {
    const a = await seed();
    render(<SlotPicker mode="browse" store={a} onContinue={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Rosie's" }));
    const box = screen.getByRole("textbox", { name: "New name for Rosie's" });
    fireEvent.change(box, { target: { value: "Rosie's two" } });
    fireEvent.click(screen.getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(screen.getByRole("listitem", { name: "Rosie's two" })).toBeTruthy());
    expect(a.list().find((s) => s.slotId === "old")!.name).toBe("Rosie's two");
    fireEvent.click(screen.getByRole("button", { name: "Delete Rosie's two" }));
    const ask = screen.getByRole("alertdialog", { name: "Delete Rosie's two?" });
    expect(document.activeElement?.textContent).toBe("Keep it");
    fireEvent.click(within(ask).getByRole("button", { name: "Keep it" }));
    expect(a.list()).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Delete Rosie's two" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, delete it" }));
    await waitFor(() => expect(a.list().map((s) => s.slotId)).toEqual(["new"]));
    expect(screen.getByRole("status").textContent).toMatch(/was deleted/);
  });

  it("new game: an empty slot goes straight on; replacing a game asks first", async () => {
    const a = await seed();
    const onNewIn = vi.fn();
    render(<SlotPicker mode="new" store={a} onContinue={() => {}} onNewIn={onNewIn} onClose={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Where shall we save your new game?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Start in an empty slot/ }));
    expect(onNewIn).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Replace Rosie's with a new game" }));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "Start over in this slot?" })).getByRole("button", { name: "Go back" }));
    expect(onNewIn).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Replace Rosie's with a new game" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, start a new game" }));
    expect(onNewIn).toHaveBeenLastCalledWith("old");
  });

  it("loads a save file into a free slot, and says so; a wrong file gets a plain message", async () => {
    const a = await seed();
    render(<SlotPicker mode="browse" store={a} onContinue={() => {}} onClose={() => {}} />);
    const input = screen.getByTestId("save-file-input") as HTMLInputElement;
    const g = owner("From a file");
    const text = await encodeSaveFile(encodeSave(g.game, g.meta), { slotId: "x", name: "From a file", mode: "owner", restaurantName: "From a file", day: 0, cash: 0, path: "owner", difficulty: "cosy", updatedAt: "" }, "t", false);
    await act(async () => { fireEvent.change(input, { target: { files: [new File([text], "fullplate-from-a-file-day1.fpsave.json")] } }); await settle(30); });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/Loaded From a file ✓/));
    expect(a.list().map((s) => s.name)).toContain("From a file");
    await act(async () => { fireEvent.change(input, { target: { files: [new File(["not a save"], "x.json")] } }); await settle(30); });
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/isn't a Full Plate save/));
  });

  it("played-ago words", () => {
    const t = Date.parse("2026-11-09T12:00:00Z");
    const ago = (ms: number) => playedAgo(new Date(t - ms).toISOString(), t);
    expect([ago(5_000), ago(5 * 60_000), ago(60 * 60_000), ago(86_400_000), ago(2 * 86_400_000), ago(30 * 86_400_000)])
      .toEqual(["just now", "5 minutes ago", "1 hour ago", "yesterday", "2 days ago", "on 10 Oct"]);
  });
});

describe("title, header mark and Save & quit", () => {
  it("Continue carries the most recently played slot", async () => {
    const a = track(mk());
    const g = owner();
    await a.save("old", g.game, g.meta);
    clock += 1000;
    const h = owner("Harbour Grill", 9);
    await a.save("new", onDay(h, 6).game, h.meta);
    const onContinue = vi.fn();
    const onYourGames = vi.fn();
    render(<TitleScreen saved={null} slots={a.list()} onNew={() => {}} onContinue={onContinue} onYourGames={onYourGames} />);
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont.textContent).toMatch(/Harbour Grill.*Day 7/);
    fireEvent.click(cont);
    expect(onContinue).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Your games/ }));
    expect(onYourGames).toHaveBeenCalled();
  });

  it("with slots, New game goes to the app (which asks for a slot), not the old replace confirm", () => {
    const onNew = vi.fn();
    render(<TitleScreen saved={null} slots={[{ slotId: "a", name: "A", mode: "owner", restaurantName: "A", day: 0, cash: 0, path: "owner", difficulty: "cosy", updatedAt: "", where: "device" }]} onNew={onNew} onContinue={() => {}} onYourGames={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "New game" }));
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("the header mark says where the save is, and explains on tap", async () => {
    const db = new FakeDb();
    const a = track(mk({ db }));
    const g = owner();
    await a.save("s1", g.game, g.meta);
    render(<SaveIndicator slotId="s1" store={a} />);
    expect(screen.getByRole("button", { name: /Saved on this device only/ })).toBeTruthy();
    await act(async () => { await a.connect(); });
    expect(screen.getByRole("button", { name: /Saving to your account/ }).textContent).toMatch(/Saving…/);
    await act(async () => { await a.flush("s1"); });
    const btn = screen.getByRole("button", { name: /Saved to your account ✓/ });
    fireEvent.click(btn);
    expect((await screen.findByRole("dialog", { name: "Saved to your account ✓" })).textContent).toMatch(/any device where you're signed in/);
  });

  it("with nothing that keeps a save, the mark says Not saved", async () => {
    const a = track(mk({ storage: null }));
    await a.connect();
    render(<SaveIndicator slotId="s1" store={a} />);
    fireEvent.click(screen.getByRole("button", { name: /Not saved/ }));
    expect((await screen.findByRole("dialog")).textContent).toMatch(/Save to a file/);
  });

  it("Save & quit shows saving, then where it went, then quits", async () => {
    let done!: (w: "account") => void;
    const onSave = vi.fn(() => new Promise<"account">((r) => { done = r; }));
    const onQuit = vi.fn();
    render(<SettingsMenu onQuit={onQuit} onNewGame={() => {}} onSave={onSave} saveName="Rosie's · Day 3" />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Save & quit" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toHaveProperty("disabled", true);
    await act(async () => { done("account"); await settle(10); });
    expect(screen.getByRole("status").textContent).toBe("Saved to your account ✓");
    expect(onQuit).not.toHaveBeenCalled();
    await act(async () => { await settle(950); });
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it("Save & quit with nothing that keeps a save stays put and offers a file", async () => {
    const onQuit = vi.fn();
    render(<SettingsMenu onQuit={onQuit} onSave={async () => "memory"} onSaveFile={async () => "Saved to a file ✓"} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save & quit" })); await settle(10); });
    expect(screen.getAllByRole("status")[0]!.textContent).toMatch(/Not saved — use Save to a file/);
    expect(onQuit).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save to a file" })); await settle(10); });
    expect(screen.getByText("Saved to a file ✓")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Quit without saving" }));
    expect(onQuit).toHaveBeenCalledTimes(1);
  });

  it("the store's hashes are stable for the same game (conflict detection relies on it)", () => {
    const g = owner();
    expect(fnv1a(encodeSave(g.game, g.meta))).toBe(fnv1a(encodeSave(decodeSave(encodeSave(g.game, g.meta)).game, g.meta)));
    expect(localStorage.getItem(INDEX_KEY)).toBeNull(); // tests never touch the real localStorage store
  });
});

describe("the app with slots", () => {
  it("Continue on the title opens the most recently played slot, and Save & quit comes back to it", async () => {
    const { App } = await import("../App");
    const { setSaveStore } = await import("../state/saveStore");
    const a = track(mk());
    const g = owner("Older Place");
    await a.save("old", onDay(g, 2).game, g.meta);
    clock += 60_000;
    const h = owner("Newest Place", 9);
    await a.save("new", onDay(h, 4).game, h.meta);
    setSaveStore(a);
    try {
      render(<App />);
      expect(screen.getByRole("button", { name: "Continue" }).textContent).toMatch(/Newest Place.*Day 5/);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Continue" })); await settle(20); });
      expect(document.querySelector(".status__name")!.textContent).toMatch(/Newest Place/);
      expect(screen.getByRole("button", { name: /Saved on this device only/ })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save & quit" })); await settle(1000); });
      expect(screen.getByRole("button", { name: "Continue" }).textContent).toMatch(/Newest Place/);
      expect(screen.getByRole("button", { name: /Your games/ }).textContent).toMatch(/2/);
    } finally { setSaveStore(null); }
  });
});

describe("the main-chunk facade", () => {
  it("shows the migrated legacy save at once (first paint), then forwards to the real store", async () => {
    const { getSaveStore, setSaveStore } = await import("../state/saveStore");
    setSaveStore(null);
    const g = owner("First Paint");
    localStorage.setItem(SAVE_KEY, encodeSave(g.game, g.meta));
    const f = getSaveStore();
    try {
      expect(f.list().map((x) => x.name)).toEqual(["First Paint"]);
      expect(f.getSnapshot().status.cloud).toBe("waiting");
      const id = f.list()[0]!.slotId;
      const r = await f.load(id);
      expect(r!.loaded.game).toEqual(g.game);
      await f.connect();
      expect(f.status()).toMatchObject({ cloud: "off", reason: "none" });
    } finally { f.dispose(); setSaveStore(null); }
  });
});
