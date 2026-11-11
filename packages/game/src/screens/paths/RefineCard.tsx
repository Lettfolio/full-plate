/**
 * Round 13 (D): the head chef refines one invented dish a season (Stars tab). A name suffix and a line of menu prose,
 * each picked from a small pool, and one more point of skill needed — no other number moves (content's cookbookOp
 * "refine"; the DishDef gets the suffix, the prose as its blurb and skillRequired + 1). Cosmetic prestige: the guide
 * envelope names a refined dish that was served on an inspection night.
 */
import { useState } from "react";
import type { GameState } from "@full-plate/sim-core";
import { liveDishes, REFINE_PROSE, REFINE_SUFFIXES, refineWords, type CookbookOp } from "@full-plate/content";
import { content } from "../../sim";
import { seasonName, seasonOf } from "../../lib/calendar";
import type { PathMeta } from "../../state/paths";

interface Props {
  game: GameState;
  meta: PathMeta;
  chefName: string;
  hasHeadChef: boolean;
  onCookbook?: ((op: CookbookOp) => void) | undefined;
}

export function RefineCard({ game, meta, chefName, hasHeadChef, onCookbook }: Props) {
  const season = seasonOf(game.day);
  const live = liveDishes(meta);
  const done = (meta.customDishes ?? []).find((d) => d.refined?.season === season);
  const open = live.filter((d) => !d.refined);
  const [dishId, setDishId] = useState("");
  const [suffix, setSuffix] = useState(0);
  const [prose, setProse] = useState(0);
  const pick = open.find((d) => d.id === dishId) ?? open[0];
  const refinedAll = live.filter((d) => d.refined);
  const skill = pick ? content.dishes.find((x) => x.id === pick.id)?.skillRequired : undefined;
  return (
    <div className="card stack stack--sm" data-testid="refine-card">
      <div className="card__title"><h3>Refine a dish</h3><span className="xs faint">one a season · this is {seasonName(season)}</span></div>
      {!live.length ? <p className="small muted">Invent a dish on the Menu tab first. Then {chefName} can make it a signature of the house.</p>
        : !hasHeadChef ? <p className="small muted">You need a head chef to refine a dish: put your best chef in charge.</p>
        : done ? <p className="small">This {seasonName(season)}'s refined dish: <b>{done.name}, {refineWords(done)?.suffix}</b>. {chefName} will look at another one in the {seasonName(season + 1)}.</p>
        : !open.length ? <p className="small muted">Every dish in your cookbook is already refined. Invent another.</p>
        : (
          <div className="stack stack--sm">
            <p className="small">{chefName} reworks one of your recipes: a grander name, a line for the menu, and it needs one more point of skill to cook{skill !== undefined ? ` (${skill} → ${skill + 1})` : ""}. Nothing else changes.</p>
            <label className="refine__field"><span className="small">Dish</span>
              <select className="refine__select" value={pick?.id ?? ""} onChange={(e) => setDishId(e.target.value)}>
                {open.map((d) => <option key={d.id} value={d.id}>{d.icon} {d.name}</option>)}
              </select>
            </label>
            <label className="refine__field"><span className="small">New name</span>
              <select className="refine__select" value={suffix} onChange={(e) => setSuffix(Number(e.target.value))}>
                {REFINE_SUFFIXES.map((s, i) => <option key={s} value={i}>{pick?.name}, {s}</option>)}
              </select>
            </label>
            <label className="refine__field"><span className="small">Line on the menu</span>
              <select className="refine__select" value={prose} onChange={(e) => setProse(Number(e.target.value))}>
                {REFINE_PROSE.map((s, i) => <option key={s} value={i}>{s}</option>)}
              </select>
            </label>
            <p className="small refine__preview" data-testid="refine-preview"><b>{pick?.name}, {REFINE_SUFFIXES[suffix]}</b> <i>“{REFINE_PROSE[prose]}”</i></p>
            <button className="btn btn--primary btn--sm refine__go" disabled={!onCookbook || !pick || game.phase !== "planning"} onClick={() => pick && onCookbook?.({ op: "refine", id: pick.id, season, suffix, prose })}>Refine it</button>
          </div>
        )}
      {refinedAll.length > 0 && <p className="xs muted">Refined so far: {refinedAll.map((d) => `${d.name}, ${refineWords(d)?.suffix}`).join(" · ")}</p>}
    </div>
  );
}
