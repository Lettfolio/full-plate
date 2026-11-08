import type { GameState } from "@full-plate/sim-core";
import { Plate } from "../components/Plate";
import { MoneyText } from "../components/MoneyText";
import { dateLabel } from "../lib/calendar";

interface Props {
  saved: GameState | null;
  onNew: () => void;
  onContinue: () => void;
  stub: boolean;
}

export function TitleScreen({ saved, onNew, onContinue, stub }: Props) {
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
              {saved.restaurantName} · Day {saved.day + 1} · {dateLabel(saved.day)} · <MoneyText pence={saved.cash} whole />
            </div>
          )}
          <button className={saved ? "btn" : "btn btn--primary btn--xl"} onClick={onNew} autoFocus={!saved}>
            New game
          </button>
        </div>
        <p className="title__foot">Milestone 1 · one restaurant, one district{stub ? " · running on the stub sim" : ""}</p>
      </div>
    </div>
  );
}
