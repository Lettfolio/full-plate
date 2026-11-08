/** Shift scoring, the end-of-shift summary and one-line coaching tips. */
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
  lines: { label: string; value: string }[];
  tip: string;
}

/** Points that earn 1/2/3 stars in a 3-minute shift, per role (tuned on the demo fixture; see HANDSON-NOTES). */
const STAR_BARS: Record<HandsOnRole, [number, number, number]> = {
  chef: [150, 400, 700],
  server: [200, 500, 850],
  bar: [150, 400, 700],
};

export function summarise(session: HandsOnSession): ShiftSummary {
  const s = session.score;
  const meanQuality = s.plates ? s.qualitySum / s.plates : 0;
  const speedPct = s.speedCount ? (s.speedBonus / s.speedCount) * 100 : 0;
  const bars = STAR_BARS[session.role];
  const stars = (s.points >= bars[2] ? 3 : s.points >= bars[1] ? 2 : s.points >= bars[0] ? 1 : 0) as 0 | 1 | 2 | 3;
  const money = (p: number) => `£${(p / 100).toFixed(2)}`;
  const lines: { label: string; value: string }[] = [];
  if (session.role === "chef") {
    lines.push({ label: "Plates cooked", value: String(s.plates) });
    lines.push({ label: "Mean quality", value: s.plates ? `${Math.round(meanQuality)}%` : "—" });
    lines.push({ label: "Speed bonus", value: s.speedCount ? `${Math.round(speedPct)}%` : "—" });
    lines.push({ label: "Perfect cooks", value: `${s.perfect}` });
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
    served: s.served, cleared: s.cleared, payments: s.payments, drops: s.drops, dropCost: s.dropCost, lines, tip: coachingTip(session),
  };
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
