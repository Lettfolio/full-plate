import { useEffect } from "react";

interface Props {
  toast: { id: number; text: string } | null;
  onDismiss: () => void;
}

const SHOW_MS = 4500;

/** Bottom-centre message for refused commands ("Not enough cash to hire…"). Announced to screen readers. */
export function Toast({ toast, onDismiss }: Props) {
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(onDismiss, SHOW_MS);
    return () => window.clearTimeout(t);
  }, [toast, onDismiss]);
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className="toast">
          <span aria-hidden="true">⚠️</span>
          <span className="spacer">{toast.text}</span>
          <button className="iconbtn" aria-label="Dismiss" onClick={onDismiss}>✕</button>
        </div>
      )}
    </div>
  );
}
