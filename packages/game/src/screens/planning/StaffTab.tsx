import { useId, useMemo, useState, type ReactNode } from "react";
import { Icon, type IconName } from "../../components/Icon";
import { Avatar } from "../../components/Avatar";
import type { Candidate, Command, GameState, Staff, StaffRole, TrackDef, TraitDef } from "@full-plate/sim-core";
import {
  dislikeLabel, likeLabel, nextTrackFee, personalityOf, quoteFor, relationsOf, TRACK_MAX_LEVEL, trackLevel, tracksFor,
} from "@full-plate/sim-core";
import { candidates, content, hireCheck, recruitmentFeeOf, shiftCost } from "../../sim";
import { Bar } from "../../components/Bar";
import { MoneyText } from "../../components/MoneyText";
import { placeTip } from "../../components/Term";
import { WEEKDAYS, weekdayIndex } from "../../lib/calendar";
import { RotaWeek } from "./RotaWeek";
import { isTrainingToday, moodFace, moodWord, onFloorToday, ROLE_LABEL, SHIFT_HOURS } from "../../lib/staff";
import { useSpendGuard } from "../../components/SpendGuard";
import { StarterLoanTip } from "../../components/BankCards";
import "./staffRoom.css";

/**
 * Round 10 (B): the staff room. Everyone is a person: a portrait (sim-core `avatarFor`, components/Avatar), a mood
 * face with the evening's reason, traits as chips with a tip, a like and a dislike, who they get on with and who they
 * clash with, skill bars, the rota, and training paths (TRAIN { track }) with level dots. Hiring opens a sheet of
 * today's three candidates, each with a "why me" quote (content staffQuotes.json).
 */

/** A former colleague from the career (sim-career Relationship), hireable with HIRE_STAFF. */
export interface KnownPerson { staff: Staff; bond: number; employer: string }

interface Props {
  game: GameState;
  send: (cmd: Command) => void;
  /** List this role's candidates first and mark them (a "Hire a …" goal); opens the hiring sheet. */
  wantRole?: StaffRole;
  /** Round 3: people you worked with in career mode (after the handover). */
  known?: KnownPerson[];
}

/** How many candidates the hiring sheet shows (sim-core offers 3-5 a day; the rest are still hireable tomorrow's way). */
export const SHEET_SIZE = 3;

const first = (name: string) => name.split(" ")[0] ?? name;

const EFFECT_WORDS: Record<keyof TraitDef["effects"], [string, string]> = {
  skill: ["cooks better", "cooks worse"],
  speed: ["works faster", "works slower"],
  charm: ["more charming", "less charming"],
  moodDecay: ["gets grumpy quicker", "stays cheerful"],
  wageDemand: ["asks for more pay", "asks for less pay"],
  mistakeRate: ["makes more mistakes", "makes fewer mistakes"],
};
/** "Works faster, makes more mistakes" from a trait's multipliers. */
export function traitEffectLine(def: TraitDef): string {
  const parts = (Object.entries(def.effects) as [keyof TraitDef["effects"], number][])
    .filter(([, v]) => v !== 1)
    .map(([k, v]) => EFFECT_WORDS[k][v > 1 ? 0 : 1]);
  const s = parts.join(", ");
  return s ? s[0]!.toUpperCase() + s.slice(1) + "." : "";
}

/** A chip with a tip on hover and keyboard focus (the Term tooltip pattern). */
function TipChip({ label, tip, icon, tone }: { label: ReactNode; tip: ReactNode; icon?: IconName; tone?: "like" | "dislike" | "friend" | "clash" }) {
  const id = `tip-${useId().replace(/:/g, "")}`;
  return (
    <span className={`term chip${tone ? ` chip--${tone}` : ""}`} tabIndex={0} aria-describedby={id} onFocus={(e) => placeTip(e.currentTarget)} onMouseEnter={(e) => placeTip(e.currentTarget)}>
      {icon && <Icon name={icon} size={16} />}
      <span>{label}</span>
      <span role="tooltip" id={id} className="term__tip">{tip}</span>
    </span>
  );
}

function TraitChips({ ids }: { ids: string[] }) {
  return (
    <div className="chips" aria-label="Personality">
      {ids.map((t) => {
        const def = content.traits.find((x) => x.id === t);
        if (!def) return null;
        return <TipChip key={t} label={def.name} tip={<><b>{def.name}.</b> {def.description} {traitEffectLine(def)}</>} />;
      })}
    </div>
  );
}

function Tastes({ person }: { person: { id?: string; name: string; role: StaffRole } }) {
  const t = personalityOf(person);
  const name = first(person.name);
  return (
    <div className="chips">
      <TipChip tone="like" icon="thumbsUp" label={<>Loves {likeLabel(content, t.like)}</>} tip={`${name} cheers up a little on a day with ${likeLabel(content, t.like)}.`} />
      <TipChip tone="dislike" icon="thumbsDown" label={<>Hates {dislikeLabel(content, t.dislike)}</>} tip={`${name} gets a little grumpy on a day with ${dislikeLabel(content, t.dislike)}.`} />
    </div>
  );
}

function Relations({ s, team }: { s: Staff; team: Staff[] }) {
  const { friends, clashes } = relationsOf(s, team.filter((o) => o.id !== s.id));
  if (!friends.length && !clashes.length) return null;
  const names = (xs: { name: string }[]) => xs.map((x) => first(x.name)).join(" and ");
  return (
    <div className="chips" data-testid="relations">
      {friends.length > 0 && <TipChip tone="friend" icon="heart" label={<>Gets on with {names(friends)}</>} tip="Happier on days they work together. Put them on the same shifts!" />}
      {clashes.length > 0 && <TipChip tone="clash" icon="bolt" label={<>Clashes with {names(clashes)}</>} tip="A bit grumpier on days they work together. Try giving them different days." />}
    </div>
  );
}

/** Why `s` can't go on a course of `t` now (null if they can). */
export function trackBlocker(game: GameState, s: Staff, t: TrackDef, weekday: number): string | null {
  const name = first(s.name);
  if (game.phase !== "planning") return "Training is booked in the morning";
  if (isTrainingToday(game, s)) return `${name} is training today`;
  const fee = nextTrackFee(s, t);
  if (fee === undefined) return `${name} has finished all ${TRACK_MAX_LEVEL} levels`;
  const floor = onFloorToday(game, weekday);
  if (floor.some((x) => x.id === s.id) && floor.filter((x) => x.role === s.role).length === 1) {
    return `${name} is the only ${ROLE_LABEL[s.role].toLowerCase()} on today — you'd have to cover`;
  }
  if (game.cash < fee) return "Not enough cash for the course";
  return null;
}

function LevelDots({ level }: { level: number }) {
  return (
    <span className="dots" aria-hidden="true">
      {Array.from({ length: TRACK_MAX_LEVEL }, (_, i) => <i key={i} className={i < level ? "on" : ""} />)}
    </span>
  );
}

function Training({ s, game, today, send }: { s: Staff; game: GameState; today: number; send: Props["send"] }) {
  const tracks = tracksFor(s.role);
  const { guard, dialog } = useSpendGuard(game);
  if (!tracks.length) return null;
  const training = isTrainingToday(game, s);
  const reasons = tracks.map((t) => trackBlocker(game, s, t, today));
  // One shared reason (training today, only one on) is said once below the buttons.
  const shared = reasons.every((r) => r && r === reasons[0]) ? reasons[0] : null;
  return (
    <div className="training">
      <div className="training__head">
        <Icon name="graduation" size={20} />
        <b>Training</b>
        {training && <span className="tag tag--train">Training today</span>}
      </div>
      <div className="training__tracks">
        {tracks.map((t, i) => {
          const lvl = trackLevel(s, t.id);
          const fee = nextTrackFee(s, t);
          const why = reasons[i];
          return (
            <button
              key={t.id}
              className="track"
              disabled={!!why}
              aria-label={`${t.name}: level ${lvl} of ${TRACK_MAX_LEVEL}${fee !== undefined ? `, next level £${Math.round(fee / 100)}` : ", finished"}${why ? ` (${why})` : ""}`}
              title={why ?? `${t.blurb} A day on the course (still paid).`}
              onClick={() => guard(fee ?? 0, `${t.name} for ${s.name.split(" ")[0]}`, () => send({ type: "TRAIN", staffId: s.id, track: t.id }))}
            >
              <span className="track__name">{t.name}</span>
              <LevelDots level={lvl} />
              <span className="track__fee">{fee === undefined ? "All done" : <MoneyText pence={fee} whole />}</span>
            </button>
          );
        })}
      </div>
      {shared && !training && <span className="xs muted train__why">{shared}</span>}
      {dialog}
    </div>
  );
}

function MoodLine({ s }: { s: Staff }) {
  const why = s.moodWhy;
  return (
    <div className="moodline" data-testid="mood-reason">
      <span className="moodline__face" aria-hidden="true">{moodFace(s.mood)}</span>
      <span>
        <b>{moodWord(s.mood)}</b>
        {why && <span className="muted">: {why.text}</span>}
        {why && Math.abs(why.delta) >= 0.5 && <span className={`moodline__d ${why.delta > 0 ? "up" : "down"}`}>{why.delta > 0 ? "▲" : "▼"}<span className="sr-only">{why.delta > 0 ? " mood up" : " mood down"}</span></span>}
      </span>
    </div>
  );
}

function PersonCard({ s, game, today, send }: { s: Staff; game: GameState; today: number; send: Props["send"] }) {
  const [confirm, setConfirm] = useState(false);
  const shifts = s.rota.filter(Boolean).length;
  return (
    <article className="person person--room" aria-label={s.name}>
      <div className="person__top">
        <Avatar person={s} size={96} mood={s.mood} />
        <div className="spacer stack stack--xs">
          <div className="person__name">{s.name}</div>
          <div className="person__role">{ROLE_LABEL[s.role]} · <MoneyText pence={s.wage} />/h</div>
          <MoodLine s={s} />
        </div>
      </div>
      <TraitChips ids={s.traits} />
      <Tastes person={s} />
      <Relations s={s} team={game.staff} />
      <div className="person__bars">
        <Bar label="Skill" value={s.skill} tone="accent" size="sm" showValue />
        <Bar label="Speed" value={s.speed} tone="sky" size="sm" showValue />
        <Bar label="Charm" value={s.charm} tone="plum" size="sm" showValue />
        <Bar label="Mood" value={s.mood} tone="auto" size="sm" showValue />
        {s.fatigue > 30 && <Bar label="Tired" value={s.fatigue} tone="amber" size="sm" showValue />}
      </div>
      <div>
        <div className="row xs muted" style={{ marginBottom: 4 }}>
          <span className="spacer">Rota · {shifts} shift{shifts === 1 ? "" : "s"}</span>
          <span>~<MoneyText pence={shiftCost(s) * shifts} whole />/week</span>
        </div>
        <div className="rota" role="group" aria-label={`${s.name}'s rota`}>
          {WEEKDAYS.map((d, i) => {
            const doubled = s.rota[i] && game.staff.some((o) => o !== s && o.role === s.role && o.rota[i]);
            return (
              <button
                key={d}
                className={`rota__day ${i === today ? "rota__day--today" : ""} ${doubled ? "rota__day--doubled" : ""}`}
                aria-pressed={!!s.rota[i]}
                title={`${i === today ? `${d} (today)` : d}${doubled ? ` — another ${ROLE_LABEL[s.role].toLowerCase()} is on too` : ""}`}
                onClick={() => send({ type: "SET_ROTA", staffId: s.id, rota: s.rota.map((v, j) => (j === i ? !v : v)) })}
              >
                {d.slice(0, 2)}
              </button>
            );
          })}
        </div>
      </div>
      <Training s={s} game={game} today={today} send={send} />
      <div className="row">
        <span className="xs faint spacer">With you since day {s.hiredDay + 1}</span>
        {confirm ? (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => setConfirm(false)}>Keep</button>
            <button className="btn btn--primary btn--sm" onClick={() => send({ type: "FIRE", staffId: s.id })}>Let {first(s.name)} go</button>
          </>
        ) : (
          <button className="btn btn--ghost btn--sm btn--danger-text" onClick={() => setConfirm(true)}>Let go…</button>
        )}
      </div>
    </article>
  );
}

export function CandidateCard({ c, game, onHire, wanted = false, quote }: { c: Candidate; game: GameState; onHire: () => void; wanted?: boolean; quote?: string }) {
  // sim-core's HIRE rule via sim.ts `hireCheck` (fee in effect + a few shifts' wages); nothing is duplicated here.
  const { fee, perShift, needed, canAfford } = hireCheck(game, c);
  const person = { name: c.name, role: c.role, ...(c.id ? { id: c.id } : {}) };
  return (
    <article className={`candidate candidate--sheet ${wanted ? "candidate--wanted" : ""}`} aria-label={c.name}>
      {wanted && <div className="candidate__wanted"><Icon name="target" size={18} /> The {ROLE_LABEL[c.role].toLowerCase()} your goal asks for</div>}
      <div className="candidate__head">
        <Avatar person={person} size={96} />
        <div className="stack stack--xs">
          <div className="person__name">{c.name}</div>
          <div className="xs muted">{ROLE_LABEL[c.role]} · <i>{c.potentialHint}</i></div>
        </div>
      </div>
      {quote && <blockquote className="candidate__quote">“{quote}”</blockquote>}
      <TraitChips ids={c.traits} />
      <Tastes person={person} />
      <div className="person__bars">
        <Bar label="Skill" value={c.skill} tone="accent" size="sm" showValue />
        <Bar label="Speed" value={c.speed} tone="sky" size="sm" showValue />
        <Bar label="Charm" value={c.charm} tone="plum" size="sm" showValue />
      </div>
      <div className="candidate__foot">
        <div className="xs muted spacer">Asks <b className="ink"><MoneyText pence={c.wage} />/h</b> · about <MoneyText pence={perShift} whole /> a shift</div>
        <button className="btn btn--green btn--sm" onClick={onHire} disabled={!canAfford}>
          Hire · <MoneyText pence={fee} whole />
        </button>
      </div>
      {/* Round 11 (U2): the reason is on the card, not in a tooltip a tablet never shows. */}
      {!canAfford && <p className="candidate__needs small" data-testid="hire-needs">Needs £{Math.ceil(needed / 100).toLocaleString("en-GB")} in the bank (you have <MoneyText pence={game.cash} whole />)</p>}
    </article>
  );
}

function HireSheet({ game, send, wantRole, known, onClose }: Props & { onClose: () => void }) {
  const pool = useMemo(() => candidates(content, game), [game]);
  const fee = recruitmentFeeOf(game);
  // Stable sort: the wanted role first, otherwise the sim's order. HIRE takes the candidate's id.
  const shown = pool
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !c.hired)
    .sort((a, b) => Number(b.c.role === wantRole) - Number(a.c.role === wantRole))
    .slice(0, SHEET_SIZE);
  const friends = (known ?? []).filter((k) => k.bond >= 0 && !game.staff.some((s) => s.id === k.staff.id || s.name === k.staff.name));
  return (
    <section className="card hiresheet" aria-labelledby="hiresheet-h">
      <div className="card__title">
        <h3 id="hiresheet-h" className="panel__title"><Icon name="people" size={22} className="panel__icon" />Who would you like to hire?</h3>
        <span className="card__sub small">New faces every morning. A shift is {SHIFT_HOURS} hours; the agency fee is <MoneyText pence={fee} whole />.</span>
        {game.staff.length > 0 && <span className="panel__action"><button className="btn btn--ghost btn--tap" onClick={onClose}><Icon name="close" size={20} />Close</button></span>}
      </div>
      <StarterLoanTip game={game} send={send} />
      {shown.length === 0 ? <div className="empty small">No one else today. Check again tomorrow.</div> : (
        <div className="hiresheet__row">
          {shown.map(({ c, i }) => (
            <CandidateCard
              key={`${i}-${c.name}`}
              c={c}
              game={game}
              wanted={c.role === wantRole}
              quote={quoteFor(content, c.archetype, { name: c.name, role: c.role, ...(c.id ? { id: c.id } : {}) })}
              onHire={() => send(c.id ? { type: "HIRE", candidateId: c.id } : { type: "HIRE", candidateIndex: i })}
            />
          ))}
        </div>
      )}
      {friends.length > 0 && (
        <>
          <h3 style={{ marginTop: 10 }}>Old colleagues</h3>
          <p className="small muted">People you worked with before you opened. They know you, and they'd come.</p>
          <div className="hiresheet__row">
            {friends.map((k) => (
              <CandidateCard
                key={k.staff.id}
                c={{ ...k.staff, potentialHint: `worked with you at ${k.employer} · bond ${Math.round(k.bond)}` } as Candidate}
                game={game}
                quote={`I loved working with you at ${k.employer}!`}
                onHire={() => send({ type: "HIRE_STAFF", staff: k.staff })}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function StaffTab({ game, send, wantRole, known = [] }: Props) {
  const today = weekdayIndex(game.day);
  const [hiring, setHiring] = useState(game.staff.length === 0 || wantRole !== undefined);
  const open = hiring || game.staff.length === 0;
  const looking = candidates(content, game).filter((c) => !c.hired).length;
  const wageBill = game.staff.reduce((a, s) => a + (s.rota[today] ? shiftCost(s) : 0), 0);

  return (
    <div className="stack staffroom">
      {open ? <HireSheet game={game} send={send} known={known} onClose={() => setHiring(false)} {...(wantRole ? { wantRole } : {})} /> : null}
      {game.staff.length > 0 && <RotaWeek game={game} today={today} />}
      <div className="stack">
        <div className="row row--wrap">
          <h3 className="spacer">Your team</h3>
          <span className="small muted">Today's wages ≈ <b><MoneyText pence={wageBill} /></b></span>
          {!open && (
            <button className="btn btn--green btn--tap" onClick={() => setHiring(true)}>
              <Icon name="user" size={20} />Hire someone{looking ? ` (${Math.min(looking, SHEET_SIZE)} looking for work)` : ""}
            </button>
          )}
        </div>
        {game.staff.length === 0 ? <div className="empty">Nobody works here yet. Hire a chef and a server above.</div> : (
          <div className="roster">{game.staff.map((s) => <PersonCard key={s.id} s={s} game={game} today={today} send={send} />)}</div>
        )}
      </div>
    </div>
  );
}
