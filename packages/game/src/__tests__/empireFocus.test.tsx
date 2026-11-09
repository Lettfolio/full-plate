/**
 * Round 3 (REVIEW P2): "Run it hands-on" builds a fresh GameState for the site via sim-empire's newGameFromSite
 * (its district, the brand menu, a locally hired crew), instead of copying the flagship's staff.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EmpireTab } from "../screens/paths/EmpireTab";
import type { GameState } from "@full-plate/sim-core";
import { BRAND_PULL_SOURCE, defaultCalibration } from "@full-plate/sim-empire";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { FORK_DAY, initialMeta } from "../state/paths";
import { applyCommand, content, runDay, suggestedOrder } from "../sim";

/** Text as a sighted reader sees it: without the <Term> tooltips (hidden until hover/focus). */
function visibleText(el: Element): string {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll(".term__tip").forEach((t) => t.remove());
  return c.textContent ?? "";
}

function forkedEmpire(): AppState {
  let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 21, districtId: "high_street", restaurantName: "Focus Test", difficulty: "cosy" } });
  for (const id of ["beef_burger", "chicken_burger", "chunky_chips", "soft_drink"]) {
    const d = content.dishes.find((x) => x.id === id)!;
    s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: id, price: d.suggestedPrice } });
  }
  s = appReducer(s, { type: "command", cmd: { type: "HIRE", candidateIndex: 0 } });
  let g = s.game!;
  for (let d = 0; d < 20 && g.phase !== "gameover"; d++) {
    g = runDay(content, g).state;
    for (const o of suggestedOrder(content, g)) g = applyCommand(content, g, { type: "ORDER_STOCK", ...o }).state;
    if (g.phase === "event") g = applyCommand(content, g, { type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === g.activeEvent?.eventId)!.choices[0]!.id }).state;
    else if (g.phase === "evening") g = applyCommand(content, g, { type: "END_DAY" }).state;
  }
  const jumped: GameState = { ...g, day: FORK_DAY };
  s = { ...s, game: jumped, meta: { ...initialMeta("owner"), lastPathDay: FORK_DAY - 1 } };
  s = appReducer(s, { type: "fork", choice: "empire", brandName: "Focus Burgers" });
  // An open second site in the Student Quarter (as if built 200 days ago).
  const e = s.meta.empire!;
  const site = { ...e.sites[0]!, id: "s2", name: "Focus Campus", districtId: "student_quarter", focused: false, staffQuality: 45, opened: e.hq.day - 200 };
  delete site.tables;
  delete site.popularity;
  delete site.prestige;
  return { ...s, meta: { ...s.meta, empire: { ...e, sites: [...e.sites, site] } } };
}

describe("Run it hands-on", () => {
  it("builds the promoted site's own restaurant: its district, the brand menu, a local crew of its quality", () => {
    const s0 = forkedEmpire();
    const flagshipStaff = s0.game!.staff.map((x) => x.id);
    const s = appReducer(s0, { type: "focusSite", siteId: "s2" });
    const g = s.game!;
    expect(s.meta.empire!.focusedSiteId).toBe("s2");
    expect(g.restaurantName).toBe("Focus Campus");
    expect(g.districtId).toBe("student_quarter");
    expect(g.day).toBe(s0.game!.day);
    expect(g.menu.map((m) => m.dishId).sort()).toEqual([...s0.meta.empire!.brand.formula.menuDishIds].sort());
    expect(g.staff).toHaveLength(4);
    expect(g.staff.some((x) => flagshipStaff.includes(x.id))).toBe(false);
    for (const x of g.staff) expect(Math.abs(x.skill - 45)).toBeLessThan(16);
    expect(g.loan.remaining).toBe(0);
    expect(g.stock.length).toBeGreaterThan(0);
    // The brand's pull on this site (recognition, consistency, a smaller city...) rides along as a footfall mod.
    const mod = g.footfallMods.find((m) => m.source === BRAND_PULL_SOURCE);
    if (mod) expect(mod.mult).toBeGreaterThan(0);
    // The flagship is parked and comes back as it was.
    expect(s.meta.parked?.s1).toBeTruthy();
    const back = appReducer(s, { type: "focusSite", siteId: "s1" });
    expect(back.game!.restaurantName).toBe("Focus Test");
    expect(back.game!.staff.map((x) => x.id)).toEqual(flagshipStaff);
  });

  it("is deterministic: the same empire promotes to the same GameState", () => {
    const a = appReducer(forkedEmpire(), { type: "focusSite", siteId: "s2" }).game!;
    const b = appReducer(forkedEmpire(), { type: "focusSite", siteId: "s2" }).game!;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("EmpireTab sites copy (round 3)", () => {
  afterEach(cleanup);
  it("splits each site's covers into the dining room you'd run hands-on and the takeaway lanes", () => {
    let s = forkedEmpire();
    s = appReducer(s, { type: "empire", cmd: { type: "SET_FORMULA", locked: true } });
    const { container } = render(<EmpireTab game={s.game!} meta={s.meta} empire={s.meta.empire!} send={() => {}} onFocusSite={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /My shops/ }));
    expect(screen.getByText(/Hands-on, you run the dining room; the takeaway counter adds about 40% on top/)).toBeTruthy();
    // Round 5: "guests" and "crew skill" are <Term>s, so match the card's text rather than one element.
    expect(visibleText(container.querySelector(".sitelist")!)).toMatch(/guests today: \d+ in the dining room \(\d+ tables, crew skill \d+\) \+ \d+ takeaway/);
  });
});

describe("round 4 review: the contract panel warns before the formula is locked", () => {
  afterEach(cleanup);
  const panel = (s: AppState) => {
    render(<EmpireTab game={s.game!} meta={s.meta} empire={s.meta.empire!} send={() => {}} onFocusSite={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /Money/ }));
  };
  it("shows 'Lock your formula first' on the contract panel until the formula is locked", () => {
    const s = forkedEmpire();
    expect(s.meta.empire!.brand.formula.locked).toBe(false);
    panel(s);
    const note = screen.getByLabelText("Formula warning");
    expect(note.textContent).toContain("Lock your formula first — franchisees of an unstandardised brand lose money.");
    expect(note.textContent).toMatch(/The brand → Lock the formula: every site/);
    expect(note.textContent!.match(/first/g)).toHaveLength(1);
    cleanup();
    panel(appReducer(s, { type: "empire", cmd: { type: "SET_FORMULA", locked: true } }));
    expect(screen.queryByLabelText("Formula warning")).toBeNull();
  });

  it("round 5: says what a new franchisee should clear in year one under the current terms", () => {
    const outlook = () => screen.getByLabelText("Franchisee outlook").textContent!;
    let s = forkedEmpire();
    panel(s);
    // Unlocked: the honest verdict.
    expect(outlook()).toMatch(/^Your franchisee would lose about £[\d,]+ a year in your best spot \(.+\) — they'll lose money\./);
    cleanup();
    s = appReducer(s, { type: "empire", cmd: { type: "SET_FORMULA", locked: true } });
    for (const sup of s.meta.empire!.suppliers) s = appReducer(s, { type: "empire", cmd: { type: "SIGN_SUPPLIER", supplierId: sup.id, exclusive: sup.failureRisk < 0.05 } });
    // This fixture's flagship is a 20-day cosy room on four dishes (57 covers a day): give the brand the reference High
    // Street calibration so the line reads a proven formula.
    s = { ...s, meta: { ...s.meta, empire: { ...s.meta.empire!, calibration: defaultCalibration(content) } } };
    panel(s);
    expect(outlook()).toMatch(/^Your franchisee should clear about £[\d,]+,000 a year in your best spot \([A-Za-z ]+, Harbourton\) — (fair|they'll only just get by)\./);
    expect(outlook()).toMatch(/Other places differ/);
    cleanup();
    // Squeeze the terms: the line turns.
    s = appReducer(s, { type: "empire", cmd: { type: "SET_CONTRACT", contract: { royaltyPct: 0.12, rentPctOfSales: 0.16 }, applyTo: "new" } });
    panel(s);
    expect(outlook()).toMatch(/they'll lose money\./);
  });
});

describe("round 5: the Empire side panel is three cards and keeps every control", () => {
  afterEach(cleanup);
  it("My shops / The brand / Money, with plain labels and the real terms beneath", () => {
    const s = forkedEmpire();
    const { container } = render(<EmpireTab game={{ ...s.game!, cash: 5_000_000 }} meta={s.meta} empire={s.meta.empire!} send={() => {}} onFocusSite={() => {}} />);
    const tabs = screen.getAllByRole("tab", { name: /My shops|The brand|Money/ });
    expect(tabs.map((t) => t.textContent)).toEqual(["🏪 My shops", "🍔 The brand", "💷 Money"]);

    // My shops: the city (open a site) and every site's actions.
    expect(screen.getAllByRole("button", { name: /^Company ·/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Run it hands-on/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Buy the plot/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Remodel" }).length).toBeGreaterThan(0);
    expect(container.querySelector(".sitenums")!.textContent).toMatch(/Profit this week.*margin \(7 days\)/);

    fireEvent.click(screen.getByRole("tab", { name: /The brand/ }));
    expect(screen.getByRole("button", { name: "Lock the formula" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Brand campaign/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Sign$/ }).length).toBeGreaterThan(0);
    expect(screen.getByText("How alike your shops are")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /Money/ }));
    expect(screen.getByRole("button", { name: "Move to HQ" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Raise Royalty" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lower fee" })).toBeTruthy();
    const royalty = screen.getByText("Money the brand gets from each shop").closest(".term")!;
    expect(royalty.querySelector(".term__real")!.textContent).toBe("royalty");
  });
});

describe("round 5 review: each district says how a franchisee would do; the collapse line is today's", () => {
  afterEach(cleanup);
  it("a verdict beside every Franchise button, and the city's sales line in today's pounds", () => {
    let s = forkedEmpire();
    s = appReducer(s, { type: "empire", cmd: { type: "SET_FORMULA", locked: true } });
    const e0 = s.meta.empire!;
    const e = { ...e0, calibration: defaultCalibration(content), applicants: e0.applicants.length ? e0.applicants : [{ id: "a1", name: "Sam Applicant", cash: 50_000_000, competence: 60, honesty: 90 } as never] };
    const { container } = render(<EmpireTab game={{ ...s.game!, cash: 5_000_000 }} meta={{ ...s.meta, empire: e }} empire={e} send={() => {}} onFocusSite={() => {}} />);
    const home = e.cities.find((c) => c.id === e.hq.homeCityId)!;
    const words = home.districts.map((d) => screen.getByLabelText(new RegExp(`^Franchise outlook ${content.districts.find((x) => x.id === d)!.name}$`)).textContent);
    expect(words).toHaveLength(home.districts.length);
    for (const w of words) expect(w).toMatch(/^they'd (do fine|only just get by|lose money)$/);
    expect(container.textContent).not.toContain("collapse below");
    expect(container.textContent).toMatch(/a shop below £[\d,]+ is in trouble/);
  });
});
