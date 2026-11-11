import { Suspense, useEffect, useState } from "react";
import { lazyRetry } from "../lib/lazyRetry";
import { modalOpen } from "../lib/modal";

// The sheet itself loads on first use (main-chunk budget).
const WordsDialog = lazyRetry(() => import("./WordsDialog").then((m) => ({ default: m.WordsDialog })));

/** One word on screen: what it says, and its tip (the Term / chip tooltip text). */
export interface ScreenWord { label: string; tip: string }

/**
 * Round 11 (D, red-team U9): every `.term` on screen (glossary Terms and the staff room's trait chips) with its tip,
 * deduplicated, in reading order. Read from the DOM when the sheet opens, so it always matches what is showing.
 */
export function wordsOnScreen(root: ParentNode = document): ScreenWord[] {
  const out: ScreenWord[] = [];
  const seen = new Set<string>();
  for (const el of root.querySelectorAll<HTMLElement>(".term")) {
    if (el.closest(".modal")) continue;
    const tipEl = el.querySelector('[role="tooltip"]');
    const tip = tipEl?.textContent?.trim() ?? "";
    if (!tip || seen.has(tip)) continue;
    seen.add(tip);
    const label = (el.querySelector(".term__plain")?.textContent ?? [...el.childNodes].filter((n) => n !== tipEl).map((n) => n.textContent).join("")).trim();
    out.push({ label: label || tip.split(":")[0]!, tip });
  }
  return out;
}

export const WORDS_EVENT = "fp:words";
/** Open the words sheet from anywhere (the skip link uses it). */
export function openWords(): void { window.dispatchEvent(new Event(WORDS_EVENT)); }

/**
 * The words sheet: the glossary for the current screen. Keyboard: "?" anywhere outside a text field or another sheet.
 * Terms themselves are out of the Tab order (Term.tsx), so this is how a keyboard player reads them.
 */
export function WordsSheet() {
  const [words, setWords] = useState<ScreenWord[] | null>(null);
  useEffect(() => {
    const show = () => setWords(wordsOnScreen());
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable)) return;
      if (modalOpen()) return; // another sheet owns the keys
      e.preventDefault();
      show();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(WORDS_EVENT, show);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener(WORDS_EVENT, show); };
  }, []);
  if (!words) return null;
  return <Suspense fallback={null}><WordsDialog words={words} onClose={() => setWords(null)} /></Suspense>;
}
