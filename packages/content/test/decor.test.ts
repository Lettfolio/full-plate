/** Round 10: the decorating catalogue (data/decor.json) — shape, prices, the starter kit and the validator. */
import { describe, expect, it } from "vitest";
import { content, DECOR_SLOT_IDS, DECOR_TAGS, fullContent, validateContent } from "../src/index";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const decor = content.decor!;

describe("decor catalogue", () => {
  it("ships in both packs and validates", () => {
    expect(fullContent.decor).toEqual(content.decor);
    expect(validateContent(content)).toEqual([]);
  });

  it("has 4–6 items per slot with one free starter, in pence, cheap to lavish", () => {
    for (const slot of DECOR_SLOT_IDS) {
      const items = decor.items.filter((i) => i.slot === slot);
      expect(items.length, slot).toBeGreaterThanOrEqual(4);
      expect(items.length, slot).toBeLessThanOrEqual(6);
      expect(items.filter((i) => i.starter)).toHaveLength(1);
      const bought = items.filter((i) => !i.starter).map((i) => i.price);
      for (const p of bought) expect(Number.isInteger(p)).toBe(true);
      // somewhere from pocket money (< £500) to a proper splash (≥ £600)
      expect(Math.min(...bought), slot).toBeLessThan(50_000);
      expect(Math.max(...bought), slot).toBeGreaterThanOrEqual(55_000);
    }
  });

  it("every bought item has a tag, a short description, a night line and a refresh cheaper than buying", () => {
    for (const i of decor.items.filter((x) => !x.starter)) {
      expect(i.tags.length, i.id).toBeGreaterThan(0);
      for (const t of i.tags) expect(DECOR_TAGS).toContain(t);
      expect(i.description.length, i.id).toBeLessThanOrEqual(120);
      expect(i.nightLine, i.id).toBeTruthy();
      expect(i.refreshCost, i.id).toBeLessThan(i.price);
      expect(i.lifeDays, i.id).toBeGreaterThan(0);
    }
  });

  it("names every style and only nudges known segments a little", () => {
    const segs = content.segments.map((s) => s.id);
    for (const tag of DECOR_TAGS) {
      const st = decor.styles[tag as keyof typeof decor.styles];
      expect(st.name).toBeTruthy();
      for (const [seg, v] of Object.entries(st.segments)) {
        expect(segs).toContain(seg);
        expect(Math.abs(v)).toBeLessThanOrEqual(0.25);
      }
    }
  });

  it("the validator catches a bad item", () => {
    const bad = clone(content);
    const it0 = bad.decor!.items.find((i) => !i.starter)!;
    it0.slot = "roof" as never;
    (it0.effects as Record<string, number>).prestige = 9;
    it0.refreshCost = it0.price + 1;
    bad.decor!.items.push(clone(bad.decor!.items[0]!));
    const problems = validateContent(bad).join("\n");
    expect(problems).toMatch(/unknown slot/);
    expect(problems).toMatch(/effects\.prestige/);
    expect(problems).toMatch(/refreshCost/);
    expect(problems).toMatch(/duplicate id/);
  });
});
