import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { lazyRetry } from "../../lib/lazyRetry";
import { dishIcon } from "../../lib/dishIcon"; // R14-E (U20)
import { Icon } from "../../components/Icon";
import type { Command, DishCourse, DishId, GameState, MenuItem } from "@full-plate/sim-core";
import { classifyMenu, content, MAX_MENU_ITEMS } from "../../sim";
import { suggestedStarterMenu } from "../../lib/starterMenu";
import { MoneyText } from "../../components/MoneyText";
import { Stepper } from "../../components/Stepper";
import { marginFraction, plateCost } from "../../lib/content";
import { pct } from "../../lib/format";
import { judged, QUADRANT, QUADRANT_MIN_DAYS } from "./quadrants";
// Round 7: the matrix is the expert view, loaded the first time it is opened.
const MenuMatrixPanel = lazyRetry(() => import("./MenuMatrixPanel"));
// Round 12 (F): "Invent a dish" and the cookbook of invented dishes (its own chunk; the sheet is another).
const CookbookStrip = lazyRetry(() => import("./CookbookStrip"));
import { recipeBook, sectionOf, type LibrarySection, type PathKind } from "../../lib/library";
import { Term } from "../../components/Term";
import { useDrinksView } from "../../lib/settings";
import type { CustomDish } from "../../lib/customDish";
import type { CookbookOp } from "@full-plate/content";
import type { PathMeta } from "../../state/paths";
import { prefsStorage } from "../../lib/storage";

export type MenuView = "list" | "matrix";
const VIEW_KEY = "full-plate:menuView:v1";
/** The last view she picked (a per-browser convenience; the list when storage is missing or blocked). */
export function readMenuView(): MenuView {
  try { return prefsStorage().getItem(VIEW_KEY) === "matrix" ? "matrix" : "list"; } catch { return "list"; }
}
function writeMenuView(v: MenuView): void {
  try { prefsStorage().setItem(VIEW_KEY, v); } catch { /* private window: keep it for this visit only */ }
}

/** ✕ asks once before a dish leaves the menu (there is no undo). */
function RemoveDish({ name, onRemove }: { name: string; onRemove: () => void }) {
  const [sure, setSure] = useState(false);
  const asked = useRef(false);
  const cross = useRef<HTMLButtonElement>(null);
  // Keep → focus goes back to the ✕ it came from, not to the top of the page.
  useEffect(() => { if (!sure && asked.current) cross.current?.focus(); asked.current = sure; }, [sure]);
  if (!sure) return <button ref={cross} className="iconbtn dish__remove" aria-label={`Remove ${name}`} title="Remove from menu" onClick={() => setSure(true)}><Icon name="close" size={20} /></button>;
  return (
    <span className="dish__confirm" role="group" aria-label={`Remove ${name}?`}>
      <button className="btn btn--sm btn--primary" onClick={onRemove}>Remove</button>
      {/* R7 review (seam d): the safe answer has focus, as in the shell's ConfirmDialog — Enter twice never removes. */}
      <button className="btn btn--sm btn--ghost" onClick={() => setSure(false)} autoFocus>Keep</button>
    </span>
  );
}

interface Props {
  game: GameState;
  send: (cmd: Command) => void;
  /** The path chosen at the fork: unlocks the fast-food (Empire) or fine-dining (Stars) recipes. */
  path?: PathKind | undefined;
  /** Round 12 (F): the game's invented dishes (meta.customDishes) and the invent action. */
  meta?: PathMeta | undefined;
  onInvent?: ((dish: CustomDish) => void) | undefined;
  /** Round 13 (D): edit / rest / delete / move a recipe. */
  onCookbook?: ((op: CookbookOp) => void) | undefined;
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

export function MenuTab({ game, send, path, meta, onInvent, onCookbook }: Props) {
  const custom = (meta && meta.customDishes) || [];
  const [hover, setHover] = useState<DishId | null>(null);
  const [view, setViewState] = useState<MenuView>(readMenuView);
  const setView = (v: MenuView) => { setViewState(v); writeMenuView(v); };
  const quadrants = useMemo(() => classifyMenu(content, game), [game]);
  const drinks = useDrinksView(); // Round 11b: names follow "Hide alcoholic drinks" at once
  const names = useMemo(() => Object.fromEntries(content.dishes.map((d) => [d.id, d.name])), [drinks, custom]);
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
      <div className="menuview" role="group" aria-label="How to show the menu">
        <button className="menuview__btn" aria-pressed={view === "list"} onClick={() => setView("list")}><Icon name="menu" size={20} />Today's menu</button>
        <button className="menuview__btn" aria-pressed={view === "matrix"} onClick={() => setView("matrix")}><Icon name="chart" size={20} />Menu matrix <span className="menuview__note">for experts</span></button>
      </div>
      <div className={view === "matrix" ? "menu-layout" : "menu-layout menu-layout--list"}>
        {view === "matrix" && (
          <Suspense fallback={<div className="empty small muted">Loading the matrix…</div>}>
            <MenuMatrixPanel items={active} quadrants={quadrants} names={names} highlight={hover} onHover={setHover} />
          </Suspense>
        )}

        <div className="stack stack--sm">
          <div className="row">
            <h3 className="spacer">{view === "list" ? "Today's menu" : "On the menu"}</h3>
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
              const q = judged(m) ? quadrants[m.dishId] : undefined;
              return (
                <div key={m.dishId} className={`dish ${m.active ? "" : "dish--off"}`} onMouseEnter={() => setHover(m.dishId)} onMouseLeave={() => setHover(null)} style={hover === m.dishId ? { borderColor: "var(--ink)" } : undefined}>
                  <span className="dish__course" title={d?.course}>{(custom.find((c) => c.id === m.dishId) || { icon: d ? dishIcon(d.name, d.course) : "🍽️" }).icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="row">
                      <span className="dish__name">{d?.name ?? m.dishId}</span>
                      {m.active && q && <span className={`pill pill--${q}`}>{QUADRANT[q].label}</span>}
                      {!m.active && <span className="pill pill--off">Off today</span>}
                    </div>
                    {/* Round 11 (U5): the advice as words under the name; nothing until a week of sales. */}
                    {m.active && (q ? <div className="dish__hint" data-testid="dish-hint">{QUADRANT[q].short}</div>
                      : <div className="dish__hint" data-testid="dish-hint">New: judged after {QUADRANT_MIN_DAYS} days of sales</div>)}
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
                    <RemoveDish name={d?.name ?? m.dishId} onRemove={() => send({ type: "REMOVE_MENU_ITEM", dishId: m.dishId })} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {onInvent && <Suspense fallback={null}><CookbookStrip meta={meta} game={game} send={send} onInvent={onInvent} onCookbook={onCookbook} /></Suspense>}

      {library.length === 0 ? (
        <section className="library"><h3>Recipe book</h3><div className="empty">Every recipe is already on your menu.</div></section>
      ) : sections.map((sec) => (
        <section className="library" key={sec.id} aria-label={SECTION_TITLE[sec.id]}>
          <div className="row" style={{ marginBottom: 10 }}>
            <h3 className="spacer">{SECTION_TITLE[sec.id]}</h3>
            <span className="small muted">{sec.id === "library" ? "Recipes that come with the game. Prices start at the suggested price — tweak them after adding." : sec.id === "fast_food" ? "Quick, cheap, made for volume." : "Ambitious, seasonal, hard to cook well."}</span>
          </div>
          <div className="library__grid">
            {sec.dishes.map((d) => {
              const cost = plateCost(content, d.id);
              const f = marginFraction(d.suggestedPrice, cost);
              return (
                <div key={d.id} className="libdish">
                  <div className="libdish__top">
                    <span aria-hidden="true">{dishIcon(d.name, d.course)}</span>
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
