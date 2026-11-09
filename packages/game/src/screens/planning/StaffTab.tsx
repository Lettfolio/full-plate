import { useMemo, useState } from "react";
import type { Candidate, Command, GameState, Staff, StaffRole } from "@full-plate/sim-core";
import { candidates, content, HIRE_CASH_BUFFER_SHIFTS, recruitmentFeeOf, shiftCost, TRAINING_FEE, TRAINING_SKILL_GAIN } from "../../sim";
import { Bar } from "../../components/Bar";
import { MoneyText } from "../../components/MoneyText";
import { traitName } from "../../lib/content";
import { WEEKDAYS, weekdayIndex } from "../../lib/calendar";
import { coverage, initials, isTrainingToday, moodFace, moodWord, ROLE_LABEL, SHIFT_HOURS, trainBlocker } from "../../lib/staff";

/** A former colleague from the career (sim-career Relationship), hireable with HIRE_STAFF. */
export interface KnownPerson { staff: Staff; bond: number; employer: string }

interface Props {
  game: GameState;
  send: (cmd: Command) => void;
  /** List this role's candidates first and mark them (a "Hire a …" goal). */
  wantRole?: StaffRole;
  /** Round 3: people you worked with in career mode (after the handover). */
  known?: KnownPerson[];
}

function TraitTags({ ids }: { ids: string[] }) {
  return (
    <span className="row row--wrap" style={{ gap: 4 }}>
      {ids.map((t) => {
        const def = content.traits.find((x) => x.id === t);
        return <span key={t} className="tag" title={def?.description}>{traitName(content, t)}</span>;
      })}
    </span>
  );
}

function TrainButton({ s, game, today, send }: { s: Staff; game: GameState; today: number; send: Props["send"] }) {
  const blocked = trainBlocker(game, s, today);
  const poor = game.cash < TRAINING_FEE;
  const why = blocked ?? (poor ? "Not enough cash for the course" : null);
  const first = s.name.split(" ")[0];
  if (isTrainingToday(game, s)) return <span className="tag tag--train">📚 Training today</span>;
  return (
    <span className="train">
      <button
        className="btn btn--ghost btn--sm"
        disabled={!!why}
        aria-describedby={why ? `train-why-${s.id}` : undefined}
        onClick={() => send({ type: "TRAIN", staffId: s.id })}
        title={why ?? `A day on a course: ${first} gains ${TRAINING_SKILL_GAIN[0]}–${TRAINING_SKILL_GAIN[1]} skill but isn't working today (still paid)`}
      >
        📚 Train · <MoneyText pence={TRAINING_FEE} whole />
      </button>
      {why && <span id={`train-why-${s.id}`} className="xs muted train__why">{why}</span>}
    </span>
  );
}

function PersonCard({ s, game, today, send }: { s: Staff; game: GameState; today: number; send: Props["send"] }) {
  const [confirm, setConfirm] = useState(false);
  const shifts = s.rota.filter(Boolean).length;
  return (
    <div className="person">
      <div className="person__top">
        <span className={`avatar avatar--${s.role}`} aria-hidden="true">{initials(s.name)}</span>
        <div className="spacer">
          <div className="person__name">{s.name}</div>
          <div className="person__role">{ROLE_LABEL[s.role]} · <MoneyText pence={s.wage} />/h</div>
        </div>
        <span className="person__mood" title={`Mood ${Math.round(s.mood)} — ${moodWord(s.mood)}`} aria-label={`Mood: ${moodWord(s.mood)}`}>{moodFace(s.mood)}</span>
      </div>
      <div className="person__bars">
        <Bar label="Skill" value={s.skill} tone="accent" size="sm" showValue />
        <Bar label="Speed" value={s.speed} tone="sky" size="sm" showValue />
        <Bar label="Charm" value={s.charm} tone="plum" size="sm" showValue />
        <Bar label="Mood" value={s.mood} tone="auto" size="sm" showValue />
        {s.fatigue > 30 && <Bar label="Tired" value={s.fatigue} tone="amber" size="sm" showValue />}
      </div>
      <TraitTags ids={s.traits} />
      <div>
        <div className="row xs muted" style={{ marginBottom: 4 }}>
          <span className="spacer">Rota · {shifts} shift{shifts === 1 ? "" : "s"}</span>
          <span>~<MoneyText pence={shiftCost(s) * shifts} whole />/week</span>
        </div>
        <div className="rota" role="group" aria-label={`${s.name}'s rota`}>
          {WEEKDAYS.map((d, i) => (
            <button
              key={d}
              className={`rota__day ${i === today ? "rota__day--today" : ""}`}
              aria-pressed={!!s.rota[i]}
              title={i === today ? `${d} (today)` : d}
              onClick={() => send({ type: "SET_ROTA", staffId: s.id, rota: s.rota.map((v, j) => (j === i ? !v : v)) })}
            >
              {d.slice(0, 2)}
            </button>
          ))}
        </div>
      </div>
      <TrainButton s={s} game={game} today={today} send={send} />
      <div className="row">
        <span className="xs faint spacer">With you since day {s.hiredDay + 1}</span>
        {confirm ? (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => setConfirm(false)}>Keep</button>
            <button className="btn btn--primary btn--sm" onClick={() => send({ type: "FIRE", staffId: s.id })}>Let {s.name.split(" ")[0]} go</button>
          </>
        ) : (
          <button className="btn btn--ghost btn--sm btn--danger-text" onClick={() => setConfirm(true)}>Let go…</button>
        )}
      </div>
    </div>
  );
}

function CandidateCard({ c, cash, fee, onHire, wanted = false }: { c: Candidate; cash: number; fee: number; onHire: () => void; wanted?: boolean }) {
  // Same rule as sim-core's HIRE: cash ≥ fee + a few shifts' wages. The fee is the game's (a manager's perk lowers it).
  const perShift = shiftCost(c);
  const needed = fee + HIRE_CASH_BUFFER_SHIFTS * perShift;
  const canAfford = cash >= needed;
  return (
    <div className={`candidate ${wanted ? "candidate--wanted" : ""}`}>
      {wanted && <div className="candidate__wanted">🎯 The {ROLE_LABEL[c.role].toLowerCase()} your goal asks for</div>}
      <div className="row">
        <span className={`avatar avatar--${c.role}`} style={{ width: 34, height: 34, fontSize: 14 }} aria-hidden="true">{initials(c.name)}</span>
        <div className="spacer">
          <div style={{ fontWeight: 800 }}>{c.name}</div>
          <div className="xs muted">{ROLE_LABEL[c.role]} · <MoneyText pence={c.wage} />/h · <i>{c.potentialHint}</i></div>
        </div>
        <button className="btn btn--green btn--sm" onClick={onHire} disabled={!canAfford} title={canAfford ? undefined : `Needs £${Math.ceil(needed / 100)} in the bank`}>
          Hire · <MoneyText pence={fee} whole />
        </button>
      </div>
      <div className="xs muted">Costs about <MoneyText pence={perShift} whole /> per shift worked</div>
      <Bar label="Skill" value={c.skill} tone="accent" size="sm" showValue />
      <Bar label="Speed" value={c.speed} tone="sky" size="sm" showValue />
      <Bar label="Charm" value={c.charm} tone="plum" size="sm" showValue />
      <TraitTags ids={c.traits} />
    </div>
  );
}

export function StaffTab({ game, send, wantRole, known = [] }: Props) {
  const today = weekdayIndex(game.day);
  const pool = useMemo(() => candidates(content, game), [game]);
  // Indices stay stable after a hire (HIRE uses them); sim-core flags hired candidates with `hired`.
  // Stable sort: the wanted role first, otherwise the sim's order. Indices are kept for HIRE.
  const shown = pool
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !c.hired)
    .sort((a, b) => Number(b.c.role === wantRole) - Number(a.c.role === wantRole));
  const roles: StaffRole[] = ["chef", "server", ...(["bar", "porter", "manager"] as const).filter((r) => game.staff.some((s) => s.role === r))];
  const wageBill = game.staff.reduce((a, s) => a + (s.rota[today] ? shiftCost(s) : 0), 0);
  const fee = recruitmentFeeOf(game);
  const friends = known.filter((k) => k.bond >= 0 && !game.staff.some((s) => s.id === k.staff.id || s.name === k.staff.name));

  return (
    <div className="staffgrid">
      <div className="stack">
        <div className="row">
          <h3 className="spacer">Your team</h3>
          <span className="small muted">Today's wages ≈ <b><MoneyText pence={wageBill} /></b></span>
        </div>
        {game.staff.length === 0 ? <div className="empty">Nobody works here yet. Hire a chef and a server →</div> : (
          <div className="roster">{game.staff.map((s) => <PersonCard key={s.id} s={s} game={game} today={today} send={send} />)}</div>
        )}
        <div className="card" style={{ padding: 12 }}>
          <div className="xs faint" style={{ fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Who's on each day</div>
          <div className="coverage">
            <span />
            {WEEKDAYS.map((d, i) => <span key={d} className="coverage__cell" style={{ background: "transparent", outline: i === today ? "2px solid var(--amber)" : undefined }}>{d}</span>)}
            {roles.map((r) => (
              <Coverage key={r} label={ROLE_LABEL[r] + "s"} counts={coverage(game.staff, r)} />
            ))}
          </div>
        </div>
      </div>

      <aside className="stack stack--sm">
        <h3>Looking for work</h3>
        <p className="small muted">New faces every morning. Wages are per hour; a shift is {SHIFT_HOURS} hours. Hiring costs a <MoneyText pence={fee} whole /> agency fee.</p>
        {shown.length === 0 && <div className="empty small">No one else today. Check again tomorrow.</div>}
        {shown.map(({ c, i }) => <CandidateCard key={`${i}-${c.name}`} c={c} fee={fee} cash={game.cash} wanted={c.role === wantRole} onHire={() => send({ type: "HIRE", candidateIndex: i })} />)}
        {friends.length > 0 && (
          <>
            <h3 style={{ marginTop: 10 }}>Old colleagues</h3>
            <p className="small muted">People you worked with before you opened. They know you, and they'd come.</p>
            {friends.map((k) => (
              <CandidateCard
                key={k.staff.id}
                c={{ ...k.staff, potentialHint: `worked with you at ${k.employer} · bond ${Math.round(k.bond)}` } as Candidate}
                fee={fee}
                cash={game.cash}
                onHire={() => send({ type: "HIRE_STAFF", staff: k.staff })}
              />
            ))}
          </>
        )}
      </aside>
    </div>
  );
}

function Coverage({ label, counts }: { label: string; counts: number[] }) {
  return (
    <>
      <span>{label}</span>
      {counts.map((n, i) => <span key={i} className={`coverage__cell ${n === 0 ? "coverage__cell--zero" : ""}`}>{n}</span>)}
    </>
  );
}
