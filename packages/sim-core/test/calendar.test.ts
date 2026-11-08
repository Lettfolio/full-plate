import { describe, expect, it } from "vitest";
import { isWeekend, monthOf, weekdayOf, worksToday } from "../src/util";
import { staffMember } from "./helpers";

describe("calendar and rota", () => {
  it("day 0 is a Wednesday in April; weekends are Fri-Sun", () => {
    expect(weekdayOf(0)).toBe(2);
    expect(monthOf(0)).toBe(4);
    expect(monthOf(30)).toBe(5);
    expect(monthOf(270)).toBe(1); // wraps into January
    expect([0, 1, 2, 3, 4, 5, 6].map(isWeekend)).toEqual([false, false, true, true, true, false, false]); // Wed..Tue
  });
  it("rota index follows the weekday, not day % 7", () => {
    const monOnly = staffMember({ rota: [true, false, false, false, false, false, false] });
    expect(worksToday(monOnly, 5)).toBe(true); // day 5 = Monday
    expect(worksToday(monOnly, 0)).toBe(false);
  });
});
