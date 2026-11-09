/** Round 7 (UX): the sous chef's lead-in, NPCs stepping aside, touch hit tests, and the HUD's read-without-numbers helpers. */
import { describe, expect, it } from "vitest";
import { createFixture } from "../src/fixture";
import { createSession } from "../src/session";
import type { StationPlan } from "../src/station";
import { bookSousWalk, freeAt, leadIn, RAIL_STAND_Y, SOUS_WALK, SOUS_WALK_TOTAL, sousPose, standDown, walkEnd, walkTimes } from "../src/sous";
import { avoidPlayer, moodOf, slipTimeLeft, viewMetrics, withKey, yourStations } from "../src/render";
import { createInputSource, onControl } from "../src/input";
import { hitTest, MIN_TARGET_PX, padToMin, railSlotRect, railTarget, stationRect } from "../src/touch";

const item = (id: string) => ({ ticketId: id, dishId: "brownie", table: 1 });
const railX = (i: number) => 4 + i * 4;

describe("the sous chef sets off as the slip turns amber (R6 P3)", () => {
  it("without a due stamp nothing changes: he sets off at the cover (the demo, old saves)", () => {
    expect(bookSousWalk(undefined, item("a"), 1, 10)).toEqual([{ items: [item("a")], slot: 1, at: 10 }]);
    expect(walkEnd({ items: [item("a")], slot: 1, at: 10 })).toBeCloseTo(10 + SOUS_WALK_TOTAL);
  });

  it("a due slip: he walks to it, waits under it, and the cover's trip carries on from the rail without a jump", () => {
    const pending = { slot: 2, dueSince: 5 };
    expect(sousPose(undefined, 4.9, railX, pending).phase).toBe("idle");
    const half = sousPose(undefined, 5 + SOUS_WALK.toRail / 2, railX, pending);
    expect(half.phase).toBe("toRail");
    expect(half.talking).toBe(false); // nothing to say until the cover
    const waiting = sousPose(undefined, 8, railX, pending);
    expect([waiting.phase, waiting.facing, waiting.moving]).toEqual(["wait", "up", false]);
    expect(waiting.x).toBeCloseTo(railX(2));
    expect(waiting.y).toBeCloseTo(RAIL_STAND_Y);
    // the tick lands at 8.5: the session books the trip with the slip's due stamp
    const trip = bookSousWalk(undefined, item("b"), 2, 8.5, 5);
    expect(trip).toEqual([{ items: [item("b")], slot: 2, at: 8.5, leadFrom: 5 }]);
    expect(walkTimes(trip[0]!)).toEqual({ start: 5, takeAt: 8.5, end: 8.5 + SOUS_WALK_TOTAL - SOUS_WALK.toRail });
    const before = sousPose(undefined, 8.5 - 1 / 60, railX, pending);
    const after = sousPose(trip, 8.5, railX);
    expect(after.phase).toBe("take");
    expect(after.talking).toBe(true);
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.01);
  });

  it("a cover that comes before he reaches the rail: he keeps walking, then takes it", () => {
    const trip = bookSousWalk(undefined, item("b"), 0, 5.4, 5);
    const t = walkTimes(trip[0]!);
    expect(t.takeAt).toBeCloseTo(5 + SOUS_WALK.toRail);
    const mid = sousPose(trip, 5.5, railX);
    expect(mid.phase).toBe("toRail");
    expect(Math.hypot(mid.x - sousPose(undefined, 5.5, railX, { slot: 0, dueSince: 5 }).x, 0)).toBeLessThan(1e-9);
  });

  it("busy when it falls due: he sets off when he's back at his post, lead-in and trip alike", () => {
    const busy = bookSousWalk(undefined, item("a"), 0, 0);
    const free = freeAt(busy);
    expect(sousPose(busy, free - 0.2, railX, { slot: 1, dueSince: 1 }).phase).toBe("back"); // the trip wins
    expect(leadIn(busy, { slot: 1, dueSince: 1 }).leadFrom).toBeCloseTo(free);
    const both = bookSousWalk(busy, item("c"), 1, free - 0.5, 1);
    expect(both.at(-1)!.leadFrom).toBeCloseTo(free);
    expect(sousPose(both, free + 0.3, railX).phase).toBe("toRail");
  });

  it("she plates it before the tick: he walks back from the rail (a stand-down), not a jump to his post", () => {
    const pending = { slot: 1, dueSince: 2 };
    const before = sousPose(undefined, 6, railX, pending);
    const walks = standDown(undefined, 1, 6, 2);
    expect(walks).toEqual([{ items: [], slot: 1, at: 6, leadFrom: 2 }]);
    const after = sousPose(walks, 6, railX);
    expect(after.phase).toBe("back");
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(0.01);
    expect(sousPose(walks, 6 + SOUS_WALK.back + 0.01, railX).phase).toBe("idle");
    // he never set off (busy past now): nothing to undo
    const busy = bookSousWalk(undefined, item("a"), 0, 5);
    expect(standDown(busy, 1, 6, 2)).toEqual(busy);
  });
});

describe("NPCs step aside for the player (render only)", () => {
  it("pushes an overlapping NPC out to the radius, leaves a distant one alone", () => {
    expect(avoidPlayer({ x: 5, y: 5 }, { x: 9, y: 9 })).toEqual({ x: 5, y: 5 });
    const p = avoidPlayer({ x: 5.2, y: 5 }, { x: 5, y: 5 }, 0.8);
    expect(Math.hypot(p.x - 5, p.y - 5)).toBeCloseTo(0.8);
    expect(p.x).toBeGreaterThan(5);
    const same = avoidPlayer({ x: 5, y: 5 }, { x: 5, y: 5 }, 0.8);
    expect(same).toEqual({ x: 5.8, y: 5 });
  });
});

describe("reading the room without numbers", () => {
  it("faces for patience, a draining bar for slip age, USE for E on a touch screen", () => {
    expect([moodOf(90), moodOf(61), moodOf(60), moodOf(31), moodOf(30), moodOf(0)]).toEqual(["happy", "happy", "meh", "meh", "cross", "cross"]);
    expect(slipTimeLeft(0)).toBe(1);
    expect(slipTimeLeft(15)).toBeCloseTo(0.5);
    expect(slipTimeLeft(45)).toBe(0);
    expect(withKey("Tap E as the slider crosses each knife mark", "USE")).toBe("Tap USE as the slider crosses each knife mark");
    expect(withKey("Hold E … let go when the needle is in the green", "USE")).toBe("Hold USE … let go when the needle is in the green");
    expect(withKey("Every chef", "USE")).toBe("Every chef");
  });

  it("her station's appliances are the ones her dishes cook on", () => {
    const f = createFixture({ role: "chef", seed: 3 });
    const plan: StationPlan = {
      level: 0, title: "Commis station", label: "Desserts · Burgers", dishIds: ["brownie", "beef_burger"], cap: 2,
      idleCoverSecs: 30, hardCoverSecs: 80, targetPpm: 2.2, coverTicks: 8,
    };
    const s = createSession(f.state, "chef", { station: plan, playerStaffId: "kid" });
    expect(yourStations(s).sort()).toEqual(["oven", "stove"]);
    expect(yourStations(createSession(f.state, "chef"))).toEqual([]);
    expect(yourStations(createSession(f.state, "server"))).toEqual([]);
  });
});

describe("touch targets", () => {
  const f = createFixture({ role: "chef", seed: 3 });
  const s = createSession(f.state, "chef");

  it("a tap on a station hits it; on the rail it means 'go and fetch a slip'; bare floor is nothing", () => {
    const view = { width: 1024, height: 600 };
    const r = stationRect(s, view, "fridge")!;
    expect(hitTest(s, view, r.x + r.w / 2, r.y + r.h / 2)).toEqual({ kind: "station", stationId: "fridge" });
    const slot = railSlotRect(view, 0);
    expect(hitTest(s, view, slot.x + 10, slot.y + 10)).toEqual({ kind: "rail" });
    expect(railTarget(s)).toBe("fridge");
    expect(railTarget(createSession(f.state, "server"))).toBeUndefined();
    // the HUD corner of the header isn't the rail
    expect(hitTest(s, view, view.width - 20, 30)).toBeUndefined();
  });

  it("targets are at least 44 px even when a tile is ~20 px (iPad landscape stage)", () => {
    const view = { width: 700, height: 420 };
    expect(viewMetrics(view).T).toBeLessThan(MIN_TARGET_PX);
    const r = stationRect(s, view, "fridge")!;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    // 21 px off-centre vertically still lands (a 1-tile-high station drawn ~20 px tall)
    expect(hitTest(s, view, cx, cy + 21)).toEqual({ kind: "station", stationId: "fridge" });
    const p = padToMin({ x: 10, y: 10, w: 20, h: 60 });
    expect([p.w, p.h, p.x, p.y]).toEqual([44, 60, -2, 10]);
  });
});

describe("keys on a button belong to the button", () => {
  it("Enter/Space on Next, Pause or Skip press it; on the canvas or the page they cook", () => {
    expect(onControl({ target: { tagName: "BUTTON" } as unknown as EventTarget })).toBe(true);
    expect(onControl({ target: { tagName: "input" } as unknown as EventTarget })).toBe(true);
    expect(onControl({ target: { tagName: "CANVAS" } as unknown as EventTarget })).toBe(false);
    expect(onControl({ target: null })).toBe(false);
    const handlers: Record<string, (e: unknown) => void> = {};
    const win = { addEventListener: (k: string, f: (e: unknown) => void) => { handlers[k] = f; }, removeEventListener: () => {} } as unknown as Window;
    const src = createInputSource(win);
    let prevented = 0;
    const key = (code: string, tagName: string) => ({ code, target: { tagName }, preventDefault: () => { prevented++; } });
    handlers.keydown!(key("Enter", "BUTTON"));
    expect(src.read().interact).toBe(false);
    expect(prevented).toBe(0);
    handlers.keydown!(key("KeyE", "CANVAS"));
    expect(src.read().interact).toBe(true);
    expect(prevented).toBe(1);
    src.dispose();
  });
});
