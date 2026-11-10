import { useEffect, useRef } from "react";
import type { Command, EventChoiceDef, GameState } from "@full-plate/sim-core";
import { content } from "../sim";
import { formatPence } from "../lib/format";
import { TermText } from "../components/TermText";

interface Props { game: GameState; send: (cmd: Command) => void }

function effectChips(fx: EventChoiceDef["effects"]): { text: string; tone: "up" | "down" }[] {
  const out: { text: string; tone: "up" | "down" }[] = [];
  if (fx.cash) out.push({ text: `${fx.cash > 0 ? "+" : ""}${formatPence(fx.cash, { whole: Math.abs(fx.cash) >= 10000 })}`, tone: fx.cash > 0 ? "up" : "down" });
  if (fx.popularity) out.push({ text: `${fx.popularity > 0 ? "+" : ""}${fx.popularity} popularity`, tone: fx.popularity > 0 ? "up" : "down" });
  if (fx.prestige) out.push({ text: `${fx.prestige > 0 ? "+" : ""}${fx.prestige} prestige`, tone: fx.prestige > 0 ? "up" : "down" });
  if (fx.staffMood) out.push({ text: `${fx.staffMood > 0 ? "+" : ""}${fx.staffMood} staff mood`, tone: fx.staffMood > 0 ? "up" : "down" });
  if (fx.footfallMultDays) {
    const p = Math.round((fx.footfallMultDays.mult - 1) * 100);
    out.push({ text: `${p >= 0 ? "+" : ""}${p}% people passing for ${fx.footfallMultDays.days} days`, tone: p >= 0 ? "up" : "down" });
  }
  return out;
}

export function EventModal({ game, send }: Props) {
  const ev = content.events.find((e) => e.id === game.activeEvent?.eventId);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, [ev?.id]);
  if (!ev) {
    return (
      <div className="modal-back" role="dialog" aria-modal="true" aria-label="Event">
        <div className="modal"><div className="modal__body"><p>Something happened, but we lost the letter.</p>
          <button className="btn" onClick={() => send({ type: "RESOLVE_EVENT", choiceId: "" })}>Carry on</button></div></div>
      </div>
    );
  }
  // Round 11 (U6): a choice that would take cash she doesn't have is greyed ("Can't afford"), as long as another is left.
  const short = (c: EventChoiceDef) => (c.effects.cash ?? 0) < 0 && game.cash + (c.effects.cash ?? 0) < 0;
  const blocked = new Set(ev.choices.every(short) ? [] : ev.choices.filter(short).map((c) => c.id));
  const firstOk = ev.choices.find((c) => !blocked.has(c.id))?.id;
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="event-title">
      <div className="modal">
        <div className="modal__banner">
          <span className="modal__stamp" aria-hidden="true">✉️</span>
          <div>
            <div className="modal__kicker">This morning's post</div>
            <h2 id="event-title"><TermText text={ev.title} /></h2>
          </div>
        </div>
        <div className="modal__body">
          <p><TermText text={ev.body} /></p>
          <div className="choices">
            {ev.choices.map((c) => {
              const chips = effectChips(c.effects);
              const cant = blocked.has(c.id);
              return (
                <button key={c.id} ref={c.id === firstOk ? first : undefined} className={`choice ${cant ? "choice--cant" : ""}`} disabled={cant} onClick={() => send({ type: "RESOLVE_EVENT", choiceId: c.id })}>
                  <span className="choice__label"><TermText text={c.label} inButton />{cant && <span className="choice__cant"> · Can't afford</span>}</span>
                  <span className="choice__fx">
                    {chips.length ? chips.map((x) => <span key={x.text} className={`fx fx--${x.tone}`}><span aria-hidden="true">{x.tone === "up" ? "▲ " : "▼ "}</span>{x.text}</span>) : <span className="fx fx--none">nothing changes</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
