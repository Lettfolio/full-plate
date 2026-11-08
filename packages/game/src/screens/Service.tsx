import { useEffect, useRef, useState } from "react";
import type { Command, CustomerId, GameState, TableId } from "@full-plate/sim-core";
import { RestaurantView } from "../canvas/RestaurantView";
import { content, SERVICE_TICKS } from "../sim";
import type { AppState } from "../state/gameReducer";
import { MoneyText } from "../components/MoneyText";
import { Stars } from "../components/Stars";
import { clockLabel } from "../lib/calendar";
import { dishName, segmentName } from "../lib/content";

interface Props {
  game: GameState;
  app: AppState;
  send: (cmd: Command) => void;
  runTicks: (n: number) => void;
}

export const SPEEDS = [0, 1, 2, 4] as const;
export type Speed = (typeof SPEEDS)[number];
/** Ticks per real second at 1x. 120 ticks → one service ≈ 60 s at 1x, 15 s at 4x. */
export const TICKS_PER_SECOND_1X = 2;

/**
 * Converts elapsed real time into a whole number of sim ticks, carrying the remainder.
 * Exported for tests. Caps a single frame at 8 ticks so a backgrounded tab doesn't fast-forward.
 */
export function ticksDue(carry: number, dtMs: number, speed: number): { n: number; carry: number } {
  if (speed <= 0) return { n: 0, carry: 0 };
  const acc = carry + (Math.min(dtMs, 250) / 1000) * TICKS_PER_SECOND_1X * speed;
  const n = Math.min(8, Math.floor(acc + 1e-9)); // epsilon: 60 frames × (1/60 s) must make exactly 2 ticks
  return { n, carry: Math.max(0, acc - n) };
}

export function Service({ game, app, send, runTicks }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<RestaurantView | null>(null);
  const tickerRef = useRef<HTMLDivElement>(null);
  const [speed, setSpeed] = useState<Speed>(1);
  const [selected, setSelected] = useState<CustomerId | null>(null);
  const [hoverTable, setHoverTable] = useState<TableId | null>(null);

  // latest values for the rAF loop without restarting it
  const live = useRef({ game, speed, selected, hoverTable, runTicks });
  live.current = { game, speed, selected, hoverTable, runTicks };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const stage = stageRef.current!;
    const view = new RestaurantView(canvas);
    viewRef.current = view;
    const ro = new ResizeObserver(() => {
      const r = stage.getBoundingClientRect();
      view.resize(r.width, r.height);
    });
    ro.observe(stage);
    const r = stage.getBoundingClientRect();
    view.resize(r.width, r.height);

    let raf = 0;
    let last = performance.now();
    let carry = 0;
    const frame = (now: number) => {
      const L = live.current;
      const due = ticksDue(carry, now - last, L.speed);
      carry = due.carry;
      last = now;
      if (due.n > 0) L.runTicks(due.n);
      view.render(L.game, { content, speed: L.speed, selected: L.selected, hoverTable: L.hoverTable, now });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); viewRef.current = null; };
  }, []);

  // keyboard: space = pause/resume, 1/2/3 = speeds
  useEffect(() => {
    let resume: Speed = 1;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        setSpeed((s) => { if (s) { resume = s; return 0; } return resume; });
      } else if (e.key === "1") setSpeed(1);
      else if (e.key === "2") setSpeed(2);
      else if (e.key === "3" || e.key === "4") setSpeed(4);
      else if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // auto-scroll the ticker
  useEffect(() => {
    const el = tickerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [app.ticker.length]);

  // drop selection when the party leaves
  const sel = selected ? game.customers.find((c) => c.id === selected && c.stage !== "left" && c.tableId) : undefined;
  useEffect(() => { if (selected && !sel) setSelected(null); }, [selected, sel]);

  const toLocal = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onClick = (e: React.MouseEvent) => {
    const p = toLocal(e);
    const hit = viewRef.current?.pick(game, p.x, p.y);
    setSelected(hit?.customerId ?? null);
  };
  const onMove = (e: React.MouseEvent) => {
    const p = toLocal(e);
    const hit = viewRef.current?.pick(game, p.x, p.y);
    const t = hit?.customerId ? hit.tableId : null;
    if (t !== hoverTable) setHoverTable(t);
  };

  const t = game.todays;
  const covers = t.covers ?? 0;
  const avg = app.ratings.count ? app.ratings.sum / app.ratings.count : 0;
  const queueing = game.customers.filter((c) => c.stage === "queue").reduce((a, c) => a + c.partySize, 0);
  const seatedParties = game.customers.filter((c) => c.tableId && c.stage !== "left" && c.stage !== "queue").length;
  const progress = Math.min(1, game.tick / SERVICE_TICKS);
  const selIndex = sel ? game.tables.findIndex((x) => x.id === sel.tableId) + 1 : 0;

  return (
    <div className="service">
      <div className="service__stage" ref={stageRef}>
        <canvas
          ref={canvasRef}
          onClick={onClick}
          onMouseMove={onMove}
          onMouseLeave={() => setHoverTable(null)}
          style={{ cursor: hoverTable ? "pointer" : "default" }}
          aria-label={`Restaurant floor: ${seatedParties} tables in use, ${queueing} people queueing outside. Click a table to select it.`}
          role="img"
        />
        {speed === 0 && <div className="paused-badge">PAUSED</div>}
      </div>

      <aside className="service__side">
        <div className="card" style={{ padding: 14 }}>
          <div className="clock">
            <div className="clock__time" aria-live="off">{clockLabel(game.tick)}</div>
            <div className="clock__track">
              <div className="clock__bar"><div className="clock__fill" style={{ width: `${progress * 100}%` }} /></div>
              <div className="clock__ends"><span>12:00 open</span><span>22:00 close</span></div>
            </div>
          </div>
          <div className="speeds" role="group" aria-label="Speed" style={{ marginTop: 12 }}>
            {SPEEDS.map((s) => (
              <button key={s} className="speed" aria-pressed={speed === s} aria-label={s === 0 ? "Pause" : `Speed ${s}x`} onClick={() => setSpeed(s)} title={s === 0 ? "Pause (Space)" : `${s}x`}>
                {s === 0 ? "❚❚" : `${s}×`}
              </button>
            ))}
          </div>
        </div>

        <div className="counters">
          <div className="counter"><div className="counter__k">Covers</div><div className="counter__v">{covers}</div></div>
          <div className="counter"><div className="counter__k">Revenue</div><div className="counter__v"><MoneyText pence={t.revenue ?? 0} whole /></div></div>
          <div className={`counter ${(t.walkouts ?? 0) > 0 ? "counter--bad" : ""}`}><div className="counter__k">Walkouts</div><div className="counter__v">{t.walkouts ?? 0}</div></div>
          <div className="counter"><div className="counter__k">Rating</div><div className="counter__v" style={{ fontSize: 18, paddingTop: 3 }}>{app.ratings.count ? <><Stars rating={avg} size={14} /> <span className="small">{avg.toFixed(1)}</span></> : <span className="faint small">—</span>}</div></div>
        </div>

        <div className="card" style={{ padding: 12, flex: 1, display: "flex", flexDirection: "column", minHeight: 160 }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <h4 className="spacer">What's happening</h4>
            <span className="xs faint">{queueing} queueing · {seatedParties} tables in</span>
          </div>
          <div className="ticker" ref={tickerRef} aria-live="polite" aria-relevant="additions">
            {app.ticker.length === 0 && <div className="ticker__empty">Doors open at noon. Customers will start drifting in…</div>}
            {app.ticker.map((l, i) => (
              <div key={`${l.day}-${l.tick}-${i}`} className={`ticker__line ticker__line--${l.kind}`}>
                <time>{clockLabel(l.tick)}</time>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card actions" style={{ padding: 12 }}>
          <h4>Manager's actions</h4>
          {sel ? (
            <div className="selected">
              <div className="spacer">
                <div style={{ fontWeight: 800 }}>Table {selIndex} · {sel.partySize} {segmentName(content, sel.segment).toLowerCase()}</div>
                <div className="xs muted">
                  {sel.stage === "seated" && "Reading the menu"}
                  {sel.stage === "ordered" && `Waiting for ${sel.order.map((d) => dishName(content, d)).join(", ") || "food"}`}
                  {sel.stage === "eating" && "Tucking in"}
                  {sel.stage === "paying" && "Asking for the bill"}
                  {" · patience "}{Math.round(sel.patience)}
                </div>
              </div>
              <button className="btn btn--primary btn--sm" disabled={!!sel.comped} onClick={() => send({ type: "COMP_TABLE", customerId: sel.id })} title="Their meal is on the house: big happiness boost, no revenue">
                {sel.comped ? "Comped ✓" : "Comp this table"}
              </button>
            </div>
          ) : (
            <div className="selected__none">Click a table on the floor to select it.</div>
          )}
          <div className="xs faint" style={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }}>86 a dish (pull it for today)</div>
          <div className="eightysix">
            {game.menu.filter((m) => m.active).map((m) => {
              const off = (game.eightySixed ?? []).includes(m.dishId);
              return (
                <div key={m.dishId} className={`eightysix__row ${off ? "eightysix__row--off" : ""}`}>
                  <span>{dishName(content, m.dishId)}</span>
                  <MoneyText pence={m.price} className="xs muted" />
                  <button className="btn btn--ghost btn--sm" disabled={off} onClick={() => send({ type: "EIGHTY_SIX", dishId: m.dishId })}>
                    {off ? "86'd" : "86"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </div>
  );
}
