/**
 * The ONLY module in the game that touches the simulation or the content pack.
 * Everything else imports from "./sim" (types may come from "@full-plate/sim-core" directly).
 *
 * VITE_USE_STUBS=1 → the fake sim and content in src/dev/ (UI development while the real
 * packages are being built). Otherwise → the real @full-plate/sim-core and @full-plate/content.
 * Switching to the real packages is: unset the flag. Nothing else.
 */
import * as realSim from "@full-plate/sim-core";
import { content as realContent } from "@full-plate/content";
import * as stubSim from "./dev/stubSim";
import { stubContent } from "./dev/stubContent";
import type { Candidate, Command, ContentPack, DishId, GameState, MenuQuadrant, StepResult } from "@full-plate/sim-core";

export type * from "@full-plate/sim-core";

export const USING_STUBS = import.meta.env.VITE_USE_STUBS === "1";

interface SimApi {
  newGame(content: ContentPack, cmd: Extract<Command, { type: "NEW_GAME" }>): GameState;
  applyCommand(content: ContentPack, state: GameState, cmd: Command): StepResult;
  tick(content: ContentPack, state: GameState): StepResult;
  runDay(content: ContentPack, state: GameState): StepResult;
  candidates(content: ContentPack, state: GameState): Candidate[];
  classifyMenu(content: ContentPack, state: GameState): Record<DishId, MenuQuadrant>;
  serialize(state: GameState): string;
  deserialize(json: string): GameState;
}

const api: SimApi = USING_STUBS ? stubSim : realSim;

export const content: ContentPack = USING_STUBS ? stubContent : realContent;

export const { newGame, applyCommand, tick, runDay, candidates, classifyMenu, serialize, deserialize } = api;

export const SERVICE_TICKS: number = realSim.SERVICE_TICKS;
export const MINUTES_PER_TICK: number = realSim.MINUTES_PER_TICK;
