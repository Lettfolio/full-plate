/** Round 10 (B): staff with personality — portraits, likes/dislikes, relationships, training tracks, candidates. */
import { describe, expect, it } from "vitest";
import { applyCommand, candidates, deserialize, runDay, serialize } from "../src/index";
import {
  AVATAR_HAIRS, AVATAR_SKINS, DISLIKE_IDS, HAIR_STYLES, LIKE_IDS, PERSONALITY_MOOD, PLAYER_LOOKS, TRAINING_TRACKS,
  avatarFor, hashKey, mainReason, personalityFactors, personalityMood, personalityOf, playerAvatar, quoteFor,
  relationBetween, relationsOf, type PersonalityDay,
} from "../src/personality";
import { TRAINING_FEE } from "../src/constants";
import { cooksOnShift, passCover, SHADOW_COOK_SUFFIX } from "../src/systems/kitchen";
import { dayContext, updateStaffMember } from "../src/systems/staffMood";
import type { GameState, Staff } from "../src/types";
import { C, ready, staffMember, step } from "./helpers";
import type { Command } from "../src/types";

/** Rejected: a LOG "bad", no change to staff or cash. */
function rejected(s: GameState, cmd: Command): boolean {
  const r = applyCommand(C, s, cmd);
  return r.events.some((e) => e.type === "LOG" && e.entry.kind === "bad") && r.state.cash === s.cash && r.state.staff === s.staff;
}

const NAMES = ["Amara Campbell", "Ben Chen", "Chloe Davies", "Dev Robinson", "Ellie Rossi", "Femi Hall", "Grace Ferreira", "Harvey Hughes", "Isla Evans", "Jamal Kowalski", "Keira Nguyen", "Liam Gallagher"];
const people = NAMES.map((name, i) => ({ id: `s${i}-${i % 4}`, name, role: (["chef", "server", "bar", "porter", "manager"] as const)[i % 5]! }));

function deepFreeze<T>(x: T): T {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
  }
  return x;
}

describe("portraits (avatarFor)", () => {
  it("is deterministic and varied", () => {
    for (const p of people) expect(avatarFor(p)).toEqual(avatarFor({ ...p }));
    const specs = people.map(avatarFor);
    expect(new Set(specs.map((s) => s.hairStyle)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(specs.map((s) => s.colour.id)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(specs.map((s) => `${s.skin}${s.hair}`)).size).toBeGreaterThanOrEqual(8);
    for (const s of specs) expect(HAIR_STYLES).toContain(s.hairStyle);
  });

  it("matches the floor sprite's skin and hair rule (hashKey(id))", () => {
    for (const p of people) {
      const h = hashKey(p.id);
      expect(avatarFor(p).skin).toBe(AVATAR_SKINS[h % AVATAR_SKINS.length]);
      expect(avatarFor(p).hair).toBe(AVATAR_HAIRS[(h >> 3) % AVATAR_HAIRS.length]);
    }
  });

  it("dresses by role (toque for chefs, cap front of house)", () => {
    expect(avatarFor({ id: "a", name: "A", role: "chef" }).hat).toBe("toque");
    expect(avatarFor({ id: "a", name: "A", role: "server" }).hat).toBe("cap");
    expect(avatarFor({ id: "a", name: "A", role: "porter" }).hat).toBe("none");
  });

  it("two people with the same initials get different portraits (R7 'two KBs')", () => {
    const a = avatarFor({ id: "s3-0", name: "Keira Brown", role: "chef" });
    const b = avatarFor({ id: "s9-1", name: "Kai Bell", role: "chef" });
    expect(a).not.toEqual(b);
  });

  it("player looks: six, wrapping, role clothes", () => {
    expect(PLAYER_LOOKS).toHaveLength(6);
    expect(playerAvatar(7, "server")).toEqual(playerAvatar(1, "server"));
    expect(playerAvatar(2, "chef").hat).toBe("toque");
    expect(playerAvatar(Number.NaN, "bar")).toEqual(playerAvatar(0, "bar"));
  });
});

describe("likes and dislikes", () => {
  it("one like and one dislike each, deterministic, never contradicting; tips only front of house", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const p = { id: `s${i}-0`, name: `Person ${i}`, role: (["chef", "server", "porter"] as const)[i % 3]! };
      const t = personalityOf(p);
      expect(personalityOf(p)).toEqual(t);
      expect(LIKE_IDS).toContain(t.like);
      expect(DISLIKE_IDS).toContain(t.dislike);
      expect([t.like, t.dislike]).not.toEqual(["busy_nights", "mad_rush"]);
      expect([t.like, t.dislike]).not.toEqual(["quiet_nights", "slow_nights"]);
      if (p.role !== "server") expect(t.like).not.toBe("tips");
      seen.add(t.like).add(t.dislike);
    }
    expect(seen.size).toBe(LIKE_IDS.length + DISLIKE_IDS.length);
  });

  const day = (over: Partial<PersonalityDay> = {}): PersonalityDay => ({
    worked: true, training: false, weekday: 2, weekend: false, coversPerHead: 12, meanRating: 3.5, tipsRatio: -0.5, fatigue: 10, workedWith: [], ...over,
  });
  const find = (pred: (t: ReturnType<typeof personalityOf>) => boolean): Staff => {
    for (let i = 0; i < 500; i++) {
      const s = staffMember({ id: `x${i}`, name: `Pat ${i}`, role: "server" });
      if (pred(personalityOf(s))) return s;
    }
    throw new Error("none");
  };

  it("a like lifts mood when it happens; a dislike lowers it; reasons say why", () => {
    const monday = find((t) => t.dislike === "mondays");
    const f = personalityFactors(C, monday, day({ weekday: 0 }));
    expect(f.some((x) => x.delta < 0 && /Monday/.test(x.text))).toBe(true);
    expect(personalityFactors(C, monday, day({ weekday: 2 })).some((x) => /Monday/.test(x.text))).toBe(false);
    const wknd = find((t) => t.like === "weekends_off");
    const g = personalityFactors(C, wknd, day({ worked: false, weekday: 6, weekend: true }));
    expect(g).toEqual([{ delta: PERSONALITY_MOOD.like, text: "had Sunday off" }]);
    const learner = find((t) => t.like === "learning");
    expect(personalityFactors(C, learner, day({ training: true }))[0]!.delta).toBe(PERSONALITY_MOOD.learning);
  });

  it("the daily nudge is clamped to ±5", () => {
    expect(personalityMood([{ delta: 4, text: "a" }, { delta: 4, text: "b" }])).toBe(5);
    expect(personalityMood([{ delta: -4, text: "a" }, { delta: -4, text: "b" }])).toBe(-5);
    expect(mainReason([{ delta: 1, text: "a" }, { delta: -2, text: "b" }])!.text).toBe("b");
    expect(mainReason([{ delta: 0.2, text: "a" }])).toBeUndefined();
    // every person on every kind of day stays inside the cap
    for (const p of people) {
      const s = staffMember(p);
      for (const d of [day(), day({ weekday: 0, coversPerHead: 40, meanRating: 1, fatigue: 90 }), day({ worked: false, weekend: true, weekday: 5 })]) {
        expect(Math.abs(personalityMood(personalityFactors(C, s, { ...d, workedWith: people.map((x) => staffMember(x)) })))).toBeLessThanOrEqual(PERSONALITY_MOOD.cap);
      }
    }
  });

  it("quotes come from the archetype pool, deterministically", () => {
    const pack = { ...C, staffText: { quotes: { chef_commis: ["One", "Two", "Three"] } } };
    const q = quoteFor(pack, "chef_commis", people[0]!);
    expect(["One", "Two", "Three"]).toContain(q);
    expect(quoteFor(pack, "chef_commis", people[0]!)).toBe(q);
    expect(quoteFor(C, "nope", people[0]!).length).toBeGreaterThan(5);
  });
});

describe("relationships", () => {
  it("are symmetric, deterministic and rare-ish", () => {
    let friends = 0, clashes = 0, n = 0;
    for (const a of people) for (const b of people) {
      expect(relationBetween(a, b)).toBe(relationBetween(b, a));
      if (a === b) { expect(relationBetween(a, b)).toBeUndefined(); continue; }
      n++;
      const r = relationBetween(a, b);
      if (r === "friends") friends++;
      if (r === "clash") clashes++;
    }
    expect(friends).toBeGreaterThan(0);
    expect(clashes).toBeLessThan(friends);
    expect(friends + clashes).toBeLessThan(n / 2);
  });

  it("friends on shift together cheer up, a clash grumbles; nothing on a day off", () => {
    let pair: [Staff, Staff] | undefined, foes: [Staff, Staff] | undefined;
    for (let i = 0; i < 400 && (!pair || !foes); i++) {
      const a = staffMember({ id: `a${i}`, name: `Ann ${i}` }), b = staffMember({ id: `b${i}`, name: `Bo ${i}` });
      const r = relationBetween(a, b);
      if (r === "friends") pair ??= [a, b];
      if (r === "clash") foes ??= [a, b];
    }
    const d: PersonalityDay = { worked: true, training: false, weekday: 2, weekend: false, coversPerHead: 12, meanRating: 3.5, tipsRatio: -1, fatigue: 0, workedWith: [] };
    const f = personalityFactors(C, pair![0], { ...d, workedWith: [pair![1]] }).find((x) => /worked with/.test(x.text))!;
    expect(f.delta).toBeGreaterThan(0);
    const c = personalityFactors(C, foes![0], { ...d, workedWith: [foes![1]] }).find((x) => /stuck on a shift/.test(x.text))!;
    expect(c.delta).toBeLessThan(0);
    expect(personalityFactors(C, foes![0], { ...d, worked: false, workedWith: [foes![1]] }).some((x) => /stuck/.test(x.text))).toBe(false);
    expect(relationsOf(pair![0], [pair![1], foes![1]]).friends).toContain(pair![1]);
  });
});

describe("evening mood reasons", () => {
  it("every staff member gets a mood note after a day; it names the day off", () => {
    const s = ready();
    const after = runDay(C, s).state;
    for (const p of after.staff) expect(p.moodWhy?.text.length).toBeGreaterThan(3);
    const off = staffMember({ rota: [false, false, false, false, false, false, false] });
    const next = updateStaffMember(C, off, s.day, dayContext({ ...s, staff: [off] }));
    expect(next.moodWhy!.text).toMatch(/off/);
  });
});

describe("training tracks", () => {
  const withCash = (s: GameState, cash = 1_000_000): GameState => ({ ...s, cash });

  it("legacy TRAIN (no track) behaves as before: fee, skill gain, no tracks", () => {
    const s = withCash(ready());
    const chef = s.staff.find((x) => x.role === "chef")!;
    const t = step(s, { type: "TRAIN", staffId: chef.id });
    const after = t.staff.find((x) => x.id === chef.id)!;
    expect(t.cash).toBe(s.cash - TRAINING_FEE);
    expect(after.skill).toBeGreaterThan(chef.skill);
    expect(after.tracks).toBeUndefined();
    expect(after.trainingTrack).toBeUndefined();
  });

  it("a track raises its stat a level at a time, costs each level's fee, stops at 3", () => {
    let s = withCash(ready());
    const chef = s.staff.find((x) => x.role === "chef")!;
    const knife = TRAINING_TRACKS.find((t) => t.id === "knife")!;
    for (let lvl = 1; lvl <= 3; lvl++) {
      const before = s.staff.find((x) => x.id === chef.id)!;
      const r = applyCommand(C, s, { type: "TRAIN", staffId: chef.id, track: "knife" });
      const after = r.state.staff.find((x) => x.id === chef.id)!;
      expect(r.state.cash).toBe(s.cash - knife.fees[lvl - 1]!);
      expect(after.speed).toBeCloseTo(Math.min(100, before.speed + knife.gain));
      expect(after.tracks?.knife).toBe(lvl);
      expect(after.trainingTrack).toBe("knife");
      // the evening: a level-up line, trainingTrack cleared
      const ev = runDay(C, r.state);
      expect(ev.events.some((e) => e.type === "LOG" && /Level up! .* Knife skills level \d/.test(e.entry.text))).toBe(true);
      const done = ev.state.staff.find((x) => x.id === chef.id)!;
      expect(done.trainingTrack).toBeUndefined();
      expect(done.tracks?.knife).toBe(lvl);
      s = withCash(step(ev.state, { type: "END_DAY" }));
    }
    expect(rejected(s, { type: "TRAIN", staffId: chef.id, track: "knife" })).toBe(true);
  });

  it("rejects a track the role can't take, an unknown track, and too little cash", () => {
    const s = withCash(ready());
    const server = s.staff.find((x) => x.role === "server")!;
    expect(rejected(s, { type: "TRAIN", staffId: server.id, track: "pass" })).toBe(true);
    expect(rejected(s, { type: "TRAIN", staffId: server.id, track: "nope" as never })).toBe(true);
    const poor = { ...s, cash: 100 };
    expect(rejected(poor, { type: "TRAIN", staffId: server.id, track: "charm" })).toBe(true);
  });

  it("is pure on deep-frozen state", () => {
    const s = deepFreeze(withCash(ready()));
    const chef = s.staff.find((x) => x.role === "chef")!;
    expect(() => applyCommand(C, s, { type: "TRAIN", staffId: chef.id, track: "plating" })).not.toThrow();
    expect(() => runDay(C, s)).not.toThrow();
  });

  it("a 'Cover the pass' chef becomes the sous chef cook; the shadow cook id still works", () => {
    const s = ready();
    const chefs = s.staff.filter((x) => x.role === "chef");
    const trained = { ...s, staff: s.staff.map((x) => (x.id === chefs[0]!.id ? { ...x, tracks: { pass: 2 } } : x)) };
    const cooks = cooksOnShift(C, trained);
    expect(passCover(cooks)?.id).toBe(chefs[0]!.id);
    expect(passCover(cooks)?.passLevel).toBe(2);
    expect(passCover(cooksOnShift(C, s))).toBeUndefined();
    const hands = { ...trained, handsOn: { role: "chef" as const, staffId: chefs[0]!.id, station: "grill" as never } };
    const ids = cooksOnShift(C, hands).map((k) => k.id);
    expect(ids).toContain(`${chefs[0]!.id}${SHADOW_COOK_SUFFIX}`);
  });
});

describe("candidates", () => {
  it("carry their future staff id and archetype; the same per day; HIRE by id works", () => {
    const s = { ...ready(), cash: 1_000_000 };
    const pool = candidates(C, s);
    expect(pool.length).toBeGreaterThanOrEqual(3);
    pool.forEach((c, i) => expect(c.id).toBe(`s${s.day}-${i}`));
    expect(candidates(C, s)).toEqual(pool);
    expect(pool.every((c) => typeof c.archetype === "string")).toBe(true);
    const r = applyCommand(C, s, { type: "HIRE", candidateId: pool[1]!.id! });
    const hired = r.state.staff.at(-1)!;
    expect(hired.id).toBe(pool[1]!.id);
    expect(avatarFor(hired)).toEqual(avatarFor({ id: pool[1]!.id!, name: pool[1]!.name, role: pool[1]!.role }));
    expect(personalityOf(hired)).toEqual(personalityOf({ id: pool[1]!.id!, name: pool[1]!.name, role: pool[1]!.role }));
    // yesterday's id or nonsense is rejected
    expect(rejected(s, { type: "HIRE", candidateId: `s${s.day + 1}-0` })).toBe(true);
    expect(rejected(s, { type: "HIRE", candidateId: "bob" })).toBe(true);
  });
});

describe("saves", () => {
  it("a save without the new fields round-trips byte-identical", () => {
    const s = ready();
    expect(s.staff.every((x) => x.moodWhy === undefined && x.tracks === undefined)).toBe(true);
    const json = serialize(s);
    expect(serialize(deserialize(json))).toBe(json);
  });

  it("new fields survive a save", () => {
    const s = { ...ready(), cash: 1_000_000 };
    const chef = s.staff.find((x) => x.role === "chef")!;
    const t = runDay(C, step(s, { type: "TRAIN", staffId: chef.id, track: "plating" })).state;
    const back = deserialize(serialize(t));
    expect(back.staff.find((x) => x.id === chef.id)!.tracks).toEqual({ plating: 1 });
    expect(back.staff[0]!.moodWhy).toEqual(t.staff[0]!.moodWhy);
  });
});
