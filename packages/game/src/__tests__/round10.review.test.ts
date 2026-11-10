/**
 * Round 10 review: the seams between A (decorating) and B (staff with personality) and the rest of the game.
 */
import { describe, expect, it } from "vitest";
import { avatarFor, playerAvatar, type GameState, type Staff } from "@full-plate/sim-core";
import { createSession, sousId, sousName, staffLook } from "@full-plate/handson";
import { PLAYER_ID } from "@full-plate/sim-career";
import { appReducer } from "../state/gameReducer";
import { careerChefStart, playBotShift } from "./handsOnHarness";

const ROLES: ("chef" | "server" | "bar")[] = ["chef", "server", "bar"];

describe("(a) one rule for a person's colours: portraits, the dining room and the hands-on floor", () => {
  it("avatarFor and the hands-on sprite agree on skin and hair for 50 staff (keyed by staff id)", () => {
    for (let i = 0; i < 50; i++) {
      const p = { id: `s${i * 7}-${i % 3}`, name: `Person ${i}`, role: ROLES[i % ROLES.length]! };
      const a = avatarFor(p), look = staffLook(p.role, p.id);
      expect([look.skin, look.hair]).toEqual([a.skin, a.hair]);
    }
  });

  it("the career player's sprite wears the look they picked", () => {
    for (let look = 0; look < 6; look++) {
      const a = playerAvatar(look, "chef");
      const sprite = staffLook("chef", "you", true, { skin: a.skin, hair: a.hair });
      expect([sprite.skin, sprite.hair]).toEqual([a.skin, a.hair]);
    }
    expect(staffLook("chef", "you", true).skin).toBe("#f1c9a5"); // owner "Jump in" / old callers: unchanged
  });
});

describe("(e) Cover the pass → the sous chef on the hands-on station", () => {
  function withPass(level: number): ReturnType<typeof careerChefStart> {
    const s = careerChefStart(5);
    const g = s.game!;
    const chefs = g.staff.filter((x) => x.role === "chef" && x.id !== PLAYER_ID);
    // train the *last* other chef, so it isn't the default pick
    const t = chefs.at(-1)!;
    // on every day, so they are on today's floor
    const staff: Staff[] = g.staff.map((x) => (x.id === t.id ? { ...x, rota: x.rota.map(() => true), tracks: { ...x.tracks, pass: level } } : x));
    return { ...s, game: { ...g, staff } as GameState };
  }

  it("a chef trained to level 1 is the one the hands-on floor names as the sous chef", () => {
    const s = withPass(1);
    const g = s.game!;
    const trained = g.staff.find((x) => (x.tracks?.pass ?? 0) > 0)!;
    const session = createSession(g, "chef", { playerStaffId: PLAYER_ID });
    expect(sousName(session, g)).toBe(trained.name.split(" ")[0]);
    expect(sousId(session, g)).toBe(trained.id);
  });

  it("level 3 covers plate better than level 1 (the sous chef's mean quality on an idle shift)", () => {
    const q = (level: number) => {
      const r = playBotShift(withPass(level), { idle: true });
      const day = r.app.game!.history.at(-1)!;
      const id = r.app.game!.staff.find((x) => (x.tracks?.pass ?? 0) > 0)!.id;
      return day.perChef?.[id];
    };
    const one = q(1), three = q(3);
    expect(one && three).toBeTruthy();
    expect(one!.plates).toBeGreaterThan(0);
    expect(three!.qualityMean).toBeGreaterThan(one!.qualityMean);
  }, 120_000);
});

describe("(i) career: TRAIN without a track still works for the owner script", () => {
  it("legacy TRAIN { staffId } is accepted in a career game", () => {
    const s = careerChefStart(3);
    const g = s.game!;
    const other = g.staff.find((x) => x.id !== PLAYER_ID)!;
    const next = appReducer({ ...s, game: { ...g, cash: 1_000_000 } }, { type: "command", cmd: { type: "TRAIN", staffId: other.id } });
    expect(next.game!.log.at(-1)?.kind).not.toBe("bad");
  });
});
