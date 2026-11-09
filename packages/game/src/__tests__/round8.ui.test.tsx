/**
 * Round 8 (B): the interface system. The Icon component's accessibility, tabs as icon + word, tables with a caption
 * and scoped headers, the 44 / 52 px control heights, the panel and stat-tile components, and the design tokens that
 * other agents' CSS and the canvas read from theme.css.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GameState } from "@full-plate/sim-core";
import { applyCommand, content, runDay } from "../sim";
import { suggestedStarterMenu } from "../lib/starterMenu";
import { baseGame } from "./fixtures/round2";
import { ArrowLabel, Icon, ICONS } from "../components/Icon";
import { Tabs } from "../components/Tabs";
import { Panel, StatTile } from "../components/Panel";
import { Evening } from "../screens/Evening";
import { StockTab } from "../screens/planning/StockTab";
import { stockNeeds } from "../screens/planning/stockNeeds";
import { DIFFICULTY_CHOICES } from "../components/DifficultyPicker";
import { STARTS } from "../screens/StartPicker";

afterEach(cleanup);
beforeEach(() => { try { localStorage.clear(); } catch { /* none */ } });
const noop = () => {};
const theme = readFileSync(join(__dirname, "../theme.css"), "utf8");
const EMOJI = /\p{Extended_Pictographic}/u;

function played(): GameState {
  let g = baseGame(81);
  for (const d of suggestedStarterMenu(content, g)) g = applyCommand(content, g, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice }).state;
  return runDay(content, g).state; // evening: history has today's result
}

describe("Icon", () => {
  it("is hidden from assistive tech when decorative", () => {
    const { container } = render(<button>Settings <Icon name="settings" /></button>);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.querySelector("title")).toBeNull();
    expect(screen.getByRole("button").textContent).toBe("Settings ");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("stroke-width")).toBe("1.75");
  });

  it("is an image with a title when it carries meaning on its own", () => {
    render(<Icon name="warning" title="Careful" size={20} />);
    const img = screen.getByRole("img", { name: "Careful" });
    expect(img.querySelector("title")!.textContent).toBe("Careful");
    expect(img.getAttribute("aria-hidden")).toBeNull();
    expect(img.getAttribute("width")).toBe("20");
  });

  it("has the set the brief asks for", () => {
    for (const n of ["menu", "stock", "rota", "money", "stars", "empire", "settings", "sound", "textSize", "speed", "pause", "play", "fastForward", "close", "back", "info", "warning", "check", "pin", "shop", "chefHat", "people", "trendUp", "trendDown"]) {
      expect(ICONS, n).toHaveProperty(n);
    }
  });

  it("ArrowLabel draws the arrow and keeps the button's name to the words", () => {
    render(<button><ArrowLabel text="Next day →" /></button>);
    const b = screen.getByRole("button", { name: "Next day" });
    expect(b.querySelector("svg.icon--forward")).not.toBeNull();
    expect(b.textContent).not.toContain("→");
  });
});

describe("Tabs: a picture and a word", () => {
  it("each tab shows a drawn icon (aria-hidden) and its label; the accessible name is the word", () => {
    render(<Tabs label="Planning" active="menu" onChange={noop} tabs={[{ id: "menu", label: "Menu", badge: 5 }, { id: "staff", label: "Staff" }, { id: "stock", label: "Stock" }, { id: "restaurant", label: "Restaurant" }, { id: "empire", label: "Empire" }, { id: "stars", label: "⭐ Stars" }]} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(6);
    for (const t of tabs) {
      const icon = t.querySelector(".tab__icon")!;
      expect(icon.getAttribute("aria-hidden")).toBe("true");
      expect(icon.querySelector("svg.icon")).not.toBeNull();
      expect(t.querySelector(".tab__label")!.textContent).toMatch(/^[A-Z][a-z]+$/);
      expect(t.textContent).not.toMatch(EMOJI);
    }
    expect(screen.getByRole("tab", { name: /^Stars/ })).toBeTruthy(); // a leading emoji in the label is dropped
    expect(screen.getByRole("tab", { name: /^Menu/ }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("Tables: caption and scope", () => {
  it("the evening's money table has a caption and the total is a row header", () => {
    const g = played();
    const { container } = render(<Evening game={g} result={g.history.at(-1)!} onNext={noop} nextLabel="Next day →" send={noop} />);
    const table = container.querySelector("table.pnl")!;
    expect(table.querySelector("caption")!.textContent).toMatch(/Where tonight's money went/);
    expect(table.querySelector('.pnl__total th[scope="row"]')!.textContent).toMatch(/Profit|Loss/);
    expect(screen.getByRole("button", { name: "Next day" })).toBeTruthy();
  });

  it("the order sheet has a caption, column headers and a row header per ingredient", () => {
    const g = played();
    const { container } = render(<StockTab game={g} send={noop} needs={stockNeeds(content, g)} />);
    const table = container.querySelector("table.stocktable")!;
    expect(table.querySelector("caption")).not.toBeNull();
    const cols = table.querySelectorAll('thead th[scope="col"]');
    expect(cols.length).toBe(table.querySelectorAll("thead th").length);
    const rows = table.querySelectorAll("tbody tr");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.querySelector('th[scope="row"]')).not.toBeNull();
  });
});

describe("Panel and StatTile", () => {
  it("a panel has one header row: title, subtitle, action", () => {
    render(<Panel title="What people said" sub="3 reviews" action={<button className="btn btn--sm">More</button>}><p>…</p></Panel>);
    const h = screen.getByRole("heading", { name: "What people said", level: 3 });
    const row = h.closest(".card__title")!;
    expect(within(row as HTMLElement).getByText("3 reviews").className).toMatch(/card__sub/);
    expect(within(row as HTMLElement).getByRole("button", { name: "More" })).toBeTruthy();
  });

  it("a stat tile says its delta in words and colour", () => {
    const { container } = render(<StatTile label="Walked out" value={4} delta={{ text: "3 this hour", dir: "up", good: "down" }} />);
    expect(container.querySelector(".kpi__k")!.textContent).toBe("Walked out");
    expect(container.querySelector(".kpi__v")!.textContent).toBe("4");
    const chip = container.querySelector(".stat-tile__delta")!;
    expect(chip.className).toMatch(/chip--down/); // up is bad here
    expect(chip.textContent).toBe("3 this hour");
  });
});

describe("Chrome uses drawn icons, not emoji", () => {
  it("difficulty badges and start cards name an Icon", () => {
    for (const d of DIFFICULTY_CHOICES) { expect(ICONS).toHaveProperty(d.icon); expect(d.icon).not.toMatch(EMOJI); }
    for (const s of STARTS) { expect(ICONS).toHaveProperty(s.icon); expect(s.icon).not.toMatch(EMOJI); }
  });
});

describe("Controls are 44 px (52 for the screen's one primary)", () => {
  /** The value of a property in the last rule for `selector` in theme.css (cascade order). */
  const last = (selector: string, prop: string) => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const all = [...theme.matchAll(new RegExp(`(?:^|\\n|\\}\\s*)${esc}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[1]!);
    const hits = all.map((b) => new RegExp(`${prop}:\\s*([^;]+);`).exec(b)?.[1]?.trim()).filter(Boolean);
    return hits.at(-1);
  };
  it("the tokens", () => {
    expect(/--control-h:\s*44px/.test(theme)).toBe(true);
    expect(/--control-h-lg:\s*52px/.test(theme)).toBe(true);
    expect(/--tap:\s*44px/.test(theme)).toBe(true);
  });
  it("every button class resolves to a token height", () => {
    expect(last(".btn", "min-height")).toBe("var(--control-h)");
    expect(last(".btn--sm", "min-height")).toBe("var(--control-h)");
    expect(last(".btn--tap", "min-height")).toBe("var(--control-h)");
    expect(last(".btn--xl", "min-height")).toBe("var(--control-h-lg)");
    expect(last(".iconbtn--tap", "width")).toBe("var(--tap)");
    expect(last(".switch", "height")).toMatch(/var\(--control-h\)/);
  });
  it("buttons in the shell carry those classes", () => {
    render(<Evening game={played()} result={null} onNext={noop} nextLabel="Next day →" send={noop} />);
    for (const b of screen.getAllByRole("button")) expect(b.className).toMatch(/\bbtn\b/);
  });
});

describe("Design tokens (agents A and C read these)", () => {
  const has = (n: string) => new RegExp(`--${n}:\\s*[^;]+;`).test(theme);
  it("Round 8 scale, spacing, radius, elevation, surfaces, semantics, charts, motion", () => {
    const names = [
      "fs-display", "lh-display", "fs-title", "lh-title", "fs-heading", "lh-heading", "fs-body", "lh-body", "fs-small", "lh-small", "fs-num",
      "space-1", "space-2", "space-3", "space-4", "space-5", "space-6", "space-8", "space-10",
      "radius-xs", "radius-sm", "radius-md", "radius-lg", "radius-pill",
      "elev-1", "elev-2", "elev-3",
      "surface-page", "surface-panel", "surface-raised", "surface-inset", "surface-ink", "on-ink", "on-ink-soft",
      "money-up", "money-down", "success", "warning", "danger", "info", "success-wash", "warning-wash", "danger-wash", "info-wash",
      "own", "franchise", "licence", "chart-grid", "chart-axis", "chart-up", "chart-down",
      "control-h", "control-h-lg", "focus-ring", "dur-fast", "dur", "ease",
    ];
    for (const n of names) expect(has(n), n).toBe(true);
  });
  it("keeps every earlier token (nothing renamed)", () => {
    const older = ["cream", "cream-deep", "paper", "ink", "ink-soft", "ink-faint", "line", "line-strong", "tomato", "tomato-deep", "tomato-wash", "basil", "basil-deep", "basil-wash", "amber", "amber-wash", "amber-deep", "plum", "plum-wash", "sky", "sky-wash", "sky-deep", "star", "star-empty", "star-edge", "font-display", "font-body", "fs-base", "fs-sm", "fs-xs", "fs-micro", "fs-label", "fs-h1", "fs-h2", "fs-h3", "r-sm", "r", "r-lg", "shadow", "shadow-lift", "gap", "beat-morning", "beat-service", "beat-evening", "tap", "awning", "hero-num", "cheer", "verdict-fair", "verdict-thin", "verdict-loses"];
    for (const n of older) expect(has(n), n).toBe(true);
  });
  it("Bigger text scales the new display sizes too", () => {
    expect(/:root\[data-text="large"\]\s*\{[^}]*--fs-display:\s*44px/.test(theme)).toBe(true);
  });
  it("transitions switch off under prefers-reduced-motion", () => {
    const blocks = [...theme.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]!).join("\n");
    expect(blocks).toMatch(/\.btn[^{]*\{[^}]*transition: none/);
    expect(blocks).toMatch(/\.modal[^{]*\{[^}]*animation: none/);
  });
});
