/**
 * Round 10 (A): decorating in the game — the Decorate tab's catalogue and buy / refresh flow, the live preview (the
 * floor canvas rebuilds its cached scene when the decor shown changes, not per frame), the evening's lines and the
 * header's style badge.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Command, GameState } from "@full-plate/sim-core";
import { applyCommand, content, decorEffects, findDecorItem, runDay } from "../sim";
import { baseGame } from "./fixtures/round2";
import { DecorateTab, effectWords, withItem } from "../screens/planning/DecorateTab";
import { loadDecorArt, RestaurantView } from "../canvas/RestaurantView";
import { roomLook } from "../canvas/decorArt";
import { decorLines, styleBadge, tiredSlots } from "../lib/decor";
import { formatPence } from "../lib/format";

afterEach(cleanup);

// A stubbed 2D context (jsdom has none): counts texts and full-canvas blits, and every other call is a no-op.
const texts: string[] = [];
const original = HTMLCanvasElement.prototype.getContext;
beforeAll(async () => {
  const grad = { addColorStop() {} };
  const make = () => {
    const target: Record<string, unknown> = {
      fillText: (t: string) => { texts.push(t); },
      measureText: (t: string) => ({ width: t.length * 7 }),
      createLinearGradient: () => grad, createRadialGradient: () => grad,
    };
    return new Proxy(target, { get: (o, k: string) => (k in o ? o[k] : () => {}), set: (o, k: string, v) => { o[k] = v; return true; } });
  };
  HTMLCanvasElement.prototype.getContext = function () { return make(); } as unknown as HTMLCanvasElement["getContext"];
  await loadDecorArt();
});
afterAll(() => { HTMLCanvasElement.prototype.getContext = original; });

function planning(seed = 31): GameState {
  return baseGame(seed);
}

/** The tab with a real sim behind `send`. */
function Harness({ start }: { start: GameState }) {
  const [game, setGame] = useState(start);
  const send = (cmd: Command) => setGame((g) => applyCommand(content, g, cmd).state);
  return <><DecorateTab game={game} send={send} /><output data-testid="cash">{game.cash}</output></>;
}

describe("Decorate tab", () => {
  it("lists the slot's catalogue with prices and effect words", async () => {
    render(<DecorateTab game={planning()} send={() => {}} />);
    for (const name of ["Oak planks", "Big cosy rugs", "Black-and-white tiles", "Terrazzo", "Herringbone parquet"]) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getAllByText(formatPence(findDecorItem(content, "floor_parquet")!.price, { whole: true })).length).toBeGreaterThan(0);
    expect(effectWords(findDecorItem(content, "light_brass")!)).toEqual(["Smarter", "+1 prestige", "Guests stay longer", "Guests order more"]);
    // the slot row: nine 44 px buttons with a word each
    const slots = within(screen.getByRole("group", { name: "Choose what to decorate" })).getAllByRole("button");
    expect(slots.map((b) => b.textContent)).toEqual(["Floor", "Walls", "Lights", "Seats", "Tables", "Sign", "Plants", "Music", "Window"]);
    fireEvent.click(slots[2]!);
    expect(screen.getByText("Crystal chandeliers")).toBeTruthy();
    expect(screen.getByText("In your restaurant")).toBeTruthy(); // the bare bulbs
  });

  it("buys: pays, says it's coming tomorrow, and can be changed back for a refund", () => {
    const start = planning();
    render(<Harness start={start} />);
    fireEvent.click(screen.getByRole("button", { name: "Walls" }));
    const sunny = findDecorItem(content, "walls_sunny")!;
    fireEvent.click(screen.getByRole("button", { name: `Buy · fit tomorrow · ${formatPence(sunny.price, { whole: true })}` }));
    expect(Number(screen.getByTestId("cash").textContent)).toBe(start.cash - sunny.price);
    expect(screen.getByText("Coming tomorrow")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep this one" }));
    expect(Number(screen.getByTestId("cash").textContent)).toBe(start.cash);
  });

  it("says how much more cash is needed instead of a buy button", () => {
    render(<DecorateTab game={{ ...planning(), cash: 10_000 }} send={() => {}} />);
    const parquet = findDecorItem(content, "floor_parquet")!;
    const btn = screen.getByRole("button", { name: `Need ${formatPence(parquet.price - 10_000, { whole: true })} more` });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a tired item and refreshes it", () => {
    const item = findDecorItem(content, "seat_cushions")!;
    const start: GameState = { ...planning(), day: item.lifeDays + 3, decor: { slots: { seating: { itemId: item.id, since: 0 } } } };
    expect(tiredSlots(start)).toEqual(["seating"]);
    render(<Harness start={start} />);
    fireEvent.click(screen.getByRole("button", { name: "Seats, looking tired" }));
    expect(screen.getByText("Looking tired")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: `Refresh · ${formatPence(item.refreshCost, { whole: true })}` }));
    expect(Number(screen.getByTestId("cash").textContent)).toBe(start.cash - item.refreshCost);
    expect(screen.queryByText("Looking tired")).toBeNull();
  });

  it("the prestige hint says what the room goes to", () => {
    render(<DecorateTab game={planning()} send={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Walls" }));
    const card = screen.getByText("Silk damask").closest("li")!;
    expect(within(card).getByText(/Room prestige/).textContent).toBe("Room prestige 0 → +2");
  });

  it("hovering a card previews it (the caption names it)", () => {
    render(<DecorateTab game={planning()} send={() => {}} />);
    const card = screen.getByText("Terrazzo").closest("li")!;
    fireEvent.mouseEnter(card);
    expect(screen.getByText(/Trying out/).textContent).toContain("Terrazzo");
    fireEvent.mouseLeave(card);
    expect(screen.getByText("This is your room today.")).toBeTruthy();
  });
});

describe("the floor canvas with decor", () => {
  it("rebuilds the cached scene when the decor shown changes, not every frame", async () => {
    const game = planning();
    const view = new RestaurantView(document.createElement("canvas"));
    view.resize(900, 620, 1);
    view.render(game, { content, speed: 0, now: 0 });
    view.render(game, { content, speed: 0, now: 16 });
    expect(view.layerBuilds).toBe(1);
    const neon = withItem(game, findDecorItem(content, "sign_neon")!);
    view.render(neon, { content, speed: 0, now: 32 });
    view.render(neon, { content, speed: 0, now: 48 });
    expect(view.layerBuilds).toBe(2);
    const both = withItem(neon, findDecorItem(content, "floor_checker")!);
    view.render(both, { content, speed: 0, now: 64 });
    expect(view.layerBuilds).toBe(3);
    // going tired is a new picture too
    const tired = { ...both, day: both.day + 400 };
    view.render(tired, { content, speed: 0, now: 80 });
    expect(view.layerBuilds).toBe(4);
    expect(roomLook(content, tired).wear.signage).toBe(2);
  });

  it("draws every slot's bought item and a dust sheet on the fitters' tables", () => {
    let g = planning();
    for (const id of ["floor_parquet", "walls_damask", "light_chandelier", "seat_velvet", "table_marble", "sign_gold", "plant_flowerwall", "music_piano", "window_cakes"]) g = withItem(g, findDecorItem(content, id)!);
    g = { ...g, decor: { ...g.decor!, fitting: { day: g.day, tables: 2, slots: ["floor"] } } };
    const look = roomLook(content, g);
    expect(look.closed).toEqual(g.tables.slice(-2).map((t) => t.id));
    expect(Object.values(look.items).every((id) => !findDecorItem(content, id)?.starter)).toBe(true);
    const view = new RestaurantView(document.createElement("canvas"));
    view.resize(1100, 700, 1);
    texts.length = 0;
    for (let i = 0; i < 3; i++) view.render(g, { content, speed: 1, now: i * 16 });
    expect(texts).toContain(g.restaurantName.toUpperCase());
    expect(decorEffects(content, g).style).toBe("posh");
  });
});

describe("evening and header", () => {
  it("one line per new item's first night, the fitters, and items gone tired", () => {
    let g = planning();
    for (const d of content.dishes.filter((x) => x.course === "main").slice(0, 3)) g = applyCommand(content, g, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice }).state;
    g = applyCommand(content, g, { type: "BUY_DECOR", slot: "lighting", itemId: "light_brass" }).state;
    g = runDay(content, g).state;
    if (g.phase === "event") g = applyCommand(content, g, { type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === g.activeEvent?.eventId)!.choices[0]!.id }).state;
    else g = applyCommand(content, g, { type: "END_DAY" }).state;
    g = runDay(content, g).state;
    const lines = decorLines(g.history.at(-1)!, g);
    expect(lines[0]).toMatchObject({ title: "Your new brass pendants", text: "Guests stayed a bit longer and ordered more." });
    expect(lines[1]?.title).toBe("The fitters were in");
  });

  it("the header names the style once three bought items share it", () => {
    let g = planning();
    expect(styleBadge(g)).toBeUndefined();
    for (const id of ["seat_cushions", "music_radio", "sign_chalk"]) g = withItem(g, findDecorItem(content, id)!);
    expect(styleBadge(g)).toEqual({ tag: "cosy", name: "Cosy café" });
  });

  it("the Decorate tab is a lazy chunk (Planning only imports it with import())", async () => {
    const src = (await import("node:fs")).readFileSync(`${__dirname}/../screens/Planning.tsx`, "utf8");
    expect(src).toMatch(/lazyRetry\(\(\) => import\("\.\/planning\/DecorateTab"\)/); // R14 (C): every lazy part is a lazyRetry
    expect(src).not.toMatch(/^import .*DecorateTab/m);
    await act(async () => {});
  });
});
