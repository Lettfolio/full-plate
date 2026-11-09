import type { ReactNode } from "react";
import { GLOSSARY, type TermId } from "../lib/glossary";

/**
 * Round 5: a plain-English label with the real trade term attached (UI-NOTES "The Term convention").
 *
 *   <Term id="royalty" />                    → "Money the brand gets from each shop" + "royalty" in small text beneath
 *   <Term id="covers" inline />              → "guests" with "covers" as a dotted-underline tooltip
 *   <Term id="royalty">Royalty</Term>        → children replace the plain label
 *
 * The real word is never dropped: it is either the subtitle (`.term__real`) or the hover/focus tooltip, and it is
 * always in the accessible name. The one-line explanation is the tooltip in both forms.
 */
export function Term({ id, children, inline = false, className }: { id: TermId; children?: ReactNode; inline?: boolean; className?: string }) {
  const g = GLOSSARY[id];
  const plain = children ?? g.plain;
  const tip = `${g.term}: ${g.explain}`;
  if (inline) {
    return (
      <abbr className={`term term--inline ${className ?? ""}`.trim()} title={tip} tabIndex={0} data-term={g.term}>
        {plain}
      </abbr>
    );
  }
  return (
    <span className={`term ${className ?? ""}`.trim()} title={tip} data-term={g.term}>
      <span className="term__plain">{plain}</span>
      <span className="term__real">{g.term}</span>
    </span>
  );
}
