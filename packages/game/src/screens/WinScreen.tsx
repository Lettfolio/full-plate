import type { GameState } from "@full-plate/sim-core";
import { MoneyText } from "../components/MoneyText";
import type { PathMeta, WinMeta } from "../state/paths";
import { dateLabel } from "../lib/calendar";

interface Props {
  game: GameState;
  meta: PathMeta;
  win: WinMeta;
  onKeepPlaying: () => void;
  onTitle: () => void;
}

const meals = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}bn` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n.toLocaleString("en-GB"));

/** Path endings (Empire meals/regions; Stars dynasty / El Bulli / handed back) in the GameOver screen's shape. */
export function WinScreen({ game, meta, win, onKeepPlaying, onTitle }: Props) {
  const e = meta.empire;
  const s = meta.stars;
  const icon = win.kind.startsWith("empire") ? "🌍" : win.kind === "el_bulli" ? "🕯️" : win.kind === "handed_back" ? "🤲" : "⭐";
  return (
    <div className="gameover win">
      <div className="card gameover__card">
        <div className="gameover__icon" aria-hidden="true">{icon}</div>
        <div className="xs faint caps">{win.won ? "You won" : "The end"} · {dateLabel(win.day)}</div>
        <h1>{win.title}</h1>
        {win.text.map((t, i) => <p key={i} className="gameover__reason">{t}</p>)}
        <div className="gameover__stats">
          {e ? (
            <>
              <div className="kpi"><div className="kpi__k">Meals served</div><div className="kpi__v">{meals(e.mealsServedTotal)}</div></div>
              <div className="kpi"><div className="kpi__k">Sites open</div><div className="kpi__v">{e.sites.filter((x) => x.status === "open").length}</div></div>
              <div className="kpi"><div className="kpi__k">Regions won</div><div className="kpi__v">{e.win.regionsWon.length} / {e.regions.length}</div></div>
              <div className="kpi"><div className="kpi__k">HQ cash</div><div className="kpi__v"><MoneyText pence={e.hq.cash} tone whole /></div></div>
            </>
          ) : s ? (
            <>
              <div className="kpi"><div className="kpi__k">Stars</div><div className="kpi__v">{"★".repeat(s.guides.michelin.stars) || "—"}</div></div>
              <div className="kpi"><div className="kpi__k">Best ever</div><div className="kpi__v">{"★".repeat(s.peakStars) || "—"}</div></div>
              <div className="kpi"><div className="kpi__k">Three-star years</div><div className="kpi__v">{s.guides.michelin.threeStarStreak}</div></div>
              <div className="kpi"><div className="kpi__k">Guide days</div><div className="kpi__v">{s.guides.michelin.history.length}</div></div>
            </>
          ) : null}
          <div className="kpi"><div className="kpi__k">Days open</div><div className="kpi__v">{game.stats.daysOpen}</div></div>
          <div className="kpi"><div className="kpi__k">Guests fed here</div><div className="kpi__v">{game.stats.totalCovers.toLocaleString("en-GB")}</div></div>
        </div>
        <div className="gameover__buttons">
          {win.kind !== "el_bulli" && win.kind !== "handed_back" && <button className="btn btn--primary" onClick={onKeepPlaying} autoFocus>Keep playing</button>}
          <button className="btn" onClick={onTitle} autoFocus={win.kind === "el_bulli" || win.kind === "handed_back"}>Title screen</button>
        </div>
      </div>
    </div>
  );
}
