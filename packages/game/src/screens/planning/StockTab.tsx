import { useState } from "react";
import type { Command, GameState, IngredientId } from "@full-plate/sim-core";
import { MoneyText } from "../../components/MoneyText";
import { Stepper } from "../../components/Stepper";
import { expectedCovers, shortfall, type StockNeed } from "./stockNeeds";

interface Props { game: GameState; send: (cmd: Command) => void; needs: StockNeed[] }

function Shelf({ days, age }: { days: number; age: number }) {
  const left = Math.max(0, days - age);
  const shown = Math.min(days, 10);
  return (
    <span className="row" style={{ gap: 6 }} title={`Keeps ${days} day${days === 1 ? "" : "s"}; oldest batch is ${age} day${age === 1 ? "" : "s"} old`}>
      <span className="shelf" aria-hidden="true">
        {Array.from({ length: shown }, (_, i) => <i key={i} className={left <= 1 ? "shelf--short" : ""} style={{ opacity: i < Math.min(left, shown) ? 1 : 0.18 }} />)}
      </span>
      <span className="xs muted">{days}d{days > 10 ? "+" : ""}</span>
    </span>
  );
}

export function StockTab({ game, send, needs }: Props) {
  const [qty, setQty] = useState<Record<IngredientId, number>>({});
  const rows = [...needs].sort((a, b) => (b.need > 0 ? 1 : 0) - (a.need > 0 ? 1 : 0) || a.name.localeCompare(b.name));
  const basket = rows.reduce((a, r) => a + (qty[r.ingredientId] ?? 0) * r.unitCost, 0);
  const ordered = game.orders.reduce((a, o) => a + o.cost, 0);
  const fillShort = () => setQty({ ...qty, ...shortfall(rows) });
  const place = () => {
    for (const r of rows) {
      const q = qty[r.ingredientId] ?? 0;
      if (q > 0) send({ type: "ORDER_STOCK", ingredientId: r.ingredientId, qty: q });
    }
    setQty({});
  };

  return (
    <div className="stack">
      <div className="row">
        <h3 className="spacer">Larder & order sheet</h3>
        <span className="small muted">Planning for about <b>{expectedCovers(game)}</b> guests</span>
      </div>
      <p className="callout">
        <b>Orders arrive tomorrow morning</b>, not today — today's service uses what's in the larder now.
        The easiest habit: restock from the evening screen after each service.
      </p>
      <table className="stocktable">
        <thead>
          <tr>
            <th>Ingredient</th>
            <th className="r">On hand</th>
            <th>Keeps</th>
            <th>Needed for menu</th>
            <th className="r">Unit cost</th>
            <th>Order</th>
            <th className="r">Line cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const q = qty[r.ingredientId] ?? 0;
            const have = r.onHand + r.incoming;
            const state = r.need === 0 ? "idle" : have >= r.need ? "ok" : "short";
            return (
              <tr key={r.ingredientId}>
                <td>
                  <b>{r.name}</b>
                  {r.usedBy.length > 0 && <div className="xs faint">{r.usedBy.join(", ")}</div>}
                </td>
                <td className="r num"><b>{r.onHand}</b>{r.incoming > 0 && <div className="xs muted">+{r.incoming} coming</div>}</td>
                <td><Shelf days={r.shelfLifeDays} age={r.age} /></td>
                <td>
                  <span className={`need need--${state}`}>
                    {state === "idle" ? "not on menu" : state === "ok" ? `✓ ~${r.need} needed` : `▲ ~${r.need} needed, short ${r.need - have}`}
                  </span>
                </td>
                <td className="r"><MoneyText pence={r.unitCost} /></td>
                <td><Stepper label={`order of ${r.name}`} value={q} step={5} bigStep={20} max={500} onChange={(v) => setQty({ ...qty, [r.ingredientId]: v })} /></td>
                <td className="r">{q > 0 ? <MoneyText pence={q * r.unitCost} /> : <span className="faint">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row">
        <button className="btn btn--ghost" onClick={fillShort}>Fill what's short</button>
        {ordered > 0 && <span className="small muted">Already ordered today: <MoneyText pence={ordered} /></span>}
        <span className="spacer" />
        <span>Basket <b><MoneyText pence={basket} /></b></span>
        <button className="btn btn--green" disabled={basket === 0} onClick={place}>Place order</button>
      </div>
      <p className="xs faint">“Needed” is a rough guess: the busiest recent day, one main per guest plus some starters, sides, desserts and drinks. Prices shown are base prices; seasonal discounts apply at checkout. Fresh food spoils — don't over-order the short-life stuff.</p>
    </div>
  );
}
