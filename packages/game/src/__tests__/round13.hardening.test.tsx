/**
 * Round 13 (E): hardening and touch.
 *  - localStorage namespaced by path, with a one-time migration (lib/storage.ts);
 *  - every screen working for the visit when localStorage throws (Safari private mode, blocked site data);
 *  - G14: SET_OWNER_PROFILE accepted only at the career handover (sim-core) and still applied there;
 *  - glossary words as touch targets: the nearest-word rule (lib/termTap.ts) and the hit-area CSS.
 * The CSP and share fuzzing have their own files (round13.csp.test.ts, round13.shareFuzz.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../App";
import { appReducer, initialAppState } from "../state/gameReducer";
import { encodeSave } from "../state/save";
import { getSaveStore, setSaveStore } from "../state/saveStore";
import { createSaveStore } from "../state/saveCore";
import { content } from "../sim";
import { deviceStorage, migrateToScope, prefsStorage, resetStorageForTests, scopeOf } from "../lib/storage";
import { getSettings, resetSettingsCache, setSettings, SETTINGS_KEY } from "../lib/settings";
import { onboardKey, knownOnboardKeys } from "../lib/onboardFlags";
import { markOnboardSeen, onboardSeen } from "../lib/onboarding";
import { getHostFlag, setHostFlag } from "../lib/coop/hostFlag";
import { HOST_KEY } from "../lib/coop/flag";
import { bestFor, peekRun, recordBest, RUN_KEY } from "../lib/challenge";
import { distance, hitBox, nearestWord } from "../lib/termTap";
import { applyOwnerProfile } from "../state/pathEngine";

const offline = async () => ({ off: "none" as const });
const storeOpts = { cloud: offline, now: () => Date.parse("2026-11-11T10:00:00Z"), debounceMs: 5, compress: false, retryMs: () => 1 };
const atPath = (p: string) => { window.history.replaceState(null, "", p); resetStorageForTests(); };
function ownerGame(name: string) {
  const s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 9, districtId: content.districts[0]!.id, restaurantName: name, difficulty: "cosy" } });
  return { game: s.game!, meta: s.meta };
}
const rawKeys = () => Object.keys(localStorage).sort();

beforeEach(() => { localStorage.clear(); atPath("/"); resetSettingsCache(); });
afterEach(() => { cleanup(); setSaveStore(null); localStorage.clear(); atPath("/"); resetSettingsCache(); });

describe("localStorage namespaced by path (S12)", () => {
  it("the scope is the page's first directory; the root (preview, tests, a custom domain) has none", () => {
    expect(scopeOf("/")).toBe("");
    expect(scopeOf("/index.html")).toBe("");
    expect(scopeOf("/full-plate/")).toBe("full-plate");
    expect(scopeOf("/full-plate/index.html")).toBe("full-plate");
    expect(scopeOf("/full-plate/deep/page.html")).toBe("full-plate");
    expect(scopeOf("/a%20b/")).toBe("a_b");
  });

  it("at the root the keys are exactly what they were (nothing moves)", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sound: false }));
    expect(deviceStorage()).toBe(window.localStorage);
    expect(rawKeys()).toEqual([SETTINGS_KEY]);
    expect(getSettings().sound).toBe(false);
  });

  it("a game saved before the change moves under the scope once, still loads, and a sibling path can't see or clobber it", async () => {
    // Before Round 13: an un-scoped slot, settings and an onboarding flag, written at /full-plate/ with the old keys.
    const g = ownerGame("Old Keys Café");
    const before = createSaveStore({ ...storeOpts, storage: window.localStorage });
    await before.save("s1", g.game, g.meta);
    before.dispose();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ sound: false, animations: false }));
    localStorage.setItem(onboardKey(9, "chef"), "1");
    const legacy = rawKeys();
    expect(legacy.every((k) => k.startsWith("full-plate:"))).toBe(true);
    expect(legacy.length).toBeGreaterThanOrEqual(4);

    atPath("/full-plate/");
    resetSettingsCache();
    const store = createSaveStore(storeOpts); // default storage: deviceStorage()
    expect(rawKeys()).toEqual([...legacy.map((k) => `full-plate/${k}`), "full-plate/full-plate:ns-migrated:v1"].sort());
    expect(store.list().map((s) => s.name)).toEqual(["Old Keys Café"]);
    const loaded = await store.load(store.list()[0]!.slotId);
    expect(encodeSave(loaded!.loaded.game, loaded!.loaded.meta)).toBe(encodeSave(g.game, g.meta));
    expect(getSettings()).toMatchObject({ sound: false, animations: false });
    expect(knownOnboardKeys()).toContain(onboardKey(9, "chef")); // the account mirror still sees the plain flag names
    store.dispose();

    // Another project on the same Pages origin, at another path: an empty store, and its writes stay in its scope.
    atPath("/other-project/");
    const sibling = createSaveStore(storeOpts);
    expect(sibling.list()).toEqual([]);
    const h = ownerGame("Sibling");
    await sibling.save("s1", h.game, h.meta);
    sibling.dispose();
    atPath("/full-plate/");
    const again = createSaveStore(storeOpts);
    expect(again.list().map((s) => s.name)).toEqual(["Old Keys Café"]);
    again.dispose();
  });

  it("the migration runs once, never overwrites a scoped key, and retries a key that ran out of room", () => {
    localStorage.setItem("full-plate:a", "old-a");
    localStorage.setItem("full-plate:b", "old-b");
    localStorage.setItem("full-plate/full-plate:b", "new-b");
    localStorage.setItem("someone-else", "x");
    // The first try: no room for "a".
    const real = window.localStorage;
    const full = new Proxy(real, {
      get(t, p) {
        if (p === "setItem") return (k: string, v: string) => { if (k === "full-plate/full-plate:a") throw new DOMException("full", "QuotaExceededError"); t.setItem(k, v); };
        const v = Reflect.get(t, p); return typeof v === "function" ? v.bind(t) : v;
      },
    });
    migrateToScope(full as Storage, "full-plate");
    expect(localStorage.getItem("full-plate:a")).toBe("old-a"); // kept where it was
    expect(localStorage.getItem("full-plate/full-plate:b")).toBe("new-b"); // the scoped copy wins
    expect(localStorage.getItem("full-plate:b")).toBeNull();
    expect(localStorage.getItem("full-plate/full-plate:ns-migrated:v1")).toBeNull();
    migrateToScope(real, "full-plate");
    expect(localStorage.getItem("full-plate/full-plate:a")).toBe("old-a");
    expect(localStorage.getItem("full-plate:a")).toBeNull();
    expect(localStorage.getItem("full-plate/full-plate:ns-migrated:v1")).toBe("1");
    expect(localStorage.getItem("someone-else")).toBe("x"); // not ours: untouched
    localStorage.setItem("full-plate:late", "1");
    migrateToScope(real, "full-plate");
    expect(localStorage.getItem("full-plate:late")).toBe("1"); // once means once
  });

  it("every game-side store writes inside the scope", () => {
    atPath("/full-plate/");
    setSettings({ musicVolume: 0.2 });
    markOnboardSeen(prefsStorage(), 3, "server");
    setHostFlag({ code: "ABCDEFGHJK", nick: "Mia", expiresAt: Date.now() + 60_000, game: "g" });
    recordBest({ date: "2026-11-11", score: 1234, template: "rush", met: true } as never);
    expect(rawKeys().every((k) => k.startsWith("full-plate/"))).toBe(true);
    expect(localStorage.getItem(`full-plate/${HOST_KEY}`)).toContain("ABCDEFGHJK");
    setHostFlag(null);
  });
});

describe("blocked storage (Safari private mode, blocked site data)", () => {
  let restore: () => void = () => {};
  beforeEach(() => {
    const own = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("The operation is insecure.", "SecurityError"); } });
    resetStorageForTests();
    resetSettingsCache();
    restore = () => { if (own) Object.defineProperty(window, "localStorage", own); else delete (window as { localStorage?: unknown }).localStorage; resetStorageForTests(); };
  });
  afterEach(() => restore());

  it("the stores fall back to memory for the visit", () => {
    expect(() => window.localStorage).toThrow();
    expect(deviceStorage()).toBeNull();
    setSettings({ sound: false });
    resetSettingsCache();
    expect(getSettings().sound).toBe(false); // read back from the visit's memory
    markOnboardSeen(prefsStorage(), 5, "chef");
    expect(onboardSeen(prefsStorage(), 5, "chef")).toBe(true);
    setHostFlag({ code: "ABCDEFGHJK", nick: "Mia", expiresAt: Date.now() + 60_000, game: "g" });
    expect(getHostFlag()?.code).toBe("ABCDEFGHJK");
    setHostFlag(null);
    expect(recordBest({ date: "2026-11-11", score: 900, template: "rush", met: false } as never)).toBe(true);
    expect(bestFor("2026-11-11")?.score).toBe(900);
  });

  it("the app shell runs: title, settings, today's challenge (twice, carrying on); the save store knows it has no device", async () => {
    render(<App />); // the default save store: no device storage, slots in memory
    expect(screen.getByRole("button", { name: "Today's challenge" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Today's challenge" }));
    fireEvent.click(await screen.findByRole("button", { name: /^(Start|Have another go)$/ }, { timeout: 15_000 }));
    const bar = await screen.findByRole("region", { name: "Today's challenge" }, { timeout: 20_000 });
    expect(bar.textContent).toContain("Day 1 of 5");
    await waitFor(() => expect(peekRun()).not.toBeNull());
    expect(prefsStorage().getItem(RUN_KEY)).toBeTruthy();
    // Settings open and change.
    fireEvent.click(screen.getAllByRole("button", { name: "Settings" })[0]!);
    const group = await screen.findByRole("radiogroup", { name: "Sound" }, { timeout: 10_000 });
    // Labels with a space used to name nothing (aria-labelledby="set-Text size" is two ids): the playtest found it.
    expect(screen.getByRole("radiogroup", { name: "Text size" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Service starts at" })).toBeTruthy();
    fireEvent.click(within(group).getByRole("radio", { name: /Off/ }));
    await waitFor(() => expect(within(screen.getByRole("radiogroup", { name: "Sound" })).getByRole("radio", { name: /Off/ }).getAttribute("aria-checked")).toBe("true"));
    expect(getSettings().sound).toBe(false);
    expect(getSaveStore().status().local).toBe(false); // the slots live in memory: every save surface says Not saved
    cleanup();
    // Back to the title in the same visit: the run carries on.
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Today's challenge" }));
    expect(await screen.findByRole("button", { name: "Carry on: day 1 of 5" }, { timeout: 15_000 })).toBeTruthy();
  }, 90_000);
});

describe("G14: the owner's skills are set only at the career handover", () => {
  it("the handover still sets them; nothing can change them afterwards", () => {
    let s = appReducer(initialAppState, { type: "newCareer", seed: 6, track: "manager", strategy: "balanced", playerName: "Robin", difficulty: "cosy" });
    const career = { ...s.meta.career!, savings: 2_000_000, stats: { ...s.meta.career!.stats, skill: 71, speed: 64, charm: 83 } };
    s = { ...s, meta: { ...s.meta, career } };
    s = appReducer(s, { type: "career", cmd: { type: "OPEN_OWN_PLACE", restaurantName: "Robin's" } } as never);
    expect(s.meta.handover).toBeTruthy();
    expect(s.game!.ownerProfile).toEqual({ skill: 71, speed: 64, charm: 83 });
    // A second handover-style call (the only code path that sends it) changes nothing now.
    const again = applyOwnerProfile(s.game!, { ...career, stats: { ...career.stats, skill: 100, speed: 100, charm: 100 } });
    expect(again.ownerProfile).toEqual({ skill: 71, speed: 64, charm: 83 });
    // And a screen still can't send it at all (round 11's reducer gate).
    const t = appReducer(s, { type: "command", cmd: { type: "SET_OWNER_PROFILE", skill: 100, speed: 100, charm: 100 } as never });
    expect(t.game!.ownerProfile).toEqual({ skill: 71, speed: 64, charm: 83 });
  });
});

describe("glossary words as touch targets", () => {
  const word = (left: number, top: number, w = 30, h = 18) => ({ left, top, right: left + w, bottom: top + h });

  it("a word's hit area is at least 44 × 44, centred, and never smaller than the word", () => {
    expect(hitBox(word(100, 100, 20, 18))).toEqual({ left: 88, right: 132, top: 87, bottom: 131 });
    expect(hitBox(word(0, 0, 120, 50))).toEqual({ left: 0, right: 120, top: 0, bottom: 50 });
    expect(distance(word(0, 0), 10, 10)).toBe(0);
    expect(distance(word(0, 0), 33, 22)).toBe(5);
  });

  it("two words closer than 44 px split the gap: the tap goes to the nearer", () => {
    const above = word(100, 100), below = word(100, 122); // two lines, 4 px apart
    expect(nearestWord([above, below], 110, 119)).toBe(0); // 1 px under the upper word, 3 px over the lower
    expect(nearestWord([above, below], 110, 121)).toBe(1);
    const left = word(100, 100, 20), right = word(126, 100, 20); // side by side, 6 px apart
    expect(nearestWord([left, right], 122, 108)).toBe(0);
    expect(nearestWord([left, right], 124, 108)).toBe(1);
    expect(nearestWord([left, right], 400, 400)).toBe(-1);
  });

  it("the hit area is in the stylesheet: invisible, absolutely placed, and off inside controls", () => {
    const css = readFileSync(join(__dirname, "../theme.css"), "utf8");
    const rule = /\.term::before \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain('content: ""');
    expect(rule).toContain("position: absolute");
    expect(rule).toMatch(/left: min\(0px, calc\(50% - 22px\)\)/);
    expect(rule).toMatch(/top: min\(0px, calc\(50% - 22px\)\)/);
    expect(rule).not.toMatch(/background|border|outline|box-shadow/);
    expect(css).toMatch(/\.term--inbutton::before,\n:is\(button, a, label[^)]*\) \.term::before \{ content: none; \}/);
  });
});
