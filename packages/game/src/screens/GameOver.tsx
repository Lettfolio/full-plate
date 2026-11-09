import type { GameState } from "@full-plate/sim-core";
import { Icon } from "../components/Icon";
import { StatTile } from "../components/Panel";
import { MoneyText } from "../components/MoneyText";
import { Stars } from "../components/Stars";
import { gameOverCause } from "../lib/dayLoop";

interface Props {
  game: GameState;
  reason: string | null;
  onRetrySameSeed: () => void;
  onNewSeed: () => void;
  onTitle: () => void;
}

/**
 * Round 7 (B): the cause in one sentence from her own last fortnight (`gameOverCause`), the bank's rule under it, and
 * plain buttons. There is no "last Monday" save to go back to (a game over deletes the save; nothing keeps a weekly
 * snapshot), so "Play this start again" replays the same restaurant from day 1 and "New game" picks a new start.
 */
export function GameOver({ game, reason, onRetrySameSeed, onNewSeed, onTitle }: Props) {
  const h = game.history;
  const rated = h.filter((d) => d.covers > 0);
  const avg = rated.length ? rated.reduce((a, d) => a + d.averageRating, 0) / rated.length : 0;
  const best = h.reduce<typeof h[number] | null>((b, d) => (!b || d.profit > b.profit ? d : b), null);
  const cause = gameOverCause(game);
  return (
    <div className="gameover">
      <div className="card gameover__card">
        <div className="gameover__icon" aria-hidden="true"><Icon name="key" size={44} /></div>
        <h1>{game.restaurantName} has closed its doors</h1>
        <p className="gameover__cause" data-testid="gameover-cause">{cause}</p>
        <p className="gameover__reason small">{reason ?? "The money ran out. It happens to the best of them."}</p>
        <div className="gameover__stats">
          <StatTile label="Days open" value={game.stats.daysOpen} />
          <StatTile label="Guests fed" value={game.stats.totalCovers.toLocaleString("en-GB")} />
          <StatTile label="Takings" value={<MoneyText pence={game.stats.totalRevenue} whole />} />
          <StatTile label="Avg rating" value={avg ? <>{avg.toFixed(1)} <Stars rating={avg} size={14} /></> : "—"} />
          <StatTile label="Best day" value={best ? <MoneyText pence={best.profit} tone whole /> : "—"} />
          <StatTile label="Final cash" value={<MoneyText pence={game.cash} tone whole />} />
        </div>
        <div className="gameover__buttons">
          <button className="btn btn--ghost" onClick={onTitle}>Title screen</button>
          <button className="btn" onClick={onNewSeed}>New game</button>
          <button className="btn btn--primary btn--xl" onClick={onRetrySameSeed} autoFocus title={`Same street, same customers (seed ${game.seed}, ${game.difficulty})`}>Play this start again</button>
        </div>
      </div>
    </div>
  );
}
