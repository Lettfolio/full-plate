/**
 * Round 12 (C): the daily challenge's score screen — the breakdown, the six-character code, and a Compare box where
 * someone else's code goes beside yours (no network: the code carries the day and the score). Lazy chunk.
 */
import { useEffect, useRef, useState } from "react";
import type { GameState } from "@full-plate/sim-core";
import { Icon } from "../components/Icon";
import { playSfx } from "../lib/sfx";
import type { PathMeta } from "../state/paths";
import {
  clearRun, decodeScore, encodeScore, prettyCode, prettyDate, recordBest, scenarioFor, scoreOf, todayKey, type Decoded,
} from "../lib/challenge";
import "./challenge.css";

interface Props {
  game: GameState;
  meta: PathMeta;
  onAgain: () => void;
  onTitle: () => void;
}

export function ChallengeScore({ game, meta, onAgain, onTitle }: Props) {
  const c = meta.challenge!;
  const sc = scenarioFor(c.date);
  const score = scoreOf(game, c);
  const code = encodeScore(c.date, score.total);
  const [newBest, setNewBest] = useState(false);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    // The run is over: its save goes, the score stays (a best per day, and the all-time list).
    clearRun();
    const beat = recordBest({ date: c.date, score: score.total, template: sc.template, met: score.goal.met });
    setNewBest(beat);
    if (score.goal.met) playSfx("win");
  }, [c.date, score.total, score.goal.met, sc.template]);

  const [typed, setTyped] = useState("");
  const [other, setOther] = useState<Decoded | null>(null);
  const [copied, setCopied] = useState(false);
  const compare = () => setOther(decodeScore(typed, todayKey()));
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
          {score.goal.met ? "Goal done: " : "Goal missed: "}{score.goal.label.toLowerCase()} ({score.goal.now.replace(/ so far$/, "")})
          {sc.template === "inspector" && <span className="challenge-score__aside"> The inspector came on night {sc.inspectorNight + 1}.</span>}
        </p>
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
              <input className="input challenge-score__input" value={typed} maxLength={9} autoCapitalize="characters" autoComplete="off" spellCheck={false}
                placeholder="e.g. FG8 8NC" onChange={(e) => { setTyped(e.target.value); setOther(null); }} />
              <button className="btn btn--tap" type="submit" disabled={!typed.trim()}>Compare</button>
            </span>
          </label>
          {other && !other.ok && <p className="callout callout--warn" role="alert">{other.why}</p>}
          {other && other.ok && <Versus mine={score.total} myDate={c.date} theirs={other.score} theirDate={other.date} />}
        </form>
        <div className="challenge-score__buttons">
          <button className="btn btn--ghost btn--tap" onClick={onTitle}>Title screen</button>
          <button className="btn btn--primary btn--xl" onClick={onAgain} autoFocus>Try again</button>
        </div>
      </div>
    </div>
  );
}

function Versus({ mine, myDate, theirs, theirDate }: { mine: number; myDate: string; theirs: number; theirDate: string }) {
  const same = myDate === theirDate;
  const d = mine - theirs;
  const verdict = !same ? "Different days, different restaurants: a rough comparison only."
    : d > 0 ? `You win by ${d.toLocaleString("en-GB")}.` : d < 0 ? `They win by ${(-d).toLocaleString("en-GB")}.` : "Dead heat.";
  return (
    <div className="versus" role="status" data-testid="challenge-versus">
      <div className={`versus__side ${same && d > 0 ? "is-win" : ""}`}>
        <span className="versus__who">You</span>
        <b className="versus__score">{mine.toLocaleString("en-GB")}</b>
        <span className="xs muted">{scenarioFor(myDate).title} · {prettyDate(myDate)}</span>
      </div>
      <div className="versus__vs" aria-hidden="true">vs</div>
      <div className={`versus__side ${same && d < 0 ? "is-win" : ""}`}>
        <span className="versus__who">Their code</span>
        <b className="versus__score">{theirs.toLocaleString("en-GB")}</b>
        <span className="xs muted">{scenarioFor(theirDate).title} · {prettyDate(theirDate)}</span>
      </div>
      <p className="versus__verdict">{verdict}</p>
    </div>
  );
}
