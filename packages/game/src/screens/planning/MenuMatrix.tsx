import type { DishId, MenuItem, MenuQuadrant } from "@full-plate/sim-core";

interface Props {
  items: MenuItem[];
  quadrants: Record<DishId, MenuQuadrant>;
  names: Record<DishId, string>;
  /** Unit margin (pence) to plot when a dish has no sales yet. */
  fallbackMargin: (m: MenuItem) => number;
  highlight?: DishId | null;
  onHover?: (id: DishId | null) => void;
}

export const QUADRANT: Record<MenuQuadrant, { label: string; colour: string; hint: string }> = {
  star: { label: "Star", colour: "#e9a23b", hint: "Popular and profitable. Keep it, show it off." },
  ploughhorse: { label: "Plough-horse", colour: "#4f8fb8", hint: "Popular, thin margin. Nudge the price up or trim the cost." },
  puzzle: { label: "Puzzle", colour: "#8a5a9e", hint: "Profitable, but few order it. Rename it, move it, push it." },
  dog: { label: "Dog", colour: "#9b8f80", hint: "Neither. Think about taking it off." },
};

const W = 360, H = 300, PAD = 30;
/** Width of a 14.5 px extra-bold label, generously (Nunito ≈ 8.6 px a character). */
export const labelWidth = (text: string): number => text.length * 8.8;
/** Long dish names are cut to fit half the chart ("Fish & chips with mus…"); the full name shows in the list. */
export const MAX_LABEL_CHARS = 22;
export const shortName = (name: string): string => (name.length > MAX_LABEL_CHARS ? `${name.slice(0, MAX_LABEL_CHARS - 1).trimEnd()}…` : name);

/**
 * Menu-engineering 2×2. X = popularity (sold in the last 7 days), Y = margin per plate.
 * Axes are centred on the menu's means so the cross-hair is the quadrant boundary the sim uses.
 */
export function MenuMatrix({ items, quadrants, names, fallbackMargin, highlight, onHover }: Props) {
  const pts = items.map((m) => ({ m, x: m.sold7d, y: m.sold7d ? m.margin7d / m.sold7d : fallbackMargin(m) }));
  const meanX = pts.length ? pts.reduce((a, p) => a + p.x, 0) / pts.length : 0;
  const meanY = pts.length ? pts.reduce((a, p) => a + p.y, 0) / pts.length : 0;
  const spanX = Math.max(1, ...pts.map((p) => Math.abs(p.x - meanX))) * 1.15;
  const spanY = Math.max(50, ...pts.map((p) => Math.abs(p.y - meanY))) * 1.15;
  const sx = (x: number) => W / 2 + ((x - meanX) / spanX) * (W / 2 - PAD);
  const sy = (y: number) => H / 2 - ((y - meanY) / spanY) * (H / 2 - PAD);
  const noSales = pts.every((p) => p.x === 0);

  // de-overlap: nudge points that land on the same pixel
  const seen = new Map<string, number>();
  const placed = pts.map((p) => {
    let cx = sx(p.x), cy = sy(p.y);
    const key = `${Math.round(cx / 14)}:${Math.round(cy / 14)}`;
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (n) { cx += Math.cos(n * 2.1) * 14; cy += Math.sin(n * 2.1) * 14; }
    return { ...p, cx, cy };
  });
  // label collision: keep a label only if it doesn't overlap one already placed, a quadrant title, an axis label or
  // another dish's dot (round 5 review: names sat on "Stars ★" and ran off the edge). Try above the dot, then below;
  // the label is clamped inside the chart. Hover always shows.
  const boxes: { x: number; y: number; w: number }[] = [
    { x: 10 + 32, y: 17, w: 70 }, { x: W - 10 - 30, y: 17, w: 66 }, // Puzzles, Stars ★ (centre x, baseline-ish y)
    { x: 10 + 20, y: H - 25, w: 44 }, { x: W - 10 - 52, y: H - 25, w: 110 }, // Dogs, Plough-horses
    { x: W / 2, y: H - 9, w: 120 }, // more popular →
  ];
  const dots = placed.map((p) => ({ x: p.cx, y: p.cy }));
  const hits = (x: number, y: number, w: number, self: { cx: number; cy: number }) =>
    boxes.some((b) => Math.abs(b.y - y) < 16 && Math.abs(b.x - x) < (b.w + w) / 2) ||
    dots.some((d) => (d.x !== self.cx || d.y !== self.cy) && Math.abs(d.y - (y - 5)) < 14 && Math.abs(d.x - x) < w / 2 + 8);
  const labelAt = new Map<DishId, { x: number; y: number }>();
  for (const p of [...placed].sort((a, b) => b.x - a.x)) {
    const w = labelWidth(shortName(names[p.m.dishId] ?? p.m.dishId));
    const x = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, p.cx));
    const spot = [p.cy - 13, p.cy + 25].find((y) => y > 14 && y < H - 4 && !hits(x, y, w, p));
    if (spot === undefined) continue;
    boxes.push({ x, y: spot, w });
    labelAt.set(p.m.dishId, { x, y: spot });
  }

  return (
    <div className="matrix">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Menu matrix: popularity against margin">
        <rect x="0" y="0" width={W / 2} height={H / 2} fill="#efe3f3" rx="10" />
        <rect x={W / 2} y="0" width={W / 2} height={H / 2} fill="#fdf0c9" rx="10" />
        <rect x="0" y={H / 2} width={W / 2} height={H / 2} fill="#ece6dd" rx="10" />
        <rect x={W / 2} y={H / 2} width={W / 2} height={H / 2} fill="#dfeef7" rx="10" />
        <line x1={W / 2} y1="0" x2={W / 2} y2={H} stroke="#fffdf8" strokeWidth="4" />
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#fffdf8" strokeWidth="4" />
        <g fontFamily="Fredoka, Nunito, sans-serif" fontSize="16" fontWeight="600">
          <text x="10" y="22" fill="#6a3f7d">Puzzles</text>
          <text x={W - 10} y="22" fill="#8a5a0b" textAnchor="end">Stars ★</text>
          <text x="10" y={H - 20} fill="#6b6157">Dogs</text>
          <text x={W - 10} y={H - 20} fill="#2d6788" textAnchor="end">Plough-horses</text>
        </g>
        <g fontFamily="Nunito, sans-serif" fontSize="14" fontWeight="800" fill="#5c534a">
          <text x={W / 2} y={H - 4} textAnchor="middle">more popular →</text>
          <text transform={`translate(16 ${H * 0.3}) rotate(-90)`} textAnchor="middle" dy="0" paintOrder="stroke" stroke="#efe3f3" strokeWidth={3}>more margin →</text>
        </g>
        {placed.map(({ m, cx, cy }) => {
          const q = quadrants[m.dishId] ?? "dog";
          const hl = highlight === m.dishId;
          return (
            <g key={m.dishId} onMouseEnter={() => onHover?.(m.dishId)} onMouseLeave={() => onHover?.(null)} style={{ cursor: "default" }}>
              <circle cx={cx} cy={cy} r={hl ? 11 : 8} fill={QUADRANT[q].colour} stroke="#2b2622" strokeWidth={hl ? 3 : 2} />
              {(hl || labelAt.has(m.dishId)) && (
                <text x={labelAt.get(m.dishId)?.x ?? Math.max(60, Math.min(W - 60, cx))} y={labelAt.get(m.dishId)?.y ?? cy - 13} textAnchor="middle" fontFamily="Nunito, sans-serif" fontSize="14.5" fontWeight="800" fill="#2b2622" paintOrder="stroke" stroke="#fffdf8" strokeWidth="3">
                  {shortName(names[m.dishId] ?? m.dishId)}
                </text>
              )}
            </g>
          );
        })}
        {noSales && (
          <text x={W / 4} y={H - 30} textAnchor="middle" fontFamily="Nunito, sans-serif" fontSize="14" fontWeight="700" fill="#5c534a">
            No sales yet: margin only
          </text>
        )}
      </svg>
    </div>
  );
}
