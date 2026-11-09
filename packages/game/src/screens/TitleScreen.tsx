import type { GameState } from "@full-plate/sim-core";
import { Plate } from "../components/Plate";
import { MoneyText } from "../components/MoneyText";
import { dateLabel } from "../lib/calendar";
import type { Loaded } from "../state/save";
import { rungDef } from "@full-plate/sim-career";

interface Props {
  /** Owner save (round 1–2 games and owner starts). */
  saved: GameState | null;
  /** Career save (employee starts; continues as the player's own place after a handover). */
  career?: Loaded | null;
  onNew: () => void;
  onContinue: () => void;
  onContinueCareer?: () => void;
}

function SaveCard({ game, sub }: { game: GameState; sub?: string }) {
  return (
    <div className="title__save">
      <b>{game.restaurantName}</b>
      {sub && <div className="xs muted">{sub}</div>}
      <div className="title__savemeta">Day {game.day + 1} · <MoneyText pence={game.cash} whole /></div>
      <div className="xs muted">{dateLabel(game.day)}</div>
    </div>
  );
}

export function TitleScreen({ saved, career, onNew, onContinue, onContinueCareer }: Props) {
  const c = career?.meta.career;
  const careerSub = c ? (c.handover ? "Your own place (from the career)" : `${c.playerName} · ${rungDef(c.track, c.rung).title}`) : undefined;
  const pathSub = (m?: Loaded["meta"]) => (m?.empire ? "Empire path" : m?.stars ? "Stars path" : undefined);
  return (
    <div className="title">
      <div className="title__inner">
        <Plate className="title__plate" />
        <h1 className="title__logo">Full <span>Plate</span></h1>
        <p className="title__tag">Open a scruffy little restaurant. Feed the town. See how far it goes.</p>
        <div className="title__buttons">
          {saved && (
            <button className="btn btn--primary btn--xl" onClick={onContinue} autoFocus>
              Continue
            </button>
          )}
          {saved && <SaveCard game={saved} />}
          {career && onContinueCareer && (
            <button className={saved ? "btn btn--xl" : "btn btn--primary btn--xl"} onClick={onContinueCareer} autoFocus={!saved}>
              Continue career
            </button>
          )}
          {career && <SaveCard game={career.game} sub={careerSub ?? pathSub(career.meta)} />}
          <button className={saved || career ? "btn" : "btn btn--primary btn--xl"} onClick={onNew} autoFocus={!saved && !career}>
            New game
          </button>
        </div>
        <p className="title__foot">Owner, chef, bar, waiter or manager — every road leads to a place of your own</p>
      </div>
    </div>
  );
}
