import type { DayResult, GameState, Review } from "@full-plate/sim-core";
import type { Command } from "@full-plate/sim-core";
import { content, OWNER_FATIGUE_WARNING, TABLE_COST } from "../sim";
import { FatigueNote } from "../components/FatigueNote";
import { restockLines } from "./planning/stockNeeds";
import { dishDays, lastStaffedDay, WALKOUTS_FOR_TABLE_TIP, worstDish } from "../lib/evening";
import { incidentLines, INCIDENT_ICON } from "../lib/incidents";
import { coveringPhrase } from "../lib/staff";
import type { PlanningTab } from "./Planning";
import { MoneyText } from "../components/MoneyText";
import { Stars } from "../components/Stars";
import { Bar } from "../components/Bar";
import { dishName } from "../lib/content";
import { pct, signed } from "../lib/format";
import { dateLabel } from "../lib/calendar";
import { initials, moodFace } from "../lib/staff";

interface Props {
  game: GameState;
  result: DayResult | null;
  /** END_DAY on a normal evening; opens the event modal when tomorrow has a card (phase "event"). */
  onNext: () => void;
  /** Go to tomorrow's planning on a given tab (Hire → Staff, Buy a table → Restaurant). */
  onGoTo?: (tab: PlanningTab) => void;
  nextLabel: string;
  send: (cmd: Command) => void;
}

/** Orders tomorrow's shortfall now (ORDER_STOCK is allowed in the evening; deliveries land next morning). */
function Restock({ game, send }: { game: GameState; send: (cmd: Command) => void }) {
  const lines = restockLines(game);
  const unit = (id: string) => content.ingredients.find((i) => i.id === id)?.unitCost ?? 0;
  const cost = lines.reduce((a, [id, q]) => a + q * unit(id), 0);
  const ordered = game.orders.length > 0;
  return (
    <div className="card restock">
      <div className="spacer">
        <h3>Stock for tomorrow</h3>
        <div className="small muted">
          {lines.length === 0
            ? ordered ? "Order placed — it arrives in the morning." : "The larder looks fine for tomorrow."
            : <>{lines.length} ingredient{lines.length > 1 ? "s" : ""} will run short. Deliveries arrive tomorrow morning.</>}
        </div>
      </div>
      {lines.length > 0 && (
        <button className="btn btn--green" onClick={() => lines.forEach(([ingredientId, qty]) => send({ type: "ORDER_STOCK", ingredientId, qty }))}>
          Restock for tomorrow · ≈<MoneyText pence={cost} whole />
        </button>
      )}
    </div>
  );
}

const SOURCE: Record<Review["source"], { icon: string; label: string }> = {
  walkin: { icon: "🚶", label: "Walk-in" },
  online: { icon: "💻", label: "Online" },
  critic: { icon: "🎩", label: "Critic" },
  wordofmouth: { icon: "💬", label: "Word of mouth" },
};

export function Delta({ v, digits = 1, suffix = "" }: { v: number; digits?: number; suffix?: string }) {
  const r = Number(v.toFixed(digits));
  const dir = r > 0 ? "up" : r < 0 ? "down" : "flat";
  return (
    <span className={`delta delta--${dir}`} aria-label={`${dir === "up" ? "up" : dir === "down" ? "down" : "no change"} ${Math.abs(r)}`}>
      {dir === "up" ? "▲" : dir === "down" ? "▼" : "•"} {signed(r, digits)}{suffix}
    </span>
  );
}

function Worst({ game, r }: { game: GameState; r: DayResult }) {
  // In the evening the state still holds today's service tally (per-dish sold + quality).
  const w = r.day === game.day ? worstDish(dishDays(content, game), r.worstDish) : null;
  return (
    <div className="dishpick dishpick--worst">
      <span className="dishpick__icon" aria-hidden="true">🥀</span>
      <div>
        <div className="dishpick__k">{w?.reason === "unpopular" ? "Least popular" : w ? "Lowest quality" : "Worst dish"}</div>
        <div className="dishpick__name">{w ? dishName(content, w.dishId) : "—"}</div>
        <div className="xs muted">{w ? w.text : "Nothing stood out (dishes that sold fewer than 3 plates don't count)."}</div>
      </div>
    </div>
  );
}

export function Evening({ game, result, onNext, onGoTo, nextLabel, send }: Props) {
  if (!result) {
    return (
      <div className="page">
        <div className="empty">No results for today. <button className="btn btn--sm" onClick={onNext}>{nextLabel}</button></div>
      </div>
    );
  }
  const r = result;
  // profit = revenue − vat − food − prep waste − spoilage − labour − rent − overheads − incident costs − loan (sim-core stats.ts).
  // Plate waste is already inside food cost, so it is shown as a note, not a line.
  const vat = r.vat ?? 0;
  const overheads = r.overheads ?? 0;
  const incidentCosts = r.incidentCosts ?? 0;
  const wasteCost = r.waste.prep + r.waste.spoil;
  const ofRev = (v: number) => (r.revenue > 0 ? pct(v / r.revenue) : "—");
  const good = r.profit >= 0;
  const moods = Object.entries(r.staffMoodDelta);
  const happened = incidentLines(r, game);
  const covered = r.ownerCovered ?? [];
  const staffed = covered.length ? lastStaffedDay(game.history, r.day) : undefined;
  const moreTables = r.walkouts > WALKOUTS_FOR_TABLE_TIP && game.tables.length < content.balance.maxTables;

  return (
    <div className="page">
      <div className="evening">
        <div className="evening__head">
          <div>
            <div className="xs faint" style={{ fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Evening · Day {r.day + 1} · {dateLabel(r.day)}</div>
            <h1>{good ? (r.averageRating >= 4 ? "What a night!" : "Doors closed, money in the till.") : "A tough night."}</h1>
          </div>
          <span className="spacer" />
          <button className="btn btn--primary btn--xl" onClick={onNext} autoFocus>{nextLabel}</button>
        </div>

        <div className="stack">
          {game.phase !== "gameover" && <Restock game={game} send={send} />}
          {covered.length > 0 && (
            <div className="card tip tip--amber">
              <span className="tip__icon" aria-hidden="true">🧑‍🍳</span>
              <div className="spacer">
                <b>You covered {coveringPhrase(covered)} yourself today.</b>
                <div className="small">
                  {staffed
                    ? <>Day {staffed.day + 1}, with a full team: {staffed.covers} served, {staffed.walkouts} walked out, {staffed.averageRating.toFixed(1)}★. Today: {r.covers} served, {r.walkouts} walked out, {r.averageRating.toFixed(1)}★.</>
                    : <>Today: {r.covers} served, {r.walkouts} walked out, {r.averageRating.toFixed(1)}★. A proper team cooks better and faster, and you'll get tired doing it all.</>}
                </div>
              </div>
              {onGoTo && <button className="btn btn--sm" onClick={() => onGoTo("staff")}>Hire →</button>}
            </div>
          )}
          {(game.ownerFatigue ?? 0) >= OWNER_FATIGUE_WARNING && game.phase !== "gameover" && <FatigueNote fatigue={game.ownerFatigue ?? 0} onHire={onGoTo ? () => onGoTo("staff") : undefined} />}
          {moreTables && (
            <div className="card tip">
              <span className="tip__icon" aria-hidden="true">🪑</span>
              <div className="spacer">
                <b>{r.walkouts} people walked out.</b>
                <div className="small">Another table (<MoneyText pence={TABLE_COST} whole />) seats more of the queue — if the kitchen can keep up.</div>
              </div>
              {onGoTo && <button className="btn btn--sm" onClick={() => onGoTo("restaurant")}>Buy a table →</button>}
            </div>
          )}
          <div className="card">
            <div className="card__title"><h3>Today's takings</h3><span className="xs faint">% of revenue</span></div>
            <table className="pnl">
              <tbody>
                <tr><td>Food & drink sales</td><td><MoneyText pence={r.revenue} /></td></tr>
                <tr className="pnl__cost"><td>VAT to the taxman <span className="pnl__pct">{ofRev(vat)}</span></td><td><MoneyText pence={-vat} /></td></tr>
                <tr className="pnl__cost"><td>Food cost <span className="pnl__pct">{ofRev(r.foodCost)}</span></td><td><MoneyText pence={-r.foodCost} /></td></tr>
                <tr className="pnl__cost"><td>Staff wages <span className="pnl__pct">{ofRev(r.labourCost)}</span></td><td><MoneyText pence={-r.labourCost} /></td></tr>
                <tr className="pnl__cost"><td>Rent (today's share)</td><td><MoneyText pence={-r.rent} /></td></tr>
                <tr className="pnl__cost"><td>Bills &amp; card fees</td><td><MoneyText pence={-overheads} /></td></tr>
                {incidentCosts > 0 && <tr className="pnl__cost"><td>Problems sorted <span className="pnl__pct">call-ins, engineer, treats</span></td><td><MoneyText pence={-incidentCosts} /></td></tr>}
                <tr className="pnl__cost"><td>Loan repayment</td><td><MoneyText pence={-r.loanPayment} /></td></tr>
                <tr className="pnl__cost"><td>Waste <span className="pnl__pct">{ofRev(wasteCost)}</span></td><td><MoneyText pence={-wasteCost} /></td></tr>
                <tr className="pnl__sub"><td>Prep trimmings</td><td><MoneyText pence={-r.waste.prep} /></td></tr>
                <tr className="pnl__sub"><td>Spoiled stock</td><td><MoneyText pence={-r.waste.spoil} /></td></tr>
                <tr className="pnl__total"><td>{good ? "Profit" : "Loss"}</td><td><MoneyText pence={r.profit} tone signed /></td></tr>
              </tbody>
            </table>
            <p className="xs faint" style={{ marginTop: 8 }}>
              Left on plates: <MoneyText pence={r.waste.plate} /> (already in food cost) · Tips for the team: <MoneyText pence={r.tips} /> (not your money) · Cash now: <MoneyText pence={game.cash} tone />
            </p>
          </div>

          <div className="card">
            <div className="card__title"><h3>Reputation</h3></div>
            <div className="repgrid">
              <div className="reprow"><span>Popularity</span><Bar value={game.reputation.popularity} tone="accent" /><Delta v={r.popularityDelta} /></div>
              <div className="reprow"><span>Prestige</span><Bar value={game.reputation.prestige} tone="plum" /><Delta v={r.prestigeDelta} /></div>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="kpis">
            <div className="kpi"><div className="kpi__k">Covers</div><div className="kpi__v">{r.covers}</div></div>
            <div className="kpi"><div className="kpi__k">Walkouts</div><div className="kpi__v" style={{ color: r.walkouts ? "var(--tomato-deep)" : undefined }}>{r.walkouts}</div></div>
            <div className="kpi"><div className="kpi__k">Avg spend</div><div className="kpi__v"><MoneyText pence={r.averageSpend} /></div></div>
            <div className="kpi"><div className="kpi__k">Avg rating</div><div className="kpi__v">{r.averageRating.toFixed(1)} <Stars rating={r.averageRating} size={15} /></div></div>
          </div>

          <div className="dishpair">
            <div className="dishpick dishpick--best">
              <span className="dishpick__icon" aria-hidden="true">🏆</span>
              <div><div className="dishpick__k">Best dish</div><div className="dishpick__name">{r.bestDish ? dishName(content, r.bestDish) : "—"}</div></div>
            </div>
            <Worst game={game} r={r} />
          </div>

          {happened.length > 0 && (
            <div className="card">
              <div className="card__title"><h3>What happened today</h3><span className="small muted">{happened.length}</span></div>
              <ul className="happened">
                {happened.map((h, i) => (
                  <li key={i} className={`happened__row ${h.ignored ? "happened__row--bad" : ""}`}>
                    <span aria-hidden="true">{INCIDENT_ICON[h.kind] ?? "❗"}</span>
                    <div>
                      <div><b>{h.title}</b> <span className="xs muted">· {h.choice}</span></div>
                      {h.outcome && <div className="small">{h.outcome}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card">
            <div className="card__title"><h3>What people said</h3><span className="small muted">{r.reviews.length} review{r.reviews.length === 1 ? "" : "s"}</span></div>
            {r.reviews.length === 0 ? <div className="empty small">Nobody wrote anything today.</div> : (
              <div className="reviews">
                {r.reviews.map((rv, i) => (
                  <div key={i} className="review">
                    <span className="review__icon" title={SOURCE[rv.source].label} aria-hidden="true">{SOURCE[rv.source].icon}</span>
                    <div>
                      <div className="row"><Stars rating={rv.rating} size={14} /><span className="review__src">{SOURCE[rv.source].label}{rv.dishId ? ` · ${dishName(content, rv.dishId)}` : ""}</span></div>
                      <div className="review__text">“{rv.text}”</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card__title"><h3>How the team feels</h3></div>
            {moods.length === 0 ? <div className="empty small">No mood changes today.</div> : (
              <div className="moodlist">
                {moods.map(([id, d]) => {
                  const s = game.staff.find((x) => x.id === id);
                  return (
                    <div key={id} className="moodrow">
                      <span className={`avatar avatar--${s?.role ?? "manager"}`} aria-hidden="true">{initials(s?.name ?? "?")}</span>
                      <span><b>{s?.name ?? "Former staff"}</b> <span aria-hidden="true">{s ? moodFace(s.mood) : ""}</span></span>
                      {s ? <Bar value={s.mood} tone="auto" size="sm" /> : <span />}
                      <Delta v={d} digits={0} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
