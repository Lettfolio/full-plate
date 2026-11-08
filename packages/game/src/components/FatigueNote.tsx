import { Bar } from "./Bar";

/**
 * Owner tiredness warning (GameState.ownerFatigue ≥ OWNER_FATIGUE_WARNING). It builds when you cover a chef or
 * server yourself and only falls on days the team runs the place; at 100 the owner cooks and serves 40% worse.
 */
export function FatigueNote({ fatigue, onHire }: { fatigue: number; onHire?: () => void }) {
  const f = Math.round(fatigue);
  return (
    <div className="card tip tip--amber" role="note">
      <span className="tip__icon" aria-hidden="true">😮‍💨</span>
      <div className="spacer">
        <b>You're worn out ({f}/100).</b>
        <div className="small">Covering shifts yourself is wearing you down, and a tired owner cooks and serves worse. A day when your team runs the place lets you recover.</div>
        <Bar value={f} tone="accent" size="sm" title={`Your tiredness: ${f} of 100`} />
      </div>
      {onHire && <button className="btn btn--sm" onClick={onHire}>Hire →</button>}
    </div>
  );
}
