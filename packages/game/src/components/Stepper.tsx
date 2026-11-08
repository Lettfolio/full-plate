interface Props {
  value: number;
  onChange: (v: number) => void;
  step: number;
  /** Larger step with Shift held. */
  bigStep?: number;
  min?: number;
  max?: number;
  label: string;
  /** Rendered between the buttons; defaults to the number. */
  children?: React.ReactNode;
}

export function Stepper({ value, onChange, step, bigStep, min = 0, max = Number.MAX_SAFE_INTEGER, label, children }: Props) {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  const by = (e: React.MouseEvent, dir: 1 | -1) => set(value + dir * (e.shiftKey && bigStep ? bigStep : step));
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" className="stepper__btn" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={(e) => by(e, -1)} title={bigStep ? "Shift-click for bigger steps" : undefined}>−</button>
      <span className="stepper__value">{children ?? value}</span>
      <button type="button" className="stepper__btn" aria-label={`Increase ${label}`} disabled={value >= max} onClick={(e) => by(e, 1)} title={bigStep ? "Shift-click for bigger steps" : undefined}>+</button>
    </span>
  );
}
