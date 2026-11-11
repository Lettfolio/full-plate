/**
 * Round 14 (C): never lose a save to a hiccup. Red-team findings U2/S14-4, S14-7, S14-9, S14-10, U15
 * (docs/RED-TEAM-2.md). Each block below fails on master 823733b.
 *  - U2/S14-4: lazy chunks retry, then a ChunkLoadError; each lazy part has its own boundary ("Couldn't load this
 *    part", Try again, Back); CrashGuard never offers Delete for a chunk error, and Delete asks first (and offers a
 *    copy to a file); a redeployed build is noticed; the day's chunks are prefetched.
 *  - S14-7: the storage migration under quota: saves before the index, copies verified, nothing out of reach.
 *  - S14-9: the playtest switches are a build flag, not a localStorage key.
 *  - S14-10: a non-live recipe on the menu or the set menu is dropped on load, with a note.
 *  - U15: blocked or full storage is said on the game screen and the title.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { Suspense } from "react";
import { liveDishes } from "@full-plate/content";
import {
  ChunkBack, ChunkLoadError, isChunkError, lazyRetry, newVersionReady, reloadSaved, retryImport, retrySettings, setSaveBeforeReload,
} from "../lib/lazyRetry";
import { CrashGuard, noteSlot } from "../components/CrashGuard";
import { PREFETCHED, prefetchDay, resetPrefetch } from "../lib/prefetch";
import { deviceStorage, migrateToScope, resetStorageForTests, storageFull } from "../lib/storage";
import { checkedDecode, type CheckedLoaded } from "../state/saveCheck";
import { encodeSave } from "../state/save";
import { setSaveStore, type SaveStore, type StoreStatus } from "../state/saveStore";
import { createSaveStore } from "../state/saveCore";
import { resetStorageNotice, StorageNotice } from "../components/StorageNotice";
import { storageTrouble } from "../lib/storageTrouble";
import { StatusBar } from "../components/StatusBar";
import { appReducer, initialAppState } from "../state/gameReducer";
import { content } from "../sim";
import { loadedApp, playDay } from "./fixtures/corpus/playDay";

const SRC = resolve(__dirname, "..");
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); });
const offlineErr = () => new TypeError("Failed to fetch dynamically imported module: http://x/assets/StaffTab-abc.js");
const quiet = <T,>(fn: () => T): T => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };

beforeEach(() => { retrySettings.delays = [1, 1]; });
afterEach(() => { cleanup(); retrySettings.delays = [400, 1500]; noteSlot(null); setSaveBeforeReload(null); setSaveStore(null); });

// ── U2 / S14-4 ──────────────────────────────────────────────────────────────
describe("U2/S14-4: a chunk that won't load is a connection problem", () => {
  it("retryImport tries three times, then throws a ChunkLoadError (a bug in the module is not one)", async () => {
    let n = 0;
    await expect(retryImport(async () => { if (++n < 3) throw offlineErr(); return "ok"; })).resolves.toBe("ok");
    expect(n).toBe(3);
    n = 0;
    const e = await retryImport(async () => { n++; throw offlineErr(); }).catch((x: unknown) => x);
    expect(n).toBe(3);
    expect(e).toBeInstanceOf(ChunkLoadError);
    expect(isChunkError(e)).toBe(true);
    const bug = await retryImport(async () => { throw new RangeError("bad"); }).catch((x: unknown) => x);
    expect(bug).toBeInstanceOf(RangeError);
    expect(isChunkError(new Error("Importing a module script failed."))).toBe(true); // Safari's words
    expect(isChunkError(new Error("boom"))).toBe(false);
  });

  it("a redeploy is noticed: index.html names other scripts than this page's", async () => {
    const doc = document.implementation.createHTMLDocument("x");
    doc.head.innerHTML = '<script type="module" crossorigin src="./assets/index-OLD111.js"></script>';
    const page = (src: string) => (async () => new Response(`<html><head><script type="module" crossorigin src="${src}"></script></head></html>`)) as unknown as typeof fetch;
    expect(await newVersionReady(doc, page("./assets/index-NEW222.js"))).toBe(true);
    expect(await newVersionReady(doc, page("./assets/index-OLD111.js"))).toBe(false);
    expect(await newVersionReady(doc, (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)).toBe(false);
  });

  it("every lazy part has its own boundary: the rest stays, Try again re-imports, Back goes where the screen says", async () => {
    let ok = false, calls = 0;
    const Part = lazyRetry(async () => { calls++; if (!ok) throw offlineErr(); return { default: ({ who }: { who: string }) => <p>Hello {who}</p> }; });
    const back = vi.fn();
    render(
      <main>
        <p>The planning screen</p>
        <ChunkBack to={{ label: "Back to the menu", go: back }}>
          <Suspense fallback={<p>Loading…</p>}><Part who="Mia" /></Suspense>
        </ChunkBack>
      </main>,
    );
    expect(await screen.findByText("Couldn't load this part.")).toBeTruthy();
    expect(calls).toBe(3);
    expect(screen.getByText("The planning screen")).toBeTruthy(); // the game underneath is alive
    expect(screen.getByRole("alert").textContent).toMatch(/Check your connection/);
    fireEvent.click(screen.getByRole("button", { name: "Back to the menu" }));
    expect(back).toHaveBeenCalledTimes(1);
    ok = true;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Hello Mia")).toBeTruthy();
    expect(calls).toBe(4);
  });

  it("a stale page (new version deployed) offers Reload, which saves the game first", async () => {
    const Part = lazyRetry(async () => { throw new ChunkLoadError("gone", true); });
    const order: string[] = [];
    setSaveBeforeReload(async () => { order.push("saved"); });
    render(<Suspense fallback={null}><Part /></Suspense>);
    expect(await screen.findByText("A new version of Full Plate is ready.")).toBeTruthy();
    await reloadSaved(() => order.push("reload"));
    expect(order).toEqual(["saved", "reload"]);
  });

  it("any other error still reaches CrashGuard", async () => {
    function Bad(): never { throw new Error("a real bug"); }
    const Part = lazyRetry(async () => ({ default: Bad }));
    quiet(() => render(<CrashGuard><Suspense fallback={null}><Part /></Suspense></CrashGuard>));
    expect(await screen.findByText("Something went wrong.")).toBeTruthy();
  });

  it("CrashGuard: a chunk error while a game is open offers Reload and Back to title, never Delete", async () => {
    noteSlot("g1");
    function Gone(): never { throw new ChunkLoadError("Failed to fetch dynamically imported module"); }
    const reload = vi.fn();
    quiet(() => render(<CrashGuard reload={reload}><Gone /></CrashGuard>));
    expect(screen.getByRole("heading").textContent).toMatch(/Couldn't load the next part of the game/);
    expect(screen.queryByText(/damaged/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Back to title" })).toBeTruthy();
  });

  it("CrashGuard: Delete names the game, asks first and offers the raw save as a file", async () => {
    const saveToFile = vi.fn(async () => "saved" as const);
    const remove = vi.fn(async () => {});
    const store = { list: () => [{ slotId: "g1", name: "Bella's Bites" }], saveToFile, remove } as unknown as SaveStore;
    noteSlot("g1");
    function Boom(): never { throw new Error("damaged"); }
    quiet(() => render(<CrashGuard store={store}><Boom /></CrashGuard>));
    fireEvent.click(screen.getByRole("button", { name: "Delete this game…" }));
    expect(remove).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Delete Bella's Bites?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save a copy to a file" }));
    await settle();
    expect(saveToFile).toHaveBeenCalledWith("g1");
    expect(screen.getByRole("status").textContent).toMatch(/Saved a copy/);
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete this game…" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Bella's Bites" }));
    expect(remove).toHaveBeenCalledWith("g1");
  });

  it("no bare React.lazy anywhere: every lazy part goes through lazyRetry", () => {
    const bad: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) { if (f !== "__tests__") walk(p); continue; }
        if (!/\.(tsx?|jsx?)$/.test(f) || p.endsWith(join("lib", "lazyRetry.tsx"))) continue;
        const s = readFileSync(p, "utf8");
        if (/(^|[^\w.])lazy\s*\(|React\.lazy\s*\(|\bimport\s*\{[^}]*\blazy\b[^}]*\}\s*from\s*"react"/.test(s)) bad.push(relative(SRC, p));
      }
    };
    walk(SRC);
    expect(bad).toEqual([]);
  });

  it("the day's chunks are prefetched: every lazy part of planning, the floor and the evening is in the list", () => {
    const files = [
      "screens/Planning.tsx", ...readdirSync(join(SRC, "screens/planning")).filter((f) => f.endsWith(".tsx")).map((f) => `screens/planning/${f}`),
      "screens/Evening.tsx", "screens/Service.tsx", "screens/ChapterCard.tsx", "components/Bank.tsx", "components/RivalCard.tsx",
      "components/SaveIndicator.tsx", "components/WordsSheet.tsx", "components/Settings.tsx", "canvas/frame.ts",
    ];
    const want = new Set<string>();
    for (const f of files) {
      const s = readFileSync(join(SRC, f), "utf8");
      for (const m of s.matchAll(/import\("([^"]+)"\)/g)) want.add(relative(SRC, resolve(join(SRC, f, ".."), m[1]!)).replace(/\\/g, "/"));
      if (/loadFriends\(\)/.test(s)) want.add("screens/VisitFriend");
    }
    // App's own: the evening, the morning post, the chapter card, game over.
    for (const x of ["screens/Evening", "screens/EventModal", "screens/ChapterCard", "screens/GameOver"]) want.add(x);
    const missing = [...want].filter((x) => !PREFETCHED.includes(x));
    expect(missing).toEqual([]);
    expect(want.size).toBeGreaterThan(20);
  });

  it("prefetchDay fetches each chunk once a visit (the path tab when one is chosen)", () => {
    resetPrefetch();
    const first = prefetchDay();
    expect(first).toBe(PREFETCHED.length - 2);
    expect(prefetchDay()).toBe(0);
    expect(prefetchDay("stars")).toBe(1);
    resetPrefetch();
  });
});

// ── S14-7 ───────────────────────────────────────────────────────────────────
/** A Storage with a quota in UTF-16 units (Chromium's is about 5M), insertion-ordered keys (the reviewer's). */
class QStore implements Storage {
  m = new Map<string, string>();
  constructor(public quota = 5_000_000) {}
  get length() { return this.m.size; }
  used() { let n = 0; for (const [k, v] of this.m) n += k.length + v.length; return n; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { const old = this.m.get(k); const add = k.length + v.length - (old === undefined ? 0 : k.length + old.length); if (this.used() + add > this.quota) throw new DOMException("full", "QuotaExceededError"); this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

describe("S14-7: the storage migration with the storage nearly full", () => {
  let restore: () => void = () => {};
  const useStorage = (s: Storage, path = "/full-plate/") => {
    const own = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => s });
    window.history.replaceState(null, "", path);
    resetStorageForTests();
    restore = () => { if (own) Object.defineProperty(window, "localStorage", own); else delete (window as { localStorage?: unknown }).localStorage; window.history.replaceState(null, "", "/"); resetStorageForTests(); };
  };
  afterEach(() => restore());
  const INDEX = "full-plate:slots:v1";
  const slot = (id: string) => `full-plate:slot:v1:${id}`;
  function nearlyFull(): QStore {
    const s = new QStore(5_000_000);
    s.setItem(INDEX, JSON.stringify({ v: 1, slots: [{ slotId: "a", hash: "h" }, { slotId: "b", hash: "h2" }, { slotId: "c", hash: "h3" }] }));
    s.setItem(slot("a"), "b64:" + "x".repeat(1_400_000));
    s.setItem(slot("b"), "b64:" + "y".repeat(1_400_000));
    s.setItem(slot("c"), "b64:" + "z".repeat(1_400_000));
    return s;
  }

  it("the reviewer's case: the index never moves ahead of its saves, and every save stays in reach", () => {
    const s = nearlyFull();
    for (let visit = 1; visit <= 3; visit++) expect(migrateToScope(s, "full-plate")).toBe(false);
    // Nothing that couldn't all move has moved; nothing is lost.
    expect(s.getItem(`full-plate/${INDEX}`)).toBeNull();
    expect(s.getItem(INDEX)).not.toBeNull();
    for (const id of ["a", "b", "c"]) expect(s.getItem(slot(id)) ?? s.getItem(`full-plate/${slot(id)}`)).not.toBeNull();
    // The page reads through: the index lists three games, and each is there.
    useStorage(s);
    const view = deviceStorage()!;
    const listed = (JSON.parse(view.getItem(INDEX)!) as { slots: { slotId: string }[] }).slots.map((x) => x.slotId);
    expect(listed).toEqual(["a", "b", "c"]);
    for (const id of listed) expect(view.getItem(slot(id))?.length).toBeGreaterThan(1_000_000);
    expect(storageFull()).toBe(true);
    // A save to a game still in the old place is written there, in place (no room for a second copy).
    view.setItem(slot("b"), "b64:" + "w".repeat(1_400_000));
    expect(s.getItem(slot("b"))!.startsWith("b64:w")).toBe(true);
    expect(s.getItem(`full-plate/${slot("b")}`)).toBeNull();
  });

  it("a half-moved store from Round 13 (index across, one save left behind) still reaches every save", () => {
    const s = nearlyFull();
    // What master's migration left: the index and two saves moved, "b" stuck under its old key.
    for (const k of [INDEX, slot("a"), slot("c")]) { const v = s.getItem(k)!; s.removeItem(k); s.setItem(`full-plate/${k}`, v); }
    useStorage(s);
    const view = deviceStorage()!;
    for (const id of ["a", "b", "c"]) expect(view.getItem(slot(id))).not.toBeNull();
    expect(storageFull()).toBe(true);
  });

  it("once there's room the move finishes (saves first, index last), and the scoped view takes over", () => {
    const s = nearlyFull();
    s.quota = 20_000_000;
    const order: string[] = [];
    const spy = new Proxy(s, { get(t, p) { if (p === "setItem") return (k: string, v: string) => { order.push(k); t.setItem(k, v); }; const v = Reflect.get(t, p); return typeof v === "function" ? v.bind(t) : v; } });
    expect(migrateToScope(spy as Storage, "full-plate")).toBe(true);
    const moved = order.filter((k) => k.startsWith("full-plate/full-plate:slot:"));
    expect(order.indexOf(`full-plate/${INDEX}`)).toBeGreaterThan(Math.max(...moved.map((k) => order.indexOf(k))));
    expect([...s.m.keys()].every((k) => k.startsWith("full-plate/"))).toBe(true);
    useStorage(s);
    expect(storageFull()).toBe(false);
  });

  it("a copy that doesn't read back is not trusted: the old key stays", () => {
    const s = new QStore();
    s.setItem(slot("a"), "json:{}");
    const liar = new Proxy(s, { get(t, p) { if (p === "setItem") return (k: string, v: string) => t.setItem(k, k.startsWith("full-plate/") ? v.slice(0, 2) : v); const v = Reflect.get(t, p); return typeof v === "function" ? v.bind(t) : v; } });
    expect(migrateToScope(liar as Storage, "full-plate")).toBe(false);
    expect(s.getItem(slot("a"))).toBe("json:{}");
    expect(s.getItem(`full-plate/${slot("a")}`)).toBeNull(); // the bad copy is taken back
  });

  it("with the storage full the game screen says so, with Save to a file", () => {
    const s = nearlyFull();
    useStorage(s);
    const status: StoreStatus = { cloud: "off", reason: "none", local: true, pending: [] };
    expect(storageTrouble(status)).toBe("full");
    resetStorageNotice();
    render(<StorageNotice status={status} where="game" onFile={async () => "Saved to a file ✓"} />);
    expect(screen.getByRole("status").textContent).toMatch(/storage is full/);
    expect(screen.getByRole("button", { name: /Save to a file/ })).toBeTruthy();
  });
});

// ── S14-9 ───────────────────────────────────────────────────────────────────
describe("S14-9: the playtest switches are a build flag, not a localStorage key", () => {
  it("devSwitches reads no storage; the flag is defined by vite.config from FP_PLAYTEST only", () => {
    const src = readFileSync(join(SRC, "lib/perfMeter.ts"), "utf8");
    const fn = src.slice(src.indexOf("export function devSwitches"), src.indexOf("export function perfEnabled"));
    expect(fn).toMatch(/import\.meta\.env\.DEV \|\| __FP_PLAYTEST__/);
    expect(fn).not.toMatch(/Storage|getItem|full-plate:dev/);
    expect(src).not.toMatch(/full-plate:dev/);
    const cfg = readFileSync(join(SRC, "../vite.config.ts"), "utf8");
    expect(cfg).toMatch(/__FP_PLAYTEST__: JSON\.stringify\(process\.env\.FP_PLAYTEST === "1"\)/);
    // The scripts that need the switches build a playtest copy; none sets the old key.
    const scripts = join(SRC, "../scripts");
    for (const f of ["lib/harness.mjs", "perf-floor.mjs", "playtest-coop-live.mjs", "probe.mjs", "type-audit.mjs"]) expect(readFileSync(join(scripts, f), "utf8")).not.toMatch(/full-plate:dev/);
    expect(readFileSync(join(scripts, "perf-floor.mjs"), "utf8")).toMatch(/playtestDist\(\)/);
  });
});

// ── S14-10 ──────────────────────────────────────────────────────────────────
describe("S14-10: a deleted or old recipe on the menu is dropped on load, with a note", () => {
  const raw = (f: string) => gunzipSync(readFileSync(join(__dirname, "fixtures/corpus", f))).toString("utf8");
  it("the reviewer's crafted save (40 recipes, 28 deleted, all on the menu) loads with only the live ones on it", () => {
    const l0 = checkedDecode(raw("r13-owner-cookbook-d8.json.gz"));
    const proto = l0.meta.customDishes![0]!;
    const recs = Array.from({ length: 40 }, (_, i) => ({ ...proto, id: `custom:zz${String(i).padStart(4, "0")}`, name: `Dish ${i}`, ...(i >= 12 ? { deleted: true } : {}), oldOf: undefined }));
    const game = { ...l0.game, menu: [...l0.game.menu.filter((m) => !m.dishId.startsWith("custom:")), ...recs.map((r) => ({ dishId: r.id, price: 900, active: true, sold7d: 0, margin7d: 0 }))] };
    const l = checkedDecode(encodeSave(game, { ...l0.meta, customDishes: recs as never, cookbookOrder: [] })) as CheckedLoaded;
    const custom = l.game.menu.filter((m) => m.dishId.startsWith("custom:")).map((m) => m.dishId);
    expect(custom).toHaveLength(12);
    const live = new Set(liveDishes(l.meta).map((d) => d.id));
    expect(custom.every((id) => live.has(id))).toBe(true);
    expect(l.repairs?.[0]).toMatch(/Dish 12, Dish 13, Dish 14 and 25 more came off the menu/);
    expect(() => playDay(loadedApp(l))).not.toThrow();
  });

  it("an old version on the set menu is taken off it; a clean save has no note and is byte-identical", () => {
    const l0 = checkedDecode(raw("r13-owner-cookbook-d8.json.gz"));
    expect((l0 as CheckedLoaded).repairs).toBeUndefined();
    expect(encodeSave(l0.game, l0.meta)).toBe(encodeSave(checkedDecode(encodeSave(l0.game, l0.meta)).game, l0.meta));
    const live = l0.meta.customDishes!.find((d) => !d.deleted && !d.oldOf)!;
    const old = { ...live, id: "custom:oldv1aa", name: `${live.name} (v1)`, oldOf: live.id };
    const game = { ...l0.game, setMenu: { dishIds: [old.id, live.id], price: 3000, active: true } };
    const l = checkedDecode(encodeSave(game, { ...l0.meta, customDishes: [...l0.meta.customDishes!, old] })) as CheckedLoaded;
    expect(l.game.setMenu!.dishIds).toEqual([live.id]);
    expect(l.repairs?.[0]).toMatch(/came off the menu: that recipe is no longer in your cookbook/);
  });
});

// ── U15 ─────────────────────────────────────────────────────────────────────
describe("U15: storage blocked or full is said on the screen", () => {
  const blocked: StoreStatus = { cloud: "off", reason: "none", local: false, pending: [] };
  let restore: () => void = () => {};
  beforeEach(() => {
    resetStorageNotice();
    const own = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("The operation is insecure.", "SecurityError"); } });
    resetStorageForTests();
    restore = () => { if (own) Object.defineProperty(window, "localStorage", own); else delete (window as { localStorage?: unknown }).localStorage; resetStorageForTests(); };
  });
  afterEach(() => restore());

  it("blocked: the planning screen's header shows a dismissible notice with Save to a file (outside the ⋯ sheet)", async () => {
    const store = createSaveStore({ storage: null, cloud: async () => ({ off: "none" as const }), compress: false });
    await store.connect();
    setSaveStore(store);
    const s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 4, districtId: content.districts[0]!.id, restaurantName: "Mia's", difficulty: "normal" } });
    const onSaveFile = vi.fn(async () => "Saved to a file ✓");
    render(<StatusBar game={s.game!} meta={s.meta} onQuit={() => {}} onSaveFile={onSaveFile} />);
    const note = await screen.findByText(/This game can't be saved on this device right now/);
    expect(note.closest(".status__more")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Save to a file/ }));
    await settle();
    expect(onSaveFile).toHaveBeenCalled();
    expect(screen.getByText(/Saved to a file ✓/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide this notice" }));
    expect(screen.queryByText(/can't be saved on this device/)).toBeNull();
    store.dispose();
  });

  it("nothing while the account keeps the games; the title has its own words", () => {
    expect(storageTrouble({ ...blocked, cloud: "on" })).toBeNull();
    expect(storageTrouble({ ...blocked, cloud: "waiting" })).toBeNull();
    expect(storageTrouble(blocked)).toBe("blocked");
    const onFile = vi.fn();
    render(<StorageNotice status={blocked} where="title" onFile={onFile} />);
    expect(screen.getByRole("status").textContent).toMatch(/This browser can't keep games right now/);
    fireEvent.click(screen.getByRole("button", { name: /Your games/ }));
    expect(onFile).toHaveBeenCalled();
  });
});
