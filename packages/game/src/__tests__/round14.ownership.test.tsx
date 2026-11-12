/**
 * Round 14 (B): S14-2, S14-11 and "documents outlive the game" — the red team's attacks (zz.r14sec.db.test.tsx) made
 * permanent, now against a store that ENFORCES the artifact's `db` rules (scripts/lib/dbRules.ts, the same engine the
 * Playwright mock uses). Every attacker is a Contributor (`interact`) who has the code. Each test fails on master
 * (default rules, shared paths, the owner hash) and passes here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { GameState } from "@full-plate/sim-core";
import { applyCommand, content, newGame, runDay } from "../sim";
import {
  buildSnapshot, checkSnapshot, codeFits, leaveReview, newCode, openShare, pubPath, setLinkForTests, share, slowKey, snapPath, stopSharing, visitsPath,
  watchReviews, type VisitReview,
} from "../state/share";
import { gameLine, known } from "../lib/visit";
import { checkGuest, coopMePath, guestDoc, guestPath, hostPath, planCommands } from "../lib/coop/protocol";
import { endHosting, guestJoin, hostStart, leaveAsGuest, partnerOf, sweepCoop, watchGuest, watchHost } from "../lib/coop/session";
import { roomName } from "../lib/coop/realtime";
import { setHostFlag } from "../lib/coop/hostFlag";
import { forgetGameSocial, forgetSlotSocial } from "../lib/socialLife";
import { weekdayIndex } from "../lib/calendar";
import { VisitRoom } from "../screens/VisitRoom";
import { VisitShareCard } from "../screens/VisitShareCard";
import { CAPABILITIES, checkRules, DB_RULES, required, type Level } from "../../scripts/lib/dbRules";
import { createMockStore } from "../../scripts/lib/mockClaude.mjs";
import { RuleDb, flush } from "./ruleDb";

afterEach(() => { cleanup(); setLinkForTests(null); setHostFlag(null); localStorage.clear(); });

function planningGame(name = "Chez Test", seed = 4242): GameState {
  let g = newGame(content, { type: "NEW_GAME", seed, districtId: content.districts[0]!.id, restaurantName: name, difficulty: "normal" });
  const step = (cmd: Parameters<typeof applyCommand>[2]) => { g = applyCommand(content, g, cmd).state; };
  for (const d of content.dishes.filter((x) => !x.id.startsWith("ff_") && !x.id.startsWith("fd_")).slice(0, 4)) step({ type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice });
  step({ type: "HIRE", candidateIndex: 0 });
  for (let i = 0; i < 2; i++) { g = runDay(content, g).state; step({ type: "END_DAY" }); if (g.phase === "event") step({ type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === g.activeEvent?.eventId)!.choices[0]!.id }); }
  expect(g.phase).toBe("planning");
  return g;
}
const refused = async (p: Promise<unknown>) => { await expect(p).rejects.toMatchObject({ code: "invalid_argument" }); };
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await flush(); }); };
/** A uid whose id the code's check letters do NOT fit (so it isn't a 1-in-961 fluke owner). */
const notFitting = (code: string, base: string) => { for (let i = 0; ; i++) { const u = i ? `${base}${i}` : base; if (!codeFits(code, u)) return u; } };

describe("the rules (dbRules.ts) as the platform reads them", () => {
  it("the declaration is valid and docs/COOP-NOTES.md quotes it exactly", () => {
    expect(checkRules(DB_RULES)).toEqual([]);
    const notes = readFileSync(join(__dirname, "../../../../docs/COOP-NOTES.md"), "utf8");
    expect(notes).toContain(JSON.stringify(CAPABILITIES, null, 2));
  });
  it("db.d.ts's own examples come out as documented (votes, signoffs, data/users, the root default)", () => {
    const votes = [{ path: "votes", read: "view" as const, write: "owner" as const }, { path: "votes/{self}", write: "interact" as const }];
    expect(checkRules(votes)).toEqual([]);
    expect(required(votes, "votes/u_a", "u_a")).toEqual({ read: "view", write: "interact" });
    expect(required(votes, "votes/u_a", "u_b")).toEqual({ read: "view", write: "owner" });
    expect(required([], "anything/x", "u_a")).toEqual({ read: "view", write: "interact" });
    expect(required([], "data/users/u_a/p", "u_a")).toEqual({ read: "view", write: "interact" });
    expect(required([], "data/users/u_a/p", "u_b")).toEqual({ read: "self", write: "self" });
    expect(required([{ path: "", write: "admin" }], "data/users/u_a/p", "u_a").write).toBe("admin"); // inheritance reaches the own subtree
    expect(checkRules([{ path: "votes", write: "owner" }, { path: "votes/{self}", write: "interact" }])).toEqual(["votes: a {self} prefix rule must set read and write"]);
    expect(checkRules([{ path: "x", read: "self", write: "self" }])).toContain('x: "self" only on the prefix of a {self} rule');
  });
  it("who may read and write each path (the table in COOP-NOTES)", () => {
    const can = (level: Level, uid: string, path: string) => { const r = required(DB_RULES, path, uid); const ok = (n: string) => n !== "self" && ["view", "interact", "admin", "owner"].indexOf(level) >= ["view", "interact", "admin", "owner"].indexOf(n); return `${ok(r.read) ? "r" : "-"}${ok(r.write) ? "w" : "-"}`; };
    const paths = ["fps/u_a", "fps/u_a/sX/snap", "fpr/u_a", "fpc/u_a/cX/host", "data/users/u_a/save-s1", "fp-share/X/v/snap", "junk/x"];
    const table = Object.fromEntries((["view", "interact", "admin", "owner"] as Level[]).map((lv) => [lv, { own: paths.map((p) => can(lv, "u_a", p)), other: paths.map((p) => can(lv, "u_b", p)) }]));
    expect(table).toEqual({
      view: { own: ["r-", "r-", "r-", "r-", "r-", "r-", "r-"], other: ["r-", "r-", "r-", "r-", "--", "r-", "r-"] },
      interact: { own: ["rw", "rw", "rw", "rw", "rw", "r-", "r-"], other: ["r-", "r-", "r-", "r-", "--", "r-", "r-"] },
      admin: { own: ["rw", "rw", "rw", "rw", "rw", "rw", "rw"], other: ["r-", "r-", "r-", "r-", "--", "rw", "rw"] },
      owner: { own: ["rw", "rw", "rw", "rw", "rw", "rw", "rw"], other: ["rw", "rw", "rw", "rw", "--", "rw", "rw"] },
    });
  });
  it("the Playwright mock enforces the same rules, with an `as` to act as anyone at any level", async () => {
    const store = createMockStore();
    await store.as("u_alice").set("fps/u_alice/sX/snap", { a: 1 });
    await expect(store.as("u_mallory").set("fps/u_alice/sX/snap", { a: 2 })).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(store.as("u_mallory").delete("fps/u_alice/sX/snap")).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(store.as("u_viv", "view").set("fps/u_viv/sX/snap", { a: 3 })).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(store.as("u_mallory").set("junk/x", { a: 1 })).rejects.toMatchObject({ code: "invalid_argument" }); // the root is admin-only
    expect(await store.as("u_mallory").get("fps/u_alice/sX/snap")).toEqual({ exists: true, data: { a: 1 } });
    await store.as("u_mallory").set("fpr/u_mallory", { k: ["r1"] });
    expect((await store.as("u_alice").list("fpr", { where: [{ field: "k", op: "array-contains", value: "r1" }] })).docs.map((d: { id: string }) => d.id)).toEqual(["u_mallory"]);
    expect(store.stats.refused).toBe(4);
  });
});

describe("S14-2 (S-db-1): a Contributor with the code can no longer rewrite, re-attribute or delete a share", () => {
  it("overwriting or deleting the owner's snapshot is refused; visitors see the owner's own", async () => {
    const db = RuleDb.create("u_alice");
    const alice = { db, uid: "u_alice" };
    const code = await share(alice, planningGame());
    const mallory = db.as("u_mallory");
    const orig = (await mallory.doc(snapPath("u_alice", code)).get()).data()!;
    const words = "Alice copies her homework and everyone knows it. Do not eat here, the chef never washes her hands. Ask anyone in 9B.";
    await refused(mallory.doc(snapPath("u_alice", code)).set({ ...orig, name: "Alice smells", staff: [{ name: "Alice is a liar", role: "chef", skill: 1 }], reviews: Array.from({ length: 8 }, () => ({ day: 3, rating: 1, source: "critic", text: words })) }));
    await refused(mallory.doc(snapPath("u_alice", code)).delete());
    await refused(mallory.doc(pubPath("u_alice")).delete());
    const carol = await openShare({ db: db.as("u_carol"), uid: "u_carol" }, code, known);
    expect("snap" in carol && carol.snap.name).toBe("Chez Test");
    expect("snap" in carol && carol.ownerId).toBe("u_alice");
  });
  it("a look-alike snapshot under Mallory's own id doesn't open with the code (check letters); a fluke fit opens nothing, never hers", async () => {
    const db = RuleDb.create("u_alice");
    const code = await share({ db, uid: "u_alice" }, planningGame());
    const m = notFitting(code, "u_mallory");
    const md = db.as(m);
    await md.doc(pubPath(m)).set({ kind: "fp-pub", v: 2 });
    await md.doc(snapPath(m, code)).set({ ...buildSnapshot(planningGame("Alice smells")) });
    const carol = await openShare({ db: db.as("u_carol"), uid: "u_carol" }, code, known);
    expect("snap" in carol && carol.snap.name).toBe("Chez Test");
    // an account whose id happens to fit (1 in 961): the code is "muddled" and opens nothing at all
    let fluke = "u_f0"; for (let i = 1; !codeFits(code, fluke); i++) fluke = `u_f${i}`;
    const fd = db.as(fluke);
    await fd.doc(pubPath(fluke)).set({ kind: "fp-pub", v: 2 });
    await fd.doc(snapPath(fluke, code)).set({ ...buildSnapshot(planningGame("Alice smells")) });
    expect(await openShare({ db: db.as("u_carol"), uid: "u_carol" }, code, known)).toEqual({ missing: true, muddled: true });
  });
  it("'mine' comes from the path: an owner field in someone else's snapshot means nothing (no Visitors card, review allowed)", async () => {
    const db = RuleDb.create("u_mallory");
    const m = { db, uid: "u_mallory" };
    const code = await share(m, planningGame("Mal's"));
    // she can only write under her own id; the R12 owner hash is ignored if she adds one
    await db.doc(snapPath("u_mallory", code)).set({ ...buildSnapshot(planningGame("Mal's")), owner: "anything" });
    await refused(db.doc(snapPath("u_alice", code)).set({ ...buildSnapshot(planningGame("Mal's")) }));
    const o = await openShare({ db: db.as("u_alice"), uid: "u_alice" }, code, known);
    expect("snap" in o && o.mine).toBe(false);
  });
  it("a Viewer can visit but writes nothing, not even under their own id", async () => {
    const db = RuleDb.create("u_alice");
    const code = await share({ db, uid: "u_alice" }, planningGame());
    const viv = { db: db.as("u_viv", "view"), uid: "u_viv" };
    expect("snap" in (await openShare(viv, code, known))).toBe(true);
    await refused(leaveReview(viv, code, { stars: 5, picks: [], nick: "Viv" }));
    await refused(share(viv, planningGame("Viv's")));
  });
});

describe("S14-2 (S-db-2): reviews — no flooding, no spoofing, no pushing real ones out, the owner deletes nothing", () => {
  it("60 forged reviews and an overwrite of Carol's: Mallory gets one entry, Carol's stays and is shown", async () => {
    const db = RuleDb.create("u_alice");
    const alice = { db, uid: "u_alice" };
    const code = await share(alice, planningGame());
    expect(await leaveReview({ db: db.as("u_carol"), uid: "u_carol" }, code, { stars: 5, picks: ["food"], nick: "Carol" })).toBe("sent");
    const key = slowKey("r", code);
    const m = db.as("u_mallory");
    // documents under anyone else's id are refused, whatever the id
    for (let i = 0; i < 60; i++) await refused(m.doc(`fpr/forged${i}`).set({ kind: "fp-visits", k: [key], r: { [key]: { stars: 1, nick: i % 2 ? "Carol" : "Dan", date: "2099-01-01" } } }));
    await refused(m.doc(visitsPath("u_carol")).set({ kind: "fp-visits", k: [key], r: { [key]: { stars: 1, nick: "Carol", date: "2026-11-11" } } }));
    await refused(m.doc(visitsPath("u_carol")).delete());
    // her own document holds one entry per share, however she builds it
    await m.doc(visitsPath("u_mallory")).set({ kind: "fp-visits", k: [key, key, key], r: { [key]: { stars: 1, nick: "Carol", date: "2099-01-01" } } });
    let seen: VisitReview[] = [];
    const stop = watchReviews(alice, code, (r) => { seen = r; }); await settle(); stop();
    expect(seen.map((r) => [r.id, r.stars])).toEqual([["u_carol", 5], ["u_mallory", 1]]); // her future date reads as today; Carol's is still there
    expect(seen.find((r) => r.id === "u_mallory")!.date <= new Date().toISOString().slice(0, 10)).toBe(true);
    expect((await db.doc(visitsPath("u_carol")).get()).exists).toBe(true);
  });
  it("the owner can hide a visitor on this device; nothing is deleted", async () => {
    const db = RuleDb.create("u_alice");
    const g = planningGame();
    const code = await share({ db, uid: "u_alice" }, g);
    await leaveReview({ db: db.as("u_mallory"), uid: "u_mallory" }, code, { stars: 1, picks: [], nick: "Mal" });
    await leaveReview({ db: db.as("u_carol"), uid: "u_carol" }, code, { stars: 5, picks: ["food"], nick: "Carol" });
    setLinkForTests(async () => ({ db, uid: "u_alice" }));
    render(<VisitShareCard game={g} />);
    expect(await screen.findByText("Mal")).toBeTruthy();
    await act(async () => { screen.getByRole("button", { name: /Hide Mal's review/ }).click(); });
    expect(screen.queryByText("Mal")).toBeNull();
    expect(screen.getByText("Carol")).toBeTruthy();
    expect(screen.getByText(/1 hidden on this device/)).toBeTruthy();
    expect((await db.doc(visitsPath("u_mallory")).get()).exists).toBe(true);
    cleanup();
    render(<VisitShareCard game={g} />); // still hidden after a reload
    expect(await screen.findByText("Carol")).toBeTruthy();
    expect(screen.queryByText("Mal")).toBeNull();
  });
});

describe("S14-2: snapshot review lines must be the game's own words", () => {
  it("lines the sim wrote survive; prose of the owner's own is dropped and never reaches a visitor's screen", async () => {
    const g = planningGame();
    const s = buildSnapshot(g);
    expect(s.reviews.length).toBeGreaterThan(0);
    expect(checkSnapshot(JSON.parse(JSON.stringify(s)), known)!.reviews).toEqual(s.reviews);
    const words = "the chef never washes her hands. Ask anyone in 9B.";
    const forged = { ...s, reviews: [{ ...s.reviews[0]!, text: words }, ...s.reviews.slice(1)] };
    const back = checkSnapshot(JSON.parse(JSON.stringify(forged)), known)!;
    expect(back.reviews.map((r) => r.text)).not.toContain(words);
    expect(back.reviews).toHaveLength(s.reviews.length - 1);
    // a real line moved to another restaurant's name or another rating doesn't pass either
    const r0 = s.reviews[0]!;
    expect(gameLine(r0.text, r0.rating, r0.dishId, "Chez Test")).toBe(true);
    expect(gameLine(r0.text, r0.rating, r0.dishId, "Elsewhere") && r0.text.includes("Chez Test")).toBe(false);
    render(<VisitRoom db={RuleDb.create("u_c")} uid="u_c" code={newCode("u_a")} snap={back} mine={false} nick="C" onExit={() => {}} />);
    await settle();
    expect(document.body.textContent).not.toContain("washes her hands");
  });
});

describe("S14-11: nothing links two shares to one account beyond the id in their paths", () => {
  it("snapshots carry no owner field; two shares' bodies have nothing in common that names the owner", async () => {
    const db = RuleDb.create("u_alice");
    const a = await share({ db, uid: "u_alice" }, planningGame("One", 1));
    const b = await share({ db, uid: "u_alice" }, planningGame("Two", 2));
    const sa = (await db.doc(snapPath("u_alice", a)).get()).data()!;
    const sb = (await db.doc(snapPath("u_alice", b)).get()).data()!;
    expect("owner" in sa || "owner" in sb).toBe(false);
    expect(JSON.stringify([sa, sb])).not.toContain("u_alice");
    expect((await db.doc(pubPath("u_alice")).get()).data()).toEqual({ kind: "fp-pub", v: 2 }); // the marker lists no codes
    // the paths hold the id (the rules need it) and a hash of each code, never the code itself
    expect(db.paths("fps/").join(" ")).not.toContain(a);
  });
});

describe("S14-2 (S-db-3): the co-op lobby — each side writes only its own document", () => {
  it("Mallory can't rewrite the host's nonce; her own host document under the same code is never found", async () => {
    const db = RuleDb.create("u_alice");
    const { code, writer } = await hostStart({ db, uid: "u_alice" }, "Alice", 1000);
    await writer.patch({ live: { nonce: "a".repeat(24), guestRole: "server", state: "ready", day: 5, at: 1000 } });
    const join = await guestJoin({ db: db.as("u_bob"), uid: "u_bob" }, code, "Bob", known.dish, 2000);
    expect(join.ok && join.partnerId).toBe("u_alice");
    const m = notFitting(code, "u_mallory");
    const md = db.as(m);
    const cur = (await md.doc(hostPath("u_alice", code)).get()).data()!;
    await refused(md.doc(hostPath("u_alice", code)).set({ ...cur, live: { nonce: "m".repeat(24), guestRole: "server", state: "on", day: 5, at: 3000 } }));
    await refused(md.doc(hostPath("u_alice", code)).delete());
    await md.doc(coopMePath(m)).set({ kind: "fp-coop-me", v: 2, j: [] });
    await md.doc(hostPath(m, code)).set({ ...cur, live: { nonce: "m".repeat(24), guestRole: "server", state: "on", day: 5, at: 3000 } });
    let seen: { live?: { nonce: string } | null } | null = null;
    const stop = watchHost(db.as("u_bob"), "u_alice", code, known.dish, (h) => { seen = h; }, undefined, "u_bob"); await settle(); stop();
    expect(seen!.live!.nonce).toBe("a".repeat(24));
    expect(roomName(code, seen!.live!.nonce)).toBe(roomName(code, "a".repeat(24)));
    // and a fresh guest finds Alice's session, not Mallory's
    const late = await guestJoin({ db: db.as("u_dan"), uid: "u_dan" }, code, "Dan", known.dish, 2500);
    expect(late.ok && late.hostId).toBe("u_alice");
  });
  it("Mallory can't write a plan as the guest: Bob's document is Bob's; once Bob is pinned her join is ignored", async () => {
    const g = planningGame();
    const wd = weekdayIndex(g.day);
    const db = RuleDb.create("u_alice");
    const alice = { db, uid: "u_alice" };
    const { code, writer } = await hostStart(alice, "Alice", Date.now());
    const bob = await guestJoin({ db: db.as("u_bob"), uid: "u_bob" }, code, "Bob", known.dish);
    if (!bob.ok) throw new Error("Bob couldn't join");
    const heard: [string | null, string | null][] = [];
    const stop = watchGuest(alice, writer, code, known.dish, (gd, id) => heard.push([gd?.nick ?? null, id]));
    await settle();
    expect(writer.current.guest).toBe("u_bob");
    expect(partnerOf(code)).toBe("u_bob");
    const plan = { n: 99, day: g.day, menu: g.menu.map((x) => ({ dishId: x.dishId, price: 25, active: x.active })), on: [] };
    const m = db.as("u_mallory");
    await refused(m.doc(guestPath("u_bob", code)).set({ ...guestDoc({ nick: "Bob", joinedAt: 1 }), plan }));
    // her own guest document and join key: the host never reads them (Bob is pinned), and joining says "taken"
    expect(await guestJoin({ db: m, uid: "u_mallory" }, code, "Bob", known.dish)).toEqual({ ok: false, why: "taken" });
    await m.doc(guestPath("u_mallory", code)).set({ ...guestDoc({ nick: "Bob", joinedAt: 1 }), plan });
    await settle();
    stop();
    expect(heard.every(([, id]) => id === "u_bob" || id === null)).toBe(true);
    const bobDoc = checkGuest((await db.doc(guestPath("u_bob", code)).get()).data(), known.dish)!;
    expect(bobDoc.plan).toBeNull();
    expect(planCommands(g, bobDoc.plan ?? { n: 0, day: -1, menu: [], on: [] }, wd, (id) => id)).toEqual([]);
    // and the guest can't touch the host's document either
    await refused(db.as("u_bob").doc(hostPath("u_alice", code)).set({ kind: "fp-coop-host", v: 1 }));
  });
});

describe("documents don't outlive the game", () => {
  it("stop sharing: the snapshot and (last share) the marker go; visitors' reviews are theirs and open nothing", async () => {
    const db = RuleDb.create("u_alice");
    const g = planningGame();
    const code = await share({ db, uid: "u_alice" }, g);
    await leaveReview({ db: db.as("u_carol"), uid: "u_carol" }, code, { stars: 4, picks: [], nick: "Carol" });
    await stopSharing({ db, uid: "u_alice" }, g);
    expect(db.paths("fps/")).toEqual([]);
    expect(await openShare({ db: db.as("u_carol"), uid: "u_carol" }, code, known)).toEqual({ missing: true });
  });
  it("end co-op (host) and leave (guest) delete each side's document, join key and marker", async () => {
    const db = RuleDb.create("u_alice");
    const alice = { db, uid: "u_alice" }, bob = { db: db.as("u_bob"), uid: "u_bob" };
    const { code, writer } = await hostStart(alice, "Alice");
    const j = await guestJoin(bob, code, "Bob", known.dish);
    if (!j.ok) throw new Error("join");
    expect((await db.doc(coopMePath("u_bob")).get()).data()!.j).toEqual([slowKey("j", code)]);
    await leaveAsGuest(bob, code, j.writer);
    expect(db.paths("fpc/u_bob")).toEqual([]);
    await j.writer.patch({ emote: { id: "wave", n: 1 } }); // a late tap after leaving writes nothing back
    expect(db.paths("fpc/u_bob")).toEqual([]);
    await endHosting(alice, code, writer);
    expect(db.paths("fpc/")).toEqual([]);
  });
  it("stale sessions are swept the next time the player is here (two hours on)", async () => {
    const db = RuleDb.create("u_alice");
    const alice = { db, uid: "u_alice" };
    const t0 = Date.now() - 3 * 3600_000;
    await hostStart(alice, "Alice", t0);
    expect(db.paths("fpc/u_alice").length).toBe(2);
    await sweepCoop(alice);
    expect(db.paths("fpc/")).toEqual([]);
  });
  it("deleting a game (Your games › Delete) and losing one stop its share and end its co-op day", async () => {
    const db = RuleDb.create("u_alice");
    const alice = { db, uid: "u_alice" };
    setLinkForTests(async () => alice);
    const g1 = planningGame("One", 1), g2 = planningGame("Two", 2);
    await share(alice, g1); await share(alice, g2);
    const { code } = await hostStart(alice, "Alice");
    const { gameKey } = await import("../state/share");
    setHostFlag({ code, nick: "Alice", expiresAt: Date.now() + 3600_000, game: gameKey(g1) });
    // delete: the slot is read with `peek` (no account settling, nothing written), then the share goes
    const asked: unknown[] = [];
    await forgetSlotSocial({ load: async (id, o) => { asked.push([id, o]); return { loaded: { game: g1, meta: {} as never }, summary: {} as never, from: "device" }; } }, "s1");
    expect(asked).toEqual([["s1", { peek: true }]]);
    await settle();
    expect(db.paths("fps/").filter((p) => p.endsWith("/snap"))).toHaveLength(1);
    expect(db.paths("fpc/")).toEqual([]);
    // lost: the other one goes too, and the marker with it
    await forgetGameSocial(g2);
    expect(db.paths("fps/")).toEqual([]);
  });
  it("the worst case stays far inside the artifact's 25,000-document budget", async () => {
    const db = RuleDb.create("u_a");
    const a = { db, uid: "u_a" };
    for (let i = 0; i < 12; i++) await share(a, planningGame(`R${i}`, 100 + i));
    await expect(share(a, planningGame("R12", 999))).rejects.toMatchObject({ code: "quota_exceeded" });
    const owner = (await openShare({ db: db.as("u_b"), uid: "u_b" }, (await import("../state/share")).newCode("u_a"), known));
    expect("missing" in owner).toBe(true);
    for (let i = 0; i < 35; i++) {
      const c = await share({ db: db.as(`u_o${i}`), uid: `u_o${i}` }, planningGame("X", 1));
      await leaveReview(a, c, { stars: 3, picks: [], nick: "A" });
    }
    const mine = (await db.doc(visitsPath("u_a")).get()).data()!;
    expect((mine.k as string[]).length).toBe(30); // a visitor's own list keeps the newest 30
    await hostStart(a, "A");
    // per player: 1 marker + 12 snapshots + 1 reviews doc + 1 co-op marker + 1 host doc (+ 1 guest doc elsewhere)
    expect(db.paths().filter((p) => p.split("/")[1] === "u_a").length).toBe(16);
  });
});
