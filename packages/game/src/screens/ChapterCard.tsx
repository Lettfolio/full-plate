/**
 * Round 12 (C): the chapter card. Year 1 is told as chapters of one month (30 days) each; on the evening a chapter
 * ends, this card scores the month out of five stars from its own results and says one thing to do next. One tap
 * closes it. Presentation only: the sim's year and the fork are unchanged. Lazy chunk.
 */
import { Suspense } from "react";
import { lazyRetry } from "../lib/lazyRetry";
import type { DayResult, GameState } from "@full-plate/sim-core";
import { Dialog } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { MoneyText } from "../components/MoneyText";
import { Stars } from "../components/Stars";
import { Term } from "../components/Term";
import { CHAPTER_DAYS, type VoicesMemo } from "../state/paths";
import "./challenge.css";

// Round 13 (D): "Regular of the month" (lazy: it needs the voices data).
const RegularOfMonth = lazyRetry(() => import("../components/RegularOfMonth").then((m) => ({ default: m.RegularOfMonth })));

export interface ChapterScore {
  n: number;
  stars: number;
  profit: number;
  /** Guest-weighted average rating over the month (0 with no guests). */
  rating: number;
  covers: number;
  popularity: number;
  next: string;
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * One star to start, then one each for: a month in profit, an average of 3.5★, an average of 4.2★, and popularity up
 * over the month. The line says what to work on (the first that's missing) or, on the last chapter, what's coming.
 *
 * Round 14 (F, U14): a month that lost money scores 1 star, or 2 if it was better than the month before (the first
 * month: if its second half beat its first) — a −£5,798 month no longer shows 2 of 5 for good reviews. The "make it
 * pay" advice reads the month: no staff → hire a chef; nights with nothing to cook → keep the larder stocked; then
 * whichever of wages or food took most (the rota line only when somebody is on it).
 */
export function chapterScore(history: readonly DayResult[], n: number, chapters: number, staffNow?: number): ChapterScore {
  const days = history.filter((d) => d.day >= (n - 1) * CHAPTER_DAYS && d.day < n * CHAPTER_DAYS);
  const profit = sum(days.map((d) => d.profit));
  const covers = sum(days.map((d) => d.covers));
  const rating = covers ? sum(days.map((d) => d.averageRating * d.covers)) / covers : 0;
  const popularity = sum(days.map((d) => d.popularityDelta));
  const before = history.filter((d) => d.day >= (n - 2) * CHAPTER_DAYS && d.day < (n - 1) * CHAPTER_DAYS);
  const mid = (n - 1) * CHAPTER_DAYS + CHAPTER_DAYS / 2;
  const improved = before.length
    ? profit > sum(before.map((d) => d.profit))
    : sum(days.filter((d) => d.day >= mid).map((d) => d.profit)) > sum(days.filter((d) => d.day < mid).map((d) => d.profit));
  const stars = profit > 0
    ? 2 + (rating >= 3.5 ? 1 : 0) + (rating >= 4.2 ? 1 : 0) + (popularity > 0 ? 1 : 0)
    : 1 + (improved && days.length > 0 ? 1 : 0);
  const open = days.filter((d) => !d.closed);
  const alone = open.filter((d) => (d.ownerCovered ?? []).includes("chef")).length;
  const empty = open.filter((d) => d.covers === 0 && Object.keys(d.perDish ?? {}).length === 0).length;
  const wages = sum(days.map((d) => d.labourCost));
  const food = sum(days.map((d) => d.foodCost + d.waste.prep + d.waste.spoil));
  const noStaff = staffNow === 0;
  const pay = noStaff ? "Next: make the month pay. Hire a chef: cooking on your own is slow, so fewer guests eat and pay."
    : open.length > 0 && alone >= open.length / 2 ? "Next: make the month pay. You did the cooking most days: put a chef on every day's rota."
    : empty >= 2 ? `Next: make the month pay. On ${empty} days nothing could be cooked: restock every evening (it arrives the next morning).`
    : wages > food ? "Next: make the month pay. Wages took the most: trim the rota on quiet days."
    : "Next: make the month pay. Food took the most: check the Menu's margins and buy only what tomorrow needs.";
  const next = n >= chapters ? "That's the year. Keep it steady: two visitors with a big question are on their way."
    : profit <= 0 ? pay
    : rating < 3.5 ? "Next: better plates. Fewer dishes, enough cooks, and fresh stock lift the reviews."
    : popularity <= 0 ? "Next: bring people in. Good reviews and a fair price grow popularity."
    : rating < 4.2 ? "Next: from good to great. A trained chef and a tighter menu push reviews past 4.2★."
    : "Next: more of the same. You could afford another table or a decorating treat.";
  return { n, stars, profit, rating, covers, popularity, next };
}

interface Props {
  game: GameState;
  n: number;
  chapters: number;
  onClose: () => void;
  /** Round 13 (D): the regulars' memo (PathMeta.voices). */
  memo?: VoicesMemo | undefined;
  /** Round 13 (D): the regulars only appear in an owner's own game. */
  regulars?: boolean | undefined;
}

export function ChapterCard({ game, n, chapters, onClose, memo, regulars = true }: Props) {
  const s = chapterScore(game.history, n, chapters, game.staff.length);
  return (
    <Dialog title={`Chapter ${n} done`} kicker={`Chapter ${n} of ${chapters} · days ${(n - 1) * CHAPTER_DAYS + 1}–${n * CHAPTER_DAYS}`} stamp={<Icon name="calendar" size={28} />} onClose={onClose} className="chapter">
      <div className="chapter__stars">
        <Stars rating={s.stars} size={34} />
        <span className="chapter__count">{s.stars} of 5</span>
      </div>
      <dl className="chapter__stats">
        <div><dt>Profit</dt><dd><MoneyText pence={s.profit} tone whole /></dd></div>
        <div><dt>Reviews</dt><dd>{s.rating ? `${s.rating.toFixed(1)}★` : "—"}</dd></div>
        <div><dt><Term id="covers" inline>Covers</Term></dt><dd>{s.covers.toLocaleString("en-GB")}</dd></div>
        <div><dt><Term id="popularity" inline>Popularity</Term></dt><dd>{s.popularity >= 0 ? "+" : "−"}{Math.abs(Math.round(s.popularity))}</dd></div>
      </dl>
      {regulars && <Suspense fallback={null}><RegularOfMonth game={game} from={(n - 1) * CHAPTER_DAYS} to={n * CHAPTER_DAYS - 1} memo={memo} /></Suspense>}
      <p className="chapter__next">{s.next}</p>
      <button className="btn btn--primary btn--tap chapter__ok" data-autofocus onClick={onClose}>{n >= chapters ? "On with the year" : `On to chapter ${n + 1}`}</button>
    </Dialog>
  );
}
