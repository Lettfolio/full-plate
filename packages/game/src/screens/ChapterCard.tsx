/**
 * Round 12 (C): the chapter card. Year 1 is told as chapters of one month (30 days) each; on the evening a chapter
 * ends, this card scores the month out of five stars from its own results and says one thing to do next. One tap
 * closes it. Presentation only: the sim's year and the fork are unchanged. Lazy chunk.
 */
import { lazy, Suspense } from "react";
import type { DayResult, GameState } from "@full-plate/sim-core";
import { Dialog } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { MoneyText } from "../components/MoneyText";
import { Stars } from "../components/Stars";
import { Term } from "../components/Term";
import { CHAPTER_DAYS, type VoicesMemo } from "../state/paths";
import "./challenge.css";

// Round 13 (D): "Regular of the month" (lazy: it needs the voices data).
const RegularOfMonth = lazy(() => import("../components/RegularOfMonth").then((m) => ({ default: m.RegularOfMonth })));

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
 */
export function chapterScore(history: readonly DayResult[], n: number, chapters: number): ChapterScore {
  const days = history.filter((d) => d.day >= (n - 1) * CHAPTER_DAYS && d.day < n * CHAPTER_DAYS);
  const profit = sum(days.map((d) => d.profit));
  const covers = sum(days.map((d) => d.covers));
  const rating = covers ? sum(days.map((d) => d.averageRating * d.covers)) / covers : 0;
  const popularity = sum(days.map((d) => d.popularityDelta));
  const stars = 1 + (profit > 0 ? 1 : 0) + (rating >= 3.5 ? 1 : 0) + (rating >= 4.2 ? 1 : 0) + (popularity > 0 ? 1 : 0);
  const next = n >= chapters ? "That's the year. Keep it steady: two visitors with a big question are on their way."
    : profit <= 0 ? "Next: make the month pay. Check the Menu's margins and trim the rota on quiet days."
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
  const s = chapterScore(game.history, n, chapters);
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
