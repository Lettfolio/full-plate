/**
 * Round 13 review: F's left-out — the live co-op guest's room had no invented dishes (its pack holds only the shipped
 * dishes, so decodeBase dropped them from the menu and the tickets). The host's base now carries the recipes on
 * tonight's menu, each re-checked on the guest's side like a save's.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { createSession } from "@full-plate/handson";
import { decodeSave } from "../state/save";
import { content, syncCustomDishes } from "../sim";
import { decodeBase, encodeBase, guestContent, MSG_MAX, skeletonOf } from "../lib/coop/realtime";
import { loadedApp } from "./fixtures/corpus/playDay";

const DIR = join(__dirname, "fixtures/corpus");
const host = () => loadedApp(decodeSave(gunzipSync(readFileSync(join(DIR, "r12-owner-invented-d6.json.gz"))).toString("utf8")));

describe("Round 13 review: invented dishes reach the live guest", () => {
  afterAll(() => { syncCustomDishes([]); });

  it("the base carries tonight's invented dishes; a guest without them gets them back, by name", () => {
    const s = host();
    const game = s.game!;
    const mine = (s.meta.customDishes ?? []).filter((d) => game.menu.some((m) => m.dishId === d.id));
    expect(mine.length).toBeGreaterThan(0);
    const wire = JSON.parse(JSON.stringify(encodeBase(game, "chef"))) as Record<string, unknown>;
    expect(new TextEncoder().encode(JSON.stringify(wire)).length).toBeLessThan(MSG_MAX);
    expect((wire.cd as unknown[]).length).toBe(mine.length);

    syncCustomDishes([]); // the guest's page: only the shipped dishes
    expect(content.dishes.some((d) => d.id === mine[0]!.id)).toBe(false);
    const base = decodeBase(wire)!;
    expect(base.dishes).toEqual(expect.arrayContaining(mine.map((d) => d.id)));
    expect(base.custom.map((d) => d.id).sort()).toEqual(mine.map((d) => d.id).sort());
    const pack = guestContent(base);
    const sess = createSession(skeletonOf(base), "server", { content: pack, tutorial: false });
    expect(sess.dishes[mine[0]!.id]!.name).toBe(pack.dishes.find((d) => d.id === mine[0]!.id)!.name);
    expect(sess.dishes[mine[0]!.id]!.name).not.toMatch(/^Custom/);
  });

  it("a recipe that wouldn't pass a save's check is dropped, and its dish with it", () => {
    const s = host();
    const wire = JSON.parse(JSON.stringify(encodeBase(s.game!, "chef"))) as Record<string, unknown>;
    const cd = wire.cd as unknown[][];
    const bad = [...cd[0]!]; bad[4] = [["plutonium", 1], ["rice", 1]];
    const odd = [...cd[0]!]; odd[0] = "custom:zzzzzzzz"; odd[1] = "<img src=x onerror=alert(1)>";
    syncCustomDishes([]);
    const base = decodeBase({ ...wire, cd: [bad, odd, "junk", null, ...cd.slice(1)] })!;
    expect(base.custom.some((d) => d.id === cd[0]![0])).toBe(false);
    expect(base.dishes).not.toContain(cd[0]![0]);
    expect(base.custom.some((d) => d.id === "custom:zzzzzzzz")).toBe(false);
  });
});
