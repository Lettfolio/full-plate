import { useEffect } from "react";
import type { ToastMsg } from "../state/gameReducer";

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
    const t = window.setTimeout(onDismiss, SHOW_MS);
    return () => window.clearTimeout(t);
  }, [toast, onDismiss]);
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className={`toast toast--${toast.tone}`}>
          {/* Goal toasts carry their own 🎉 in the text. */}
          {!(toast.tone === "good" && toast.text.startsWith("🎉")) && <span aria-hidden="true">{ICON[toast.tone]}</span>}
          <span className="spacer">{toast.text}</span>
          <button className="iconbtn" aria-label="Dismiss" onClick={onDismiss}>✕</button>
        </div>
      )}
    </div>
  );
}
