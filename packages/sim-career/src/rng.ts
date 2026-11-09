/**
 * The career layer's only randomness: sim-core's seeded xoshiro128** and hashSeed, imported by path because
 * sim-core's package exports only ".". (CAREER-NOTES asks for a "./rng" export so this can become a package import.)
 * Career draws are stateless: every draw seeds a fresh Rng from hashSeed(career.seed, day, salt, …).
 */
export { hashSeed, Rng } from "../../sim-core/src/rng";
