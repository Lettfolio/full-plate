/** The Full Plate mark: a plate with a tomato and a basil leaf. Decorative. */
export function Plate({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 160 160" aria-hidden="true">
      <ellipse cx="80" cy="140" rx="58" ry="8" fill="rgba(80,55,20,0.12)" />
      <circle cx="80" cy="76" r="64" fill="#fffdf8" stroke="#2b2622" strokeWidth="5" />
      <circle cx="80" cy="76" r="46" fill="none" stroke="#e6d8bd" strokeWidth="3" strokeDasharray="2 7" strokeLinecap="round" />
      <circle cx="72" cy="82" r="26" fill="#e0533d" stroke="#2b2622" strokeWidth="4" />
      <path d="M62 72 q6 -6 12 -2" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.65" />
      <path d="M72 58 q14 -20 34 -12 q-6 22 -30 18 z" fill="#4d8f47" stroke="#2b2622" strokeWidth="4" strokeLinejoin="round" />
      <path d="M76 62 q12 -8 24 -12" stroke="#2b2622" strokeWidth="2.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}
