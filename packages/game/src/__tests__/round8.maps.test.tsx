/**
 * Round 8 (A, maps): the Empire world map (city buttons, zoom clamps, supply routes, the map key), the city map
 * (districts, "Open here" into the open-site flow), and the Stars map (every restaurant pinned, deterministic
 * placement, nothing hidden leaked). Geography itself: every city sits on land in its own region.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { EmpireState } from "@full-plate/sim-empire";
import { CRITERION_LABEL, starsView, type StarsState } from "@full-plate/sim-stars";
import { EmpireTab } from "../screens/paths/EmpireTab";
import { StarsTab } from "../screens/paths/StarsTab";
import { cityMix, supplyRoutes, WorldMap } from "../screens/paths/WorldMap";
import { starsPlaces } from "../screens/paths/StarsMap";
import { centreOn, cityPos, clampView, landAt, MAP_H, MAP_W, zoomAt, ZOOM_MAX, ZOOM_MIN } from "../screens/paths/worldGeo";
import { extras } from "../sim";
import { appReducer } from "../state/gameReducer";
import { empireGame } from "./fixtures/empire";

afterEach(cleanup);
const noop = () => {};
const pins = () => within(screen.getByRole("group", { name: "World map of cities and shops" })).getAllByRole("button");

describe("geography", () => {
  it("every city sits on land in its own region, and keeps its id", () => {
    for (const c of extras.world.cities) {
      const land = landAt(cityPos(c));
      expect(land, c.id).toBeTruthy();
      expect(land!.regionId, c.id).toBe(c.regionId);
    }
  });

  it("the view clamps: zoom 1–4, and the map always fills the frame", () => {
    expect(clampView({ k: 9, tx: 0, ty: 0 }).k).toBe(ZOOM_MAX);
    expect(clampView({ k: 0.2, tx: 50, ty: 50 })).toEqual({ k: ZOOM_MIN, tx: 0, ty: 0 });
    const v = clampView({ k: 2, tx: -5000, ty: 400 });
    expect(v).toEqual({ k: 2, tx: -MAP_W, ty: 0 });
    let z = { k: 1, tx: 0, ty: 0 };
    for (let i = 0; i < 20; i++) z = zoomAt(z, 1.6, [900, 450]);
    expect(z.k).toBe(ZOOM_MAX);
    expect(z.tx).toBeGreaterThanOrEqual(MAP_W * (1 - ZOOM_MAX));
    expect(z.ty).toBeGreaterThanOrEqual(MAP_H * (1 - ZOOM_MAX));
    expect(centreOn({ k: 1, tx: 0, ty: 0 }, [10, 10])).toEqual({ k: 1, tx: 0, ty: 0 });
  });
});

describe("world map", () => {
  it("every city is a focusable button with an accessible name, in tab order", () => {
    const s = empireGame();
    const e = s.meta.empire!;
    render(<WorldMap e={e} picked="harbourton" onPick={noop} />);
    const b = pins();
    expect(b).toHaveLength(e.cities.length);
    for (const c of e.cities) {
      const btn = b.find((x) => x.getAttribute("data-city") === c.id)!;
      expect(btn.tagName).toBe("BUTTON");
      expect(btn.tabIndex).toBe(0);
      expect(btn.getAttribute("aria-label")).toMatch(new RegExp(`^${c.name}, ${c.country}: \\d+ shops?`));
      btn.focus();
      expect(document.activeElement).toBe(btn);
    }
    expect(screen.getByRole("button", { name: /^Harbourton, Albrenn: 1 shop \(1 your own\), 3 being built, your head office$/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^Bayview, Westrian Union: 0 shops, not entered/ })).toBeTruthy();
  });

  it("hover or focus shows a tooltip: shops, rent level, recognition", () => {
    const s = empireGame();
    render(<WorldMap e={s.meta.empire!} picked="harbourton" onPick={noop} />);
    const h = screen.getByRole("button", { name: /^Harbourton/ });
    fireEvent.focus(h);
    const tip = screen.getByRole("tooltip");
    expect(h.getAttribute("aria-describedby")).toBe(tip.id);
    expect(tip.textContent).toMatch(/1 shop: 1 your own · 3 being built/);
    expect(tip.textContent).toMatch(/Rent ££ \(average\)/);
    expect(tip.textContent).toMatch(/known in The Isles: \d+/);
  });

  it("zoom controls clamp: + disables at 4×, − and reset disable back at 1×", () => {
    const s = empireGame();
    const { container } = render(<WorldMap e={s.meta.empire!} picked="harbourton" onPick={noop} />);
    const frame = container.querySelector(".worldmap__frame")!;
    const zin = screen.getByRole("button", { name: "Zoom in" });
    const zout = screen.getByRole("button", { name: "Zoom out" });
    const reset = screen.getByRole("button", { name: "Reset map" });
    expect(zout).toHaveProperty("disabled", true);
    expect(reset).toHaveProperty("disabled", true);
    for (let i = 0; i < 6 && !zin.hasAttribute("disabled"); i++) fireEvent.click(zin);
    expect(frame.getAttribute("data-zoom")).toBe(ZOOM_MAX.toFixed(2));
    expect(zin).toHaveProperty("disabled", true);
    expect(zout).toHaveProperty("disabled", false);
    fireEvent.click(zin);
    expect(frame.getAttribute("data-zoom")).toBe(ZOOM_MAX.toFixed(2));
    fireEvent.click(reset);
    expect(frame.getAttribute("data-zoom")).toBe("1.00");
    expect(zout).toHaveProperty("disabled", true);
    for (let i = 0; i < 10; i++) fireEvent.click(zout);
    expect(frame.getAttribute("data-zoom")).toBe("1.00");
    // Pins stay in the tab order whatever the zoom.
    expect(pins()).toHaveLength(s.meta.empire!.cities.length);
  });

  it("supply routes run from HQ only to cities with shops (open or being built)", () => {
    const s = empireGame();
    const base = s.meta.empire!;
    // One franchise in Kingsbridge being built, one company shop open in Vasant; Glenmoor entered but empty.
    const e: EmpireState = {
      ...base,
      cities: base.cities.map((c) => (["kingsbridge", "vasant", "glenmoor"].includes(c.id) ? { ...c, entered: true } : c)),
      sites: [
        ...base.sites,
        { ...base.sites[0]!, id: "t-kb", cityId: "kingsbridge", status: "building" },
        { ...base.sites[0]!, id: "t-va", cityId: "vasant", status: "open", ownership: "company" },
      ],
    };
    const routes = supplyRoutes(e);
    expect(routes.map((r) => r.to).sort()).toEqual(["kingsbridge", "vasant"]);
    expect(routes.every((r) => r.from === "harbourton")).toBe(true);
    const { container } = render(<WorldMap e={e} picked="harbourton" onPick={noop} />);
    const drawn = [...container.querySelectorAll("[data-route]")].map((p) => p.getAttribute("data-route")).sort();
    expect(drawn).toEqual(["kingsbridge", "vasant"]);
    expect(cityMix(e).get("kingsbridge")).toEqual({ company: 0, franchise: 0, licence: 0, building: 1 });
    // A region with its own commissary is supplied from its busiest city there, not from HQ.
    const withKitchen: EmpireState = {
      ...e,
      regions: e.regions.map((r) => (r.id === "sunrise" ? { ...r, commissary: true } : r)),
      cities: e.cities.map((c) => (c.id === "kaito" ? { ...c, entered: true } : c)),
      sites: [...e.sites, { ...base.sites[0]!, id: "t-ka", cityId: "kaito", status: "open" }, { ...base.sites[0]!, id: "t-va2", cityId: "vasant", status: "open" }],
    };
    expect(supplyRoutes(withKitchen).find((r) => r.to === "kaito")).toEqual({ from: "vasant", to: "kaito", commissary: true });
  });

  it("the map key toggles (collapsed when the map is narrow, as in jsdom)", () => {
    const s = empireGame();
    render(<WorldMap e={s.meta.empire!} picked="harbourton" onPick={noop} />);
    const key = screen.getByRole("button", { name: /Map key/ });
    expect(key.getAttribute("aria-expanded")).toBe("false");
    const list = document.getElementById(key.getAttribute("aria-controls")!)!;
    expect(list.hidden).toBe(true);
    fireEvent.click(key);
    expect(key.getAttribute("aria-expanded")).toBe("true");
    expect(list.hidden).toBe(false);
    expect(list.textContent).toMatch(/Your own.*Franchise.*Licence.*Your head office.*Not entered.*Being built.*Supply route.*Glow/);
    fireEvent.click(key);
    expect(list.hidden).toBe(true);
  });
});

describe("city map", () => {
  it("picking a city shows its district map; Back returns to the world", () => {
    const s = empireGame();
    const e = s.meta.empire!;
    render(<EmpireTab game={s.game!} meta={s.meta} empire={e} send={noop} onFocusSite={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /^Harbourton, Albrenn/ }));
    const map = screen.getByRole("region", { name: "Map of Harbourton" });
    const board = within(map).getByRole("group", { name: "Harbourton districts" });
    const home = e.cities.find((c) => c.id === "harbourton")!;
    const tiles = board.querySelectorAll("[data-district]");
    expect([...tiles].map((t) => t.getAttribute("data-district")).sort()).toEqual([...home.districts].sort());
    // The three franchises (still being built) sit in their districts; the flagship's district shows it too.
    for (const d of ["student_quarter", "seaside", "business_park"]) {
      const tile = board.querySelector(`[data-district="${d}"]`) as HTMLElement;
      expect(within(tile).getByRole("img").getAttribute("aria-label")).toMatch(/^1 shop in .*: 1 being built$/);
      expect(tile.textContent).toMatch(/👣 (Very busy|Busy|Steady)/);
      expect(tile.textContent).toMatch(/£+ \w+ rent/);
    }
    expect(screen.getByRole("heading", { name: /^Shops in Harbourton/ })).toBeTruthy();
    fireEvent.click(within(map).getByRole("button", { name: /World map/ }));
    expect(screen.queryByRole("region", { name: "Map of Harbourton" })).toBeNull();
    expect(pins()).toHaveLength(e.cities.length);
  });

  it("“Open here” leads to that district's open-site buttons in the side panel", async () => {
    const s = empireGame();
    const e = s.meta.empire!;
    render(<EmpireTab game={s.game!} meta={s.meta} empire={e} send={noop} onFocusSite={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /^Harbourton, Albrenn/ }));
    const open = screen.getAllByRole("button", { name: /^(Open here|Open another): / });
    expect(open.length).toBe(e.cities.find((c) => c.id === "harbourton")!.districts.length);
    const first = open[0]!;
    const district = first.closest("[data-district]")!.getAttribute("data-district")!;
    await act(async () => { fireEvent.click(first); await new Promise((r) => requestAnimationFrame(() => r(null))); });
    const row = document.querySelector(`[data-opensite="${district}"]`)!;
    expect(row).toBeTruthy();
    expect(row.contains(document.activeElement)).toBe(true);
  });

  it("a city not entered says so and offers Enter instead of Open here", () => {
    const s = empireGame();
    render(<EmpireTab game={s.game!} meta={s.meta} empire={s.meta.empire!} send={noop} onFocusSite={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /^Kaito, Nihara/ }));
    const map = screen.getByRole("region", { name: "Map of Kaito" });
    expect(map.textContent).toMatch(/Not entered yet/);
    expect(within(map).getByRole("button", { name: /^Enter Kaito/ })).toBeTruthy();
    expect(within(map).queryAllByRole("button", { name: /^(Open here|Open another)/ })).toHaveLength(0);
  });
});

describe("Stars map", () => {
  function starsGame() {
    const s0 = empireGame();
    const owner = { ...s0, meta: { ...s0.meta, empire: undefined, fork: { offered: true, firstOfferDay: s0.game!.day } } };
    const s = appReducer(owner, { type: "fork", choice: "stars" });
    const day = s.game!.day;
    const stars: StarsState = {
      ...s.meta.stars!,
      satellites: [
        { id: "sat-a", kind: "bar", name: "The Little Bar", openedDay: day - 30, headChefTrained: true, staffAbsorbed: 2, earned: 0 },
        { id: "sat-b", kind: "bistro", name: "Bistro Two", openedDay: day - 10, headChefTrained: false, staffAbsorbed: 4, earned: 0 },
        { id: "sat-c", kind: "ticketed", name: "Chef's Table", openedDay: day - 2, headChefTrained: false, staffAbsorbed: 3, earned: 0 },
      ],
      rival: { name: "Maison Lune", openedDay: day - 90, strength: 50, stars: 1 },
    };
    return { s, stars };
  }

  it("pins every restaurant in the group, and the rival, with stars where they can have them", () => {
    const { s, stars } = starsGame();
    render(<StarsTab game={s.game!} meta={s.meta} stars={stars} send={noop} onTastingMenu={noop} />);
    const map = screen.getByRole("group", { name: /^Map of Harbourton with your restaurants/ });
    const placed = [...map.querySelectorAll("[data-place]")].map((x) => x.getAttribute("data-place")).sort();
    expect(placed).toEqual(["flagship", "rival", "sat-a", "sat-b", "sat-c"]);
    for (const n of [s.game!.restaurantName, "The Little Bar", "Bistro Two", "Chef's Table", "Maison Lune"]) expect(map.textContent).toContain(n);
    const flag = map.querySelector('[data-place="flagship"]')!;
    expect(flag.closest("[data-district]")!.getAttribute("data-district")).toBe(s.game!.districtId);
    expect(map.querySelector('[data-place="sat-a"]')!.textContent).toMatch(/no stars/);
    expect(map.querySelector('[data-place="rival"]')!.textContent).toMatch(/1 star/);
  });

  it("placement is a stable hash of ids (same district every time, no randomness)", () => {
    const { s, stars } = starsGame();
    const v = starsView(stars, s.game!.day);
    const ds = ["high_street", "student_quarter", "business_park", "seaside"];
    const a = starsPlaces(v, "R", "high_street", ds, 0);
    const b = starsPlaces(v, "R", "high_street", ds, 0);
    expect(a).toEqual(b);
    expect(a.every((p) => ds.includes(p.districtId))).toBe(true);
  });

  it("never shows this year's hidden visits: only the season flag, revealed visits and rumours", () => {
    const { s, stars } = starsGame();
    const secret = { ...stars, guides: { ...stars.guides, michelin: { ...stars.guides.michelin, inspectorVisits: [...stars.guides.michelin.inspectorVisits, { day: s.game!.day - 1, inspector: "Mme Secret", scores: Object.fromEntries(Object.keys(CRITERION_LABEL).map((k) => [k, 99])) as never, total: 99, revealed: false }] } } };
    render(<StarsTab game={s.game!} meta={s.meta} stars={secret} send={noop} onTastingMenu={noop} />);
    const card = screen.getByRole("heading", { name: /^Your restaurants in/ }).closest("section")!;
    expect(card.textContent).not.toContain("Mme Secret");
    expect(card.textContent).toMatch(/visits stay secret until guide day/);
  });
});

describe("map styles stay out of theme.css", () => {
  it("map.css holds the map's rules and variables; it is imported by the map modules", () => {
    const dir = join(__dirname, "../screens/paths");
    const css = readFileSync(join(dir, "map.css"), "utf8");
    expect(css).toMatch(/--map-sea:/);
    expect(readFileSync(join(dir, "mapParts.tsx"), "utf8")).toContain('import "./map.css"');
    expect(readFileSync(join(__dirname, "../theme.css"), "utf8")).not.toMatch(/worldmap|citymap|starsmap/);
  });
});
