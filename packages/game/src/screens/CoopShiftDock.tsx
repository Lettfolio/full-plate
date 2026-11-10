/**
 * Round 12 (G): the host's co-op panel (lazy; App mounts it while this device hosts a session). Bottom left, folds to
 * a pill. It writes the host's side of the session from the game as it goes — tonight's board while planning, the stage,
 * the evening's numbers — and shows the guest's nickname, their emotes and their plan. "Use it" sends the plan's changes
 * as ordinary planning commands through the game's own `send` (the sim checks them like any tap); "Not this time"
 * keeps the host's plan. The host's game stays the only authority: nothing the guest writes is applied without a tap.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Command, GameState } from "@full-plate/sim-core";
import { Icon } from "../components/Icon";
import { weekdayIndex } from "../lib/calendar";
import { getHostFlag, setHostFlag, useHostFlag, type HostFlag } from "../lib/coop/hostFlag";
import { pendingWriter } from "../lib/coop/hand";
import { boardOf, eveningOf, planCommands, type EmoteId, type GuestDoc, type HostDoc, type Stage } from "../lib/coop/protocol";
import { hostResume, RttMeter, watchGuest, type DocWriter } from "../lib/coop/session";
import { dishName, known } from "../lib/visit";
import { gameKey, link, showCode } from "../state/share";
import { EmoteBar, EmoteHeard } from "./CoopShiftParts";
import "./visit.css";

const stageOf = (g: GameState): Stage => (g.phase === "planning" ? "plan" : g.phase === "service" ? "service" : "evening");
const PINGS = 3;

declare global { interface Window { __fpCoopRtt?: number[] } }

interface Props { game: GameState; send: (cmd: Command) => void }

/** Mounted by App while a host flag is stored; renders nothing once it has gone or expired. */
export function CoopShiftDock(p: Props) {
  const flag = useHostFlag();
  useEffect(() => { if (!flag) setHostFlag(null); }, [flag]); // an expired flag: clear it (App unmounts this)
  return flag ? <HostDock key={flag.code} {...p} flag={flag} /> : null;
}

function HostDock({ game, send, flag }: Props & { flag: HostFlag }) {
  const [writer, setWriter] = useState<DocWriter<HostDoc> | null>(() => pendingWriter.get(flag.code) ?? null);
  const [guest, setGuest] = useState<GuestDoc | null>(null);
  const [open, setOpen] = useState(true);
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
      const w = "off" in l ? null : await hostResume(l.db, flag.code, known.dish);
      if (!live) return;
      if (w) setWriter(w); else setHostFlag(null);
    });
    return () => { live = false; };
  }, [flag.code, writer]);

  // the guest's side, live
  useEffect(() => {
    let stop = () => {};
    let live = true;
    void link().then((l) => {
      if (!live || "off" in l) return;
      stop = watchGuest(l.db, flag.code, known.dish, (g) => {
        setGuest(g);
        if (g?.pong) {
          const ms = meter.current.pong(g.pong.n);
          if (ms !== null) { setRtt(meter.current.median); (window.__fpCoopRtt ??= []).push(ms); }
        }
      }, () => setLost(true));
    });
    return () => { live = false; stop(); };
  }, [flag.code]);

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
  const changes = useMemo(() => (plan && plan.n > answered ? planCommands(game, plan, weekday, dishName) : []), [plan, answered, game, weekday]);
  const planWaiting = !!plan && plan.n > answered && plan.day === game.day && game.phase === "planning";
  const [, bump] = useState(0);
  const answer = (used: boolean) => {
    if (!writer || !plan) return;
    if (used) for (const c of changes) send(c.cmd);
    void writer.patch({ answer: { n: plan.n, used } });
    bump((x) => x + 1);
  };
  const end = async () => {
    if (writer) { await writer.patch({ stage: "ended" }); }
    setHostFlag(null);
  };
  const emote = (id: EmoteId) => { emoteN.current = Math.max(Date.now(), emoteN.current + 1); if (writer) void writer.patch({ emote: { id, n: emoteN.current } }); };

  const who = guest && !guest.ended ? guest.nick : null;
  // folds itself for the service (it would cover the room) and opens again for the evening or a new plan
  useEffect(() => { setOpen(game.phase !== "service"); }, [game.phase]);
  useEffect(() => { if (planWaiting) setOpen(true); }, [planWaiting]);
  // another game is open: the session belongs to the one that made it
  if (!mine) return null;
  if (!open) {
    return (
      <div className="coopdock coopdock--pill">
        {who && <EmoteHeard from={who} emote={guest?.emote ?? null} />}
        <button className="btn btn--tap coopdock__pill" onClick={() => setOpen(true)} aria-expanded="false">
          <Icon name="people" size={20} />Co-op{who ? ` · ${who}` : ""}{planWaiting ? " · plan in" : ""}
        </button>
      </div>
    );
  }
  return (
    <aside className="coopdock card" aria-label="Co-op day">
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
          {planWaiting ? (
            <div className="coopplan stack stack--sm">
              <p className="small"><b>{who}</b> sent a plan for tonight{changes.length ? ":" : ", the same as yours."}</p>
              {changes.length > 0 && <ul className="coopplan__list small">{changes.slice(0, 8).map((c, i) => <li key={i}>{c.label}</li>)}{changes.length > 8 && <li>…and {changes.length - 8} more</li>}</ul>}
              <div className="row">
                <button className="btn btn--green btn--tap" onClick={() => answer(true)}>Use it</button>
                <button className="btn btn--ghost btn--tap" onClick={() => answer(false)}>Not this time</button>
              </div>
            </div>
          ) : (
            <p className="small muted">{game.phase === "planning" ? `${who} is planning tonight.` : game.phase === "service" ? `${who} is watching for the evening's numbers.` : `${who} sees tonight's numbers.`}</p>
          )}
        </div>
      )}
      {lost && <p className="small callout">Lost touch with the session. It may have ended.</p>}
      <EmoteBar onSend={emote} disabled={!writer || !who} />
      <button className="btn btn--ghost btn--tap btn--danger-text" onClick={() => void end()}>End the co-op day</button>
    </aside>
  );
}

