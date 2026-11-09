/** @full-plate/handson public API. */
export * from "./types";
export { COLD_PLATE_SECS, NUDGE_SHARE, sousName, createSession, updateSession, nearestStation, openFoodTickets, openDrinkTickets, readyGroups, dirtyTables, payingParties, NO_INPUT, PLAYER_RADIUS } from "./session";
export type { SessionOptions } from "./session";
export { render, viewMetrics, C as HANDSON_PALETTE, avoidPlayer, moodOf, slipTimeLeft, sousPending, withKey, yourStations } from "./render";
export { hitTest, MIN_TARGET_PX, padToMin, railSlotRect, railTagRect, railTarget, stationRect } from "./touch";
export type { Hit, Rect } from "./touch";
export type { HandsOnView, ViewMetrics } from "./render";
export { nextHint } from "./hints";
export { summarise, coachingTip, emptyScore, shiftNotes, starBars } from "./score";
export type { ShiftSummary, ShiftNote } from "./score";
export { createInputSource, gamepadInput, mergeInputs } from "./input";
export type { InputSource } from "./input";
export { buildLayout, cookMethod, dishProfiles, WORLD_W, WORLD_H, MAX_TABLES } from "./layout";
export { TUNING, POINTS, cookQuality, chopHit, pourQuality, plateExecution, chefSpeedBonus, serveSpeedBonus } from "./verbs";
export { botInput, HESITATE_SECS } from "./bot";
export { commisStation, stationTickets, stationLevel, railCapOf, STATION_LEVELS } from "./station";
export type { StationPlan, StationLevel } from "./station";
export { railView, courseMarkers, helperAtWork, coverSoon, HELPER_SUFFIX } from "./crew";
export type { RailEntry, RailOwner, CourseMarker, HelperWork } from "./crew";
export { bookSousWalk, freeAt, leadIn, sousPose, sousLine, standDown, walkEnd, walkStart, walkTimes, SOUS_WALK, SOUS_WALK_TOTAL, SOUS_POST } from "./sous";
export type { SousWalk, SousItem, SousPending, SousPose, SousPhase } from "./sous";
export { PACING, railCapFor, rollingPpm, shiftTempo } from "./pacing";
export type { ShiftTempo } from "./pacing";
export { findPath, steerToward, standTiles } from "./nav";
export { createFixture, advanceFixture, applyResults, FIXTURE_MENU } from "./fixture";
export type { Fixture, FixtureOptions } from "./fixture";

import type { HandsOnSession } from "./types";
/** Sessions are plain JSON. */
export function serialize(session: HandsOnSession): string { return JSON.stringify(session); }
export function deserialize(json: string): HandsOnSession {
  const s = JSON.parse(json) as HandsOnSession;
  if (s.version !== 1) throw new Error(`Unknown hands-on session version ${String(s.version)}`);
  return s;
}
