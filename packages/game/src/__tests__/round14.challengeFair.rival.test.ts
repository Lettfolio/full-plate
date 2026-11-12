// @vitest-environment node
/** Round 14 (D): the daily challenge's fairness sweep for "rival" (challengeFair.ts says what it checks). */
import { expect, it } from "vitest";
import { FAIR_DATES, summary, sweep } from "./challengeFair";

it("rival: five Skips miss, degenerate play never pays, honest play meets, room above the best script", async () => {
  const rows = await sweep("rival");
  expect(rows).toHaveLength(FAIR_DATES);
  console.info(summary("rival", rows));
}, 3_600_000);
