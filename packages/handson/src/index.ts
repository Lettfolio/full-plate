/** @full-plate/handson public API. */
export * from "./types";
export { COLD_PLATE_SECS, createSession, updateSession, nearestStation, openFoodTickets, openDrinkTickets, readyGroups, dirtyTables, payingParties, NO_INPUT, PLAYER_RADIUS } from "./session";
export type { SessionOptions } from "./session";
export { render, viewMetrics, C as HANDSON_PALETTE } from "./render";
export type { HandsOnView, ViewMetrics } from "./render";
export { nextHint } from "./hints";
export { summarise, coachingTip, emptyScore } from "./score";
export type { ShiftSummary } from "./score";
export { createInputSource, gamepadInput, mergeInputs } from "./input";
export type { InputSource } from "./input";
export { buildLayout, cookMethod, dishProfiles, WORLD_W, WORLD_H, MAX_TABLES } from "./layout";
export { TUNING, POINTS, cookQuality, chopHit, pourQuality, plateExecution, chefSpeedBonus, serveSpeedBonus } from "./verbs";
export { botInput, HESITATE_SECS } from "./bot";
export { commisStation, stationTickets, stationLevel, railCapOf, STATION_LEVELS, COVER_EXECUTION } from "./station";
export type { StationPlan, StationLevel } from "./station";
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
