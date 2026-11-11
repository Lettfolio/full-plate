import { useEffect, useMemo, useState } from "react";
import type { GameState } from "@full-plate/sim-core";
import type { PathMeta } from "../state/paths";
import { Icon, type IconName } from "./Icon";
import { regularsOf } from "../lib/regulars";
import { postDays } from "../lib/rival";
import { link } from "../state/share";
import { dismissTry, noteTryShown, pickTry, tryKey, useTryState, type TryFacts, type TryId } from "../lib/tryNext";

/**
 * Round 14 (E, discoverability): the planning screen's "New thing to try" card (lib/tryNext.ts has the rules). Lazy
 * (Planning loads it with Suspense), one item at a time, a button that goes there and a cross that makes it go away
 * for good. No motion, no sound.
 */
const COPY: Record<TryId, { icon: IconName; title: string; body: string; go: string }> = {
  cook: { icon: "chefHat", title: "Run the kitchen yourself", body: "Open tonight and cook it with your own hands: you plate up, the team does the rest. Or tap Cook it yourself once service is on.", go: "Open and cook it myself" },
  brand: { icon: "paint", title: "Make it look like yours", body: "Pick a logo, two house colours and how the name is lettered. They show on the awning, the menu and your postcards.", go: "Open the brand kit" },
  invent: { icon: "chefHat", title: "Invent a dish", body: "Pick the ingredients, name it, set the price. Your own recipes go in your cookbook.", go: "Invent a dish" },
  challenge: { icon: "target", title: "Today's challenge", body: "The same restaurant for everyone today, five days to post a score. This game is saved and waits for you.", go: "Try today's challenge" },
  postcard: { icon: "restaurant", title: "Send a postcard", body: "A picture of your room with last night's numbers on it, to save or send.", go: "Make a postcard" },
  regulars: { icon: "people", title: "You've got a regular", body: "Someone keeps coming back. Their story, and the dish they'd love to see, are in the Regulars book.", go: "See your regulars" },
  rival: { icon: "restaurant", title: "Someone's watching", body: "The chef across the road has started posting about you. Have a look.", go: "See what they said" },
  share: { icon: "people", title: "Show a friend", body: "Share your restaurant with a code, or visit theirs.", go: "Share with a friend" },
};

export function TryCard({ game, meta, onGo }: { game: GameState; meta?: PathMeta | undefined; onGo: (id: TryId) => void }) {
  const s = useTryState();
  const [canShare, setCanShare] = useState(false);
  const due = game.day >= 4 && !s.off && !s.dismissed.includes("share");
  useEffect(() => {
    if (!due) return;
    let live = true;
    void link().then((l) => { if (live) setCanShare("db" in l); }).catch(() => {});
    return () => { live = false; };
  }, [due]);
  const facts: TryFacts = useMemo(() => ({
    day: game.day,
    activeDishes: game.menu.filter((m) => m.active).length,
    profitableNight: game.history.some((d) => !d.closed && d.profit > 0),
    regularJoined: game.day >= 1 && regularsOf(game, meta?.voices).some((r) => r.joined !== undefined && r.joined <= game.day),
    rivalPosted: game.day >= 1 && postDays(game, 0).some((d) => d >= 1 && d <= game.day),
    canShare,
  }), [game.day, game.history.length, game.menu, meta?.voices, canShare]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = tryKey(game);
  const { id } = pickTry(s, key, facts);
  useEffect(() => { if (id) noteTryShown(key, id); }, [id, key]);
  if (!id) return null;
  const c = COPY[id];
  return (
    <section className="trycard" aria-labelledby="trycard-t">
      <span className="trycard__icon" aria-hidden="true"><Icon name={c.icon} size={24} /></span>
      <div className="trycard__text">
        <span className="trycard__kicker">New thing to try</span>
        <h2 id="trycard-t" className="trycard__title">{c.title}</h2>
        <p className="trycard__body">{c.body}</p>
        <button className="btn btn--green btn--tap trycard__go" onClick={() => { dismissTry(id); onGo(id); }}>{c.go} →</button>
      </div>
      <button className="iconbtn iconbtn--tap trycard__x" aria-label={`No thanks: don't show “${c.title}” again`} onClick={() => dismissTry(id)}><Icon name="close" size={20} /></button>
    </section>
  );
}

export default TryCard;
