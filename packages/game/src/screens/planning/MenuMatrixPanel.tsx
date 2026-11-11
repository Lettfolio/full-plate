import type { DishId, MenuItem, MenuQuadrant } from "@full-plate/sim-core";
import { content } from "../../sim";
import { plateCost } from "../../lib/content";
import { Term } from "../../components/Term";
import { MenuMatrix } from "./MenuMatrix";
import { QUADRANT, QUADRANT_TERM } from "./quadrants";
import { MenuMatrixList } from "./MenuMatrixList";
import { usePhoneNarrow } from "../../lib/layout";

interface Props {
  items: MenuItem[];
  quadrants: Record<DishId, MenuQuadrant>;
  names: Record<DishId, string>;
  highlight: DishId | null;
  onHover: (id: DishId | null) => void;
}

/** Round 7: the expert view's chart + legend, loaded on first use (React.lazy in MenuTab). */
export default function MenuMatrixPanel({ items, quadrants, names, highlight, onHover }: Props) {
  // Round 13 (B): an upright phone gets the matrix as a ranked list (MenuMatrixList), not a squeezed chart.
  const phone = usePhoneNarrow();
  const margin = (m: MenuItem) => m.price - plateCost(content, m.dishId);
  if (phone) return (
    <div className="stack stack--sm">
      <h3>Menu matrix</h3>
      <MenuMatrixList items={items} quadrants={quadrants} names={names} fallbackMargin={margin} plateCost={(m) => plateCost(content, m.dishId)} />
    </div>
  );
  return (
    <div className="stack stack--sm">
      <h3>Menu matrix</h3>
      <MenuMatrix items={items} quadrants={quadrants} names={names} fallbackMargin={(m) => m.price - plateCost(content, m.dishId)} highlight={highlight} onHover={onHover} />
      <div className="matrix__legend">
        {(Object.keys(QUADRANT) as (keyof typeof QUADRANT)[]).map((q) => (
          <div key={q}><b style={{ color: QUADRANT[q].colour }}>●</b> <Term id={QUADRANT_TERM[q]} inline><b>{QUADRANT[q].label}</b></Term> — {QUADRANT[q].hint}</div>
        ))}
      </div>
    </div>
  );
}
