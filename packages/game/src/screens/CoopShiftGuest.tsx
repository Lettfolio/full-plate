/**
 * Round 12 (G): the guest's side of a co-op day (lazy, from Visit a friend). The guest plans tonight for the host —
 * dishes on or off, prices, who works tonight — and sends it; the host decides whether to use it, runs the service,
 * and both see the evening. Six emotes, no text. Nothing here touches a game of the guest's own.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { MoneyText } from "../components/MoneyText";
import { Stars } from "../components/Stars";
import { Stepper } from "../components/Stepper";
import { Term } from "../components/Term";
import { expired, type Board, type EmoteId, type GuestDoc, type HostDoc } from "../lib/coop/protocol";
import { leaveAsGuest, watchHost, type DocWriter } from "../lib/coop/session";
import { getRoom } from "../lib/coop/room";
import { dishName, known, ROLE_WORD } from "../lib/visit";
import type { SDb } from "../state/share";
import { EmoteBar, EmoteHeard } from "./CoopShiftParts";
import "./visit.css";

// Round 13 (F): the live shift's guest half, its own chunk
const GuestLive = lazy(() => import("./CoopLive").then((m) => ({ default: m.GuestLive })));

/** Round 14 (B): `hostId` (the host's platform id, from the path the code led to) and `uid` (mine) place the documents. */
interface Props { db: SDb; uid: string; hostId: string; code: string; first: HostDoc; writer: DocWriter<GuestDoc>; onExit: () => void }

interface Draft { day: number; menu: Board["menu"]; on: Set<string> }
const draftOf = (b: Board): Draft => ({ day: b.day, menu: b.menu.map((m) => ({ ...m })), on: new Set(b.staff.filter((s) => s.on).map((s) => s.id)) });

export function CoopShiftGuest({ db, uid, hostId, code, first, writer, onExit }: Props) {
  const [host, setHost] = useState<HostDoc | null>(first);
  const [lost, setLost] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(first.board ? draftOf(first.board) : null);
  const [sentN, setSentN] = useState(0);
  const [, tick] = useState(0);

  useEffect(() => watchHost(db, hostId, code, known.dish, (h) => {
    setHost(h);
    // answer the host's pings at once (the round trip is measured on the host's side)
    if (h?.ping && h.ping.n !== writer.current.pong?.n) void writer.patch({ pong: { n: h.ping.n } });
  }, () => setLost(true), uid), [db, hostId, uid, code, writer]);

  // a new day's board: start the plan from it
  const boardDay = host?.board?.day;
  useEffect(() => { if (host?.board && (!draft || draft.day !== host.board.day)) { setDraft(draftOf(host.board)); setSentN(0); } }, [boardDay]); // eslint-disable-line react-hooks/exhaustive-deps

  // Round 13 (F): live play — say so in my document when this page can reach the room; join when the host goes live
  const [roomOk, setRoomOk] = useState(false);
  useEffect(() => { let on = true; void getRoom().then((r) => { if (on && r) { setRoomOk(true); void writer.patch({ rt: true }); } }); return () => { on = false; }; }, [writer]);
  const [inLive, setInLive] = useState<string | null>(null);
  const [liveMsg, setLiveMsg] = useState<string | null>(null);
  const doneLive = useRef(new Set<string>());
  const live = host?.live ?? null;
  const liveOpen = !!live && roomOk && (live.state === "on" || (live.state === "ready" && host?.board?.day === live.day));
  useEffect(() => { if (live && liveOpen && inLive !== live.nonce && !doneLive.current.has(live.nonce)) setInLive(live.nonce); }, [live, liveOpen, inLive]);

  // the clock: expiry is checked once a minute
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 60_000); return () => clearInterval(t); }, []);

  const leave = async () => { await leaveAsGuest({ db, uid }, code, writer).catch(() => {}); onExit(); };
  const emote = (id: EmoteId) => void writer.patch({ emote: { id, n: Math.max(Date.now(), (writer.current.emote?.n ?? 0) + 1) } });
  const send = () => {
    if (!draft) return;
    const n = (writer.current.plan?.n ?? 0) + 1;
    void writer.patch({ plan: { n, day: draft.day, menu: draft.menu, on: [...draft.on] } });
    setSentN(n);
  };
  const changed = useMemo(() => {
    const b = host?.board;
    if (!b || !draft) return 0;
    return draft.menu.filter((m, i) => m.active !== b.menu[i]?.active || m.price !== b.menu[i]?.price).length + b.staff.filter((s) => s.on !== draft.on.has(s.id)).length;
  }, [host?.board, draft]);

  const over = !host || host.stage === "ended" || expired(host);
  const who = host?.nick ?? "Your friend";
  const board = host?.board;
  const answer = host?.answer && sentN && host.answer.n === sentN ? host.answer : null;

  return (
    <div className="page coopguest stack">
      <header className="row coopguest__head">
        <div className="spacer">
          <p className="small muted">Co-op day · you're <b>{writer.current.nick}</b></p>
          <h2>{board ? board.restaurant : "Your friend's restaurant"} <span className="muted">with {who}</span></h2>
        </div>
        <button className="btn btn--ghost btn--tap" onClick={() => void leave()}><Icon name="close" size={20} />Leave</button>
      </header>

      {over ? (
        <div className="card stack stack--sm">
          <h3>{!host ? "The session has gone" : host.stage === "ended" ? `${who} ended the co-op day` : "The two hours are up"}</h3>
          <p className="small muted">Ask {who} for a new code to play again.</p>
          <button className="btn btn--primary btn--tap" onClick={onExit}>Back to the title</button>
        </div>
      ) : (
        <>
          <div className="card row coopguest__emotes">
            <EmoteBar onSend={emote} />
            <EmoteHeard from={who} emote={host.emote} />
          </div>
          {lost && <p className="callout small">Lost touch with {who}. Leave and join again with the same code.</p>}
          {liveMsg && <p className="callout small" role="status">{liveMsg}</p>}
          {inLive && live && live.nonce === inLive && (
            <Suspense fallback={<p className="card small muted">Opening the live shift…</p>}>
              <GuestLive code={code} live={live} hostNick={who} dbOver={live.state === "ended" ? live.why ?? "done" : live.state === "ready" && host.board && host.board.day !== live.day ? "host" : null}
                onExit={(_why, msg) => { doneLive.current.add(inLive); setInLive(null); setLiveMsg(msg ?? null); }} />
            </Suspense>
          )}
          {live && live.state !== "ended" && !roomOk && host.stage !== "evening" && <p className="small muted">{who} is playing tonight live, but this page can't join live play: you'll see the numbers here.</p>}

          {host.stage === "plan" && board && draft && (
            <section className="card stack" aria-labelledby="coop-plan-h">
              <div className="row"><h3 id="coop-plan-h" className="spacer">Plan tonight for {who}</h3><span className="small muted">Day {board.day + 1}</span></div>
              <div className="coopguest__cols">
                <div className="stack stack--sm">
                  <h4>Menu</h4>
                  <ul className="coopguest__list">
                    {draft.menu.map((m, i) => (
                      <li key={m.dishId} className="coopguest__row">
                        <button type="button" className="btn btn--tap coopguest__toggle" aria-pressed={m.active} onClick={() => setDraft({ ...draft, menu: draft.menu.map((x, j) => (j === i ? { ...x, active: !x.active } : x)) })}>
                          {m.active ? <Icon name="check" size={18} /> : <Icon name="close" size={18} />}{dishName(m.dishId)}
                        </button>
                        <Stepper label={`price of ${dishName(m.dishId)}`} value={m.price} step={25} min={25} max={20000} onChange={(price) => setDraft({ ...draft, menu: draft.menu.map((x, j) => (j === i ? { ...x, price } : x)) })}>
                          <MoneyText pence={m.price} />
                        </Stepper>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="stack stack--sm">
                  <h4>On the <Term id="rota" inline>rota</Term> tonight</h4>
                  <ul className="coopguest__list">
                    {board.staff.map((s) => (
                      <li key={s.id} className="coopguest__row">
                        <button type="button" className="btn btn--tap coopguest__toggle" aria-pressed={draft.on.has(s.id)} onClick={() => { const on = new Set(draft.on); if (on.has(s.id)) on.delete(s.id); else on.add(s.id); setDraft({ ...draft, on }); }}>
                          {draft.on.has(s.id) ? <Icon name="check" size={18} /> : <Icon name="close" size={18} />}{s.name} <span className="muted">· {ROLE_WORD[s.role]}</span>
                        </button>
                      </li>
                    ))}
                    {board.staff.length === 0 && <li className="small muted">No staff yet: {who} is doing it all.</li>}
                  </ul>
                </div>
              </div>
              <div className="row coopguest__send">
                <p className="small spacer" role="status">
                  {answer ? (answer.used ? <><b>{who}</b> used your plan.</> : <><b>{who}</b> kept their own plan this time.</>)
                    : sentN ? <>Sent. Waiting for <b>{who}</b> to look at it…</>
                    : changed ? <>{changed} change{changed === 1 ? "" : "s"} from {who}'s plan.</> : <>No changes yet.</>}
                </p>
                <button className="btn btn--primary btn--tap" onClick={send}>Send plan to {who}</button>
              </div>
            </section>
          )}
          {host.stage === "plan" && !board && <p className="card small muted">Waiting for {who} to open the planning screen…</p>}

          {host.stage === "service" && (
            <section className="card stack stack--sm">
              <h3>{who} is running tonight's service</h3>
              <p className="small muted">The evening's numbers show here when the doors close. Cheer them on with an emote.</p>
            </section>
          )}

          {host.stage === "evening" && (
            <section className="card stack stack--sm" aria-labelledby="coop-eve-h">
              <h3 id="coop-eve-h">Tonight at {board?.restaurant ?? "their restaurant"}</h3>
              {host.evening ? (
                <dl className="visitnums">
                  <div><dt><Term id="covers" inline>Covers</Term></dt><dd>{host.evening.covers}</dd></div>
                  <div><dt>Walked out</dt><dd>{host.evening.walkouts}</dd></div>
                  <div><dt><Term id="takings" inline>Takings</Term></dt><dd><MoneyText pence={host.evening.revenue} whole /></dd></div>
                  <div><dt>Profit</dt><dd><MoneyText pence={host.evening.profit} whole /></dd></div>
                  <div><dt>Rating</dt><dd><Stars rating={host.evening.rating} size={18} /></dd></div>
                  {host.evening.bestDish && <div><dt>Best dish</dt><dd>{dishName(host.evening.bestDish)}</dd></div>}
                </dl>
              ) : <p className="small muted">The restaurant was closed tonight.</p>}
              <p className="small muted">Tomorrow's plan opens when {who} starts the next day.</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
export default CoopShiftGuest;
