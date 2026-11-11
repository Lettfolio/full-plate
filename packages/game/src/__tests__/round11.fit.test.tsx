/**
 * Round 11 (D): tablet and child fit — red-team U1, U7–U11 and the U12 items D owns. Real sim and reducer throughout.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { formatPence as simFormatPence, poundsText } from "@full-plate/sim-core";
import { pounds as careerPounds } from "@full-plate/sim-career";
import { GROWN_UP_WORDS } from "@full-plate/content";
import { content, serialize, syncSoftDrinks, runDay, applyCommand } from "../sim";
import { appReducer, initialAppState, type AppState } from "../state/gameReducer";
import { decodeSave, encodeSave } from "../state/save";
import { autosaveKey } from "../state/useSaves";
import { formatPence, formatPounds } from "../lib/format";
import { DEFAULT_SETTINGS, getSettings, resetSettingsCache, SETTINGS_KEY, startSpeed } from "../lib/settings";
import { NARROW_QUERY, pointWord } from "../lib/layout";
import { Term } from "../components/Term";
import { termParts } from "../components/TermText";
import { WordsSheet, wordsOnScreen } from "../components/WordsSheet";
import { focusMainAction } from "../App";
import { Service } from "../screens/Service";
import { StartPicker } from "../screens/StartPicker";
import { NewGame } from "../screens/NewGame";
import { BoardMeeting } from "../screens/paths/BoardMeeting";
import { StarsTab } from "../screens/paths/StarsTab";
import { GoalExplainer } from "../components/GoalExplainer";
import { empireGame, withMeeting } from "./fixtures/empire";

// Round 13 (A): Service starts lazy imports (the floor renderer, the regulars' names) when it mounts; let them land before
// the environment is torn down, or vitest reports an EnvironmentTeardownError now and then (pre-existing; it failed
// `pnpm -r test` on a busy machine).
afterAll(async () => { await Promise.all([import("../canvas/RestaurantView"), import("../lib/regulars")]); });

const CSS = readFileSync(join(__dirname, "..", "theme.css"), "utf8");
const noop = () => {};
/**
 * Round 11b (the player is 14): trade words are back on screen, each inside a glossary term. The check is now "every
 * trade word on screen is a term": take every `.term` out and no trade word may be left; and every term carries its tip.
 */
const outsideTerms = (el: Element) => {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll(".term").forEach((t) => t.remove());
  return (c.textContent ?? "").replace(/\s+/g, " ");
};
/** Visible words (tooltips out): what a sighted player reads. */
const plainText = (el: Element) => {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll(".term__tip").forEach((t) => t.remove());
  return (c.textContent ?? "").replace(/\s+/g, " ");
};
/** Bare "86" is left out: it is also a number on screen (patience 86); the 86 buttons are checked by term count. */
const JARGON = /\b(86'd|footfall|covers|segments?|wholesalers?|royalt(y|ies)|VAT|HMRC|call-out|tronc|sommeliers?|satellites?|comp|comped|franchisees?|HQ)\b/i;
function expectTermsExplained(el: Element) {
  expect(outsideTerms(el)).not.toMatch(JARGON);
  for (const t of el.querySelectorAll<HTMLElement>(".term")) {
    const tip = t.querySelector(".term__tip");
    expect(tip?.textContent ?? "", t.textContent ?? "").toMatch(/^[^:]+: .{10,}/);
  }
}

function owner(seed = 11, difficulty: "cosy" | "normal" = "normal"): AppState {
  let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed, districtId: content.districts[0]!.id, restaurantName: "Fit Test", difficulty } });
  for (const id of ["margherita", "cheeseburger", "soft_drink", "cheesy_garlic_bread"]) {
    const d = content.dishes.find((x) => x.id === id);
    if (d) s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: id, price: d.suggestedPrice } });
  }
  s = appReducer(s, { type: "command", cmd: { type: "HIRE", candidateIndex: 0 } });
  return appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
}

afterEach(cleanup);
// Service measures its floor with a ResizeObserver (jsdom has none); the canvas view itself never draws here.
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

describe("U1: iPad portrait", () => {
  it("one narrow breakpoint: no 1024 px floor, the header in two rows, tabs that scroll, service stacked", () => {
    expect(NARROW_QUERY).toBe("(max-width: 1023px)");
    const block = CSS.slice(CSS.indexOf("R11-D: tablet and child fit"));
    const narrow = block.slice(block.indexOf("@media (max-width: 1023px)"));
    expect(narrow).toMatch(/body \{ min-width: 0; \}/);
    expect(narrow).toMatch(/\.status \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
    expect(narrow).toMatch(/\.planning__bar \.tabs \{[^}]*overflow-x: auto/);
    expect(narrow).toMatch(/\.tabs\[data-more-right\]/);
    expect(narrow).toMatch(/\.service \{ grid-template-columns: minmax\(0, 1fr\); grid-template-rows:/);
    expect(narrow).toMatch(/\.actiondock \{ flex-wrap: wrap;/);
  });

  it("'Click a table' says 'Tap' on a touch screen", () => {
    expect(pointWord(true)).toBe("Tap");
    expect(pointWord(false)).toBe("Click");
  });
});

describe("U9: keyboard", () => {
  it("glossary terms are out of the Tab order but still focus on tap and keep their tooltip", () => {
    const { container } = render(<p><Term id="royalty" /><Term id="covers" inline /></p>);
    const terms = [...container.querySelectorAll<HTMLElement>(".term")];
    expect(terms).toHaveLength(2);
    for (const t of terms) {
      expect(t.getAttribute("tabindex")).toBe("-1");
      expect(document.getElementById(t.getAttribute("aria-describedby")!)!.getAttribute("role")).toBe("tooltip");
      t.focus();
      expect(document.activeElement).toBe(t);
    }
  });

  it("'?' opens the words sheet with every term on screen", async () => {
    render(<div><p><Term id="footfall" inline /> and <Term id="tronc" /></p><WordsSheet /></div>);
    expect(wordsOnScreen().map((w) => w.tip.split(":")[0])).toEqual(["footfall", "tronc"]);
    act(() => { fireEvent.keyDown(window, { key: "?" }); });
    const d = await screen.findByRole("dialog", { name: "What the words mean" });
    expect(d.textContent).toContain("People walking past");
    expect(d.textContent).toContain("Shared tips");
  });

  it("the skip link lands on the screen's one primary, or the hint that says what to do instead", () => {
    document.body.innerHTML = `<div class="actiondock"><button class="hint hint--link">Add dishes</button><button class="btn btn--xl" disabled>Open</button></div>`;
    expect(focusMainAction()?.textContent).toBe("Add dishes");
    document.body.innerHTML = `<div class="actiondock"><button class="btn btn--xl">Open for service</button></div>`;
    expect(focusMainAction()?.textContent).toBe("Open for service");
    document.body.innerHTML = `<button class="btn" data-main-action>Skip to evening</button>`;
    expect(document.activeElement).not.toBe(document.querySelector("[data-main-action]"));
    expect(focusMainAction()).toBe(document.activeElement);
    document.body.innerHTML = "";
  });
});

describe("U10: pacing", () => {
  beforeEach(() => { localStorage.clear(); resetSettingsCache(); });

  it("Skip to evening runs the same ticks as watching: identical end state", () => {
    const start = owner(23);
    let watched = start;
    for (let i = 0; i < 1000 && watched.game!.phase === "service"; i++) watched = appReducer(watched, { type: "ticks", n: 1 });
    const skipped = appReducer(start, { type: "skipShift" });
    expect(skipped.game!.phase).not.toBe("service");
    expect(serialize(skipped.game!)).toBe(serialize(watched.game!));
  });

  it("the owner's service has a Skip to evening button; a picked speed is remembered", () => {
    const s = owner(5);
    let skipped = 0;
    render(<Service game={s.game!} app={s} send={noop} runTicks={noop} onSkip={() => { skipped++; }} onJumpIn={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip to evening" }));
    expect(skipped).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Speed 2x" }));
    expect(getSettings()).toMatchObject({ defaultSpeed: 2, speedPicked: true });
  });

  it("Cosy starts service at 4× until a speed is picked; the remembered speed wins after that", () => {
    expect(startSpeed(DEFAULT_SETTINGS, "cosy")).toBe(4);
    expect(startSpeed(DEFAULT_SETTINGS, "normal")).toBe(1);
    expect(startSpeed({ ...DEFAULT_SETTINGS, defaultSpeed: 2, speedPicked: true }, "cosy")).toBe(2);
  });

  it("How do I win? says honestly how long the first year takes", () => {
    render(<GoalExplainer onClose={noop} />);
    expect(screen.getByRole("dialog").textContent).toMatch(/365 days in the game.*3 to 6 hours/);
  });
});

describe("U11: reload mid-shift", () => {
  it("autosaves once per sim-hour of service and when hands-on starts", () => {
    const s = owner(9);
    const k0 = autosaveKey(s.game!, s.meta);
    const later = appReducer(s, { type: "ticks", n: 2 });
    expect(autosaveKey(later.game!, later.meta)).toBe(k0); // same hour: no save
    let hour = s;
    while (hour.game!.phase === "service" && autosaveKey(hour.game!, hour.meta) === k0) hour = appReducer(hour, { type: "ticks", n: 1 });
    expect(hour.game!.phase).toBe("service");
    const jumped = appReducer(hour, { type: "handsOnStart", meta: { role: "chef", jumpIn: true } });
    expect(autosaveKey(jumped.game!, jumped.meta)).not.toBe(autosaveKey(hour.game!, hour.meta));
  });

  it("a save made while playing hands-on loads back into hands-on play at the saved clock, with a note", () => {
    let s = owner(9);
    s = appReducer(s, { type: "ticks", n: 7 });
    s = appReducer(s, { type: "handsOnStart", meta: { role: "server", jumpIn: true } });
    const raw = encodeSave(s.game!, s.meta);
    const loaded = decodeSave(raw);
    expect(loaded.meta.handsOnResume).toEqual({ role: "server", jumpIn: true });
    // "load" still drops the live session (the round-4/5 contract); App then dispatches "resumeHandsOn".
    const l = appReducer(initialAppState, { type: "load", game: loaded.game, meta: loaded.meta });
    expect(l.meta.handsOn).toBeUndefined();
    expect(decodeSave(encodeSave(l.game!, l.meta)).meta.handsOnResume).toEqual({ role: "server", jumpIn: true }); // survives a save before use
    const r = appReducer(l, { type: "resumeHandsOn" });
    expect(r.game!.phase).toBe("service");
    expect(r.game!.tick).toBe(s.game!.tick);
    expect(r.meta.handsOn).toMatchObject({ role: "server", jumpIn: true });
    expect(r.meta.handsOnResume).toBeUndefined();
    expect(r.toast?.text).toMatch(/^Back on your shift/);
    // An evening save never resumes hands-on.
    expect(decodeSave(encodeSave({ ...s.game!, phase: "evening" }, s.meta)).meta.handsOnResume).toBeUndefined();
  });
});

describe("U8: Hide alcoholic drinks (off by default since Round 11b)", () => {
  afterEach(() => { syncSoftDrinks(getSettings().noGrownUpDrinks); });

  it("is off by default (real drinks), and when switched on swaps the drinks' words, never their ids or numbers", () => {
    expect(DEFAULT_SETTINGS.noGrownUpDrinks).toBe(false);
    syncSoftDrinks(DEFAULT_SETTINGS.noGrownUpDrinks);
    expect(content.dishes.find((d) => d.id === "lager")!.name).toBe("Pint of lager");
    syncSoftDrinks(true);
    const lager = content.dishes.find((d) => d.id === "lager")!;
    expect(lager.name).toBe("Tall fizzy lemonade");
    expect(content.dishes.find((d) => d.id === "espresso_martini")!.name).toBe("Iced mocha");
    for (const d of content.dishes) expect(`${d.name} ${d.blurb ?? ""}`).not.toMatch(GROWN_UP_WORDS);
    for (const i of content.ingredients) expect(i.name).not.toMatch(GROWN_UP_WORDS);
    syncSoftDrinks(false);
    expect(lager.name).toBe("Pint of lager");
  });

  it("the sim gives identical numbers with the setting on or off (a week with the grown-up drinks on the menu)", () => {
    const week = () => {
      let g = owner(31).game!;
      g = applyCommand(content, { ...g, phase: "planning" }, { type: "ADD_MENU_ITEM", dishId: "lager", price: content.dishes.find((d) => d.id === "lager")!.suggestedPrice }).state;
      for (let d = 0; d < 7 && g.phase !== "gameover"; d++) {
        g = runDay(content, g).state;
        if (g.phase === "event") g = applyCommand(content, g, { type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === g.activeEvent?.eventId)!.choices[0]!.id }).state;
        else if (g.phase === "evening") g = applyCommand(content, g, { type: "END_DAY" }).state;
      }
      return { cash: g.cash, rng: g.rngState, history: g.history.map((h) => [h.day, h.covers, h.revenue, h.profit]) };
    };
    syncSoftDrinks(false);
    const off = week();
    syncSoftDrinks(true);
    expect(week()).toEqual(off);
  });

  it("the Settings field is stored with the other preferences", () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ noGrownUpDrinks: false }));
    resetSettingsCache();
    expect(getSettings().noGrownUpDrinks).toBe(false);
    localStorage.clear(); resetSettingsCache();
  });
});

describe("U7 (re-targeted in Round 11b): every trade word on screen is a glossary term", () => {
  it("start picker and lease: footfall is on screen, tipped", () => {
    const a = render(<StartPicker content={content} onBack={noop} onOwner={noop} onCareer={noop} />);
    expectTermsExplained(a.container);
    cleanup();
    const b = render(<NewGame content={content} initialSeed={1} initialDifficulty="normal" onStart={noop} onBack={noop} />);
    expectTermsExplained(b.container);
    const ff = b.container.querySelector("[data-term-id='footfall']")!;
    expect(plainText(ff)).toBe("Footfall");
  });

  it("service: '86' on the list and its buttons (named for screen readers), the log's 86'd tipped", () => {
    const s = owner(5);
    const { container } = render(<Service game={s.game!} app={{ ...s, ticker: [...s.ticker, { day: 0, tick: 30, kind: "bad", text: "Cheeseburger has run out — 86'd for today." }] }} send={noop} runTicks={noop} onSkip={noop} onJumpIn={noop} />);
    expectTermsExplained(container);
    expect(plainText(container)).toContain("86 a dish for the rest of today");
    expect(container.querySelectorAll("[data-term-id='eightySix']").length).toBeGreaterThan(2);
    expect(screen.getAllByRole("button", { name: /^86 .* \(take it off for today\)$/ }).length).toBeGreaterThan(0);
  });

  it("the board meeting and the Stars tab: HQ, royalties, satellites — each tipped", () => {
    const s = withMeeting(empireGame());
    const b = render(<BoardMeeting empire={s.meta.empire!} meeting={s.meta.empire!.boardMeeting!} send={noop} />);
    expectTermsExplained(b.container);
    expect(plainText(b.container)).toMatch(/HQ (made|lost)/);
    expect(b.container.querySelector("[data-term-id='hq']")).toBeTruthy();
    cleanup();
    const st = appReducer({ ...empireGame(), meta: { ...empireGame().meta, empire: undefined, fork: { offered: true } } }, { type: "fork", choice: "stars" });
    const t = render(<StarsTab game={st.game!} meta={st.meta} stars={st.meta.stars!} send={noop} onTastingMenu={noop} />);
    expectTermsExplained(t.container);
  });

  it("TermText tips the trade words in sim and content lines, and leaves look-alikes alone", () => {
    const parts = (t: string) => termParts(t).filter((p) => typeof p !== "string").map((p) => (p as { word: string; id: string }).id);
    expect(parts("No stock for Fish — 86'd for today.")).toEqual(["eightySix"]);
    expect(parts("HQ gives up about £2,000. Priya asks for a royalty holiday.")).toEqual(["hq", "feeHoliday"]);
    expect(parts("A brown envelope from HMRC: you overpaid VAT.")).toEqual(["hmrc", "vat"]);
    expect(parts("Comped a party of 4. The sommelier sighs; the call-out fee stings; your share of the tronc.")).toEqual(["comp", "sommelier", "callOutFee", "tronc"]);
    expect(parts("A satellite closes. Franchisees form an association. You buy from the wholesaler.")).toEqual(["satellite", "franchisee", "wholesaler"]);
    expect(parts("86 guests, a company car, a vat of stock, competition, HQs")).toEqual([]);
  });

  it("a term inside a button: a tap shows its tip and does not press the button; the button's name is its label", () => {
    let pressed = 0;
    render(<button onClick={() => pressed++}><Term id="comp" inline inButton>Comp</Term> this table</button>);
    const btn = screen.getByRole("button", { name: "Comp this table" });
    const word = btn.querySelector(".term") as HTMLElement;
    expect(word.hasAttribute("tabindex")).toBe(false);
    fireEvent.click(word);
    expect(pressed).toBe(0);
    expect(word.hasAttribute("data-open")).toBe(true);
    fireEvent.click(btn);
    expect(pressed).toBe(1);
  });
});

describe("U12: one pounds formatter", () => {
  it("sim-core's formatPence is the game's, with one minus sign everywhere", () => {
    expect(formatPence).toBe(simFormatPence);
    expect(formatPounds(-123_456)).toBe("−£1,235");
    expect(poundsText(-123_400)).toBe("−£1,234"); // the evening tips used "-£"
    expect(careerPounds(-50_000)).toBe("−£500");
    expect(simFormatPence(1200, { trim: true })).toBe("£12");
    expect(simFormatPence(1250, { trim: true })).toBe("£12.50");
  });

  it("no package keeps its own player-facing pounds formatter", () => {
    const root = join(__dirname, "..", "..", "..");
    const files = [
      "game/src/screens/paths/EmpireTab.tsx", "game/src/screens/paths/BoardMeeting.tsx", "sim-empire/src/engine.ts", "sim-empire/src/board.ts",
      "sim-stars/src/commands.ts", "sim-career/src/ladder.ts", "sim-core/src/commands.ts", "sim-core/src/advice.ts", "sim-core/src/systems/incidents.ts",
      "handson/src/score.ts", "handson/src/session.ts",
    ];
    for (const f of files) {
      const src = readFileSync(join(root, f), "utf8");
      expect(src, f).not.toMatch(/`[^`]*£\$\{[^`]*(toFixed|toLocaleString|Math\.round)/);
    }
  });
});
