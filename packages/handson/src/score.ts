/** Shift scoring, the end-of-shift summary and one-line coaching tips. */
import { formatPence } from "@full-plate/sim-core";
import type { HandsOnRole, HandsOnScore, HandsOnSession } from "./types";

export function emptyScore(): HandsOnScore {
  return {
    plates: 0, qualitySum: 0, speedBonus: 0, speedCount: 0, served: 0, cleared: 0, payments: 0, drops: 0, dropCost: 0,
    chopHits: 0, chopMarks: 0, overcooked: 0, undercooked: 0, perfect: 0, pours: 0, pourSum: 0, tillWait: 0, points: 0,
  };
}

export function addPoints(score: HandsOnScore, pts: number) {
  score.points = Math.max(0, Math.round(score.points + pts));
}

export interface ShiftSummary {
  role: HandsOnRole;
  points: number;
  /** 1-3 stars on the score screen. */
  stars: 0 | 1 | 2 | 3;
  plates: number;
  meanQuality: number;     // 0-100, execution
  speedPct: number;        // 0-100 mean speed bonus
  served: number;
  cleared: number;
  payments: number;
  drops: number;
  dropCost: number;
  /** [round 4] Station tickets the sous chef covered, and plates that waited past COLD_PLATE_SECS. */
  covered?: number;
  slowPlates?: number;
  lines: { label: string; value: string }[];
  tip: string;
  /** [round 4] Three one-line notes for the score card, best first, then (at most) one thing to work on. */
  notes?: ShiftNote[];
  /** [round 7] Points the next star needs (absent at three stars), for the score card's "what to try next". */
  nextStarAt?: number;
}

export interface ShiftNote { text: string; tone: "good" | "work" }

/** Points that earn 1/2/3 stars in a 3-minute shift, per role (tuned on the demo fixture; see HANDSON-NOTES). */
const STAR_BARS: Record<HandsOnRole, [number, number, number]> = {
  chef: [250, 650, 1150],
  server: [200, 550, 1000],
  bar: [200, 550, 1000],
};
/**
 * Round 4: a career station's bars by level. A commis station is one section of the menu at a child's pace: a
 * half-speed bot (7–8 plates) lands ★★, a quick one (13–17) ★★★.
 */
const STATION_STAR_BARS: readonly [number, number, number][] = [[150, 380, 750], [200, 500, 950]];

export function starBars(session: HandsOnSession): [number, number, number] {
  const st = session.opts.station;
  return (st && STATION_STAR_BARS[st.level]) || STAR_BARS[session.role];
}

export function summarise(session: HandsOnSession): ShiftSummary {
  const s = session.score;
  const meanQuality = s.plates ? s.qualitySum / s.plates : 0;
  const speedPct = s.speedCount ? (s.speedBonus / s.speedCount) * 100 : 0;
  const bars = starBars(session);
  const stars = (s.points >= bars[2] ? 3 : s.points >= bars[1] ? 2 : s.points >= bars[0] ? 1 : 0) as 0 | 1 | 2 | 3;
  const money = (p: number) => formatPence(p);
  const lines: { label: string; value: string }[] = [];
  if (session.role === "chef") {
    lines.push({ label: "Plates cooked", value: String(s.plates) });
    lines.push({ label: "Mean quality", value: s.plates ? `${Math.round(meanQuality)}%` : "—" });
    lines.push({ label: "Speed bonus", value: s.speedCount ? `${Math.round(speedPct)}%` : "—" });
    lines.push({ label: "Perfect cooks", value: `${s.perfect}` });
    // Round 5 review: "Sent out by the sous chef 10" beside "Plates cooked 7" read as her failing. Most of those are the
    // team covering a busy commis (teamwork); only the ones while she'd walked away are hers to work on.
    if (session.opts.station) {
      const away = s.idleCovers ?? 0;
      const busy = Math.max(0, (s.covered ?? 0) - away);
      lines.push({ label: "Sous chef helped", value: away ? `${busy} while you were busy, ${away} while you were away` : `${busy} while you were busy` });
    }
  } else {
    lines.push({ label: "Plates served", value: String(s.served) });
    if (session.role === "bar") lines.push({ label: "Drinks poured", value: `${s.pours}${s.pours ? ` (${Math.round((s.pourSum / s.pours) * 100)}%)` : ""}` });
    lines.push({ label: "Speed bonus", value: s.speedCount ? `${Math.round(speedPct)}%` : "—" });
    lines.push({ label: "Tables reset", value: String(s.cleared) });
    lines.push({ label: "Payments taken", value: String(s.payments) });
  }
  lines.push({ label: "Drops", value: s.drops ? `${s.drops} (${money(s.dropCost)})` : "none" });
  return {
    role: session.role, points: s.points, stars, plates: s.plates, meanQuality: Math.round(meanQuality), speedPct: Math.round(speedPct),
    served: s.served, cleared: s.cleared, payments: s.payments, drops: s.drops, dropCost: s.dropCost,
    covered: s.covered ?? 0, slowPlates: s.slowPlates ?? 0, lines, tip: coachingTip(session), notes: shiftNotes(session),
    ...(stars < 3 ? { nextStarAt: bars[stars as 0 | 1 | 2] } : {}),
  };
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const count = (n: number) => WORDS[n] ?? String(n);
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

/**
 * Three short notes a 10-year-old can read at a glance ("Fast on the pass!", "Two plates went cold"): up to two
 * things that went well, then the one thing most worth working on (or a third good thing on a clean shift).
 */
export function shiftNotes(session: HandsOnSession): ShiftNote[] {
  const s = session.score;
  const good: string[] = [];
  const work: string[] = [];
  const speed = s.speedCount ? s.speedBonus / s.speedCount : 0;
  if (session.role === "chef") {
    const q = s.plates ? s.qualitySum / s.plates : 0;
    if (s.plates === 0) return [
      { text: "Every chef starts somewhere!", tone: "good" },
      { text: "Grab a ticket from the fridge to begin", tone: "work" },
      { text: s.covered ? `The sous chef covered ${count(s.covered).toLowerCase()} for you` : "Your station is waiting", tone: "work" },
    ];
    if (speed >= 0.7) good.push("Fast on the pass!");
    if (q >= 85) good.push(`Beautiful plates — ${Math.round(q)}% quality!`);
    if (s.perfect >= 3 && s.perfect >= s.plates / 2) good.push(`${plural(s.perfect, "perfect cook", "perfect cooks")}!`);
    if (s.plates >= 10) good.push(`${s.plates} plates — what a busy shift!`);
    else good.push(`${plural(s.plates, "plate", "plates")} out of your kitchen`);
    if (!s.drops) good.push("Steady hands: nothing dropped");
    if (q >= 60 && q < 85) good.push(`Tasty plates — ${Math.round(q)}% quality`);
    if (s.perfect >= 1 && !(s.perfect >= 3 && s.perfect >= s.plates / 2)) good.push(`${plural(s.perfect, "perfect cook", "perfect cooks")}!`);
    if (s.slowPlates) work.push(`${plural(s.slowPlates, "plate", "plates")} went cold`);
    // Round 5: the sim's sous chef sends what a busy commis can't reach in time — that's teamwork, not a mistake. Only
    // tickets covered while the player had wandered off are worth working on.
    if (s.idleCovers) work.push(`The sous chef covered ${plural(s.idleCovers, "ticket", "tickets").toLowerCase()} while you were away`);
    if (s.drops) work.push(`${plural(s.drops, "dish", "dishes")} hit the bin`);
    if (s.overcooked > s.perfect) work.push("A few cooks went past the green");
    if (speed < 0.5) work.push("Tickets waited a bit long");
  } else {
    if (speed >= 0.7) good.push("Hot and fast!");
    if (s.served) good.push(`${plural(s.served, "plate", "plates")} served`);
    if (s.payments) good.push(`${plural(s.payments, "table", "tables")} paid up`);
    if (s.cleared) good.push(`${plural(s.cleared, "table", "tables")} reset`);
    if (session.role === "bar" && s.pours && s.pourSum / s.pours >= 0.9) good.push("Perfect pours!");
    if (!s.drops && s.served) good.push("Nothing dropped");
    if (s.tillWait > 25) work.push("Guests waited at the till");
    if (s.drops) work.push(`${plural(s.drops, "drop", "drops")} — slow down near walls`);
    if (speed < 0.5 && s.speedCount) work.push("Food cooled on the pass");
    if (!good.length) good.push("Every shift is practice!");
  }
  if (session.role !== "chef" && good.length < 3 && !work.length) good.push("The guests went home happy");
  const used = Math.min(good.length, work.length ? 2 : 3);
  const notes: ShiftNote[] = good.slice(0, used).map((text) => ({ text, tone: "good" as const }));
  if (work[0]) notes.push({ text: work[0], tone: "work" });
  for (const text of good.slice(used)) if (notes.length < 3) notes.push({ text, tone: "good" });
  for (const text of work.slice(1)) if (notes.length < 3) notes.push({ text, tone: "work" });
  const chef = session.role === "chef";
  if (notes.length < 3) notes.push({ text: chef ? "Every shift makes you a better chef" : "Every shift makes you a better host", tone: "good" });
  if (notes.length < 3) notes.push({ text: chef ? "Try for every cook in the green next time" : "Try carrying two plates at once next time", tone: "work" });
  return notes.slice(0, 3);
}

/** The single most useful thing to try next shift. Ordered by how much it would have helped. */
export function coachingTip(session: HandsOnSession): string {
  const s = session.score;
  const role = session.role;
  if (s.drops >= 2) return role === "chef"
    ? "Plan before you grab: binning a dish costs the food. Finish one ticket before starting the next."
    : "Slow down near tables and walls when you're carrying a stack — bumps make plates wobble.";
  if (role === "chef") {
    if (s.plates === 0) return "Start at the fridge: grab the oldest ticket, chop it on the board, cook it, then plate at the pass.";
    if (s.chopMarks && s.chopHits / s.chopMarks < 0.6) return "Chopping: tap E as the slider crosses each knife mark — rhythm beats speed.";
    if (s.overcooked > s.perfect && s.overcooked >= s.undercooked) return "Let go of E as soon as the needle reaches the green — overdone plates lose quality.";
    if (s.undercooked > s.perfect) return "Hold E a touch longer: wait for the needle to get into the green band before you let go.";
    if (s.speedCount && s.speedBonus / s.speedCount < 0.6) return "Tickets are waiting too long. Work the rail left to right — the oldest ticket first.";
    return "Lovely work. Next time, try for every cook in the green: perfect plates score the most.";
  }
  if (s.served === 0 && s.cleared === 0 && s.payments === 0) return "Plates appear on the pass under the heat lamps — pick them up and carry them to the table number on the ticket.";
  if (s.tillWait > 25) return "Guests were waiting at the till. Check for the gold £ table and take payment between runs.";
  if (role === "bar" && s.pours && s.pourSum / s.pours < 0.8) return "Pouring: let go of E right on the dashed line — a bit short or too full both cost quality.";
  if (s.speedCount && s.speedBonus / s.speedCount < 0.6) return "Food is cooling on the pass. Carry up to three plates at once if they're for nearby tables.";
  if (s.cleared < Math.max(1, Math.floor(s.served / 3))) return "Reset dirty tables quickly — a clean table is how the next party gets seated.";
  return "Great shift! Try stacking plates for the same table so you serve them all in one trip.";
}
