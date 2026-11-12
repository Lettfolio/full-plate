/**
 * Round 13 (F): the live shift's screens — the host's panel offers it only when both pages can reach the `room`
 * capability, arming it writes the lobby record to the host's db document, and the guest's screen joins (or, with no
 * room, stays on the Round 12 turn-based day with one line saying why).
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { GameState } from "@full-plate/sim-core";
import { applyCommand, content, newGame } from "../sim";
import { gameKey, newCode, setLinkForTests } from "../state/share";
import { RuleDb } from "./ruleDb";
import { setHostFlag } from "../lib/coop/hostFlag";
import { pendingWriter } from "../lib/coop/hand";
import { guestDoc, guestPath, hostDoc, hostPath, type HostDoc } from "../lib/coop/protocol";
import { DocWriter } from "../lib/coop/session";
import { setRoomForTests, type NamedRoomLike, type RoomNs } from "../lib/coop/room";
import { CoopShiftDock } from "../screens/CoopShiftDock";
import { CoopShiftGuest } from "../screens/CoopShiftGuest";

afterEach(() => { cleanup(); setLinkForTests(null); setRoomForTests(null); setHostFlag(null); localStorage.clear(); pendingWriter.clear(); });

const stubRoom = (): RoomNs => ({
  join: async (name: string): Promise<NamedRoomLike> => ({
    name,
    emit: async () => {}, on: () => () => {}, presence: async () => {},
    peers: () => [{ peer: "me", by: null, isMe: true, sameTab: true, kind: "viewer", presence: {}, updatedAt: 0 }],
    onPeers: () => () => {}, connected: () => true, onConnection: () => () => {}, leave: async () => {},
  }),
});

function planningGame(): GameState {
  let g = newGame(content, { type: "NEW_GAME", seed: 77, districtId: content.districts[0]!.id, restaurantName: "Chez Live", difficulty: "normal" });
  for (const d of content.dishes.filter((x) => !x.id.startsWith("ff_") && !x.id.startsWith("fd_")).slice(0, 3)) g = applyCommand(content, g, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice }).state;
  return g;
}
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

async function hostWithGuest(rt: boolean, room: boolean) {
  const db = RuleDb.create("u_host");
  const game = planningGame();
  const code = newCode("u_host");
  setLinkForTests(async () => ({ db, uid: "u_host" }));
  setRoomForTests(async () => (room ? stubRoom() : null));
  // R14 (B): each side's document under its own id; the guest already pinned into the host's document
  const writer = new DocWriter<HostDoc>(db, hostPath("u_host", code), hostDoc({ nick: "Ali", createdAt: Date.now(), guest: "u_guest" }));
  await writer.patch({});
  pendingWriter.set(code, writer);
  await db.as("u_guest").doc(guestPath("u_guest", code)).set({ ...guestDoc({ nick: "Sam", joinedAt: Date.now() }), ...(rt ? { rt: true } : {}) } as unknown as Record<string, unknown>);
  setHostFlag({ code, nick: "Ali", expiresAt: Date.now() + 3_600_000, game: gameKey(game) });
  const live = { handsOn: null, jumpIn: () => {}, sendResults: () => {} };
  render(<CoopShiftDock game={game} send={() => {}} live={live} />);
  await flush();
  return { db, code, writer };
}

describe("the host's panel", () => {
  it("offers a live service when both pages can reach the room; arming writes the lobby record", async () => {
    const { db, code } = await hostWithGuest(true, true);
    expect(screen.getByText(/Play tonight's service live/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /I serve, Sam cooks/ }));
    fireEvent.click(screen.getByRole("button", { name: "Go live tonight" }));
    await flush();
    const live = (db.docs.get(hostPath("u_host", code)) as { live?: { state: string; guestRole: string; nonce: string } }).live!;
    expect(live.state).toBe("ready");
    expect(live.guestRole).toBe("chef");
    expect(live.nonce).toMatch(/^[a-z0-9]{24}$/);
    expect(screen.getByText(/Live tonight\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not live tonight" }));
    await flush();
    expect((db.docs.get(hostPath("u_host", code)) as { live?: { state: string } }).live!.state).toBe("ended");
  });
  it("without the room on the host's page there is no offer: the Round 12 day as it was", async () => {
    await hostWithGuest(true, false);
    expect(screen.queryByText(/Play tonight's service live/)).toBeNull();
    expect(screen.getByText(/Sam is planning tonight/)).toBeTruthy();
  });
  it("when the guest's page can't, it says so in one line", async () => {
    await hostWithGuest(false, true);
    expect(screen.queryByRole("button", { name: "Go live tonight" })).toBeNull();
    expect(screen.getByText(/Sam's page can't do live play/)).toBeTruthy();
  });
});

describe("the guest's screen", () => {
  async function guest(room: boolean) {
    const db = RuleDb.create("u_guest");
    const code = newCode("u_host");
    setRoomForTests(async () => (room ? stubRoom() : null));
    const game = planningGame();
    const first = hostDoc({ nick: "Ali", createdAt: Date.now(), board: { day: game.day, restaurant: "Chez Live", menu: game.menu.map((m) => ({ dishId: m.dishId, price: m.price, active: m.active })), staff: [] }, live: { nonce: "n".repeat(24), guestRole: "server", state: "ready", day: game.day, at: 1 } });
    await db.as("u_host").doc(hostPath("u_host", code)).set(first as unknown as Record<string, unknown>);
    const writer = new DocWriter(db, guestPath("u_guest", code), guestDoc({ nick: "Sam", joinedAt: Date.now() }));
    render(<CoopShiftGuest db={db} uid="u_guest" hostId="u_host" code={code} first={first} writer={writer} onExit={() => {}} />);
    await flush();
    return { db, code };
  }
  it("joins the live shift the host armed (and says its page can do live play)", async () => {
    const { db, code } = await guest(true);
    expect(await screen.findByText(/Live tonight: you.re serving/, undefined, { timeout: 8000 })).toBeTruthy();
    expect((db.docs.get(guestPath("u_guest", code)) as { rt?: boolean }).rt).toBe(true);
    // the turn-based day is one tap away
    fireEvent.click(screen.getByRole("button", { name: /Play the turn-based day instead/ }));
    await flush();
    expect(screen.queryByText(/Live tonight: you're serving/)).toBeNull();
    expect(screen.getByRole("button", { name: /Send plan to Ali/ })).toBeTruthy();
  });
  it("with no room, stays on the turn-based day with one line", async () => {
    await guest(false);
    expect(screen.queryByText(/Live tonight: you're serving/)).toBeNull();
    expect(screen.getByText(/this page can't join live play/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Send plan to Ali/ })).toBeTruthy();
  });
});
