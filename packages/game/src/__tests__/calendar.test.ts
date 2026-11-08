import { describe, expect, it } from "vitest";
import { dateLabel, weekdayIndex } from "../lib/calendar";
import { START_WEEKDAY, weekdayOf } from "../sim";

describe("calendar follows sim-core", () => {
  it("day 0 is the sim's start weekday (Wednesday) in April", () => {
    expect(weekdayIndex(0)).toBe(START_WEEKDAY);
    expect(dateLabel(0)).toBe("Wed 1 Apr · Year 1");
    expect(dateLabel(30)).toMatch(/^\w{3} 1 May/);
  });
  it("matches the rota index the sim uses for every day of a fortnight", () => {
    for (let d = 0; d < 14; d++) expect(weekdayIndex(d)).toBe(weekdayOf(d));
  });
});
