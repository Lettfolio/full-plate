/** Round 12 (E): the voices data — gossip, the rival, the regulars, the blogger and the rewritten critic pool. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extras, fullContent } from "../src/index";
import { loadVoices, REGULAR_BEATS, starterDishIds, validateVoices, voices } from "../src/voices";

const count = (v: unknown): number => (typeof v === "string" ? 1 : Array.isArray(v) ? v.reduce((a: number, x) => a + count(x), 0) : v && typeof v === "object" ? Object.entries(v).filter(([k]) => !k.startsWith("_")).reduce((a, [, x]) => a + count(x), 0) : 0);
const districts = fullContent.districts.map((d) => d.id);

describe("voices data", () => {
  it("validates, and the validator catches a bad placeholder, a grown-up drink and an unknown dish", () => {
    expect(validateVoices(voices, starterDishIds(), districts)).toEqual([]);
    const bad = loadVoices();
    bad.gossip = { ...bad.gossip, patter: [...bad.gossip.patter, "A pint at {pub}."] };
    bad.regulars = { ...bad.regulars, regulars: bad.regulars.regulars.map((r, i) => (i ? r : { ...r, favourite: "ff_classic_stacker" })) };
    const p = validateVoices(bad, starterDishIds(), districts);
    expect(p.some((x) => x.includes("unknown placeholder {pub}"))).toBe(true);
    expect(p.some((x) => x.includes("grown-up drink"))).toBe(true);
    expect(p.some((x) => x.includes("ff_classic_stacker"))).toBe(true);
  });

  it("gossip has at least 120 lines (patter, two running jokes, reactions) and a station per district", () => {
    const g = voices.gossip;
    const lines = g.opening.length + g.patter.length + g.jokes.critic.length + g.jokes.bins.length + Object.values(g.reactions).flat().length;
    expect(lines).toBeGreaterThanOrEqual(120);
    for (const d of districts) expect(g.stations[d]).toBeTruthy();
  });

  it("8 rival personalities, 10 regulars with five beats each (intro + four VIP orders)", () => {
    expect(voices.rival.personalities).toHaveLength(8);
    expect(voices.regulars.regulars.length).toBeGreaterThanOrEqual(8);
    for (const r of voices.regulars.regulars) expect(r.beats).toHaveLength(REGULAR_BEATS);
    // the branching beats the brief asks for exist: a first date that goes well or badly, a break-up, exams, a birthday
    const all = JSON.stringify(voices.regulars);
    for (const w of [/first date/, /dumped/, /exam/i, /ninetieth/, /food truck/, /blog/]) expect(all).toMatch(w);
  });
});

describe("critics", () => {
  const raw = JSON.parse(readFileSync(join(__dirname, "..", "data", "criticText.json"), "utf8"));
  it("the local critic pool keeps every key and its size; the sommelier and the upturned crate stay", () => {
    for (const k of ["1", "2", "3", "4", "5"]) expect(raw.localCritic[k]).toHaveLength(4);
    expect(raw.criticNames).toHaveLength(5);
    expect(raw.inspectorRumours).toHaveLength(10);
  });
  it("the food blogger has a name, a blog and at least 30 lines, keyed 1-5 by rating", () => {
    const b = extras.criticText.blogger!;
    expect(b.name).toBe("Ruth Lessley");
    expect(count(b) - 3).toBeGreaterThanOrEqual(30);
    for (const k of ["1", "2", "3", "4", "5"]) {
      expect(b.headlines[k]!.length).toBeGreaterThanOrEqual(2);
      expect(b.reviews[k]!.length).toBeGreaterThanOrEqual(2);
    }
  });
});
