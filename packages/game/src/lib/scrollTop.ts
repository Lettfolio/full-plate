/**
 * Round 14 (E, U1): where the page sits when a screen or a tab changes.
 *
 * On a phone the page scrolls as one (phone.css), so without this every phase change and tab change kept the previous
 * screen's scroll position (day 1 opened 1,696 px down; Staff opened at its bottom). Now:
 *   - a new screen (title → lease → planning → service → evening → planning…) starts at the top, and keyboard / screen
 *     reader focus moves to the screen's heading when the control that was pressed has gone (it never steals focus
 *     from something still on screen);
 *   - a planning tab starts at the top the first time it is opened that day; coming back to a tab the same day puts it
 *     back where it was left (`TabScrollMemory`, keyed by day and tab — nothing is stored);
 *   - a shortcut that sends her to a tab for a reason ("Hire someone first", the "Step 1" nudge) lands on the thing it
 *     is about (`landOn`), not on the top or on the last position.
 * Desktop and tablet scroll inside `.screen` instead of the page: both scrollers are handled, so the same rules hold.
 */

type Scroller = { read(): number; write(y: number): void; max(): number };

/** jsdom has no scrolling (and logs "not implemented" for window.scrollTo): the DOM helpers do nothing there. */
function live(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined" && !/jsdom/i.test(navigator.userAgent || "");
}
function screenEl(): HTMLElement | null { return typeof document === "undefined" ? null : document.querySelector<HTMLElement>(".screen"); }

/** The page (phones) and the `.screen` box (wider screens), whichever is scrolled. */
export const pageScroller: Scroller = {
  read() {
    if (!live()) return 0;
    return Math.max(window.scrollY || 0, screenEl()?.scrollTop ?? 0);
  },
  write(y) {
    if (!live()) return;
    const sc = screenEl();
    if (sc && sc.scrollHeight > sc.clientHeight + 1) sc.scrollTop = y;
    window.scrollTo(0, y);
  },
  max() {
    if (!live()) return 0;
    const sc = screenEl();
    const inner = sc ? sc.scrollHeight - sc.clientHeight : 0;
    return Math.max(document.documentElement.scrollHeight - window.innerHeight, inner, 0);
  },
};

/** Top of the page (both scrollers). */
export function scrollToTop(s: Scroller = pageScroller): void { s.write(0); }

/**
 * Moves focus to the screen's heading, but only when focus has nowhere useful to be: it is on <body> (the button that
 * was pressed has gone) or on an element no longer in the page. The heading gets tabIndex -1 so it can take focus
 * without joining the Tab order. Returns the heading focused, if any.
 */
export function focusScreenHeading(doc: Document = document): HTMLElement | null {
  const a = doc.activeElement;
  if (a && a !== doc.body && a.isConnected) return null;
  const h = doc.querySelector<HTMLElement>("main h1, main h2, .page h1, h1");
  if (!h) return null;
  if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
  h.focus({ preventScroll: true });
  return h;
}

/**
 * Remembers each planning tab's scroll position within one day. `enter(day, tab)` returns where that tab should open:
 * its own last position if it was open earlier the same day, else 0. `note(y)` records the current tab's position
 * (called from the scroll listener). A new day forgets everything.
 */
export class TabScrollMemory {
  private day = -1;
  private current: string | null = null;
  private pos = new Map<string, number>();
  enter(day: number, tab: string): number {
    if (day !== this.day) { this.day = day; this.pos.clear(); }
    this.current = tab;
    return this.pos.get(tab) ?? 0;
  }
  note(y: number): void { if (this.current !== null) this.pos.set(this.current, Math.max(0, Math.round(y))); }
  /** The tab currently being tracked. */
  get tab(): string | null { return this.current; }
}

/**
 * Restores `y` once the page is tall enough to hold it (a lazy tab grows after it mounts): tries every frame for up
 * to `ms`, then settles for the furthest it can go. Returns a cancel function.
 */
export function restoreScroll(y: number, s: Scroller = pageScroller, ms = 1200): () => void {
  if (!live()) return () => {};
  if (y <= 0) { s.write(0); return () => {}; }
  let raf = 0; const t0 = performance.now();
  const step = () => {
    if (s.max() >= y - 1 || performance.now() - t0 > ms) { s.write(Math.min(y, s.max())); return; }
    s.write(Math.min(y, s.max()));
    raf = requestAnimationFrame(step);
  };
  step();
  return () => cancelAnimationFrame(raf);
}

let pendingLanding: string | null = null;
/**
 * A shortcut asks the next tab to open on `selector` (a CSS selector) instead of its top. The tab change picks it up
 * (`takeLanding`) and `landOn` scrolls it into view once it has rendered.
 */
export function requestLanding(selector: string): void { pendingLanding = selector; }
export function takeLanding(): string | null { const s = pendingLanding; pendingLanding = null; return s; }

/** Scrolls the first element matching `selector` into view (centred), waiting up to `ms` for a lazy tab to render it. */
export function landOn(selector: string, ms = 2000): () => void {
  if (!live()) return () => {};
  let raf = 0; const t0 = performance.now();
  const step = () => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) { el.scrollIntoView({ block: "center", inline: "nearest" }); return; }
    if (performance.now() - t0 < ms) raf = requestAnimationFrame(step);
  };
  // a frame later: the screen-change reset (App.tsx, a parent's layout effect) runs after this tab's own
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/** The one memory for the planning tabs (Planning unmounts during service; the day key resets it next morning). */
export const tabScroll = new TabScrollMemory();

/**
 * For a moment after a screen change, keeps the page at the top when something focuses itself (React's `autoFocus`
 * scrolls the focused button into view: the evening's "Next day", the game-over and challenge buttons). The focus
 * stays where the screen put it (keyboard users start on the primary); only the scroll is undone. Ends at the first
 * touch, click, key or wheel, or after `ms`. Returns a cancel function.
 */
export function holdTopAfterScreenChange(ms = 2500, s: Scroller = pageScroller): () => void {
  if (!live()) return () => {};
  const onFocus = () => { s.write(0); };
  const stop = () => {
    clearTimeout(timer);
    document.removeEventListener("focusin", onFocus, true);
    for (const ev of ENDS) window.removeEventListener(ev, stop, true);
  };
  const ENDS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
  document.addEventListener("focusin", onFocus, true);
  for (const ev of ENDS) window.addEventListener(ev, stop, true);
  const timer = setTimeout(stop, ms);
  return stop;
}
