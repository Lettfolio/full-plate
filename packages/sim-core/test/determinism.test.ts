import { describe, expect, it } from "vitest";
import { deserialize, runDay, serialize, tick } from "../src/index";
import { MIGRATIONS } from "../src/save";
import type { Command, GameState } from "../src/types";
import { C, playDays, ready, step } from "./helpers";

const script: Command[] = [
  { type: "ORDER_STOCK", ingredientId: "beef", qty: 50 },
  { type: "SET_MENU_ITEM", dishId: "steak", price: 2800 },
  { type: "BUY_TABLE" },
];

function play(seed: number): GameState {
  return playDays(step(ready(seed), ...script), 20);
}

describe("determinism", () => {
  it("same seed + commands ⇒ byte-identical serialized state", () => {
    expect(serialize(play(5))).toBe(serialize(play(5)));
  });

  it("different seeds diverge", () => {
    expect(serialize(play(5))).not.toBe(serialize(play(6)));
  });

  it("never mutates the input state", () => {
    const s = ready(3);
    const before = serialize(s);
    runDay(C, s);
    expect(serialize(s)).toBe(before);
  });
});

describe("serialize", () => {
  it("round-trips mid-service and continues identically", () => {
    let s = step(ready(8), { type: "START_SERVICE" });
    for (let i = 0; i < 50; i++) s = runTick(s);
    const restored = deserialize(serialize(s));
    expect(serialize(restored)).toBe(serialize(s));
    expect(serialize(runDay(C, restored).state)).toBe(serialize(runDay(C, s).state));
  });

  it("round-trips after a long game", () => {
    const s = playDays(ready(2), 40);
    expect(deserialize(serialize(s))).toEqual(JSON.parse(serialize(s)));
  });

  it("rejects newer versions and bad saves; version 1 migration is identity", () => {
    const s = ready(1);
    expect(() => deserialize(serialize({ ...s, version: 2 as 1 }))).toThrow(/newer/);
    expect(() => deserialize(JSON.stringify({ ...s, rngState: [1] }))).toThrow(/RNG/);
    expect(() => deserialize("null")).toThrow();
    const raw = { a: 1 };
    expect(MIGRATIONS[1]!(raw)).toBe(raw);
    const { version: _v, ...noVersion } = JSON.parse(serialize(s));
    expect(deserialize(JSON.stringify(noVersion)).version).toBe(1);
  });
});

const runTick = (s: GameState) => tick(C, s).state;

describe("purity", () => {
  it("never calls Math.random or Date", () => {
    const random = Math.random;
    const now = Date.now;
    Math.random = () => {
      throw new Error("Math.random used");
    };
    Date.now = () => {
      throw new Error("Date.now used");
    };
    try {
      expect(() => playDays(ready(9), 5)).not.toThrow();
    } finally {
      Math.random = random;
      Date.now = now;
    }
  });
});
