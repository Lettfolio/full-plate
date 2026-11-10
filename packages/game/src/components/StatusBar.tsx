import type { ReactNode } from "react";
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
export function StatusBar({ game, meta, onQuit, onNewGame, onSave, onSaveFile, saveMark }: Props) {
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
  return (
    <header className="status-wrap">
      <div className="status">
        <div className="status__who">
          <div className="status__name">
            {game.restaurantName}
            {badges.map((b) => <span key={b.id} className={`pathbadge pathbadge--${b.tone}`}>{b.label}</span>)}
            {style && <span className={`pathbadge pathbadge--style pathbadge--style-${style.tag}`} title="Your restaurant's style">{style.name}</span>}
          </div>
          <div className="status__when">
            <span className="status__day">Day {game.day + 1}</span> {dateLabel(game.day)} · <span className="status__district">{district?.name ?? game.districtId}</span>
          </div>
        </div>
        {career ? (
          <>
            <div className="status__stat">
              <span className="status__k">Your savings</span>
              <MoneyText pence={career.savings} whole className={`status__cash ${career.savings < 0 ? "money--neg" : ""}`} />
            </div>
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
            <div className="status__stat">
              <span className="status__k">Cash</span>
              <MoneyText pence={game.cash} whole className={`status__cash ${game.cash < 0 ? "money--neg" : ""}`} />
              <CashTrend game={game} />
              <BankChip game={game} />
            </div>
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
        )}
        <div className="status__end">
          {saveMark}
          <span className={`pill pill--${game.difficulty}`}><Icon name={game.difficulty === "cosy" ? "heart" : game.difficulty === "hard" ? "chilli" : "speed"} size={16} />{game.difficulty[0]!.toUpperCase() + game.difficulty.slice(1)}</span>
          <SettingsMenu difficulty={game.difficulty} onQuit={onQuit} onNewGame={onNewGame} onSave={onSave} onSaveFile={onSaveFile} saveName={`${game.restaurantName} · Day ${game.day + 1}`} />
        </div>
      </div>
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
