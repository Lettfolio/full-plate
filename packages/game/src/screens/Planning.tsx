import { useMemo, useState } from "react";
import type { Command, GameState } from "@full-plate/sim-core";
import { Tabs, type TabDef } from "../components/Tabs";
import { content } from "../sim";
import { MenuTab } from "./planning/MenuTab";
import { StaffTab } from "./planning/StaffTab";
import { StockTab } from "./planning/StockTab";
import { RestaurantTab } from "./planning/RestaurantTab";
import { stockNeeds } from "./planning/stockNeeds";
import { weekdayIndex, WEEKDAYS } from "../lib/calendar";

type TabId = "menu" | "staff" | "stock" | "restaurant";

interface Props {
  game: GameState;
  send: (cmd: Command) => void;
}

interface Hint { text: string; tone: "warn" | "bad" | "good"; tab?: TabId }

export function Planning({ game, send }: Props) {
  const [tab, setTab] = useState<TabId>("menu");
  const today = weekdayIndex(game.day);
  const active = game.menu.filter((m) => m.active);
  const onShift = game.staff.filter((s) => s.rota[today]);
  const chefs = onShift.filter((s) => s.role === "chef").length;
  const servers = onShift.filter((s) => s.role === "server").length;
  const needs = useMemo(() => stockNeeds(content, game), [game]);
  const short = needs.filter((n) => n.need > 0 && n.onHand < n.need).length;

  const hints: Hint[] = [];
  if (!active.length) hints.push({ text: "Your menu is empty", tone: "bad", tab: "menu" });
  // With nobody on, the owner covers the role (slowly) — a warning, not a blocker.
  if (!chefs) hints.push({ text: `No chef on for ${WEEKDAYS[today]} — you'll be cooking`, tone: "bad", tab: "staff" });
  if (!servers) hints.push({ text: `No server on for ${WEEKDAYS[today]} — you'll be serving`, tone: "warn", tab: "staff" });
  if (short) hints.push({ text: `${short} ingredient${short > 1 ? "s" : ""} running low`, tone: "warn", tab: "stock" });
  if (!hints.length) hints.push({ text: "Everything looks ready", tone: "good" });

  const tabs: TabDef<TabId>[] = [
    { id: "menu", label: "Menu", badge: active.length },
    { id: "staff", label: "Staff", badge: !chefs ? "!" : game.staff.length, badgeTone: !chefs ? "warn" : "info" },
    { id: "stock", label: "Stock", badge: short ? short : "", badgeTone: "warn" },
    { id: "restaurant", label: "Restaurant", badge: game.tables.length },
  ];

  return (
    <div className="page planning">
      <div className="planning__bar">
        <div>
          <div className="xs faint" style={{ fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Morning</div>
          <h1 style={{ marginBottom: 6 }}>Get ready for {WEEKDAYS[today]}</h1>
        </div>
        <Tabs label="Planning" tabs={tabs} active={tab} onChange={setTab} />
      </div>
      <div className="planning__panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "menu" && <MenuTab game={game} send={send} />}
        {tab === "staff" && <StaffTab game={game} send={send} />}
        {tab === "stock" && <StockTab game={game} send={send} needs={needs} />}
        {tab === "restaurant" && <RestaurantTab game={game} send={send} />}
      </div>
      <div className="openbar">
        <div className="openbar__hints">
          {hints.map((h) => (
            <button key={h.text} className={`hint hint--${h.tone}`} style={{ border: 0, cursor: h.tab ? "pointer" : "default" }} onClick={() => h.tab && setTab(h.tab)}>
              {h.text}
            </button>
          ))}
        </div>
        <button className="btn btn--primary btn--xl" disabled={game.phase !== "planning" || !active.length} onClick={() => send({ type: "START_SERVICE" })}>
          Open for service →
        </button>
      </div>
    </div>
  );
}
