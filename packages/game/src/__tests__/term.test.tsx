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
    expect(el.querySelector(".term__plain")!.textContent).toBe("Money the brand gets from each shop");
    expect(el.querySelector(".term__real")!.textContent).toBe("royalty");
    expect(el.getAttribute("title")).toBe(`royalty: ${GLOSSARY.royalty.explain}`);
  });

  it("children replace the plain label but keep the real word", () => {
    const { container } = render(<Term id="covers">Guests today</Term>);
    expect(screen.getByText("Guests today")).toBeTruthy();
    expect(container.querySelector(".term__real")!.textContent).toBe("covers");
  });

  it("inline form: a focusable abbr whose title carries the term and the one-liner", () => {
    render(<Term id="tronc" inline />);
    const abbr = screen.getByText("Shared tips");
    expect(abbr.tagName).toBe("ABBR");
    expect(abbr.getAttribute("tabindex")).toBe("0");
    expect(abbr.getAttribute("title")).toMatch(/^tronc: /);
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
