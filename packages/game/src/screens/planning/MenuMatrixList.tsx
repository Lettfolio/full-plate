/**
 * Round 13 (B): the menu matrix on an upright phone. A 360-unit scatter plot squeezed into 358 px puts its words
 * under 13 px, so a phone gets the same judgement as a ranked list: the four quadrants (same names, colours and tips),
 * each dish ranked by what it made over the last 7 days; tap a dish for its numbers. Lives in the matrix's lazy chunk.
 */
import { useState } from "react";
import type { DishId, MenuItem, MenuQuadrant } from "@full-plate/sim-core";
import { Term } from "../../components/Term";
import { MoneyText } from "../../components/MoneyText";
import { judged, QUADRANT, QUADRANT_MIN_DAYS, QUADRANT_TERM } from "./quadrants";

/** The phone list's groups, best first. */
export const LIST_ORDER: readonly MenuQuadrant[] = ["star", "ploughhorse", "puzzle", "dog"];

/** Margin a plate: last week's average, or price minus plate cost before anything has sold. */
export const plateMargin = (m: MenuItem, fallback: (m: MenuItem) => number): number => (m.sold7d ? Math.round(m.margin7d / m.sold7d) : fallback(m));

/** Dishes grouped by quadrant (in LIST_ORDER), each group ranked by last week's margin, then plates sold. */
export function rankMenu(items: readonly MenuItem[], quadrants: Record<DishId, MenuQuadrant>, fallback: (m: MenuItem) => number): { q: MenuQuadrant; dishes: MenuItem[] }[] {
  return LIST_ORDER.map((q) => ({
    q,
    dishes: items
      .filter((m) => (quadrants[m.dishId] ?? "dog") === q)
      .sort((a, b) => b.margin7d - a.margin7d || b.sold7d - a.sold7d || plateMargin(b, fallback) - plateMargin(a, fallback)),
  }));
}

interface Props {
  items: MenuItem[];
  quadrants: Record<DishId, MenuQuadrant>;
  names: Record<DishId, string>;
  fallbackMargin: (m: MenuItem) => number;
  plateCost: (m: MenuItem) => number;
}

export function MenuMatrixList({ items, quadrants, names, fallbackMargin, plateCost }: Props) {
  const [open, setOpen] = useState<DishId | null>(null);
  const groups = rankMenu(items, quadrants, fallbackMargin);
  return (
    <div className="mmlist" aria-label="Menu matrix as a list">
      {groups.map(({ q, dishes }) => (
        <section key={q} className={`mmlist__group mmlist__group--${q}`} aria-labelledby={`mmlist-${q}`}>
          <h4 id={`mmlist-${q}`} className="mmlist__head">
            <span className="mmlist__dot" style={{ background: QUADRANT[q].colour }} aria-hidden="true" />
            <Term id={QUADRANT_TERM[q]} inline>{q === "star" ? "Stars" : q === "ploughhorse" ? "Plough-horses" : q === "puzzle" ? "Puzzles" : "Dogs"}</Term>
            <span className="mmlist__count">{dishes.length}</span>
          </h4>
          <p className="mmlist__hint">{QUADRANT[q].hint}</p>
          {dishes.length === 0 ? <p className="mmlist__none">None right now.</p> : (
            <ol className="mmlist__dishes">
              {dishes.map((m, i) => {
                const isOpen = open === m.dishId;
                const id = `mmlist-d-${m.dishId}`;
                return (
                  <li key={m.dishId} className="mmlist__dish">
                    <button type="button" className="mmlist__row" aria-expanded={isOpen} aria-controls={id} onClick={() => setOpen(isOpen ? null : m.dishId)}>
                      <span className="mmlist__rank" aria-hidden="true">{i + 1}</span>
                      <span className="mmlist__name">{names[m.dishId] ?? m.dishId}</span>
                      <span className="mmlist__sum">{m.sold7d} sold · <MoneyText pence={plateMargin(m, fallbackMargin)} /> a plate</span>
                      <span className="mmlist__chev" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>
                    </button>
                    {isOpen && (
                      <dl className="mmlist__nums" id={id}>
                        <div><dt>Sold, last 7 days</dt><dd>{m.sold7d}</dd></div>
                        <div><dt>Price</dt><dd><MoneyText pence={m.price} /></dd></div>
                        <div><dt>Food cost a plate</dt><dd><MoneyText pence={plateCost(m)} /></dd></div>
                        <div><dt><Term id="margin" inline>Margin</Term> a plate</dt><dd><MoneyText pence={plateMargin(m, fallbackMargin)} /></dd></div>
                        <div><dt>Made, last 7 days</dt><dd><MoneyText pence={m.margin7d} whole /></dd></div>
                        {!judged(m) && <div className="mmlist__new"><dt>New</dt><dd>judged after {QUADRANT_MIN_DAYS} days of sales</dd></div>}
                      </dl>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ))}
    </div>
  );
}
