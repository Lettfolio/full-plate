import { useState } from "react";
import { Icon } from "../../components/Icon";
import type { Command, GameState, IngredientId } from "@full-plate/sim-core";
import { MoneyText } from "../../components/MoneyText";
import { Stepper } from "../../components/Stepper";
import { expectedCovers, restockLines, type StockNeed } from "./stockNeeds";
import { forecastLine, wholeHave } from "../../lib/dayLoop";

interface Props { game: GameState; send: (cmd: Command) => void; needs: StockNeed[]; /** Day 0: opening stock arrives at "Open", so nothing reads as short. */ opening?: boolean }

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

export function StockTab({ game, send, needs, opening = false }: Props) {
  const [qty, setQty] = useState<Record<IngredientId, number>>({});
  const rows = [...needs].sort((a, b) => (b.need > 0 ? 1 : 0) - (a.need > 0 ? 1 : 0) || a.name.localeCompare(b.name));
  const basket = rows.reduce((a, r) => a + (qty[r.ingredientId] ?? 0) * r.unitCost, 0);
  const ordered = game.orders.reduce((a, o) => a + o.cost, 0);
  const lines = new Map(rows.map((r) => [r.ingredientId, forecastLine(r, opening)]));
  const shortCount = [...lines.values()].filter((l) => l.tone === "short").length;
  const guests = expectedCovers(game);
  const fillShort = () => setQty({ ...qty, ...Object.fromEntries(restockLines(game)) });
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
      </div>
      {/* Round 7: the forecast in one line a child can read, before the table. */}
      <p className={`forecast forecast--${opening ? "opening" : shortCount ? "short" : "ok"}`} data-testid="stock-forecast">
        <span className="forecast__icon" aria-hidden="true"><Icon name={shortCount && !opening ? "stock" : "check"} size={24} /></span>
        <span>
          Next service: about <b>{guests}</b> guests.{" "}
          {opening ? "Today's opening stock is bought for you when you open." : shortCount ? <><b>{shortCount} thing{shortCount === 1 ? "" : "s"}</b> will run short — tap <b>{opening ? "Fill for tomorrow" : "Fill what's short"}</b>, then <b>Place order</b>.</> : "The larder covers it."}
        </span>
      </p>
      {opening && (
        <p className="callout" role="note"><b>First day:</b> today's opening stock is bought for you when you open. Anything you order here is for tomorrow.</p>
      )}
      <p className="callout">
        <b>Orders arrive tomorrow morning</b>, not today — today's service uses what's in the larder now.
        The easiest habit: restock from the evening screen after each service.
      </p>
      <table className="stocktable">
        <caption className="sr-only">The larder: what you have, what the next service needs, and your order</caption>
        <thead>
          <tr>
            <th scope="col">Ingredient</th>
            <th scope="col" className="r">On hand</th>
            <th scope="col" className="stocktable__wide">Keeps</th>
            <th scope="col">Next service</th>
            <th scope="col" className="r stocktable__wide">Unit cost</th>
            <th scope="col">Order</th>
            <th scope="col" className="r">Line cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const q = qty[r.ingredientId] ?? 0;
            const line = lines.get(r.ingredientId)!;
            return (
              <tr key={r.ingredientId}>
                <th scope="row">
                  <b>{r.name}</b>
                  {r.usedBy.length > 0 && <div className="xs faint">{r.usedBy.join(", ")}</div>}
                  <div className="xs muted stocktable__narrow"><MoneyText pence={r.unitCost} /> each · keeps {r.shelfLifeDays}d</div>
                </th>
                <td className="r num"><b>{wholeHave(r.onHand)}</b>{r.incoming > 0 && <div className="xs muted">+{wholeHave(r.incoming)} coming</div>}</td>
                <td className="stocktable__wide"><Shelf days={r.shelfLifeDays} age={r.age} /></td>
                <td>
                  <span className={`need need--${line.tone}`} data-testid={`forecast-${r.ingredientId}`}>
                    {line.tone === "short" ? <Icon name="warning" size={16} /> : line.tone === "ok" || line.tone === "coming" ? <Icon name="check" size={16} /> : null}{line.text}
                  </span>
                </td>
                <td className="r stocktable__wide"><MoneyText pence={r.unitCost} /></td>
                <td><Stepper label={`order of ${r.name}`} value={q} step={5} bigStep={20} max={500} onChange={(v) => setQty({ ...qty, [r.ingredientId]: v })} /></td>
                <td className="r">{q > 0 ? <MoneyText pence={q * r.unitCost} /> : <span className="faint">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="row">
        <button className="btn btn--ghost" onClick={fillShort}>{opening ? "Fill for tomorrow" : "Fill what's short"}</button>
        {ordered > 0 && <span className="small muted">Already ordered today: <MoneyText pence={ordered} /></span>}
        <span className="spacer" />
        <span>Basket <b><MoneyText pence={basket} /></b></span>
        <button className="btn btn--green" disabled={basket === 0} onClick={place}>Place order</button>
      </div>
      <p className="xs faint">“Next service” is a rough guess: the busiest recent day, one main per guest plus some starters, sides, desserts and drinks. Prices shown are base prices; seasonal discounts apply at checkout. Fresh food spoils — don't over-order the short-life stuff.</p>
    </div>
  );
}
