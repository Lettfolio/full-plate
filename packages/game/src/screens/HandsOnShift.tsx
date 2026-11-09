import { useEffect, useRef, useState } from "react";
import type { GameState } from "@full-plate/sim-core";
import {
  botInput, createInputSource, createSession, render, summarise, updateSession,
  type HandsOnResult, type HandsOnRole, type HandsOnSession, type ShiftSummary,
} from "@full-plate/handson";
import { content, HOOKS, SERVICE_TICKS } from "../sim";
import { clockLabel } from "../lib/calendar";

/** Real seconds per sim tick while a hands-on session is live (HANDSON-NOTES: a 120-tick service is 3 minutes). */
export const HANDS_ON_SECONDS_PER_TICK = 1.5;
const AUTOPILOT: number | undefined = (() => {
  try {
    const v = new URLSearchParams(window.location.search).get("autopilot");
    return v === null ? undefined : Math.max(0, Math.min(1, Number(v) || 0));
  } catch { return undefined; }
})();
const STEP = 1 / 60;

interface Props {
  game: GameState;
  role: HandsOnRole;
  /** Career mode: the player's Staff id (the chef only takes their own or unassigned tickets). */
  playerStaffId?: string;
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
 * The playable shift (packages/handson): one 60 fps fixed-step loop reads keyboard/gamepad, steps the session, turns
 * its results into PLAYER_* commands, advances the sim at its own pace and draws. Mirrors handson/demo/main.ts.
 */
export function HandsOnShift({ game, role, playerStaffId, jumpIn, tutorial = true, runTicks, sendResults, onLeave, onSkip, onDone, onScore }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const live = useRef({ game, runTicks, sendResults, onScore });
  live.current = { game, runTicks, sendResults, onScore };
  const sessionRef = useRef<HandsOnSession | null>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const [, force] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const input = createInputSource(window);
    sessionRef.current = createSession(live.current.game, role, { content, tutorial, ...(playerStaffId ? { playerStaffId } : {}) });
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let tickAcc = 0;
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
      if (!pausedRef.current && L.game.phase === "service") {
        acc += dt;
        tickAcc += dt;
        // Playtests/attract mode: `?autopilot=0.4` lets the package's hint-following bot play at that skill.
        const inp = AUTOPILOT !== undefined ? botInput(sessionRef.current!, L.game, AUTOPILOT) : input.read();
        const results: HandsOnResult[] = [];
        while (acc >= STEP) {
          const r = updateSession(sessionRef.current!, L.game, inp, STEP);
          sessionRef.current = r.session;
          results.push(...r.results);
          acc -= STEP;
        }
        if (results.length) L.sendResults(results);
        const due = Math.floor(tickAcc / HANDS_ON_SECONDS_PER_TICK);
        if (due > 0) {
          tickAcc -= due * HANDS_ON_SECONDS_PER_TICK;
          L.onScore?.(summarise(sessionRef.current!));
          L.runTicks(Math.min(due, 4));
        }
      }
      if (!alive || !wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      render(ctx, sessionRef.current!, L.game, { width: rect.width, height: rect.height, dpr: window.devicePixelRatio || 1 });
      if (now - lastHud > 500) { lastHud = now; force((x) => x + 1); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    canvas.focus();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      input.dispose();
      if (sessionRef.current) onDone(summarise(sessionRef.current));
    };
    // The session lives for the whole mount; role/playerStaffId don't change while mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = sessionRef.current;
  const progress = Math.min(1, game.tick / SERVICE_TICKS);
  return (
    <div className="handson">
      <div className="handson__bar">
        <div>
          <div className="xs faint handson__kicker">{jumpIn ? "Jumped in" : "Your shift"} · {ROLE_LABEL[role]}</div>
          <div className="handson__clock">{clockLabel(game.tick)}</div>
        </div>
        <div className="clock__track" style={{ flex: 1 }}>
          <div className="clock__bar"><div className="clock__fill" style={{ width: `${progress * 100}%` }} /></div>
          <div className="clock__ends"><span>12:00</span><span>22:00</span></div>
        </div>
        <div className="handson__score" aria-live="off">
          <b>{Math.round(s?.score.points ?? 0)}</b> <span className="xs muted">points</span>
        </div>
        <div className="handson__keys xs muted" aria-hidden="true">
          <kbd>WASD</kbd> walk · <kbd>E</kbd> use (hold to cook/pour) · <kbd>Q</kbd> cancel · gamepad works too
        </div>
        <button className="btn btn--sm" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>{paused ? "▶ Resume" : "❚❚ Pause"}</button>
        {jumpIn && onLeave && <button className="btn btn--sm" onClick={() => s && onLeave(summarise(s))}>Back to the office</button>}
        <button className="btn btn--sm btn--ghost" onClick={() => { if (s) onScore?.(summarise(s)); onSkip(); }}>{jumpIn ? "Skip to close" : "Skip to end of shift"}</button>
      </div>
      {!HOOKS.player && (
        <div className="banner banner--amber" role="status">
          <span aria-hidden="true">🧪</span>
          <span>Practice mode: this build's sim doesn't take hands-on results yet, so the team cooks and serves as usual while you play.</span>
        </div>
      )}
      <div className="handson__stage" ref={wrapRef}>
        <canvas ref={canvasRef} tabIndex={0} aria-label={`Hands-on ${role} shift. Walk with WASD or the arrow keys; E to use a station.`} />
        {paused && <div className="paused-badge">PAUSED</div>}
      </div>
    </div>
  );
}
