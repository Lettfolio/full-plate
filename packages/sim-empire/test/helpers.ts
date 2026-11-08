import { content } from "@full-plate/content";
import { applyCommand, type DayResult, type GameState } from "@full-plate/sim-core";
import { playOne, STRATEGIES } from "../../sim-core/src/headless";
import { applyEmpireCommand, newEmpire, stepEmpireDay, type EmpireCommand, type EmpireState } from "../src/index";
import { FAST_FOOD_MENU } from "../src/headless";

export { content };

/** A focused sim-core restaurant played for `days` by sim-core's own scripted "balanced" owner. */
export function focusedRun(seed: number, days: number): { state: GameState; history: DayResult[] } {
  const r = playOne(content, seed, days, STRATEGIES.balanced, "normal");
  return { state: r.final!, history: r.final!.history };
}

export function empire(over: Partial<{ seed: number; cash: number }> = {}): EmpireState {
  return newEmpire(content, {
    seed: over.seed ?? 7,
    brandName: "Test Burgers",
    flagship: { name: "Flagship", districtId: "high_street" },
    hqCash: over.cash ?? 500_000_000,
    menuDishIds: FAST_FOOD_MENU,
  });
}

/** Applies a command and fails loudly if rejected. */
export function must(e: EmpireState, cmd: EmpireCommand): EmpireState {
  const r = applyEmpireCommand(content, e, cmd);
  const bad = r.events.find((ev) => ev.kind === "rejected");
  if (bad) throw new Error(`${cmd.type} rejected: ${bad.text}`);
  return r.empire;
}

export function rejected(e: EmpireState, cmd: EmpireCommand): string | undefined {
  return applyEmpireCommand(content, e, cmd).events.find((ev) => ev.kind === "rejected")?.text;
}

export function days(e: EmpireState, n: number, noEvents = true): EmpireState {
  let cur = e;
  for (let i = 0; i < n; i++) cur = stepEmpireDay(content, cur, undefined, { noEvents }).empire;
  return cur;
}

/** Adds an applicant directly (tests shouldn't wait for the random arrival). */
export function withApplicant(e: EmpireState, id = "a_test", over: Partial<{ competence: number; honesty: number; cash: number }> = {}): EmpireState {
  return {
    ...e,
    applicants: [...e.applicants, { id, name: `Applicant ${id}`, competence: over.competence ?? 60, honesty: over.honesty ?? 90, cash: over.cash ?? 40_000_000, arrivedDay: e.hq.day }],
  };
}

export { applyCommand };
