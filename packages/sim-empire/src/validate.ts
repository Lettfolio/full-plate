/**
 * Round 11: the EmpireState schema for loaded saves (red-team S3). Applied by the game to `deserialize`'s result
 * (after migrations) wherever a save comes in; see sim-core/validate.ts for the rules. Throws a SchemaError.
 */
import {
  anyJson, arr, BIG, bool, day, id, int, money, name, num, obj, oneOf, opt, pct100, rec, rngState, text,
} from "@full-plate/sim-core/schema";
import { BOARD_MINUTES_MAX, EVENT_LOG_MAX, MONTHLY_HISTORY_MAX } from "./constants";
import type { EmpireState } from "./types";

const n = num();
const share = num(-10, 10);
const many = 5000;
const income = obj({ shops: money, royalties: money, rent: money, fees: money, supply: money, costs: money });
const decisionKind = oneOf("royalty", "localise", "buyPlot", "refurbish", "feeHoliday", "driveThru", "supplyMarkup", "campaign");

const site = obj({
  id, name: name(80), cityId: id, districtId: id, opened: day,
  status: oneOf("building", "open", "closed"),
  ownership: oneOf("company", "franchise", "licence"),
  franchisee: opt(id),
  land: oneOf("thirdParty", "hqLease", "hqOwned"),
  contract: opt(obj({ royaltyPct: share, adFundPct: share, rentPctOfSales: share, signedDay: day, termDays: day, remodelEveryDays: day })),
  brandConsistency: pct100, staffQuality: pct100,
  covers7d: n, revenue7d: money, margin7d: money, revenueYear: money, rent: money, rentReviewedDay: day,
  driveThru: bool, lastRemodel: day, openedTrading: opt(day), refurbDays: opt(day),
  footfallMods: arr(obj({ mult: num(0, 1000), daysRemaining: n, reason: text }), 500),
  saturationPenalty: n, lastInspected: opt(day), unreported: money, failingDays: n,
  operatorLoan: opt(obj({ remaining: money, daily: money })),
  mealsServed: n, focused: opt(bool), tables: opt(num(0, 1000)), popularity: opt(pct100), prestige: opt(pct100),
});

const franchisee = obj({
  id, name: name(80), competence: pct100, honesty: pct100, mood: pct100, cash: money, sites: arr(id, many),
  joinedDay: day, margin30d: n, lastExpansionDay: opt(day), feeHolidayUntil: opt(day),
});

const city = obj({
  id, name: name(80), country: name(80), regionId: id, population: n, districts: arr(id, 100), costIndex: n,
  dietaryRules: arr(oneOf("no-beef", "no-pork", "halal", "kosher"), 10),
  localChampion: opt(name(80)), championStrength: n, entered: bool, localised: bool, tradition: bool, exited: opt(bool), x: n, y: n,
});

const empireState = obj<EmpireState>({
  version: oneOf(1),
  seed: num(-BIG, BIG),
  rngState,
  brand: obj({
    name: name(80),
    formula: obj({
      menuDishIds: arr(id, 1000), locked: bool, standardisation: num(-1000, 1000), driveThru: bool, academy: bool, appOrdering: bool,
      fresh: bool, priceIndex: num(0, 100),
    }),
    recognition: rec(num(-1000, 1000), 500),
    adSpend30d: rec(money, 500),
    research: opt(obj({ tech: oneOf("academy", "driveThru", "appOrdering"), daysLeft: n })),
    permanentDemand: num(0, 1000),
  }),
  contract: obj({ fee: money, royaltyPct: share, adFundPct: share, rentPctOfSales: share, termDays: day, remodelEveryDays: day }),
  sites: arr(site, many),
  franchisees: arr(franchisee, many),
  applicants: arr(obj({ id, name: name(80), competence: pct100, honesty: pct100, cash: money, arrivedDay: day }), 500),
  cities: arr(city, 1000),
  regions: arr(obj({ id, name: name(80), commissary: bool, x: n, y: n }), 200),
  property: arr(obj({ siteId: id, purchasePrice: money, priceLevelAtPurchase: n, mortgageRemaining: money, mortgageDaily: money, rentIncome: money }), many),
  suppliers: arr(obj({ id, name: name(80), category: id, discountPct: share, failureRisk: share, signed: bool, exclusive: bool, signedDay: opt(day) }), 500),
  hq: obj({ cash: money, day, priceLevel: num(0, 1e6), lastDayNet: money, income30d: money, homeCityId: id }),
  calibration: obj({
    baseCovers: n, demandScale: opt(n), spendScale: opt(n), foodScale: opt(n), popularity: opt(n),
    coversMean: n, spendPerCover: money, foodPerCover: money, labourPerDay: money, overheadsFixed: money,
    cardFeePct: share, vatPct: share, weekdayProfile: arr(n, 7), weekendMult: n, districtId: opt(id), noiseSd: n, days: n,
    source: obj({ covers: n, revenue: money, profit: money }),
  }),
  focusedSiteId: opt(id),
  mealsServedTotal: n,
  association: obj({ active: bool, formedDay: opt(day) }),
  inspectionEveryDays: num(0, 1e5),
  effects: arr(obj({
    id, kind: oneOf("scandal", "campaign", "discount", "product", "supplierOutage"), label: text, startDay: day, endDay: day,
    demand: num(-100, 100), spend: opt(num(-100, 100)), regionId: opt(id), siteId: opt(id), supplierId: opt(id), budgetPerDay: opt(money),
  }), many),
  pendingIdea: opt(obj({ franchiseeId: id, name: name(80), day })),
  events: arr(obj({ day, kind: id, text, tone: oneOf("good", "bad", "info", "money"), siteId: opt(id), cityId: opt(id), regionId: opt(id) }), EVENT_LOG_MAX * 5),
  history: arr(obj({
    day, sites: n, company: n, franchise: n, licence: n, mealsServed: n, hqCash: money, hqIncome: money, systemSales: money, avgMood: n, avgRecognition: n,
  }), MONTHLY_HISTORY_MAX * 2),
  win: obj({
    mealsTarget: n, regionsWon: arr(id, 200), solvent: bool, moodOk: bool, achieved: bool, achievedDay: opt(day), reason: opt(oneOf("meals", "regions")),
  }),
  status: oneOf("running", "bankrupt"),
  nextId: int(0, BIG),
  monthBook: opt(income),
  boardMeeting: opt(obj({
    id, day, month: n, income,
    topMover: opt(obj({ cityId: id, districtId: id, change: money, salesYear: money })),
    risk: obj({ kind: oneOf("mood", "collapse", "borrowing", "maturity", "none"), text, siteId: opt(id) }),
    decision: obj({
      kind: decisionKind, question: text, advice: text, skipText: text,
      options: arr(obj({ id, label: text, detail: text, cmd: opt(obj({ type: id }, anyJson)), cost: opt(money) }), 20),
    }),
  })),
  boardMinutes: opt(arr(obj({ id, day, kind: decisionKind, choice: text, text, net: money }), BOARD_MINUTES_MAX * 5)),
  boardDistrictSales: opt(rec(money, many)),
  supplyMarkupPct: opt(num(0, 1)),
}, false);

/** A loaded EmpireState (after `deserialize`'s migrations), checked and cleaned (throws SchemaError). */
export function validateEmpireState(raw: unknown): EmpireState {
  return empireState(raw, "empire");
}

