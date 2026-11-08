import { useEffect, useRef, useState } from "react";
import type { Command, Incident } from "@full-plate/sim-core";
import { MoneyText } from "./MoneyText";
import { countdownFraction, INCIDENT_ICON } from "../lib/incidents";
import { MINUTES_PER_TICK } from "../sim";

interface Props {
  incident: Incident;
  /** Resolved a moment ago: show the outcome and fade out. */
  leaving?: boolean;
  tick: number;
  cash: number;
  send: (cmd: Command) => void;
  /** Mouse-over / focus on the card highlights its subject on the canvas. */
  onFocusSubject?: (incidentId: string | null) => void;
}

/** One live incident: what happened, how long you have, and 2-3 things you can do about it. */
export function IncidentCard({ incident: inc, leaving = false, tick, cash, send, onFocusSubject }: Props) {
  const f = countdownFraction(inc, tick);
  const urgent = f < 0.34;
  if (leaving) {
    return (
      <section className={`incident incident--leaving ${inc.resolution === "ignored" ? "incident--bad" : "incident--good"}`} aria-label={`${inc.title}: resolved`}>
        <div className="incident__head">
          <span className="incident__icon" aria-hidden="true">{inc.resolution === "ignored" ? "⌛" : "✔️"}</span>
          <div className="spacer">
            <h4>{inc.title}</h4>
            <p className="small">{inc.outcome || (inc.resolution === "ignored" ? "Nobody dealt with it." : "Sorted.")}</p>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section
      className={`incident ${urgent ? "incident--urgent" : ""}`}
      aria-labelledby={`inc-${inc.id}`}
      onMouseEnter={() => onFocusSubject?.(inc.id)}
      onMouseLeave={() => onFocusSubject?.(null)}
    >
      <div className="incident__head">
        <span className="incident__icon" aria-hidden="true">{INCIDENT_ICON[inc.kind] ?? "❗"}</span>
        <div className="spacer">
          <h4 id={`inc-${inc.id}`}>{inc.title}</h4>
          <p className="small">{inc.body}</p>
        </div>
      </div>
      <div className="incident__timer" role="meter" aria-label="Time to decide" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)}>
        <span style={{ width: `${f * 100}%` }} />
      </div>
      <div className="xs muted">{inc.ticksLeft * MINUTES_PER_TICK} min to decide, or it sorts itself out (badly).</div>
      <div className="incident__options">
        {inc.options.map((o) => {
          const short = (o.cost ?? 0) > 0 && cash < (o.cost ?? 0);
          return (
            <button
              key={o.id}
              className="incident__opt"
              onClick={() => send({ type: "RESPOND_INCIDENT", incidentId: inc.id, optionId: o.id })}
              onFocus={() => onFocusSubject?.(inc.id)}
              onBlur={() => onFocusSubject?.(null)}
              title={short ? "You're low on cash, but the sim may still let you" : undefined}
            >
              <span className="incident__optlabel">{o.label}</span>
              {o.cost ? <span className="incident__cost"><MoneyText pence={-o.cost} whole={o.cost >= 10000} /></span> : <span className="incident__cost incident__cost--free">free</span>}
              <span className="incident__optdesc">{o.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Keeps a just-resolved incident on screen for `ms` so its card can show the outcome and fade out
 * instead of vanishing. Returns live incidents plus recently resolved ones (marked `leaving`).
 * Incidents that were already resolved when the screen mounted (e.g. after a reload) never show.
 */
export function useFadingIncidents(all: readonly Incident[] | undefined, ms = 1600): { inc: Incident; leaving: boolean }[] {
  const seenLive = useRef(new Set<string>());
  const resolvedAt = useRef(new Map<string, number>());
  const [, bump] = useState(0);
  const now = Date.now();
  // Set-once bookkeeping; idempotent, so StrictMode's double render is harmless.
  for (const i of all ?? []) {
    if (!i.resolution) seenLive.current.add(i.id);
    else if (seenLive.current.has(i.id) && !resolvedAt.current.has(i.id)) resolvedAt.current.set(i.id, now);
  }
  const out = (all ?? []).flatMap((inc) => {
    if (!inc.resolution) return [{ inc, leaving: false }];
    const at = resolvedAt.current.get(inc.id);
    return at !== undefined && now - at < ms ? [{ inc, leaving: true }] : [];
  });
  const fading = out.filter((x) => x.leaving).length;
  useEffect(() => {
    if (!fading) return;
    const t = window.setTimeout(() => bump((n) => n + 1), ms);
    return () => window.clearTimeout(t);
  }, [fading, ms]);
  return out;
}
