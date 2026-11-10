/**
 * Round 12 (E): "Food Gossip" — this morning's line of local radio at the top of the planning screen, with "More" for
 * the last seven mornings. A lazy chunk (Planning mounts it with React.lazy); the line itself is lib/gossip.ts. No
 * motion and no sound: it is a line of text.
 */
import { useId, useMemo, useState } from "react";
import type { GameState } from "@full-plate/sim-core";
import type { PathMeta } from "../state/paths";
import { gossipFor, gossipWeek } from "../lib/gossip";
import { station } from "../lib/voiceKit";
import { WEEKDAYS, weekdayIndex } from "../lib/calendar";
import { Icon } from "./Icon";
import { TermText } from "./TermText";
import "./voices.css";

export function GossipTicker({ game, meta }: { game: GameState; meta?: PathMeta | undefined }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  // Keyed on the day and the history length: the line is fixed for the morning, whatever else changes on screen.
  const line = useMemo(() => gossipFor(game, game.day, meta), [game.seed, game.day, game.history.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const week = useMemo(() => (open ? gossipWeek(game, game.day, meta) : []), [open, game.seed, game.day, game.history.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const when = (day: number) => (day === game.day ? "This morning" : day === game.day - 1 ? "Yesterday" : `${WEEKDAYS[weekdayIndex(day)]} (day ${day + 1})`);
  return (
    <section className="gossip" aria-label="Food Gossip" data-testid="gossip">
      <span className="gossip__station"><Icon name="sound" size={18} />{station(game.districtId)} · Food Gossip</span>
      <p className="gossip__line" data-testid="gossip-line" data-kind={line.kind}><TermText text={line.text} /></p>
      <button className="btn btn--sm" aria-expanded={open} {...(open ? { "aria-controls": id } : {})} onClick={() => setOpen((o) => !o)}>{open ? "Less" : "More"}</button>
      {open && (
        <ol className="gossip__week" id={id} aria-label="The last seven mornings">
          {week.map((g) => <li key={g.day}><span className="gossip__when">{when(g.day)}</span><span><TermText text={g.text} /></span></li>)}
        </ol>
      )}
    </section>
  );
}
