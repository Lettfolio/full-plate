import { Suspense, useState } from "react";
import { lazyRetry } from "../lib/lazyRetry";
import type { GameState } from "@full-plate/sim-core";
import { MoneyText } from "../components/MoneyText";
// Round 12 (B): the shopfront picture is its own chunk (it is also the brand kit's preview); the main chunk was full.
const Shopfront = lazyRetry(() => import("../components/Shopfront").then((m) => ({ default: m.Shopfront })));
// Round 11 (D): "How do I win?" (pictures and all) loads when opened (main-chunk budget).
const GoalExplainer = lazyRetry(() => import("../components/GoalExplainer").then((m) => ({ default: m.GoalExplainer })));
import { ConfirmDialog } from "../components/Dialog";
import { dateLabel } from "../lib/calendar";
import type { SlotView } from "../state/saveStore";
import { Icon } from "../components/Icon";
import { todayLine } from "../lib/challengeToday";

interface Props {
  /** A single save (rounds 1–8's shape, kept for its tests). Round 9: the app passes `slots` instead. */
  saved: GameState | null;
  onNew: () => void;
  onContinue: () => void;
  /** Round 9: save slots, newest first. Continue plays the first; "Your games" opens the picker; New game asks the app. */
  slots?: SlotView[];
  onYourGames?: () => void;
  /** Round 9: one line on where games are kept ("Saved to your account" / "on this device only"). */
  saveNote?: { icon: "cloud" | "cloudOff" | "warning"; text: string };
  /** Round 9: a problem to tell the player (a save that couldn't be opened). */
  note?: string | null;
  /** Round 9: Continue is opening the save. */
  busy?: boolean;
  /** Round 12 (C): "Today's challenge". */
  onChallenge?: () => void;
  /** Round 12 (G): "Visit a friend" — a friend's code opens their restaurant or their co-op day. */
  onVisit?: () => void;
}

export const PATH_LABEL = { owner: "Owner", career: "Career", empire: "Empire", stars: "Stars" } as const;

interface Card { name: string; sub?: string | undefined; day: number; cash: number }

/** Round 7: the save sits inside its Continue button, so the biggest thing on the screen is "carry on where I was". */
function ContinueButton({ label, card, primary, onClick, autoFocus, busy }: { label: string; card: Card; primary: boolean; onClick: () => void; autoFocus?: boolean; busy?: boolean }) {
  const id = `save-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <button className={`continue ${primary ? "continue--primary" : ""}`} onClick={onClick} autoFocus={autoFocus} aria-label={label} aria-describedby={id} aria-busy={busy || undefined} disabled={busy}>
      <span className="continue__go">{busy ? "Opening…" : label} <Icon name="forward" size={24} /></span>
      <span className="continue__save title__save" id={id}>
        <b className="continue__name">{card.name}</b>
        {card.sub && <span className="continue__sub">{card.sub}</span>}
        <span className="title__savemeta">Day {card.day + 1} · <MoneyText pence={card.cash} whole /></span>
        <span className="continue__date">{dateLabel(card.day)}</span>
      </span>
    </button>
  );
}

/** Round 14 (D): today's challenge with its name, and her best today when she has one (no sim, no lazy chunk). */
function ChallengeButton({ onClick }: { onClick: () => void }) {
  const line = todayLine();
  return (
    <button className="btn btn--tap title__challenge" onClick={onClick} aria-label="Today's challenge" aria-describedby="title-challenge-line">
      <Icon name="target" size={20} />
      <span className="title__challenge-text" style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2, textAlign: "left" }}>
        <span>Today's challenge</span>
        <span id="title-challenge-line" className="title__challenge-line" style={{ fontSize: "var(--fs-xs)", fontWeight: 600, color: "var(--ink-soft)" }}>{line.title}{line.best !== undefined ? ` · your best ${line.best.toLocaleString("en-GB")}` : ""}</span>
      </span>
    </button>
  );
}

function slotCard(s: SlotView): Card {
  const path = PATH_LABEL[s.path];
  const sub = s.name !== s.restaurantName ? `${s.restaurantName} · ${path}` : s.path === "owner" ? undefined : `${path} path`;
  return { name: s.name, sub, day: s.day, cash: s.cash };
}

export function TitleScreen({ saved, onNew, onContinue, slots, onYourGames, saveNote, note, busy, onChallenge, onVisit }: Props) {
  const [goals, setGoals] = useState(false);
  const [confirmNew, setConfirmNew] = useState(false);
  // Round 9: the career save is one of the slots now (no separate "Continue career").
  // Round 11: a lost (archived) game is in Your games, not behind Continue.
  const latest = slots?.find((s) => !s.archived);
  const card: Card | null = latest ? slotCard(latest) : !slots && saved ? { name: saved.restaurantName, day: saved.day, cash: saved.cash } : null;
  const hasSave = !!card;
  return (
    <div className="title">
      <div className="title__inner">
        <div className="title__art">
          <Suspense fallback={<svg className="title__shop" viewBox="0 0 480 420" aria-hidden="true" />}><Shopfront className="title__shop" /></Suspense>
        </div>
        <div className="title__side">
          <h1 className="title__logo">Full <span>Plate</span></h1>
          <p className="title__tag">Open a scruffy little restaurant. Feed the town. See how far it goes.</p>
          {note && <p className="callout callout--warn title__note" role="alert">{note}</p>}
          <div className="title__buttons">
            {card && <ContinueButton label="Continue" card={card} primary onClick={onContinue} autoFocus busy={!!busy} />}
            {slots && slots.length > 0 && onYourGames && (
              <button className="btn btn--tap title__games" onClick={onYourGames}>
                <Icon name="folder" size={20} />Your games <span className="title__count">{slots.length}</span>
              </button>
            )}
            <button className={hasSave ? "btn btn--tap" : "btn btn--primary btn--xl"} onClick={() => (hasSave && !slots ? setConfirmNew(true) : onNew())} autoFocus={!hasSave}>
              New game
            </button>
            {slots && slots.length === 0 && onYourGames && (
              <button className="btn btn--ghost btn--tap" onClick={onYourGames}><Icon name="folder" size={20} />Load a save file</button>
            )}
            {onChallenge && <ChallengeButton onClick={onChallenge} />}
            {onVisit && <button className="btn btn--ghost btn--tap" onClick={onVisit}><Icon name="people" size={20} />Visit a friend</button>}
            <button className="btn btn--ghost btn--tap title__goal" onClick={() => setGoals(true)}>
              <Icon name="trophy" size={20} />How do I win?
            </button>
          </div>
          {saveNote && <p className="title__savenote"><Icon name={saveNote.icon} size={20} />{saveNote.text}</p>}
          <p className="title__foot">Owner, chef, bar, waiter or manager: every road leads to a place of your own.</p>
        </div>
      </div>
      {goals && <Suspense fallback={null}><GoalExplainer onClose={() => setGoals(false)} /></Suspense>}
      {confirmNew && (
        <ConfirmDialog
          title="Start a new game?"
          body={<p>Your saved game stays safe until the new one begins. Then the new game takes its place.</p>}
          confirmLabel="Yes, start a new game"
          cancelLabel="Go back"
          onCancel={() => setConfirmNew(false)}
          onConfirm={() => { setConfirmNew(false); onNew(); }}
        />
      )}
    </div>
  );
}
