/**
 * sim-empire uses sim-core's seeded xoshiro128** RNG (never Math.random). sim-core's package entry does not
 * re-export it yet, so this file imports the module by path; when sim-core exports `Rng` from its index,
 * change this one line to `export { Rng, hashSeed, seedState } from "@full-plate/sim-core"`.
 */
export { Rng, hashSeed, seedState } from "../../sim-core/src/rng";
export type { RngState } from "../../sim-core/src/rng";
