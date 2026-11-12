/**
 * Round 12 (G): "Visit a friend" from the title (lazy). One code box and a nickname: the code opens either a shared
 * restaurant (VisitRoom) or a co-op day the friend is hosting (CoopShiftGuest). No list, no search: no code, no visit.
 */
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { expired } from "../lib/coop/protocol";
import { findHost, guestJoin, sweepCoop, type DocWriter } from "../lib/coop/session";
import type { GuestDoc, HostDoc } from "../lib/coop/protocol";
import { known } from "../lib/visit";
import { cleanNick, link, NICK_MAX, nickInput, offLine, openShare, parseCode, type Link, type SDb, type ShareSnapshot } from "../state/share";
import { CoopShiftGuest } from "./CoopShiftGuest";
import { VisitRoom } from "./VisitRoom";
import "./visit.css";
import { prefsStorage } from "../lib/storage";

type View =
  | { at: "form" }
  | { at: "visit"; db: SDb; uid: string; code: string; snap: ShareSnapshot; mine: boolean }
  | { at: "coop"; db: SDb; uid: string; hostId: string; code: string; host: HostDoc; writer: DocWriter<GuestDoc> };

const NICK_KEY = "full-plate:nick:v1";
const savedNick = (): string => { try { return cleanNick(prefsStorage().getItem(NICK_KEY) ?? ""); } catch { return ""; } };

export function VisitFriend({ onBack }: { onBack: () => void }) {
  const [conn, setConn] = useState<Link | null>(null);
  const [code, setCode] = useState("");
  const [nick, setNick] = useState(savedNick);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [view, setView] = useState<View>({ at: "form" });
  // Round 14 (B): finished co-op sessions of mine are swept (their documents deleted) whenever I come here
  useEffect(() => { void link().then((l) => { setConn(l); if (!("off" in l)) void sweepCoop(l).catch(() => {}); }); }, []);

  const go = async () => {
    if (!conn || "off" in conn) return;
    const c = parseCode(code);
    if (!c) { setNote("A code is 10 letters and numbers, like ABCDE-23456."); return; }
    const n = cleanNick(nick);
    try { prefsStorage().setItem(NICK_KEY, n); } catch { /* fine */ }
    setBusy(true); setNote(null);
    try {
      const [found, shared] = await Promise.all([findHost(conn.db, c, known.dish), openShare(conn, c, known)]);
      const h = found?.host ?? null;
      if (h && h.stage !== "ended" && !expired(h)) {
        if (!n) { setNote("Pick a nickname first: your friend sees it."); setBusy(false); return; }
        const j = await guestJoin(conn, c, n, known.dish);
        if (j.ok) { setView({ at: "coop", db: conn.db, uid: conn.uid, hostId: j.hostId, code: c, host: j.host, writer: j.writer }); return; }
        setNote(j.why === "error" ? "Couldn't join: your friend's link may only let you look (ask them for Contributor access)."
          : j.why === "taken" ? "Someone else has already joined that co-op day. Ask your friend for a new code."
          : j.why === "own" ? "That's your own co-op day: give the code to a friend."
          : "That co-op day has finished. Ask for a new code.");
      } else if (h) {
        setNote(h.stage === "ended" ? "That co-op day has finished. Ask for a new code." : "That co-op code is over two hours old. Ask for a new one.");
      } else if ("snap" in shared) {
        setView({ at: "visit", db: conn.db, uid: conn.uid, code: c, snap: shared.snap, mine: shared.mine });
        return;
      } else if (shared.muddled) {
        setNote("That code is muddled up with another one. Ask your friend to stop sharing and share again for a new code.");
      } else {
        setNote("Nothing is shared under that code. Check it with your friend: it may have been stopped.");
      }
    } catch { setNote("Couldn't reach the shared space just now. Try again in a moment."); }
    setBusy(false);
  };

  if (view.at === "visit") return <VisitRoom db={view.db} uid={view.uid} code={view.code} snap={view.snap} mine={view.mine} nick={cleanNick(nick)} onExit={onBack} />;
  if (view.at === "coop") return <CoopShiftGuest db={view.db} uid={view.uid} hostId={view.hostId} code={view.code} first={view.host} writer={view.writer} onExit={onBack} />;

  const off = conn ? offLine(conn) : null;
  return (
    <div className="page visitfriend">
      <div className="card stack visitfriend__card">
        <div className="row">
          <h2 className="spacer">Visit a friend</h2>
          <button className="btn btn--ghost btn--tap" onClick={onBack}><Icon name="back" size={20} />Back</button>
        </div>
        <p className="small muted">Type the code your friend gave you: it opens their restaurant to look round, or the co-op day they're hosting.</p>
        {off ? <p className="callout small">{off}</p> : (
          <form className="stack stack--sm" onSubmit={(e) => { e.preventDefault(); void go(); }}>
            <label className="field">
              <span className="field__label">Friend's code</span>
              <input className="input visitfriend__code" value={code} maxLength={14} autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="ABCDE-23456" onChange={(e) => setCode(e.target.value.toUpperCase())} />
            </label>
            <label className="field">
              <span className="field__label">Your nickname <span className="muted">(letters and numbers, up to {NICK_MAX})</span></span>
              <input className="input" value={nick} maxLength={NICK_MAX} autoComplete="off" placeholder="e.g. Sam" onChange={(e) => setNick(nickInput(e.target.value))} />
            </label>
            <button className="btn btn--primary btn--tap" type="submit" disabled={!conn || busy || !code.trim()}>{busy ? "Looking…" : "Go"}</button>
          </form>
        )}
        {note && <p className="small callout callout--warn" role="alert">{note}</p>}
        <p className="small muted">No chat, no strangers: only people you give a code to can visit, and they can only leave stars, picks from a list and emotes.</p>
      </div>
    </div>
  );
}
export { CoopShiftDock } from "./CoopShiftDock";
export { VisitShareCard } from "./VisitShareCard";
