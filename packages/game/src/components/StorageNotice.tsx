/**
 * Round 14 (C, red-team U15): when this device can't keep the game (storage blocked, or full), say so where she'll see
 * it — under the header on the game's screens, and on the title — not only in the phone's ⋯ sheet. One line, a
 * "Save to a file" button and a dismiss (for this visit). Nothing shows while the account is keeping the games.
 * A lazy chunk: the main chunk only asks `storageTrouble` (lib/storageTrouble.ts) and loads this when there is some.
 */
import { useState } from "react";
import type { StoreStatus } from "../state/saveStore";
import { storageTrouble, type StorageTrouble } from "../lib/storageTrouble";
import { Icon } from "./Icon";

const dismissed = new Set<string>();
/** Tests: show every notice again. */
export function resetStorageNotice(): void { dismissed.clear(); }

const TEXT: Record<"title" | "game", Record<StorageTrouble, string>> = {
  game: {
    blocked: "This game can't be saved on this device right now.",
    full: "This device's storage is full, so this game may not be saved here.",
  },
  title: {
    blocked: "This browser can't keep games right now: each one is gone when the page closes.",
    full: "This device's storage is full, so games may not be saved here.",
  },
};

interface Props {
  status: StoreStatus;
  where: "title" | "game";
  /** Game: save to a file (resolves with what happened). Title: open Your games, where each game has Save to a file. */
  onFile: () => Promise<string> | void;
}

export function StorageNotice({ status, where, onFile }: Props) {
  const trouble = storageTrouble(status);
  const key = `${where}:${trouble}`;
  const [hidden, setHidden] = useState(() => dismissed.has(key));
  const [note, setNote] = useState<string | null>(null);
  if (!trouble || hidden || dismissed.has(key)) return null;
  const file = () => {
    const r = onFile();
    if (r) { setNote("Getting the file ready…"); void r.then(setNote, () => setNote("Sorry, the file couldn't be made.")); }
  };
  return (
    <div className={`callout callout--warn storenotice storenotice--${where}`} role="status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, margin: where === "title" ? "12px auto" : "8px 16px", maxWidth: 960 }}>
      <Icon name="warning" size={20} />
      <span style={{ flex: "1 1 220px" }}>{TEXT[where][trouble]} {note ?? (where === "game" ? "Keep a copy:" : "Keep a copy of each game from Your games.")}</span>
      <button type="button" className="btn btn--tap" onClick={file}><Icon name="download" size={20} />{where === "game" ? "Save to a file" : "Your games"}</button>
      <button type="button" className="btn btn--ghost btn--tap" aria-label="Hide this notice" onClick={() => { dismissed.add(key); setHidden(true); }}><Icon name="close" size={20} /></button>
    </div>
  );
}
