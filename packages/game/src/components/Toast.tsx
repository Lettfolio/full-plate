import { useEffect, useLayoutEffect, useRef } from "react";
import type { ToastMsg } from "../state/gameReducer";
import { playSfx } from "../lib/sfx";

interface Props {
  toast: ToastMsg | null;
  onDismiss: () => void;
}

const SHOW_MS = 4500;
const ICON: Record<ToastMsg["tone"], string> = { bad: "⚠️", good: "🎉", info: "🔔" };

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
    const at = toast ? toastPlacement(document.querySelector(".service__stage")?.getBoundingClientRect() ?? null) : null;
    el.style.top = at ? `${at.top}px` : "";
    el.style.left = at ? `${at.left}px` : "";
    el.style.bottom = at ? "auto" : "";
    el.classList.toggle("toast-region--stage", !!at);
  }, [toast]);
  useEffect(() => {
    if (!toast) return;
    if (toast.tone === "good") playSfx("good");
    const t = window.setTimeout(onDismiss, SHOW_MS);
    return () => window.clearTimeout(t);
  }, [toast, onDismiss]);
  return (
    <div ref={region} className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          <span className="toast__icon" aria-hidden="true">{toast.tone === "good" && toast.text.startsWith("🎉") ? "🎉" : ICON[toast.tone]}</span>
          {/* Goal toasts carry their own 🎉 in the text: it moves into the round badge. */}
          <span className="spacer">{toast.tone === "good" && toast.text.startsWith("🎉") ? toast.text.replace(/^🎉\s*/, "") : toast.text}</span>
          <button className="iconbtn iconbtn--tap" aria-label="Dismiss" onClick={onDismiss}>✕</button>
        </div>
      )}
    </div>
  );
}
