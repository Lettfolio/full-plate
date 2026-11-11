/**
 * Round 14 (C, red-team U2/S14-4): Planning's hook into lib/prefetch.ts (a chunk of its own): half a second after the
 * screen settles, in idle time, fetch the rest of the day's chunks so the day can be finished offline.
 */
export function prefetchSoon(path?: "empire" | "stars"): () => void {
  if (import.meta.env.MODE === "test") return () => {}; // the unit tests load modules on their own terms
  let live = true;
  // Offline, wait for the connection: a failed import is kept for the life of the page (Chromium), so fetching now
  // would spoil the parts for later.
  const go = (): void => {
    if (!live) return;
    if (navigator.onLine === false) { window.addEventListener("online", go, { once: true }); return; }
    void import("./prefetch").then((m) => m.prefetchDay(path), () => {});
  };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  const t = setTimeout(() => (w.requestIdleCallback ? w.requestIdleCallback(go, { timeout: 1500 }) : go()), 500);
  return () => { live = false; clearTimeout(t); window.removeEventListener("online", go); };
}
