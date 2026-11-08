/**
 * Hands-on demo: a playable 3-minute chef / server / bar shift against the fixture GameState. This file is the model
 * for how the game mounts the layer: one fixed-step loop that reads input, calls updateSession, turns results into
 * sim changes (here: the fixture's applyResults; in the game: PLAYER_* commands), advances the sim, then renders.
 *
 * `?role=server&t=40&auto=1` are debug params for screenshots: start role, fast-forward seconds, and a tiny autopilot.
 */
import { content } from "@full-plate/content";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/nunito/900.css";
import {
  advanceFixture, applyResults, botInput, createFixture, createInputSource, createSession, render, updateSession,
  type Fixture, type HandsOnInput, type HandsOnRole, type HandsOnSession,
} from "../src/index";

const SHIFT_SECONDS = 180;
const STEP = 1 / 60;

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("view") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const tutorialBox = document.getElementById("tutorial") as HTMLInputElement;
const input = createInputSource(window);

let role: HandsOnRole = (["chef", "server", "bar"].includes(params.get("role") ?? "") ? params.get("role") : "chef") as HandsOnRole;
let fixture: Fixture;
let session: HandsOnSession;
let acc = 0;
let last = performance.now();
let seed = Number(params.get("seed") ?? 20261108);

function start(r: HandsOnRole) {
  role = r;
  fixture = createFixture({ role, seed });
  session = createSession(fixture.state, role, { content, tutorial: tutorialBox.checked, shiftSeconds: SHIFT_SECONDS, seed: seed ^ 0xabc });
  for (const b of document.querySelectorAll<HTMLButtonElement>(".roles button")) b.setAttribute("aria-pressed", String(b.dataset.role === role));
  canvas.focus();
}

function step(inp: HandsOnInput) {
  const wasOver = session.shift?.over;
  const r = updateSession(session, fixture.state, inp, STEP);
  session = r.session;
  fixture = applyResults(fixture, r.results);
  if (!session.shift?.over) fixture = advanceFixture(fixture, STEP);
  // score screen: E to play again (after a beat so a held key doesn't skip it)
  if (wasOver && inp.interact && !prevInteract && performance.now() - overAt > 800) { seed++; start(role); }
  if (!wasOver && session.shift?.over) overAt = performance.now();
  prevInteract = inp.interact;
}
let prevInteract = false;
let overAt = 0;

// ── autopilot for screenshots: the package's hint-following bot ──
const auto = (): HandsOnInput => botInput(session, fixture.state, 0.85);
const autopilot = params.get("auto") === "1";

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
}

function frame(now: number) {
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  const inp = autopilot ? auto() : input.read();
  while (acc >= STEP) { step(inp); acc -= STEP; }
  const rect = canvas.getBoundingClientRect();
  render(ctx, session, fixture.state, { width: rect.width, height: rect.height, dpr: window.devicePixelRatio || 1, continueLabel: "Press E to play again · pick another role above" });
  requestAnimationFrame(frame);
}

for (const b of document.querySelectorAll<HTMLButtonElement>(".roles button")) b.addEventListener("click", () => start(b.dataset.role as HandsOnRole));
tutorialBox.addEventListener("change", () => { session = { ...session, tutorial: tutorialBox.checked }; canvas.focus(); });
window.addEventListener("keydown", (e) => { if (e.code === "KeyR") start(role); });
window.addEventListener("resize", resize);

start(role);
resize();
// debug fast-forward for screenshots
const ff = Number(params.get("t") ?? 0);
for (let i = 0; i < ff / STEP; i++) step(autopilot ? auto() : { up: false, down: false, left: false, right: false, interact: false, cancel: false });
requestAnimationFrame((t) => { last = t; frame(t); });
(window as unknown as { __handson: () => unknown }).__handson = () => ({ session, state: fixture.state });
