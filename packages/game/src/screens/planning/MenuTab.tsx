import { useMemo, useState } from "react";
import type { Command, DishCourse, DishId, GameState, MenuItem } from "@full-plate/sim-core";
import { classifyMenu, content, MAX_MENU_ITEMS } from "../../sim";
import { suggestedStarterMenu } from "../../lib/starterMenu";
import { MoneyText } from "../../components/MoneyText";
import { Stepper } from "../../components/Stepper";
import { marginFraction, plateCost } from "../../lib/content";
import { pct } from "../../lib/format";
import { MenuMatrix, QUADRANT } from "./MenuMatrix";
import { recipeBook, sectionOf, type LibrarySection, type PathKind } from "../../lib/library";
import { Term } from "../../components/Term";
import type { TermId } from "../../lib/glossary";
const QUADRANT_TERM = { star: "mmStar", ploughhorse: "mmPloughhorse", puzzle: "mmPuzzle", dog: "mmDog" } as const satisfies Record<string, TermId>;

interface Props {
  game: GameState;
  send: (cmd: Command) => void;
  /** The path chosen at the fork: unlocks the fast-food (Empire) or fine-dining (Stars) recipes. */
  path?: PathKind | undefined;
}

const SECTION_TITLE: Record<LibrarySection, string> = {
  library: "Recipe book",
  fast_food: "🍔 The formula kitchen (Empire)",
  fine_dining: "⭐ Fine dining (Stars)",
};

export const COURSE_ICON: Record<DishCourse, string> = { starter: "🥗", main: "🍽️", dessert: "🍰", drink: "🥤", side: "🍟" };
const COURSE_ORDER: DishCourse[] = ["starter", "main", "side", "dessert", "drink"];
const PRICE_STEP = 25;
const PRICE_BIG = 100;

function marginTone(f: number): string {
  return f >= 0.68 ? "margin--good" : f >= 0.55 ? "margin--ok" : "margin--bad";
}

export function MenuTab({ game, send, path }: Props) {
  const [hover, setHover] = useState<DishId | null>(null);
  const quadrants = useMemo(() => classifyMenu(content, game), [game]);
  const names = useMemo(() => Object.fromEntries(content.dishes.map((d) => [d.id, d.name])), []);
  const byCourse = (a: MenuItem, b: MenuItem) => {
    const ca = content.dishes.find((d) => d.id === a.dishId)?.course ?? "main";
    const cb = content.dishes.find((d) => d.id === b.dishId)?.course ?? "main";
    return COURSE_ORDER.indexOf(ca) - COURSE_ORDER.indexOf(cb);
  };
  const items = [...game.menu].sort(byCourse);
  const active = items.filter((m) => m.active);
  const onMenu = new Set(game.menu.map((m) => m.dishId));
  const library = recipeBook(content, path).filter((d) => !onMenu.has(d.id)).sort((a, b) => COURSE_ORDER.indexOf(a.course) - COURSE_ORDER.indexOf(b.course));
  const sections = (["fast_food", "fine_dining", "library"] as LibrarySection[])
    .map((id) => ({ id, dishes: library.filter((d) => sectionOf(d.id) === id) }))
    .filter((x) => x.dishes.length > 0);

  return (
    <div className="stack">
      <div className="menu-layout">
        <div className="stack stack--sm">
          <h3>Menu matrix</h3>
          <MenuMatrix items={active} quadrants={quadrants} names={names} fallbackMargin={(m) => m.price - plateCost(content, m.dishId)} highlight={hover} onHover={setHover} />
          <div className="matrix__legend">
            {(Object.keys(QUADRANT) as (keyof typeof QUADRANT)[]).map((q) => (
              <div key={q}><b style={{ color: QUADRANT[q].colour }}>●</b> <Term id={QUADRANT_TERM[q]} inline><b>{QUADRANT[q].label}</b></Term> — {QUADRANT[q].hint}</div>
            ))}
          </div>
        </div>

        <div className="stack stack--sm">
          <div className="row">
            <h3 className="spacer">On the menu</h3>
            <span className="small muted">{active.length} active · aim for 6–10 · max {MAX_MENU_ITEMS}</span>
          </div>
          <div className="dishlist">
            {items.length === 0 && (
              <div className="empty starter">
                <p><b>Your menu is empty — nobody will come in until you add some dishes.</b></p>
                <p className="small muted">Pick from the recipe book below, or start with a ready-made menu that suits this street. You can change it any morning.</p>
                <button className="btn btn--primary" onClick={() => suggestedStarterMenu(content, game).forEach((d) => send({ type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice }))}>
                  Use a suggested starter menu
                </button>
              </div>
            )}
            {items.map((m) => {
              const d = content.dishes.find((x) => x.id === m.dishId);
              const cost = plateCost(content, m.dishId);
              const f = marginFraction(m.price, cost);
              const q = quadrants[m.dishId];
              return (
                <div key={m.dishId} className={`dish ${m.active ? "" : "dish--off"}`} onMouseEnter={() => setHover(m.dishId)} onMouseLeave={() => setHover(null)} style={hover === m.dishId ? { borderColor: "var(--ink)" } : undefined}>
                  <span className="dish__course" title={d?.course}>{d ? COURSE_ICON[d.course] : "🍽️"}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="row">
                      <span className="dish__name">{d?.name ?? m.dishId}</span>
                      {m.active && q && <span className={`pill pill--${q}`}>{QUADRANT[q].label}</span>}
                      {!m.active && <span className="pill pill--off">Off today</span>}
                    </div>
                    <div className="dish__meta">
                      <span>cost <MoneyText pence={cost} /></span>
                      <span>suggested <MoneyText pence={d?.suggestedPrice ?? 0} /></span>
                      <span>sold 7d <b>{m.sold7d}</b></span>
                      {d && <span>skill {d.skillRequired}</span>}
                    </div>
                  </div>
                  <Stepper label={`price of ${d?.name ?? m.dishId}`} value={m.price} step={PRICE_STEP} bigStep={PRICE_BIG} min={PRICE_STEP} max={20000} onChange={(price) => send({ type: "SET_MENU_ITEM", dishId: m.dishId, price })}>
                    <MoneyText pence={m.price} />
                  </Stepper>
                  <div className="dish__margin">
                    <div className="xs faint"><Term id="margin" inline>margin</Term></div>
                    <b className={marginTone(f)}>{pct(f)}</b> <span className="xs muted">(<MoneyText pence={m.price - cost} />)</span>
                  </div>
                  <div className="row">
                    <button className="btn btn--ghost btn--sm" onClick={() => send({ type: "SET_MENU_ITEM", dishId: m.dishId, active: !m.active })} title={m.active ? "Keep the recipe but don't serve it" : "Serve it again"}>
                      {m.active ? "Rest" : "Serve"}
                    </button>
                    <button className="iconbtn" aria-label={`Remove ${d?.name ?? m.dishId}`} title="Remove from menu" onClick={() => send({ type: "REMOVE_MENU_ITEM", dishId: m.dishId })}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {library.length === 0 ? (
        <section className="library"><h3>Recipe book</h3><div className="empty">Every recipe is already on your menu.</div></section>
      ) : sections.map((sec) => (
        <section className="library" key={sec.id} aria-label={SECTION_TITLE[sec.id]}>
          <div className="row" style={{ marginBottom: 10 }}>
            <h3 className="spacer">{SECTION_TITLE[sec.id]}</h3>
            <span className="small muted">{sec.id === "library" ? "Prices start at the suggested price — tweak them after adding." : sec.id === "fast_food" ? "Quick, cheap, made for volume." : "Ambitious, seasonal, hard to cook well."}</span>
          </div>
          <div className="library__grid">
            {sec.dishes.map((d) => {
              const cost = plateCost(content, d.id);
              const f = marginFraction(d.suggestedPrice, cost);
              return (
                <div key={d.id} className="libdish">
                  <div className="libdish__top">
                    <span aria-hidden="true">{COURSE_ICON[d.course]}</span>
                    <b>{d.name}</b>
                    <button className="btn btn--green btn--sm" disabled={game.menu.length >= MAX_MENU_ITEMS} onClick={() => send({ type: "ADD_MENU_ITEM", dishId: d.id, price: d.suggestedPrice })} aria-label={`Add ${d.name}`}>Add</button>
                  </div>
                  <div className="dish__meta">
                    <span>cost <MoneyText pence={cost} /></span>
                    <span>sells <MoneyText pence={d.suggestedPrice} /></span>
                    <span className={marginTone(f)}><b>{pct(f)}</b> <Term id="margin" inline>margin</Term></span>
                    <span>skill {d.skillRequired}</span>
                  </div>
                  {d.blurb && <div className="xs muted">{d.blurb}</div>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
