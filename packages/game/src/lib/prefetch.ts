/**
 * Round 14 (C, red-team U2/S14-4): once the planning screen has been up a moment, fetch (in idle time) every chunk the
 * rest of the day can need — each planning tab, the service floor, the evening and what hangs off it, the save file
 * and settings sheets — so a day already started can be finished with no connection. Each is fetched once a visit; a
 * failure is quiet (lazyRetry tries again when the part is opened). The path tabs come when a path is chosen.
 * round14.c.test checks that every lazy part of the day's screens is in DAY. This module is a chunk of its own (its
 * thirty imports would cost the main chunk ~4 kB): Planning loads it with `prefetchSoon` (lib/prefetchSoon.ts).
 */
const DAY: Record<string, () => Promise<unknown>> = {
  // planning tabs and what they open
  "screens/planning/StaffTab": () => import("../screens/planning/StaffTab"),
  "screens/planning/StockTab": () => import("../screens/planning/StockTab"),
  "screens/planning/RestaurantTab": () => import("../screens/planning/RestaurantTab"),
  "screens/planning/DecorateTab": () => import("../screens/planning/DecorateTab"),
  "screens/planning/MenuMatrixPanel": () => import("../screens/planning/MenuMatrixPanel"),
  "screens/planning/CookbookStrip": () => import("../screens/planning/CookbookStrip"),
  "screens/planning/InventDishSheet": () => import("../screens/planning/InventDishSheet"),
  "screens/planning/BrandTab": () => import("../screens/planning/BrandTab"),
  "screens/VisitFriend": () => import("../screens/VisitFriend"), // the Restaurant tab's share card (lib/coop/flag loadFriends)
  "components/GossipTicker": () => import("../components/GossipTicker"),
  "components/RegularsBook": () => import("../components/RegularsBook"),
  "components/BankCards": () => import("../components/BankCards"),
  "components/TryCard": () => import("../components/TryCard"), // R14 (E), merged in the review
  "components/TodayCard": () => import("../components/TodayCard"), // R14 (F), merged in the review
  // service
  "canvas/RestaurantView": () => import("../canvas/RestaurantView"),
  "canvas/decorArt": () => import("../canvas/decorArt"),
  "lib/regulars": () => import("../lib/regulars"),
  "lib/floorCamera": () => import("../lib/floorCamera"),
  // the evening and the next morning
  "screens/Evening": () => import("../screens/Evening"),
  "components/EveningExtras": () => import("../components/EveningExtras"),
  "components/PostcardDialog": () => import("../components/PostcardDialog"),
  "screens/EventModal": () => import("../screens/EventModal"),
  "screens/ChapterCard": () => import("../screens/ChapterCard"),
  "components/RegularOfMonth": () => import("../components/RegularOfMonth"),
  "screens/GameOver": () => import("../screens/GameOver"),
  "lib/voicesMemo": () => import("../lib/voicesMemo"),
  // the header's sheets and saving to a file
  "components/SettingsBody": () => import("../components/SettingsBody"),
  "components/WordsDialog": () => import("../components/WordsDialog"),
  "components/SaveSheet": () => import("../components/SaveSheet"),
  "components/StorageNotice": () => import("../components/StorageNotice"),
  "state/saveFiles": () => import("../state/saveFiles"),
  "state/saveCodec": () => import("../state/saveCodec"),
};
const PATHS: Record<"empire" | "stars", () => Promise<unknown>> = {
  empire: () => import("../screens/paths/EmpireTab"),
  stars: () => import("../screens/paths/StarsTab"),
};
/** Exported for round14.c.test. */
export const PREFETCHED = [...Object.keys(DAY), "screens/paths/EmpireTab", "screens/paths/StarsTab"];

const done = new Set<string>();

/** Fetches the day's chunks (and the chosen path's tab) once a visit. Returns how many it started (tests). */
export function prefetchDay(path?: "empire" | "stars"): number {
  const todo = Object.entries(DAY).filter(([k]) => !done.has(k));
  if (path && !done.has(path)) todo.push([path, PATHS[path]]);
  for (const [k, load] of todo) { done.add(k); void load().catch(() => { done.delete(k); }); }
  return todo.length;
}

/** Tests: forget what was fetched. */
export function resetPrefetch(): void { done.clear(); }
