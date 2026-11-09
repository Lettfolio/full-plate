/**
 * Round 3 (REVIEW P2): "Run it hands-on" builds a fresh GameState for the site via sim-empire's newGameFromSite
 * (its district, the brand menu, a locally hired crew), instead of copying the flagship's staff.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EmpireTab } from "../screens/paths/EmpireTab";
import type { GameState } from "@full-plate/sim-core";
import { BRAND_PULL_SOURCE } from "@full-plate/sim-empire";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { FORK_DAY, initialMeta } from "../state/paths";
import { applyCommand, content, runDay, suggestedOrder } from "../sim";

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
    render(<EmpireTab game={s.game!} meta={s.meta} empire={s.meta.empire!} send={() => {}} onFocusSite={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Sites" }));
    expect(screen.getByText(/Hands-on, you run the dining room; the takeaway counter adds about 40% on top/)).toBeTruthy();
    expect(screen.getAllByText(/covers today: \d+ in the dining room \(\d+ tables, crew \d+\) \+ \d+ takeaway/).length).toBeGreaterThan(0);
  });
});

describe("round 4 review: the contract panel warns before the formula is locked", () => {
  afterEach(cleanup);
  const panel = (s: AppState) => {
    render(<EmpireTab game={s.game!} meta={s.meta} empire={s.meta.empire!} send={() => {}} onFocusSite={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Contract" }));
  };
  it("shows 'Lock your formula first' on the contract panel until the formula is locked", () => {
    const s = forkedEmpire();
    expect(s.meta.empire!.brand.formula.locked).toBe(false);
    panel(s);
    const note = screen.getByLabelText("Formula warning");
    expect(note.textContent).toContain("Lock your formula first — franchisees of an unstandardised brand lose money.");
    expect(note.textContent).toMatch(/Brand → Lock the formula/);
    cleanup();
    panel(appReducer(s, { type: "empire", cmd: { type: "SET_FORMULA", locked: true } }));
    expect(screen.queryByLabelText("Formula warning")).toBeNull();
  });
});
