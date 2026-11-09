import type { Command, GameState } from "@full-plate/sim-core";
import { STARS_CONSTANTS } from "@full-plate/sim-stars";
import { MoneyText } from "../../components/MoneyText";
import type { TonightRisk } from "./stockNeeds";

interface Props {
  game: GameState;
  risk: TonightRisk;
  send: (cmd: Command) => void;
  /** Stars path in inspection season: the warning is louder and names what's at stake. */
  inspection?: boolean;
  /** Stars held now (the copy says "the star" once there is one to lose). */
  stars?: number;
  /** Stars owners can shut tonight instead (it doesn't count against steadiness). */
  canClose?: boolean;
  /** Round 4 review: the alert says closing is safe, so it offers the button right there. */
  onClose?: () => void;
  onStock?: () => void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Round 3 review P1: "forgetting to restock for one evening in inspection season empties the menu". Shown in the
 * morning when the larder on hand won't cover sim-core's forecast for a menu dish. Orders arrive tomorrow, so the
 * one-tap order protects tomorrow; tonight the honest choices are a shorter menu or (Stars) closing.
 */
export function StockWarning({ game, risk, send, inspection = false, stars = 0, canClose = false, onClose, onStock }: Props) {
  if (!risk.dishes.length) return null;
  const shown = risk.dishes.slice(0, 4);
  const more = risk.dishes.length - shown.length;
  const ordered = risk.lines.length === 0 && game.orders.length > 0;
  const offNight = risk.dishes.length >= STARS_CONSTANTS.SHORT_MENU_MIN_86;
  return (
    <div className={`callout ${inspection ? "callout--warn stockwarn--loud" : ""} stockwarn`} role={inspection ? "alert" : "note"} aria-label="Stock warning">
      {inspection && (
        <div className="stockwarn__head">
          🕵️ <b>Inspectors are about — a short menu tonight could cost {stars > 0 ? "the star" : "you a star"}.</b>
        </div>
      )}
      <div>
        <b>📦 Tonight's larder won't cover {plural(risk.dishes.length, "dish", "dishes")}</b>
        {risk.out > 0 && <> ({risk.out} will be off the menu when the doors open)</>}:{" "}
        {shown.map((d, i) => (
          <span key={d.dishId}>
            {i > 0 ? ", " : ""}
            {d.name} <span className="muted">({d.plates === 0 ? "none left" : `about ${d.plates}`})</span>
          </span>
        ))}
        {more > 0 && <> and {more} more</>}.
      </div>
      <div className="xs">
        Deliveries arrive tomorrow morning, so tonight cooks from what's on the shelf.
        {inspection && offNight && <> {plural(STARS_CONSTANTS.SHORT_MENU_MIN_86, "dish", "dishes")} or more off counts as an off night for the guide.{canClose ? " Closing tonight doesn't count against you." : ""}</>}
      </div>
      <div className="row row--wrap" style={{ marginTop: 6 }}>
        {ordered ? (
          <span className="small">✓ Ordered — it arrives tomorrow morning.</span>
        ) : risk.lines.length > 0 ? (
          <button
            className={`btn btn--sm ${inspection ? "btn--primary" : "btn--green"}`}
            disabled={game.phase !== "planning"}
            title="Orders sim-core's suggested shortfall for every ingredient. It arrives tomorrow morning."
            onClick={() => risk.lines.forEach(([ingredientId, qty]) => send({ type: "ORDER_STOCK", ingredientId, qty }))}
          >
            Order to cover tomorrow · ≈<MoneyText pence={risk.cost} whole />
          </button>
        ) : null}
        {inspection && offNight && canClose && onClose && (
          <button className="btn btn--sm" disabled={game.phase !== "planning"} title="No service tonight, no inspector, and it doesn't count against your steadiness." onClick={onClose}>
            Close tonight instead
          </button>
        )}
        {onStock && <button className="btn btn--sm btn--ghost" onClick={onStock}>See the larder</button>}
      </div>
    </div>
  );
}
