/** Round 10 (B): staffQuotes.json (ContentPack.staffText). */
import { describe, expect, it } from "vitest";
import { DISLIKE_IDS, LIKE_IDS, quoteFor } from "@full-plate/sim-core";
import { content, STAFF_DISLIKE_IDS, STAFF_LIKE_IDS, validateContent } from "../src/index";

describe("staffText (staffQuotes.json)", () => {
  it("ships with the pack and validates", () => {
    expect(content.staffText).toBeDefined();
    expect(validateContent(content)).toEqual([]);
  });

  it("the local id lists match sim-core's", () => {
    expect([...STAFF_LIKE_IDS]).toEqual(LIKE_IDS);
    expect([...STAFF_DISLIKE_IDS]).toEqual(DISLIKE_IDS);
  });

  it("every archetype has at least four short quotes, and quoteFor uses them", () => {
    for (const a of content.staffArchetypes) {
      const q = content.staffText!.quotes![a.id]!;
      expect(q.length, a.id).toBeGreaterThanOrEqual(4);
      for (const line of q) expect(line.length).toBeLessThanOrEqual(70);
      expect(q).toContain(quoteFor(content, a.id, { id: "s1-0", name: a.nameSamples[0]!, role: a.role }));
    }
  });

  it("rejects unknown keys, missing labels and empty quote lists", () => {
    const bad = (staffText: unknown) => validateContent({ ...content, staffText });
    expect(bad({ quotes: { nobody: ["Hi"] } }).join()).toMatch(/unknown archetype/);
    expect(bad({ quotes: { server: [] } }).join()).toMatch(/non-empty/);
    expect(bad({ likes: { busy_nights: "x" } }).join()).toMatch(/missing "quiet_nights"/);
    expect(bad({ dislikes: { ...content.staffText!.dislikes, fryer: "the fryer" } }).join()).toMatch(/unknown id "fryer"/);
    expect(bad({ quotes: { server: ["x".repeat(80)] } }).join()).toMatch(/longer than 70/);
    expect(bad("nope").join()).toMatch(/staffText: expected an object/);
  });
});
