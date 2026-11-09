import { useMemo, useState } from "react";
import type { GameState } from "@full-plate/sim-core";
import {
  associationBlocks, avgFranchiseeMood, boxTables, buildCost, cityEntryCost, contractAttractiveness, contractTake, developmentFacility, EMPIRE,
  expectedSiteDay, franchiseCashNeeded, offPremise, openSites, propertyPrice, spendable, TECH_LABEL,
  type City, type EmpireCommand, type EmpireState, type SiteSummary, type Tech,
} from "@full-plate/sim-empire";
import { content, extras } from "../../sim";
import { MoneyText } from "../../components/MoneyText";
import { Bar } from "../../components/Bar";
import { compactMeals } from "../../components/StatusBar";
import { Term } from "../../components/Term";
import { GLOSSARY, type TermId } from "../../lib/glossary";
import type { PathMeta } from "../../state/paths";

interface Props {
  game: GameState;
  meta: PathMeta;
  empire: EmpireState;
  send: (cmd: EmpireCommand) => void;
  onFocusSite: (siteId: string) => void;
}

/** Hand-drawn blobs for the five regions (0-1000 × 0-400), from the sim-empire demo. */
const LANDMASSES: { regionId: string; d: string }[] = [
  { regionId: "isles", d: "M410 44 q36 -20 74 -2 q34 22 26 62 q10 40 -16 70 q-34 22 -74 6 q-30 -26 -22 -66 q-12 -40 12 -70z" },
  { regionId: "mainland", d: "M520 120 q40 -22 90 -6 q36 14 34 44 q-6 30 -44 40 q-40 12 -70 -4 q-28 -20 -22 -48 q2 -16 12 -26z" },
  { regionId: "westland", d: "M100 130 q60 -40 140 -10 q40 20 30 70 q-10 50 -70 60 q-60 10 -100 -20 q-30 -30 -20 -70 q6 -20 20 -30z" },
  { regionId: "sunrise", d: "M720 200 q40 -60 120 -50 q70 10 80 60 q6 40 -40 80 q-50 40 -120 20 q-50 -16 -48 -60 q0 -30 8 -50z" },
  { regionId: "crescent", d: "M592 248 q30 -16 70 -2 q40 14 44 44 q2 30 -36 42 q-40 10 -66 -10 q-24 -20 -20 -46 q2 -18 8 -28z" },
];
const REGION_LABEL: Record<string, [number, number]> = { isles: [350, 120], mainland: [560, 225], westland: [180, 290], sunrise: [820, 345], crescent: [640, 350] };
const OWN_COLOUR = ["var(--tomato)", "var(--amber)", "var(--plum)"];
const districtName = (id: string) => content.districts.find((d) => d.id === id)?.name ?? id.replace("_", " ");

/** Round 5: three cards a child can find things in (My shops = city + sites, The brand, Money = HQ, flagship till, contract). */
type Panel = "shops" | "brand" | "money";
const PANEL_LABEL: Record<Panel, string> = { shops: "🏪 My shops", brand: "🍔 The brand", money: "💷 Money" };

/** Path A screen: world map, city/site panels, brand & tech, contract, suppliers, campaigns (EMPIRE-NOTES §1 "What the map screen shows"). */
export function EmpireTab({ game, meta, empire: e, send, onFocusSite }: Props) {
  const [picked, setPicked] = useState<string>(e.hq.homeCityId);
  const [panel, setPanel] = useState<Panel>("shops");
  const [move, setMove] = useState(0);
  const city = e.cities.find((c) => c.id === picked);
  const open = openSites(e);
  const franchised = e.sites.some((s) => s.ownership !== "company" && s.status === "open");
  const mood = franchised ? avgFranchiseeMood(e) : undefined;
  const recent = meta.empireEvents.filter((x) => x.kind !== "applicant").slice(-12).reverse();
  const tillSpare = Math.max(0, game.cash - 200_000);
  const step = Math.max(10_000, Math.round(tillSpare / 4 / 10_000) * 10_000);

  return (
    <div className="empire">
      <div className="empire__stats" aria-label="Empire totals">
        <Stat k="Shops open" v={String(open.length)} sub={`${open.filter((s) => s.ownership === "company").length} company · ${open.filter((s) => s.ownership !== "company").length} franchised`} />
        <Stat k="Meals served" v={compactMeals(e.mealsServedTotal)} sub={`of ${compactMeals(EMPIRE.WIN_MEALS)}`} />
        <Stat k={<Term id="hqCash">HQ money</Term>} v={<MoneyText pence={e.hq.cash} whole tone />} sub={<>net <MoneyText pence={e.hq.income30d} whole tone /> / month</>} />
        <Stat k={<Term id="facility">HQ can spend</Term>} v={<MoneyText pence={Math.max(0, spendable(e))} whole />} sub={<>incl. <MoneyText pence={developmentFacility(e)} whole /> bank facility (grows with open sites)</>} />
        <Stat k={<Term id="franchiseeMood">Shop owners' mood</Term>} v={mood === undefined ? "—" : String(Math.round(mood))} sub={e.association.active ? "⚠ association formed" : `revolt below ${EMPIRE.ASSOCIATION_MOOD}`} />
        <Stat k={<Term id="plot">Land owned</Term>} v={String(e.property.length)} sub={`${e.applicants.length} applicant${e.applicants.length === 1 ? "" : "s"} waiting`} />
      </div>

      {e.association.active && (
        <p className="callout callout--warn" role="note"><b>The franchisee association has formed.</b> Fee rises on existing deals, forced remodels, discount campaigns and opening next to a franchisee are blocked until mood is back above {EMPIRE.ASSOCIATION_DISSOLVE_MOOD}.</p>
      )}
      {e.hq.cash < 0 && (
        <p className="callout callout--warn" role="note">
          <b>HQ is overdrawn by <MoneyText pence={-e.hq.cash} whole />.</b> The overdraft costs {Math.round(EMPIRE.OVERDRAFT_APR * 100)}% a year (about <MoneyText pence={Math.round((-e.hq.cash * EMPIRE.OVERDRAFT_APR) / 12)} whole /> a month).{" "}
          {spendable(e) > 0 ? <>The bank will lend <MoneyText pence={spendable(e)} whole /> more for new building.</> : <>The bank won't lend more for building until sites open or cash comes in.</>}{" "}
          HQ goes bust at −<MoneyText pence={EMPIRE.HQ_CREDIT_LINE * e.hq.priceLevel} whole />.
        </p>
      )}

      <div className="empire__layout">
        <div className="stack">
          <div className="card empire__map">
            <WorldMap e={e} picked={picked} onPick={(id) => { setPicked(id); setPanel("shops"); }} />
            <div className="empire__legend xs">
              <span><i style={{ background: OWN_COLOUR[0] }} /><Term id="company" inline>Your own</Term></span>
              <span><i style={{ background: OWN_COLOUR[1] }} /><Term id="franchise" inline>Franchise</Term></span>
              <span><i style={{ background: OWN_COLOUR[2] }} /><Term id="licence" inline>Licence</Term></span>
              <span><i style={{ background: "var(--paper)", border: "1.5px solid var(--ink)" }} />Not entered</span>
              <span className="muted">Bar under a region = <Term id="recognition" inline>how many people know you</Term> (green at {EMPIRE.WIN_RECOGNITION})</span>
            </div>
          </div>
          <div className="card">
            <div className="card__title"><h3>News from the chain</h3></div>
            <ul className="empire__log">
              {recent.length === 0 && <li className="muted small">Nothing yet. Open a site to get going.</li>}
              {recent.map((x, i) => <li key={i} className={`careerlog__line careerlog__line--${x.tone}`}>{x.text}</li>)}
            </ul>
          </div>
        </div>

        <aside className="stack empire__side">
          <div className="tabs tabs--sm empire__tabs" role="tablist" aria-label="Empire panels">
            {(["shops", "brand", "money"] as Panel[]).map((p) => (
              <button key={p} role="tab" aria-selected={panel === p} className={`tab ${panel === p ? "tab--active" : ""}`} onClick={() => setPanel(p)}>
                {PANEL_LABEL[p]}
              </button>
            ))}
          </div>
          {panel === "shops" && (
            <>
              {city && <CityPanel e={e} city={city} send={send} />}
              <SitesPanel e={e} send={send} onFocusSite={onFocusSite} />
            </>
          )}
          {panel === "brand" && <BrandPanel e={e} send={send} />}
          {panel === "money" && (
            <>
              <div className="card stack stack--sm">
                <div className="card__title"><h3>Money at HQ</h3></div>
                <div className="bignums">
                  <BigNum label={<Term id="hqCash">HQ money</Term>} value={<MoneyText pence={e.hq.cash} whole tone />} />
                  <BigNum label={<Term id="facility">HQ can spend</Term>} value={<MoneyText pence={Math.max(0, spendable(e))} whole />} />
                </div>
                <p className="small muted">Last month HQ made <MoneyText pence={e.hq.income30d} whole tone />. HQ can spend its cash plus a bank loan for building that grows as shops open.</p>
              </div>
              <div className="card stack stack--sm">
                <div className="card__title"><h3>Money from the flagship</h3></div>
                <p className="small muted">The restaurant you run keeps its own till. Move spare cash to HQ to fund new sites.</p>
                <div className="row">
                  <button className="btn btn--sm" aria-label="Move less" disabled={move <= 0} onClick={() => setMove(Math.max(0, move - step))}>−</button>
                  <b className="bignum__inline"><MoneyText pence={move} whole /></b>
                  <button className="btn btn--sm" aria-label="Move more" disabled={move + step > tillSpare} onClick={() => setMove(Math.min(tillSpare, move + step))}>+</button>
                  <button className="btn btn--green btn--sm" disabled={move <= 0} onClick={() => { send({ type: "TRANSFER_FROM_FOCUSED", amount: move }); setMove(0); }}>Move to HQ</button>
                </div>
                <p className="xs faint">Keeps £2,000 in the till. Till now: <MoneyText pence={game.cash} whole /></p>
              </div>
              <ContractPanel e={e} send={send} />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

/** A big number with its plain label above (Money and Sites cards). */
function BigNum({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return <div className="bignum"><div className="bignum__k">{label}</div><div className="bignum__v">{value}</div></div>;
}

function Stat({ k, v, sub }: { k: React.ReactNode; v: React.ReactNode; sub?: React.ReactNode }) {
  return <div className="kpi"><div className="kpi__k">{k}</div><div className="kpi__v">{v}</div>{sub && <div className="xs muted">{sub}</div>}</div>;
}

function WorldMap({ e, picked, onPick }: { e: EmpireState; picked?: string; onPick: (id: string) => void }) {
  const pins = useMemo(() => {
    const byCity = new Map<string, { company: number; franchise: number; licence: number; building: number }>();
    for (const s of e.sites) {
      if (s.status === "closed") continue;
      const c = byCity.get(s.cityId) ?? { company: 0, franchise: 0, licence: 0, building: 0 };
      if (s.status === "building") c.building++;
      else c[s.ownership]++;
      byCity.set(s.cityId, c);
    }
    return byCity;
  }, [e]);
  const scandal = new Set(e.effects.filter((f) => f.kind === "scandal" && f.regionId).map((f) => f.regionId!));
  return (
    <svg viewBox="40 20 920 380" role="group" aria-label="World map of cities and sites">
      <rect x="40" y="20" width="920" height="380" fill="var(--sky-wash)" rx="16" />
      {LANDMASSES.map((l) => {
        const rec = e.brand.recognition[l.regionId] ?? 0;
        return <path key={l.regionId} d={l.d} fill={`color-mix(in srgb, var(--basil-wash) ${100 - rec}%, #b9d9a8)`} stroke={scandal.has(l.regionId) ? "var(--tomato)" : "var(--line-strong)"} strokeWidth={scandal.has(l.regionId) ? 4 : 2} />;
      })}
      {e.regions.map((r) => {
        const rec = e.brand.recognition[r.id] ?? 0;
        const [lx, ly] = REGION_LABEL[r.id] ?? [r.x, r.y];
        return (
          <g key={r.id} transform={`translate(${lx} ${ly})`} aria-label={`${r.name}: recognition ${Math.round(rec)}`}>
            <text textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--ink-soft)" fontFamily="var(--font-display)">{r.name}</text>
            <rect x={-40} y={6} width={80} height={7} rx={3.5} fill="var(--cream-deep)" />
            <rect x={-40} y={6} width={0.8 * rec} height={7} rx={3.5} fill={rec >= EMPIRE.WIN_RECOGNITION ? "var(--basil)" : "var(--amber)"} />
          </g>
        );
      })}
      {e.cities.map((c) => {
        const p = pins.get(c.id);
        const total = p ? p.company + p.franchise + p.licence : 0;
        const r = 8 + Math.min(16, Math.sqrt(total) * 2);
        const sel = c.id === picked;
        return (
          <g
            key={c.id}
            transform={`translate(${c.x} ${c.y})`}
            onClick={() => onPick(c.id)}
            onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onPick(c.id); } }}
            style={{ cursor: "pointer" }}
            role="button"
            tabIndex={0}
            aria-pressed={sel}
            aria-label={`${c.name}, ${c.country}: ${total} site${total === 1 ? "" : "s"}${c.entered ? "" : ", not entered"}`}
          >
            {sel && <circle r={r + 6} fill="none" stroke="var(--ink)" strokeWidth={2} strokeDasharray="4 3" />}
            {total > 0 ? <Pie r={r} parts={[p!.company, p!.franchise, p!.licence]} /> : (
              <circle r={8} fill={c.entered ? "var(--cream-deep)" : "var(--paper)"} stroke="var(--ink)" strokeWidth={1.5} strokeDasharray={c.exited ? "2 2" : undefined} />
            )}
            {p?.building ? <circle cx={r - 2} cy={-r + 2} r={4.5} fill="var(--amber)" stroke="var(--ink)" strokeWidth={1} /> : null}
            <text y={r + 18} textAnchor="middle" fontSize="16" fontWeight="800" paintOrder="stroke" stroke="var(--paper)" strokeWidth={3} fill="var(--ink)" fontFamily="var(--font-body)">{c.name}{total ? ` · ${total}` : ""}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Pie({ r, parts }: { r: number; parts: number[] }) {
  const total = parts.reduce((a, b) => a + b, 0);
  const nonZero = parts.filter((x) => x > 0).length;
  if (nonZero === 1) return <circle r={r} fill={OWN_COLOUR[parts.findIndex((x) => x > 0)]} stroke="var(--ink)" strokeWidth={1.5} />;
  let a0 = -Math.PI / 2;
  return (
    <g>
      {parts.map((n, i) => {
        if (!n) return null;
        const a1 = a0 + (n / total) * Math.PI * 2;
        const d = `M0 0 L${r * Math.cos(a0)} ${r * Math.sin(a0)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)} Z`;
        a0 = a1;
        return <path key={i} d={d} fill={OWN_COLOUR[i]} />;
      })}
      <circle r={r} fill="none" stroke="var(--ink)" strokeWidth={1.5} />
    </g>
  );
}

/** Why HQ can't pay `cost` right now (undefined when it can). */
function cantAfford(e: EmpireState, cost: number | undefined): string | undefined {
  if (!cost || cost <= 0 || spendable(e) >= cost) return undefined;
  return `Needs ${pounds(cost)}; HQ can spend ${pounds(Math.max(0, spendable(e)))}`;
}
const AFFORD_HELP = "HQ can spend its cash plus a bank facility that grows as sites open. Move cash from the flagship, or wait for sites to trade.";
const pounds = (p: number) => `£${Math.round(p / 100).toLocaleString("en-GB")}`;

/** A button the franchisee association may block, or that HQ may not be able to pay for: disabled with the reason. */
function Blockable({ e, cmd, send, children, className = "btn btn--sm", title, cost }: { e: EmpireState; cmd: EmpireCommand; send: (c: EmpireCommand) => void; children: React.ReactNode; className?: string; title?: string; cost?: number }) {
  const assoc = associationBlocks(e, cmd);
  const blocked = assoc ?? cantAfford(e, cost);
  return (
    <span className="blockable">
      <button className={className} disabled={!!blocked} title={assoc ?? (blocked ? AFFORD_HELP : title)} onClick={() => send(cmd)}>{children}</button>
      {blocked && <span className="xs muted blockable__why">{blocked}</span>}
    </span>
  );
}

function CityPanel({ e, city, send }: { e: EmpireState; city: City; send: (c: EmpireCommand) => void }) {
  const sites = e.sites.filter((s) => s.cityId === city.id && s.status !== "closed");
  const live = sites.filter((s) => s.status === "open");
  const avgRev = live.length ? live.reduce((a, s) => a + s.revenueYear, 0) / live.length : 0;
  const sat = live.length ? live.reduce((a, s) => a + s.saturationPenalty, 0) / live.length : 0;
  const region = e.regions.find((r) => r.id === city.regionId);
  const blurb = extras.world.cities.find((c) => c.id === city.id)?.blurb;
  const rules = extras.countries.countries.find((c) => c.name === city.country)?.rules ?? [];
  const applicant = e.applicants[0];
  const cost = buildCost(city, e.brand.formula.driveThru, e.hq.priceLevel);
  return (
    <div className="card stack stack--sm">
      <div className="card__title"><h3>{city.name}, {city.country}</h3><span className="xs faint">{region?.name}</span></div>
      {blurb && <p className="small muted">{blurb}</p>}
      <dl className="facts">
        <dt>Population</dt><dd>{(city.population / 1e6).toFixed(1)}m</dd>
        <dt><Term id="costIndex" /></dt><dd>×{city.costIndex.toFixed(2)}</dd>
        <dt>Sites</dt><dd>{live.length}{sites.length > live.length ? ` (+${sites.length - live.length} building)` : ""}</dd>
        <dt><Term id="takings">Sales a year (average)</Term></dt><dd>{live.length ? <MoneyText pence={avgRev} whole /> : "—"} <span className="xs muted">(collapse below £400k)</span></dd>
        <dt><Term id="saturation" /></dt><dd>{Math.round(sat * 100)}%</dd>
        {city.localChampion && <><dt>Local champion</dt><dd>{city.localChampion} ({Math.round(city.championStrength * 100)}%)</dd></>}
      </dl>
      {rules.length > 0 && (
        <div className="callout" role="note">
          <b>Country rules{city.localised ? " (menu localised ✓)" : ""}</b>
          <ul className="small">{rules.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      <div className="row row--wrap">
        {!city.entered && !city.exited && (
          <Blockable e={e} send={send} className="btn btn--primary btn--sm" cost={cityEntryCost(e, city)} cmd={{ type: "ENTER_CITY", cityId: city.id }}>Enter {city.name} · <MoneyText pence={cityEntryCost(e, city)} whole /></Blockable>
        )}
        {!city.entered && !city.exited && spendable(e) >= cityEntryCost(e, city) && spendable(e) - cityEntryCost(e, city) < cost && (
          <p className="xs callout callout--warn" role="note">Entering leaves HQ <MoneyText pence={spendable(e) - cityEntryCost(e, city)} whole /> to spend, and a site here costs <MoneyText pence={cost} whole />. You'd be in {city.name} with nothing to open until more money comes in.</p>
        )}
        {city.entered && city.dietaryRules.length > 0 && !city.localised && (
          <Blockable e={e} send={send} cost={Math.round(EMPIRE.LOCALISE_COST * Math.max(0.6, city.costIndex) * e.hq.priceLevel)} cmd={{ type: "LOCALISE_MENU", cityId: city.id }}>Localise the menu · <MoneyText pence={Math.round(EMPIRE.LOCALISE_COST * Math.max(0.6, city.costIndex) * e.hq.priceLevel)} whole /></Blockable>
        )}
      </div>
      {city.entered && (
        <>
          <h4>Open a site <span className="xs muted">(builds in 90 days)</span></h4>
          {applicant && <UnlockedFormulaWarning e={e} />}
          <div className="opensite">
            {city.districts.map((d) => (
              <div key={d} className="opensite__row">
                <span className="spacer small"><b>{districtName(d)}</b></span>
                <Blockable e={e} send={send} cost={cost} cmd={{ type: "OPEN_SITE", cityId: city.id, districtId: d, ownership: "company", land: "hqLease" }} title="Company-owned: you build it and keep the profit">
                  Company · <MoneyText pence={cost} whole />
                </Blockable>
                {applicant && (
                  <Blockable e={e} send={send} cmd={{ type: "OPEN_SITE", cityId: city.id, districtId: d, ownership: "franchise", land: "hqLease", applicantId: applicant.id }} title={`${applicant.name} pays the fee and ${Math.round(EMPIRE.FRANCHISEE_EQUITY_SHARE * 100)}% of the build; you sublet the land`}>
                    Franchise to {applicant.name.split(" ")[0]}
                  </Blockable>
                )}
              </div>
            ))}
          </div>
          {applicant ? (
            <p className="xs muted">{e.applicants.length} applicant{e.applicants.length === 1 ? "" : "s"} waiting. A franchisee needs <MoneyText pence={franchiseCashNeeded(e, city)} whole /> of their own.</p>
          ) : <p className="xs muted">No franchise applicants yet — recognition and fair terms bring them.</p>}
        </>
      )}
      {city.exited && <p className="xs muted">The brand was forced out of {city.country}.</p>}
    </div>
  );
}

/** One of a site's three numbers: big value, plain label, the real word beneath. */
function SiteNum({ id, label, value }: { id: TermId; label?: string; value: React.ReactNode }) {
  return <div className="sitenum"><div className="sitenum__v">{value}</div><Term id={id}>{label}</Term></div>;
}

function SitesPanel({ e, send, onFocusSite }: { e: EmpireState; send: (c: EmpireCommand) => void; onFocusSite: (id: string) => void }) {
  const list = e.sites.filter((s) => s.status !== "closed").slice(0, 40);
  const cityName = (id: string) => e.cities.find((c) => c.id === id)?.name ?? id;
  const applicant = e.applicants[0];
  return (
    <div className="card stack stack--sm">
      <div className="card__title"><h3>Sites</h3><span className="xs faint">{e.sites.filter((s) => s.status !== "closed").length}</span></div>
      <p className="xs muted">
        Each site is a dining room like yours: {boxTables(content, e.brand.formula.standardisation)} tables and a local crew of two chefs and two servers.
        Hands-on, you run the dining room{offPremiseNote(e)}.
      </p>
      {applicant && list.some((s) => s.ownership === "company" && !s.focused && s.status === "open") && <UnlockedFormulaWarning e={e} />}
      <ul className="sitelist">
        {list.map((s: SiteSummary) => (
          <li key={s.id} className={`site ${s.focused ? "site--focused" : ""}`}>
            <div className="row">
              <span className="site__dot" style={{ background: OWN_COLOUR[s.ownership === "company" ? 0 : s.ownership === "franchise" ? 1 : 2] }} aria-hidden="true" />
              <b className="spacer">{s.name}</b>
              <span className="xs muted">{cityName(s.cityId)} · {s.status === "building" ? `opens day ${s.opened + 1}` : s.ownership}</span>
            </div>
            {s.status === "open" && (
              <div className="sitenums">
                <SiteNum id="margin7d" value={<MoneyText pence={s.margin7d} whole tone />} />
                <SiteNum id="takings" label="Sales a year" value={<MoneyText pence={s.revenueYear} whole />} />
                <SiteNum id="brandConsistency" label="How alike" value={`${Math.round(s.brandConsistency)}/100`} />
                {s.land === "hqOwned" && <span className="pill pill--star sitenums__own">You own the land</span>}
              </div>
            )}
            {s.status === "open" && <SiteCovers e={e} s={s} />}
            {s.status === "open" && (
              <div className="row row--wrap" style={{ marginTop: 4 }}>
                {s.focused ? <span className="pill pill--star">You run this one</span> : <button className="btn btn--sm btn--ghost" onClick={() => onFocusSite(s.id)} title="Run this restaurant yourself from tomorrow morning">Run it hands-on</button>}
                {s.land !== "hqOwned" && <Blockable e={e} send={send} className="btn btn--sm btn--ghost" cost={Math.round(propertyPrice(s) * EMPIRE.PROPERTY_DEPOSIT_SHARE)} cmd={{ type: "BUY_PROPERTY", siteId: s.id }} title="40% deposit, 25-year mortgage">Buy the plot · <MoneyText pence={propertyPrice(s)} whole /></Blockable>}
                {s.ownership === "company" && !s.focused && applicant && <Blockable e={e} send={send} className="btn btn--sm btn--ghost" cmd={{ type: "SELL_FRANCHISE", siteId: s.id, applicantId: applicant.id }}>Sell franchise</Blockable>}
                {s.ownership !== "company" && <Blockable e={e} send={send} className="btn btn--sm btn--ghost" cmd={{ type: "BUY_BACK", siteId: s.id }}>Buy back</Blockable>}
                <Blockable e={e} send={send} className="btn btn--sm btn--ghost" cmd={{ type: "REMODEL", siteId: s.id }} title={GLOSSARY.remodel.explain}>Remodel</Blockable>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "takeaway counter, drive-thru and app add N% on top" for the formula's current tech (empty when nothing does). */
function offPremiseNote(e: EmpireState): string {
  const parts = [e.brand.formula.standardisation > EMPIRE.REF_STANDARDISATION && "the takeaway counter", e.brand.formula.driveThru && "drive-thru lanes", e.brand.formula.appOrdering && "app orders"].filter(Boolean);
  if (!parts.length) return "";
  const lane = Math.round((offPremise({ driveThru: e.brand.formula.driveThru }, e.brand) - 1) * 100);
  return `; ${parts.join(", ").replace(/, ([^,]*)$/, " and $1")} ${parts.length === 1 ? "adds" : "add"} about ${lane}% on top`;
}

/** Expected covers today, split into the dining room (what you'd see hands-on) and the off-premise lanes. */
function SiteCovers({ e, s }: { e: EmpireState; s: SiteSummary }) {
  const day = expectedSiteDay(content, e, s.id);
  const off = offPremise(s, e.brand);
  const room = Math.round(day.covers / off);
  const lanes = day.covers - room;
  const tables = s.tables ?? boxTables(content, e.brand.formula.standardisation);
  return (
    <div className="small muted">
      ~{day.covers} <Term id="covers" inline>guests</Term> today: {room} in the dining room ({tables} tables, <Term id="crewSkill" inline>crew skill</Term> {Math.round(s.staffQuality)}){lanes > 0 ? ` + ${lanes} takeaway` : ""}
    </div>
  );
}

function BrandPanel({ e, send }: { e: EmpireState; send: (c: EmpireCommand) => void }) {
  const f = e.brand.formula;
  const next = (["academy", "driveThru", "appOrdering"] as Tech[]).find((t) => !f[t]);
  const [budget, setBudget] = useState(20_000_000);
  const presets = extras.formulas;
  return (
    <div className="stack stack--sm">
      <div className="card stack stack--sm">
        <div className="card__title"><h3>The formula</h3></div>
        <div className="row"><Term id="standardisation" /><span className="spacer" /><b className="bignum__inline">{f.standardisation}</b></div>
        <Bar value={f.standardisation} tone="accent" size="sm" title="Standardisation" />
        <p className="small muted">
          {f.locked ? "Locked: every site cooks the same menu the same way." : "Not locked yet: each site does its own thing."} {f.fresh ? "Fresh, never frozen." : ""}{" "}
          Standardisation fits more tables in the box ({boxTables(content, f.standardisation)} now) and runs a takeaway counter
          (+{Math.round(EMPIRE.TAKEAWAY_PER_STD * 100)}% of the dining room per point above {EMPIRE.REF_STANDARDISATION}).
        </p>
        <div className="row row--wrap">
          {!f.locked && <button className="btn btn--primary btn--sm" onClick={() => send({ type: "SET_FORMULA", locked: true })}>Lock the formula</button>}
          {f.locked && next && !e.brand.research && <Blockable e={e} send={send} cost={Math.round(EMPIRE.TECH[next].cost * e.hq.priceLevel)} cmd={{ type: "RESEARCH", tech: next }}>Research {TECH_LABEL[next].toLowerCase()} · <MoneyText pence={Math.round(EMPIRE.TECH[next].cost * e.hq.priceLevel)} whole /></Blockable>}
          {e.brand.research && <span className="small">Researching {TECH_LABEL[e.brand.research.tech].toLowerCase()} · {e.brand.research.daysLeft} days</span>}
        </div>
        <div className="xs muted">Tech: {[f.academy && "academy", f.driveThru && "drive-thru", f.appOrdering && "app"].filter(Boolean).join(", ") || "none yet"}</div>
        <h4>Menu presets</h4>
        <div className="stack stack--sm">
          {presets.map((p) => (
            <button key={p.id} className="libdish libdish--btn" onClick={() => send({ type: "SET_FORMULA", menuDishIds: [...p.menuDishIds] })}>
              <b>{p.name}</b> <span className="xs muted">{p.menuDishIds.length} items{p.dietarySafe?.length ? ` · safe for ${p.dietarySafe.join(", ")}` : ""}</span>
              <span className="xs muted">{p.blurb}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="card stack stack--sm">
        <div className="card__title"><h3><Term id="recognition" /></h3></div>
        {e.regions.map((r) => {
          const rec = e.brand.recognition[r.id] ?? 0;
          return <Bar key={r.id} label={r.name} value={rec} tone={rec >= EMPIRE.WIN_RECOGNITION ? "basil" : "amber"} size="sm" showValue />;
        })}
      </div>
      <div className="card stack stack--sm">
        <div className="card__title"><h3>Campaigns</h3></div>
        <div className="row">
          <button className="btn btn--sm" onClick={() => setBudget(Math.max(5_000_000, budget - 5_000_000))}>−</button>
          <b><MoneyText pence={budget} whole /></b>
          <button className="btn btn--sm" onClick={() => setBudget(budget + 5_000_000)}>+</button>
        </div>
        <div className="row row--wrap">
          <Blockable e={e} send={send} cost={budget} cmd={{ type: "LAUNCH_CAMPAIGN", kind: "brand", budget }}>Brand campaign</Blockable>
          <Blockable e={e} send={send} cost={budget} cmd={{ type: "LAUNCH_CAMPAIGN", kind: "discount", budget }} title="+12% demand, −10% spend, franchisees hate it">Discount campaign</Blockable>
          <Blockable e={e} send={send} cost={budget} cmd={{ type: "LAUNCH_PRODUCT", name: "The Big One", budget, fit: "stretch" }} title="A gamble: 25% chance of a hit">Launch a new product</Blockable>
          {e.pendingIdea && <button className="btn btn--green btn--sm" onClick={() => send({ type: "LAUNCH_PRODUCT", name: e.pendingIdea!.name, budget, fit: "franchiseeIdea" })}>Launch “{e.pendingIdea.name}”</button>}
        </div>
      </div>
      <div className="card stack stack--sm">
        <div className="card__title"><h3>Suppliers</h3></div>
        {e.suppliers.map((s) => (
          <div key={s.id} className="row">
            <span className="spacer small"><b>{s.name}</b> <span className="xs muted">{s.category} · up to {Math.round(s.discountPct * 100)}% off · {Math.round(s.failureRisk * 100)}%/yr outage risk</span></span>
            {s.signed ? <span className="pill pill--star">{s.exclusive ? "exclusive" : "signed"}</span> : (
              <>
                <button className="btn btn--sm btn--ghost" onClick={() => send({ type: "SIGN_SUPPLIER", supplierId: s.id, exclusive: false })}>Sign</button>
                <button className="btn btn--sm btn--ghost" onClick={() => send({ type: "SIGN_SUPPLIER", supplierId: s.id, exclusive: true })} title="Full discount, full single-point-of-failure risk">Exclusive</button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Round 4 review (EMPIRE-NOTES open question 8c): before the formula is locked a franchised dining room barely covers
 * its rent, royalty and loan, so the operator loses money and mood slides. Say so wherever a franchise can be sold.
 */
export const UNLOCKED_FORMULA_WARNING = "Lock your formula first — franchisees of an unstandardised brand lose money.";
function UnlockedFormulaWarning({ e }: { e: EmpireState }) {
  if (e.brand.formula.locked) return null;
  return (
    <p className="small callout callout--warn" role="note" aria-label="Formula warning">
      <b>{UNLOCKED_FORMULA_WARNING}</b> Go to <b>The brand → Lock the formula</b>: every site then cooks the same menu the same way and gets an extra table and a takeaway counter. Even then a new franchisee only just gets by until drive-thru and app orders arrive, so watch their mood.
    </p>
  );
}

function ContractPanel({ e, send }: { e: EmpireState; send: (c: EmpireCommand) => void }) {
  const c = e.contract;
  const set = (patch: Partial<typeof c>) => send({ type: "SET_CONTRACT", contract: patch, applyTo: "new" });
  const rentIncome = e.property.reduce((a, p) => a + p.rentIncome, 0);
  const row = (term: TermId, label: string, value: string, field: "royaltyPct" | "adFundPct" | "rentPctOfSales", d: number) => (
    <div className="row contract__row">
      <span className="spacer"><Term id={term} /></span>
      <button className="btn btn--sm" aria-label={`Lower ${label}`} onClick={() => set({ [field]: Math.max(0, c[field] - d) })}>−</button>
      <b className="bignum__inline">{value}</b>
      <button className="btn btn--sm" aria-label={`Raise ${label}`} onClick={() => set({ [field]: c[field] + d })}>+</button>
    </div>
  );
  const attract = contractAttractiveness(c);
  return (
    <div className="card stack stack--sm">
      <div className="card__title"><h3>Franchise contract</h3><span className="xs faint">for new deals</span></div>
      <UnlockedFormulaWarning e={e} />
      <div className="row contract__row"><span className="spacer"><Term id="franchiseFee" /></span>
        <button className="btn btn--sm" aria-label="Lower fee" onClick={() => set({ fee: Math.max(0, c.fee - 500_000) })}>−</button>
        <b className="bignum__inline"><MoneyText pence={c.fee} whole /></b>
        <button className="btn btn--sm" aria-label="Raise fee" onClick={() => set({ fee: c.fee + 500_000 })}>+</button>
      </div>
      {row("royalty", "Royalty", `${(c.royaltyPct * 100).toFixed(1)}%`, "royaltyPct", 0.005)}
      {row("adFund", "Ad fund", `${(c.adFundPct * 100).toFixed(1)}%`, "adFundPct", 0.005)}
      {row("landRent", "Rent on your land", `${(c.rentPctOfSales * 100).toFixed(0)}%`, "rentPctOfSales", 0.01)}
      <Bar label="Applicants like it" value={Math.min(1.5, attract)} max={1.5} tone={attract < 0.6 ? "accent" : attract < 1 ? "amber" : "basil"} size="sm" />
      <p className="small muted"><Term id="take" inline>You take</Term> <b>{(contractTake(c) * 100).toFixed(1)}%</b> of sales. Higher take = more money per store and fewer, angrier franchisees. Rent income: <MoneyText pence={rentIncome} whole />/month.</p>
    </div>
  );
}
