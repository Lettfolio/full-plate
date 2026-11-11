/**
 * Round 13 (A): a fixed, deterministic floor for the renderer bench and the paused-frame diff (floor-bench.html, served
 * by the Vite dev server only — nothing imports this from the game, so it is not in the build). The states are
 * precomputed (below), so every build draws the same frames at the same times. `__floorBench.frame(i, now)` draws state i at time `now`; `bench(frames)` draws them back to back,
 * each flushed to pixels, and returns ms per frame; `passes(frames)` the same with the per-pass profile; `still(now)` draws one state at a fixed time for a screenshot.
 */
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/nunito/900.css";
import { advanceFixture, createFixture } from "@full-plate/handson";
import { applyCommand, deserialize, tick, type GameState } from "@full-plate/sim-core";
import { RestaurantView } from "../canvas/RestaurantView";
import { content } from "../sim";

const params = new URLSearchParams(location.search);
const W = Number(params.get("w") ?? innerWidth), H = Number(params.get("h") ?? innerHeight);
const dpr = Math.min(2, devicePixelRatio || 1);
const canvas = document.getElementById("floor") as HTMLCanvasElement;
canvas.style.width = `${W}px`; canvas.style.height = `${H}px`;

/**
 * The states: by default the audit save `owner-planning` (scripts/.audit-saves, made by the audit/probe scripts) opened
 * and run like the app at 4× — START_SERVICE, then 8 ticks a second, so frame i shows tick 8 + i·8/60 (12:40 → 16:00
 * over 300 frames, the lunchtime rush with a queue and walkers). `?state=fixture` uses the hands-on fixture instead.
 */
const states: GameState[] = [];
let perFrame = 1;
if (params.get("state") !== "fixture") {
  const save = await (await fetch("/scripts/.audit-saves/owner-planning.json")).json() as { game: string };
  let g = applyCommand(content, deserialize(save.game), { type: "START_SERVICE" }).state;
  for (let t = 0; t < 8; t++) g = tick(content, g).state;
  for (let t = 0; t < 112 && g.phase === "service"; t++) { states.push(g); g = tick(content, g).state; }
  perFrame = 8 / 60;
} else {
  let f = createFixture({ role: "server", seed: 11, busy: 2.2 });
  for (let i = 0; i < 60 * 25; i++) f = advanceFixture(f, 1 / 60);
  for (let i = 0; i < 360; i++) { f = advanceFixture(f, 4 / 60); states.push(f.state); }
}
const at = (i: number) => states[Math.min(states.length - 1, Math.floor(Math.max(0, i) * perFrame))]!;

let view = new RestaurantView(canvas);
view.resize(W, H, dpr);
const ctx = canvas.getContext("2d")!;
const sel = at(200).customers.find((c) => c.tableId)?.id ?? null;
const draw = (i: number, now: number, speed = 4) => view.render(at(i), { content, speed, now, selected: sel });

(window as unknown as { __floorBench: unknown }).__floorBench = {
  states: states.length,
  frame: draw,
  /** A fresh view (cold caches), then `frames` frames back to back from state 0, each flushed: ms per frame. */
  bench(frames = 300, warm = 60) {
    view = new RestaurantView(canvas); view.resize(W, H, dpr);
    for (let i = 0; i < warm; i++) draw(i, 1000 + i * 16.67);
    ctx.getImageData(0, 0, 1, 1);
    const t0 = performance.now();
    for (let i = warm; i < warm + frames; i++) { draw(i, 1000 + i * 16.67); ctx.getImageData(0, 0, 1, 1); }
    return (performance.now() - t0) / frames;
  },
  /** As bench, with the renderer's per-pass profile on (perfMeter.ts passProfile): ms per frame per pass. */
  passes(frames = 300, warm = 60) {
    view = new RestaurantView(canvas); view.resize(W, H, dpr);
    for (let i = 0; i < warm; i++) draw(i, 1000 + i * 16.67);
    const g = globalThis as { __fpPassProfile?: { ms: Record<string, number>; frames: number } | null };
    g.__fpPassProfile = { ms: {}, frames: 0 };
    for (let i = warm; i < warm + frames; i++) draw(i, 1000 + i * 16.67);
    const p = g.__fpPassProfile!; g.__fpPassProfile = null;
    return Object.fromEntries(Object.entries(p.ms).map(([k, v]) => [k, v / p.frames]));
  },
  /** One state at a fixed time, after `lead` frames of walking up to it (so sprites are where the sim puts them). */
  still(index = 200, now = 50_000, lead = Math.min(120, index)) {
    view = new RestaurantView(canvas); view.resize(W, H, dpr);
    for (let i = index - lead; i <= index; i++) draw(i, now - (index - i) * 16.67);
    draw(index, now, 0);
  },
};
document.title = "Floor bench ready";
