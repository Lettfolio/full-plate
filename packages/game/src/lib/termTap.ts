/**
 * Round 13 (E, R11.11 item 1): glossary words as touch targets.
 *
 * Each `.term` carries an invisible ≥ 44 × 44 px hit area (theme.css, `.term::before`, centred on the word, never
 * smaller than the word; no layout change, nothing drawn). Inline words sit on 20-odd-pixel lines, so two hit areas
 * can overlap, and one can lie over a neighbouring button. Hit testing alone would give the tap to whichever box paints
 * last, so this one capture-phase click listener settles it:
 *
 *  - a tap inside a word's own box is that word's (nothing changes);
 *  - a tap that reached a word only through its hit area goes to a real control under the finger first (a button or
 *    link whose own box contains the point), else to the NEAREST word whose hit area contains the point (distance from
 *    the point to each word's own box), so two close words split the gap between them.
 *
 * Words inside a control (a button's label) have no hit area: the control is the target there.
 */

export interface Box { left: number; top: number; right: number; bottom: number }
/** Half the minimum target (WCAG 2.5.5's 44 px). */
export const HALF = 22;

/** The hit area of a word's own box: at least 44 × 44, centred, never smaller than the box. */
export function hitBox(r: Box): Box {
  const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
  return {
    left: Math.min(r.left, cx - HALF), right: Math.max(r.right, cx + HALF),
    top: Math.min(r.top, cy - HALF), bottom: Math.max(r.bottom, cy + HALF),
  };
}
const inside = (b: Box, x: number, y: number) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
/** Distance from a point to a box (0 inside it). */
export function distance(b: Box, x: number, y: number): number {
  const dx = Math.max(b.left - x, 0, x - b.right), dy = Math.max(b.top - y, 0, y - b.bottom);
  return Math.hypot(dx, dy);
}

/**
 * Which of `words` (their own boxes) a tap at (x, y) belongs to: the nearest one whose hit area contains the point,
 * the first on a tie; -1 when none does. Pure (the tests use it directly).
 */
export function nearestWord(words: readonly Box[], x: number, y: number): number {
  let best = -1, bestD = Infinity;
  words.forEach((w, i) => {
    if (!inside(hitBox(w), x, y)) return;
    const d = distance(w, x, y);
    if (d < bestD) { best = i; bestD = d; }
  });
  return best;
}

const CONTROL = "button, a[href], input, select, textarea, summary, label, [role=button], [role=tab], [role=radio], [role=checkbox], [role=switch], [role=link], [role=menuitem], [role=option], [role=slider]";
const TERM = ".term:not(.term--inbutton)";

function onClick(e: MouseEvent): void {
  const t = (e.target as Element | null)?.closest?.(TERM) as HTMLElement | null;
  if (!t || !e.isTrusted || (e.clientX === 0 && e.clientY === 0 && e.detail === 0)) return; // keyboard "click": no point
  const x = e.clientX, y = e.clientY;
  if (inside(t.getBoundingClientRect(), x, y)) return; // on the word itself
  // Reached through the hit area. A real control under the finger comes first.
  const stack = document.elementsFromPoint(x, y);
  const control = stack.filter((el) => !el.closest(TERM)).map((el) => el.closest(CONTROL) as HTMLElement | null)
    .find((el): el is HTMLElement => !!el && !el.contains(t) && inside(el.getBoundingClientRect(), x, y));
  const words = [...new Set(stack.map((el) => el.closest(TERM)).filter((el): el is HTMLElement => !!el))];
  const pick = control ? null : words[nearestWord(words.map((w) => w.getBoundingClientRect()), x, y)];
  if (!control && (!pick || pick === t)) return;
  e.preventDefault();
  e.stopPropagation();
  if (document.activeElement === t) t.blur();
  if (control) control.click();
  else pick!.focus();
}

let installed = false;
/** Once, from main.tsx. */
export function installTermTap(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("click", onClick, true);
}
