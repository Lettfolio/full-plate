/**
 * Round 7: the placeholder a lazy chunk shows while it loads — the rough shape of a page (a heading and two cards) with
 * a slow sheen, instead of a bare "Loading…" line. Announced politely for screen readers.
 */
export function Skeleton({ label = "Loading" }: { label?: string }) {
  return (
    <div className="page">
      <div className="skeleton" role="status" aria-live="polite" aria-label={label}>
        <div className="skeleton__bar skeleton__bar--title" />
        <div className="skeleton__bar skeleton__bar--card" />
        <div className="skeleton__bar skeleton__bar--short" />
        <div className="skeleton__bar skeleton__bar--card" />
      </div>
    </div>
  );
}
