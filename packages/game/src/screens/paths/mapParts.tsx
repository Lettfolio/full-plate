/**
 * Round 8 (maps): the pieces the Empire city map and the Stars map share — the map key and the tiled city board.
 * No sim-empire or sim-stars imports, so the Stars chunk doesn't pull in the Empire's code.
 */
import { formatPounds } from "../../lib/format";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode, type RefObject } from "react";
import { content } from "../../sim";
import { hash32 } from "./worldGeo";
import "./map.css";

// ───────────────────────── gestures (Round 13 — B) ─────────────────────────

/** What a map lets the gestures do. `pan` is in screen px; `zoom` is about a client point (default: the frame's middle). */
export interface MapOps {
  pan(dx: number, dy: number): void;
  zoom(f: number, clientX?: number, clientY?: number): void;
  reset(): void;
  zoomed(): boolean;
  /** True when zooming by `f` would do nothing (already at that end): the wheel then scrolls the page on. */
  atLimit(f: number): boolean;
}

/** A mouse wheel's notch, not a trackpad's two-finger scroll (that one pans a zoomed map instead of zooming). */
export const isWheelNotch = (e: Pick<WheelEvent, "deltaMode" | "deltaX" | "deltaY">): boolean =>
  e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));

/** The next step for a map key: arrows pan 60 px, + and − zoom, 0 resets (null: not a map key). */
export function mapKey(key: string): { pan?: [number, number]; zoom?: number; reset?: true } | null {
  switch (key) {
    case "ArrowLeft": return { pan: [60, 0] };
    case "ArrowRight": return { pan: [-60, 0] };
    case "ArrowUp": return { pan: [0, 60] };
    case "ArrowDown": return { pan: [0, -60] };
    case "+": case "=": return { zoom: 1.4 };
    case "-": case "_": return { zoom: 1 / 1.4 };
    case "0": return { reset: true };
    default: return null;
  }
}

/**
 * Round 13 (B): pan and pinch for a map frame, shared by the world map and the city boards. Touch: one finger drags,
 * two pinch, a double tap zooms in (and back out from the top). Trackpad: pinch (ctrl+wheel) zooms at the pointer,
 * two-finger scroll pans a zoomed map. Mouse: drag, wheel zooms. Keyboard on the frame: arrows, + / −, 0.
 */
export function useMapGestures(frame: RefObject<HTMLElement | null>, opsIn: MapOps) {
  const ops = useRef(opsIn);
  ops.current = opsIn;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<{ startX: number; startY: number; moved: boolean; pinch?: number; lastTap?: { x: number; y: number; t: number } }>({ startX: 0, startY: 0, moved: false });
  const suppress = useRef(false);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (ev: WheelEvent) => {
      const o = ops.current;
      if (ev.ctrlKey) { ev.preventDefault(); o.zoom(Math.exp(-ev.deltaY * 0.01), ev.clientX, ev.clientY); return; }
      if (isWheelNotch(ev)) {
        if (ev.deltaY === 0) return;
        const f = Math.exp(-ev.deltaY * 0.0022);
        if (o.atLimit(f)) return; // at a clamp the page scrolls on instead of trapping the wheel
        ev.preventDefault();
        o.zoom(f, ev.clientX, ev.clientY);
        return;
      }
      if (!o.zoomed()) return;
      ev.preventDefault();
      o.pan(-ev.deltaX, -ev.deltaY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [frame]);
  const onPointerDown = useCallback((ev: RPointerEvent<HTMLElement>) => {
    if ((ev.target as HTMLElement).closest(".worldmap__ctl, .zoomframe__ctl")) return;
    pointers.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.current.size === 1) g.current = { ...g.current, startX: ev.clientX, startY: ev.clientY, moved: false };
    else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      g.current.pinch = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      g.current.moved = true;
    }
  }, []);
  const onPointerMove = useCallback((ev: RPointerEvent<HTMLElement>) => {
    const prev = pointers.current.get(ev.pointerId);
    if (!prev) return;
    const next = { x: ev.clientX, y: ev.clientY };
    pointers.current.set(ev.pointerId, next);
    const s = g.current;
    if (pointers.current.size >= 2 && s.pinch) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (d > 0) ops.current.zoom(d / s.pinch, (a!.x + b!.x) / 2, (a!.y + b!.y) / 2);
      s.pinch = d;
      return;
    }
    if (!s.moved && Math.hypot(next.x - s.startX, next.y - s.startY) < 6) return;
    if (!s.moved) { s.moved = true; try { frame.current?.setPointerCapture(ev.pointerId); } catch { /* jsdom */ } }
    ops.current.pan(next.x - prev.x, next.y - prev.y);
  }, [frame]);
  const onPointerEnd = useCallback((ev: RPointerEvent<HTMLElement>) => {
    if (!pointers.current.delete(ev.pointerId)) return;
    const s = g.current;
    if (pointers.current.size < 2) s.pinch = undefined;
    if (pointers.current.size > 0) return;
    if (s.moved) { suppress.current = true; s.moved = false; s.lastTap = undefined; return; }
    if (ev.type !== "pointerup" || (ev.target as HTMLElement).closest("button, a")) { s.lastTap = undefined; return; }
    const now = performance.now(), last = s.lastTap;
    if (last && now - last.t < 320 && Math.hypot(ev.clientX - last.x, ev.clientY - last.y) < 30) {
      s.lastTap = undefined;
      const o = ops.current;
      if (o.atLimit(2)) o.reset(); else o.zoom(2, ev.clientX, ev.clientY);
    } else s.lastTap = { x: ev.clientX, y: ev.clientY, t: now };
  }, []);
  const onClickCapture = useCallback((ev: React.MouseEvent) => {
    if (suppress.current) { suppress.current = false; ev.stopPropagation(); ev.preventDefault(); }
  }, []);
  const onKeyDown = useCallback((ev: RKeyboardEvent<HTMLElement>) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = mapKey(ev.key);
    if (!k) return;
    // arrows on a pin or a button inside the frame still pan; Enter/Space stay theirs
    ev.preventDefault();
    const o = ops.current;
    if (k.pan) o.pan(k.pan[0], k.pan[1]);
    else if (k.zoom) o.zoom(k.zoom);
    else o.reset();
  }, []);
  return { onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd, onClickCapture, onKeyDown };
}

interface PxView { k: number; tx: number; ty: number }
const ZF_MAX = 3;

/**
 * Round 13 (B): a pan-and-zoom frame for HTML content (the city boards: the Stars city map and the Empire's city map).
 * At 1× it changes nothing (no transform, nothing clipped); zoomed, the content is scaled and clipped to the frame,
 * with + / − / reset buttons. Buttons inside still work (a drag never presses one).
 */
export function ZoomFrame({ label, children }: { label: string; children: ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  const [v, setRaw] = useState<PxView>({ k: 1, tx: 0, ty: 0 });
  const vRef = useRef(v);
  vRef.current = v;
  const clampV = (n: PxView): PxView => {
    const el = frame.current;
    const W = el?.clientWidth ?? 0, H = el?.clientHeight ?? 0;
    const k = Math.min(ZF_MAX, Math.max(1, Number.isFinite(n.k) ? n.k : 1));
    const c = (t: number, min: number) => Math.min(0, Math.max(min, Number.isFinite(t) ? t : 0));
    return { k, tx: c(n.tx, W * (1 - k)), ty: c(n.ty, H * (1 - k)) };
  };
  const set = (f: (p: PxView) => PxView) => setRaw((p) => clampV(f(p)));
  const zoom = (f: number, cx?: number, cy?: number) => set((p) => {
    const r = frame.current?.getBoundingClientRect();
    const ax = r && cx !== undefined ? cx - r.left : (r?.width ?? 0) / 2, ay = r && cy !== undefined ? cy - r.top : (r?.height ?? 0) / 2;
    const k = Math.min(ZF_MAX, Math.max(1, p.k * f)), s = k / p.k;
    return { k, tx: ax - (ax - p.tx) * s, ty: ay - (ay - p.ty) * s };
  });
  const reset = () => setRaw({ k: 1, tx: 0, ty: 0 });
  const handlers = useMapGestures(frame, {
    pan: (dx, dy) => set((p) => ({ ...p, tx: p.tx + dx, ty: p.ty + dy })),
    zoom, reset,
    zoomed: () => vRef.current.k > 1,
    atLimit: (f) => (f < 1 && vRef.current.k <= 1) || (f > 1 && vRef.current.k >= ZF_MAX),
  });
  const zoomed = v.k > 1.001;
  return (
    <div className="zoomframe-wrap">
      <div
        ref={frame}
        className={`zoomframe ${zoomed ? "zoomframe--zoomed" : ""}`}
        data-zoom={v.k.toFixed(2)}
        role="region"
        aria-label={`${label}. Arrow keys move it, plus and minus zoom, 0 resets.`}
        tabIndex={0}
        {...handlers}
      >
        <div className="zoomframe__inner" style={zoomed ? { transform: `translate(${v.tx.toFixed(1)}px, ${v.ty.toFixed(1)}px) scale(${v.k.toFixed(3)})` } : undefined}>
          {children}
        </div>
      </div>
      <div className="zoomframe__ctl" role="group" aria-label="Map size">
        {zoomed && <span className="zoomframe__hint">Drag to move · pinch to zoom</span>}
        <button type="button" className="mapbtn" aria-label={`Enlarge: ${label}`} disabled={v.k >= ZF_MAX} onClick={() => zoom(1.5)}>+</button>
        <button type="button" className="mapbtn" aria-label={`Shrink: ${label}`} disabled={!zoomed} onClick={() => zoom(1 / 1.5)}>−</button>
        <button type="button" className="mapbtn" aria-label={`Back to the whole of ${label}`} disabled={!zoomed} onClick={reset}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 8V4h4M16 12v4h-4M4 4l5 5M16 16l-5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  );
}

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
    <ZoomFrame label={label}>
    <div className={`cityboard ${sea ? "cityboard--coast" : ""}`} role="group" aria-label={label} data-inland={inland.length}>
      <div className="cityboard__row">{inland.map(tile)}</div>
      {sea && <div className="cityboard__row cityboard__row--sea">{tile(sea)}</div>}
      {sea && <div className="cityboard__sea" aria-hidden="true"><svg viewBox="0 0 400 20" preserveAspectRatio="none"><path d="M0 10q25 -8 50 0t50 0 50 0 50 0 50 0 50 0 50 0 50 0" /></svg></div>}
    </div>
    </ZoomFrame>
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

