import type { GameState } from "@full-plate/sim-core";
import { Plate } from "../components/Plate";
import { MoneyText } from "../components/MoneyText";
import { dateLabel } from "../lib/calendar";

interface Props {
  saved: GameState | null;
  onNew: () => void;
  onContinue: () => void;
}

export function TitleScreen({ saved, onNew, onContinue }: Props) {
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
          {saved && (
            <div className="title__save">
              <b>{saved.restaurantName}</b>
              <div className="title__savemeta">Day {saved.day + 1} · <MoneyText pence={saved.cash} whole /></div>
              <div className="xs muted">{dateLabel(saved.day)}</div>
            </div>
          )}
          <button className={saved ? "btn" : "btn btn--primary btn--xl"} onClick={onNew} autoFocus={!saved}>
            New game
          </button>
        </div>
        <p className="title__foot">One restaurant, one district</p>
      </div>
    </div>
  );
}
