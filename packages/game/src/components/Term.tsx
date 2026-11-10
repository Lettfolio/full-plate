import { useId, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { GLOSSARY, type TermId } from "../lib/glossary";

/**
 * Round 5: a plain-English label with the real trade term attached (UI-NOTES "The Term convention").
 *
 *   <Term id="royalty" />                    → "Money the brand gets from each shop" + "royalty" in small text beneath
 *   <Term id="covers" inline />              → "guests" with "covers" as a dotted-underline tooltip
 *   <Term id="royalty">Royalty</Term>        → children replace the plain label
 *
 * The real word is never dropped: it is either the subtitle (`.term__real`) or the tooltip, and it is always in the
 * accessible name. The one-line explanation is the tooltip in both forms.
 *
 * Round 5 review: the tooltip is a real element (`role="tooltip"`, linked by `aria-describedby`) shown on hover *and*
 * keyboard focus — a `title` attribute never appears on focus and is unreliable in screen readers. Both forms are
 * focusable (tabIndex 0).
 *
 * Round 11 (D, red-team U9): terms are out of the Tab order (tabIndex -1: 71 terms made 156 tab stops on the day-1
 * Menu). A tap or click still focuses one and shows its tip; keyboard players press "?" (or the "What the words mean"
 * skip link) for the words sheet (components/WordsSheet.tsx), which lists every term on screen. `data-term-id` is what
 * the sheet collects.
 */
/** Widest tip (theme.css `.term__tip` max-width) plus a margin. */
const TIP_ROOM = 272;

/**
 * Round 7 review: a tip opening to the right of a word near the right edge widened the page (a sideways scrollbar while
 * hovering "margin" on the Menu, up to 137 px). Before it shows, flip it to open leftwards when it would not fit.
 * Layout only — nothing is stored.
 */
export function placeTip(el: HTMLElement): void {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const r = el.getBoundingClientRect();
  if (r.left + TIP_ROOM > vw && r.right - TIP_ROOM >= 0) el.setAttribute("data-flip", "");
  else el.removeAttribute("data-flip");
}
const onShow = (e: FocusEvent<HTMLElement> | MouseEvent<HTMLElement>) => placeTip(e.currentTarget);

/** Round 11 (D, U7): a career rung's title with the trade word tipped ("Sous chef" → second chef). */
export function rungTerm(title: string): TermId | undefined {
  return /commis/i.test(title) ? "commis" : /chef de partie/i.test(title) ? "chefDePartie" : /sous chef/i.test(title) ? "sousChef" : undefined;
}
export function RungName({ title }: { title: string }) {
  const id = rungTerm(title);
  return id ? <Term id={id} inline>{title}</Term> : <>{title}</>;
}

export function Term({ id, children, inline = false, className }: { id: TermId; children?: ReactNode; inline?: boolean; className?: string }) {
  const g = GLOSSARY[id];
  const plain = children ?? g.plain;
  const tipId = `term-${useId().replace(/:/g, "")}`;
  const tip = <span role="tooltip" id={tipId} className="term__tip">{g.term}: {g.explain}</span>;
  if (inline) {
    return (
      <abbr className={`term term--inline ${className ?? ""}`.trim()} tabIndex={-1} data-term-id={id} aria-describedby={tipId} data-term={g.term} onFocus={onShow} onMouseEnter={onShow}>
        {plain}
        {tip}
      </abbr>
    );
  }
  return (
    <span className={`term ${className ?? ""}`.trim()} tabIndex={-1} data-term-id={id} aria-describedby={tipId} data-term={g.term} onFocus={onShow} onMouseEnter={onShow}>
      <span className="term__plain">{plain}</span>
      <span className="term__real">{g.term}</span>
      {tip}
    </span>
  );
}
