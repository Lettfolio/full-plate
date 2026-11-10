/**
 * Round 10 (A): the Decorate tab — make it *her* restaurant. Lazy-loaded from Planning.
 *
 * Left: the dining room drawn by the real RestaurantView, showing the item under the pointer (or the one tapped) as
 * if it were already fitted, with the room's style and what the decor adds. Right: a row of slot buttons (floor,
 * walls, lights…) and that slot's catalogue as cards — price, effect words, the room's prestige before → after, and
 * one button: "Buy · fit tomorrow", "Coming tomorrow", "In your restaurant", or how much more cash is needed. The item
 * in the room shows its wear: "Looking tired — refresh £40".
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Command, DecorItemDef, DecorSlot, GameState } from "@full-plate/sim-core";
import { content, DECOR_SLOTS, decorCatalogue, decorEffects, decorStyleName, decorWear, installedDecor } from "../../sim";
import { loadDecorArt, RestaurantView } from "../../canvas/RestaurantView";
import { canvasDpr, prefersReducedMotion } from "../../lib/perfMeter";
import { SLOT_LABEL } from "../../lib/decor";
import { Icon, type IconName } from "../../components/Icon";
import { Panel, StatTile } from "../../components/Panel";
import { MoneyText } from "../../components/MoneyText";
import { formatPence } from "../../lib/format";
import "./decorate.css";

// The preview always shows decor: fetch the decor art with the tab.
void loadDecorArt();

interface Props { game: GameState; send: (cmd: Command) => void }

export const SLOT_ICON: Record<DecorSlot, IconName> = {
  floor: "floor", walls: "paint", lighting: "lamp", seating: "chair", tables: "restaurant", signage: "sign", plants: "plant", music: "music", window: "window",
};
const TAG_WORD: Record<string, string> = { cosy: "Cosier", fun: "More fun", smart: "Smarter", posh: "Posher" };

/** The words on a card: the item's style first, then what it does. */
export function effectWords(item: DecorItemDef): string[] {
  const e = item.effects;
  const words = item.tags.map((t) => TAG_WORD[t] ?? t);
  if (e.prestige) words.push(`+${e.prestige} prestige`);
  if (e.popularity) words.push(`+${e.popularity} popularity`);
  if (e.comfort) words.push(e.comfort > 1 ? "Much comfier" : "Comfier");
  if (e.stay) words.push("Guests stay longer");
  if (e.spend) words.push("Guests order more");
  return words;
}

/** `game` with `item` fitted in its slot today (what the preview draws). */
export function withItem(game: GameState, item: DecorItemDef): GameState {
  const slots = { ...(game.decor?.slots ?? {}) };
  if (item.starter) delete slots[item.slot];
  else slots[item.slot] = { itemId: item.id, since: game.day };
  return { ...game, decor: { ...(game.decor ?? {}), slots } };
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

export function DecorateTab({ game, send }: Props) {
  const [slot, setSlot] = useState<DecorSlot>("floor");
  const [hover, setHover] = useState<DecorItemDef | null>(null);
  const [picked, setPicked] = useState<DecorItemDef | null>(null);
  const preview = hover ?? (picked?.slot === slot ? picked : null);
  const shown = useMemo(() => (preview ? withItem(game, preview) : game), [game, preview]);
  const now = decorEffects(content, game);
  const room = decorStyleName(content, game);
  const canShop = game.phase === "planning" || game.phase === "evening";
  const pending = new Map((game.decor?.pending ?? []).map((p) => [p.slot, p.itemId]));
  const here = installedDecor(content, game, slot);
  const wear = here ? decorWear(here.item, here.since, game.day) : "fresh";

  return (
    <div className="decorate">
      <div className="decorate__preview">
        <Panel title="Your dining room" icon="paint" sub={<span className="decorate__style">{room}</span>}>
          <RoomCanvas game={shown} />
          <p className="decorate__caption small" aria-live="polite">
            {preview && preview.id !== here?.item.id
              ? <>Trying out <b>{preview.name}</b>{preview.starter ? "" : " — not bought yet"}.</>
              : <>This is your room today.</>}
          </p>
          <div className="decorate__tiles">
            <StatTile label="Prestige from decor" value={signed(now.prestige)} />
            <StatTile label="Popularity from decor" value={signed(now.popularity)} />
            <StatTile label="Upkeep a day" value={<MoneyText pence={now.upkeep} />} />
          </div>
        </Panel>
      </div>

      <div className="decorate__shop">
        <div className="decorate__slots" role="group" aria-label="Choose what to decorate">
          {DECOR_SLOTS.map((s) => {
            const it = installedDecor(content, game, s);
            const tired = !!it?.bought && decorWear(it.item, it.since, game.day) === "tired";
            return (
              <button
                key={s}
                className={`decorate__slot ${s === slot ? "decorate__slot--on" : ""}`}
                aria-pressed={s === slot}
                onClick={() => { setSlot(s); setHover(null); }}
              >
                <Icon name={SLOT_ICON[s]} size={22} />
                <span>{SLOT_LABEL[s]}</span>
                {pending.has(s) && <><span className="decorate__dot decorate__dot--new" title="Coming tomorrow" aria-hidden="true" /><span className="sr-only">, coming tomorrow</span></>}
                {tired && <><span className="decorate__dot decorate__dot--tired" title="Looking tired" aria-hidden="true" /><span className="sr-only">, looking tired</span></>}
              </button>
            );
          })}
        </div>

        <Panel
          title={SLOT_LABEL[slot]}
          icon={SLOT_ICON[slot]}
          sub={here ? <>Now: {here.item.name}</> : undefined}
          action={<span className="small">You have <b><MoneyText pence={game.cash} whole /></b></span>}
        >
          {here?.bought && wear !== "fresh" && (
            <div className={`callout ${wear === "tired" ? "callout--warn" : ""} decorate__wear`} role="note">
              <span className="spacer">
                <b>{wear === "tired" ? "Looking tired" : "Starting to look worn"}</b> — your {lower(here.item.name)} {wear === "tired" ? "have lost their shine, so guests notice less and it drags your prestige." : "will look tired soon."}
              </span>
              <button
                className="btn btn--green"
                disabled={!canShop || game.cash < here.item.refreshCost}
                onClick={() => send({ type: "REFRESH_DECOR", slot })}
              >
                Refresh · <MoneyText pence={here.item.refreshCost} whole />
              </button>
            </div>
          )}
          <ul className="decorate__cards">
            {decorCatalogue(content, slot).map((item) => (
              <DecorCard
                key={item.id}
                item={item}
                game={game}
                current={here?.item.id === item.id}
                pendingHere={pending.get(slot)}
                canShop={canShop}
                picked={picked?.id === item.id}
                onPreview={(on) => setHover(on ? item : null)}
                onPick={() => setPicked(picked?.id === item.id ? null : item)}
                onBuy={() => send({ type: "BUY_DECOR", slot, itemId: item.id })}
              />
            ))}
          </ul>
          <p className="small muted decorate__note">
            The fitters come the next morning. Big jobs close a table or two that night. Everything wears out in the end — a refresh costs much less than buying again.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function lower(s: string) { return s.charAt(0).toLowerCase() + s.slice(1); }

function DecorCard({ item, game, current, pendingHere, canShop, picked, onPreview, onPick, onBuy }: {
  item: DecorItemDef; game: GameState; current: boolean; pendingHere: string | undefined; canShop: boolean; picked: boolean;
  onPreview: (on: boolean) => void; onPick: () => void; onBuy: () => void;
}) {
  const coming = pendingHere === item.id;
  const before = decorEffects(content, game).prestige;
  const after = decorEffects(content, withItem(game, item)).prestige;
  const short = item.price - game.cash;
  const upkeep = item.effects.upkeep ?? 0;
  let button: JSX.Element;
  if (coming) button = <span className="decorate__state decorate__state--new"><Icon name="calendar" size={18} />Coming tomorrow</span>;
  else if (current && !pendingHere) button = <span className="decorate__state"><Icon name="check" size={18} />In your restaurant</span>;
  else if (current) button = <button className="btn" disabled={!canShop} onClick={onBuy}>Keep this one</button>;
  else if (short > 0) button = <button className="btn" disabled>Need <MoneyText pence={short} whole /> more</button>;
  else button = (
    <button className="btn btn--green" disabled={!canShop} onClick={onBuy}>
      {item.starter ? "Put it back · free" : <>Buy · fit tomorrow · <MoneyText pence={item.price} whole /></>}
    </button>
  );
  return (
    <li
      className={`decorate__card ${current ? "decorate__card--current" : ""} ${picked ? "decorate__card--picked" : ""}`}
      onMouseEnter={() => onPreview(true)}
      onMouseLeave={() => onPreview(false)}
      onFocus={() => onPreview(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onPreview(false); }}
    >
      <button className="decorate__look" aria-pressed={picked} onClick={onPick}>
        <span className="decorate__name">{item.name}</span>
        <span className="decorate__price">{item.starter ? "Free" : formatPence(item.price, { whole: true })}</span>
      </button>
      <p className="small decorate__desc">{item.description}</p>
      {!item.starter && (
        <ul className="decorate__words" aria-label="What it does">
          {effectWords(item).map((w) => <li key={w} className="pill">{w}</li>)}
        </ul>
      )}
      {!current && after !== before && (
        <p className="small decorate__hint">Room prestige <b>{signed(before)}</b> → <b>{signed(after)}</b></p>
      )}
      {!item.starter && (upkeep > 0 || item.fitTables > 0) && (
        <p className="small muted decorate__cost">
          {upkeep > 0 && <>Costs <MoneyText pence={upkeep} /> a day to keep. </>}
          {item.fitTables > 0 && <>{item.fitTables} table{item.fitTables === 1 ? "" : "s"} closed on fitting night.</>}
        </p>
      )}
      <div className="decorate__buy">{button}</div>
    </li>
  );
}

/** The dining room drawn by the real floor renderer (static scene layer, rebuilt only when the decor shown changes). */
function RoomCanvas({ game }: { game: GameState }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(game);
  live.current = game;
  useEffect(() => {
    let view: RestaurantView;
    try { view = new RestaurantView(canvas.current!); } catch { return; } // no 2D canvas (tests, very old browsers): cards still work
    // the canvas fills the frame's content box (inside its border), so size the drawing to that, not the border box
    const fit = () => { const el = wrap.current!; view.resize(el.clientWidth, el.clientHeight, canvasDpr()); };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : undefined;
    ro?.observe(wrap.current!);
    let raf = 0;
    const frame = (t: number) => {
      view.render({ ...live.current, customers: [], tickets: [] }, { content, speed: 0, now: t, reducedMotion: prefersReducedMotion(), preview: true });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, []);
  return (
    <div className="decorate__room" ref={wrap}>
      <canvas ref={canvas} className="decorate__canvas" role="img" aria-label="Your dining room with the decoration you're looking at" />
    </div>
  );
}
