/** Round 5 review: the owner Service canvas draws table numbers on top of the guests (they hid most badges). */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(__dirname, "../canvas/RestaurantView.ts"), "utf8");

describe("RestaurantView draw order", () => {
  it("table numbers come after people and staff, and only there", () => {
    const body = src.slice(src.indexOf("this.updateSprites(game, L, dt, opts);"), src.indexOf("this.firstFrame = false;"));
    const at = (call: string) => body.indexOf(call);
    expect(at("this.drawTableNumbers(game, L);")).toBeGreaterThan(at("this.drawPeople(game, L, opts);"));
    expect(at("this.drawPeople(game, L, opts);")).toBeGreaterThan(at("this.drawStaff(game, L, opts, dt);"));
    expect(at("this.drawTableNumbers(game, L);")).toBeLessThan(at("this.drawHighlights(game, L, opts);"));
    // The table pass no longer paints its own number underneath.
    const tables = src.slice(src.indexOf("private drawTables("), src.indexOf("private drawTableNumbers("));
    expect(tables).not.toMatch(/String\(i \+ 1\)/);
  });
});
