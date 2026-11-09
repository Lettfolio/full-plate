/**
 * Round 7: the first-shift onboarding on the hands-on canvas — three short steps with a pointer (grab a slip → cook at
 * your station → send it to the pass), shown once per save and role, skippable, replayable from the "?" button.
 * Pure step data plus a tiny localStorage flag; the overlay lives in screens/HandsOnShift.tsx.
 */
import type { HandsOnRole } from "@full-plate/handson";

/** What a step points at: the rail (first slip) or a station id on the canvas. */
export type OnboardTarget = { kind: "rail" } | { kind: "station"; stationId: string };

export interface OnboardStep {
  title: string;
  text: string;
  target: OnboardTarget;
}

export interface OnboardOptions {
  role: HandsOnRole;
  /** A commis with a station: which appliance is hers (handson `yourStations`), for step 2. */
  station?: { appliance?: string };
  /** Touch screen: "tap" and the USE button instead of walking keys and E. */
  touch: boolean;
}

export function onboardingSteps({ role, station, touch }: OnboardOptions): OnboardStep[] {
  const walk = touch ? "Tap a spot to walk there" : "Walk with WASD or the arrow keys";
  const use = touch ? "USE" : "E";
  if (role === "chef") {
    const where = station?.appliance && station.appliance !== "prep"
      ? `the ${station.appliance === "stove" ? "hob" : station.appliance} marked Yours`
      : "your station";
    return [
      {
        title: "Grab a slip",
        text: station
          ? `Your orders hang on the rail up here. Red-edged slips are yours. ${touch ? "Tap a slip" : `${walk} to the fridge and press ${use}`} to fetch the food.`
          : `Orders hang on the rail up here. ${touch ? "Tap a slip" : `${walk} to the fridge and press ${use}`} to fetch the food.`,
        target: { kind: "rail" },
      },
      {
        title: "Cook at your station",
        text: `Chop it on the board, then cook it at ${where}. Hold ${use} and let go when the needle is in the green.`,
        target: { kind: "station", stationId: station?.appliance ?? "stove" },
      },
      {
        title: "Send it to the pass",
        text: `Plate it at the pass and it goes out to the table. Then grab your next slip. If you get stuck, the sous chef helps.`,
        target: { kind: "station", stationId: "pass" },
      },
    ];
  }
  if (role === "bar") {
    return [
      { title: "Pour a drink", text: `${walk} to the bar. Hold ${use} to pour and let go on the dashed line.`, target: { kind: "station", stationId: "bar" } },
      { title: "Carry it out", text: "Take the drinks to the table number on the slip.", target: { kind: "rail" } },
      { title: "Take payment", text: `A gold £ on a table means they want to pay. Press ${use} at the till.`, target: { kind: "station", stationId: "till" } },
    ];
  }
  return [
    { title: "Pick up the food", text: `${walk} to the pass when plates are up, and press ${use} to pick them up.`, target: { kind: "station", stationId: "pass" } },
    { title: "Serve the table", text: "Carry them to the table number on the slip. Up to three plates at once.", target: { kind: "rail" } },
    { title: "Clear and get paid", text: `Clear dirty tables, then take payment at the till when you see a gold £.`, target: { kind: "station", stationId: "till" } },
  ];
}

/** One flag per save (the game's seed) and role. */
export const onboardKey = (seed: number, role: HandsOnRole): string => `full-plate:onboard:v1:${role}:${seed}`;

export function onboardSeen(storage: Pick<Storage, "getItem"> | undefined, seed: number, role: HandsOnRole): boolean {
  try { return storage?.getItem(onboardKey(seed, role)) === "1"; } catch { return false; }
}

export function markOnboardSeen(storage: Pick<Storage, "setItem"> | undefined, seed: number, role: HandsOnRole): void {
  try { storage?.setItem(onboardKey(seed, role), "1"); } catch { /* private mode: it shows again next time */ }
}

/** Where to put the step card relative to its target in a stage of height `stageH`: below it in the top half. */
export function cardPlacement(target: { y: number; h: number }, stageH: number): "below" | "above" {
  return target.y + target.h / 2 < stageH / 2 ? "below" : "above";
}
