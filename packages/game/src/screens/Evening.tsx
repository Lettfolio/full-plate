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
import { dateLabel, WEEKDAY_NAMES, weekdayIndex } from "../lib/calendar";
import { initials, moodFace } from "../lib/staff";
import type { EmpireCommand } from "@full-plate/sim-empire";
import type { ShiftSummary } from "@full-plate/handson";
import { FORK_DAY, forkMilestone, type PathMeta } from "../state/paths";
import { compactMeals } from "../components/StatusBar";
import { inSeason } from "@full-plate/sim-stars";
import { Term } from "../components/Term";
import { AdviceCard } from "../components/AdviceCard";
import { DayRhythm } from "../components/DayRhythm";
import { lastNights, versusYesterday } from "../lib/dayLoop";
import { formatPence } from "../lib/format";
import { ArrowLabel, Icon } from "../components/Icon";

/**
 * Round 7 (B): tonight's money as one big friendly figure (count-up, ▲/▼, green/red), what that is against last
 * night, and the last seven nights as bars, so "a tough night" has a size. The sums stay one tap away.
 */
export function TonightMoney({ game, r }: { game: GameState; r: DayResult }) {
  const up = r.profit >= 0;
  const vs = versusYesterday(game.history.at(-1)?.day === r.day ? game.history : [...game.history, r]);
  const nights = lastNights(game.history.at(-1)?.day === r.day ? game.history : [...game.history, r]);
  const peak = Math.max(1, ...nights.map((n) => Math.abs(n.profit)));
  return (
    <section className={`tonight tonight--${up ? "up" : "down"}`} aria-label="Tonight's money">
      <div className="tonight__main">
        <div className="tonight__k">{up ? "Tonight you made" : "Tonight you lost"}</div>
        <div className="tonight__v">
          <span className="tonight__arrow" aria-hidden="true"><Icon name={up ? "trendUp" : "trendDown"} size={44} /></span>
          <MoneyText pence={Math.abs(r.profit)} whole countUp="mount" />
        </div>
        {vs !== undefined && (
          <div className={`tonight__vs tonight__vs--${vs >= 0 ? "up" : "down"}`}>
            {vs === 0 ? "The same as last night" : `${formatPence(Math.abs(vs), { whole: true })} ${vs > 0 ? "better" : "worse"} than last night`}
          </div>
        )}
        <div className="tonight__facts">
          <span><b>{r.covers}</b> <Term id="covers" inline>guests</Term></span>
          <span className={r.walkouts ? "tonight__bad" : ""}><b>{r.walkouts}</b> walked out</span>
          <span><b>{r.averageRating.toFixed(1)}</b> <Stars rating={r.averageRating} size={15} /></span>
          <span>Cash in the bank <b><MoneyText pence={game.cash} whole tone /></b></span>
        </div>
      </div>
      {nights.length > 1 && (
        <div className="tonight__week" role="img" aria-label={`Last ${nights.length} nights: ${nights.map((n) => `${WEEKDAY_NAMES[weekdayIndex(n.day)]} ${n.profit < 0 ? "lost" : "made"} ${formatPence(Math.abs(n.profit), { whole: true })}`).join(", ")}`}>
          <div className="tonight__bars" aria-hidden="true">
            {nights.map((n) => (
              <div key={n.day} className={`tonight__col ${n.day === r.day ? "is-tonight" : ""}`}>
                <div className="tonight__half tonight__half--up">{n.profit > 0 && <i style={{ height: `${Math.max(6, (n.profit / peak) * 100)}%` }} />}</div>
                <div className="tonight__half tonight__half--down">{n.profit < 0 && <i style={{ height: `${Math.max(6, (-n.profit / peak) * 100)}%` }} />}</div>
                <span className="tonight__day">{n.day === r.day ? "Today" : WEEKDAY_NAMES[weekdayIndex(n.day)]!.slice(0, 3)}</span>
              </div>
            ))}
          </div>
          <div className="tonight__weeknote">Your last {nights.length} nights</div>
        </div>
      )}
    </section>
  );
}

interface Props {
  game: GameState;
  result: DayResult | null;
  /** END_DAY on a normal evening; opens the event modal when tomorrow has a card (phase "event"). */
  onNext: () => void;
  /** Go to tomorrow's planning on a given tab (Hire → Staff, Buy a table → Restaurant). */
  onGoTo?: (tab: PlanningTab) => void;
  /** [round 6] The tip's one-tap action: end the evening, apply `commands` tomorrow morning, open `tab`. */
  onAct?: (commands: Command[], tab: PlanningTab, done: string, now?: boolean) => void;
  nextLabel: string;
  send: (cmd: Command) => void;
  /** Round 3: path layers (Empire sweep, Stars news) and the hands-on score. */
  meta?: PathMeta;
  sendEmpire?: (cmd: EmpireCommand) => void;
  shiftSummary?: ShiftSummary | null;
}

const STARS_LINE: Partial<Record<string, string>> = { CRITIC_REVIEW: "🎩", INSPECTOR_HINT: "🕵️", STRESS_WARNING: "😰", BURNOUT: "🔥", RESEARCH_DONE: "🧪", SMYTH_ARC_STARTED: "🧑‍🍳", HEAD_CHEF_LEFT: "👋", STAGIAIRE_SCANDAL: "📰", FIFTY_BEST: "🌍", GAULT_MILLAU: "🎩", GOOD_FOOD: "📗", INSPECTION_SEASON: "🗓️", SHORT_MENU: "📉" };

/** Round 3 cards: the Empire's evening (meals, HQ, move cash), the Stars' news, and the hands-on score. */
function PathCards({ game, meta, sendEmpire, shiftSummary }: { game: GameState; meta?: PathMeta; sendEmpire?: (cmd: EmpireCommand) => void; shiftSummary?: ShiftSummary | null }) {
  const e = meta?.empire;
  const news = (meta?.starsEvents ?? []).flatMap((ev) => {
    const icon = STARS_LINE[ev.type];
    if (!icon) return [];
    const text = ev.type === "CRITIC_REVIEW" ? `${ev.review.critic} (${"★".repeat(ev.review.rating)}): “${ev.review.text}”`
      : ev.type === "INSPECTOR_HINT" ? ev.text
      : ev.type === "STRESS_WARNING" ? `Your head chef's stress is at ${Math.round(ev.stress)}.`
      : ev.type === "BURNOUT" ? "Your head chef has burnt out. The kitchen will wobble for a while."
      : ev.type === "RESEARCH_DONE" ? `The test kitchen finished ${dishName(content, ev.dishId)}: it's a signature now.`
      : ev.type === "SMYTH_ARC_STARTED" ? "Your head chef wants a place of their own — see the Stars tab."
      : ev.type === "HEAD_CHEF_LEFT" ? (ev.backed ? "Your head chef has left to open their own place, with your blessing." : `Your head chef has left${ev.rival ? ` to open ${ev.rival}` : ""}.`)
      : ev.type === "STAGIAIRE_SCANDAL" ? "A newspaper story about unpaid stagiaires. Ouch."
      : ev.type === "FIFTY_BEST" ? (ev.hallOfFame ? "The World's 50 Greatest Tables: number one — into the hall of fame!" : ev.rank ? `The World's 50 Greatest Tables: number ${ev.rank}.` : "Not on the World's 50 Greatest Tables list this year.")
      : ev.type === "GAULT_MILLAU" ? `The Toque Guide gives you ${ev.points.toFixed(1)}/20.`
      : ev.type === "GOOD_FOOD" ? (ev.tier ? `The Good Table Guide lists you at ${ev.tier}/10.` : "Not in the Good Table Guide this year.")
      : ev.type === "INSPECTION_SEASON" ? `Inspection season: ${ev.daysToGuide} days to guide day.`
      : ev.type === "SHORT_MENU" ? ev.text : "";
    return text ? [{ icon, text }] : [];
  });
  const lastMeals = e?.history.at(-1);
  const spare = Math.max(0, game.cash - 200_000);
  // Year 2 has started but nobody has come calling yet: say what's missing (once a week, on Sundays).
  const fork = meta?.fork;
  const forkHint = meta && meta.mode === "owner" && fork && !fork.chosen && !fork.offered && game.day >= FORK_DAY && weekdayIndex(game.day) === 6 ? forkMilestone(game).missing : undefined;
  return (
    <>
      {forkHint && (
        <div className="card tip">
          <span className="tip__icon" aria-hidden="true">🍴</span>
          <div className="spacer"><b>People in the trade are watching.</b> <span className="small">A franchise consultant and a critic both want to visit when you {forkHint}.</span></div>
        </div>
      )}
      {shiftSummary && (
        <div className="card tip">
          <span className="tip__icon" aria-hidden="true">🧑‍🍳</span>
          <div className="spacer">
            <b>You jumped in: {"★".repeat(shiftSummary.stars)}{"☆".repeat(3 - shiftSummary.stars)} · {shiftSummary.points} points</b>
            <div className="small">{shiftSummary.lines.map((l) => `${l.label} ${l.value}`).join(" · ")}</div>
          </div>
        </div>
      )}
      {e && (
        <div className="card">
          <div className="card__title"><h3>🍔 {e.brand.name} tonight</h3><span className="xs faint">{e.sites.filter((x) => x.status === "open").length} site{e.sites.filter((x) => x.status === "open").length === 1 ? "" : "s"}</span></div>
          <div className="small">Meals served so far: <b>{compactMeals(e.mealsServedTotal)}</b> · HQ cash <MoneyText pence={e.hq.cash} whole tone /> · HQ net today <MoneyText pence={e.hq.lastDayNet} whole tone signed /></div>
          {lastMeals && <div className="xs muted">This month so far: {lastMeals.sites} sites trading.</div>}
          {sendEmpire && spare >= 10_000 && (
            <button className="btn btn--sm btn--green" style={{ marginTop: 8 }} onClick={() => sendEmpire({ type: "TRANSFER_FROM_FOCUSED", amount: spare })}>Sweep <MoneyText pence={spare} whole /> from the till to HQ</button>
          )}
        </div>
      )}
      {news.length > 0 && (
        <div className="card">
          <div className="card__title"><h3>⭐ News from the guides</h3></div>
          <ul className="happened">{news.map((n, i) => <li key={i} className="happened__row"><span aria-hidden="true">{n.icon}</span><div className="small">{n.text}</div></li>)}</ul>
        </div>
      )}
    </>
  );
}

/** Orders tomorrow's shortfall now (ORDER_STOCK is allowed in the evening; deliveries land next morning). */
function Restock({ game, send, inspection = false, stars = 0 }: { game: GameState; send: (cmd: Command) => void; inspection?: boolean; stars?: number }) {
  const lines = restockLines(game);
  const unit = (id: string) => content.ingredients.find((i) => i.id === id)?.unitCost ?? 0;
  const cost = lines.reduce((a, [id, q]) => a + q * unit(id), 0);
  const ordered = game.orders.length > 0;
  return (
    <div className={`card restock ${inspection && lines.length > 0 ? "callout--warn" : ""}`}>
      <div className="spacer">
        <h3>Stock for tomorrow</h3>
        {inspection && lines.length > 0 && <div className="small"><b>🕵️ Inspectors are about.</b> Run out tomorrow and a short menu could cost you {stars > 0 ? "the star" : "a star"}.</div>}
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
      <span className="dishpick__icon" aria-hidden="true"><Icon name="trendDown" size={26} /></span>
      <div>
        <div className="dishpick__k">{w?.reason === "unpopular" ? "Least popular" : w ? "Lowest quality" : "Worst dish"}</div>
        <div className="dishpick__name">{w ? dishName(content, w.dishId) : "—"}</div>
        <div className="xs muted">{w ? w.text : "Nothing stood out (dishes that sold fewer than 3 plates don't count)."}</div>
      </div>
    </div>
  );
}

/** "Friday, Saturday and Sunday" */
export function dayList(days: readonly number[]): string {
  const n = days.map((d) => WEEKDAY_NAMES[d]!);
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
}

export function Evening({ game, result, onNext, onGoTo, onAct, nextLabel, send, meta, sendEmpire, shiftSummary }: Props) {
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
        <div className="evening__head beathead">
          <DayRhythm beat="evening" weekday={WEEKDAY_NAMES[weekdayIndex(r.day)]!} />
          <h1 title={`Day ${r.day + 1} · ${dateLabel(r.day)}`}>{good ? (r.averageRating >= 4 ? "What a night!" : "Doors closed, money in the till.") : "A tough night."}</h1>
        </div>
        {/* Round 6: tonight's one tip comes first, across both columns (round 5's rota tip is one of them). */}
        {game.phase !== "gameover" && meta?.mode !== "career" && <div className="evening__tip"><AdviceCard game={game} onAct={onAct} /></div>}
        <div className="evening__money"><TonightMoney game={game} r={r} /></div>

        <div className="stack">
          {game.phase !== "gameover" && <Restock game={game} send={send} inspection={!!meta?.stars && !meta.stars.ending && inSeason(meta.stars, game.day + 1)} stars={meta?.stars?.guides.michelin.stars ?? 0} />}
          <PathCards game={game} {...(meta ? { meta } : {})} {...(sendEmpire ? { sendEmpire } : {})} shiftSummary={shiftSummary ?? null} />
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
          <details className="card sums">
            <summary className="sums__summary"><h3>Where the money went</h3><span className="small muted">tap to see the sums</span></summary>
            <table className="pnl">
              <caption className="sr-only">Where tonight's money went: sales, then each cost, then {good ? "profit" : "loss"}</caption>
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
                <tr className="pnl__total"><th scope="row">{good ? "Profit" : "Loss"}</th><td><MoneyText pence={r.profit} tone signed /></td></tr>
              </tbody>
            </table>
            <p className="xs faint" style={{ marginTop: 8 }}>
              Left on plates: <MoneyText pence={r.waste.plate} /> (already in food cost) · Tips for the team: <MoneyText pence={r.tips} /> (not your money) · Cash now: <MoneyText pence={game.cash} tone />
            </p>
          </details>

          <div className="card">
            <div className="card__title"><h3>Reputation</h3></div>
            <div className="repgrid">
              <div className="reprow"><Term id="popularity">Popularity</Term><Bar value={game.reputation.popularity} tone="accent" /><Delta v={r.popularityDelta} /></div>
              <div className="reprow"><Term id="prestige">Prestige</Term><Bar value={game.reputation.prestige} tone="plum" /><Delta v={r.prestigeDelta} /></div>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="dishpair">
            <div className="dishpick dishpick--best">
              <span className="dishpick__icon" aria-hidden="true"><Icon name="trophy" size={26} /></span>
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
      {/* Round 7: the same bottom-right place as Planning's "Open for service". */}
      <div className="actiondock actiondock--page">
        <span className="actiondock__note small muted">Average spend <b><MoneyText pence={r.averageSpend} /></b> a guest</span>
        <button className="btn btn--primary btn--xl" onClick={onNext} autoFocus><ArrowLabel text={nextLabel} /></button>
      </div>
    </div>
  );
}
