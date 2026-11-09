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

export function Term({ id, children, inline = false, className }: { id: TermId; children?: ReactNode; inline?: boolean; className?: string }) {
  const g = GLOSSARY[id];
  const plain = children ?? g.plain;
  const tipId = `term-${useId().replace(/:/g, "")}`;
  const tip = <span role="tooltip" id={tipId} className="term__tip">{g.term}: {g.explain}</span>;
  if (inline) {
    return (
      <abbr className={`term term--inline ${className ?? ""}`.trim()} tabIndex={0} aria-describedby={tipId} data-term={g.term} onFocus={onShow} onMouseEnter={onShow}>
        {plain}
        {tip}
      </abbr>
    );
  }
  return (
    <span className={`term ${className ?? ""}`.trim()} tabIndex={0} aria-describedby={tipId} data-term={g.term} onFocus={onShow} onMouseEnter={onShow}>
      <span className="term__plain">{plain}</span>
      <span className="term__real">{g.term}</span>
      {tip}
    </span>
  );
}
