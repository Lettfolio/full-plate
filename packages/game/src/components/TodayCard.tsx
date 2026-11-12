/**
 * Round 14 (F): the morning's "Today" card — one small real decision when there is one (a regular's VIP order due
 * today, the rival's week on Monday and Sunday). Hidden when nothing is live. A lazy chunk (it needs the voices data);
 * the rows are lib/today.ts.
 */
import { useMemo, useState } from "react";
import type { Command, GameState } from "@full-plate/sim-core";
import type { PathMeta } from "../state/paths";
import { content } from "../sim";
import { todayRows, type TodayTab } from "../lib/today";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { Term } from "./Term";
import { regularFace } from "./RegularsBook";
import { rivalFace } from "./RivalCard";
import { voices } from "../lib/voiceKit";
import "./today.css";

export function TodayCard({ game, meta, send, onTab }: { game: GameState; meta?: PathMeta | undefined; send: (cmd: Command) => void; onTab: (t: TodayTab) => void }) {
  // Fixed for the morning: keyed on the day, the menu and the larder (a tap that adds the dish updates its row).
  const rows = useMemo(() => todayRows(content, game, meta?.voices), [game.day, game.menu, game.stock, game.history.length, meta?.voices?.day]); // eslint-disable-line react-hooks/exhaustive-deps
  const [done, setDone] = useState<Record<string, string>>({});
  if (!rows.length) return null;
  const face = (kind: string, who: string) => {
    if (kind === "vip") { const def = voices.regulars.regulars.find((r) => r.id === who); return def ? <Avatar spec={regularFace(def)} size={40} /> : null; }
    return <Avatar spec={rivalFace(who, "rival")} size={40} />;
  };
  return (
    <section className="card today" aria-label="Today" data-testid="today-card">
      <div className="today__k"><Icon name="calendar" size={16} /> Today</div>
      <ul className="today__list">
        {rows.map((r) => (
          <li key={`${r.kind}-${r.who}`} className="today__row" data-testid={`today-${r.kind}`}>
            {face(r.kind, r.who)}
            <div>
              <b>{r.kind === "vip" ? <><Term id="vip" inline>VIP</Term> · {r.title}</> : r.title}</b>
              <div className="small">{r.text}</div>
            </div>
            {done[r.who] ? <span className="today__done small"><Icon name="check" size={16} /> {done[r.who]}</span> : r.act && (
              <button className="btn btn--sm" onClick={() => {
                if (r.act!.commands) { r.act!.commands.forEach(send); setDone((d) => ({ ...d, [r.who]: "Done" })); }
                if (r.act!.tab) onTab(r.act!.tab);
              }}>{r.act.label}</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
