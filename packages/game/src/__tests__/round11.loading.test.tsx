/**
 * Round 11 (agent A): loading, saving and account hygiene — the red-team's reproductions (docs/RED-TEAM.md S1–S6,
 * S10–S12, G9–G14), each regenerated here from a real save (no scratchpad files), now refused or contained.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import type { GameState } from "@full-plate/sim-core";
import { applyEmpireCommand, forkFromGameState, type EmpireState } from "@full-plate/sim-empire";
import { applyStarsCommand, newStarsState, STARS_CONSTANTS } from "@full-plate/sim-stars";
import { applyCareerCommand, newCareer } from "@full-plate/sim-career";
import { strategies, STRATEGIES } from "@full-plate/sim-core";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { FORK_DAY, initialMeta, type PathMeta } from "../state/paths";
import { decodeSave, encodeSave } from "../state/save";
import { createSaveStore } from "../state/saveCore";
import { checkHeader, validateLoaded } from "../state/saveCheck";
import { unpack } from "../state/saveCodec";
import { decodeSaveFile, FILE_MAGIC } from "../state/saveFiles";
import { MAX_ONBOARD_FLAGS } from "../state/saveCloud";
import { CHUNK_SIZE, INDEX_KEY, MAX_FILE_BYTES, OWNER_KEY, slotKey, type CloudConn, type MiniCollection, type MiniDb, type MiniDocRef, type MiniSnap, type SaveStore } from "../state/saveStore";
import { saveMark } from "../state/useSaves";
import { CrashGuard, noteSlot } from "../components/CrashGuard";
import { TitleScreen } from "../screens/TitleScreen";
import { SlotPicker } from "../screens/SlotPicker";
import { applyCommand, content } from "../sim";
import { empireCommand } from "../state/pathEngine";

// ── fakes (db.d.ts semantics that matter: path parity, 256 KiB, private data/users/<uid>) ──
class FakeStorage {
  map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
}
const MAX_DOC = 256 * 1024;
class FakeDb implements MiniDb {
  docs: Map<string, Record<string, unknown>>;
  reads = 0;
  failSet: ((path: string, data: Record<string, unknown>) => string | null) | null = null;
  constructor(public uid: string, shared?: FakeDb) { this.docs = shared?.docs ?? new Map(); }
  private visible = (p: string) => !p.startsWith("data/users/") || p.startsWith(`data/users/${this.uid}/`);
  private snap(p: string): MiniSnap {
    const d = this.docs.get(p), ok = !!d && this.visible(p);
    return { id: p.split("/").at(-1)!, exists: ok, data: () => (ok ? JSON.parse(JSON.stringify(d)) : undefined) };
  }
  private list(col: string) {
    const depth = col.split("/").length + 1;
    return [...this.docs.keys()].filter((p) => p.startsWith(col + "/") && p.split("/").length === depth).sort().map((p) => this.snap(p)).filter((s) => s.exists);
  }
  docRef(path: string): MiniDocRef {
    const own = () => { if (!this.visible(path)) throw { code: "invalid_argument" }; };
    return {
      get: async () => { this.reads++; return this.snap(path); },
      set: async (data) => {
        own();
        const f = this.failSet?.(path, data); if (f) throw { code: f };
        const json = JSON.stringify(data);
        if (json.length > MAX_DOC) throw { code: "invalid_argument", message: "over 256 KiB" };
        this.docs.set(path, JSON.parse(json));
      },
      update: async (data) => { own(); const d = this.docs.get(path); if (!d) throw { code: "invalid_argument" }; this.docs.set(path, { ...d, ...data }); },
      delete: async () => { own(); this.docs.delete(path); },
      collection: (sub) => this.collection(`${path}/${sub}`),
    };
  }
  collection(path: string): MiniCollection {
    return {
      doc: (id) => this.docRef(`${path}/${id}`),
      get: async () => { this.reads++; return { docs: this.list(path) }; },
      onSnapshot: (fn) => { queueMicrotask(() => fn({ docs: this.list(path) })); return () => {}; },
    };
  }
}
let clock = Date.parse("2026-11-10T12:00:00Z");
const stores: SaveStore[] = [];
const mk = (storage: FakeStorage | null, db?: FakeDb, compress = false) => {
  const s = createSaveStore({ storage, cloud: db ? async (): Promise<CloudConn> => ({ db, uid: db.uid }) : async () => ({ off: "none" }), now: () => clock, debounceMs: 5, compress, retryMs: () => 1 });
  stores.push(s);
  return s;
};
const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const owner = (name = "Rosie's", seed = 7) => {
  const s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed, districtId: content.districts[0]!.id, restaurantName: name, difficulty: "cosy" } });
  return { game: s.game!, meta: s.meta };
};
/** mkfiles.mjs: a real envelope with the game JSON patched. */
function envWith(f: (g: Record<string, unknown>) => void, metaPatch: Record<string, unknown> = {}) {
  const o = owner();
  const env = JSON.parse(encodeSave(o.game, o.meta));
  const g = JSON.parse(env.game); f(g); env.game = JSON.stringify(g);
  Object.assign(env.meta, metaPatch);
  return JSON.stringify(env);
}
const asFile = (raw: string, name = "x") => JSON.stringify({ magic: FILE_MAGIC, v: 1, name, restaurantName: "", day: 0, path: "owner", savedAt: "", encoding: "json", data: raw });
const refusal = async (text: string) => { try { await decodeSaveFile(text); return "ACCEPTED"; } catch (e) { return (e as Error).message; } };
const DAMAGED = /That save file is damaged/;

beforeEach(() => { clock = Date.parse("2026-11-10T12:00:00Z"); });
afterEach(() => { cleanup(); for (const s of stores.splice(0)) s.dispose(); noteSlot(null); });

describe("S1/S3: every crafted file from the red-team kit is refused or cleaned", () => {
  it("type confusions are refused with the child-readable message (nothing is stored)", async () => {
    const tries: Record<string, string> = {
      objName: envWith((g) => { g.restaurantName = { evil: true }; }),
      staffObj: envWith((g) => { g.staff = { a: 1 }; }),
      dayString: envWith((g) => { g.day = "7"; }),
      cashInf: envWith((g) => { g.cash = "INF"; }).replace('\\"INF\\"', "1e999"),
      phaseBogus: envWith((g) => { g.phase = "<img src=x onerror=alert(1)>"; }),
      staff1e5: envWith((g) => { g.staff = Array.from({ length: 100_000 }, (_, i) => ({ ...((g.staff as object[])[0] ?? {}), id: `x${i}` })); }),
      menuNaNPrice: envWith((g) => { g.menu = [{ dishId: "x", price: "free", active: true }]; }),
      metaFork: envWith(() => {}, { fork: "yes" }),
      empireJunk: (() => { const e = JSON.parse(envWith(() => {})); e.empire = JSON.stringify({ version: 1, brand: 1, contract: 1, sites: 1, franchisees: 1, cities: 1, regions: 1, hq: 1, calibration: 1, rngState: [1, 2, 3, 4] }); return JSON.stringify(e); })(),
      starsJunk: (() => { const e = JSON.parse(envWith(() => {})); e.stars = JSON.stringify({ version: 1, rngState: [1, 2, 3, 4], guides: "x" }); return JSON.stringify(e); })(),
      careerJunk: (() => { const e = JSON.parse(envWith(() => {})); e.career = JSON.stringify({ version: 1, playerName: ["x"] }); return JSON.stringify(e); })(),
      parkedJunk: envWith(() => {}, { parked: { s2: JSON.stringify({ version: 1, rngState: [1, 2, 3, 4], staff: 7 }) } }),
    };
    for (const [k, raw] of Object.entries(tries)) {
      expect(await refusal(asFile(raw)), k).toMatch(DAMAGED);
      expect(await refusal(raw), `${k} (raw envelope)`).toMatch(DAMAGED);
    }
    const st = new FakeStorage(), s = mk(st);
    await expect(s.importFile(asFile(tries.objName!))).rejects.toThrow(DAMAGED);
    expect(st.getItem(INDEX_KEY) ?? "").not.toContain("evil");
  });

  it("the malformed inputs stay refused cleanly", async () => {
    const cases = ["", "{", "null", "[]", "1e999", '"hi"', JSON.stringify({ magic: "nope" }), JSON.stringify({ magic: FILE_MAGIC, encoding: "zip", data: "x" }),
      JSON.stringify({ magic: FILE_MAGIC, encoding: "gzip-b64", data: "!!!" }), envWith((g) => { g.version = 99; }), envWith((g) => { delete g.rngState; }), "[".repeat(200_000) + "]".repeat(200_000)];
    for (const t of cases) expect(await refusal(t)).not.toBe("ACCEPTED");
  });

  it("a 300 kB name is cut to 40 characters; bidi / zero-width characters are stripped; HTML stays text", async () => {
    const XSS = `<img src=x onerror="document.title='PWNED'">‮evil​⁦x\u0007`;
    const huge = await decodeSaveFile(asFile(envWith((g) => { g.restaurantName = "R".repeat(300_000); })));
    expect(huge.loaded.game.restaurantName).toBe("R".repeat(40));
    const x = await decodeSaveFile(asFile(envWith((g) => { g.restaurantName = XSS; }), XSS));
    expect(x.loaded.game.restaurantName).not.toMatch(/[‮​⁦\u0007]/);
    expect(x.name).not.toMatch(/[‮​]/);
    expect(x.name!.length).toBeLessThanOrEqual(40);
    // The account header stays small and the account stays on (S2).
    const db = new FakeDb("uA"), s = mk(new FakeStorage(), db);
    await s.connect();
    await s.importFile(asFile(envWith((g) => { g.restaurantName = "R".repeat(300_000); })));
    await s.flush(s.list()[0]!.slotId);
    expect(s.status().cloud).toBe("on");
    const header = [...db.docs.entries()].find(([k]) => /save-[^/]+$/.test(k))![1];
    expect(JSON.stringify(header).length).toBeLessThan(2000);
  });

  it("prototype keys never reach Object.prototype and are dropped from the game", async () => {
    const raw = envWith((g) => { g["__proto__"] = { polluted: 1 }; }, { ["__proto__"]: { polluted3: 1 } } as never).replace('"kind":"full-plate"', '"kind":"full-plate","__proto__":{"polluted4":1}');
    const { loaded } = await decodeSaveFile(asFile(raw));
    expect(({} as Record<string, unknown>).polluted ?? ({} as Record<string, unknown>).polluted3 ?? ({} as Record<string, unknown>).polluted4).toBeUndefined();
    expect(Object.getPrototypeOf(loaded.game)).toBe(Object.prototype);
  });

  it("import keeps the re-serialised game, never the file's text (S6: 3 MB of padding is dropped)", async () => {
    const pad = randomBytes(2_000_000).toString("base64");
    const raw = envWith(() => {}, { junk: pad });
    const db = new FakeDb("uA"), st = new FakeStorage(), s = mk(st, db);
    await s.connect();
    const v = await s.importFile(asFile(raw));
    await s.flush(v.slotId);
    const kept = st.getItem(slotKey(v.slotId))!;
    expect(kept.length).toBeLessThan(200_000);
    expect(kept).not.toContain(pad.slice(0, 64));
    expect([...db.docs.keys()].filter((k) => k.includes(`save-${v.slotId}/chunks/`))).toHaveLength(1);
    const l = await mk(st, db).load(v.slotId);
    expect((l!.loaded.meta as unknown as Record<string, unknown>).junk).toBeUndefined();
  });
});

describe("S4: size caps", () => {
  it("a gzip bomb stops at the 8 MB cap, quickly, with a plain message", async () => {
    const bomb = JSON.stringify({ magic: FILE_MAGIC, v: 1, name: "bomb", encoding: "gzip-b64", data: gzipSync(Buffer.alloc(64 * 2 ** 20), { level: 9 }).toString("base64") });
    const t0 = performance.now();
    expect(await refusal(bomb)).toMatch(/too big/);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
  it("text over 5 MB is refused before parsing; base64 is length-checked before atob", async () => {
    expect(await refusal(" ".repeat(MAX_FILE_BYTES + 1))).toMatch(/too big/);
    await expect(unpack("b64", "A".repeat(12_000_000))).rejects.toThrow(/too big/);
  });
  it("the picker refuses a file over 5 MB without reading it", async () => {
    const s = mk(new FakeStorage());
    render(<SlotPicker mode="browse" store={s} onContinue={() => {}} onClose={() => {}} />);
    const file = new File(["x"], "big.fpsave.json");
    Object.defineProperty(file, "size", { value: MAX_FILE_BYTES + 1 });
    let read = false;
    Object.defineProperty(file, "text", { value: async () => { read = true; return ""; } });
    fireEvent.change(screen.getByTestId("save-file-input"), { target: { files: [file] } });
    expect(await screen.findByText(/too big/)).toBeTruthy();
    expect(read).toBe(false);
  });
});

describe("S1: device cache and account headers can't reach the UI with the wrong types", () => {
  it("a damaged device index (object name) lists as text; the title renders; the damaged blob won't open", async () => {
    const st = new FakeStorage();
    st.setItem(INDEX_KEY, JSON.stringify({ v: 1, slots: [{ slotId: "bad", name: { evil: 1 }, restaurantName: { evil: 1 }, day: "7", cash: 1e400, path: "x", mode: "owner", difficulty: "cosy", updatedAt: 5, hash: "h", syncedHash: null }] }));
    st.setItem(slotKey("bad"), `json:${envWith((g) => { g.staff = { a: 1 }; })}`);
    const s = mk(st);
    const [v] = s.list();
    expect(typeof v!.name).toBe("string");
    expect(v!.day).toBe(0);
    render(<TitleScreen saved={null} slots={s.list()} onNew={() => {}} onContinue={() => {}} onYourGames={() => {}} />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(await s.load("bad")).toBeNull();
  });

  it("a header with an object name (written by an old build) is ignored on a second device, and the first device's copy goes back over it", async () => {
    const db = new FakeDb("kid");
    const A = mk(new FakeStorage(), db);
    await A.connect();
    const o = owner("Good");
    await A.save("s1", o.game, o.meta);
    await A.flush("s1");
    const path = "data/users/kid/save-s1";
    db.docs.set(path, { ...db.docs.get(path)!, name: { evil: true }, restaurantName: { evil: true } });
    const B = mk(new FakeStorage(), db);
    await B.connect();
    render(<TitleScreen saved={null} slots={B.list()} onNew={() => {}} onContinue={() => {}} onYourGames={() => {}} />);
    expect(B.list()).toEqual([]);
    // Device A reconnects: its copy is still there and is pushed over the bad header.
    const A2 = mk((A as unknown as { core: { d: { storage: FakeStorage } } }).core.d.storage, db);
    await A2.connect();
    await settle(80);
    await A2.flush("s1");
    expect(db.docs.get(path)!.name).toBe("Good");
  });

  it("S10: a header's chunkCount must equal ⌈packedLength / CHUNK⌉ and be ≤ 8; a forged one costs one read", async () => {
    const db = new FakeDb("uA"), s = mk(new FakeStorage(), db);
    await s.connect();
    const o = owner("F");
    await s.save("f", o.game, o.meta); await s.flush("f");
    const h = db.docs.get("data/users/uA/save-f")!;
    expect(checkHeader(h)).not.toBeNull();
    expect(checkHeader({ ...h, chunkCount: 200_000 })).toBeNull();
    expect(checkHeader({ ...h, chunkCount: 2 })).toBeNull();
    expect(checkHeader({ ...h, chunkCount: 9, packedLength: 9 * CHUNK_SIZE })).toBeNull();
    db.docs.set("data/users/uA/save-f", { ...h, chunkCount: 200_000, hash: "deadbeef" });
    const r0 = db.reads;
    await s.core.part!.fetch("f");
    expect(db.reads - r0).toBeLessThanOrEqual(2);
  });
});

describe("S2: one slot the account refuses stalls that slot, not the account", () => {
  it("invalid_argument on one slot's write: that card says it can't sync; other games still sync", async () => {
    const db = new FakeDb("uA");
    db.failSet = (p) => (p.includes("save-bad") ? "invalid_argument" : null);
    const s = mk(new FakeStorage(), db);
    await s.connect();
    const o = owner("A");
    await s.save("bad", o.game, o.meta); await s.flush("bad");
    expect(s.status().cloud).toBe("on");
    expect(s.status().blocked).toEqual(["bad"]);
    expect(s.list().find((x) => x.slotId === "bad")!.cantSync).toBe(true);
    expect(saveMark(s.status(), "bad")).toBe("device");
    await s.save("good", owner("B").game, o.meta); await s.flush("good");
    expect(db.docs.has("data/users/uA/save-good")).toBe(true);
    expect(saveMark(s.status(), "good")).toBe("account");
    render(<SlotPicker mode="browse" store={s} onContinue={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/Can't go to your account/)).toBeTruthy();
  });

  it("a game packed over ~1 MB stays on the device with a clear mark, and the account stays on", async () => {
    const db = new FakeDb("uA"), s = mk(new FakeStorage(), db);
    await s.connect();
    const o = owner();
    const meta = { ...o.meta, empireEvents: Array.from({ length: 300 }, (_, i) => ({ day: i, kind: "milestone", text: randomBytes(2900).toString("base64"), tone: "info" })) } as PathMeta;
    await s.save("huge", o.game, meta); await s.flush("huge");
    expect(s.status().cloud).toBe("on");
    expect(s.status().blocked).toEqual(["huge"]);
    expect([...db.docs.keys()].some((k) => k.includes("save-huge"))).toBe(false);
  });

  it("S11: after a header write that failed (but landed), the next push re-reads the header before picking a bank", async () => {
    const db = new FakeDb("uA"), st = new FakeStorage(), s = mk(st, db);
    await s.connect();
    const o = owner("Twice");
    await s.save("t", o.game, o.meta); await s.flush("t"); // bank a
    let n = 0;
    db.failSet = (p, data) => { if (p.endsWith("/save-t") && n++ < 2) { db.docs.set(p, JSON.parse(JSON.stringify(data))); return "unavailable"; } return null; };
    await s.save("t", { ...o.game, day: 2 }, o.meta); await s.flush("t"); // landed on bank b, reported failed
    expect(db.docs.get("data/users/uA/save-t")!.bank).toBe("b");
    db.failSet = null;
    await s.save("t", { ...o.game, day: 3 }, o.meta); await s.flush("t");
    // The re-read saw bank b, so this push wrote bank a and the header points at complete chunks.
    const h = db.docs.get("data/users/uA/save-t")!;
    expect(h.bank).toBe("a");
    const other = mk(new FakeStorage(), db);
    await other.connect();
    expect((await other.load("t"))!.loaded.game.day).toBe(3);
  });
});

describe("S5: a shared browser and two accounts", () => {
  it("account B never gets A's offline game, A's synced game isn't deleted, and A sees both again", async () => {
    const dbA = new FakeDb("uA"), dbB = new FakeDb("uB", dbA);
    const st = new FakeStorage();
    const A = mk(st, dbA); await A.connect();
    const a1 = owner("Parent synced"); await A.save("p1", a1.game, a1.meta); await A.flush("p1");
    A.core.st.cloud = "off"; // the parent plays one offline
    const a2 = owner("Parent offline"); await A.save("p2", a2.game, a2.meta); await settle();
    A.dispose();
    const B = mk(st, dbB); await B.connect(); await settle(120);
    expect([...dbA.docs.keys()].filter((k) => k.startsWith("data/users/uB/") && /save-/.test(k))).toEqual([]);
    expect(B.list().map((x) => x.name)).toEqual([]);
    expect(st.getItem(slotKey("p1"))).toBeTruthy();
    // The child's own game is tied to the child.
    await B.save("k1", owner("Kid's").game, a1.meta); await B.flush("k1");
    const A2 = mk(st, dbA); await A2.connect(); await settle(120);
    expect(A2.list().map((x) => x.name).sort()).toEqual(["Parent offline", "Parent synced"]);
    expect([...dbA.docs.keys()].some((k) => k === "data/users/uA/save-p2")).toBe(true);
    expect(st.getItem(OWNER_KEY)).not.toContain("uA"); // a hash, not the id
  });

  it("settings and onboarding flags from another account don't carry over (they are replaced, not merged)", async () => {
    const dbA = new FakeDb("uA"), dbB = new FakeDb("uB", dbA);
    const st = new FakeStorage();
    let local = { settings: { sound: false } as Record<string, unknown>, onboard: ["full-plate:onboard:v1:chef:1"] };
    let forgot = 0;
    const bridge = { read: () => local, adopt: (p: { settings?: Record<string, unknown>; onboard?: string[] }) => { local = { settings: p.settings ?? local.settings, onboard: p.onboard ?? local.onboard }; }, forget: () => { forgot++; local = { settings: {}, onboard: [] }; } };
    const A = mk(st, dbA); A.attachPrefs(bridge); await A.connect(); await settle();
    expect((dbA.docs.get("data/users/uA/prefs") as { onboard: string[] }).onboard).toHaveLength(1);
    const B = mk(st, dbB); B.attachPrefs(bridge); await B.connect(); await settle();
    expect(forgot).toBe(1);
    expect((dbA.docs.get("data/users/uB/prefs") as { onboard: string[] }).onboard).toEqual([]);
  });
});

describe("S6: backups, orphans, prefs", () => {
  it("repeated two-device conflicts keep at most two backups per game", async () => {
    const db = new FakeDb("uA");
    const o = owner("Twin");
    const A = mk(new FakeStorage(), db); await A.connect(); await A.save("t", o.game, o.meta); await settle();
    const B = mk(new FakeStorage(), db); await B.connect(); await B.load("t"); await settle();
    for (let r = 1; r <= 10; r++) {
      A.core.st.cloud = "off"; B.core.st.cloud = "off";
      await A.save("t", { ...o.game, day: 10 * r }, o.meta); await B.save("t", { ...o.game, day: 10 * r + 1, cash: r }, o.meta);
      A.core.st.cloud = "on"; B.core.st.cloud = "on";
      await B.core.part!.push("t"); await settle(30);
      clock += 60_000;
      await A.load("t"); await settle(60);
      await B.load("t"); await settle(60);
    }
    expect(A.list().length).toBeLessThanOrEqual(3);
    expect(A.list().filter((x) => x.backupOf === "t").length).toBeLessThanOrEqual(2);
  });

  it("a push that stops half-way leaves no orphan chunks once the slot is deleted", async () => {
    const db = new FakeDb("uA"), s = mk(new FakeStorage(), db);
    await s.connect();
    const o = owner("Leak");
    await s.save("leak", o.game, o.meta); await s.flush("leak");
    // ~5 chunks; chunk 3 fails twice (transient) → stalled after b-0..b-2.
    const big = { ...o.meta, empireEvents: Array.from({ length: 200 }, (_, i) => ({ day: i, kind: "milestone", text: randomBytes(2400).toString("base64"), tone: "info" })) } as PathMeta;
    let n = 0;
    db.failSet = (p) => (p.endsWith("/chunks/b-3") && n++ < 2 ? "unavailable" : null);
    await s.save("leak", o.game, big); await s.flush("leak");
    expect([...db.docs.keys()].filter((k) => k.includes("save-leak/chunks/b-")).length).toBe(3);
    db.failSet = null;
    await s.save("leak", { ...o.game, day: 3 }, o.meta); await s.flush("leak");
    await s.remove("leak"); await settle();
    expect([...db.docs.keys()].filter((k) => k.includes("save-leak"))).toEqual([]);
  });

  it("the account keeps the newest 50 onboarding flags", async () => {
    const db = new FakeDb("uA"), s = mk(new FakeStorage(), db);
    const flags = Array.from({ length: 80 }, (_, i) => `full-plate:onboard:v1:chef:${i}`);
    s.attachPrefs({ read: () => ({ settings: {}, onboard: flags }), adopt: () => {} });
    await s.connect(); await settle();
    const p = db.docs.get("data/users/uA/prefs") as { onboard: string[] };
    expect(p.onboard).toHaveLength(MAX_ONBOARD_FLAGS);
    expect(p.onboard).toContain(flags.at(-1));
    expect(p.onboard).not.toContain(flags[0]);
  });
});

describe("G10: autosave never throws on a state that can't be packed", () => {
  it("a NaN in the Empire makes the mark say Couldn't save; the next good save clears it", async () => {
    const s = mk(new FakeStorage());
    const o = owner();
    const badEmpire = { version: 1, hq: { cash: NaN } } as unknown as EmpireState;
    await expect(s.save("x", o.game, { ...o.meta, empire: badEmpire })).resolves.toBeUndefined();
    expect(s.status().failed).toEqual(["x"]);
    expect(saveMark(s.status(), "x")).toBe("failed");
    await s.save("x", o.game, o.meta);
    expect(s.status().failed).toBeUndefined();
  });
});

describe("S1: the error page above the title", () => {
  function Boom(): never { throw new Error("boom"); }
  it("a crash on the title lists every game (names as text) with Delete, and Back to title remounts", async () => {
    const st = new FakeStorage(), s = mk(st);
    const o = owner("Crashy");
    await s.save("c1", o.game, o.meta); await settle();
    const err = console.error; console.error = () => {};
    try {
      render(<CrashGuard store={s}><Boom /></CrashGuard>);
    } finally { console.error = err; }
    expect(screen.getByText(/Something went wrong/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete Crashy" }));
    // R14 (C, U2): Delete asks first, naming the game, and offers a copy to a file.
    expect(screen.getByRole("heading", { name: "Delete Crashy?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save a copy to a file" })).toBeTruthy();
    expect(s.list()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Delete Crashy" }));
    await settle();
    expect(s.list()).toEqual([]);
    expect(screen.getByRole("status").textContent).toMatch(/Crashy was deleted/);
    expect(screen.getByRole("button", { name: "Back to title" })).toBeTruthy();
  });
  it("a crash while a game is open offers Delete this game", async () => {
    const s = mk(new FakeStorage());
    const o = owner("Open one");
    await s.save("g1", o.game, o.meta); await settle();
    noteSlot("g1");
    const err = console.error; console.error = () => {};
    try { render(<CrashGuard store={s}><Boom /></CrashGuard>); } finally { console.error = err; }
    fireEvent.click(screen.getByRole("button", { name: "Delete this game…" }));
    await settle();
    expect(s.list()).toHaveLength(1); // R14 (C, U2): not yet: the confirm names the game
    fireEvent.click(screen.getByRole("button", { name: "Delete Open one" }));
    await settle();
    expect(s.list()).toEqual([]);
  });
});

// ── G9–G14: the sims refuse junk instead of storing it ──
const finiteDeep = (v: unknown): boolean => (typeof v === "number" ? Number.isFinite(v) : v && typeof v === "object" ? Object.values(v).every(finiteDeep) : true);
const rejectedEmpire = (e: EmpireState, cmd: unknown) => applyEmpireCommand(content, e, cmd as never).events.find((x) => x.kind === "rejected")?.text;

function yearTwo(): { game: GameState; meta: PathMeta } {
  let g = owner("Det", 17).game;
  for (let d = 0; d < 24; d++) g = strategies.runStrategyDay(content, g, STRATEGIES.balanced);
  return { game: { ...g, day: FORK_DAY, history: g.history.map((h) => ({ ...h, profit: Math.max(h.profit, 10_000) })) }, meta: { ...initialMeta("owner"), lastPathDay: FORK_DAY - 1 } };
}

describe("G9–G14: sim robustness", () => {
  it("G9: Object.prototype names are not commands in any dispatcher", () => {
    const g = owner().game;
    const e = forkFromGameState(content, yearTwo().game, { brandName: "B" });
    const stars = newStarsState(content, yearTwo().game);
    const cg = newCareer(content, { seed: 3, track: "chef" });
    for (const type of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(() => applyCommand(content, g, { type } as never)).not.toThrow();
      expect(rejectedEmpire(e, { type })).toBe("Unknown command.");
      expect(applyStarsCommand(content, stars, { type } as never, { day: 0, cash: 0, state: g }).events[0]).toMatchObject({ type: "REJECTED" });
      expect(applyCareerCommand(content, cg, { type } as never).rejected).toBe("Unknown command.");
    }
    expect(() => applyCommand(content, g, null as never)).not.toThrow();
  });

  it("G13: HIRE refuses an id that's already on the staff", () => {
    let s = { ...owner().game, cash: 10_000_000 };
    const id = `s${s.day}-0`;
    s = applyCommand(content, s, { type: "HIRE_STAFF", staff: { id, name: "Former Colleague", role: "chef", skill: 60, speed: 60, charm: 50, wage: 1300, mood: 70, fatigue: 0, traits: [], hiredDay: 0, potential: 70, rota: [true, true, true, true, true, true, true] } }).state;
    const after = applyCommand(content, s, { type: "HIRE", candidateIndex: 0 }).state;
    const ids = after.staff.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("G10/G14: Empire junk arguments are refused and nothing non-finite is stored", () => {
    const e = forkFromGameState(content, yearTwo().game, { brandName: "B" });
    const junk: unknown[] = [
      { type: "SET_CONTRACT", contract: { royaltyPct: NaN }, applyTo: "all" }, { type: "SET_CONTRACT", contract: { fee: Infinity }, applyTo: "new" },
      { type: "SET_FORMULA", priceIndex: NaN }, { type: "SET_INSPECTIONS", everyDays: NaN }, { type: "SET_SUPPLY_MARKUP", pct: Infinity },
      { type: "LAUNCH_PRODUCT", name: "x", budget: Infinity, fit: "core" }, { type: "LAUNCH_PRODUCT", name: "x", budget: 100_000, fit: "toString" },
      { type: "TRANSFER_FROM_FOCUSED", amount: Infinity }, { type: "LAUNCH_CAMPAIGN", kind: "brand", budget: 0.4 }, { type: "RESEARCH", tech: "toString" },
      { type: "OPEN_SITE", cityId: e.cities[0]!.id, districtId: "x", ownership: "nope", land: "thirdParty" },
    ];
    for (const c of junk) {
      const r = applyEmpireCommand(content, e, c as never);
      expect(r.events.some((x) => x.kind === "rejected"), JSON.stringify(c)).toBe(true);
      expect(finiteDeep(r.empire)).toBe(true);
    }
    const fr = e.franchisees.find((f) => f.sites.length);
    if (fr) expect(rejectedEmpire(e, { type: "FEE_HOLIDAY", franchiseeId: fr.id, days: NaN })).toBeTruthy();
  });

  it("G14: campaigns need £500 and don't stack (each running one halves the next's lift)", () => {
    let e = forkFromGameState(content, yearTwo().game, { brandName: "B" });
    e = { ...e, hq: { ...e.hq, cash: 1e10 } };
    expect(rejectedEmpire(e, { type: "LAUNCH_CAMPAIGN", kind: "brand", budget: 49_999 })).toMatch(/at least/);
    const lifts: number[] = [];
    for (let i = 0; i < 3; i++) { e = applyEmpireCommand(content, e, { type: "LAUNCH_CAMPAIGN", kind: "brand", budget: 5_000_000 }).empire; lifts.push(e.effects.at(-1)!.demand); }
    expect(lifts).toEqual([0.03, 0.015, 0.0075]);
  });

  it("G14: moving money from the till must be finite and no more than the till holds", () => {
    const y = yearTwo();
    const s = appReducer({ ...initialAppState, game: y.game, meta: y.meta }, { type: "fork", choice: "empire" });
    for (const amount of [Infinity, NaN, s.game!.cash + 1]) {
      const r = empireCommand(s.game!, s.meta, { type: "TRANSFER_FROM_FOCUSED", amount });
      expect(r.game.cash).toBe(s.game!.cash);
      expect(r.meta.empire!.hq.cash).toBe(s.meta.empire!.hq.cash);
    }
  });

  it("G11: Stars refuses unknown satellite kinds, NaN counts and days, and a backed chef past the cap", () => {
    const y = yearTwo();
    const stars = newStarsState(content, y.game);
    const ctx = { day: y.game.day, cash: 1e10, state: y.game };
    const rej = (cmd: unknown, st = stars) => applyStarsCommand(content, st, cmd as never, ctx).events.find((x) => x.type === "REJECTED");
    expect(() => applyStarsCommand(content, stars, { type: "OPEN_SATELLITE", kind: "spaceship" } as never, ctx)).not.toThrow();
    expect(rej({ type: "OPEN_SATELLITE", kind: "spaceship" })).toBeTruthy();
    expect(rej({ type: "OPEN_SATELLITE", kind: "backed" })).toBeTruthy();
    expect(rej({ type: "SET_STAGIAIRE_POLICY", paid: true, count: NaN })).toBeTruthy();
    expect(rej({ type: "CLOSE_FOR_REFIT", days: NaN })).toBeTruthy();
    const full = { ...stars, headChef: { ...stars.headChef, wantsOwnPlace: true }, satellites: Array.from({ length: STARS_CONSTANTS.MAX_SATELLITES }, (_, i) => ({ id: `sat${i}`, kind: "bar" as const, name: "B", openedDay: 0, headChefTrained: true, staffAbsorbed: 0, earned: 0 })) };
    expect(rej({ type: "BACK_HEAD_CHEF" }, full)).toBeTruthy();
  });

  it("G12: the fork happens once, from the fork day, in an owner game; a non-string brand is refused", () => {
    const y = yearTwo();
    const s0: AppState = { ...initialAppState, game: y.game, meta: y.meta };
    expect(appReducer({ ...s0, game: { ...y.game, day: 10 } }, { type: "fork", choice: "empire" }).meta.empire).toBeUndefined();
    expect(appReducer(s0, { type: "fork", choice: "empire", brandName: { x: 1 } as never }).meta.empire).toBeUndefined();
    expect(appReducer({ ...s0, meta: { ...y.meta, mode: "career" } }, { type: "fork", choice: "stars" }).meta.stars).toBeUndefined();
    const once = appReducer(s0, { type: "fork", choice: "empire" });
    expect(once.meta.empire).toBeTruthy();
    const again = appReducer({ ...once, meta: { ...once.meta, fork: { offered: true } } }, { type: "fork", choice: "stars" });
    expect(again.meta.stars).toBeUndefined();
    expect(again.meta.empire).toBe(once.meta.empire);
    expect(appReducer(s0, { type: "fork", choice: "snooze" }).meta).toBe(s0.meta); // no card showing
  });

  it("G14: SET_OWNER_PROFILE can't come from a screen", () => {
    const o = owner();
    const s = appReducer({ ...initialAppState, ...o }, { type: "command", cmd: { type: "SET_OWNER_PROFILE", skill: 100, speed: 100, charm: 100 } as never });
    expect(s.game!.ownerProfile).toBeUndefined();
  });
});

describe("the validators accept every real save", () => {
  const same = (game: GameState, meta: PathMeta) => {
    const raw = encodeSave(game, meta);
    const v = validateLoaded(decodeSave(raw));
    expect(encodeSave(v.game, v.meta)).toBe(raw);
  };
  it("owner (60 played days, mid-service too), Empire, Stars and a career", () => {
    let g = owner("Real", 11).game;
    for (let d = 0; d < 60; d++) g = strategies.runStrategyDay(content, g, STRATEGIES.typical);
    same(g, initialMeta("owner"));
    let mid = appReducer({ ...initialAppState, game: g, meta: initialMeta("owner") }, { type: "command", cmd: { type: "START_SERVICE" } });
    for (let i = 0; i < 37 && mid.game!.phase === "service"; i++) mid = appReducer(mid, { type: "ticks", n: 1 });
    expect(mid.game!.customers.length).toBeGreaterThan(0);
    same(mid.game!, mid.meta);
    const y = yearTwo();
    const emp = appReducer({ ...initialAppState, game: y.game, meta: y.meta }, { type: "fork", choice: "empire" });
    same(emp.game!, emp.meta);
    const st = appReducer({ ...initialAppState, game: y.game, meta: y.meta }, { type: "fork", choice: "stars" });
    same(st.game!, st.meta);
    let c = appReducer(initialAppState, { type: "newCareer", seed: 5, track: "chef", strategy: "balanced", playerName: "Alex", difficulty: "normal" });
    for (let d = 0; d < 20; d++) {
      if (c.game!.phase === "planning") c = appReducer(c, { type: "command", cmd: { type: "START_SERVICE" } });
      while (c.game!.phase === "service") c = appReducer(c, { type: "ticks", n: 50 });
      c = appReducer(c, { type: "nextDay" });
    }
    same(c.game!, c.meta);
  });
});
