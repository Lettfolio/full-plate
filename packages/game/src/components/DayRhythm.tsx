/**
 * Round 7 (B): the owner's day as three beats — plan the morning, run the service, read the evening. Shown at the top
 * of each beat so a child always knows where she is in the day and what comes next. Display only.
 */
export type Beat = "morning" | "service" | "evening";

const BEATS: { id: Beat; icon: string; label: string }[] = [
  { id: "morning", icon: "☀️", label: "Get ready" },
  { id: "service", icon: "🍽️", label: "Service" },
  { id: "evening", icon: "🌙", label: "Evening" },
];

interface Props {
  beat: Beat;
  /** "Thursday" etc. */
  weekday: string;
  compact?: boolean;
}

export function DayRhythm({ beat, weekday, compact = false }: Props) {
  const at = BEATS.findIndex((b) => b.id === beat);
  return (
    <ol className={`dayrhythm ${compact ? "dayrhythm--compact" : ""}`} aria-label={`${weekday}: ${BEATS[at]!.label}, step ${at + 1} of 3`}>
      {BEATS.map((b, i) => (
        <li key={b.id} className={`dayrhythm__beat dayrhythm__beat--${b.id} ${i === at ? "is-now" : i < at ? "is-done" : ""}`} aria-current={i === at ? "step" : undefined}>
          <span className="dayrhythm__icon" aria-hidden="true">{i < at ? "✓" : b.icon}</span>
          <span className="dayrhythm__label">{i === at && !compact ? `${weekday} · ${b.label}` : b.label}</span>
        </li>
      ))}
    </ol>
  );
}
