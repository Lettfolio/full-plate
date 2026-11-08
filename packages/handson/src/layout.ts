/**
 * The hands-on tilemap. Same arrangement as the game's RestaurantView (kitchen strip on top with the pass, dining
 * room below, front wall and door at the bottom) so the two cameras read as one restaurant — but on a walkable
 * grid. 30 × 15 tiles: fits 1024 × 600 at 34 px a tile with a ticket rail above.
 */
import type { ContentPack, DishDef, DishId, GameState, Table, TableId } from "@full-plate/sim-core";
import type { CookMethod, DishProfile, Prop, Station } from "./types";

export const WORLD_W = 30;
export const WORLD_H = 15;
/** Kitchen floor rows (the chef walks here). */
export const KITCHEN_ROWS = [2, 4] as const;
/** Row of the pass and the kitchen wall. */
export const PASS_ROW = 5;
/** Dining region where tables are laid out (inclusive tile bounds). */
export const DINING = { x0: 1, x1: 22, y0: 7, y1: 13 } as const;
export const FRONT_WALL_ROW = 14;
export const DOOR = { x: 11, w: 2 } as const;
/** Where a fresh session puts the player for each role. */
export const SPAWN = { chef: { x: 7.5, y: 3.5 }, server: { x: 11.5, y: 6.5 }, bar: { x: 26.5, y: 9.5 } } as const;
/** Most tables the floor can show; extra state tables are left to the AI (noted in HANDSON-NOTES). */
export const MAX_TABLES = 12;

export interface BuiltLayout {
  stations: Station[];
  props: Prop[];
  grid: string[];
  tableNumbers: Record<TableId, number>;
}

export function buildLayout(tables: readonly Table[]): BuiltLayout {
  const stations: Station[] = [
    { id: "fridge", kind: "fridge", x: 1, y: 1, w: 2, h: 1, label: "Fridge" },
    { id: "prep", kind: "prep", x: 4, y: 1, w: 3, h: 1, label: "Prep board" },
    { id: "stove", kind: "stove", x: 8, y: 1, w: 3, h: 1, label: "Hob" },
    { id: "oven", kind: "oven", x: 12, y: 1, w: 2, h: 1, label: "Oven" },
    { id: "fryer", kind: "fryer", x: 15, y: 1, w: 2, h: 1, label: "Fryer" },
    { id: "pass", kind: "pass", x: 5, y: PASS_ROW, w: 9, h: 1, label: "The pass" },
    { id: "dishReturn", kind: "dishReturn", x: 17, y: PASS_ROW, w: 2, h: 1, label: "Wash-up" },
    { id: "bar", kind: "bar", x: 24, y: 7, w: 1, h: 4, label: "Bar" },
    { id: "till", kind: "till", x: 24, y: 12, w: 1, h: 1, label: "Till" },
  ];
  const props: Prop[] = [
    { kind: "sink", x: 18, y: 1, w: 2, h: 1 },
    { kind: "shelves", x: 28, y: 7, w: 1, h: 5 },
    { kind: "plant", x: 1, y: 13, w: 1, h: 1 },
  ];

  // tables: an even grid over the dining region, 2×2 tiles each, with walkways between
  const shown = tables.slice(0, MAX_TABLES);
  const n = Math.max(1, shown.length);
  const regionW = DINING.x1 - DINING.x0 + 1; // 22
  const regionH = DINING.y1 - DINING.y0 + 1; // 7
  const rows = n <= 5 ? 1 : n <= 10 ? 2 : 3;
  const cols = Math.ceil(n / rows);
  const tableNumbers: Record<TableId, number> = {};
  tables.forEach((t, i) => { tableNumbers[t.id] = i + 1; });
  shown.forEach((t, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const cellW = regionW / inRow;
    const cellH = regionH / rows;
    const big = t.seats > 2 || rows < 3;
    const size = big ? 2 : 1;
    const x = Math.floor(DINING.x0 + cellW * (col + 0.5) - size / 2);
    const y = Math.floor(DINING.y0 + cellH * (row + 0.5) - size / 2);
    stations.push({ id: `table:${t.id}`, kind: "table", x, y, w: size, h: size, label: `Table ${i + 1}`, tableId: t.id, number: i + 1 });
  });

  const grid = buildGrid(stations, props);
  return { stations, props, grid, tableNumbers };
}

function buildGrid(stations: readonly Station[], props: readonly Prop[]): string[] {
  const g: string[][] = Array.from({ length: WORLD_H }, () => Array.from({ length: WORLD_W }, () => "."));
  const block = (x: number, y: number, w: number, h: number) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (g[yy] && g[yy]![xx] !== undefined) g[yy]![xx] = "#";
  };
  // outer walls
  block(0, 0, WORLD_W, 1);
  block(0, FRONT_WALL_ROW, WORLD_W, 1);
  block(0, 0, 1, WORLD_H);
  block(WORLD_W - 1, 0, 1, WORLD_H);
  // kitchen wall along the pass row, with a swing door at x 15-16
  block(1, PASS_ROW, 14, 1);
  block(17, PASS_ROW, 4, 1);
  // office (top right): staff-only, drawn but not walkable
  block(21, 1, 8, 5);
  for (const s of stations) block(s.x, s.y, s.w, s.h);
  for (const p of props) block(p.x, p.y, p.w, p.h);
  return g.map((r) => r.join(""));
}

export function isBlocked(grid: readonly string[], tx: number, ty: number): boolean {
  const row = grid[ty];
  if (!row) return true;
  return row[tx] !== ".";
}

// ───────────────────────── dishes ─────────────────────────
const FRY = /chips|fries|fish_and|onion_rings|katsu|fishcake|bites|gyoza|potato_skins|fish_fingers|halloumi_fries|scampi/;
const OVEN = /pizza|margherita|pie|roast|lamb|crumble|brownie|jacket|mac_and|lasagne|sticky_toffee|pasty|garlic_bread|duck|creme_brulee|bake/;
const COLD = /salad|eton|sundae|tiramisu|cheese_board|ploughman|prawn_cocktail|bread_and_butter|bruschetta|caesar/;

/** Which station a dish cooks on. Drinks pour at the bar; cold dishes go straight from the board to the pass. */
export function cookMethod(dishId: DishId, course?: DishDef["course"]): CookMethod {
  if (course === "drink") return "pour";
  if (COLD.test(dishId)) return "none";
  if (FRY.test(dishId)) return "fryer";
  if (OVEN.test(dishId)) return "oven";
  return "stove";
}

const titleCase = (id: string) => id.split(/[_-]/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");

const LEAD = /^(Roasted|Cheesy|Sticky|Loaded|Crispy|Wild|Seared|Slow-cooked|Pan-roasted|All-day|Little chef's|Tiny|Beer-battered|Chunky|Homemade|Pressed|Glass of|Pint of|Pot of|Sirloin|Spaghetti|British|Strawberry|Thai|Chocolate|Cornish-style|Jacket|Buttered)\s+/i;
const OVERRIDE: Record<string, string> = {
  "Prawn & veggie noodle stir-fry": "Stir-fry",
  "Knickerbocker glory": "Sundae",
  "Cola or lemonade": "Cola",
  "Sourdough & salted butter": "Bread & butter",
  "Mushroom & halloumi burger": "Veggie burger",
  "Tomato bruschetta": "Bruschetta",
  "Bacon & mushroom pizza": "Bacon pizza",
  "Wild mushroom risotto": "Risotto",
  "Seafood linguine": "Linguine",
  "Steak & ale pie": "Steak pie",
  "Jacket potato, cheese & beans": "Jacket potato",
  "Cheesy chips": "Cheesy chips",
  "Pan-roasted salmon, crushed potatoes": "Roast salmon",
  "Espresso martini": "Espresso tini",
  "Asparagus & hollandaise": "Asparagus",
  "Chicken tikka masala": "Tikka masala",
  "Chicken & leek gyoza": "Gyoza",
};

/** A ticket-slip name (≤ 14 characters) that still says what the dish is. */
export function shortName(name: string): string {
  if (OVERRIDE[name]) return OVERRIDE[name]!;
  let n = name.split(/,| with /)[0]!.trim();
  for (let i = 0; i < 2; i++) n = n.replace(LEAD, "");
  if (n.length > 14 && n.includes(" & ")) n = n.split(" & ")[0]!;
  if (n.length > 14) {
    let out = "";
    for (const w of n.split(" ")) { if ((out ? out.length + 1 : 0) + w.length > 14) break; out = out ? `${out} ${w}` : w; }
    n = out || n.slice(0, 13) + "…";
  }
  return n[0]!.toUpperCase() + n.slice(1);
}

/** Profiles for every dish the state can mention (menu + live tickets); content gives real names when passed. */
export function dishProfiles(state: GameState, content?: ContentPack): Record<DishId, DishProfile> {
  const ids = new Set<DishId>([...state.menu.map((m) => m.dishId), ...state.tickets.map((t) => t.dishId)]);
  if (content) for (const d of content.dishes) ids.add(d.id);
  const out: Record<DishId, DishProfile> = {};
  for (const id of [...ids].sort()) out[id] = profileFor(id, content);
  return out;
}

export function profileFor(id: DishId, content?: ContentPack): DishProfile {
  const def = content?.dishes.find((d) => d.id === id);
  const name = def?.name ?? titleCase(id);
  const course = def?.course ?? (DRINKISH.test(id) ? "drink" : undefined);
  let cost = 0;
  if (def && content) {
    const unit = new Map(content.ingredients.map((i) => [i.id, i.unitCost]));
    cost = Math.round(def.ingredients.reduce((sum, x) => sum + (unit.get(x.id) ?? 0) * x.qty, 0));
  }
  const method = cookMethod(id, course);
  return {
    name, short: shortName(name), method,
    cost: cost > 0 ? cost : method === "pour" ? 60 : 150,
    ceiling: def?.qualityCeiling ?? 80,
  };
}

const DRINKISH = /wine|lager|ale|gin|martini|prosecco|lemonade|soft_drink|juice|milkshake|flat_white|tea|coffee|hot_chocolate|cola|beer/;
