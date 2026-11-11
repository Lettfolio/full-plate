/**
 * Round 13 (E): fuzzing a friend's share snapshot (state/share.ts `checkSnapshot`, `openShare`, `checkReview`) with
 * the red-team's save-fuzzer payloads (scratchpad/redteam/sec/mkfiles.mjs: an HTML/script/bidi name, an object for a
 * name, an object for the staff list, a 300,000-character name, a day as a string) plus 200 seeded random mutations of
 * a real snapshot. Nothing may throw past the validator, and what it returns (and the visit screen draws) holds only
 * cleaned, capped, known values.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { GameState } from "@full-plate/sim-core";
import { UNSAFE_CHARS } from "@full-plate/sim-core/schema";
import { applyCommand, content, DECOR_SLOTS, newGame, runDay } from "../sim";
import { buildSnapshot, checkReview, checkSnapshot, LIMITS, openShare, snapPath, type SDb, type SDocRef, type SDocSnap, type ShareSnapshot } from "../state/share";
import { known } from "../lib/visit";
import { VisitRoom } from "../screens/VisitRoom";

afterEach(cleanup);

// ── a tiny db: just enough for openShare and the visit screen (reads only; writes succeed) ──
function oneDocDb(docs: Map<string, unknown>): SDb {
  const snap = (p: string): SDocSnap => ({ id: p.split("/").at(-1)!, exists: docs.has(p), data: () => (docs.has(p) ? (docs.get(p) as Record<string, unknown>) : undefined) });
  const ref = (p: string): SDocRef => ({ get: async () => snap(p), set: async () => {}, delete: async () => {}, onSnapshot: (next) => { queueMicrotask(() => next(snap(p))); return () => {}; } });
  const q = { orderBy: () => q, limit: () => q, get: async () => ({ docs: [] }), onSnapshot: (next: (s: { docs: SDocSnap[] }) => void) => { queueMicrotask(() => next({ docs: [] })); return () => {}; } };
  return { doc: ref, collection: () => ({ ...q, doc: (id: string) => ref(id) }) } as unknown as SDb;
}

/** A real snapshot: day 3, a menu, a hire, two nights of history and reviews, decor and a brand. */
function baseSnapshot(): ShareSnapshot {
  let g: GameState = newGame(content, { type: "NEW_GAME", seed: 1313, districtId: content.districts[0]!.id, restaurantName: "Fuzz Kitchen", difficulty: "normal" });
  const step = (cmd: Parameters<typeof applyCommand>[2]) => { g = applyCommand(content, g, cmd).state; };
  for (const d of content.dishes.filter((x) => !x.id.startsWith("ff_") && !x.id.startsWith("fd_")).slice(0, 5)) step({ type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice });
  step({ type: "HIRE", candidateIndex: 0 });
  for (let i = 0; i < 2; i++) { g = runDay(content, g).state; step({ type: "END_DAY" }); if (g.phase === "event") step({ type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === g.activeEvent?.eventId)!.choices[0]!.id }); }
  const s = buildSnapshot(g, Date.parse("2026-11-11T12:00:00Z"), { shape: "round", motif: "pan", letter: "F", primary: "#e0533d", accent: "#2b2622", uniform: "apron", uniformColour: "#ffffff", menu: "chalk" });
  const item = (content as { decor?: { items?: { id: string; slot: string }[] } }).decor?.items?.[0];
  return item ? { ...s, decor: { ...s.decor, [item.slot]: { itemId: item.id, since: 1 } } } : s;
}

// ── the red-team's payloads (mkfiles.mjs), aimed at the snapshot's fields ──
const XSS = `<img src=x onerror="document.title='PWNED'"><script>document.title='PWNED2'</script>‮evil​`;
const named: [string, (s: Record<string, unknown>) => void][] = [
  ["xss-name", (s) => { s.name = XSS; (s.staff as { name: string }[])[0]!.name = XSS; (s.reviews as { text: string }[]).push({ text: XSS } as never); }],
  ["obj-name", (s) => { s.name = { evil: true }; }],
  ["staff-obj", (s) => { s.staff = { a: 1 }; }],
  ["huge-name", (s) => { s.name = "R".repeat(300_000); (s.reviews as unknown[]).push({ text: "R".repeat(300_000), rating: 5, day: 1 }); }],
  ["day-string", (s) => { s.day = "7"; (s.week as { day: unknown }[]).forEach((d) => { d.day = "7"; }); }],
  ["proto-keys", (s) => { s.decor = JSON.parse('{"__proto__":{"itemId":"x","since":1},"constructor":{"itemId":"y"},"floor":{"itemId":"nope"}}'); s.brand = JSON.parse('{"__proto__":"x","constructor":"<b>","primary":"url(https://evil.example/x)"}'); }],
  ["unknown-ids", (s) => { s.districtId = "the_moon"; s.menu = [{ dishId: "<script>", price: 1, active: true }]; s.staff = [{ name: "Ok", role: "overlord", skill: 1e9 }]; }],
  ["deep", (s) => { let d: unknown = "x"; for (let i = 0; i < 5000; i++) d = [d]; s.tables = d; s.menu = d; s.week = { length: 1e9 }; }],
  ["huge-arrays", (s) => { s.tables = Array(200_000).fill(4); s.reviews = Array(10_000).fill({ text: "hi", rating: 5 }); s.staff = Array(10_000).fill({ name: "x", role: "chef", skill: 5 }); }],
  ["not-numbers", (s) => { s.day = Number.NaN; s.rep = { popularity: Infinity, prestige: -Infinity }; s.week = [{ revenue: 1e308, profit: -1e308, rating: Number.NaN, covers: "9" }]; }],
];

// ── 200 seeded random mutations ──
function rng(seed: number) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const NASTY: unknown[] = [
  null, true, false, 0, -1, 1e308, -1e308, Number.NaN, Infinity, 0.1, 2 ** 53 + 1, "", " ", "7", "-5", XSS, "\u0000\u0007\u001b[31m", "‮⁦‏﻿", "😀".repeat(500),
  "x".repeat(5000), [], [[[]]], {}, { __proto__: null }, JSON.parse('{"__proto__":{"polluted":1}}'), { toString: "nope", valueOf: 3 }, ["chef"], { itemId: "floor" }, "chef", "walkin", "fp-share",
];
type Path = (string | number)[];
function paths(v: unknown, at: Path = [], out: Path[] = []): Path[] {
  out.push(at);
  if (v && typeof v === "object" && at.length < 4) for (const [k, x] of Object.entries(v)) paths(x, [...at, Array.isArray(v) ? Number(k) : k], out);
  return out;
}
function mutate(base: ShareSnapshot, r: () => number): unknown {
  let s: unknown = JSON.parse(JSON.stringify(base));
  const n = 1 + Math.floor(r() * 4);
  for (let i = 0; i < n; i++) {
    const all = paths(s);
    const p = all[Math.floor(r() * all.length)]!;
    const v = NASTY[Math.floor(r() * NASTY.length)];
    const op = r();
    if (!p.length) { if (op < 0.2) s = v; continue; } // the whole document replaced, sometimes
    let parent = s as Record<string | number, unknown>;
    for (const k of p.slice(0, -1)) parent = parent[k] as Record<string | number, unknown>;
    const last = p.at(-1)!;
    if (op < 0.6) parent[last] = v;
    else if (op < 0.75) delete parent[last];
    else if (op < 0.9 && typeof last === "string") { parent[`${last}_${Math.floor(r() * 9)}`] = v; } // an extra key
    else parent[last] = Array(Math.floor(r() * 300)).fill(parent[last]); // a long list of whatever was there
  }
  return s;
}

// ── what a validated snapshot must be ──
const UNSAFE = new RegExp(UNSAFE_CHARS.source);
const ROLES = ["chef", "server", "bar", "porter", "manager"];
function assertClean(s: ShareSnapshot): void {
  const walk = (v: unknown, at: string): void => {
    if (typeof v === "string") { expect(UNSAFE.test(v), `${at} has an unsafe character`).toBe(false); expect(v.length, at).toBeLessThanOrEqual(LIMITS.text * 2); }
    else if (typeof v === "number") expect(Number.isFinite(v), at).toBe(true);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`));
    else if (v && typeof v === "object") {
      expect(Object.getPrototypeOf(v), `${at} prototype`).toBe(Object.prototype);
      for (const [k, x] of Object.entries(v)) walk(x, `${at}.${k}`);
    } else expect(typeof v === "boolean" || v === undefined, `${at}: ${typeof v}`).toBe(true);
  };
  walk(s, "snap");
  expect(s.name.length).toBeGreaterThan(0);
  expect(Array.from(s.name).length).toBeLessThanOrEqual(40);
  expect(s.tables.length).toBeLessThanOrEqual(LIMITS.tables);
  expect(s.menu.length).toBeLessThanOrEqual(LIMITS.menu);
  expect(s.staff.length).toBeLessThanOrEqual(LIMITS.staff);
  expect(s.reviews.length).toBeLessThanOrEqual(LIMITS.reviews);
  expect(s.week.length).toBeLessThanOrEqual(LIMITS.week);
  for (const t of s.tables) expect(Number.isInteger(t) && t >= 1 && t <= 12, `table ${t}`).toBe(true);
  for (const m of s.menu) expect(known.dish(m.dishId), `dish ${m.dishId}`).toBe(true);
  for (const p of s.staff) { expect(ROLES).toContain(p.role); expect(p.skill).toBeGreaterThanOrEqual(0); expect(p.skill).toBeLessThanOrEqual(100); }
  for (const [slot, d] of Object.entries(s.decor)) { expect(DECOR_SLOTS as readonly string[]).toContain(slot); expect(known.decor(d!.itemId), `decor ${d!.itemId}`).toBe(true); }
  expect(s.districtId === "" || known.district(s.districtId), `district ${s.districtId}`).toBe(true);
  for (const k of Object.keys(s.brand ?? {})) expect(k).toMatch(/^[a-zA-Z]{1,20}$/);
  expect(JSON.stringify(s).length).toBeLessThan(64_000);
  // Validating a validated snapshot changes nothing.
  expect(checkSnapshot(JSON.parse(JSON.stringify(s)), known)).toEqual(s);
}

describe("share snapshot fuzzing (R13-E)", () => {
  const base = baseSnapshot();
  const inputs: [string, unknown][] = [
    ...named.map(([n, f]): [string, unknown] => { const s = JSON.parse(JSON.stringify(base)) as Record<string, unknown>; f(s); return [n, s]; }),
    ...Array.from({ length: 200 }, (_, i): [string, unknown] => { const r = rng(13_000 + i); return [`random-${i}`, mutate(base, r)]; }),
    ["not-an-object", "fp-share"], ["array", [base]], ["null", null], ["wrong-kind", { ...base, kind: "fp-save" }], ["wrong-version", { ...base, v: 2 }],
  ];

  it("the base snapshot passes untouched", () => {
    expect(checkSnapshot(JSON.parse(JSON.stringify(base)), known)).toEqual(base);
    assertClean(base);
  });

  it(`${inputs.length} hostile snapshots: nothing throws, and every result is clean, capped and known`, () => {
    let accepted = 0;
    for (const [name, raw] of inputs) {
      let out: ShareSnapshot | null = null;
      expect(() => { out = checkSnapshot(raw, known); }, name).not.toThrow();
      if (out) { accepted++; try { assertClean(out); } catch (e) { throw new Error(`${name}: ${(e as Error).message}`); } }
    }
    expect(accepted).toBeGreaterThan(150); // most mutations still read as a snapshot (just a coerced one)
  });

  it("the red-team's payloads come out tamed", () => {
    const get = (n: string) => checkSnapshot(inputs.find(([k]) => k === n)![1], known)!;
    expect(get("xss-name").name).not.toMatch(/[‮​]/);
    expect(get("obj-name").name).toBe("A restaurant");
    expect(get("staff-obj").staff).toEqual([]);
    expect(Array.from(get("huge-name").name)).toHaveLength(40);
    expect(get("day-string").day).toBe(0);
    const proto = get("proto-keys");
    expect(Object.keys(proto.decor).every((k) => (DECOR_SLOTS as readonly string[]).includes(k))).toBe(true);
    expect(Object.getPrototypeOf(proto.decor)).toBe(Object.prototype);
    expect(get("unknown-ids")).toMatchObject({ districtId: "", menu: [], staff: [] });
    expect(get("huge-arrays").tables).toHaveLength(LIMITS.tables);
  });

  it("openShare only ever hands the screen a checked snapshot (or 'missing'), whatever is stored", async () => {
    for (const [name, raw] of inputs.slice(0, 80)) {
      const db = oneDocDb(new Map([[snapPath("ABCDEFGHJK"), raw]]));
      const r = await openShare({ db, uid: "u_v" }, "ABCDEFGHJK", known);
      if ("missing" in r) continue;
      expect(r.snap, name).toEqual(checkSnapshot(raw, known));
    }
  });

  it("reviews: 200 hostile documents, nothing throws, only the fixed compliments and a clean nickname survive", () => {
    const r = rng(77);
    for (let i = 0; i < 200; i++) {
      const raw = mutate({ kind: "fp-review", stars: 4, picks: ["food", "room"], nick: "Mia", date: "2026-11-11", at: 1 } as never, r);
      let out: ReturnType<typeof checkReview> = null;
      expect(() => { out = checkReview(`r${i}`, raw); }).not.toThrow();
      if (!out) continue;
      const o = out as NonNullable<ReturnType<typeof checkReview>>;
      expect(o.stars >= 1 && o.stars <= 5).toBe(true);
      expect(o.picks.every((p) => ["food", "room", "staff", "fast", "value", "menu", "music", "back"].includes(p))).toBe(true);
      expect(o.nick).toMatch(/^[\p{L}\p{N} ]{0,16}$/u);
      expect(Number.isFinite(o.at)).toBe(true);
    }
  });

  it("the visit screen draws 40 of them without throwing and without raw markup, bidi or ids reaching the page", async () => {
    const title = document.title;
    const ok = inputs.map(([, raw]) => checkSnapshot(raw, known)).filter((s): s is ShareSnapshot => !!s).slice(0, 40);
    for (const snap of ok) {
      const { container, unmount } = render(<VisitRoom db={oneDocDb(new Map())} uid="u_v" code="ABCDEFGHJK" snap={snap} mine={false} nick="Mia" onExit={() => {}} />);
      await act(async () => { await Promise.resolve(); });
      expect(UNSAFE.test(container.textContent ?? "")).toBe(false);
      expect(container.querySelector("script, iframe, object, embed, img:not(.brandlogo)")).toBeNull();
      for (const el of container.querySelectorAll("*")) {
        for (const a of el.attributes) {
          expect(a.name.startsWith("on"), a.name).toBe(false);
          if (a.name === "src") expect(a.value).toMatch(/^data:image\/svg\+xml;/);
          expect(UNSAFE.test(a.value), `${a.name} has an unsafe character`).toBe(false); // markup in a name is just text (React escapes it)
        }
      }
      expect(container.textContent).not.toContain("<script>");
      unmount();
    }
    expect(document.title).toBe(title);
  }, 120_000);
});
