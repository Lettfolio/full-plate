import { useId } from "react";

/**
 * Round 12 (A): a Settings row with a 0–100 % volume slider. A native range input: arrow keys, Page Up/Down, Home/End
 * and touch drags all work; the whole row and the thumb are 44 px tall (theme.css "Round 12 — A"). `onDone` fires when
 * a drag or a key press ends (Sound effects plays a sample there).
 */
export function VolumeSlider({ label, value, onChange, onDone, note }: { label: string; value: number; onChange: (v: number) => void; onDone?: () => void; note?: string }) {
  const id = useId();
  const pct = Math.round(value * 100);
  return (
    <div className="sheet__row volume">
      <label className="sheet__label" htmlFor={id}>{label}</label>
      <input
        id={id} type="range" className="volume__range" min={0} max={100} step={5} value={pct}
        aria-valuetext={pct === 0 ? "Off" : `${pct}%`}
        style={{ "--fill": `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        onPointerUp={onDone} onKeyUp={onDone}
      />
      <span className="volume__value" aria-hidden="true">{pct === 0 ? "Off" : `${pct}%`}</span>
      {note && <span className="xs muted volume__note">{note}</span>}
    </div>
  );
}
