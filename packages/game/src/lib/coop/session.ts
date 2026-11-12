/**
 * Round 12 (G): one side of a co-op session over the db — a writer for my document (one write at a time, bursts
 * coalesced into the newest body, as db.d.ts asks) and a subscription to the other side's document.
 *
 * Round 14 (B, S14-2): each side's document lives under its writer's own id (protocol.ts has the paths), so the `db`
 * rules let nobody else write it. The guest finds the host from the code (its check letters fit the host's id); the
 * host finds would-be guests by their markers' join keys and pins the FIRST one into its own document (`guest`):
 * a later one is refused ("taken"). `partnerId` — the other side's platform id, taken from the path of the document
 * it wrote, so it is trustworthy — is in `JoinResult`, in `watchGuest`'s callback and in `partnerOf(code)` (for the
 * live shift's `by` check). Ending a session deletes my document; stale ones are swept the next time I'm here.
 */
import { codeFits, codeOwners, errCode, newCode, parseCode, readMe, slowKey, writeMe, type Me, type SDb } from "../../state/share";
import { checkGuest, checkHost, coopMePath, expired, guestDoc, guestPath, hostDoc, hostPath, SESSION_MS, UID_RE, type GuestDoc, type HostDoc } from "./protocol";

type L = { db: SDb; uid: string };

/** Writes the newest body of one document, one write in flight at a time. After `remove()` it writes nothing more. */
export class DocWriter<T extends object> {
  private body: T;
  private queued = false;
  private busy: Promise<void> | null = null;
  private closed = false;
  failed: string | null = null;
  constructor(private db: SDb, readonly path: string, first: T, private onFail?: (code: string) => void) { this.body = first; }
  get current(): T { return this.body; }
  /** Replace the body (merged) and write it soon. Resolves when this body (or a newer one) is written. */
  patch(p: Partial<T>): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.body = { ...this.body, ...p };
    this.queued = true;
    return (this.busy ??= this.drain());
  }
  private async drain(): Promise<void> {
    try {
      while (this.queued && !this.closed) {
        this.queued = false;
        try { await this.db.doc(this.path).set(this.body as Record<string, unknown>); this.failed = null; }
        catch (e) { this.failed = errCode(e); this.onFail?.(this.failed); }
      }
    } finally { this.busy = null; }
  }
  async remove(): Promise<void> {
    await this.busy;
    this.closed = true;
    try { await this.db.doc(this.path).delete(); } catch { /* swept next time */ }
  }
}

// ── who is on the other side (from paths only) ──
const partners = new Map<string, string>();
/** The other side's platform id for session `code` on this page (null until there is one). */
export const partnerOf = (code: string): string | null => partners.get(code) ?? null;

// ── my co-op marker and private record ──
async function marker(l: L, edit: (j: string[]) => string[]): Promise<void> {
  const ref = l.db.doc(coopMePath(l.uid));
  const s = await ref.get();
  const j = s.exists ? (Array.isArray(s.data()?.j) ? (s.data()!.j as unknown[]).filter((x): x is string => typeof x === "string" && /^j[0-9a-f]{32}$/.test(x)) : []) : [];
  const next = [...new Set(edit(j))].slice(-20);
  if (!s.exists || JSON.stringify(next) !== JSON.stringify(j)) await ref.set({ kind: "fp-coop-me", v: 2, j: next });
}
async function note(l: L, edit: (c: Me["coop"]) => Me["coop"]): Promise<void> {
  const me = await readMe(l);
  await writeMe(l, { ...me, coop: edit({ ...me.coop }) });
}
/**
 * Delete my own co-op documents for sessions that are over (or, with `codes`, for those sessions now), keep my
 * marker's join keys to the live ones, and drop the marker when nothing is left. Nobody else can delete them.
 */
export async function sweepCoop(l: L, now = Date.now(), codes: readonly string[] = []): Promise<void> {
  const me = await readMe(l);
  const gone = Object.entries(me.coop).filter(([c, n]) => n.exp <= now || codes.includes(c));
  for (const [c, n] of gone) await l.db.doc(n.role === "host" ? hostPath(l.uid, c) : guestPath(l.uid, c)).delete();
  const left = Object.fromEntries(Object.entries(me.coop).filter(([c]) => !gone.some(([g]) => g === c)));
  if (gone.length) await writeMe(l, { ...me, coop: left });
  const keys = Object.entries(left).filter(([, n]) => n.role === "guest").map(([c]) => slowKey("j", c));
  if (!Object.keys(left).length) { if ((await l.db.doc(coopMePath(l.uid)).get()).exists) await l.db.doc(coopMePath(l.uid)).delete(); }
  else await marker(l, () => keys);
}

/** Host: make a session under a fresh code (its check letters fit my id). */
export async function hostStart(l: L, nick: string, now = Date.now(), code = newCode(l.uid)): Promise<{ code: string; writer: DocWriter<HostDoc> }> {
  if (!codeFits(code, l.uid)) throw { code: "invalid_argument" };
  await sweepCoop(l, now).catch(() => {});
  await marker(l, (j) => j);
  const writer = new DocWriter<HostDoc>(l.db, hostPath(l.uid, code), hostDoc({ nick, createdAt: now }));
  await writer.patch({});
  if (writer.failed) throw { code: writer.failed };
  await note(l, (c) => ({ ...c, [code]: { role: "host", host: l.uid, exp: now + SESSION_MS } })).catch(() => {});
  return { code, writer };
}
/** Host: pick up a session this device started (after a reload). Null if it's gone or expired. */
export async function hostResume(l: L, code: string, dish: (id: string) => boolean, now = Date.now()): Promise<DocWriter<HostDoc> | null> {
  try {
    const s = await l.db.doc(hostPath(l.uid, code)).get();
    const h = s.exists ? checkHost(s.data(), dish) : null;
    if (!h || h.stage === "ended" || expired(h, now)) return null;
    if (h.guest) partners.set(code, h.guest);
    return new DocWriter<HostDoc>(l.db, hostPath(l.uid, code), h);
  } catch { return null; }
}
/** Host: end the session — say so, then delete my document (the guest sees it end either way). */
export async function endHosting(l: L, code: string, writer?: DocWriter<HostDoc> | null): Promise<void> {
  if (writer) { await writer.patch({ stage: "ended" }); await writer.remove(); }
  partners.delete(code);
  await sweepCoop(l, Date.now(), [code]);
}

/** The session a code opens: the one host document whose owner's id fits the code. */
export async function findHost(db: SDb, code: string, dish: (id: string) => boolean): Promise<{ hostId: string; host: HostDoc } | null> {
  const found: { hostId: string; host: HostDoc }[] = [];
  for (const id of await codeOwners(db, "fpc", code)) {
    const s = await db.doc(hostPath(id, code)).get();
    const h = s.exists ? checkHost(s.data(), dish) : null;
    if (h) found.push({ hostId: id, host: h });
  }
  return found.length === 1 ? found[0]! : null;
}

export type JoinResult =
  | { ok: true; host: HostDoc; writer: DocWriter<GuestDoc>; code: string; hostId: string; partnerId: string }
  | { ok: false; why: "code" | "missing" | "expired" | "ended" | "taken" | "own" | "error" };
/** Guest: join by code with a nickname. */
export async function guestJoin(l: L, typed: string, nick: string, dish: (id: string) => boolean, now = Date.now()): Promise<JoinResult> {
  const code = parseCode(typed);
  if (!code) return { ok: false, why: "code" };
  try {
    const f = await findHost(l.db, code, dish);
    if (!f) return { ok: false, why: "missing" };
    const h = f.host;
    if (h.stage === "ended") return { ok: false, why: "ended" };
    if (expired(h, now)) return { ok: false, why: "expired" };
    if (f.hostId === l.uid) return { ok: false, why: "own" };
    if (h.guest && h.guest !== l.uid) return { ok: false, why: "taken" };
    const writer = new DocWriter<GuestDoc>(l.db, guestPath(l.uid, code), guestDoc({ nick, joinedAt: now }));
    await writer.patch({});
    if (writer.failed) return { ok: false, why: "error" };
    await marker(l, (j) => [...j, slowKey("j", code)]);
    await note(l, (c) => ({ ...c, [code]: { role: "guest", host: f.hostId, exp: h.expiresAt } })).catch(() => {});
    partners.set(code, f.hostId);
    return { ok: true, host: h, writer, code, hostId: f.hostId, partnerId: f.hostId };
  } catch { return { ok: false, why: "error" }; }
}
/** Guest: leave — say so, delete my document and my join key. */
export async function leaveAsGuest(l: L, code: string, writer: DocWriter<GuestDoc>): Promise<void> {
  await writer.patch({ ended: true });
  await writer.remove();
  partners.delete(code);
  await sweepCoop(l, Date.now(), [code]).catch(() => {});
}

/**
 * Guest: watch the host's document. `null` = not there (yet, or any more) — or the host let someone else in (`me`
 * given and the host's `guest` is another id).
 */
export function watchHost(db: SDb, hostId: string, code: string, dish: (id: string) => boolean, next: (h: HostDoc | null) => void, error?: (code: string) => void, me?: string): () => void {
  let last: HostDoc | null = null;
  return db.doc(hostPath(hostId, code)).onSnapshot((s) => {
    const h = s.exists ? checkHost(s.data(), dish) : null;
    if (h && me && h.guest && h.guest !== me) { last = null; next(null); return; }
    // the host deletes the document when the day ends: once seen, its going means "ended"
    if (!h && last) { next({ ...last, stage: "ended" }); return; }
    last = h;
    next(h);
  }, (e) => error?.(e.code));
}
/**
 * Host: watch my guest. Until one is pinned, watch for markers carrying this session's join key; the first whose
 * guest document is there (and not ended) is pinned into my document — after that only their document is read.
 * `next(guest, partnerId)`: the partner's id is the path segment of the document it came from.
 */
export function watchGuest(l: L, writer: DocWriter<HostDoc>, code: string, dish: (id: string) => boolean, next: (g: GuestDoc | null, partnerId: string | null) => void, error?: (code: string) => void): () => void {
  let dead = false;
  let stopDoc = () => {};
  let stopQ = () => {};
  const follow = (id: string) => {
    partners.set(code, id);
    let last: GuestDoc | null = null;
    stopDoc = l.db.doc(guestPath(id, code)).onSnapshot((s) => {
      if (dead) return;
      const g = s.exists ? checkGuest(s.data(), dish) : null;
      // the guest deletes the document on leaving: once seen, its going means "left"
      if (!g && last) { next({ ...last, ended: true }, id); return; }
      last = g;
      next(g, id);
    }, (e) => error?.(e.code));
  };
  const pinned = writer.current.guest;
  if (pinned && UID_RE.test(pinned)) follow(pinned);
  else {
    let busy = false;
    stopQ = l.db.collection("fpc").where("j", "array-contains", slowKey("j", code)).limit(20).onSnapshot(async (s) => {
      if (dead || busy || writer.current.guest) return;
      busy = true;
      try {
        for (const d of s.docs) {
          if (d.id === l.uid || !UID_RE.test(d.id)) continue;
          const g = await l.db.doc(guestPath(d.id, code)).get();
          const gd = g.exists ? checkGuest(g.data(), dish) : null;
          if (!gd || gd.ended || dead || writer.current.guest) continue;
          await writer.patch({ guest: d.id });
          stopQ();
          follow(d.id);
          return;
        }
        if (!dead) next(null, null);
      } finally { busy = false; }
    }, (e) => error?.(e.code));
  }
  return () => { dead = true; stopQ(); stopDoc(); };
}

/** Round-trip times (ms) of the host's pings answered by the guest's pongs. */
export class RttMeter {
  private sent = new Map<number, number>();
  samples: number[] = [];
  next = 1;
  ping(now = performance.now()): number { const n = this.next++; this.sent.set(n, now); return n; }
  pong(n: number, now = performance.now()): number | null {
    const t = this.sent.get(n);
    if (t === undefined) return null;
    this.sent.delete(n);
    const ms = Math.round(now - t);
    this.samples.push(ms);
    return ms;
  }
  get median(): number | null {
    if (!this.samples.length) return null;
    const s = [...this.samples].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
  }
}
