import { useEffect, useRef, useState } from "react";
import type { GameState } from "@full-plate/sim-core";
import { forkMilestone } from "../../state/paths";

interface Props {
  game: GameState;
  onChoose: (choice: "snooze" | "empire" | "stars", brandName?: string) => void;
}

/**
 * The fork (BRIEF "Core loop & the shared first act"): a franchise consultant and a visiting critic both show interest
 * in the same week. "Think about it" brings the card back in a week.
 */
export function ForkCard({ game, onChoose }: Props) {
  const [brand, setBrand] = useState("");
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, []);
  const m = forkMilestone(game);
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="fork-title">
      <div className="modal modal--wide fork">
        <div className="modal__banner">
          <span className="modal__stamp" aria-hidden="true">🍴</span>
          <div>
            <div className="modal__kicker">Year two · a week to remember</div>
            <h2 id="fork-title">Two visitors, one question</h2>
          </div>
        </div>
        <div className="modal__body">
          <p>
            {game.restaurantName} has made a name for itself ({m.popularity >= 60 ? `popularity ${Math.round(m.popularity)}` : `${m.profitDays} profitable days`}).
            This week two people asked to see you.
          </p>
          <div className="fork__cards">
            <div className="fork__side fork__side--empire">
              <div className="fork__icon" aria-hidden="true">🍔🌍</div>
              <h3>The franchise consultant</h3>
              <p className="small">“Your numbers are good. Lock the menu, make it fast, and I can put your name on a hundred high streets. My investors will put up £500k.”</p>
              <ul className="small fork__list">
                <li>Open sites, sell franchises, buy the land under them</li>
                <li>A world map, a formula, and franchisees to keep happy</li>
                <li>Win: a billion meals, or every region knows your name</li>
              </ul>
              <label className="field">
                <span className="field__label">Brand name</span>
                <input className="input" value={brand} maxLength={28} placeholder={`${game.restaurantName} Kitchen`} onChange={(e) => setBrand(e.target.value)} />
              </label>
              <button ref={first} className="btn btn--primary" onClick={() => onChoose("empire", brand.trim() || undefined)}>Be everywhere →</button>
            </div>
            <div className="fork__side fork__side--stars">
              <div className="fork__icon" aria-hidden="true">⭐🍽️</div>
              <h3>The visiting critic</h3>
              <p className="small">“I ate here on Tuesday. Nobody knew who I was. Your kitchen could be one of the great ones — if you are willing to obsess.”</p>
              <ul className="small fork__list">
                <li>Hidden inspectors, guide day, a test kitchen, tasting menus</li>
                <li>Stress, stagiaires, and a head chef with dreams of their own</li>
                <li>Win: three stars for five years — or close at your peak</li>
              </ul>
              <button className="btn btn--primary" onClick={() => onChoose("stars")}>Be the best →</button>
            </div>
          </div>
          <p className="xs muted">You can't really have both. Two billion served, or two Michelin stars.</p>
          <button className="btn btn--ghost" onClick={() => onChoose("snooze")}>Think about it (ask me again next week)</button>
        </div>
      </div>
    </div>
  );
}
