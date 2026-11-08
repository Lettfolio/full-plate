/**
 * TYPECHECK-ONLY fallback for "@full-plate/sim-core" while packages/sim-core/src/index.ts
 * does not exist yet. tsconfig.json `paths` lists the real index first and this file second,
 * so as soon as the real package lands TypeScript resolves to it and this file is ignored.
 *
 * The declarations below are copied verbatim from docs/ARCHITECTURE.md ("sim-core public API"),
 * and the types come straight from the real contract (types.ts) — so the game is typechecked
 * against the real contract either way. Never imported at runtime.
 */
import type { Candidate, Command, ContentPack, DishId, GameState, MenuQuadrant, StepResult } from "../../../sim-core/src/types";
export * from "../../../sim-core/src/types";

export declare function newGame(content: ContentPack, cmd: Extract<Command, { type: "NEW_GAME" }>): GameState;
export declare function applyCommand(content: ContentPack, state: GameState, cmd: Command): StepResult;
export declare function tick(content: ContentPack, state: GameState): StepResult;
export declare function runDay(content: ContentPack, state: GameState): StepResult;
export declare function candidates(content: ContentPack, state: GameState): Candidate[];
export declare function classifyMenu(content: ContentPack, state: GameState): Record<DishId, MenuQuadrant>;
export declare function serialize(state: GameState): string;
export declare function deserialize(json: string): GameState;
