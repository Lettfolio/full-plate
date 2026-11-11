/**
 * Round 14 (D): scripted players for the daily challenge's fairness test (round14.challengeFair.test.ts). Each takes a
 * built scenario and plays its five days with ordinary commands, as a player could from the screens.
 */
import type { Command, GameState } from "@full-plate/sim-core";
import { strategies } from "@full-plate/sim-core";
import { applyCommand, candidates, careerContent, content, runStrategyDay, STRATEGIES } from "../sim";
import { scoreOf, templateOf, type Built, type Score } from "../lib/challenge";
import { CHALLENGE_DAYS } from "../state/paths";

const send = (g: GameState, cmd: Command) => applyCommand(content, g, cmd).state;
const step = (g: GameState, cmd: Command) => send(g, cmd);
const days = (g0: GameState, f: (g: GameState, i: number) => GameState) => {
  let g = g0;
  for (let i = 0; i < CHALLENGE_DAYS && g.phase !== "gameover"; i++) g = f(g, i);
  return g;
};
/** End of the evening: END_DAY, then the morning post answered with its first affordable choice. */
const closeEvening = (s0: GameState) => {
  let s = s0;
  if (s.phase === "evening") s = send(s, { type: "END_DAY" });
  if (s.phase === "event") s = strategies.resolveEvent(content, s, step);
  return s;
};
/** "Skip": open, skip to the evening (no reactions), next day. Nothing ordered, nothing changed. */
const skipDay = (g: GameState) => closeEvening(g.phase === "planning" ? strategies.playService(content, g, false) : g);
const closeDay = (g: GameState) => closeEvening(send(g, { type: "CLOSE_TODAY" }));
/** A typical day that never orders stock. */
const noRestockDay = (g0: GameState) => {
  let s = g0;
  s = strategies.staffing(content, s, STRATEGIES.typical, step);
  s = strategies.playService(content, s, true, true);
  return closeEvening(s);
};
/** Serve and restock like the typical owner, never hiring. */
const keepNobodyDay = (g0: GameState) => {
  let s = strategies.playService(content, g0, true, true);
  if (s.phase === "evening" || s.phase === "event") s = strategies.restock(content, s, STRATEGIES.typical, step);
  return closeEvening(s);
};
const fireAll = (g: GameState) => g.staff.reduce((s, st) => send(s, { type: "FIRE", staffId: st.id }), g);
const priceAll = (g: GameState, price: (p: number, suggested: number) => number) =>
  g.menu.reduce((s, m) => send(s, { type: "SET_MENU_ITEM", dishId: m.dishId, price: price(m.price, content.dishes.find((d) => d.id === m.dishId)!.suggestedPrice) }), g);
const strat = (name: "typical" | "balanced" | "premium") => (g: GameState) => runStrategyDay(content, g, STRATEGIES[name]);

export type Player = (b: Built) => GameState;

/** Doing nothing: five Skips. */
export const NOTHING: Player = (b) => days(b.game, skipDay);

/** Honest scripts: the typical and balanced owners as they are. */
export const HONEST: Record<string, Player> = {
  typical: (b) => days(b.game, strat("typical")),
  balanced: (b) => days(b.game, strat("balanced")),
};

/** A fresh team: everyone let go on the first morning and the typical owner hires again from today's candidates. */
export const freshTeam = (g: GameState): GameState => fireAll(g);

/** Hires the best of today's candidates for a role (by skill, or skill for the money), if there's cash for it. */
function hireBest(g: GameState, role: string, by: "skill" | "value" = "value"): GameState {
  const pool = candidates(content, g).map((c, i) => ({ c, i })).filter((x) => x.c.role === role && !x.c.hired);
  const score = (c: (typeof pool)[number]["c"]) => (by === "skill" ? c.skill : (c.skill + (role === "server" ? c.charm : c.speed)) / (c.wage / 1000));
  const top = pool.sort((a, b) => score(b.c) - score(a.c))[0];
  return top ? send(g, { type: "HIRE", candidateIndex: top.i }) : g;
}
const allWeek = (g: GameState) => g.staff.reduce((s, st) => send(s, { type: "SET_ROTA", staffId: st.id, rota: [true, true, true, true, true, true, true] }), g);
const have = (g: GameState, role: string) => g.staff.filter((s) => s.role === role).length;

/**
 * A simple best effort that fixes the stated problem on the first morning, then runs the balanced or the typical owner
 * (the better of the two). `met` is true when either met the goal.
 */
export const FIXES: Record<string, (g: GameState) => GameState> = {
  // Prices back to the menu's suggested level (a little over), the best seller back on.
  rescue: (g) => readdBest(priceAll(g, (_p, sp) => Math.round((sp * 1.1) / 10) * 10)),
  // Everyone on all week, a second chef and server if there's only one, two more tables.
  rush: (g) => {
    let s = g;
    if (have(s, "chef") < 2) s = hireBest(s, "chef");
    if (have(s, "server") < 2) s = hireBest(s, "server");
    s = allWeek(s);
    for (let k = 0; k < 2; k++) s = send(s, { type: "BUY_TABLE" });
    return s;
  },
  // A full crew for the inspector's nights: a second chef and server if there's only one, everyone on all week.
  inspector: (g) => {
    let s = g;
    if (have(s, "chef") < 2) s = hireBest(s, "chef", "skill");
    if (have(s, "server") < 2) s = hireBest(s, "server", "skill");
    return allWeek(s);
  },
  // Rehire a chef and a server, everyone on all week.
  walkout: (g) => allWeek(hireBest(hireBest(g, "server"), "chef")),
  // Prices back to the menu's suggested level, and a crew that keeps the stars up with the room full.
  rival: (g) => {
    let s = priceAll(g, (_p, sp) => sp);
    if (have(s, "chef") < 2) s = hireBest(s, "chef", "skill");
    if (have(s, "server") < 2) s = hireBest(s, "server", "skill");
    return allWeek(s);
  },
  // The weekend rota put back, a second chef and server if there's only one, two more tables.
  festival: (g) => {
    let s = g;
    if (have(s, "chef") < 2) s = hireBest(s, "chef");
    if (have(s, "server") < 2) s = hireBest(s, "server");
    s = allWeek(s);
    for (let k = 0; k < 2; k++) s = send(s, { type: "BUY_TABLE" });
    return s;
  },
};

export function bestEffort(b: Built): { score: Score; met: boolean; knobs: string } {
  const t = templateOf(b.meta.challenge!);
  let best: { score: Score; met: boolean; knobs: string } | null = null;
  let met = false;
  for (const fix of ["fix", "as-is", "fresh"] as const) for (const name of ["balanced", "typical"] as const) {
    const g0 = fix === "fix" ? FIXES[t]!(b.game) : fix === "fresh" ? freshTeam(b.game) : b.game;
    const score = scoreOf(days(g0, strat(name)), b.meta.challenge!);
    if (score.goal.met) met = true;
    if (!best || score.total > best.score.total) best = { score, met: score.goal.met, knobs: `${fix} ${name}` };
  }
  return { ...best!, met };
}

/** The district's best-liked library main that isn't on the menu goes back on at its suggested price. */
function readdBest(g: GameState): GameState {
  const mix = careerContent.districts.find((x) => x.id === g.districtId)!.segmentMix;
  const w = (d: (typeof careerContent.dishes)[number]) => Object.entries(mix).reduce((a, [s, k]) => a + k * (d.baseAppeal[s] ?? 0), 0);
  const off = careerContent.dishes.filter((d) => d.course === "main" && !g.menu.some((m) => m.dishId === d.id)).sort((x, y) => w(y) - w(x));
  const top = off[0];
  return top ? send(g, { type: "ADD_MENU_ITEM", dishId: top.id, price: top.suggestedPrice }) : g;
}

/** Degenerate play that must never pay. */
export const DEGENERATE: Record<string, Player> = {
  /** Every price at the Menu stepper's £200, then the typical owner. */
  priceCap: (b) => days(priceAll(b.game, () => 20_000), strat("typical")),
  /** Every price ×3. */
  price3: (b) => days(priceAll(b.game, (p) => Math.min(20_000, p * 3)), strat("typical")),
  /** The typical owner who never orders stock. */
  neverRestock: (b) => days(b.game, noRestockDay),
  /** Fire everyone and run it alone (the owner covers every job). */
  fireAll: (b) => days(fireAll(b.game), keepNobodyDay),
  /** Shut all five days. */
  closeAll: (b) => days(b.game, closeDay),
  /** Fire everyone, take the bank's starter loan, stay shut. */
  loanClose: (b) => days(send(fireAll(b.game), { type: "STARTER_LOAN" }), closeDay),
  /** Fire everyone, take the loan (if the bank would lend), run it alone. */
  loanAlone: (b) => days(send(fireAll(b.game), { type: "STARTER_LOAN" }), keepNobodyDay),
};
