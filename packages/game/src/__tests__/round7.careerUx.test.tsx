/**
 * Round 7 (A, career UX): the first-shift onboarding (once per save, skippable, replayable), touch play on the canvas,
 * the score card's "next shift, try this", and the sous chef's lead-in played through the real reducer.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  botInput, createFixture, createSession, railView, sousPending, sousPose, summarise, updateSession, NO_INPUT,
  type HandsOnSession, type ShiftSummary,
} from "@full-plate/handson";
import { PLAYER_ID } from "@full-plate/sim-career";
import { HandsOnShift, onboardCardStyle, onboardTargetRect, secondsPerTick } from "../screens/HandsOnShift";
import { ShiftScoreCard } from "../screens/career/CareerEvening";
import { cardPlacement, markOnboardSeen, onboardingSteps, onboardKey, onboardSeen } from "../lib/onboarding";
import { createTouchControl } from "../lib/touchControl";
import { forDevice, nightCoaching } from "../lib/coaching";
import { appReducer } from "../state/gameReducer";
import { content } from "../sim";
import { careerChefStart } from "./handsOnHarness";

afterEach(() => { cleanup(); localStorage.clear(); });

beforeAll(() => {
  // jsdom has no canvas or ResizeObserver; frames never run here (rAF is parked), so only the DOM is under test.
  const ctx = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement["getContext"];
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  globalThis.requestAnimationFrame = (() => 0) as unknown as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = () => {};
});

describe("onboarding steps", () => {
  it("three steps per role: slip → station → pass for a chef, pointing at the rail then stations", () => {
    const chef = onboardingSteps({ role: "chef", station: { appliance: "fryer" }, touch: false });
    expect(chef.map((s) => s.title)).toEqual(["Grab a slip", "Cook at your station", "Send it to the pass"]);
    expect(chef.map((s) => (s.target.kind === "rail" ? "rail" : s.target.stationId))).toEqual(["rail", "fryer", "pass"]);
    expect(chef[1]!.text).toMatch(/fryer marked Yours.*Hold E/);
    expect(chef[0]!.text).toMatch(/WASD/);
    for (const role of ["server", "bar"] as const) expect(onboardingSteps({ role, touch: false })).toHaveLength(3);
  });

  it("talks about tapping and the USE button on a touch screen", () => {
    const t = onboardingSteps({ role: "chef", station: { appliance: "oven" }, touch: true });
    expect(t[0]!.text).toMatch(/Tap a slip/);
    expect(t[1]!.text).toMatch(/Hold USE/);
    expect(t.map((s) => s.text).join(" ")).not.toMatch(/\bE\b|WASD/);
  });

  it("is remembered once per save (seed) and role; storage failures just show it again", () => {
    const store = new Map<string, string>();
    const st = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(onboardSeen(st, 42, "chef")).toBe(false);
    markOnboardSeen(st, 42, "chef");
    expect(onboardSeen(st, 42, "chef")).toBe(true);
    expect(onboardSeen(st, 43, "chef")).toBe(false); // a new career
    expect(onboardSeen(st, 42, "server")).toBe(false); // a new role
    expect(onboardKey(42, "chef")).toBe("full-plate:onboard:v1:chef:42");
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(onboardSeen(broken, 1, "chef")).toBe(false);
    expect(() => markOnboardSeen(broken, 1, "chef")).not.toThrow();
  });

  it("places the card beside its spotlight with the arrow over the target", () => {
    expect(cardPlacement({ y: 10, h: 60 }, 600)).toBe("below");
    expect(cardPlacement({ y: 400, h: 60 }, 600)).toBe("above");
    const below = onboardCardStyle({ x: 20, y: 10, w: 300, h: 60 }, { width: 1000, height: 600 });
    expect(below.top).toBe(86);
    expect(below.left).toBe(12);
    const above = onboardCardStyle({ x: 900, y: 400, w: 60, h: 60 }, { width: 1000, height: 600 });
    expect(above.bottom).toBe(216);
    expect(above.left).toBe(1000 - 340 - 12);
    expect(parseFloat(above["--arrow-x"])).toBeCloseTo(930 - (1000 - 340 - 12));
  });

  it("spotlights the station tag and first slip for the rail step, and a ≥44 px box round a station", () => {
    const f = createFixture({ role: "chef", seed: 3 });
    const s = createSession(f.state, "chef", { station: { level: 0, title: "Commis station", label: "Desserts", dishIds: ["brownie"], cap: 2, idleCoverSecs: 30, hardCoverSecs: 80, targetPpm: 2.2 }, playerStaffId: "kid" });
    const view = { width: 900, height: 520 };
    const rail = onboardTargetRect({ title: "", text: "", target: { kind: "rail" } }, s, view)!;
    expect(rail.x).toBe(10);
    expect(rail.w).toBeGreaterThan(280);
    const oven = onboardTargetRect({ title: "", text: "", target: { kind: "station", stationId: "oven" } }, s, view)!;
    expect(Math.min(oven.w, oven.h)).toBeGreaterThanOrEqual(44);
  });
});

function mountShift(props: Partial<Parameters<typeof HandsOnShift>[0]> = {}) {
  const app = careerChefStart(5);
  const game = { ...app.game!, phase: "service" as const };
  return render(
    <HandsOnShift game={game} role="chef" playerStaffId={PLAYER_ID} jumpIn={false} runTicks={() => {}} sendResults={() => {}} onSkip={() => {}} onDone={() => {}} {...props} />,
  );
}

describe("HandsOnShift: the onboarding overlay", () => {
  it("shows on the first shift of a save, pages through its steps, and doesn't come back once finished", () => {
    const first = mountShift();
    expect(screen.getByRole("dialog", { name: "Grab a slip" })).toBeTruthy();
    expect(screen.getByLabelText("Step 1 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("dialog", { name: /Cook at|Send it/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Let's cook!" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    first.unmount();
    mountShift();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("can be skipped, and replayed from the ? button", () => {
    mountShift();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "How to play" }));
    expect(screen.getByRole("dialog", { name: "Grab a slip" })).toBeTruthy();
  });

  it("a touch on the canvas switches the shift to touch: USE and Drop buttons, no key hints", () => {
    mountShift();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.queryByRole("button", { name: /^Use/ })).toBeNull();
    expect(document.querySelector(".handson__keys")).toBeTruthy();
    const canvas = document.querySelector("canvas")!;
    act(() => { canvas.dispatchEvent(Object.assign(new MouseEvent("pointerdown", { bubbles: true }), { pointerType: "touch", pointerId: 1 })); });
    expect(document.querySelector(".handson--touch")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Use/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Drop/ })).toBeTruthy();
    expect(document.querySelector(".handson__keys")).toBeNull();
  });
});

describe("touch control", () => {
  const walkTo = (s: HandsOnSession, state: ReturnType<typeof createFixture>["state"], ctl: ReturnType<typeof createTouchControl>, frames: number) => {
    for (let i = 0; i < frames; i++) s = updateSession(s, state, { ...NO_INPUT, ...(ctl.read(s) ?? {}) }, 1 / 60).session;
    return s;
  };

  it("tap a station: she walks there and stops facing it; press it there: USE (latched for a tap shorter than a frame)", () => {
    const f = createFixture({ role: "chef", seed: 3 });
    let s = createSession(f.state, "chef", { tutorial: false });
    const ctl = createTouchControl();
    ctl.press(s, { kind: "station", stationId: "fridge" });
    expect(ctl.target).toBe("fridge");
    const first = ctl.read(s)!;
    expect(Math.hypot(first.moveX ?? 0, first.moveY ?? 0)).toBeGreaterThan(0);
    ctl.press(s, { kind: "station", stationId: "fridge" }); // re-aim
    s = walkTo(s, f.state, ctl, 600);
    expect(s.prompt?.stationId).toBe("fridge");
    expect(ctl.target).toBeUndefined();
    // press on the station she's at = USE; a release before the frame still counts once
    ctl.press(s, { kind: "station", stationId: "fridge" });
    ctl.release();
    expect(ctl.read(s)).toEqual({ interact: true });
    expect(ctl.read(s)).toBeNull();
  });

  it("the rail sends a chef to the fridge; the big buttons are E and Q; bare floor does nothing", () => {
    const f = createFixture({ role: "chef", seed: 3 });
    const s = createSession(f.state, "chef");
    const ctl = createTouchControl();
    ctl.press(s, { kind: "rail" });
    expect(ctl.target).toBe("fridge");
    ctl.use(true);
    expect(ctl.target).toBeUndefined();
    expect(ctl.read(s)).toEqual({ interact: true });
    expect(ctl.read(s)).toEqual({ interact: true }); // still held
    ctl.use(false);
    expect(ctl.read(s)).toBeNull();
    ctl.drop(true); ctl.drop(false);
    expect(ctl.read(s)).toEqual({ cancel: true });
    ctl.press(s, undefined);
    expect(ctl.read(s)).toBeNull();
  });

  it("while a verb runs, the whole canvas is the USE button (hold to cook)", () => {
    const f = createFixture({ role: "chef", seed: 3 });
    const s = { ...createSession(f.state, "chef"), activeAction: { verb: "cook", stationId: "stove", t: 0, dur: 2 } } as unknown as HandsOnSession;
    const ctl = createTouchControl();
    ctl.press(s, { kind: "station", stationId: "table:t1" });
    expect(ctl.read(s)).toEqual({ interact: true });
    expect(ctl.read(s)).toEqual({ interact: true });
    ctl.release();
    expect(ctl.read(s)).toBeNull();
  });
});

describe("score card: next shift, try this", () => {
  const base: ShiftSummary = { role: "chef", points: 245, stars: 1, plates: 3, meanQuality: 88, speedPct: 80, served: 0, cleared: 0, payments: 0, drops: 0, dropCost: 0, covered: 2, lines: [], tip: "Let go of E as soon as the needle reaches the green — overdone plates lose quality.", notes: [], nextStarAt: 380 };

  it("one sentence from tonight's numbers toward the next star", () => {
    expect(nightCoaching(base)).toBe("Three plates at 88% tonight — about two more plates would have earned a second star.");
    expect(nightCoaching({ ...base, stars: 0, points: 120, plates: 1, nextStarAt: 150 })).toBe("One plate at 88% tonight — about one more plate would have earned your first star.");
    expect(nightCoaching({ ...base, stars: 3, points: 900 })).toMatch(/three-star shift! Next time, see if you can beat 900 points/);
    expect(nightCoaching({ ...base, plates: 0, points: 0, stars: 0 })).toMatch(/sous chef sent two for you/);
    expect(nightCoaching({ ...base, role: "server", served: 4, plates: 0 })).toMatch(/^Four plates served tonight/);
  });

  it("the coach's tip names the USE button on a touch screen", () => {
    expect(forDevice(base.tip, true)).toBe("Let go of USE as soon as the needle reaches the green — overdone plates lose quality.");
    expect(forDevice(base.tip, false)).toBe(base.tip);
  });

  it("renders the tip and the sentence as the card's 'Next shift, try this'", () => {
    const app = careerChefStart(5);
    render(<ShiftScoreCard summary={base} career={app.meta.career!} name="Mia" touch />);
    const card = screen.getByRole("status", { name: "Shift score: 1 of 3 stars" });
    expect(card.querySelector(".shiftcard__nexthead")!.textContent).toBe("Next shift, try this");
    expect(card.querySelector(".shiftcard__nexttip")!.textContent).toMatch(/^Let go of USE/);
    expect(card.querySelector(".shiftcard__coach")!.textContent).toMatch(/two more plates would have earned a second star/);
  });
});

describe("the sous chef's lead-in through a whole bot shift (render-side pose, real reducer)", () => {
  /** Frame-by-frame pose as render draws it; counts per-frame jumps (> 0.6 tiles) and trips that set off before the cover. */
  function run(seed: number, lead: boolean) {
    let s = careerChefStart(seed);
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    s = appReducer(s, { type: "handsOnStart", meta: { role: "chef", jumpIn: false } });
    const station = s.meta.handsOn!.station!;
    let session = createSession(s.game!, "chef", { content, tutorial: true, playerStaffId: PLAYER_ID, station, ...(lead ? { sousLead: true } : {}) });
    const railX = (i: number) => Math.min(19.5, Math.max(2.5, 4 + i * 4.2));
    let acc = 0, t = 0, jumps = 0, led = 0, trips = 0, frames = 0;
    let prev: { x: number; y: number } | undefined;
    const seen = new Set<number>();
    while (s.game!.phase === "service" && t < 900) {
      const r = updateSession(session, s.game!, botInput(session, s.game!, 0.55, 0.5), 1 / 60);
      session = r.session;
      if (r.results.length) s = appReducer(s, { type: "handsOnResults", results: r.results });
      t += 1 / 60; acc += 1 / 60;
      const pose = sousPose(session.sousWalks, session.time, railX, sousPending(session, s.game!, railView(session, s.game!)));
      if (prev && Math.hypot(pose.x - prev.x, pose.y - prev.y) > 0.6) jumps++;
      prev = pose;
      frames++;
      for (const w of session.sousWalks ?? []) if (w.items.length && !seen.has(w.at)) { seen.add(w.at); trips++; if (w.leadFrom !== undefined && w.leadFrom < w.at) led++; }
      const secs = secondsPerTick(session, s.game!);
      if (acc >= secs) {
        acc -= secs;
        s = appReducer(s, { type: "handsOnScore", summary: summarise(session) });
        s = appReducer(s, { type: "ticks", n: 1 });
      }
    }
    return { jumps, led, trips, frames };
  }

  // Round 10: B re-seeded this to 1, 9, 13 because seeds 5-7 jumped once staff personalities re-rolled the warm-up, and
  // seeds 4, 8, 10, 11, 14 already jumped on master f14f861 (sousPose drew the newest walk from the post). Round 10
  // review fixed sous.ts (a walk sets off from where he is; late bookings ease over; the lead-in follows the first-due
  // slip and slides with it): seeds 4 and 8 (failing on master) and 5, 6 (failing on r10-b) are back, with 1, 9, 13.
  it.each([1, 4, 5, 6, 8, 9, 13])("seed %i: trips set off as the slip falls due, and the sous chef never jumps", (seed) => {
    const withLead = run(seed, true);
    expect(withLead.trips).toBeGreaterThan(2);
    expect(withLead.led / withLead.trips).toBeGreaterThan(0.5);
    expect(withLead.jumps).toBe(0);
    const old = run(seed, false);
    expect(old.led).toBe(0);
    expect(old.jumps).toBe(0);
  }, 120_000);

  // Round 10 review: the snap itself on every other seed to 16 (10, 11, 14 jumped on master). Seeds 7 and 12 lead fewer
  // than half their trips (the bot plates fast, so most covers come with no due slip first) — that ratio isn't a snap.
  it.each([2, 3, 7, 10, 11, 12, 14, 15, 16])("seed %i: the sous chef never jumps (lead-in on)", (seed) => {
    const withLead = run(seed, true);
    expect(withLead.trips).toBeGreaterThan(2);
    expect(withLead.jumps).toBe(0);
  }, 120_000);
});
