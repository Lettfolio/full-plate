import type { DayResult, GameState } from "@full-plate/sim-core";
import { openingBudget, perHour, PLAYER_ID, rungDef, trackStatName, type CareerEvent, type CareerState } from "@full-plate/sim-career";
import { careerContent } from "../../sim";
import { MoneyText } from "../../components/MoneyText";
import { Stars } from "../../components/Stars";
import { Bar } from "../../components/Bar";
import { dateLabel } from "../../lib/calendar";
import type { PathMeta } from "../../state/paths";

interface Props {
  game: GameState;
  meta: PathMeta;
  career: CareerState;
  result: DayResult | null;
  onNext: () => void;
}

/** The employee's evening: your shift, your money, your review on Sundays (CAREER-NOTES "Evening when you're an employee"). */
export function CareerEvening({ game, meta, career, result, onNext }: Props) {
  const evs = meta.careerEvents;
  const review = evs.find((e): e is Extract<CareerEvent, { type: "REVIEW" }> => e.type === "REVIEW")?.review;
  const slip = evs.find((e): e is Extract<CareerEvent, { type: "PAYSLIP" }> => e.type === "PAYSLIP")?.payslip;
  const promoted = evs.find((e): e is Extract<CareerEvent, { type: "PROMOTED" }> => e.type === "PROMOTED");
  const lines = career.log.filter((l) => l.day === career.day - 1).slice(-6);
  const r = result;
  const worked = !!r && career.week.workedSimDays.includes(r.day);
  const shiftPay = worked ? Math.round(career.wage * 10) : 0;
  const budget = openingBudget(careerContent, career);
  const management = rungDef(career.track, career.rung).simRole === "manager";
  const summary = meta.shiftSummary;

  return (
    <div className="page">
      <div className="evening evening--career">
        <div className="evening__head">
          <div>
            <div className="xs faint caps">Evening · {r ? `Day ${r.day + 1} · ${dateLabel(r.day)}` : "No shift"}</div>
            <h1>{promoted ? `Promoted to ${promoted.title.toLowerCase()}!` : worked ? (r && r.averageRating >= 4.3 ? "Great shift!" : "Shift done.") : "A day off."}</h1>
          </div>
          <span className="spacer" />
          <button className="btn btn--primary btn--xl" onClick={onNext} autoFocus>Next day →</button>
        </div>

        <div className="stack">
          {promoted && (
            <div className="card promo" role="status">
              <div className="promo__badge" aria-hidden="true">⬆</div>
              <div>
                <h2>{promoted.title}</h2>
                <p>New wage: <b>{perHour(promoted.wage)}</b>. Well earned.</p>
              </div>
            </div>
          )}
          <div className="card">
            <div className="card__title"><h3>Your shift</h3>{worked ? <span className="pill pill--star">worked</span> : <span className="pill pill--off">off</span>}</div>
            <table className="pnl">
              <tbody>
                <tr><td>Pay ({perHour(career.wage)} × 10h)</td><td><MoneyText pence={shiftPay} /></td></tr>
                <tr><td>Tips this week so far <span className="pnl__pct">tronc, shared by law</span></td><td><MoneyText pence={career.week.tips} /></td></tr>
                <tr><td>Wages this week so far</td><td><MoneyText pence={career.week.wagesGross} /></td></tr>
              </tbody>
            </table>
            {summary && (
              <div className="shiftscore">
                <b>Hands-on: {"★".repeat(summary.stars)}{"☆".repeat(3 - summary.stars)} · {summary.points} points</b>
                <div className="small muted">{summary.lines.map((l) => `${l.label} ${l.value}`).join(" · ")}</div>
                <div className="xs muted">Tip: {summary.tip}</div>
              </div>
            )}
            <div className="bars2" style={{ marginTop: 10 }}>
              <Bar label="Mood" value={career.mood} tone="auto" showValue size="sm" />
              <Bar label="Stress" value={career.stress} tone="amber" showValue size="sm" />
              <Bar label="Tiredness" value={career.fatigue} tone="plum" showValue size="sm" />
              <Bar label={trackStatName(career.track)} value={career.track === "waiter" ? career.stats.charm : career.track === "chef" ? career.stats.skill : (career.stats.skill + career.stats.charm) / 2} tone="basil" showValue size="sm" />
            </div>
          </div>

          <div className="card">
            <div className="card__title"><h3>Savings</h3><span className="small muted"><MoneyText pence={career.savings} whole /></span></div>
            <Bar label="Toward your own place" value={Math.max(0, career.savings)} max={Math.max(1, budget.savingsNeeded)} tone="basil" />
            <p className="xs muted" style={{ marginTop: 4 }}>{career.canOpenOwn ? "🔑 You could open your own place now — see My shift tomorrow morning." : <>About <MoneyText pence={Math.max(0, budget.savingsNeeded - career.savings)} whole /> to go.</>}</p>
          </div>

          {slip && (
            <div className="card">
              <div className="card__title"><h3>Payslip</h3><span className="xs faint">week ending day {slip.day + 1}</span></div>
              <table className="pnl">
                <tbody>
                  <tr><td>Wages</td><td><MoneyText pence={slip.wages} /></td></tr>
                  <tr><td>Tips (tronc)</td><td><MoneyText pence={slip.tips} /></td></tr>
                  {slip.bonus > 0 && <tr><td>Bonus</td><td><MoneyText pence={slip.bonus} /></td></tr>}
                  <tr className="pnl__cost"><td>Income tax</td><td><MoneyText pence={-slip.tax} /></td></tr>
                  <tr className="pnl__cost"><td>National Insurance <span className="pnl__pct">none on tronc</span></td><td><MoneyText pence={-slip.ni} /></td></tr>
                  <tr className="pnl__cost"><td>Rent, bills, food, travel</td><td><MoneyText pence={-slip.living} /></td></tr>
                  <tr className="pnl__total"><td>Saved</td><td><MoneyText pence={slip.saved} tone signed /></td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="stack">
          {review && (
            <div className="card review-card">
              <div className="card__title"><h3>Your weekly review</h3><span className="small muted">from {review.reviewer} ({review.reviewerRole})</span></div>
              <div className="review-card__score"><Stars rating={review.score} size={22} /> <b>{review.score.toFixed(1)}</b></div>
              <ul className="review-card__notes">{review.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
              <div className="bars2">
                <Bar label="Food / service" value={review.breakdown.rating} max={5} tone="accent" size="sm" />
                <Bar label="Turning up" value={review.breakdown.reliability} max={5} tone="sky" size="sm" />
                <Bar label="Learning" value={review.breakdown.growth} max={5} tone="basil" size="sm" />
                <Bar label={management ? "Profit" : "Busy nights"} value={review.breakdown.business} max={5} tone="amber" size="sm" />
              </div>
            </div>
          )}
          {r && (
            <div className="kpis">
              <div className="kpi"><div className="kpi__k">Covers</div><div className="kpi__v">{r.covers}</div></div>
              <div className="kpi"><div className="kpi__k">Walkouts</div><div className="kpi__v">{r.walkouts}</div></div>
              <div className="kpi"><div className="kpi__k">Rating</div><div className="kpi__v">{r.averageRating.toFixed(1)} <Stars rating={r.averageRating} size={15} /></div></div>
              <div className="kpi"><div className="kpi__k">{management ? "Profit" : "How the place did"}</div><div className="kpi__v"><MoneyText pence={r.profit} tone whole /></div></div>
            </div>
          )}
          <div className="card">
            <div className="card__title"><h3>Today</h3></div>
            {lines.length === 0 ? <div className="empty small">A quiet one.</div> : (
              <ul className="careerlog">{lines.map((l, i) => <li key={i} className={`ticker__line ticker__line--${l.kind === "money" ? "money" : l.kind}`}><span>{l.text}</span></li>)}</ul>
            )}
          </div>
          <div className="card">
            <div className="card__title"><h3>The team today</h3></div>
            <ul className="coworkers">
              {game.staff.filter((s) => s.id !== PLAYER_ID).slice(0, 6).map((s) => {
                const rel = career.relationships.find((x) => x.staffId === s.id);
                return <li key={s.id} className="coworker"><b className="spacer">{s.name}</b><span className="xs muted">{s.role}{rel?.tag ? ` · ${rel.tag}` : ""} · bond {Math.round(rel?.bond ?? 0)}</span></li>;
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
