/**
 * Unit-economics probe (round 5): opens one new site in an empire, lets it build, trades it for a year with no
 * random events and breaks the year into a franchisee's (or a company site's) P&L. Pure: it returns numbers and
 * never touches its input. Used by the headless (`--unit`), the regression test and the docs table.
 */
import { formatPounds } from "@full-plate/sim-core";
import type { ContentPack } from "@full-plate/sim-core";
import * as K from "./constants";
import { applyEmpireCommand, remodelCost, stepEmpireDay } from "./engine";
import type { DistrictId, EmpireState, LandMode, Ownership, SiteTrace } from "./types";

export interface UnitProbeOptions {
  cityId?: string;
  districtId?: DistrictId;
  ownership?: Exclude<Ownership, "licence">;
  land?: LandMode;
  /** Trading days to measure after the site opens. Default 360. */
  days?: number;
  /** Sign the brand's supply deals first, as the scripted styles do in week one (exclusive where the supplier is safe). */
  supplyDeals?: boolean;
  /** Trade this many days before measuring (e.g. 360 = the second year). Default 0. */
  skipDays?: number;
  /** The operator who takes a franchise (default competence 60, honesty 90: an honest, decent operator). */
  competence?: number;
  honesty?: number;
}

/** A year of one site, in pence (totals over the window) and as shares of net sales. */
export interface UnitEconomics {
  days: number;
  coversPerDay: number;
  revenue: number;
  vat: number;
  netSales: number;
  food: number;
  labour: number;
  overheads: number;
  /** Occupancy the operator (or company site) paid: market rent or HQ's sublet rent. */
  rent: number;
  royalty: number;
  adFund: number;
  /** Build-loan instalments (franchise: 70% of the fit-out over 10 years at 7%). */
  loan: number;
  /** The scheduled remodel spread over the contract's remodel cycle (a reserve, not cash). */
  remodelReserve: number;
  /** Cash the operator kept (franchise) or the site sent HQ before HQ overheads (company). */
  net: number;
  netAfterReserve: number;
  /** net ÷ netSales. */
  netPct: number;
  /** Site margin before fees, loan and occupancy: (net sales − food − labour − overheads) ÷ net sales. */
  sitePct: number;
  /** Operator net by 30-day month (the J-curve). */
  monthly: number[];
  /** Franchisee mood at the end (franchise only). */
  mood?: number;
}

const r0 = (x: number) => Math.round(x);

/** Opens the probe site, waits for it to build and returns the empire on its opening day plus its id. */
export function openProbeSite(content: ContentPack, e0: EmpireState, opts: UnitProbeOptions = {}): { e: EmpireState; siteId: string } {
  const ownership = opts.ownership ?? "franchise";
  const cityId = opts.cityId ?? e0.hq.homeCityId;
  const city = e0.cities.find((c) => c.id === cityId)!;
  const districtId = opts.districtId ?? city.districts[0]!;
  let e: EmpireState = { ...e0, hq: { ...e0.hq, cash: Math.max(e0.hq.cash, 1_000_000_000) } };
  if (opts.supplyDeals) for (const sup of e.suppliers) if (!sup.signed) e = applyEmpireCommand(content, e, { type: "SIGN_SUPPLIER", supplierId: sup.id, exclusive: sup.failureRisk < 0.05 }).empire;
  if (ownership === "franchise") {
    e = { ...e, applicants: [...e.applicants, { id: "a_probe", name: "Probe Operator", competence: opts.competence ?? 60, honesty: opts.honesty ?? 90, cash: 100_000_000, arrivedDay: e.hq.day }] };
  }
  const r = applyEmpireCommand(content, e, {
    type: "OPEN_SITE",
    cityId,
    districtId,
    ownership,
    land: opts.land ?? "hqLease",
    ...(ownership === "franchise" ? { applicantId: "a_probe" } : {}),
  });
  const bad = r.events.find((ev) => ev.kind === "rejected");
  if (bad) throw new Error(`unit probe: ${bad.text}`);
  e = r.empire;
  const siteId = e.sites[e.sites.length - 1]!.id;
  while (e.sites.find((s) => s.id === siteId)!.status === "building") e = stepEmpireDay(content, e, undefined, { noEvents: true }).empire;
  return { e, siteId };
}

/** One new site's first `days` of trading (default a year), broken down. */
export function probeUnitEconomics(content: ContentPack, e0: EmpireState, opts: UnitProbeOptions = {}): UnitEconomics {
  const { e: opened, siteId } = openProbeSite(content, e0, opts);
  const days = opts.days ?? K.DAYS_PER_YEAR;
  let e = opened;
  for (let d = 0; d < (opts.skipDays ?? 0) && e.status === "running"; d++) e = stepEmpireDay(content, e, undefined, { noEvents: true }).empire;
  const rows: SiteTrace[] = [];
  for (let d = 0; d < days && e.status === "running"; d++) {
    const r = stepEmpireDay(content, e, undefined, { noEvents: true, trace: [siteId] });
    e = r.empire;
    for (const t of r.trace ?? []) rows.push(t);
  }
  const sum = (f: (t: SiteTrace) => number) => rows.reduce((a, t) => a + f(t), 0);
  const site = e.sites.find((s) => s.id === siteId)!;
  const franchise = site.ownership === "franchise";
  const revenue = sum((t) => t.result.revenue);
  const vat = sum((t) => t.result.vat);
  const netSales = revenue - vat;
  const food = sum((t) => t.result.foodCost);
  const labour = sum((t) => t.result.labourCost);
  const overheads = sum((t) => t.result.overheads);
  const rent = sum((t) => t.rent);
  const royalty = sum((t) => t.royalty);
  const adFund = sum((t) => t.adFund);
  const loan = sum((t) => t.loan);
  const net = franchise ? sum((t) => t.operator) : sum((t) => t.hq);
  const city = e.cities.find((c) => c.id === site.cityId)!;
  const cycle = site.contract?.remodelEveryDays ?? K.DEFAULT_REMODEL_EVERY_DAYS;
  const remodelReserve = (remodelCost(site, city, e.hq.priceLevel) * rows.length) / cycle;
  const monthly: number[] = [];
  for (let i = 0; i < rows.length; i += 30) monthly.push(r0(rows.slice(i, i + 30).reduce((a, t) => a + (franchise ? t.operator : t.hq), 0)));
  const fr = site.franchisee ? e.franchisees.find((f) => f.id === site.franchisee) : undefined;
  return {
    days: rows.length,
    coversPerDay: sum((t) => t.result.covers) / Math.max(1, rows.length),
    revenue: r0(revenue),
    vat: r0(vat),
    netSales: r0(netSales),
    food: r0(food),
    labour: r0(labour),
    overheads: r0(overheads),
    rent: r0(rent),
    royalty: r0(royalty),
    adFund: r0(adFund),
    loan: r0(loan),
    remodelReserve: r0(remodelReserve),
    net: r0(net),
    netAfterReserve: r0(net - remodelReserve),
    netPct: netSales > 0 ? net / netSales : 0,
    sitePct: netSales > 0 ? (netSales - food - labour - overheads) / netSales : 0,
    monthly,
    ...(fr ? { mood: fr.mood } : {}),
  };
}

const pct = (x: number, of: number) => `${((100 * x) / Math.max(1, of)).toFixed(1)}%`;
const gbp = formatPounds;

/** A printable table of one probe (headless `--unit`). */
export function formatUnitEconomics(u: UnitEconomics, label = ""): string {
  const ns = u.netSales;
  const line = (k: string, v: number) => `  ${k.padEnd(22)} ${gbp(v).padStart(11)}  ${pct(v, ns).padStart(6)}`;
  return [
    `${label} — ${u.days} days, ${u.coversPerDay.toFixed(0)} covers/day${u.mood !== undefined ? `, mood at the end ${u.mood.toFixed(0)}` : ""}`,
    line("Net sales (ex VAT)", ns),
    line("Food & packaging", u.food),
    line("Crew wages", u.labour),
    line("Overheads", u.overheads),
    line("Rent", u.rent),
    line("Royalty", u.royalty),
    line("Ad fund", u.adFund),
    line("Build loan", u.loan),
    line("Net (cash)", u.net),
    line("Remodel reserve", u.remodelReserve),
    line("Net after reserve", u.netAfterReserve),
    `  by month: ${u.monthly.map((m) => Math.round(m / 100)).join(" ")}`,
  ].join("\n");
}
