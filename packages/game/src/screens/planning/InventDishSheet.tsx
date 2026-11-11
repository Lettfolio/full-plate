/**
 * Round 12 (F): the "Invent a dish" sheet (lazy, from the Menu tab). Name it, pick a course and a plate, choose 2–5
 * real ingredients with quantities, set a price — and see, as you go, what the kitchen and the street will make of it:
 * the real ingredient cost, the suggested price at the usual margin, the skill and prep time it needs, the cuisine it
 * reads as, and an honest guess at how it will sell here, with the one reason that matters most.
 *
 * All the numbers come from the content transform (`customDishFacts`, packages/content/src/customDish.ts) — the same
 * function that makes the DishDef the sim cooks, so the sheet can't promise something the kitchen won't do.
 *
 * Round 13 (D): the same sheet edits a recipe (`editing`): name, plate, price and ingredients, the course fixed. New
 * ingredients make a new version (the cookbook keeps the old one's sales as "v1"); the reducer's `cookbook` edit does it.
 */
import { useMemo, useState } from "react";
import type { GameState } from "@full-plate/sim-core";
import {
  cleanDishName, CUSTOM_COURSES, CUSTOM_ICONS, CUSTOM_MAX_INGREDIENTS, CUSTOM_MIN_INGREDIENTS, CUSTOM_NAME_MAX, CUSTOM_QTY_MAX,
  CUSTOM_QTY_MIN, CUSTOM_QTY_STEP, customDishFacts, guessPopularity, makeCustomDish, pickableIngredients, type CustomCourse, type PopularityGuess,
} from "@full-plate/content";
import { customRef, MAX_MENU_ITEMS, MINUTES_PER_TICK } from "../../sim";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { MoneyText } from "../../components/MoneyText";
import { Stepper } from "../../components/Stepper";
import { Term } from "../../components/Term";
import { formatPence, pct } from "../../lib/format";
import type { CustomDish } from "../../lib/customDish";
import "./invent.css";

const COURSE_LABEL: Record<CustomCourse, string> = { starter: "Starter", main: "Main", dessert: "Dessert", drink: "Drink" };
const ICON_NAME: Record<string, string> = {
  "🍲": "stew pot", "🥘": "paella pan", "🍝": "pasta", "🍛": "curry", "🍜": "noodle bowl", "🥗": "salad", "🥪": "sandwich", "🌮": "taco",
  "🍔": "burger", "🥩": "steak", "🍤": "prawn", "🍣": "sushi", "🥧": "pie", "🍰": "cake", "🧁": "cupcake", "🍮": "pudding",
  "🍨": "ice cream", "🍹": "cocktail glass", "🥤": "cup with straw", "☕": "hot drink",
};
const DEFAULT_ICON: Record<CustomCourse, string> = { starter: "🥗", main: "🍲", dessert: "🍰", drink: "🥤" };
const BAND_WORDS: Record<PopularityGuess["band"], string> = {
  favourite: "Likely a favourite", steady: "Should sell steadily", slow: "A slow seller", hard: "A hard sell",
};
const CUISINE_WORD: Record<string, string> = { british: "British", italian: "Italian", american: "American", asian: "Asian", french: "French", cafe: "café" };
const PRICE_STEP = 25;

interface Props {
  game: GameState;
  /** The recipes already in the cookbook (names must differ). */
  have: readonly CustomDish[];
  /** The new recipe, and its menu price (null when the menu is full: it only goes in the cookbook). */
  onInvent: (dish: CustomDish, price: number | null) => void;
  onClose: () => void;
  /** Round 13 (D): edit this recipe instead of inventing one. */
  editing?: CustomDish | undefined;
  /** Its price now (today's menu, else the house price). */
  editPrice?: number | undefined;
  onEdit?: (change: { name: string; icon: string; price: number; ingredients: { id: string; qty: number }[] }) => void;
}

/** "rice, mushrooms and parmesan" etc. are the ingredient names without their pack-size notes. */
const shortName = (n: string) => n.replace(/\s*\(.*\)$/, "");

export default function InventDishSheet({ game, have, onInvent, onClose, editing, editPrice, onEdit }: Props) {
  const ed = editing;
  const [error, setError] = useState("");
  const [name, setName] = useState(ed?.name ?? "");
  const [course, setCourse] = useState<CustomCourse>(ed?.course ?? "main");
  const [icon, setIcon] = useState<string>(ed?.icon ?? DEFAULT_ICON.main);
  const [iconPicked, setIconPicked] = useState(!!ed);
  const [ings, setIngs] = useState<{ id: string; qty: number }[]>(ed ? ed.ingredients.map((x) => ({ ...x })) : []);
  const [pick, setPick] = useState("");
  const [price, setPrice] = useState<number | null>(ed ? editPrice ?? ed.price ?? null : null);
  const newVersion = !!ed && (ings.length !== ed.ingredients.length || ings.some((x, i) => x.id !== ed.ingredients[i]!.id || x.qty !== ed.ingredients[i]!.qty));
  const list = pickableIngredients(customRef);
  const byId = useMemo(() => new Map(list.map((i) => [i.id, i])), [list]);
  const clean = cleanDishName(name);
  const ready = ings.length >= CUSTOM_MIN_INGREDIENTS;

  const facts = useMemo(() => (ready ? customDishFacts({ id: "custom:preview", name: clean || "New dish", course, icon, ingredients: ings, createdDay: game.day }, customRef) : null), [ready, clean, course, icon, ings, game.day]);
  const guess = useMemo(() => (facts ? guessPopularity(facts.dish, customRef, game.districtId) : null), [facts, game.districtId]);
  const suggested = facts?.dish.suggestedPrice ?? 0;
  const myPrice = price ?? suggested;
  const cost = Math.round(facts?.cost ?? ings.reduce((a, x) => a + (byId.get(x.id)?.unitCost ?? 0) * x.qty, 0));
  const bestChef = Math.max(0, ...game.staff.filter((s) => s.role === "chef").map((s) => s.skill));
  const menuFull = game.menu.length >= MAX_MENU_ITEMS;

  const setCourseAndIcon = (c: CustomCourse) => { setCourse(c); if (!iconPicked) setIcon(DEFAULT_ICON[c]); setPrice(null); };
  const addIngredient = () => {
    if (!pick || ings.length >= CUSTOM_MAX_INGREDIENTS || ings.some((x) => x.id === pick)) return;
    setIngs([...ings, { id: pick, qty: 1 }]);
    setPick("");
    setPrice(null);
  };
  const setQty = (id: string, qty: number) => { setIngs(ings.map((x) => (x.id === id ? { ...x, qty } : x))); setPrice(null); };
  const remove = (id: string) => { setIngs(ings.filter((x) => x.id !== id)); setPrice(null); };

  const why = !clean ? "Give it a name." : !ready ? `Pick at least ${CUSTOM_MIN_INGREDIENTS} ingredients.` : "";
  const submit = () => {
    if (why) return;
    if (ed) {
      if (have.some((d) => d.id !== ed.id && !d.deleted && !d.oldOf && d.name.toLowerCase() === clean.toLowerCase())) { setError(`You already have a dish called ${clean}.`); return; }
      onEdit?.({ name: clean, icon, price: Math.max(50, myPrice), ingredients: ings });
      return;
    }
    const made = makeCustomDish(have, game.seed, game.day, { name: clean, course, icon, ingredients: ings }, customRef);
    if ("error" in made) { setError(made.error); return; }
    onInvent(made.dish, menuFull ? null : myPrice);
  };

  return (
    <Dialog title={ed ? "Edit recipe" : "Invent a dish"} kicker={ed ? `${ed.name}${ed.v ? ` · version ${ed.v}` : ""}` : "Your recipe, your price"} stamp={<Icon name="chefHat" size={28} />} onClose={onClose} wide className="invent">
      <div className="invent__grid">
        <div className="stack stack--sm">
          <label className="invent__field">
            <span className="invent__label">Name</span>
            <input className="invent__name" value={name} maxLength={CUSTOM_NAME_MAX * 2} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="e.g. Midnight mushroom risotto" data-autofocus aria-describedby="invent-namecount" />
            <span id="invent-namecount" className="xs muted">{[...clean].length}/{CUSTOM_NAME_MAX}</span>
          </label>

          <div className="invent__field" role="group" aria-label="Course">
            <span className="invent__label" aria-hidden="true">Course</span>
            <div className="seg invent__seg">
              {CUSTOM_COURSES.map((c) => <button key={c} type="button" className="seg__opt" aria-pressed={course === c} disabled={!!ed && c !== course} onClick={() => setCourseAndIcon(c)}>{COURSE_LABEL[c]}</button>)}
            </div>
          </div>

          <div className="invent__field" role="group" aria-label="Plate">
            <span className="invent__label" aria-hidden="true">Plate</span>
            <div className="invent__icons">
              {CUSTOM_ICONS.map((ic) => (
                <button key={ic} type="button" className="invent__icon" aria-pressed={icon === ic} aria-label={ICON_NAME[ic] ?? ic} title={ICON_NAME[ic]} onClick={() => { setIcon(ic); setIconPicked(true); }}>
                  <span aria-hidden="true">{ic}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="invent__field">
            <span className="invent__label">Ingredients <span className="xs muted">({CUSTOM_MIN_INGREDIENTS}–{CUSTOM_MAX_INGREDIENTS}, per plate)</span></span>
            {ings.length === 0 && <div className="small muted">Nothing yet. Pick from the list below; the prices are what your supplier charges.</div>}
            <ul className="invent__ings">
              {ings.map((x) => {
                const ing = byId.get(x.id);
                const nm = shortName(ing?.name ?? x.id);
                return (
                  <li key={x.id} className="invent__ing">
                    <span className="invent__ingname"><b>{nm}</b><span className="xs muted"><MoneyText pence={ing?.unitCost ?? 0} /> each · <MoneyText pence={Math.round((ing?.unitCost ?? 0) * x.qty)} /> a plate</span></span>
                    <Stepper label={`amount of ${nm}`} value={x.qty} step={CUSTOM_QTY_STEP} min={CUSTOM_QTY_MIN} max={CUSTOM_QTY_MAX} onChange={(q) => setQty(x.id, q)}>× {x.qty}</Stepper>
                    <button type="button" className="iconbtn iconbtn--tap" aria-label={`Take out ${nm}`} onClick={() => remove(x.id)}><Icon name="close" size={20} /></button>
                  </li>
                );
              })}
            </ul>
            {ings.length < CUSTOM_MAX_INGREDIENTS && (
              <div className="row invent__add">
                <select className="invent__select" aria-label="Ingredient to add" value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">Choose an ingredient…</option>
                  {[...list].sort((a, b) => a.name.localeCompare(b.name)).filter((i) => !ings.some((x) => x.id === i.id)).map((i) => (
                    <option key={i.id} value={i.id}>{shortName(i.name)} · {formatPence(i.unitCost)}</option>
                  ))}
                </select>
                <button type="button" className="btn" disabled={!pick} onClick={addIngredient}><Icon name="plus" size={18} />Add</button>
              </div>
            )}
          </div>
        </div>

        <div className="invent__facts" aria-live="polite">
          <div className="invent__preview">
            <span className="invent__plate" aria-hidden="true">{icon}</span>
            <div><b>{clean || "Your dish"}</b><div className="xs muted">{COURSE_LABEL[course]}{facts ? ` · reads as ${CUISINE_WORD[facts.cuisine] ?? facts.cuisine}${facts.vegetarian ? " · vegetarian" : ""}` : ""}</div></div>
          </div>
          <dl className="invent__dl">
            <div><dt>Ingredients cost</dt><dd><MoneyText pence={cost} /></dd></div>
            <div><dt>Suggested price</dt><dd>{facts ? <MoneyText pence={suggested} /> : "—"}</dd></div>
            <div><dt>Skill needed</dt><dd>{facts ? <>{facts.dish.skillRequired}<span className="xs muted"> · {bestChef ? `best chef ${bestChef}` : "no chef yet"}</span></> : "—"}</dd></div>
            <div><dt>Prep time</dt><dd>{facts ? `${facts.dish.prepTicks * MINUTES_PER_TICK} min` : "—"}</dd></div>
          </dl>
          {facts && bestChef > 0 && facts.dish.skillRequired > bestChef && <div className="invent__note invent__note--warn">Harder than your best chef can manage: expect a few plates to come back wrong.</div>}
          {facts && guess && (
            <div className={`invent__guess invent__guess--${guess.band}`}>
              <b>{BAND_WORDS[guess.band]}</b>
              <div className="small">{guessReason(facts, guess, course, game)}</div>
            </div>
          )}
          {facts && (
            <div className="invent__price">
              <span className="invent__label">Your price</span>
              <Stepper label={`price of ${clean || "your dish"}`} value={myPrice} step={PRICE_STEP} bigStep={100} min={PRICE_STEP} max={20000} onChange={setPrice}><MoneyText pence={myPrice} /></Stepper>
              <span className="small"><Term id="margin" inline>margin</Term> <b>{pct(myPrice > 0 ? (myPrice - cost) / myPrice : 0)}</b>{myPrice > suggested * 1.15 ? <span className="xs muted"> · guests will notice it's over the going rate</span> : null}</span>
            </div>
          )}
        </div>
      </div>
      <div className="invent__foot">
        <span className={`small spacer ${error ? "invent__error" : "muted"}`} role={error ? "alert" : undefined} data-testid="invent-foot">{error || why || (ed
          ? (newVersion ? `New ingredients make version ${(ed.v ?? 1) + 1}. The old recipe keeps its ${ed.sold} sold as v${ed.v ?? 1}.` : "Name, plate and price change straight away. Change an ingredient and it becomes a new version.")
          : menuFull ? `The menu is full (${MAX_MENU_ITEMS}): it goes in your cookbook for later.` : "It goes on today's menu and into your cookbook.")}</span>
        <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--green" disabled={!!why} onClick={submit}>{ed ? (newVersion ? `Save as v${(ed.v ?? 1) + 1}` : "Save recipe") : menuFull ? "Save to cookbook" : "Put it on the menu"}</button>
      </div>
    </Dialog>
  );
}

/** The one reason that matters most for how it will sell (price, portion, then who likes it). */
function guessReason(facts: ReturnType<typeof customDishFacts>, guess: PopularityGuess, course: CustomCourse, game: GameState): string {
  const c = COURSE_LABEL[course].toLowerCase();
  if (facts.priceBand > 1.6) return `At ${formatPence(facts.dish.suggestedPrice)} it's dear for a ${c}: hardly anyone will order it, and a menu that pricey keeps people walking past.`;
  if (facts.portion < 0.85) return `It's a small plate for a ${c}. A bit more in it and people will take it seriously.`;
  const district = customRef.districts.find((d) => d.id === game.districtId);
  let top = "", topScore = -1;
  for (const [seg, share] of Object.entries(district?.segmentMix ?? {})) {
    const v = share * (facts.dish.baseAppeal[seg] ?? 0);
    if (v > topScore) { topScore = v; top = seg; }
  }
  const who = (customRef.segments.find((s) => s.id === top)?.name ?? "regulars").toLowerCase();
  const kind = `${CUISINE_WORD[facts.cuisine] ?? facts.cuisine} ${c}`;
  if (facts.capped.length) return `About as good as a ${c} gets with ${who} round here — even a great idea can't beat the best dishes on the book.`;
  if (guess.band === "favourite") return `A ${kind} is just what ${who} round here go for.`;
  if (guess.band === "steady") return `Middle of the pack for a ${c} here; ${who} are the most likely to order it.`;
  return `${who.charAt(0).toUpperCase() + who.slice(1)} might try it, but most guests on this street pick other ${c}s.`;
}
