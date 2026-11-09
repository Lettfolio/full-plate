/** Round 5 review: Menu matrix labels stay inside the chart and off the quadrant titles ("Stars ★"). */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { MenuItem } from "@full-plate/sim-core";
import { labelWidth, MenuMatrix, shortName } from "../screens/planning/MenuMatrix";

afterEach(cleanup);
const W = 360, H = 300;
// The playtest's menu (Stars save, day 367): two stars near the top-right corner, long names.
const rows: [string, string, number, number][] = [
  ["cb", "Cheeseburger & fries", 60, 60 * 620], ["fc", "Fish & chips with mushy peas", 75, 75 * 540], ["fe", "All-day full English", 74, 74 * 500],
  ["stp", "Sticky toffee pudding", 20, 20 * 300], ["x", "Apple crumble", 26, 26 * 280], ["ch", "Chunky chips", 38, 38 * 180],
];
const items = rows.map(([dishId, , sold7d, margin7d]) => ({ dishId, price: 1000, active: true, sold7d, margin7d }) as unknown as MenuItem);
const names = Object.fromEntries(rows.map(([id, n]) => [id, n]));

describe("MenuMatrix labels", () => {
  it("are clamped inside the chart and never sit on a quadrant title or the axis label", () => {
    const { container } = render(<MenuMatrix items={items} quadrants={{}} names={names} fallbackMargin={() => 0} />);
    const titles = [...container.querySelectorAll("text")].filter((t) => /^(Puzzles|Stars ★|Dogs|Plough-horses)$/.test(t.textContent ?? ""));
    expect(titles).toHaveLength(4);
    const labels = [...container.querySelectorAll("text")].filter((t) => Object.values(names).map(shortName).includes(t.textContent ?? ""));
    expect(labels.length).toBeGreaterThanOrEqual(3);
    for (const l of labels) {
      const x = Number(l.getAttribute("x")), y = Number(l.getAttribute("y"));
      const w = labelWidth(l.textContent!);
      expect(x - w / 2, l.textContent!).toBeGreaterThanOrEqual(0);
      expect(x + w / 2, l.textContent!).toBeLessThanOrEqual(W);
      expect(y).toBeGreaterThan(14);
      expect(y).toBeLessThan(H);
      // "Stars ★" occupies the top-right corner up to y≈26.
      if (y < 34) expect(x + w / 2, `${l.textContent} vs Stars ★`).toBeLessThan(W - 10 - 66);
    }
  });

  it("cuts long names to fit", () => {
    expect(shortName("Fish & chips with mushy peas")).toBe("Fish & chips with mus…");
    expect(shortName("Chunky chips")).toBe("Chunky chips");
    expect(labelWidth(shortName("Chocolate brownie & ice cream"))).toBeLessThan(W / 2 + 30);
  });
});
