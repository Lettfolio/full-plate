import type { GameState } from "@full-plate/sim-core";
import { avgFranchiseeMood, openSites } from "@full-plate/sim-empire";
import { starsView } from "@full-plate/sim-stars";
import { rungDef } from "@full-plate/sim-career";
import { content } from "../sim";
import { dateLabel } from "../lib/calendar";
import { Bar } from "./Bar";
import { MoneyText } from "./MoneyText";
import { SettingsMenu } from "./Settings";
import { pathBadges, type PathMeta } from "../state/paths";

interface Props {
  game: GameState;
  meta?: PathMeta;
  onMenu?: () => void;
}

export const compactMeals = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}bn` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}m` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

/** Always-visible header: who/when, cash, reputation, loan; round 3 adds path badges and the Empire/Stars/career strip. */
export function StatusBar({ game, meta, onMenu }: Props) {
  const district = content.districts.find((d) => d.id === game.districtId);
  const badges = meta ? pathBadges(meta) : [];
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
          </div>
          <div className="status__when">
            Day {game.day + 1} · {dateLabel(game.day)} · {district?.name ?? game.districtId}
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
              <b>{rungDef(career.track, career.rung).title}</b>
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
            </div>
            <div className="status__stat status__stat--bars">
              <Bar label="Popularity" value={game.reputation.popularity} tone="accent" showValue size="sm" title="Popularity — brings more people through the door" />
              <Bar label="Prestige" value={game.reputation.prestige} tone="plum" showValue size="sm" title="Prestige — the quality of your name; bigger spenders and critics" />
            </div>
            <div className="status__stat">
              <span className="status__k">Loan left</span>
              <MoneyText pence={game.loan.remaining} whole />
              <span className="status__sub">{game.loan.daysRemaining} days · <MoneyText pence={game.loan.dailyPayment} />/day</span>
            </div>
          </>
        )}
        <div className="status__end">
          <span className={`pill pill--${game.difficulty}`}>{game.difficulty}</span>
          {onMenu && <button className="btn btn--ghost btn--sm" onClick={onMenu}>Save &amp; quit</button>}
          <SettingsMenu />
        </div>
      </div>
      {e && (
        <div className="pathstrip pathstrip--empire" aria-label="Empire summary">
          <span className="pathstrip__brand">🍔 {e.brand.name}</span>
          <span><b>{openSites(e).length}</b> site{openSites(e).length === 1 ? "" : "s"}{e.sites.some((x) => x.status === "building") ? ` (+${e.sites.filter((x) => x.status === "building").length} building)` : ""}</span>
          <span><b>{compactMeals(e.mealsServedTotal)}</b> meals served</span>
          <span>HQ <MoneyText pence={e.hq.cash} whole className={e.hq.cash < 0 ? "money--neg" : ""} /></span>
          <span>Franchisee mood <b>{franchised ? Math.round(avgFranchiseeMood(e)) : "—"}</b></span>
          {e.association.active && <span className="pathstrip__warn">⚠ Franchisee association</span>}
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
