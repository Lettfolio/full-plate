/** Round 3 review: no clock/Math.random, and the Empire steps never write into their (deep-frozen) inputs. */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyEmpireCommand, forkFromGameState, stepEmpireDay, type EmpireCommand, type EmpireState } from "../src";
import { content, empire, withApplicant } from "./helpers";
import { newGame, strategies, STRATEGIES } from "@full-plate/sim-core";

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

describe("purity (sim-empire)", () => {
  it("sources never read the clock or Math.random", () => {
    expect(scanSources()).toEqual([]);
  });

  it("forkFromGameState, stepEmpireDay and commands leave deep-frozen inputs untouched", () => {
    let g = newGame(content, { type: "NEW_GAME", seed: 3, districtId: "high_street", restaurantName: "Ice", difficulty: "normal" });
    for (let i = 0; i < 16; i++) g = strategies.runStrategyDay(content, g, STRATEGIES.balanced);
    const forked = forkFromGameState(content, deepFreeze(g), { brandName: "Ice Burgers" });
    expect(forked.sites).toHaveLength(1);
    let e: EmpireState = withApplicant(empire());
    const send = (c: EmpireCommand) => { e = applyEmpireCommand(content, deepFreeze(e), c).empire; };
    send({ type: "SET_FORMULA", locked: true });
    send({ type: "RESEARCH", tech: "academy" });
    send({ type: "OPEN_SITE", cityId: "harbourton", districtId: "seaside", ownership: "company", land: "hqLease" });
    send({ type: "OPEN_SITE", cityId: "harbourton", districtId: "business_park", ownership: "franchise", land: "hqLease", applicantId: "a_test" });
    send({ type: "ENTER_CITY", cityId: "kingsbridge" });
    send({ type: "SIGN_SUPPLIER", supplierId: "spudline", exclusive: true });
    send({ type: "LAUNCH_CAMPAIGN", kind: "brand", budget: 5_000_000 });
    send({ type: "SET_CONTRACT", contract: { royaltyPct: 0.06 }, applyTo: "all" });
    for (let d = 0; d < 120; d++) e = stepEmpireDay(content, deepFreeze(e), deepFreeze(g.history.at(-1)!)).empire;
    send({ type: "BUY_PROPERTY", siteId: "s1" });
    send({ type: "REMODEL", siteId: "s1" });
    send({ type: "TRANSFER_FROM_FOCUSED", amount: 10_000 });
    expect(e.hq.day).toBeGreaterThan(100);
  });
});
