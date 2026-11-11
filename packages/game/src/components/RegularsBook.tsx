/**
 * Round 12 (E): the Regulars book — a sheet from the Restaurant tab. Each regular so far: their face, job and favourite
 * dish, their story (intro, then each beat, good or bad branch), the photos they've left, and the open VIP order with
 * whether that dish is on today's menu. Its own lazy chunk; the story is lib/regulars.ts.
 */
import { useMemo } from "react";
import { avatarFor, type AvatarSpec, type GameState } from "@full-plate/sim-core";
import type { RegularDef } from "@full-plate/content/voices";
import { lines, orderText, regularsOf, storyOf, thanksNote, type RegularState } from "../lib/regulars";
import type { VoicesMemo } from "../state/paths";
import { dishLabel, fill, weekdayName } from "../lib/voiceKit";
import { WEEKDAY_NAMES } from "../lib/calendar";
import { Avatar } from "./Avatar";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { Term } from "./Term";
import "./voices.css";

/** A regular's face: sim-core's portrait rule on their id, in their own clothes (no hat, no apron). */
export function regularFace(def: RegularDef): AvatarSpec {
  const { apron: _a, trim: _t, ...base } = avatarFor({ id: `regular-${def.id}`, name: def.name, role: "manager" });
  return { ...base, hat: "none", body: def.colour, shirt: false };
}

function Person({ game, s }: { game: GameState; s: RegularState }) {
  const story = storyOf(game, s);
  const order = orderText(game, s);
  const onMenu = s.open ? game.menu.some((m) => m.active && m.dishId === s.open!.dishId) : false;
  const L = lines();
  const dish = dishLabel(s.open?.dishId);
  return (
    <li className="regbook__person" data-testid={`regular-${s.def.id}`}>
      <Avatar spec={regularFace(s.def)} size={72} />
      <div>
        <div className="regbook__name">{s.def.name}</div>
        <div className="small muted">{s.def.job} · usually has the {dishLabel(s.def.favourite)}</div>
        <ol className="regbook__story" aria-label={`${s.def.name}'s story so far`}>
          {story.map((b) => (
            <li key={`${b.beat}-${b.day}`} className={b.good ? "" : "is-bad"}>
              <span className="xs muted">{weekdayName(b.day)}, day {b.day + 1}: </span>{b.text}
            </li>
          ))}
        </ol>
        {order ? (
          <div className={`regbook__order ${onMenu ? "is-ready" : ""}`} data-testid="vip-order">
            <b><Term id="vip" inline>VIP</Term> order: </b>{order}
            <div className="xs">
              {fill(onMenu ? L.onMenu : L.notOnMenu, { dish })} {fill(L.waiting, { dish, weekday: WEEKDAY_NAMES[s.open!.weekday] })}
              {s.open!.triedDay !== undefined && <> {fill(L.tryAgain, { weekday: WEEKDAY_NAMES[s.open!.weekday] })}</>}
            </div>
          </div>
        ) : <p className="small"><Icon name="check" size={16} /> {L.finished}</p>}
        {thanksNote(game, s) && <p className="thanksnote" data-testid="book-thanks"><span className="xs muted">The note they left:</span> “{thanksNote(game, s)!.text}”</p>}
        {story.some((b) => b.photo) && (
          <div className="regbook__photos" aria-label="Photos">
            {story.filter((b) => b.photo).map((b) => (
              <figure key={b.beat} className="polaroid" data-testid="photo">
                <div className="polaroid__pic" aria-hidden="true">{b.photo!.emoji}</div>
                <figcaption className="polaroid__cap">{b.photo!.caption}</figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

export function RegularsBook({ game, memo, onClose }: { game: GameState; memo?: VoicesMemo | undefined; onClose: () => void }) {
  const regs = useMemo(() => regularsOf(game, memo), [game.seed, game.history.length, memo?.day]); // eslint-disable-line react-hooks/exhaustive-deps
  const joined = regs.filter((r) => r.joined !== undefined).sort((a, b) => a.joined! - b.joined!);
  const toCome = regs.length - joined.length;
  return (
    <Dialog title="The Regulars book" kicker={game.restaurantName} stamp={<Icon name="people" size={28} />} onClose={onClose} wide className="regbook__sheet">
      <div className="regbook">
        <p className="small">People who keep coming back. Meet a <Term id="vip" inline>VIP</Term> order (their dish on the menu that day, and a night of 3.5★ or better) and their story moves on, with a photo for the book.</p>
        <ul className="regbook" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {joined.map((s) => <Person key={s.def.id} game={game} s={s} />)}
        </ul>
        {toCome > 0 && <p className="regbook__soon">{toCome} more face{toCome === 1 ? "" : "s"} to come. New regulars turn up as stories finish.</p>}
      </div>
    </Dialog>
  );
}
