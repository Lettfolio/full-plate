import { formatPounds } from "../../lib/format";
import { useMemo, useState } from "react";
import { Icon } from "../../components/Icon";
import type { GameState } from "@full-plate/sim-core";
import {
  canAskPromotion, mentorSessionAvailable, openingBudget, perHour, PLAYER_ID, promotionChecklist, raiseAvailable, rungDef,
  rungFloorStat, trackStat, trackStatName, type CareerCommand, type CareerState, type ChecklistItem,
} from "@full-plate/sim-career";
import { commisStation } from "@full-plate/handson";
import "./career.css";
import { careerContent, extras } from "../../sim";
import { MoneyText } from "../../components/MoneyText";
import { Bar } from "../../components/Bar";
import { WEEKDAYS, weekdayIndex } from "../../lib/calendar";
import { Avatar } from "../../components/Avatar";
import { playerAvatar } from "@full-plate/sim-core";
import { handoverPreview } from "../../state/pathEngine";
import type { PathMeta } from "../../state/paths";
import { handsOnRoleFor } from "../../state/paths";
import { fill } from "@full-plate/content";
import type { Command } from "@full-plate/sim-core";
import { RungName, Term } from "../../components/Term";
import { TermText } from "../../components/TermText";

interface Props {
  game: GameState;
  meta: PathMeta;
  career: CareerState;
  sendCareer: (cmd: CareerCommand) => void;
  /** START_SERVICE on the employer's state. */
  send: (cmd: Command) => void;
}

const OWNER_BLURB = { balanced: "A fair boss: steady hours, decent tips", premium: "A fussy boss: high standards, faster growth", cheap: "A cheap boss: long rotas, no training" } as const;

/** Planning when you're an employee: the owner plans; you plan your week (CAREER-NOTES "Planning when you're an employee"). */
export function MyShift({ game, meta, career, sendCareer, send }: Props) {
  const today = weekdayIndex(game.day);
  const me = game.staff.find((s) => s.id === PLAYER_ID);
  const working = !!me?.rota[today] && career.trainingSimDay !== game.day;
  const training = career.trainingSimDay === game.day;
  const employed = career.employer.status === "employed";
  const rung = rungDef(career.track, career.rung);
  const list = promotionChecklist(career);
  const budget = openingBudget(careerContent, career);
  const [districtId, setDistrictId] = useState(budget.districtId);
  const [placeName, setPlaceName] = useState("");
  const [opening, setOpening] = useState(false);
  const preview = useMemo(() => (opening ? handoverPreview(game, meta, districtId) : undefined), [opening, game, meta, districtId]);
  const mentor = career.relationships.find((r) => r.staffId === career.mentor);
  const coworkers = career.relationships.filter((r) => r.current).sort((a, b) => b.bond - a.bond);
  const onToday = new Set(game.staff.filter((s) => s.rota[today]).map((s) => s.id));
  const slip = career.payslips.at(-1);
  const savingsTarget = Math.max(1, budget.savingsNeeded);
  const role = handsOnRoleFor(career.role);
  // Round 4: a chef owns a station; show what's on it today (the same pick the shift will make).
  const station = role === "chef" && working ? commisStation(game, careerContent, career.track === "chef" ? career.rung : 0) : undefined;
  const missing = list.items.filter((i) => !i.met).map((i) => i.label.toLowerCase());
  const promoWhy = !employed ? "You need a job first"
    : !list.ready ? (missing.length ? `Tick every box first — still to do: ${missing.join(", ")}` : list.note ?? "Not yet")
    : !canAskPromotion(career) ? "You asked this week — give the boss a few days" : "Ask the boss for the next rung";
  const promoLine = !employed ? undefined
    : !list.ready ? (missing.length ? `tick every box first (still to do: ${missing.join(", ")}).` : list.note ?? "not yet.")
    : !canAskPromotion(career) ? "you asked this week, so give the boss a few days." : undefined;
  const mentorWhy = !employed ? undefined
    : !career.mentor ? "work alongside someone more skilled until you get on well, and they'll mentor you."
    : !mentorSessionAvailable(career) ? "one hour a week, and you've had this week's." : undefined;
  const ownerMorning = meta.ownerMorning.filter((c) => c.type === "HIRE" || c.type === "FIRE" || c.type === "BUY_TABLE" || c.type === "TRAIN");

  return (
    <div className="myshift">
      <section className="card myshift__today" aria-label="Today">
        <div className="row">
          <Avatar spec={playerAvatar(career.look ?? 0, career.role)} size={64} mood={career.mood} />
          <div className="spacer">
            <div className="panel__eyebrow">You · {career.employer.restaurantName}</div>
            <h3>{rung.title} · {perHour(career.wage)}</h3>
            <div className="small muted">Boss: {career.owner.name} — {OWNER_BLURB[career.owner.strategy]}</div>
          </div>
        </div>
        <div className="myshift__status">
          {!employed ? (
            <p className="callout callout--warn"><b>Out of work.</b> {career.employer.status === "fired" ? "You were let go." : "The restaurant closed."} Look at your offers — living costs still come out of your savings.</p>
          ) : training ? (
            <p className="callout"><b>📚 Training course today.</b> The boss is paying for a day of learning instead of a shift.</p>
          ) : working ? (
            <p className="callout callout--good"><b>You're on today.</b> {station ? <>Your station: <b>{station.label}</b> ({station.title.toLowerCase()}). {career.shiftsWorked === 0 ? "Your first shift starts with a quick how-to." : "Red-edged slips are yours; a silver dome means a table is waiting for your course."}</> : role ? `You'll be ${role === "chef" ? "on the pass" : role === "bar" ? "behind the bar" : "on the floor"}.` : "You'll run the floor and the office."}</p>
          ) : (
            <p className="callout"><b>Day off.</b> The team runs the place without you today.</p>
          )}
        </div>
        <div className="bars2">
          <Bar label={`Your ${trackStatName(career.track).toLowerCase()}`} value={Math.floor(trackStat(career.track, career.stats))} tone="basil" showValue size="sm" title="Rounded down, like the promotion checklist" />
          <Bar label="Mood" value={career.mood} tone="auto" showValue size="sm" />
          <Bar label="Stress" value={career.stress} tone="amber" showValue size="sm" />
          <Bar label="Boss's mood" value={career.owner.mood} tone="sky" showValue size="sm" />
        </div>
        {ownerMorning.length > 0 && (
          <ul className="xs muted myshift__owner">
            {ownerMorning.map((c, i) => <li key={i}>{career.owner.name} {c.type === "HIRE" ? "hired someone new" : c.type === "FIRE" ? "let someone go" : c.type === "BUY_TABLE" ? "bought another table" : "booked a training day"}.</li>)}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="week-h">
        <div className="card__title"><h3 id="week-h">This week's shifts</h3><span className="xs faint">max 6 (48 hours)</span></div>
        <div className="rota rota--big" role="group" aria-label="Shifts you'll take">
          {WEEKDAYS.map((d, i) => {
            const contract = i < 4;
            return (
              <button
                key={d}
                className={`rota__day ${i === today ? "rota__day--today" : ""}`}
                aria-pressed={career.shiftPlan[i]}
                disabled={!employed}
                title={contract ? "Contract day: saying no annoys the boss" : "Optional: costs a little mood, pleases the boss"}
                onClick={() => sendCareer({ type: "TAKE_SHIFT", weekday: i, take: !career.shiftPlan[i] })}
              >
                {d}
              </button>
            );
          })}
        </div>
        <p className="xs muted" style={{ marginTop: 6 }}>Mon–Thu are contract shifts. Fri–Sun are optional: they cost a little mood and please the boss.</p>
        <div className="row row--wrap" style={{ marginTop: 10 }}>
          <button className="btn btn--sm" disabled={!employed || !list.ready || !canAskPromotion(career)} title={promoWhy} onClick={() => sendCareer({ type: "REQUEST_PROMOTION" })}>Ask for a promotion</button>
          <button className="btn btn--sm" disabled={!employed || !raiseAvailable(career)} onClick={() => sendCareer({ type: "ASK_FOR_RAISE" })} title={raiseAvailable(career) ? undefined : "You asked recently — wait a few weeks"}>
            Ask for a raise{raiseAvailable(career) ? "" : " (wait)"}
          </button>
          <button className="btn btn--sm" disabled={!employed || !career.mentor || !mentorSessionAvailable(career)} title={mentorWhy} onClick={() => sendCareer({ type: "MENTOR_SESSION" })}>
            Hour with your mentor
          </button>
        </div>
        {/* Round 7: a tablet never shows a title tooltip, so say why the buttons are grey in words. */}
        {employed && (promoLine || mentorWhy) && (
          <p className="myshift__why">
            {promoLine ? <><b>Promotion:</b> {promoLine}</> : null}
            {promoLine && mentorWhy ? " " : null}
            {mentorWhy ? <><b>Mentor:</b> {mentorWhy}</> : null}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="promo-h">
        <div className="card__title"><h3 id="promo-h">{list.nextTitle ? <>Next: <RungName title={list.nextTitle} /></> : "Top of the ladder"}</h3>{list.ready && <span className="pill pill--star">Ready!</span>}</div>
        {list.nextRung !== undefined && (careerTextFor(career.track, list.nextRung) ?? null)}
        {list.items.length > 0 && (
          <div className="promo-progress" aria-label="Progress to promotion">
            <Bar value={list.items.filter((i) => i.met).length} max={list.items.length} tone="basil" size="sm" label={`${list.items.filter((i) => i.met).length} of ${list.items.length} ticked`} />
          </div>
        )}
        <ul className="checklist checklist--progress">
          {list.items.map((i) => (
            <li key={i.key} className={i.met ? "checklist__item checklist__item--met" : "checklist__item"}>
              <span className={`checkmark${i.met ? " checkmark--on" : ""}`} aria-hidden="true">{i.met && <Icon name="check" size={16} />}</span>
              <span className="spacer">
                {i.key === "stat" ? `${i.label} (play your shifts hands-on to learn faster)` : i.label}
                <span className="checklist__meter"><Bar value={progressOf(i, career)} max={1} tone={i.met ? "basil" : "amber"} size="sm" title={`${i.label}: ${valueText(i)} of ${i.target}`} /></span>
              </span>
              {i.key === "reviewAvg" && career.weeklyReview.length === 0
                ? <span className="xs muted">{6 - (career.day % 7) === 0 ? "first review tonight" : `first review in ${6 - (career.day % 7)} day${6 - (career.day % 7) === 1 ? "" : "s"}`}</span>
                : <><b>{valueText(i)}</b><span className="xs muted">/ {i.target}</span></>}
            </li>
          ))}
        </ul>
        {list.note && <p className="xs muted">{list.note}</p>}
        {!list.ready && list.items.length > 0 && <p className="xs muted">The boss promotes you at the Sunday review once every box is ticked — or ask straight away.</p>}
      </section>

      <section className="card" aria-labelledby="team-h">
        <div className="card__title"><h3 id="team-h">Co-workers</h3><span className="xs faint">{mentor ? `Mentor: ${mentor.name}` : "No mentor yet"}</span></div>
        {coworkers.length === 0 ? <div className="empty small">Nobody else works here yet.</div> : (
          <ul className="coworkers">
            {coworkers.slice(0, 8).map((r) => (
              <li key={r.staffId} className="coworker">
                <Avatar person={{ id: r.staffId, name: r.name, role: r.role }} size={36} />
                <span className="spacer">
                  <b>{r.name}</b> <span className="xs muted">{r.role}{onToday.has(r.staffId) ? " · on today" : ""}</span>
                  {r.tag && <span className={`pill pill--${r.tag === "mentor" ? "star" : "dog"}`} style={{ marginLeft: 6 }}>{r.tag[0]!.toUpperCase() + r.tag.slice(1)}</span>}
                </span>
                <span className="xs muted" title="How well you get on">{r.bond >= 0 ? "♥" : "✗"} {Math.round(r.bond)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="offers-h">
        <div className="card__title"><h3 id="offers-h">Offers</h3><span className="small muted">{career.offers.length}</span></div>
        {career.offers.length === 0 ? <div className="empty small">No offers right now. A good reputation brings them in.</div> : (
          <ul className="offers">
            {career.offers.map((o) => (
              <li key={o.id} className="offer">
                <div className="spacer">
                  <b>{o.restaurantName}</b> <span className="xs muted">· {o.ownerName} · {OWNER_BLURB[o.strategy].split(":")[0]}</span>
                  <div className="small"><RungName title={rungDef(o.track, o.rung).title} /> on <b>{perHour(o.wage)}</b>{o.rung > career.rung ? " — a step up!" : ""}</div>
                  <div className="xs muted">“<TermText text={o.pitch} />” · until day {o.expiresDay + 1}</div>
                </div>
                <button className="btn btn--green btn--sm" onClick={() => sendCareer({ type: "ACCEPT_OFFER", offerId: o.id })}>Accept</button>
                <button className="btn btn--ghost btn--sm" onClick={() => sendCareer({ type: "DECLINE_OFFER", offerId: o.id })}>No thanks</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" aria-labelledby="money-h">
        <div className="card__title"><h3 id="money-h">Savings</h3><span className="small muted"><MoneyText pence={career.savings} whole /></span></div>
        <Bar label="Toward your own place" value={Math.max(0, career.savings)} max={savingsTarget} tone="basil" size="sm" title={`You need about ${formatPounds(budget.savingsNeeded)} saved (plus a bank loan)`} />
        <p className="xs muted" style={{ marginTop: 4 }}>
          Need ≈<MoneyText pence={budget.savingsNeeded} whole /> saved (fit-out, deposit and a reserve, minus a <MoneyText pence={budget.loan} whole /> loan). {budget.rungOk ? "" : `Banks want you to be a ${budget.rungNeeded.toLowerCase()} first.`}
        </p>
        {slip && (
          <table className="pnl pnl--slip" aria-label="Last payslip">
            <tbody>
              <tr><td>Wages</td><td><MoneyText pence={slip.wages} /></td></tr>
              <tr><td><Term id="tronc" /></td><td><MoneyText pence={slip.tips} /></td></tr>
              {slip.bonus > 0 && <tr><td>Bonus</td><td><MoneyText pence={slip.bonus} /></td></tr>}
              <tr className="pnl__cost"><td>Tax + NI</td><td><MoneyText pence={-(slip.tax + slip.ni)} /></td></tr>
              <tr className="pnl__cost"><td>Rent, bills, food</td><td><MoneyText pence={-slip.living} /></td></tr>
              <tr className="pnl__total"><td>Saved last week</td><td><MoneyText pence={slip.saved} tone signed /></td></tr>
            </tbody>
          </table>
        )}
        {career.canOpenOwn && !opening && (
          <button className="btn btn--primary" style={{ marginTop: 10 }} onClick={() => setOpening(true)}><Icon name="key" size={20} />Open my own place…</button>
        )}
        {opening && (
          <div className="openown" role="group" aria-label="Open your own place">
            <label className="field">
              <span className="field__label">Name</span>
              <input className="input" value={placeName} maxLength={32} placeholder={`${career.playerName.split(" ")[0]}'s`} onChange={(e) => setPlaceName(e.target.value)} />
            </label>
            <label className="field">
              <span className="field__label">District</span>
              <select className="input" value={districtId} onChange={(e) => setDistrictId(e.target.value)}>
                {careerContent.districts.map((d) => {
                  const b = openingBudget(careerContent, career, d.id);
                  return <option key={d.id} value={d.id} disabled={b.shortfall > 0}>{d.name}{b.shortfall > 0 ? ` (${formatPounds(b.shortfall)} short)` : ""}</option>;
                })}
              </select>
            </label>
            {preview && (
              <ul className="perks">
                {preview.summary.perks.filter((p) => p.via !== "needs_hook").map((p) => <li key={p.id}><b>{p.label}.</b> <span className="small">{p.detail}</span></li>)}
              </ul>
            )}
            <div className="row">
              <button className="btn btn--primary" onClick={() => sendCareer({ type: "OPEN_OWN_PLACE", districtId, ...(placeName.trim() ? { restaurantName: placeName.trim() } : {}), difficulty: career.employer.difficulty })}>Sign the lease →</button>
              <button className="btn btn--ghost" onClick={() => setOpening(false)}>Not yet</button>
            </div>
          </div>
        )}
      </section>

      <div className="openbar myshift__open">
        <div className="openbar__hints small muted">
          {employed ? (working ? "Ready when you are." : "You're not on today — watch the team or skip ahead.") : "No job today: check your offers."}
        </div>
        {employed ? (
          <button className="btn btn--primary btn--xl" disabled={game.phase !== "planning"} onClick={() => send({ type: "START_SERVICE" })}>
            {working ? "Start my shift →" : "Watch today's service →"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

const valueText = (i: ChecklistItem): string => (i.key === "reviewAvg" ? i.current.toFixed(1) : String(Math.floor(i.current)));

/** 0..1 toward a checklist line: the track stat from this rung's starting point; everything else from zero. */
export function progressOf(i: ChecklistItem, career: CareerState): number {
  if (i.met) return 1;
  const from = i.key === "stat" ? Math.min(rungFloorStat(career.track, career.rung), i.target - 1) : 0;
  return Math.max(0, Math.min(1, (i.current - from) / Math.max(1e-9, i.target - from)));
}

function careerTextFor(track: CareerState["track"], rung: number) {
  const id = rungDef(track, rung).id;
  const t = (extras.careerText.promotion as unknown as Record<string, Record<string, { title: string; copy: string }>>)[track]?.[id];
  return t ? <p className="small muted" style={{ marginBottom: 6 }}>{fill(t.copy, {})}</p> : undefined;
}
