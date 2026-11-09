import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import type { GameState } from "@full-plate/sim-core";
import {
  botInput, createInputSource, createSession, hitTest, padToMin, railSlotRect, railTagRect, render, shiftTempo, stationRect, summarise,
  updateSession, yourStations, type HandsOnResult, type HandsOnRole, type HandsOnSession, type InputSource, type Rect, type ShiftSummary,
  type StationPlan,
} from "@full-plate/handson";
import { content, HOOKS, SERVICE_TICKS } from "../sim";
import { clockLabel } from "../lib/calendar";
import { modalOpen } from "../lib/modal";
import { cardPlacement, markOnboardSeen, onboardingSteps, onboardSeen, type OnboardStep } from "../lib/onboarding";
import { createTouchControl, prefersTouch } from "../lib/touchControl";

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
  try { return parseAutopilot(new URLSearchParams(window.location.search).get("autopilot")); } catch { return undefined; }
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
  tutorial?: boolean;
  runTicks: (n: number) => void;
  sendResults: (results: HandsOnResult[]) => void;
  onLeave?: (summary: ShiftSummary) => void;
  onSkip: () => void;
  /** Called on unmount (end of service) with the score. */
  onDone: (summary: ShiftSummary) => void;
  /** The running score, reported just before each sim tick (so the evening's career step sees the shift). */
  onScore?: (summary: ShiftSummary) => void;
}

const ROLE_LABEL: Record<HandsOnRole, string> = { chef: "On the pass", server: "On the floor", bar: "Behind the bar" };
/**
 * The HUD's kicker. A career commis owns a station, not the pass (round 4 review: it said "On the pass"). Round 7: the
 * station's own label only ("Sides · Desserts"), so it fits one line at 1024 px; the canvas rail tag names the station.
 */
export const shiftKicker = (role: HandsOnRole, jumpIn: boolean | undefined, station?: Pick<StationPlan, "title" | "label">): string =>
  `${jumpIn ? "Jumped in" : "Your shift"} · ${station ? station.label : ROLE_LABEL[role]}`;

/** Round 7: autopilot playtests page through the onboarding by themselves (seconds a step). */
const AUTOPILOT_STEP_SECS = 2.5;

/** Round 7: an onboarding step's spotlight on the stage (CSS px), from the session's own layout. */
export function onboardTargetRect(step: OnboardStep, session: HandsOnSession, view: { width: number; height: number }): Rect | undefined {
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
export function HandsOnShift({ game, role, playerStaffId, station, jumpIn, tutorial = true, runTicks, sendResults, onLeave, onSkip, onDone, onScore }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const live = useRef({ game, runTicks, sendResults, onScore });
  live.current = { game, runTicks, sendResults, onScore };
  const sessionRef = useRef<HandsOnSession | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [, force] = useState(0);
  // Round 7: touch play (tap to walk, press to use) and the first-shift onboarding.
  const [touch, setTouch] = useState(prefersTouch);
  const touchCtl = useRef(createTouchControl());
  const inputRef = useRef<InputSource | null>(null);
  const storage = (() => { try { return window.localStorage; } catch { return undefined; } })();
  const [onboard, setOnboard] = useState<number | null>(() => (onboardSeen(storage, game.seed, role) ? null : 0));
  const onboardRef = useRef(onboard);
  onboardRef.current = onboard;
  const [stage, setStage] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const input = createInputSource(window);
    inputRef.current = input;
    sessionRef.current = createSession(live.current.game, role, {
      content, tutorial, ...(playerStaffId ? { playerStaffId } : {}), ...(station ? { station, sousLead: true } : {}),
    });
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let tickAcc = 0;
    let sheetWasOpen = false;
    let lastHud = 0;
    let alive = true;
    const resize = () => {
      if (!wrapRef.current) return;
      const r = wrapRef.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
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
        if (results.length) L.sendResults(results);
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
      render(ctx, sessionRef.current!, L.game, { width: rect.width, height: rect.height, dpr: window.devicePixelRatio || 1, keyLabel: touchRef.current ? "USE" : "E" });
      if (now - lastHud > 500) { lastHud = now; force((x) => x + 1); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    canvas.focus();
    force((x) => x + 1); // the onboarding's steps and spotlight need the session: draw them now, not at the next HUD tick
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      input.dispose();
      inputRef.current = null;
      if (sessionRef.current) onDone(summarise(sessionRef.current));
    };
    // The session lives for the whole mount; role/playerStaffId don't change while mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Round 7: autopilot playtests page through the onboarding on their own.
  useEffect(() => {
    if (onboard === null || !AUTOPILOT) return;
    const id = window.setTimeout(() => next(), AUTOPILOT_STEP_SECS * 1000);
    return () => window.clearTimeout(id);
  });

  const s = sessionRef.current;
  const steps = s ? onboardingSteps({ role, touch, ...(station ? { station: { appliance: yourStations(s)[0] } } : {}) }) : [];
  const finish = useCallback(() => { markOnboardSeen(storage, game.seed, role); setOnboard(null); canvasRef.current?.focus(); }, [storage, game.seed, role]);
  const next = () => (onboard === null ? undefined : onboard + 1 >= steps.length ? finish() : setOnboard(onboard + 1));

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch" && !touch) setTouch(true);
    const sess = sessionRef.current;
    if (!sess || onboard !== null || paused) return;
    const r = e.currentTarget.getBoundingClientRect();
    touchCtl.current.press(sess, hitTest(sess, { width: r.width, height: r.height }, e.clientX - r.left, e.clientY - r.top));
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerUp = () => touchCtl.current.release();
  /** R7 review (seam d): a bar button pressed with the mouse/finger hands the keys straight back to the cook (Space
   *  would otherwise press Pause again); a keyboard press (detail 0) keeps focus on the button. */
  const toCookIfPointer = (e: { detail: number }) => { if (e.detail > 0) canvasRef.current?.focus(); };
  const touchRef = useRef(touch);
  touchRef.current = touch;

  const progress = Math.min(1, game.tick / SERVICE_TICKS);
  const step = onboard !== null ? steps[onboard] : undefined;
  const spot = step && s && stage.width ? onboardTargetRect(step, s, stage) : undefined;
  return (
    <div className={`handson${touch ? " handson--touch" : ""}`}>
      <div className="handson__bar">
        <div className="handson__when">
          <div className="xs faint handson__kicker">{shiftKicker(role, jumpIn, station)}</div>
          <div className="handson__clock">{clockLabel(game.tick)}</div>
        </div>
        <div className="clock__track" style={{ flex: 1 }}>
          <div className="clock__bar"><div className="clock__fill" style={{ width: `${progress * 100}%` }} /></div>
          <div className="clock__ends"><span>12:00</span><span>22:00</span></div>
        </div>
        {!touch && (
          <div className="handson__keys xs muted" aria-hidden="true">
            <kbd>WASD</kbd> walk · <kbd>E</kbd> use · <kbd>Q</kbd> drop
          </div>
        )}
        <button className="btn handson__btn handson__help" onClick={() => setOnboard(0)} aria-label="How to play" title="How to play">?</button>
        <button className="btn handson__btn" onClick={(e) => { setPaused((p) => !p); toCookIfPointer(e); }} aria-pressed={paused}>{paused ? "▶ Resume" : "❚❚ Pause"}</button>
        {jumpIn && onLeave && <button className="btn handson__btn" onClick={() => s && onLeave(summarise(s))}>Back to the office</button>}
        <button className="btn btn--ghost handson__btn" onClick={() => { if (s) onScore?.(summarise(s)); onSkip(); }}>{jumpIn ? "Skip to close" : "Skip to end of shift"}</button>
      </div>
      {!HOOKS.player && (
        <div className="banner banner--amber" role="status">
          <span aria-hidden="true">🧪</span>
          <span>Practice mode: this build's sim doesn't take hands-on results yet, so the team cooks and serves as usual while you play.</span>
        </div>
      )}
      <div className="handson__stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          aria-label={`Hands-on ${role} shift. ${touch ? "Tap a station to walk there; press it, or the USE button, to use it." : "Walk with WASD or the arrow keys; E to use a station."}`}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
        {touch && onboard === null && (
          <div className="handson__pad">
            <button
              className="handson__drop"
              aria-label="Drop what you're holding"
              onPointerDown={(e) => { e.preventDefault(); touchCtl.current.drop(true); }}
              onPointerUp={() => touchCtl.current.drop(false)}
              onPointerCancel={() => touchCtl.current.drop(false)}
              onPointerLeave={() => touchCtl.current.drop(false)}
            >Drop</button>
            <button
              className="handson__use"
              aria-label="Use (hold to cook or pour)"
              onPointerDown={(e) => { e.preventDefault(); touchCtl.current.use(true); }}
              onPointerUp={() => touchCtl.current.use(false)}
              onPointerCancel={() => touchCtl.current.use(false)}
              onPointerLeave={() => touchCtl.current.use(false)}
            >USE</button>
          </div>
        )}
        {step && (
          <div className="onboard" role="dialog" aria-modal="false" aria-labelledby="onboard-title">
            {spot && <div className="onboard__spot" style={{ left: spot.x, top: spot.y, width: spot.w, height: spot.h }} aria-hidden="true" />}
            <div
              className={`onboard__card onboard__card--${spot ? cardPlacement(spot, stage.height) : "below"}`}
              style={spot ? onboardCardStyle(spot, stage) : { left: "50%", top: 24, transform: "translateX(-50%)" }}
            >
              <div className="onboard__steps" aria-label={`Step ${(onboard ?? 0) + 1} of ${steps.length}`}>
                {steps.map((_, i) => <span key={i} className={`onboard__dot${i === onboard ? " onboard__dot--on" : ""}`} />)}
              </div>
              <h3 id="onboard-title">{step.title}</h3>
              <p>{step.text}</p>
              <div className="onboard__actions">
                <button className="btn btn--ghost handson__btn" onClick={finish}>Skip</button>
                <button className="btn btn--primary handson__btn" onClick={next} autoFocus>{onboard! + 1 >= steps.length ? "Let's cook!" : "Next"}</button>
              </div>
            </div>
          </div>
        )}
        {paused && <div className="paused-badge">PAUSED</div>}
      </div>
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
