/**
 * Round 14 (A): live co-op integrity — the second red team's S14-1/G1, S14-3, G3, G5 and R13-N1, each as the reviewer
 * reproduced it (r14/redteam/{sec,game}), now asserting what should hold. Every `it` here fails on master 823733b.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { botInput, createSession, updateSession, type HandsOnResult, type HandsOnSession } from "@full-plate/handson";
import { applyCommand, type GameState } from "@full-plate/sim-core";
import { appReducer, type AppAction, type AppState } from "../state/gameReducer";
import { decodeSave, encodeSave } from "../state/save";
import { content } from "../sim";
import { HANDS_ON_SECONDS_PER_TICK } from "../screens/HandsOnShift";
import {
  decodeBase, DROP_CAP_MIN, encodeBase, encodeFloor, LiveGuest, LiveHost, newLedger, RESULT_BURST, tagOf, TOPIC, vetResults,
  type LiveRole, type RoomMsg,
} from "../lib/coop/realtime";
import { FakeRoom } from "./coopNet";
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
  return s;
}
function hostInService(hostRole: LiveRole = "chef", ticks = 40): AppState {
  let app = appReducer(ownerPlanning(), { type: "command", cmd: { type: "START_SERVICE" } });
  app = appReducer(app, { type: "handsOnStart", meta: { role: hostRole, jumpIn: true } });
  for (let i = 0; i < ticks; i++) app = appReducer(app, { type: "ticks", n: 1 });
  return app;
}
const tagged = (peer: string, nonce: string, data: Record<string, unknown>, by: string | null, topic: string = TOPIC.in): RoomMsg =>
  ({ peer, by, isMe: false, sameTab: false, kind: "viewer", topic, data: { s: tagOf(nonce, peer), ...data } });

/** A host whose guest results go through the real reducer, on a clock the test moves. */
function rig(app0: AppState, hostRole: LiveRole = "chef") {
  const box = { app: app0, now: 1000, roles: [] as string[] };
  const nonce = "q".repeat(24);
  const host: LiveHost = new LiveHost({
    emit: () => {}, now: () => box.now,
    apply: (results) => { box.app = appReducer(box.app, { type: "handsOnResults", results }); host.setGame(box.app.game!); },
    setSimRole: (r) => { box.roles.push(r); box.app = appReducer(box.app, { type: "command", cmd: { type: "SET_HANDS_ON", role: r } }); host.setGame(box.app.game!); },
  }, { nonce, hostRole });
  host.setMe("H");
  host.setGame(box.app.game!);
  const say = (body: Record<string, unknown>, peer = "G", by: string | null = "u_guest") => host.hear(tagged(peer, nonce, body, by));
  return { box, host, say, nonce };
}
/** Every plate on the pass, so a "server" guest could honestly be carrying any of them. */
const allAtPass = (g: GameState): GameState => ({ ...g, tickets: g.tickets.map((t, i) => ({ ...t, atPass: true, platedAtTick: g.tick - (i % 3), quality: 60, ticksRemaining: 0 })) });

describe("S14-1 / G1: a guest can't spend the host's money", () => {
  it("20 batches × 16 fabricated drops a message, 31 messages in 2 s: the host's cash doesn't move", () => {
    const { box, host, say } = rig(hostInService());
    const cash0 = box.app.game!.cash;
    say({ k: "hi", role: "server" });
    const drop = { type: "DROPPED", item: "plates", cost: 5000 };
    let q = 0;
    for (let i = 0; i < 31; i++) { box.now += 66; say({ k: "act", p: Array.from({ length: 20 }, () => [++q, Array.from({ length: 16 }, () => drop)]) }); }
    expect(box.app.game!.cash).toBe(cash0);
    // and the save keeps the honest number
    expect((decodeSave(encodeSave(box.app.game!, box.app.meta)) as { game: GameState }).game.cash).toBe(cash0);
  });

  it("a drop naming every ticket sends back only plates on the pass, at most three, each once, at the host's price", () => {
    let app = hostInService();
    for (let i = 0; i < 60; i++) app = appReducer(app, { type: "ticks", n: 1 });
    const { box, host, say } = rig(app);
    const g0 = box.app.game!;
    const atPass = g0.tickets.filter((t) => t.atPass);
    const cooking = g0.tickets.filter((t) => !t.atPass);
    expect(atPass.length + cooking.length).toBeGreaterThan(3);
    const ids = g0.tickets.map((t) => t.id);
    const drops = [];
    for (let i = 0; i < ids.length; i += 3) drops.push({ type: "DROPPED", item: "plates", cost: 0, ticketIds: ids.slice(i, i + 3) });
    say({ k: "hi", role: "server" });
    say({ k: "act", p: [[1, drops.slice(0, 16)]] });
    const g1 = box.app.game!;
    // tickets still cooking are untouched
    for (const t of cooking) expect(g1.tickets.find((x) => x.id === t.id)).toEqual(t);
    // at most one drop honoured in that instant (a server carries at most three plates)
    const reset = atPass.filter((t) => !g1.tickets.find((x) => x.id === t.id)?.atPass);
    expect(reset.length).toBeLessThanOrEqual(3);
    // the same plates again later cost nothing more
    const cash1 = g1.cash;
    box.now += 5000;
    say({ k: "act", p: [[2, [{ type: "DROPPED", item: "plates", cost: 5000, ticketIds: reset.map((t) => t.id) }]]] });
    expect(box.app.game!.cash).toBe(cash1);
  });

  it("the host prices a drop from the dish, whatever the guest says it cost", () => {
    const app = hostInService();
    const { box, host, say } = rig({ ...app, game: allAtPass(app.game!) });
    const t = box.app.game!.tickets[0]!;
    const cash0 = box.app.game!.cash;
    say({ k: "hi", role: "server" });
    say({ k: "act", p: [[1, [{ type: "DROPPED", item: "plates", cost: 5000, ticketIds: [t.id] }]]] });
    const lost = cash0 - box.app.game!.cash;
    const dish = content.dishes.find((d) => d.id === t.dishId)!;
    const unit = new Map(content.ingredients.map((i) => [i.id, i.unitCost]));
    const cost = Math.round(dish.ingredients.reduce((s, x) => s + (unit.get(x.id) ?? 0) * x.qty, 0));
    expect(lost).toBe(cost > 0 ? cost : 150);
    expect(host.status.dropCost).toBe(lost);
  });

  it("the budget counts results: one message can't carry more than the burst", () => {
    const { host, say } = rig(hostInService());
    say({ k: "hi", role: "server" });
    say({ k: "act", p: Array.from({ length: 20 }, (_, i) => [i + 1, Array.from({ length: 16 }, () => ({ type: "TABLE_CLEARED", tableId: "nope" }))]) });
    expect(host.ack).toBeLessThanOrEqual(RESULT_BURST / 16);
  });

  it("past tonight's cap the guest is benched: the team takes the role, nothing more of theirs is applied, the host is told", () => {
    const app = hostInService();
    const { box, host, say } = rig({ ...app, game: allAtPass(app.game!) });
    say({ k: "hi", role: "server" });
    host.pump();
    expect(box.roles.at(-1)).toBe("server"); // the guest serves: the sim backs off serving
    const ids = box.app.game!.tickets.map((t) => t.id);
    let q = 0;
    for (let i = 0; i < ids.length && !host.status.benched; i += 3) {
      box.now += 1300;
      say({ k: "act", p: [[++q, [{ type: "DROPPED", item: "plates", cost: 0, ticketIds: ids.slice(i, i + 3) }]]] });
      // fresh plates come up on the pass all evening
      host.setGame(allAtPass(box.app.game!));
      box.app = { ...box.app, game: allAtPass(box.app.game!) };
    }
    expect(host.status.benched).toBe(true);
    expect(host.status.dropCost).toBeLessThanOrEqual(host.status.dropCap);
    const cash = box.app.game!.cash;
    const applied = host.status.applied;
    box.now += 2000;
    say({ k: "act", p: [[++q, [{ type: "PAYMENT_TAKEN", customerId: box.app.game!.customers[0]!.id }]]] });
    expect(host.status.applied).toBe(applied);
    expect(box.app.game!.cash).toBe(cash);
    host.pump();
    expect(box.roles.at(-1)).toBe("chef"); // the sim's fallback serves (the host cooks)
  });

  it("a guest chef's drop is charged only for a ticket the host's game shows them holding, once", () => {
    const app = hostInService("server", 30);
    const { box, host, say } = rig(app, "server");
    const cash0 = box.app.game!.cash;
    say({ k: "hi", role: "chef" });
    say({ k: "act", p: [[1, [{ type: "DROPPED", item: "cooked", cost: 5000 }]]] });
    expect(box.app.game!.cash).toBe(cash0); // holding nothing
    const t = box.app.game!.tickets.find((x) => !x.chefId && !x.atPass && x.ticksRemaining > 0)!;
    box.now += 100;
    say({ k: "act", p: [[2, [{ type: "TICKET_CLAIMED", ticketId: t.id }]]] });
    box.now += 1500;
    say({ k: "act", p: [[3, [{ type: "DROPPED", item: "raw", cost: 5000 }]]] });
    const once = cash0 - box.app.game!.cash;
    expect(once).toBeGreaterThan(0);
    expect(once).toBeLessThan(5000);
    box.now += 1500;
    say({ k: "act", p: [[4, [{ type: "DROPPED", item: "raw", cost: 5000 }]]] });
    expect(cash0 - box.app.game!.cash).toBe(once);
  });

  it("vetResults: cap with a floor of £15, and the drop that would cross it is refused", () => {
    const g = allAtPass(hostInService().game!);
    const l = newLedger();
    const prof = () => ({ name: "x", short: "x", method: "none" as const, cost: 900, ceiling: 80 });
    let now = 0, capped = false, n = 0;
    for (const t of g.tickets) {
      now += 2000;
      const v = vetResults(g, [{ type: "DROPPED", item: "plates", cost: 1, ticketIds: [t.id] }], "server", l, prof, now);
      if (v.capped) { capped = true; break; }
      n++;
    }
    expect(capped).toBe(true);
    expect(n).toBe(Math.floor(DROP_CAP_MIN / 900));
    expect(l.cost).toBeLessThanOrEqual(DROP_CAP_MIN);
  });

  it("the sim itself re-fires only plates on the pass, and prices named plates from the dish", () => {
    const g = hostInService().game!;
    const cooking = g.tickets.find((t) => !t.atPass)!;
    const r = applyCommand(content, g, { type: "PLAYER_DROPPED", ticketIds: [cooking.id], cost: 5000 });
    expect(r.state.tickets.find((t) => t.id === cooking.id)).toEqual(cooking);
    expect(r.state.cash).toBe(g.cash);
  });
});

describe("G5: a guest chef's plate is held to the dish's ceiling", () => {
  it("quality 100 from the guest lands at no more than the dish can reach", () => {
    const app = hostInService("server", 30);
    const { box, say } = rig(app, "server");
    const t = box.app.game!.tickets.find((x) => !x.chefId && !x.atPass)!;
    const ceiling = content.dishes.find((d) => d.id === t.dishId)!.qualityCeiling;
    expect(ceiling).toBeLessThan(100);
    say({ k: "hi", role: "chef" });
    say({ k: "act", p: [[1, [{ type: "TICKET_CLAIMED", ticketId: t.id }, { type: "PLATE_COOKED", ticketId: t.id, quality: 100, execution: 1, station: "none", speedBonus: 1 }]]] });
    const after = box.app.game!;
    // the host serves, so the guest's plate waits on the pass with the quality the host's game gave it
    const at = after.tickets.find((x) => x.id === t.id)!;
    expect(at.atPass).toBe(true);
    expect(at.quality).toBeLessThanOrEqual(ceiling);
  });
});

describe("S14-3: the pin before the budget, one bucket per peer, the lobby names the partner", () => {
  it("a stranger's flood doesn't spend the guest's budget", () => {
    const { box, host, say } = rig(hostInService());
    say({ k: "hi" }, "G", "u_friend");
    let q = 0;
    for (let i = 0; i < 100; i++) {
      box.now += 10;
      for (let k = 0; k < 3; k++) say({ k: "beat" }, "Z", "u_mallory");
      if (i % 10 === 0) say({ k: "act", p: [[++q, [{ type: "TABLE_CLEARED", tableId: "nope" }]]] }, "G", "u_friend");
    }
    expect(host.ack).toBe(q);
  });

  it("when the lobby names the guest's account, a stranger who says hi first is never pinned", () => {
    const { host, say } = rig(hostInService());
    host.setPartner({ by: "u_friend", gen: "1" });
    say({ k: "hi" }, "Z", "u_mallory");
    say({ k: "hi" }, "G", "u_friend");
    expect(host.partnerPeer).toBe("G");
  });

  it("a wrong pin made before the lobby said who is dropped when it does", () => {
    const { host, say } = rig(hostInService());
    say({ k: "hi" }, "Z", "u_mallory");
    expect(host.partnerPeer).toBe("Z");
    host.setPartner({ by: "u_friend", gen: "1" });
    say({ k: "hi" }, "G", "u_friend");
    expect(host.partnerPeer).toBe("G");
  });

  it("with no account named, another sender takes the pin only after the old one goes quiet AND the lobby changes", () => {
    const { box, host, say } = rig(hostInService());
    host.setPartner({ by: null, gen: "join-1" });
    say({ k: "hi" }, "A", "u_a");
    box.now += 10_000;
    say({ k: "hi" }, "B", "u_b");
    expect(host.partnerPeer).toBe("A"); // quiet, but the lobby hasn't changed
    host.setPartner({ by: null, gen: "join-2" });
    say({ k: "hi" }, "B", "u_b");
    expect(host.partnerPeer).toBe("B");
  });

  it("guest side: a fake host can't feed the guest's screen once the lobby names the host", () => {
    const g = hostInService().game!;
    const nonce = "u".repeat(24);
    const guest = new LiveGuest({ emit: () => {}, now: () => 0 }, { nonce, role: "server" });
    guest.setMe("G");
    guest.setPartner({ by: "u_host", gen: "h1" });
    guest.hear(tagged("Z", nonce, encodeBase({ ...g, restaurantName: "Mallorys" }, "chef"), "u_mallory", TOPIC.st));
    expect(guest.base).toBeNull();
    const real = encodeBase(g, "chef");
    guest.hear(tagged("H", nonce, real, "u_host", TOPIC.st));
    guest.hear(tagged("H", nonce, encodeFloor(g, decodeBase(real)!, { seq: 1, t: 1, ack: 0, rtt: null, guestOn: true }), "u_host", TOPIC.st));
    expect(guest.base?.name).not.toBe("Mallorys");
    expect(guest.floor).not.toBeNull();
  });
});

describe("G3: a reloaded guest keeps their results", () => {
  it("the new page's first batch is applied (acks are per page session)", () => {
    const app = hostInService();
    const { box, host, say, nonce } = rig(app);
    const g = box.app.game!;
    say({ k: "hi", role: "server", sid: "pageone" }, "G1", "u_g");
    for (let q = 1; q <= 10; q++) say({ k: "act", sid: "pageone", p: [[q, [{ type: "TABLE_CLEARED", tableId: g.tables[0]!.id }]]] }, "G1", "u_g");
    box.now += 4000;
    const sent: unknown[] = [];
    const guest2 = new LiveGuest({ emit: (_t, d) => sent.push(d), now: () => 0 }, { nonce, role: "server" });
    guest2.setMe("G2");
    const c = g.customers.find((x) => x.stage !== "queue" && x.stage !== "left")!;
    guest2.send([{ type: "PAYMENT_TAKEN", customerId: c.id } as HandsOnResult]);
    const before = host.status.applied;
    host.hear({ peer: "G2", by: "u_g", isMe: false, sameTab: false, kind: "viewer", topic: TOPIC.in, data: sent.find((d) => (d as { k?: string }).k === "act") });
    expect(host.status.applied).toBe(before + 1);
  });

  it("a floor acknowledging another page's batches doesn't clear this page's", () => {
    const g = hostInService().game!;
    const nonce = "w".repeat(24);
    const guest = new LiveGuest({ emit: () => {}, now: () => 0 }, { nonce, role: "server", sid: "newpage" });
    guest.setMe("G");
    const bm = encodeBase(g, "chef");
    guest.hear(tagged("H", nonce, bm, "u_h", TOPIC.st));
    guest.send([{ type: "TABLE_CLEARED", tableId: g.tables[0]!.id }]);
    guest.hear(tagged("H", nonce, encodeFloor(g, decodeBase(bm)!, { seq: 1, t: 1, ack: 10, ackSid: "oldpage", rtt: null, guestOn: true }), "u_h", TOPIC.st));
    expect(guest.status.pending).toBe(1);
    guest.hear(tagged("H", nonce, encodeFloor(g, decodeBase(bm)!, { seq: 2, t: 1, ack: 1, ackSid: "newpage", rtt: null, guestOn: true }), "u_h", TOPIC.st));
    expect(guest.status.pending).toBe(0);
  });
});

describe("R13-N1: emotes are acknowledged and re-sent", () => {
  it("a lost emote arrives on a re-send, shows once, and the re-sends stop at the ack", () => {
    const room = new FakeRoom({ latencyMs: 0 });
    const nonce = "e".repeat(24);
    const host = new LiveHost({ emit: room.emitter("H"), now: () => room.now, apply: () => {}, setSimRole: () => {} }, { nonce, hostRole: "chef" });
    const guest = new LiveGuest({ emit: room.emitter("G"), now: () => room.now }, { nonce, role: "server" });
    let shown = 0;
    let dropNext = 0;
    room.join("H", "u_h", (m) => { if (m.topic === TOPIC.emo && dropNext > 0) { dropNext--; return; } host.hear(m); if (m.topic === TOPIC.emo && host.emote) shown = host.emote.n; });
    room.join("G", "u_g", (m) => guest.hear(m));
    host.setMe("H"); guest.setMe("G");
    host.setGame(hostInService().game!);
    for (let t = 50; t <= 2000; t += 50) { room.advance(t); host.pump(); guest.pump(); }
    expect(host.partnerPeer).toBe("G");
    dropNext = 1; // the first send is lost
    guest.sendEmote("wave");
    const n = guest.emote === null ? (guest as unknown as { emoOut: { n: number } }).emoOut.n : 0;
    for (let t = 2050; t <= 4000; t += 50) { room.advance(t); host.pump(); guest.pump(); }
    expect(host.emote?.id).toBe("wave");
    expect(shown).toBe(n);
    expect(guest.emotePending).toBe(false);
  });

  it("gives up after two retries when nobody answers", () => {
    let now = 0;
    const sent: unknown[] = [];
    const guest = new LiveGuest({ emit: (t, d) => { if (t === TOPIC.emo) sent.push(d); }, now: () => now }, { nonce: "f".repeat(24), role: "server" });
    guest.setMe("G");
    guest.sendEmote("clap");
    for (; now < 5000; now += 50) guest.pump();
    expect(sent).toHaveLength(3);
    expect(guest.emotePending).toBe(false);
  });
});

// ───────────────────────── after a live shift the save looks like a solo one ─────────────────────────

const STEP = 1 / 60;
/** One evening: the host's bot alone (solo) or with a guest bot over the fake room (live). */
function evening(live: boolean): AppState {
  const room = new FakeRoom({ latencyMs: 40 });
  const nonce = "s".repeat(24);
  let app = appReducer(ownerPlanning(), { type: "command", cmd: { type: "START_SERVICE" } });
  app = appReducer(app, { type: "handsOnStart", meta: { role: "chef", jumpIn: true } });
  const act = (a: AppAction) => { app = appReducer(app, a); host?.setGame(app.game!); };
  const host: LiveHost | null = live ? new LiveHost({ emit: room.emitter("H"), now: () => room.now, apply: (results) => act({ type: "handsOnResults", results }), setSimRole: (role) => act({ type: "command", cmd: { type: "SET_HANDS_ON", role } }) }, { nonce, hostRole: "chef" }) : null;
  const guest = live ? new LiveGuest({ emit: room.emitter("G"), now: () => room.now }, { nonce, role: "server" }) : null;
  if (host && guest) { room.join("H", "u_h", (m) => host.hear(m)); room.join("G", "u_g", (m) => guest.hear(m)); host.setMe("H"); guest.setMe("G"); host.setGame(app.game!); }
  let hs = createSession(app.game!, "chef", { content, tutorial: false });
  let gs: HandsOnSession | null = null;
  let t = 0, tickAcc = 0, pumpAcc = 0;
  while (app.game!.phase === "service" && t < 400) {
    t += STEP; tickAcc += STEP; pumpAcc += STEP;
    room.advance(Math.round(t * 1000));
    const r = updateSession(hs, app.game!, botInput(hs, app.game!, 0.6, 1), STEP);
    hs = r.session;
    if (r.results.length) act({ type: "handsOnResults", results: r.results });
    if (guest?.view) {
      gs ??= createSession(guest.view, "server", { content, tutorial: false });
      const g = updateSession(gs, guest.view, botInput(gs, guest.view, 0.6, 1), STEP);
      gs = g.session;
      if (g.results.length) guest.send(g.results);
    }
    if (pumpAcc >= 0.05) { pumpAcc = 0; host?.pump(); guest?.pump(); }
    if (tickAcc >= HANDS_ON_SECONDS_PER_TICK) { tickAcc -= HANDS_ON_SECONDS_PER_TICK; act({ type: "ticks", n: 1 }); }
  }
  host?.end("done");
  return appReducer(app, { type: "handsOnStop" });
}
/** Every key path in a JSON value (array items merged), so two saves can be compared by shape, not by numbers. */
function shape(v: unknown, path = "", out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) { for (const x of v) shape(x, `${path}[]`, out); return out; }
  if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) { out.add(`${path}.${k}`); shape(x, `${path}.${k}`, out); } return out; }
  out.add(`${path}:${v === null ? "null" : typeof v}`);
  return out;
}

describe("after a live shift the host's save has the shape of a solo one", () => {
  it("the same top-level fields and no field a solo save never has", () => {
    const solo = evening(false), live = evening(true);
    expect(solo.game!.phase).not.toBe("service");
    expect(live.game!.phase).not.toBe("service");
    const a = JSON.parse(encodeSave(solo.game!, solo.meta)) as Record<string, unknown>;
    const b = JSON.parse(encodeSave(live.game!, live.meta)) as Record<string, unknown>;
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    const sa = shape(decodeSave(JSON.stringify(a))), sb = shape(decodeSave(JSON.stringify(b)));
    // no path in the live save that a solo save of the same day can't have (ignore leaf types of optional numbers)
    const keys = (s: Set<string>) => new Set([...s].filter((x) => !x.includes(":")));
    const extra = [...keys(sb)].filter((k) => !keys(sa).has(k) && !/\.(chefs|perChef|dishes)\./.test(k));
    expect(extra).toEqual([]);
    expect(decodeSave(JSON.stringify(b))).toBeTruthy();
  }, 120_000);
});
