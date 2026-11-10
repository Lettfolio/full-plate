import { useEffect, useMemo, useState } from "react";
import type { GameState } from "@full-plate/sim-core";
import { MoneyText } from "../components/MoneyText";
import type { PathMeta, WinMeta } from "../state/paths";
import { dateLabel } from "../lib/calendar";
import { playSfx } from "../lib/sfx";
import { TermText } from "../components/TermText";

interface Props {
  game: GameState;
  meta: PathMeta;
  win: WinMeta;
  onKeepPlaying: () => void;
  onTitle: () => void;
}

const meals = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}bn` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n.toLocaleString("en-GB"));

export interface JourneyStep { day: number; icon: string; text: string }

/**
 * Round 7: the road from the first day to the ending, from what the save already holds (pure; exported for tests).
 * Day 0 is opening day; the fork; the first franchise or first star; the ending.
 */
export function journey(game: GameState, meta: PathMeta, win: WinMeta): JourneyStep[] {
  const out: JourneyStep[] = [{ day: 0, icon: "🔑", text: `Opened ${game.restaurantName}` }];
  if (meta.fork.chosenDay !== undefined) out.push({ day: meta.fork.chosenDay, icon: meta.fork.chosen === "empire" ? "🌍" : "⭐", text: meta.fork.chosen === "empire" ? "Chose to be everywhere" : "Chose to be the best" });
  const e = meta.empire;
  if (e) {
    const firstFranchise = e.sites.filter((s) => s.ownership !== "company").sort((a, b) => a.opened - b.opened)[0];
    if (firstFranchise) out.push({ day: firstFranchise.opened, icon: "🤝", text: `First franchise: ${firstFranchise.name}` });
    const hundredth = e.sites.filter((s) => s.status !== "building").sort((a, b) => a.opened - b.opened)[99];
    if (hundredth) out.push({ day: hundredth.opened, icon: "💯", text: "100th shop opened" });
  }
  const s = meta.stars;
  if (s) {
    const first = s.guides.michelin.history.find((h) => h.after > 0);
    if (first) out.push({ day: first.day, icon: "⭐", text: "First star from the guide" });
    const third = s.guides.michelin.history.find((h) => h.after === 3);
    if (third) out.push({ day: third.day, icon: "🌟", text: "Three stars!" });
  }
  out.push({ day: win.day, icon: win.won ? "🏆" : "🌙", text: win.title });
  return out.sort((a, b) => a.day - b.day);
}

/** The headline number of the run: meals for the Empire, stars for the Stars. */
function finalFigure(game: GameState, meta: PathMeta): { big: string; label: string } {
  if (meta.empire) return { big: meals(meta.empire.mealsServedTotal), label: "meals served" };
  if (meta.stars) {
    const n = Math.max(meta.stars.guides.michelin.stars, meta.stars.peakStars);
    if (n) return { big: "★".repeat(n), label: n === 1 ? "star at your best" : "stars at your best" };
  }
  return { big: game.stats.totalCovers.toLocaleString("en-GB"), label: "guests fed" };
}

/** Draws the win card on a canvas and downloads it as a PNG (no library, no network). */
// Round 12 (B): the picture is drawn by lib/postcard.ts (saveWinPicture), loaded on the click, and saved through the
// save-file path (the downloads capability inside claude.ai).

/** A fixed, seed-free scatter of confetti (decorative; stops under reduced motion). */
const CONFETTI = Array.from({ length: 28 }, (_, i) => ({ left: (i * 37) % 100, delay: ((i * 7) % 10) / 10, hue: i % 4 }));

/** Path endings (Empire meals/regions; Stars dynasty / El Bulli / handed back): a celebration and the journey. */
export function WinScreen({ game, meta, win, onKeepPlaying, onTitle }: Props) {
  const e = meta.empire;
  const s = meta.stars;
  const icon = win.kind.startsWith("empire") ? "🌍" : win.kind === "el_bulli" ? "🕯️" : win.kind === "handed_back" ? "🤲" : "⭐";
  const steps = useMemo(() => journey(game, meta, win), [game, meta, win]);
  const figure = finalFigure(game, meta);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (win.won) playSfx("win"); }, [win.won]);
  return (
    <div className={`gameover win ${win.won ? "win--won" : ""}`}>
      {win.won && <div className="confetti" aria-hidden="true">{CONFETTI.map((c, i) => <i key={i} className={`confetti__bit confetti__bit--${c.hue}`} style={{ left: `${c.left}%`, animationDelay: `${c.delay}s` }} />)}</div>}
      <div className="card gameover__card win__card">
        <div className="gameover__icon" aria-hidden="true">{icon}</div>
        <div className="win__kicker">{win.won ? "You won!" : "The end"} <span className="muted">{dateLabel(win.day)}</span></div>
        <h1 className="win__title">{win.title}</h1>
        {win.text.map((t, i) => <p key={i} className="gameover__reason">{t}</p>)}
        <div className="win__figure"><b>{figure.big}</b> <span>{figure.label}</span></div>
        <ol className="journey" aria-label="Your journey">
          {steps.map((st, i) => (
            <li key={i} className="journey__step">
              <span className="journey__icon" aria-hidden="true">{st.icon}</span>
              <span className="journey__day">Day {st.day + 1}</span>
              <span className="journey__text"><TermText text={st.text} /></span>
            </li>
          ))}
        </ol>
        <div className="gameover__stats win__stats">
          {e ? (
            <>
              <div className="kpi"><div className="kpi__k">Shops open</div><div className="kpi__v">{e.sites.filter((x) => x.status === "open").length}</div></div>
              <div className="kpi"><div className="kpi__k">Regions won</div><div className="kpi__v">{e.win.regionsWon.length} / {e.regions.length}</div></div>
              <div className="kpi"><div className="kpi__k">HQ money</div><div className="kpi__v"><MoneyText pence={e.hq.cash} tone whole /></div></div>
            </>
          ) : s ? (
            <>
              <div className="kpi"><div className="kpi__k">Three-star years</div><div className="kpi__v">{s.guides.michelin.threeStarStreak}</div></div>
              <div className="kpi"><div className="kpi__k">Guide days</div><div className="kpi__v">{s.guides.michelin.history.length}</div></div>
            </>
          ) : null}
          <div className="kpi"><div className="kpi__k">Days open</div><div className="kpi__v">{game.stats.daysOpen}</div></div>
          <div className="kpi"><div className="kpi__k">Guests fed here</div><div className="kpi__v">{game.stats.totalCovers.toLocaleString("en-GB")}</div></div>
        </div>
        <div className="gameover__buttons">
          {win.kind !== "el_bulli" && win.kind !== "handed_back" && <button className="btn btn--primary btn--tap" onClick={onKeepPlaying} autoFocus>Keep playing</button>}
          <button className="btn btn--tap" onClick={() => { void import("../lib/postcard").then((m) => m.saveWinPicture(game, win, figure, steps)).then((r) => setSaved(r === "saved")); }}><span aria-hidden="true">📸</span> {saved ? "Picture saved" : "Save a picture"}</button>
          <button className="btn btn--ghost btn--tap" onClick={onTitle} autoFocus={win.kind === "el_bulli" || win.kind === "handed_back"}>Title screen</button>
        </div>
      </div>
    </div>
  );
}
