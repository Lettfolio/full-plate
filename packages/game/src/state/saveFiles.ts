/**
 * Round 9: slot housekeeping in a lazy chunk — rename, delete, and save files, the layer that works everywhere. "Save to a file" offers
 * `fullplate-<name>-day<N>.fpsave.json`: a small JSON envelope around the packed save (gzip + base64 with the
 * `full-plate-save-file` magic, or the plain envelope where CompressionStream is missing). "Load a save file" reads that,
 * an old raw envelope, or a bare round 1–2 GameState. `.json` because the `downloads` capability only allows listed
 * extensions (`.fpsave` is not one).
 */
import { decodeSave, encodeSave, type Loaded } from "./save";
import { DAMAGED, validateLoaded } from "./saveCheck";
import { pack, TooBig, unpack } from "./saveCodec";
import { defaultSlotName, isOver, MAX_FILE_BYTES, MAX_PACKED, MAX_SLOTS, pickSummary, runtime, safeName, type Core, type SlotPath, type SlotSummary, type SlotView } from "./saveStore";
import { cleanName } from "@full-plate/sim-core/schema";

export const NOT_A_SAVE = "That file isn't a Full Plate save.";
export const TOO_BIG = "That file is too big to be a Full Plate save.";

export const FILE_MAGIC = "full-plate-save-file";

export interface SaveFile {
  magic: typeof FILE_MAGIC;
  v: 1;
  name: string;
  restaurantName: string;
  day: number;
  path: SlotPath;
  savedAt: string;
  encoding: "gzip-b64" | "b64" | "json";
  /** Packed envelope (base64), or the envelope itself for "json". */
  data: string;
}

export function saveFileName(name: string, day: number): string {
  const slug = name.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase().slice(0, 40) || "game";
  return `fullplate-${slug}-day${day + 1}.fpsave.json`;
}

/** A save file's text. `compress` false (no CompressionStream) writes the envelope as plain JSON. */
export async function encodeSaveFile(raw: string, s: SlotSummary, now: string, compress: boolean): Promise<string> {
  const p = compress ? await pack(raw, true) : { encoding: "json" as const, data: raw };
  const file: SaveFile = { magic: FILE_MAGIC, v: 1, name: s.name, restaurantName: s.restaurantName, day: s.day, path: s.path, savedAt: now, encoding: p.encoding, data: p.data };
  return JSON.stringify(file);
}

/**
 * Reads a save file, an old raw envelope, or a bare round 1–2 GameState. Throws a child-readable message.
 * Round 11: too-big text is refused before parsing (S4), and every field of the game is checked (S1/S3) — `loaded` is
 * the cleaned copy; `raw` is the original text (callers keep `encodeSave(loaded)`, never `raw`).
 */
export async function decodeSaveFile(text: string): Promise<{ raw: string; loaded: Loaded; name?: string }> {
  if (typeof text !== "string" || text.length > MAX_FILE_BYTES) throw new Error(TOO_BIG);
  let f: Partial<SaveFile>;
  try { f = JSON.parse(text) as Partial<SaveFile>; } catch { throw new Error(NOT_A_SAVE); }
  let raw = text, decoded: Loaded;
  if (f?.magic !== FILE_MAGIC) {
    try { decoded = decodeSave(text); } catch { throw new Error(NOT_A_SAVE); }
  } else {
    if (typeof f.data !== "string" || (f.encoding !== "gzip-b64" && f.encoding !== "b64" && f.encoding !== "json")) throw new Error(DAMAGED);
    try { raw = await unpack(f.encoding, f.data); decoded = decodeSave(raw); } catch (e) { throw new Error(e instanceof TooBig ? TOO_BIG : DAMAGED); }
  }
  let loaded: Loaded;
  try { loaded = validateLoaded(decoded); } catch { throw new Error(DAMAGED); }
  const name = typeof f?.name === "string" ? cleanName(f.name, 40).trim() : "";
  return { raw, loaded, ...(name ? { name } : {}) };
}

/**
 * Offers a file: the `downloads` capability inside claude.ai (the viewer confirms), else an `<a download>` link.
 * Round 12 (B): also a Blob (a postcard PNG); the capability takes its type from the extension.
 */
export async function offerFile(filename: string, text: string | Blob): Promise<"saved" | "declined" | "failed"> {
  const c = runtime();
  if (c) {
    try {
      const dl = (await c.use("downloads")) as { save(r: { filename: string; data: string | Blob }): Promise<unknown> } | null;
      if (dl) {
        try { await dl.save({ filename, data: text }); return "saved"; } catch (e) {
          const code = (e as { code?: string })?.code;
          if (code === "declined" || code === "rate_limited") return "declined";
          // anything else (unavailable, rejected_extension…): a plain link below
        }
      }
    } catch { /* a plain link below */ }
  }
  try {
    const url = URL.createObjectURL((typeof text === "string" ? new Blob([text], { type: "application/json" }) : text));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename, rel: "noopener" });
    a.style.display = "none";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return "saved";
  } catch { return "failed"; }
}

/** The best copy's raw envelope, for a save file (no conflict questions: memory → device → account). */
async function rawFor(c: Core, slotId: string): Promise<{ raw: string; summary: SlotSummary } | null> {
  const m = c.memory.get(slotId);
  if (m) return { raw: m.raw, summary: m.summary };
  const e = c.index.get(slotId), h = c.headers.get(slotId);
  const raw = e ? await c.readBlob(slotId) : null;
  if (raw && e && (!h || h.hash === e.hash || h.updatedAt <= e.updatedAt)) return { raw, summary: pickSummary(e) };
  const got = c.part && h ? await c.part.fetch(slotId) : null;
  if (got) return { raw: got.raw, summary: pickSummary(got.header) };
  return raw && e ? { raw, summary: pickSummary(e) } : null;
}

/** A save file for the slot: its text and suggested file name. */
export async function exportFile(c: Core, slotId: string): Promise<{ filename: string; text: string } | null> {
  const r = await rawFor(c, slotId);
  return r ? { filename: saveFileName(r.summary.name, r.summary.day), text: await encodeSaveFile(r.raw, r.summary, new Date(c.d.now()).toISOString(), c.d.compress) } : null;
}

export async function saveToFile(c: Core, slotId: string): Promise<"saved" | "declined" | "failed"> {
  const f = await exportFile(c, slotId).catch(() => null);
  return f ? offerFile(f.filename, f.text) : "failed";
}

/** Reads a save file into a free slot (or `intoSlotId`). Throws a child-readable message when it can't. */
export async function importFile(c: Core, text: string, intoSlotId?: string): Promise<SlotView> {
  const { loaded, name } = await decodeSaveFile(text);
  if (isOver(loaded.game, loaded.meta)) throw new Error("That game had already finished, so it can't be continued.");
  const id = intoSlotId ?? (c.list().length < MAX_SLOTS ? c.uniqueId() : null);
  if (!id) throw new Error(`All ${MAX_SLOTS} save slots are full. Delete a game first, then load the file again.`);
  // Round 11 (S6): keep the game, not the file — re-serialised from the checked copy, so padding and unknown keys go.
  let raw: string;
  try { raw = encodeSave(loaded.game, loaded.meta); } catch { throw new Error(DAMAGED); }
  if ((await pack(raw, c.d.compress)).data.length > MAX_PACKED) throw new Error("That game is too big to keep. Sorry!");
  await c.putRaw(id, raw, loaded.game, loaded.meta, name ?? defaultSlotName(loaded.game, loaded.meta));
  return c.list().find((s) => s.slotId === id)!;
}

export async function rename(c: Core, slotId: string, name: string): Promise<void> {
  const n = safeName(String(name)).trim();
  if (!n) return;
  const m = c.memory.get(slotId), e = c.index.get(slotId), h = c.headers.get(slotId);
  if (m) m.summary = { ...m.summary, name: n };
  if (e) { e.name = n; c.writeIndex(); }
  if (h) c.headers.set(slotId, { ...h, name: n });
  c.emit();
  if (h) await c.part?.rename(slotId, n);
}

/** Delete everywhere: on the account the header goes first (so it stops listing), then its chunks. */
export async function remove(c: Core, slotId: string): Promise<void> {
  clearTimeout(c.timers.get(slotId)); c.timers.delete(slotId);
  const hw = c.index.get(slotId)?.hw ?? 0;
  c.memory.delete(slotId); c.dirty.delete(slotId); c.renameNext.delete(slotId);
  c.dropLocal(slotId);
  c.emit();
  if (c.st.cloud === "on") await c.part?.remove(slotId, hw);
}
