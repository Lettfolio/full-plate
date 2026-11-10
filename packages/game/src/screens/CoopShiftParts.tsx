/**
 * Round 12 (G): the co-op pieces both sides share — the six-emote palette and the friend's last emote. No text box
 * anywhere: an emote is an id from a fixed list, drawn from that list.
 */
import { useEffect, useRef, useState } from "react";
import { EMOTE_GAP_MS, EMOTES, emoteOf, type Emote, type EmoteId } from "../lib/coop/protocol";

export function EmoteBar({ onSend, disabled }: { onSend: (id: EmoteId) => void; disabled?: boolean }) {
  const [wait, setWait] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <div className="emotes" role="group" aria-label="Send an emote">
      {EMOTES.map((e) => (
        <button key={e.id} type="button" className="emotes__btn" disabled={disabled || wait} aria-label={`Send “${e.label}”`} title={e.label}
          onClick={() => { onSend(e.id); setWait(true); t.current = setTimeout(() => setWait(false), EMOTE_GAP_MS); }}>
          <span aria-hidden="true">{e.glyph}</span>
        </button>
      ))}
    </div>
  );
}

/** The friend's newest emote for four seconds (appears and goes: no movement, so nothing to reduce). */
export function EmoteHeard({ from, emote }: { from: string; emote: Emote | null }) {
  const [shown, setShown] = useState<Emote | null>(null);
  const seen = useRef<number | null>(emote?.n ?? null);
  useEffect(() => {
    if (!emote || emote.n === seen.current) return;
    seen.current = emote.n;
    setShown(emote);
    const t = setTimeout(() => setShown(null), 4000);
    return () => clearTimeout(t);
  }, [emote]);
  const e = shown ? emoteOf(shown.id) : null;
  return (
    <p className="emoteheard" role="status" aria-live="polite">
      {e && <><span className="emoteheard__glyph" aria-hidden="true">{e.glyph}</span><span className="small"><b>{from}</b>: {e.label}</span></>}
    </p>
  );
}
