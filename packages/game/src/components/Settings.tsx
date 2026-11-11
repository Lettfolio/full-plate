import { lazy, Suspense, useEffect, useState } from "react";
import { Icon } from "./Icon";

export interface SettingsProps {
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
  /** Round 11 (D): the game's difficulty, for the speed a service starts at (Cosy: 4× until one is picked). */
  difficulty?: string | undefined;
  /** Round 14 (D): save this game and open today's challenge; the app brings her back to this game after. */
  onChallenge?: (() => void) | undefined;
}

export type SavedWhere = "account" | "device" | "memory" | "none";

/**
 * Round 13 (A): open the Settings sheet from elsewhere (a toast's link) with keyboard focus on one row. The header's
 * SettingsMenu listens for the event; where none is mounted (a phone's header folds it into a sheet) the Settings
 * button is clicked instead, and the row is focused once the sheet is up.
 */
export const OPEN_SETTINGS_EVENT = "fp:open-settings";
export type SettingsRow = "animations";
export function openSettingsAt(row: SettingsRow): void {
  const e = new CustomEvent<{ row: SettingsRow; handled: boolean }>(OPEN_SETTINGS_EVENT, { detail: { row, handled: false } });
  window.dispatchEvent(e);
  if (e.detail.handled) return; // the gear opens the sheet with that row's switch focused (data-autofocus)
  document.querySelector<HTMLButtonElement>('button[aria-label="Settings"]')?.click();
  focusRow(row);
}
function focusRow(row: SettingsRow, tries = 20): void {
  // after the sheet has focused its own first control
  window.setTimeout(() => {
    const el = document.querySelector<HTMLElement>(`[data-settings-row="${row}"]`);
    if (el) { el.focus(); el.scrollIntoView?.({ block: "nearest" }); }
    else if (tries > 0) focusRow(row, tries - 1);
  }, 60);
}

/** Round 12 (D): the sheet's body is its own chunk (components/SettingsBody.tsx); fetched early so a tap never waits. */
let Loaded: typeof import("./SettingsBody").SettingsBody | null = null;
export const loadSettingsBody = () => import("./SettingsBody").then((m) => { Loaded = m.SettingsBody; return m; });
const LazyBody = lazy(() => loadSettingsBody().then((m) => ({ default: m.SettingsBody })));
const warm = () => { void loadSettingsBody().catch(() => {}); };

/**
 * The gear in the header. Round 7: a settings sheet (text size, sound, service speed and pause) with the game's
 * save / title / new-game actions in one place. Preferences live in localStorage, not in the game save.
 * Round 12 (D): the rows live in SettingsBody.tsx — add new rows there.
 */
export function SettingsMenu(props: SettingsProps) {
  const [open, setOpen] = useState(false);
  const [focusRow, setFocusRow] = useState<SettingsRow | undefined>(undefined);
  const [fileNote, setFileNote] = useState<string | null>(null);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    if (w.requestIdleCallback) w.requestIdleCallback(warm, { timeout: 4000 }); else setTimeout(warm, 2000);
  }, []);
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ row: SettingsRow; handled: boolean }>).detail; if (d.handled) return; d.handled = true; setFocusRow(d.row); setOpen(true); };
    window.addEventListener(OPEN_SETTINGS_EVENT, on);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, on);
  }, []);
  return (
    <>
      <button className="btn btn--ghost btn--tap shellbtn" aria-label="Settings" aria-haspopup="dialog" aria-expanded={open} onPointerEnter={warm} onFocus={warm} onClick={() => setOpen(true)}>
        <Icon name="settings" size={22} className="shellbtn__icon" /><span className="shellbtn__text">Settings</span>
      </button>
      {open && (Loaded
        // Once fetched it renders at once, with no Suspense round trip (the tests rely on this too).
        ? <Loaded {...props} onClose={() => { setOpen(false); setFocusRow(undefined); }} fileNote={fileNote} setFileNote={setFileNote} focusRow={focusRow} />
        : <Suspense fallback={null}><LazyBody {...props} onClose={() => { setOpen(false); setFocusRow(undefined); }} fileNote={fileNote} setFileNote={setFileNote} focusRow={focusRow} /></Suspense>)}
    </>
  );
}
