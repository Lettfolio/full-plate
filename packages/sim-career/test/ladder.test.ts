import { describe, expect, it } from "vitest";
import {
  applyCareerCommand, LADDER, NLW, OWNERS, promotionChecklist, rungWage, trackStat,
  type CareerGame, type CareerState, type CareerTrack,
} from "../src/index";
import { poachChance } from "../src/career";
import { content, fakeReview, fakeStaff, played } from "./helpers";

const TRACKS: CareerTrack[] = ["chef", "bar", "waiter", "manager"];

/** A career that meets every criterion for the next rung (no rival). */
function ready(game: CareerGame): CareerGame {
  const c = game.career;
  const crit = LADDER[c.track][c.rung + 1]!.criteria!;
  const stats = { ...c.stats, skill: crit.stat + 5, charm: crit.stat + 5 };
  const career: CareerState = {
    ...c, stats, shiftsAtRung: crit.shiftsAtRung, reputation: (crit.reputation ?? 0) + 5,
    weeklyReview: [4, 4, 4, 4].map((s) => fakeReview(s)), owner: { ...c.owner, mood: crit.ownerMood + 5 },
    relationships: c.relationships.map(({ tag: _t, ...r }) => r),
  };
  const { rival: _r, ...noRival } = career;
  return { ...game, career: noRival };
}

describe("ladder", () => {
  it("every rung pays at least the National Living Wage at every owner, and wages rise up the ladder", () => {
    for (const t of TRACKS) {
      const rungs = LADDER[t];
      for (const s of Object.keys(OWNERS) as (keyof typeof OWNERS)[]) {
        for (let r = 0; r < rungs.length; r++) {
          expect(rungWage(t, r, s)).toBeGreaterThanOrEqual(NLW);
          if (r > 0) expect(rungWage(t, r, s)).toBeGreaterThanOrEqual(rungWage(t, r - 1, s));
        }
      }
      expect(rungs[0]!.criteria).toBeUndefined();
      for (const r of rungs.slice(1)) expect(r.criteria).toBeDefined();
    }
    expect(NLW).toBe(1271);
  });

  it("rung names follow the brief", () => {
    expect(LADDER.chef.map((r) => r.id)).toEqual(["commis", "chef_de_partie", "sous_chef", "head_chef"]);
    expect(LADDER.bar.at(-1)!.title).toBe("General manager");
    expect(LADDER.waiter.at(-1)!.title).toBe("Restaurant manager");
    expect(LADDER.manager.at(-1)!.equityPct).toBeGreaterThan(0);
  });

  it("the checklist shows every criterion with current and target values", () => {
    const g = played("chef", 0);
    const list = promotionChecklist(g.career);
    expect(list.nextTitle).toBe("Chef de partie");
    expect(list.items.map((i) => i.key)).toEqual(["stat", "shiftsAtRung", "reviewAvg", "ownerMood"]);
    expect(list.ready).toBe(false);
    expect(list.items.find((i) => i.key === "stat")!.current).toBeCloseTo(trackStat("chef", g.career.stats));
  });
});

describe("promotion", () => {
  it("REQUEST_PROMOTION before the criteria are met is refused with what is missing", () => {
    const g = played("waiter", 3);
    const r = applyCareerCommand(content, g, { type: "REQUEST_PROMOTION" });
    const denied = r.events.find((e) => e.type === "PROMOTION_DENIED");
    expect(denied && denied.type === "PROMOTION_DENIED" && denied.missing.length).toBeGreaterThan(0);
    expect(r.game.career.rung).toBe(0);
    // Asking again straight away is on cooldown.
    expect(applyCareerCommand(content, r.game, { type: "REQUEST_PROMOTION" }).rejected).toBeTruthy();
  });

  it("meeting every criterion promotes: new title, wage, sim role, shifts at rung reset", () => {
    const g = ready(played("waiter", 3));
    expect(promotionChecklist(g.career).ready).toBe(true);
    const r = applyCareerCommand(content, g, { type: "REQUEST_PROMOTION" });
    expect(r.game.career.rung).toBe(1);
    expect(r.game.career.wage).toBe(rungWage("waiter", 1, g.career.owner.strategy));
    expect(r.game.career.shiftsAtRung).toBe(0);
    expect(r.game.career.promotionsEarned).toBe(1);
    expect(r.game.state.staff.find((s) => s.id === "player")!.wage).toBe(r.game.career.wage);
  });

  it("the waiter's last rung switches the sim role to manager", () => {
    let g = ready(played("waiter", 3));
    g = applyCareerCommand(content, g, { type: "REQUEST_PROMOTION" }).game;
    g = ready({ ...g, career: { ...g.career, cooldowns: {} } });
    g = applyCareerCommand(content, g, { type: "REQUEST_PROMOTION" }).game;
    expect(g.career.rung).toBe(2);
    expect(g.career.role).toBe("manager");
    expect(g.state.staff.find((s) => s.id === "player")!.role).toBe("manager");
  });

  it("a rival can poach the promotion: rung unchanged, promotionsLost++, a four-week cooldown", () => {
    const base = ready(played("chef", 3));
    const rival = fakeStaff("rival-1", { name: "Riley Rival", skill: 90, traits: ["ambitious"] });
    let poached = 0;
    let promoted = 0;
    for (let day = 3; day < 60; day++) {
      const c = base.career;
      const career: CareerState = {
        ...c, day, rival: rival.id,
        relationships: [...c.relationships, { staffId: rival.id, name: rival.name, role: "chef", bond: -20, tag: "rival", employer: c.employer.restaurantName, current: true, sharedShifts: 10, snapshot: rival }],
      };
      const r = applyCareerCommand(content, { ...base, career }, { type: "REQUEST_PROMOTION" });
      if (r.events.some((e) => e.type === "POACHED")) {
        poached++;
        expect(r.game.career.rung).toBe(0);
        expect(r.game.career.promotionsLost).toBe(1);
        expect(r.game.career.cooldowns.poach).toBe(day + 28);
        expect(promotionChecklist(r.game.career).ready).toBe(false);
        expect(r.game.career.relationships.find((x) => x.staffId === rival.id)!.bond).toBeLessThan(-20);
      } else if (r.events.some((e) => e.type === "PROMOTED")) promoted++;
    }
    expect(poached).toBeGreaterThan(5);
    expect(promoted).toBeGreaterThan(5);
  });

  it("poach chance grows with the rival's standing and shrinks with your reviews", () => {
    expect(poachChance(80, 40, 3.5)).toBeGreaterThan(poachChance(40, 40, 3.5));
    expect(poachChance(40, 40, 5)).toBeLessThan(poachChance(40, 40, 3));
    expect(poachChance(10, 90, 5)).toBeGreaterThanOrEqual(0.05);
  });

  it("over a year a commis climbs at least two rungs and the owner promotes at reviews", () => {
    const g = played("chef", 365);
    expect(g.career.rung).toBeGreaterThanOrEqual(2);
    expect(g.career.weeklyReview.length).toBeGreaterThan(40);
  });
});
