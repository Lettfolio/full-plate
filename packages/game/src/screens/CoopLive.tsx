/**
 * Round 13 (F): the LIVE co-op shift on screen (lazy chunk). Two halves over lib/coop/realtime.ts:
 *
 *   HostLive   mounted by the host's co-op panel once tonight is armed. Joins the session's named room, runs the
 *              LiveHost (snapshots out, the guest's input in through the game's own `handsOnResults`), jumps the host in
 *              when the doors open, logs the shift and replays it at closing time, and gives App's HandsOnShift its
 *              `remote`: the partner on the stage, the link, the emotes.
 *   GuestLive  the guest's side (from the guest's co-op screen): joins the same room, rebuilds the floor from the host's
 *              snapshots and plays the other role in a HandsOnShift of its own whose results go to the host.
 *
 * Nothing here is in the main chunk; the main chunk holds only flag.ts's remote store and reducer tap.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Command, GameState } from "@full-plate/sim-core";
import { drawPerson, readPalette, staffLook, viewMetrics, type HandsOnResult, type HandsOnRole, type HandsOnSession, type Palette, type ShiftSummary } from "@full-plate/handson";
import { Icon } from "../components/Icon";
import { coopTap, setCoopRemote } from "../lib/coop/flag";
import { emoteOf, type EmoteId, type HostDoc, type LiveDoc, type LiveRole } from "../lib/coop/protocol";
import {
  checkSpot, LiveGuest, LiveHost, presenceOf, roomName, spotOf, TOPIC, type EndWhy, type RoomMsg, type Spot,
} from "../lib/coop/realtime";
import { getRoom, joinLive, type NamedRoomLike } from "../lib/coop/room";
import type { DocWriter } from "../lib/coop/session";
import { getSettings } from "../lib/settings";
import { prefersReducedMotion } from "../lib/perfMeter";
import { appReducer, type AppState } from "../state/gameReducer";
import type { HandsOnRemote } from "./HandsOnShift";
import { EmoteBar } from "./CoopShiftParts";
import "./visit.css";

const HandsOnShift = lazy(() => import("./HandsOnShift").then((m) => ({ default: m.HandsOnShift })));

const PUMP_MS = 50;
const PRESENCE_MS = 100;
/** The host left the hands-on canvas (Back to the office) for this long: the live shift ends. */
const OFFICE_MS = 1500;
export const ROLE_DOING: Record<LiveRole, string> = { chef: "cooking", server: "serving" };

declare global {
  interface Window {
    /** Playtests read these: the replay check, the measured round trips, snapshot sizes and rate. */
    __fpCoopReplay?: { ok: boolean; actions: number; bytes: number };
    __fpCoopLive?: { side: "host" | "guest"; rtt: number | null; snaps?: number; sizes?: number[]; applied?: number; refused: number; seconds?: number; status: unknown };
  }
}

const motionOn = (): boolean => getSettings().animations && !prefersReducedMotion();

/** Sends presence at most every PRESENCE_MS, and only when it changed. */
function presenceSender(room: NamedRoomLike) {
  let last = 0;
  let key = "";
  return (s: HandsOnSession) => {
    const now = performance.now();
    if (now - last < PRESENCE_MS) return;
    const spot = spotOf(s);
    const k = `${spot.x},${spot.y},${spot.f},${spot.c}`;
    if (k === key) return;
    key = k;
    last = now;
    room.presence(presenceOf(spot)).catch(() => {});
  };
}

/** The partner's presence, from the room's peers (only the pinned partner counts). */
function watchPartner(room: NamedRoomLike, partner: () => string | null, into: { current: Spot | null }): () => void {
  const read = () => { const p = partner(); const peer = p ? room.peers().find((x) => x.peer === p) : undefined; into.current = peer ? checkSpot(peer.presence) : null; };
  const stop = room.onPeers(read);
  const t = setInterval(read, 250);
  return () => { stop(); clearInterval(t); };
}

// ───────────────────────── the layer over the stage ─────────────────────────

interface LayerInfo {
  partner: string;
  partnerRole: LiveRole;
  rtt: number | null;
  note: string | null;
  emote: { id: EmoteId; n: number } | null;
  onEmote: (id: EmoteId) => void;
  action?: { label: string; run: () => void } | undefined;
}

/** The partner drawn with the game's own sprite at their spot (smoothed between presence updates), and a name tag. */
function PartnerCanvas({ stage, spot, role, name }: { stage: { width: number; height: number }; spot: { current: Spot | null }; role: LiveRole; name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !stage.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(stage.width * dpr);
    c.height = Math.round(stage.height * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let pal: Palette;
    try { pal = readPalette(c); } catch { return; }
    const m = viewMetrics(stage);
    const at = { x: -1, y: -1 };
    let raf = 0;
    let phase = 0;
    let lastT = performance.now();
    const look = staffLook(role, `partner:${name}`);
    const frame = (t: number) => {
      const dt = Math.min(0.1, (t - lastT) / 1000);
      lastT = t;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, stage.width, stage.height);
      const s = spot.current;
      if (s) {
        const motion = motionOn();
        // smoothing between the ~10 Hz presence updates; snaps under reduced motion
        if (at.x < 0 || !motion) { at.x = s.x; at.y = s.y; } else { const k = Math.min(1, dt * 12); at.x += (s.x - at.x) * k; at.y += (s.y - at.y) * k; }
        const moving = Math.hypot(s.x - at.x, s.y - at.y) > 0.04;
        if (moving && motion) phase += dt * 16;
        const px = m.ox + at.x * m.T, py = m.oy + at.y * m.T;
        ctx.strokeStyle = pal.plum; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(px, py + m.T * 0.32, m.T * 0.44, m.T * 0.18, 0, 0, Math.PI * 2); ctx.stroke();
        drawPerson(ctx, px, py, m.T * 0.33, look, { facing: s.f, moving: moving && motion, phase, carrying: s.c, outline: pal.outline, shadow: pal.shadow });
        ctx.font = "800 13px system-ui, sans-serif";
        const w = ctx.measureText(name).width + 12;
        const ty = py - m.T * 0.95;
        ctx.fillStyle = pal.plum;
        ctx.beginPath(); ctx.roundRect(px - w / 2, ty - 18, w, 20, 10); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(name, px, ty - 8);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [stage.width, stage.height, spot, role, name]);
  return <canvas ref={ref} className="cooplive__partner" style={{ width: stage.width, height: stage.height }} aria-hidden="true" />;
}

const sameInfo = (a: LayerInfo, b: LayerInfo) =>
  a.partner === b.partner && a.partnerRole === b.partnerRole && a.rtt === b.rtt && a.note === b.note && a.emote?.n === b.emote?.n && a.action?.label === b.action?.label;

/**
 * The co-op HUD over the stage. It reads the live engine itself (`read`, five times a second) rather than through
 * props, so the remote handed to HandsOnShift stays one object for the whole shift.
 */
function LiveLayer({ stage, spot, read }: { stage: { width: number; height: number }; spot: { current: Spot | null }; read: () => LayerInfo }) {
  const [info, setInfo] = useState(read);
  useEffect(() => {
    const t = setInterval(() => setInfo((old) => { const n = read(); return sameInfo(old, n) ? old : n; }), 200);
    return () => clearInterval(t);
  }, [read]);
  const [heard, setHeard] = useState<{ id: EmoteId; n: number } | null>(null);
  const [emotes, setEmotes] = useState(false);
  const seen = useRef(info.emote?.n ?? 0);
  useEffect(() => {
    if (!info.emote || info.emote.n === seen.current) return;
    seen.current = info.emote.n;
    setHeard(info.emote);
    const t = setTimeout(() => setHeard(null), 4000);
    return () => clearTimeout(t);
  }, [info.emote]);
  const e = heard ? emoteOf(heard.id) : null;
  return (
    <>
      <PartnerCanvas stage={stage} spot={spot} role={info.partnerRole} name={info.partner} />
      <div className="cooplive__hud">
        <p className="cooplive__link small" role="status">
          <Icon name="people" size={18} /><b>{info.partner}</b>&nbsp;is {ROLE_DOING[info.partnerRole]}
          {info.rtt !== null && <span className="muted"> · link {info.rtt} ms</span>}
        </p>
        {info.note && <p className="cooplive__note small" role="status">{info.note}{info.action && <button className="btn btn--tap cooplive__act" onClick={info.action.run}>{info.action.label}</button>}</p>}
        {e && <p className="cooplive__heard small" role="status" aria-live="polite"><span aria-hidden="true" className="cooplive__glyph">{e.glyph}</span><b>{info.partner}</b>: {e.label}</p>}
        <div className="cooplive__emotes">
          {emotes && <EmoteBar onSend={(id) => { info.onEmote(id); setEmotes(false); }} />}
          <button type="button" className="btn btn--tap cooplive__emotebtn" aria-expanded={emotes} onClick={() => setEmotes((x) => !x)}>
            <span aria-hidden="true">🙂</span>{emotes ? "Close" : "Emote"}
          </button>
        </div>
      </div>
    </>
  );
}

// ───────────────────────── the host ─────────────────────────

export interface HostLiveApi {
  /** meta.handsOn's role while the host is on the hands-on canvas, else null. */
  handsOn: HandsOnRole | null;
  jumpIn: (role: HandsOnRole) => void;
  sendResults: (results: HandsOnResult[]) => void;
}
interface HostProps {
  game: GameState;
  send: (cmd: Command) => void;
  api: HostLiveApi;
  code: string;
  live: LiveDoc;
  writer: DocWriter<HostDoc>;
  guestNick: string;
  /** The live shift is over (or couldn't start): the panel goes back to the turn-based day. */
  onEnded: (why: EndWhy, msg?: string) => void;
  /** What the panel shows before the doors open. */
  onStatus: (s: { room: boolean; guestHere: boolean }) => void;
}

export function HostLive({ game, send, api, code, live, writer, guestNick, onEnded, onStatus }: HostProps) {
  const hostRole: LiveRole = live.guestRole === "server" ? "chef" : "server";
  const [room, setRoom] = useState<NamedRoomLike | null>(null);
  const [, bump] = useState(0);
  const engine = useRef<LiveHost | null>(null);
  const spot = useRef<Spot | null>(null);
  const api$ = useRef(api);
  api$.current = api;
  const send$ = useRef(send);
  send$.current = send;
  const game$ = useRef(game);
  game$.current = game;
  const ended = useRef(false);
  const started = useRef(live.state === "on");
  const t0 = useRef(0);

  const finish = (why: EndWhy, msg?: string) => {
    if (ended.current) return;
    ended.current = true;
    engine.current?.end(why);
    setCoopRemote(null);
    void writer.patch({ live: { ...live, state: "ended", why, at: Date.now() } });
    const rec = coopTap.rec;
    coopTap.rec = null;
    if (rec && rec.actions.length) {
      // The shift is a pure function of the state it started from and the actions the reducer saw: replay and compare.
      const replayed = rec.actions.reduce<AppState>((s, a) => appReducer(s, a as Parameters<typeof appReducer>[1]), rec.start as AppState);
      const a = JSON.stringify(replayed.game), b = JSON.stringify(game$.current);
      window.__fpCoopReplay = { ok: a === b, actions: rec.actions.length, bytes: b.length };
    }
    onEnded(why, msg);
  };

  // the room
  useEffect(() => {
    let live$ = true;
    let stops: (() => void)[] = [];
    let joined: NamedRoomLike | null = null;
    void getRoom().then(async (ns) => {
      if (!live$) return;
      if (!ns) { finish("lost", "Live play isn't available on this page, so it's the turn-based day."); return; }
      const j = await joinLive(ns, roomName(code, live.nonce));
      if (!live$) { if ("room" in j) void j.room.leave(); return; }
      if ("error" in j) { finish("lost", j.error === "not_permitted" ? "Live play isn't open to you on this page (it needs Contributor access)." : "Couldn't open the live room, so it's the turn-based day."); return; }
      joined = j.room;
      const host = new LiveHost({
        emit: (topic, data) => { j.room.emit(topic, data).catch((e: { code?: string }) => { if (e?.code === "not_permitted") finish("lost", "Live play isn't open to you on this page (it needs Contributor access)."); }); },
        apply: (results) => api$.current.sendResults(results),
        setSimRole: (role) => send$.current({ type: "SET_HANDS_ON", role }),
        now: () => performance.now(),
      }, { nonce: live.nonce, hostRole });
      host.setMe(j.me);
      host.setGame(game$.current);
      engine.current = host;
      t0.current = performance.now();
      const hear = (m: RoomMsg) => { host.hear(m); };
      stops = [j.room.on(TOPIC.in, hear), j.room.on(TOPIC.emo, (m) => { host.hear(m); bump((x) => x + 1); }), watchPartner(j.room, () => host.partnerPeer, spot)];
      let lastStatus = "";
      const t = setInterval(() => {
        host.pump();
        const st = host.status;
        const k = `${st.guest}|${st.rtt}|${st.slow}`;
        if (k !== lastStatus) { lastStatus = k; bump((x) => x + 1); }
        window.__fpCoopLive = { side: "host", rtt: st.rtt, snaps: st.snaps, sizes: host.sizes, applied: st.applied, refused: host.refused, seconds: (performance.now() - t0.current) / 1000, status: st };
      }, PUMP_MS);
      stops.push(() => clearInterval(t));
      setRoom(j.room);
    });
    return () => { live$ = false; for (const s of stops) s(); if (joined) void joined.leave(); setCoopRemote(null); };
    // one room per session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, live.nonce]);

  useEffect(() => { engine.current?.setGame(game); }, [game]);

  // doors open → on the line, the log starts; doors shut → the end, the replay check
  useEffect(() => {
    if (!room || ended.current) return;
    if (game.phase === "service" && !started.current) {
      started.current = true;
      coopTap.rec = { start: null, actions: [], seen: new WeakSet() };
      void writer.patch({ live: { ...live, state: "on", at: Date.now() } });
      api$.current.jumpIn(hostRole);
    } else if (game.phase !== "service" && started.current && game.phase !== "planning") {
      finish("done");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, game.phase]);

  // "Back to the office" mid-shift ends the live shift (the guest would be serving a dining room at office speed)
  const onCanvas = api.handsOn !== null;
  useEffect(() => {
    if (!started.current || ended.current || game.phase !== "service" || onCanvas) return;
    const t = setTimeout(() => finish("office"), OFFICE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onCanvas, game.phase]);

  const st = engine.current?.status;
  const readRef = useRef<() => LayerInfo>(() => ({ partner: guestNick, partnerRole: live.guestRole, rtt: null, note: null, emote: null, onEmote: () => {} }));
  readRef.current = () => {
    const e = engine.current, s2 = e?.status;
    return {
      partner: guestNick, partnerRole: live.guestRole, rtt: s2?.rtt ?? null,
      note: !s2 ? null
        : s2.guest === "waiting" ? `Waiting for ${guestNick} to join the room…`
        : s2.guest === "away" ? `${guestNick} has gone quiet: the team is covering the ${live.guestRole === "server" ? "tables" : "tickets"} until they're back.`
        : s2.slow ? `The link is slow (${s2.rtt} ms), so ${guestNick}'s taps arrive late.`
        : null,
      emote: e?.emote ?? null, onEmote: (id) => e?.sendEmote(id),
      ...(s2?.slow ? { action: { label: "Finish on my own", run: () => finish("slow") } } : {}),
    };
  };
  const read = useCallback(() => readRef.current(), []);
  const remote: HandsOnRemote | null = useMemo(() => {
    if (!room) return null;
    const pres = presenceSender(room);
    return { onFrame: (s) => pres(s), layer: (stage) => <LiveLayer stage={stage} spot={spot} read={read} /> };
  }, [room, read]);
  useEffect(() => { if (started.current && !ended.current && remote) setCoopRemote(remote); }, [remote, game.phase]);

  const here = st?.guest === "here";
  useEffect(() => { onStatus({ room: !!room, guestHere: here }); }, [room, here]); // eslint-disable-line react-hooks/exhaustive-deps
  // Nothing of its own on screen: the panel says "live tonight", the layer on the stage does the rest.
  return null;
}

// ───────────────────────── the guest ─────────────────────────

interface GuestProps {
  code: string;
  live: LiveDoc;
  hostNick: string;
  /** Back to the turn-based co-op screen (its evening card shows tonight's numbers). */
  onExit: (why: EndWhy | "cant", msg?: string) => void;
}

export function GuestLive({ code, live, hostNick, onExit }: GuestProps) {
  const role = live.guestRole;
  const [room, setRoom] = useState<NamedRoomLike | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [, bump] = useState(0);
  const [summary, setSummary] = useState<ShiftSummary | null>(null);
  const [left, setLeft] = useState(false);
  const engine = useRef<LiveGuest | null>(null);
  const spot = useRef<Spot | null>(null);

  useEffect(() => {
    let alive = true;
    let stops: (() => void)[] = [];
    let joined: NamedRoomLike | null = null;
    void getRoom().then(async (ns) => {
      if (!alive) return;
      if (!ns) { onExit("cant", "Live play isn't available on this page."); return; }
      const j = await joinLive(ns, roomName(code, live.nonce));
      if (!alive) { if ("room" in j) void j.room.leave(); return; }
      if ("error" in j) { setProblem(j.error === "not_permitted" ? `Live play needs Contributor access. Ask ${hostNick}, or play the turn-based day.` : "Couldn't open the live room."); return; }
      joined = j.room;
      const g = new LiveGuest({
        emit: (topic, data) => { j.room.emit(topic, data).catch((e: { code?: string }) => { if (e?.code === "not_permitted") setProblem(`Live play needs Contributor access. Ask ${hostNick}, or play the turn-based day.`); }); },
        now: () => performance.now(),
      }, { nonce: live.nonce, role });
      g.setMe(j.me);
      g.onChange = () => bump((x) => x + 1);
      engine.current = g;
      const t0 = performance.now();
      stops = [j.room.on(TOPIC.st, (m) => g.hear(m)), j.room.on(TOPIC.emo, (m) => g.hear(m)), watchPartner(j.room, () => g.partnerPeer, spot)];
      const t = setInterval(() => {
        g.pump();
        window.__fpCoopLive = { side: "guest", rtt: g.status.rtt, refused: g.refused, seconds: (performance.now() - t0) / 1000, status: g.status };
      }, PUMP_MS);
      stops.push(() => clearInterval(t));
      setRoom(j.room);
    });
    return () => { alive = false; engine.current?.leave(); for (const s of stops) s(); if (joined) void joined.leave(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, live.nonce]);

  const g = engine.current;
  const view = g?.view ?? null;
  const ended = g?.status.ended ?? null;
  const pres = useMemo(() => (room ? presenceSender(room) : null), [room]);
  const readRef = useRef<() => LayerInfo>(() => ({ partner: hostNick, partnerRole: role === "server" ? "chef" : "server", rtt: null, note: null, emote: null, onEmote: () => {} }));
  readRef.current = () => {
    const e = engine.current;
    return {
      partner: hostNick, partnerRole: e?.base?.hostRole ?? (role === "server" ? "chef" : "server"), rtt: e?.status.rtt ?? null,
      note: !e ? null
        : e.status.host === "quiet" ? `Lost touch with ${hostNick}… hang on.`
        : !e.status.on ? `${hostNick} can't hear you yet: the team has your ${role === "server" ? "tables" : "tickets"} for now.`
        : e.status.rtt !== null && e.status.rtt > 400 ? `The link is slow (${e.status.rtt} ms): ${hostNick} may finish on their own.`
        : null,
      emote: e?.emote ?? null, onEmote: (id) => e?.sendEmote(id),
      ...(e?.status.host === "quiet" ? { action: { label: "Back to the co-op day", run: () => { e.leave(); onExit("lost"); } } } : {}),
    };
  };
  const read = useCallback(() => readRef.current(), []);
  const remote: HandsOnRemote | null = useMemo(() => (!pres ? null : { onFrame: (s) => pres(s), layer: (stage) => <LiveLayer stage={stage} spot={spot} read={read} /> }), [pres, read]);

  const leaveShift = () => { g?.leave(); setLeft(true); };

  if (problem) {
    return (
      <div className="card stack stack--sm cooplive__card">
        <h3>No live shift this time</h3>
        <p className="small">{problem}</p>
        <button className="btn btn--primary btn--tap" onClick={() => onExit("cant")}>Back to the co-op day</button>
      </div>
    );
  }
  if (ended || left) {
    const why = left ? "guest" : ended;
    return (
      <div className="card stack stack--sm cooplive__card" role="status">
        <h3>{why === "done" ? "Doors closed" : why === "guest" ? "You left the shift" : why === "slow" ? `${hostNick} finished on their own` : why === "office" ? `${hostNick} went back to the office` : "The live shift has ended"}</h3>
        {why === "slow" && <p className="small muted">The link was too slow for a live shift. The turn-based day still works.</p>}
        {why === "guest" && <p className="small muted">The team covers the {role === "server" ? "tables" : "tickets"} till close.</p>}
        {summary && (
          <dl className="visitnums">
            {role === "server" ? <>
              <div><dt>Plates served</dt><dd>{summary.served}</dd></div>
              <div><dt>Tables cleared</dt><dd>{summary.cleared}</dd></div>
              <div><dt>Bills taken</dt><dd>{summary.payments}</dd></div>
            </> : <>
              <div><dt>Plates cooked</dt><dd>{summary.plates}</dd></div>
              <div><dt>Plate quality</dt><dd>{Math.round(summary.meanQuality)}%</dd></div>
            </>}
            <div><dt>Points</dt><dd>{summary.points}</dd></div>
          </dl>
        )}
        <button className="btn btn--primary btn--tap" onClick={() => onExit(why ?? "done")}>Back to the co-op day</button>
      </div>
    );
  }
  if (!view || !remote) {
    return (
      <div className="card stack stack--sm cooplive__card" role="status">
        <h3>Live tonight: you're {ROLE_DOING[role]}</h3>
        <p className="small">{hostNick} is {ROLE_DOING[role === "server" ? "chef" : "server"]}. The shift starts when they open the doors.</p>
        <p className="small muted">{!room ? "Opening the live room…" : g?.base ? "Connected. Waiting for the doors…" : `Waiting for ${hostNick}…`}</p>
        <button className="btn btn--ghost btn--tap" onClick={() => onExit("cant")}>Play the turn-based day instead</button>
      </div>
    );
  }
  return (
    <div className="cooplive">
      <Suspense fallback={<div className="cooplive__card card small muted">Setting up the floor…</div>}>
        <HandsOnShift
          game={view}
          role={role}
          jumpIn={false}
          runTicks={noop}
          sendResults={(r) => g?.send(r)}
          onSkip={leaveShift}
          onDone={setSummary}
          onScore={setSummary}
          remote={remote}
        />
      </Suspense>
    </div>
  );
}
const noop = () => {};
