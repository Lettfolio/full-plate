/**
 * Round 13 (F): the live co-op shift's protocol (lib/coop/realtime.ts) — the snapshot codec, the host's checks on the
 * guest's input, the session tags, and whole shifts between a host bot and a guest bot over a lossy, reordering room
 * (coopNet.ts), with the host's action log replayed to a byte-identical game.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { botInput, createSession, updateSession, type HandsOnResult, type HandsOnSession } from "@full-plate/handson";
import { appReducer, type AppAction, type AppState } from "../state/gameReducer";
import { decodeSave } from "../state/save";
import { content } from "../sim";
import { HANDS_ON_SECONDS_PER_TICK } from "../screens/HandsOnShift";
import {
  checkResult, decodeBase, decodeFloor, encodeBase, encodeFloor, LiveGuest, LiveHost, MSG_MAX, newNonce, roomName, skeletonOf, tagOf, TOPIC, viewOf,
  type LiveRole, type RoomMsg,
} from "../lib/coop/realtime";
import { checkHost, checkLive, hostDoc } from "../lib/coop/protocol";
import { FakeRoom, type NetOpts } from "./coopNet";
import { loadedApp } from "./fixtures/corpus/playDay";

const DIR = join(__dirname, "fixtures/corpus");
function ownerPlanning(): AppState {
  const raw = gunzipSync(readFileSync(join(DIR, "r11-owner-staffed-normal-d40.json.gz"))).toString("utf8");
  let s = loadedApp(decodeSave(raw));
  for (let i = 0; i < 6 && s.game!.phase !== "planning"; i++) {
    s = s.game!.phase === "service" ? appReducer(s, { type: "skipShift" }) : s.game!.phase === "event"
      ? appReducer(s, { type: "command", cmd: { type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === s.game!.activeEvent?.eventId)!.choices[0]!.id } })
      : appReducer(s, { type: "nextDay" });
  }
  expect(s.game!.phase).toBe("planning");
  return s;
}
/** A busy moment: the service run (no hands-on) to its middle. */
function midService(): AppState {
  let s = appReducer(ownerPlanning(), { type: "command", cmd: { type: "START_SERVICE" } });
  let best = s;
  for (let i = 0; i < 110 && s.game!.phase === "service"; i++) {
    s = appReducer(s, { type: "ticks", n: 1 });
    if (s.game!.phase === "service" && s.game!.customers.length + s.game!.tickets.length > best.game!.customers.length + best.game!.tickets.length) best = s;
  }
  return best;
}

describe("snapshot codec", () => {
  it("round-trips the room and the floor, under room.d.ts's 4 KiB, with everything the hands-on view reads", () => {
    const g = midService().game!;
    expect(g.customers.length).toBeGreaterThan(4);
    const bm = encodeBase(g, "chef");
    const base = decodeBase(JSON.parse(JSON.stringify(bm)))!;
    expect(base.tables.map((t) => t.id)).toEqual(g.tables.map((t) => t.id));
    expect(base.staff.length).toBe(g.staff.length);
    const fm = encodeFloor(g, base, { seq: 3, t: 1000, ack: 2, rtt: 120, guestOn: true });
    const n = new TextEncoder().encode(JSON.stringify({ s: "x".repeat(20), ...fm })).length;
    expect(n).toBeLessThan(MSG_MAX);
    const f = decodeFloor(JSON.parse(JSON.stringify(fm)), base)!;
    expect(f.seq).toBe(3);
    expect(f.tick).toBe(g.tick);
    expect(f.customers.map((c) => [c.id, c.stage, c.tableId, c.order])).toEqual(g.customers.map((c) => [c.id, c.stage, c.tableId, c.order]));
    expect(f.tickets.map((t) => [t.id, t.customerId, t.dishId, t.ticksRemaining, !!t.atPass])).toEqual(g.tickets.map((t) => [t.id, t.customerId, t.dishId, t.ticksRemaining, !!t.atPass]));
    const view = viewOf(skeletonOf(base), f);
    expect(view.tables.map((t) => [t.id, t.dirtyTicks, t.occupiedBy])).toEqual(g.tables.map((t) => [t.id, t.dirtyTicks, t.occupiedBy]));
    // the guest's own hands-on session runs against it
    let sess = createSession(view, "server", { content, tutorial: false });
    for (let i = 0; i < 120; i++) sess = updateSession(sess, view, botInput(sess, view, 0.6, 1), 1 / 60).session;
    expect(sess.time).toBeGreaterThan(1.9);
  });

  it("trims a crowded floor (queue first) to stay under the budget, and refuses junk", () => {
    const g = midService().game!;
    const many = { ...g, customers: [...g.customers, ...Array.from({ length: 80 }, (_, i) => ({ ...g.customers[0]!, id: `cq${i}`, stage: "queue" as const, tableId: undefined }))] };
    const base = decodeBase(encodeBase(many, "chef"))!;
    const fm = encodeFloor(many, base, { seq: 1, t: 1, ack: 0, rtt: null, guestOn: false });
    expect(new TextEncoder().encode(JSON.stringify(fm)).length).toBeLessThanOrEqual(3800);
    const f = decodeFloor(fm, base)!;
    expect(f.customers.filter((c) => c.stage !== "queue").length).toBe(g.customers.filter((c) => c.stage !== "queue").length);
    // malformed / hostile
    expect(decodeBase({ k: "base", tb: [] })).toBeNull();
    expect(decodeFloor({ k: "st", b: base.b + 1 }, base)).toBeNull();
    const bad = decodeFloor({ k: "st", b: base.b, c: [["<img>", "families", 2, 1, 0, [], 50, 0, 0, 0, 0, 0, 0], ["ok1", "nope", 2, 1], ["ok2", "families", 99, 9]], x: [["t1", 7, 0]], tb: [[1e9, 55]] }, base)!;
    expect(bad.customers).toHaveLength(0);
    expect(bad.tickets).toHaveLength(0);
    expect(bad.tables[0]).toEqual({ dirty: 9999, occ: -1 });
  });
});

describe("the host's checks on the guest's input", () => {
  it("lets a server serve, clear, take payment and drop plates; nothing else", () => {
    expect(checkResult({ type: "TABLE_SERVED", customerId: "c1", ticketId: "k1", speedBonus: 9 }, "server")).toEqual({ type: "TABLE_SERVED", customerId: "c1", ticketId: "k1", speedBonus: 1 });
    expect(checkResult({ type: "PLATE_COOKED", ticketId: "k1", quality: 100 }, "server")).toBeNull();
    expect(checkResult({ type: "RAIL_RESIZED", cap: 9 }, "server")).toBeNull();
    expect(checkResult({ type: "START_SERVICE" }, "server")).toBeNull();
    expect(checkResult({ type: "SET_MENU_ITEM", dishId: "x", price: 1 }, "chef")).toBeNull();
    expect(checkResult({ type: "DROPPED", item: "raw", cost: 99999 }, "server")).toBeNull();
    expect(checkResult({ type: "DROPPED", item: "plates", cost: 99999, ticketIds: ["a", "b", "c", "d"], extra: 1 }, "server")).toEqual({ type: "DROPPED", item: "plates", cost: 5000, ticketIds: ["a", "b", "c"] });
    expect(checkResult({ type: "TABLE_CLEARED", tableId: "t1; drop" }, "server")).toBeNull();
  });
  it("lets a chef claim, plate and drop what they were cooking", () => {
    expect(checkResult({ type: "PLATE_COOKED", ticketId: "k1", quality: 250, execution: -1, station: "laser", speedBonus: 0.5 }, "chef")).toEqual({ type: "PLATE_COOKED", ticketId: "k1", quality: 100, execution: 0, station: "none", speedBonus: 0.5 });
    expect(checkResult({ type: "TICKET_CLAIMED", ticketId: "k1" }, "chef")).toEqual({ type: "TICKET_CLAIMED", ticketId: "k1" });
    expect(checkResult({ type: "TABLE_SERVED", customerId: "c1", ticketId: "k1" }, "chef")).toBeNull();
  });
});

describe("the lobby record and the room", () => {
  it("keeps live in the host's document, coerced", () => {
    const n = newNonce();
    expect(n).toMatch(/^[a-z0-9]{24}$/);
    expect(checkLive({ nonce: n, guestRole: "chef", state: "on", day: 3, at: 5 })).toEqual({ nonce: n, guestRole: "chef", state: "on", day: 3, at: 5 });
    expect(checkLive({ nonce: "short", state: "on" })).toBeNull();
    expect(checkLive({ nonce: n, state: "party" })).toBeNull();
    const h = checkHost({ ...hostDoc({ nick: "Al", createdAt: 1 }), live: { nonce: n, guestRole: "x", state: "ready", day: 2, at: 1 } }, () => true)!;
    expect(h.live).toEqual({ nonce: n, guestRole: "server", state: "ready", day: 2, at: 1 });
    expect(checkHost(hostDoc({ nick: "Al", createdAt: 1 }), () => true)!.live).toBeUndefined();
    const name = roomName("ABCDEFGHJK", n);
    expect(name).toMatch(/^[a-z0-9][a-z0-9_.-]{0,47}$/);
    expect(roomName("ABCDEFGHJK", newNonce())).not.toBe(name);
  });
});

// ───────────────────────── whole shifts ─────────────────────────

const STEP = 1 / 60;
interface Run {
  host: LiveHost; guest: LiveGuest; net: FakeRoom; app: AppState; start: AppState; log: AppAction[];
  sent: number; served: number; applied: number; guestSession: HandsOnSession; seconds: number; simRoles: string[];
}
/**
 * The host plays `hostRole` with the package bot through the real app reducer (as HandsOnShift does); the guest plays
 * the other role with the bot against the view it rebuilds from snapshots. `quiet` = [from, to] seconds the guest
 * says nothing (a tab in the background).
 */
function playLive(net: NetOpts, hostRole: LiveRole = "chef", opts: { seconds?: number; quiet?: [number, number] } = {}): Run {
  const room = new FakeRoom(net);
  const nonce = "a".repeat(24);
  let app = appReducer(ownerPlanning(), { type: "command", cmd: { type: "START_SERVICE" } });
  app = appReducer(app, { type: "handsOnStart", meta: { role: hostRole, jumpIn: true } });
  const start = app;
  const log: AppAction[] = [];
  const act = (a: AppAction) => { log.push(a); app = appReducer(app, a); host.setGame(app.game!); };
  const simRoles: string[] = [];
  const host: LiveHost = new LiveHost({
    emit: room.emitter("hostpeer"), now: () => room.now,
    apply: (results) => act({ type: "handsOnResults", results }),
    setSimRole: (role) => { simRoles.push(role); act({ type: "command", cmd: { type: "SET_HANDS_ON", role } }); },
  }, { nonce, hostRole });
  const guestRole = hostRole === "chef" ? "server" : "chef";
  const guest = new LiveGuest({ emit: room.emitter("guestpeer"), now: () => room.now }, { nonce, role: guestRole });
  room.join("hostpeer", "u_host", (m) => host.hear(m));
  room.join("guestpeer", "u_guest", (m) => guest.hear(m));
  host.setMe("hostpeer"); guest.setMe("guestpeer");
  host.setGame(app.game!);
  let hs = createSession(app.game!, hostRole, { content, tutorial: false });
  let gs: HandsOnSession | null = null;
  let sent = 0;
  let t = 0, tickAcc = 0, pumpAcc = 0;
  const maxT = opts.seconds ?? 400;
  while (app.game!.phase === "service" && t < maxT) {
    t += STEP; tickAcc += STEP; pumpAcc += STEP;
    room.advance(Math.round(t * 1000));
    const r = updateSession(hs, app.game!, botInput(hs, app.game!, 0.6, 1), STEP);
    hs = r.session;
    if (r.results.length) act({ type: "handsOnResults", results: r.results });
    const quiet = opts.quiet && t >= opts.quiet[0] && t < opts.quiet[1];
    if (guest.view && !quiet) {
      gs ??= createSession(guest.view, guestRole, { content, tutorial: false });
      const g = updateSession(gs, guest.view, botInput(gs, guest.view, 0.6, 1), STEP);
      gs = g.session;
      const mine = g.results.filter((x: HandsOnResult) => x.type !== "RAIL_RESIZED");
      if (mine.length) { sent += mine.length; guest.send(mine); }
    }
    if (pumpAcc >= 0.05) { pumpAcc = 0; host.pump(); if (!quiet) guest.pump(); }
    if (tickAcc >= HANDS_ON_SECONDS_PER_TICK) { tickAcc -= HANDS_ON_SECONDS_PER_TICK; act({ type: "ticks", n: 1 }); }
  }
  if (app.game!.phase !== "service") { host.end("done"); for (let i = 0; i < 30; i++) { t += 0.05; room.advance(Math.round(t * 1000)); host.pump(); } }
  const served = gs?.score.served ?? 0;
  return { host, guest, net: room, app, start, log, sent, served, applied: host.status.applied, guestSession: gs!, seconds: t, simRoles };
}
const replay = (r: Run): AppState => r.log.reduce(appReducer, r.start);
const gameJson = (s: AppState) => JSON.stringify(s.game);

describe("a whole live shift between two bots", () => {
  it("at 0 ms: every guest result lands once, the guest serves, and the log replays byte-identically", () => {
    const r = playLive({ latencyMs: 0 });
    expect(r.app.game!.phase).not.toBe("service");
    expect(r.served).toBeGreaterThan(5);
    expect(r.applied).toBe(r.sent);
    expect(r.guest.status.ended).toBe("done");
    expect(gameJson(replay(r))).toBe(gameJson(r.app));
    // the guest's taps arrived through the role's own commands only
    const fromGuest = r.log.filter((a): a is Extract<AppAction, { type: "handsOnResults" }> => a.type === "handsOnResults").flatMap((a) => a.results.map((x) => x.type));
    expect(new Set(fromGuest)).not.toContain("RAIL_RESIZED");
  }, 120_000);

  it("at 150 ms with 20% loss and reordering: still exactly once, still replays", () => {
    const r = playLive({ latencyMs: 150, jitterMs: 120, loss: 0.2, seed: 11 });
    expect(r.net.dropped).toBeGreaterThan(50);
    expect(r.served).toBeGreaterThan(3);
    expect(r.applied).toBeLessThanOrEqual(r.sent);
    expect(r.applied).toBeGreaterThanOrEqual(r.sent - 16); // at most the last batch in flight at closing time
    expect(gameJson(replay(r))).toBe(gameJson(r.app));
    const sizes = r.host.sizes;
    expect(Math.max(...sizes)).toBeLessThan(MSG_MAX);
    const rate = r.host.status.snaps / r.seconds;
    expect(rate).toBeGreaterThanOrEqual(4.5);
    expect(rate).toBeLessThanOrEqual(10.5);
  }, 120_000);

  it("at 400 ms with 20% loss the host says the link is slow", () => {
    const r = playLive({ latencyMs: 400, jitterMs: 100, loss: 0.2, seed: 3 }, "chef", { seconds: 40 });
    expect(r.host.status.rtt).toBeGreaterThan(400);
    expect(r.host.status.slow).toBe(true);
  }, 60_000);

  it("a guest quiet for 3 s hands the role back to the team, and takes it back on return", () => {
    const r = playLive({ latencyMs: 60 }, "chef", { seconds: 40, quiet: [10, 20] });
    // server (guest here) → chef (guest away: the host's own role; the sim's fallback serves) → server again
    expect(r.simRoles.slice(0, 3)).toEqual(["server", "chef", "server"]);
    expect(gameJson(replay(r))).toBe(gameJson(r.app));
  }, 60_000);

  it("host serves, guest cooks: the guest's plates reach the host's game", () => {
    const r = playLive({ latencyMs: 80, jitterMs: 40, loss: 0.1, seed: 5 }, "server", { seconds: 90 });
    const cooked = r.guestSession.score.plates;
    expect(cooked).toBeGreaterThan(0);
    expect(r.app.game!.service!.chefs?.player?.plates ?? 0).toBeGreaterThan(0);
    expect(gameJson(replay(r))).toBe(gameJson(r.app));
  }, 60_000);
});

describe("before the doors open", () => {
  it("the host sends the room but no floor, so the guest waits instead of playing an empty service", () => {
    const room = new FakeRoom();
    const nonce = "d".repeat(24);
    const host = new LiveHost({ emit: room.emitter("H"), now: () => room.now, apply: () => {}, setSimRole: () => {} }, { nonce, hostRole: "chef" });
    const guest = new LiveGuest({ emit: room.emitter("G"), now: () => room.now }, { nonce, role: "server" });
    room.join("H", "u_h", (m) => host.hear(m)); room.join("G", "u_g", (m) => guest.hear(m));
    host.setMe("H"); guest.setMe("G");
    const planning = ownerPlanning();
    host.setGame(planning.game!);
    for (let t = 50; t <= 3000; t += 50) { room.advance(t); host.pump(); guest.pump(); }
    expect(guest.base).not.toBeNull();
    expect(guest.view).toBeNull();
    expect(host.status.guest).toBe("here");
    host.setGame(appReducer(planning, { type: "command", cmd: { type: "START_SERVICE" } }).game!);
    for (let t = 3050; t <= 3500; t += 50) { room.advance(t); host.pump(); guest.pump(); }
    expect(guest.view?.phase).toBe("service");
  });
});

describe("strangers in the room", () => {
  it("can't speak for the host or the guest, replay their messages, or pin themselves", () => {
    const room = new FakeRoom();
    const nonce = "b".repeat(24);
    const applied: HandsOnResult[] = [];
    const host = new LiveHost({ emit: room.emitter("H"), now: () => room.now, apply: (r) => applied.push(...r), setSimRole: () => {} }, { nonce, hostRole: "chef" });
    const g = midService().game!;
    host.setMe("H");
    host.setGame({ ...g, handsOn: { role: "chef", since: 0 } });
    room.join("H", "u_h", (m) => host.hear(m));
    const say = (peer: string, data: unknown, by: string | null = null): RoomMsg => ({ peer, by, isMe: false, sameTab: false, kind: "viewer", topic: TOPIC.in, data });
    const act = { k: "act", p: [[1, [{ type: "PAYMENT_TAKEN", customerId: g.customers[0]!.id }]]] };
    // no tag, a made-up tag, the guest's tag sent from another peer (a replay), an agent
    host.hear(say("X", act));
    host.hear(say("X", { s: "0".repeat(20), ...act }));
    host.hear(say("X", { s: tagOf(nonce, "G"), ...act }));
    host.hear({ ...say("G", { s: tagOf(nonce, "G"), ...act }), kind: "agent" });
    expect(applied).toHaveLength(0);
    // the real guest's first genuine message pins them (their hello may have been lost)
    host.hear(say("G", { s: tagOf(nonce, "G"), ...act }, "u_g"));
    expect(applied).toHaveLength(1);
    // a second peer that somehow had the nonce can't take the guest's place while they're here
    host.hear(say("Z", { s: tagOf(nonce, "Z"), k: "hi" }, "u_z"));
    host.hear(say("Z", { s: tagOf(nonce, "Z"), k: "act", p: [[2, [{ type: "PAYMENT_TAKEN", customerId: "c9" }]]] }, "u_z"));
    expect(applied).toHaveLength(1);
    // the same batch again (a re-send) is not applied twice
    host.hear(say("G", { s: tagOf(nonce, "G"), ...act }, "u_g"));
    expect(applied).toHaveLength(1);
    expect(host.refused).toBe(5);
  });

  it("the guest ignores a floor from anyone but the pinned host, and stale (reordered) floors", () => {
    const g = midService().game!;
    const nonce = "c".repeat(24);
    const guest = new LiveGuest({ emit: () => {}, now: () => 0 }, { nonce, role: "server" });
    guest.setMe("G");
    const bm = encodeBase(g, "chef");
    const base = decodeBase(bm)!;
    const from = (peer: string, data: Record<string, unknown>): RoomMsg => ({ peer, by: null, isMe: false, sameTab: false, kind: "viewer", topic: TOPIC.st, data: { s: tagOf(nonce, peer), ...data } });
    guest.hear(from("H", bm));
    guest.hear(from("H", encodeFloor(g, base, { seq: 5, t: 1, ack: 0, rtt: null, guestOn: true })));
    expect(guest.floor?.seq).toBe(5);
    guest.hear(from("H", encodeFloor(g, base, { seq: 4, t: 1, ack: 0, rtt: null, guestOn: true })));
    expect(guest.floor?.seq).toBe(5);
    guest.hear(from("X", encodeFloor({ ...g, tick: 999 }, base, { seq: 9, t: 1, ack: 0, rtt: null, guestOn: true })));
    expect(guest.floor?.seq).toBe(5);
    guest.hear({ ...from("H", encodeFloor(g, base, { seq: 6, t: 1, ack: 0, rtt: null, guestOn: true })), data: { s: "nope", k: "st" } });
    expect(guest.floor?.seq).toBe(5);
    expect(guest.refused).toBeGreaterThanOrEqual(2);
  });
});
