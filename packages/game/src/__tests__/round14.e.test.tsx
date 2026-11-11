/**
 * Round 14 (E): the first hour on a phone — RED-TEAM-2 U1, U3, U4, U7, U11, U12, U17, U18, U20 and discoverability.
 * Each block turns the reviewer's reproduction into a check that fails on master `823733b` and passes here. Layout that
 * only a real browser shows (scroll positions, clipped controls at 390 / 320 px) is guarded by the probe's `notAtTop`
 * and `clipped` counts (scripts/probe.mjs, baseline 0 on the upright phone); these tests guard the code and the CSS.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DayResult, GameState } from "@full-plate/sim-core";
import { content } from "../sim";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { resetSettingsCache } from "../lib/settings";
import { PHONE_ANY_QUERY, PHONE_PORTRAIT_QUERY, PHONE_QUERY } from "../lib/layout";
import { focusScreenHeading, lastLandingRequested, TabScrollMemory } from "../lib/scrollTop";
import { landingFor, Planning } from "../screens/Planning";
import { peekJumpRole } from "../screens/Service";
import { StartPicker } from "../screens/StartPicker";
import { NewGame } from "../screens/NewGame";
import { Toast } from "../components/Toast";
import { RotateCard } from "../components/RotateCard";
import { HandsOnHowTo } from "../screens/HandsOnHowTo";
import { GLOSSARY } from "../lib/glossary";
import { busyness, floorFrameFor, noteFloorFrame, resetFloorFrame } from "../lib/floorFrame";
import { canSharePng, isBestNight } from "../lib/postcard";
import { dishIcon } from "../lib/dishIcon";
import { dismissTry, pickTry, readTry, resetTryCache, setTryOff, TRY_KEY, type TryFacts, type TryState } from "../lib/tryNext";
import { TryCard } from "../components/TryCard";
import { resetStorageForTests } from "../lib/storage";

const noop = () => {};
const SRC = join(__dirname, "..");
const phoneCss = readFileSync(join(SRC, "phone.css"), "utf8");
function mockMedia(match: (q: string) => boolean) {
  const mm = vi.fn((q: string) => ({ matches: match(q), media: q, addEventListener: noop, removeEventListener: noop }));
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: mm });
}
afterEach(() => { cleanup(); delete (window as { matchMedia?: unknown }).matchMedia; });
beforeEach(() => { localStorage.clear(); resetStorageForTests(); resetSettingsCache(); resetTryCache(); resetFloorFrame(); });

function owner(dishes = ["margherita", "cheeseburger", "soft_drink"]): AppState {
  let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 7, districtId: content.districts[0]!.id, restaurantName: "Pocket Bistro", difficulty: "normal" } });
  for (const id of dishes) {
    const d = content.dishes.find((x) => x.id === id);
    if (d) s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: id, price: d.suggestedPrice } });
  }
  return s;
}

describe("U1: screens and tabs start at the top; shortcuts land on what they're about", () => {
  it("each tab remembers its own position within a day, opens at the top the first time, and forgets overnight", () => {
    const m = new TabScrollMemory();
    expect(m.enter(0, "menu")).toBe(0);
    m.note(1696);
    expect(m.enter(0, "staff")).toBe(0); // Staff opened at its foot on master: here it starts at the top
    m.note(400);
    expect(m.enter(0, "menu")).toBe(1696); // back to Menu the same day: where she left it
    expect(m.enter(0, "staff")).toBe(400);
    expect(m.enter(1, "staff")).toBe(0); // next morning: every tab starts at the top again
    expect(m.enter(1, "menu")).toBe(0);
  });

  it("focus goes to the new screen's heading only when the pressed button has gone", () => {
    document.body.innerHTML = `<main><h1>Get ready for Monday</h1><button id="b">Stay</button></main>`;
    (document.activeElement as HTMLElement | null)?.blur();
    const h = focusScreenHeading();
    expect(h?.textContent).toBe("Get ready for Monday");
    expect(document.activeElement).toBe(h);
    expect(h?.getAttribute("tabindex")).toBe("-1");
    (document.getElementById("b") as HTMLButtonElement).focus();
    expect(focusScreenHeading()).toBeNull(); // a control still on screen keeps focus
    expect(document.activeElement?.id).toBe("b");
    document.body.innerHTML = "";
  });

  it("the Step 1 nudge lands on the starter-menu button; Staff shortcuts land on the role the goal asks for", () => {
    const empty = owner([]).game!;
    expect(landingFor("menu", empty)).toBe(".starter");
    expect(landingFor("menu", owner().game!)).toBeNull();
    expect(landingFor("staff", empty)).toBe(".candidate--wanted, .hiresheet");
  });

  it("“Hire someone first” switches to Staff and asks to land on the wanted candidate", () => {
    const s = owner();
    const tabs: string[] = [];
    render(<Planning game={s.game!} send={noop} tab="menu" onTab={(t) => tabs.push(t)} meta={s.meta} />);
    fireEvent.click(screen.getByRole("button", { name: /Open for service/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hire someone first" }));
    expect(tabs).toEqual(["staff"]);
    expect(lastLandingRequested()).toBe(".candidate--wanted, .hiresheet");
  });

  it("a hint for the tab already open still lands (Step 1 on Menu)", () => {
    const s = owner([]);
    const tabs: string[] = [];
    render(<Planning game={s.game!} send={noop} tab="menu" onTab={(t) => tabs.push(t)} meta={s.meta} />);
    fireEvent.click(screen.getByRole("button", { name: /Step 1: add dishes/ }));
    expect(tabs).toEqual([]);
    expect(lastLandingRequested()).toBe(".starter");
  });

  it("the probe checks every upright-phone arrival and the walk scrolls each screen to its foot first", () => {
    const probe = readFileSync(join(SRC, "../scripts/probe.mjs"), "utf8");
    const harness = readFileSync(join(SRC, "../scripts/lib/harness.mjs"), "utf8");
    expect(probe).toMatch(/notAtTop/);
    expect(harness).toMatch(/const toFoot = async/);
    expect(harness).toMatch(/const tab = async \(name\) => \{ await toFoot\(\);/);
  });

  it("App resets the scroll on every screen change and holds it against autoFocus", () => {
    const app = readFileSync(join(SRC, "App.tsx"), "utf8");
    expect(app).toMatch(/scrollToTop\(\);\s*const hold = holdTopAfterScreenChange\(\);/);
  });
});

describe("U3: the price stepper is never clipped on a phone", () => {
  it("phone.css gives the stepper its own full-width row in a menu row (with or without Goals) and never clips its buttons", () => {
    expect(phoneCss).toMatch(/html \.dish > \.stepper, html \.planning__body--goals \.dish > \.stepper \{ grid-column: 1 \/ -1;[^}]*overflow: visible;/);
    expect(phoneCss).toMatch(/html \.stepper \{ overflow: visible; max-width: 100%; \}/);
  });
  it("the probe counts clipped controls", () => {
    const probe = readFileSync(join(SRC, "../scripts/probe.mjs"), "utf8");
    expect(probe).toMatch(/const clipped = \[\];/);
    expect(probe).toMatch(/sum\.clipped \+= m\.clipped\.length/);
  });
});

describe("U4: the hands-on shift at the sheet's peek; the dock says what will happen", () => {
  it("offers to cook when no chef is on (loud), to serve when only the floor is empty, and goes quiet after Day 3", () => {
    const g = owner().game!;
    expect(peekJumpRole(g)).toEqual({ role: "chef", label: "Cook it yourself", loud: true });
    const today = new Array(7).fill(true);
    const chef = { ...(g.staff[0] ?? {}), id: "c1", role: "chef", rota: today } as GameState["staff"][number];
    const server = { ...chef, id: "s1", role: "server" } as GameState["staff"][number];
    expect(peekJumpRole({ ...g, staff: [chef] })).toEqual({ role: "server", label: "Serve it yourself", loud: true });
    expect(peekJumpRole({ ...g, day: 5, staff: [chef, server] })).toEqual({ role: "chef", label: "Cook it yourself", loud: false });
    expect(peekJumpRole({ ...g, day: 5, staff: [server] }).loud).toBe(true);
  });
  it("the planning dock no longer promises she'll cook when she'll be watching", () => {
    const s = owner();
    render(<Planning game={s.game!} send={noop} tab="menu" onTab={noop} meta={s.meta} />);
    expect(document.body.textContent).not.toMatch(/you'll cook yourself|you'll be cooking|you'll be serving/);
    expect(screen.getByRole("button", { name: /cover the kitchen/ })).toBeTruthy();
  });
});

describe("U7: one new-game flow, nothing asked twice", () => {
  it("the start picker doesn't ask an owner where to open (the lease screen does); a career still picks its street", () => {
    const calls: string[] = [];
    render(<StartPicker content={content} onBack={noop} onOwner={(d, id) => calls.push(`${d}:${id}`)} onCareer={noop} />);
    expect(screen.queryByText(/Where will you open\?/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Choose a name/ }));
    expect(calls).toEqual(["normal:"]);
    fireEvent.click(screen.getByRole("radio", { name: /^Apprentice chef/ }));
    expect(screen.getByText(/Where's your first job\?/)).toBeTruthy();
  });
  it("the lease screen asks the name first, then where (once), then how tricky, then the lease", () => {
    render(<NewGame content={content} initialSeed={1} initialDifficulty="normal" onStart={noop} onBack={noop} />);
    expect(screen.getAllByText(/Where will you open\?/)).toHaveLength(1);
    const name = screen.getByRole("textbox", { name: /What's it called/ });
    const where = screen.getByRole("radiogroup", { name: "District" });
    const lease = screen.getByRole("button", { name: /Sign the lease/ });
    expect(name.compareDocumentPosition(where) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(where.compareDocumentPosition(lease) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(name.getAttribute("enterkeyhint")).toBe("next");
  });
  it("on a phone the streets are a compact list (the picked one shows who walks past and its busy months)", () => {
    expect(phoneCss).toMatch(/html \.district\[aria-checked="false"\] \.district__more \{ display: none; \}/);
    render(<NewGame content={content} initialSeed={1} onStart={noop} onBack={noop} />);
    expect(document.querySelectorAll(".district__more").length).toBe(content.districts.length * 2);
  });
});

describe("U11 / U12: toasts and small screens", () => {
  it("a service toast on a phone sits along the top edge, not over the middle of the floor", () => {
    mockMedia((q) => q === PHONE_QUERY || q === PHONE_ANY_QUERY);
    const stage = document.createElement("div"); stage.className = "service__stage"; document.body.appendChild(stage);
    render(<Toast toast={{ id: 1, text: "🎉 Goal complete: Put 6 dishes on the menu", tone: "good" }} onDismiss={noop} />);
    const region = document.querySelector(".toast-region") as HTMLElement;
    expect(region.classList.contains("toast-region--top")).toBe(true);
    expect(region.classList.contains("toast-region--stage")).toBe(false);
    expect(region.style.top).toBe("");
    stage.remove();
  });
  it("phone.css places toasts above the dock (upright) and top right (sideways / 200 % zoom), and keeps Skip on screen", () => {
    expect(phoneCss).toMatch(/html \.toast-region\.toast-region--top \{ top: calc\(4px \+ env\(safe-area-inset-top, 0px\)\)/);
    expect(phoneCss).toMatch(/html \.toast-region:not\(\.toast-region--stage\) \{ left: auto; right: 8px;/);
    expect(phoneCss).toMatch(/html \.service__side \.service__skip \{ position: sticky; bottom: 0;/);
  });
  it("320 px: the menu view toggle and the tab bar share the width", () => {
    expect(phoneCss).toMatch(/html \.menuview \{ display: flex; max-width: 100%; \}/);
    expect(phoneCss).toMatch(/html \.planning__bar \.tab \{ flex: 1 1 0; min-width: 0;/);
  });
  it("the page reaches the safe areas (viewport-fit=cover) and the fixed bars keep clear of them", () => {
    expect(readFileSync(join(SRC, "../index.html"), "utf8")).toMatch(/viewport-fit=cover/);
    expect(phoneCss).toMatch(/html \.status-wrap \{ padding-top: env\(safe-area-inset-top, 0px\); \}/);
    expect(phoneCss).toMatch(/html \.servsheet__peek \{ padding-bottom: calc\(8px \+ env\(safe-area-inset-bottom, 0px\)\); \}/);
  });
});

describe("U17: rotate first, then the how-to; Office and On the pass have tips", () => {
  it("the how-to waits while the turn card is up and shows once she carries on upright", () => {
    mockMedia((q) => q === PHONE_PORTRAIT_QUERY || q === PHONE_QUERY || q === PHONE_ANY_QUERY);
    render(<><RotateCard /><HandsOnHowTo cards={[{ title: "Walk", body: "Tap a station." }]} step={0} onNext={noop} onSkip={noop} /></>);
    expect(screen.getByText("Turn your phone sideways")).toBeTruthy();
    expect(screen.queryByText("Walk")).toBeNull();
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Play it upright anyway" })); });
    expect(screen.queryByText("Turn your phone sideways")).toBeNull();
    expect(screen.getByText("Walk")).toBeTruthy();
  });
  it("the glossary explains Office; the shift and the Jump in card use the terms", () => {
    expect(GLOSSARY.office.explain).toMatch(/watch the rest/);
    expect(readFileSync(join(SRC, "screens/HandsOnShift.tsx"), "utf8")).toMatch(/<Term id="office" inline inButton="passive">Office<\/Term>/);
    expect(readFileSync(join(SRC, "screens/Service.tsx"), "utf8")).toMatch(/On the <Term id="pass" inline inButton>pass<\/Term>/);
  });
});

describe("U18: the postcard", () => {
  const day = (d: number, profit: number): DayResult => ({ day: d, profit, closed: false } as DayResult);
  it("knows the best night (most profit of all, two nights in)", () => {
    expect(isBestNight([day(0, 50)], day(0, 50))).toBe(false);
    expect(isBestNight([day(0, 50), day(1, 80)], day(1, 80))).toBe(true);
    expect(isBestNight([day(0, 90), day(1, 80)], day(1, 80))).toBe(false);
    expect(isBestNight([day(0, -10), day(1, -5)], day(1, -5))).toBe(false);
  });
  it("keeps the day's busiest service frame for the picture (not the empty room after closing)", () => {
    const g = owner().game!;
    const c = (id: string, stage: string) => ({ id, stage } as unknown as GameState["customers"][number]);
    const quiet = { ...g, phase: "service", customers: [c("a", "seated")] } as GameState;
    const busy = { ...g, phase: "service", customers: [c("a", "eating"), c("b", "ordered"), c("q", "queue")] } as GameState;
    expect(busyness(busy)).toBe(2);
    noteFloorFrame(quiet); noteFloorFrame(busy); noteFloorFrame(quiet);
    expect(floorFrameFor(g.day)).toBe(busy);
    noteFloorFrame({ ...busy, phase: "evening" } as GameState);
    expect(floorFrameFor(g.day)).toBe(busy);
    expect(floorFrameFor(g.day + 1)).toBeNull();
  });
  it("shares the picture as a file where the browser can, else falls back to saving", () => {
    expect(canSharePng()).toBe(false); // jsdom: no navigator.share
    const nav = navigator as unknown as Record<string, unknown>;
    nav.share = vi.fn(); nav.canShare = vi.fn(() => true);
    expect(canSharePng()).toBe(true);
    delete nav.share; delete nav.canShare;
  });
});

describe("Discoverability: New thing to try", () => {
  const facts = (f: Partial<TryFacts> = {}): TryFacts => ({ day: 1, activeDishes: 3, profitableNight: false, regularJoined: false, rivalPosted: false, canShare: false, ...f });
  const none: TryState = { off: false, dismissed: [] };
  it("never on Day 1; one item a day; a dismissed one isn't replaced that day and never comes back", () => {
    expect(pickTry(none, "k0", facts({ day: 0 })).id).toBeNull();
    const d2 = pickTry(none, "k1", facts());
    expect(d2.id).toBe("cook");
    const after = { ...d2.next, dismissed: ["cook" as const] };
    expect(pickTry(after, "k1", facts()).id).toBeNull(); // same day: nothing else
    expect(pickTry(after, "k2", facts({ day: 2 })).id).toBe("brand"); // next day: the next thing
    expect(pickTry({ ...none, off: true }, "k1", facts()).id).toBeNull();
    expect(pickTry(none, "k5", facts({ day: 4, canShare: false })).id).toBe("cook");
    const all: TryState = { off: false, dismissed: ["cook", "brand", "invent", "challenge"] };
    expect(pickTry(all, "k9", facts({ day: 4, canShare: true })).id).toBe("share");
    expect(pickTry(all, "k9", facts({ day: 4 })).id).toBeNull(); // sharing doesn't work here: not offered
  });
  it("an item left alone for three days retires itself (it doesn't nag)", () => {
    let st: TryState = { off: false, dismissed: ["cook", "brand"] };
    const seen: (string | null)[] = [];
    for (let d = 2; d <= 6; d++) { const r = pickTry(st, `k${d}`, facts({ day: d })); seen.push(r.id); st = r.next; }
    expect(seen).toEqual(["invent", "invent", "invent", "challenge", "challenge"]);
  });
  it("stores through lib/storage and survives a reload", () => {
    dismissTry("brand"); setTryOff(true);
    expect(JSON.parse(localStorage.getItem(TRY_KEY) ?? localStorage.getItem(Object.keys(localStorage).find((k) => k.endsWith("try-next:v1"))!) ?? "{}")).toBeTruthy();
    resetTryCache();
    expect(readTry()).toMatchObject({ off: true, dismissed: ["brand"] });
  });
  it("the card shows from Day 2, its button goes there, and × makes it go away", () => {
    let s = owner();
    s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
    for (let i = 0; i < 400 && s.game!.phase === "service"; i++) s = appReducer(s, { type: "ticks", n: 10 });
    s = appReducer(s, { type: "nextDay" });
    expect(s.game!.day).toBe(1);
    const went: string[] = [];
    render(<TryCard game={s.game!} meta={s.meta} onGo={(id) => went.push(id)} />);
    expect(screen.getByText("New thing to try")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Cook tonight/ }));
    expect(went).toEqual(["cook"]);
    expect(screen.queryByText("New thing to try")).toBeNull(); // used = gone, and nothing else today
  });
  it("Settings has the switch", () => {
    expect(readFileSync(join(SRC, "components/SettingsBody.tsx"), "utf8")).toMatch(/New things to try/);
  });
});

describe("U20: polish", () => {
  it("dishes get their own picture, not one per course", () => {
    const starters = content.dishes.filter((d) => d.course === "starter").map((d) => dishIcon(d.name, d.course));
    expect(new Set(starters).size).toBeGreaterThan(4);
    expect(dishIcon("Cheesy garlic bread", "starter")).toBe("🥖");
    expect(dishIcon("Prawn cocktail", "starter")).toBe("🍤");
    expect(dishIcon("Steak & ale pie", "main")).toBe("🥧");
    expect(dishIcon("Pint of lager", "drink")).toBe("🍺");
  });
  it("one restock wording; the two recipe lists say what they are", () => {
    expect(readFileSync(join(SRC, "screens/planning/StockWarning.tsx"), "utf8")).not.toMatch(/Order to cover tomorrow/);
    expect(readFileSync(join(SRC, "screens/planning/MenuTab.tsx"), "utf8")).toMatch(/Recipes that come with the game/);
    expect(readFileSync(join(SRC, "screens/planning/CookbookStrip.tsx"), "utf8")).toMatch(/Recipes you made up/);
  });
  it("the game-over tiles wrap on a phone; the fork's two choices stack", () => {
    expect(phoneCss).toMatch(/html \.gameover__stats \.kpi__v \{ flex-wrap: wrap;/);
    expect(phoneCss).toMatch(/html \.fork__cards \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });
});
