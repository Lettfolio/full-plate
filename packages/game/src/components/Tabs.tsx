import { useRef, type KeyboardEvent } from "react";
import { Icon, isIconName, type IconName } from "./Icon";

export interface TabDef<T extends string> {
  id: T;
  label: string;
  /** Small count or warning shown after the label. */
  badge?: string | number;
  badgeTone?: "warn" | "info";
  /** Round 8: an Icon name (or, for older callers, an emoji) shown before the label, aria-hidden. Defaults from
   *  TAB_ICONS by id, then a leading emoji in the label. */
  icon?: IconName | string;
}

/** Every tab has a picture as well as a word (a child scans pictures first). Round 8: drawn icons, not emoji. */
export const TAB_ICONS: Record<string, IconName> = {
  menu: "menu", staff: "chefHat", stock: "stock", restaurant: "restaurant", empire: "empire", stars: "stars",
  shops: "shop", brand: "trophy", money: "money", decorate: "paint",
};

/** "🍔 Empire" → ["🍔", "Empire"]; plain labels pass through. */
export function splitIcon(label: string): [string | undefined, string] {
  const m = /^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s+(.*)$/u.exec(label);
  return m ? [m[1], m[2]!] : [undefined, label];
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
          {(() => {
            const [lead, text] = splitIcon(t.label);
            const icon = t.icon ?? TAB_ICONS[t.id] ?? lead;
            return <>{icon && <span className="tab__icon" aria-hidden="true">{isIconName(icon) ? <Icon name={icon} size={22} /> : icon}</span>}<span className="tab__label">{text}</span></>;
          })()}
          {t.badge !== undefined && t.badge !== "" && <span className={`tab__badge tab__badge--${t.badgeTone ?? "info"}`}>{t.badge}</span>}
        </button>
      ))}
    </div>
  );
}
