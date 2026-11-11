/**
 * Round 13 (B): phone, beyond CSS — the header's "⋯" sheet, the service panel as a bottom sheet, the floor's phone
 * density, the menu matrix as a list, and pan/zoom on the maps. Phones are faked with matchMedia (jsdom has none).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { MenuItem, Table } from "@full-plate/sim-core";
import { content } from "../sim";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { resetSettingsCache } from "../lib/settings";
import { PHONE_ANY_QUERY, PHONE_QUERY } from "../lib/layout";
import { StatusBar } from "../components/StatusBar";
import { readSheet, Service, sheetKey } from "../screens/Service";
import { computeLayout, layoutKey, PHONE_FLOOR, phoneFloorSize } from "../canvas/layout";
import { MenuMatrixList, rankMenu } from "../screens/planning/MenuMatrixList";
import { isWheelNotch, mapKey, ZoomFrame } from "../screens/paths/mapParts";
import { quietLabels } from "../screens/paths/WorldMap";
import { HOME_VIEW } from "../screens/paths/worldGeo";
import { empireGame } from "./fixtures/empire";

const noop = () => {};
// Service measures its floor with a ResizeObserver (jsdom has none); the canvas view itself never draws here.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
function mockMedia(match: (q: string) => boolean) {
  const mm = vi.fn((q: string) => ({ matches: match(q), media: q, addEventListener: noop, removeEventListener: noop }));
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: mm });
}
const upright = () => mockMedia((q) => q === PHONE_QUERY || q === PHONE_ANY_QUERY);
afterEach(() => { cleanup(); delete (window as { matchMedia?: unknown }).matchMedia; });
// Service fetches the floor view, the regulars and (on a phone) the camera lazily; load them up front so no import is
// still in flight when the file's environment is torn down.
beforeAll(async () => { await Promise.all([import("../canvas/RestaurantView"), import("../lib/regulars"), import("../lib/floorCamera")]); });
beforeEach(() => { localStorage.clear(); resetSettingsCache(); });

function owner(service = false): AppState {
  let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 7, districtId: content.districts[0]!.id, restaurantName: "Pocket Bistro", difficulty: "normal" } });
  for (const id of ["margherita", "cheeseburger", "soft_drink"]) {
    const d = content.dishes.find((x) => x.id === id);
    if (d) s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: id, price: d.suggestedPrice } });
  }
  return service ? appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } }) : s;
}

describe("header ⋯ sheet (R13-B)", () => {
  it("a phone keeps name, day and cash in the header; loan, bars, sound, words, settings and save are behind ⋯", () => {
    upright();
    const s = owner();
    render(<StatusBar game={s.game!} meta={s.meta} saveMark={<button className="savemark">Saved</button>} />);
    expect(screen.getByText("Pocket Bistro")).toBeTruthy();
    expect(screen.getByText(/^Day 1$/)).toBeTruthy();
    const more = screen.getByRole("button", { name: /^More:/ });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(more.getAttribute("aria-controls")!)!;
    expect(panel.hidden).toBe(true);
    for (const t of ["Loan left", "Popularity", "Prestige"]) expect(within(panel).getAllByText(t).length).toBeGreaterThan(0);
    expect(within(panel).getByRole("button", { name: "Settings", hidden: true })).toBeTruthy();
    expect(within(panel).getByRole("switch", { name: /Sound/, hidden: true })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: /Words/, hidden: true })).toBeTruthy();
    expect(within(panel).getByText("Saved")).toBeTruthy();
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    // the sound switch flips the setting
    const sw = within(panel).getByRole("switch", { name: /Sound/ });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    expect(within(panel).getByRole("switch", { name: /Sound/ }).getAttribute("aria-checked")).toBe("false");
    // Escape closes it and gives focus back to ⋯
    fireEvent.keyDown(window, { key: "Escape" });
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(more);
  });

  it("desktop and tablet keep the one-row header (no ⋯)", () => {
    const s = owner();
    render(<StatusBar game={s.game!} meta={s.meta} />);
    expect(screen.queryByRole("button", { name: /^More:/ })).toBeNull();
    expect(screen.getByText("Loan left")).toBeTruthy();
  });
});

describe("service panel as a bottom sheet (R13-B)", () => {
  it("peek shows the handle, the one urgent thing and the speed deck; the rest is hidden until opened", () => {
    upright();
    const s = owner(true);
    render(<Service game={s.game!} app={s} send={noop} runTicks={noop} onSkip={noop} onJumpIn={noop} />);
    const handle = screen.getByRole("button", { name: /^Service panel/ });
    expect(handle.getAttribute("aria-expanded")).toBe("false");
    const body = document.getElementById(handle.getAttribute("aria-controls")!)!;
    expect(body.hidden).toBe(true);
    expect(screen.getByRole("button", { name: "Speed 4x" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Skip to evening" })).toHaveLength(1);
    expect(body.contains(screen.getByText("Manager's actions"))).toBe(true);
    // Enter/click steps peek → half → full → peek and is remembered
    fireEvent.click(handle);
    expect(body.hidden).toBe(false);
    expect(document.querySelector(".service__side")!.getAttribute("data-sheet")).toBe("half");
    expect(readSheet()).toBe("half");
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(document.querySelector(".service__side")!.getAttribute("data-sheet")).toBe("full");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(readSheet()).toBe("peek");
  });

  it("opens where it was left", () => {
    upright();
    localStorage.setItem("full-plate:service-sheet:v1", "full");
    const s = owner(true);
    render(<Service game={s.game!} app={s} send={noop} runTicks={noop} onSkip={noop} />);
    expect(document.querySelector(".service__side")!.getAttribute("data-sheet")).toBe("full");
    expect(screen.getByRole("button", { name: /^Service panel/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("keys on the handle", () => {
    expect(sheetKey("peek", "ArrowUp")).toBe("half");
    expect(sheetKey("full", "ArrowUp")).toBe("full");
    expect(sheetKey("full", "PageDown")).toBe("half");
    expect(sheetKey("half", "End")).toBe("full");
    expect(sheetKey("half", "x")).toBeNull();
  });

  it("not a phone: the panel is unchanged (no handle, speeds and skip in the clock card)", () => {
    const s = owner(true);
    render(<Service game={s.game!} app={s} send={noop} runTicks={noop} onSkip={noop} />);
    expect(screen.queryByRole("button", { name: /^Service panel/ })).toBeNull();
    expect(document.querySelector(".service__side")!.getAttribute("data-sheet")).toBeNull();
    expect(screen.getByRole("button", { name: /Skip to evening/ })).toBeTruthy();
  });
});

describe("phone floor density (R13-B)", () => {
  const tables = (n: number): Table[] => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, seats: i % 2 ? 4 : 2 }) as unknown as Table);

  it("two tables a row at most, bigger tables and people than the desktop layout of the same room", () => {
    const t = tables(8);
    const desk = computeLayout(340, 700, t);
    const ph = computeLayout(340, 700, t, "phone");
    const xs = new Set([...ph.tables.values()].map((s) => Math.round(s.x)));
    expect(xs.size).toBeLessThanOrEqual(2);
    expect(ph.person).toBeGreaterThanOrEqual(8);
    expect(ph.person).toBeGreaterThan(desk.person);
    expect(ph.tablesKey).not.toBe(desk.tablesKey);
    expect(desk.tablesKey).toBe(layoutKey(t));
    expect(desk.density).toBeUndefined();
  });

  it("is drawn at least 1:1 on a 390 px phone and grows taller (scrolls) for a big room", () => {
    const small = phoneFloorSize(376, 580, 6);
    expect(small.w).toBe(PHONE_FLOOR.logicalW);
    expect(small.scale).toBeGreaterThanOrEqual(1);
    const big = phoneFloorSize(376, 580, 14);
    expect(big.h).toBeGreaterThan(small.h);
    expect(big.h * big.scale).toBeGreaterThan(580);
  });
});

describe("menu matrix as a list (R13-B)", () => {
  const item = (dishId: string, sold7d: number, margin7d: number): MenuItem => ({ dishId, price: 1000, active: true, sold7d, margin7d }) as unknown as MenuItem;
  const items = [item("a", 10, 5000), item("b", 40, 9000), item("c", 3, 2400), item("d", 30, 3000), item("e", 1, 100)];
  const q = { a: "star", b: "star", c: "puzzle", d: "ploughhorse", e: "dog" } as const;

  it("groups Stars, Plough-horses, Puzzles, Dogs, each ranked by what it made last week", () => {
    const g = rankMenu(items, q, () => 0);
    expect(g.map((x) => x.q)).toEqual(["star", "ploughhorse", "puzzle", "dog"]);
    expect(g[0]!.dishes.map((m) => m.dishId)).toEqual(["b", "a"]);
  });

  it("names the four quadrants with their tips; a tap shows a dish's numbers", () => {
    render(<MenuMatrixList items={items} quadrants={q} names={{ a: "Soup", b: "Burger", c: "Tart", d: "Chips", e: "Salad" }} fallbackMargin={() => 0} plateCost={() => 300} />);
    for (const h of ["Stars", "Plough-horses", "Puzzles", "Dogs"]) expect(screen.getByRole("heading", { name: new RegExp(h) })).toBeTruthy();
    const row = screen.getByRole("button", { name: /Burger/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Sold, last 7 days")).toBeTruthy();
    expect(screen.getAllByText("£2.25").length).toBeGreaterThan(1); // 9000 / 40 a plate
  });
});

describe("maps (R13-B)", () => {
  it("keys: arrows pan, + and − zoom, 0 resets", () => {
    expect(mapKey("ArrowRight")).toEqual({ pan: [-60, 0] });
    expect(mapKey("+")!.zoom).toBeGreaterThan(1);
    expect(mapKey("-")!.zoom).toBeLessThan(1);
    expect(mapKey("0")).toEqual({ reset: true });
    expect(mapKey("Enter")).toBeNull();
  });

  it("tells a mouse wheel's notch from a trackpad's scroll", () => {
    expect(isWheelNotch({ deltaMode: 0, deltaX: 0, deltaY: 100 })).toBe(true);
    expect(isWheelNotch({ deltaMode: 1, deltaX: 0, deltaY: 3 })).toBe(true);
    expect(isWheelNotch({ deltaMode: 0, deltaX: 2, deltaY: 7.5 })).toBe(false);
  });

  it("a city board zooms with + and resets with 0 (and changes nothing at 1×)", () => {
    render(<ZoomFrame label="Map of Harbourton"><p>board</p></ZoomFrame>);
    const frame = screen.getByRole("region", { name: /Map of Harbourton/ });
    expect(frame.dataset.zoom).toBe("1.00");
    expect((frame.firstElementChild as HTMLElement).style.transform).toBe("");
    const enlarge = screen.getByRole("button", { name: "Enlarge: Map of Harbourton" });
    act(() => { fireEvent.keyDown(enlarge, { key: "+" }); });
    expect(Number(frame.dataset.zoom)).toBeGreaterThan(1);
    act(() => { fireEvent.keyDown(enlarge, { key: "0" }); });
    expect(frame.dataset.zoom).toBe("1.00");
    fireEvent.click(enlarge);
    expect(Number(frame.dataset.zoom)).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: "Back to the whole of Map of Harbourton" }));
    expect(frame.dataset.zoom).toBe("1.00");
  });

  it("world-map names that would collide on a small frame drop out, and come back zoomed in", () => {
    const e = empireGame().meta.empire!;
    const small = quietLabels(e, HOME_VIEW, { w: 358, h: 179 }, new Map(), undefined);
    const wide = quietLabels(e, HOME_VIEW, { w: 2400, h: 1200 }, new Map(), undefined);
    expect(small.size).toBeGreaterThan(0);
    expect(wide.size).toBeLessThan(small.size);
    // the HQ city always keeps its name
    expect(small.has(e.hq.homeCityId)).toBe(false);
  });
});
