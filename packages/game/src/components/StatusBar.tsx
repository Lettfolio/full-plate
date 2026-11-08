import type { GameState } from "@full-plate/sim-core";
import { content } from "../sim";
import { dateLabel } from "../lib/calendar";
import { Bar } from "./Bar";
import { MoneyText } from "./MoneyText";

interface Props {
  game: GameState;
  onMenu?: () => void;
}

/** Always-visible header: who/when, cash, reputation, loan. */
export function StatusBar({ game, onMenu }: Props) {
  const district = content.districts.find((d) => d.id === game.districtId);
  return (
    <header className="status">
      <div className="status__who">
        <div className="status__name">{game.restaurantName}</div>
        <div className="status__when">
          Day {game.day + 1} · {dateLabel(game.day)} · {district?.name ?? game.districtId}
        </div>
      </div>
      <div className="status__stat">
        <span className="status__k">Cash</span>
        <MoneyText pence={game.cash} whole className={`status__cash ${game.cash < 0 ? "money--neg" : ""}`} />
      </div>
      <div className="status__stat status__stat--bars">
        <Bar label="Popularity" value={game.reputation.popularity} tone="accent" showValue size="sm" title="Popularity — brings more people through the door" />
        <Bar label="Prestige" value={game.reputation.prestige} tone="plum" showValue size="sm" title="Prestige — the quality of your name; bigger spenders and critics" />
      </div>
      <div className="status__stat">
        <span className="status__k">Loan left</span>
        <MoneyText pence={game.loan.remaining} whole />
        <span className="status__sub">{game.loan.daysRemaining} days · <MoneyText pence={game.loan.dailyPayment} />/day</span>
      </div>
      <div className="status__end">
        <span className={`pill pill--${game.difficulty}`}>{game.difficulty}</span>
        {onMenu && <button className="btn btn--ghost btn--sm" onClick={onMenu}>Save &amp; quit</button>}
      </div>
    </header>
  );
}
