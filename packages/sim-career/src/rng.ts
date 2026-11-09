/**
 * The career layer's only randomness: sim-core's seeded xoshiro128** and hashSeed (sim-core's public index).
 * Career draws are stateless: every draw seeds a fresh Rng from hashSeed(career.seed, day, salt, …).
 */
export { hashSeed, Rng } from "@full-plate/sim-core";
