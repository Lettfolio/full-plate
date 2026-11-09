import { Fragment, useId, useState, type ReactNode } from "react";
import type { Advice, Command, GameState } from "@full-plate/sim-core";
import { actionWords, adviceTextOf, content, eveningAdvice } from "../sim";
import { GLOSSARY, type TermId } from "../lib/glossary";
import { Term } from "./Term";
import type { PlanningTab } from "../screens/Planning";

/**
 * Round 6: the Evening's one tip (sim-core `eveningAdvice`): the rota tip of round 5 plus over-stock, a dud dish, an
 * idle second chef and under-pricing. One line a child can read, the numbers behind it under "Why?", and one button
 * that does it: planning commands (rota, menu, prices) are applied tomorrow morning, before the player sees the tab.
 * The words come from the content pack (`adviceText`): `{name}` placeholders and `[[termId|label]]` glossary words.
 */

/** Fills a content template into React nodes: `{var}` → its value, `[[term|label]]` → <Term inline>. */
export function renderTemplate(template: string, vars: Record<string, string>): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[\[(\w+)\|([^\]]*)\]\]/g;
  let last = 0;
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
  for (let m = re.exec(template); m; m = re.exec(template)) {
    if (m.index > last) out.push(fill(template.slice(last, m.index)));
    const [, id, label] = m;
    out.push(id! in GLOSSARY ? <Term key={m.index} id={id as TermId} inline>{fill(label!)}</Term> : <Fragment key={m.index}>{fill(label!)}</Fragment>);
    last = m.index + m[0].length;
  }
  if (last < template.length) out.push(fill(template.slice(last)));
  return out;
}

interface Props {
  /** Defaults to `eveningAdvice(game, content)`; tests may pass one. */
  advice?: Advice | undefined;
  game: GameState;
  /**
   * One tap: end the evening, apply `commands` tomorrow morning, open `tab`. `done` is the toast. With `now` (the
   * over-stock trim) the commands apply tonight and the evening stays up.
   */
  onAct?: ((commands: Command[], tab: PlanningTab, done: string, now?: boolean) => void) | undefined;
}

export function AdviceCard({ advice, game, onAct }: Props) {
  const a = advice ?? eveningAdvice(game, content);
  const [open, setOpen] = useState(false);
  const whyId = `why-${useId().replace(/:/g, "")}`;
  if (!a) return null;
  const t = adviceTextOf(content, a.kind);
  const plain = (s: string) => s.replace(/\[\[\w+\|([^\]]*)\]\]/g, "$1").replace(/\{(\w+)\}/g, (m, k: string) => a.vars[k] ?? m);
  const action = plain(actionWords(a, t));
  return (
    <section className={`card tip advice advice--${a.kind} ${a.kind === "rota" ? "tip--amber" : ""}`} aria-label="Tonight's tip" data-advice={a.kind}>
      <span className="tip__icon" aria-hidden="true">{t.icon}</span>
      <div className="spacer advice__text">
        <div className="advice__k">Tonight's tip</div>
        <b className="advice__title">{renderTemplate(t.title, a.vars)}</b>
        <div className="advice__body">{renderTemplate(t.body, a.vars)}</div>
        <button type="button" className="advice__why" aria-expanded={open} aria-controls={whyId} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide why" : "Why?"}
        </button>
        <div id={whyId} className="advice__reason" hidden={!open}>{renderTemplate(t.why, a.vars)}</div>
      </div>
      {onAct && (
        <button className="btn btn--sm btn--green advice__act" onClick={() => onAct(a.commands, a.tab, a.commands.length ? `Done: ${action}.` : "", !!a.now)}>
          {action}{a.commands.length ? "" : " →"}
        </button>
      )}
    </section>
  );
}
