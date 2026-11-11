/**
 * Round 13 (D): the chapter card's "Regular of the month" — whoever's story moved on most in the chapter's 30 days
 * (lib/regulars.ts regularOfMonth), with their face and what happened. Lazy (it needs the voices data); renders
 * nothing when nobody's story moved that month.
 */
import { useMemo } from "react";
import type { GameState } from "@full-plate/sim-core";
import { fill } from "../lib/voiceKit";
import { lines, regularOfMonth, regularsOf, storyOf } from "../lib/regulars";
import type { VoicesMemo } from "../state/paths";
import { Avatar } from "./Avatar";
import { regularFace } from "./RegularsBook";

export function RegularOfMonth({ game, from, to, memo }: { game: GameState; from: number; to: number; memo?: VoicesMemo | undefined }) {
  const pick = useMemo(() => {
    const top = regularOfMonth(regularsOf(game, memo), from, to);
    if (!top) return null;
    const latest = storyOf(game, top.s).filter((b) => b.day >= from && b.day <= to).at(-1);
    return { top, latest };
  }, [game.seed, game.history.length, from, to, memo?.day]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pick) return null;
  const { s, beats } = pick.top;
  return (
    <div className="chapter__regular" data-testid="regular-of-month">
      <Avatar spec={regularFace(s.def)} size={48} />
      <div>
        <b>{fill(lines().ofTheMonth, { name: s.def.name })}</b>
        <div className="xs muted">{s.def.job} · {beats === 1 ? "one moment" : `${beats} moments`} this month</div>
        {pick.latest && <div className="small">{pick.latest.text}</div>}
      </div>
    </div>
  );
}
