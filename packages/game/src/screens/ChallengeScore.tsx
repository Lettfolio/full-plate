/**
 * Round 12 (C): the daily challenge's score screen — the breakdown, the score code (eight characters since Round 14), and a Compare box where
 * someone else's code goes beside yours (no network: the code carries the day and the score). Lazy chunk.
 */
import { useEffect, useRef, useState } from "react";
import type { GameState } from "@full-plate/sim-core";
import { Icon } from "../components/Icon";
import { playSfx } from "../lib/sfx";
import type { PathMeta } from "../state/paths";
import {
  ceilingOf, clearRun, decodeScore, encodeScore, prettyCode, prettyDate, recordBest, scenarioFor, scoreOf, templateOf, todayKey, whyMissed, type Decoded,
} from "../lib/challenge";
import "./challenge.css";

interface Props {
  game: GameState;
  meta: PathMeta;
  onAgain: () => void;
  onTitle: () => void;
  /** Round 14: "Back to <restaurant>" when she came from inside a game (onTitle opens it again). */
  titleLabel?: string;
}

export function ChallengeScore({ game, meta, onAgain, onTitle, titleLabel = "Title screen" }: Props) {
  const c = meta.challenge!;
  const sc = scenarioFor(c.date, templateOf(c));
  const score = scoreOf(game, c);
  const why = whyMissed(game, c);
  const myFp = c.fp ?? 0;
  const code = encodeScore(c.date, score.total, myFp);
  const [newBest, setNewBest] = useState(false);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    // The run is over: its save goes, the score stays (a best per day, and the all-time list).
    clearRun();
    const beat = recordBest({ date: c.date, score: score.total, template: sc.template, met: score.goal.met, fp: myFp });
    setNewBest(beat);
    if (score.goal.met) playSfx("win");
  }, [c.date, score.total, score.goal.met, sc.template, myFp]);

  const [typed, setTyped] = useState("");
  const [other, setOther] = useState<Decoded | null>(null);
  const [copied, setCopied] = useState(false);
  const compare = () => setOther(decodeScore(typed, todayKey(), { date: c.date, max: ceilingOf(c) }));
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); }
  };

  return (
    <div className="challenge-score">
      <div className="card challenge-score__card">
        <div className="challenge__kicker">Today's challenge · {prettyDate(c.date)}</div>
        <h1 className="challenge__title challenge__title--center"><Icon name="target" size={30} />{sc.title}</h1>
        <p className={`challenge-score__goal ${score.goal.met ? "is-met" : ""}`} data-testid="challenge-goal">
          {score.bust ? `${game.restaurantName} closed its doors. ` : ""}
          {score.goal.met ? "Goal done: " : "Goal missed: "}{score.goal.label.charAt(0).toLowerCase() + score.goal.label.slice(1)} ({score.goal.now.replace(/ so far$/, "")})
          {sc.template === "inspector" && <span className="challenge-score__aside"> The inspector came on night {sc.inspectorNight + 1}.</span>}
        </p>
        {why && <p className="challenge-score__why" data-testid="challenge-why"><b>What went wrong:</b> {why}</p>}
        <table className="challenge-score__table">
          <caption className="sr-only">Score breakdown</caption>
          <tbody>
            {score.lines.map((l) => (
              <tr key={l.label}>
                <th scope="row">{l.label}</th>
                <td className="challenge-score__note">{l.note}</td>
                <td className={`challenge-score__pts ${l.points < 0 ? "is-neg" : ""}`}>{l.points < 0 ? "−" : "+"}{Math.abs(l.points).toLocaleString("en-GB")}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th scope="row">Score</th><td /><td className="challenge-score__total" data-testid="challenge-total">{score.total.toLocaleString("en-GB")}</td></tr>
          </tfoot>
        </table>
        {newBest && <p className="callout callout--good challenge-score__best">Your best today.</p>}
        <div className="challenge-score__codebox">
          <span className="small muted">Your score code</span>
          <span className="challenge__code" data-testid="challenge-code" aria-label={`Score code ${code.split("").join(" ")}`}>{prettyCode(code)}</span>
          <button className="btn btn--ghost btn--tap" onClick={() => void copy()}><Icon name="clipboard" size={20} />{copied ? "Copied" : "Copy"}</button>
        </div>
        <form className="challenge-score__compare" onSubmit={(e) => { e.preventDefault(); compare(); }}>
          <label className="field">
            <span className="field__label">Compare with someone else's code</span>
            <span className="row">
              <input className="input challenge-score__input" value={typed} maxLength={11} autoCapitalize="characters" autoComplete="off" spellCheck={false}
                placeholder="e.g. 4FG8 8NCQ" onChange={(e) => { setTyped(e.target.value); setOther(null); }} />
              <button className="btn btn--tap" type="submit" disabled={!typed.trim()}>Compare</button>
            </span>
          </label>
          {other && !other.ok && <p className="callout callout--warn" role="alert">{other.why}</p>}
          {other && other.ok && <Versus mine={score.total} myDate={c.date} myTitle={sc.title} theirs={other.score} theirDate={other.date} sameVersion={other.fp === myFp} />}
        </form>
        <div className="challenge-score__buttons">
          <button className="btn btn--ghost btn--tap" onClick={onTitle}>{titleLabel}</button>
          <button className="btn btn--primary btn--xl" onClick={onAgain} autoFocus>Try again</button>
        </div>
      </div>
    </div>
  );
}

/**
 * Round 14 (S14-6): a code carries no secret, so the line reports what their code says rather than declaring a winner,
 * and two codes from different builds of the same day's restaurant (fingerprints differ) aren't compared at all.
 */
function Versus({ mine, myDate, myTitle, theirs, theirDate, sameVersion }: { mine: number; myDate: string; myTitle: string; theirs: number; theirDate: string; sameVersion: boolean }) {
  const same = myDate === theirDate;
  const comparable = same && sameVersion;
  const d = theirs - mine;
  const n = (x: number) => x.toLocaleString("en-GB");
  const verdict = !same ? `Their code is from ${prettyDate(theirDate)}: a different restaurant, so only a rough comparison.`
    : !sameVersion ? "You two were given different versions of today's challenge (different game versions or browsers), so the scores can't be compared."
    : d > 0 ? `Their code says ${n(theirs)}: ${n(d)} more than yours.` : d < 0 ? `Their code says ${n(theirs)}: ${n(-d)} less than yours.` : `Their code says ${n(theirs)}: the same as yours.`;
  return (
    <div className={`versus ${comparable ? "" : "versus--apart"}`} role="status" data-testid="challenge-versus">
      <div className={`versus__side ${comparable && d < 0 ? "is-higher" : ""}`}>
        <span className="versus__who">You</span>
        <b className="versus__score">{n(mine)}</b>
        <span className="xs muted">{myTitle} · {prettyDate(myDate)}</span>
      </div>
      <div className="versus__vs" aria-hidden="true">vs</div>
      <div className={`versus__side ${comparable && d > 0 ? "is-higher" : ""}`}>
        <span className="versus__who">Their code</span>
        <b className="versus__score">{n(theirs)}</b>
        <span className="xs muted">{same ? myTitle : scenarioFor(theirDate).title} · {prettyDate(theirDate)}</span>
      </div>
      <p className="versus__verdict">{verdict}</p>
    </div>
  );
}
