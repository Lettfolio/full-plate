/**
 * Round 8 (maps): the Empire's world map and city map, and the legend they share.
 *
 * The world is an SVG scene (sea, depth bands, coasts, terrain, halos, routes) under an HTML layer of labels and city
 * pins. Pins are real <button>s (tab order, accessible names, 44 px hit areas) and their text is CSS-sized, so no
 * label ever shrinks below 13 px when the map is zoomed out. Geography and the pan/zoom maths are in `worldGeo.ts`.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { cityEntryCost, EMPIRE, type City, type EmpireState, type SiteSummary } from "@full-plate/sim-empire";
import { Term } from "../../components/Term";
import { Icon } from "../../components/Icon";
import { MoneyText } from "../../components/MoneyText";
import {
  centreOn, cityPos, clampView, DUNES, HILLS, HOME_VIEW, LABEL_SIDE, LANDS, MAP_H, MAP_W, PATCHES, PEAKS, REGION_GEO, RIVERS,
  routePath, toScreenPct, TREES, zoomAt, ZOOM_MAX, ZOOM_MIN, type Pt, type View,
} from "./worldGeo";
import { CityBoard, districtLabel, LegendItem, MapLegend } from "./mapParts";

// R8 review: B's ownership tokens, so the map, the legend, city bars and charts agree.
export const OWN_COLOUR = ["var(--own)", "var(--franchise)", "var(--licence)"] as const;
type Mix = { company: number; franchise: number; licence: number; building: number };

/** Shops per city (closed ones left out; building ones counted apart). */
export function cityMix(e: EmpireState): Map<string, Mix> {
  const by = new Map<string, Mix>();
  for (const s of e.sites) {
    if (s.status === "closed") continue;
    const c = by.get(s.cityId) ?? { company: 0, franchise: 0, licence: 0, building: 0 };
    if (s.status === "building") c.building++;
    else c[s.ownership]++;
    by.set(s.cityId, c);
  }
  return by;
}

/**
 * Supply routes: one from the hub to every other city with shops (open or being built). The hub is HQ's city, or, in a
 * region with its own commissary, that region's busiest city with shops. Cities without shops get no route.
 */
export function supplyRoutes(e: EmpireState): { from: string; to: string; commissary: boolean }[] {
  const mix = cityMix(e);
  const home = e.cities.find((c) => c.id === e.hq.homeCityId);
  const count = (id: string) => { const m = mix.get(id); return m ? m.company + m.franchise + m.licence + m.building : 0; };
  const hubOf = (c: City): { id: string; commissary: boolean } => {
    const region = e.regions.find((r) => r.id === c.regionId);
    if (!region?.commissary || region.id === home?.regionId) return { id: e.hq.homeCityId, commissary: false };
    const best = e.cities.filter((x) => x.regionId === region.id && count(x.id) > 0).sort((a, b) => count(b.id) - count(a.id))[0];
    return { id: best?.id ?? e.hq.homeCityId, commissary: !!best };
  };
  const out: { from: string; to: string; commissary: boolean }[] = [];
  for (const c of e.cities) {
    if (count(c.id) === 0) continue;
    const hub = hubOf(c);
    if (hub.id !== c.id) out.push({ from: hub.id, to: c.id, commissary: hub.commissary });
  }
  return out;
}

/** £ / ££ / £££ from a city's cost index (its rents and wages against the home city). */
export function rentLevel(costIndex: number): { signs: string; word: string } {
  if (costIndex < 0.75) return { signs: "£", word: "cheap" };
  if (costIndex <= 1.0) return { signs: "££", word: "average" };
  return { signs: "£££", word: "pricey" };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** "3 your own, 18 franchise" (only the non-zero kinds). */
function mixWords(m: Mix | undefined): string {
  if (!m) return "";
  return [m.company && `${m.company} your own`, m.franchise && `${m.franchise} franchise`, m.licence && `${m.licence} licence`].filter(Boolean).join(", ");
}

// ───────────────────────── world map ─────────────────────────

export function WorldMap({ e, picked, onPick, logo }: { e: EmpireState; picked?: string; onPick: (id: string) => void; /** R13-D: the brand's logo on every pin with shops */ logo?: string | undefined }) {
  const uid = useId().replace(/:/g, "");
  const [view, setViewRaw] = useState<View>(HOME_VIEW);
  const setView = useCallback((v: View | ((p: View) => View)) => setViewRaw((p) => clampView(typeof v === "function" ? v(p) : v)), []);
  const [tip, setTip] = useState<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const frame = useRef<HTMLDivElement>(null);
  const mix = useMemo(() => cityMix(e), [e]);
  const routes = useMemo(() => supplyRoutes(e), [e]);
  const pos = useMemo(() => new Map(e.cities.map((c) => [c.id, cityPos(c)] as const)), [e.cities]);
  const scandal = new Set(e.effects.filter((f) => f.kind === "scandal" && f.regionId).map((f) => f.regionId!));
  const hq = e.hq.homeCityId;
  const hubs = new Set(routes.filter((r) => r.commissary).map((r) => r.from));

  // ── pointer pan / pinch, wheel zoom (all clamped) ──
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; moved: boolean; pinch?: number }>({ startX: 0, startY: 0, moved: false });
  const suppressClick = useRef(false);
  const unitsPerPx = () => { const w = frame.current?.getBoundingClientRect().width ?? 0; return w > 0 ? MAP_W / w : 1; };
  const toUnits = (cx: number, cy: number): Pt => {
    const r = frame.current?.getBoundingClientRect();
    const s = unitsPerPx();
    return r ? [(cx - r.left) * s, (cy - r.top) * s] : [MAP_W / 2, MAP_H / 2];
  };
  const onPointerDown = (ev: RPointerEvent<HTMLDivElement>) => {
    if ((ev.target as HTMLElement).closest(".worldmap__ctl")) return;
    pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.current.size === 1) gesture.current = { startX: ev.clientX, startY: ev.clientY, moved: false };
    else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      gesture.current.moved = true;
    }
  };
  const onPointerMove = (ev: RPointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(ev.pointerId);
    if (!prev) return;
    const next = { x: ev.clientX, y: ev.clientY };
    pointers.current.set(ev.pointerId, next);
    const g = gesture.current;
    if (pointers.current.size >= 2 && g.pinch) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      // Read everything now: the updater runs later, after g.pinch has moved on.
      const ratio = d / g.pinch, mid = toUnits((a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      if (d > 0) setView((v) => zoomAt(v, ratio, mid));
      g.pinch = d;
      return;
    }
    if (!g.moved && Math.hypot(next.x - g.startX, next.y - g.startY) < 6) return;
    if (!g.moved) { g.moved = true; try { frame.current?.setPointerCapture(ev.pointerId); } catch { /* jsdom */ } }
    const s = unitsPerPx(), dx = (next.x - prev.x) * s, dy = (next.y - prev.y) * s;
    setView((v) => ({ ...v, tx: v.tx + dx, ty: v.ty + dy }));
  };
  const onPointerEnd = (ev: RPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(ev.pointerId);
    if (pointers.current.size < 2) gesture.current.pinch = undefined;
    if (pointers.current.size === 0 && gesture.current.moved) { suppressClick.current = true; gesture.current.moved = false; }
  };
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      if (ev.deltaY === 0) return;
      const r = el.getBoundingClientRect();
      const s = r.width > 0 ? MAP_W / r.width : 1;
      const at: Pt = [(ev.clientX - r.left) * s, (ev.clientY - r.top) * s];
      const f = Math.exp(-ev.deltaY * 0.0022);
      const v = viewRef.current;
      // At a clamp, let the page scroll on (zooming out at 1×, or in at 4×) instead of trapping the wheel.
      if ((f < 1 && v.k <= ZOOM_MIN) || (f > 1 && v.k >= ZOOM_MAX)) return;
      ev.preventDefault();
      setViewRaw((p) => zoomAt(p, f, at));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  /** A focused pin that is off-screen while zoomed: bring it into the middle. */
  const onPinFocus = (id: string) => {
    setTip(id);
    const p = pos.get(id);
    if (!p) return;
    const [sx, sy] = toScreenPct(view, p);
    if (sx < 4 || sx > 96 || sy < 6 || sy > 94) setView((v) => centreOn(v, p));
  };

  const k = view.k;
  const gT = `translate(${view.tx.toFixed(2)} ${view.ty.toFixed(2)}) scale(${k.toFixed(4)})`;
  const tipAt = tip && pos.get(tip) ? toScreenPct(view, pos.get(tip)!) : undefined;
  // No tooltip for a pin the zoom has pushed off the frame.
  const tipCity = tipAt && tipAt[0] >= -2 && tipAt[0] <= 102 && tipAt[1] >= -3 && tipAt[1] <= 103 ? e.cities.find((c) => c.id === tip) : undefined;
  return (
    <div className="worldmap">
      <div
        ref={frame}
        className={`worldmap__frame ${k > 1 ? "worldmap__frame--zoomed" : ""}`}
        data-zoom={k.toFixed(2)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(ev) => { if (suppressClick.current) { suppressClick.current = false; ev.stopPropagation(); ev.preventDefault(); } }}
        onMouseLeave={() => setTip(null)}
      >
        <svg className="worldmap__svg" viewBox={`0 0 ${MAP_W} ${MAP_H}`} aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id={`${uid}-sea`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--map-sea-top)" />
              <stop offset="1" stopColor="var(--map-sea)" />
            </linearGradient>
            {LANDS.map((l) => <clipPath key={l.id} id={`${uid}-clip-${l.id}`}><path d={l.d} /></clipPath>)}
            {e.regions.map((r) => (
              <radialGradient key={r.id} id={`${uid}-halo-${r.id}`}>
                <stop offset="0.35" stopColor={haloColour(e, r.id)} stopOpacity={haloAlpha(e, r.id)} />
                <stop offset="1" stopColor={haloColour(e, r.id)} stopOpacity="0" />
              </radialGradient>
            ))}
          </defs>
          <rect width={MAP_W} height={MAP_H} fill={`url(#${uid}-sea)`} />
          <g transform={gT}>
            <Graticule />
            {e.regions.map((r) => {
              const h = REGION_GEO[r.id]?.halo;
              return h ? <ellipse key={r.id} className="worldmap__halo" data-region={r.id} cx={h.cx} cy={h.cy} rx={h.rx} ry={h.ry} fill={`url(#${uid}-halo-${r.id})`} /> : null;
            })}
            {LANDS.map((l) => <path key={l.id} d={l.d} className="worldmap__shelf" />)}
            {LANDS.map((l) => <path key={l.id} d={l.d} className="worldmap__shallows" />)}
            {LANDS.map((l) => <path key={l.id} d={l.d} className="worldmap__land" vectorEffect="non-scaling-stroke" />)}
            {PATCHES.map((p, i) => <path key={i} d={p.d} className={`worldmap__${p.kind}`} clipPath={`url(#${uid}-clip-${p.landId})`} />)}
            <Terrain />
            {RIVERS.map((d, i) => <path key={i} d={d} className="worldmap__river" vectorEffect="non-scaling-stroke" />)}
            {LANDS.filter((l) => scandal.has(l.regionId)).map((l) => <path key={l.id} d={l.d} className="worldmap__scandal" vectorEffect="non-scaling-stroke" />)}
            {routes.map((r) => {
              const a = pos.get(r.from), b = pos.get(r.to);
              return a && b ? <path key={`${r.from}-${r.to}`} d={routePath(a, b)} className={`worldmap__route ${r.commissary ? "worldmap__route--commissary" : ""}`} data-route={r.to} vectorEffect="non-scaling-stroke" /> : null;
            })}
          </g>
          <Compass />
        </svg>

        <div className="worldmap__labels" aria-hidden="true">
          {e.regions.map((r) => {
            const g = REGION_GEO[r.id];
            if (!g) return null;
            const [x, y] = toScreenPct(view, g.label);
            if (x < -10 || x > 110 || y < -10 || y > 110) return null;
            const rec = Math.round(e.brand.recognition[r.id] ?? 0);
            return (
              <div key={r.id} className="worldmap__region" style={{ left: `${x}%`, top: `${y}%` }}>
                <span className="worldmap__regionname">{r.name}</span>
                <span className={`worldmap__known ${rec >= EMPIRE.WIN_RECOGNITION ? "worldmap__known--won" : ""}`}>{scandal.has(r.id) ? "⚠ scandal · " : ""}known {rec}{rec >= EMPIRE.WIN_RECOGNITION ? " ✓" : ""}</span>
              </div>
            );
          })}
        </div>

        <div className="worldmap__pins" role="group" aria-label="World map of cities and shops">
          {e.cities.map((c) => {
            const p = pos.get(c.id)!;
            const [x, y] = toScreenPct(view, p);
            const m = mix.get(c.id);
            const total = m ? m.company + m.franchise + m.licence : 0;
            const sel = c.id === picked;
            const name = `${c.name}, ${c.country}: ${plural(total, "shop")}${total ? ` (${mixWords(m)})` : ""}${m?.building ? `, ${m.building} being built` : ""}${c.id === hq ? ", your HQ" : ""}${c.exited ? ", forced out" : c.entered ? "" : ", not entered"}`;
            const state = total > 0 ? "has" : c.exited ? "exited" : c.entered ? "entered" : "new";
            return (
              <button
                key={c.id}
                type="button"
                className={`mappin mappin--${state} mappin--${LABEL_SIDE[c.id] ?? "r"} ${sel ? "mappin--picked" : ""} ${x < -2 || x > 102 || y < -3 || y > 103 ? "mappin--off" : ""}`}
                style={{ left: `${x}%`, top: `${y}%` }}
                aria-label={name}
                aria-pressed={sel}
                aria-describedby={tip === c.id ? `${uid}-tip` : undefined}
                data-city={c.id}
                onClick={() => onPick(c.id)}
                onFocus={() => onPinFocus(c.id)}
                onBlur={() => setTip((t) => (t === c.id ? null : t))}
                onMouseEnter={() => setTip(c.id)}
              >
                <span className="mappin__mark" aria-hidden="true">
                  {total > 0 ? <PinDonut m={m!} total={total} /> : <span className="mappin__dot" />}
                  {c.id === hq && <span className="mappin__hq" title="HQ"><Crown /></span>}
                  {hubs.has(c.id) && c.id !== hq && <span className="mappin__hq mappin__hq--kitchen" title="Commissary">🍳</span>}
                  {m?.building ? <span className="mappin__building" /> : null}
                  {logo && total > 0 && <img className="mappin__logo" src={logo} width={20} height={20} alt="" aria-hidden="true" />}
                </span>
                <span className="mappin__label" aria-hidden="true">{c.name}</span>
              </button>
            );
          })}
        </div>

        {tipCity && tipAt && <CityTip e={e} c={tipCity} m={mix.get(tipCity.id)} at={tipAt} id={`${uid}-tip`} />}

        <div className="worldmap__ctl worldmap__zoom" role="group" aria-label="Map zoom">
          <button type="button" className="mapbtn" aria-label="Zoom in" disabled={k >= ZOOM_MAX} onClick={() => setView((v) => zoomAt(v, 1.6))}>+</button>
          <button type="button" className="mapbtn" aria-label="Zoom out" disabled={k <= ZOOM_MIN} onClick={() => setView((v) => zoomAt(v, 1 / 1.6))}>−</button>
          <button type="button" className="mapbtn mapbtn--reset" aria-label="Reset map" disabled={k === 1 && view.tx === 0 && view.ty === 0} onClick={() => setView(HOME_VIEW)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8V4h4M16 12v4h-4M4 4l5 5M16 16l-5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        {k > 1 && <MiniMap view={view} onJump={(p) => setView((v) => centreOn(v, p))} />}
      </div>
      <MapLegend>
        <LegendItem swatch={<i className="legend__dot" style={{ background: OWN_COLOUR[0] }} />}><Term id="company" inline>Your own</Term></LegendItem>
        <LegendItem swatch={<i className="legend__dot" style={{ background: OWN_COLOUR[1] }} />}><Term id="franchise" inline>Franchise</Term></LegendItem>
        <LegendItem swatch={<i className="legend__dot" style={{ background: OWN_COLOUR[2] }} />}><Term id="licence" inline>Licence</Term></LegendItem>
        <LegendItem swatch={<span className="legend__hq"><Crown /></span>}>Your <Term id="hq" inline>HQ</Term></LegendItem>
        <LegendItem swatch={<i className="legend__dot legend__dot--new" />}>Not entered</LegendItem>
        <LegendItem swatch={<i className="legend__dot legend__dot--building" />}>Being built</LegendItem>
        <LegendItem swatch={<svg className="legend__route" viewBox="0 0 30 10" aria-hidden="true"><path d="M2 5h26" /></svg>}>Supply route from <Term id="hq" inline>HQ</Term></LegendItem>
        <LegendItem swatch={<i className="legend__halo" />}>Glow = <Term id="recognition" inline>how many people know you</Term> (green at {EMPIRE.WIN_RECOGNITION})</LegendItem>
      </MapLegend>
    </div>
  );
}

const haloColour = (e: EmpireState, id: string) => ((e.brand.recognition[id] ?? 0) >= EMPIRE.WIN_RECOGNITION ? "var(--map-halo-won)" : "var(--map-halo)");
/** Halo strength: nothing below 3, up to 0.75 at 100. */
const haloAlpha = (e: EmpireState, id: string) => { const r = e.brand.recognition[id] ?? 0; return r < 3 ? 0 : Math.min(0.75, 0.15 + (r / 100) * 0.6).toFixed(2); };

function PinDonut({ m, total }: { m: Mix; total: number }) {
  const size = total >= 20 ? 40 : total >= 5 ? 34 : 30;
  const R = 15, C = 2 * Math.PI * R;
  let off = 0;
  const parts = [m.company, m.franchise, m.licence];
  return (
    <span className="mappin__donut" style={{ width: size, height: size }}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="19" className="mappin__disc" />
        {parts.map((n, i) => {
          if (!n) return null;
          const len = (n / total) * C;
          const el = <circle key={i} cx="20" cy="20" r={R} fill="none" stroke={OWN_COLOUR[i]} strokeWidth="6" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 20 20)" />;
          off += len;
          return el;
        })}
      </svg>
      <b className="mappin__n">{total}</b>
    </span>
  );
}

function Crown() {
  return <svg viewBox="0 0 20 14" aria-hidden="true"><path d="M2 12 1 3l5 4 4-6 4 6 5-4-1 9z" /></svg>;
}

function CityTip({ e, c, m, at, id }: { e: EmpireState; c: City; m?: Mix; at: Pt; id: string }) {
  const total = m ? m.company + m.franchise + m.licence : 0;
  const rent = rentLevel(c.costIndex);
  const region = e.regions.find((r) => r.id === c.regionId);
  const rec = Math.round(e.brand.recognition[c.regionId] ?? 0);
  const below = at[1] < 38;
  const style: CSSProperties = { left: `${Math.min(84, Math.max(16, at[0]))}%`, top: `${Math.min(96, Math.max(4, at[1]))}%` };
  return (
    <div role="tooltip" id={id} className={`maptip ${below ? "maptip--below" : ""}`} style={style}>
      <b className="maptip__name">{c.name}</b> <span className="maptip__where">{c.country} · {region?.name}</span>
      <div className="maptip__row">{total ? <>{plural(total, "shop")}: {mixWords(m)}</> : c.exited ? "Forced out" : c.entered ? "No shops yet" : <>Not entered · costs <MoneyText pence={cityEntryCost(e, c)} whole /></>}{m?.building ? ` · ${m.building} being built` : ""}</div>
      <div className="maptip__row">Rent {rent.signs} <span className="maptip__soft">({rent.word})</span> · known in {region?.name ?? "the region"}: <b>{rec}</b></div>
      {c.id === e.hq.homeCityId && <div className="maptip__row maptip__soft">Your head office (HQ) is here</div>}
    </div>
  );
}

function Graticule() {
  const xs = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  const ys = [100, 200, 300, 400];
  return (
    <g className="worldmap__grid">
      {xs.map((x) => <path key={`x${x}`} d={`M${x} 0Q${x + (x - 500) * 0.04} 250 ${x} 500`} vectorEffect="non-scaling-stroke" />)}
      {ys.map((y) => <path key={`y${y}`} d={`M0 ${y}H1000`} vectorEffect="non-scaling-stroke" />)}
    </g>
  );
}

/** Peaks, hills, trees and dunes: one stroke weight, two tones each. */
function Terrain() {
  return (
    <g className="worldmap__terrain">
      {TREES.map(([x, y], i) => <circle key={`t${i}`} cx={x} cy={y} r={3.3 + ((i * 7) % 3) * 0.4} className="worldmap__tree" />)}
      {DUNES.map(([x, y], i) => <path key={`d${i}`} d={`M${x - 6} ${y}q6 -5 12 0`} className="worldmap__dune" />)}
      {HILLS.map(([x, y], i) => <path key={`h${i}`} d={`M${x - 9} ${y + 3}q9 -11 18 0`} className="worldmap__hill" />)}
      {PEAKS.map(([x, y], i) => (
        <g key={`p${i}`} className="worldmap__peak">
          <path d={`M${x - 8} ${y + 6}L${x} ${y - 7}L${x + 8} ${y + 6}Z`} />
          <path d={`M${x} ${y - 7}L${x + 8} ${y + 6}H${x + 1}Z`} className="worldmap__peakshade" />
        </g>
      ))}
    </g>
  );
}

function Compass() {
  return (
    <g className="worldmap__compass" transform="translate(40 456)">
      <circle r="22" />
      <path d="M0 -19 5 0 0 19 -5 0Z" className="worldmap__compassneedle" />
      <path d="M0 -19 5 0H-5Z" className="worldmap__compassnorth" />
    </g>
  );
}

function MiniMap({ view, onJump }: { view: View; onJump: (p: Pt) => void }) {
  return (
    <svg
      className="worldmap__ctl worldmap__mini"
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      aria-hidden="true"
      onClick={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); if (r.width) onJump([((ev.clientX - r.left) / r.width) * MAP_W, ((ev.clientY - r.top) / r.height) * MAP_H]); }}
    >
      <rect width={MAP_W} height={MAP_H} className="worldmap__minisea" />
      {LANDS.map((l) => <path key={l.id} d={l.d} className="worldmap__miniland" />)}
      <rect x={-view.tx / view.k} y={-view.ty / view.k} width={MAP_W / view.k} height={MAP_H / view.k} className="worldmap__miniview" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A little shopfront in its owner's colour (a stripy awning); dashed while it is being built. */
export function ShopIcon({ ownership, building, mine, size = 24 }: { ownership: SiteSummary["ownership"]; building?: boolean; mine?: boolean; size?: number }) {
  const colour = OWN_COLOUR[ownership === "company" ? 0 : ownership === "franchise" ? 1 : 2];
  return (
    <svg className={`shopicon ${building ? "shopicon--building" : ""}`} viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M4 10.5h16V21H4z" className="shopicon__body" />
      <path d="M3 6h18l-1.2 4.6H4.2z" fill={building ? "var(--paper)" : colour} className="shopicon__awning" />
      <path d="M9 6l-.6 4.6M15 6l.6 4.6" className="shopicon__stripe" />
      <path d="M10 21v-5h4v5" className="shopicon__door" />
      {mine && <path d="M18.5 1.5l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z" className="shopicon__star" />}
    </svg>
  );
}

const SHOPS_DRAWN = 12;

/** The picked city as a district map: shops drawn in each district, "Open here" leading to the open-site buttons. */
export function CityMap({ e, city, onBack, onOpenHere }: { e: EmpireState; city: City; onBack: () => void; onOpenHere: (districtId: string | null) => void }) {
  const sites = e.sites.filter((s) => s.cityId === city.id && s.status !== "closed");
  const m = cityMix(e).get(city.id);
  const total = m ? m.company + m.franchise + m.licence : 0;
  const region = e.regions.find((r) => r.id === city.regionId);
  const rec = Math.round(e.brand.recognition[city.regionId] ?? 0);
  const rent = rentLevel(city.costIndex);
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { backRef.current?.focus({ preventScroll: true }); }, [city.id]);
  return (
    <div className="citymap" aria-label={`Map of ${city.name}`} role="region">
      <div className="citymap__top">
        <button ref={backRef} type="button" className="btn btn--sm btn--ghost btn--tap citymap__back" onClick={onBack}><Icon name="back" size={18} /> World map</button>
        <div className="citymap__title">
          <h3>{city.name}</h3>
          <span className="citymap__where">{city.country} · {region?.name}{city.id === e.hq.homeCityId ? <> · <Term id="hq" inline>HQ</Term></> : ""}</span>
        </div>
        <ul className="citymap__chips" aria-label={`${city.name} at a glance`}>
          <li className="mapchip">{plural(total, "shop")}{m?.building ? ` · ${m.building} building` : ""}</li>
          <li className="mapchip">Rent {rent.signs} {rent.word}</li>
          <li className={`mapchip ${rec >= EMPIRE.WIN_RECOGNITION ? "mapchip--won" : ""}`}>Known {rec}</li>
        </ul>
      </div>
      {!city.entered && (
        <p className="citymap__note">
          {city.exited ? <>The brand was forced out of {city.country}.</> : <>Not entered yet. <button type="button" className="btn btn--sm btn--primary btn--tap" onClick={() => onOpenHere(null)}>Enter {city.name}…</button></>}
        </p>
      )}
      <CityBoard cityId={city.id} districts={city.districts} costIndex={city.costIndex} label={`${city.name} districts`} tileClass={(d) => (sites.some((s) => s.districtId === d) ? "district--taken" : "district--free")}>
        {(d) => {
          const here = sites.filter((s) => s.districtId === d).sort((a, b) => Number(b.focused) - Number(a.focused) || Number(a.status === "building") - Number(b.status === "building"));
          const open = here.filter((s) => s.status === "open");
          const counts = [open.filter((s) => s.ownership === "company").length, open.filter((s) => s.ownership === "franchise").length, open.filter((s) => s.ownership === "licence").length];
          const building = here.length - open.length;
          const words = [counts[0] && `${counts[0]} your own`, counts[1] && `${counts[1]} franchise`, counts[2] && `${counts[2]} licence`, building && `${building} being built`].filter(Boolean).join(", ");
          return (
            <>
              {here.length > 0 ? (
                <div className="district__shops" role="img" aria-label={`${plural(here.length, "shop")} in ${districtLabel(d)}: ${words}${here.some((s) => s.focused) ? ", including the one you run" : ""}`}>
                  {here.slice(0, SHOPS_DRAWN).map((s) => <ShopIcon key={s.id} ownership={s.ownership} building={s.status === "building"} mine={s.focused} />)}
                  {here.length > SHOPS_DRAWN && <span className="district__more">+{here.length - SHOPS_DRAWN}</span>}
                </div>
              ) : <p className="district__empty">No shop here yet</p>}
              {city.entered && !city.exited && (
                <button type="button" className={`btn btn--sm btn--tap district__open ${here.length ? "btn--ghost" : "btn--green"}`} onClick={() => onOpenHere(d)} aria-label={`${here.length ? "Open another" : "Open here"}: ${districtLabel(d)}`}>
                  <Icon name="plus" size={18} />{here.length ? "Open another" : "Open here"}
                </button>
              )}
            </>
          );
        }}
      </CityBoard>
    </div>
  );
}
