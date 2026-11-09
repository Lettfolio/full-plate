/**
 * Career fast-forward.
 *   pnpm --filter @full-plate/sim-career headless [--days 365] [--seed 7] [--seeds 1] [--strategy balanced] [--weekend 1]
 * Plays each of the four starts for a year with the default auto-policy and prints the rung reached, savings,
 * relationships and the handover perks (the place you could open on the last day).
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ContentPack } from "@full-plate/sim-core";
import { advanceCareerDay, DEFAULT_POLICY, newCareer, type AutoPolicy } from "./career";
import { handoverToOwner, openingBudget } from "./handover";
import { perHour, pounds, promotionChecklist, reviewAverage, rungDef, trackStat } from "./ladder";
import type { CareerGame, CareerTrack, OwnerStrategy } from "./types";

export const TRACKS: readonly CareerTrack[] = ["chef", "bar", "waiter", "manager"];

export interface YearRun {
  track: CareerTrack;
  seed: number;
  game: CareerGame;
  /** Career day of each promotion (and the title reached). */
  promotions: { day: number; title: string }[];
  jobs: number;
  ms: number;
}

export function playCareer(content: ContentPack, track: CareerTrack, seed: number, days: number, strategy: OwnerStrategy, policy: AutoPolicy): YearRun {
  const t0 = performance.now();
  let game = newCareer(content, { seed, track, strategy, playerName: "Alex Taylor" });
  const promotions: YearRun["promotions"] = [];
  for (let d = 0; d < days && !game.career.handover; d++) {
    const r = advanceCareerDay(content, game, policy);
    game = r.game;
    for (const e of r.events) if (e.type === "PROMOTED") promotions.push({ day: game.career.day, title: e.title });
    for (const e of r.events) if (e.type === "JOB_CHANGED") promotions.push({ day: game.career.day, title: `→ ${e.restaurantName} (${e.strategy}, ${rungDef(track, e.rung).title.toLowerCase()})` });
  }
  return { track, seed, game, promotions, jobs: game.career.jobs.length, ms: performance.now() - t0 };
}

export function report(content: ContentPack, run: YearRun): string {
  const c = run.game.career;
  const lines: string[] = [];
  const def = rungDef(c.track, c.rung);
  lines.push(`━━ ${c.track.toUpperCase()} start (seed ${run.seed}) — day ${c.day}, ${(run.ms / 1000).toFixed(1)}s`);
  lines.push(`  rung ${c.rung}: ${def.title} on ${perHour(c.wage)} at ${c.employer.restaurantName} (${c.owner.strategy}, ${c.employer.status}); jobs held ${run.jobs}`);
  lines.push(`  promotions: ${run.promotions.map((p) => `day ${p.day} ${p.title}`).join("; ") || "none"}  (lost to a rival: ${c.promotionsLost})`);
  lines.push(`  stats skill ${c.stats.skill.toFixed(1)} charm ${c.stats.charm.toFixed(1)} speed ${c.stats.speed.toFixed(1)} (track ${trackStat(c.track, c.stats).toFixed(1)}); rep ${c.reputation.toFixed(0)}; mood ${c.mood.toFixed(0)}; stress ${c.stress.toFixed(0)}; owner mood ${c.owner.mood.toFixed(0)}`);
  lines.push(`  shifts ${c.shiftsWorked} (weekend ${c.lifetime.weekendShifts}, declined ${c.lifetime.declinedShifts}, training days ${c.lifetime.trainingDays}, mentor sessions ${c.lifetime.mentorSessions}); avg review ${reviewAverage(c).toFixed(1)} of last 4`);
  const lt = c.lifetime;
  lines.push(`  money: wages ${pounds(lt.wages)} + tronc ${pounds(lt.tips)} + bonus ${pounds(lt.bonus)} − tax ${pounds(lt.tax)} − NI ${pounds(lt.ni)} − living ${pounds(lt.living)} ⇒ savings ${pounds(c.savings)}`);
  const rels = [...c.relationships].sort((a, b) => b.bond - a.bond);
  const fmt = (r: (typeof rels)[number]) => `${r.name} (${r.role}${r.wasHeadChef ? ", head chef" : ""}${r.tag ? `, ${r.tag}` : ""}${r.current ? "" : ", former"}) ${r.bond >= 0 ? "+" : ""}${r.bond.toFixed(0)}`;
  lines.push(`  relationships: ${rels.slice(0, 5).map(fmt).join("; ") || "none"}${rels.length > 5 ? ` … +${rels.length - 5}` : ""}`);
  const list = promotionChecklist(c);
  if (list.nextTitle) lines.push(`  next: ${list.nextTitle} — ${list.items.map((i) => `${i.met ? "✓" : "✗"} ${i.label} ${Math.floor(i.current)}/${i.target}`).join(", ")}`);
  const b = openingBudget(content, c);
  lines.push(`  own place (${b.districtId}): needs ${pounds(b.savingsNeeded)} of savings + ${pounds(b.loan)} loan; ${c.canOpenOwn ? `CAN OPEN (since day ${c.canOpenSinceDay})` : `not yet (${b.rungOk ? "" : `rung: ${b.rungNeeded}; `}short ${pounds(b.shortfall)})`}`);
  const h = handoverToOwner(content, c, run.game.state);
  lines.push(`  handover preview: opening cash ${pounds(h.state.cash)}, staff on day 1: ${h.state.staff.map((s) => `${s.name} (${s.role}, ${perHour(s.wage)})`).join(", ") || "none"}`);
  for (const p of h.perks) lines.push(`    • ${p}`);
  return lines.join("\n");
}

function arg(argv: readonly string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const days = Number(arg(argv, "days") ?? 365);
  const seed0 = Number(arg(argv, "seed") ?? 7);
  const seeds = Number(arg(argv, "seeds") ?? 1);
  const strategy = (arg(argv, "strategy") ?? "balanced") as OwnerStrategy;
  const policy: AutoPolicy = { ...DEFAULT_POLICY, weekendShifts: Number(arg(argv, "weekend") ?? DEFAULT_POLICY.weekendShifts) };
  const { content } = (await import("@full-plate/content")) as { content: ContentPack };
  console.log(`Full Plate career headless — ${days} days, first employer ${strategy}, ${policy.weekendShifts} weekend shift(s)/week, seeds ${seed0}..${seed0 + seeds - 1}`);
  for (const track of TRACKS) {
    for (let s = seed0; s < seed0 + seeds; s++) console.log(report(content, playCareer(content, track, s, days, strategy, policy)));
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  });
}
