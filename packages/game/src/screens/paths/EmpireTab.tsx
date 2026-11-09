import { useMemo, useRef, useState } from "react";
import type { GameState } from "@full-plate/sim-core";
import {
  associationBlocks, avgFranchiseeMood, boxTables, buildCost, cityEntryCost, contractAttractiveness, contractTake, developmentFacility, EMPIRE,
  expectedSiteDay, franchiseCashNeeded, franchiseOutlook, offPremise, openSites, propertyPrice, spendable, TECH_LABEL,
  type City, type EmpireCommand, type EmpireState, type FranchiseOutlook, type SiteSummary, type Tech,
} from "@full-plate/sim-empire";
import type { DistrictId } from "@full-plate/sim-core";
import { content, extras } from "../../sim";
import { dateLabel } from "../../lib/calendar";
import { MoneyText } from "../../components/MoneyText";
import { Bar } from "../../components/Bar";
import { compactMeals } from "../../components/StatusBar";
import { Term } from "../../components/Term";
import { Icon } from "../../components/Icon";
import { TAB_ICONS } from "../../components/Tabs";
import { GLOSSARY, type TermId } from "../../lib/glossary";
import type { PathMeta } from "../../state/paths";
import { CityMap, OWN_COLOUR, WorldMap } from "./WorldMap";

interface Props {
  game: GameState;
  meta: PathMeta;
  empire: EmpireState;
  send: (cmd: EmpireCommand) => void;
  onFocusSite: (siteId: string) => void;
}

const districtName = (id: string) => content.districts.find((d) => d.id === id)?.name ?? id.replace("_", " ");

/** Round 5: three cards a child can find things in (My shops = city + sites, The brand, Money = HQ, flagship till, contract). */
type Panel = "shops" | "brand" | "money";
const PANEL_LABEL: Record<Panel, string> = { shops: "🏪 My shops", brand: "🍔 The brand", money: "💷 Money" };

/** Path A screen: world map, city/site panels, brand & tech, contract, suppliers, campaigns (EMPIRE-NOTES §1 "What the map screen shows"). */
export function EmpireTab({ game, meta, empire: e, send, onFocusSite }: Props) {
  const [picked, setPicked] = useState<string>(e.hq.homeCityId);
  const [panel, setPanel] = useState<Panel>("shops");
  const [move, setMove] = useState(0);
  // Round 8: the map card shows the world, or the picked city's district map.
  const [mapView, setMapView] = useState<"world" | "city">("world");
  const sideRef = useRef<HTMLElement>(null);
  const city = e.cities.find((c) => c.id === picked);
  const pickCity = (id: string) => { setPicked(id); setPanel("shops"); setMapView("city"); };
  /** "Open here" on the city map: the side panel's open-site row for that district (or the Enter button), focused. */
  const openHere = (districtId: string | null) => {
    setPanel("shops");
    requestAnimationFrame(() => {
      const root = sideRef.current;
      const target = districtId === null
        ? root?.querySelector<HTMLButtonElement>("[data-enter-city] button")
        : root?.querySelector<HTMLButtonElement>(`[data-opensite="${districtId}"] button:not(:disabled)`) ?? root?.querySelector<HTMLButtonElement>(`[data-opensite="${districtId}"] button`);
      const row = target?.closest<HTMLElement>("[data-opensite], [data-enter-city]");
      row?.scrollIntoView?.({ block: "center", behavior: "smooth" });
      row?.classList.add("opensite__row--flash");
      window.setTimeout(() => row?.classList.remove("opensite__row--flash"), 1600);
      target?.focus({ preventScroll: true });
    });
  };
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
            {mapView === "city" && city
              ? <CityMap e={e} city={city} onBack={() => setMapView("world")} onOpenHere={openHere} />
              : <WorldMap e={e} picked={picked} onPick={pickCity} />}
          </div>
          <div className="card">
            <div className="card__title"><h3>News from the chain</h3></div>
            <ul className="empire__log">
              {recent.length === 0 && <li className="muted small">Nothing yet. Open a site to get going.</li>}
              {recent.map((x, i) => <li key={i} className={`careerlog__line careerlog__line--${x.tone}`}>{x.text}</li>)}
            </ul>
          </div>
        </div>

        <aside className="stack empire__side" ref={sideRef}>
          <div className="tabs tabs--sm empire__tabs" role="tablist" aria-label="Empire panels">
            {(["shops", "brand", "money"] as Panel[]).map((p) => (
              <button key={p} role="tab" aria-selected={panel === p} className={`tab ${panel === p ? "tab--active" : ""}`} onClick={() => setPanel(p)}>
                <span className="tab__icon" aria-hidden="true"><Icon name={TAB_ICONS[p]!} size={20} /></span> <span className="tab__label">{PANEL_LABEL[p].replace(/^\S+ /, "")}</span>
              </button>
            ))}
          </div>
          {panel === "shops" && (
            <>
              <ShopsHero e={e} picked={picked} onPick={pickCity} />
              {city && <CityPanel e={e} city={city} send={send} />}
              <SitesPanel e={e} send={send} onFocusSite={onFocusSite} cityId={picked} />
            </>
          )}
          {panel === "brand" && <><BrandHero e={e} /><BrandPanel e={e} send={send} /></>}
          {panel === "money" && (
            <>
              <MoneyHero e={e} />
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
              <BoardMinutes e={e} />
              <ContractPanel e={e} send={send} />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

/** "Mar · Year 3": the month of a board meeting. */
const monthLabel = (day: number) => dateLabel(day).replace(/^\w+ \d+ /, "");

/** Round 6: the board's minutes, one line a month (newest first): what was decided and what HQ made. */
function BoardMinutes({ e }: { e: EmpireState }) {
  const minutes = (e.boardMinutes ?? []).slice(-12).reverse();
  return (
    <div className="card stack stack--sm" aria-label="Board meetings">
      <div className="card__title"><h3><Term id="boardMeeting">Board meetings</Term></h3><span className="xs faint">once a month</span></div>
      {e.boardMeeting && <p className="small"><b>This month's meeting is waiting for you.</b></p>}
      {minutes.length === 0 ? <p className="small muted">The first meeting is at the end of this month.</p> : (
        <ul className="boardminutes">
          {minutes.map((m) => (
            <li key={m.id} className="small">
              <b>{monthLabel(m.day)}</b> · {m.text} · HQ {m.net >= 0 ? "made" : "lost"} <MoneyText pence={Math.abs(m.net)} whole />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A big number with its plain label above (Money and Sites cards). */
function BigNum({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return <div className="bignum"><div className="bignum__k">{label}</div><div className="bignum__v">{value}</div></div>;
}

/** Round 7: shops per city, biggest first, as stacked CSS bars (own / franchise / licence). Tapping a row picks the city. */
export function shopsByCity(e: EmpireState): { cityId: string; name: string; parts: [number, number, number]; total: number }[] {
  const rows = new Map<string, [number, number, number]>();
  for (const s of e.sites) {
    if (s.status !== "open") continue;
    const r = rows.get(s.cityId) ?? [0, 0, 0];
    r[s.ownership === "company" ? 0 : s.ownership === "franchise" ? 1 : 2]++;
    rows.set(s.cityId, r);
  }
  return [...rows.entries()]
    .map(([cityId, parts]) => ({ cityId, name: e.cities.find((c) => c.id === cityId)?.name ?? cityId, parts, total: parts[0] + parts[1] + parts[2] }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

function ShopsHero({ e, picked, onPick }: { e: EmpireState; picked: string; onPick: (id: string) => void }) {
  const rows = shopsByCity(e);
  const open = rows.reduce((a, r) => a + r.total, 0);
  const building = e.sites.filter((x) => x.status === "building").length;
  const max = Math.max(1, ...rows.map((r) => r.total));
  const shown = rows.slice(0, 6);
  return (
    <div className="card hero" aria-label="Shops summary">
      <div className="hero__num"><b>{open}</b> <span>shop{open === 1 ? "" : "s"} open{building ? `, ${building} being built` : ""}</span></div>
      {shown.length > 0 && (
        <ul className="citybars" aria-label="Shops by city">
          {shown.map((r) => (
            <li key={r.cityId}>
              <button className={`citybar ${r.cityId === picked ? "citybar--on" : ""}`} aria-pressed={r.cityId === picked} onClick={() => onPick(r.cityId)} aria-label={`${r.name}: ${r.parts[0]} your own, ${r.parts[1]} franchise, ${r.parts[2]} licence`}>
                <span className="citybar__name">{r.name}</span>
                <span className="citybar__track" aria-hidden="true">
                  {r.parts.map((n, i) => n > 0 && <span key={i} className="citybar__part" style={{ width: `${(n / max) * 100}%`, background: OWN_COLOUR[i] }} />)}
                </span>
                <b className="citybar__n">{r.total}</b>
              </button>
            </li>
          ))}
        </ul>
      )}
      {rows.length > shown.length && <p className="xs muted">…and {rows.length - shown.length} more {rows.length - shown.length === 1 ? "city" : "cities"}. Tap a city on the map to see it.</p>}
    </div>
  );
}

function BrandHero({ e }: { e: EmpireState }) {
  const won = e.regions.filter((r) => (e.brand.recognition[r.id] ?? 0) >= EMPIRE.WIN_RECOGNITION).length;
  const share = Math.min(100, (e.mealsServedTotal / EMPIRE.WIN_MEALS) * 100);
  return (
    <div className="card hero" aria-label="Brand summary">
      <div className="hero__num"><b>{won}</b> <span>of {e.regions.length} regions know your name</span></div>
      <p className="small muted">A region "knows you" at {EMPIRE.WIN_RECOGNITION}. Get every region there to win, or serve a billion meals.</p>
      <ul className="regionbars" aria-label="How many people know you, by region">
        {e.regions.map((r) => {
          const rec = Math.round(e.brand.recognition[r.id] ?? 0);
          return (
            <li key={r.id} className="regionbar">
              <span className="regionbar__name">{r.name}</span>
              <span className="regionbar__track"><span className={`regionbar__fill ${rec >= EMPIRE.WIN_RECOGNITION ? "regionbar__fill--won" : ""}`} style={{ width: `${rec}%` }} /><i className="regionbar__goal" style={{ left: `${EMPIRE.WIN_RECOGNITION}%` }} /></span>
              <b className="regionbar__n">{rec}</b>
            </li>
          );
        })}
      </ul>
      <div className="mealsline small"><span>🍔 Meals served</span><span className="mealsline__track"><span style={{ width: `${Math.max(0.6, share)}%` }} /></span><b>{compactMeals(e.mealsServedTotal)}</b><span className="muted">of {compactMeals(EMPIRE.WIN_MEALS)}</span></div>
    </div>
  );
}

/** "Mar": the month initial for a board minute. */
const monthShort = (day: number) => dateLabel(day).split(" ")[2] ?? "";

function MoneyHero({ e }: { e: EmpireState }) {
  const months = (e.boardMinutes ?? []).slice(-12);
  const max = Math.max(1, ...months.map((m) => Math.abs(m.net)));
  const last = e.hq.income30d;
  return (
    <div className="card hero" aria-label="Money summary">
      <div className="hero__num"><b className={last < 0 ? "money--neg" : "money--pos"}><MoneyText pence={Math.abs(last)} whole /></b> <span>HQ {last < 0 ? "lost" : "made"} in the last 30 days</span></div>
      {months.length > 1 ? (
        <div className="monthbars" role="img" aria-label={`HQ money each month: ${months.map((m) => `${monthShort(m.day)} ${m.net >= 0 ? "made" : "lost"} ${pounds(Math.abs(m.net))}`).join(", ")}`}>
          {months.map((m) => (
            <div key={m.id} className="monthbars__col">
              <span className={`monthbars__bar ${m.net < 0 ? "monthbars__bar--neg" : ""}`} style={{ height: `${Math.max(4, (Math.abs(m.net) / max) * 100)}%` }} />
              <span className="monthbars__m">{monthShort(m.day)}</span>
            </div>
          ))}
        </div>
      ) : <p className="small muted">After a couple of board meetings, each month's money shows here as a bar.</p>}
    </div>
  );
}

function Stat({ k, v, sub }: { k: React.ReactNode; v: React.ReactNode; sub?: React.ReactNode }) {
  return <div className="kpi"><div className="kpi__k">{k}</div><div className="kpi__v">{v}</div>{sub && <div className="xs muted">{sub}</div>}</div>;
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
        <dt><Term id="takings">Sales a year (average)</Term></dt><dd>{live.length ? <><MoneyText pence={avgRev} whole /> <span className="xs muted">(a shop below <MoneyText pence={Math.round(EMPIRE.COLLAPSE_REVENUE_YEAR * e.hq.priceLevel)} whole /> is in trouble)</span></> : "no shops yet"}</dd>
        <dt><Term id="saturation" /></dt><dd>{Math.round(sat * 100)}%</dd>
        {city.localChampion && <><dt>Local champion</dt><dd>{city.localChampion} ({Math.round(city.championStrength * 100)}%)</dd></>}
      </dl>
      {rules.length > 0 && (
        <div className="callout" role="note">
          <b>Country rules{city.localised ? " (menu localised ✓)" : ""}</b>
          <ul className="small">{rules.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
      <div className="row row--wrap" data-enter-city={city.entered || city.exited ? undefined : city.id}>
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
              <div key={d} className="opensite__row" data-opensite={d}>
                <span className="spacer small"><b>{districtName(d)}</b></span>
                <Blockable e={e} send={send} cost={cost} cmd={{ type: "OPEN_SITE", cityId: city.id, districtId: d, ownership: "company", land: "hqLease" }} title="Company-owned: you build it and keep the profit">
                  Company · <MoneyText pence={cost} whole />
                </Blockable>
                {applicant && (
                  <Blockable e={e} send={send} cmd={{ type: "OPEN_SITE", cityId: city.id, districtId: d, ownership: "franchise", land: "hqLease", applicantId: applicant.id }} title={`${applicant.name} pays the fee and ${Math.round(EMPIRE.FRANCHISEE_EQUITY_SHARE * 100)}% of the build; you sublet the land`}>
                    Franchise to {applicant.name.split(" ")[0]}
                  </Blockable>
                )}
                {applicant && <DistrictOutlook e={e} cityId={city.id} districtId={d} />}
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

const SITES_SHOWN = 5;
function SitesPanel({ e, send, onFocusSite, cityId }: { e: EmpireState; send: (c: EmpireCommand) => void; onFocusSite: (id: string) => void; cityId: string }) {
  const [all, setAll] = useState(false);
  // Round 7: the picked city's shops, the one you run first; five at a time (a year-4 brand has 70).
  const inCity = e.sites.filter((s) => s.status !== "closed" && s.cityId === cityId).sort((a, b) => Number(b.focused) - Number(a.focused));
  const list = all ? inCity : inCity.slice(0, SITES_SHOWN);
  const cityName = (id: string) => e.cities.find((c) => c.id === id)?.name ?? id;
  const applicant = e.applicants[0];
  const elsewhere = e.sites.filter((s) => s.status !== "closed").length - inCity.length;
  return (
    <div className="card stack stack--sm">
      <div className="card__title"><h3>Shops in {cityName(cityId)}</h3><span className="xs faint">{inCity.length}{elsewhere ? ` here · ${elsewhere} elsewhere` : ""}</span></div>
      {inCity.length === 0 && <p className="small muted">No shops here yet. Pick a city with shops on the map, or open one above.</p>}
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
      {inCity.length > SITES_SHOWN && (
        <button className="btn btn--ghost btn--tap" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${inCity.length} shops in ${cityName(cityId)}`}
        </button>
      )}
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
 * Round 5: once locked, a fair contract clears a modest profit in year one; the contract panel says how much.
 */
export const UNLOCKED_FORMULA_WARNING = "Lock your formula first — franchisees of an unstandardised brand lose money.";
function UnlockedFormulaWarning({ e }: { e: EmpireState }) {
  if (e.brand.formula.locked) return null;
  return (
    <p className="small callout callout--warn" role="note" aria-label="Formula warning">
      <b>{UNLOCKED_FORMULA_WARNING}</b> Go to <b>The brand → Lock the formula</b>: every site then cooks the same menu the same way and gets an extra table and a takeaway counter. The contract panel shows what a new franchisee should clear in year one.
    </p>
  );
}

/** The home city's district where a new franchisee does best under the current terms (ties: the city's order). */
export function bestHomeOutlook(e: EmpireState): FranchiseOutlook {
  const home = e.cities.find((c) => c.id === e.hq.homeCityId)!;
  return home.districts.map((d) => franchiseOutlook(content, e, { cityId: home.id, districtId: d })).reduce((a, b) => (b.net > a.net ? b : a));
}

/** Round 5 review: a franchisee's year one in this district, in a child's words (beside its Franchise button). */
const OUTLOOK_WORDS: Record<FranchiseOutlook["verdict"], string> = { fair: "they'd do fine", thin: "they'd only just get by", loses: "they'd lose money" };
const OUTLOOK_ICON: Record<FranchiseOutlook["verdict"], string> = { fair: "👍", thin: "😐", loses: "👎" };
function DistrictOutlook({ e, cityId, districtId }: { e: EmpireState; cityId: string; districtId: DistrictId }) {
  const o = useMemo(() => franchiseOutlook(content, e, { cityId, districtId }), [e, cityId, districtId]);
  return (
    <span className={`verdict verdict--${o.verdict}`}>
      <span aria-hidden="true">{OUTLOOK_ICON[o.verdict]}</span>
      <span className={`opensite__outlook opensite__outlook--${o.verdict}`} aria-label={`Franchise outlook ${districtName(districtId)}`}>{OUTLOOK_WORDS[o.verdict]}</span>
    </span>
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
  // Round 5: a new franchisee's year one under these terms (HQ holding the lease), rounded to £1,000. Round 5 review:
  // the home city's best district, named — its first district was arbitrary, and districts differ by ±5 points (each
  // city's Franchise buttons carry their own verdict).
  const outlook = useMemo(() => bestHomeOutlook(e), [e]);
  const about = Math.round(Math.abs(outlook.net) / 100_000) * 100_000;
  const where = `${districtName(outlook.districtId)}, ${e.cities.find((x) => x.id === outlook.cityId)?.name ?? ""}`;
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
      <p className="small" aria-label="Franchisee outlook">
        {outlook.net >= 0 ? <>Your franchisee should clear about <b><MoneyText pence={about} whole /></b> a year</> : <>Your franchisee would lose about <b><MoneyText pence={about} whole /></b> a year</>}
        {` in your best spot (${where})`}
        {outlook.verdict === "fair" ? " — fair." : outlook.verdict === "thin" ? " — they'll only just get by." : " — they'll lose money."}
        {outlook.verdict !== "fair" && e.suppliers.some((s) => !s.signed) ? " Supply deals would cut their food bill." : ""}
        {" Other places differ: each city shows it next to the Franchise buttons."}
      </p>
      <p className="small muted"><Term id="take" inline>You take</Term> <b>{(contractTake(c) * 100).toFixed(1)}%</b> of sales. Higher take = more money per store and fewer, angrier franchisees. Rent income: <MoneyText pence={rentIncome} whole />/month.</p>
    </div>
  );
}
