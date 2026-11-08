/**
 * WasteSystem (evening) — three WRAP waste streams:
 *  - prep: trim taken from stock in proportion to portions used; better chefs trim less.
 *  - plate: food left by unhappy diners (already in food cost; reported only).
 *  - spoil: batches past shelf life are binned at the end of the day.
 * Also books today's food cost (ingredients consumed by the kitchen).
 */
import { PREP_WASTE_RATE, WRAP_SHARES } from "../constants";
import type { Rng } from "../rng";
import { spoil, takeStock } from "../stock";
import type { ContentPack, GameState, SimEvent, Stock } from "../types";
import { findIngredient, logEvent, onShift, tallyOf } from "../util";
import type { SystemResult } from "./system";
import { effectiveSkill } from "./system";

/** Prep trim rate: base × (content share ÷ WRAP share) × (1.5 − head chef skill/100). */
export function prepWasteRate(content: ContentPack, state: GameState): number {
  const chefs = onShift(state, "chef");
  const skill = chefs.length ? Math.max(...chefs.map((c) => effectiveSkill(content, c))) : 35;
  const share = content.balance.wasteShares.prep / WRAP_SHARES.prep;
  return Math.max(0, PREP_WASTE_RATE * share * (1.5 - skill / 100));
}

/** Pence value of portions at base unit cost. */
function valueOf(content: ContentPack, id: string, qty: number): number {
  return (findIngredient(content, id)?.unitCost ?? 0) * qty;
}

export function foodCostOf(content: ContentPack, used: Record<string, number>): number {
  let cost = 0;
  for (const [id, qty] of Object.entries(used)) cost += valueOf(content, id, qty);
  return Math.round(cost);
}

function trimPrep(content: ContentPack, state: GameState, used: Record<string, number>): { stock: Stock[]; cost: number } {
  const rate = prepWasteRate(content, state);
  let stock = state.stock;
  let cost = 0;
  for (const [id, qty] of Object.entries(used)) {
    const r = takeStock(stock, id, qty * rate, state.day);
    stock = r.stock;
    cost += valueOf(content, id, r.taken);
  }
  return { stock, cost: Math.round(cost) };
}

export function wasteSystem(content: ContentPack, state: GameState, _rng: Rng): SystemResult {
  const tally = tallyOf(state);
  const prep = trimPrep(content, state, tally.ingredientsUsed);
  // Spoil what will be past its shelf life by tomorrow morning.
  const spoiled = spoil(content, prep.stock, state.day + 1);
  let spoilCost = 0;
  for (const b of spoiled.binned) spoilCost += valueOf(content, b.id, b.qty);
  const plateScale = content.balance.wasteShares.plate / WRAP_SHARES.plate;
  const waste = { prep: prep.cost, plate: Math.round(tally.plateWaste * plateScale), spoil: Math.round(spoilCost) };
  const events: SimEvent[] = [];
  if (spoiled.binned.length) {
    const names = spoiled.binned.map((b) => findIngredient(content, b.id)?.name ?? b.id).join(", ");
    events.push(logEvent(state, `Binned out-of-date stock: ${names}.`, "bad"));
  }
  return {
    state: {
      ...state,
      stock: spoiled.stock,
      todays: { ...state.todays, waste, foodCost: foodCostOf(content, tally.ingredientsUsed) },
    },
    events,
  };
}
