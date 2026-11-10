/**
 * Round 12 (F): "Your cookbook" on the Menu tab, between today's menu and the recipe book — the "Invent a dish" button
 * (opens the lazy InventDishSheet) and a strip of every dish she invented, with its plates sold all time (folded in each
 * evening by content's foldCookbook) and an Add button for one that isn't on the menu now. Its own chunk.
 */
import { lazy, Suspense, useState } from "react";
import type { Command, GameState } from "@full-plate/sim-core";
import { content, MAX_MENU_ITEMS } from "../../sim";
import { Icon } from "../../components/Icon";
import { MoneyText } from "../../components/MoneyText";
import { canInvent, type CustomDish } from "../../lib/customDish";
import type { PathMeta } from "../../state/paths";
import "./invent.css";

const InventDishSheet = lazy(() => import("./InventDishSheet"));
const COURSE: Record<string, string> = { starter: "Starter", main: "Main", dessert: "Dessert", drink: "Drink" };

interface Props {
  meta: PathMeta | undefined;
  game: GameState;
  send: (cmd: Command) => void;
  /** Puts the recipe in the cookbook (the reducer's "invent"); this strip then adds it to the menu at her price. */
  onInvent: (dish: CustomDish) => void;
}

export default function CookbookStrip({ meta, game, send, onInvent }: Props) {
  const [open, setOpen] = useState(false);
  const dishes = meta?.customDishes ?? [];
  const can = canInvent(meta);
  if (!can && dishes.length === 0) return null;
  const total = dishes.reduce((a, d) => a + d.sold, 0);
  return (
    <section className="cookbook" aria-label="Your cookbook">
      <div className="row cookbook__head">
        <h3 className="spacer">Your cookbook</h3>
        <span className="small muted">{dishes.length ? `${dishes.length} invented · ${total} plate${total === 1 ? "" : "s"} sold so far` : "Your own recipes: pick the ingredients, set the price."}</span>
        {can && <button className="btn" disabled={game.phase !== "planning"} onClick={() => setOpen(true)}><Icon name="chefHat" size={20} />Invent a dish</button>}
      </div>
      {dishes.length > 0 && (
        <ul className="cookbook__strip">
          {dishes.map((d) => {
            const def = content.dishes.find((x) => x.id === d.id);
            const on = game.menu.find((m) => m.dishId === d.id);
            return (
              <li key={d.id} className="cookbook__card" data-testid="cookbook-card">
                <div className="cookbook__top">
                  <span className="cookbook__icon" aria-hidden="true">{d.icon}</span>
                  <b className="spacer">{d.name}</b>
                </div>
                <div className="xs muted">{COURSE[d.course]} · invented day {d.createdDay + 1}{def ? <> · sells <MoneyText pence={def.suggestedPrice} /></> : null}</div>
                <div><span className="cookbook__sold">{d.sold}</span> <span className="small">sold all time</span></div>
                {on ? <span className="pill">{on.active ? "On the menu" : "Resting"}</span> : (
                  <button className="btn btn--green btn--sm" disabled={!def || game.menu.length >= MAX_MENU_ITEMS || game.phase !== "planning"} onClick={() => def && send({ type: "ADD_MENU_ITEM", dishId: d.id, price: def.suggestedPrice })} aria-label={`Add ${d.name} to the menu`}>Add to menu</button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <Suspense fallback={null}>
          <InventDishSheet game={game} have={dishes} onClose={() => setOpen(false)} onInvent={(d, p) => { setOpen(false); onInvent(d); if (p) send({ type: "ADD_MENU_ITEM", dishId: d.id, price: p }); }} />
        </Suspense>
      )}
    </section>
  );
}
