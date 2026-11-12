/**
 * Round 14 (A): the turn-based co-op day's panel — U6 (a friend who closed the tab is noticed; on a phone the panel
 * starts folded) and S14-5 ("Use it" shows every change, big price moves first and flagged, and applies only what was
 * on screen). Layout (what covers what at 390×844 and 844×390) is checked in the built dist by
 * scripts/playtest-coop-r14.mjs with elementFromPoint; jsdom has no layout.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Command, GameState } from "@full-plate/sim-core";
import { applyCommand, content, newGame } from "../sim";
import { gameKey, newCode, setLinkForTests } from "../state/share";
import { RuleDb } from "./ruleDb";
import { getHostFlag, setHostFlag } from "../lib/coop/hostFlag";
import { pendingWriter } from "../lib/coop/hand";
import { guestDoc, guestPath, hostDoc, hostPath, planCommands, type HostDoc } from "../lib/coop/protocol";
import { DocWriter } from "../lib/coop/session";
import { setRoomForTests } from "../lib/coop/room";
import { CoopShiftDock, GONE_MS, PLAN_FOLD, shownChanges } from "../screens/CoopShiftDock";
import { weekdayIndex } from "../lib/calendar";

const realMatch = window.matchMedia;
afterEach(() => {
  cleanup(); setLinkForTests(null); setRoomForTests(null); setHostFlag(null); localStorage.clear(); pendingWriter.clear();
  vi.useRealTimers();
  window.matchMedia = realMatch;
});

// Round 14 review: B's rule-enforcing store (each side writes only its own document under its own id), not A's flat MemDb
const HOST = "u_host", GUEST = "u_bob";
function planningGame(dishes = 3): GameState {
  let g = newGame(content, { type: "NEW_GAME", seed: 77, districtId: content.districts[0]!.id, restaurantName: "Chez Live", difficulty: "normal" });
  for (const d of content.dishes.filter((x) => !x.id.startsWith("ff_") && !x.id.startsWith("fd_")).slice(0, dishes)) g = applyCommand(content, g, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice }).state;
  return g;
}
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const phone = (on: boolean) => {
  window.matchMedia = ((q: string) => ({ matches: on, media: q, onchange: null, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
};

async function host(opts: { game?: GameState; plan?: (g: GameState) => unknown; send?: (c: Command) => void } = {}) {
  const db = RuleDb.create(HOST);
  const bob = db.as(GUEST);
  const game = opts.game ?? planningGame();
  const code = newCode(HOST);
  setLinkForTests(async () => ({ db, uid: HOST }));
  setRoomForTests(async () => null);
  const writer = new DocWriter<HostDoc>(db, hostPath(HOST, code), hostDoc({ nick: "Ali", createdAt: Date.now(), guest: GUEST }));
  await writer.patch({});
  pendingWriter.set(code, writer);
  await bob.doc(guestPath(GUEST, code)).set({ ...guestDoc({ nick: "Bob", joinedAt: Date.now() }), ...(opts.plan ? { plan: opts.plan(game) } : {}) } as unknown as Record<string, unknown>);
  setHostFlag({ code, nick: "Ali", expiresAt: Date.now() + 3_600_000, game: gameKey(game) });
  render(<CoopShiftDock game={game} send={opts.send ?? (() => {})} />);
  await flush();
  return { db: bob, code, writer, game };
}

describe("U6: on a phone the panel starts folded", () => {
  it("folded on a phone, open on a laptop", async () => {
    phone(true);
    await host();
    expect(screen.getByRole("button", { name: /Co-op · Bob/ })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Co-op day" })).toBeNull();
    cleanup(); setHostFlag(null); pendingWriter.clear();
    phone(false);
    await host();
    expect(screen.getByRole("complementary", { name: "Co-op day" })).toBeTruthy();
  });
});

describe("U6: a friend who closed the tab is noticed", () => {
  it("no answer for 45 s: 'Bob seems to have gone' with Keep waiting / End co-op; an answer clears it", async () => {
    phone(false);
    vi.useFakeTimers({ toFake: ["setInterval", "Date"] });
    const { db, code, writer } = await host();
    // the friend's page is gone: nobody answers the pings
    await act(async () => { vi.advanceTimersByTime(GONE_MS + 16_000); });
    await flush();
    expect(screen.getByText(/seems to have gone/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep waiting" }));
    await flush();
    expect(screen.queryByText(/seems to have gone/)).toBeNull();
    await act(async () => { vi.advanceTimersByTime(GONE_MS + 6_000); });
    await flush();
    expect(screen.getByText(/seems to have gone/)).toBeTruthy();
    // they come back and answer
    const g = db.docs.get(guestPath(GUEST, code))!;
    await db.doc(guestPath(GUEST, code)).set({ ...g, pong: { n: writer.current.ping!.n } });
    await flush();
    expect(screen.queryByText(/seems to have gone/)).toBeNull();
    // and End co-op ends it
    await act(async () => { vi.advanceTimersByTime(GONE_MS + 16_000); });
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "End co-op" }));
    await flush();
    expect(getHostFlag()).toBeNull();
  });

  it("a friend who keeps answering is never called gone", async () => {
    phone(false);
    vi.useFakeTimers({ toFake: ["setInterval", "Date"] });
    const { db, code, writer } = await host();
    for (let i = 0; i < 12; i++) {
      await act(async () => { vi.advanceTimersByTime(5_000); });
      await flush();
      const g = db.docs.get(guestPath(GUEST, code))!;
      if (writer.current.ping) await db.doc(guestPath(GUEST, code)).set({ ...g, pong: { n: writer.current.ping.n } });
      await flush();
    }
    expect(screen.queryByText(/seems to have gone/)).toBeNull();
  });
});

describe("S14-5: 'Use it' shows every change and applies only what was shown", () => {
  const bigPlan = (g: GameState) => ({
    n: 1, day: g.day, on: [],
    menu: g.menu.map((m, i) => ({ dishId: m.dishId, active: !m.active, price: i === 4 ? m.price * 3 : i === 1 ? Math.round(m.price * 0.9) : m.price + 100 })),
  });

  it("folds to eight, biggest price move first, flags moves over 30 %, and 'Use these 8' sends only those eight", async () => {
    phone(false);
    const sent: Command[] = [];
    const { game } = await host({ game: planningGame(6), plan: bigPlan, send: (c) => sent.push(c) });
    const all = planCommands(game, bigPlan(game) as never, weekdayIndex(game.day), (id) => id);
    expect(all.length).toBeGreaterThan(PLAN_FOLD);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(PLAN_FOLD);
    expect(items[0]!.textContent).toMatch(/\+200%, a big change/);
    expect(screen.getAllByText(/a big change/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: `Use these ${PLAN_FOLD}` }));
    expect(sent).toHaveLength(PLAN_FOLD);
    const shown = shownChanges(game, all).slice(0, PLAN_FOLD).map((c) => JSON.stringify(c.cmd));
    expect(sent.map((c) => JSON.stringify(c))).toEqual(shown);
  });

  it("'Show all' lists every change and 'Use it' then sends all of them", async () => {
    phone(false);
    const sent: Command[] = [];
    const { game } = await host({ game: planningGame(6), plan: bigPlan, send: (c) => sent.push(c) });
    const all = planCommands(game, bigPlan(game) as never, weekdayIndex(game.day), (id) => id);
    fireEvent.click(screen.getByRole("button", { name: `Show all ${all.length} changes` }));
    expect(screen.getAllByRole("listitem")).toHaveLength(all.length);
    fireEvent.click(screen.getByRole("button", { name: "Use it" }));
    expect(sent).toHaveLength(all.length);
  });
});

describe("R13-N2: the live guest reads the how-to in the lobby, not on the host's clock", () => {
  it("the lobby offers the steps before the doors open", async () => {
    phone(false);
    const { CoopShiftGuest } = await import("../screens/CoopShiftGuest");
    const hostDb = RuleDb.create(HOST);
    const db = hostDb.as("u_sam");
    const code = newCode(HOST);
    setRoomForTests(async () => ({
      join: async (name: string) => ({
        name, emit: async () => {}, on: () => () => {}, presence: async () => {},
        peers: () => [{ peer: "me", by: null, isMe: true, sameTab: true, kind: "viewer" as const, presence: {}, updatedAt: 0 }],
        onPeers: () => () => {}, connected: () => true, onConnection: () => () => {}, leave: async () => {},
      }),
    }));
    const game = planningGame();
    const first = hostDoc({ nick: "Ali", createdAt: Date.now(), board: { day: game.day, restaurant: "Chez Live", menu: game.menu.map((m) => ({ dishId: m.dishId, price: m.price, active: m.active })), staff: [] }, live: { nonce: "n".repeat(24), guestRole: "server", state: "ready", day: game.day, at: 1 } });
    await hostDb.doc(hostPath(HOST, code)).set(first as unknown as Record<string, unknown>);
    const writer = new DocWriter(db, guestPath("u_sam", code), guestDoc({ nick: "Sam", joinedAt: Date.now() }));
    render(<CoopShiftGuest db={db} uid="u_sam" hostId={HOST} code={code} first={first} writer={writer} onExit={() => {}} />);
    await flush();
    expect(await screen.findByText("How the shift works", undefined, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText(/Pick up the food/)).toBeTruthy();
  });
});
