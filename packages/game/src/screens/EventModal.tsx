import { useEffect, useRef } from "react";
import type { Command, EventChoiceDef, GameState } from "@full-plate/sim-core";
import { content } from "../sim";
import { formatPence } from "../lib/format";

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
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="event-title">
      <div className="modal">
        <div className="modal__banner">
          <span className="modal__stamp" aria-hidden="true">✉️</span>
          <div>
            <div className="modal__kicker">This morning's post</div>
            <h2 id="event-title">{ev.title}</h2>
          </div>
        </div>
        <div className="modal__body">
          <p>{ev.body}</p>
          <div className="choices">
            {ev.choices.map((c, i) => {
              const chips = effectChips(c.effects);
              return (
                <button key={c.id} ref={i === 0 ? first : undefined} className="choice" onClick={() => send({ type: "RESOLVE_EVENT", choiceId: c.id })}>
                  <span className="choice__label">{c.label}</span>
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
