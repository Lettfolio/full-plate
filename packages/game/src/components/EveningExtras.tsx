/**
 * Round 12 (E): what the Evening adds once the doors close — the food blogger's review on her visit nights, the
 * regulars whose story moved on tonight (or who came for the first time), the framed clipping on the night it's earned,
 * and "Tomorrow on the radio": the gossip line tomorrow morning will open with. Evening.tsx mounts it (one slot,
 * React.lazy); everything here is worked out from the night's real results (lib/*).
 */
import { useMemo } from "react";
import type { DayResult, GameState } from "@full-plate/sim-core";
import type { PathMeta } from "../state/paths";
import { gossipFor } from "../lib/gossip";
import { reviewOn, blogger } from "../lib/blogger";
import { regularsOf, storyOf, thanksNote } from "../lib/regulars";
import { clipFrom, rivalFor, weekScores } from "../lib/rival";
import { station, withResult } from "../lib/voiceKit";
import { Avatar } from "./Avatar";
import { Panel } from "./Panel";
import { Stars } from "./Stars";
import { Term } from "./Term";
import { TermText } from "./TermText";
import { regularFace } from "./RegularsBook";
import "./voices.css";

export function EveningExtras({ game, result, meta }: { game: GameState; result: DayResult; meta?: PathMeta | undefined }) {
  const v = useMemo(() => {
    const g = withResult(game, result);
    const day = result.day;
    const regs = regularsOf(g, meta?.voices);
    const tonight = regs.flatMap((s) => storyOf(g, s).filter((b) => b.day === day).map((b) => ({ s, b, thanks: thanksNote(g, s)?.day === day ? thanksNote(g, s)!.text : undefined })));
    const clip = clipFrom(meta?.voices, g.seed, weekScores(g)) === day + 1;
    return { g, review: reviewOn(g, day), tonight, clip, tomorrow: gossipFor(g, day + 1, meta), rival: clip ? rivalFor(g.seed, g.districtId) : undefined };
  }, [game.seed, result.day, game.history.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const b = blogger();
  return (
    <>
      {v.review && (
        <Panel title={b.blog} sub={`${b.name} · ${b.tagline}`} icon="clipboard" className="blogpost">
          <div data-testid="blogger-review">
            {v.review.closed ? <p className="blogpost__text">{v.review.text}</p> : (
              <>
                <p className="blogpost__head">“{v.review.headline}”</p>
                <div className="blogpost__by"><Stars rating={v.review.rating} size={16} /><span className="small muted">{v.review.rating} out of 5, posted tonight</span></div>
                <p className="blogpost__text">{v.review.text}</p>
                <p className="blogpost__sign small muted">{v.review.signoff}</p>
              </>
            )}
          </div>
        </Panel>
      )}
      {v.tonight.length > 0 && (
        <Panel title="Your regulars tonight" sub={`${v.tonight.length} stor${v.tonight.length === 1 ? "y" : "ies"}`} icon="people">
          <ul className="beatlist" data-testid="regulars-tonight">
            {v.tonight.map(({ s, b: beat, thanks }) => (
              <li key={s.def.id} className="beatlist__row">
                <Avatar spec={regularFace(s.def)} size={48} />
                <div>
                  <b>{s.def.name}</b> <span className="xs muted">{beat.beat === 0 ? "a new regular" : beat.good ? <>a <Term id="vip" inline>VIP</Term> order met{beat.photo ? ` · photo for the book: ${beat.photo.emoji}` : ""}</> : beat.lapsed ? "went elsewhere tonight" : "it didn't quite go to plan"}</span>
                  <div className="small">{beat.text}</div>
                  {thanks && <p className="thanksnote" data-testid="thanks-note"><span className="xs muted">A note left on the table:</span> “{thanks}” <span className="small">— {s.def.name.split(" ")[0]}</span></p>}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {v.clip && v.rival && (
        <div className="clipping" data-testid="clipping-earned">
          <span className="clipping__frame" aria-hidden="true">🖼️</span>
          <div><b>Three weeks running ahead of {v.rival.place}.</b><div className="small">The Gazette wants a photo. A framed clipping goes on your Restaurant tab.</div></div>
        </div>
      )}
      <Panel title={`Tomorrow on ${station(v.g.districtId)}`} sub="Food Gossip" icon="sound">
        <p className="voicecard__line" data-testid="gossip-tomorrow"><TermText text={v.tomorrow.text} /></p>
      </Panel>
    </>
  );
}
