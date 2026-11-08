import { describe, expect, it } from "vitest";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { content, SERVICE_TICKS } from "../sim";
import { suggestedStarterMenu } from "../lib/starterMenu";

const NEW = { type: "NEW_GAME", seed: 4242, districtId: content.districts[0]!.id, restaurantName: "Test Kitchen", difficulty: "normal" } as const;

function withMenu(): AppState {
  let s = appReducer(initialAppState, { type: "new", cmd: NEW });
  for (const d of suggestedStarterMenu(content, s.game!)) {
    s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice } });
  }
  return s;
}
/** Ticks until the service ends. A batch stops early on the tick an incident starts, so loop. */
export function finishService(s: AppState): AppState {
  for (let i = 0; i < SERVICE_TICKS * 2 && s.game!.phase === "service"; i++) s = appReducer(s, { type: "ticks", n: SERVICE_TICKS });
  return s;
}
const started = () => appReducer(withMenu(), { type: "command", cmd: { type: "START_SERVICE" } });

describe("appReducer (real sim + content)", () => {
  it("the game starts with an empty menu and the starter menu fills it with 6-8 dishes incl. mains", () => {
    const fresh = appReducer(initialAppState, { type: "new", cmd: NEW });
    expect(fresh.game!.menu).toHaveLength(0);
    const s = withMenu();
    expect(s.game!.menu.length).toBeGreaterThanOrEqual(6);
    expect(s.game!.menu.length).toBeLessThanOrEqual(8);
    const mains = s.game!.menu.filter((m) => content.dishes.find((d) => d.id === m.dishId)?.course === "main");
    expect(mains.length).toBeGreaterThan(0);
    expect(s.toast?.tone ?? "none").not.toBe("bad"); // a goal toast is fine; a refusal isn't
  });

  it("never mutates the previous GameState", () => {
    const a = withMenu();
    const snapshot = JSON.stringify(a.game);
    const b = appReducer(a, { type: "command", cmd: { type: "SET_MENU_ITEM", dishId: a.game!.menu[0]!.dishId, price: 9999 } });
    expect(JSON.stringify(a.game)).toBe(snapshot);
    expect(b.game!.menu[0]!.price).toBe(9999);
  });

  it("ticks are a no-op outside service", () => {
    const a = withMenu();
    expect(appReducer(a, { type: "ticks", n: 5 })).toBe(a);
  });

  it("a rejected command becomes a toast", () => {
    const a = withMenu();
    const b = appReducer(a, { type: "command", cmd: { type: "END_DAY" } });
    expect(b.toast?.text).toMatch(/Can't end the day/);
    expect(appReducer(b, { type: "dismissToast" }).toast).toBeNull();
  });

  it("a batch of ticks stops at the end of service and captures the day's result", () => {
    let s = started();
    expect(s.game!.phase).toBe("service");
    s = finishService(s);
    expect(s.ticksRun).toBe(SERVICE_TICKS);
    expect(["evening", "event", "gameover"]).toContain(s.game!.phase);
    expect(s.lastResult?.day).toBe(0);
    expect(s.lastResult).toEqual(s.game!.history.at(-1));
    expect(s.ticker.length).toBeGreaterThan(0);
  });

  it("86'd dishes live in GameState and reset the next day", () => {
    let s = started();
    const dish = s.game!.menu[0]!.dishId;
    s = appReducer(s, { type: "command", cmd: { type: "EIGHTY_SIX", dishId: dish } });
    expect(s.game!.eightySixed).toContain(dish);
    s = finishService(s);
    if (s.game!.phase === "event") {
      const ev = content.events.find((e) => e.id === s.game!.activeEvent?.eventId)!;
      s = appReducer(s, { type: "command", cmd: { type: "RESOLVE_EVENT", choiceId: ev.choices[0]!.id } });
    } else {
      s = appReducer(s, { type: "command", cmd: { type: "END_DAY" } });
    }
    expect(s.game!.day).toBe(1);
    expect(s.game!.eightySixed).toEqual([]);
  });
});
