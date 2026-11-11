/**
 * Round 12 (G): visit a friend's restaurant and the turn-based co-op day — codes, names, the snapshot and its checks,
 * reviews (one a day, last 50, no free text), the co-op documents, a guest's plan as sim commands, and the screens'
 * no-db line. The db is an in-memory double with db.d.ts's shape (path parity, ordered/limited queries, snapshots).
 * Round 14 (B): the double is ruleDb.ts, which enforces the artifact's access rules; codes carry the owner's check
 * letters; reviews live in each visitor's own document; the co-op documents under each side's own id.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { GameState } from "@full-plate/sim-core";
import { applyCommand, content, newGame, runDay } from "../sim";
import {
  buildSnapshot, checkReview, checkSnapshot, cleanNick, CODE_ALPHABET, CODE_LEN, CODE_RAND, codeFits, leaveReview, listReviews, MAX_REVIEWS, newCode, nickInput, openShare, parseCode,
  pubPath, setLinkForTests, share, sharedCode, showCode, slowKey, snapPath, stopSharing, visitsPath, watchReviews,
  type VisitReview,
} from "../state/share";
import { RuleDb } from "./ruleDb";
import { known, roomState, weekTotals } from "../lib/visit";
import { boardOf, checkGuest, checkHost, eveningOf, guestDoc, hostDoc, planCommands, SESSION_MS } from "../lib/coop/protocol";
import { DocWriter, endHosting, guestJoin, hostStart, RttMeter, watchGuest, watchHost } from "../lib/coop/session";
import { getHostFlag, setHostFlag } from "../lib/coop/hostFlag";
import { weekdayIndex } from "../lib/calendar";
import { VisitShareCard } from "../screens/VisitShareCard";
import { VisitFriend } from "../screens/VisitFriend";
import { TitleScreen } from "../screens/TitleScreen";

afterEach(() => { cleanup(); setLinkForTests(null); localStorage.clear(); setHostFlag(null); });

/** A game on day 3 in planning, with dishes, a hire and some history. */
function planningGame(): GameState {
  let g = newGame(content, { type: "NEW_GAME", seed: 4242, districtId: content.districts[0]!.id, restaurantName: "Chez Test", difficulty: "normal" });
  const step = (cmd: Parameters<typeof applyCommand>[2]) => { g = applyCommand(content, g, cmd).state; };
  for (const d of content.dishes.filter((x) => !x.id.startsWith("ff_") && !x.id.startsWith("fd_")).slice(0, 4)) step({ type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice });
  step({ type: "HIRE", candidateIndex: 0 });
  for (let i = 0; i < 2; i++) { g = runDay(content, g).state; step({ type: "END_DAY" }); if (g.phase === "event") step({ type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === g.activeEvent?.eventId)!.choices[0]!.id }); }
  expect(g.phase).toBe("planning");
  return g;
}

describe("codes and names", () => {
  it("codes are 10 characters from a 31-letter alphabet (8 random: ≥ 36^7.6 of them, + 2 check letters) and survive typing", () => {
    expect(CODE_LEN).toBe(10);
    expect(CODE_ALPHABET.length ** CODE_RAND).toBeGreaterThan(8e11);
    for (let i = 0; i < 50; i++) {
      const c = newCode("u_owner");
      expect(codeFits(c, "u_owner")).toBe(true);
      expect(c).toMatch(/^[A-HJKMNP-Z2-9]{10}$/);
      expect(parseCode(showCode(c).toLowerCase())).toBe(c);
      expect(parseCode(` ${c.slice(0, 5)} - ${c.slice(5)} `)).toBe(c);
    }
    expect(parseCode("ABCDE-1234O")).toBeNull(); // 1 and O are not in the alphabet
    expect(parseCode("ABCDE")).toBeNull();
  });
  it("nicknames are letters, digits and spaces, at most 16", () => {
    expect(cleanNick("  Sam <script>!!  ")).toBe("Sam script");
    expect(cleanNick("‮evil‬ name")).toBe("evil name");
    expect(cleanNick("a".repeat(40))).toHaveLength(16);
    expect(cleanNick("Zoë 2")).toBe("Zoë 2");
    expect(cleanNick("🍕🍕")).toBe("");
    expect(cleanNick(42)).toBe("");
    expect(nickInput("Al ex!")).toBe("Al ex");
  });
});

describe("the snapshot", () => {
  it("carries what a visit draws and nothing else", () => {
    const g = planningGame();
    const s = buildSnapshot(g, Date.UTC(2026, 10, 10));
    expect(s.name).toBe("Chez Test");
    expect(s.date).toBe("2026-11-10");
    expect(s.menu.length).toBe(4);
    expect(s.staff.length).toBe(g.staff.length);
    expect(s.week.length).toBe(2);
    const text = JSON.stringify(s);
    for (const secret of ["cash", "loan", "stock", "rngState", "seed", "wage", "orders", "prefs"]) expect(text).not.toContain(`"${secret}"`);
    expect(text.length).toBeLessThan(20_000);
    // it reads back as itself
    expect(checkSnapshot(JSON.parse(text), known)).toEqual(s);
  });
  it("someone else's snapshot is coerced: unknown ids dropped, names cleaned, lists capped", () => {
    const bad = {
      kind: "fp-share", v: 1, name: "<b>Hi</b>‮".repeat(20), districtId: "nowhere", difficulty: "evil", day: -5, date: "yesterday",
      tables: Array(99).fill(99), decor: { floor: { itemId: "nope" } }, rep: { popularity: 1e9 },
      menu: [{ dishId: "not_a_dish", price: 5 }, { dishId: content.dishes[0]!.id, price: 1e12, active: "yes" }],
      staff: [{ name: { toString: "x" }, role: "chef", skill: 999 }, { name: "Spy", role: "ceo" }],
      reviews: [{ rating: 9, source: "x", text: "fine" }, { rating: 3, text: 7 }], week: "lots", brand: { "bad key!": 1, colour: "<i>red</i>" },
    };
    const s = checkSnapshot(bad, known)!;
    expect(s.name.length).toBeLessThanOrEqual(40);
    expect(s.name).not.toContain("‮");
    expect(s.districtId).toBe("");
    expect(s.difficulty).toBe("normal");
    expect(s.day).toBe(0);
    expect(s.date).toBe("");
    expect(s.tables).toHaveLength(24);
    expect(Math.max(...s.tables)).toBe(12);
    expect(s.decor).toEqual({});
    expect(s.rep.popularity).toBe(100);
    expect(s.menu).toEqual([{ dishId: content.dishes[0]!.id, price: 100_000, active: true }]);
    expect(s.staff).toEqual([{ name: "Someone", role: "chef", skill: 100 }]);
    expect(s.reviews).toEqual([]); // R14 (B): "fine" is not a line the game writes, so it isn't shown
    expect(s.week).toEqual([]);
    expect(s.brand).toEqual({ colour: "<i>red</i>" }); // plain data, rendered as text if ever shown
    expect(checkSnapshot({ ...bad, kind: "other" }, known)).toBeNull();
    expect(checkSnapshot(null, known)).toBeNull();
  });
  it("the visit's room is a throwaway state with the friend's tables and decor; the week adds up", () => {
    const g = planningGame();
    const s = buildSnapshot(g);
    const room = roomState(s);
    expect(room.tables.map((t) => t.seats)).toEqual(g.tables.map((t) => t.seats));
    expect(room.restaurantName).toBe("Chez Test");
    expect(room.customers).toEqual([]);
    const w = weekTotals(s);
    expect(w.covers).toBe(g.history.reduce((a, d) => a + d.covers, 0));
  });
});

describe("sharing and visiting over the db", () => {
  it("share → visit → review → the owner sees it; one review a day; re-share keeps the code; stop removes it all", async () => {
    const db = RuleDb.create("u_owner");
    const owner = { db, uid: "u_owner" };
    const visitor = { db: db.as("u_friend"), uid: "u_friend" };
    const g = planningGame();
    const code = await share(owner, g, { now: Date.UTC(2026, 10, 10) });
    expect(parseCode(code)).toBe(code);
    expect(codeFits(code, "u_owner")).toBe(true);
    expect(await sharedCode(owner, g)).toBe(code);
    // no discovery: the markers list ids only; the snapshot sits under a hash of the code
    expect((await db.collection("fps").get()).docs.map((d) => [d.id, d.data()])).toEqual([["u_owner", { kind: "fp-pub", v: 2 }]]);
    expect(db.paths("fps/")).toEqual([pubPath("u_owner"), snapPath("u_owner", code)]);
    expect(snapPath("u_owner", code)).not.toContain(code);
    const opened = await openShare(visitor, code, known);
    expect("snap" in opened && opened.snap.name).toBe("Chez Test");
    expect("snap" in opened && opened.mine).toBe(false);
    expect("snap" in opened && opened.ownerId).toBe("u_owner");
    expect(await openShare(visitor, "ABCDEFGHJK", known)).toEqual({ missing: true });

    const seen: VisitReview[][] = [];
    const stop = watchReviews(owner, code, (r) => seen.push(r));
    const day = Date.UTC(2026, 10, 10, 12);
    expect(await leaveReview(visitor, code, { stars: 4, picks: ["food", "room", "food", "made-up", "staff", "fast"], nick: "Sam!!" }, day)).toBe("sent");
    expect(await leaveReview(visitor, code, { stars: 1, picks: [], nick: "Sam" }, day + 3600_000)).toBe("already");
    expect(await leaveReview(visitor, code, { stars: 0, picks: [], nick: "Sam" }, day + 86_400_000)).toBe("bad");
    expect(await leaveReview(owner, code, { stars: 5, picks: [], nick: "Me", mine: true }, day)).toBe("own");
    await act(async () => { await Promise.resolve(); });
    const last = seen.at(-1)!;
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ id: "u_friend", stars: 4, picks: ["food", "room", "staff"], nick: "Sam", date: "2026-11-10" });
    // the review is in the visitor's own document, under a slow hash of the code (not the code)
    expect(Object.keys((await db.doc(visitsPath("u_friend")).get()).data()!.r as object)).toEqual([slowKey("r", code)]);
    // the next day, again: it replaces the visitor's one review of this share
    expect(await leaveReview(visitor, code, { stars: 5, picks: ["back"], nick: "Sam" }, day + 86_400_000)).toBe("sent");
    await act(async () => { await Promise.resolve(); });
    expect(seen.at(-1)!.map((r) => r.stars)).toEqual([5]);
    stop();

    // re-share overwrites under the same code
    const later = applyCommand(content, g, { type: "BUY_TABLE" }).state;
    expect(await share(owner, later)).toBe(code);
    const again = await openShare(visitor, code, known);
    expect("snap" in again && again.snap.tables.length).toBe(later.tables.length);

    await stopSharing(owner, g);
    expect(await sharedCode(owner, g)).toBeNull();
    expect((await db.doc(snapPath("u_owner", code)).get()).exists).toBe(false);
    expect(db.paths("fps/")).toEqual([]); // the marker went with the last share
    expect(await openShare(visitor, code, known)).toEqual({ missing: true });
    expect(await share(owner, g)).not.toBe(code); // a new share gets a new code
  });
  it("the owner's list: one review per visitor, newest 50, pruned on read (no document deleted); a forged entry keeps only its stars and listed picks", async () => {
    const code = newCode("u_owner");
    const key = slowKey("r", code);
    const docs = Array.from({ length: 60 }, (_, i) => ({ id: `u_v${String(i).padStart(2, "0")}`, exists: true, data: () => ({ kind: "fp-visits", k: [key], r: { [key]: { stars: 3, picks: ["food"], nick: "x", date: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}` } } }) }));
    const list = listReviews(docs, code, "u_owner");
    expect(list).toHaveLength(MAX_REVIEWS);
    expect(list[0]!.date >= list.at(-1)!.date).toBe(true);
    // a future date reads as today; the owner's own document and hidden visitors are left out
    const far = listReviews([{ id: "u_x", exists: true, data: () => ({ kind: "fp-visits", r: { [key]: { stars: 2, date: "2099-01-01" } } }) }, { ...docs[0]!, id: "u_owner" }], code, "u_owner", [], Date.UTC(2026, 10, 11));
    expect(far.map((r) => [r.id, r.date])).toEqual([["u_x", "2026-11-11"]]);
    expect(listReviews(docs.slice(0, 3), code, "u_owner", ["u_v01"]).map((r) => r.id)).toEqual(["u_v02", "u_v00"]);
    expect(checkReview("x", { stars: 99, picks: ["<img onerror>", "food"], nick: "<b>Bad</b> words here and more", text: "free text is ignored", at: 1e14 }))
      .toEqual({ id: "x", stars: 5, picks: ["food"], nick: "bBadb words here", date: "" });
  });
});

describe("the co-op day", () => {
  it("a guest's plan becomes planning commands the sim applies like the host's own taps", () => {
    const g = planningGame();
    const wd = weekdayIndex(g.day);
    const board = boardOf(g, wd);
    const [a, b] = board.menu;
    const worker = board.staff[0]!;
    const plan = {
      n: 1, day: g.day,
      menu: [{ ...a!, active: !a!.active }, { ...b!, price: b!.price + 50 }, { dishId: "not_on_menu", price: 100, active: true }],
      on: board.staff.filter((s) => s.id !== worker.id && s.on).map((s) => s.id).concat(worker.on ? [] : [worker.id]),
    };
    const changes = planCommands(g, plan, wd, (id) => id);
    expect(changes.map((c) => c.kind).sort()).toEqual(["dishOff", "price", worker.on ? "staffOff" : "staffOn"].sort());
    let h = g;
    for (const c of changes) h = applyCommand(content, h, c.cmd).state;
    expect(h.menu.find((m) => m.dishId === a!.dishId)!.active).toBe(!a!.active);
    expect(h.menu.find((m) => m.dishId === b!.dishId)!.price).toBe(b!.price + 50);
    expect(h.staff.find((s) => s.id === worker.id)!.rota[wd]).toBe(!worker.on);
    // the same commands from the same state give the same game: the plan is just input
    let h2 = g;
    for (const c of planCommands(g, plan, wd, (id) => id)) h2 = applyCommand(content, h2, c.cmd).state;
    expect(JSON.stringify(h2)).toBe(JSON.stringify(h));
    // a plan for another day, or outside planning, changes nothing
    expect(planCommands(g, { ...plan, day: g.day - 1 }, wd, (id) => id)).toEqual([]);
    expect(planCommands({ ...g, phase: "service" }, plan, wd, (id) => id)).toEqual([]);
  });
  it("the evening the guest sees comes from the host's last result", () => {
    let g = planningGame();
    g = runDay(content, g).state;
    const e = eveningOf(g)!;
    expect(e.day).toBe(g.day);
    expect(e.covers).toBe(g.history.at(-1)!.covers);
  });
  it("both documents are coerced on read: emotes from the list, no free text, ids checked", () => {
    const h = checkHost({ ...hostDoc({ nick: "Al<script>", createdAt: 1 }), emote: { id: "rude", n: 3 }, board: { day: 2, restaurant: "X", menu: [{ dishId: "zzz" }], staff: [{ id: "bad id!", role: "chef" }, { id: "s1", role: "chef", name: "Bo", on: true }] } }, known.dish)!;
    expect(h.nick).toBe("Alscript");
    expect(h.emote).toBeNull();
    expect(h.expiresAt).toBe(1 + SESSION_MS);
    expect(h.board!.menu).toEqual([]);
    expect(h.board!.staff).toEqual([{ id: "s1", name: "Bo", role: "chef", on: true }]);
    const gd = checkGuest({ ...guestDoc({ nick: "Sam", joinedAt: 5 }), plan: { n: 1, day: 2, menu: [], on: ["s1", "<x>", 7] }, emote: { id: "clap", n: Date.now() } }, known.dish)!;
    expect(gd.plan!.on).toEqual(["s1"]);
    expect(gd.emote!.id).toBe("clap");
    expect(checkGuest({ kind: "nope" }, known.dish)).toBeNull();
  });
  it("invite → join → both see each other → plan → answer → end; expired and ended codes don't join", async () => {
    const db = RuleDb.create("u_host");
    const host = { db, uid: "u_host" };
    const guest = { db: db.as("u_guest"), uid: "u_guest" };
    const t0 = 1_000_000;
    const { code, writer } = await hostStart(host, "Ali", t0);
    expect(codeFits(code, "u_host")).toBe(true);
    const g = planningGame();
    await writer.patch({ board: boardOf(g, weekdayIndex(g.day)) });
    expect(await guestJoin(guest, "nonsense", "Sam", known.dish, t0)).toEqual({ ok: false, why: "code" });
    expect(await guestJoin(guest, "ABCDEFGHJK", "Sam", known.dish, t0)).toEqual({ ok: false, why: "missing" });
    expect(await guestJoin(guest, code, "Sam", known.dish, t0 + SESSION_MS + 1)).toEqual({ ok: false, why: "expired" });
    expect(await guestJoin(host, code, "Me", known.dish, t0)).toEqual({ ok: false, why: "own" });
    const j = await guestJoin(guest, showCode(code).toLowerCase(), "Sam", known.dish, t0 + 1000);
    if (!j.ok) throw new Error("join failed");
    expect(j.host.nick).toBe("Ali");
    expect(j.host.board!.restaurant).toBe("Chez Test");
    expect(j.hostId).toBe("u_host");
    expect(j.partnerId).toBe("u_host");

    const hostSees: (ReturnType<typeof checkGuest>)[] = [];
    const partner: (string | null)[] = [];
    const guestSees: (ReturnType<typeof checkHost>)[] = [];
    const s1 = watchGuest(host, writer, code, known.dish, (x, id) => { hostSees.push(x); partner.push(id); });
    const s2 = watchHost(guest.db, "u_host", code, known.dish, (x) => guestSees.push(x), undefined, "u_guest");
    for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
    expect(hostSees.at(-1)!.nick).toBe("Sam");
    expect(partner.at(-1)).toBe("u_guest");
    expect(writer.current.guest).toBe("u_guest"); // pinned into the host's own document
    await j.writer.patch({ plan: { n: 1, day: g.day, menu: [], on: [] }, emote: { id: "wave", n: 1 } });
    expect(hostSees.at(-1)!.plan!.n).toBe(1);
    expect(hostSees.at(-1)!.emote!.id).toBe("wave");
    await writer.patch({ answer: { n: 1, used: false } });
    expect(guestSees.at(-1)!.answer).toEqual({ n: 1, used: false });
    await writer.patch({ stage: "ended" });
    expect(guestSees.at(-1)!.stage).toBe("ended");
    expect(await guestJoin(guest, code, "Sam", known.dish, t0 + 2000)).toEqual({ ok: false, why: "ended" });
    // ending deletes the host's document (and its marker, nothing else being open)
    await endHosting(host, code, writer);
    expect(db.paths("fpc/u_host")).toEqual([]);
    expect(guestSees.at(-1)).toBeNull();
    s1(); s2();
  });
  it("the writer sends one write at a time and coalesces a burst into the newest body", async () => {
    const db = RuleDb.create("u_host");
    const w = new DocWriter(db, "fpc/u_host/cABC/host", { a: 0 });
    const all = Promise.all([1, 2, 3, 4, 5].map((a) => w.patch({ a })));
    await all;
    expect(db.writes).toBeLessThanOrEqual(2);
    expect((await db.doc("fpc/u_host/cABC/host").get()).data()).toEqual({ a: 5 });
  });
  it("round trips are measured ping → pong; the median shows", () => {
    const m = new RttMeter();
    const a = m.ping(0), b = m.ping(10), c = m.ping(20);
    expect(m.pong(b, 310)).toBe(300);
    expect(m.pong(a, 100)).toBe(100);
    expect(m.pong(c, 220)).toBe(200);
    expect(m.pong(99, 500)).toBeNull();
    expect(m.median).toBe(200);
  });
  it("the host flag survives a reload and ends itself after two hours", () => {
    setHostFlag({ code: "ABCDEFGHJK", nick: "Ali", expiresAt: Date.now() + 1000, game: "g" });
    expect(JSON.parse(localStorage.getItem("full-plate:coop-host:v1")!).code).toBe("ABCDEFGHJK");
    setHostFlag({ code: "ABCDEFGHJK", nick: "Ali", expiresAt: Date.now() - 1, game: "g" });
    expect(getHostFlag()).toBeNull();
  });
});

describe("screens", () => {
  it("without the Claude link, the Friends card and Visit a friend say so in one line", async () => {
    setLinkForTests(async () => ({ off: "none" }));
    render(<VisitShareCard game={planningGame()} />);
    expect(await screen.findByText(/Sharing needs the Claude link/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Share my restaurant/ })).toBeNull();
    cleanup();
    render(<VisitFriend onBack={() => {}} />);
    expect(await screen.findByText(/Sharing needs the Claude link/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("with a db, the card offers Share, and sharing shows the code", async () => {
    const db = RuleDb.create("u_owner");
    setLinkForTests(async () => ({ db, uid: "u_owner" }));
    render(<VisitShareCard game={planningGame()} />);
    const btn = await screen.findByRole("button", { name: "Share my restaurant" });
    await act(async () => { btn.click(); });
    expect(await screen.findByText(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Stop sharing/ })).toBeTruthy();
    expect(screen.getByText("No visitors yet.")).toBeTruthy();
  });
  it("the title has a Visit a friend button when the app passes one", () => {
    let hit = 0;
    render(<TitleScreen saved={null} slots={[]} onNew={() => {}} onContinue={() => {}} onVisit={() => hit++} />);
    screen.getByRole("button", { name: /Visit a friend/ }).click();
    expect(hit).toBe(1);
  });
});

// ── R12 review: B's brand kit rides along on a share and comes back as the owner's logo ──
import { shareBrand } from "../screens/VisitShareCard";
import { visitBrandLogo } from "../screens/VisitRoom";
import { defaultBrand, encodeBrand, logoDataUrl, parseBrand } from "../lib/brand";

describe("share carries the brand (R12 review)", () => {
  it("a set brand survives buildSnapshot → checkSnapshot and draws the same logo; junk falls back to the name's default", () => {
    const g = newGame(content, { type: "NEW_GAME", seed: 7, restaurantName: "Brand Test" } as never);
    const mine = { ...defaultBrand("something else"), primary: "#123456", accent: "#fedcba" };
    const code = encodeBrand(mine);
    const s = checkSnapshot(JSON.parse(JSON.stringify(buildSnapshot(g, 0, shareBrand(g, code)))), known)!;
    expect(visitBrandLogo(s)).toBe(logoDataUrl(parseBrand(code, defaultBrand(s.name))));
    expect(visitBrandLogo({ name: s.name, brand: { shape: "<script>", primary: "zz" } })).toBe(logoDataUrl(defaultBrand(s.name)));
    expect(visitBrandLogo({ name: s.name })).toBeNull();
  });
});
