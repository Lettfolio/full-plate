/** Round 6: the evening tips' rules and words live here (data/adviceText.json) and match sim-core's defaults exactly. */
import { describe, expect, it } from "vitest";
import { ADVICE_RULES, ADVICE_TEXT } from "../../sim-core/src/advice";
import { ADVICE_PLACEHOLDERS, content, validateContent } from "../src/index";

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe("adviceText", () => {
  it("ships every tip's rules and words, equal to sim-core's built-in ones", () => {
    expect(content.adviceText?.rules).toEqual(ADVICE_RULES);
    expect(content.adviceText?.text).toEqual(ADVICE_TEXT);
    expect(Object.keys(ADVICE_PLACEHOLDERS).sort()).toEqual(Object.keys(ADVICE_TEXT).sort());
  });

  it("rejects unknown placeholders, rules, kinds and out-of-range knobs", () => {
    const bad = clone(content);
    bad.adviceText!.text!.dog!.title = "Nobody orders the {dosh}.";
    bad.adviceText!.rules!.cooldownDays = -1;
    (bad.adviceText!.rules as Record<string, unknown>).nagNightly = 1;
    bad.adviceText!.rules!.priority = ["rota", "rota"];
    (bad.adviceText!.text as Record<string, unknown>).tidyUp = { title: "x" };
    const p = validateContent(bad).join("\n");
    expect(p).toMatch(/adviceText\.text\.dog\.title: unknown placeholder \{dosh\}/);
    expect(p).toMatch(/adviceText\.rules\.cooldownDays/);
    expect(p).toMatch(/unknown rule "nagNightly"/);
    expect(p).toMatch(/adviceText\.rules\.priority/);
    expect(p).toMatch(/unknown kind "tidyUp"/);
  });

  it("words are short enough for a card and free of jargon outside [[term|label]]", () => {
    for (const t of Object.values(content.adviceText!.text!)) {
      expect(t!.title!.length).toBeLessThanOrEqual(80);
      expect(t!.action!.length).toBeLessThanOrEqual(60);
      const plain = Object.values(t!).join(" ").replace(/\[\[[^\]]*\]\]/g, "").replace(/\{\w+\}/g, "");
      expect(plain).not.toMatch(/\b(spoilage|margin|covers|rota|KPI|COGS)\b/i);
    }
  });
});
