/**
 * Round 6 review seams: C's evening tip (a one-tap action applied tomorrow morning, or tonight for the over-stock trim)
 * against B's board meeting (a modal that holds the calendar at a month end), on the same Empire evening; and the
 * advice log + board meeting saved together.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { Command, GameState } from "@full-plate/sim-core";
import { appReducer, type AppState } from "../state/gameReducer";
import { decodeSave, encodeSave } from "../state/save";
import { BoardMeeting } from "../screens/paths/BoardMeeting";
import { Evening } from "../screens/Evening";
import { applyCommand, content, eveningAdvice } from "../sim";
import { empireGame, withMeeting } from "./fixtures/empire";

afterEach(cleanup);
const noop = () => {};

/** The board-meeting evening, with a week of beef mince binned and 200 portions of it on tomorrow's order: a tip is due. */
function meetingWithTip(): AppState {
  const s = withMeeting(empireGame());
  const g = s.game!;
  const history = g.history.map((h, i) => (i >= g.history.length - 7 ? { ...h, spoiled: { beef_mince: { qty: 40, cost: 4_000 } } } : h));
  let game: GameState = { ...g, history };
  game = applyCommand(content, game, { type: "ORDER_STOCK", ingredientId: "beef_mince", qty: 200 }).state;
  return { ...s, game };
}

const price = (s: AppState, dishId: string) => s.game!.menu.find((m) => m.dishId === dishId)!.price;
/** Next day from the evening, through the morning post when there is one (its first choice). */
function toMorning(s: AppState): AppState {
  let n = appReducer(s, { type: "nextDay" });
  if (n.game!.phase === "event") {
    const ev = content.events.find((e) => e.id === n.game!.activeEvent?.eventId)!;
    n = appReducer(n, { type: "command", cmd: { type: "RESOLVE_EVENT", choiceId: ev.choices[0]!.id } });
  }
  return n;
}

describe("seam (a): the evening tip's action vs the board meeting holding the calendar", () => {
  const raise = (s: AppState): Command[] => [{ type: "SET_MENU_ITEM", dishId: "beef_burger", price: price(s, "beef_burger") + 100 }];

  it("tip first: Next day is held by the board (it says so), the action waits, and lands the morning after the board is answered", () => {
    let s = meetingWithTip();
    const day = s.game!.day;
    const before = price(s, "beef_burger");
    const meeting = s.meta.empire!.boardMeeting!;
    s = appReducer(s, { type: "actTomorrow", commands: raise(s), done: "Done: prices up." });
    s = appReducer(s, { type: "nextDay" });
    expect(s.game!.day).toBe(day);
    expect(s.toast?.text).toMatch(/board is waiting/);
    expect(s.meta.empire!.boardMeeting).toBe(meeting); // the card still shows
    expect(s.tomorrow?.commands).toHaveLength(1);
    expect(price(s, "beef_burger")).toBe(before);
    s = appReducer(s, { type: "empire", cmd: { type: "BOARD_DECIDE", optionId: "skip" } });
    expect(s.tomorrow).toBeDefined();
    s = toMorning(s);
    expect(s.game!.phase).toBe("planning");
    expect(s.game!.day).toBe(day + 1);
    expect(price(s, "beef_burger")).toBe(before + 100);
    expect(s.tomorrow).toBeUndefined();
    expect(s.toast?.text).toBe("Done: prices up.");
    expect(s.meta.empire!.boardMinutes!.at(-1)!.choice).toBe("skip");
  });

  it("board first: answering it, then the tip, moves the day on and applies the action", () => {
    let s = meetingWithTip();
    const before = price(s, "beef_burger");
    s = appReducer(s, { type: "empire", cmd: { type: "BOARD_DECIDE", optionId: s.meta.empire!.boardMeeting!.decision.advice } });
    expect(s.meta.empire!.boardMeeting).toBeUndefined();
    s = appReducer(s, { type: "actTomorrow", commands: raise(s), done: "Done." });
    s = toMorning(s);
    expect(s.game!.phase).toBe("planning");
    expect(price(s, "beef_burger")).toBe(before + 100);
  });

  it("the over-stock trim applies tonight even while the board is open, and leaves the meeting up", () => {
    let s = meetingWithTip();
    const a = eveningAdvice(s.game!, content)!;
    expect(a.kind).toBe("overstock");
    expect(a.now).toBe(true);
    const cash = s.game!.cash;
    s = appReducer(s, { type: "actNow", commands: a.commands, done: "Done: trimmed." });
    expect(s.game!.phase).toBe("evening");
    expect(s.game!.cash).toBeGreaterThan(cash);
    expect(s.game!.orders.filter((o) => o.ingredientId === "beef_mince").reduce((n, o) => n + o.qty, 0)).toBe(200 - (a.commands[0] as { qty: number }).qty);
    expect(s.toast?.text).toBe("Done: trimmed.");
    expect(s.meta.empire!.boardMeeting).toBeDefined();
  });

  it("a refused action keeps its own toast, not 'Done'", () => {
    let s = meetingWithTip();
    s = appReducer(s, { type: "actNow", commands: [{ type: "CANCEL_ORDER", ingredientId: "cod", qty: 5 }], done: "Done." });
    expect(s.toast?.tone).toBe("bad");
    expect(s.toast?.text).toMatch(/Nothing of .* is on order/);
  });

  it("a game over before the morning drops the queued action", () => {
    let s = meetingWithTip();
    s = appReducer(s, { type: "actTomorrow", commands: raise(s), done: "Done." });
    s = { ...s, game: { ...s.game!, phase: "gameover" } };
    s = appReducer(s, { type: "toast", text: "x" });
    expect(s.tomorrow).toBeUndefined();
  });

  it("the advice log and the board meeting round-trip together byte-identically", () => {
    const s = meetingWithTip();
    // END_DAY records tonight's tip; the meeting is still unanswered (a reload the next morning).
    const game = applyCommand(content, s.game!, { type: "END_DAY" }).state;
    expect(game.adviceLog?.overstock?.subject).toBe("beef_mince");
    expect(s.meta.empire!.boardMeeting).toBeDefined();
    const raw = encodeSave(game, s.meta);
    const back = decodeSave(raw);
    expect(back.game.adviceLog).toEqual(game.adviceLog);
    expect(back.meta.empire!.boardMeeting).toEqual(s.meta.empire!.boardMeeting);
    expect(encodeSave(back.game, back.meta)).toBe(raw);
  });
});

describe("seam (b): tip card and board card on the same evening", () => {
  it("one dialog (the board) over the evening; the tip is inline, first on the page, not a second modal", () => {
    const s = meetingWithTip();
    const e = s.meta.empire!;
    render(
      <>
        <Evening game={s.game!} result={s.game!.history.at(-1)!} onNext={noop} onAct={noop} nextLabel="Next day →" send={noop} meta={s.meta} />
        <BoardMeeting empire={e} meeting={e.boardMeeting!} send={noop} />
      </>,
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const tip = screen.getByLabelText("Tonight's tip");
    expect(tip.closest('[role="dialog"]')).toBeNull();
    expect(document.querySelector(".evening .card")!.getAttribute("aria-label")).toBe("Tonight's tip");
    expect(screen.getByRole("button", { name: /off tomorrow's order/ })).toBeTruthy();
  });
});

describe("seam (d): 'Your own shops £0' when the only company shop is the one she runs", () => {
  it("says why under the money; not when HQ has another company shop", () => {
    const s = withMeeting(empireGame());
    const e = s.meta.empire!;
    const own = e.sites.filter((x) => x.ownership === "company" && x.status !== "closed");
    expect(own.length).toBe(1);
    expect(own[0]!.focused).toBe(true);
    expect(e.boardMeeting!.income.shops).toBe(0);
    render(<BoardMeeting empire={e} meeting={e.boardMeeting!} send={noop} />);
    expect(screen.getByLabelText("About your own shops").textContent).toMatch(/^£0 because your only own shop is the one you run/);
    cleanup();
    const withAnother = { ...e, sites: [...e.sites, { ...own[0]!, id: "other", focused: false }] };
    render(<BoardMeeting empire={withAnother} meeting={{ ...e.boardMeeting!, income: { ...e.boardMeeting!.income, shops: 123_400 } }} send={noop} />);
    expect(screen.queryByLabelText("About your own shops")).toBeNull();
  });
});
