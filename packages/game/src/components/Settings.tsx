import { usePopover } from "../lib/usePopover";
import { useSettings } from "../lib/settings";

/** Gear button with the two player preferences (saved in localStorage, not in the game save). */
export function SettingsMenu() {
  const { open, setOpen, root } = usePopover();
  const [s, set] = useSettings();
  return (
    <div className="popwrap" ref={root}>
      <button className="iconbtn" aria-label="Settings" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)} title="Settings">⚙</button>
      {open && (
        <div className="popover popover--right" role="dialog" aria-label="Settings">
          <h4>Settings</h4>
          <label className="check">
            <input type="checkbox" checked={s.autoPause} onChange={(e) => set({ autoPause: e.target.checked })} />
            <span>Pause when something goes wrong in service <span className="xs muted">(at 1× and 2×; at 4× you get a note instead)</span></span>
          </label>
          <div className="check" role="radiogroup" aria-label="Service starts at">
            <span className="spacer">Service starts at</span>
            {([1, 2, 4] as const).map((v) => (
              <button key={v} role="radio" aria-checked={s.defaultSpeed === v} className="speed speed--mini" onClick={() => set({ defaultSpeed: v })}>{v}×</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
