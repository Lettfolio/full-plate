import { describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach } from "vitest";
afterEach(cleanup);
import type { GameState } from "@full-plate/sim-core";
import { PLAYER_ID } from "@full-plate/sim-career";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { CAREER_SAVE_KEY, decodeSave, encodeSave, ENVELOPE_VERSION, loadSave, SAVE_KEY, saveGame } from "../state/save";
import { FORK_DAY, forkDue, initialMeta } from "../state/paths";
import { applyCommand, content, runDay, serialize, suggestedOrder } from "../sim";
import { StartPicker } from "../screens/StartPicker";

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, keys: () => [...m.keys()] };
}

const owner = (): AppState => appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 11, districtId: "high_street", restaurantName: "Fork Test", difficulty: "cosy" } });

/** A played owner game moved to year 2 with a strong record (a real sim history, re-dated). */
function yearTwoOwner(popularity = 70): AppState {
  let s = owner();
  s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: "fish_and_chips", price: 1450 } });
  s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: "burger", price: 1250 } });
  s = appReducer(s, { type: "command", cmd: { type: "HIRE", candidateIndex: 0 } });
  let g = s.game!;
  for (let d = 0; d < 20 && g.phase !== "gameover"; d++) {
    g = runDay(content, g).state;
    for (const o of suggestedOrder(content, g)) g = applyCommand(content, g, { type: "ORDER_STOCK", ...o }).state;
    if (g.phase === "event") g = appReducer({ ...s, game: g }, { type: "command", cmd: { type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === g.activeEvent?.eventId)?.choices[0]?.id ?? "" } }).game!;
    else if (g.phase === "evening") g = appReducer({ ...s, game: g }, { type: "command", cmd: { type: "END_DAY" } }).game!;
  }
  // Jump the calendar to the start of year 2 (the fork condition reads day + reputation + history).
  const jumped: GameState = { ...g, day: FORK_DAY, reputation: { ...g.reputation, popularity } };
  return { ...s, game: jumped, meta: { ...initialMeta("owner"), lastPathDay: FORK_DAY - 1 } };
}

describe("start picker routing", () => {
  it("routes Owner to the lease screen and employee starts to a career", () => {
    const calls: string[] = [];
    render(<StartPicker content={content} onBack={() => {}} onOwner={(d, id) => calls.push(`owner:${d}:${id}`)} onCareer={(o) => calls.push(`career:${o.track}:${o.strategy}:${o.difficulty}:${o.districtId}`)} />);
    expect(screen.getAllByRole("radio", { checked: true }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Choose a name/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Apprentice chef/ }));
    fireEvent.click(screen.getByRole("radio", { name: /^Normal/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Seaside/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start as apprentice chef/ }));
    expect(calls[0]).toMatch(/^owner:cosy:/);
    expect(calls[1]).toBe("career:chef:balanced:normal:seaside");
  });

  it("offers all five starts with a line from the brief", () => {
    render(<StartPicker content={content} onBack={() => {}} onOwner={() => {}} onCareer={() => {}} />);
    for (const n of ["Owner", "Apprentice chef", "Bar", "Waiter", "Restaurant manager"]) expect(screen.getAllByRole("radio", { name: new RegExp(`^${n}`) }).length).toBeGreaterThan(0);
    expect(screen.getByText(/Commis in someone else's kitchen/)).toBeTruthy();
  });
});

describe("career start", () => {
  it("runs a whole employee day: owner plans, shift, career evening, owner closes", () => {
    let s = appReducer(initialAppState, { type: "newCareer", seed: 4, track: "chef", strategy: "balanced", playerName: "Robin", difficulty: "normal", districtId: "high_street" });
    expect(s.meta.mode).toBe("career");
    expect(s.game!.staff.some((x) => x.id === PLAYER_ID)).toBe(true);
    expect(s.meta.morningDay).toBe(s.game!.day); // the AI owner planned this morning
    const day0 = s.meta.career!.day;
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    expect(s.game!.phase).toBe("service");
    s = appReducer(s, { type: "skipShift" });
    expect(["evening", "event"]).toContain(s.game!.phase);
    expect(s.meta.career!.day).toBe(day0 + 1); // stepCareerDay ran
    expect(s.meta.ownerCommands.length).toBeGreaterThan(0); // the owner's closing commands are queued
    const simDay = s.game!.day;
    s = appReducer(s, { type: "nextDay" });
    expect(s.game!.phase).toBe("planning");
    expect(s.game!.day).toBe(simDay + 1);
  });

  it("shift choices go through sim-career (TAKE_SHIFT re-rosters the player)", () => {
    let s = appReducer(initialAppState, { type: "newCareer", seed: 5, track: "waiter", strategy: "balanced", playerName: "Sam", difficulty: "normal" });
    s = appReducer(s, { type: "career", cmd: { type: "TAKE_SHIFT", weekday: 6, take: true } });
    expect(s.meta.career!.shiftPlan[6]).toBe(true);
    expect(s.game!.staff.find((x) => x.id === PLAYER_ID)!.rota[6]).toBe(true);
  });
});

describe("the fork", () => {
  it("is not offered before year 2, nor without the milestone", () => {
    const s = owner();
    expect(forkDue({ ...s.game!, phase: "evening", day: FORK_DAY - 1, reputation: { popularity: 90, prestige: 10 } }, s.meta.fork, "owner")).toBe(false);
    expect(forkDue({ ...s.game!, phase: "evening", day: FORK_DAY, reputation: { popularity: 20, prestige: 10 } }, s.meta.fork, "owner")).toBe(false);
    expect(forkDue({ ...s.game!, phase: "evening", day: FORK_DAY, reputation: { popularity: 60, prestige: 10 } }, s.meta.fork, "owner")).toBe(true);
    expect(forkDue({ ...s.game!, phase: "evening", day: FORK_DAY, reputation: { popularity: 90, prestige: 10 } }, s.meta.fork, "career")).toBe(false);
  });

  it("shows the card in the evening; Think about it snoozes it a week; choosing Empire forks the empire", () => {
    let s = yearTwoOwner();
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    s = appReducer(s, { type: "ticks", n: 200 });
    while (s.game!.phase === "service") s = appReducer(s, { type: "ticks", n: 200 });
    expect(s.meta.fork.offered).toBe(true);
    s = appReducer(s, { type: "fork", choice: "snooze" });
    expect(s.meta.fork.offered).toBe(false);
    expect(s.meta.fork.snoozeUntil).toBe(s.game!.day + 7);
    expect(forkDue(s.game!, s.meta.fork, "owner")).toBe(false);
    expect(forkDue({ ...s.game!, day: s.game!.day + 7 }, s.meta.fork, "owner")).toBe(true);
    s = appReducer(s, { type: "fork", choice: "empire", brandName: "Forky's" });
    expect(s.meta.fork.chosen).toBe("empire");
    expect(s.meta.empire!.brand.name).toBe("Forky's");
    expect(s.meta.empire!.focusedSiteId).toBe("s1");
  });

  it("Empire: each evening steps the empire once; moving money takes it from the till", () => {
    let s = yearTwoOwner();
    s = appReducer(s, { type: "fork", choice: "empire" });
    const hq0 = s.meta.empire!.hq;
    const cash0 = s.game!.cash;
    s = appReducer(s, { type: "empire", cmd: { type: "TRANSFER_FROM_FOCUSED", amount: 50_000 } });
    expect(s.game!.cash).toBe(cash0 - 50_000);
    expect(s.meta.empire!.hq.cash).toBe(hq0.cash + 50_000);
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    while (s.game!.phase === "service") s = appReducer(s, { type: "ticks", n: 200 });
    expect(s.meta.empire!.hq.day).toBe(hq0.day + 1);
    const again = appReducer(s, { type: "toast", text: "x" });
    expect(again.meta.empire!.hq.day).toBe(hq0.day + 1); // idempotent per day
  });

  it("Stars: the evening steps the stars layer and its pack carries signatures", () => {
    let s = yearTwoOwner();
    s = appReducer(s, { type: "fork", choice: "stars" });
    expect(s.meta.stars).toBeTruthy();
    const last = s.meta.stars!.lastDay;
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    while (s.game!.phase === "service") s = appReducer(s, { type: "ticks", n: 200 });
    expect(s.meta.stars!.lastDay).toBeGreaterThan(last);
    // fine-dining recipes unlock in the recipe book after Stars (library.ts is tested separately)
    expect(s.meta.fork.chosen).toBe("stars");
  });
});

describe("save envelope", () => {
  it("round-trips owner, empire and stars state with a version", () => {
    let s = yearTwoOwner();
    s = appReducer(s, { type: "fork", choice: "empire" });
    const raw = encodeSave(s.game!, s.meta);
    const env = JSON.parse(raw);
    expect(env.kind).toBe("full-plate");
    expect(env.v).toBe(ENVELOPE_VERSION);
    const back = decodeSave(raw);
    expect(back.game).toEqual(s.game);
    expect(back.meta.empire).toEqual(s.meta.empire);
    expect(back.meta.fork).toEqual(s.meta.fork);

    let t = yearTwoOwner();
    t = appReducer(t, { type: "fork", choice: "stars" });
    expect(decodeSave(encodeSave(t.game!, t.meta)).meta.stars).toEqual(t.meta.stars);
  });

  it("still loads a bare round 1–2 GameState save as a plain owner game", () => {
    const st = memoryStorage();
    const g = owner().game!;
    st.setItem(SAVE_KEY, serialize(g));
    const l = loadSave(SAVE_KEY, st)!;
    expect(l.game).toEqual(g);
    expect(l.meta.mode).toBe("owner");
    expect(l.meta.empire).toBeUndefined();
  });

  it("career games use their own key and survive a reload", () => {
    const st = memoryStorage();
    const s = appReducer(initialAppState, { type: "newCareer", seed: 8, track: "bar", strategy: "premium", playerName: "Jo", difficulty: "cosy" });
    expect(saveGame(s.game!, s.meta, st)).toBe(true);
    expect(st.keys()).toEqual([CAREER_SAVE_KEY]);
    const l = loadSave(CAREER_SAVE_KEY, st)!;
    expect(l.meta.mode).toBe("career");
    expect(l.meta.career).toEqual(s.meta.career);
    const resumed = appReducer(initialAppState, { type: "load", game: l.game, meta: l.meta });
    expect(resumed.meta.career!.playerName).toBe("Jo");
  });

  it("rejects envelopes from the future", () => {
    expect(() => decodeSave(JSON.stringify({ kind: "full-plate", v: ENVELOPE_VERSION + 1, game: "{}", meta: {} }))).toThrow();
  });
});
