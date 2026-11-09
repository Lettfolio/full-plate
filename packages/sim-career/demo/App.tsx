/**
 * Career ledger: pick a start, fast-forward week by week, and read the climb — reviews, the promotion checklist,
 * savings toward your own place, co-workers — then open your own restaurant and see the handover.
 * Everything runs the real sim-core + sim-career packages in the browser.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { content } from "@full-plate/content";
import {
  advanceCareerDay,
  applyCareerCommand,
  DEFAULT_POLICY,
  handoverToOwner,
  LADDER,
  newCareer,
  openingBudget,
  perHour,
  pounds,
  promotionChecklist,
  rungDef,
  trackStat,
  trackStatName,
  type AutoPolicy,
  type CareerEvent,
  type CareerGame,
  type CareerTrack,
  type HandoverSummary,
  type OwnerStrategy,
  type WeeklyReview,
} from "../src/index";

const TRACKS: { id: CareerTrack; name: string; blurb: string; icon: string }[] = [
  { id: "chef", name: "Apprentice chef", blurb: "Commis on minimum wage. Learn the stations; climb to head chef.", icon: "🔪" },
  { id: "bar", name: "Bar person", blurb: "Bar back to general manager. Drinks know-how for life.", icon: "🍸" },
  { id: "waiter", name: "Waiter", blurb: "Read tables, earn the tronc, run the floor.", icon: "🍽️" },
  { id: "manager", name: "Restaurant manager", blurb: "Run someone else's place. Hit targets, earn a share.", icon: "📋" },
];
const OWNERS_UI: { id: OwnerStrategy; name: string; blurb: string }[] = [
  { id: "balanced", name: "Balanced", blurb: "Fair hours, steady tips" },
  { id: "cheap", name: "Cheap", blurb: "Six-day rotas, no training" },
  { id: "premium", name: "Premium", blurb: "High standards, faster growth" },
];

interface WeekRow {
  week: number;
  review?: WeeklyReview;
  rung: number;
  savings: number;
  stat: number;
  events: string[];
}

function eventLine(e: CareerEvent): string | undefined {
  switch (e.type) {
    case "PROMOTED": return `⬆ Promoted to ${e.title} (${perHour(e.wage)})`;
    case "POACHED": return `✗ ${e.rivalName} got the ${e.title.toLowerCase()} job`;
    case "JOB_CHANGED": return `→ New job at ${e.restaurantName} (${e.strategy})`;
    case "OFFER_RECEIVED": return `✉ Offer from ${e.offer.restaurantName}`;
    case "RAISE": return e.granted ? `£ Raise to ${perHour(e.wage)}` : "£ Raise refused";
    case "MENTOR_CHANGED": return e.name ? `★ ${e.name} is mentoring you` : undefined;
    case "RIVAL_CHANGED": return e.name ? `⚔ ${e.name} is your rival` : undefined;
    case "BURNOUT": return "☁ Burnt out: three days off";
    case "EMPLOYER_CLOSED": return "✗ The restaurant closed";
    case "FIRED": return "✗ Fired";
    case "TRAINED": return `✎ Training day +${e.gain.toFixed(1)}`;
    case "CAN_OPEN_OWN": return "🔑 You could open your own place";
    default: return undefined;
  }
}

function Stars({ score }: { score: number }) {
  const full = Math.round(score);
  return (
    <span className="stars" aria-label={`${score} out of 5`}>
      {"★★★★★".slice(0, full)}
      <span className="off">{"★★★★★".slice(full)}</span>
    </span>
  );
}

export function App() {
  const [track, setTrack] = useState<CareerTrack>("chef");
  const [strategy, setStrategy] = useState<OwnerStrategy>("balanced");
  const [seed, setSeed] = useState(7);
  const [weekend, setWeekend] = useState(1);
  const [game, setGame] = useState<CareerGame | null>(() => newCareer(content, { seed: 7, track: "chef", strategy: "balanced", playerName: "Alex Taylor" }));
  const first = useRef(true);
  const [rows, setRows] = useState<WeekRow[]>([]);
  const [running, setRunning] = useState(false);
  const [handover, setHandover] = useState<{ summary: HandoverSummary; staff: string[] } | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const stop = useRef(false);

  const policy: AutoPolicy = useMemo(() => ({ ...DEFAULT_POLICY, weekendShifts: weekend }), [weekend]);

  function start() {
    stop.current = true;
    const g = newCareer(content, { seed, track, strategy, playerName: "Alex Taylor" });
    setGame(g);
    setRows([]);
    setHandover(null);
    setSelected(null);
  }
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    start();
  }, [track, strategy, seed]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Plays `weeks` weeks, yielding to the browser between weeks so the timeline fills in live. */
  function play(weeks: number) {
    if (!game || running) return;
    stop.current = false;
    setRunning(true);
    let g = game;
    let left = weeks;
    const stepWeek = () => {
      if (stop.current || left <= 0 || g.career.handover) {
        setRunning(false);
        return;
      }
      const events: string[] = [];
      let review: WeeklyReview | undefined;
      for (let d = 0; d < 7; d++) {
        const r = advanceCareerDay(content, g, policy);
        g = r.game;
        for (const e of r.events) {
          if (e.type === "REVIEW") review = e.review;
          const line = eventLine(e);
          if (line) events.push(line);
        }
      }
      left--;
      const c = g.career;
      const row: WeekRow = { week: Math.ceil(c.day / 7), rung: c.rung, savings: c.savings, stat: trackStat(c.track, c.stats), events, ...(review ? { review } : {}) };
      setGame(g);
      setRows((rs) => [...rs, row]);
      setTimeout(stepWeek, 0);
    };
    stepWeek();
  }

  function openOwn() {
    if (!game) return;
    const r = applyCareerCommand(content, game, { type: "OPEN_OWN_PLACE", restaurantName: "Alex's Kitchen" });
    if (r.game.career.handover) {
      setGame(r.game);
      setHandover({ summary: r.game.career.handover, staff: r.game.state.staff.map((s) => `${s.name} (${s.role}, ${perHour(s.wage)})`) });
    }
  }

  if (!game) return null;
  const c = game.career;
  const list = promotionChecklist(c);
  const budget = openingBudget(content, c);
  const goal = budget.savingsNeeded || 1;
  const savingsPct = Math.max(0, Math.min(100, (c.savings / goal) * 100));
  const preview = handover ?? (() => {
    const h = handoverToOwner(content, c, game.state);
    return { summary: h.summary, staff: h.state.staff.map((s) => `${s.name} (${s.role}, ${perHour(s.wage)})`) };
  })();
  const rungs = LADDER[c.track];
  const rels = [...c.relationships].filter((r) => r.current || Math.abs(r.bond) >= 15).sort((a, b) => Number(b.current) - Number(a.current) || b.bond - a.bond).slice(0, 8);
  const shown = selected !== null ? rows[selected] : rows.at(-1);
  const maxSavings = Math.max(goal, ...rows.map((r) => r.savings), 1);

  return (
    <div className="app">
      <header className="top">
        <div className="title">
          <h1>Career ledger</h1>
          <p>Start at the bottom of someone else's restaurant. Climb, save, then open your own.</p>
        </div>
        <div className="controls">
          <label>Owner
            <select value={strategy} onChange={(e) => setStrategy(e.target.value as OwnerStrategy)} disabled={running}>
              {OWNERS_UI.map((o) => <option key={o.id} value={o.id}>{o.name} — {o.blurb}</option>)}
            </select>
          </label>
          <label>Weekend shifts
            <select value={weekend} onChange={(e) => setWeekend(Number(e.target.value))} disabled={running}>
              {[0, 1, 2].map((n) => <option key={n} value={n}>{n} a week</option>)}
            </select>
          </label>
          <label>Seed <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 1)} disabled={running} style={{ width: 70 }} /></label>
        </div>
      </header>

      <section className="picker" aria-label="Choose your start">
        {TRACKS.map((t) => (
          <button key={t.id} className={`pick ${t.id === track ? "on" : ""}`} onClick={() => setTrack(t.id)} disabled={running}>
            <span className="icon" aria-hidden>{t.icon}</span>
            <strong>{t.name}</strong>
            <span>{t.blurb}</span>
          </button>
        ))}
      </section>

      <div className="grid">
        <aside className="stack">
          <div className="card who">
            <h2>{rungDef(c.track, c.rung).title}</h2>
            <p className="muted">{c.employer.status === "employed" ? `at ${c.employer.restaurantName} · owner ${c.owner.name} (${c.owner.strategy})` : c.handover ? `owner of ${c.handover.restaurantName}` : `between jobs (${c.employer.status})`}</p>
            <ol className="ladder">
              {rungs.map((r, i) => (
                <li key={r.id} className={i < c.rung ? "done" : i === c.rung ? "here" : ""}>
                  <span>{r.title}</span><span className="muted">{perHour(Math.round(r.wage))}</span>
                </li>
              ))}
            </ol>
            <dl className="facts">
              <dt>Day</dt><dd>{c.day} (week {Math.floor(c.day / 7) + 1})</dd>
              <dt>Wage</dt><dd>{perHour(c.wage)} · 10-hour shifts</dd>
              <dt>{trackStatName(c.track)}</dt><dd>{trackStat(c.track, c.stats).toFixed(1)}</dd>
              <dt>Mood / stress</dt><dd>{Math.round(c.mood)} / {Math.round(c.stress)}</dd>
              <dt>Owner's confidence</dt><dd>{Math.round(c.owner.mood)}</dd>
              <dt>Reputation</dt><dd>{Math.round(c.reputation)}</dd>
              <dt>Shifts worked</dt><dd>{c.shiftsWorked} ({c.lifetime.weekendShifts} weekend)</dd>
            </dl>
          </div>

          <div className="card">
            <h2>Promotion checklist</h2>
            {list.nextTitle ? <h3>Next: {list.nextTitle}</h3> : null}
            {list.note ? <p className="muted">{list.note}</p> : null}
            <ul className="checklist">
              {list.items.map((i) => (
                <li key={i.key} className={i.met ? "met" : ""}>
                  <span className="tick" aria-hidden>{i.met ? "✓" : "○"}</span>
                  <span className="lbl">{i.label}</span>
                  <span className="val">{i.key === "reviewAvg" ? i.current.toFixed(1) : Math.floor(i.current)} / {i.target}</span>
                  <span className="bar"><span style={{ width: `${Math.min(100, (i.current / i.target) * 100)}%` }} /></span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h2>Co-workers</h2>
            <ul className="people">
              {rels.length === 0 ? <li className="muted">Nobody yet.</li> : null}
              {rels.map((r) => (
                <li key={`${r.employer}-${r.staffId}`}>
                  <span>{r.name} <span className="muted">· {r.role}{r.wasHeadChef ? " (head chef)" : ""}{r.current ? "" : ` · ${r.employer}`}</span></span>
                  {r.tag ? <span className={`tag ${r.tag}`}>{r.tag}</span> : null}
                  <span className={`bond ${r.bond >= 0 ? "pos" : "neg"}`}>{r.bond >= 0 ? "+" : ""}{Math.round(r.bond)}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <main className="stack">
          <div className="card">
            <div className="row">
              <h2>Savings toward your own place</h2>
              <div className="controls">
                <button onClick={() => play(1)} disabled={running || !!c.handover}>+1 week</button>
                <button onClick={() => play(4)} disabled={running || !!c.handover}>+4 weeks</button>
                <button onClick={() => play(52 - Math.floor(c.day / 7))} disabled={running || !!c.handover || c.day >= 364}>To one year</button>
                {running ? <button className="secondary" onClick={() => (stop.current = true)}>Pause</button> : <button className="secondary" onClick={start}>Restart</button>}
              </div>
            </div>
            <div className="savings">
              <div className="meter big" role="progressbar" aria-valuenow={Math.round(savingsPct)} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${savingsPct}%` }} />
              </div>
              <div className="meter-row">
                <span><strong>{pounds(c.savings)}</strong> saved</span>
                <span>need {pounds(budget.savingsNeeded)} + {pounds(Math.min(content.balance.loanPrincipal, Math.round(budget.savingsNeeded * 3)))} bank loan ({budget.districtId.replace("_", " ")})</span>
              </div>
              <p className="muted small">
                Lifetime: wages {pounds(c.lifetime.wages)} + tronc {pounds(c.lifetime.tips)}{c.lifetime.bonus ? ` + bonus ${pounds(c.lifetime.bonus)}` : ""} − tax {pounds(c.lifetime.tax)} − NI {pounds(c.lifetime.ni)} − living costs {pounds(c.lifetime.living)}.
                {budget.rungOk ? "" : ` Banks want to see you reach ${budget.rungNeeded.toLowerCase()} first.`}
              </p>
              <button className="open" onClick={openOwn} disabled={!c.canOpenOwn || !!c.handover || running} title={c.canOpenOwn ? "" : "Not yet: see the savings bar"}>
                🔑 Open my own place
              </button>
            </div>
          </div>

          <div className="card">
            <h2>Week by week</h2>
            {rows.length === 0 ? <p className="muted">Press “+1 week” to work your first week.</p> : null}
            <div className="timeline" role="list">
              {rows.map((r, i) => (
                <button
                  key={i}
                  role="listitem"
                  className={`wk ${selected === i ? "sel" : ""} ${r.events.some((e) => e.startsWith("⬆")) ? "promo" : ""} ${r.events.some((e) => e.startsWith("✗")) ? "bad" : ""}`}
                  onClick={() => setSelected(selected === i ? null : i)}
                  title={`Week ${r.week}: ${r.review ? r.review.score.toFixed(1) : "—"}★ · ${pounds(r.savings)}`}
                >
                  <span className="col" style={{ height: `${Math.max(4, (r.savings / maxSavings) * 100)}%` }} />
                  <span className="sc">{r.review ? r.review.score.toFixed(1) : "–"}</span>
                </button>
              ))}
            </div>
            <p className="muted small">Bars: savings. Numbers: the week's review. Green = promotion, red = a setback. Click a week to read it.</p>
          </div>

          {shown ? (
            <div className="card review">
              <div className="row">
                <h2>Week {shown.week} review</h2>
                {shown.review ? <Stars score={shown.review.score} /> : null}
              </div>
              {shown.review ? (
                <>
                  <p className="muted">From {shown.review.reviewer} ({shown.review.reviewerRole}) · {shown.review.shifts} shifts · mood {shown.review.mood} · fatigue {shown.review.fatigue}</p>
                  <ul className="notes">{shown.review.notes.map((n, i) => <li key={i}>“{n}”</li>)}</ul>
                  <div className="breakdown">
                    {(["rating", "reliability", "growth", "business"] as const).map((k) => (
                      <div key={k}><span>{k === "business" ? "turnover" : k}</span><div className="meter"><div style={{ width: `${(shown.review!.breakdown[k] / 5) * 100}%` }} /></div></div>
                    ))}
                  </div>
                </>
              ) : <p className="muted">No review this week.</p>}
              {shown.events.length ? <ul className="events">{shown.events.map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
            </div>
          ) : null}

          <div className={`card handover ${handover ? "live" : ""}`}>
            <h2>{handover ? `You've opened ${handover.summary.restaurantName}!` : "If you opened today…"}</h2>
            <p className="muted">
              {handover ? "The game now hands over to the normal owner start, with these carry-overs:" : "What you'd take with you (preview; the button above makes it real):"}
            </p>
            <dl className="facts">
              <dt>Savings in</dt><dd>{pounds(preview.summary.savingsIn)}</dd>
              <dt>Bank loan</dt><dd>{pounds(preview.summary.loan)}</dd>
              <dt>Cash on day 1</dt><dd>{pounds(preview.summary.cashAtOpening)} after fit-out and deposit</dd>
              <dt>Staff on day 1</dt><dd>{preview.staff.join(", ") || "nobody yet"}</dd>
            </dl>
            <ul className="perks">
              {preview.summary.perks.map((p) => (
                <li key={p.id} className={p.via === "needs_hook" ? "hook" : ""}>
                  <strong>{p.label}</strong> {p.detail}
                </li>
              ))}
            </ul>
          </div>
        </main>
      </div>
    </div>
  );
}
