import { describe, expect, it } from "vitest";
import { content } from "@full-plate/content";
import { profileFor, shortName } from "../src/layout";

describe("dish profiles", () => {
  it("every content dish gets a short slip name (≤ 14 chars) and a cooking method", () => {
    for (const d of content.dishes) {
      const p = profileFor(d.id, content);
      expect(p.short.length, d.name).toBeLessThanOrEqual(14);
      expect(p.cost).toBeGreaterThan(0);
      if (d.course === "drink") expect(p.method).toBe("pour");
    }
    expect(shortName("Spaghetti carbonara")).toBe("Carbonara");
    expect(shortName("Fish & chips with mushy peas")).toBe("Fish & chips");
    expect(shortName("Pint of lager")).toBe("Lager");
  });
});
