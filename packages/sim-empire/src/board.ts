/**
 * [round 6] The monthly board meeting (EMPIRE-NOTES §3 "Board meeting"): the month's money by source, the district
 * that moved most, one headline worry and exactly ONE decision with two or three options, each a real command.
 *
 * Pure and deterministic: the question is picked from the eligible pool by a hash of (seed, month), never by the
 * empire's rng, so holding a meeting doesn't change what the dice do next. The board's `advice` is what a sensible
 * operator would pick (the headless "board-follower" and the card's tip).
 */
import { formatPounds } from "@full-plate/sim-core";
import type { ContentPack } from "@full-plate/sim-core";
import * as K from "./constants";
import {
  annuityDaily,
  bookValue,
  avgFranchiseeMood,
  developmentFacility,
  expectedSiteDay,
  FAIR_NET_PCT,
  medianFranchiseeMargin,
  propertyPrice,
  refurbCost,
  remodelCost,
  spendable,
} from "./engine";
import { clamp, maturity, menuBreaksRules } from "./model";
import type { BoardDecisionKind, BoardIncome, BoardMeeting, BoardOption, BoardRisk, City, EmpireCommand, EmpireState, SiteSummary } from "./types";
import { DISTRICT_SHORT } from "./world";

type Decision = BoardMeeting["decision"];

const pounds = formatPounds;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const first = (name: string) => name.split(" ")[0] ?? name;
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** A small integer hash of (seed, month): the picker's only source of variety. */
export function boardHash(seed: number, month: number): number {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(month | 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/** Yearly sales per "cityId|districtId" across open sites (the top mover compares meetings). */
export function districtSales(e: EmpireState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of e.sites) {
    if (s.status !== "open") continue;
    const k = `${s.cityId}|${s.districtId}`;
    out[k] = (out[k] ?? 0) + Math.round(s.revenueYear);
  }
  return out;
}

export function buildBoardMeeting(content: ContentPack, e: EmpireState, income: BoardIncome, day: number): BoardMeeting {
  const month = Math.floor(day / K.BOARD_MONTH_DAYS);
  const mover = topMover(e);
  return { id: `bm${month}`, day, month, income: { ...income }, ...(mover ? { topMover: mover } : {}), risk: boardRisk(e, day), decision: pickDecision(content, e, month, day) };
}

function topMover(e: EmpireState): BoardMeeting["topMover"] {
  const now = districtSales(e);
  const before = e.boardDistrictSales ?? {};
  let best: BoardMeeting["topMover"];
  for (const k of Object.keys(now).sort()) {
    const change = now[k]! - (before[k] ?? 0);
    if (change > 0 && (!best || change > best.change)) {
      const [cityId, districtId] = k.split("|") as [string, string];
      best = { cityId, districtId, change, salesYear: now[k]! };
    }
  }
  return best;
}

const tired = (e: EmpireState, day: number) => e.sites.filter((s) => s.status === "open" && !s.focused && maturity(s, day) >= K.REFURB_MIN_MATURITY);

/** The one headline worry, most urgent first: the owners' mood, a shop below the line, borrowing, tired shops. */
export function boardRisk(e: EmpireState, day: number): BoardRisk {
  const active = e.franchisees.filter((f) => f.sites.length);
  const mood = avgFranchiseeMood(e);
  if (e.association.active) return { kind: "mood", text: "Shop owners have teamed up against you. They block some moves until they make money again." };
  if (active.length >= 3 && mood < 45) return { kind: "mood", text: `Shop owners are grumpy (mood ${Math.round(mood)} out of 100). Below ${K.ASSOCIATION_MOOD} they may team up against you.` };
  const line = K.COLLAPSE_REVENUE_YEAR * e.hq.priceLevel;
  const failing = e.sites.filter((s) => s.status === "open" && s.failingDays > 0).sort((a, b) => a.revenueYear - b.revenueYear)[0];
  if (failing) return { kind: "collapse", siteId: failing.id, text: `${failing.name} sells only ${pounds(failing.revenueYear)} a year. A shop below ${pounds(line)} is in trouble.` };
  const facility = developmentFacility(e);
  if (e.hq.cash < 0 && -e.hq.cash >= 0.8 * facility)
    return { kind: "borrowing", text: `HQ has borrowed ${pounds(-e.hq.cash)}. The bank lends about ${pounds(K.FACILITY_PER_OPEN_SITE * e.hq.priceLevel)} per shop, so it may soon say no.` };
  const n = tired(e, day).length;
  if (n > 0) return { kind: "maturity", text: `${plural(n, "shop")} ${n === 1 ? "is" : "are"} getting tired: wages and repairs cost more each year.` };
  return { kind: "none", text: "No big worries this month." };
}

function pickDecision(content: ContentPack, e: EmpireState, month: number, day: number): Decision {
  // Round 11 (G8): HQ that can't spend anything gets one question until it can: how to pay the debt down.
  const debt = debtDecision(e);
  if (debt) return debt;
  const pool: Decision[] = [];
  for (const b of [royalty, localise, buyPlot, refurbish, feeHoliday, driveThru, supplyMarkup]) {
    const d = b(content, e, day);
    if (d) pool.push(d);
  }
  if (pool.length < 2) pool.push(campaign(e));
  // Don't ask the same kind of question two months running when there is another.
  const last = e.boardMinutes?.at(-1)?.kind;
  const fresh = pool.filter((d) => d.kind !== last);
  const from = fresh.length ? fresh : pool;
  return from[boardHash(e.seed, month) % from.length]!;
}

function decision(kind: BoardDecisionKind, question: string, options: BoardOption[], advice: string, skipText = "Nothing changes."): Decision {
  return { kind, question, options, advice, skipText };
}

// ── the pool ──

function royalty(_c: ContentPack, e: EmpireState): Decision | undefined {
  const active = e.franchisees.filter((f) => f.sites.length);
  if (active.length < 3) return undefined;
  const r = e.contract.royaltyPct;
  const mood = avgFranchiseeMood(e);
  const med = medianFranchiseeMargin(e) ?? 0;
  const up = Math.round(Math.min(K.ROYALTY_RANGE[1], r + K.BOARD_ROYALTY_STEP) * 1000) / 1000;
  const down = Math.round(Math.max(K.ROYALTY_RANGE[0], r - K.BOARD_ROYALTY_STEP) * 1000) / 1000;
  const options: BoardOption[] = [];
  if (up > r && !e.association.active)
    options.push({ id: "raise", label: `Raise it to ${pct(up)}`, detail: "More money from every shop. Shop owners won't like it: their mood drops.", cmd: { type: "SET_CONTRACT", contract: { royaltyPct: up }, applyTo: "all" } });
  if (down < r) options.push({ id: "lower", label: `Lower it to ${pct(down)}`, detail: "Less money for HQ. Shop owners keep more and slowly cheer up.", cmd: { type: "SET_CONTRACT", contract: { royaltyPct: down }, applyTo: "all" } });
  options.push({ id: "keep", label: `Keep it at ${pct(r)}`, detail: "Nothing changes." });
  const wantLower = (mood < 45 || med < 0.03) && options.some((o) => o.id === "lower");
  // A sensible board squeezes only happy, well-paid owners, and never past a point above the benchmark royalty.
  const canRaise = options.some((o) => o.id === "raise") && up <= K.DEFAULT_ROYALTY_PCT + K.BOARD_ROYALTY_STEP + 1e-9;
  const advice = wantLower ? "lower" : mood >= 70 && med >= 0.08 && canRaise ? "raise" : "keep";
  return decision("royalty", `Shop owners pay you ${pct(r)} of their sales. Change it?`, options, advice, wantLower ? "Shop owners hoped you'd listen: their mood dips a little." : "Nothing changes.");
}

function localise(content: ContentPack, e: EmpireState): Decision | undefined {
  const sitesIn = (c: City) => e.sites.filter((s) => s.status !== "closed" && s.cityId === c.id).length;
  const city = e.cities
    .filter((c) => c.entered && !c.exited && !c.localised && c.dietaryRules.length && menuBreaksRules(content, e.brand.formula.menuDishIds, c.dietaryRules))
    .sort((a, b) => sitesIn(b) - sitesIn(a) || b.population - a.population)[0];
  if (!city) return undefined;
  const cost = Math.round(K.LOCALISE_COST * Math.max(0.6, city.costIndex) * e.hq.priceLevel);
  const lost = Math.round((1 - K.DIETARY_PENALTY) * 100);
  return decision(
    "localise",
    `Your menu breaks the food rules in ${city.name} (${city.dietaryRules.join(", ")}). Make a local menu?`,
    [
      { id: "localise", label: `Make a ${city.name} menu`, detail: `Costs ${pounds(cost)} now. Guests there stop staying away, and your special might become a local tradition.`, cmd: { type: "LOCALISE_MENU", cityId: city.id }, cost },
      { id: "wait", label: "Not yet", detail: `No cost. Shops in ${city.name} keep losing about ${lost}% of their guests.` },
    ],
    spendable(e) >= 2 * cost ? "localise" : "wait",
  );
}

/**
 * What a careful board keeps back before spending on capex (land, refurbs, lanes): the cost of entering a new country
 * — growth comes first — or a tenth of the mortgages already carried plus one shop's facility, whichever is more.
 */
const capexReserve = (e: EmpireState) =>
  Math.max((K.CITY_ENTRY_COST + K.COUNTRY_ENTRY_COST) * e.hq.priceLevel, 0.1 * e.property.reduce((a, p) => a + p.mortgageRemaining, 0) + K.FACILITY_PER_OPEN_SITE * e.hq.priceLevel);

function buyPlot(_c: ContentPack, e: EmpireState): Decision | undefined {
  const campusFirst = (s: SiteSummary) => (s.districtId === "student_quarter" || s.districtId === "business_park" ? 1 : 0);
  const site = e.sites
    .filter((s) => s.status === "open" && s.ownership !== "licence" && s.land !== "hqOwned")
    .sort((a, b) => campusFirst(b) - campusFirst(a) || b.revenueYear / propertyPrice(b) - a.revenueYear / propertyPrice(a) || a.id.localeCompare(b.id))[0];
  if (!site) return undefined;
  const price = propertyPrice(site);
  const deposit = Math.round(price * K.PROPERTY_DEPOSIT_SHARE);
  if (spendable(e) < deposit) return undefined;
  const monthly = annuityDaily(price - deposit, K.MORTGAGE_APR, K.MORTGAGE_YEARS * K.DAYS_PER_YEAR) * 30;
  const where = DISTRICT_SHORT[site.districtId] ?? site.districtId;
  return decision(
    "buyPlot",
    `The land under ${site.name} (${where}) is for sale at ${pounds(price)}. Buy it?`,
    [
      {
        id: "buy",
        label: `Buy the ${where} plot`,
        detail: `${pounds(deposit)} now, then about ${pounds(monthly)} a month for ${K.MORTGAGE_YEARS} years. ${site.ownership === "franchise" ? "The shop owner pays you rent." : "You stop paying rent on it."}`,
        cmd: { type: "BUY_PROPERTY", siteId: site.id },
        cost: deposit,
      },
      { id: "rent", label: "Keep renting", detail: "No cost now. The rent goes up as prices rise." },
    ],
    e.hq.cash >= deposit + capexReserve(e) ? "buy" : "rent",
  );
}

function refurbish(content: ContentPack, e: EmpireState, day: number): Decision | undefined {
  const site = tired(e, day).sort((a, b) => Number(b.ownership === "company") - Number(a.ownership === "company") || b.revenueYear - a.revenueYear || a.id.localeCompare(b.id))[0];
  if (!site) return undefined;
  const city = e.cities.find((c) => c.id === site.cityId)!;
  const cost = refurbCost(site, city, e.hq.priceLevel);
  if (spendable(e) < cost) return undefined;
  const fr = site.franchisee ? e.franchisees.find((f) => f.id === site.franchisee) : undefined;
  let advice = "leave";
  const affordable = e.hq.cash >= cost + capexReserve(e);
  if (site.ownership === "company") advice = affordable && refurbGain(content, e, site) >= cost ? "refurb" : "leave";
  else if (fr && fr.mood < 55 && affordable) advice = "refurb";
  const years = Math.max(1, Math.floor((day - (site.openedTrading ?? day)) / K.DAYS_PER_YEAR));
  return decision(
    "refurbish",
    `${site.name} has traded for ${plural(years, "year")} and is getting tired. Refurbish it?`,
    [
      { id: "refurb", label: `Refurbish ${site.name}`, detail: `${pounds(cost)} now. The shop feels new again: its wage and repair bills drop back for a while.${fr ? ` ${first(fr.name)} will be pleased.` : ""}`, cmd: { type: "REFURBISH", siteId: site.id }, cost },
      { id: "leave", label: "Leave it", detail: "No cost now. It keeps getting a little more tired and costly." },
    ],
    advice,
  );
}

/** HQ's expected gain from refurbishing a company site: today's daily gain, fading to nothing over REFURB_DAYS. */
export function refurbGain(content: ContentPack, e: EmpireState, site: SiteSummary): number {
  const now = expectedSiteDay(content, e, site.id).contribution;
  const age = e.hq.day - (site.openedTrading ?? e.hq.day) - (site.refurbDays ?? 0);
  const add = Math.max(0, age - (Math.min(age, K.MATURE_FULL_DAYS) - K.REFURB_DAYS));
  const refurbed = { ...e, sites: e.sites.map((s) => (s.id === site.id ? { ...s, refurbDays: (s.refurbDays ?? 0) + add } : s)) };
  const after = expectedSiteDay(content, refurbed, site.id).contribution;
  return Math.max(0, after - now) * (K.REFURB_DAYS / 2);
}

function feeHoliday(_c: ContentPack, e: EmpireState, day: number): Decision | undefined {
  const fr = e.franchisees
    .filter((f) => f.sites.length && (f.feeHolidayUntil === undefined || f.feeHolidayUntil <= day) && (f.margin30d < FAIR_NET_PCT || f.mood < 50))
    .sort((a, b) => a.margin30d - b.margin30d || a.id.localeCompare(b.id))[0];
  if (!fr) return undefined;
  const sites = e.sites.filter((s) => s.franchisee === fr.id && s.status === "open");
  const royaltyDay = sites.reduce((a, s) => a + (s.revenueYear / K.DAYS_PER_YEAR) * (1 - e.calibration.vatPct) * (s.contract?.royaltyPct ?? e.contract.royaltyPct), 0);
  const name = first(fr.name);
  return decision(
    "feeHoliday",
    `${fr.name} is finding it hard${sites.length > 1 ? ` with ${plural(sites.length, "shop")}` : ""}. They ask for a royalty holiday. Help them?`,
    [
      { id: "long", label: "Three months off", detail: `HQ gives up about ${pounds(royaltyDay * 90)}. ${name} cheers up a lot.`, cmd: { type: "FEE_HOLIDAY", franchiseeId: fr.id, days: 90 } },
      { id: "short", label: "One month off", detail: `HQ gives up about ${pounds(royaltyDay * 30)}. ${name} cheers up a bit.`, cmd: { type: "FEE_HOLIDAY", franchiseeId: fr.id, days: 30 } },
      { id: "no", label: "Say no", detail: `HQ keeps the money. ${name} will be upset.` },
    ],
    fr.margin30d < 0 ? "long" : "short",
    `${name} will feel ignored: their mood drops.`,
  );
}

function driveThru(_c: ContentPack, e: EmpireState): Decision | undefined {
  if (!e.brand.formula.driveThru) return undefined;
  const site = e.sites
    .filter((s) => s.status === "open" && !s.driveThru && s.ownership !== "licence")
    .sort((a, b) => Number(b.ownership === "company") - Number(a.ownership === "company") || b.revenueYear - a.revenueYear || a.id.localeCompare(b.id))[0];
  if (!site) return undefined;
  const city = e.cities.find((c) => c.id === site.cityId)!;
  const cost = remodelCost(site, city, e.hq.priceLevel);
  if (spendable(e) < cost) return undefined;
  const more = Math.round((K.DRIVE_THRU_COVERS - 1) * 100);
  const affordable = e.hq.cash >= cost + capexReserve(e);
  const fr = site.franchisee ? e.franchisees.find((f) => f.id === site.franchisee) : undefined;
  const lane: BoardOption = { id: "lane", label: fr ? "HQ pays for a lane" : "Add a drive-thru", detail: `${pounds(cost)} from HQ now. Cars can order without parking: about ${more}% more guests, but the bigger plot costs more rent.${fr ? ` ${first(fr.name)} will be pleased.` : ""}`, cmd: { type: "REMODEL", siteId: site.id, hqPays: true }, cost };
  const wait: BoardOption = { id: "wait", label: "Not now", detail: fr ? "No cost. The lane comes with the shop's next planned refit." : "No cost. The shop stays as it is." };
  if (!fr) return decision("driveThru", `${site.name} has no drive-thru lane yet. Build one?`, [lane, wait], affordable ? "lane" : "wait");
  // A franchise shop: HQ can pay, or order the owner to pay now (a forced remodel the association can block).
  const make: BoardOption = { id: "make", label: `${first(fr.name)} pays now`, detail: `It costs ${first(fr.name)} ${pounds(cost)}. Being told to spend makes them cross: their mood drops a lot.`, cmd: { type: "REMODEL", siteId: site.id } };
  const options = e.association.active ? [lane, wait] : [lane, make, wait];
  return decision("driveThru", `${site.name} (${first(fr.name)}'s shop) has no drive-thru lane yet. Add one?`, options, affordable && fr.mood < 60 && e.hq.cash >= 10 * cost ? "lane" : "wait");
}

function supplyMarkup(_c: ContentPack, e: EmpireState): Decision | undefined {
  const active = e.franchisees.filter((f) => f.sites.length);
  if (active.length < 5 || !e.suppliers.some((s) => s.signed)) return undefined;
  const now = e.supplyMarkupPct ?? 0;
  const mood = avgFranchiseeMood(e);
  const med = medianFranchiseeMargin(e) ?? 0;
  if (now === 0) {
    if (e.association.active) return undefined;
    const up = K.SUPPLY_MARKUP_STEP;
    return decision(
      "supplyMarkup",
      "HQ buys the food for every shop. Charge shop owners a little extra for it?",
      [
        { id: "start", label: `Add ${pct(up)}`, detail: "HQ earns a little on every bun and bag of chips. Shop owners notice: their mood drops.", cmd: { type: "SET_SUPPLY_MARKUP", pct: up } },
        { id: "cost", label: "Sell it at cost", detail: "Nothing changes. Shop owners keep their food cheap." },
      ],
      mood >= 70 && med >= 0.08 ? "start" : "cost",
    );
  }
  return decision(
    "supplyMarkup",
    `You add ${pct(now)} to the food you sell shop owners. Keep it?`,
    [
      { id: "drop", label: "Drop the markup", detail: "HQ earns less. Shop owners' food gets cheaper and they slowly cheer up.", cmd: { type: "SET_SUPPLY_MARKUP", pct: 0 } },
      { id: "keep", label: `Keep ${pct(now)}`, detail: "Nothing changes." },
    ],
    mood < 50 || med < 0.04 ? "drop" : "keep",
  );
}

function campaign(e: EmpireState): Decision {
  const live = e.regions.filter((r) => e.sites.some((s) => s.status === "open" && e.cities.find((c) => c.id === s.cityId)?.regionId === r.id));
  const home = e.cities.find((c) => c.id === e.hq.homeCityId)!.regionId;
  const region = (live.length ? live : e.regions.filter((r) => r.id === home)).slice().sort((a, b) => (e.brand.recognition[a.id] ?? 0) - (e.brand.recognition[b.id] ?? 0) || a.id.localeCompare(b.id))[0]!;
  const pl = e.hq.priceLevel;
  const budget = Math.round(clamp(e.hq.income30d / 2, 2_000_000 * pl, 50_000_000 * pl) / 100_000) * 100_000;
  const rec = Math.round(e.brand.recognition[region.id] ?? 0);
  return decision(
    "campaign",
    `People in ${region.name} know you ${rec} out of 100. Run adverts there?`,
    [
      { id: "advertise", label: `Advertise in ${region.name}`, detail: `${pounds(budget)} for a month of adverts. More people get to know you there.`, cmd: { type: "LAUNCH_CAMPAIGN", kind: "brand", budget, regionId: region.id }, cost: budget },
      { id: "save", label: "Save the money", detail: "HQ keeps its cash for new shops." },
    ],
    e.hq.cash >= 4 * budget && rec < K.WIN_RECOGNITION + 5 ? "advertise" : "save",
  );
}

// ── round 11 (G8): HQ is sinking ──

/** A one-tap way out of debt: refranchise a shop or close a loss-maker. Labels and details are child-readable. */
export interface DebtOption { id: "sell" | "close"; label: string; detail: string; cmd: EmpireCommand; gain: number }

/**
 * Ways to pay HQ's debt down, best first: sell the most valuable company shop you don't run to the applicant who can
 * afford it (HQ gets the fee and the building), and close the shop losing the most (it stops the bleeding). Empty
 * when neither applies. The focused shop is never offered (it can't be sold while you run it).
 */
export function debtOptions(e: EmpireState): DebtOption[] {
  const out: DebtOption[] = [];
  const own = e.sites.filter((s) => s.status === "open" && s.ownership === "company" && !s.focused);
  const fee = e.contract.fee;
  const sale = own
    .map((s) => {
      const city = e.cities.find((c) => c.id === s.cityId)!;
      const book = bookValue(e, city, s);
      const need = fee + Math.round(book * K.FRANCHISEE_EQUITY_SHARE);
      const buyer = e.applicants.filter((a) => a.cash >= need).sort((a, b) => b.cash - a.cash || a.id.localeCompare(b.id))[0];
      return buyer ? { s, buyer, gain: fee + book } : undefined;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.gain - a.gain || a.s.id.localeCompare(b.s.id))[0];
  if (sale) {
    out.push({
      id: "sell",
      label: `Sell ${sale.s.name} to ${first(sale.buyer.name)}`,
      detail: `HQ gets ${pounds(sale.gain)} now. ${first(sale.buyer.name)} runs the shop and pays you a royalty on its sales.`,
      cmd: { type: "SELL_FRANCHISE", siteId: sale.s.id, applicantId: sale.buyer.id },
      gain: sale.gain,
    });
  }
  const loser = e.sites
    .filter((s) => s.status === "open" && !s.focused && s.ownership === "company" && s.margin7d < 0)
    .sort((a, b) => a.margin7d - b.margin7d || a.id.localeCompare(b.id))[0];
  if (loser) {
    out.push({
      id: "close",
      label: `Close ${loser.name}`,
      detail: `It loses about ${pounds(-loser.margin7d)} a week. Closing it stops that.`,
      cmd: { type: "CLOSE_SITE", siteId: loser.id },
      gain: -loser.margin7d,
    });
  }
  return out;
}

/** HQ's money is falling: about how much a day (pence, ≥ 0) over the last month. 0 when HQ is making money. */
export function hqSinkingPerDay(e: EmpireState): number {
  return Math.max(0, -Math.round(e.hq.income30d / 30));
}

/** The trap, not a dip: HQ can't spend and lost money over the last month (a growing chain often borrows to the limit while it earns). */
function debtDecision(e: EmpireState): Decision | undefined {
  if (spendable(e) >= 0 || hqSinkingPerDay(e) <= 0) return undefined;
  const opts = debtOptions(e);
  if (!opts.length) return undefined;
  const options: BoardOption[] = [
    ...opts.map((o) => ({ id: o.id, label: o.label, detail: o.detail, cmd: o.cmd })),
    { id: "hold", label: "Hold on", detail: "Nothing changes. HQ keeps borrowing to pay its bills." },
  ];
  return decision(
    "debt",
    `HQ owes the bank ${pounds(-e.hq.cash)} and can't borrow any more. Pay some of it back?`,
    options,
    opts[0]!.id,
    "HQ keeps sinking.",
  );
}
