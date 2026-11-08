/**
 * Stand-in for the "@full-plate/sim-core" module in stub mode (aliased in vite.config.ts).
 * Exposes the same runtime surface: the API functions plus the runtime constants from types.ts.
 */
export * from "./stubSim";
export const SERVICE_TICKS = 120;
export const MINUTES_PER_TICK = 5;
