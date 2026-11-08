import type { GameState } from "@full-plate/sim-core";
import { MoneyText } from "../components/MoneyText";
import { Stars } from "../components/Stars";

interface Props {
  game: GameState;
  reason: string | null;
  onRetrySameSeed: () => void;
  onNewSeed: () => void;
  onTitle: () => void;
}

export function GameOver({ game, reason, onRetrySameSeed, onNewSeed, onTitle }: Props) {
  const h = game.history;
  const rated = h.filter((d) => d.covers > 0);
  const avg = rated.length ? rated.reduce((a, d) => a + d.averageRating, 0) / rated.length : 0;
  const best = h.reduce<typeof h[number] | null>((b, d) => (!b || d.profit > b.profit ? d : b), null);
  return (
    <div className="gameover">
      <div className="card gameover__card">
        <div className="gameover__icon" aria-hidden="true">🔑</div>
        <h1>{game.restaurantName} has closed its doors</h1>
        <p className="gameover__reason">{reason ?? "The money ran out. It happens to the best of them."}</p>
        <div className="gameover__stats">
          <div className="kpi"><div className="kpi__k">Days open</div><div className="kpi__v">{game.stats.daysOpen}</div></div>
          <div className="kpi"><div className="kpi__k">Guests fed</div><div className="kpi__v">{game.stats.totalCovers.toLocaleString("en-GB")}</div></div>
          <div className="kpi"><div className="kpi__k">Takings</div><div className="kpi__v"><MoneyText pence={game.stats.totalRevenue} whole /></div></div>
          <div className="kpi"><div className="kpi__k">Avg rating</div><div className="kpi__v">{avg ? <>{avg.toFixed(1)} <Stars rating={avg} size={14} /></> : "—"}</div></div>
          <div className="kpi"><div className="kpi__k">Best day</div><div className="kpi__v">{best ? <MoneyText pence={best.profit} tone whole /> : "—"}</div></div>
          <div className="kpi"><div className="kpi__k">Final cash</div><div className="kpi__v"><MoneyText pence={game.cash} tone whole /></div></div>
        </div>
        <p className="small muted">Seed {game.seed} · {game.difficulty}</p>
        <div className="gameover__buttons">
          <button className="btn btn--primary" onClick={onRetrySameSeed} autoFocus>Try again (same seed)</button>
          <button className="btn" onClick={onNewSeed}>New seed</button>
          <button className="btn btn--ghost" onClick={onTitle}>Title screen</button>
        </div>
      </div>
    </div>
  );
}
