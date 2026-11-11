/**
 * Round 12 (E): the chef across the road, on the Restaurant tab — who they are, the weekly "who's winning on reviews"
 * line, their last few posts and (once earned) the framed clipping. Beside it, the Regulars book's button. A lazy chunk
 * (RestaurantTab is lazy); the numbers are lib/rival.ts.
 */
import { lazy, Suspense, useMemo, useState } from "react";
import { avatarFor, type AvatarSpec, type GameState } from "@full-plate/sim-core";
import { clipFrom, feed, rivalFor, weekScores, winningLine, winStreak, CLIPPING_WEEKS } from "../lib/rival";
import type { VoicesMemo } from "../state/paths";
import { regularsOf } from "../lib/regulars";
import { fill, voices } from "../lib/voiceKit";
import { Avatar } from "./Avatar";
import { Panel } from "./Panel";
import { Term } from "./Term";
import "./voices.css";

const RegularsBook = lazy(() => import("./RegularsBook").then((m) => ({ default: m.RegularsBook })));

export function rivalFace(id: string, name: string): AvatarSpec {
  return avatarFor({ id, name, role: "chef" });
}

export function RivalCard({ game, memo }: { game: GameState; memo?: VoicesMemo | undefined }) {
  const v = useMemo(() => {
    const rival = rivalFor(game.seed, game.districtId);
    const weeks = weekScores(game);
    return { rival, weeks, posts: feed(game, rival, game.day, 3), clip: clipFrom(memo, game.seed, weeks), streak: winStreak(weeks) };
  }, [game.seed, game.districtId, game.day, game.history.length, memo?.clip]); // eslint-disable-line react-hooks/exhaustive-deps
  const { rival, weeks, posts, clip, streak } = v;
  const earned = clip !== undefined && clip <= game.day;
  const item = voices.rival.clippingItem;
  return (
    <Panel title="Across the road" sub={rival.personality.label} className="rival" icon="restaurant">
      <div className="rival__who">
        <Avatar spec={rivalFace(rival.id, rival.name)} size={64} />
        <div>
          <div className="rival__name">{rival.name}, {rival.place}</div>
          <div className="small muted">{rival.personality.bio}</div>
        </div>
      </div>
      <div className="rival__score" data-testid="rival-score">
        <b>{winningLine(rival, weeks)}</b>
        {streak > 0 && !earned && <span className="small">You've won {streak} week{streak === 1 ? "" : "s"} running ({CLIPPING_WEEKS} gets you in the paper).</span>}
      </div>
      {earned && (
        <div className="clipping" data-testid="clipping">
          <span className="clipping__frame" aria-hidden="true">🖼️</span>
          <div><b>{item.name}</b><div className="small">{fill(item.caption, { restaurant: game.restaurantName, rivalPlace: rival.place, rivalFirst: rival.first })}</div></div>
        </div>
      )}
      <div>
        <h4 className="small" style={{ margin: "0 0 6px" }}>Their posts</h4>
        {posts.length === 0 ? <p className="small muted">Nothing yet. They're watching, though.</p> : (
          <ul className="rival__feed" data-testid="rival-feed">
            {posts.map((p) => <li key={p.day} className="rival__post"><b>{p.weekday} (day {p.day + 1})</b>{p.text}</li>)}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/** The Regulars book's card: who's a regular so far and the button that opens the book (its own lazy chunk). */
export function RegularsCard({ game, memo }: { game: GameState; memo?: VoicesMemo | undefined }) {
  const [open, setOpen] = useState(false);
  const regs = useMemo(() => regularsOf(game, memo), [game.seed, game.history.length, memo?.day]); // eslint-disable-line react-hooks/exhaustive-deps
  const joined = regs.filter((r) => r.joined !== undefined);
  const orders = joined.filter((r) => r.open).length;
  return (
    <Panel title="Regulars" sub={`${joined.length} of ${regs.length}`} icon="people">
      <p className="small">{joined.length === 0 ? "Nobody yet. Open for a night or two and faces start coming back." : <>{joined.map((r) => r.def.name.split(" ")[0]).join(", ")}. {orders > 0 && <>{orders} open <Term id="vip" inline>VIP</Term> order{orders === 1 ? "" : "s"}.</>}</>}</p>
      <button className="btn btn--tap" onClick={() => setOpen(true)} disabled={joined.length === 0}>Open the Regulars book</button>
      {open && <Suspense fallback={null}><RegularsBook game={game} memo={memo} onClose={() => setOpen(false)} /></Suspense>}
    </Panel>
  );
}
