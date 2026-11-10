/**
 * applyStarsCommand — the Stars path's player decisions. Pure. Costs go through the ledger (`pendingCash`), so the
 * game pays them at the next applyStarsEffects; affordability is checked against `ctx.cash` minus what's already owed.
 */
import { formatPounds } from "@full-plate/sim-core";
import type { ContentPack, GameState } from "@full-plate/sim-core";
import {
  BACK_HEAD_CHEF_COST,
  EL_BULLI_WIN_GUIDES,
  PAY_RISE_COST,
  PAY_RISE_STAY_DAYS,
  PAY_RISE_STRESS,
  HAND_BACK_EXCLUDED_YEARS,
  HAND_BACK_STRESS,
  LOYALTY_DAYS,
  MAX_REFIT_DAYS,
  MAX_SATELLITES,
  RELAUNCH_CLOSED_DAYS,
  RELAUNCH_COST,
  RELAUNCH_DAYS,
  RELAUNCH_STRESS,
  RESEARCH_BASE_DAYS,
  RESEARCH_COST,
  SATELLITES,
  SATELLITE_STAR_DISCOUNT,
  SATELLITE_TRAINING_COST,
  SATELLITE_TRAINING_DAYS,
  SOURCING_SEASONAL_BASE,
  SOURCING_START_RELATIONSHIP,
  STAGIAIRE_MAX,
  SUPPLIERS,
  TEST_KITCHEN_COST,
  TICKETING_COST,
  GUIDE_MONTH,
} from "./constants";
import { nextMonthStart } from "./inspector";
import { clamp, r2 } from "./proxies";
import { Rng } from "./rng";
import { headChefLeaves, starBump } from "./step";
import type { Ending, StarsCommand, StarsEvent, StarsState, StarsStepResult } from "./types";

export interface CommandContext {
  day: number;
  /** The restaurant's cash right now (GameState.cash). */
  cash: number;
  /** Needed by BACK_HEAD_CHEF / LET_HEAD_CHEF_GO to pick the next head chef. */
  state?: GameState;
}

const reject = (stars: StarsState, reason: string): StarsStepResult => ({ stars, events: [{ type: "REJECTED", reason }] });

function spend(stars: StarsState, ctx: CommandContext, cost: number): StarsState | undefined {
  if (ctx.cash + stars.ledger.pendingCash < cost) return undefined;
  return { ...stars, ledger: { ...stars.ledger, pendingCash: stars.ledger.pendingCash - cost } };
}

const pounds = formatPounds;

/** Supplier catalogue limited to ingredients the content pack actually has. */
export function supplierCatalogue(content: ContentPack): { id: string; name: string; ingredientIds: string[] }[] {
  const have = new Set(content.ingredients.map((i) => i.id));
  return SUPPLIERS.map((s) => ({ ...s, ingredientIds: s.ingredientIds.filter((i) => have.has(i)) })).filter((s) => s.ingredientIds.length > 0);
}

export function satelliteCost(stars: StarsState, kind: "bar" | "bistro" | "ticketed"): number {
  return Math.round(SATELLITES[kind].cost * (1 - SATELLITE_STAR_DISCOUNT * stars.guides.michelin.stars));
}

export function researchDays(skillRequired: number): number {
  return RESEARCH_BASE_DAYS + Math.round(skillRequired / 4);
}

/** Round 11 (G11): a finite number (junk API arguments must never become NaN in the state). */
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function applyStarsCommand(content: ContentPack, stars: StarsState, cmd: StarsCommand, ctx: CommandContext): StarsStepResult {
  if (stars.ending) return reject(stars, "This story has ended.");
  if (typeof (cmd as { type?: unknown } | null | undefined)?.type !== "string") return reject(stars, "Unknown command.");
  const day = ctx.day;
  const log = (text: string, tone: "good" | "bad" | "info" | "money" = "info"): StarsEvent => ({ type: "LOG", day, text, tone });
  switch (cmd.type) {
    case "UNLOCK_TEST_KITCHEN": {
      if (stars.testKitchen.unlocked) return reject(stars, "The test kitchen is already open.");
      const s = spend(stars, ctx, TEST_KITCHEN_COST);
      if (!s) return reject(stars, `A test kitchen costs ${pounds(TEST_KITCHEN_COST)}.`);
      return { stars: { ...s, testKitchen: { ...s.testKitchen, unlocked: true } }, events: [log("The test kitchen is open. Time to find your voice.", "good")] };
    }
    case "RESEARCH_DISH": {
      const tk = stars.testKitchen;
      if (!tk.unlocked) return reject(stars, "Open a test kitchen first.");
      if (tk.inProgress) return reject(stars, "The test kitchen is already working on a dish.");
      const dish = content.dishes.find((d) => d.id === cmd.dishId);
      if (!dish || dish.course === "drink") return reject(stars, "That isn't a dish the kitchen can develop.");
      if (tk.researched.includes(dish.id)) return reject(stars, `${dish.name} is already a signature.`);
      const s = spend(stars, ctx, RESEARCH_COST);
      if (!s) return reject(stars, `Development costs ${pounds(RESEARCH_COST)}.`);
      const daysLeft = researchDays(dish.skillRequired);
      return { stars: { ...s, testKitchen: { ...tk, inProgress: { dishId: dish.id, daysLeft } } }, events: [log(`The test kitchen starts on ${dish.name} (${daysLeft} days).`)] };
    }
    case "OPEN_SATELLITE": {
      // Round 11 (G11): only the kinds you can open (a "backed" place is the head chef's, via BACK_HEAD_CHEF).
      if (cmd.kind !== "bar" && cmd.kind !== "bistro" && cmd.kind !== "ticketed") return reject(stars, "That isn't a kind of place you can open.");
      if (cmd.name !== undefined && typeof cmd.name !== "string") return reject(stars, "A name must be words.");
      if (stars.satellites.length >= MAX_SATELLITES) return reject(stars, `The group is already ${MAX_SATELLITES} satellites wide.`);
      const cost = satelliteCost(stars, cmd.kind);
      const s = spend(stars, ctx, cost);
      if (!s) return reject(stars, `Opening a ${SATELLITES[cmd.kind].label.toLowerCase()} costs ${pounds(cost)}.`);
      const sat = {
        id: `sat${s.nextId}`,
        kind: cmd.kind,
        name: cmd.name?.trim().slice(0, 40) || `${SATELLITES[cmd.kind].label} ${s.nextId}`,
        openedDay: day,
        headChefTrained: false,
        staffAbsorbed: SATELLITES[cmd.kind].staff,
        earned: 0,
      };
      return {
        stars: { ...s, nextId: s.nextId + 1, satellites: [...s.satellites, sat] },
        events: [{ type: "SATELLITE_OPENED", satellite: sat }, log(`${sat.name} opens. Until its own head chef is trained, the flagship will feel it.`, "money")],
      };
    }
    case "TRAIN_SATELLITE_CHEF": {
      const sat = stars.satellites.find((x) => x.id === cmd.satelliteId);
      if (!sat) return reject(stars, "No such satellite.");
      if (sat.headChefTrained || sat.trainingDaysLeft !== undefined) return reject(stars, "That kitchen already has (or is training) its own head chef.");
      const s = spend(stars, ctx, SATELLITE_TRAINING_COST);
      if (!s) return reject(stars, `Training a head chef costs ${pounds(SATELLITE_TRAINING_COST)}.`);
      return {
        stars: { ...s, satellites: s.satellites.map((x) => (x.id === sat.id ? { ...x, trainingDaysLeft: SATELLITE_TRAINING_DAYS } : x)) },
        events: [log(`A sous chef starts ${SATELLITE_TRAINING_DAYS} days of training to run ${sat.name}.`)],
      };
    }
    case "CLOSE_SATELLITE": {
      if (!stars.satellites.some((x) => x.id === cmd.satelliteId)) return reject(stars, "No such satellite.");
      return { stars: { ...stars, satellites: stars.satellites.filter((x) => x.id !== cmd.satelliteId) }, events: [log("A satellite closes. The group is smaller and the flagship steadier.")] };
    }
    case "UNLOCK_TICKETING": {
      if (stars.ticketing.unlocked) return reject(stars, "Ticketing is already set up.");
      const s = spend(stars, ctx, TICKETING_COST);
      if (!s) return reject(stars, `A ticketing system costs ${pounds(TICKETING_COST)}.`);
      return { stars: { ...s, ticketing: { unlocked: true, prepaid: true, dynamicPricing: false } }, events: [log("Prepaid tickets: fewer no-shows, and cash up front for the best produce.", "good")] };
    }
    case "SET_TICKETING": {
      if (!stars.ticketing.unlocked) return reject(stars, "Set up ticketing first.");
      return { stars: { ...stars, ticketing: { unlocked: true, prepaid: !!cmd.prepaid, dynamicPricing: !!cmd.dynamicPricing } }, events: [] };
    }
    case "SET_STAGIAIRE_POLICY": {
      if (!finite(cmd.count)) return reject(stars, "How many stagiaires?");
      const count = clamp(Math.round(cmd.count), 0, STAGIAIRE_MAX);
      const prev = stars.stagiaires;
      const startsUnpaid = !cmd.paid && (prev.paid || prev.count === 0);
      return {
        stars: { ...stars, stagiaires: { paid: !!cmd.paid, count, scandals: prev.scandals, sinceDay: startsUnpaid ? day : prev.sinceDay } },
        events: [log(count === 0 ? "No stagiaires this season." : `${count} ${cmd.paid ? "paid" : "unpaid"} stagiaire${count > 1 ? "s" : ""} join the brigade.`)],
      };
    }
    case "SIGN_SOURCING": {
      const sup = supplierCatalogue(content).find((x) => x.id === cmd.supplierId);
      if (!sup) return reject(stars, "Unknown supplier.");
      if (stars.sourcing.some((x) => x.supplierId === sup.id)) return reject(stars, `You already buy from ${sup.name}.`);
      const rel = {
        supplierId: sup.id,
        name: sup.name,
        ingredientIds: sup.ingredientIds,
        relationship: SOURCING_START_RELATIONSHIP,
        seasonalBonus: r2(SOURCING_SEASONAL_BASE),
        signedDay: day,
      };
      return { stars: { ...stars, sourcing: [...stars.sourcing, rel] }, events: [log(`You start buying from ${sup.name}. Trust takes years.`)] };
    }
    case "DROP_SOURCING":
      if (!stars.sourcing.some((x) => x.supplierId === cmd.supplierId)) return reject(stars, "You don't buy from them.");
      return { stars: { ...stars, sourcing: stars.sourcing.filter((x) => x.supplierId !== cmd.supplierId) }, events: [] };
    case "BACK_HEAD_CHEF": {
      if (!stars.headChef.wantsOwnPlace) return reject(stars, "Your head chef isn't looking to leave.");
      // Round 11 (G11): their place counts as one of the group's satellites.
      if (stars.satellites.length >= MAX_SATELLITES) return reject(stars, `The group is already ${MAX_SATELLITES} places wide: close one first, or let them go.`);
      const s = spend(stars, ctx, BACK_HEAD_CHEF_COST);
      if (!s) return reject(stars, `Backing them costs ${pounds(BACK_HEAD_CHEF_COST)}.`);
      const rng = new Rng(s.rngState);
      const left = headChefLeaves(s, day, ctx.state, true, rng);
      const sat = { id: `sat${left.stars.nextId}`, kind: "backed" as const, name: "The alumni's place", openedDay: day, headChefTrained: true, staffAbsorbed: 0, earned: 0 };
      return {
        stars: { ...left.stars, rngState: rng.getState(), nextId: left.stars.nextId + 1, satellites: [...left.stars.satellites, sat], loyaltyUntil: day + LOYALTY_DAYS },
        events: [...left.events, { type: "SATELLITE_OPENED", satellite: sat }, log("You back your head chef's own restaurant. They leave as friends.", "good")],
      };
    }
    case "PAY_HEAD_CHEF_TO_STAY": {
      if (!stars.headChef.wantsOwnPlace) return reject(stars, "Your head chef isn't looking to leave.");
      const s = spend(stars, ctx, PAY_RISE_COST);
      if (!s) return reject(stars, `A pay rise and a share of the restaurant costs ${pounds(PAY_RISE_COST)}.`);
      const { decisionDeadline: _d, ...hc } = s.headChef;
      return {
        stars: { ...s, headChef: { ...hc, wantsOwnPlace: false, staysUntil: day + PAY_RISE_STAY_DAYS, stress: r2(clamp(hc.stress + PAY_RISE_STRESS, 0, 100)) } },
        events: [log("A pay rise and a share of the restaurant: your head chef stays, and the kitchen breathes out.", "good")],
      };
    }
    case "LET_HEAD_CHEF_GO": {
      if (!stars.headChef.wantsOwnPlace) return reject(stars, "Your head chef isn't looking to leave.");
      const rng = new Rng(stars.rngState);
      const left = headChefLeaves(stars, day, ctx.state, false, rng);
      return { stars: { ...left.stars, rngState: rng.getState() }, events: [...left.events, log(`Your head chef leaves to open ${left.stars.rival?.name ?? "a rival"}.`, "bad")] };
    }
    case "CLOSE_FOR_REFIT": {
      if (!finite(cmd.days)) return reject(stars, "How many days?");
      const days = clamp(Math.round(cmd.days), 1, MAX_REFIT_DAYS);
      const until = Math.max(stars.refitUntil ?? 0, day + days);
      return {
        stars: { ...stars, refitUntil: until },
        events: [{ type: "REFIT_STARTED", day, until }, log(`Closed for a refit until day ${until}. Remember: no service, no assessment.`, "bad")],
      };
    }
    case "HAND_BACK_STARS": {
      const m = stars.guides.michelin;
      if (m.stars === 0) return reject(stars, "You have no stars to hand back.");
      let until = m.nextGuideDay;
      for (let i = 1; i < HAND_BACK_EXCLUDED_YEARS; i++) until = nextMonthStart(until + 1, GUIDE_MONTH);
      const s: StarsState = {
        ...stars,
        afterglow: { mult: starBump(stars, day), day },
        headChef: { ...stars.headChef, stress: r2(clamp(stars.headChef.stress + HAND_BACK_STRESS, 0, 100)) },
        guides: { ...stars.guides, michelin: { ...m, stars: 0, threeStarStreak: 0, excludedUntil: until + 1 } },
      };
      const events: StarsEvent[] = [log("You hand back your stars. The pressure lifts; the cooking is yours again.", "info")];
      if (cmd.retire) {
        const ending: Ending = { kind: "handed_back", day, win: false, text: "You handed back your stars and walked away on your own terms." };
        events.push({ type: "ENDING", ending });
        return { stars: { ...s, ending }, events };
      }
      return { stars: s, events };
    }
    case "RELAUNCH_CONCEPT": {
      if ((stars.relaunchUntil ?? -1) > day) return reject(stars, "You relaunched recently. Let the new concept settle.");
      const s = spend(stars, ctx, RELAUNCH_COST);
      if (!s) return reject(stars, `A relaunch costs ${pounds(RELAUNCH_COST)}.`);
      const until = day + RELAUNCH_CLOSED_DAYS;
      return {
        stars: {
          ...s,
          refitUntil: Math.max(s.refitUntil ?? 0, until),
          relaunchUntil: until + RELAUNCH_DAYS,
          consistencyWindow: [],
          consistencyDays: [],
          headChef: { ...s.headChef, stress: r2(clamp(s.headChef.stress + RELAUNCH_STRESS, 0, 100)) },
        },
        events: [{ type: "REFIT_STARTED", day, until }, log("A new concept. Closed for a month, then a fresh story for the inspectors.", "good")],
      };
    }
    case "CLOSE_AT_PEAK": {
      const m = stars.guides.michelin;
      if (m.stars < 2 || m.stars < stars.peakStars) return reject(stars, "Closing at the peak needs at least two stars — and to be at your best.");
      // Round 11 (G4): a win only at the very top (three stars held on EL_BULLI_WIN_GUIDES guides running); earlier it
      // is an honourable ending — the story ends well, but it isn't the dynasty-sized win.
      const win = m.stars === 3 && m.threeStarStreak >= EL_BULLI_WIN_GUIDES;
      const ending: Ending = {
        kind: "el_bulli",
        day,
        win,
        text: win
          ? `You closed with three stars at the height of your fame and became a foundation. Stopping can be winning.`
          : `You closed with ${m.stars} stars while people still queued at the door. A proud ending — the very top was still ahead.`,
      };
      return { stars: { ...stars, ending }, events: [{ type: "ENDING", ending }] };
    }
    default:
      return reject(stars, "Unknown command.");
  }
}

