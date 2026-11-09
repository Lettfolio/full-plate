import { lazy, Suspense, useState } from "react";
import { getSaveStore, type SaveStore } from "../state/saveStore";
import { saveMark, useSaves, type SaveMark } from "../state/useSaves";
import { Icon, type IconName } from "./Icon";

const SaveSheet = lazy(() => import("./SaveSheet").then((m) => ({ default: m.SaveSheet })));

export const SAVE_LOOK: Record<SaveMark, { icon: IconName; short: string; title: string }> = {
  account: { icon: "cloud", short: "Saved ✓", title: "Saved to your account ✓" },
  saving: { icon: "cloud", short: "Saving…", title: "Saving to your account…" },
  device: { icon: "cloudOff", short: "This device only", title: "Saved on this device only" },
  memory: { icon: "warning", short: "Not saved", title: "Not saved" },
};

/** Round 9: the small save mark in the header — synced ✓ / saving… / this device only / not saved; tap for why. */
export function SaveIndicator({ slotId, store = getSaveStore() }: { slotId: string; store?: SaveStore }) {
  const { status } = useSaves(store);
  const [open, setOpen] = useState(false);
  const mark = saveMark(status, slotId);
  const look = SAVE_LOOK[mark];
  return (
    <>
      <button className={`btn btn--ghost btn--tap shellbtn savemark savemark--${mark}`} aria-label={`${look.title}. What does this mean?`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <Icon name={look.icon} size={20} className="shellbtn__icon" /><span className="savemark__text">{look.short}</span>
      </button>
      {open && <Suspense fallback={null}><SaveSheet mark={mark} reason={status.reason} title={look.title} icon={look.icon} onFile={() => store.saveToFile(slotId)} onClose={() => setOpen(false)} /></Suspense>}
    </>
  );
}
