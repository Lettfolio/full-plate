/**
 * Round 12 (G): the host's co-op panel (lazy; App mounts it while this device hosts a session). Bottom left, folds to
 * a pill. It writes the host's side of the session from the game as it goes — tonight's board while planning, the stage,
 * the evening's numbers — and shows the guest's nickname, their emotes and their plan. "Use it" sends the plan's changes
 * as ordinary planning commands through the game's own `send` (the sim checks them like any tap); "Not this time"
 * keeps the host's plan. The host's game stays the only authority: nothing the guest writes is applied without a tap.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { devSwitches } from "../lib/perfMeter";
import { lazyRetry } from "../lib/lazyRetry";
import type { Command, GameState } from "@full-plate/sim-core";
import { Icon } from "../components/Icon";
import { weekdayIndex } from "../lib/calendar";
import { PHONE_ANY_QUERY } from "../lib/layout";
import { getHostFlag, setHostFlag, useHostFlag, type HostFlag } from "../lib/coop/hostFlag";
import { pendingWriter } from "../lib/coop/hand";
import { boardOf, eveningOf, planCommands, type EmoteId, type GuestDoc, type HostDoc, type LiveDoc, type LiveRole, type PlanChange, type Stage } from "../lib/coop/protocol";
import { newNonce, type EndWhy } from "../lib/coop/protocol";
import { getRoom } from "../lib/coop/room";
import { endHosting, hostResume, RttMeter, watchGuest, type DocWriter } from "../lib/coop/session";
import { dishName, known } from "../lib/visit";
import { gameKey, link, showCode } from "../state/share";
import { EmoteBar, EmoteHeard } from "./CoopShiftParts";
import type { HostLiveApi } from "./CoopLive";
import "./visit.css";

// Round 13 (F): the live shift's host half, its own chunk (only loaded once tonight is armed)
const HostLive = lazyRetry(() => import("./CoopLive").then((m) => ({ default: m.HostLive })));

const stageOf = (g: GameState): Stage => (g.phase === "planning" ? "plan" : g.phase === "service" ? "service" : "evening");
const PINGS = 3;
/**
 * R14 (U6): the heartbeat. While a friend is in the session the host pings every PULSE_MS (one write to the host's
 * document) and the friend's page answers; a ping unanswered for GONE_MS means the friend has probably gone.
 */
export const PULSE_MS = 15_000;
export const GONE_MS = 45_000;
/** R14 (S14-5): the plan list shows this many changes folded; a price moving more than FLAG_SHARE either way is flagged. */
export const PLAN_FOLD = 8;
export const FLAG_SHARE = 0.3;
const phoneNow = (): boolean => { try { return typeof window.matchMedia === "function" && window.matchMedia(PHONE_ANY_QUERY).matches; } catch { return false; } };

/**
 * R14 (U6): on a phone the panel and its pill sit above whatever the page keeps at the bottom of the screen — the tab
 * bar, the dock with Open for service, the service sheet (and its urgent line) — measured as the page lays out, so
 * neither ever covers them, upright or sideways. Null off a phone (the stylesheet's place, bottom left).
 */
const BLOCKERS = ".planning__bar .tabs, .actiondock, .service__side--sheet, .servsheet__urgent, .eveningdock, .evening .actiondock";
export interface PhoneSpot { bottom: number; maxHeight: number; hidden: boolean }
export function phoneSpot(doc: Document = document, dockWidth = 352): PhoneSpot | null {
  if (!phoneNow()) return null;
  const h = doc.defaultView?.innerHeight ?? 800;
  let top = h;
  for (const el of doc.querySelectorAll(BLOCKERS)) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom <= 0 || r.top >= h || r.left >= dockWidth) continue;
    // only what sits in the lower part of the screen holds the dock up (a dock scrolled to the top doesn't)
    if (r.top < h * 0.35) continue;
    top = Math.min(top, r.top);
  }
  const bottom = Math.round(h - top + 8);
  const room = top - 16;
  return { bottom, maxHeight: Math.max(0, Math.round(room)), hidden: room < 120 };
}
function usePhoneSpot(): PhoneSpot | null {
  const [spot, setSpot] = useState<PhoneSpot | null>(() => (typeof document === "undefined" ? null : phoneSpot()));
  const [phone, setPhone] = useState(phoneNow);
  useEffect(() => {
    const again = () => setPhone(phoneNow());
    addEventListener("resize", again);
    return () => removeEventListener("resize", again);
  }, []);
  useEffect(() => {
    const read = () => setSpot((old) => { const n = phoneSpot(); return JSON.stringify(n) === JSON.stringify(old) ? old : n; });
    read();
    if (!phone) return;
    // the page's own bottom furniture moves (the sheet opens, a dock appears): follow it while on a phone
    const t = setInterval(read, 400);
    addEventListener("scroll", read, { passive: true });
    return () => { clearInterval(t); removeEventListener("scroll", read); };
  }, [phone]);
  return spot;
}

/** A plan change as the host reads it: the price move as a share (price changes), and whether it is flagged. */
export interface ShownChange extends PlanChange { key: string; move: number | null; big: boolean }
/** R14 (S14-5): every change of a plan, big price moves first (largest first), each with a stable key. */
export function shownChanges(game: Pick<GameState, "menu">, changes: readonly PlanChange[]): ShownChange[] {
  const out = changes.map((c, i): ShownChange & { i: number } => {
    let move: number | null = null;
    if (c.kind === "price" && c.cmd.type === "SET_MENU_ITEM" && typeof c.cmd.price === "number") {
      const was = game.menu.find((m) => m.dishId === (c.cmd as { dishId: string }).dishId)?.price ?? 0;
      move = was > 0 ? c.cmd.price / was - 1 : null;
    }
    return { ...c, key: JSON.stringify(c.cmd), move, big: move !== null && Math.abs(move) > FLAG_SHARE, i };
  });
  out.sort((a, b) => Math.abs(b.move ?? 0) - Math.abs(a.move ?? 0) || a.i - b.i);
  return out.map(({ i: _i, ...c }) => c);
}

declare global { interface Window { __fpCoopRtt?: number[] } }

interface Props {
  game: GameState;
  send: (cmd: Command) => void;
  /** Round 13 (F): what a live shift needs from App (absent: the turn-based day only). */
  live?: HostLiveApi;
}

/** Mounted by App while a host flag is stored; renders nothing once it has gone or expired. */
export function CoopShiftDock(p: Props) {
  const flag = useHostFlag();
  useEffect(() => { if (!flag) setHostFlag(null); }, [flag]); // an expired flag: clear it (App unmounts this)
  return flag ? <HostDock key={flag.code} {...p} flag={flag} /> : null;
}

function HostDock({ game, send, flag, live: liveApi }: Props & { flag: HostFlag }) {
  const [writer, setWriter] = useState<DocWriter<HostDoc> | null>(() => pendingWriter.get(flag.code) ?? null);
  const [guest, setGuest] = useState<GuestDoc | null>(null);
  // Round 14 review (S14-3): the guest's platform id from the path of their document (builder B), for A's live pin
  const [guestId, setGuestId] = useState<string | null>(null);
  // R14 (U6): on a phone the panel starts folded (it would cover the page's own buttons), and sits above them
  const [open, setOpen] = useState(() => !phoneNow());
  const spot = usePhoneSpot();
  const placed = spot ? { bottom: spot.bottom, maxHeight: spot.maxHeight } : undefined;
  const [rtt, setRtt] = useState<number | null>(null);
  const [lost, setLost] = useState(false);
  const meter = useRef(new RttMeter());
  const emoteN = useRef(0);

  // connect: the writer the Friends card made, or pick the session back up after a reload
  useEffect(() => {
    if (writer) { pendingWriter.delete(flag.code); return; }
    let live = true;
    void link().then(async (l) => {
      if (!live) return;
      const w = "off" in l ? null : await hostResume(l, flag.code, known.dish);
      if (!live) return;
      if (w) setWriter(w); else setHostFlag(null);
    });
    return () => { live = false; };
  }, [flag.code, writer]);

  // the guest's side, live (Round 14 B: the first guest to join is pinned into my document; their platform id, from
  // the path, is watchGuest's second argument and session.ts `partnerOf(code)`)
  useEffect(() => {
    if (!writer) return;
    let stop = () => {};
    let live = true;
    void link().then((l) => {
      if (!live || "off" in l) return;
      stop = watchGuest(l, writer, flag.code, known.dish, (g, partnerId) => {
        setGuest(g);
        // sticky: B pins the first guest into my document for the whole session, so their going never frees the pin
        const id = partnerId ?? writer.current.guest ?? null;
        if (id) setGuestId(id);
        if (g?.pong) {
          const ms = meter.current.pong(g.pong.n);
          if (ms !== null) { setRtt(meter.current.median); if (devSwitches()) (window.__fpCoopRtt ??= []).push(ms); }
        }
      }, () => setLost(true));
    });
    return () => { live = false; stop(); };
  }, [flag.code, writer]);

  // a few pings when a guest arrives: the measured round trip shows in the panel (COOP-NOTES)
  const joined = guest?.joinedAt ?? 0;
  const pongN = guest?.pong?.n ?? 0;
  useEffect(() => {
    if (!writer || !joined) return;
    const m = meter.current;
    if (m.samples.length >= PINGS) return;
    const last = m.next - 1;
    if (last > 0 && pongN < last) return; // still waiting for the last one
    void writer.patch({ ping: { n: m.ping() } });
  }, [writer, joined, pongN]);

  // R14 (U6): the heartbeat — keep one ping out while a friend is here; one unanswered for GONE_MS: they seem to have gone
  const [gone, setGone] = useState(false);
  const waitSince = useRef<number | null>(null);
  const guestRef = useRef(guest);
  guestRef.current = guest;
  const present = !!joined && !guest?.ended;
  useEffect(() => {
    if (!writer || !present) { waitSince.current = null; setGone(false); return; }
    const beat = () => {
      const now = Date.now();
      const out = writer.current.ping?.n ?? 0;
      const answered = (guestRef.current?.pong?.n ?? 0) >= out;
      if (answered) {
        waitSince.current = null;
        setGone(false);
        void writer.patch({ ping: { n: meter.current.ping() } });
      } else {
        waitSince.current ??= now;
        if (now - waitSince.current >= GONE_MS) setGone(true);
      }
    };
    const t = setInterval(beat, PULSE_MS / 3);
    return () => clearInterval(t);
  }, [writer, present]);
  // an answer clears it at once
  useEffect(() => { if (pongN > 0) { waitSince.current = null; setGone(false); } }, [pongN]);
  const keepWaiting = () => { waitSince.current = Date.now(); setGone(false); };

  // the host's side, from the game: board while planning, the stage, the evening
  const weekday = weekdayIndex(game.day);
  const board = useMemo(() => (game.phase === "planning" ? boardOf(game, weekday) : null), [game, weekday]);
  const evening = useMemo(() => (game.phase === "evening" || game.phase === "event" ? eveningOf(game) : null), [game]);
  const stage = stageOf(game);
  const sent = useRef("");
  const mine = flag.game === gameKey(game);
  useEffect(() => {
    if (!writer || !mine) return;
    const patch: Partial<HostDoc> = { stage, ...(board ? { board } : {}), ...(stage === "evening" ? { evening } : stage === "plan" ? { evening: null } : {}) };
    const key = JSON.stringify(patch);
    if (key === sent.current) return;
    sent.current = key;
    void writer.patch(patch);
  }, [writer, mine, stage, board, evening]);

  // the session ends itself after two hours
  useEffect(() => {
    const t = setInterval(() => { if (!getHostFlag()) setHostFlag(null); }, 30_000);
    return () => clearInterval(t);
  }, []);

  const plan = guest?.plan ?? null;
  const answered = writer?.current.answer?.n ?? 0;
  const changes = useMemo(() => (plan && plan.n > answered ? shownChanges(game, planCommands(game, plan, weekday, dishName)) : []), [plan, answered, game, weekday]);
  // R14 (S14-5): every change can be seen (folded to PLAN_FOLD, big price moves first); "Use it" applies what is on screen
  const [allShown, setAllShown] = useState(false);
  useEffect(() => { setAllShown(false); }, [plan?.n]);
  const visible = allShown ? changes : changes.slice(0, PLAN_FOLD);
  const shownRef = useRef<ShownChange[]>([]);
  shownRef.current = visible;
  const planWaiting = !!plan && plan.n > answered && plan.day === game.day && game.phase === "planning";
  const [, bump] = useState(0);
  // ── Round 13 (F): tonight, live ──
  const [roomOk, setRoomOk] = useState(false);
  useEffect(() => { let on = true; void getRoom().then((r) => on && setRoomOk(!!r)); return () => { on = false; }; }, []);
  const [pick, setPick] = useState<LiveRole>("server"); // the guest's role
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const liveDoc: LiveDoc | null = writer?.current.live ?? null;
  const liveActive = !!liveDoc && liveDoc.state !== "ended" && (liveDoc.state === "on" || liveDoc.day === game.day);
  const arm = () => {
    if (!writer) return;
    setLiveNote(null);
    void writer.patch({ live: { nonce: newNonce(), guestRole: pick, state: "ready", day: game.day, at: Date.now() } });
    bump((x) => x + 1);
  };
  const disarm = () => { if (!writer || !liveDoc) return; void writer.patch({ live: { ...liveDoc, state: "ended", why: "host", at: Date.now() } }); bump((x) => x + 1); };
  const liveEnded = (why: EndWhy, msg?: string) => {
    setLiveNote(msg ?? (why === "done" ? "Doors closed on the live shift." : why === "slow" ? "Finished on your own: the link was too slow. The turn-based day still works." : why === "office" ? "Back in the office: the live shift is over." : null));
    bump((x) => x + 1);
  };
  const [liveSt, setLiveSt] = useState({ room: false, guestHere: false });
  const liveEl = writer && liveActive && liveDoc && liveApi ? (
    <Suspense fallback={null}>
      <HostLive key={liveDoc.nonce} game={game} send={send} api={liveApi} code={flag.code} live={liveDoc} writer={writer} guestNick={guest?.nick ?? "Your friend"} guestId={guestId} guestGen={String(guest?.joinedAt ?? 0)} onEnded={liveEnded} onStatus={setLiveSt} />
    </Suspense>
  ) : null;
  const doing = (r: LiveRole) => (r === "chef" ? "cooking" : "serving");
  const answer = (used: boolean) => {
    if (!writer || !plan) return;
    // only what the host saw, and only if it is still part of the plan (a newer plan re-renders the list first)
    if (used) { const now = new Set(changes.map((c) => c.key)); for (const c of shownRef.current) if (now.has(c.key)) send(c.cmd); }
    void writer.patch({ answer: { n: plan.n, used } });
    bump((x) => x + 1);
  };
  const end = async () => {
    // Round 14 (B): ending deletes my document (and sweeps my marker) in the background; the panel goes at once
    const code = flag.code;
    setHostFlag(null);
    const l = await link();
    if (!("off" in l)) await endHosting(l, code, writer).catch(() => {});
  };
  const emote = (id: EmoteId) => { emoteN.current = Math.max(Date.now(), emoteN.current + 1); if (writer) void writer.patch({ emote: { id, n: emoteN.current } }); };

  const who = guest && !guest.ended ? guest.nick : null;
  // folds itself for the service (it would cover the room) and opens again for the evening or a new plan
  // (R14: on a phone it stays folded until there's something to answer)
  useEffect(() => { setOpen(game.phase !== "service" && !phoneNow()); }, [game.phase]);
  useEffect(() => { if (planWaiting) setOpen(true); }, [planWaiting]);
  useEffect(() => { if (gone && game.phase !== "service") setOpen(true); }, [gone]); // eslint-disable-line react-hooks/exhaustive-deps
  // another game is open: the session belongs to the one that made it
  if (!mine) return null;
  // a live shift owns the service: its layer is on the stage, so the panel steps aside. HostLive sits at one place in
  // the tree whatever the panel shows, so folding the panel or opening the doors never drops the room.
  if (liveEl && game.phase === "service") return <>{liveEl}</>;
  if (!open) {
    return (<>{liveEl}
      <div className="coopdock coopdock--pill" style={spot ? { bottom: spot.bottom } : undefined} hidden={spot?.hidden}>
        {who && <EmoteHeard from={who} emote={guest?.emote ?? null} />}
        <button className="btn btn--tap coopdock__pill" onClick={() => setOpen(true)} aria-expanded="false">
          <Icon name="people" size={20} />Co-op{who ? ` · ${who}` : ""}{gone ? " seems to have gone" : planWaiting ? " · plan in" : ""}
        </button>
      </div>
    </>);
  }
  return (<>{liveEl}
    <aside className="coopdock card" aria-label="Co-op day" style={placed}>
      <div className="row">
        <Icon name="people" size={22} />
        <h3 className="spacer coopdock__title">Co-op day</h3>
        <button className="iconbtn iconbtn--tap" onClick={() => setOpen(false)} aria-label="Fold the co-op panel" aria-expanded="true"><Icon name="chevronDown" size={20} /></button>
      </div>
      {!writer && <p className="small muted">Connecting…</p>}
      {writer && !who && (
        <div className="stack stack--sm">
          <p className="small">Give your friend this code. They type it under <b>Visit a friend</b>.</p>
          <div className="visitcode visitcode--sm">{showCode(flag.code)}</div>
          {guest?.ended && <p className="small callout">{guest.nick} left the session.</p>}
          <p className="small muted">You're <b>{flag.nick}</b>. The code works for two hours.</p>
        </div>
      )}
      {writer && who && (
        <div className="stack stack--sm">
          <p className="small"><b>{flag.nick}</b> (you) with <b>{who}</b>{rtt !== null && <span className="muted"> · link {rtt} ms</span>}</p>
          <EmoteHeard from={who} emote={guest?.emote ?? null} />
          {gone && (
            <div className="coopgone callout stack stack--sm" role="status">
              <p className="small"><b>{who}</b> seems to have gone: no answer for {Math.round(GONE_MS / 1000)} seconds.</p>
              <div className="row">
                <button className="btn btn--tap" onClick={keepWaiting}>Keep waiting</button>
                <button className="btn btn--ghost btn--tap btn--danger-text" onClick={() => void end()}>End co-op</button>
              </div>
            </div>
          )}
          {planWaiting ? (
            <div className="coopplan stack stack--sm">
              <p className="small"><b>{who}</b> sent a plan for tonight{changes.length ? ":" : ", the same as yours."}</p>
              {changes.length > 0 && (
                <ul className="coopplan__list small">
                  {visible.map((c) => (
                    <li key={c.key} className={c.big ? "coopplan__big" : undefined}>
                      {c.label}
                      {c.move !== null && <span className={c.big ? "coopplan__flag" : "muted"}> ({c.move > 0 ? "+" : "−"}{Math.round(Math.abs(c.move) * 100)}%{c.big ? ", a big change" : ""})</span>}
                    </li>
                  ))}
                </ul>
              )}
              {changes.length > PLAN_FOLD && (
                <button type="button" className="btn btn--ghost btn--tap" aria-expanded={allShown} onClick={() => setAllShown((x) => !x)}>
                  {allShown ? `Show the first ${PLAN_FOLD}` : `Show all ${changes.length} changes`}
                </button>
              )}
              <div className="row">
                <button className="btn btn--green btn--tap" onClick={() => answer(true)}>{changes.length > visible.length ? `Use these ${visible.length}` : "Use it"}</button>
                <button className="btn btn--ghost btn--tap" onClick={() => answer(false)}>Not this time</button>
              </div>
            </div>
          ) : gone ? null : (
            <p className="small muted">{game.phase === "planning" ? `${who} is planning tonight.` : game.phase === "service" ? `${who} is watching for the evening's numbers.` : `${who} sees tonight's numbers.`}</p>
          )}
          {liveActive && liveDoc && game.phase === "planning" && (
            <div className="cooparm stack stack--sm" role="status">
              <p className="small"><b>Live tonight.</b> You're {doing(liveDoc.guestRole === "server" ? "chef" : "server")}, <b>{who}</b> is {doing(liveDoc.guestRole)}. Open the doors when you're both ready.</p>
              <p className="small muted">{!liveSt.room ? "Opening the live room…" : liveSt.guestHere ? `${who} is in the room.` : `Waiting for ${who} to join the room…`}</p>
            </div>
          )}
          {!liveActive && game.phase === "planning" && liveApi && roomOk && guest?.rt && (
            <div className="cooparm stack stack--sm">
              <p className="small"><b>Play tonight's service live</b>, together, on one floor.</p>
              <div className="cooparm__roles" role="group" aria-label="Who does what">
                <button type="button" className="btn btn--tap" aria-pressed={pick === "server"} onClick={() => setPick("server")}>I cook, {who} serves</button>
                <button type="button" className="btn btn--tap" aria-pressed={pick === "chef"} onClick={() => setPick("chef")}>I serve, {who} cooks</button>
              </div>
              <button className="btn btn--green btn--tap" onClick={arm}>Go live tonight</button>
            </div>
          )}
          {liveActive && game.phase === "planning" && <button className="btn btn--ghost btn--tap" onClick={disarm}>Not live tonight</button>}
          {!liveActive && game.phase === "planning" && liveApi && roomOk && guest && !guest.rt && <p className="small muted">{who}'s page can't do live play, so it's the turn-based day.</p>}
          {liveNote && <p className="small callout" role="status">{liveNote}</p>}
        </div>
      )}
      {lost && <p className="small callout">Lost touch with the session. It may have ended.</p>}
      <EmoteBar onSend={emote} disabled={!writer || !who} />
      <button className="btn btn--ghost btn--tap btn--danger-text" onClick={() => void end()}>End the co-op day</button>
    </aside>
  </>);
}

