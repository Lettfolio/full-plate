import { useEffect, useLayoutEffect, useRef } from "react";
import type { ToastMsg } from "../state/gameReducer";
import { playSfx } from "../lib/sfx";
import { Icon, type IconName } from "./Icon";
import { TermText } from "./TermText";
import { openSettingsAt } from "./Settings";
import { PHONE_ANY_QUERY } from "../lib/layout";

interface Props {
  toast: ToastMsg | null;
  onDismiss: () => void;
}

const SHOW_MS = 4500;
/** Round 13 (A): a toast with a link stays long enough to read and reach. */
const LINK_SHOW_MS = 9000;
const ICON: Record<ToastMsg["tone"], IconName> = { bad: "warning", good: "check", info: "info" };

/**
 * Where the toast sits. Bottom-centre by default; during service it moves to the top of the restaurant floor, just
 * under the PAUSED badge, so it never covers the queue on the pavement or the speed controls (R7 review seam a).
 * Layout only.
 */
export function toastPlacement(stage: DOMRect | null): { top: number; left: number } | null {
  if (!stage || !stage.width) return null;
  return { top: Math.round(stage.top + 48), left: Math.round(stage.left + stage.width / 2) };
}

/** Bottom-centre message: refused commands, goals reached, incidents at 4x. Announced to screen readers. */
export function Toast({ toast, onDismiss }: Props) {
  const region = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = region.current;
    if (!el) return;
    // Round 14 (E, U11): on a phone (either way up) a service toast sits along the top edge (phone.css), clear of the
    // floor in the middle, the sheet's peek and the primary button.
    const stage = document.querySelector(".service__stage");
    const phone = typeof window.matchMedia === "function" && window.matchMedia(PHONE_ANY_QUERY).matches;
    el.classList.toggle("toast-region--top", !!toast && phone && !!stage);
    const at = toast && !phone ? toastPlacement(stage?.getBoundingClientRect() ?? null) : null;
    el.style.top = at ? `${at.top}px` : "";
    el.style.left = at ? `${at.left}px` : "";
    el.style.bottom = at ? "auto" : "";
    el.classList.toggle("toast-region--stage", !!at);
  }, [toast]);
  useEffect(() => {
    if (!toast) return;
    if (toast.tone === "good") playSfx("good");
    const t = window.setTimeout(onDismiss, toast.link ? LINK_SHOW_MS : SHOW_MS);
    return () => window.clearTimeout(t);
  }, [toast, onDismiss]);
  return (
    <div ref={region} className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          <span className="toast__icon" aria-hidden="true">{toast.tone === "good" && toast.text.startsWith("🎉") ? <Icon name="trophy" size={22} /> : <Icon name={ICON[toast.tone]} size={22} />}</span>
          {/* Goal toasts carry their own 🎉 in the text: it moves into the round badge. */}
          <span className="spacer toast__text"><TermText text={toast.tone === "good" && toast.text.startsWith("🎉") ? toast.text.replace(/^🎉\s*/, "") : toast.text} /></span>
          {/* Round 13 (A): a toast can carry one link — "animations" opens Settings at the Animations switch */}
          {toast.link === "animations" && <button className="btn btn--ghost btn--tap toast__link" onClick={() => { openSettingsAt("animations"); onDismiss(); }}>Settings</button>}
          <button className="iconbtn iconbtn--tap" aria-label="Dismiss" onClick={onDismiss}><Icon name="close" size={20} /></button>
        </div>
      )}
    </div>
  );
}
