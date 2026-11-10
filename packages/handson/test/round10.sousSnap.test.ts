/**
 * Round 10 review: the sous-chef snap (r10-b's report). sousPose drew the newest walk under way from his post, so a walk
 * that took over while he was out on another made him jump across the kitchen. Now a walk sets off from where he is, a
 * late cover goes to the slip he was waiting under, and the lead-in follows the slip
 * that fell due first, sliding with it along the rail. Whole-shift coverage: game round7.careerUx (seeds 4, 5, 6, 8).
 */
import { describe, expect, it } from "vitest";
import { bookSousWalk, freeAt, SLOT_SLIDE, SOUS_POST, SOUS_WALK, shownSlot, sousPose, type SousPending, type SousWalk } from "../src/sous";

const item = (id: string) => ({ ticketId: id, dishId: "chips", table: 1 });
const railX = (i: number) => 4 + i * 4.2;
/** Largest per-frame step of the drawn pose over [a, b] at 60 fps. */
function maxStep(walksAt: (t: number) => readonly SousWalk[] | undefined, pendingAt: (t: number) => SousPending | undefined, a: number, b: number): number {
  let prev = sousPose(walksAt(a), a, railX, pendingAt(a)), worst = 0;
  for (let t = a + 1 / 60; t <= b; t += 1 / 60) {
    const p = sousPose(walksAt(t), t, railX, pendingAt(t));
    worst = Math.max(worst, Math.hypot(p.x - prev.x, p.y - prev.y));
    prev = p;
  }
  return worst;
}

describe("round 10 review: the sous chef never snaps", () => {
  it("a cover with no lead-in, booked while he walks to another due slip, sets off from where he is", () => {
    const pending: SousPending = { slot: 0, dueSince: 10 };
    const bookedAt = 10.5; // halfway to slot 0's rail spot
    const walks = bookSousWalk(undefined, item("q"), 0, bookedAt, undefined, pending);
    expect(walks[0]!.from).toEqual(pending);
    const was = sousPose(undefined, bookedAt - 1 / 60, railX, pending);
    const now = sousPose(walks, bookedAt, railX, pending);
    expect(Math.hypot(now.x - was.x, now.y - was.y)).toBeLessThan(0.6); // one frame of walking
    expect(now.x).toBeLessThan(SOUS_POST.x - 1); // not back at his post
    expect(maxStep((t) => (t < bookedAt ? undefined : walks), () => pending, 9.5, 20)).toBeLessThan(0.6);
  });

  it("without the lead-in stamp (old sessions, sousLead off) the walk still sets off from his post", () => {
    const walks = bookSousWalk(undefined, item("q"), 0, 10);
    expect(sousPose(walks, 10, railX)).toMatchObject({ x: SOUS_POST.x, y: SOUS_POST.y, phase: "toRail" });
  });

  it("pruning a finished trip can't move the lead-in a later walk set off from", () => {
    const first = bookSousWalk(undefined, item("a"), 0, 0);
    const free = freeAt(first);
    const pending: SousPending = { slot: 1, dueSince: free - 1 }; // fell due while he was busy: sets off at `free`
    const from = { slot: 1, dueSince: Math.max(pending.dueSince, free) }; // as the session stamps it
    const later = bookSousWalk(first, item("b"), 0, free + 0.4, undefined, from); // the first trip is pruned here
    expect(later).toHaveLength(1);
    const was = sousPose(first, free + 0.4 - 1 / 60, railX, pending);
    const now = sousPose(later, free + 0.4, railX, pending);
    expect(Math.hypot(now.x - was.x, now.y - was.y)).toBeLessThan(0.6); // one frame of walking
  });

  it("a due slip that moves along the rail: he slides with it", () => {
    const e = { slot: 0, slotFrom: 1, slotAt: 20 };
    expect(shownSlot(e, 20, 0)).toBe(1);
    expect(shownSlot(e, 20 + SLOT_SLIDE / 2, 0)).toBeCloseTo(0.5);
    expect(shownSlot(e, 20 + SLOT_SLIDE, 0)).toBe(0);
    expect(shownSlot({}, 20, 3)).toBe(3);
    const pendingAt = (t: number): SousPending => ({ slot: shownSlot(e, t, 0), dueSince: 10 });
    expect(maxStep(() => undefined, pendingAt, 19.5, 21)).toBeLessThan(0.6);
  });

  it("is pure: same walks and time, same pose; the walks are never mutated", () => {
    const walks = Object.freeze(bookSousWalk(undefined, item("q"), 0, 10.5, undefined, { slot: 0, dueSince: 10 }).map((w) => Object.freeze(w)));
    const a = sousPose(walks, 11 + SOUS_WALK.toRail, railX, { slot: 1, dueSince: 10.2 });
    const b = sousPose(walks, 11 + SOUS_WALK.toRail, railX, { slot: 1, dueSince: 10.2 });
    expect(a).toEqual(b);
  });
});

describe("round 10 review: a fitting night on the hands-on floor", () => {
  it("the fitters' tables are under dust sheets (no place settings); other nights draw the same as before", async () => {
    const { content } = await import("@full-plate/content");
    const { createFixture } = await import("../src/fixture");
    const { createSession } = await import("../src/session");
    const { render } = await import("../src/render");
    const { LayerCache } = await import("../src/layers");
    const { closedTableIds } = await import("@full-plate/sim-core");
    const f = createFixture({ role: "server" });
    const draw = (state: typeof f.state) => {
      const calls: string[] = [];
      const grad = { addColorStop() {} };
      const target: Record<string, unknown> = { fillText: () => {}, measureText: (t: string) => ({ width: t.length * 7 }), createLinearGradient: () => grad, createRadialGradient: () => grad };
      const ctx = new Proxy(target, {
        get: (o, k: string) => (k in o ? o[k] : (...a: unknown[]) => { calls.push(k + ":" + a.map((x) => (typeof x === "number" ? x.toFixed(1) : typeof x)).join(",")); }),
        set: (o, k: string, v) => { if (typeof v !== "function") calls.push(`${k}=${String(v)}`); o[k] = v; return true; },
      });
      const s = createSession(state, "server", { content });
      render(ctx as unknown as CanvasRenderingContext2D, s, state, { width: 1280, height: 800, layers: new LayerCache(() => undefined) });
      return calls;
    };
    const empty = { ...f.state, customers: [], tables: f.state.tables.map((t) => ({ ...t, occupiedBy: undefined, dirtyTicks: 0 })) };
    const fitting = { ...empty, decor: { slots: {}, fitting: { day: empty.day, tables: 2, slots: ["walls" as const] } } };
    expect(closedTableIds(fitting)).toHaveLength(2);
    const plain = draw(empty), fit = draw(fitting);
    expect(plain.filter((c) => c === "fillStyle=#efe9dc")).toHaveLength(0);
    expect(fit.filter((c) => c === "fillStyle=#efe9dc")).toHaveLength(2);
    expect(fit.length).toBeLessThan(plain.length); // two tables' place settings not drawn
  });
});
