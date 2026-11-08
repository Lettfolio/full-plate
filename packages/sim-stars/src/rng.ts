/**
 * The seeded RNG is sim-core's xoshiro128** (never Math.random / Date).
 * sim-core's package `exports` only exposes ".", and index.ts does not re-export rng.ts, so this file reaches it by
 * relative path. STARS-NOTES.md asks sim-core to add `"./rng": "./src/rng.ts"` (or re-export Rng/hashSeed) so this
 * becomes `from "@full-plate/sim-core/rng"`.
 */
export { Rng, hashSeed, seedState } from "../../sim-core/src/rng";
export type { RngState } from "../../sim-core/src/rng";
