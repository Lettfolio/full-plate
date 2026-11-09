import type { GameState } from "@full-plate/sim-core";
import { MoneyText } from "../../components/MoneyText";
import { WEEKDAYS, WEEKDAY_NAMES } from "../../lib/calendar";
import { Avatar } from "../../components/Avatar";
import { daysPhrase, doubledShifts, losingFortnight, rotaWeek } from "../../lib/dayLoop";

/**
 * Round 7 (B): the week at a glance. One row per job, one column per day, a face for everyone on. A day with nobody in
 * a job is red ("you'll do it"); a day with two people in one job is amber and says so — the doubled-up shift that
 * costs a losing restaurant the most (round 5: what loses hard mode). After a losing fortnight the note turns red.
 */
export function RotaWeek({ game, today }: { game: GameState; today: number }) {
  const rows = rotaWeek(game.staff);
  const doubled = doubledShifts(game.staff);
  const losing = losingFortnight(game);
  return (
    <section className="card rotaweek" aria-label="This week's rota">
      <div className="card__title"><h3>Who's on this week</h3></div>
      <div className="rotaweek__grid" role="table" aria-label="Rota by day">
        <div role="row" className="rotaweek__row rotaweek__row--head">
          <span role="columnheader" className="rotaweek__role" />
          {WEEKDAYS.map((d, i) => (
            <span role="columnheader" key={d} className={`rotaweek__day ${i === today ? "is-today" : ""}`} aria-label={i === today ? `${WEEKDAY_NAMES[i]} (today)` : WEEKDAY_NAMES[i]}>
              {i === today ? "Today" : d}
            </span>
          ))}
        </div>
        {rows.map((row) => (
          <div role="row" key={row.role} className="rotaweek__row">
            <span role="rowheader" className="rotaweek__role">{row.label}s</span>
            {row.cells.map((c) => {
              const state = c.empty ? "empty" : c.doubled ? "doubled" : "one";
              const label = c.empty
                ? `${WEEKDAY_NAMES[c.day]}: no ${row.label.toLowerCase()} — you'll do it yourself`
                : `${WEEKDAY_NAMES[c.day]}: ${c.people.map((p) => p.name).join(" and ")}${c.doubled ? ` — ${c.people.length} ${row.label.toLowerCase()}s on one day` : ""}`;
              return (
                <span role="cell" key={c.day} className={`rotaweek__cell rotaweek__cell--${state} ${c.day === today ? "is-today" : ""}`} data-state={state} aria-label={label} title={label}>
                  {c.empty ? <span className="rotaweek__you">You</span> : c.people.map((p) => <Avatar key={p.id} person={p} size={30} mood={p.mood} className="rotaweek__face" />)}
                  {c.doubled && <span className="rotaweek__x" aria-hidden="true">×{c.people.length}</span>}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      {doubled.length > 0 ? (
        <p className={`rotaweek__note ${losing ? "rotaweek__note--bad" : ""}`} data-testid="rota-doubled">
          <span aria-hidden="true">{losing ? "⚠️" : "👥"}</span>
          <span>
            {doubled.map((d, i) => (
              <span key={d.role}>{i > 0 && " "}<b>Two {rowLabel(d.role)}s on {daysPhrase(d.days)}</b> — the extra shifts cost about <MoneyText pence={d.weeklyExtra} whole /> a week.</span>
            ))}{" "}
            {losing ? "You've lost money for two weeks: only keep both on if those days are really busy." : "Worth it on busy days; on quiet ones, give someone the day off."}
          </span>
        </p>
      ) : (
        <p className="rotaweek__note rotaweek__note--ok"><span aria-hidden="true">👍</span><span>Nobody is doubled up: one person per job each day.</span></p>
      )}
    </section>
  );
}

const rowLabel = (role: string) => (role === "porter" ? "kitchen porter" : role);
