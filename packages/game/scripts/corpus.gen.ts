/**
 * Round 11 (red-team T3): (re)builds the generated half of the committed save corpus,
 * src/__tests__/fixtures/corpus/ (`r11-*.json.gz`), with the real sim + content, and rewrites index.json.
 * The legacy half (`r6-*`, `r7-*`, `r9-*`: the 17 distinct reviewer saves from rounds 6–7 and two round-9 save files)
 * was copied in once and is never regenerated — those files are the point.
 *
 *   npx vitest run --config scripts/vitest.corpus.config.ts       (from packages/game)
 *
 * Saves are deterministic (fixed seeds), so a re-run only changes files when the sim or the envelope changed — which is
 * worth seeing in a diff: an old save must still load after such a change, so keep the old file and add a new one.
 */
import { it } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { GameState } from "@full-plate/sim-core";
import { stepEmpireDay } from "@full-plate/sim-empire";
import { runHeadless } from "../../sim-stars/src/script";
import { runStyle } from "../../sim-empire/src/strategies";
import { appReducer, initialAppState, type AppState } from "../src/state/gameReducer";
import { FORK_DAY, initialMeta, type PathMeta } from "../src/state/paths";
import { chooseEmpire, chooseStars } from "../src/state/pathEngine";
import { encodeSave } from "../src/state/save";
import { applyCommand, content, findDecorItem, runDay, suggestedOrder } from "../src/sim";
import { playDay } from "../src/__tests__/fixtures/corpus/playDay";

const DIR = join(__dirname, "../src/__tests__/fixtures/corpus");
interface Entry { file: string; kind: "envelope" | "savefile"; key: "save" | "career"; origin: string; what: string }

const made: Entry[] = [];
function write(name: string, key: Entry["key"], what: string, game: GameState, meta: PathMeta) {
  const file = `r11-${name}.json.gz`;
  writeFileSync(join(DIR, file), gzipSync(encodeSave(game, meta), { level: 9 }));
  made.push({ file, kind: "envelope", key, origin: "generated (scripts/corpus.gen.ts, round 11)", what });
}

function owner(seed: number, difficulty: GameState["difficulty"], days: number, hires: number): AppState {
  let s = appReducer(initialAppState, { type: "new", cmd: { type: "NEW_GAME", seed, districtId: "high_street", restaurantName: "Corpus Café", difficulty } });
  for (const id of ["beef_burger", "chicken_burger", "chunky_chips", "soft_drink", "garden_salad", "brownie"]) {
    const d = content.dishes.find((x) => x.id === id);
    if (d) s = appReducer(s, { type: "command", cmd: { type: "ADD_MENU_ITEM", dishId: id, price: d.suggestedPrice } });
  }
  for (let i = 0; i < hires; i++) s = appReducer(s, { type: "command", cmd: { type: "HIRE", candidateIndex: i } });
  let g = s.game!;
  for (let d = 0; d < days && g.phase !== "gameover"; d++) {
    g = runDay(content, g).state;
    for (const o of suggestedOrder(content, g)) g = applyCommand(content, g, { type: "ORDER_STOCK", ...o }).state;
    if (g.phase === "event") g = applyCommand(content, g, { type: "RESOLVE_EVENT", choiceId: content.events.find((e) => e.id === g.activeEvent?.eventId)!.choices[0]!.id }).state;
    else if (g.phase === "evening") g = applyCommand(content, g, { type: "END_DAY" }).state;
  }
  s = { ...s, game: g, meta: { ...s.meta, lastPathDay: g.history.at(-1)?.day ?? -1 } };
  // Staff come and go (round 10 personalities: some quit); top the team back up on the save day.
  for (let i = 0; s.game!.staff.length < hires && i < 6 && s.game!.phase === "planning"; i++) s = appReducer(s, { type: "command", cmd: { type: "HIRE", candidateIndex: i } });
  return s;
}

function career(track: "chef" | "waiter" | "manager", seed: number, days: number): AppState {
  let s = appReducer(initialAppState, { type: "newCareer", seed, track, strategy: "balanced", playerName: "Robin", difficulty: "cosy", districtId: "high_street", look: 2 });
  for (let d = 0; d < days; d++) s = playDay(s);
  return s;
}

it("writes the generated corpus saves", () => {
  // Careers: apprentice chef, waiter and manager tracks a few days in (planning), plus a chef mid-evening.
  for (const [track, label, days] of [["chef", "apprentice", 4], ["waiter", "waiter", 5], ["manager", "manager", 6]] as const) {
    const s = career(track, 40 + days, days);
    write(`career-${label}-d${days}`, "career", `career, ${track} track, ${days} days in`, s.game!, s.meta);
  }
  { let s = career("chef", 51, 3); s = appReducer(s, { type: "command", cmd: { type: "START_SERVICE" } }); s = appReducer(s, { type: "skipShift" });
    write("career-apprentice-evening", "career", "career, chef track, the evening after a worked shift", s.game!, s.meta); }

  // Owners as rounds 8–10 left them: staffed (round-10 personalities), decorated (round-10 decor), on each difficulty.
  { const s = owner(61, "normal", 40, 3);
    write("owner-staffed-normal-d40", "save", "owner, Normal, 3 hires, day ~40, planning", s.game!, s.meta); }
  { const s = owner(62, "hard", 15, 2);
    write("owner-hard-d15", "save", "owner, Hard, 2 hires, day ~15, planning", s.game!, s.meta); }
  { let s = owner(63, "cosy", 30, 2);
    const g0 = s.game!;
    let g = g0;
    for (const id of ["floor_checker", "sign_neon", "seat_velvet"]) {
      const it = findDecorItem(content, id);
      if (!it) continue;
      const r = applyCommand(content, g, { type: "BUY_DECOR", slot: it.slot, itemId: it.id });
      g = r.state;
    }
    s = { ...s, game: g };
    write("owner-decorated-d30", "save", "owner, Cosy, decor bought (floor, sign, seating) the evening before fitting", s.game!, s.meta);
    s = playDay(s); s = playDay(s);
    write("owner-decorated-fitted-d32", "save", "owner, Cosy, the same room two days later (fitted)", s.game!, s.meta); }

  // Empire, year 4 (three years of franchise growth after the fork), the day its board meeting is held.
  const base = owner(21, "cosy", 25, 1);
  const eve = runDay(content, base.game!).state;
  const morning: GameState = { ...base.game!, day: FORK_DAY + 1 };
  const m0: PathMeta = { ...initialMeta("owner"), lastPathDay: FORK_DAY };
  { const forked = chooseEmpire(morning, m0, "Corpus Burgers");
    let emp = runStyle(content, "franchise", 4, 3, forked.empire!, "follow").final;
    do emp = stepEmpireDay(content, emp).empire;
    while (!emp.boardMeeting);
    const bday = emp.boardMeeting.day;
    const last = eve.history.at(-1)!;
    write("empire-y4-board", "save", "Empire, year 4, franchise style, the evening a board meeting is waiting", { ...eve, day: bday, history: [...eve.history.slice(0, -1), { ...last, day: bday }] }, { ...forked, empire: emp, lastPathDay: bday }); }

  // Stars, year 3: two scripted years after the fork (sim-stars' headless script on this restaurant).
  { const run = runHeadless(content, { years: 2, seed: 7, refitYear: 0, districtId: "high_street", from: morning });
    const meta = chooseStars(morning, m0);
    write("stars-y3", "save", "Stars, two scripted years after the fork (year 3)", run.final.state, { ...meta, stars: run.final.stars, lastPathDay: run.final.state.history.at(-1)?.day ?? FORK_DAY }); }

  const indexPath = join(DIR, "index.json");
  const old: Entry[] = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")).files : [];
  const files = [...old.filter((e) => !e.file.startsWith("r11-")), ...made];
  writeFileSync(indexPath, JSON.stringify({
    about: "Round 11 save corpus (red-team T3). corpus.test.ts decodes each, checks re-encoding is stable, and plays a day. key: the localStorage key the save lived under (save = full-plate:save:v1, career = full-plate:career:v1). Legacy files are never regenerated.",
    files,
  }, null, 1) + "\n");
}, 900_000);
