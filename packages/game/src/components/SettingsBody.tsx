import { useState } from "react";
import { startSpeed, useSettings, type TextSize, type UnderlineTerms } from "../lib/settings";
import { playSfx } from "../lib/sfx";
import { ConfirmDialog, Dialog } from "./Dialog";
import { Icon, type IconName } from "./Icon";
import { VolumeSlider } from "./VolumeSlider";
import type { SavedWhere, SettingsProps } from "./Settings";

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

interface BodyProps extends SettingsProps {
  /** Close the sheet (and anything it opened). */
  onClose: () => void;
  /** The "Save to a file" line, kept by the header button so it survives closing the sheet (as before R12-D). */
  fileNote: string | null;
  setFileNote: (s: string | null) => void;
  /** Round 13 (A): open with this row's control focused (a toast's "Settings" link). */
  focusRow?: "animations" | undefined;
}

/**
 * Round 12 (D, bundle relief): the settings sheet itself — every row, the save / title / new-game actions and the
 * new-game confirmation — split out of `Settings.tsx` into its own lazy chunk. The header button stays in the main
 * chunk and fetches this when it is hovered, focused or the page goes idle. Behaviour is unchanged from round 11.
 *
 * Later rounds: add Settings rows HERE (at the end of the row list, before `.sheet__game`), not in Settings.tsx.
 */
export function SettingsBody({ onQuit, onNewGame, saveName, onSave, onSaveFile, difficulty, onClose, fileNote, setFileNote, focusRow }: BodyProps) {
  const [saving, setSaving] = useState<"saving" | SavedWhere | null>(null);
  const saveAndQuit = async () => {
    if (!onQuit) return;
    if (!onSave) { onClose(); onQuit(); return; }
    setSaving("saving");
    const where = await Promise.race([onSave().catch(() => "none" as const), new Promise<SavedWhere>((r) => setTimeout(() => r("device"), 10_000))]);
    setSaving(where);
    // A not-saved game stays on screen: the player reads the warning and can save a file first.
    if (where === "memory" || where === "none") return;
    await new Promise((r) => setTimeout(r, 900));
    setSaving(null); onClose(); onQuit();
  };
  const [confirm, setConfirm] = useState<"new" | null>(null);
  const [s, set] = useSettings();
  return (
    <>
      {!confirm && (
        <Dialog title="Settings" kicker="Your game" stamp={<Icon name="settings" size={28} />} onClose={() => { setSaving(null); onClose(); }} className="sheet">
          <Choice<TextSize> label="Text size" value={s.textSize} onChange={(v) => set({ textSize: v })} options={[{ id: "normal", label: "Normal" }, { id: "large", label: "Bigger", icon: "textSize" }]} />
          <Choice<"on" | "off"> label="Sound" value={s.sound ? "on" : "off"} onChange={(v) => { set({ sound: v === "on" }); if (v === "on") playSfx("good"); }} options={[{ id: "on", label: "On", icon: "sound" }, { id: "off", label: "Off", icon: "soundOff" }]} />
          <Choice<1 | 2 | 4> label="Service starts at" value={startSpeed(s, difficulty)} onChange={(v) => set({ defaultSpeed: v, speedPicked: true })} options={[{ id: 1, label: "1×" }, { id: 2, label: "2×" }, { id: 4, label: "4×" }]} />
          <label className="sheet__row sheet__check">
            <input type="checkbox" className="switch" checked={s.autoPause} onChange={(e) => set({ autoPause: e.target.checked })} />
            <span>Pause when something goes wrong in service <span className="xs muted">(at 1× and 2×; at 4× you get a note instead)</span></span>
          </label>
          <label className="sheet__row sheet__check">
            <input type="checkbox" className="switch" checked={s.noGrownUpDrinks} onChange={(e) => set({ noGrownUpDrinks: e.target.checked })} />
            <span>Hide alcoholic drinks <span className="xs muted">(soft drinks take their place on the menu, at the same prices)</span></span>
          </label>
          <Choice<UnderlineTerms> label="Underline words I can tap" value={s.underlineTerms} onChange={(v) => set({ underlineTerms: v })} options={[{ id: "first", label: "First time" }, { id: "always", label: "Always" }]} />
          {/* R12-A */}
          <label className="sheet__row sheet__check">
            <input type="checkbox" className="switch" data-settings-row="animations" {...(focusRow === "animations" ? { "data-autofocus": true } : {})} checked={s.animations} onChange={(e) => set({ animations: e.target.checked })} />
            <span>Animations <span className="xs muted">(the floor's little moments, numbers that count up, fades between screens; off makes them instant)</span></span>
          </label>
          {/* R12-A */}
          <VolumeSlider label="Music" value={s.musicVolume} onChange={(v) => set({ musicVolume: v })} {...(s.sound ? {} : { note: "Sound is off" })} />
          {/* R12-A */}
          <VolumeSlider label="Sound effects" value={s.sfxVolume} onChange={(v) => set({ sfxVolume: v })} onDone={() => playSfx("orderUp")} {...(s.sound ? {} : { note: "Sound is off" })} />
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
              <div className="row row--wrap"><button className="btn btn--ghost btn--tap" onClick={() => { setSaving(null); onClose(); onQuit?.(); }}>Quit without saving</button></div>
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
          {/* Round 11 — E (red-team S13): font credit. Keep this the last thing in the sheet. */}
          <p className="small muted sheet__about">
            About: the letters are Fredoka and Nunito, free fonts shared under the SIL Open Font License.{" "}
            <a className="btn btn--ghost btn--tap" href="fonts-licence/OFL.txt" target="_blank" rel="noopener">Font licence</a>
          </p>
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
          onConfirm={() => { setConfirm(null); onClose(); onNewGame(); }}
        />
      )}
    </>
  );
}
