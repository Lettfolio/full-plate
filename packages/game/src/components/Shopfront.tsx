/**
 * Round 7: the title screen's picture — a little corner restaurant with a striped awning, a steaming plate in the
 * window and a chalkboard on the pavement. Original art, CSS colours from the theme; decorative (aria-hidden).
 * The only motion is the steam, and it stops under prefers-reduced-motion (theme.css R7-C).
 */
export function Shopfront({ className, name = "Full Plate" }: { className?: string; name?: string }) {
  const stripes = Array.from({ length: 10 }, (_, i) => i);
  return (
    <svg className={className} viewBox="0 0 480 420" aria-hidden="true">
      {/* sky blobs + pavement */}
      <circle cx="74" cy="70" r="46" fill="var(--amber-wash)" />
      <circle cx="430" cy="46" r="26" fill="var(--tomato-wash)" />
      <rect x="0" y="360" width="480" height="60" rx="12" fill="var(--cream-deep)" />
      <path d="M0 372 H480" stroke="var(--line-strong)" strokeWidth="3" strokeDasharray="22 14" />
      {/* the building */}
      <rect x="46" y="64" width="388" height="300" rx="16" fill="var(--paper)" stroke="var(--ink)" strokeWidth="5" />
      <rect x="46" y="64" width="388" height="300" rx="16" fill="url(#fp-bricks)" opacity="0.5" />
      <defs>
        <pattern id="fp-bricks" width="40" height="20" patternUnits="userSpaceOnUse">
          <path d="M0 0.5 H40 M0 10.5 H40 M20 0 V10 M0 10 V20 M40 10 V20" stroke="var(--line)" strokeWidth="1.5" fill="none" />
        </pattern>
      </defs>
      {/* name board */}
      <rect x="104" y="82" width="272" height="58" rx="12" fill="var(--ink)" />
      <rect x="112" y="90" width="256" height="42" rx="8" fill="none" stroke="var(--amber)" strokeWidth="2" strokeDasharray="3 5" />
      <text x="240" y="122" textAnchor="middle" fontFamily="var(--font-display)" fontWeight="600" fontSize="28" fill="var(--cream)">{name}</text>
      {/* awning: ten stripes and a scalloped hem */}
      <g>
        {stripes.map((i) => <path key={i} d={`M${40 + i * 40} 156 h40 l6 40 h-52z`} fill={i % 2 ? "var(--paper)" : "var(--tomato)"} stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />)}
        {stripes.map((i) => <path key={`h${i}`} d={`M${34 + i * 40} 196 a26 14 0 0 0 52 0z`} fill={i % 2 ? "var(--paper)" : "var(--tomato)"} stroke="var(--ink)" strokeWidth="3" strokeLinejoin="round" />)}
      </g>
      {/* window with a table and a steaming plate */}
      <rect x="74" y="226" width="190" height="122" rx="10" fill="var(--sky-wash)" stroke="var(--ink)" strokeWidth="4" />
      <path d="M90 240 l26 -6 M214 244 l30 -8" stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity="0.8" />
      <rect x="96" y="312" width="146" height="10" rx="4" fill="#c99a63" stroke="var(--ink)" strokeWidth="3" />
      <ellipse cx="169" cy="306" rx="40" ry="9" fill="var(--paper)" stroke="var(--ink)" strokeWidth="3" />
      <path d="M146 302 q23 -18 46 0" fill="var(--tomato)" stroke="var(--ink)" strokeWidth="3" />
      <path d="M170 288 q8 -10 18 -8" stroke="var(--basil)" strokeWidth="4" fill="none" strokeLinecap="round" />
      <g className="shopfront__steam" stroke="var(--ink-faint)" strokeWidth="3" fill="none" strokeLinecap="round">
        <path d="M156 276 q-8 -10 0 -20 q8 -10 0 -20" />
        <path d="M172 272 q-8 -10 0 -20 q8 -10 0 -20" />
        <path d="M188 276 q-8 -10 0 -20 q8 -10 0 -20" />
      </g>
      {/* door with an Open sign */}
      <rect x="292" y="226" width="110" height="134" rx="8" fill="var(--basil)" stroke="var(--ink)" strokeWidth="4" />
      <rect x="306" y="240" width="82" height="50" rx="6" fill="var(--sky-wash)" stroke="var(--ink)" strokeWidth="3" />
      <circle cx="388" cy="306" r="5" fill="var(--amber)" stroke="var(--ink)" strokeWidth="2" />
      <path d="M326 252 l21 -10 l21 10" stroke="var(--ink)" strokeWidth="2" fill="none" />
      <rect x="318" y="252" width="58" height="26" rx="5" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2.5" />
      <text x="347" y="271" textAnchor="middle" fontFamily="var(--font-display)" fontWeight="600" fontSize="16" fill="var(--tomato-deep)">Open</text>
      {/* window box with basil */}
      <rect x="68" y="346" width="202" height="16" rx="4" fill="var(--tomato-deep)" stroke="var(--ink)" strokeWidth="3" />
      {[90, 120, 150, 180, 210, 240].map((x) => <path key={x} d={`M${x} 346 q-6 -14 4 -20 q8 8 -4 20z`} fill="var(--basil)" stroke="var(--ink)" strokeWidth="2" />)}
      {/* chalkboard on the pavement */}
      <g transform="translate(398 290) rotate(4)">
        <path d="M-6 100 L6 0 M70 100 L58 0" stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" />
        <rect x="-4" y="-4" width="72" height="72" rx="6" fill="var(--ink)" />
        <text x="32" y="18" textAnchor="middle" fontFamily="var(--font-display)" fontSize="16" fill="var(--cream)">Today</text>
        <text x="32" y="38" textAnchor="middle" fontFamily="var(--font-display)" fontSize="16" fill="var(--amber)">you're</text>
        <text x="32" y="58" textAnchor="middle" fontFamily="var(--font-display)" fontSize="16" fill="var(--cream)">the boss</text>
      </g>
    </svg>
  );
}
