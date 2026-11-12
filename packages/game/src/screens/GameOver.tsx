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
 * plain buttons. Round 11 (U3): the game is no longer deleted — it stays in Your games, greyed, as "Lost — day N".
 * Nothing keeps a weekly snapshot, so there is no "last Monday" to go back to: "Start over with the same restaurant"
 * replays the same street, name and difficulty from day 1 (in the same slot) and "New game" picks a new start.
 */
/**
 * Round 14 (F, U13): the real cause first, when the last fortnight shows one the money sentence can't: she had nobody
 * to help (she covered the kitchen on most nights), or the larder was empty on nights nobody ate. Undefined otherwise
 * (the money sentence — wages, food, rent, the loan — says it).
 */
export function bustLead(game: Pick<GameState, "history" | "staff">): { kinds: ("noStaff" | "noStock")[]; text: string } | undefined {
  const h = game.history.slice(-14).filter((d) => !d.closed);
  if (!h.length) return undefined;
  const empty = h.filter((d) => d.covers === 0 && Object.keys(d.perDish ?? {}).length === 0).length;
  const alone = h.filter((d) => (d.ownerCovered ?? []).includes("chef")).length;
  const out: { kind: "noStaff" | "noStock"; text: string }[] = [];
  if (game.staff.length === 0 && alone >= h.length / 2) out.push({ kind: "noStaff", text: `You had no staff: you cooked and served on your own on ${alone} of your last ${h.length} days, so the food was slow and the queue walked out.` });
  if (empty >= Math.max(2, h.length / 3)) out.push({ kind: "noStock", text: `On ${empty} of those days nobody ate at all: nothing on the menu could be cooked. Stock ordered in the evening arrives the next morning.` });
  return out.length ? { kinds: out.map((x) => x.kind), text: out.map((x) => x.text).join(" ") } : undefined;
}

export function GameOver({ game, reason, onRetrySameSeed, onNewSeed, onTitle }: Props) {
  const h = game.history;
  const rated = h.filter((d) => d.covers > 0);
  const avg = rated.length ? rated.reduce((a, d) => a + d.averageRating, 0) / rated.length : 0;
  const best = h.reduce<typeof h[number] | null>((b, d) => (!b || d.profit > b.profit ? d : b), null);
  const cause = gameOverCause(game);
  const lead = bustLead(game);
  return (
    <div className="gameover">
      <div className="card gameover__card">
        <div className="gameover__icon" aria-hidden="true"><Icon name="key" size={44} /></div>
        <h1>{game.restaurantName} has closed its doors</h1>
        <p className="gameover__cause" data-testid="gameover-cause">{cause}{lead && <> <b data-testid="gameover-lead">{lead.text}</b></>}</p>
        <p className="gameover__reason small">{reason ?? "The money ran out. It happens to the best of them."}</p>
        <p className="gameover__kept small" data-testid="gameover-kept">It's kept in Your games as “Lost — day {game.day + 1}”, so you can always start it over.</p>
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
          <button className="btn btn--primary btn--xl" onClick={onRetrySameSeed} autoFocus title={`Same street, same customers (seed ${game.seed}, ${game.difficulty})`}>Start over with the same restaurant</button>
        </div>
      </div>
    </div>
  );
}
