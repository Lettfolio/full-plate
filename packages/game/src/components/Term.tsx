import { useId, useState, type FocusEvent, type MouseEvent, type ReactNode } from "react";
import { GLOSSARY, type TermId } from "../lib/glossary";
import { useSettings } from "../lib/settings";

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
 *
 * Round 11b (the player is 14): the screen shows the real trade word (`<Term id="eightySix" inline>86</Term>`), the tip
 * says what it means. Two additions:
 *  - **Underline once.** An inline term gets its dotted underline the first time that word appears in a session (and
 *    until it is tapped); later copies are plain text, still tappable, still with the tip (`term--quiet`). Settings ›
 *    "Underline words I can tap" › Always brings every underline back. Day-1 Menu stops looking like a worksheet.
 *  - **Inside a button** (`inButton`): a span with no tabindex (nothing focusable inside a button) and an aria-hidden
 *    tip (the button's name stays its label). A tap on the word shows the tip and does *not* press the button; a tap
 *    anywhere else on the button does. `inButton="passive"` is for a button whose whole label is the word (Service's
 *    "86"): hover shows the tip, a tap presses the button, and a nearby term (the list's header) explains it.
 *    Board options and log lines get their terms from <TermText>.
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

/** Round 11b: the first Term instance of each word this session (by React id), which keeps the underline. */
const firstSeen = new Map<TermId, string>();
/** For tests (and a new game, if wanted): every word counts as unseen again. */
export function resetTermsSeen(): void { firstSeen.clear(); }
/** Stable per instance: true for the first instance of `id` this session (React's double render in StrictMode agrees). */
function claimFirst(id: TermId, key: string): boolean {
  const k = firstSeen.get(id);
  if (k === undefined) { firstSeen.set(id, key); return true; }
  return k === key;
}

/** A tap on a term inside a button shows its tip instead of pressing the button (the tip closes after a few seconds). */
function tapInButton(e: MouseEvent<HTMLElement>): void {
  e.preventDefault();
  e.stopPropagation();
  const el = e.currentTarget;
  placeTip(el);
  if (el.hasAttribute("data-open")) { el.removeAttribute("data-open"); return; }
  el.setAttribute("data-open", "");
  window.setTimeout(() => el.removeAttribute("data-open"), 4000);
}

/** Round 11 (D, U7): a career rung's title with the trade word tipped ("Sous chef" → second chef). */
export function rungTerm(title: string): TermId | undefined {
  return /commis/i.test(title) ? "commis" : /chef de partie/i.test(title) ? "chefDePartie" : /sous chef/i.test(title) ? "sousChef" : undefined;
}
export function RungName({ title }: { title: string }) {
  const id = rungTerm(title);
  return id ? <Term id={id} inline>{title}</Term> : <>{title}</>;
}

export function Term({ id, children, inline = false, inButton = false, className }: { id: TermId; children?: ReactNode; inline?: boolean; inButton?: boolean | "passive"; className?: string }) {
  const g = GLOSSARY[id];
  const plain = children ?? g.plain;
  const rid = useId();
  const tipId = `term-${rid.replace(/:/g, "")}`;
  const [{ underlineTerms }] = useSettings();
  const [first] = useState(() => claimFirst(id, rid));
  const [tapped, setTapped] = useState(false);
  const quiet = underlineTerms !== "always" && (!first || tapped) ? " term--quiet" : "";
  const markTapped = () => { if (!tapped) setTapped(true); };
  if (inButton) {
    return (
      <span className={`term term--inline term--inbutton${quiet} ${className ?? ""}`.trim()} data-term-id={id} data-term={g.term} onMouseEnter={onShow} onClick={inButton === "passive" ? undefined : (e) => { tapInButton(e); markTapped(); }}>
        {plain}
        <span role="tooltip" aria-hidden="true" className="term__tip">{g.term}: {g.explain}</span>
      </span>
    );
  }
  const tip = <span role="tooltip" id={tipId} className="term__tip">{g.term}: {g.explain}</span>;
  if (inline) {
    return (
      <abbr className={`term term--inline${quiet} ${className ?? ""}`.trim()} tabIndex={-1} data-term-id={id} aria-describedby={tipId} data-term={g.term} onFocus={(e) => { onShow(e); markTapped(); }} onMouseEnter={onShow}>
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
