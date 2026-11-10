/** Round 5: <Term> shows a plain label first and never drops the real word (subtitle or tooltip, and the a11y name). */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Term } from "../components/Term";
import { GLOSSARY, type TermId } from "../lib/glossary";

afterEach(cleanup);

describe("Term", () => {
  it("block form: plain label, the real word beneath, the explanation as a tooltip", () => {
    const { container } = render(<Term id="royalty" />);
    const el = container.querySelector(".term")!;
    expect(el.querySelector(".term__plain")!.textContent).toBe("A share of their takings");
    expect(el.querySelector(".term__real")!.textContent).toBe("royalty");
    // Round 5 review: a real tooltip, focusable and linked for screen readers (a title never shows on focus).
    // Round 11 (D, U9): focusable by tap/click but out of the Tab order (tabindex -1); "?" opens the words sheet.
    expect(el.getAttribute("tabindex")).toBe("-1");
    const tip = document.getElementById(el.getAttribute("aria-describedby")!)!;
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.textContent).toBe(`royalty: ${GLOSSARY.royalty.explain}`);
    expect(el.contains(tip)).toBe(true);
  });

  it("children replace the plain label but keep the real word", () => {
    const { container } = render(<Term id="covers">Guests today</Term>);
    expect(screen.getByText("Guests today")).toBeTruthy();
    expect(container.querySelector(".term__real")!.textContent).toBe("covers");
  });

  it("inline form: a focusable abbr described by a tooltip carrying the term and the one-liner", () => {
    render(<Term id="tronc" inline />);
    const abbr = screen.getByText("Shared tips");
    expect(abbr.tagName).toBe("ABBR");
    expect(abbr.getAttribute("tabindex")).toBe("-1");
    expect(screen.getByRole("tooltip").textContent).toMatch(/^tronc: /);
    expect(abbr.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
  });

  it("two Terms get distinct tooltip ids; focus (a tap) lands on the term", () => {
    const { container } = render(<p><Term id="royalty" /><Term id="covers" inline /></p>);
    const ids = [...container.querySelectorAll("[aria-describedby]")].map((e) => e.getAttribute("aria-describedby"));
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(document.getElementById(id!)).toBeTruthy();
    (container.querySelector(".term") as HTMLElement).focus();
    expect(document.activeElement).toBe(container.querySelector(".term"));
  });

  it("every glossary entry is filled in, one line, and plainer than the term", () => {
    for (const [id, g] of Object.entries(GLOSSARY) as [TermId, (typeof GLOSSARY)[TermId]][]) {
      expect(g.term, id).toBeTruthy();
      expect(g.plain, id).toBeTruthy();
      expect(g.explain.length, id).toBeGreaterThan(10);
      expect(g.explain.length, id).toBeLessThan(140);
      expect(g.explain, id).not.toMatch(/\n/);
    }
  });
});
