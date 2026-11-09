/** Round 3 review: no clock/Math.random in the session code, and updateSession never writes into its (deep-frozen) inputs. */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { content } from "@full-plate/content";
import { advanceFixture, applyResults, createFixture } from "../src/fixture";
import { createSession, updateSession } from "../src/session";
import { botInput } from "../src/bot";

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

describe("purity (handson)", () => {
  it("sources never read the clock or Math.random (input.ts reads the gamepad, not the clock)", () => {
    expect(scanSources()).toEqual([]);
  });

  for (const role of ["chef", "server", "bar"] as const) {
    it(`${role}: 20 s of bot play with deep-frozen session, state and input`, () => {
      let f = createFixture({ role, seed: 5 });
      let s = createSession(deepFreeze(f.state), role, { content, seed: 5 });
      let results = 0;
      for (let i = 0; i < 1200; i++) {
        const input = deepFreeze(botInput(deepFreeze(s), f.state, 1));
        const r = updateSession(deepFreeze(s), deepFreeze(f.state), input, 1 / 60);
        s = r.session;
        results += r.results.length;
        f = advanceFixture(applyResults(f, r.results), 1 / 60);
      }
      expect(results).toBeGreaterThan(0);
    });
  }
});
