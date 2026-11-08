/**
 * Tutorial hints: the next sensible action for this role, given what you're carrying and what the restaurant needs.
 * Pure; the renderer shows it as a banner plus an arrow to `stationId`.
 */
import type { GameState } from "@full-plate/sim-core";
import { dirtyTables, openDrinkTickets, openFoodTickets, payingParties, profile, readyGroups, tableNumberOf } from "./session";
import type { HandsOnSession, Hint } from "./types";

const KEY = "E";

export function nextHint(session: HandsOnSession, state: GameState): Hint | undefined {
  const s = session;
  if (s.shift?.over) return undefined;
  const a = s.activeAction;
  if (a) {
    switch (a.verb) {
      case "chop": return { text: `Tap ${KEY} as the slider crosses each knife mark`, stationId: a.stationId };
      case "cook": return { text: `Hold ${KEY} … let go when the needle is in the green`, stationId: a.stationId };
      case "pour": return { text: `Hold ${KEY} to pour … let go at the dashed line`, stationId: a.stationId };
      case "clear": return { text: `Tap ${KEY} to stack the plates`, stationId: a.stationId };
      default: return undefined;
    }
  }
  const c = s.carrying;
  const tableStation = (customerId: string) => {
    const cust = state.customers.find((x) => x.id === customerId);
    return cust?.tableId ? `table:${cust.tableId}` : undefined;
  };

  if (s.role === "chef") {
    if (c?.kind === "raw") return { text: `Chop the ${profile(s, c.dishId).short} on the prep board`, stationId: "prep" };
    if (c?.kind === "prepped") {
      const m = profile(s, c.dishId).method;
      if (m === "none") return { text: "Cold dish — take it straight to the pass and plate it", stationId: "pass" };
      const where = m === "stove" ? "on the hob" : m === "oven" ? "in the oven" : "in the fryer";
      return { text: `Cook it ${where}`, stationId: m };
    }
    if (c?.kind === "cooked") return { text: "Plate it at the pass — shout “Service!”", stationId: "pass" };
    const next = openFoodTickets(s, state)[0];
    if (next) {
      const tn = tableNumberOf(s, state, next.customerId);
      return { text: `Oldest ticket: ${profile(s, next.dishId).short}${tn ? ` for table ${tn}` : ""} — grab it from the fridge`, stationId: "fridge" };
    }
    return { text: "All caught up — wait for the next ticket on the rail" };
  }

  if (c?.kind === "plates") {
    const first = c.plates[0]!;
    const tn = tableNumberOf(s, state, first.customerId);
    return { text: `Take ${c.plates.length > 1 ? "them" : "it"} to table ${tn ?? "?"}`, stationId: tableStation(first.customerId) };
  }
  if (c?.kind === "dirty") return { text: "Drop the dirty plates at the wash-up", stationId: "dishReturn" };

  const paying = payingParties(s, state)[0];
  if (s.role === "bar") {
    if (paying) return { text: `Table ${tableNumberOf(s, state, paying.id) ?? ""} wants to pay — go to the till`, stationId: "till" };
    const drink = openDrinkTickets(s, state)[0];
    if (drink) return { text: `Pour a ${profile(s, drink.dishId).short} at the bar`, stationId: "bar" };
    const ready = readyGroups(s, state, "bar")[0];
    if (ready) return { text: `Carry the drinks to table ${tableNumberOf(s, state, ready.customerId) ?? "?"}`, stationId: "bar" };
    const dirty = dirtyTables(s, state)[0];
    if (dirty) return { text: `Table ${s.tableNumbers[dirty]} needs clearing`, stationId: `table:${dirty}` };
    return { text: "Quiet moment — keep an eye on the ticket rail" };
  }

  // server
  const food = readyGroups(s, state, "pass")[0];
  if (food) return { text: `Food up for table ${tableNumberOf(s, state, food.customerId) ?? "?"} — pick it up at the pass`, stationId: "pass" };
  if (paying) return { text: `Table ${tableNumberOf(s, state, paying.id) ?? ""} wants to pay — go to the till`, stationId: "till" };
  const drinks = readyGroups(s, state, "bar")[0];
  if (drinks) return { text: `Drinks ready at the bar for table ${tableNumberOf(s, state, drinks.customerId) ?? "?"}`, stationId: "bar" };
  const dirty = dirtyTables(s, state)[0];
  if (dirty) return { text: `Table ${s.tableNumbers[dirty]} needs clearing`, stationId: `table:${dirty}` };
  return { text: "Waiting on the kitchen — tickets on the rail show what's coming" };
}
