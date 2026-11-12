/**
 * Round 14 review: where builders A and B meet. B's lobby gives each partner's platform id from the PATH of their
 * document (rules make it trustworthy); A's live engines pin only the account `setPartner` names. These tests run the
 * two together — B's session over the rule-enforcing db, its ids fed into A's LiveHost/LiveGuest exactly as
 * CoopShiftDock / CoopShiftGuest now do — and prove a third account holding the code cannot take the pin while the
 * admitted guest is present (S14-3 in live use, not only with hand-set ids).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { appReducer, type AppState } from "../state/gameReducer";
import { decodeSave } from "../state/save";
import { content } from "../sim";
import { known } from "../lib/visit";
import { guestJoin, hostStart, watchGuest, watchHost } from "../lib/coop/session";
import { decodeBase, encodeBase, encodeFloor, LiveGuest, LiveHost, tagOf, TOPIC, type RoomMsg } from "../lib/coop/realtime";
import { loadedApp } from "./fixtures/corpus/playDay";
import { RuleDb } from "./ruleDb";

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
const DIR = join(__dirname, "fixtures/corpus");
function hostInService(): AppState {
  const raw = gunzipSync(readFileSync(join(DIR, "r11-owner-staffed-normal-d40.json.gz"))).toString("utf8");
  let s = loadedApp(decodeSave(raw));
  for (let i = 0; i < 6 && s.game!.phase !== "planning"; i++) {
    s = s.game!.phase === "service" ? appReducer(s, { type: "skipShift" }) : s.game!.phase === "event"
      ? appReducer(s, { type: "command", cmd: { type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === s.game!.activeEvent?.eventId)!.choices[0]!.id } })
      : appReducer(s, { type: "nextDay" });
  }
  s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
  s = appReducer(s, { type: "handsOnStart", meta: { role: "chef", jumpIn: true } });
  for (let i = 0; i < 40; i++) s = appReducer(s, { type: "ticks", n: 1 });
  return s;
}
const tagged = (peer: string, nonce: string, data: Record<string, unknown>, by: string | null, topic: string = TOPIC.in): RoomMsg =>
  ({ peer, by, isMe: false, sameTab: false, kind: "viewer", topic, data: { s: tagOf(nonce, peer), ...data } });

describe("S14-3 wired: B's path-derived ids are A's pin", () => {
  it("host: a third account with the code can't take the pin while the admitted guest is present", async () => {
    const db = RuleDb.create("u_alice");
    const alice = { db, uid: "u_alice" };
    const { code, writer } = await hostStart(alice, "Alice", Date.now());
    const bob = await guestJoin({ db: db.as("u_bob"), uid: "u_bob" }, code, "Bob", known.dish);
    expect(bob.ok).toBe(true);
    // what CoopShiftDock does: the partner id from watchGuest's second argument goes to HostLive's guestId
    let guestId: string | null = null, gen = "";
    const stop = watchGuest(alice, writer, code, known.dish, (g, id) => { if (id) guestId = id; gen = String(g?.joinedAt ?? 0); });
    await settle();
    expect(guestId).toBe("u_bob");
    // Mallory has the code too: joining says taken, her own documents are never read
    const m = { db: db.as("u_mallory"), uid: "u_mallory" };
    expect(await guestJoin(m, code, "Bob", known.dish)).toEqual({ ok: false, why: "taken" });

    const box = { app: hostInService(), now: 1000 };
    const cash0 = box.app.game!.cash;
    const nonce = "w".repeat(24);
    const host: LiveHost = new LiveHost({
      emit: () => {}, now: () => box.now, setSimRole: () => {},
      apply: (results) => { box.app = appReducer(box.app, { type: "handsOnResults", results }); host.setGame(box.app.game!); },
    }, { nonce, hostRole: "chef" });
    host.setMe("H");
    host.setGame(box.app.game!);
    host.setPartner({ by: guestId, gen });
    // Mallory speaks first and often; Bob is present and talking
    for (let i = 0; i < 30; i++) {
      box.now += 50;
      host.hear(tagged("M", nonce, { k: "hi" }, "u_mallory"));
      host.hear(tagged("M", nonce, { k: "act", p: [[i + 1, [{ type: "TABLE_CLEARED", tableId: "t1" }]]] }, "u_mallory"));
      if (i % 5 === 0) host.hear(tagged("B", nonce, { k: "hi" }, "u_bob"));
    }
    expect(host.partnerPeer).toBe("B");
    expect(host.ack).toBe(0); // nothing of Mallory's was applied
    // Bob goes quiet for a long time: the lobby still names him, so Mallory still can't take over
    box.now += 120_000;
    host.hear(tagged("M", nonce, { k: "hi" }, "u_mallory"));
    expect(host.partnerPeer).toBe("B");
    expect(box.app.game!.cash).toBe(cash0);
    stop();
  });

  it("guest: a fake host page (another account) can't feed the guest's screen; the id is the code's owner", async () => {
    const db = RuleDb.create("u_alice");
    const { code } = await hostStart({ db, uid: "u_alice" }, "Alice", Date.now());
    const bob = await guestJoin({ db: db.as("u_bob"), uid: "u_bob" }, code, "Bob", known.dish);
    if (!bob.ok) throw new Error("Bob couldn't join");
    let createdAt = 0;
    const stop = watchHost(db.as("u_bob"), bob.hostId, code, known.dish, (h) => { if (h) createdAt = h.createdAt; }, undefined, "u_bob");
    await settle(); stop();
    // what CoopShiftGuest does: hostId (from the path the code led to) and the host document's createdAt
    const g = hostInService().game!;
    const nonce = "v".repeat(24);
    const guest = new LiveGuest({ emit: () => {}, now: () => 0 }, { nonce, role: "server" });
    guest.setMe("B");
    guest.setPartner({ by: bob.hostId, gen: String(createdAt) });
    expect(bob.hostId).toBe("u_alice");
    guest.hear(tagged("M", nonce, encodeBase({ ...g, restaurantName: "Mallorys" }, "chef"), "u_mallory", TOPIC.st));
    expect(guest.base).toBeNull();
    const real = encodeBase(g, "chef");
    guest.hear(tagged("H", nonce, real, "u_alice", TOPIC.st));
    guest.hear(tagged("H", nonce, encodeFloor(g, decodeBase(real)!, { seq: 1, t: 1, ack: 0, rtt: null, guestOn: true }), "u_alice", TOPIC.st));
    expect(guest.base?.name).toBe(g.restaurantName);
  });

  it("the screens pass the ids (no null placeholders left)", () => {
    const dock = readFileSync(join(__dirname, "../screens/CoopShiftDock.tsx"), "utf8");
    const gst = readFileSync(join(__dirname, "../screens/CoopShiftGuest.tsx"), "utf8");
    expect(dock).toMatch(/guestId=\{guestId\}/);
    expect(dock).toMatch(/watchGuest\([^)]*\(g, partnerId\)/);
    expect(gst).toMatch(/hostId=\{hostId\}/);
    expect(dock + gst).not.toMatch(/(guestId|hostId)=\{null\}/);
  });
});
