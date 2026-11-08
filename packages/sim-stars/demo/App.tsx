/**
 * "A year in the life" — a scripted quality restaurant on the real content pack, with the Stars layer mounted the
 * way STARS-NOTES.md describes. The page only reads `starsView()` (what the player may see). Inspector visits stay
 * "?" until guide day; the reveal button shows them. A collapsed debug panel shows inspectorModel for developers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { content } from "@full-plate/content";
import { DAYS_PER_MONTH, monthOf } from "@full-plate/sim-core";
import { inspectorModel, starsView, STARS_CONSTANTS as C } from "../src";
import type { GuideResult, InspectorVisit, StarsEvent } from "../src";
import { ScriptedRun, type DayLog, type Profile } from "../src/script";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const gbp = (p: number) => `£${Math.round(p / 100).toLocaleString("en-GB")}`;

interface FeedItem { day: number; text: string; tone: "good" | "bad" | "info" }

function describe(e: StarsEvent): FeedItem | undefined {
  switch (e.type) {
    case "INSPECTOR_HINT": return { day: e.day, text: `Rumour: ${e.text}`, tone: "info" };
    case "INSPECTION_SEASON": return { day: e.day, text: `Inspection season begins — ${e.daysToGuide} days to the guide.`, tone: "info" };
    case "CRITIC_REVIEW": return { day: e.review.day, text: `${e.review.critic}: ${"★".repeat(e.review.rating)} “${e.review.text}”`, tone: e.review.rating >= 4 ? "good" : e.review.rating <= 2 ? "bad" : "info" };
    case "FIFTY_BEST": return { day: e.day, text: e.hallOfFame && e.rank === undefined ? "World's 50 Best: in the hall of fame." : e.rank ? `World's 50 Best: No. ${e.rank}${e.hallOfFame ? " — straight into the hall of fame!" : ""}` : "World's 50 Best: not on the list this year.", tone: e.rank ? "good" : "info" };
    case "GAULT_MILLAU": return { day: e.day, text: `Gault&Millau: ${e.points}/20 (was ${e.before}).`, tone: e.points > e.before ? "good" : e.points < e.before ? "bad" : "info" };
    case "GOOD_FOOD": return { day: e.day, text: `Good Food Guide: score ${e.tier}/10.`, tone: e.tier > e.before ? "good" : "info" };
    case "STRESS_WARNING": return { day: e.day, text: `The head chef is close to the edge (stress ${Math.round(e.stress)}).`, tone: "bad" };
    case "BURNOUT": return { day: e.day, text: "Burnout. The head chef is off for weeks.", tone: "bad" };
    case "STAGIAIRE_SCANDAL": return { day: e.day, text: "Newspaper exposé on unpaid stagiaires.", tone: "bad" };
    case "RESEARCH_DONE": return { day: e.day, text: `Test kitchen: ${content.dishes.find((d) => d.id === e.dishId)?.name ?? e.dishId} is now a signature.`, tone: "good" };
    case "SMYTH_ARC_STARTED": return { day: e.day, text: "Your head chef dreams of their own restaurant. Back them, or lose them to a rival?", tone: "info" };
    case "HEAD_CHEF_LEFT": return { day: e.day, text: e.backed ? "You backed your head chef's own place. They leave as friends." : `Your head chef left to open ${e.rival}.`, tone: e.backed ? "good" : "bad" };
    case "SATELLITE_OPENED": return { day: e.satellite.openedDay, text: `${e.satellite.name} opens.`, tone: "info" };
    case "SATELLITE_CHEF_TRAINED": return { day: -1, text: "A satellite now has its own trained head chef.", tone: "good" };
    case "REFIT_STARTED": return { day: e.day, text: `Closed until day ${e.until}.`, tone: "bad" };
    case "ENDING": return { day: e.ending.day, text: e.ending.text, tone: e.ending.win ? "good" : "info" };
    case "LOG": return e.tone === "money" ? undefined : { day: e.day, text: e.text, tone: e.tone === "bad" ? "bad" : e.tone === "good" ? "good" : "info" };
    default: return undefined;
  }
}

function StarBadge({ stars, label, sub }: { stars: number; label: string; sub: string }) {
  return (
    <div className="card badge" aria-label={`${stars} Michelin stars`}>
      <div className="stars">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i < stars ? "" : "off"}>★</span>
        ))}
      </div>
      <div className="label">{label}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

function StressMeter({ stress, season }: { stress: number; season: boolean }) {
  const colour = stress >= C.STRESS_WARNING ? "var(--red)" : stress >= 50 ? "var(--amber)" : "var(--green)";
  const mood = stress >= C.BURNOUT_FROM ? "On the edge" : stress >= C.STRESS_WARNING ? "Frayed" : stress >= 50 ? "Under pressure" : stress >= 30 ? "Focused" : "Relaxed";
  return (
    <div className="card">
      <h2>Head chef stress</h2>
      <div className="meter" role="meter" aria-valuenow={Math.round(stress)} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${stress}%`, background: colour }} />
      </div>
      <div className="meter-row">
        <span>{mood}</span>
        <span>{Math.round(stress)}/100{season ? " · inspection season" : ""}</span>
      </div>
    </div>
  );
}

/** Year timeline. Before guide day only "?" markers would be honest — and the page doesn't even know the days. */
function Timeline({ windowStart, guideDay, today, quality, revealed }: { windowStart: number; guideDay: number; today: number; quality: { day: number; q: number }[]; revealed?: InspectorVisit[] }) {
  const W = 760, H = 150, padL = 36, padR = 12, top = 16, bottom = 34;
  const span = Math.max(1, guideDay - windowStart);
  const x = (d: number) => padL + ((d - windowStart) / span) * (W - padL - padR);
  const y = (q: number) => top + (1 - (Math.max(50, Math.min(100, q)) - 50) / 50) * (H - top - bottom);
  const season0 = x(guideDay - C.SEASON_DAYS);
  const pts = quality.filter((p) => p.day >= windowStart && p.day <= guideDay && p.q > 0);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(p.day).toFixed(1)},${y(p.q).toFixed(1)}`).join(" ");
  const months: number[] = [];
  for (let d = Math.ceil(windowStart / DAYS_PER_MONTH) * DAYS_PER_MONTH; d <= guideDay; d += DAYS_PER_MONTH) months.push(d);
  return (
    <div className="timeline">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Assessment year timeline">
        <rect x={season0} y={top - 6} width={x(guideDay) - season0} height={H - top - bottom + 6} fill="var(--season)" rx={6} />
        {[60, 80, 100].map((q) => (
          <g key={q}>
            <line x1={padL} x2={W - padR} y1={y(q)} y2={y(q)} stroke="var(--line)" />
            <text x={padL - 6} y={y(q) + 4} fontSize={11} textAnchor="end" fill="var(--muted)">{q}</text>
          </g>
        ))}
        {months.map((d) => (
          <text key={d} x={x(d)} y={H - 18} fontSize={11} textAnchor="middle" fill="var(--muted)">{MONTHS[monthOf(d) - 1]}</text>
        ))}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={1.6} />
        {today < guideDay && <line x1={x(today)} x2={x(today)} y1={top - 6} y2={H - bottom} stroke="var(--ink)" strokeDasharray="3 3" />}
        <text x={x(guideDay)} y={H - 4} fontSize={11} textAnchor="end" fill="var(--ink)" fontWeight={700}>Guide day</text>
        {revealed?.map((v) => (
          <g key={v.day}>
            <circle cx={x(v.day)} cy={y(v.total)} r={7} fill="var(--gold)" stroke="#fff" strokeWidth={2} />
            <text x={x(v.day)} y={y(v.total) - 11} fontSize={11} textAnchor="middle" fill="var(--ink)" fontWeight={700}>{v.total.toFixed(0)}</text>
          </g>
        ))}
      </svg>
      {!revealed && <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--muted)" }}>Inspectors eat here on nights nobody knows about. Their visits appear only on guide day.</p>}
      <div className="legend">
        <span style={{ ["--c" as string]: "var(--accent)" }}>Your nightly plate quality (you can see this)</span>
        <span style={{ ["--c" as string]: "var(--season)" }}>Inspection season</span>
        <span style={{ ["--c" as string]: "var(--gold)" }}>Inspector visit (after reveal)</span>
      </div>
    </div>
  );
}

function TrackCard({ name, value, note }: { name: string; value: string; note: string }) {
  return (
    <div className="track">
      <div className="name">{name}</div>
      <div className="value">{value}</div>
      <div className="note">{note}</div>
    </div>
  );
}

interface PendingReveal { result: GuideResult; visits: InspectorVisit[]; windowStart: number }

export function App() {
  const [seed, setSeed] = useState(3);
  const [profile, setProfile] = useState<Profile>("stars");
  const runRef = useRef<ScriptedRun>();
  const [, force] = useState(0);
  const [logs, setLogs] = useState<DayLog[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(6);
  const [pending, setPending] = useState<PendingReveal>();
  const [shown, setShown] = useState<PendingReveal>();
  const [modal, setModal] = useState(false);
  const windowStartRef = useRef(0);

  const reset = useCallback(() => {
    runRef.current = new ScriptedRun(content, { years: 3, seed, refitYear: 0, districtId: "high_street", profile });
    windowStartRef.current = runRef.current.state.day;
    setLogs([]);
    setFeed([]);
    setPending(undefined);
    setShown(undefined);
    setModal(false);
    setPlaying(false);
    force((n) => n + 1);
  }, [seed, profile]);
  useEffect(reset, [reset]);
  const run = runRef.current;
  const day = run?.state.day ?? 0;
  const atLimit = day >= 3 * C.YEAR_DAYS;

  const advance = useCallback((n: number) => {
    const r = runRef.current;
    if (!r) return;
    const newLogs: DayLog[] = [];
    const items: FeedItem[] = [];
    for (let i = 0; i < n && !r.done && r.state.day < 3 * C.YEAR_DAYS; i++) {
      const log = r.stepDay();
      if (!log) break;
      newLogs.push(log);
      for (const e of log.events) {
        const it = describe(e);
        if (it) items.push({ ...it, day: it.day < 0 ? log.day : it.day });
        if (e.type === "GUIDE_DAY") {
          // Guide day: pause, and let the player press the reveal button.
          setPending({ result: e.result, visits: e.visits, windowStart: windowStartRef.current });
          windowStartRef.current = e.result.day + 1;
          setPlaying(false);
          i = n;
        }
      }
    }
    setLogs((l) => [...l, ...newLogs].slice(-800));
    setFeed((f) => [...items.reverse(), ...f].slice(0, 120));
    force((x) => x + 1);
  }, []);

  // QA: ?days=N fast-forwards on load (stops at the first guide day, like Play does); &reveal opens it.
  const qa = useRef(false);
  useEffect(() => {
    if (qa.current) return;
    qa.current = true;
    const q = new URLSearchParams(window.location.search);
    const n = Number(q.get("days") ?? 0);
    if (n > 0) advance(n);
    autoReveal.current = q.has("reveal");
  });
  const autoReveal = useRef(false);
  useEffect(() => {
    if (pending && autoReveal.current) {
      autoReveal.current = false;
      setShown(pending);
      setPending(undefined);
      setModal(true);
    }
  }, [pending]);

  useEffect(() => {
    if (!playing || pending) return;
    const t = setInterval(() => advance(speed), 60);
    return () => clearInterval(t);
  }, [playing, pending, speed, advance]);

  const view = useMemo(() => (run ? starsView(run.stars, day) : undefined), [run, day, logs.length]);
  if (!run || !view) return null;

  // While a reveal is pending the badge still shows last year's stars (the envelope isn't open yet).
  const badgeStars = pending ? pending.result.before : view.stars;
  const last = logs.at(-1);
  const windowStart = pending ? pending.windowStart : windowStartRef.current;
  const guideDay = pending ? pending.result.day : view.nextGuideDay;
  const quality = logs.map((l) => ({ day: l.day, q: l.quality }));
  const hidden = run.stars.guides.michelin.inspectorVisits.filter((v) => !v.revealed);
  const debug = inspectorModel(hidden, run.stars.consistencyWindow);

  const openReveal = () => {
    setShown(pending);
    setPending(undefined);
    setModal(true);
  };

  return (
    <div className="app">
      <div className="top">
        <div className="title">
          <h1>A year in the life · The Larder</h1>
          <p>
            Day {day} · {MONTHS[monthOf(day) - 1]}, year {Math.floor(day / C.YEAR_DAYS) + 1} · cash {gbp(run.state.cash)} · prestige {Math.round(run.state.reputation.prestige)}
          </p>
        </div>
        <div className="controls">
          <label>
            Restaurant
            <select value={profile} onChange={(e) => setProfile(e.target.value as Profile)}>
              <option value="stars">Perfectionist (chasing stars)</option>
              <option value="bistro">Good bistro (no ambitions)</option>
            </select>
          </label>
          <label>
            Seed <input type="number" value={seed} min={1} style={{ width: 64 }} onChange={(e) => setSeed(Math.max(1, Number(e.target.value) || 1))} />
          </label>
          <label>
            Speed
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              <option value={1}>1 day</option>
              <option value={6}>6 days</option>
              <option value={20}>20 days</option>
            </select>
          </label>
          <button onClick={() => setPlaying((p) => !p)} disabled={!!pending || run.done || atLimit}>{playing ? "Pause" : "Play"}</button>
          <button className="secondary" onClick={() => advance(30)} disabled={!!pending || run.done || atLimit}>+30 days</button>
          <button className="secondary" onClick={reset}>Restart</button>
        </div>
      </div>

      <div className="grid">
        <div className="stack">
          <div>
            <StarBadge
              stars={badgeStars}
              label={badgeStars ? `${badgeStars} Michelin star${badgeStars > 1 ? "s" : ""}` : "Not in the guide (yet)"}
              sub={pending ? "The guide is out today…" : `Next guide: ${Math.max(0, view.daysToGuide)} days`}
            />
            {pending && (
              <div className="reveal" style={{ textAlign: "center" }}>
                <button onClick={openReveal}>Open the guide ✉</button>
              </div>
            )}
          </div>
          <StressMeter stress={view.headChef.stress} season={view.inspectionSeason} />
          <div className="card">
            <h2>Kitchen</h2>
            <h3>Steadiness (last 60 nights)</h3>
            <div className="meter" style={{ margin: "6px 0 12px" }}>
              <div style={{ width: `${view.steadiness}%`, background: "var(--accent)" }} />
            </div>
            <div style={{ fontSize: 14, lineHeight: 1.7 }}>
              <div>Covers yesterday: <b>{last?.covers ?? 0}</b> · quality <b>{last ? last.quality.toFixed(0) : "–"}</b></div>
              <div>Head chef reputation: <b>{Math.round(view.headChef.reputation)}</b></div>
              <div>Signatures: <b>{view.testKitchen.researched.length || "none"}</b>{view.testKitchen.inProgress ? ` (developing ${view.testKitchen.inProgress.daysLeft}d)` : ""}</div>
              <div>Partners: <b>{view.sourcing.map((s) => `${s.name.split(" ")[0]} ${Math.round(s.relationship)}`).join(", ") || "none"}</b></div>
              <div>Satellites: <b>{view.satellites.map((s) => `${s.name}${s.headChefTrained ? "" : " ⚠"}`).join(", ") || "none"}</b></div>
              <div>Stagiaires: <b>{view.stagiaires.count ? `${view.stagiaires.count} ${view.stagiaires.paid ? "paid" : "unpaid"}` : "none"}</b> · Ticketing: <b>{view.ticketing.unlocked ? (view.ticketing.prepaid ? "prepaid" : "on") : "off"}</b></div>
              {view.rival && <div>Rival: <b>{view.rival.name}</b> {"★".repeat(view.rival.stars)}</div>}
            </div>
          </div>
        </div>

        <div className="stack">
          {run.stars.ending && (
            <div className="card ending">
              <h2>{run.stars.ending.win ? "You won" : "The end"}</h2>
              <p>{run.stars.ending.text}</p>
            </div>
          )}
          <div className="card">
            <h2>This assessment year</h2>
            <Timeline windowStart={windowStart} guideDay={guideDay} today={day} quality={quality} />
            {shown && (
              <>
                <h3 style={{ marginTop: 14 }}>Last year, revealed</h3>
                <Timeline windowStart={shown.windowStart} guideDay={shown.result.day} today={shown.result.day} quality={quality} revealed={shown.visits} />
              </>
            )}
          </div>
          <div className="card">
            <h2>Prestige tracks</h2>
            <div className="tracks">
              <TrackCard name="Michelin" value={badgeStars ? "★".repeat(badgeStars) : "—"} note={`3★ streak ${view.threeStarStreak}/${C.WIN_YEARS}`} />
              <TrackCard name="World's 50 Best" value={view.fiftyBest.hallOfFame ? "Hall of fame" : view.fiftyBest.rank ? `No. ${view.fiftyBest.rank}` : "Unranked"} note="Every June" />
              <TrackCard name="Gault&Millau" value={`${view.gaultMillau}/20`} note="Every November" />
              <TrackCard name="Good Food Guide" value={view.goodFood ? `${view.goodFood}/10` : "Not listed"} note="Every September" />
              <TrackCard name="Local critic" value={view.critic.lastReview ? "★".repeat(view.critic.lastReview.rating) : "—"} note={view.critic.lastReview ? view.critic.lastReview.critic : "Hasn't been yet"} />
            </div>
          </div>
          <div className="card">
            <h2>News</h2>
            <div className="feed">
              {feed.length === 0 && <div style={{ color: "var(--muted)" }}>Press Play to run the year.</div>}
              {feed.map((f, i) => (
                <div key={i} className={f.tone}>
                  <span className="d">d{f.day}</span>
                  {f.text}
                </div>
              ))}
            </div>
          </div>
          {view.guideHistory.length > 0 && (
            <div className="card">
              <h2>Guide history</h2>
              <table className="history">
                <thead>
                  <tr><th>Guide day</th><th>Before</th><th>After</th><th>Visits</th><th>Verdict</th></tr>
                </thead>
                <tbody>
                  {view.guideHistory.filter((g) => !pending || g.day !== pending.result.day).map((g) => (
                    <tr key={g.day}>
                      <td>{g.day}</td><td>{"★".repeat(g.before) || "—"}</td><td>{"★".repeat(g.after) || "—"}</td><td>{g.visits}</td><td>{g.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details className="card debug">
            <summary>Developer debug: inspectorModel (never shown to players)</summary>
            <div className="warn">Hidden state. The game UI must not show this; Cosy mode may show only the fuzzy line below.</div>
            <div style={{ fontSize: 14, lineHeight: 1.7 }}>
              <div>Hidden visits so far: <b>{hidden.length}</b> (scheduled left: {run.stars.guides.michelin.scheduled.length})</div>
              <div>Predicted stars: <b>{debug.predictedStars}</b> · confidence <b>{debug.confidence.toFixed(2)}</b> · score {debug.score.toFixed(1)}</div>
              <div>Cosy hint: <i>{view.cosyHint}</i></div>
            </div>
          </details>
        </div>
      </div>

      {modal && shown && (
        <div className="modal-bg" onClick={() => setModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ textAlign: "center" }}>Guide day</h2>
            <div className="stars">{"★".repeat(shown.result.after) || "—"}</div>
            <p style={{ textAlign: "center" }}>
              {shown.result.after > shown.result.before ? "You've gained a star!" : shown.result.after < shown.result.before ? "You've lost a star." : shown.result.after ? "You keep your stars." : "Not this year."}
            </p>
            <p>{shown.result.reason}</p>
            <h3>The inspectors came on…</h3>
            <ul>
              {shown.visits.map((v) => (
                <li key={v.day}>
                  Day {v.day} ({MONTHS[monthOf(v.day) - 1]}) — {v.inspector}: {v.total.toFixed(0)} (technique {v.scores.technique.toFixed(0)}, consistency {v.scores.consistency.toFixed(0)})
                </li>
              ))}
              {shown.visits.length === 0 && <li>Nobody. You weren't open enough to be assessed.</li>}
            </ul>
            <div style={{ textAlign: "right" }}>
              <button onClick={() => setModal(false)}>Back to the kitchen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
