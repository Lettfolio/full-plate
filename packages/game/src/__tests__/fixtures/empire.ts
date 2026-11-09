/**
 * Round 6: an owner game forked into the Empire with three franchisees trading, and the same game stepped to the
 * evening of a month's board meeting. Shared by the board-meeting card tests and the round-6 review seams.
 */
import { applyEmpireCommand, stepEmpireDay, type EmpireCommand, type EmpireState } from "@full-plate/sim-empire";
import { appReducer, initialAppState, type AppState } from "../../state/gameReducer";
import { FORK_DAY, initialMeta } from "../../state/paths";
import { applyCommand, content, runDay, suggestedOrder } from "../../sim";

/** An owner game forked into the Empire at FORK_DAY, with a locked formula and three franchisees trading. */
export function empireGame(): AppState {
  let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed: 31, districtId: "high_street", restaurantName: "Board Test", difficulty: "cosy" } });
  for (const id of ["beef_burger", "chicken_burger", "chunky_chips", "soft_drink"]) {
    const d = content.dishes.find((x) => x.id === id)!;
    s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: id, price: d.suggestedPrice } });
  }
  s = appReducer(s, { type: "command", cmd: { type: "HIRE", candidateIndex: 0 } });
  let g = s.game!;
  for (let d = 0; d < 16 && g.phase !== "gameover"; d++) {
    g = runDay(content, g).state;
    for (const o of suggestedOrder(content, g)) g = applyCommand(content, g, { type: "ORDER_STOCK", ...o }).state;
    if (g.phase === "event") g = applyCommand(content, g, { type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === g.activeEvent?.eventId)!.choices[0]!.id }).state;
    else if (g.phase === "evening") g = applyCommand(content, g, { type: "END_DAY" }).state;
  }
  s = { ...s, game: { ...g, day: FORK_DAY }, meta: { ...initialMeta("owner"), lastPathDay: FORK_DAY - 1 } };
  s = appReducer(s, { type: "fork", choice: "empire", brandName: "Board Burgers" });
  let e = s.meta.empire!;
  const send = (cmd: EmpireCommand) => { e = applyEmpireCommand(content, e, cmd).empire; };
  send({ type: "SET_FORMULA", locked: true });
  for (const [i, d] of ["student_quarter", "seaside", "business_park"].entries()) {
    e = { ...e, applicants: [...e.applicants, { id: `ap${i}`, name: `Owner ${i}`, competence: 60, honesty: 90, cash: 60_000_000, arrivedDay: e.hq.day }] };
    send({ type: "OPEN_SITE", cityId: "harbourton", districtId: d, ownership: "franchise", land: "hqLease", applicantId: `ap${i}` });
  }
  return { ...s, meta: { ...s.meta, empire: e } };
}

/** Steps the empire (as the evenings would) until a meeting is waiting; the game's day follows it. */
export function withMeeting(s: AppState): AppState {
  let e: EmpireState = s.meta.empire!;
  do e = stepEmpireDay(content, e, undefined, { noEvents: true }).empire;
  while (!e.boardMeeting);
  const day = e.boardMeeting.day;
  return { ...s, game: { ...s.game!, day, phase: "evening" }, meta: { ...s.meta, empire: e, lastPathDay: day } };
}

