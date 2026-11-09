import type { Command, GameState } from "@full-plate/sim-core";
import { Bar } from "./Bar";
import { initials, onBreak, onFloorToday, ROLE_LABEL } from "../lib/staff";
import { weekdayIndex } from "../lib/calendar";
import { BREAK_TICKS, MINUTES_PER_TICK } from "../sim";

interface Props { game: GameState; send: (cmd: Command) => void; /** Watching someone else's shift (career): show who is on, no Break buttons. */ readOnly?: boolean }

/** Service: who is on, how tired they are, and a Break button (GIVE_BREAK). */
export function StaffStrip({ game, send, readOnly = false }: Props) {
  const people = onFloorToday(game, weekdayIndex(game.day));
  if (!people.length) return null;
  return (
    <ul className="staffstrip" aria-label="Staff on shift">
      {people.map((s) => {
        const resting = onBreak(game, s);
        const first = s.name.split(" ")[0] ?? s.name;
        return (
          <li key={s.id} className={`staffstrip__p ${resting ? "staffstrip__p--rest" : ""}`}>
            <span className={`avatar avatar--${s.role}`} aria-hidden="true">{initials(s.name)}</span>
            <div className="staffstrip__info">
              <div className="xs"><b>{first}</b> <span className="muted">{ROLE_LABEL[s.role]}</span></div>
              <Bar value={s.fatigue} tone={s.fatigue >= 70 ? "accent" : s.fatigue >= 40 ? "amber" : "basil"} size="sm" title={`${first}'s tiredness: ${Math.round(s.fatigue)} of 100`} />
            </div>
            {readOnly ? (resting ? <span className="xs muted">☕ On break</span> : null) : <button
              className="btn btn--ghost btn--sm"
              disabled={resting}
              onClick={() => send({ type: "GIVE_BREAK", staffId: s.id })}
              title={resting ? `${first} is on a break` : `Send ${first} for a ${BREAK_TICKS * MINUTES_PER_TICK}-minute break: less tired, but you're a pair of hands down meanwhile`}
              aria-label={resting ? `${first} is on a break` : `Give ${first} a break`}
            >
              {resting ? "☕ On break" : "Break"}
            </button>}
          </li>
        );
      })}
    </ul>
  );
}
