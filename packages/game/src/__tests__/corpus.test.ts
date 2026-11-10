/**
 * Round 11 (red-team T3): the committed save corpus (fixtures/corpus/index.json). Every save the game has ever
 * written that we kept — the reviewers' 17 distinct round 6–7 files, two round-9 save files, and saves generated now
 * for careers (apprentice, waiter, manager), owners as rounds 8–10 left them (staffed, decorated, each difficulty), an
 * Empire in year 4 with a board meeting waiting and a Stars restaurant in year 3 — must
 *   1. decode (save files through decodeSaveFile),
 *   2. re-encode stably: encode(decode(x)) is a fixed point, and byte-identical to the file for saves written by this
 *      round's encoder (older saves pick up fields added since, once),
 *   3. play a day through the real app reducer without throwing, and still encode and decode afterwards.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { decodeSave, encodeSave } from "../state/save";
import { decodeSaveFile } from "../state/saveFiles";
import { loadedApp, playDay } from "./fixtures/corpus/playDay";

const DIR = join(__dirname, "fixtures/corpus");
interface Entry { file: string; kind: "envelope" | "savefile"; key: "save" | "career"; origin: string; what: string }
const { files } = JSON.parse(readFileSync(join(DIR, "index.json"), "utf8")) as { files: Entry[] };

async function rawOf(e: Entry): Promise<string> {
  const text = gunzipSync(readFileSync(join(DIR, e.file))).toString("utf8");
  return e.kind === "savefile" ? (await decodeSaveFile(text)).raw : text;
}

describe("save corpus (round 11)", () => {
  it("is the distinct set the red-team counted, plus this round's saves, and stays small", () => {
    // Round 12 (F): generated saves are r11-* and later (r12-owner-invented-d6: invented dishes); legacy is the rest.
    const legacy = files.filter((f) => !/^r1[1-9]-/.test(f.file));
    expect(legacy.filter((f) => f.kind === "envelope")).toHaveLength(17);
    expect(files.filter((f) => f.file.startsWith("r11-career-")).length).toBeGreaterThanOrEqual(3);
    const bytes = files.reduce((a, f) => a + readFileSync(join(DIR, f.file)).length, 0);
    expect(bytes).toBeLessThan(3 * 1024 * 1024);
  });

  it.each(files.map((f) => [f.file, f] as const))("%s: decodes, re-encodes stably, plays a day", async (_name, e) => {
    const raw = await rawOf(e);
    const loaded = decodeSave(raw);
    const once = encodeSave(loaded.game, loaded.meta);
    if (/^r1[1-9]-/.test(e.file)) expect(once).toBe(raw);
    const again = decodeSave(once);
    expect(encodeSave(again.game, again.meta)).toBe(once);

    const before = loadedApp(loaded);
    const after = playDay(before);
    const g0 = before.game!, g1 = after.game!;
    const ended = g1.phase === "gameover" || !!after.meta.win;
    if (!ended) expect(g1.day !== g0.day || after.meta.career?.day !== before.meta.career?.day).toBe(true);
    const back = decodeSave(encodeSave(g1, after.meta));
    expect(back.game.day).toBe(g1.day);
    expect(back.meta.mode).toBe(after.meta.mode);
  }, 120_000);

  it("the generated saves are what their names say", async () => {
    const get = async (name: string) => decodeSave(await rawOf(files.find((f) => f.file === `r11-${name}.json.gz`)!));
    for (const [n, track] of [["career-apprentice-d4", "chef"], ["career-waiter-d5", "waiter"], ["career-manager-d6", "manager"]] as const) {
      const l = await get(n);
      expect(l.meta.mode).toBe("career");
      expect(l.meta.career!.track).toBe(track);
      expect(l.meta.career!.day).toBeGreaterThan(0);
    }
    const dec = await get("owner-decorated-fitted-d32");
    expect(Object.keys(dec.game.decor?.slots ?? {}).length).toBeGreaterThanOrEqual(2);
    expect((await get("owner-staffed-normal-d40")).game.staff.length).toBeGreaterThanOrEqual(3);
    const emp = await get("empire-y4-board");
    expect(emp.meta.empire!.boardMeeting).toBeTruthy();
    expect(emp.meta.empire!.hq.day).toBeGreaterThan(3 * 365);
    const stars = await get("stars-y3");
    expect(stars.meta.stars).toBeTruthy();
    expect(stars.game.day).toBeGreaterThan(2 * 365);
    // Round 12 (F): invented dishes on the menu, with their cookbook sales.
    const inv = decodeSave(await rawOf(files.find((f) => f.file === "r12-owner-invented-d6.json.gz")!));
    expect(inv.meta.customDishes?.map((d) => d.name)).toEqual(["Midnight risotto", "Strawberry mess"]);
    expect(inv.meta.customDishes![0]!.sold).toBeGreaterThan(0);
    expect(inv.game.menu.filter((m) => m.dishId.startsWith("custom:"))).toHaveLength(2);
  });
});
