import { useMemo, useState } from "react";
import type { Command, GameState, StaffRole } from "@full-plate/sim-core";
import { GoalsCard } from "../components/GoalsCard";
import { HelpPopover } from "../components/HelpPopover";
import { GOAL_TAB } from "../lib/goals";
import { Tabs, type TabDef } from "../components/Tabs";
import { asCommand, content, HOOKS, openingStockBudget, OWNER_FATIGUE_WARNING } from "../sim";
import { FatigueNote } from "../components/FatigueNote";
import { MoneyText } from "../components/MoneyText";
import { isOpeningDay } from "../lib/calendar";
import { MenuTab } from "./planning/MenuTab";
import { StaffTab } from "./planning/StaffTab";
import { StockTab } from "./planning/StockTab";
import { RestaurantTab } from "./planning/RestaurantTab";
import { stockNeeds } from "./planning/stockNeeds";
import { weekdayIndex, WEEKDAYS } from "../lib/calendar";
import { unplateable } from "../lib/plateable";
import type { PathKind } from "../lib/library";
import type { EmpireCommand } from "@full-plate/sim-empire";
import type { StarsCommand } from "@full-plate/sim-stars";
import type { PathMeta } from "../state/paths";
import { EmpireTab } from "./paths/EmpireTab";
import { StarsTab } from "./paths/StarsTab";

export type PlanningTab = "menu" | "staff" | "stock" | "restaurant" | "empire" | "stars";
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
}

interface Hint { text: string; tone: "warn" | "bad" | "good"; tab?: TabId }

/** The role of the first unfinished "Hire a …" goal, so the Staff tab can put those candidates first. */
function openHireGoalRole(game: GameState): StaffRole | undefined {
  return (game.goals ?? []).find((g) => !g.done && g.kind === "hire_role")?.role;
}

export function Planning({ game, send, tab, onTab: setTab, goalsJustDone = [], path, meta, sendEmpire, sendStars, onFocusSite, onTastingMenu }: Props) {
  // "Show me" on a hire goal: the Staff tab lists that role's candidates first.
  const [wantRole, setWantRole] = useState<StaffRole | undefined>(undefined);
  // First day with no staff at all: one "are you sure?" (a 12-year-old presses the big button first).
  const [confirmAlone, setConfirmAlone] = useState(false);
  const today = weekdayIndex(game.day);
  const active = game.menu.filter((m) => m.active);
  const onShift = game.staff.filter((s) => s.rota[today]);
  const chefs = onShift.filter((s) => s.role === "chef").length;
  const servers = onShift.filter((s) => s.role === "server").length;
  const needs = useMemo(() => stockNeeds(content, game), [game]);
  // Day 0: the larder is empty until "Open", when the sim buys opening stock, so nothing is "short" yet.
  const opening = isOpeningDay(game);
  const short = opening ? 0 : needs.filter((n) => n.need > 0 && n.onHand < n.need).length;
  const shortDelivery = game.shortDelivery;
  const shortName = shortDelivery ? content.ingredients.find((i) => i.id === shortDelivery.ingredientId)?.name ?? shortDelivery.ingredientId : "";

  const closedForRefit = !!meta?.stars && (meta.stars.refitUntil ?? -1) > game.day;
  const hints: Hint[] = [];
  if (!active.length) hints.push({ text: "Step 1: add dishes to your menu", tone: "bad", tab: "menu" });
  // With nobody on, the owner covers the role (slowly) — a warning, not a blocker.
  if (!game.staff.some((s) => s.role === "chef")) hints.push({ text: "Hire a chef (or you'll cook yourself)", tone: "bad", tab: "staff" });
  else if (!chefs) hints.push({ text: `No chef on for ${WEEKDAYS[today]} — you'll be cooking`, tone: "bad", tab: "staff" });
  if (!servers) hints.push({ text: `No server on for ${WEEKDAYS[today]} — you'll be serving`, tone: "warn", tab: "staff" });
  const noStock = opening ? 0 : unplateable(content, game).length;
  if (noStock) hints.push({ text: `${noStock} dish${noStock > 1 ? "es" : ""} out of stock today — order in the evening`, tone: "bad", tab: "stock" });
  if (short) hints.push({ text: `${short} ingredient${short > 1 ? "s" : ""} running low`, tone: "warn", tab: "stock" });
  if (!hints.length) hints.push({ text: "Everything looks ready", tone: "good" });

  // Goals go in a sidebar when the sim provides them. First run (empty menu): the card is spotlit
  // and comes first in reading order, so it's what the eye lands on.
  const hasGoals = (game.goals ?? []).some((g) => !g.done) || goalsJustDone.length > 0;
  const firstRun = hasGoals && game.menu.length === 0;

  const tabs: TabDef<TabId>[] = [
    { id: "menu", label: "Menu", badge: active.length },
    { id: "staff", label: "Staff", badge: !chefs ? "!" : game.staff.length, badgeTone: !chefs ? "warn" : "info" },
    { id: "stock", label: "Stock", badge: short ? short : "", badgeTone: "warn" },
    { id: "restaurant", label: "Restaurant", badge: game.tables.length },
    ...(meta?.empire ? [{ id: "empire" as const, label: "🍔 Empire", badge: meta.empire.sites.filter((x) => x.status === "open").length }] : []),
    ...(meta?.stars ? [{ id: "stars" as const, label: "⭐ Stars", badge: meta.stars.headChef.wantsOwnPlace ? "!" : "", badgeTone: "warn" as const }] : []),
  ];
  const wide = tab === "empire" || tab === "stars";

  return (
    <div className="page planning">
      <div className="planning__bar">
        <div>
          <div className="xs faint" style={{ fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Morning</div>
          <h1 style={{ marginBottom: 6 }}>Get ready for {WEEKDAYS[today]}</h1>
        </div>
        <Tabs label="Planning" tabs={tabs} active={tab} onChange={setTab} />
        <div className="planning__help"><HelpPopover /></div>
      </div>
      {(opening || shortDelivery || (game.ownerFatigue ?? 0) >= OWNER_FATIGUE_WARNING) && (
        <div className="planning__notices">
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
          {(game.ownerFatigue ?? 0) >= OWNER_FATIGUE_WARNING && <FatigueNote fatigue={game.ownerFatigue ?? 0} onHire={() => setTab("staff")} />}
        </div>
      )}
      <div className={`planning__body ${hasGoals && !wide ? "planning__body--goals" : ""}`}>
        {hasGoals && !wide && (
          <aside className="planning__side" aria-label="Goals">
            <GoalsCard
              goals={game.goals}
              justDone={goalsJustDone}
              spotlight={firstRun}
              onShow={(g) => { const t = GOAL_TAB[g.kind]; setWantRole(g.kind === "hire_role" ? g.role : undefined); if (t) setTab(t); }}
            />
          </aside>
        )}
        <div className="planning__panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "menu" && <MenuTab game={game} send={send} path={path} />}
          {tab === "staff" && <StaffTab game={game} send={send} wantRole={wantRole ?? openHireGoalRole(game)} />}
          {tab === "stock" && <StockTab game={game} send={send} needs={needs} opening={opening} />}
          {tab === "restaurant" && <RestaurantTab game={game} send={send} />}
          {tab === "empire" && meta?.empire && sendEmpire && <EmpireTab game={game} meta={meta} empire={meta.empire} send={sendEmpire} onFocusSite={onFocusSite ?? (() => {})} />}
          {tab === "stars" && meta?.stars && sendStars && <StarsTab game={game} meta={meta} stars={meta.stars} send={sendStars} onTastingMenu={onTastingMenu ?? (() => {})} />}
        </div>
      </div>
      <div className="openbar">
        <div className="openbar__hints">
          {hints.map((h) => (
            <button key={h.text} className={`hint hint--${h.tone}`} style={{ border: 0, cursor: h.tab ? "pointer" : "default" }} onClick={() => h.tab && setTab(h.tab)}>
              {h.text}
            </button>
          ))}
        </div>
        {closedForRefit ? (
          <button className="btn btn--primary btn--xl" disabled={game.phase !== "planning"} onClick={() => send(HOOKS.closeToday ? asCommand({ type: "CLOSE_TODAY" }) : { type: "START_SERVICE" })}>
            Closed for the refit — next day →
          </button>
        ) : confirmAlone ? (
          <div className="openbar__confirm" role="alertdialog" aria-labelledby="alone-q">
            <span id="alone-q"><b>Open with nobody to help?</b> You'll cook and serve on your own: slow food, long queues.</span>
            <button className="btn btn--green" autoFocus onClick={() => { setConfirmAlone(false); setTab("staff"); }}>Hire someone first</button>
            <button className="btn btn--ghost" onClick={() => { setConfirmAlone(false); send({ type: "START_SERVICE" }); }}>Open anyway</button>
          </div>
        ) : (
          <button
            className="btn btn--primary btn--xl"
            disabled={game.phase !== "planning" || !active.length}
            title={active.length ? undefined : "Add at least one dish to your menu first"}
            onClick={() => (opening && game.staff.length === 0 ? setConfirmAlone(true) : send({ type: "START_SERVICE" }))}
          >
            Open for service →
          </button>
        )}
      </div>
    </div>
  );
}
