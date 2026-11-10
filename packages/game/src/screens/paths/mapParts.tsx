/**
 * Round 8 (maps): the pieces the Empire city map and the Stars map share — the map key and the tiled city board.
 * No sim-empire or sim-stars imports, so the Stars chunk doesn't pull in the Empire's code.
 */
import { formatPounds } from "../../lib/format";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { content } from "../../sim";
import { hash32 } from "./worldGeo";
import "./map.css";

// ───────────────────────── legend ─────────────────────────

/** The map key: open by default when the map is wide, folded behind a 44 px "Map key" button when it is narrow. */
export function MapLegend({ children, title = "Map key" }: { children: ReactNode; title?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    if (open !== null) return;
    const w = ref.current?.getBoundingClientRect().width ?? 0;
    setOpen(w >= 720);
  }, [open]);
  const id = useId();
  return (
    <div ref={ref} className={`legend ${open ? "legend--open" : ""}`}>
      <button type="button" className="legend__toggle" aria-expanded={!!open} aria-controls={id} onClick={() => setOpen(!open)}>
        <span aria-hidden="true" className="legend__chev">▸</span> {title}
      </button>
      <ul id={id} className="legend__items" hidden={!open}>{children}</ul>
    </div>
  );
}
export function LegendItem({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return <li className="legend__item"><span className="legend__swatch" aria-hidden="true">{swatch}</span><span>{children}</span></li>;
}

// ───────────────────────── city map ─────────────────────────

const districtDef = (id: string) => content.districts.find((d) => d.id === id);
export const districtLabel = (id: string) => districtDef(id)?.name ?? id.replace(/_/g, " ");

/** "Very busy / Busy / Steady" from a district's footfall (content districts.json). */
export function footfallWord(id: string): string {
  const f = districtDef(id)?.footfall ?? 80;
  return f >= 100 ? "Very busy" : f >= 80 ? "Busy" : "Steady";
}
/** A district's rent level in this city: content rent × the city's cost index, in £ signs and a word. */
export function districtRent(id: string, costIndex: number): { signs: string; word: string; monthly: number } {
  const monthly = Math.round((districtDef(id)?.monthlyRent ?? 300_000) * costIndex);
  return monthly < 240_000 ? { signs: "£", word: "cheap", monthly } : monthly < 330_000 ? { signs: "££", word: "middling", monthly } : { signs: "£££", word: "pricey", monthly };
}

/** Tile order on a city board: the town centre first, the seafront last (it runs along the bottom, by the sea). */
const TILE_ORDER = ["high_street", "business_park", "student_quarter", "seaside"];
export function boardDistricts(ids: readonly string[]): { inland: string[]; sea?: string } {
  const sorted = [...ids].sort((a, b) => (TILE_ORDER.indexOf(a) + 1 || 9) - (TILE_ORDER.indexOf(b) + 1 || 9));
  const sea = sorted.find((d) => d === "seaside");
  return { inland: sorted.filter((d) => d !== "seaside"), sea };
}

/** A city's districts as a little tiled street map. `children(d)` fills each tile below its name and hints. */
export function CityBoard({ cityId, districts, costIndex, label, children, tileClass }: {
  cityId: string; districts: readonly string[]; costIndex: number; label: string;
  children: (d: string) => ReactNode; tileClass?: (d: string) => string;
}) {
  const { inland, sea } = boardDistricts(districts);
  const tile = (d: string) => {
    const rent = districtRent(d, costIndex);
    return (
      <section key={d} className={`district district--${d} ${tileClass?.(d) ?? ""}`} aria-label={districtLabel(d)} data-district={d}>
        <Blocks seed={hash32(`${cityId}:${d}`)} sea={d === "seaside"} />
        <h4 className="district__name">{districtLabel(d)}</h4>
        <div className="district__hints">
          <span className="district__hint" title="How many people walk past">👣 {footfallWord(d)}</span>
          <span className="district__hint" title={`Rent about ${formatPounds(rent.monthly)} a month`}>{rent.signs} {rent.word} rent</span>
        </div>
        {children(d)}
      </section>
    );
  };
  return (
    <div className={`cityboard ${sea ? "cityboard--coast" : ""}`} role="group" aria-label={label} data-inland={inland.length}>
      <div className="cityboard__row">{inland.map(tile)}</div>
      {sea && <div className="cityboard__row cityboard__row--sea">{tile(sea)}</div>}
      {sea && <div className="cityboard__sea" aria-hidden="true"><svg viewBox="0 0 400 20" preserveAspectRatio="none"><path d="M0 10q25 -8 50 0t50 0 50 0 50 0 50 0 50 0 50 0 50 0" /></svg></div>}
    </div>
  );
}

/** Decorative building footprints for a district tile (seeded by city and district: same picture every time). */
function Blocks({ seed, sea }: { seed: number; sea: boolean }) {
  const rects = useMemo(() => {
    let a = seed;
    const rnd = () => { a = (Math.imul(a ^ (a >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0; return a / 4294967296; };
    const out: { x: number; y: number; w: number; h: number }[] = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 7; col++) {
        if (rnd() < 0.35) continue;
        out.push({ x: col * 28 + 4 + rnd() * 4, y: row * 22 + 4 + rnd() * 3, w: 12 + rnd() * 10, h: 10 + rnd() * 7 });
      }
    }
    return out;
  }, [seed]);
  return (
    <svg className="district__blocks" viewBox="0 0 200 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <path d="M0 45H200M100 0V90" className="district__street" />
      {rects.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx="1.5" />)}
      {sea && <path d="M0 80q12 -6 25 0t25 0 25 0 25 0 25 0 25 0 25 0 25 0V90H0Z" className="district__surf" />}
    </svg>
  );
}

