import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { GameState } from "@full-plate/sim-core";
import { loadGame, saveGame, SAVE_KEY, useAutosave } from "../state/save";
import { appReducer, initialAppState } from "../state/gameReducer";
import { content } from "../sim";

function memoryStorage() {
  const m = new Map<string, string>();
  const writes: string[] = [];
  return {
    writes,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { writes.push(k); m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

const fresh = () => appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 7, districtId: content.districts[0]!.id, restaurantName: "Saver", difficulty: "cosy" } });

describe("save / load", () => {
  it("round-trips through serialize/deserialize", () => {
    const st = memoryStorage();
    const g = fresh().game!;
    expect(saveGame(g, st)).toBe(true);
    expect(loadGame(st)).toEqual(g);
  });

  it("treats corrupt or finished saves as no save", () => {
    const st = memoryStorage();
    st.setItem(SAVE_KEY, "{not json");
    expect(loadGame(st)).toBeNull();
    const over = { ...fresh().game!, phase: "gameover" } as GameState;
    saveGame(over, st);
    expect(st.getItem(SAVE_KEY)).toBeNull();
  });
});

describe("useAutosave", () => {
  it("writes on phase change, not on every tick", () => {
    const st = memoryStorage();
    let s = fresh();
    const { rerender } = renderHook(({ g }) => useAutosave(g, st), { initialProps: { g: s.game } });
    expect(st.writes).toHaveLength(1); // planning, day 0

    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    rerender({ g: s.game });
    expect(st.writes).toHaveLength(2); // service

    for (let i = 0; i < 10; i++) {
      s = appReducer(s, { type: "ticks", n: 1 });
      rerender({ g: s.game });
    }
    expect(st.writes).toHaveLength(2); // ticks don't save

    s = appReducer(s, { type: "ticks", n: 500 });
    rerender({ g: s.game });
    expect(st.writes).toHaveLength(3); // evening
    expect(loadGame(st)?.phase).toBe("evening");
  });
});
