import { useEffect, useRef } from "react";
import { Icon } from "../../components/Icon";
import type { HandoverSummary } from "@full-plate/sim-career";
import { MoneyText } from "../../components/MoneyText";
import { HOOKS } from "../../sim";

/** After "Open my own place": what carried over (CAREER-NOTES "The handover flow"). */
export function HandoverModal({ summary, onClose }: { summary: HandoverSummary; onClose: () => void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { btn.current?.focus(); }, []);
  const perks = summary.perks.filter((p) => p.via !== "needs_hook" || HOOKS.ownerProfile);
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-labelledby="ho-title">
      <div className="modal">
        <div className="modal__banner">
          <span className="modal__stamp" aria-hidden="true"><Icon name="key" size={28} /></span>
          <div>
            <div className="modal__kicker">From {summary.rungTitle.toLowerCase()} to owner</div>
            <h2 id="ho-title">Welcome to {summary.restaurantName}</h2>
          </div>
        </div>
        <div className="modal__body">
          <p>You put in <b><MoneyText pence={summary.savingsIn} whole /></b> of savings and the bank lent <b><MoneyText pence={summary.loan} whole /></b>. After the fit-out and deposit you have <b><MoneyText pence={summary.cashAtOpening} whole /></b> in the till.</p>
          <ul className="perks">
            {perks.map((p) => (
              <li key={p.id}><b>{p.id === "owner_skills" ? "Your own skills" : p.label}.</b> <span className="small">{p.id === "owner_skills" ? "When you cover a shift yourself, you cook and serve with the skills you earned." : p.detail}</span></li>
            ))}
          </ul>
          <button ref={btn} className="btn btn--primary btn--xl" onClick={onClose}>Let's open →</button>
        </div>
      </div>
    </div>
  );
}
