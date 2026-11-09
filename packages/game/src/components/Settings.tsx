import { useState } from "react";
import { useSettings, type TextSize } from "../lib/settings";
import { playSfx } from "../lib/sfx";
import { ConfirmDialog, Dialog } from "./Dialog";

interface Props {
  /** Save and go back to the title screen (absent during service: finish the night first). */
  onQuit?: (() => void) | undefined;
  /** Start a new game (asks first). Absent during service. */
  onNewGame?: (() => void) | undefined;
  /** "Rosie's · Day 21", for the confirmation. */
  saveName?: string;
}

/** A row of big two/three-way toggles (role=radio). */
function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string; icon?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="sheet__row">
      <span className="sheet__label" id={`set-${label}`}>{label}</span>
      <div className="seg" role="radiogroup" aria-labelledby={`set-${label}`}>
        {options.map((o) => (
          <button key={String(o.id)} role="radio" aria-checked={value === o.id} className="seg__opt" onClick={() => onChange(o.id)}>
            {o.icon && <span aria-hidden="true">{o.icon}</span>} {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The gear in the header. Round 7: a settings sheet (text size, sound, service speed and pause) with the game's
 * save / title / new-game actions in one place. Preferences live in localStorage, not in the game save.
 */
export function SettingsMenu({ onQuit, onNewGame, saveName }: Props) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<"new" | null>(null);
  const [s, set] = useSettings();
  return (
    <>
      <button className="btn btn--ghost btn--tap shellbtn" aria-label="Settings" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <span aria-hidden="true" className="shellbtn__icon">⚙</span><span className="shellbtn__text">Settings</span>
      </button>
      {open && !confirm && (
        <Dialog title="Settings" kicker="Your game" stamp="⚙️" onClose={() => setOpen(false)} className="sheet">
          <Choice<TextSize> label="Text size" value={s.textSize} onChange={(v) => set({ textSize: v })} options={[{ id: "normal", label: "Normal" }, { id: "large", label: "Bigger", icon: "🔍" }]} />
          <Choice<"on" | "off"> label="Sound" value={s.sound ? "on" : "off"} onChange={(v) => { set({ sound: v === "on" }); if (v === "on") playSfx("good"); }} options={[{ id: "on", label: "On", icon: "🔔" }, { id: "off", label: "Off", icon: "🔕" }]} />
          <Choice<1 | 2 | 4> label="Service starts at" value={s.defaultSpeed} onChange={(v) => set({ defaultSpeed: v })} options={[{ id: 1, label: "1×" }, { id: 2, label: "2×" }, { id: 4, label: "4×" }]} />
          <label className="sheet__row sheet__check">
            <input type="checkbox" checked={s.autoPause} onChange={(e) => set({ autoPause: e.target.checked })} />
            <span>Pause when something goes wrong in service <span className="xs muted">(at 1× and 2×; at 4× you get a note instead)</span></span>
          </label>
          <div className="sheet__game">
            <p className="small muted">Your game saves itself every morning and every evening.</p>
            {onQuit || onNewGame ? (
              <div className="row row--wrap">
                {onQuit && <button className="btn btn--tap" onClick={() => { setOpen(false); onQuit(); }}>Save and go to the title screen</button>}
                {onNewGame && <button className="btn btn--ghost btn--tap" onClick={() => setConfirm("new")}>Start a new game…</button>}
              </div>
            ) : (
              <p className="small">Finish tonight's service first, then you can leave or start again from here.</p>
            )}
          </div>
        </Dialog>
      )}
      {confirm === "new" && onNewGame && (
        <ConfirmDialog
          title="Start a new game?"
          body={<p>{saveName ? <><b>{saveName}</b> stays saved until your new game begins. Then the new game takes its place.</> : "Your new game will take this one's place."}</p>}
          confirmLabel="Yes, start a new game"
          cancelLabel="Keep playing"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => { setConfirm(null); setOpen(false); onNewGame(); }}
        />
      )}
    </>
  );
}
