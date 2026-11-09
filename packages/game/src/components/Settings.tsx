import { useState } from "react";
import { useSettings, type TextSize } from "../lib/settings";
import { playSfx } from "../lib/sfx";
import { ConfirmDialog, Dialog } from "./Dialog";
import { Icon, type IconName } from "./Icon";

interface Props {
  /** Save and go back to the title screen (absent during service: finish the night first). */
  onQuit?: (() => void) | undefined;
  /** Start a new game (asks first). Absent during service. */
  onNewGame?: (() => void) | undefined;
  /** "Rosie's · Day 21", for the confirmation. */
  saveName?: string;
  /** Round 9: save to the current slot now (device + account); Save & quit waits for it, then quits. */
  onSave?: (() => Promise<SavedWhere>) | undefined;
  /** Round 9: offer the current game as a save file; resolves with a line to show. */
  onSaveFile?: (() => Promise<string>) | undefined;
}

export type SavedWhere = "account" | "device" | "memory" | "none";
const SAVED_SAY: Record<SavedWhere, string> = {
  account: "Saved to your account ✓",
  device: "Saved on this device only — sign in to keep it everywhere",
  memory: "Not saved — use Save to a file to keep this game",
  none: "Not saved — use Save to a file to keep this game",
};

/** A row of big two/three-way toggles (role=radio). */
function Choice<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string; icon?: IconName }[]; onChange: (v: T) => void }) {
  return (
    <div className="sheet__row">
      <span className="sheet__label" id={`set-${label}`}>{label}</span>
      <div className="seg" role="radiogroup" aria-labelledby={`set-${label}`}>
        {options.map((o) => (
          <button key={String(o.id)} role="radio" aria-checked={value === o.id} className="seg__opt" onClick={() => onChange(o.id)}>
            {o.icon && <Icon name={o.icon} size={20} />}{o.label}
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
export function SettingsMenu({ onQuit, onNewGame, saveName, onSave, onSaveFile }: Props) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<"saving" | SavedWhere | null>(null);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const saveAndQuit = async () => {
    if (!onQuit) return;
    if (!onSave) { setOpen(false); onQuit(); return; }
    setSaving("saving");
    const where = await Promise.race([onSave().catch(() => "none" as const), new Promise<SavedWhere>((r) => setTimeout(() => r("device"), 10_000))]);
    setSaving(where);
    // A not-saved game stays on screen: the player reads the warning and can save a file first.
    if (where === "memory" || where === "none") return;
    await new Promise((r) => setTimeout(r, 900));
    setSaving(null); setOpen(false); onQuit();
  };
  const [confirm, setConfirm] = useState<"new" | null>(null);
  const [s, set] = useSettings();
  return (
    <>
      <button className="btn btn--ghost btn--tap shellbtn" aria-label="Settings" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <Icon name="settings" size={22} className="shellbtn__icon" /><span className="shellbtn__text">Settings</span>
      </button>
      {open && !confirm && (
        <Dialog title="Settings" kicker="Your game" stamp={<Icon name="settings" size={28} />} onClose={() => { setSaving(null); setOpen(false); }} className="sheet">
          <Choice<TextSize> label="Text size" value={s.textSize} onChange={(v) => set({ textSize: v })} options={[{ id: "normal", label: "Normal" }, { id: "large", label: "Bigger", icon: "textSize" }]} />
          <Choice<"on" | "off"> label="Sound" value={s.sound ? "on" : "off"} onChange={(v) => { set({ sound: v === "on" }); if (v === "on") playSfx("good"); }} options={[{ id: "on", label: "On", icon: "sound" }, { id: "off", label: "Off", icon: "soundOff" }]} />
          <Choice<1 | 2 | 4> label="Service starts at" value={s.defaultSpeed} onChange={(v) => set({ defaultSpeed: v })} options={[{ id: 1, label: "1×" }, { id: 2, label: "2×" }, { id: 4, label: "4×" }]} />
          <label className="sheet__row sheet__check">
            <input type="checkbox" className="switch" checked={s.autoPause} onChange={(e) => set({ autoPause: e.target.checked })} />
            <span>Pause when something goes wrong in service <span className="xs muted">(at 1× and 2×; at 4× you get a note instead)</span></span>
          </label>
          <div className="sheet__game">
            <p className="small muted">Your game saves itself every morning and every evening.</p>
            {onQuit || onNewGame ? (
              <div className="row row--wrap">
                {onQuit && (
                  <button className="btn btn--tap" onClick={() => void saveAndQuit()} disabled={saving === "saving"} aria-describedby={saving ? "saveq-state" : undefined}>
                    <Icon name="save" size={20} />{saving === "saving" ? "Saving…" : "Save & quit"}
                  </button>
                )}
                {onNewGame && <button className="btn btn--ghost btn--tap" onClick={() => setConfirm("new")}>Start a new game…</button>}
              </div>
            ) : null}
            {saving && saving !== "saving" && (
              <p id="saveq-state" role="status" className={`small savequit savequit--${saving}`}>
                <Icon name={saving === "account" ? "cloud" : saving === "device" ? "cloudOff" : "warning"} size={20} />{SAVED_SAY[saving]}
              </p>
            )}
            {saving === "memory" || saving === "none" ? (
              <div className="row row--wrap"><button className="btn btn--ghost btn--tap" onClick={() => { setSaving(null); setOpen(false); onQuit?.(); }}>Quit without saving</button></div>
            ) : null}
            {onSaveFile && (
              <div className="row row--wrap">
                <button className="btn btn--tap" onClick={() => { setFileNote("Getting the file ready…"); void onSaveFile().then(setFileNote); }}><Icon name="download" size={20} />Save to a file</button>
                {fileNote && <span className="small" role="status">{fileNote}</span>}
              </div>
            )}
            {onQuit || onNewGame ? null : (
              <p className="small">Finish tonight's service first, then you can leave or start again from here.</p>
            )}
          </div>
        </Dialog>
      )}
      {confirm === "new" && onNewGame && (
        <ConfirmDialog
          title="Start a new game?"
          body={<p>{onSave && saveName ? <><b>{saveName}</b> stays saved in Your games. Next, pick where your new game goes.</> : saveName ? <><b>{saveName}</b> stays saved until your new game begins. Then the new game takes its place.</> : "Your new game will take this one's place."}</p>}
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
