import { formatPounds } from "../../lib/format";
import { useEffect, useRef } from "react";
import { associationBlocks, bookNet, spendable, type BoardDecisionKind, type BoardIncome, type BoardMeeting as Meeting, type EmpireCommand, type EmpireState } from "@full-plate/sim-empire";
import { content } from "../../sim";
import { dateLabel } from "../../lib/calendar";
import { MoneyText } from "../../components/MoneyText";
import { Term } from "../../components/Term";
import type { TermId } from "../../lib/glossary";
import { TermText } from "../../components/TermText";

interface Props {
  empire: EmpireState;
  meeting: Meeting;
  send: (cmd: EmpireCommand) => void;
}

/** The month's money, one line per source (round 6). Rows with nothing in them are left out, except your own shops. */
const INCOME_ROWS: { key: keyof BoardIncome; icon: string; term: TermId; label: string }[] = [
  { key: "shops", icon: "🏪", term: "company", label: "Your own shops" },
  { key: "royalties", icon: "👑", term: "royalty", label: "Royalties from franchise shops" },
  { key: "rent", icon: "🏠", term: "landRent", label: "Rent from your land" },
  { key: "fees", icon: "✍️", term: "franchiseFee", label: "Joining fees" },
  { key: "supply", icon: "🍞", term: "supplyMarkup", label: "Extra on food" },
  { key: "costs", icon: "🏢", term: "hqCosts", label: "Running HQ" },
];

/** The trade word behind each kind of question (shown as a "What's this?" chip). */
const KIND_TERM: Record<BoardDecisionKind, TermId> = {
  royalty: "royalty",
  localise: "localise",
  buyPlot: "plot",
  refurbish: "refurb",
  feeHoliday: "feeHoliday",
  driveThru: "driveThru",
  supplyMarkup: "supplyMarkup",
  campaign: "campaign",
  debt: "facility",
};

const RISK_ICON: Record<Meeting["risk"]["kind"], string> = { mood: "😠", collapse: "📉", borrowing: "🏦", maturity: "🧱", none: "😊" };
const districtName = (id: string) => content.districts.find((d) => d.id === id)?.name ?? id.replace("_", " ");

/**
 * Round 6: the Empire's monthly board meeting (EMPIRE-NOTES §3 "Board meeting"). Short sentences for a child; the real
 * words sit in <Term>. It stays up — and "Next day" waits — until an option is picked or the meeting is skipped.
 */
export function BoardMeeting({ empire: e, meeting: m, send }: Props) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); }, [m.id]);
  const net = bookNet(m.income);
  const rows = INCOME_ROWS.filter((r) => r.key === "shops" || m.income[r.key] !== 0);
  const mover = m.topMover;
  const moverCity = mover ? e.cities.find((c) => c.id === mover.cityId)?.name ?? mover.cityId : "";
  const d = m.decision;
  const tip = d.options.find((o) => o.id === d.advice);
  // Round 6 review: with no company shop but the one she runs, "Your own shops £0" read like a failing shop.
  const own = e.sites.filter((s) => s.ownership === "company" && s.status !== "closed");
  const onlyFlagship = own.length > 0 && own.every((s) => s.focused) && m.income.shops === 0;
  // Round 7: each money line gets a bar, so the biggest earner is the longest bar.
  const biggest = Math.max(1, ...rows.map((r) => Math.abs(m.income[r.key])));
  const [, dd, mon] = dateLabel(m.day).split(" ");
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="board-title">
      <div className="modal modal--wide boardmeeting">
        <div className="modal__banner boardmeeting__banner">
          <span className="boardmeeting__date" aria-hidden="true"><b>{dd}</b><span>{mon}</span></span>
          <div>
            <div className="modal__kicker"><span aria-hidden="true">📋</span> The <Term id="boardMeeting" inline>board meeting</Term> · {dateLabel(m.day)}</div>
            <h2 id="board-title">How did {e.brand.name} do this month?</h2>
          </div>
        </div>
        <div className="modal__body boardmeeting__body">
          <div className="boardmeeting__top">
            <section aria-label="Money this month" className="boardmeeting__money">
              <h3>{net >= 0 ? <><Term id="hq" inline>HQ</Term> made <MoneyText pence={net} whole tone /></> : <><Term id="hq" inline>HQ</Term> lost <MoneyText pence={-net} whole tone={false} className="money--neg" /></>}</h3>
              <ul className="boardmeeting__rows">
                {rows.map((r) => (
                  <li key={r.key}>
                    <span aria-hidden="true">{r.icon}</span>
                    <Term id={r.term} inline>{r.label}</Term>
                    <span className="spacer" />
                    <MoneyText pence={m.income[r.key]} whole tone signed />
                    <span className="boardmeeting__bar" aria-hidden="true"><span className={m.income[r.key] < 0 ? "neg" : ""} style={{ width: `${(Math.abs(m.income[r.key]) / biggest) * 100}%` }} /></span>
                  </li>
                ))}
              </ul>
              {onlyFlagship && (
                <p className="small muted boardmeeting__own" aria-label="About your own shops">
                  £0 because your only own shop is the one you run: its money stays in its own till (the Evening shows it).
                </p>
              )}
            </section>
            <section className="stack stack--sm">
              {mover && (
                <p className="boardmeeting__note" aria-label="Top mover">
                  <span aria-hidden="true">📈</span> <b>Biggest riser:</b> {districtName(mover.districtId)}, {moverCity}. Sales up <MoneyText pence={mover.change} whole /> a year.
                </p>
              )}
              <p className={`boardmeeting__note callout ${m.risk.kind === "none" ? "callout--good" : "callout--warn"}`} aria-label="Worry">
                <span aria-hidden="true">{RISK_ICON[m.risk.kind]}</span> <b>{m.risk.kind === "none" ? "All calm." : "Worry:"}</b> {m.risk.kind === "none" ? "No big worries this month." : <TermText text={m.risk.text} />}
              </p>
            </section>
          </div>

          <section aria-label="The decision" className="stack stack--sm boardmeeting__decision">
            <div className="boardmeeting__ask"><span aria-hidden="true">🗳️</span> The board needs you to decide</div>
            <h3 className="boardmeeting__q"><TermText text={d.question} /> <span className="xs muted">(<Term id={KIND_TERM[d.kind]} inline>what's this?</Term>)</span></h3>
            <div className="boardmeeting__options">
              {d.options.map((o, i) => {
                const why = (o.cmd && associationBlocks(e, o.cmd)) ?? (o.cost && spendable(e) < o.cost ? `HQ can only spend ${pounds(Math.max(0, spendable(e)))} right now.` : undefined);
                return (
                  <button key={o.id} ref={i === 0 ? first : undefined} className={`libdish libdish--btn boardmeeting__option ${o.id === d.advice ? "boardmeeting__option--tip" : ""}`} disabled={!!why} onClick={() => send({ type: "BOARD_DECIDE", optionId: o.id })}>
                    {o.id === d.advice && <span className="boardmeeting__ribbon" aria-hidden="true">💡 The board's pick</span>}
                    <b><TermText text={o.label} inButton /></b>
                    <span className="small"><TermText text={o.detail} inButton /></span>
                    {why && <span className="small boardmeeting__why"><TermText text={why} inButton /></span>}
                  </button>
                );
              })}
            </div>
            {tip && <p className="small muted" aria-label="Board's tip"><span aria-hidden="true">💡</span> The board thinks: <b><TermText text={tip.label} /></b>.</p>}
          </section>

          <div className="row boardmeeting__skip">
            <button className="btn btn--ghost btn--tap" onClick={() => send({ type: "BOARD_DECIDE", optionId: "skip" })}>Skip this one</button>
            <span className="small muted">If you skip: <TermText text={d.skipText} /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

const pounds = formatPounds;

