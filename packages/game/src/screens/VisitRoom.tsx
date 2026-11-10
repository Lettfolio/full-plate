/**
 * Round 12 (G): a friend's restaurant, read-only — the room drawn by the real floor renderer (empty-room preview), the
 * menu, the team, the reviews the sim wrote, this week's numbers, and one review back: 1–5 stars and up to three
 * compliments from a fixed list. Everything shown came through `checkSnapshot` (state/share.ts).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { content } from "../sim";
import { Icon } from "../components/Icon";
import { MoneyText } from "../components/MoneyText";
import { Stars } from "../components/Stars";
import { Term } from "../components/Term";
import { RestaurantView } from "../canvas/RestaurantView";
import { canvasDpr, prefersReducedMotion } from "../lib/perfMeter";
import { dateLabel } from "../lib/calendar";
import { dishName, districtName, roomState, ROLE_WORD, weekTotals } from "../lib/visit";
import { COMPLIMENTS, leaveReview, MAX_PICKS, reviewedToday, showCode, type ReviewResult, type SDb, type ShareSnapshot } from "../state/share";
import type { GameState } from "@full-plate/sim-core";
import { defaultBrand, logoDataUrl, parseBrand } from "../lib/brand";
import "./visit.css";

/** R12 review: the owner's brand kit, if the share carries one (each field re-checked; anything odd → the name's default). */
export function visitBrandLogo(snap: Pick<ShareSnapshot, "name" | "brand">): string | null {
  const b = snap.brand;
  if (!b) return null;
  const f = (k: string) => (typeof b[k] === "string" ? String(b[k]) : "");
  const code = ["1", f("shape"), f("motif"), f("letter"), f("primary"), f("accent"), f("uniform"), f("uniformColour"), f("menu")].join(".");
  return logoDataUrl(parseBrand(code, defaultBrand(snap.name)));
}

interface Props { db: SDb; uid: string; code: string; snap: ShareSnapshot; mine: boolean; nick: string; onExit: () => void }

function Room({ game, name }: { game: GameState; name: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let view: RestaurantView;
    try { view = new RestaurantView(canvas.current!); } catch { return; } // no 2D canvas (tests): the lists still work
    const el = wrap.current!;
    const fit = () => { if (el.isConnected) view.resize(el.clientWidth, el.clientHeight, canvasDpr()); };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : undefined;
    ro?.observe(el);
    let raf = 0;
    const frame = (t: number) => { view.render(game, { content, speed: 0, now: t, reducedMotion: prefersReducedMotion(), preview: true }); raf = requestAnimationFrame(frame); };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [game]);
  return (
    <div className="visitroom" ref={wrap}>
      <canvas ref={canvas} className="visitroom__canvas" role="img" aria-label={`The dining room at ${name}: ${game.tables.length} tables`} />
    </div>
  );
}

const SOURCE: Record<string, string> = { walkin: "A guest", online: "Online", critic: "A critic", wordofmouth: "Word of mouth" };

export function VisitRoom({ db, uid, code, snap, mine, nick, onExit }: Props) {
  const room = useMemo(() => roomState(snap), [snap]);
  const week = weekTotals(snap);
  const [stars, setStars] = useState(0);
  const [picks, setPicks] = useState<string[]>([]);
  const [state, setState] = useState<ReviewResult | "sending" | "error" | null>(mine ? "own" : null);
  useEffect(() => { if (!mine) void reviewedToday({ db, uid }, code).then((y) => { if (y) setState("already"); }).catch(() => {}); }, [db, uid, code, mine]);
  const send = async () => {
    setState("sending");
    try { setState(await leaveReview({ db, uid }, code, { stars, picks, nick, mine })); } catch { setState("error"); }
  };
  const seats = snap.tables.reduce((a, s) => a + s, 0);
  const logo = useMemo(() => visitBrandLogo(snap), [snap]);
  const on = snap.menu.filter((m) => m.active);

  return (
    <div className="page visit stack">
      <header className="row visit__head">
        <div className="spacer">
          <p className="small muted">Visiting · code {showCode(code)}</p>
          <h2 className="row">{logo && <img className="brandlogo" src={logo} width={40} height={40} alt="" aria-hidden />}{snap.name}</h2>
          <p className="small muted">{[districtName(snap.districtId), dateLabel(snap.day)].filter(Boolean).join(" · ")}{snap.date && ` · shared ${snap.date}`}</p>
        </div>
        <button className="btn btn--ghost btn--tap" onClick={onExit}><Icon name="back" size={20} />Leave</button>
      </header>

      <div className="visit__grid">
        <section className="card stack stack--sm visit__roomcard">
          <h3>The dining room</h3>
          <Room game={room} name={snap.name} />
          <p className="small muted">{snap.tables.length} tables · {seats} seats</p>
        </section>

        <section className="card stack stack--sm" aria-labelledby="visit-week">
          <h3 id="visit-week">This week</h3>
          {week.nights ? (
            <dl className="visitnums">
              <div><dt>Nights open</dt><dd>{week.nights}</dd></div>
              <div><dt><Term id="covers" inline>Covers</Term></dt><dd>{week.covers}</dd></div>
              <div><dt><Term id="takings" inline>Takings</Term></dt><dd><MoneyText pence={week.revenue} whole /></dd></div>
              <div><dt>Profit</dt><dd><MoneyText pence={week.profit} whole /></dd></div>
              <div><dt>Average rating</dt><dd><Stars rating={week.rating} size={18} /></dd></div>
            </dl>
          ) : <p className="small muted">Not open yet: no numbers so far.</p>}
        </section>

        <section className="card stack stack--sm" aria-labelledby="visit-menu">
          <h3 id="visit-menu">Menu</h3>
          {on.length ? (
            <ul className="visitlist">{on.map((m) => <li key={m.dishId} className="visitlist__row"><span className="spacer">{dishName(m.dishId)}</span><MoneyText pence={m.price} /></li>)}</ul>
          ) : <p className="small muted">Nothing on the menu yet.</p>}
        </section>

        <section className="card stack stack--sm" aria-labelledby="visit-team">
          <h3 id="visit-team">The team</h3>
          {snap.staff.length ? (
            <ul className="visitlist">{snap.staff.map((s, i) => <li key={i} className="visitlist__row"><span className="spacer">{s.name}</span><span className="small muted">{ROLE_WORD[s.role]}</span></li>)}</ul>
          ) : <p className="small muted">The owner does everything.</p>}
        </section>

        <section className="card stack stack--sm" aria-labelledby="visit-reviews">
          <h3 id="visit-reviews">What guests said</h3>
          {snap.reviews.length ? (
            <ul className="visitlist">{snap.reviews.map((r, i) => (
              <li key={i} className="visitreview"><span className="row"><Stars rating={r.rating} size={16} /><span className="small muted">{SOURCE[r.source]}{r.dishId ? ` · ${dishName(r.dishId)}` : ""}</span></span><span className="small">“{r.text}”</span></li>
            ))}</ul>
          ) : <p className="small muted">No reviews yet.</p>}
        </section>

        <section className="card stack stack--sm visit__leave" aria-labelledby="visit-leave">
          <h3 id="visit-leave">Leave a review</h3>
          {state === "own" ? <p className="small muted">This is your own restaurant: friends leave the reviews.</p>
            : state === "already" ? <p className="small">You've reviewed {snap.name} today. Come back tomorrow.</p>
            : state === "sent" ? <p className="small callout callout--good" role="status">Sent. {snap.name} will see it under Visitors.</p>
            : (
              <>
                <div className="visitstars" role="group" aria-label="Your stars">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" aria-pressed={stars === n} aria-label={`${n} star${n === 1 ? "" : "s"}`} className={`visitstars__btn ${n <= stars ? "is-on" : ""}`} onClick={() => setStars(n)}>★</button>
                  ))}
                </div>
                <p className="small muted">Pick up to {MAX_PICKS}:</p>
                <div className="visitpicks">
                  {COMPLIMENTS.map((c) => {
                    const on = picks.includes(c.id);
                    return <button key={c.id} type="button" className="btn btn--tap visitpicks__btn" aria-pressed={on} disabled={!on && picks.length >= MAX_PICKS} onClick={() => setPicks(on ? picks.filter((p) => p !== c.id) : [...picks, c.id])}>{c.text}</button>;
                  })}
                </div>
                <div className="row">
                  <button className="btn btn--primary btn--tap" disabled={!stars || state === "sending"} onClick={() => void send()}>{state === "sending" ? "Sending…" : "Send review"}</button>
                  {nick && <span className="small muted">as <b>{nick}</b></span>}
                </div>
                {state === "error" && <p className="small callout callout--warn" role="alert">That didn't go through. Your friend's link may only let you look (ask them for Contributor access).</p>}
              </>
            )}
        </section>
      </div>
    </div>
  );
}
export default VisitRoom;
