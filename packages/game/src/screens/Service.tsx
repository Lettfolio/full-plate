import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../components/Icon";
import type { Command, CustomerId, GameState, Incident, TableId } from "@full-plate/sim-core";
import { RestaurantView, type Highlight } from "../canvas/RestaurantView";
import { canvasDpr, createPerfMeter, perfEnabled, prefersReducedMotion } from "../lib/perfMeter";
import { content, MINUTES_PER_TICK, SERVICE_TICKS } from "../sim";
import type { AppState } from "../state/gameReducer";
import { MoneyText } from "../components/MoneyText";
import { Stars } from "../components/Stars";
import { IncidentCard, useFadingIncidents } from "../components/IncidentCard";
import { GoalsCard } from "../components/GoalsCard";
import { StaffStrip } from "../components/StaffStrip";
import { modalOpen } from "../lib/modal";
import { clockLabel, WEEKDAY_NAMES, weekdayIndex } from "../lib/calendar";
import { dishName, segmentName } from "../lib/content";
import { coveringPhrase } from "../lib/staff";
import { getSettings, useSettings } from "../lib/settings";
import { Term } from "../components/Term";
import { DayRhythm } from "../components/DayRhythm";

/** Round 7: an hour of service in ticks (for the live summary's "this hour" trend). */
export const HOUR_TICKS = Math.max(1, Math.round(60 / MINUTES_PER_TICK));

/** What changed over the last hour, from samples taken at each tick (UI memory only). */
export function hourTrend(samples: ReadonlyMap<number, number>, tick: number, now: number): number | undefined {
  const then = samples.get(Math.max(0, tick - HOUR_TICKS));
  return then === undefined || tick < HOUR_TICKS ? undefined : now - then;
}

const SPEED_ICON: Record<number, IconName> = { 0: "pause", 1: "play", 2: "fastForward", 4: "fastest" };
const SPEED_WORD: Record<number, string> = { 0: "Pause", 1: "Normal", 2: "Fast", 4: "Fastest" };

interface Props {
  game: GameState;
  app: AppState;
  send: (cmd: Command) => void;
  runTicks: (n: number) => void;
  /** Show a short message (used for incidents at 4x instead of pausing). */
  notify?: (text: string) => void;
  /**
   * Round 3, employee shift without hands-on (no sim hook, a manager rung, or a day off): a read-only "watch your
   * shift". The owner answers incidents, comp and 86 are hidden, and the player's sprite is ringed.
   */
  watch?: { title: string; note?: string; playerStaffId?: string; onPlay?: () => void; playLabel?: string };
  /** Round 3, owner: "Jump in" mounts the hands-on canvas for the rest of the service. */
  onJumpIn?: (role: "chef" | "server" | "bar") => void;
  /** "Skip to end of shift": run the remaining ticks now. */
  onSkip?: () => void;
}

/** Space/1/2/4 shortcuts must not hijack a focused control: Space on a button should press it. */
export function shortcutsBlocked(target: EventTarget | null): boolean {
  if (modalOpen()) return true; // keys belong to the open sheet
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest("button, a[href], input, select, textarea, [role=button], [role=radio], [role=tab], [role=checkbox]") !== null;
}

/** What to draw a pulsing ring around for an incident: its table (directly or via its customer) and staff member. */
export function incidentHighlight(game: GameState, inc: Incident): Highlight {
  const tableIds: TableId[] = [];
  const customerIds: CustomerId[] = [];
  if (inc.tableId) tableIds.push(inc.tableId);
  if (inc.customerId) {
    const c = game.customers.find((x) => x.id === inc.customerId);
    if (c?.tableId && c.stage !== "queue") tableIds.push(c.tableId);
    else if (c) customerIds.push(c.id);
  }
  return { tableIds, customerIds, staffIds: inc.staffId ? [inc.staffId] : [] };
}

/** Speed after an INCIDENT_STARTED: pause at 1x/2x when auto-pause is on; never at 4x (toast instead). */
export function speedAfterIncident(speed: Speed, autoPause: boolean): { speed: Speed; toast: boolean } {
  if (speed === 0) return { speed, toast: false };
  if (speed === 4) return { speed, toast: true };
  return autoPause ? { speed: 0, toast: false } : { speed, toast: false };
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

function stageText(c: GameState["customers"][number]): string {
  switch (c.stage) {
    case "seated": return "Reading the menu";
    case "ordered": return `Waiting for ${c.order.map((d) => dishName(content, d)).join(", ") || "food"}`;
    case "eating": return "Tucking in";
    case "paying": return "Asking for the bill";
    default: return "";
  }
}
function stageShort(c: GameState["customers"][number]): string {
  return c.stage === "seated" ? "menus" : c.stage === "ordered" ? "waiting" : c.stage === "eating" ? "eating" : c.stage === "paying" ? "bill" : "";
}

export function Service({ game, app, send, runTicks, notify, watch, onJumpIn, onSkip }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<RestaurantView | null>(null);
  const tickerRef = useRef<HTMLDivElement>(null);
  const [speed, setSpeed] = useState<Speed>(() => getSettings().defaultSpeed);
  const [selected, setSelected] = useState<CustomerId | null>(null);
  const [hoverTable, setHoverTable] = useState<TableId | null>(null);
  const [focusIncident, setFocusIncident] = useState<string | null>(null);
  const [settings] = useSettings();

  const cards = useFadingIncidents(game.incidents);
  const liveIncidents = cards.filter((c) => !c.leaving).map((c) => c.inc);
  // Ring every live incident's subject; the hovered/focused card's subject rings harder.
  const highlight: Highlight = { tableIds: [], customerIds: [], staffIds: [], strong: [] };
  for (const inc of liveIncidents) {
    const one = incidentHighlight(game, inc);
    highlight.tableIds.push(...one.tableIds); highlight.customerIds.push(...one.customerIds); highlight.staffIds.push(...one.staffIds);
    if (inc.id === focusIncident) highlight.strong!.push(...one.tableIds, ...one.customerIds, ...one.staffIds);
  }
  if (watch?.playerStaffId && game.staff.some((x) => x.id === watch.playerStaffId)) {
    highlight.staffIds.push(watch.playerStaffId);
    highlight.strong!.push(watch.playerStaffId);
  }

  const watchRef = useRef(!!watch);
  watchRef.current = !!watch;
  // latest values for the rAF loop without restarting it
  const live = useRef({ game, speed, selected, hoverTable, runTicks, highlight });
  live.current = { game, speed, selected, hoverTable, runTicks, highlight };

  // Incident alert: pause (1x/2x, if enabled) or a toast (4x). Fires once per INCIDENT_STARTED.
  const lastAlert = useRef(app.incidentAlert.seq);
  useEffect(() => {
    if (app.incidentAlert.seq === lastAlert.current) return;
    lastAlert.current = app.incidentAlert.seq;
    if (watchRef.current) return; // the owner deals with it
    const next = speedAfterIncident(live.current.speed, settings.autoPause);
    if (next.speed !== live.current.speed) setSpeed(next.speed);
    // Paused for a decision: put keyboard focus on the new card's first available option (only if focus isn't
    // already in a text field), so Tab/Enter users and screen readers land on the choice.
    if (next.speed === 0 && app.incidentAlert.incidentId) {
      const id = app.incidentAlert.incidentId;
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return;
        document.querySelector<HTMLButtonElement>(`[data-incident="${CSS.escape(id)}"] .incident__opt:not(:disabled)`)?.focus();
      });
    }
    if (next.toast) {
      const inc = game.incidents?.find((i) => i.id === app.incidentAlert.incidentId);
      notify?.(`${inc?.title ?? "Something's come up"} — see the right-hand panel.`);
    }
  }, [app.incidentAlert, settings.autoPause, game.incidents, notify]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const stage = stageRef.current!;
    const view = new RestaurantView(canvas);
    viewRef.current = view;
    const ro = new ResizeObserver(() => {
      const r = stage.getBoundingClientRect();
      view.resize(r.width, r.height, canvasDpr());
    });
    ro.observe(stage);
    const r = stage.getBoundingClientRect();
    view.resize(r.width, r.height, canvasDpr());

    // Round 8: `?perf=1` draws a frame-time counter in the corner (off by default)
    const perf = perfEnabled() ? createPerfMeter("floor") : undefined;
    let raf = 0;
    let last = performance.now();
    let carry = 0;
    const frame = (now: number) => {
      perf?.begin(performance.now());
      const L = live.current;
      const due = ticksDue(carry, now - last, modalOpen() ? 0 : L.speed); // a sheet over service holds the clock
      carry = due.carry;
      last = now;
      if (due.n > 0) L.runTicks(due.n);
      view.render(L.game, { content, speed: L.speed, selected: L.selected, hoverTable: L.hoverTable, highlight: L.highlight, now, reducedMotion: prefersReducedMotion() });
      if (perf) { perf.end(performance.now()); perf.draw(canvas.getContext("2d")!, 6, 6); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); viewRef.current = null; };
  }, []);

  // keyboard: space = pause/resume, 1/2/4 = speeds (not while a control has focus)
  useEffect(() => {
    let resume: Speed = getSettings().defaultSpeed;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") { setSelected(null); return; }
      if (shortcutsBlocked(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setSpeed((s) => { if (s) { resume = s; return 0; } return resume; });
      } else if (e.key === "1") setSpeed(1);
      else if (e.key === "2") setSpeed(2);
      else if (e.key === "3" || e.key === "4") setSpeed(4);
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
  const walkouts = t.walkouts ?? 0;
  const avg = app.ratings.count ? app.ratings.sum / app.ratings.count : 0;
  const queueing = game.customers.filter((c) => c.stage === "queue").reduce((a, c) => a + c.partySize, 0);
  const seatedParties = game.customers.filter((c) => c.tableId && c.stage !== "left" && c.stage !== "queue").length;
  const progress = Math.min(1, game.tick / SERVICE_TICKS);
  // Live summary trend: one sample per tick of covers / walk-outs / queue (cosmetic memory, reset each day).
  const samples = useRef<{ day: number; covers: Map<number, number>; walk: Map<number, number>; queue: Map<number, number> }>({ day: -1, covers: new Map(), walk: new Map(), queue: new Map() });
  if (samples.current.day !== game.day) samples.current = { day: game.day, covers: new Map(), walk: new Map(), queue: new Map() };
  if (!samples.current.covers.has(game.tick)) {
    samples.current.covers.set(game.tick, covers);
    samples.current.walk.set(game.tick, walkouts);
    samples.current.queue.set(game.tick, queueing);
  }
  const trend = {
    covers: hourTrend(samples.current.covers, game.tick, covers),
    walk: hourTrend(samples.current.walk, game.tick, walkouts),
    queue: hourTrend(samples.current.queue, game.tick, queueing),
  };
  const selIndex = sel ? game.tables.findIndex((x) => x.id === sel.tableId) + 1 : 0;
  const covering = game.ownerCovering ?? [];
  const seated = game.customers
    .filter((c) => c.tableId && c.stage !== "left" && c.stage !== "queue")
    .map((c) => ({ c, n: game.tables.findIndex((x) => x.id === c.tableId) + 1 }))
    .sort((a, b) => a.n - b.n);

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
        {!watch && <DayRhythm beat="service" weekday={WEEKDAY_NAMES[weekdayIndex(game.day)]!} compact />}
        {watch && (
          <div className="card watchcard" role="status">
            <div className="row">
              <span aria-hidden="true">👀</span>
              <b className="spacer">{watch.title}</b>
            </div>
            {watch.note && <div className="small muted">{watch.note}</div>}
            <div className="row row--wrap" style={{ marginTop: 8 }}>
              {watch.onPlay && <button className="btn btn--primary watchcard__play" onClick={watch.onPlay}>{watch.playLabel ?? "Play my shift"}</button>}
              {onSkip && <button className="btn btn--sm" onClick={onSkip}>Skip to end of shift</button>}
            </div>
          </div>
        )}
        {cards.length > 0 && (
          <div className="incidents" aria-label="Problems to deal with">
            {cards.map(({ inc, leaving }) => (
              <IncidentCard key={inc.id} incident={inc} leaving={leaving} tick={game.tick} cash={game.cash} send={watch ? () => {} : send} onFocusSubject={setFocusIncident} readOnly={!!watch} />
            ))}
          </div>
        )}

        <div className="card" style={{ padding: 14 }}>
          <div className="clock">
            <div>
              <div className="clock__day">{WEEKDAY_NAMES[weekdayIndex(game.day)]}</div>
              <div className="clock__time" aria-live="off">{clockLabel(game.tick)}</div>
            </div>
            <div className="clock__track">
              <div className="clock__bar"><div className="clock__fill" style={{ width: `${progress * 100}%` }} /></div>
              <div className="clock__ends"><span>12:00 open</span><span>22:00 close</span></div>
            </div>
          </div>
          <StaffStrip game={game} send={send} readOnly={!!watch} />
          <div className="speeds speeds--deck" role="group" aria-label="Speed" style={{ marginTop: 12 }}>
            {SPEEDS.map((sp) => (
              <button key={sp} className={`speed speed--${sp}`} aria-pressed={speed === sp} aria-label={sp === 0 ? "Pause" : `Speed ${sp}x`} onClick={() => setSpeed(sp)} title={sp === 0 ? "Pause (Space)" : `${SPEED_WORD[sp]} (${sp === 4 ? "4" : sp})`}>
                <span className="speed__icon" aria-hidden="true"><Icon name={SPEED_ICON[sp]!} size={20} /></span>
                <span className="speed__word">{sp === 0 ? (speed === 0 ? "Paused" : "Pause") : `${sp}×`}</span>
              </button>
            ))}
          </div>
        </div>

        {covering.length > 0 && (
          <div className="banner banner--amber" role="status">
            <Icon name="warning" size={22} />
            <span>You're covering {coveringPhrase(covering)} yourself — expect slow food.</span>
          </div>
        )}

        {/* Round 7: the live summary — four things a child can read at a glance, each with what changed this hour. */}
        <div className="livesum" aria-label="Service so far">
          <LiveTile icon="service" label={<Term id="covers" inline>Served</Term>} value={covers} trend={trend.covers} good="up" />
          <LiveTile icon="smile" label="Happy" value={app.ratings.count ? <><span className="livesum__stars"><Stars rating={avg} size={15} /></span> {avg.toFixed(1)}</> : "—"} />
          <LiveTile icon="timer" label="Waiting" value={queueing} trend={trend.queue} good="down" />
          <LiveTile key={`walk-${walkouts}`} icon="walkOut" label="Walked out" value={walkouts} trend={trend.walk} good="down" bad={walkouts > 0} flashKey={walkouts} />
        </div>
        <div className="livesum__till">Takings so far <MoneyText pence={t.revenue ?? 0} whole countUp="change" /></div>
        {!watch && onJumpIn && (
          <div className="card jumpin">
            <div className="row">
              <Icon name="chefHat" size={22} />
              <b className="spacer">Jump in</b>
              <span className="xs faint">for the rest of service</span>
            </div>
            <div className="row row--wrap" style={{ marginTop: 6 }}>
              <button className="btn btn--sm" onClick={() => onJumpIn("chef")}>On the pass</button>
              <button className="btn btn--sm" onClick={() => onJumpIn("server")}>On the floor</button>
              <button className="btn btn--sm" onClick={() => onJumpIn("bar")}>Behind the bar</button>
            </div>
          </div>
        )}
        <GoalsCard goals={game.goals} justDone={app.goalsJustDone} collapsible />

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

        {!watch && <div className="card actions" style={{ padding: 12 }}>
          <h4>Manager's actions</h4>
          {sel ? (
            <div className="selected">
              <div className="spacer">
                <div style={{ fontWeight: 800 }}>Table {selIndex} · {sel.partySize} {segmentName(content, sel.segment).toLowerCase()}</div>
                <div className="xs muted">
                  {stageText(sel)}
                  {" · patience "}{Math.round(sel.patience)}
                </div>
              </div>
              <button className="btn btn--primary btn--sm" disabled={!!sel.comped} onClick={() => send({ type: "COMP_TABLE", customerId: sel.id })} title="Their meal is on the house: big happiness boost, no revenue">
                {sel.comped ? "Comped ✓" : "Comp this table"}
              </button>
            </div>
          ) : (
            <div className="selected__none">Click a table on the floor, or pick one below.</div>
          )}
          {seated.length > 0 && (
            <ul className="tablelist" aria-label="Seated tables (Tab to move, Enter to select)">
              {seated.map(({ c, n }) => (
                <li key={c.id}><button
                  aria-pressed={sel?.id === c.id}
                  aria-label={`Table ${n}: ${c.partySize} ${segmentName(content, c.segment).toLowerCase()}, ${stageText(c).toLowerCase()}, patience ${Math.round(c.patience)}`}
                  className="tablelist__item"
                  onClick={() => setSelected(sel?.id === c.id ? null : c.id)}
                  onFocus={() => setHoverTable(c.tableId ?? null)}
                  onBlur={() => setHoverTable(null)}
                >
                  <b>T{n}</b>
                  <span className="spacer">{c.partySize} · {stageShort(c)}</span>
                  <span className={`patience-dot patience-dot--${c.patience < 34 ? "low" : c.patience < 67 ? "mid" : "ok"}`} aria-hidden="true" />
                </button></li>
              ))}
            </ul>
          )}
          <div className="xs faint" style={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }} title="Kitchen slang: to 86 a dish means to stop selling it for the rest of the day">
            Take off today's menu (86)
          </div>
          <div className="eightysix">
            {game.menu.filter((m) => m.active).map((m) => {
              const off = (game.eightySixed ?? []).includes(m.dishId);
              const name = dishName(content, m.dishId);
              return (
                <div key={m.dishId} className={`eightysix__row ${off ? "eightysix__row--off" : ""}`}>
                  <span>{name}</span>
                  <MoneyText pence={m.price} className="xs muted" />
                  <button
                    className="btn btn--ghost btn--sm"
                    disabled={off}
                    onClick={() => send({ type: "EIGHTY_SIX", dishId: m.dishId })}
                    title={off ? `${name} is off for today` : `"86" ${name}: stop selling it for the rest of today (back on tomorrow)`}
                    aria-label={off ? `${name} is off today` : `Take ${name} off today's menu`}
                  >
                    {off ? "Off today" : "86"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>}
      </aside>
    </div>
  );
}

/** One live-summary tile: icon, label, big value, and "▲ 3 this hour" coloured by whether up is good. */
function LiveTile({ icon, label, value, trend, good, bad = false, flashKey }: { icon: IconName; label: React.ReactNode; value: React.ReactNode; trend?: number | undefined; good?: "up" | "down"; bad?: boolean; flashKey?: number }) {
  const dir = trend === undefined || trend === 0 ? "flat" : trend > 0 ? "up" : "down";
  const tone = dir === "flat" ? "flat" : (dir === good ? "good" : "bad");
  return (
    <div className={`livesum__tile ${bad ? "livesum__tile--bad" : ""}`} data-flash={flashKey ? "1" : undefined}>
      <span className="livesum__icon" aria-hidden="true"><Icon name={icon} size={22} /></span>
      <div className="livesum__k">{label}</div>
      <div className="livesum__v">{value}</div>
      {trend !== undefined && (
        <div className={`livesum__trend livesum__trend--${tone}`}>
          {dir !== "flat" && <Icon name={dir === "up" ? "trendUp" : "trendDown"} size={16} />}{dir === "flat" ? "steady" : `${Math.abs(trend)} this hour`}
        </div>
      )}
    </div>
  );
}
