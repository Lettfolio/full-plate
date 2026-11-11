/**
 * Round 9: "Your games" — up to six save slots. Continue, rename, delete (with the round-7 confirm), save to a file,
 * load a save file; and, from New game, pick where the new game goes. A lazy chunk (App.tsx).
 */
import { useRef, useState } from "react";
import { ConfirmDialog, Dialog } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { MoneyText } from "../components/MoneyText";
import { dateLabel } from "../lib/calendar";
import { MAX_FILE_BYTES, MAX_SLOTS, type SaveStore, type SlotSummary, type SlotView } from "../state/saveStore";
import { useSaves } from "../state/useSaves";
import { PATH_LABEL } from "./TitleScreen";
import "./slots.css";
import { logoDataUrl, resolveBrand } from "../lib/brand";

/** The picker's own icons, drawn like components/Icon.tsx (24 px grid, 1.75 stroke) but kept in this lazy chunk. */
const PICK = {
  pencil: <><path d="M15.5 4.5l4 4L9 19H5v-4z" /><path d="M13 7l4 4" /></>,
  trash: <><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" /><path d="M10.2 10.5v6M13.8 10.5v6" /></>,
  upload: <><path d="M12 15.5V4M7.5 8.5L12 4l4.5 4.5" /><path d="M4.5 15v4.5h15V15" /></>,
};
function PickIcon({ name }: { name: keyof typeof PICK }) {
  return (
    <svg className={`icon icon--${name}`} width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PICK[name]}
    </svg>
  );
}

/** "just now", "5 minutes ago", "yesterday", "2 days ago", "on 3 Nov". Wall-clock UI text only. */
export function playedAgo(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "a while ago";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  return `on ${new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

const WHERE = {
  account: { icon: "cloud", text: "On your account" },
  device: { icon: "cloudOff", text: "This device only" },
  memory: { icon: "warning", text: "Not saved yet" },
} as const;

interface Props {
  mode: "browse" | "new";
  store: SaveStore;
  onContinue: (slotId: string) => void;
  /** New game goes in this slot (an existing one: the player said yes to replacing it), or a free one (null). */
  onNewIn?: (slotId: string | null) => void;
  onClose: () => void;
  /** A slot is opening. */
  busy?: string | null;
  /** Round 11: an archived ("Lost — day N") game starts again with the same restaurant, in its own slot. */
  onRestart?: (slotId: string) => void;
}

type Ask = { kind: "delete" | "overwrite"; slot: SlotView } | null;

export function SlotPicker({ mode, store, onContinue, onNewIn, onClose, busy, onRestart }: Props) {
  const { slots } = useSaves(store);
  const [ask, setAsk] = useState<Ask>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ tone: "good" | "warn" | "info"; text: string } | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const free = Math.max(0, MAX_SLOTS - slots.length);

  const toFile = async (s: SlotView) => {
    setMsg({ tone: "info", text: `Getting ${s.name} ready…` });
    const r = await store.saveToFile(s.slotId);
    setMsg(r === "saved" ? { tone: "good", text: `Saved ${s.name} to a file ✓` } : r === "declined" ? { tone: "info", text: "No file was saved." } : { tone: "warn", text: "Sorry, that file couldn't be made." });
  };
  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    // Round 11 (S4): a file this big can't be a save; it isn't even read.
    if (file.size > MAX_FILE_BYTES) { setMsg({ tone: "warn", text: "That file is too big to be a Full Plate save." }); if (fileRef.current) fileRef.current.value = ""; return; }
    try {
      const text = await file.text();
      const s = await store.importFile(text);
      setFresh(s.slotId);
      setMsg({ tone: "good", text: `Loaded ${s.name} ✓ It's at the top of your games.` });
    } catch (e) {
      setMsg({ tone: "warn", text: e instanceof Error && e.message.length < 140 ? e.message : "That file isn't a Full Plate save." });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const saveName = async (s: SlotView) => {
    const n = draft.trim();
    setRenaming(null);
    if (n && n !== s.name) { await store.rename(s.slotId, n); setMsg({ tone: "good", text: `Renamed to ${n} ✓` }); }
  };

  if (ask?.kind === "delete") {
    return (
      <ConfirmDialog
        title={`Delete ${ask.slot.name}?`}
        body={<p>This deletes <b>{ask.slot.name}</b> from this device{ask.slot.where === "account" ? " and from your account" : ""}. It can't be undone. Save it to a file first if you might want it back.</p>}
        confirmLabel="Yes, delete it"
        cancelLabel="Keep it"
        danger
        onCancel={() => setAsk(null)}
        onConfirm={() => {
          const s = ask.slot; setAsk(null);
          // Round 14 (B): its share and co-op day go with it (lazy; the delete waits only for the slot's local read)
          void import("../lib/socialLife").then((m) => m.forgetSlotSocial(store, s.slotId)).catch(() => {}).finally(() => store.remove(s.slotId));
          setMsg({ tone: "info", text: `${s.name} was deleted.` });
        }}
      />
    );
  }
  if (ask?.kind === "overwrite") {
    return (
      <ConfirmDialog
        title="Start over in this slot?"
        body={<p><b>{ask.slot.name}</b> stays saved until your new game begins. Then the new game takes its place.</p>}
        confirmLabel="Yes, start a new game"
        cancelLabel="Go back"
        danger
        onCancel={() => setAsk(null)}
        onConfirm={() => { const s = ask.slot; setAsk(null); onNewIn?.(s.slotId); }}
      />
    );
  }

  return (
    <Dialog
      title={mode === "new" ? "Where shall we save your new game?" : "Your games"}
      kicker={`${slots.length} of ${MAX_SLOTS} slots used`}
      stamp={<Icon name={mode === "new" ? "plus" : "folder"} size={28} />}
      onClose={onClose}
      wide
      className="slots"
    >
      {msg && <p className={`callout${msg.tone === "warn" ? " callout--warn" : msg.tone === "good" ? " callout--good" : ""} slots__msg`} role="status">{msg.text}</p>}
      {mode === "new" && free > 0 && (
        <button className="btn btn--primary btn--xl slots__fresh" onClick={() => onNewIn?.(null)} data-autofocus>
          <Icon name="plus" size={22} />Start in an empty slot
        </button>
      )}
      {mode === "new" && free === 0 && <p className="callout slots__msg">All {MAX_SLOTS} slots are full. Pick a game to replace, or delete one first.</p>}
      <ul className="slots__list" aria-label="Saved games">
        {slots.map((s, i) => {
          const where = WHERE[s.where];
          const isRenaming = renaming === s.slotId;
          return (
            <li key={s.slotId} className={`slot${fresh === s.slotId ? " slot--fresh" : ""}${s.archived ? " slot--lost" : ""}`} aria-label={s.archived ? `${s.name}, lost on day ${s.day + 1}` : s.name}>
              <div className="slot__head">
                {/* R12-B: the game's logo (the stored brand, else the name's default) */}
                <img className="slot__logo" src={logoDataUrl(resolveBrand(s.brand, s.restaurantName, s.path === "career"))} width={40} height={40} alt="" aria-hidden="true" />
                {isRenaming ? (
                  <form className="slot__rename" onSubmit={(e) => { e.preventDefault(); void saveName(s); }}>
                    <label className="sr-only" htmlFor={`rn-${s.slotId}`}>New name for {s.name}</label>
                    <input id={`rn-${s.slotId}`} className="input" value={draft} maxLength={40} autoFocus onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }} />
                    <button className="btn btn--tap" type="submit">Save name</button>
                    <button className="btn btn--ghost btn--tap" type="button" onClick={() => setRenaming(null)}>Cancel</button>
                  </form>
                ) : (
                  <h3 className="slot__name">{s.name}</h3>
                )}
                <span className={`pill slot__path slot__path--${s.path}`}>{PATH_LABEL[s.path]}</span>
              </div>
              {s.name !== s.restaurantName && <div className="slot__sub">{s.restaurantName}</div>}
              <div className="slot__meta">
                {s.archived ? <span className="slot__day slot__lost" data-testid="slot-lost">Lost — day {s.day + 1}</span> : <span className="slot__day">Day {s.day + 1}</span>}
                <MoneyText pence={s.cash} whole className={s.cash < 0 ? "money--neg" : ""} />
                <span className="slot__date">{dateLabel(s.day)}</span>
              </div>
              <div className="slot__when"><Icon name={where.icon} size={18} />Played {playedAgo(s.updatedAt)} · {s.cantSync ? "Can't go to your account (too big), kept on this device" : where.text}</div>
              <div className="slot__actions">
                {mode === "browse" && s.archived ? (
                  <button className="btn btn--primary btn--tap" onClick={() => onRestart?.(s.slotId)} disabled={!!busy || !onRestart} aria-label={`Start ${s.restaurantName} over`} {...(i === 0 ? { "data-autofocus": true } : {})}>
                    {busy === s.slotId ? "Opening…" : "Start over with the same restaurant"}
                  </button>
                ) : mode === "browse" ? (
                  <button className="btn btn--primary btn--tap" onClick={() => onContinue(s.slotId)} disabled={!!busy} aria-label={`Continue ${s.name}`} {...(i === 0 ? { "data-autofocus": true } : {})}>
                    {busy === s.slotId ? "Opening…" : "Continue"}<Icon name="forward" size={20} />
                  </button>
                ) : (
                  <button className="btn btn--danger btn--tap" onClick={() => setAsk({ kind: "overwrite", slot: s })} aria-label={`Replace ${s.name} with a new game`}>Replace with a new game</button>
                )}
                {mode === "browse" && (
                  <>
                    {s.archived && <button className="btn btn--ghost btn--tap" onClick={() => onContinue(s.slotId)} disabled={!!busy} aria-label={`What happened to ${s.name}`}>What happened</button>}
                    <button className="btn btn--ghost btn--tap" onClick={() => { setDraft(s.name); setRenaming(s.slotId); }} aria-label={`Rename ${s.name}`}><PickIcon name="pencil" />Rename</button>
                    <button className="btn btn--ghost btn--tap" onClick={() => void toFile(s)} aria-label={`Save ${s.name} to a file`}><Icon name="download" size={20} />Save to a file</button>
                    <button className="btn btn--ghost btn--tap slot__delete" onClick={() => setAsk({ kind: "delete", slot: s })} aria-label={`Delete ${s.name}`}><PickIcon name="trash" />Delete</button>
                  </>
                )}
              </div>
            </li>
          );
        })}
        {Array.from({ length: mode === "browse" ? free : 0 }, (_, i) => (
          <li key={`free-${i}`} className="slot slot--empty" aria-label="Empty slot"><Icon name="save" size={22} />Empty slot</li>
        ))}
      </ul>
      <div className="slots__foot">
        <input ref={fileRef} type="file" accept=".json,.fpsave,application/json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => void fromFile(e.target.files?.[0])} data-testid="save-file-input" />
        <button className="btn btn--tap" onClick={() => fileRef.current?.click()} disabled={free === 0}><PickIcon name="upload" />Load a save file</button>
        <p className="small muted">A save file keeps a copy of a game anywhere you like — and moves it to another device or account.</p>
      </div>
    </Dialog>
  );
}

/** Round 9: the same game was played in two places. Pick one; the other is kept as a backup. */
export function ConflictDialog({ local, cloud, onPick }: { local: SlotSummary; cloud: SlotSummary; onPick: (which: "local" | "cloud") => void }) {
  const newer = local.updatedAt >= cloud.updatedAt ? "local" : "cloud";
  const option = (which: "local" | "cloud", s: SlotSummary) => (
    <button className={`conflict__opt${which === newer ? " conflict__opt--newer" : ""}`} onClick={() => onPick(which)} {...(which === newer ? { "data-autofocus": true } : {})}>
      <span className="conflict__where"><Icon name={which === "local" ? "cloudOff" : "cloud"} size={20} />{which === "local" ? "On this device" : "On your account"}{which === newer && <span className="pill conflict__new">Newer</span>}</span>
      <b>Day {s.day + 1} · <MoneyText pence={s.cash} whole /></b>
      <span className="small">Played {playedAgo(s.updatedAt)}</span>
    </button>
  );
  return (
    <Dialog title="Which one shall we play?" kicker={local.name} stamp={<Icon name="help" size={28} />} onClose={() => onPick(newer)} role="alertdialog" className="conflict">
      <p>This game was played in two places, so there are two different copies.</p>
      <div className="conflict__opts">{option(newer, newer === "local" ? local : cloud)}{option(newer === "local" ? "cloud" : "local", newer === "local" ? cloud : local)}</div>
      <p className="small muted">The other one is kept in Your games as a backup, so nothing is lost.</p>
    </Dialog>
  );
}
