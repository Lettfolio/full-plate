/**
 * Empire demo: a stylised world map of 12 invented cities in 5 regions, site pins, brand and contract
 * panels, an event log, and "advance 1 year" under a scripted style (or by hand: click a city to act).
 * A proof that the package works, not the final UI (see docs/EMPIRE-NOTES.md for the real map screen).
 */
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { content } from "@full-plate/content";
import {
  applyEmpireCommand,
  avgFranchiseeMood,
  buildCost,
  contractTake,
  openSites,
  serialize,
  stepEmpireDay,
  EMPIRE,
  TECH_LABEL,
  type City,
  type EmpireCommand,
  type EmpireEvent,
  type EmpireState,
  type Tech,
} from "../src/index";
import { playStyleWeek, startingEmpire, type EmpireStyle } from "../src/strategies";

const STYLE_LABEL: Record<EmpireStyle | "manual", string> = {
  franchise: "Franchise fast",
  company: "Company-owned, steady",
  innout: "Fresh & slow (In-N-Out)",
  manual: "Manual (no autopilot)",
};

const m = (p: number) => {
  const pounds = p / 100;
  if (Math.abs(pounds) >= 1e9) return `£${(pounds / 1e9).toFixed(2)}bn`;
  if (Math.abs(pounds) >= 1e6) return `£${(pounds / 1e6).toFixed(1)}m`;
  if (Math.abs(pounds) >= 1e3) return `£${(pounds / 1e3).toFixed(0)}k`;
  return `£${pounds.toFixed(0)}`;
};
const meals = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}bn` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Hand-drawn blobs for the five regions (0-1000 × 0-500). */
const LANDMASSES: { regionId: string; d: string }[] = [
  { regionId: "isles", d: "M410 44 q36 -20 74 -2 q34 22 26 62 q10 40 -16 70 q-34 22 -74 6 q-30 -26 -22 -66 q-12 -40 12 -70z" },
  { regionId: "mainland", d: "M520 120 q40 -22 90 -6 q36 14 34 44 q-6 30 -44 40 q-40 12 -70 -4 q-28 -20 -22 -48 q2 -16 12 -26z" },
  { regionId: "westland", d: "M100 130 q60 -40 140 -10 q40 20 30 70 q-10 50 -70 60 q-60 10 -100 -20 q-30 -30 -20 -70 q6 -20 20 -30z" },
  { regionId: "sunrise", d: "M720 200 q40 -60 120 -50 q70 10 80 60 q6 40 -40 80 q-50 40 -120 20 q-50 -16 -48 -60 q0 -30 8 -50z" },
  { regionId: "crescent", d: "M592 248 q30 -16 70 -2 q40 14 44 44 q2 30 -36 42 q-40 10 -66 -10 q-24 -20 -20 -46 q2 -18 8 -28z" },
];

function App() {
  // ?style=company&seed=2&years=10 fast-forwards on load (for screenshots and quick comparisons).
  const params = new URLSearchParams(location.search);
  const [style, setStyle] = useState<EmpireStyle | "manual">(() => (params.get("style") as EmpireStyle | null) ?? "franchise");
  const [seed, setSeed] = useState(() => Number(params.get("seed") ?? 1));
  const [boot] = useState(() => fastForward(startingEmpire(content, seed), style, Number(params.get("years") ?? 0) * EMPIRE.DAYS_PER_YEAR));
  const [e, setE] = useState<EmpireState>(boot.empire);
  const [log, setLog] = useState<EmpireEvent[]>(() => boot.events.slice().reverse().filter((x) => x.kind !== "rent_review" && x.kind !== "applicant").slice(0, 300));
  const [picked, setPicked] = useState<string | undefined>("harbourton");
  const [busy, setBusy] = useState(false);

  const push = (evs: EmpireEvent[]) => setLog((l) => [...evs.slice().reverse().filter((x) => x.kind !== "rent_review" && x.kind !== "applicant"), ...l].slice(0, 300));

  function act(cmd: EmpireCommand) {
    const r = applyEmpireCommand(content, e, cmd);
    setE(r.empire);
    push(r.events);
  }

  function advance(days: number) {
    setBusy(true);
    // Run in a timeout so the button shows its busy state.
    setTimeout(() => {
      const r = fastForward(e, style, days);
      setE(r.empire);
      push(r.events);
      setBusy(false);
    }, 10);
  }

  function reset(nextSeed = seed) {
    setE(startingEmpire(content, nextSeed));
    setLog([]);
  }

  const open = openSites(e);
  const year = Math.floor(e.hq.day / EMPIRE.DAYS_PER_YEAR);
  const mood = e.franchisees.some((f) => f.sites.length) ? avgFranchiseeMood(e) : undefined;
  const city = e.cities.find((c) => c.id === picked);

  return (
    <>
      <header>
        <h1>{e.brand.name}</h1>
        <span className="sub">
          Year {year + 1}, day {(e.hq.day % EMPIRE.DAYS_PER_YEAR) + 1}
          {e.status === "bankrupt" ? " — bankrupt" : ""}
        </span>
        <div className="toolbar">
          <label>
            <span className="sr-only">Style </span>
            <select value={style} onChange={(ev) => setStyle(ev.target.value as EmpireStyle | "manual")} aria-label="Autopilot style">
              {(Object.keys(STYLE_LABEL) as (EmpireStyle | "manual")[]).map((k) => (
                <option key={k} value={k}>
                  {STYLE_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => advance(30)} disabled={busy || e.status !== "running"}>
            +1 month
          </button>
          <button className="primary" onClick={() => advance(EMPIRE.DAYS_PER_YEAR)} disabled={busy || e.status !== "running"}>
            {busy ? "Simulating…" : "Advance 1 year"}
          </button>
          <button
            onClick={() => {
              const s = seed + 1;
              setSeed(s);
              reset(s);
            }}
          >
            New seed ({seed + 1})
          </button>
          <button onClick={() => reset()}>Reset</button>
        </div>
      </header>

      <section className="stats" aria-label="Empire totals">
        <Stat k="Sites open" v={String(open.length)} />
        <Stat k="Company / franchise" v={`${open.filter((s) => s.ownership === "company").length} / ${open.filter((s) => s.ownership !== "company").length}`} />
        <Stat k="Meals served" v={meals(e.mealsServedTotal)} />
        <Stat k="HQ cash" v={m(e.hq.cash)} tone={e.hq.cash < 0 ? "bad" : undefined} />
        <Stat k="HQ net / month" v={m(e.hq.income30d)} tone={e.hq.income30d < 0 ? "bad" : "good"} />
        <Stat k="Franchisee mood" v={mood === undefined ? "—" : mood.toFixed(0)} tone={mood !== undefined && mood < EMPIRE.ASSOCIATION_MOOD ? "bad" : undefined} />
        <Stat k="Plots owned" v={String(e.property.length)} />
      </section>

      <div className="layout">
        <div className="main-col">
        <div className="card map">
          <WorldMap e={e} picked={picked} onPick={setPicked} />
          <div className="legend">
            <span style={{ ["--c" as string]: "var(--tomato)" }}>Company-owned</span>
            <span style={{ ["--c" as string]: "var(--amber)" }}>Franchise</span>
            <span style={{ ["--c" as string]: "var(--plum)" }}>Licence</span>
            <span style={{ ["--c" as string]: "var(--paper)" }}>City not entered</span>
          </div>
        </div>
        <div className="lower">
        <div className="card">
          <h2>Event log</h2>
          <ul className="log" aria-live="polite">
            {log.length === 0 && <li>Pick a style and press “Advance 1 year”, or click a city to act by hand.</li>}
            {log.map((ev, i) => (
              <li key={i} className={ev.tone}>
                <span className="d">Y{Math.floor(ev.day / 360) + 1} D{(ev.day % 360) + 1}</span>
                {ev.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="card chart">
          <h2>Sites over time</h2>
          <Sparkline values={e.history.map((h) => h.sites)} />
          <h2 style={{ marginTop: 10 }}>HQ cash</h2>
          <Sparkline values={e.history.map((h) => h.hqCash)} />
          <p className="note">
            Save size: {(serialize(e).length / 1024).toFixed(0)} KB · {e.sites.length} sites stepped per day
          </p>
        </div>
        </div>
        </div>

        <aside className="side">
          {e.win.achieved && (
            <div className="card win">
              <h2>Empire won</h2>
              <p style={{ margin: 0 }}>
                {e.win.reason === "meals" ? "A billion meals served" : "Present and profitable in every region"} in year {Math.floor((e.win.achievedDay ?? 0) / EMPIRE.DAYS_PER_YEAR) + 1}.
              </p>
            </div>
          )}
          {e.association.active && (
            <div className="card warn">
              <h2>Franchisee association</h2>
              <p style={{ margin: 0 }}>Owners have organised. Fee rises, forced remodels and discount campaigns are blocked until mood is back above {EMPIRE.ASSOCIATION_DISSOLVE_MOOD}.</p>
            </div>
          )}
          {city && <CityPanel e={e} city={city} act={act} />}
          <BrandPanel e={e} act={act} />
          <ContractPanel e={e} act={act} />
        </aside>
      </div>

    </>
  );
}

/** Steps `days` days, letting the scripted style make its weekly decisions (none when manual). */
function fastForward(start: EmpireState, style: EmpireStyle | "manual", days: number): { empire: EmpireState; events: EmpireEvent[] } {
  let cur = start;
  const evs: EmpireEvent[] = [];
  for (let d = 0; d < days && cur.status === "running"; d++) {
    if (style !== "manual" && cur.hq.day % 7 === 0) {
      const p = playStyleWeek(content, cur, style);
      cur = p.empire;
      evs.push(...p.events);
    }
    const r = stepEmpireDay(content, cur);
    cur = r.empire;
    evs.push(...r.events);
  }
  return { empire: cur, events: evs };
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: "good" | "bad" | undefined }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className={`v ${tone ?? ""}`}>{v}</div>
    </div>
  );
}

function WorldMap({ e, picked, onPick }: { e: EmpireState; picked?: string | undefined; onPick: (id: string) => void }) {
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
  const scandalRegions = new Set(e.effects.filter((f) => f.kind === "scandal" && f.regionId).map((f) => f.regionId!));
  return (
    <svg viewBox="0 0 1000 400" role="img" aria-label="World map of cities and sites">
      {LANDMASSES.map((l) => {
        const rec = e.brand.recognition[l.regionId] ?? 0;
        return (
          <path
            key={l.regionId}
            d={l.d}
            fill="var(--land)"
            stroke={scandalRegions.has(l.regionId) ? "var(--tomato)" : "var(--land-edge)"}
            strokeWidth={scandalRegions.has(l.regionId) ? 4 : 2}
            style={{ filter: `saturate(${0.6 + rec / 100})` }}
          />
        );
      })}
      {e.regions.map((r) => {
        const rec = e.brand.recognition[r.id] ?? 0;
        const lx = r.id === "isles" ? 350 : r.id === "mainland" ? 560 : r.id === "westland" ? 180 : r.id === "sunrise" ? 820 : 640;
        const ly = r.id === "isles" ? 120 : r.id === "mainland" ? 225 : r.id === "westland" ? 290 : r.id === "sunrise" ? 345 : 350;
        return (
          <g key={r.id} transform={`translate(${lx} ${ly})`}>
            <text textAnchor="middle" fontSize="15" fontWeight="900" fill="var(--ink-soft)">
              {r.name}
            </text>
            <rect x={-40} y={6} width={80} height={6} rx={3} fill="var(--cream-deep)" />
            <rect x={-40} y={6} width={0.8 * rec} height={6} rx={3} fill={rec >= EMPIRE.WIN_RECOGNITION ? "var(--basil)" : "var(--amber)"} />
          </g>
        );
      })}
      {e.cities.map((c) => {
        const p = pins.get(c.id);
        const total = p ? p.company + p.franchise + p.licence : 0;
        const r = 7 + Math.min(16, Math.sqrt(total) * 2);
        const sel = c.id === picked;
        return (
          <g key={c.id} transform={`translate(${c.x} ${c.y})`} onClick={() => onPick(c.id)} style={{ cursor: "pointer" }} role="button" aria-label={`${c.name}: ${total} sites`}>
            {sel && <circle r={r + 6} fill="none" stroke="var(--ink)" strokeWidth={2} strokeDasharray="4 3" />}
            {total > 0 ? (
              <Pie r={r} parts={[p!.company, p!.franchise, p!.licence]} />
            ) : (
              <circle r={7} fill={c.entered ? "var(--cream-deep)" : "var(--paper)"} stroke="var(--ink)" strokeWidth={1.5} strokeDasharray={c.exited ? "2 2" : undefined} />
            )}
            {p?.building ? <circle cx={r - 2} cy={-r + 2} r={4} fill="var(--amber)" stroke="var(--ink)" strokeWidth={1} /> : null}
            <text y={r + 14} textAnchor="middle" fontSize="12" fontWeight="800" fill="var(--ink)">
              {c.name}
              {total ? ` · ${total}` : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Pie({ r, parts }: { r: number; parts: number[] }) {
  const colours = ["var(--tomato)", "var(--amber)", "var(--plum)"];
  const total = parts.reduce((a, b) => a + b, 0);
  let a0 = -Math.PI / 2;
  const nonZero = parts.filter((x) => x > 0).length;
  if (nonZero === 1) {
    const i = parts.findIndex((x) => x > 0);
    return <circle r={r} fill={colours[i]} stroke="var(--ink)" strokeWidth={1.5} />;
  }
  return (
    <g>
      {parts.map((n, i) => {
        if (!n) return null;
        const a1 = a0 + (n / total) * Math.PI * 2;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const d = `M0 0 L${r * Math.cos(a0)} ${r * Math.sin(a0)} A${r} ${r} 0 ${large} 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)} Z`;
        a0 = a1;
        return <path key={i} d={d} fill={colours[i]} />;
      })}
      <circle r={r} fill="none" stroke="var(--ink)" strokeWidth={1.5} />
    </g>
  );
}

function CityPanel({ e, city, act }: { e: EmpireState; city: City; act: (c: EmpireCommand) => void }) {
  const sites = e.sites.filter((s) => s.cityId === city.id && s.status !== "closed");
  const open = sites.filter((s) => s.status === "open");
  const avgRev = open.length ? open.reduce((a, s) => a + s.revenueYear, 0) / open.length : 0;
  const sat = open.length ? open.reduce((a, s) => a + s.saturationPenalty, 0) / open.length : 0;
  const applicant = e.applicants[0];
  const region = e.regions.find((r) => r.id === city.regionId)!;
  return (
    <div className="card city-panel">
      <h2>
        {city.name}, {city.country}
      </h2>
      <dl>
        <dt>Region</dt>
        <dd>{region.name}</dd>
        <dt>Population</dt>
        <dd>{(city.population / 1e6).toFixed(1)}m</dd>
        <dt>Cost index</dt>
        <dd>×{city.costIndex.toFixed(2)}</dd>
        <dt>Sites</dt>
        <dd>
          {open.length}
          {sites.length > open.length ? ` (+${sites.length - open.length} building)` : ""}
        </dd>
        <dt>Avg takings / yr</dt>
        <dd>{open.length ? m(avgRev) : "—"}</dd>
        <dt>Saturation</dt>
        <dd>{pct(sat)}</dd>
        {city.dietaryRules.length > 0 && (
          <>
            <dt>Dietary rules</dt>
            <dd>
              {city.dietaryRules.join(", ")}
              {city.localised ? " (localised)" : ""}
            </dd>
          </>
        )}
        {city.localChampion && (
          <>
            <dt>Local champion</dt>
            <dd>
              {city.localChampion} ({Math.round(city.championStrength * 100)}%)
            </dd>
          </>
        )}
      </dl>
      <div className="actions">
        {!city.entered && !city.exited && <button onClick={() => act({ type: "ENTER_CITY", cityId: city.id })}>Enter city</button>}
        {city.entered && city.dietaryRules.length > 0 && !city.localised && <button onClick={() => act({ type: "LOCALISE_MENU", cityId: city.id })}>Localise menu</button>}
        {city.entered &&
          city.districts.map((d) => (
            <button key={d} onClick={() => act({ type: "OPEN_SITE", cityId: city.id, districtId: d, ownership: "company", land: "hqLease" })} title={`Build cost ${m(buildCost(city, e.brand.formula.driveThru, e.hq.priceLevel))}`}>
              + company · {d.replace("_", " ")}
            </button>
          ))}
        {city.entered && applicant && (
          <button onClick={() => act({ type: "OPEN_SITE", cityId: city.id, districtId: city.districts[0]!, ownership: "franchise", land: "hqLease", applicantId: applicant.id })}>
            + franchise to {applicant.name}
          </button>
        )}
      </div>
      {city.exited && <p className="note">The brand was forced out of {city.country}.</p>}
      <p className="note">{e.applicants.length} franchise applicant{e.applicants.length === 1 ? "" : "s"} waiting.</p>
    </div>
  );
}

function BrandPanel({ e, act }: { e: EmpireState; act: (c: EmpireCommand) => void }) {
  const f = e.brand.formula;
  const next = (["academy", "driveThru", "appOrdering"] as Tech[]).find((t) => !f[t]);
  return (
    <div className="card">
      <h2>Brand &amp; formula</h2>
      <dl>
        <dt>Standardisation</dt>
        <dd>{f.standardisation}</dd>
        <dt>Formula</dt>
        <dd>{f.locked ? "locked" : "not locked"}{f.fresh ? ", fresh never frozen" : ""}</dd>
        <dt>Tech</dt>
        <dd>
          {[f.academy && "academy", f.driveThru && "drive-thru", f.appOrdering && "app"].filter(Boolean).join(", ") || "—"}
          {e.brand.research ? ` (researching ${TECH_LABEL[e.brand.research.tech].toLowerCase()}, ${e.brand.research.daysLeft}d)` : ""}
        </dd>
        <dt>Menu</dt>
        <dd>{f.menuDishIds.length} items</dd>
        <dt>Suppliers</dt>
        <dd>{e.suppliers.filter((s) => s.signed).map((s) => s.name.split(" ")[0] + (s.exclusive ? "*" : "")).join(", ") || "—"}</dd>
      </dl>
      <div className="regions" style={{ marginTop: 10 }}>
        {e.regions.map((r) => {
          const rec = e.brand.recognition[r.id] ?? 0;
          return (
            <div className="row" key={r.id}>
              <span>{r.name}</span>
              <div className="bar" aria-label={`${r.name} recognition ${rec.toFixed(0)}`}>
                <i style={{ width: `${rec}%`, background: rec >= EMPIRE.WIN_RECOGNITION ? "var(--basil)" : "var(--amber)" }} />
              </div>
              <span>{rec.toFixed(0)}</span>
            </div>
          );
        })}
      </div>
      <div className="city-panel">
        <div className="actions">
          {!f.locked && <button onClick={() => act({ type: "SET_FORMULA", locked: true })}>Lock formula</button>}
          {f.locked && next && !e.brand.research && <button onClick={() => act({ type: "RESEARCH", tech: next })}>Research {TECH_LABEL[next].toLowerCase()}</button>}
          <button onClick={() => act({ type: "LAUNCH_CAMPAIGN", kind: "brand", budget: 20_000_000 })}>£200k campaign</button>
          {e.pendingIdea && <button onClick={() => act({ type: "LAUNCH_PRODUCT", name: e.pendingIdea!.name, budget: 20_000_000, fit: "franchiseeIdea" })}>Launch “{e.pendingIdea.name}”</button>}
        </div>
      </div>
    </div>
  );
}

function ContractPanel({ e, act }: { e: EmpireState; act: (c: EmpireCommand) => void }) {
  const c = e.contract;
  const step = (field: "royaltyPct" | "rentPctOfSales", d: number) => act({ type: "SET_CONTRACT", contract: { [field]: c[field] + d }, applyTo: "new" });
  const rentIncome = e.property.reduce((a, p) => a + p.rentIncome, 0);
  return (
    <div className="card">
      <h2>Franchise contract</h2>
      <dl>
        <dt>Fee</dt>
        <dd>{m(c.fee)}</dd>
        <dt>Royalty</dt>
        <dd>
          <button aria-label="Lower royalty" onClick={() => step("royaltyPct", -0.005)} style={{ padding: "0 8px" }}>
            −
          </button>{" "}
          {pct(c.royaltyPct)}{" "}
          <button aria-label="Raise royalty" onClick={() => step("royaltyPct", 0.005)} style={{ padding: "0 8px" }}>
            +
          </button>
        </dd>
        <dt>Ad fund</dt>
        <dd>{pct(c.adFundPct)}</dd>
        <dt>Rent (HQ land)</dt>
        <dd>
          <button aria-label="Lower rent share" onClick={() => step("rentPctOfSales", -0.01)} style={{ padding: "0 8px" }}>
            −
          </button>{" "}
          {pct(c.rentPctOfSales)} or cost +{EMPIRE.RENT_COST_MARKUP * 100}%{" "}
          <button aria-label="Raise rent share" onClick={() => step("rentPctOfSales", 0.01)} style={{ padding: "0 8px" }}>
            +
          </button>
        </dd>
        <dt>Total take</dt>
        <dd>{pct(contractTake(c))} of sales</dd>
        <dt>Rent income / month</dt>
        <dd>{m(rentIncome)}</dd>
      </dl>
      <p className="note">Changes apply to new agreements. Higher take = fewer, angrier applicants.</p>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <svg viewBox="0 0 300 90" />;
  const lo = Math.min(0, ...values);
  const hi = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 296 + 2},${88 - ((v - lo) / (hi - lo)) * 84}`).join(" ");
  const zero = 88 - ((0 - lo) / (hi - lo)) * 84;
  return (
    <svg viewBox="0 0 300 90" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" x2="300" y1={zero} y2={zero} stroke="var(--line)" />
      <polyline points={pts} fill="none" stroke="var(--tomato)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
