/**
 * Round 4: pacing for a career chef's station, so a 10-year-old always has the next ticket coming and the rail never
 * runs dry for long. Two knobs, both deterministic functions of the session and the GameState:
 *
 * - **Tempo** (`shiftTempo().secondsPerTick`): how many real seconds the host waits between sim ticks. An empty rail
 *   fast-forwards the restaurant (0.5 s a tick) so the next station ticket lands within seconds; a rail with room
 *   hurries a little; a full rail runs at the level's base pace, slowed further (up to ×1.5) for a player below their
 *   target plates per minute — fewer tickets pile up and go cold, and the shift stretches (at most ~5 minutes).
 * - **Rail size** (`railCapFor`): the level's cap, plus one for a player well above their target (busier, but they
 *   have shown they can juggle). The session emits RAIL_RESIZED when it changes; the game re-sends SET_HANDS_ON.
 *
 * Roles without a station (server, bar, owner jump-in) keep the flat HANDS_ON-notes pace of 1.5 s a tick.
 */
import type { GameState } from "@full-plate/sim-core";
import { railCapOf, stationTickets } from "./station";
import type { HandsOnSession } from "./types";

export const PACING = {
  /** Seconds per tick with no station (and the reference pace). */
  flatSpt: 1.5,
  /** Base seconds per tick by level (commis gets the gentlest restaurant). */
  baseSpt: [1.6, 1.5, 1.4, 1.3] as readonly number[],
  /** Empty rail: fast-forward until the next station ticket arrives. */
  drySpt: 0.5,
  /** Rail has room: hurry the next ticket a little. */
  roomFactor: 0.8,
  /** Full rail and the player below target: slow the restaurant by up to this much. */
  maxSlowFactor: 1.5,
  /** The rolling rate looks back this far (seconds) … */
  ppmWindowSecs: 120,
  /** … and only steers once the player has been at it this long (before that: on target). */
  warmupSecs: 45,
  /** At this multiple of the target rate the rail grows by one ticket (never above maxCap). */
  extraCapAt: 1.3,
  maxCap: 4,
} as const;

/** The player's own plates per minute over the last PACING.ppmWindowSecs (the target rate before warm-up). */
export function rollingPpm(session: HandsOnSession): number {
  const target = session.opts.station?.targetPpm ?? 2;
  if (session.time < PACING.warmupSecs) return target;
  const from = session.time - PACING.ppmWindowSecs;
  const n = (session.plateTimes ?? []).filter((t) => t > from).length;
  return n / (Math.min(PACING.ppmWindowSecs, session.time) / 60);
}

/** Rail size the player should have now: the level's, +1 when well above target. */
export function railCapFor(session: HandsOnSession): number {
  const st = session.opts.station;
  if (!st) return 0;
  const fast = session.time >= PACING.warmupSecs && rollingPpm(session) >= st.targetPpm * PACING.extraCapAt;
  return Math.min(PACING.maxCap, st.cap + (fast ? 1 : 0));
}

export interface ShiftTempo {
  secondsPerTick: number;
  /** The player's rail is empty and the restaurant is fast-forwarding to the next ticket. */
  dry: boolean;
  ppm: number;
  railSize: number;
}

export function shiftTempo(session: HandsOnSession, state: GameState): ShiftTempo {
  const st = session.opts.station;
  if (!st) return { secondsPerTick: PACING.flatSpt, dry: false, ppm: 0, railSize: 0 };
  const rail = stationTickets(session, state).length;
  const carrying = !!session.carrying && "ticketId" in session.carrying;
  const ppm = rollingPpm(session);
  const base = PACING.baseSpt[Math.max(0, Math.min(PACING.baseSpt.length - 1, st.level))]!;
  if (session.shift?.over) return { secondsPerTick: base, dry: false, ppm, railSize: rail };
  if (rail === 0 && !carrying) return { secondsPerTick: PACING.drySpt, dry: true, ppm, railSize: 0 };
  const cap = railCapOf(session, state);
  if (rail < cap) return { secondsPerTick: round3(base * PACING.roomFactor), dry: false, ppm, railSize: rail };
  const slow = ppm > 0 ? Math.min(PACING.maxSlowFactor, Math.max(1, st.targetPpm / ppm)) : PACING.maxSlowFactor;
  return { secondsPerTick: round3(base * slow), dry: false, ppm, railSize: rail };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;
