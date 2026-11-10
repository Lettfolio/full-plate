import { useState } from "react";
import { Icon } from "./Icon";
import type { Goal } from "@full-plate/sim-core";
import { MoneyText } from "./MoneyText";
import { GOAL_TAB, goalFraction, visibleGoals } from "../lib/goals";

interface Props {
  goals: readonly Goal[] | undefined;
  /** Goal ids completed today (flash + reward). */
  justDone?: readonly string[];
  /** Collapsed: a one-line summary that expands on click (Service). */
  collapsible?: boolean;
  /** Draw the eye: first run, empty menu. */
  spotlight?: boolean;
  /** Round 11b: past the first week (lib/goals goalsQuiet): no spotlight, no flash; "Show me" stays. */
  quiet?: boolean;
  /** "Show me" on a goal: jump to the planning tab its hint is about. */
  onShow?: (goal: Goal) => void;
}

function Reward({ g }: { g: Goal }) {
  if (!g.reward?.cash && !g.reward?.popularity) return null;
  return (
    <span className="goal__reward">
      {g.reward.cash ? <>+<MoneyText pence={g.reward.cash} whole /></> : null}
      {g.reward.cash && g.reward.popularity ? " · " : null}
      {g.reward.popularity ? <>+{g.reward.popularity} popularity</> : null}
    </span>
  );
}

/** Guided objectives. Hidden entirely until sim-core provides goals. */
export function GoalsCard({ goals, justDone = [], collapsible = false, spotlight = false, quiet = false, onShow }: Props) {
  const [open, setOpen] = useState(!collapsible);
  const { open: todo, done } = visibleGoals(goals, justDone);
  if (!todo.length && !done.length) return null;
  const body = (
    <ul className="goals__list">
      {done.map((g) => (
        <li key={g.id} className="goal goal--done">
          <div className="goal__top"><span className="goal__tick" aria-hidden="true">✓</span><b className="spacer">{g.title}</b><Reward g={g} /></div>
          <span className="sr-only">Completed.</span>
        </li>
      ))}
      {todo.map((g) => (
        <li key={g.id} className="goal">
          <div className="goal__top">
            <b className="spacer">{g.title}</b>
            {g.target > 1 && <span className="xs muted num">{Math.min(g.progress, g.target)}/{g.target}</span>}
          </div>
          <span className="goal__bar" role="meter" aria-label={`${g.title} progress`} aria-valuemin={0} aria-valuemax={g.target} aria-valuenow={Math.min(g.progress, g.target)}>
            <span style={{ width: `${goalFraction(g) * 100}%` }} />
          </span>
          <div className="row">
            <span className="xs muted spacer">{g.hint}</span>
            <Reward g={g} />
            {onShow && GOAL_TAB[g.kind] && <button className="btn btn--ghost btn--sm goal__show" onClick={() => onShow(g)}>Show me</button>}
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <section className={`card goals ${spotlight && !quiet ? "goals--spotlight" : ""} ${quiet ? "goals--quiet" : ""} ${collapsible ? "goals--compact" : ""}`} aria-labelledby="goals-title">
      {collapsible ? (
        <button className="goals__toggle" aria-expanded={open} aria-controls="goals-body" onClick={() => setOpen(!open)}>
          <Icon name="target" size={20} className="goals__icon" />
          <h4 id="goals-title" className="spacer">Goals</h4>
          <span className="xs muted">{todo[0] && !open ? todo[0].title : `${todo.length} to go`}</span>
          <span aria-hidden="true">{open ? "▴" : "▾"}</span>
        </button>
      ) : (
        <div className="card__title"><h3 id="goals-title"><Icon name="target" size={24} className="goals__icon" />Goals</h3><span className="xs muted">{todo.length} to go</span></div>
      )}
      {open && <div id="goals-body">{body}</div>}
    </section>
  );
}
