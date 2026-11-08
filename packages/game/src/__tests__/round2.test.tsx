import { describe, expect, it } from "vitest";
import { afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { GameState, SimEvent } from "@full-plate/sim-core";
import { absorb, appReducer, incidentOutcomeKind, initialAppState, type AppState } from "../state/gameReducer";
import { content } from "../sim";
import { GoalsCard } from "../components/GoalsCard";
import { IncidentCard } from "../components/IncidentCard";
import { visibleGoals } from "../lib/goals";
import { countdownFraction, incidentLines, liveIncidents } from "../lib/incidents";
import { dishDays, worstDish, WORST_MIN_SOLD, lastStaffedDay } from "../lib/evening";
import { shortcutsBlocked, speedAfterIncident, incidentHighlight } from "../screens/Service";
import { trainBlocker, coveringPhrase } from "../lib/staff";
import { baseGame, GOALS, sentBack, serviceWithIncident } from "./fixtures/round2";

afterEach(cleanup);

const inService = (g: GameState): GameState => ({ ...g, phase: "service", tick: 32 });
const app = (game: GameState): AppState => ({ ...initialAppState, game });

describe("incidents: RESPOND_INCIDENT dispatch through the reducer", () => {
  it("clicking an option dispatches RESPOND_INCIDENT with the incident and option ids", () => {
    const g = serviceWithIncident(inService(baseGame()));
    const sent: unknown[] = [];
    render(<IncidentCard incident={g.incidents![0]!} tick={g.tick} cash={g.cash} send={(c) => sent.push(c)} />);
    expect(screen.getByRole("heading", { name: "Plate sent back" })).toBeTruthy();
    // cost is shown on the paid option, "free" on the others
    const comp = screen.getByRole("button", { name: /Comp the plate/ });
    expect(comp.textContent).toMatch(/−£14\.50/);
    expect(screen.getAllByText("free")).toHaveLength(2);
    comp.click();
    expect(sent).toEqual([{ type: "RESPOND_INCIDENT", incidentId: "inc-1", optionId: "comp" }]);
  });

  it("the reducer sends RESPOND_INCIDENT to the real sim and never mutates state", () => {
    const g = serviceWithIncident(inService(baseGame()));
    const before = JSON.stringify(g);
    const s = appReducer(app(g), { type: "command", cmd: { type: "RESPOND_INCIDENT", incidentId: "inc-1", optionId: "remake" } });
    expect(JSON.stringify(g)).toBe(before);
    expect(s.game).not.toBeNull();
    const after = s.game!.incidents?.find((i) => i.id === "inc-1");
    if (after?.resolution) {
      // sim has landed: the incident is resolved with the chosen option, no toast
      expect(after.resolution).toBe("remake");
      expect(s.toast?.tone ?? "good").not.toBe("bad");
    } else {
      // sim not landed yet: refused with a LOG "bad", shown as a toast, not a ticker line
      expect(s.toast?.tone).toBe("bad");
      expect(s.ticker).toHaveLength(0);
      expect(s.game!.phase).toBe("service");
    }
  });

  it("INCIDENT_STARTED bumps the alert once; INCIDENT_RESOLVED adds a ticker line coloured by outcome", () => {
    const g = serviceWithIncident(inService(baseGame()));
    let s = absorb(app(g), [{ type: "INCIDENT_STARTED", incidentId: "inc-1" }]);
    expect(s.incidentAlert).toEqual({ seq: 1, incidentId: "inc-1" });
    s = absorb(s, [{ type: "INCIDENT_RESOLVED", incidentId: "inc-1", resolution: "remake", outcome: "Fresh plate out; table 3 is happy." }]);
    expect(s.ticker.at(-1)).toMatchObject({ text: "Fresh plate out; table 3 is happy.", kind: "good" });
    s = absorb(s, [{ type: "INCIDENT_RESOLVED", incidentId: "inc-2", resolution: "ignored", outcome: "Nobody cleaned it up." }]);
    expect(s.ticker.at(-1)!.kind).toBe("bad");
    // if the sim already logged the outcome, don't duplicate it
    const ev: SimEvent[] = [
      { type: "LOG", entry: { day: 0, tick: 40, text: "Sorted.", kind: "good" } },
      { type: "INCIDENT_RESOLVED", incidentId: "inc-3", resolution: "comp", outcome: "Sorted." },
    ];
    expect(absorb(s, ev).ticker.filter((l) => l.text === "Sorted.")).toHaveLength(1);
    expect(incidentOutcomeKind("apologise", "They walked out anyway.")).toBe("bad");
  });

  it("auto-pause: 1x/2x pause when enabled, 4x never pauses but toasts, off means keep going", () => {
    expect(speedAfterIncident(1, true)).toEqual({ speed: 0, toast: false });
    expect(speedAfterIncident(2, true)).toEqual({ speed: 0, toast: false });
    expect(speedAfterIncident(4, true)).toEqual({ speed: 4, toast: true });
    expect(speedAfterIncident(2, false)).toEqual({ speed: 2, toast: false });
    expect(speedAfterIncident(0, true)).toEqual({ speed: 0, toast: false });
  });

  it("highlights the incident's table, and the countdown/live helpers handle missing round-2 fields", () => {
    const g = serviceWithIncident(inService(baseGame()));
    expect(incidentHighlight(g, g.incidents![0]!).tableIds).toEqual([g.tables[2]!.id]);
    expect(liveIncidents({})).toEqual([]);
    expect(liveIncidents({ incidents: [sentBack({ resolution: "comp" })] })).toEqual([]);
    expect(countdownFraction(sentBack({ startedTick: 30, ticksLeft: 6 }), 36)).toBeCloseTo(0.5);
  });

  it("evening list: prefers DayResult.incidents and shows the button label the player chose", () => {
    const g = { ...baseGame(), incidents: [sentBack({ resolution: "comp", outcome: "Free plate, big smile." })] };
    const lines = incidentLines({ ...g.history[0]!, incidents: [{ kind: "sent_back", resolution: "comp", outcome: "Free plate, big smile." }] } as never, g);
    expect(lines).toEqual([{ kind: "sent_back", title: "Plate sent back", choice: "Comp the plate", outcome: "Free plate, big smile.", ignored: false }]);
    expect(incidentLines(null, { incidents: [sentBack({ resolution: "ignored", outcome: "Grumbles." })] })[0]).toMatchObject({ choice: "Left it", ignored: true });
    expect(incidentLines(null, {})).toEqual([]);
  });
});

describe("goals", () => {
  it("renders up to 4 unfinished goals of the lowest tier, with progress and hint", () => {
    render(<GoalsCard goals={GOALS} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(4); // tier 0 open: menu, chef, open, hidden — not the done one, not tier 1
    expect(screen.getByText("Put 6 dishes on the menu")).toBeTruthy();
    expect(screen.queryByText("Serve 50 guests")).toBeNull();
    expect(screen.queryByText("Order tomorrow's stock")).toBeNull();
    const bar = screen.getByRole("meter", { name: "Put 6 dishes on the menu progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(screen.getByText("Menu tab → add dishes")).toBeTruthy();
    expect(screen.getByText("2/6")).toBeTruthy();
  });

  it("flashes goals completed today with their reward", () => {
    const { container } = render(<GoalsCard goals={GOALS} justDone={["g-stock"]} />);
    const done = container.querySelector(".goal--done")!;
    expect(done.textContent).toMatch(/Order tomorrow's stock/);
    expect(done.textContent).toMatch(/\+£20/);
  });

  it("is hidden when the sim gives no goals, and the next tier unlocks when a tier is done", () => {
    const { container } = render(<GoalsCard goals={undefined} />);
    expect(container.innerHTML).toBe("");
    const tier0Done = GOALS.map((g) => (g.tier === 0 ? { ...g, done: true } : g));
    expect(visibleGoals(tier0Done).open.map((g) => g.id)).toEqual(["g-50"]);
  });

  it("collapsed on Service: a one-line toggle", () => {
    render(<GoalsCard goals={GOALS} collapsible />);
    const t = screen.getByRole("button", { name: /Goals/ });
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    t.click();
  });

  it("GOAL_COMPLETED makes a celebratory toast naming the reward", () => {
    const s = absorb(app({ ...baseGame(), goals: GOALS }), [{ type: "GOAL_COMPLETED", goalId: "g-50" }]);
    expect(s.toast).toMatchObject({ tone: "good" });
    expect(s.toast!.text).toMatch(/Serve 50 guests/);
    expect(s.toast!.text).toMatch(/\+£100/);
    expect(s.goalsJustDone).toEqual(["g-50"]);
  });
});

describe("worst dish filter", () => {
  const D = (dishId: string, course: "main" | "starter" | "dessert", sold: number, quality?: number) => ({ dishId, course, sold, ...(quality !== undefined ? { quality } : {}) });

  it(`excludes dishes that sold fewer than ${WORST_MIN_SOLD} plates`, () => {
    const w = worstDish([D("pie", "main", 20, 78), D("fish", "main", 18, 74), D("bread", "starter", 2, 30)]);
    expect(w).toBeNull(); // bread is the lowest quality but only sold 2; the mains are close together
  });

  it("names low quality when one dish is clearly worse", () => {
    const w = worstDish([D("pie", "main", 20, 80), D("fish", "main", 18, 79), D("curry", "main", 9, 55)]);
    expect(w).toMatchObject({ dishId: "curry", reason: "quality" });
    expect(w!.text).toMatch(/Low quality/);
  });

  it("names unpopular when quality is even but one dish sells far less than its course", () => {
    const w = worstDish([D("pie", "main", 24, 76), D("fish", "main", 22, 75), D("curry", "main", 4, 74), D("cake", "dessert", 6, 70)]);
    expect(w).toMatchObject({ dishId: "curry", reason: "unpopular" });
    expect(w!.text).toMatch(/Unpopular/);
  });

  it("falls back to the sim's worstDish when there is no per-dish quality, but still applies the filter", () => {
    expect(worstDish([D("pie", "main", 10), D("fish", "main", 9)], "fish")).toMatchObject({ dishId: "fish", reason: "quality" });
    expect(worstDish([D("pie", "main", 10), D("fish", "main", 1)], "fish")).toBeNull();
  });

  it("reads per-dish numbers from the evening's service tally", () => {
    const g = baseGame();
    const dish = content.dishes[0]!;
    const withTally = {
      ...g,
      menu: [{ dishId: dish.id, price: dish.suggestedPrice, active: true, sold7d: 4, margin7d: 0, recent: [{ sold: 4, margin: 0 }] }],
      service: { dishes: { [dish.id]: { sold: 5, plated: 5, qualitySum: 300, margin: 0 } } } as unknown as GameState["service"],
    };
    expect(dishDays(content, withTally)).toEqual([{ dishId: dish.id, course: dish.course, sold: 5, quality: 60 }]);
  });
});

describe("staff matters", () => {
  it("can't train the only chef rostered today; can train when someone else covers the role", () => {
    const g = baseGame();
    const mk = (id: string, role: "chef" | "server") => ({ id, name: `${id} Smith`, role, skill: 50, speed: 50, charm: 50, wage: 1200, mood: 70, fatigue: 0, traits: [], hiredDay: 0, potential: 60, rota: [true, true, true, true, true, true, true] });
    const one = { ...g, staff: [mk("Ana", "chef"), mk("Bo", "server")] };
    expect(trainBlocker(one, one.staff[0]!, 2)).toMatch(/only chef on today/);
    const two = { ...g, staff: [mk("Ana", "chef"), mk("Cy", "chef")] };
    expect(trainBlocker(two, two.staff[0]!, 2)).toBeNull();
    expect(trainBlocker({ ...two, phase: "service" }, two.staff[0]!, 2)).toMatch(/morning/);
  });

  it("owner-covering copy and last staffed day", () => {
    expect(coveringPhrase(["chef", "server"])).toBe("the kitchen and the floor");
    const day = (d: number, ownerCovered?: ("chef" | "server")[]) => ({ day: d, ownerCovered }) as never;
    expect(lastStaffedDay([day(0), day(1, ["chef"]), day(2, ["chef"])], 2)).toMatchObject({ day: 0 });
    expect(lastStaffedDay([day(0, ["chef"])], 1)).toBeUndefined();
  });
});

describe("keyboard", () => {
  it("Space shortcuts are blocked on focused buttons, inputs and radios but not on the page", () => {
    const b = document.createElement("button");
    const i = document.createElement("input");
    const span = document.createElement("span");
    b.appendChild(span);
    expect(shortcutsBlocked(b)).toBe(true);
    expect(shortcutsBlocked(span)).toBe(true);
    expect(shortcutsBlocked(i)).toBe(true);
    expect(shortcutsBlocked(document.body)).toBe(false);
    expect(shortcutsBlocked(null)).toBe(false);
  });
});
