/**
 * Purity under real play (review round 2): every state handed to the sim is deep-frozen first, so any
 * system that writes into its input (a mutated tally map, a pushed array, a patched staff row) throws.
 * Covers incidents (every option kind is answered by the headless policy), breaks, training and goals.
 */
import { describe, expect, it } from "vitest";
import { content } from "../../content/src/index";
import { applyCommand, newGame, serialize, suggestedOrder, tick } from "../src/index";
import { respondToIncidents } from "../src/headless";
import type { Command, GameState } from "../src/types";

function deepFreeze<T>(x: T): T {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
  }
  return x;
}

const cmd = (s: GameState, c: Command): GameState => applyCommand(content, deepFreeze(s), c).state;

describe("purity with deep-frozen inputs (real content)", () => {
  it("plays 10 days with incidents, breaks and training without writing into any input state", () => {
    let s = newGame(content, { type: "NEW_GAME", seed: 11, districtId: content.districts[0]!.id, restaurantName: "Ice", difficulty: "normal" });
    const mains = content.dishes.filter((d) => d.course === "main").slice(0, 3);
    const rest = ["starter", "dessert", "drink"].map((c) => content.dishes.find((d) => d.course === c)!);
    for (const d of [...mains, ...rest]) s = cmd(s, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice });
    s = cmd(s, { type: "HIRE", candidateIndex: 0 });
    s = cmd(s, { type: "HIRE", candidateIndex: 1 });
    let incidents = 0;
    for (let day = 0; day < 10 && s.phase !== "gameover"; day++) {
      if (day === 3 && s.staff[0]) s = cmd(s, { type: "TRAIN", staffId: s.staff[0].id });
      s = cmd(s, { type: "START_SERVICE" });
      while (s.phase === "service") {
        if ((s.incidents ?? []).some((i) => !i.resolution)) {
          incidents++;
          s = respondToIncidents(content, deepFreeze(s));
        }
        if (s.tick === 40 && s.staff[1]) s = cmd(s, { type: "GIVE_BREAK", staffId: s.staff[1].id });
        const before = serialize(s);
        const r = tick(content, deepFreeze(s));
        expect(serialize(s)).toBe(before);
        s = r.state;
      }
      if (s.phase !== "gameover") for (const l of suggestedOrder(content, deepFreeze(s))) s = cmd(s, { type: "ORDER_STOCK", ingredientId: l.ingredientId, qty: l.qty });
      s = s.phase === "event" ? cmd(s, { type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === s.activeEvent?.eventId)?.choices[0]?.id ?? "" }) : cmd(s, { type: "END_DAY" });
    }
    expect(s.day).toBeGreaterThanOrEqual(9);
    expect(incidents).toBeGreaterThan(3);
  }, 60_000);
});
