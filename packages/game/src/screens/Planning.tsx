import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { landOn, pageScroller, requestLanding, restoreScroll, tabScroll, takeLanding } from "../lib/scrollTop";
import type { Command, GameState, StaffRole } from "@full-plate/sim-core";
import { GoalsCard } from "../components/GoalsCard";
import { HelpPopover } from "../components/HelpPopover";
import { GOAL_TAB, goalsQuiet } from "../lib/goals";
import { Tabs, type TabDef } from "../components/Tabs";
import { asCommand, content, HOOKS, openingStockBudget, OWNER_FATIGUE_WARNING } from "../sim";
import { FatigueNote } from "../components/FatigueNote";
import { BankBanner, bankLastDays, hirePromptText, loanDue, StarterLoanTip } from "../components/Bank";
import { MoneyText } from "../components/MoneyText";
import { isOpeningDay } from "../lib/calendar";
import { MenuTab } from "./planning/MenuTab";
import type { CustomDish } from "../lib/customDish";
import type { CookbookOp } from "@full-plate/content";
import type { KnownPerson } from "./planning/StaffTab";
// Round 10: the staff room (portrait cards, hiring sheet, training) loads on first open too.
const StaffTab = lazy(() => import("./planning/StaffTab").then((m) => ({ default: m.StaffTab })));
// Round 3 review: the path tabs load on first open (code-split).
const EmpireTab = lazy(() => import("./paths/EmpireTab").then((m) => ({ default: m.EmpireTab })));
const StarsTab = lazy(() => import("./paths/StarsTab").then((m) => ({ default: m.StarsTab })));
// Round 10: the Decorate tab (catalogue, live room preview) loads on first open too.
const DecorateTab = lazy(() => import("./planning/DecorateTab").then((m) => ({ default: m.DecorateTab })));
// Round 12 (E): the Restaurant tab (with the rival and the Regulars book) and the morning gossip load on demand.
const RestaurantTab = lazy(() => import("./planning/RestaurantTab").then((m) => ({ default: m.RestaurantTab })));
const GossipTicker = lazy(() => import("../components/GossipTicker").then((m) => ({ default: m.GossipTicker })));
// Round 12 (G): the Stock tab loads on first open too (main-chunk budget: room for the Friends entry points).
const StockTab = lazy(() => import("./planning/StockTab").then((m) => ({ default: m.StockTab })));
// Round 14 (E): "New thing to try" (one item a day from Day 2; components/TryCard.tsx, lib/tryNext.ts).
const TryCard = lazy(() => import("../components/TryCard"));
import type { TryId } from "../lib/tryNext";
import { usePhone } from "../lib/layout";
import { tiredSlots, tiredText } from "../lib/decor";
import { stockNeeds, tonightRisk } from "./planning/stockNeeds";
import { StockWarning } from "./planning/StockWarning";
import { inSeason } from "@full-plate/sim-stars";
import { weekdayIndex, WEEKDAYS, WEEKDAY_NAMES } from "../lib/calendar";
import { DayRhythm } from "../components/DayRhythm";
import { ArrowLabel } from "../components/Icon";
import { unplateable } from "../lib/plateable";
import { useNarrow } from "../lib/layout";
import type { PathKind } from "../lib/library";
import type { EmpireCommand } from "@full-plate/sim-empire";
import type { StarsCommand } from "@full-plate/sim-stars";
import type { PathMeta } from "../state/paths";
import { useDrinksView } from "../lib/settings";

export type PlanningTab = "menu" | "staff" | "stock" | "restaurant" | "decorate" | "empire" | "stars";
type TabId = PlanningTab;

interface Props {
  game: GameState;
  send: (cmd: Command) => void;
  /** Controlled by App so the evening screen can send the player straight to a tab ("Hire", "Buy a table"). */
  tab: PlanningTab;
  onTab: (t: PlanningTab) => void;
  /** Goal ids completed today, for the flash. */
  goalsJustDone?: readonly string[];
  /** The path chosen at the fork (unlocks that path's recipes). */
  path?: PathKind | undefined;
  meta?: PathMeta;
  sendEmpire?: (cmd: EmpireCommand) => void;
  sendStars?: (cmd: StarsCommand) => void;
  onFocusSite?: (siteId: string) => void;
  onTastingMenu?: (menuId: string | null) => void;
  /** Round 12 (B): save a new brand code. */
  onBrand?: (code: string) => void;
  /** Round 12 (F): invent a dish (Menu tab). */
  onInvent?: (dish: CustomDish) => void;
  /** Round 13 (D): the cookbook's edits (Menu tab) and the Stars refine. */
  onCookbook?: (op: CookbookOp) => void;
  /** Round 14 (E): "New thing to try" › cook tonight yourself (opens service and starts the hands-on shift). */
  onCookTonight?: () => void;
  /** Round 14 (E): "New thing to try" › today's challenge (the game is saved; App opens the challenge). */
  onChallenge?: () => void;
}

/** Round 14 (E): where each "New thing to try" item, and each phone shortcut chip, lands. */
const TRY_GO: Record<Exclude<TryId, "cook" | "challenge">, [PlanningTab, string]> = {
  brand: ["restaurant", ".brandcard"],
  invent: ["menu", ".cookbook"],
  postcard: ["restaurant", ".postcard__open"],
  regulars: ["restaurant", ".voices-row"],
  rival: ["restaurant", ".rival"],
  share: ["restaurant", ".visitcard"],
};
/** Round 14 (E): on a phone, a row of chips under the Menu and Restaurant headings jumps to what sits screens below. */
const TAB_CHIPS: Partial<Record<PlanningTab, [string, string][]>> = {
  menu: [["Invent a dish", ".cookbook"], ["Recipe book", ".library"]],
  restaurant: [["Brand kit", ".brandcard"], ["Postcard", ".postcard__open"], ["Rival", ".rival"], ["Regulars", ".voices-row"], ["Friends", ".visitcard"]],
};

interface Hint { text: string; tone: "warn" | "bad" | "good"; tab?: TabId }

/** The role of the first unfinished "Hire a …" goal, so the Staff tab can put those candidates first. */
function openHireGoalRole(game: GameState): StaffRole | undefined {
  return (game.goals ?? []).find((g) => !g.done && g.kind === "hire_role")?.role;
}

/** Round 14 (E, U1): where a shortcut to a tab should land (the thing it is about), by tab. */
function landingFor(tab: TabId, game: GameState): string | null {
  if (tab === "menu" && game.menu.length === 0) return ".starter";
  if (tab === "staff") return ".candidate--wanted, .hiresheet";
  return null;
}

export function Planning({ game, send, tab, onTab: pickTab, goalsJustDone = [], path, meta, sendEmpire, sendStars, onFocusSite, onTastingMenu, onBrand, onInvent, onCookbook, onCookTonight, onChallenge }: Props) {
  // Round 14 (E, U1): each tab opens at its own last position this day (top the first time); a shortcut lands on what
  // it is about. The tab bar itself just switches (`pickTab`); hints, goals and "Hire someone first" use `setTab`.
  useLayoutEffect(() => {
    const landing = takeLanding();
    const y = tabScroll.enter(game.day, tab);
    return landing ? landOn(landing) : restoreScroll(y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, game.day]);
  useEffect(() => {
    const on = (e: Event) => { const t = e.target; if (t === document || (t instanceof HTMLElement && t.classList.contains("screen"))) tabScroll.note(pageScroller.read()); };
    document.addEventListener("scroll", on, { passive: true, capture: true });
    return () => document.removeEventListener("scroll", on, { capture: true });
  }, []);
  const goTo = (t: TabId, landing: string | null) => {
    if (t === tab) { if (landing) landOn(landing); return; }
    if (landing) requestLanding(landing);
    pickTab(t);
  };
  const setTab = (t: TabId) => goTo(t, landingFor(t, game));
  const tryGo = (id: TryId) => {
    if (id === "cook") { onCookTonight?.(); return; }
    if (id === "challenge") { onChallenge?.(); return; }
    const [t, sel] = TRY_GO[id];
    goTo(t, sel);
  };
  const phone = usePhone();
  const chips = phone ? TAB_CHIPS[tab] : undefined;
  // "Show me" on a hire goal: the Staff tab lists that role's candidates first.
  const [wantRole, setWantRole] = useState<StaffRole | undefined>(undefined);
  // First day with no staff at all: one "are you sure?" (a 12-year-old presses the big button first).
  const [confirmAlone, setConfirmAlone] = useState(false);
  const today = weekdayIndex(game.day);
  const active = game.menu.filter((m) => m.active);
  const onShift = game.staff.filter((s) => s.rota[today]);
  const chefs = onShift.filter((s) => s.role === "chef").length;
  const servers = onShift.filter((s) => s.role === "server").length;
  const drinks = useDrinksView();
  const needs = useMemo(() => stockNeeds(content, game), [game, drinks]);
  // Day 0: the larder is empty until "Open", when the sim buys opening stock, so nothing is "short" yet.
  const opening = isOpeningDay(game);
  const short = opening ? 0 : needs.filter((n) => n.need > 0 && n.onHand < n.need).length;
  const shortDelivery = game.shortDelivery;
  const shortName = shortDelivery ? content.ingredients.find((i) => i.id === shortDelivery.ingredientId)?.name ?? shortDelivery.ingredientId : "";

  const hire = hirePromptText(game);
  const lastDays = bankLastDays(game);
  // The starter-loan tip shows in the morning too, except on the Staff tab (the hiring sheet carries it there).
  const loanTip = tab !== "staff" && !opening && loanDue(game);
  const closedForRefit = !!meta?.stars && (meta.stars.refitUntil ?? -1) > game.day;
  // Round 3 review P1: say before service when the larder won't cover the forecast (louder in inspection season).
  const risk = useMemo(() => tonightRisk(content, game), [game, drinks]);
  const showRisk = !opening && !closedForRefit && game.phase === "planning" && risk.dishes.length > 0;
  const inspection = !!meta?.stars && !meta.stars.ending && inSeason(meta.stars, game.day);
  const hints: Hint[] = [];
  if (!active.length) hints.push({ text: "Step 1: add dishes to your menu", tone: "bad", tab: "menu" });
  // With nobody on, the owner covers the role (slowly) — a warning, not a blocker.
  // Round 11 (U2): when no chef is affordable the dock says how far off it is, not "Hire a chef".
  if (!game.staff.some((s) => s.role === "chef")) hints.push({ text: hire.can ? "Hire a chef (or you'll cover the kitchen, slowly)" : `${hire.text} (you'll cover the kitchen)`, tone: "bad", tab: "staff" });
  else if (!chefs) hints.push({ text: `No chef on for ${WEEKDAYS[today]} — you'll cover the kitchen`, tone: "bad", tab: "staff" });
  if (!servers) hints.push({ text: `No server on for ${WEEKDAYS[today]} — you'll cover the floor`, tone: "warn", tab: "staff" });
  const noStock = opening ? 0 : unplateable(content, game).length;
  if (noStock) hints.push({ text: `${noStock} dish${noStock > 1 ? "es" : ""} out of stock today — order in the evening`, tone: "bad", tab: "stock" });
  if (short) hints.push({ text: `${short} ingredient${short > 1 ? "s" : ""} running low`, tone: "warn", tab: "stock" });
  const tired = tiredSlots(game);
  if (tired.length) hints.push({ text: tired.length === 1 ? tiredText(game, tired[0]!) : `${tired.length} things in your room look tired`, tone: "warn", tab: "decorate" });
  if (!hints.length) hints.push({ text: "Everything looks ready", tone: "good" });

  // Goals go in a sidebar when the sim provides them. First run (empty menu): the card is spotlit
  // and comes first in reading order, so it's what the eye lands on.
  const hasGoals = (game.goals ?? []).some((g) => !g.done) || goalsJustDone.length > 0;
  const firstRun = hasGoals && game.menu.length === 0;
  // Round 11 (D): upright on an iPad the goals sit above the panel, folded to one line after the first run.
  const narrow = useNarrow();

  const tabs: TabDef<TabId>[] = [
    { id: "menu", label: "Menu", badge: active.length },
    { id: "staff", label: "Staff", badge: !chefs ? "!" : game.staff.length, badgeTone: !chefs ? "warn" : "info" },
    { id: "stock", label: "Stock", badge: short ? short : "", badgeTone: "warn" },
    { id: "restaurant", label: "Restaurant", badge: game.tables.length },
    { id: "decorate", label: "Decorate", badge: tired.length ? "!" : game.decor?.pending?.length || "", badgeTone: tired.length ? "warn" : "info" },
    ...(meta?.empire ? [{ id: "empire" as const, label: "Empire", badge: meta.empire.sites.filter((x) => x.status === "open").length }] : []),
    ...(meta?.stars ? [{ id: "stars" as const, label: "Stars", badge: meta.stars.headChef.wantsOwnPlace ? "!" : "", badgeTone: "warn" as const }] : []),
  ];
  const wide = tab === "empire" || tab === "stars";

  /** Stars: shut tonight (everyone off today's rota first, so nobody is paid for a shift that won't happen). */
  const closeTonight = () => {
    for (const st of game.staff) if (st.rota[today]) send({ type: "SET_ROTA", staffId: st.id, rota: st.rota.map((on, i) => (i === today ? false : on)) });
    send(asCommand({ type: "CLOSE_TODAY" }));
  };
  return (
    <div className="page planning">
      <div className="planning__bar">
        <div className="beathead">
          <DayRhythm beat="morning" weekday={WEEKDAY_NAMES[today]!} />
          <h1>Get ready for {WEEKDAY_NAMES[today]}</h1>
        </div>
        <Tabs label="Planning" tabs={tabs} active={tab} onChange={pickTab} />
        <div className="planning__help"><HelpPopover /></div>
      </div>
      {/* Round 12 (E): not on the wide Empire / Stars tabs, which need the height for their maps and tracks. */}
      {meta?.mode !== "career" && !wide && <Suspense fallback={null}><GossipTicker game={game} meta={meta} /></Suspense>}
      {meta?.mode !== "career" && !meta?.challenge && !wide && game.day >= 1 && <Suspense fallback={null}><TryCard game={game} meta={meta} onGo={tryGo} /></Suspense>}
      {(opening || shortDelivery || showRisk || (game.ownerFatigue ?? 0) >= OWNER_FATIGUE_WARNING || lastDays || loanTip) && (
        <div className="planning__notices">
          {(lastDays || loanTip) && (
            <Suspense fallback={null}>
              {lastDays && <BankBanner game={game} />}
              {loanTip && <StarterLoanTip game={game} send={send} />}
            </Suspense>
          )}
          {showRisk && (
            <StockWarning
              game={game}
              risk={risk}
              send={send}
              inspection={inspection}
              stars={meta?.stars?.guides.michelin.stars ?? 0}
              canClose={!!meta?.stars && HOOKS.closeToday}
              onClose={closeTonight}
              {...(tab !== "stock" ? { onStock: () => setTab("stock") } : {})}
            />
          )}
          {opening && game.menu.length > 0 && (
            <p className="callout" role="note">
              <b>📦 Your larder is empty — that's fine.</b> Opening stock for today's menu is bought automatically when you open (up to <MoneyText pence={openingStockBudget(content)} whole />). Orders you place now arrive tomorrow morning.
            </p>
          )}
          {shortDelivery && (
            <p className="callout callout--warn" role="note">
              <b>🚚 The {shortName} delivery came {shortDelivery.missing} portion{shortDelivery.missing === 1 ? "" : "s"} short</b> this morning (the supplier refunded it). Dishes that use it may run out during service.
            </p>
          )}
          {(game.ownerFatigue ?? 0) >= OWNER_FATIGUE_WARNING && <FatigueNote fatigue={game.ownerFatigue ?? 0} onHire={() => setTab("staff")} hireLabel={hire.text} />}
        </div>
      )}
      <div className={`planning__body ${hasGoals && !wide ? "planning__body--goals" : ""}`}>
        {hasGoals && !wide && (
          <aside className="planning__side" aria-label="Goals">
            <GoalsCard
              key={narrow && !firstRun ? "fold" : "open"}
              collapsible={narrow && !firstRun}
              goals={game.goals}
              justDone={goalsJustDone}
              spotlight={firstRun}
              quiet={goalsQuiet(game.day, game.goals)}
              onShow={(g) => { const t = GOAL_TAB[g.kind]; setWantRole(g.kind === "hire_role" ? g.role : undefined); if (t) setTab(t); }}
            />
          </aside>
        )}
        <div className="planning__panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {chips && (
            <nav className="tabchips" aria-label={`Jump to, on ${tab === "menu" ? "Menu" : "Restaurant"}`}>
              {chips.map(([label, sel]) => <button key={sel} type="button" className="tabchip" onClick={() => landOn(sel)}>{label}</button>)}
            </nav>
          )}
          {tab === "menu" && <MenuTab game={game} send={send} path={path} meta={meta} onInvent={onInvent} onCookbook={onCookbook} />}
          {tab === "staff" && <Suspense fallback={<div className="empty small muted">Opening the staff room…</div>}><StaffTab game={game} send={send} wantRole={wantRole ?? openHireGoalRole(game)} known={knownPeople(meta)} /></Suspense>}
          {tab === "stock" && <Suspense fallback={<div className="empty small muted">Opening the store room…</div>}><StockTab game={game} send={send} needs={needs} opening={opening} /></Suspense>}
          <Suspense fallback={<div className="empty small muted">Loading…</div>}>
            {tab === "restaurant" && <RestaurantTab game={game} send={send} meta={meta} onBrand={onBrand} />}
            {tab === "decorate" && <DecorateTab game={game} send={send} />}
            {tab === "empire" && meta?.empire && sendEmpire && <EmpireTab game={game} meta={meta} empire={meta.empire} send={sendEmpire} onFocusSite={onFocusSite ?? (() => {})} />}
            {tab === "stars" && meta?.stars && sendStars && <StarsTab game={game} meta={meta} stars={meta.stars} send={sendStars} onTastingMenu={onTastingMenu ?? (() => {})} onCookbook={onCookbook} />}
          </Suspense>
        </div>
      </div>
      {/* Round 7: the day's one primary button sits in a dock pinned to the bottom-right, on every tab. */}
      <div className="openbar actiondock">
        <div className="openbar__hints">
          {hints.map((h) => (
            <button key={h.text} className={`hint hint--${h.tone} ${h.tab ? "hint--link" : ""}`} style={{ border: 0, cursor: h.tab ? "pointer" : "default" }} onClick={() => h.tab && setTab(h.tab)}>
              {h.text}
            </button>
          ))}
        </div>
        {closedForRefit ? (
          <button className="btn btn--primary btn--xl" disabled={game.phase !== "planning"} onClick={() => {
            if (!HOOKS.closeToday) { send({ type: "START_SERVICE" }); return; }
            // CLOSE_TODAY pays rostered staff 50%: give today off first (the rest of the week's rota is kept).
            for (const st of game.staff) if (st.rota[today]) send({ type: "SET_ROTA", staffId: st.id, rota: st.rota.map((on, i) => (i === today ? false : on)) });
            send(asCommand({ type: "CLOSE_TODAY" }));
          }}>
            Closed for the refit — next day →
          </button>
        ) : confirmAlone ? (
          <div className="openbar__confirm" role="alertdialog" aria-labelledby="alone-q">
            <span id="alone-q"><b>Open with nobody to help?</b> You'll cook and serve on your own: slow food, long queues.</span>
            <button className="btn btn--green" autoFocus onClick={() => { setConfirmAlone(false); setTab("staff"); }}>Hire someone first</button>
            <button className="btn btn--ghost" onClick={() => { setConfirmAlone(false); send({ type: "START_SERVICE" }); }}>Open anyway</button>
          </div>
        ) : (
          <>
          {meta?.stars && HOOKS.closeToday && (
            <button
              className="btn btn--ghost"
              disabled={game.phase !== "planning"}
              title="Shut tonight: no service, no inspector, and it doesn't count against your steadiness. Rent still runs; staff taken off today's rota are not paid."
              onClick={closeTonight}
            >
              Close tonight
            </button>
          )}
          <button
            className="btn btn--primary btn--xl"
            disabled={game.phase !== "planning" || !active.length}
            title={active.length ? undefined : "Add at least one dish to your menu first"}
            onClick={() => (opening && game.staff.length === 0 ? setConfirmAlone(true) : send({ type: "START_SERVICE" }))}
          >
            <ArrowLabel text="Open for service →" />
          </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Former colleagues from a finished career (sim-career relationships), for the Staff tab's "Old colleagues". */
function knownPeople(meta: PathMeta | undefined): KnownPerson[] {
  const c = meta?.career;
  if (!c?.handover) return [];
  return c.relationships
    .filter((r) => r.snapshot && r.snapshot.role !== "porter")
    .sort((a, b) => b.bond - a.bond)
    .slice(0, 4)
    .map((r) => ({ staff: { ...r.snapshot, id: `known-${r.staffId}` }, bond: r.bond, employer: r.employer }));
}
