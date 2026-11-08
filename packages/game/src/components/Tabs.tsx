import { useRef, type KeyboardEvent } from "react";

export interface TabDef<T extends string> {
  id: T;
  label: string;
  /** Small count or warning shown after the label. */
  badge?: string | number;
  badgeTone?: "warn" | "info";
}

interface Props<T extends string> {
  tabs: TabDef<T>[];
  active: T;
  onChange: (id: T) => void;
  label: string;
}

export function Tabs<T extends string>({ tabs, active, onChange, label }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + tabs.length) % tabs.length;
    onChange(tabs[j]!.id);
    refs.current[j]?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => { refs.current[i] = el; }}
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={t.id === active}
          aria-controls={`panel-${t.id}`}
          tabIndex={t.id === active ? 0 : -1}
          className={`tab ${t.id === active ? "tab--active" : ""}`}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
          {t.badge !== undefined && t.badge !== "" && <span className={`tab__badge tab__badge--${t.badgeTone ?? "info"}`}>{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}
