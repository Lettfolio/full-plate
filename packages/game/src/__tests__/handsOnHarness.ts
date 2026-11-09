/**
 * Headless career hands-on shift: the HandsOnShift loop (60 Hz session steps, a sim tick every HANDS_ON seconds) driven
 * through the real appReducer with the package's hint-following bot — what `?autopilot=` does in the browser.
 */
import { botInput, createSession, NO_INPUT, stationTickets, summarise, updateSession, type HandsOnSession, type ShiftSummary } from "@full-plate/handson";
import { PLAYER_ID } from "@full-plate/sim-career";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { content, weekdayOf } from "../sim";
import { secondsPerTick } from "../screens/HandsOnShift";

const STEP = 1 / 60;

export interface BotShift {
  app: AppState; summary: ShiftSummary; seconds: number; session: HandsOnSession;
  /** Seconds the player had nothing on their rail and nothing in hand (waiting for work). */
  drySeconds: number;
}
/** A bot: `skill` 0..1 timing, `pace` 0..1 walking/hesitation (0.5 = a slow child); `idle` plays nothing at all. */
export interface BotSpec { skill?: number; pace?: number; idle?: boolean }

export function careerChefStart(seed = 5, difficulty: "cosy" | "normal" = "cosy"): AppState {
  return appReducer(initialAppState, { type: "newCareer", seed, track: "chef", strategy: "balanced", playerName: "Robin", difficulty, districtId: "high_street" });
}

/** Plays one whole hands-on shift from planning; returns the evening AppState and the shift summary. */
export function playBotShift(start: AppState, bot: BotSpec = {}, maxSeconds = 900): BotShift {
  let s = appReducer(start, { type: "command", cmd: { type: "START_SERVICE" } });
  s = appReducer(s, { type: "handsOnStart", meta: { role: "chef", jumpIn: false } });
  const station = s.meta.handsOn?.station;
  let session = createSession(s.game!, "chef", { content, tutorial: true, playerStaffId: PLAYER_ID, ...(station ? { station } : {}) });
  let tickAcc = 0;
  let t = 0;
  let dry = 0;
  while (s.game!.phase === "service" && t < maxSeconds) {
    if (station && !session.carrying && stationTickets(session, s.game!).length === 0) dry += STEP;
    const inp = bot.idle ? NO_INPUT : botInput(session, s.game!, bot.skill ?? 0.55, bot.pace ?? 1);
    const r = updateSession(session, s.game!, inp, STEP);
    session = r.session;
    if (r.results.length) s = appReducer(s, { type: "handsOnResults", results: r.results });
    t += STEP;
    tickAcc += STEP;
    const secs = secondsPerTick(session, s.game!);
    if (tickAcc >= secs) {
      tickAcc -= secs;
      s = appReducer(s, { type: "handsOnScore", summary: summarise(session) });
      s = appReducer(s, { type: "ticks", n: 1 });
    }
  }
  return { app: s, summary: summarise(session), seconds: Math.round(t), session, drySeconds: Math.round(dry) };
}

/** A career run: every worked day is played hands-on by the bot; days off are skipped. Returns each worked shift. */
export function playBotDays(seed = 5, bot: BotSpec = {}, days = 7): (BotShift & { day: number })[] {
  let s = careerChefStart(seed);
  const out: (BotShift & { day: number })[] = [];
  for (let d = 0; d < days; d++) {
    const works = s.game!.staff.find((x) => x.id === PLAYER_ID)?.rota[weekdayOf(s.game!.day)] ?? false;
    if (works) {
      const r = playBotShift(s, bot);
      s = r.app;
      out.push({ ...r, day: d });
    } else {
      s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
      s = appReducer(s, { type: "skipShift" });
    }
    s = appReducer(s, { type: "nextDay" });
  }
  return out;
}
