import { useEffect, useId, useRef, type ReactNode } from "react";

interface DialogProps {
  /** Heading text; also the dialog's accessible name. */
  title: ReactNode;
  /** Small line above the title (the banner's kicker). */
  kicker?: ReactNode;
  /** Emoji or a small SVG in the round stamp. */
  stamp?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** "alertdialog" for confirmations. */
  role?: "dialog" | "alertdialog";
  className?: string;
}

/**
 * Round 7 (shell): one modal for the settings sheet, the goal explainer and confirmations. Escape and the backdrop
 * close it; focus moves to the first control inside and goes back to whatever opened it.
 */
export function Dialog({ title, kicker, stamp, onClose, children, wide, role = "dialog", className }: DialogProps) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>("[data-autofocus]") ?? box.current?.querySelector<HTMLElement>(".modal__body button, .modal__body input") ?? box.current?.querySelector<HTMLElement>("button");
    first?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", esc, true);
    return () => { window.removeEventListener("keydown", esc, true); before?.focus?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className={`modal ${wide ? "modal--wide" : ""} ${className ?? ""}`.trim()} role={role} aria-modal="true" aria-labelledby={`${id}-t`}>
        <div className="modal__banner">
          {stamp && <span className="modal__stamp" aria-hidden="true">{stamp}</span>}
          <div className="spacer">
            {kicker && <div className="modal__kicker">{kicker}</div>}
            <h2 id={`${id}-t`}>{title}</h2>
          </div>
          <button className="iconbtn iconbtn--tap" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

interface ConfirmProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Red confirm button for things that can't be undone. */
  danger?: boolean;
}

/** "Are you sure?" with the safe choice focused first. */
export function ConfirmDialog({ title, body, confirmLabel, cancelLabel = "Go back", onConfirm, onCancel, danger }: ConfirmProps) {
  return (
    <Dialog title={title} stamp={danger ? "⚠️" : "🤔"} onClose={onCancel} role="alertdialog" className="confirm">
      <div className="confirm__body">{body}</div>
      <div className="confirm__buttons">
        <button className="btn btn--tap" data-autofocus onClick={onCancel}>{cancelLabel}</button>
        <button className={`btn btn--tap ${danger ? "btn--primary" : "btn--green"}`} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Dialog>
  );
}
