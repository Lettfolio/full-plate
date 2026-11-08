interface Props {
  /** Value on a 0..max scale (default max 100). */
  value: number;
  max?: number;
  label?: string;
  /** Show the number at the right. */
  showValue?: boolean;
  tone?: "accent" | "basil" | "amber" | "plum" | "sky" | "ink" | "auto";
  size?: "sm" | "md";
  title?: string;
}

/** A small horizontal meter. tone="auto" goes red → amber → green with the value. */
export function Bar({ value, max = 100, label, showValue = false, tone = "basil", size = "md", title }: Props) {
  const f = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const t = tone === "auto" ? (f < 0.34 ? "accent" : f < 0.67 ? "amber" : "basil") : tone;
  return (
    <div className={`bar bar--${size}`} title={title}>
      {label && <span className="bar__label">{label}</span>}
      <span className="bar__track" role="meter" aria-label={label ?? title} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.round(value)}>
        <span className={`bar__fill bar__fill--${t}`} style={{ width: `${f * 100}%` }} />
      </span>
      {showValue && <span className="bar__value">{Math.round(value)}</span>}
    </div>
  );
}
