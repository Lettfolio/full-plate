import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import type { ContentPack, GameState } from "@full-plate/sim-core";
import {
  botInput, createInputSource, createSession, hitTest, nextHint, padToMin, railSlotRect, railTagRect, readPalette, render, shiftTempo, stationRect, summarise,
  updateSession, yourStations, type HandsOnResult, type HandsOnRole, type HandsOnSession, type HandsOnView, type InputSource, type Rect, type ShiftSummary,
  type Palette, type StationPlan,
} from "@full-plate/handson";
import { content, HOOKS, SERVICE_TICKS } from "../sim";
import { clockLabel } from "../lib/calendar";
import { modalOpen } from "../lib/modal";
import { cardPlacement, markOnboardSeen, onboardingSteps, onboardSeen, type OnboardStep } from "../lib/onboarding";
import { createTouchControl, dragStick, prefersTouch } from "../lib/touchControl";
import { canvasDpr, createPerfMeter, devSwitches, perfEnabled, prefersReducedMotion } from "../lib/perfMeter";
import { prefsStorage } from "../lib/storage";
import { getSettings } from "../lib/settings";
import { BUZZ, buzz } from "../lib/haptics";
import { brandLook, canvasBrand } from "../canvas/brand";
import { layoutView, markPhoneHowToSeen, phoneHowToSeen, useHandsOnLayout, type HandsOnLayout } from "./handsonPhone";
import { HandsOnHowTo, phoneHowToCards } from "./HandsOnHowTo";
import "./handson-phone.css";

/**
 * Real seconds per sim tick while a hands-on session is live with no station (HANDSON-NOTES: a 120-tick service is 3
 * minutes). A career chef's station paces itself (handson `shiftTempo`: fast-forward on an empty rail, gentler for a
 * slow player).
 */
export const HANDS_ON_SECONDS_PER_TICK = 1.5;

/** Seconds until the next sim tick for this session (the station's tempo, else the flat pace). */
export const secondsPerTick = (session: HandsOnSession, game: GameState): number =>
  session.opts.station ? shiftTempo(session, game).secondsPerTick : HANDS_ON_SECONDS_PER_TICK;
/** `?autopilot=0.55` (skill) or `?autopilot=0.55,0.5` (skill, pace: 0.5 = a half-speed "slow child" bot). */
export function parseAutopilot(v: string | null): { skill: number; pace: number } | undefined {
  if (v === null) return undefined;
  const [a, b] = v.split(",");
  const unit = (x: string | undefined, d: number) => Math.max(0, Math.min(1, x === undefined || x === "" ? d : Number(x) || 0));
  return { skill: unit(a, 0), pace: unit(b, 1) };
}
const AUTOPILOT = (() => {
  // Round 11 (D, S12): a dev build, or the `full-plate:dev` localStorage flag (lib/perfMeter devSwitches).
  try { return devSwitches() ? parseAutopilot(new URLSearchParams(window.location.search).get("autopilot")) : undefined; } catch { return undefined; }
})();
const STEP = 1 / 60;

interface Props {
  game: GameState;
  role: HandsOnRole;
  /** Career mode: the player's Staff id (the chef only takes their own or unassigned tickets). */
  playerStaffId?: string;
  /** Career chef: their commis station (round 4); the rail shows only its tickets. */
  station?: StationPlan;
  /** Owner "Jump in": open-ended, with a "Back to the office" button. */
  jumpIn: boolean;
  /** Round 10 review: the career player's chosen look (skin and hair), so the sprite matches the portrait. */
  look?: { skin: string; hair: string };
  tutorial?: boolean;
  runTicks: (n: number) => void;
  sendResults: (results: HandsOnResult[]) => void;
  onLeave?: (summary: ShiftSummary) => void;
  onSkip: () => void;
  /** Called on unmount (end of service) with the score. */
  onDone: (summary: ShiftSummary) => void;
  /** The running score, reported just before each sim tick (so the evening's career step sees the shift). */
  onScore?: (summary: ShiftSummary) => void;
  /** Round 13 (F): a live co-op partner (screens/CoopLive.tsx). Absent: the shift is exactly as before. */
  remote?: HandsOnRemote;
  /** R13 review: the pack the session names dishes from (a live guest's carries the host's invented dishes). Default: the game's. */
  pack?: ContentPack;
}

/** Round 13 (F): what a live co-op shift hooks into the loop — where you are each frame, and a layer over the stage. */
export interface HandsOnRemote {
  /** Every frame, after the session steps (co-op publishes where you are). */
  onFrame(session: HandsOnSession): void;
  /**
   * Drawn over the stage: your partner, the link, the emotes. `stage` carries the phone layout's view flags (compact
   * strip, following camera) and `focus` is where you are, so the partner lands where the renderer puts the room
   * (R13 review: C's phone layouts moved the room under F's layer).
   */
  layer(stage: RemoteStage, focus: () => { x: number; y: number } | null): ReactNode;
}

/** Round 13 (review): the stage a remote layer draws over — its size and the layout's view flags. */
export type RemoteStage = { width: number; height: number } & Pick<HandsOnView, "compact" | "follow">;

const ROLE_LABEL: Record<HandsOnRole, string> = { chef: "On the pass", server: "On the floor", bar: "Behind the bar" };
/**
 * The HUD's kicker. A career commis owns a station, not the pass (round 4 review: it said "On the pass"). Round 7: the
 * station's own label only ("Sides · Desserts"), so it fits one line at 1024 px; the canvas rail tag names the station.
 */
export const shiftKicker = (role: HandsOnRole, jumpIn: boolean | undefined, station?: Pick<StationPlan, "title" | "label">): string =>
  `${jumpIn ? "Jumped in" : "Your shift"} · ${station ? station.label : ROLE_LABEL[role]}`;

/** Round 7: autopilot playtests page through the onboarding by themselves (seconds a step). */
const AUTOPILOT_STEP_SECS = 2.5;

/**
 * Round 13 (C): the canvas view for a stage at a layout — size, the phone options (strip header, camera, hit slop),
 * and the house uniform. The frame's draw, the taps' hit test and the onboarding spotlights all use this one.
 */
export function stageView(stage: { width: number; height: number }, layout: HandsOnLayout): HandsOnView {
  return { width: stage.width, height: stage.height, ...layoutView(layout), dress: (role, look) => brandLook(look, role, canvasBrand()) };
}

/** Round 13 (C): what a finished batch of results feels like in the hand (Settings › Sound and Buzz). */
export function resultBuzz(results: readonly HandsOnResult[]): number | readonly number[] | undefined {
  if (results.some((r) => r.type === "DROPPED")) return BUZZ.oops;
  if (results.some((r) => r.type === "PLATE_COOKED" || r.type === "TABLE_SERVED" || r.type === "PAYMENT_TAKEN")) return BUZZ.done;
  return undefined;
}

/** Round 7: an onboarding step's spotlight on the stage (CSS px), from the session's own layout. */
export function onboardTargetRect(step: OnboardStep, session: HandsOnSession, view: HandsOnView): Rect | undefined {
  if (step.target.kind === "rail") {
    if (session.role !== "chef" || !session.opts.station) return railSlotRect(view, 0, false);
    return { ...railTagRect(view), w: railTagRect(view).w + railSlotRect(view, 0).w + 14 };
  }
  const r = stationRect(session, view, step.target.stationId);
  return r ? padToMin({ x: r.x - 6, y: r.y - 6, w: r.w + 12, h: r.h + 12 }) : undefined;
}

/**
 * The playable shift (packages/handson): one 60 fps fixed-step loop reads keyboard/gamepad, steps the session, turns
 * its results into PLAYER_* commands, advances the sim at its own pace and draws. Mirrors handson/demo/main.ts.
 */
export function HandsOnShift({ game, role, playerStaffId, station, jumpIn, look, tutorial = true, runTicks, sendResults, onLeave, onSkip, onDone, onScore, remote, pack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const live = useRef({ game, runTicks, sendResults, onScore, remote });
  live.current = { game, runTicks, sendResults, onScore, remote };
  const sessionRef = useRef<HandsOnSession | null>(null);
  /** Round 13 (review): where you are, for a live partner's layer (the upright phone's camera follows you). */
  const focusOf = useCallback(() => sessionRef.current?.player ?? null, []);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [, force] = useState(0);
  // Round 13 (C): a phone sideways or upright gets its own layout (screens/handsonPhone.ts); the frame reads it live.
  const layout = useHandsOnLayout();
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const phone = layout !== "desk";
  // Round 7: touch play (tap to walk, press to use) and the first-shift onboarding.
  const [touchSeen, setTouch] = useState(prefersTouch);
  const touch = touchSeen || phone;
  const touchCtl = useRef(createTouchControl());
  const inputRef = useRef<InputSource | null>(null);
  const storage = prefsStorage(); // R13-E: namespaced, memory when blocked
  // Round 13 (C): on a phone the three-card how-to (once per role on this device) stands in for the R7 spotlight steps.
  const [onboard, setOnboard] = useState<number | null>(() =>
    (layout !== "desk" ? phoneHowToSeen(storage, role) || onboardSeen(storage, game.seed, role) : onboardSeen(storage, game.seed, role)) ? null : 0);
  const onboardRef = useRef(onboard);
  onboardRef.current = onboard;
  const [stage, setStage] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const input = createInputSource(window);
    inputRef.current = input;
    sessionRef.current = createSession(live.current.game, role, {
      content: pack ?? content, tutorial, ...(playerStaffId ? { playerStaffId } : {}), ...(station ? { station, sousLead: true } : {}), ...(look ? { look } : {}),
    });
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let tickAcc = 0;
    let sheetWasOpen = false;
    let lastHud = 0;
    let alive = true;
    // Round 8: theme colours read from the canvas once per resize; dpr capped at 2; `?perf=1` frame counter.
    let palette: Palette = readPalette(canvas);
    const perf = perfEnabled() ? createPerfMeter("handson") : undefined;
    const resize = () => {
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      const dpr = canvasDpr();
      palette = readPalette(canvas);
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      setStage((s) => (s.width === r.width && s.height === r.height ? s : { width: r.width, height: r.height }));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current!);
    resize();
    const frame = (now: number) => {
      // A dispatch inside this frame (results, ticks) can end the service and unmount us before the frame finishes.
      if (!alive || !wrapRef.current) return;
      perf?.begin(performance.now());
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const L = live.current;
      // R7 review (seam d): a sheet (Settings) holds the shift; when it closes, the keys go back to the cook, not to the
      // header button the sheet returned focus to (Space would open Settings again instead of using a station).
      const sheet = modalOpen();
      if (sheetWasOpen && !sheet) canvasRef.current?.focus();
      sheetWasOpen = sheet;
      if (!pausedRef.current && onboardRef.current === null && !sheet && L.game.phase === "service") {
        acc += dt;
        tickAcc += dt;
        input.setTouch(touchCtl.current.read(sessionRef.current!));
        // Playtests/attract mode: `?autopilot=0.4[,0.5]` lets the package's hint-following bot play (skill, pace).
        const inp = AUTOPILOT ? botInput(sessionRef.current!, L.game, AUTOPILOT.skill, AUTOPILOT.pace) : input.read();
        const results: HandsOnResult[] = [];
        while (acc >= STEP) {
          const r = updateSession(sessionRef.current!, L.game, inp, STEP);
          sessionRef.current = r.session;
          results.push(...r.results);
          acc -= STEP;
        }
        if (results.length) {
          L.sendResults(results);
          const b = resultBuzz(results);
          if (b !== undefined) buzz(b);
        }
        const spt = secondsPerTick(sessionRef.current!, L.game);
        const due = Math.floor(tickAcc / spt);
        if (due > 0) {
          tickAcc -= due * spt;
          L.onScore?.(summarise(sessionRef.current!));
          L.runTicks(Math.min(due, 4));
        }
      }
      if (!alive || !wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      // Round 13 (C): Settings › Animations off stills the canvas too (it already followed prefers-reduced-motion).
      render(ctx, sessionRef.current!, L.game, {
        ...stageView(rect, layoutRef.current), dpr: canvasDpr(), keyLabel: touchRef.current ? "USE" : "E", palette,
        reducedMotion: prefersReducedMotion() || !getSettings().animations,
      });
      if (perf) { perf.end(performance.now()); ctx.setTransform(canvasDpr(), 0, 0, canvasDpr(), 0, 0); perf.draw(ctx, 6, rect.height - 26); }
      L.remote?.onFrame(sessionRef.current!);
      if (now - lastHud > 500) { lastHud = now; force((x) => x + 1); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // Round 13 (C): playtests (the dev flag only) drive the shift with real touches: where a station is drawn, where
    // the hint points, and whether the package's bot would be holding USE right now. Read-only.
    const devHook = devSwitches();
    if (devHook) {
      const at = () => (wrapRef.current ? wrapRef.current.getBoundingClientRect() : undefined);
      (window as unknown as { __fpHandsOn?: unknown }).__fpHandsOn = {
        hint: () => (sessionRef.current ? nextHint(sessionRef.current, live.current.game)?.stationId ?? null : null),
        rect: (id: string) => { const r = at(); const sess = sessionRef.current; const sr = r && sess ? stationRect(sess, stageView(r, layoutRef.current), id) : undefined; return sr && r ? { x: r.left + sr.x, y: r.top + sr.y, w: sr.w, h: sr.h } : null; },
        state: () => { const sess = sessionRef.current; if (!sess) return null; const b = botInput(sess, live.current.game, 1); return { prompt: sess.prompt ? { stationId: sess.prompt.stationId, enabled: sess.prompt.enabled } : null, verb: sess.activeAction?.verb ?? null, wantsUse: !!b.interact, points: sess.score.points, plates: sess.score.plates, served: sess.score.served, carrying: sess.carrying?.kind ?? null, player: { x: sess.player.x, y: sess.player.y } }; },
        layout: () => layoutRef.current,
      };
    }
    canvas.focus();
    force((x) => x + 1); // the onboarding's steps and spotlight need the session: draw them now, not at the next HUD tick
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      input.dispose();
      inputRef.current = null;
      if (devHook) delete (window as unknown as { __fpHandsOn?: unknown }).__fpHandsOn;
      if (sessionRef.current) onDone(summarise(sessionRef.current));
    };
    // The session lives for the whole mount; role/playerStaffId don't change while mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Round 13 (C): no page scroll, rubber-band, pinch or double-tap zoom while a shift is on (html.fp-handson in
  // handson-phone.css; iOS Safari's pinch is a `gesturestart` it only skips when told to).
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("fp-handson");
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop);
    return () => { root.classList.remove("fp-handson"); document.removeEventListener("gesturestart", stop); };
  }, []);

  const s = sessionRef.current;
  const deskSteps = s ? onboardingSteps({ role, touch, ...(station ? { station: { appliance: yourStations(s)[0] } } : {}) }) : [];
  const phoneCards = phone ? phoneHowToCards(role, layout, station) : [];
  const stepCount = phone ? phoneCards.length : deskSteps.length;
  const finish = useCallback(() => {
    markOnboardSeen(storage, game.seed, role);
    if (layoutRef.current !== "desk") markPhoneHowToSeen(storage, role);
    setOnboard(null);
    canvasRef.current?.focus();
  }, [storage, game.seed, role]);
  const next = () => (onboard === null ? undefined : onboard + 1 >= stepCount ? finish() : setOnboard(onboard + 1));

  // Round 7: autopilot playtests page through the onboarding on their own.
  // R7 review: keyed on the step — with no deps the 500 ms HUD re-render reset the timer forever, so an autopilot
  // first shift sat on step 1 with the clock held (0 plates, and the onboarding never marked as seen).
  useEffect(() => {
    if (onboard === null || !AUTOPILOT) return;
    const id = window.setTimeout(() => next(), AUTOPILOT_STEP_SECS * 1000);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboard, stepCount]);

  // Round 13 (C): a finger that travels on the canvas is a drag stick (lib/touchControl dragStick) — unless the press
  // was the USE button (at her station, or during a verb), which stays a press however the finger wobbles.
  const drag = useRef<{ id: number; x: number; y: number; use: boolean } | null>(null);
  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch" && !touchSeen) setTouch(true);
    const sess = sessionRef.current;
    if (!sess || onboard !== null || paused) return;
    const r = e.currentTarget.getBoundingClientRect();
    const did = touchCtl.current.press(sess, hitTest(sess, stageView(r, layout), e.clientX - r.left, e.clientY - r.top));
    if (did === "use") buzz(BUZZ.tap);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, use: did === "use" };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: RPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || d.use) return;
    touchCtl.current.stick(dragStick(e.clientX - d.x, e.clientY - d.y));
  };
  const onPointerUp = () => { drag.current = null; touchCtl.current.release(); };
  /** R7 review (seam d): a bar button pressed with the mouse/finger hands the keys straight back to the cook (Space
   *  would otherwise press Pause again); a keyboard press (detail 0) keeps focus on the button. */
  const toCookIfPointer = (e: { detail: number }) => { if (e.detail > 0) canvasRef.current?.focus(); };
  const touchRef = useRef(touch);
  touchRef.current = touch;

  // Round 13 (C): the upright drag pad — a floating stick: where the thumb lands is the centre.
  const knobRef = useRef<HTMLSpanElement>(null);
  const pad = useRef<{ id: number; x: number; y: number } | null>(null);
  const padKnob = (dx: number, dy: number) => {
    const k = knobRef.current;
    if (!k) return;
    const d = Math.hypot(dx, dy), cap = 44, f = d > cap ? cap / d : 1;
    k.style.transform = `translate(${dx * f}px, ${dy * f}px)`;
  };
  const onPadDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (onboard !== null || paused) return;
    pad.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPadMove = (e: RPointerEvent<HTMLDivElement>) => {
    const p = pad.current;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    padKnob(dx, dy);
    touchCtl.current.stick(dragStick(dx, dy, 8, 44));
  };
  const onPadUp = () => { pad.current = null; padKnob(0, 0); touchCtl.current.stick(null); };

  const progress = Math.min(1, game.tick / SERVICE_TICKS);
  const step = onboard !== null && !phone ? deskSteps[onboard] : undefined;
  const view = stage.width ? stageView(stage, layout) : undefined;
  const spot = step && s && view ? onboardTargetRect(step, s, view) : undefined;

  const help = <button className="btn handson__btn handson__help" onClick={() => setOnboard(0)} aria-label="How to play" title="How to play">?</button>;
  const pauseBtn = (
    <button className="btn handson__btn handson__pause" onClick={(e) => { setPaused((p) => !p); toCookIfPointer(e); }} aria-pressed={paused} aria-label={phone ? (paused ? "Resume" : "Pause") : undefined}>
      {phone ? <><span aria-hidden="true">{paused ? "▶" : "❚❚"}</span><span className="handson__word" aria-hidden="true">{paused ? "Resume" : "Pause"}</span></> : paused ? "▶ Resume" : "❚❚ Pause"}
    </button>
  );
  const leaveBtn = jumpIn && onLeave
    ? <button className="btn handson__btn handson__leave" onClick={() => s && onLeave(summarise(s))}>{phone ? "Office" : "Back to the office"}</button>
    : null;
  const skipBtn = (
    <button className="btn btn--ghost handson__btn handson__skip" onClick={() => { if (s) onScore?.(summarise(s)); onSkip(); }} aria-label={phone ? (jumpIn ? "Skip to close" : "Skip to end of shift") : undefined}>
      {phone ? <><span aria-hidden="true">⏭</span><span className="handson__word" aria-hidden="true">Skip</span></> : jumpIn ? "Skip to close" : "Skip to end of shift"}
    </button>
  );
  const useBtn = (
    <button
      className="handson__use"
      aria-label="Use (hold to cook or pour)"
      onPointerDown={(e) => { e.preventDefault(); touchCtl.current.use(true); buzz(BUZZ.tap); }}
      onPointerUp={() => touchCtl.current.use(false)}
      onPointerCancel={() => touchCtl.current.use(false)}
      onPointerLeave={() => touchCtl.current.use(false)}
    >USE</button>
  );
  const dropBtn = (
    <button
      className="handson__drop"
      aria-label="Drop what you're holding"
      onPointerDown={(e) => { e.preventDefault(); touchCtl.current.drop(true); }}
      onPointerUp={() => touchCtl.current.drop(false)}
      onPointerCancel={() => touchCtl.current.drop(false)}
      onPointerLeave={() => touchCtl.current.drop(false)}
    >Drop</button>
  );
  const kicker = (
    <div className="handson__when">
      <div className="xs faint handson__kicker">{shiftKicker(role, jumpIn, station)}</div>
      <div className="handson__clock">{clockLabel(game.tick)}</div>
    </div>
  );
  const canvasEl = (
    <canvas
      ref={canvasRef}
      tabIndex={0}
      aria-label={`Hands-on ${role} shift. ${touch ? "Tap a station to walk there, or drag to steer; press it, or the USE button, to use it." : "Walk with WASD or the arrow keys; E to use a station."}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
  const overlays: ReactNode = (
    <>
      {remote?.layer({ ...stage, ...layoutView(layout) }, focusOf)}
      {step && (
        <div className="onboard" role="dialog" aria-modal="false" aria-labelledby="onboard-title">
          {spot && <div className="onboard__spot" style={{ left: spot.x, top: spot.y, width: spot.w, height: spot.h }} aria-hidden="true" />}
          <div
            className={`onboard__card onboard__card--${spot ? cardPlacement(spot, stage.height) : "below"}`}
            style={spot ? onboardCardStyle(spot, stage) : { left: "50%", top: 24, transform: "translateX(-50%)" }}
          >
            <div className="onboard__steps" aria-label={`Step ${(onboard ?? 0) + 1} of ${deskSteps.length}`}>
              {deskSteps.map((_, i) => <span key={i} className={`onboard__dot${i === onboard ? " onboard__dot--on" : ""}`} />)}
            </div>
            <h3 id="onboard-title">{step.title}</h3>
            <p>{step.text}</p>
            <div className="onboard__actions">
              <button className="btn btn--ghost handson__btn" onClick={finish}>Skip</button>
              <button className="btn btn--primary handson__btn" onClick={next} autoFocus>{onboard! + 1 >= deskSteps.length ? "Let's cook!" : "Next"}</button>
            </div>
          </div>
        </div>
      )}
      {phone && onboard !== null && <HandsOnHowTo cards={phoneCards} step={onboard} onNext={next} onSkip={finish} />}
      {paused && <div className="paused-badge">PAUSED</div>}
    </>
  );
  const practice = !HOOKS.player && (
    <div className="banner banner--amber" role="status">
      <span aria-hidden="true">🧪</span>
      <span>Practice mode: this build's sim doesn't take hands-on results yet, so the team cooks and serves as usual while you play.</span>
    </div>
  );
  const noMenu = (e: { preventDefault(): void }) => e.preventDefault(); // a long press (hold to cook) is not a context menu

  // One tree for every layout (the side columns and the controls row are slots that are empty off a phone), so turning
  // the phone mid-shift keeps the same canvas and stage elements — the frame loop and its ResizeObserver hold them.
  const sideways = layout === "sideways", upright = layout === "upright";
  return (
    <div className={`handson${touch ? " handson--touch" : ""}${phone ? ` handson--phone handson--${layout}` : ""}`} onContextMenu={touch ? noMenu : undefined}>
      {!sideways && (
        <div className="handson__bar">
          {kicker}
          {!upright && (
            <div className="clock__track" style={{ flex: 1 }}>
              <div className="clock__bar"><div className="clock__fill" style={{ width: `${progress * 100}%` }} /></div>
              <div className="clock__ends"><span>12:00</span><span>22:00</span></div>
            </div>
          )}
          {!touch && (
            <div className="handson__keys xs muted" aria-hidden="true">
              <kbd>WASD</kbd> walk · <kbd>E</kbd> use · <kbd>Q</kbd> drop
            </div>
          )}
          {help}
          {pauseBtn}
          {leaveBtn}
          {skipBtn}
        </div>
      )}
      <div className="handson__body">
        {sideways && (
          <div className="handson__side handson__side--l">
            {help}
            {pauseBtn}
            {skipBtn}
            <span className="handson__gap" />
            {onboard === null && dropBtn}
          </div>
        )}
        <div className="handson__main">
          {practice}
          <div className="handson__stage" ref={wrapRef}>
            {canvasEl}
            {!phone && touch && onboard === null && (
              <div className="handson__pad">
                {dropBtn}
                {useBtn}
              </div>
            )}
            {overlays}
          </div>
        </div>
        {sideways && (
          <div className="handson__side handson__side--r">
            {leaveBtn}
            <span className="handson__gap" />
            {onboard === null && useBtn}
          </div>
        )}
      </div>
      {upright && (
        <div className="handson__controls">
          <div className="handson__stick" onPointerDown={onPadDown} onPointerMove={onPadMove} onPointerUp={onPadUp} onPointerCancel={onPadUp} aria-hidden="true">
            <span className="handson__stickring"><span className="handson__knob" ref={knobRef} /></span>
            <span className="handson__word">Drag to walk</span>
          </div>
          <div className="handson__btns">
            {onboard === null && dropBtn}
            {onboard === null && useBtn}
          </div>
        </div>
      )}
    </div>
  );
}

/** Round 7: the onboarding card sits beside its spotlight (below it in the top half, above it in the bottom half). */
export function onboardCardStyle(spot: Rect, stage: { width: number; height: number }): { left: number; top?: number; bottom?: number; ["--arrow-x"]: string } {
  const W = Math.min(340, stage.width - 24);
  const cx = spot.x + spot.w / 2;
  const left = Math.max(12, Math.min(stage.width - W - 12, cx - W / 2));
  const arrow = `${Math.max(18, Math.min(W - 18, cx - left))}px`;
  return cardPlacement(spot, stage.height) === "below"
    ? { left, top: spot.y + spot.h + 16, "--arrow-x": arrow }
    : { left, bottom: stage.height - spot.y + 16, "--arrow-x": arrow };
}
