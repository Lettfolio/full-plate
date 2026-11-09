import type { Difficulty } from "@full-plate/sim-core";
import { Icon, type IconName } from "./Icon";

/** Round 7: the three difficulties as big toggles a child can read (icon, name, one line). */
/** Round 8: illustrated badges (heart / gauge / chilli) instead of 🧸 🙂 🌶️, in the difficulty's colour. */
export const DIFFICULTY_CHOICES: { id: Difficulty; name: string; icon: IconName; line: string }[] = [
  { id: "cosy", name: "Cosy", icon: "heart", line: "You can't go bust. Learn at your own pace." },
  { id: "normal", name: "Normal", icon: "speed", line: "Run out of money and the bank closes you down." },
  { id: "hard", name: "Hard", icon: "chilli", line: "Fussy guests, thin profits and an impatient bank." },
];

export function DifficultyPicker({ value, onChange, labelId }: { value: Difficulty; onChange: (d: Difficulty) => void; labelId: string }) {
  return (
    <div className="diffpick" role="radiogroup" aria-labelledby={labelId}>
      {DIFFICULTY_CHOICES.map((d) => (
        <button key={d.id} role="radio" aria-checked={value === d.id} className={`diffpick__opt diffpick__opt--${d.id}`} onClick={() => onChange(d.id)}>
          <span className="diffpick__icon" aria-hidden="true"><Icon name={d.icon} size={26} /></span>
          <span className="diffpick__name">{d.name}</span>
          <span className="diffpick__line">{d.line}</span>
        </button>
      ))}
    </div>
  );
}
