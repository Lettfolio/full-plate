/**
 * stepStarsDay — runs once per in-game day, in the evening, on that day's DayResult (or `closedDay(day)` when the
 * restaurant did not open). Pure: returns a new StarsState and the events for the UI.
 *
 * Order per day:
 *  1. head chef sync (fired / left → the next best chef takes over; the kitchen is disrupted)
 *  2. proxies → today's criteria, rolling 60-day window, hidden assessment accumulators, daily-score EMA
 *  3. inspectors (scheduled hidden visits; a closed night postpones the visit or loses it) and rumours
 *  4. local critic; test kitchen; sourcing relationships; satellites; ticketing; stagiaires
 *  5. chef stress, burnout, head-chef reputation and the Smyth arc
 *  6. annual tracks (50 Best, Gault&Millau, Good Food) and guide day (reveal, decide, streak, win)
 *  7. the reputation feed into the ledger (prestige anchor, persistent footfall multiplier)
 */
import type { ContentPack, DayResult, GameState } from "@full-plate/sim-core";
import {
  BURNOUT_CHANCE_PER_POINT,
  BURNOUT_FOOTFALL,
  BURNOUT_FROM,
  BURNOUT_PRESTIGE,
  BURNOUT_STRESS_AFTER,
  CONSISTENCY_WINDOW_DAYS,
  DAILY_SCORE_ALPHA,
  DISRUPTION_DAYS,
  DYNAMIC_PRICING_UPLIFT,
  GUIDE_MONTH,
  HEAD_CHEF_PROMOTE_GAP,
  HINT_DECOY,
  HINT_ON_VISIT,
  OFF_NIGHT_DROP,
  PREPAID_FOOTFALL,
  PREPAID_SUPPLIER_DISCOUNT,
  PRESTIGE_ANCHOR_PULL,
  PRESTIGE_STAR_GAIN,
  PRESTIGE_STAR_LOSS,
  REPUTATION_GAIN_BASE,
  REPUTATION_GAIN_PER_STAR,
  RIVAL_FOOTFALL_PER_STAR,
  RIVAL_GROWTH_PER_YEAR,
  SATELLITES,
  SATELLITE_STAR_UPLIFT,
  SEASON_DAYS,
  SIGNATURE_FOOTFALL_CAP,
  SIGNATURE_FOOTFALL_EACH,
  SMYTH_DAILY_CHANCE,
  SMYTH_DECISION_DAYS,
  SMYTH_MIN_REPUTATION,
  SMYTH_MIN_TENURE,
  SOURCING_DAILY,
  SOURCING_GAIN,
  SOURCING_LOSS,
  SOURCING_SEASONAL_BASE,
  SOURCING_SEASONAL_SCALE,
  STAGIAIRE_DAILY_WAGE,
  STAGIAIRE_RELIEF_MAX,
  STAGIAIRE_SCANDAL_AGEING,
  STAGIAIRE_SCANDAL_CHANCE,
  STAGIAIRE_STRESS_RELIEF,
  STAR_AFTERGLOW_DAYS,
  STAR_FOOTFALL,
  STRESS_BASE,
  STRESS_CLOSED_TARGET,
  STRESS_GUIDE_SPIKE_PER_STAR,
  STRESS_LOST_STAR_SPIKE,
  STRESS_PER_STAR,
  STRESS_PER_STREAK_YEAR,
  STRESS_PER_UNTRAINED_SATELLITE,
  STRESS_PULL,
  STRESS_SEASON,
  STRESS_WARNING,
  SCANDAL_FOOTFALL,
  SCANDAL_POPULARITY,
  SCANDAL_PRESTIGE,
  SCANDAL_STRESS,
  TEST_KITCHEN_DAILY,
  VISIT_CUTOFF_DAYS,
  WIN_YEARS,
  YEAR_DAYS,
} from "./constants";
import { decideGuide, emptyAssessment, inSeason, makeVisit, nextMonthStart, scheduleVisits, starsForScore } from "./inspector";
import { CRITERIA_KEYS, clamp, criteriaTotal, dayCriteria, dayInputs, r2, windowStats } from "./proxies";
import { Rng } from "./rng";
import { pickHeadChef, startingReputation } from "./state";
import { criticVisit, prestigeTarget, stepTracks } from "./tracks";
import type { Criteria, Ending, GuideResult, InspectorVisit, StarCount, StarsEvent, StarsState, StarsStepResult } from "./types";

/** A DayResult for a day the restaurant did not open (refit, relaunch, holiday). Feed it to stepStarsDay. */
export function closedDay(day: number): DayResult {
  return {
    day, covers: 0, walkouts: 0, revenue: 0, tips: 0, foodCost: 0, labourCost: 0, rent: 0, loanPayment: 0,
    waste: { prep: 0, plate: 0, spoil: 0 }, profit: 0, averageSpend: 0, averageRating: 0,
    popularityDelta: 0, prestigeDelta: 0, reviews: [], staffMoodDelta: {},
  };
}

/** True while the restaurant is shut for a refit/relaunch: the game must not START_SERVICE (feed closedDay instead). */
export function isClosed(stars: StarsState, day: number): boolean {
  return (stars.refitUntil ?? -1) > day || !!stars.ending;
}

function addCriteria(a: Criteria, b: Criteria): Criteria {
  const out = { ...a };
  for (const k of CRITERIA_KEYS) out[k] = r2(a[k] + b[k]);
  return out;
}

/** Star bump with afterglow: losing a star fades the old bump over STAR_AFTERGLOW_DAYS instead of dropping it. */
export function starBump(stars: StarsState, day: number): number {
  const now = STAR_FOOTFALL[stars.guides.michelin.stars];
  const ag = stars.afterglow;
  if (!ag || day - ag.day >= STAR_AFTERGLOW_DAYS || ag.mult <= now) return now;
  return now + (ag.mult - now) * (1 - (day - ag.day) / STAR_AFTERGLOW_DAYS);
}

/** Persistent footfall multiplier: star bump × prepaid (fewer no-shows) × signature dishes on the menu × the rival's pull. */
export function persistentMultiplier(stars: StarsState, day: number, state?: GameState): number {
  if (isClosed(stars, day)) return 0; // shut for a refit: nobody comes in (rent and rostered wages still run)
  const sigs = (state?.menu ?? []).filter((m) => m.active && stars.testKitchen.researched.includes(m.dishId)).length;
  const prepaid = stars.ticketing.unlocked && stars.ticketing.prepaid ? 1 + PREPAID_FOOTFALL : 1;
  const sig = 1 + SIGNATURE_FOOTFALL_EACH * Math.min(SIGNATURE_FOOTFALL_CAP, sigs);
  const rival = 1 - RIVAL_FOOTFALL_PER_STAR * (stars.rival?.stars ?? 0);
  return r2(starBump(stars, day) * prepaid * sig * rival);
}

export function stressTarget(stars: StarsState, day: number, open: boolean): number {
  if (!open) return STRESS_CLOSED_TARGET;
  const m = stars.guides.michelin;
  const untrained = stars.satellites.filter((s) => !s.headChefTrained).length;
  const relief = Math.min(STAGIAIRE_RELIEF_MAX, stars.stagiaires.count) * STAGIAIRE_STRESS_RELIEF;
  return clamp(
    STRESS_BASE + STRESS_PER_STAR * m.stars + (inSeason(stars, day) ? STRESS_SEASON : 0) + STRESS_PER_STREAK_YEAR * m.threeStarStreak +
      STRESS_PER_UNTRAINED_SATELLITE * untrained - relief,
    0,
    100,
  );
}

/** Daily chance an unpaid stagiaire programme blows up into a staff-treatment story (ages with the years it has run). */
export function scandalChance(stars: StarsState, day: number): number {
  const st = stars.stagiaires;
  if (st.paid || st.count <= 0) return 0;
  const years = Math.max(0, day - st.sinceDay) / YEAR_DAYS;
  return STAGIAIRE_SCANDAL_CHANCE * st.count * (1 + STAGIAIRE_SCANDAL_AGEING * years);
}

/** The head chef leaves the kitchen (backed → friendly satellite elsewhere, or to a rival). Returns the updated head chef block. */
export function headChefLeaves(s: StarsState, day: number, state: GameState | undefined, backed: boolean, rng: Rng): { stars: StarsState; events: StarsEvent[] } {
  const leaving = s.headChef.staffId;
  const former = leaving ? [...s.headChef.former, leaving] : s.headChef.former;
  const next = state ? pickHeadChef(state.staff, former) : undefined;
  const events: StarsEvent[] = [];
  let rival = s.rival;
  if (!backed) {
    const name = rng.pick(["Core", "Ember", "Saltmarsh", "Hearth", "Lumen", "Fennel & Fire"]);
    rival = { name, ...(leaving ? { formerStaffId: leaving } : {}), openedDay: day, strength: Math.round(s.headChef.reputation), stars: 0 };
  }
  events.push({ type: "HEAD_CHEF_LEFT", day, ...(leaving ? { staffId: leaving } : {}), backed, ...(!backed && rival ? { rival: rival.name } : {}) });
  if (next) events.push({ type: "HEAD_CHEF_CHANGED", day, staffId: next.id });
  const { decisionDeadline: _d, staffId: _id, ...hc } = s.headChef;
  return {
    stars: {
      ...s,
      ...(rival ? { rival } : {}),
      headChef: {
        ...hc,
        ...(next ? { staffId: next.id } : {}),
        reputation: startingReputation(next),
        tenureStart: day,
        wantsOwnPlace: false,
        former,
        disruptedUntil: day + (backed ? Math.round(DISRUPTION_DAYS / 2) : DISRUPTION_DAYS),
      },
    },
    events,
  };
}

/**
 * Advances the Stars layer by one day. `result` is the DayResult sim-core just produced (or closedDay(day));
 * `state` is the GameState right after that service (evening phase) — its `service` tally gives exact per-dish
 * quality. Calling it twice for the same day is a no-op.
 */
export function stepStarsDay(content: ContentPack, stars0: StarsState, result: DayResult, state?: GameState): StarsStepResult {
  const day = result.day;
  if (stars0.ending || day <= stars0.lastDay) return { stars: stars0, events: [] };
  const rng = new Rng(stars0.rngState);
  const events: StarsEvent[] = [];
  const log = (text: string, tone: "good" | "bad" | "info" | "money" = "info") => events.push({ type: "LOG", day, text, tone });
  let s: StarsState = stars0;
  const prestige = state?.reputation.prestige ?? 50;

  // 1. head chef sync
  if (state) {
    const cur = state.staff.find((x) => x.id === s.headChef.staffId);
    const best = pickHeadChef(state.staff, s.headChef.former);
    // A clearly better chef in the brigade takes the pass (a promotion, not a disruption).
    const promote = !!cur && !!best && best.id !== cur.id && best.skill >= cur.skill + HEAD_CHEF_PROMOTE_GAP;
    if (!cur || promote) {
      const next = best;
      if (next) {
        const hadOne = s.headChef.staffId !== undefined;
        s = {
          ...s,
          headChef: {
            ...s.headChef,
            staffId: next.id,
            reputation: startingReputation(next),
            tenureStart: day,
            wantsOwnPlace: false,
            ...(hadOne && !promote ? { disruptedUntil: Math.max(s.headChef.disruptedUntil ?? 0, day + DISRUPTION_DAYS) } : {}),
          },
        };
        events.push({ type: "HEAD_CHEF_CHANGED", day, staffId: next.id });
      }
    }
  }

  // 2. proxies
  const open = result.covers > 0 && !isClosed(s, day);
  const inputs = dayInputs(content, result, state);
  let criteria: Criteria | undefined;
  if (open) {
    const before = windowStats(s.consistencyWindow);
    const window = [...s.consistencyWindow, inputs.quality].slice(-CONSISTENCY_WINDOW_DAYS);
    criteria = dayCriteria(content, s, inputs, window);
    const total = criteriaTotal(criteria);
    const a = s.assessment;
    const q = inputs.quality;
    s = {
      ...s,
      consistencyWindow: window,
      lastCriteria: criteria,
      dailyScoreEma: r2(s.dailyScoreEma + (total - s.dailyScoreEma) * DAILY_SCORE_ALPHA),
      assessment: {
        ...a,
        openDays: a.openDays + 1,
        criteriaSum: addCriteria(a.criteriaSum, criteria),
        qN: a.qN + 1,
        qSum: r2(a.qSum + q),
        qSumSq: r2(a.qSumSq + q * q),
        qOff: a.qOff + (before.n >= 5 && q < before.mean - OFF_NIGHT_DROP ? 1 : 0),
      },
    };
  }

  // 3. inspectors (hidden)
  const m = s.guides.michelin;
  const cutoff = m.nextGuideDay - VISIT_CUTOFF_DAYS;
  const due = m.scheduled.filter((d) => d <= day);
  if (due.length) {
    let scheduled = m.scheduled.filter((d) => d > day);
    const visits: InspectorVisit[] = [...m.inspectorVisits];
    for (const d of due) {
      if (d === day && open && criteria) {
        const v = makeVisit(rng, day, criteria, visits.length);
        visits.push(v);
        if (rng.chance(HINT_ON_VISIT)) s = { ...s, hints: [...s.hints, { day, text: "A solo diner took their time and asked about the farm the lamb came from." }] };
      } else {
        // Closed that night: the inspector rebooks for another night, if there's time before the guide goes to print.
        const retry = day + rng.int(7, 30);
        if (retry < cutoff) scheduled = [...scheduled, retry].sort((a, b) => a - b);
      }
    }
    s = { ...s, guides: { ...s.guides, michelin: { ...s.guides.michelin, inspectorVisits: visits, scheduled } } };
  } else if (open && rng.chance(HINT_DECOY)) {
    s = { ...s, hints: [...s.hints, { day, text: "Someone at table four was taking notes. An inspector? Or just a blogger?" }] };
  }
  const lastHint = s.hints.at(-1);
  if (lastHint && lastHint.day === day && s.hints !== stars0.hints) events.push({ type: "INSPECTOR_HINT", day, text: lastHint.text });
  if (day === s.guides.michelin.nextGuideDay - SEASON_DAYS) events.push({ type: "INSPECTION_SEASON", day, daysToGuide: SEASON_DAYS });

  // 4a. local critic (eats on an open night once due)
  if (open && criteria && day >= s.guides.localCritic.nextVisit) {
    const r = criticVisit(rng, s, day, criteriaTotal(criteria));
    s = r.stars;
    events.push(...r.events);
  }

  // 4b. test kitchen
  let cash = 0;
  if (s.testKitchen.unlocked) {
    cash -= TEST_KITCHEN_DAILY;
    const ip = s.testKitchen.inProgress;
    if (ip) {
      if (ip.daysLeft <= 1) {
        s = { ...s, testKitchen: { unlocked: true, researched: [...s.testKitchen.researched, ip.dishId] } };
        events.push({ type: "RESEARCH_DONE", day, dishId: ip.dishId });
      } else s = { ...s, testKitchen: { ...s.testKitchen, inProgress: { dishId: ip.dishId, daysLeft: ip.daysLeft - 1 } } };
    }
  }

  // 4c. sourcing relationships: built over years of open days, lost in a season of closed ones
  if (s.sourcing.length) {
    cash -= SOURCING_DAILY * s.sourcing.length;
    s = {
      ...s,
      sourcing: s.sourcing.map((r) => {
        const relationship = r2(clamp(r.relationship + (open ? SOURCING_GAIN : -SOURCING_LOSS), 0, 100));
        return { ...r, relationship, seasonalBonus: r2(SOURCING_SEASONAL_BASE + (SOURCING_SEASONAL_SCALE * relationship) / 100) };
      }),
    };
  }

  // 4d. satellites earn (more with the flagship's stars) and their head chefs train
  if (s.satellites.length) {
    const uplift = 1 + SATELLITE_STAR_UPLIFT * s.guides.michelin.stars;
    const sats = s.satellites.map((x) => {
      const earned = Math.round(SATELLITES[x.kind].daily * uplift);
      cash += earned;
      let y = { ...x, earned: x.earned + earned };
      if (y.trainingDaysLeft !== undefined) {
        if (y.trainingDaysLeft <= 1) {
          const { trainingDaysLeft: _t, ...rest } = y;
          y = { ...rest, headChefTrained: true };
          events.push({ type: "SATELLITE_CHEF_TRAINED", satelliteId: x.id });
        } else y = { ...y, trainingDaysLeft: y.trainingDaysLeft - 1 };
      }
      return y;
    });
    s = { ...s, satellites: sats };
  }

  // 4e. ticketing: prepaid cash up front buys a supplier discount; time-based pricing lifts takings a little
  if (open && s.ticketing.unlocked) {
    if (s.ticketing.prepaid) cash += Math.round(result.foodCost * PREPAID_SUPPLIER_DISCOUNT);
    if (s.ticketing.dynamicPricing) cash += Math.round(result.revenue * DYNAMIC_PRICING_UPLIFT);
  }

  // 4f. stagiaires
  let pendingPrestige = 0;
  let pendingPopularity = 0;
  const footfall: { mult: number; days: number }[] = [];
  if (s.stagiaires.count > 0) {
    if (s.stagiaires.paid) cash -= STAGIAIRE_DAILY_WAGE * s.stagiaires.count;
    else if (rng.chance(scandalChance(s, day))) {
      pendingPrestige += SCANDAL_PRESTIGE;
      pendingPopularity += SCANDAL_POPULARITY;
      footfall.push(SCANDAL_FOOTFALL);
      s = {
        ...s,
        stagiaires: { ...s.stagiaires, scandals: s.stagiaires.scandals + 1, count: 0, paid: true, sinceDay: day },
        headChef: { ...s.headChef, stress: clamp(s.headChef.stress + SCANDAL_STRESS, 0, 100) },
      };
      events.push({ type: "STAGIAIRE_SCANDAL", day });
      log("A newspaper exposé on unpaid stagiaires. The programme is suspended.", "bad");
    }
  }

  // 5. stress, burnout, reputation, Smyth arc
  {
    const hc = s.headChef;
    const target = stressTarget(s, day, open);
    let stress = r2(clamp(hc.stress + (target - hc.stress) * STRESS_PULL, 0, 100));
    if (hc.stress < STRESS_WARNING && stress >= STRESS_WARNING) events.push({ type: "STRESS_WARNING", day, stress });
    let reputation = hc.reputation;
    if (open && hc.staffId) reputation = r2(clamp(reputation + REPUTATION_GAIN_BASE + REPUTATION_GAIN_PER_STAR * s.guides.michelin.stars, 0, 100));
    let next = { ...hc, stress, reputation };
    if (open && stress > BURNOUT_FROM && rng.chance((stress - BURNOUT_FROM) * BURNOUT_CHANCE_PER_POINT)) {
      next = { ...next, stress: BURNOUT_STRESS_AFTER, burnouts: hc.burnouts + 1, disruptedUntil: day + DISRUPTION_DAYS };
      pendingPrestige += BURNOUT_PRESTIGE;
      footfall.push(BURNOUT_FOOTFALL);
      events.push({ type: "BURNOUT", day, ...(hc.staffId ? { staffId: hc.staffId } : {}) });
      log("The head chef has burned out. The kitchen limps on without them for weeks.", "bad");
    }
    s = { ...s, headChef: next };
    // Smyth arc: a celebrated head chef wants their own place.
    if (!next.wantsOwnPlace && next.staffId && next.reputation >= SMYTH_MIN_REPUTATION && day - next.tenureStart >= SMYTH_MIN_TENURE && rng.chance(SMYTH_DAILY_CHANCE)) {
      const deadline = day + SMYTH_DECISION_DAYS;
      s = { ...s, headChef: { ...next, wantsOwnPlace: true, decisionDeadline: deadline } };
      events.push({ type: "SMYTH_ARC_STARTED", day, staffId: next.staffId, deadline });
    } else if (next.wantsOwnPlace && next.decisionDeadline !== undefined && day >= next.decisionDeadline) {
      const r = headChefLeaves(s, day, state, false, rng);
      s = r.stars;
      events.push(...r.events);
      log(`Your head chef has left to open ${s.rival?.name ?? "a rival"} — and wants your stars.`, "bad");
    }
  }

  // 6a. annual lists
  {
    const r = stepTracks(rng, s, day, prestige);
    s = r.stars;
    events.push(...r.events);
  }

  // 6b. guide day
  if (day >= s.guides.michelin.nextGuideDay) {
    const mm = s.guides.michelin;
    const before = mm.stars;
    const yearVisits = mm.inspectorVisits.filter((v) => !v.revealed);
    const excluded = (mm.excludedUntil ?? -1) > day;
    const d = decideGuide(before, yearVisits, s.assessment, excluded);
    const after = d.after;
    const revealed = mm.inspectorVisits.map((v) => (v.revealed ? v : { ...v, revealed: true }));
    const streak = after === 3 ? mm.threeStarStreak + 1 : 0;
    const res: GuideResult = { day, before, after, assessed: d.assessed, ...(d.score !== undefined ? { score: d.score } : {}), visits: yearVisits.length, reason: d.reason };
    const nextGuide = nextMonthStart(day + 1, GUIDE_MONTH);
    const scheduled = scheduleVisits(rng, day + 1, nextGuide);
    if (after > before) pendingPrestige += PRESTIGE_STAR_GAIN * (after - before);
    if (after < before) pendingPrestige += PRESTIGE_STAR_LOSS * (before - after);
    const spike = STRESS_GUIDE_SPIKE_PER_STAR * after + (after < before ? STRESS_LOST_STAR_SPIKE : 0);
    let rival = s.rival;
    if (rival) {
      const strength = clamp(rival.strength + RIVAL_GROWTH_PER_YEAR, 0, 100);
      rival = { ...rival, strength, stars: starsForScore(strength - 5) };
    }
    s = {
      ...s,
      ...(rival ? { rival } : {}),
      ...(after < before ? { afterglow: { mult: starBump(s, day), day } } : {}),
      peakStars: Math.max(s.peakStars, after) as StarCount,
      headChef: { ...s.headChef, stress: r2(clamp(s.headChef.stress + spike, 0, 100)) },
      guides: {
        ...s.guides,
        michelin: {
          ...mm,
          stars: after,
          inspectorVisits: revealed,
          scheduled,
          nextGuideDay: nextGuide,
          threeStarStreak: streak,
          history: [...mm.history, res],
        },
      },
      assessment: emptyAssessment(day + 1),
      hints: [],
    };
    events.push({ type: "GUIDE_DAY", result: res, visits: yearVisits.map((v) => ({ ...v, revealed: true })) });
    if (streak >= WIN_YEARS && (state?.cash ?? 0) >= 0) {
      const ending: Ending = { kind: "dynasty", day, win: true, text: `Three stars for ${WIN_YEARS} years running. The kitchen is a legend.` };
      s = { ...s, ending };
      events.push({ type: "ENDING", ending });
    }
  }

  // 7. reputation feed
  pendingPrestige += (prestigeTarget(s) - prestige) * PRESTIGE_ANCHOR_PULL;
  const ledger = {
    ...s.ledger,
    pendingCash: s.ledger.pendingCash + cash,
    pendingPrestige: r2(s.ledger.pendingPrestige + pendingPrestige),
    pendingPopularity: r2(s.ledger.pendingPopularity + pendingPopularity),
    pendingFootfall: [...s.ledger.pendingFootfall, ...footfall],
    persistentMult: persistentMultiplier(s, day + 1, state),
  };
  s = { ...s, ledger, lastDay: day, rngState: rng.getState() };
  return { stars: s, events };
}

