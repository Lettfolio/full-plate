import { useState } from "react";
import type { GameState } from "@full-plate/sim-core";
import {
  CRITERION_LABEL, researchDays, satelliteCost, starsHints, starsView, supplierCatalogue, STARS_CONSTANTS as K,
  type StarsCommand, type StarsEvent, type StarsState,
} from "@full-plate/sim-stars";
import { fill } from "@full-plate/content";
import { content, extras, HOOKS, monthOf, tagsOf } from "../../sim";
import { MoneyText } from "../../components/MoneyText";
import { Bar } from "../../components/Bar";
import { dateLabel, WEEKDAY_NAMES } from "../../lib/calendar";
import type { PathMeta } from "../../state/paths";
import { Term } from "../../components/Term";
import { guideYear, nightStrip } from "../../lib/starsStrip";
import { StarsMap } from "./StarsMap";

interface Props {
  game: GameState;
  meta: PathMeta;
  stars: StarsState;
  send: (cmd: StarsCommand) => void;
  onTastingMenu: (menuId: string | null) => void;
}

const dish = (id: string) => content.dishes.find((d) => d.id === id);

/**
 * Path B screen (STARS-NOTES §1 "Screens the game needs"). Reads `starsView` only, so the inspectors' secrets (visit
 * days, this year's scores, the model) never reach the screen.
 */
export function StarsTab({ game, meta, stars, send, onTastingMenu }: Props) {
  const v = starsView(stars, game.day);
  const names = extras.criticText.guideNames;
  const shownStars = meta.pendingGuide ? meta.pendingGuide.result.before : v.stars;
  const signatureDishes = content.dishes.filter((d) => tagsOf(d.id).includes("signature_candidate") || game.menu.some((m) => m.dishId === d.id && d.qualityCeiling >= 85));
  const month = monthOf(game.day);
  const [stagCount, setStagCount] = useState(v.stagiaires.count);
  const arc = v.headChef.wantsOwnPlace && v.headChef.decisionDeadline !== undefined;
  const chefName = game.staff.find((s) => s.id === v.headChef.staffId)?.name ?? "Your head chef";
  const smyth = extras.criticText.headChef;
  const recent = meta.starsEvents.filter((e): e is Extract<StarsEvent, { type: "LOG" }> => e.type === "LOG").slice(-6);
  const refitOn = (v.refitUntil ?? -1) > game.day;
  // Round 3 review P2: which criterion holds you back, from your own recent nights (never the inspectors' secrets).
  const hints = starsHints(content, stars, game).filter((h) => h.behind);
  const lastGuide = v.guideHistory.at(-1);
  const lastVisits = lastGuide ? v.pastVisits.filter((x) => x.day <= lastGuide.day && x.day > (v.guideHistory.at(-2)?.day ?? -1)) : [];
  const lastWeakest = lastVisits.length
    ? (Object.keys(CRITERION_LABEL) as (keyof typeof CRITERION_LABEL)[])
        .map((k) => ({ k, mean: lastVisits.reduce((a, x) => a + x.scores[k], 0) / lastVisits.length }))
        .sort((a, b) => a.mean - b.mean)[0]
    : undefined;

  // Round 7: the hero — the countdown to guide day on a year strip, and the last 60 nights as a strip of cells.
  const year = guideYear(game.day, v.nextGuideDay, lastGuide?.day, K.SEASON_DAYS);
  const strip = nightStrip(stars.consistencyWindow, stars.consistencyDays, K.OFF_NIGHT_DROP, K.CONSISTENCY_WINDOW_DAYS);
  const out = v.excludedUntil !== undefined && v.excludedUntil > game.day;
  return (
    <div className="starstab">
      {arc && (
        <div className="card smyth" role="alertdialog" aria-labelledby="smyth-h">
          <div className="row"><span className="smyth__icon" aria-hidden="true">🧑‍🍳</span><h3 id="smyth-h" className="spacer">{chefName} wants a place of their own</h3><span className="xs muted">decide by {dateLabel(v.headChef.decisionDeadline!)}</span></div>
          <p className="small">{fill(smyth.wantsOwnPlace[game.day % smyth.wantsOwnPlace.length] ?? "", { chef: chefName, restaurant: game.restaurantName })}</p>
          <div className="row row--wrap">
            <button className="btn btn--primary" onClick={() => send({ type: "BACK_HEAD_CHEF" })}>{fill(smyth.backChoice, { chef: chefName })} · <MoneyText pence={K.BACK_HEAD_CHEF_COST} whole /></button>
            <button className="btn" onClick={() => send({ type: "LET_HEAD_CHEF_GO" })}>{fill(smyth.letGoChoice, { chef: chefName })}</button>
          </div>
        </div>
      )}

      <section className="starshero" aria-label="Guide day">
        <div className={`card starshero__count ${year.inSeason ? "starshero__count--season" : ""}`}>
          <div className="starshero__top">
            <div>
              <div className="starshero__k">{names.michelin}</div>
              <div className="starshero__stars" aria-label={`${shownStars} star${shownStars === 1 ? "" : "s"} now`}>{[0, 1, 2].map((i) => <span key={i} className={i < shownStars ? "on" : ""}>★</span>)}</div>
            </div>
            <div className="starshero__days">
              {out ? <><b className="starshero__num">—</b><span>out of the guide until {dateLabel(v.excludedUntil!)}</span></>
                : <><b className="starshero__num">{v.daysToGuide}</b><span>day{v.daysToGuide === 1 ? "" : "s"} to guide day</span></>}
            </div>
          </div>
          {!out && (
            <div className="yearstrip" aria-hidden="true">
              <div className="yearstrip__season" style={{ left: `${year.seasonPct}%` }}><span>🕵️ inspectors about</span></div>
              <div className="yearstrip__today" style={{ left: `${year.todayPct}%` }}><span>today</span></div>
              <div className="yearstrip__end">✉️</div>
            </div>
          )}
          <p className="starshero__line">
            {out ? "The guide isn't looking at you for now. Use the time to rest the kitchen."
              : year.inSeason ? <><b>Inspection season.</b> An inspector could be eating here tonight, and nobody will know. Make every night a good one.</>
              : <>Inspectors start visiting in about <b>{Math.max(0, v.daysToGuide - K.SEASON_DAYS)} days</b>. Get the kitchen steady before then.</>}
            {v.threeStarStreak ? <> Three-star streak: <b>{v.threeStarStreak}/5</b>.</> : null}
          </p>
        </div>
        <div className="card stack stack--sm starshero__hints" aria-labelledby="guide-looks-h">
          <div className="card__title"><h3 id="guide-looks-h">What's holding you back</h3><span className="xs faint">from your last week</span></div>
          {hints.length === 0 ? (
            <p className="small">Nothing on your own record stands out as weak. Keep every night like this.</p>
          ) : (
            <ol className="starhints">
              {hints.slice(0, 2).map((h) => (
                <li key={h.criterion}><span className="pill pill--puzzle">{h.label}</span><span className="small">{h.text}</span></li>
              ))}
            </ol>
          )}
          {hints.length > 2 && (
            <details className="xs">
              <summary>Also worth a look ({hints.length - 2})</summary>
              <ul className="starhints">{hints.slice(2).map((h) => <li key={h.criterion}><b>{h.label}:</b> {h.text}</li>)}</ul>
            </details>
          )}
          {lastWeakest && <p className="xs muted">Last guide day, the inspectors marked your {CRITERION_LABEL[lastWeakest.k].toLowerCase()} lowest.</p>}
          <p className="xs faint">The inspectors' own marks stay secret until guide day. These come from your kitchen's record.</p>
        </div>
      </section>

      <section className="card nights" aria-labelledby="nights-h">
        <div className="card__title"><h3 id="nights-h">Your last {strip.cells.length || K.CONSISTENCY_WINDOW_DAYS} nights</h3><span className="nights__score">Steadiness <b>{Math.round(v.steadiness)}</b></span></div>
        {strip.cells.length === 0 ? <p className="small muted">Open for a few nights and each one appears here as a square.</p> : (
          <>
            <ol className="nights__strip" aria-label={`${strip.steady} steady, ${strip.wobbly} wobbly, ${strip.off} bad nights`}>
              {strip.cells.map((c, i) => <li key={i} className={`nights__cell nights__cell--${c.tone}`} title={`${c.day !== undefined ? `${dateLabel(c.day)}: ` : ""}${c.tone === "off" ? "a bad night" : c.tone === "wobbly" ? "a wobbly night" : "a steady night"}`} />)}
            </ol>
            <div className="nights__key small">
              <span><i className="nights__cell nights__cell--steady" /> {strip.steady} steady</span>
              <span><i className="nights__cell nights__cell--wobbly" /> {strip.wobbly} wobbly</span>
              <span><i className="nights__cell nights__cell--off" /> {strip.off} bad</span>
              <span className="muted spacer">Oldest on the left, last night on the right. Bad nights pull steadiness down.</span>
            </div>
          </>
        )}
      </section>

      <div className="tracks tracks--others" aria-label="Prestige tracks">
        <div className="card track"><div className="track__k">{names.fiftyBest}</div><div className="track__v">{v.fiftyBest.hallOfFame ? "Hall of fame" : v.fiftyBest.rank ? `#${v.fiftyBest.rank}` : "—"}</div><div className="xs muted">{v.fiftyBest.bestRank ? `best #${v.fiftyBest.bestRank}` : "not listed yet"}</div></div>
        <div className="card track"><div className="track__k">{names.gaultMillau}</div><div className="track__v">{v.gaultMillau ? `${v.gaultMillau.toFixed(1)}/20` : "—"}</div><div className="xs muted">never 20</div></div>
        <div className="card track"><div className="track__k">{names.goodFood}</div><div className="track__v">{v.goodFood ? `${v.goodFood}/10` : "—"}</div><div className="xs muted">{v.goodFood ? "listed" : "not listed"}</div></div>
        <div className="card track"><div className="track__k">Local critic</div><div className="track__v">{v.critic.lastReview ? "★".repeat(v.critic.lastReview.rating) : "—"}</div><div className="xs muted">{v.critic.lastReview ? `${v.critic.lastReview.critic}, ${dateLabel(v.critic.lastReview.day)}` : "hasn't been yet"}</div></div>
      </div>

      <StarsMap v={v} restaurantName={game.restaurantName} districtId={game.districtId} shownStars={shownStars} day={game.day} />

      <div className="starstab__grid">
        <div className="stack">
          <div className="card stack stack--sm">
            <div className="card__title"><h3>The kitchen</h3>{v.inspectionSeason && <span className="pill pill--puzzle">Inspection season</span>}</div>
            <Bar label="Head chef stress" value={v.headChef.stress} tone={v.headChef.stress >= 75 ? "accent" : v.headChef.stress >= 50 ? "amber" : "basil"} showValue />
            <Bar label="Steadiness (last 60 nights)" value={v.steadiness} tone="sky" showValue />
            <Bar label="Head chef's reputation" value={v.headChef.reputation} tone="plum" showValue />
            <p className="xs muted">Inspectors come on nights nobody knows about. Every service counts — the steadiness bar is your own kitchen's record, not theirs.</p>
            {v.weakNights.length > 0 && (
              <p className="xs callout callout--warn" role="note">
                <b>Your {v.weakNights.map((w) => WEEKDAY_NAMES[w.weekday]).join(" and ")} nights cook about {Math.round(Math.max(...v.weakNights.map((w) => w.others - w.mean)))} points worse</b> than the rest of the week, and that is what wrecks steadiness.
                Put a stronger chef on those nights, or close them (“Close tonight” in the morning).
              </p>
            )}
            {v.rumours.length > 0 && <ul className="xs rumours">{v.rumours.slice(-3).map((r, i) => <li key={i}>🕵️ {dateLabel(r.day)}: {r.text}</li>)}</ul>}
            {game.difficulty === "cosy" && v.cosyHint && <p className="xs callout">{v.cosyHint}</p>}
            {v.headChef.stress >= 70 && (
              <div className="row row--wrap">
                <button className="btn btn--sm" onClick={() => send({ type: "RELAUNCH_CONCEPT" })} title="Shut 30 days, −30 stress, fresh personality">Relaunch the concept · <MoneyText pence={K.RELAUNCH_COST} whole /></button>
                <button className="btn btn--sm btn--ghost" onClick={() => send({ type: "HAND_BACK_STARS" })} title="Out of the guide for three years, −40 stress">Hand back the stars</button>
              </div>
            )}
            {v.stars >= 2 && v.stars === v.peakStars && (
              <button className="btn btn--sm btn--ghost" onClick={() => { if (window.confirm("Close at your peak and become a foundation? This ends the game — as a win.")) send({ type: "CLOSE_AT_PEAK" }); }}>Close at the top (the El Bulli ending)…</button>
            )}
          </div>

          <div className="card stack stack--sm">
            <div className="card__title"><h3>Tasting menus</h3><span className="xs faint">{HOOKS.setMenu ? (game.setMenu?.active ? "on tonight" : "off") : "coming soon"}</span></div>
            {extras.tastingMenus.map((t) => {
              const inSeason = t.months.includes(month);
              const on = game.setMenu?.active && t.courses.every((c) => game.setMenu!.dishIds.includes(c.dishId));
              return (
                <div key={t.id} className={`tasting ${on ? "tasting--on" : ""}`}>
                  <div className="row"><b className="spacer">{t.name}</b><MoneyText pence={t.pricePerHead} whole /> <span className="xs muted">a head</span></div>
                  <div className="xs muted">{t.blurb}</div>
                  <div className="xs">{t.courses.map((c) => dish(c.dishId)?.name ?? c.dishId).join(" · ")}</div>
                  <div className="row" style={{ marginTop: 4 }}>
                    <span className={`pill ${inSeason ? "pill--star" : "pill--off"}`}>{inSeason ? "In season" : "Out of season"}</span>
                    <span className="spacer" />
                    {on ? <button className="btn btn--sm btn--ghost" disabled={game.phase !== "planning"} onClick={() => onTastingMenu(null)}>Take it off</button>
                      : <button className="btn btn--sm" disabled={!HOOKS.setMenu || game.phase !== "planning"} title={HOOKS.setMenu ? undefined : "Needs the sim's set-menu support"} onClick={() => onTastingMenu(t.id)}>Serve it</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="stack">
          <div className="card stack stack--sm">
            <div className="card__title"><h3>Test kitchen</h3>{v.testKitchen.unlocked ? <span className="xs faint">{v.testKitchen.researched.length} signature{v.testKitchen.researched.length === 1 ? "" : "s"}</span> : null}</div>
            {!v.testKitchen.unlocked ? (
              <>
                <p className="small muted">A research kitchen turns dishes into signatures: more appeal, a higher ceiling, and the chef's personality on the plate.</p>
                <button className="btn btn--sm" onClick={() => send({ type: "UNLOCK_TEST_KITCHEN" })}>Build the test kitchen · <MoneyText pence={K.TEST_KITCHEN_COST} whole /></button>
              </>
            ) : v.testKitchen.inProgress ? (
              <p className="small">Working on <b>{dish(v.testKitchen.inProgress.dishId)?.name}</b> · {v.testKitchen.inProgress.daysLeft} days to go</p>
            ) : (
              <div className="stack stack--sm">
                {signatureDishes.filter((d) => !v.testKitchen.researched.includes(d.id)).slice(0, 6).map((d) => (
                  <div key={d.id} className="row">
                    <span className="spacer small">{d.name}</span>
                    <span className="xs muted">{researchDays(d.skillRequired)} days</span>
                    <button className="btn btn--sm btn--ghost" onClick={() => send({ type: "RESEARCH_DISH", dishId: d.id })}>Develop · <MoneyText pence={K.RESEARCH_COST} whole /></button>
                  </div>
                ))}
              </div>
            )}
            {v.testKitchen.researched.length > 0 && <p className="xs muted">Signatures: {v.testKitchen.researched.map((id) => dish(id)?.name ?? id).join(", ")}</p>}
          </div>

          <div className="card stack stack--sm">
            <div className="card__title"><h3>Sourcing</h3></div>
            {supplierCatalogue(content).map((s) => {
              const rel = v.sourcing.find((x) => x.supplierId === s.id);
              return (
                <div key={s.id} className="row">
                  <span className="spacer small"><b>{s.name}</b>{rel && <Bar value={rel.relationship} tone="basil" size="sm" title={`Relationship ${Math.round(rel.relationship)}`} />}</span>
                  {rel ? <button className="btn btn--sm btn--ghost" onClick={() => send({ type: "DROP_SOURCING", supplierId: s.id })}>Drop</button>
                    : <button className="btn btn--sm btn--ghost" onClick={() => send({ type: "SIGN_SOURCING", supplierId: s.id })}>Sign · <MoneyText pence={K.SOURCING_DAILY} />/day</button>}
                </div>
              );
            })}
          </div>

          <div className="card stack stack--sm">
            <div className="card__title"><h3>Bookings</h3></div>
            {!v.ticketing.unlocked ? (
              <button className="btn btn--sm" onClick={() => send({ type: "UNLOCK_TICKETING" })}>Set up prepaid tickets · <MoneyText pence={K.TICKETING_COST} whole /></button>
            ) : (
              <div className="row row--wrap">
                <label className="check"><input type="checkbox" checked={v.ticketing.prepaid} onChange={(e) => send({ type: "SET_TICKETING", prepaid: e.target.checked, dynamicPricing: v.ticketing.dynamicPricing })} /> Prepaid seats (no-shows fall)</label>
                <label className="check"><input type="checkbox" checked={v.ticketing.dynamicPricing} onChange={(e) => send({ type: "SET_TICKETING", prepaid: v.ticketing.prepaid, dynamicPricing: e.target.checked })} /> Saturday premium, Tuesday discount</label>
              </div>
            )}
          </div>

          <div className="card stack stack--sm">
            <div className="card__title"><h3><Term id="stagiaires" /></h3><span className="xs faint">{v.stagiaires.scandals ? `${v.stagiaires.scandals} scandal` : ""}</span></div>
            <p className="xs muted">Young cooks on a stage. Skilled help and a steadier kitchen — but unpaid stages are a risk that grows every year.</p>
            <div className="row">
              <button className="btn btn--sm" onClick={() => setStagCount(Math.max(0, stagCount - 1))}>−</button>
              <b>{stagCount}</b>
              <button className="btn btn--sm" onClick={() => setStagCount(Math.min(6, stagCount + 1))}>+</button>
              <button className="btn btn--sm btn--ghost" onClick={() => send({ type: "SET_STAGIAIRE_POLICY", paid: true, count: stagCount })}>Pay them · <MoneyText pence={K.STAGIAIRE_DAILY_WAGE * stagCount} />/day</button>
              <button className="btn btn--sm btn--ghost" onClick={() => send({ type: "SET_STAGIAIRE_POLICY", paid: false, count: stagCount })}>Unpaid</button>
            </div>
            <div className="xs">Now: {v.stagiaires.count} {v.stagiaires.paid ? "paid" : "unpaid"}</div>
          </div>

          <div className="card stack stack--sm">
            <div className="card__title"><h3>The group</h3><span className="xs faint">sister restaurants never earn stars</span></div>
            {v.satellites.map((s) => (
              <div key={s.id} className="row">
                <span className="spacer small"><b>{s.name}</b> <span className="xs muted">{s.kind} · earned <MoneyText pence={s.earned} whole /></span>{!s.headChefTrained && <span className="xs" title="Untrained head chef: costs the flagship consistency"> ⚠</span>}</span>
                {!s.headChefTrained && s.trainingDaysLeft === undefined && s.kind !== "backed" && <button className="btn btn--sm btn--ghost" onClick={() => send({ type: "TRAIN_SATELLITE_CHEF", satelliteId: s.id })}>Train a head chef</button>}
                {s.trainingDaysLeft !== undefined && <span className="xs muted">training · {s.trainingDaysLeft}d</span>}
              </div>
            ))}
            <div className="row row--wrap">
              {(["bar", "bistro", "ticketed"] as const).map((k) => (
                <button key={k} className="btn btn--sm btn--ghost" onClick={() => send({ type: "OPEN_SATELLITE", kind: k })}>Open a {k === "ticketed" ? "ticketed room" : k} · <MoneyText pence={satelliteCost(stars, k)} whole /></button>
              ))}
            </div>
            {v.rival && <p className="xs callout callout--warn">Rival: <b>{v.rival.name}</b> {"★".repeat(v.rival.stars)} — opened {dateLabel(v.rival.openedDay)}</p>}
          </div>

          <div className="card stack stack--sm">
            <div className="card__title"><h3>Refit</h3></div>
            {refitOn ? <p className="small">Closed for the refit until {dateLabel(v.refitUntil!)}.</p> : (
              <>
                <p className="xs muted">Closing for months means no assessment this year — and the stars lapse (the Fat Duck rule).</p>
                <button className="btn btn--sm btn--ghost" onClick={() => send({ type: "CLOSE_FOR_REFIT", days: 60 })}>Close for a 60-day refit</button>
                {!HOOKS.closeToday && <p className="xs faint">While closed, rostered staff are still paid until the sim supports closed days.</p>}
              </>
            )}
          </div>

          {recent.length > 0 && (
            <div className="card">
              <div className="card__title"><h3>Last night</h3></div>
              <ul className="empire__log">{recent.map((e, i) => <li key={i} className={`careerlog__line careerlog__line--${e.tone}`}>{e.text}</li>)}</ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
