/**
 * Round 12 (F): "Your cookbook" on the Menu tab, between today's menu and the recipe book — the "Invent a dish" button
 * (opens the lazy InventDishSheet) and a strip of every dish she invented, with its plates sold all time (folded in each
 * evening by content's foldCookbook) and an Add button for one that isn't on the menu now. Its own chunk.
 *
 * Round 13 (D): each card can be **edited** (the same sheet: name, plate, price, ingredients — new ingredients make a
 * new version and the old one's sales stay under "<name> v1"), **rested** (off today's menu and onto the shelf),
 * **deleted** (confirm; refused while it's on today's menu, the set menu, the brand formula or another shop's menu)
 * and **moved** left or right. Every change is the reducer's `cookbook` action (content's cookbookOp).
 */
import { lazy, Suspense, useState } from "react";
import type { Command, GameState } from "@full-plate/sim-core";
import { housePrice, liveDishes, olderVersions, refineWords, type CookbookOp } from "@full-plate/content";
import { content, customRef, MAX_MENU_ITEMS } from "../../sim";
import { Icon } from "../../components/Icon";
import { MoneyText } from "../../components/MoneyText";
import { canInvent, type CustomDish } from "../../lib/customDish";
import { cookbookUse } from "../../state/gameReducer";
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
  /** Round 13 (D): edit / rest / delete / move (the reducer's "cookbook"). Without it the cards are read-only. */
  onCookbook?: ((op: CookbookOp) => void) | undefined;
}

/** Where a recipe is used, in words, for the delete confirm (null = nowhere: it can go). */
function usedWhere(game: GameState, meta: PathMeta, id: string): string | null {
  const u = cookbookUse(game, meta, id);
  return u.menu ? "today's menu" : u.setMenu ? "the set menu" : u.formula ? "the brand formula" : u.parked ? "another shop's menu" : null;
}

export default function CookbookStrip({ meta, game, send, onInvent, onCookbook }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const all = meta?.customDishes ?? [];
  const dishes = liveDishes(meta);
  const can = canInvent(meta);
  if (!can && dishes.length === 0) return null;
  const total = all.reduce((a, d) => a + d.sold, 0);
  const planning = game.phase === "planning";
  const edit = editing ? dishes.find((d) => d.id === editing) : undefined;
  const op = (o: CookbookOp) => onCookbook?.(o);
  const shelf = dishes.filter((d) => d.resting).length;
  return (
    <section className="cookbook" aria-label="Your cookbook">
      <div className="row cookbook__head">
        <h3 className="spacer">Your cookbook</h3>
        <span className="small muted">{dishes.length ? `${dishes.length} invented${shelf ? ` · ${shelf} resting` : ""} · ${total} plate${total === 1 ? "" : "s"} sold so far` : "Your own recipes: pick the ingredients, set the price."}</span>
        {can && <button className="btn" disabled={!planning} onClick={() => setOpen(true)}><Icon name="chefHat" size={20} />Invent a dish</button>}
      </div>
      {dishes.length > 0 && (
        <ul className="cookbook__strip">
          {dishes.map((d, i) => {
            const def = content.dishes.find((x) => x.id === d.id);
            const on = game.menu.find((m) => m.dishId === d.id);
            const older = olderVersions(meta, d.id);
            const refined = refineWords(d);
            const price = housePrice(d, customRef);
            const where = meta ? usedWhere(game, meta, d.id) : null;
            return (
              <li key={d.id} className={`cookbook__card${d.resting ? " is-resting" : ""}`} data-testid="cookbook-card">
                <div className="cookbook__top">
                  <span className="cookbook__icon" aria-hidden="true">{d.icon}</span>
                  <b className="spacer">{d.name}{refined && <span className="cookbook__suffix">, {refined.suffix}</span>}</b>
                  {d.v && <span className="pill cookbook__v">Version {d.v}</span>}
                </div>
                <div className="xs muted">{COURSE[d.course]} · invented day {d.createdDay + 1}{def ? <> · your price <MoneyText pence={on?.price ?? price} /></> : null}</div>
                {refined && <div className="xs cookbook__prose">“{refined.prose}”</div>}
                <div><span className="cookbook__sold">{d.sold}</span> <span className="small">sold all time</span></div>
                {older.length > 0 && <div className="xs muted" data-testid="cookbook-older">{older.map((o) => `${o.name}: ${o.sold} sold`).join(" · ")}</div>}
                {d.resting ? <span className="pill">Resting</span> : on ? <span className="pill">{on.active ? "On the menu" : "Off today"}</span> : (
                  <button className="btn btn--green btn--sm" disabled={!def || game.menu.length >= MAX_MENU_ITEMS || !planning} onClick={() => def && send({ type: "ADD_MENU_ITEM", dishId: d.id, price })} aria-label={`Add ${d.name} to the menu`}>Add to menu</button>
                )}
                {onCookbook && confirm === d.id ? (
                  <div className="cookbook__confirm" role="group" aria-label={`Delete ${d.name}?`}>
                    {where ? (
                      <>
                        <span className="small">It's on {where}: take it off there first.</span>
                        <button className="btn btn--sm" onClick={() => setConfirm(null)}>OK</button>
                      </>
                    ) : (
                      <>
                        <span className="small">Delete {d.name} for good? Old nights keep their numbers.</span>
                        <div className="row">
                          <button className="btn btn--danger btn--sm" onClick={() => { setConfirm(null); op({ op: "delete", id: d.id }); }}>Delete</button>
                          <button className="btn btn--ghost btn--sm" onClick={() => setConfirm(null)}>Keep it</button>
                        </div>
                      </>
                    )}
                  </div>
                ) : onCookbook && (
                  <div className="cookbook__tools">
                    <button className="btn btn--sm" disabled={!planning} onClick={() => setEditing(d.id)} aria-label={`Edit ${d.name}`}>Edit</button>
                    <button className="btn btn--sm btn--ghost" disabled={!planning} onClick={() => op({ op: "rest", id: d.id, resting: !d.resting })} aria-label={d.resting ? `Bring back ${d.name}` : `Rest ${d.name}`}>{d.resting ? "Bring back" : "Rest"}</button>
                    <button className="btn btn--sm btn--ghost" disabled={!planning} onClick={() => setConfirm(d.id)} aria-label={`Delete ${d.name}`}>Delete</button>
                    <span className="cookbook__move">
                      <button className="iconbtn iconbtn--tap" disabled={!planning || i === 0} onClick={() => op({ op: "move", id: d.id, by: -1 })} aria-label={`Move ${d.name} earlier`}><Icon name="back" size={20} /></button>
                      <button className="iconbtn iconbtn--tap" disabled={!planning || i === dishes.length - 1} onClick={() => op({ op: "move", id: d.id, by: 1 })} aria-label={`Move ${d.name} later`}><Icon name="forward" size={20} /></button>
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {open && (
        <Suspense fallback={null}>
          <InventDishSheet game={game} have={all} onClose={() => setOpen(false)} onInvent={(d, p) => { setOpen(false); onInvent(d); if (p) send({ type: "ADD_MENU_ITEM", dishId: d.id, price: p }); }} />
        </Suspense>
      )}
      {edit && (
        <Suspense fallback={null}>
          <InventDishSheet
            game={game} have={all} editing={edit} editPrice={game.menu.find((m) => m.dishId === edit.id)?.price ?? housePrice(edit, customRef)}
            onClose={() => setEditing(null)} onInvent={() => {}}
            onEdit={(c) => { setEditing(null); op({ op: "edit", id: edit.id, ...c }); }}
          />
        </Suspense>
      )}
    </section>
  );
}
