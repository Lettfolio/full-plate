import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

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
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      // R8 review: Tab stays inside an open dialog (it walked out onto the page behind, e.g. the Empire map's pins).
      if (e.key === "Tab" && box.current) {
        const items = [...box.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
          .filter((el) => !el.closest("[hidden], [inert]"));
        if (!items.length) return;
        const first = items[0]!, last = items[items.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        const inside = !!active && box.current.contains(active);
        if (e.shiftKey && (active === first || !inside)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (active === last || !inside)) { e.preventDefault(); first.focus(); }
      }
    };
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
          <button className="iconbtn iconbtn--tap" aria-label="Close" onClick={onClose}><Icon name="close" size={22} /></button>
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
    <Dialog title={title} stamp={<Icon name={danger ? "warning" : "help"} size={28} />} onClose={onCancel} role="alertdialog" className="confirm">
      <div className="confirm__body">{body}</div>
      <div className="confirm__buttons">
        <button className="btn btn--tap" data-autofocus onClick={onCancel}>{cancelLabel}</button>
        <button className={`btn btn--tap ${danger ? "btn--primary" : "btn--green"}`} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Dialog>
  );
}
