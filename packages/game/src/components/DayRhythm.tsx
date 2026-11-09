/**
 * Round 7 (B): the owner's day as three beats — plan the morning, run the service, read the evening. Shown at the top
 * of each beat so a child always knows where she is in the day and what comes next. Display only.
 */
import { Icon, type IconName } from "./Icon";

export type Beat = "morning" | "service" | "evening";

const BEATS: { id: Beat; icon: IconName; label: string }[] = [
  { id: "morning", icon: "sun", label: "Get ready" },
  { id: "service", icon: "service", label: "Service" },
  { id: "evening", icon: "moon", label: "Evening" },
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
          <span className="dayrhythm__icon" aria-hidden="true"><Icon name={i < at ? "check" : b.icon} size={compact ? 16 : 18} /></span>
          <span className="dayrhythm__label">{i === at && !compact ? `${weekday} · ${b.label}` : b.label}</span>
        </li>
      ))}
    </ol>
  );
}
