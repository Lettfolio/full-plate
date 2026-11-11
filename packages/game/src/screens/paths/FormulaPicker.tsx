/**
 * Round 13 (D): an invented dish in the brand formula (Empire tab › The brand). The formula is sim-empire's own
 * `SET_FORMULA menuDishIds` — the same command the presets send — so nothing about the franchise economics changes:
 * an invented dish is an ordinary DishDef in the pack (content's customDish transform, appeal capped at the course's
 * top quarter), priced at its suggested price × the formula's price index like every formula dish, and a locked
 * formula's sites lose consistency while they retrain, as for any menu change. Nobody who doesn't press these
 * buttons sees a different number.
 */
import type { EmpireCommand, EmpireState } from "@full-plate/sim-empire";
import { liveDishes } from "@full-plate/content";
import { content } from "../../sim";
import { MoneyText } from "../../components/MoneyText";
import { Term } from "../../components/Term";
import type { PathMeta } from "../../state/paths";
import "./refine.css";

interface Props { e: EmpireState; meta?: PathMeta | undefined; send: (c: EmpireCommand) => void }

export function FormulaPicker({ e, meta, send }: Props) {
  const f = e.brand.formula;
  const mine = liveDishes(meta);
  const names = f.menuDishIds.map((id) => content.dishes.find((d) => d.id === id)?.name ?? id);
  return (
    <div className="stack stack--sm formulapick" data-testid="formula-picker">
      <h4>On the formula now</h4>
      <p className="xs">{names.join(" · ")}</p>
      <h4>Your recipes</h4>
      {!mine.length ? <p className="xs muted">Invent a dish on the Menu tab and it can go into the formula here: every site would cook it.</p> : (
        <>
          <p className="xs muted">
            Put one of your own dishes on every site's menu, at its suggested price × the formula's price level ({f.priceIndex.toFixed(2)}).
            {f.locked && <> Changing a locked formula costs every site some <Term id="brandConsistency" inline>consistency</Term> while they retrain.</>}
          </p>
          <ul className="formulapick__list">
            {mine.map((d) => {
              const def = content.dishes.find((x) => x.id === d.id);
              const inIt = f.menuDishIds.includes(d.id);
              const last = inIt && f.menuDishIds.length <= 1;
              return (
                <li key={d.id} className="row formulapick__row" data-testid="formula-recipe">
                  <span aria-hidden="true" className="formulapick__icon">{d.icon}</span>
                  <span className="spacer small"><b>{d.name}</b>{def && <span className="xs muted"> · <MoneyText pence={Math.round(def.suggestedPrice * f.priceIndex)} /> a plate</span>}</span>
                  {inIt ? <button className="btn btn--sm btn--ghost" disabled={last} onClick={() => send({ type: "SET_FORMULA", menuDishIds: f.menuDishIds.filter((x) => x !== d.id) })} aria-label={`Take ${d.name} out of the formula`}>Take it out</button>
                    : <button className="btn btn--sm" onClick={() => send({ type: "SET_FORMULA", menuDishIds: [...f.menuDishIds, d.id] })} aria-label={`Put ${d.name} in the formula`}>Put it in</button>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
