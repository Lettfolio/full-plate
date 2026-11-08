import { describe, expect, it } from "vitest";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { content, SERVICE_TICKS } from "../sim";

const NEW = { type: "NEW_GAME", seed: 4242, districtId: content.districts[0]!.id, restaurantName: "Test Kitchen", difficulty: "normal" } as const;

function started(): AppState {
  const s = appReducer(initialAppState, { type: "new", cmd: NEW });
  return appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
}

describe("appReducer", () => {
  it("never mutates the previous GameState", () => {
    const a = appReducer(initialAppState, { type: "new", cmd: NEW });
    const snapshot = JSON.stringify(a.game);
    const b = appReducer(a, { type: "command", cmd: { type: "SET_MENU_ITEM", dishId: a.game!.menu[0]!.dishId, price: 9999 } });
    expect(JSON.stringify(a.game)).toBe(snapshot);
    expect(b.game!.menu[0]!.price).toBe(9999);
  });

  it("ticks are a no-op outside service", () => {
    const a = appReducer(initialAppState, { type: "new", cmd: NEW });
    expect(appReducer(a, { type: "ticks", n: 5 })).toBe(a);
  });

  it("a batch of ticks stops at the end of service and captures the day's result", () => {
    let s = started();
    expect(s.game!.phase).toBe("service");
    s = appReducer(s, { type: "ticks", n: SERVICE_TICKS + 50 });
    expect(s.ticksRun).toBe(SERVICE_TICKS); // did not keep ticking past the end
    expect(["evening", "gameover"]).toContain(s.game!.phase);
    expect(s.lastResult?.day).toBe(0);
    expect(s.ticker.length).toBeGreaterThan(0); // LOG events reached the ticker
  });

  it("tracks 86'd dishes for the service and resets them next service", () => {
    let s = started();
    const dish = s.game!.menu[0]!.dishId;
    s = appReducer(s, { type: "command", cmd: { type: "EIGHTY_SIX", dishId: dish } });
    s = appReducer(s, { type: "command", cmd: { type: "EIGHTY_SIX", dishId: dish } });
    expect(s.eightySixed).toEqual([dish]);
    s = appReducer(s, { type: "ticks", n: SERVICE_TICKS });
    s = appReducer(s, { type: "command", cmd: { type: "END_DAY" } });
    if (s.game!.phase === "event") s = appReducer(s, { type: "command", cmd: { type: "RESOLVE_EVENT", choiceId: "x" } });
    expect(s.game!.day).toBe(1);
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    expect(s.eightySixed).toEqual([]);
    expect(s.ratings).toEqual({ sum: 0, count: 0 });
  });
});
