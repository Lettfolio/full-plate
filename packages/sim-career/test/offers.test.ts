import { describe, expect, it } from "vitest";
import { applyCareerCommand, makeOffer, offerIsBetter, rollOffers, trackStat, type CareerGame } from "../src/index";
import { content, played } from "./helpers";

function withOffer(g: CareerGame): CareerGame {
  const offer = makeOffer(content, g.career);
  return { ...g, career: { ...g.career, offers: [offer] } };
}

describe("offers", () => {
  it("makeOffer is deterministic and comes from a different district and owner", () => {
    const g = played("waiter", 40);
    const a = makeOffer(content, g.career);
    expect(makeOffer(content, g.career)).toEqual(a);
    expect(a.districtId).not.toBe(g.career.employer.districtId);
    expect(a.ownerName).not.toBe(g.career.owner.name);
    expect(a.wage).toBeGreaterThanOrEqual(g.career.wage);
    expect(a.expiresDay).toBeGreaterThan(a.madeDay);
  });

  it("offers arrive over a year and expire", () => {
    const stay = { weekendShifts: 1, acceptOffers: false, askRaises: false, mentorSessions: false, askPromotion: true };
    const g = played("waiter", 365, 2, "balanced", stay);
    const received = g.career.log.filter((l) => /offers you/.test(l.text)).length;
    expect(received).toBeGreaterThan(0);
    expect(g.career.offers.every((o) => o.expiresDay > g.career.day)).toBe(true);
  });

  it("out of work, an offer is guaranteed within a few days", () => {
    const g = played("chef", 10);
    let c = { ...g.career, employer: { ...g.career.employer, status: "fired" as const }, offers: [] };
    c = { ...c, jobs: c.jobs.map((j) => ({ ...j, toDay: c.day })) };
    let got = false;
    for (let i = 0; i < 5 && !got; i++) {
      const r = rollOffers(content, c, i);
      got = !!r.made;
      c = { ...c, day: c.day + 1 };
    }
    expect(got).toBe(true);
  });

  it("accepting builds a new GameState with the new owner and district and carries skills over", () => {
    const g = withOffer(played("chef", 60));
    const offer = g.career.offers[0]!;
    const r = applyCareerCommand(content, g, { type: "ACCEPT_OFFER", offerId: offer.id });
    const c = r.game.career;
    expect(r.rejected).toBeUndefined();
    expect(c.owner.strategy).toBe(offer.strategy);
    expect(c.employer.districtId).toBe(offer.districtId);
    expect(r.game.state.restaurantName).toBe(offer.restaurantName);
    expect(r.game.state.districtId).toBe(offer.districtId);
    expect(r.game.state).not.toBe(g.state);
    expect(trackStat("chef", c.stats)).toBe(trackStat("chef", g.career.stats));
    expect(c.wage).toBe(offer.wage);
    expect(c.jobs).toHaveLength(2);
    expect(c.jobs[0]!.leftBecause).toBe("offer");
    // Old colleagues are kept as former; new ones appear.
    expect(c.relationships.filter((x) => !x.current).length).toBe(g.career.relationships.length);
    expect(c.relationships.some((x) => x.current && x.employer === offer.restaurantName)).toBe(true);
    expect(r.game.state.staff.find((s) => s.id === "player")!.skill).toBeCloseTo(g.career.stats.skill, 1);
    expect(r.game.state.phase).toBe("planning");
  });

  it("an unknown offer is refused; declining removes it", () => {
    const g = withOffer(played("bar", 20));
    expect(applyCareerCommand(content, g, { type: "ACCEPT_OFFER", offerId: "nope" }).rejected).toBeTruthy();
    const d = applyCareerCommand(content, g, { type: "DECLINE_OFFER", offerId: g.career.offers[0]!.id });
    expect(d.game.career.offers).toHaveLength(0);
  });

  it("offerIsBetter prefers a rung up and real pay rises", () => {
    const g = played("waiter", 20);
    const o = makeOffer(content, g.career);
    expect(offerIsBetter(g.career, { ...o, rung: g.career.rung + 1 })).toBe(true);
    expect(offerIsBetter(g.career, { ...o, rung: g.career.rung, wage: g.career.wage })).toBe(false);
  });
});
