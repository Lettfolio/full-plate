import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { styleBadge } from "../lib/decor";
import type { GameState } from "@full-plate/sim-core";
import { avgFranchiseeMood, openSites } from "@full-plate/sim-empire";
import { starsView } from "@full-plate/sim-stars";
import { rungDef } from "@full-plate/sim-career";
import { content } from "../sim";
import { dateLabel } from "../lib/calendar";
import { Bar } from "./Bar";
import { MoneyText } from "./MoneyText";
import { SettingsMenu, type SavedWhere } from "./Settings";
import { RungName, Term } from "./Term";
import { pathBadges, type PathMeta } from "../state/paths";
import { Icon } from "./Icon";
import { BankChip } from "./Bank";
import { usePhone } from "../lib/layout";
import { useSettings } from "../lib/settings";
import { modalOpen } from "../lib/modal";
import { openWords } from "./WordsSheet";
import { bankStatus } from "../sim";

interface Props {
  game: GameState;
  meta?: PathMeta;
  /** Save and go to the title (absent during service). */
  onQuit?: (() => void) | undefined;
  /** Start a new game after a confirmation (absent during service). */
  onNewGame?: (() => void) | undefined;
  /** Round 9: Save & quit saves first; the header shows where the save is (SaveIndicator). */
  onSave?: (() => Promise<SavedWhere>) | undefined;
  onSaveFile?: (() => Promise<string>) | undefined;
  saveMark?: ReactNode;
  /** Round 14 (D): save and open today's challenge (the Settings sheet's game menu). */
  onChallenge?: (() => void) | undefined;
}

/** Round 7: yesterday's profit as a small arrow under the cash (the trend a child can read at a glance). */
function CashTrend({ game }: { game: GameState }) {
  const last = game.history.at(-1);
  if (!last) return <span className="status__sub">Day one: no sales yet</span>;
  const up = last.profit >= 0;
  const label = game.phase === "planning" ? "yesterday" : "today";
  return (
    <span className={`status__trend status__trend--${up ? "up" : "down"}`}>
      <Icon name={up ? "trendUp" : "trendDown"} size={16} /> {up ? "made" : "lost"} <MoneyText pence={Math.abs(last.profit)} whole /> {label}
    </span>
  );
}

export const compactMeals = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}bn` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

/** Always-visible header: who/when, cash, reputation, loan; round 3 adds path badges and the Empire/Stars/career strip. */
export function StatusBar({ game, meta, onQuit, onNewGame, onSave, onSaveFile, saveMark, onChallenge }: Props) {
  const district = content.districts.find((d) => d.id === game.districtId);
  const badges = meta ? pathBadges(meta) : [];
  const style = styleBadge(game); // round 10: "Cosy café", "Smart bistro"…
  const career = meta?.mode === "career" && meta.career && !meta.career.handover ? meta.career : undefined;
  const e = meta?.empire;
  const s = meta?.stars;
  const sv = s ? starsView(s, game.day) : undefined;
  // While the guide-day envelope is unopened the badge keeps last year's stars.
  const shownStars = meta?.pendingGuide ? meta.pendingGuide.result.before : sv?.stars ?? 0;
  const franchised = e?.sites.some((x) => x.ownership !== "company" && x.status === "open");
  const phone = usePhone();
  const more = useMoreSheet(phone);
  const bankWarn = !career && (() => { const b = bankStatus(content, game); return b.below && b.daysLeft !== null && game.phase !== "gameover"; })();

  const who = (
    <div className="status__who">
      <div className="status__name">
        <span className="status__logo" aria-hidden="true" /><span className="brandname">{game.restaurantName}</span>
        {badges.map((b) => <span key={b.id} className={`pathbadge pathbadge--${b.tone}`}>{b.label}</span>)}
        {style && <span className={`pathbadge pathbadge--style pathbadge--style-${style.tag}`} title="Your restaurant's style">{style.name}</span>}
      </div>
      <div className="status__when">
        <span className="status__day">Day {game.day + 1}</span> {dateLabel(game.day)} · <span className="status__district">{district?.name ?? game.districtId}</span>
      </div>
    </div>
  );
  const money = career ? (
    <div className="status__stat">
      <span className="status__k">Your savings</span>
      <MoneyText pence={career.savings} whole className={`status__cash ${career.savings < 0 ? "money--neg" : ""}`} />
    </div>
  ) : (
    <div className="status__stat">
      <span className="status__k">Cash</span>
      <MoneyText pence={game.cash} whole className={`status__cash ${game.cash < 0 ? "money--neg" : ""}`} />
      {!phone && <><CashTrend game={game} /><BankChip game={game} /></>}
    </div>
  );
  const rest = career ? (
    <>
      <div className="status__stat">
        <span className="status__k">You are</span>
        <b><RungName title={rungDef(career.track, career.rung).title} /></b>
        <span className="status__sub">at {career.employer.restaurantName}</span>
      </div>
      <div className="status__stat status__stat--bars">
        <Bar label="Reputation" value={career.reputation} tone="plum" showValue size="sm" title="Your name in the trade: brings job offers" />
        <Bar label="Mood" value={career.mood} tone="auto" showValue size="sm" />
      </div>
    </>
  ) : (
    <>
      {phone && <div className="status__stat status__stat--trend"><CashTrend game={game} /><BankChip game={game} /></div>}
      <div className="status__stat status__stat--bars">
        <Bar label="Popularity" value={game.reputation.popularity} tone="accent" showValue size="sm" title="Popularity — brings more people through the door" />
        <Bar label="Prestige" value={game.reputation.prestige} tone="plum" showValue size="sm" title="Prestige — the quality of your name; bigger spenders and critics" />
      </div>
      <div className="status__stat">
        <span className="status__k">Loan left</span>
        <MoneyText pence={game.loan.remaining} whole />
        <span className="status__sub"><MoneyText pence={game.loan.dailyPayment} />/day · {game.loan.daysRemaining} days</span>
      </div>
    </>
  );
  const pill = <span className={`pill pill--${game.difficulty}`}><Icon name={game.difficulty === "cosy" ? "heart" : game.difficulty === "hard" ? "chilli" : "speed"} size={16} />{game.difficulty[0]!.toUpperCase() + game.difficulty.slice(1)}</span>;
  const gear = <SettingsMenu difficulty={game.difficulty} onQuit={onQuit} onNewGame={onNewGame} onSave={onSave} onSaveFile={onSaveFile} onChallenge={onChallenge} saveName={`${game.restaurantName} · Day ${game.day + 1}`} />;
  return (
    <header className={`status-wrap ${phone ? "status-wrap--phone" : ""}`} ref={more.wrap}>
      {phone ? (
        // Round 13 (B): on a phone the header keeps the name, the day and the cash; everything else is one tap away
        // in the "⋯" sheet (a disclosure under the header, not a modal: Settings and the save mark open their own sheets
        // from inside it, so it stays mounted while they are open).
        <div className="status status--phone">
          {who}
          {money}
          <button ref={more.button} type="button" className={`btn btn--ghost btn--tap shellbtn status__morebtn ${bankWarn ? "status__morebtn--warn" : ""}`} aria-expanded={more.open} aria-controls={more.id} aria-label={`More: ${career ? "your rung, reputation and mood" : "loan, popularity and prestige"}, sound, words and the game menu${bankWarn ? " (the bank is waiting)" : ""}`} onClick={() => more.setOpen(!more.open)}>
            <span aria-hidden="true" className="status__moredots">⋯</span>
          </button>
          <div id={more.id} className="status__more" hidden={!more.open} role="region" aria-label="More">
            <div className="status__morestats">{rest}</div>
            <div className="status__moreacts">
              {saveMark}
              {pill}
              <SoundSwitch />
              <button type="button" className="btn btn--ghost btn--tap shellbtn status__words" onClick={() => { more.setOpen(false); openWords(); }}>
                <span aria-hidden="true" className="shellbtn__icon">?</span><span>Words</span>
              </button>
              {gear}
            </div>
          </div>
        </div>
      ) : (
      <div className="status">
        {who}
        {money}
        {rest}
        <div className="status__end">
          {saveMark}
          {pill}
          {gear}
        </div>
      </div>
      )}
      {e && (
        <div className="pathstrip pathstrip--empire" aria-label="Empire summary">
          <span className="pathstrip__brand"><Icon name="empire" size={18} />{e.brand.name}</span>
          <span><b>{openSites(e).length}</b> site{openSites(e).length === 1 ? "" : "s"}{e.sites.some((x) => x.status === "building") ? ` (+${e.sites.filter((x) => x.status === "building").length} building)` : ""}</span>
          <span><b>{compactMeals(e.mealsServedTotal)}</b> meals served</span>
          <span><Term id="hqCash" inline>HQ</Term> <MoneyText pence={e.hq.cash} whole className={e.hq.cash < 0 ? "money--neg" : ""} /></span>
          <span><Term id="franchiseeMood" inline>Franchisee mood</Term> <b>{franchised ? Math.round(avgFranchiseeMood(e)) : "—"}</b></span>
          {e.association.active && <span className="pathstrip__warn"><Icon name="warning" size={18} /><Term id="association" inline>Franchisee association</Term></span>}
        </div>
      )}
      {sv && (
        <div className="pathstrip pathstrip--stars" aria-label="Stars summary">
          <span className="pathstrip__brand" aria-label={`${shownStars} star${shownStars === 1 ? "" : "s"}`}>The Stars · {"★".repeat(shownStars)}{"☆".repeat(3 - shownStars)}</span>
          <span>Guide day in <b>{sv.daysToGuide}</b> days{sv.inspectionSeason ? " · inspection season" : ""}</span>
          <span>Chef stress <b>{Math.round(sv.headChef.stress)}</b></span>
          <span>Steadiness <b>{Math.round(sv.steadiness)}</b></span>
          {sv.threeStarStreak > 0 && <span>Three-star streak <b>{sv.threeStarStreak}/5</b></span>}
        </div>
      )}
    </header>
  );
}

/** Round 13 (B): the phone header's "⋯" sheet: Escape or a tap outside closes it (not while a sheet opened from it is up). */
function useMoreSheet(phone: boolean) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!phone) setOpen(false); }, [phone]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !modalOpen()) { setOpen(false); button.current?.focus(); } };
    const onDown = (e: PointerEvent) => { if (!modalOpen() && !wrap.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown); };
  }, [open]);
  return { open, setOpen, id, wrap, button };
}

/** Sound on/off without opening Settings (the volumes stay in Settings). */
function SoundSwitch() {
  const [s, set] = useSettings();
  return (
    <button type="button" role="switch" aria-checked={s.sound} className="btn btn--ghost btn--tap shellbtn status__sound" onClick={() => set({ sound: !s.sound })}>
      <Icon name={s.sound ? "sound" : "soundOff"} size={20} className="shellbtn__icon" /><span>Sound {s.sound ? "on" : "off"}</span>
    </button>
  );
}
