import { useEffect, useRef, useState } from "react";
import type { GameState } from "@full-plate/sim-core";
import type { GuideResult, InspectorVisit } from "@full-plate/sim-stars";
import { fill } from "@full-plate/content";
import { extras } from "../../sim";
import { dateLabel } from "../../lib/calendar";

interface Props {
  game: GameState;
  pending: { result: GuideResult; visits: InspectorVisit[] };
  onClose: () => void;
}

/** Guide day (STARS-NOTES §1.2): the badge keeps last year's stars until the envelope is opened. */
export function GuideEnvelope({ game, pending, onClose }: Props) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { btn.current?.focus(); }, [open]);
  const t = extras.criticText;
  const r = pending.result;
  const chef = game.staff.filter((s) => s.role === "chef").sort((a, b) => b.skill - a.skill)[0]?.name ?? "the chef";
  const vars = { restaurant: game.restaurantName, guide: t.guideNames.michelin, stars: r.after, starWord: r.after === 1 ? t.guideNames.starWord : t.guideNames.starsWord, chef };
  const pick = (xs: string[]) => xs[r.day % xs.length] ?? xs[0] ?? "";
  const g = t.guideDay;
  const line = !r.assessed ? pick(g.notAssessed)
    : r.after > r.before ? (r.before === 0 && r.after === 1 ? pick(g.gainedFirst) : r.after === 3 ? pick(g.gainedThird) : pick(g.gained))
    : r.after < r.before ? (r.after === 0 ? pick(g.lostAll) : pick(g.lost))
    : r.after === 0 ? pick(g.stillNone) : pick(g.kept);
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <div className={`modal envelope ${open ? "envelope--open" : ""}`}>
        <div className="modal__banner envelope__banner">
          <span className="modal__stamp" aria-hidden="true">{open ? "⭐" : "✉️"}</span>
          <div>
            <div className="modal__kicker">Guide day · {dateLabel(r.day)}</div>
            <h2 id="guide-title">{t.guideNames.michelin}</h2>
          </div>
        </div>
        <div className="modal__body">
          {!open ? (
            <>
              <p>{fill(g.envelope, vars)}</p>
              <div className="envelope__seal" aria-hidden="true">✉️</div>
              <button ref={btn} className="btn btn--primary btn--xl" onClick={() => setOpen(true)}>Open the envelope</button>
            </>
          ) : (
            <>
              <div className="envelope__stars" aria-label={`${r.after} stars`}>
                {[0, 1, 2].map((i) => <span key={i} className={i < r.after ? "envelope__star envelope__star--on" : "envelope__star"}>★</span>)}
              </div>
              <p>{fill(line, vars)}</p>
              <p className="xs muted">{r.reason}</p>
              {pending.visits.length > 0 && (
                <div>
                  <h4>The inspectors who came this year</h4>
                  <table className="stocktable">
                    <thead><tr><th>Night</th><th>Who</th><th className="r">Score</th><th>Ingredients · Harmony · Technique · Personality · Consistency</th></tr></thead>
                    <tbody>
                      {pending.visits.map((v) => (
                        <tr key={v.day}>
                          <td>{dateLabel(v.day)}</td>
                          <td>{v.inspector}</td>
                          <td className="r"><b>{v.total.toFixed(0)}</b></td>
                          <td className="xs">{[v.scores.ingredients, v.scores.harmony, v.scores.technique, v.scores.personality, v.scores.consistency].map((x) => x.toFixed(0)).join(" · ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button ref={btn} className="btn btn--primary" onClick={onClose}>Back to work</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
