import { lazy, Suspense } from "react";
import type { Command, GameState } from "@full-plate/sim-core";
import type { PathMeta } from "../../state/paths";
import { content, TABLE_COST } from "../../sim";
import { MoneyText } from "../../components/MoneyText";
import { useSpendGuard } from "../../components/SpendGuard";
import { RegularsCard, RivalCard } from "../../components/RivalCard";

// Round 12 (B): the brand kit card (and its editor sheet and the postcard) is its own chunk.
const BrandCard = lazy(() => import("./BrandTab").then((m) => ({ default: m.BrandCard })));

interface Props { game: GameState; send: (cmd: Command) => void; meta?: PathMeta | undefined; onBrand?: ((code: string) => void) | undefined }

export function RestaurantTab({ game, send, meta, onBrand }: Props) {
  const max = content.balance.maxTables;
  const seats = game.tables.reduce((a, t) => a + t.seats, 0);
  const roomLeft = game.tables.length < max;
  const affordable = game.cash >= TABLE_COST;
  const { guard, dialog } = useSpendGuard(game);
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
        <p className="small">Price: <b><MoneyText pence={TABLE_COST} whole /></b></p>
        <button className="btn btn--green" disabled={!roomLeft || !affordable || game.phase !== "planning"} onClick={() => guard(TABLE_COST, "Another table", () => send({ type: "BUY_TABLE" }))}>
          {!roomLeft ? "Room is full" : affordable ? <>Buy table · <MoneyText pence={TABLE_COST} whole /></> : <>Needs <MoneyText pence={TABLE_COST - game.cash} whole /> more</>}
        </button>
        {dialog}
      </aside>
      {meta && <Suspense fallback={null}><BrandCard game={game} meta={meta} onBrand={onBrand} /></Suspense>}
      {/* Round 12 (E): the chef across the road and the Regulars book. */}
      <div className="voices-row"><RivalCard game={game} /><RegularsCard game={game} /></div>
    </div>
  );
}
