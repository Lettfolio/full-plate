/**
 * Round 6: the Empire's monthly board meeting card (screens/paths/BoardMeeting.tsx), the calendar pause in the reducer,
 * and the one-line minutes on the Money panel.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { bookNet, type EmpireCommand } from "@full-plate/sim-empire";
import { BoardMeeting } from "../screens/paths/BoardMeeting";
import { EmpireTab } from "../screens/paths/EmpireTab";
import { appReducer } from "../state/gameReducer";
import { empireGame, withMeeting } from "./fixtures/empire";

const visibleText = (el: Element) => {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll(".term__tip").forEach((t) => t.remove());
  return (c.textContent ?? "").replace(/\s+/g, " ");
};

describe("the board meeting card", () => {
  afterEach(cleanup);

  it("shows the month's money by source, a worry and one question with its options", () => {
    const s = withMeeting(empireGame());
    const e = s.meta.empire!;
    const m = e.boardMeeting!;
    const sent: EmpireCommand[] = [];
    const { container } = render(<BoardMeeting empire={e} meeting={m} send={(c) => sent.push(c)} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "How did Board Burgers do this month?" })).toBeTruthy();
    const money = visibleText(screen.getByLabelText("Money this month"));
    expect(money).toMatch(new RegExp(`^HQ (made|lost) £[\\d,]+`));
    expect(money).toContain("Your own shops");
    expect(money).toContain("Running HQ");
    // The real words are there, in the tooltips.
    expect(container.querySelector("[data-term='HQ overheads']")).toBeTruthy();
    expect(container.querySelector("[data-term='board meeting']")).toBeTruthy();
    expect(screen.getByLabelText("Worry").textContent!.length).toBeGreaterThan(10);
    expect(screen.getByRole("heading", { name: new RegExp(m.decision.question.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeTruthy();
    const options = container.querySelectorAll(".boardmeeting__option");
    expect(options.length).toBe(m.decision.options.length);
    expect(options.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText("Board's tip").textContent).toContain(m.decision.options.find((o) => o.id === m.decision.advice)!.label);
    // The first option has focus, so a keyboard player can answer straight away.
    expect(document.activeElement).toBe(options[0]);
    fireEvent.click(options[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Skip this one" }));
    expect(sent).toEqual([{ type: "BOARD_DECIDE", optionId: m.decision.options[0]!.id }, { type: "BOARD_DECIDE", optionId: "skip" }]);
    expect(screen.getByText(/^If you skip:/).textContent).toContain(m.decision.skipText);
    // Short sentences for a child: every option's detail is two sentences at most.
    for (const o of m.decision.options) expect(o.detail.split(/[.!?](\s|$)/).filter((x) => x.trim()).length).toBeLessThanOrEqual(3);
  });

  it("an option HQ can't pay for is disabled with the reason", () => {
    const s = withMeeting(empireGame());
    const e = s.meta.empire!;
    const m = {
      ...e.boardMeeting!,
      decision: { ...e.boardMeeting!.decision, options: [{ id: "x", label: "Buy it", detail: "Costs a lot.", cmd: { type: "BUY_PROPERTY", siteId: "s1" } as EmpireCommand, cost: 1e12 }, { id: "y", label: "No", detail: "Nothing." }], advice: "y" },
    };
    render(<BoardMeeting empire={e} meeting={m} send={() => {}} />);
    const btn = screen.getByRole("button", { name: /Buy it/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // Round 11b: the trade word is back, tipped; the button's name stays its label (the in-button tip is aria-hidden).
    expect(visibleText(btn)).toMatch(/HQ can only spend £[\d,]+ right now/);
    expect(btn.querySelector("[data-term-id='hq']")).toBeTruthy();
  });
});

describe("the calendar waits for the board", () => {
  afterEach(cleanup);

  it("Next day does nothing while the meeting is open; answering it logs one line on the Money panel", () => {
    let s = withMeeting(empireGame());
    const day = s.game!.day;
    const m = s.meta.empire!.boardMeeting!;
    const blocked = appReducer(s, { type: "nextDay" });
    expect(blocked.game!.day).toBe(day);
    expect(blocked.game!.phase).toBe("evening");
    expect(blocked.toast?.text).toMatch(/board is waiting/);
    const option = m.decision.options.find((o) => !o.cmd) ?? m.decision.options[0]!;
    s = appReducer(s, { type: "empire", cmd: { type: "BOARD_DECIDE", optionId: option.id } });
    expect(s.meta.empire!.boardMeeting).toBeUndefined();
    expect(s.meta.empireEvents.at(-1)!.kind).toBe("boardDecision");
    const next = appReducer(s, { type: "nextDay" });
    expect(next.game!.day).toBe(day + 1);

    render(<EmpireTab game={s.game!} meta={s.meta} empire={s.meta.empire!} send={() => {}} onFocusSite={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: /Money/ }));
    const lines = screen.getByLabelText("Board meetings").querySelectorAll("li");
    const last = s.meta.empire!.boardMinutes!.at(-1)!;
    expect(visibleText(lines[0]!)).toContain(option.label);
    expect(visibleText(lines[0]!).trim()).toMatch(new RegExp(`HQ (made|lost) £[\\d,]+$`));
    expect(last.net).toBe(bookNet(m.income));
  });

  it("skipping is allowed and also lets the day move on", () => {
    let s = withMeeting(empireGame());
    s = appReducer(s, { type: "empire", cmd: { type: "BOARD_DECIDE", optionId: "skip" } });
    expect(s.meta.empire!.boardMinutes!.at(-1)!.choice).toBe("skip");
    expect(appReducer(s, { type: "nextDay" }).game!.day).toBe(s.game!.day + 1);
  });
});
