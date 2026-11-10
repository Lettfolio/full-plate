import type { GameState } from "@full-plate/sim-core";
import { empireOutcome, openSites, type EmpireState } from "@full-plate/sim-empire";
import { MoneyText } from "../../components/MoneyText";
import { StatTile } from "../../components/Panel";
import { compactMeals } from "../../components/StatusBar";

interface Props {
  game: GameState;
  empire: EmpireState;
  /** "bankrupt": HQ ran out of credit (the Empire is over). "shopBust": the shop she runs went bust and HQ couldn't save it. */
  kind: "bankrupt" | "shopBust";
  /** Day of the last board meeting she can go back to (bankrupt only). */
  checkpointDay?: number;
  onRetry?: () => void;
  onMoveOn?: () => void;
  onNewGame: () => void;
  onTitle: () => void;
}

/**
 * Round 11 (G1, G8): the two ways an Empire run can stop, in short sentences. Bankrupt: what happened and "Try again
 * from the last board meeting" when this visit remembers one, else a new game. A bust shop with HQ unable to pay:
 * "Close this shop and move on" to another company shop (the Empire carries on).
 */
export function EmpireEnd({ game, empire: e, kind, checkpointDay, onRetry, onMoveOn, onNewGame, onTitle }: Props) {
  const o = empireOutcome(e);
  const others = e.sites.filter((s) => s.status === "open" && s.ownership === "company" && !s.focused).length;
  if (kind === "shopBust") {
    return (
      <div className="gameover" role="dialog" aria-label="Your shop went bust">
        <div className="card gameover__card">
          <div className="gameover__icon" aria-hidden="true">🏚️</div>
          <h1>{game.restaurantName} has run out of money</h1>
          <p className="gameover__cause">The bank closed this shop's account, and head office had no money left to help it.</p>
          <p className="small">Your chain is still going: {openSites(e).length} shops are open, and head office has <MoneyText pence={e.hq.cash} whole tone />.</p>
          <div className="gameover__buttons">
            <button className="btn btn--ghost" onClick={onTitle}>Title screen</button>
            {others > 0
              ? <button className="btn btn--primary btn--xl" autoFocus onClick={onMoveOn}>Close this shop and move on</button>
              : <><p className="small">You have no other shop of your own to run.</p><button className="btn btn--primary btn--xl" autoFocus onClick={onNewGame}>Start a new game</button></>}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="gameover" role="dialog" aria-label="Your chain has gone bust">
      <div className="card gameover__card">
        <div className="gameover__icon" aria-hidden="true">🏦</div>
        <h1>{e.brand.name} has gone bust</h1>
        <p className="gameover__cause" data-testid="empire-bust-cause">
          Head office spent more than it earned for too long. It borrowed until the bank said stop, and then the bank asked for all its money back.
        </p>
        <p className="small">Next time, keep an eye on "Head office can spend": when it goes below zero, sell a shop to a franchisee or close one that loses money.</p>
        <div className="gameover__stats">
          <StatTile label="Shops open" value={openSites(e).length} />
          <StatTile label="Meals served" value={compactMeals(e.mealsServedTotal)} />
          <StatTile label="Head office owed" value={<MoneyText pence={Math.max(0, -o.hqCash)} whole />} />
        </div>
        <div className="gameover__buttons">
          <button className="btn btn--ghost" onClick={onTitle}>Title screen</button>
          {onRetry && checkpointDay !== undefined
            ? <><button className="btn" onClick={onNewGame}>New game</button><button className="btn btn--primary btn--xl" autoFocus onClick={onRetry}>Try again from the last board meeting</button></>
            : <button className="btn btn--primary btn--xl" autoFocus onClick={onNewGame}>Start over</button>}
        </div>
      </div>
    </div>
  );
}
