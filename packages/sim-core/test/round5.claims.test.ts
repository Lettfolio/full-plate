/** Round 5: a hands-on claim never cooks a ticket twice (PLAYER_CLAIMED / PLAYER_COOKED of a ticket an AI cook has). */
import { describe, expect, it } from "vitest";
import { applyCommand } from "../src/index";
import type { Command, GameState, KitchenTicket } from "../src/types";
import { C, customer, inService, ready } from "./helpers";

const apply = (s: GameState, cmd: Command) => applyCommand(C, s, cmd);
const ticket = (id: string, over: Partial<KitchenTicket> = {}): KitchenTicket => ({ id, customerId: "c1", dishId: "burger", createdTick: 10, ticksRemaining: 3, quality: 0, ...over });

function state(chefId?: string): GameState {
  const s0 = inService(ready());
  const c = customer("c1", { stage: "ordered", tableId: "T1", order: ["burger"], spend: 1450, stageTick: 8 });
  const s = { ...s0, customers: [c], tickets: [ticket("k1", chefId ? { chefId } : {})] };
  return apply(s, { type: "SET_HANDS_ON", role: "chef" }).state;
}
const aiChef = (s: GameState) => s.staff.find((x) => x.role === "chef")!.id;

describe("never cooking a ticket twice (round 5)", () => {
  it("PLAYER_CLAIMED / PLAYER_COOKED of a ticket an AI cook has is refused with one LOG line, state unchanged", () => {
    const s0 = state();
    const s = { ...s0, tickets: s0.tickets.map((t) => ({ ...t, chefId: aiChef(s0) })) };
    for (const cmd of [{ type: "PLAYER_CLAIMED", ticketId: "k1" }, { type: "PLAYER_COOKED", ticketId: "k1", quality: 80 }] as const) {
      const r = apply(s, cmd);
      expect(r.events).toEqual([expect.objectContaining({ type: "LOG", entry: expect.objectContaining({ kind: "bad", text: "Another chef is already cooking that one." }) })]);
      const { log: _a, ...after } = r.state;
      const { log: _b, ...before } = s;
      expect(after).toEqual(before);
    }
  });

  it("an unassigned ticket is still the human's to claim and cook; their own claim is a no-op", () => {
    let s = apply(state(), { type: "PLAYER_CLAIMED", ticketId: "k1" }).state;
    expect(s.tickets[0]).toMatchObject({ chefId: "player", claimedAtTick: s.tick });
    expect(apply(s, { type: "PLAYER_CLAIMED", ticketId: "k1" }).events).toEqual([]);
    s = apply(s, { type: "PLAYER_COOKED", ticketId: "k1", quality: 70 }).state;
    expect(s.tickets).toEqual([]);
    expect(s.service!.chefs!.player).toEqual({ plates: 1, qualitySum: 70 });
  });
});
