/** Round 3 review: no clock/Math.random, and the Stars path steps never write into their (deep-frozen) inputs. */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyCommand, newGame, strategies, STRATEGIES, type GameState } from "@full-plate/sim-core";
import { applyStarsCommand, applyStarsEffects, closedDay, newStarsState, prepareService, stepStarsDay, withSignatures } from "../src";
import { content } from "./helpers";

/** No clock or Math.random in the package sources (the headless CLIs and perf benchmarks may time themselves). */
function scanSources(): string[] {
  const dir = fileURLToPath(new URL("../src", import.meta.url));
  const bad: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".ts") || f === "headless.ts") continue;
    const lines = readFileSync(`${dir}/${f}`, "utf8").split("\n");
    lines.forEach((line, i) => {
      const code = line.replace(/\/\*.*?\*\//g, "").replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
      if (/Math\.random|Date\.now|new Date\b/.test(code)) bad.push(`${f}:${i + 1}`);
    });
  }
  return bad;
}

function deepFreeze<T>(x: T): T {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
  }
  return x;
}

describe("purity (sim-stars)", () => {
  it("sources never read the clock or Math.random", () => {
    expect(scanSources()).toEqual([]);
  });

  it("stepStarsDay, applyStarsEffects, prepareService and every command leave deep-frozen inputs untouched", () => {
    let g: GameState = newGame(content, { type: "NEW_GAME", seed: 4, districtId: "high_street", restaurantName: "Ice", difficulty: "normal" });
    for (let i = 0; i < 20; i++) g = strategies.runStrategyDay(content, g, STRATEGIES.balanced);
    let stars = newStarsState(content, deepFreeze(g));
    const ctx = () => ({ day: g.day, cash: 50_000_000, state: deepFreeze(g) });
    const cmds = [
      { type: "UNLOCK_TEST_KITCHEN" }, { type: "RESEARCH_DISH", dishId: g.menu[0]!.dishId }, { type: "SIGN_SOURCING", supplierId: "foragers" },
      { type: "UNLOCK_TICKETING" }, { type: "SET_TICKETING", prepaid: true, dynamicPricing: true }, { type: "SET_STAGIAIRE_POLICY", paid: false, count: 2 },
      { type: "OPEN_SATELLITE", kind: "bar" },
    ] as const;
    for (const c of cmds) stars = applyStarsCommand(content, deepFreeze(stars), c, ctx()).stars;
    for (let d = 0; d < 12; d++) {
      const cooking = withSignatures(content, stars);
      g = prepareService(deepFreeze(g), deepFreeze(stars));
      g = strategies.playService(cooking, g, true);
      const res = g.history.at(-1)!;
      const r = stepStarsDay(cooking, deepFreeze(stars), deepFreeze(res.covers > 0 ? res : closedDay(res.day)), deepFreeze(g));
      const fx = applyStarsEffects(deepFreeze(g), deepFreeze(r.stars));
      g = applyCommand(content, fx.state, { type: "END_DAY" }).state;
      stars = fx.stars;
    }
    const sat = stars.satellites[0]!;
    for (const c of [{ type: "TRAIN_SATELLITE_CHEF", satelliteId: sat.id }, { type: "CLOSE_FOR_REFIT", days: 3 }, { type: "RELAUNCH_CONCEPT" }, { type: "CLOSE_SATELLITE", satelliteId: sat.id }] as const) {
      stars = applyStarsCommand(content, deepFreeze(stars), c, ctx()).stars;
    }
    expect(stars.lastDay).toBeGreaterThan(20);
  });
});
