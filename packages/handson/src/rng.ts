/**
 * sim-core's seeded RNG, imported by path: sim-core's public index does not export `Rng` yet (round 3 must not edit
 * sim-core). When the lead adds `export { Rng, hashSeed } from "./rng"` to sim-core's index, change this line to
 * `export { Rng, hashSeed } from "@full-plate/sim-core";` — nothing else in this package needs to change.
 */
export { Rng, hashSeed } from "../../sim-core/src/rng";
export type { RngState } from "../../sim-core/src/rng";
