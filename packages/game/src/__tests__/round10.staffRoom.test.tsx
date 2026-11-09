/**
 * Round 10 (B): the staff room — person cards (portrait, mood reason, trait tips, like/dislike, relations), the
 * three-candidate hiring sheet, rota portraits, training tracks through the real sim, the evening's level-up line, and
 * the career player's look.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { avatarFor, personalityOf, relationBetween, type Command, type GameState, type Staff } from "@full-plate/sim-core";
import { applyCommand, candidates, content, runDay } from "../sim";
import { suggestedStarterMenu } from "../lib/starterMenu";
import { baseGame } from "./fixtures/round2";
import { SHEET_SIZE, StaffTab, traitEffectLine } from "../screens/planning/StaffTab";
import { RotaWeek } from "../screens/planning/RotaWeek";
import { Evening } from "../screens/Evening";
import { Avatar } from "../components/Avatar";
import { StartPicker } from "../screens/StartPicker";
import { appReducer, initialAppState } from "../state/gameReducer";

afterEach(cleanup);
const noop = () => {};

function ready(cash = 2_000_000): GameState {
  let g = baseGame(77);
  for (const d of suggestedStarterMenu(content, g)) g = applyCommand(content, g, { type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice }).state;
  g = { ...g, cash };
  const pool = candidates(content, g);
  for (const role of ["chef", "server"] as const) {
    const c = pool.find((x) => x.role === role);
    if (c) g = applyCommand(content, g, { type: "HIRE", candidateId: c.id! }).state;
  }
  return { ...g, cash };
}
const send = (g: GameState, ...cmds: Command[]) => cmds.reduce((s, c) => applyCommand(content, s, c).state, g);

describe("portraits", () => {
  it("draw an SVG, decorative unless titled; the same person always looks the same", () => {
    const p = { id: "s1-0", name: "Keira Brown", role: "chef" as const };
    const { container } = render(<><Avatar person={p} size={96} /><Avatar person={p} size={32} title="Keira" /></>);
    const [a, b] = [...container.querySelectorAll("svg.avatarsvg")];
    expect(a!.getAttribute("aria-hidden")).toBe("true");
    expect(b!.getAttribute("role")).toBe("img");
    expect(b!.getAttribute("aria-label")).toBe("Keira");
    expect(a!.getAttribute("width")).toBe("96");
    // distinct clip ids per instance
    const ids = [...container.querySelectorAll("clipPath")].map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("the rota grid shows mini portraits, and two people with the same initials look different (R7 'two KBs')", () => {
    const g = ready();
    const chef = g.staff.find((s) => s.role === "chef")!;
    const twin: Staff = { ...chef, id: "kb2", name: "Kai Bell", rota: chef.rota.slice() };
    const kb: Staff = { ...chef, name: "Keira Brown" };
    const game = { ...g, staff: [kb, twin, ...g.staff.filter((s) => s !== chef)] };
    const { container } = render(<RotaWeek game={game} today={0} />);
    expect(container.querySelectorAll("svg.rotaweek__face").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/\bKB\b/);
    expect(avatarFor(kb)).not.toEqual(avatarFor(twin));
  });
});

describe("person cards", () => {
  it("show portrait, mood with the evening's reason, trait chips with a tip, a like and a dislike", () => {
    let g = ready();
    g = runDay(content, g).state;
    g = applyCommand(content, g, { type: "END_DAY" }).state;
    render(<StaffTab game={g} send={noop} />);
    for (const s of g.staff) {
      const card = screen.getByRole("article", { name: s.name });
      expect(card.querySelector("svg.avatarsvg")).toBeTruthy();
      expect(within(card).getByTestId("mood-reason").textContent).toContain(s.moodWhy!.text);
      const t = personalityOf(s);
      expect(card.textContent).toMatch(/Loves /);
      expect(card.textContent).toMatch(/Hates /);
      expect(t.like).toBeTruthy();
      for (const id of s.traits) {
        const def = content.traits.find((x) => x.id === id)!;
        const chip = within(card).getByText(def.name).closest(".chip")!;
        expect(chip.getAttribute("tabindex")).toBe("0");
        const tip = document.getElementById(chip.getAttribute("aria-describedby")!)!;
        expect(tip.getAttribute("role")).toBe("tooltip");
        expect(tip.textContent).toContain(def.description);
      }
    }
  });

  it("say who gets on and who clashes (only among the team)", () => {
    const g = ready();
    const base = g.staff[0]!;
    // find a friend and a foe for `base` by name
    let friend: Staff | undefined, foe: Staff | undefined;
    for (let i = 0; i < 500 && (!friend || !foe); i++) {
      const o: Staff = { ...base, id: `x${i}`, name: `Robin ${i}` };
      const r = relationBetween(base, o);
      if (r === "friends") friend ??= o;
      if (r === "clash") foe ??= o;
    }
    render(<StaffTab game={{ ...g, staff: [base, friend!, foe!] }} send={noop} />);
    const card = screen.getByRole("article", { name: base.name });
    expect(card.textContent).toContain(`Gets on with ${friend!.name.split(" ")[0]}`);
    expect(card.textContent).toContain(`Clashes with ${foe!.name.split(" ")[0]}`);
  });

  it("trait tip lines read as plain words", () => {
    expect(traitEffectLine({ id: "x", name: "X", description: "", effects: { speed: 1.18, mistakeRate: 1.08 } })).toBe("Works faster, makes more mistakes.");
    expect(traitEffectLine({ id: "x", name: "X", description: "", effects: { moodDecay: 0.8 } })).toBe("Stays cheerful.");
  });
});

describe("hiring sheet", () => {
  it("opens from the staff room with three candidates: portrait, quote, traits, like/dislike, asking wage; Hire sends the id", () => {
    const g = ready();
    const sent: Command[] = [];
    render(<StaffTab game={g} send={(c) => sent.push(c)} />);
    expect(document.querySelector(".hiresheet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Hire someone/ }));
    const sheet = document.querySelector(".hiresheet") as HTMLElement;
    const cards = [...sheet.querySelectorAll(".candidate")] as HTMLElement[];
    const pool = candidates(content, g).filter((c) => !c.hired);
    expect(cards).toHaveLength(Math.min(SHEET_SIZE, pool.length));
    for (const card of cards) {
      expect(card.querySelector("svg.avatarsvg")).toBeTruthy();
      expect(card.querySelector(".candidate__quote")!.textContent!.length).toBeGreaterThan(10);
      expect(card.textContent).toMatch(/Asks £/);
      expect(card.textContent).toMatch(/Loves .*Hates /);
    }
    fireEvent.click(within(cards[0]!).getByRole("button", { name: /Hire/ }));
    expect(sent).toEqual([{ type: "HIRE", candidateId: pool[0]!.id }]);
    // the command works in the sim: the hired person has the candidate's portrait
    const after = applyCommand(content, g, sent[0]!).state;
    const hired = after.staff.at(-1)!;
    expect(hired.id).toBe(pool[0]!.id);
    expect(avatarFor(hired)).toEqual(avatarFor({ id: pool[0]!.id!, name: pool[0]!.name, role: pool[0]!.role }));
    // Close goes back to the team
    fireEvent.click(within(sheet).getByRole("button", { name: /Close/ }));
    expect(document.querySelector(".hiresheet")).toBeNull();
  });

  it("is open straight away with no staff, and candidates are the same all day (seeded)", () => {
    const g = { ...ready(), staff: [] };
    render(<StaffTab game={g} send={noop} />);
    expect(document.querySelector(".hiresheet")).toBeTruthy();
    expect(candidates(content, g)).toEqual(candidates(content, { ...g }));
  });
});

describe("training tracks", () => {
  it("track buttons show level dots and send TRAIN with a track; the sim levels up and the evening says so", () => {
    let g = ready();
    // a second chef so the first can leave the floor
    const chef = g.staff.find((s) => s.role === "chef")!;
    g = { ...g, staff: [...g.staff, { ...chef, id: "c2", name: "Dee Two" }] };
    const sent: Command[] = [];
    render(<StaffTab game={g} send={(c) => sent.push(c)} />);
    const card = screen.getByRole("article", { name: chef.name });
    const knife = within(card).getByRole("button", { name: /^Knife skills: level 0 of 3, next level £120/ });
    expect(knife.querySelectorAll(".dots i.on")).toHaveLength(0);
    fireEvent.click(knife);
    expect(sent).toEqual([{ type: "TRAIN", staffId: chef.id, track: "knife" }]);
    cleanup();

    const trained = send(g, sent[0]!);
    expect(trained.staff.find((s) => s.id === chef.id)!.tracks).toEqual({ knife: 1 });
    render(<StaffTab game={trained} send={noop} />);
    const card2 = screen.getByRole("article", { name: chef.name });
    expect(within(card2).getByText("Training today")).toBeTruthy();
    const k2 = within(card2).getByRole("button", { name: /^Knife skills: level 1 of 3/ }) as HTMLButtonElement;
    expect(k2.disabled).toBe(true);
    expect(k2.querySelectorAll(".dots i.on")).toHaveLength(1);
    cleanup();

    const evening = runDay(content, trained).state;
    render(<Evening game={evening} result={evening.history.at(-1)!} onNext={noop} nextLabel="Next" send={noop} />);
    expect(screen.getByTestId("level-up").textContent).toMatch(/Level up! .* Knife skills level 1 \(speed \+4\)/);
  });

  it("only offers tracks for the role (no 'Cover the pass' for a server)", () => {
    const g = ready();
    const server = g.staff.find((s) => s.role === "server")!;
    render(<StaffTab game={g} send={noop} />);
    const card = screen.getByRole("article", { name: server.name });
    expect(within(card).queryByRole("button", { name: /Cover the pass/ })).toBeNull();
    expect(within(card).getByRole("button", { name: /Front of house/ })).toBeTruthy();
  });
});

describe("evening mood reasons", () => {
  it("show under each name whose mood moved", () => {
    const g = runDay(content, ready()).state;
    render(<Evening game={g} result={g.history.at(-1)!} onNext={noop} nextLabel="Next" send={noop} />);
    const moved = Object.entries(g.history.at(-1)!.staffMoodDelta).filter(([, d]) => Math.abs(d) >= 0.5);
    expect(screen.queryAllByTestId("mood-why")).toHaveLength(moved.length);
  });
});

describe("career look", () => {
  it("the start screen offers six looks and passes the pick to newCareer", () => {
    let opts: { look: number } | undefined;
    render(<StartPicker content={content} onOwner={noop} onCareer={(o) => { opts = o; }} onBack={noop} />);
    fireEvent.click(screen.getByRole("radio", { name: /Apprentice chef/ }));
    const looks = screen.getAllByRole("radio", { name: /^Look \d$/ });
    expect(looks).toHaveLength(6);
    fireEvent.click(looks[3]!);
    expect(looks[3]!.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Start as apprentice chef/ }));
    expect(opts!.look).toBe(3);
    const s = appReducer(initialAppState, { type: "newCareer", seed: 4, track: "chef", strategy: "balanced", playerName: "Robin", difficulty: "cosy", look: 3 });
    expect(s.meta.career!.look).toBe(3);
  });
});
