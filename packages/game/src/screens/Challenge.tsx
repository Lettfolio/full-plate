/**
 * Round 12 (C): "Today's challenge" — the intro screen (today's scenario, carry on / start, your bests) and the bar
 * shown above the game while a challenge runs (goal, day of five, autosave to the challenge's own save). Lazy chunk.
 */
import { useEffect, useRef, useState } from "react";
import type { GameState } from "@full-plate/sim-core";
import { Icon } from "../components/Icon";
import { Term } from "../components/Term";
import { ConfirmDialog } from "../components/Dialog";
import { content } from "../sim";
import { CHALLENGE_DAYS, type PathMeta } from "../state/paths";
import {
  bestFor, buildChallenge, clearRun, encodeScore, goalOf, loadRun, peekRun, prettyCode, prettyDate, saveRun, scenarioFor,
  TEMPLATES, todayKey, topBests, type StoredRun, type TemplateId,
} from "../lib/challenge";
import "./challenge.css";

/** What each template asks, before the restaurant is built (the exact number comes with it). */
export const GOAL_HINT: Record<TemplateId, string> = {
  rescue: "Stop the money leaking: finish the five days in profit.",
  rush: "Serve a fifth more guests than last week.",
  inspector: "Cook so well every night that the inspector's night scores 4.4★ or more. You won't know which night it is.",
  walkout: "Rehire, then serve nearly as many guests as before the walkout.",
  rival: "Win the street back: popularity up by three by the last night.",
  festival: "Big weekend: a quarter more takings than a normal week, with half the team off at the weekend.",
};

interface Props {
  onBack: () => void;
  onPlay: (game: GameState, meta: PathMeta) => void;
}

export function Challenge({ onBack, onPlay }: Props) {
  const today = todayKey();
  const sc = scenarioFor(today);
  const [run, setRun] = useState<StoredRun | null>(() => peekRun());
  const [stale, setStale] = useState(false);
  const [building, setBuilding] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const best = bestFor(today);
  const tops = topBests(10);
  const district = content.districts.find((d) => d.id === sc.districtId)?.name ?? "";

  // A run from another day has ended (yesterday's challenge isn't playable).
  useEffect(() => {
    if (run && run.date !== today) { clearRun(); setRun(null); setStale(true); }
  }, [run, today]);

  const start = async () => {
    setConfirm(false); setProblem(null); setBuilding(0);
    try {
      const b = await buildChallenge(today, (share) => setBuilding(share));
      clearRun();
      await saveRun(b.game, b.meta);
      onPlay(b.game, b.meta);
    } catch {
      setBuilding(null);
      setProblem("Sorry, today's restaurant couldn't be set up. Try again.");
    }
  };
  const carryOn = async () => {
    if (!run) return;
    setProblem(null); setBuilding(1);
    const l = await loadRun(run);
    if (!l) { setBuilding(null); clearRun(); setRun(null); setProblem("That run couldn't be opened, so it's been cleared. Start today's challenge again."); return; }
    onPlay(l.game, l.meta);
  };

  const resumable = run && run.date === today;
  return (
    <div className="page challenge">
      <div className="challenge__head">
        <button className="btn btn--ghost btn--tap" onClick={onBack}><Icon name="back" size={20} />Back</button>
        <h1>Today's challenge</h1>
      </div>
      <div className="challenge__grid">
        <section className="card challenge__brief" aria-labelledby="ch-title">
          <div className="challenge__kicker">{prettyDate(today)} · same for everyone today</div>
          <h2 id="ch-title" className="challenge__title"><Icon name="target" size={28} />{sc.title}</h2>
          <p className="challenge__sub">{sc.kicker}. {sc.restaurantName}, {district}.</p>
          <p className="challenge__goal"><b>Goal:</b> {GOAL_HINT[sc.template]}</p>
          <ul className="challenge__rules small">
            <li>Five days on Normal. Watch, skip or work any service hands-on.</li>
            <li>Score = goal + <Term id="takings" inline>takings</Term> + reviews − losses (food binned, guests who walked out).</li>
            <li>At the end you get a six-character code. Read it out, or type someone else's in to compare.</li>
          </ul>
          {stale && <p className="callout" role="status">Yesterday's run ended at midnight (UTC). This is today's.</p>}
          {problem && <p className="callout callout--warn" role="alert">{problem}</p>}
          {building !== null ? (
            <div className="challenge__building" role="status" aria-live="polite">
              <span>Setting the restaurant up: running its first weeks…</span>
              <span className="challenge__meter" aria-hidden="true"><span style={{ width: `${Math.round(building * 100)}%` }} /></span>
            </div>
          ) : (
            <div className="challenge__actions">
              {resumable ? (
                <>
                  <button className="btn btn--primary btn--xl" onClick={() => void carryOn()} autoFocus>
                    Carry on: day {Math.min(CHALLENGE_DAYS, run.day + 1)} of {CHALLENGE_DAYS}
                  </button>
                  <button className="btn btn--tap" onClick={() => setConfirm(true)}>Start again</button>
                </>
              ) : (
                <button className="btn btn--primary btn--xl" onClick={() => void start()} autoFocus>{best ? "Have another go" : "Start"}</button>
              )}
            </div>
          )}
          {best && (
            <p className="challenge__best">
              Your best today: <b>{best.score.toLocaleString("en-GB")}</b> · code <span className="challenge__code challenge__code--sm">{prettyCode(encodeScore(best.date, best.score))}</span>
            </p>
          )}
        </section>
        <section className="card challenge__tops" aria-labelledby="ch-tops">
          <h2 id="ch-tops" className="challenge__h"><Icon name="trophy" size={22} />Your best days</h2>
          {tops.length ? (
            <ol className="challenge__list">
              {tops.map((b) => (
                <li key={b.date} className={b.date === today ? "is-today" : undefined}>
                  <span className="challenge__ldate">{prettyDate(b.date)}</span>
                  <span className="challenge__lname">{TEMPLATES[b.template]?.title ?? ""}{b.met ? " ✓" : ""}</span>
                  <b className="challenge__lscore">{b.score.toLocaleString("en-GB")}</b>
                </li>
              ))}
            </ol>
          ) : (
            <p className="small muted">Nothing yet. Finish a challenge and its score lands here, with the day it was.</p>
          )}
          <p className="xs muted">A new challenge every day at midnight (UTC). Yesterday's can't be replayed.</p>
        </section>
      </div>
      {confirm && (
        <ConfirmDialog
          title="Start today's challenge again?"
          body={<p>The run you're in the middle of is dropped. Your best score today stays.</p>}
          confirmLabel="Yes, start again"
          onCancel={() => setConfirm(false)}
          onConfirm={() => void start()}
        />
      )}
    </div>
  );
}

/**
 * The bar above the game during a challenge: what it is, the goal and where it stands, the day of five. It also keeps
 * the challenge's own save up to date (every morning, evening and the start of service, like the slots).
 */
export function ChallengeHud({ game, meta }: { game: GameState; meta: PathMeta }) {
  const c = meta.challenge!;
  const sc = scenarioFor(c.date);
  const goal = goalOf(game, c);
  const dayOf = Math.min(CHALLENGE_DAYS, game.day - c.startDay + 1);
  const last = game.day >= c.startDay + CHALLENGE_DAYS - 1 && (game.phase === "evening" || game.phase === "event");
  const key = `${game.day}:${game.phase}`;
  const saved = useRef<string | null>(null);
  useEffect(() => {
    if (saved.current === key || game.phase === "gameover") return;
    saved.current = key;
    void saveRun(game, meta);
  }, [key, game, meta]);
  return (
    <div className="chbar" role="region" aria-label="Today's challenge">
      <span className="chbar__name"><Icon name="target" size={20} />{sc.title}</span>
      <span className="chbar__day">Day {dayOf} of {CHALLENGE_DAYS}</span>
      <span className="chbar__goal">
        <span className="chbar__label">{goal.label}</span>
        <span className="chbar__meter" aria-hidden="true"><span className={goal.met ? "is-met" : undefined} style={{ width: `${Math.round(goal.share * 100)}%` }} /></span>
        <span className="chbar__now">{goal.met ? "✓ " : ""}{goal.now}</span>
      </span>
      {last && <span className="chbar__last">Last night done. <b>Next day</b> shows your score.</span>}
    </div>
  );
}
