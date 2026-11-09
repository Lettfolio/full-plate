import { useEffect } from "react";
import type { ToastMsg } from "../state/gameReducer";
import { playSfx } from "../lib/sfx";

interface Props {
  toast: ToastMsg | null;
  onDismiss: () => void;
}

const SHOW_MS = 4500;
const ICON: Record<ToastMsg["tone"], string> = { bad: "⚠️", good: "🎉", info: "🔔" };

/** Bottom-centre message: refused commands, goals reached, incidents at 4x. Announced to screen readers. */
export function Toast({ toast, onDismiss }: Props) {
  useEffect(() => {
    if (!toast) return;
    if (toast.tone === "good") playSfx("good");
    const t = window.setTimeout(onDismiss, SHOW_MS);
    return () => window.clearTimeout(t);
  }, [toast, onDismiss]);
  return (
    <div className="toast-region" role="status" aria-live="polite">
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
