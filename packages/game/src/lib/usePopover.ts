import { useEffect, useRef, useState } from "react";

/** Open/close state for a small popover: closes on a click outside `root` or on Escape. */
export function usePopover<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const root = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("mousedown", away); window.removeEventListener("keydown", esc); };
  }, [open]);
  return { open, setOpen, root };
}
