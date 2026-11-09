import { useState } from "react";
import type { GameState } from "@full-plate/sim-core";
import { MoneyText } from "../components/MoneyText";
import { Shopfront } from "../components/Shopfront";
import { GoalExplainer } from "../components/GoalExplainer";
import { ConfirmDialog } from "../components/Dialog";
import { dateLabel } from "../lib/calendar";
import type { Loaded } from "../state/save";
import { rungDef } from "@full-plate/sim-career";
import { Icon } from "../components/Icon";

interface Props {
  /** Owner save (round 1–2 games and owner starts). */
  saved: GameState | null;
  /** Career save (employee starts; continues as the player's own place after a handover). */
  career?: Loaded | null;
  onNew: () => void;
  onContinue: () => void;
  onContinueCareer?: () => void;
}

/** Round 7: the save sits inside its Continue button, so the biggest thing on the screen is "carry on where I was". */
function ContinueButton({ label, game, sub, primary, onClick, autoFocus }: { label: string; game: GameState; sub?: string | undefined; primary: boolean; onClick: () => void; autoFocus?: boolean }) {
  const id = `save-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <button className={`continue ${primary ? "continue--primary" : ""}`} onClick={onClick} autoFocus={autoFocus} aria-label={label} aria-describedby={id}>
      <span className="continue__go">{label} <Icon name="forward" size={24} /></span>
      <span className="continue__save title__save" id={id}>
        <b className="continue__name">{game.restaurantName}</b>
        {sub && <span className="continue__sub">{sub}</span>}
        <span className="title__savemeta">Day {game.day + 1} · <MoneyText pence={game.cash} whole /></span>
        <span className="continue__date">{dateLabel(game.day)}</span>
      </span>
    </button>
  );
}

export function TitleScreen({ saved, career, onNew, onContinue, onContinueCareer }: Props) {
  const [goals, setGoals] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  const c = career?.meta.career;
  const careerSub = c ? (c.handover ? "Your own place (from the career)" : `${c.playerName} · ${rungDef(c.track, c.rung).title}`) : undefined;
  const pathSub = (m?: Loaded["meta"]) => (m?.empire ? "Empire path" : m?.stars ? "Stars path" : undefined);
  const hasSave = !!saved || !!career;
  return (
    <div className="title">
      <div className="title__inner">
        <div className="title__art">
          <Shopfront className="title__shop" />
        </div>
        <div className="title__side">
          <h1 className="title__logo">Full <span>Plate</span></h1>
          <p className="title__tag">Open a scruffy little restaurant. Feed the town. See how far it goes.</p>
          <div className="title__buttons">
            {saved && <ContinueButton label="Continue" game={saved} sub={undefined} primary onClick={onContinue} autoFocus />}
            {career && onContinueCareer && (
              <ContinueButton label="Continue career" game={career.game} sub={careerSub ?? pathSub(career.meta)} primary={!saved} onClick={onContinueCareer} autoFocus={!saved} />
            )}
            <button className={hasSave ? "btn btn--tap" : "btn btn--primary btn--xl"} onClick={() => (hasSave ? setConfirmNew(true) : onNew())} autoFocus={!hasSave}>
              New game
            </button>
            <button className="btn btn--ghost btn--tap title__goal" onClick={() => setGoals(true)}>
              <Icon name="trophy" size={20} />How do I win?
            </button>
          </div>
          <p className="title__foot">Owner, chef, bar, waiter or manager: every road leads to a place of your own.</p>
        </div>
      </div>
      {goals && <GoalExplainer onClose={() => setGoals(false)} />}
      {confirmNew && (
        <ConfirmDialog
          title="Start a new game?"
          body={<p>Your saved game stays safe until the new one begins. Then the new game takes its place.</p>}
          confirmLabel="Yes, start a new game"
          cancelLabel="Go back"
          onCancel={() => setConfirmNew(false)}
          onConfirm={() => { setConfirmNew(false); onNew(); }}
        />
      )}
    </div>
  );
}
