import { describe, expect, it } from "vitest";
import { content } from "@full-plate/content";
import { createFixture } from "../src/fixture";
import { createSession } from "../src/session";
import { emptyScore, shiftNotes, starBars, summarise } from "../src/score";
import type { HandsOnScore, HandsOnSession } from "../src/types";
import type { StationPlan } from "../src/station";

const plan: StationPlan = { level: 0, title: "Commis station", label: "Soup", dishIds: ["tomato_soup"], cap: 2, idleCoverSecs: 30, hardCoverSecs: 80, targetPpm: 2.2 };
function withScore(score: Partial<HandsOnScore>, station = true): HandsOnSession {
  const f = createFixture({ role: "chef", seed: 3 });
  const s = createSession(f.state, "chef", { content, ...(station ? { station: plan } : {}) });
  return { ...s, score: { ...emptyScore(), ...score } };
}

describe("end-of-shift notes (round 4)", () => {
  it("three one-liners: what went well, then the one thing to work on", () => {
    const n = shiftNotes(withScore({ plates: 9, qualitySum: 9 * 90, speedBonus: 7.2, speedCount: 9, perfect: 2, slowPlates: 2, points: 700 }));
    expect(n).toEqual([
      { text: "Fast on the pass!", tone: "good" },
      { text: "Beautiful plates — 90% quality!", tone: "good" },
      { text: "Two plates went cold", tone: "work" },
    ]);
  });

  it("a clean shift gets three good notes; an empty one is encouraged, never scolded", () => {
    const clean = shiftNotes(withScore({ plates: 12, qualitySum: 12 * 80, speedBonus: 9, speedCount: 12, points: 1100 }));
    expect(clean.map((x) => x.tone)).toEqual(["good", "good", "good"]);
    expect(clean.map((x) => x.text)).toContain("12 plates — what a busy shift!");
    const none = shiftNotes(withScore({ covered: 3 }));
    expect(none[0]).toEqual({ text: "Every chef starts somewhere!", tone: "good" });
    expect(none[2]!.text).toBe("The sous chef covered three for you");
  });

  it("a commis station has gentler star bars; summarise carries the notes", () => {
    expect(starBars(withScore({}))[1]).toBeLessThan(starBars(withScore({}, false))[1]);
    const sum = summarise(withScore({ plates: 8, qualitySum: 8 * 80, speedBonus: 5, speedCount: 8, points: 450 }));
    expect(sum.stars).toBe(2);
    expect(sum.notes).toHaveLength(3);
  });

  it("round 5: the sous chef sending what a busy commis couldn't reach is teamwork; only idle covers are a 'work on'", () => {
    const busy = shiftNotes(withScore({ plates: 9, qualitySum: 9 * 70, speedBonus: 3, speedCount: 9, covered: 18, points: 500 }));
    expect(busy.map((x) => x.text).join(" | ")).not.toMatch(/covered/);
    const away = shiftNotes(withScore({ plates: 9, qualitySum: 9 * 90, speedBonus: 8, speedCount: 9, covered: 18, idleCovers: 2, points: 600 }));
    expect(away[2]).toEqual({ text: "The sous chef covered two tickets while you were away", tone: "work" });
    expect(summarise(withScore({ covered: 4 })).lines).toContainEqual({ label: "Sous chef helped", value: "4 while you were busy" });
    expect(summarise(withScore({ covered: 10, idleCovers: 3 })).lines).toContainEqual({ label: "Sous chef helped", value: "7 while you were busy, 3 while you were away" });
  });
});
