/**
 * Round 12 (B): the brand kit and postcards. The brand is game-side only (PathMeta.brand, a short code); every old save
 * gets a default brand from its name; text on brand colours always reads; staff wear the uniform; the postcard says
 * nothing personal.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { avatarFor } from "@full-plate/sim-core";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { decodeSave, encodeSave } from "../state/save";
import { checkedDecode } from "../state/saveCheck";
import { decodeSaveFile } from "../state/saveFiles";
import { pickSummary, summarize } from "../state/saveStore";
import { autosaveKey } from "../state/useSaves";
import { content } from "../sim";
import {
  applyBrand, BRAND_RE, contrast, currentBrand, defaultBrand, dress, encodeBrand, logoSvg, MOTIFS, onColour, PALETTE, parseBrand,
  resolveBrand, SHAPES, uniformPatch, type Brand,
} from "../lib/brand";
import { brandLook, setCanvasBrand } from "../canvas/brand";
import { staffLook } from "../canvas/people";
import { postcardFileName, postcardInfo, wrapLines, bestReview } from "../lib/postcard";
import { Avatar } from "../components/Avatar";
import { StatusBar } from "../components/StatusBar";
import { BrandCard } from "../screens/planning/BrandTab";
import type { PathMeta } from "../state/paths";

afterEach(() => { cleanup(); applyBrand(null); });

function newApp(name = "Noodle Nook"): AppState {
  return appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 4242, districtId: content.districts[0]!.id, restaurantName: name, difficulty: "normal" } });
}

const MINE: Brand = { shape: "shield", motif: "chilli", letter: "caps", primary: "#24345c", accent: "#f5d77a", uniform: "waistcoat", uniformColour: "#9e2a3a", menu: "chalkboard" };

describe("brand code", () => {
  it("round-trips, and unknown or malformed parts fall back to the name's default", () => {
    const code = encodeBrand(MINE);
    expect(code).toBe("1.shield.chilli.caps.24345c.f5d77a.waistcoat.9e2a3a.chalkboard");
    expect(BRAND_RE.test(code)).toBe(true);
    expect(parseBrand(code, defaultBrand("x"))).toEqual(MINE);
    const d = defaultBrand("Bella's");
    expect(parseBrand("1.blob.chilli.caps.24345c.f5d77a.cape.9e2a3a.neon", d)).toEqual({ ...MINE, shape: d.shape, uniform: d.uniform, menu: d.menu });
    for (const bad of [undefined, "", "2.shield", "1.shield.chilli.caps.ZZZZZZ.f5d77a.apron.9e2a3a.classic", "<script>"]) expect(parseBrand(bad, d)).toEqual(d);
  });

  it("every restaurant gets a deterministic default from its name; a word in the name picks the motif", () => {
    expect(defaultBrand("Mia's Café")).toEqual(defaultBrand("Mia's Café"));
    expect(defaultBrand("The Noodle Bar").motif).toBe("noodles");
    expect(defaultBrand("Harbour Fish & Chips").motif).toBe("fish");
    expect(defaultBrand("Bean There Café").motif).toBe("cup");
    const names = ["Home Diner", "Mia's Cafe", "Golden Fork", "Rosa's", "The Corner", "Plate Expectations", "Lemon Tree"];
    const looks = new Set(names.map((n) => encodeBrand(defaultBrand(n))));
    expect(looks.size).toBe(names.length); // different names, different brands
    for (const n of names) {
      const b = defaultBrand(n);
      expect(contrast(b.primary, b.accent)).toBeGreaterThanOrEqual(2.2); // the motif shows on the shape
    }
  });

  it("a career employee wears the employer's brand (read-only), whatever is stored", () => {
    expect(resolveBrand(encodeBrand(MINE), "Pat's Grill", true)).toEqual(defaultBrand("Pat's Grill"));
    expect(resolveBrand(encodeBrand(MINE), "Pat's Grill", false)).toEqual(MINE);
  });
});

describe("contrast is enforced", () => {
  it("text on any brand colour (palette, or any hex she types) is at least 4.5:1", () => {
    const hexes = PALETTE.map((p) => p.hex);
    for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 51) hexes.push(`#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
    for (const h of hexes) expect(contrast(h, onColour(h))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the logo", () => {
  it("is a pure SVG of the shape and motif in the house colours, for every combination", () => {
    for (const shape of SHAPES) for (const motif of MOTIFS) {
      const svg = logoSvg({ ...MINE, shape, motif });
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 100 100"/);
      expect(svg).toContain(MINE.primary);
      expect(svg).not.toMatch(/NaN|undefined|<text|<script/);
      expect(logoSvg({ ...MINE, shape, motif })).toBe(svg);
    }
    expect(new Set(MOTIFS.map((m) => logoSvg({ ...MINE, motif: m }))).size).toBe(MOTIFS.length);
    expect(MOTIFS.length).toBeGreaterThanOrEqual(12);
    expect(SHAPES.length).toBeGreaterThanOrEqual(8);
  });
});

describe("saves", () => {
  it("the reducer stores the code, the autosave key sees it, and it survives encode → check → decode", () => {
    let s = newApp();
    const key0 = autosaveKey(s.game!, s.meta);
    s = appReducer(s, { type: "brand", code: encodeBrand(MINE) });
    expect(s.meta.brand).toBe(encodeBrand(MINE));
    expect(autosaveKey(s.game!, s.meta)).not.toBe(key0);
    const back = checkedDecode(encodeSave(s.game!, s.meta));
    expect(back.meta.brand).toBe(encodeBrand(MINE));
    expect(parseBrand(back.meta.brand, defaultBrand(""))).toEqual(MINE);
  });

  it("a malformed brand in a save is dropped (the default shows), not fatal", () => {
    const s = newApp();
    const env = JSON.parse(encodeSave(s.game!, s.meta)) as { meta: Record<string, unknown> };
    env.meta.brand = "1.<img onerror>";
    expect(checkedDecode(JSON.stringify(env)).meta.brand).toBeUndefined();
    env.meta.brand = 42;
    expect(() => checkedDecode(JSON.stringify(env))).toThrow();
  });

  it("the slot summary carries the code for Your games; junk never reaches the picker", () => {
    const s = appReducer(newApp(), { type: "brand", code: encodeBrand(MINE) });
    const sum = summarize("s1", "Mine", s.game!, s.meta, "2026-01-01T00:00:00Z");
    expect(sum.brand).toBe(encodeBrand(MINE));
    expect(pickSummary({ ...sum, brand: "</div><b>" }).brand).toBeUndefined();
    expect(summarize("s1", "Mine", newApp().game!, newApp().meta, "x").brand).toBeUndefined();
  });

  it("every corpus save (no brand stored) loads with a full default brand from its name", async () => {
    const dir = join(__dirname, "fixtures/corpus");
    const { files } = JSON.parse(readFileSync(join(dir, "index.json"), "utf8")) as { files: { file: string; kind: string }[] };
    expect(files.length).toBeGreaterThanOrEqual(29);
    for (const e of files) {
      const text = gunzipSync(readFileSync(join(dir, e.file))).toString("utf8");
      const raw = e.kind === "savefile" ? (await decodeSaveFile(text)).raw : text;
      const l = checkedDecode(raw);
      const name = l.meta.empire?.brand.name ?? l.game.restaurantName;
      const b = resolveBrand(l.meta.brand, name, l.meta.mode === "career" && !!l.meta.career && !l.meta.career.handover);
      expect(BRAND_RE.test(encodeBrand(b))).toBe(true);
      if (!e.file.startsWith("r12-")) expect(b).toEqual(defaultBrand(name));
      else expect(l.meta.brand).toBeTruthy();
    }
  });
});

describe("uniforms", () => {
  it("front of house wear the style in the uniform colour; chefs keep their whites and wear the colour", () => {
    const server = avatarFor({ id: "s9", name: "Theo", role: "server" });
    const tee = dress(server, uniformPatch("server", "tee", "#3f7d4e", "#f5d77a"));
    expect(tee.body).toBe("#3f7d4e");
    expect(tee.apron).toBeUndefined();
    expect(tee.hatColour).toBe("#3f7d4e");
    const apron = dress(server, uniformPatch("server", "apron", "#3f7d4e", "#f5d77a"));
    expect(apron.apron).toBe("#3f7d4e");
    const chef = avatarFor({ id: "c9", name: "Rosa", role: "chef" });
    const dressed = dress(chef, uniformPatch("chef", "waistcoat", "#9e2a3a", "#f5d77a"));
    expect(dressed.body).toBe(chef.body);
    expect(dressed.hat).toBe("toque");
    expect(dressed.trim).toBe("#9e2a3a");
  });

  it("the floor canvas dresses staff sprites from the page's brand, and an explicit null turns it off", () => {
    const g = newApp().game!;
    const staff = { ...(g.staff[0] ?? { id: "x", name: "Sam Ser", mood: 70 }), role: "server" as const } as Parameters<typeof staffLook>[0];
    const plain = staffLook(staff);
    expect(brandLook(plain, "server", null)).toBe(plain);
    setCanvasBrand({ uniform: "waistcoat", colour: "#7a3e6c", accent: "#f5d77a" });
    const look = brandLook(plain, "server", { uniform: "waistcoat", colour: "#7a3e6c", accent: "#f5d77a" });
    expect(look.body).toBe("#7a3e6c");
    expect(look.shirt).toBe(true);
    expect(look.trim).toBe("#f5d77a");
    setCanvasBrand(null);
  });

  it("Avatar takes an optional uniform over the person's clothes", () => {
    const { container, rerender } = render(<Avatar person={{ id: "s1", name: "Theo", role: "server" }} size={64} />);
    const before = container.innerHTML;
    rerender(<Avatar person={{ id: "s1", name: "Theo", role: "server" }} size={64} uniform={{ body: "#123456" }} />);
    expect(container.innerHTML).not.toBe(before);
    expect(container.innerHTML).toContain("#123456");
  });
});

describe("on the page", () => {
  it("applyBrand sets the CSS variables, the menu style and the floor uniform; null takes them off", () => {
    applyBrand(MINE);
    const root = document.documentElement;
    expect(root.dataset.brand).toBe("on");
    expect(root.dataset.menuStyle).toBe("chalkboard");
    expect(root.style.getPropertyValue("--brand-primary")).toBe("#24345c");
    expect(root.style.getPropertyValue("--on-brand-primary")).toBe(onColour("#24345c"));
    expect(root.style.getPropertyValue("--brand-logo")).toContain("data:image/svg+xml");
    expect(root.style.getPropertyValue("--awning")).toContain("#24345c");
    expect(currentBrand()).toEqual(MINE);
    applyBrand(null);
    expect(root.dataset.brand).toBeUndefined();
    expect(root.style.getPropertyValue("--brand-primary")).toBe("");
  });

  it("the header has a logo chip and the name in the brand's lettering", () => {
    const s = newApp("Lemon Tree");
    render(<StatusBar game={s.game!} meta={s.meta} />);
    const name = screen.getByText("Lemon Tree");
    expect(name.className).toBe("brandname");
    expect(name.previousElementSibling?.className).toBe("status__logo");
    expect(name.previousElementSibling?.getAttribute("aria-hidden")).toBe("true");
  });

  it("the Brand card opens the kit; picking a shape, picture, colours, uniform and menu style saves one code", () => {
    const s = newApp("Lemon Tree");
    const onBrand = vi.fn();
    render(<BrandCard game={s.game!} meta={s.meta} onBrand={onBrand} />);
    expect(screen.getByRole("heading", { name: "Your brand" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Edit brand/ }));
    const sheet = screen.getByRole("dialog", { name: "Brand kit" });
    const pick = (group: string, name: string) => fireEvent.click(within(within(sheet).getByRole("radiogroup", { name: group })).getByRole("radio", { name }));
    pick("Logo shape", "Shield");
    pick("Logo picture", "Chilli");
    pick("Lettering", "Sign caps");
    pick("House colour", "Navy");
    pick("Accent colour", "Butter");
    pick("Uniform style", "Waistcoat");
    pick("Uniform colour", "Cherry");
    pick("Menu style", "Chalkboard");
    expect(within(within(sheet).getByRole("radiogroup", { name: "Logo shape" })).getByRole("radio", { name: "Shield" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(sheet).getByRole("button", { name: /Save brand/ }));
    expect(onBrand).toHaveBeenCalledWith(encodeBrand(MINE));
  });

  it("a hex code works for any colour; Randomise changes the preview and is the same for the same clicks", () => {
    const s = newApp("Lemon Tree");
    const onBrand = vi.fn();
    render(<BrandCard game={s.game!} meta={s.meta} onBrand={onBrand} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit brand/ }));
    fireEvent.change(screen.getByLabelText("House colour: hex code"), { target: { value: "#ABCDEF" } });
    fireEvent.click(screen.getByRole("button", { name: /Randomise/ }));
    fireEvent.click(screen.getByRole("button", { name: /Save brand/ }));
    const first = onBrand.mock.calls[0]![0] as string;
    expect(first).not.toBe(encodeBrand(defaultBrand("Lemon Tree")));
    cleanup();
    render(<BrandCard game={s.game!} meta={s.meta} onBrand={onBrand} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit brand/ }));
    fireEvent.change(screen.getByLabelText("House colour: hex code"), { target: { value: "#abcdef" } });
    fireEvent.click(screen.getByRole("button", { name: /Save brand/ }));
    expect((onBrand.mock.calls[1]![0] as string).split(".")[4]).toBe("abcdef");
    cleanup();
    render(<BrandCard game={s.game!} meta={s.meta} onBrand={onBrand} />);
    fireEvent.click(screen.getByRole("button", { name: /Edit brand/ }));
    fireEvent.click(screen.getByRole("button", { name: /Randomise/ }));
    fireEvent.click(screen.getByRole("button", { name: /Save brand/ }));
    expect(onBrand.mock.calls[2]![0]).toBe(first); // Randomise replaces everything, from the game's seed and the click count
  });

  it("in a career the brand is the employer's: no editor, a note instead", () => {
    const s = appReducer(initialAppState, { type: "newCareer", seed: 77, track: "chef", strategy: "balanced", playerName: "Sam", difficulty: "normal" });
    render(<BrandCard game={s.game!} meta={s.meta as PathMeta} onBrand={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Edit brand/ })).toBeNull();
    expect(screen.getByText(/design your own once you run the place/)).toBeTruthy();
  });
});

describe("postcards", () => {
  it("carry the restaurant's name, the day's numbers and the best review — nothing personal", () => {
    let s = newApp("Lemon Tree");
    const info0 = postcardInfo(s.game!, MINE);
    expect(info0.headline).toMatch(/first night/);
    expect(info0.numbers.map((n) => n.label)).toEqual(["Tables", "Seats", "Dishes"]);
    const r = { day: 3, covers: 41, revenue: 52_300, profit: 9_000, averageRating: 4.3, closed: false, reviews: [
      { day: 3, source: "walkin" as const, rating: 3, text: "Fine." },
      { day: 3, source: "online" as const, rating: 5, text: "The best ramen this side of the river." },
    ] };
    const info = postcardInfo(s.game!, MINE, r as never);
    expect(info.headline).toBe("What a night!");
    expect(info.numbers).toEqual([{ label: "Guests fed", value: "41" }, { label: "Takings", value: "£523" }, { label: "Rating", value: "4.3★" }]);
    expect(info.review?.text).toBe("The best ramen this side of the river.");
    expect(info.where).toContain("Day 4");
    expect(JSON.stringify(info)).not.toMatch(/Sam|player|email/i);
    expect(bestReview([])).toBeUndefined();
    expect(postcardFileName("Mia's Café!", 3, "portrait")).toBe("full-plate-mia-s-caf-day4-portrait.png");
    s = appReducer(s, { type: "brand", code: encodeBrand(MINE) });
    expect(s.meta.brand).toBeTruthy();
  });

  it("wraps a long review into lines that fit, with an ellipsis when cut", () => {
    const m = (t: string) => t.length * 10;
    expect(wrapLines(m, "one two three", 200, 3)).toEqual(["one two three"]);
    const out = wrapLines(m, "aaaa bbbb cccc dddd eeee ffff gggg hhhh", 100, 2);
    expect(out).toHaveLength(2);
    expect(out[1]!.endsWith("…")).toBe(true);
    for (const l of out) expect(m(l)).toBeLessThanOrEqual(100);
  });
});

// keep the runner honest about async UI
it("the Brand card's postcard button is there for owners", async () => {
  const s = newApp();
  render(<BrandCard game={s.game!} meta={s.meta} onBrand={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Postcard" })).toBeTruthy());
  expect(decodeSave(encodeSave(s.game!, s.meta)).meta.brand).toBeUndefined();
});
