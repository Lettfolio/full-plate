/** Round 3 review: no clock/Math.random, and the career steps never write into their (deep-frozen) inputs. */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { applyCareerCommand, beginCareerDay, finishCareerDay, newCareer, ownerIncidentResponses, stepCareerDay, type CareerGame } from "../src";
import { applyCommand, tick } from "@full-plate/sim-core";
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

describe("purity (sim-career)", () => {
  it("sources never read the clock or Math.random", () => {
    expect(scanSources()).toEqual([]);
  });

  it("a fortnight of career days through the game's call order leaves deep-frozen inputs untouched", () => {
    let g: CareerGame = newCareer(content, { seed: 21, track: "chef", strategy: "premium" });
    for (const c of [{ type: "TAKE_SHIFT", weekday: 5, take: true }, { type: "MENTOR_SESSION" }, { type: "ASK_FOR_RAISE" }] as const) g = applyCareerCommand(content, deepFreeze(g), c).game;
    for (let d = 0; d < 14; d++) {
      const begun = beginCareerDay(content, deepFreeze(g));
      let s = applyCommand(content, deepFreeze(begun.game.state), { type: "START_SERVICE" }).state;
      while (s.phase === "service") {
        for (const cmd of ownerIncidentResponses(content, begun.game.career.owner.strategy, deepFreeze(s))) s = applyCommand(content, s, cmd).state;
        s = tick(content, deepFreeze(s)).state;
      }
      const r = stepCareerDay(content, deepFreeze(begun.game.career), deepFreeze(s), deepFreeze(s.history.at(-1)!));
      g = finishCareerDay(content, deepFreeze({ career: r.career, state: s }), r.nextOwnerCommands);
    }
    expect(g.career.day).toBeGreaterThanOrEqual(14);
  });
});
