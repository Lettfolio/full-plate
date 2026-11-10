/**
 * Round 11 (red-team T3): move any loaded save one calendar day on through the real app reducer, the way a player
 * pressing the obvious button would: answer a board meeting (skip), open (owner) or work (career, skipped to the end),
 * take the event's first choice, then "Next day". Used by corpus.test.ts and scripts/corpus.gen.ts.
 */
import type { Command } from "@full-plate/sim-core";
import { appReducer, initialAppState, type AppState } from "../../../state/gameReducer";
import type { Loaded } from "../../../state/save";
import { content } from "../../../sim";

export function loadedApp(l: Loaded): AppState {
  return appReducer(initialAppState, { type: "load", game: l.game, meta: l.meta });
}

/** One day on. Stops early on game over or a win card (nothing more to play), and after 12 steps (a stuck state). */
export function playDay(start: AppState): AppState {
  let s = start;
  const day0 = s.game!.day;
  const career0 = s.meta.career?.day;
  const moved = () => s.game!.day !== day0 || (career0 !== undefined && s.meta.career?.day !== career0);
  for (let i = 0; i < 12 && !moved() && s.game!.phase !== "gameover"; i++) {
    const g = s.game!;
    if (s.meta.empire?.boardMeeting) { s = appReducer(s, { type: "empire", cmd: { type: "BOARD_DECIDE", optionId: "skip" } }); continue; }
    switch (g.phase) {
      case "planning": {
        const opened = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } });
        if (opened.game!.phase === "service") { s = opened; break; }
        // can't open (nothing on the menu, or the career's employer is shut): move the day on instead
        const next = appReducer(s, { type: "nextDay" });
        if (next === s) return s;
        s = next;
        break;
      }
      case "service": s = appReducer(s, { type: "skipShift" }); break;
      case "event": {
        const ev = content.events.find((e) => e.id === g.activeEvent?.eventId);
        const cmd: Command = { type: "RESOLVE_EVENT", choiceId: ev!.choices[0]!.id };
        s = appReducer(s, { type: "command", cmd });
        break;
      }
      default: s = appReducer(s, { type: "nextDay" });
    }
  }
  return s;
}
