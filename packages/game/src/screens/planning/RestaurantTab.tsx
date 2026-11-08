import type { Command, GameState } from "@full-plate/sim-core";
import { content } from "../../sim";

interface Props { game: GameState; send: (cmd: Command) => void }

export function RestaurantTab({ game, send }: Props) {
  const max = content.balance.maxTables;
  const seats = game.tables.reduce((a, t) => a + t.seats, 0);
  const canBuy = game.tables.length < max;
  return (
    <div className="floorplan">
      <div className="stack stack--sm">
        <div className="row">
          <h3 className="spacer">Dining room</h3>
          <span className="small muted">{game.tables.length} of {max} tables · {seats} seats</span>
        </div>
        <div className="floorplan__room">
          {game.tables.map((t) => (
            <div key={t.id} className="tablechip" title={`${t.seats} seats`}>
              <span>{t.seats}</span>
            </div>
          ))}
          {Array.from({ length: max - game.tables.length }, (_, i) => (
            <div key={`e${i}`} className="tablechip tablechip--empty" aria-hidden="true">+</div>
          ))}
        </div>
      </div>
      <aside className="card stack stack--sm">
        <h3>Buy a table</h3>
        <p className="small muted">
          Another table of {content.balance.seatsPerTable} means fewer people stuck in the queue on busy nights —
          but only if the kitchen and your servers can keep up.
        </p>
        <p className="xs faint">The price is set by the sim; you'll see it come off your cash.</p>
        <button className="btn btn--green" disabled={!canBuy || game.phase !== "planning"} onClick={() => send({ type: "BUY_TABLE" })}>
          {canBuy ? "Buy table" : "Room is full"}
        </button>
      </aside>
    </div>
  );
}
