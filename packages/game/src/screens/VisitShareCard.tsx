/**
 * Round 12 (G): the Restaurant tab's "Friends" card (lazy) — share this restaurant under a code, see who visited (stars
 * and compliments only), and invite a friend to plan tonight with you (the co-op day; the dock takes over from there).
 * Where there's no db (GitHub Pages, signed out) it says so in one line.
 */
import { useEffect, useState } from "react";
import type { GameState } from "@full-plate/sim-core";
import { Icon } from "../components/Icon";
import { Stars } from "../components/Stars";
import { Term } from "../components/Term";
import { setHostFlag, useHostFlag } from "../lib/coop/hostFlag";
import { hostStart } from "../lib/coop/session";
import { pendingWriter } from "../lib/coop/hand";
import {
  cleanNick, complimentText, nickInput, errCode, gameKey, link, NICK_MAX, offLine, pruneReviews, share, sharedCode, showCode, stopSharing, watchReviews,
  type Link, type VisitReview,
} from "../state/share";
import "./visit.css";

type Busy = null | "share" | "stop" | "invite";

export function VisitShareCard({ game }: { game: GameState }) {
  const [conn, setConn] = useState<Link | null>(null);
  const [code, setCode] = useState<string | null | undefined>(undefined);
  const [reviews, setReviews] = useState<VisitReview[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [nick, setNick] = useState("");
  const host = useHostFlag();

  useEffect(() => {
    let live = true;
    void link().then(async (l) => {
      if (!live) return;
      setConn(l);
      if ("off" in l) return;
      const c = await sharedCode(l, game).catch(() => null);
      if (live) setCode(c);
    });
    return () => { live = false; };
    // the game's identity only: re-reading on every planning tap would be one db read per tap
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameKey(game)]);

  useEffect(() => {
    if (!conn || "off" in conn || !code) { setReviews([]); return; }
    void pruneReviews(conn, code).catch(() => {});
    return watchReviews(conn, code, setReviews);
  }, [conn, code]);

  const off = conn ? offLine(conn) : null;
  const run = async (what: Exclude<Busy, null>, fn: (l: { db: import("../state/share").SDb; uid: string }) => Promise<void>) => {
    if (!conn || "off" in conn) return;
    setBusy(what); setNote(null);
    try { await fn(conn); } catch (e) {
      const c = errCode(e);
      setNote(c === "quota_exceeded" ? "The shared space is full. Stop an old share first." : c === "invalid_argument" ? "Your friend link doesn't let you share (ask for Contributor access)." : "That didn't go through. Try again in a moment.");
    }
    setBusy(null);
  };
  const copy = async () => {
    if (!code) return;
    try { await navigator.clipboard.writeText(showCode(code)); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setNote("Copying isn't allowed here: read the code out instead."); }
  };
  const invite = () => run("invite", async (l) => {
    const n = cleanNick(nick) || "Host";
    const { code: c, writer } = await hostStart(l.db, n);
    pendingWriter.set(c, writer);
    setHostFlag({ code: c, nick: n, expiresAt: writer.current.expiresAt, game: gameKey(game) });
  });

  return (
    <section className="card stack stack--sm visitcard" aria-labelledby="visitcard-h">
      <div className="row"><Icon name="people" size={22} /><h3 id="visitcard-h" className="spacer">Friends</h3></div>
      {!conn && <p className="small muted">Checking…</p>}
      {off && <p className="small muted visitcard__off">{off}</p>}
      {conn && !off && (
        <>
          <div className="stack stack--sm">
            <h4>Share my restaurant</h4>
            {code ? (
              <>
                <p className="small">Friends type this code under <b>Visit a friend</b> on the title screen.</p>
                <div className="visitcode" aria-label={`Your code: ${showCode(code).split("").join(" ")}`}>{showCode(code)}</div>
                <div className="row visitcard__btns">
                  <button className="btn btn--tap" onClick={() => void copy()}><Icon name="clipboard" size={20} />{copied ? "Copied" : "Copy"}</button>
                  <button className="btn btn--tap" disabled={!!busy} onClick={() => void run("share", async (l) => { setCode(await share(l, game)); setNote("Updated: friends see today's room and numbers."); })}>{busy === "share" ? "Updating…" : "Update"}</button>
                  <button className="btn btn--ghost btn--tap btn--danger-text" disabled={!!busy} onClick={() => void run("stop", async (l) => { await stopSharing(l, game); setCode(null); setNote("Stopped. That code doesn't open anything now."); })}>{busy === "stop" ? "Stopping…" : "Stop sharing"}</button>
                </div>
              </>
            ) : (
              <>
                <p className="small muted">A friend with the code can look round: the room, menu, team, reviews and this week's numbers. Never your cash, stock or saves.</p>
                <button className="btn btn--green btn--tap" disabled={!!busy || code === undefined} onClick={() => void run("share", async (l) => setCode(await share(l, game)))}>{busy === "share" ? "Sharing…" : "Share my restaurant"}</button>
              </>
            )}
          </div>
          {code && (
            <div className="stack stack--sm">
              <h4>Visitors <span className="small muted">({reviews.length})</span></h4>
              {reviews.length === 0 ? <p className="small muted">No visitors yet.</p> : (
                <ul className="visitors">
                  {reviews.map((r) => (
                    <li key={r.id} className="visitors__item">
                      <Stars rating={r.stars} size={18} />
                      <span className="small"><b>{r.nick || "A friend"}</b>{r.date && <span className="muted"> · {r.date}</span>}</span>
                      {r.picks.length > 0 && <span className="small visitors__picks">{r.picks.map((p) => complimentText(p)).join(" · ")}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="stack stack--sm">
            <h4>Plan tonight with a friend</h4>
            {host ? (
              <p className="small">You're hosting: the co-op panel (bottom left) shows the code and your friend.</p>
            ) : (
              <>
                <p className="small muted">Your friend plans tonight's menu and who's on the <Term id="rota" inline>rota</Term>; you look it over and run the service. You both see the evening. Emotes only, no chat.</p>
                <label className="field">
                  <span className="field__label">Your nickname</span>
                  <input className="input" value={nick} maxLength={NICK_MAX} placeholder="Host" onChange={(e) => setNick(nickInput(e.target.value))} />
                </label>
                <button className="btn btn--tap" disabled={!!busy} onClick={() => void invite()}><Icon name="people" size={20} />{busy === "invite" ? "Making a code…" : "Invite a friend"}</button>
              </>
            )}
          </div>
          {note && <p className="small visitcard__note" role="status">{note}</p>}
        </>
      )}
    </section>
  );
}
export default VisitShareCard;
