/**
 * Round 12 (G): one side of a co-op session over the db — a writer for my document (one write at a time, bursts
 * coalesced into the newest body, as db.d.ts asks) and a subscription to the other side's document.
 */
import { errCode, newCode, parseCode, type SDb } from "../../state/share";
import { checkGuest, checkHost, expired, guestDoc, guestPath, hostDoc, hostPath, type GuestDoc, type HostDoc } from "./protocol";

/** Writes the newest body of one document, one write in flight at a time. */
export class DocWriter<T extends object> {
  private body: T;
  private queued = false;
  private busy: Promise<void> | null = null;
  failed: string | null = null;
  constructor(private db: SDb, private path: string, first: T, private onFail?: (code: string) => void) { this.body = first; }
  get current(): T { return this.body; }
  /** Replace the body (merged) and write it soon. Resolves when this body (or a newer one) is written. */
  patch(p: Partial<T>): Promise<void> {
    this.body = { ...this.body, ...p };
    this.queued = true;
    return (this.busy ??= this.drain());
  }
  private async drain(): Promise<void> {
    try {
      while (this.queued) {
        this.queued = false;
        try { await this.db.doc(this.path).set(this.body as Record<string, unknown>); this.failed = null; }
        catch (e) { this.failed = errCode(e); this.onFail?.(this.failed); }
      }
    } finally { this.busy = null; }
  }
  async remove(): Promise<void> {
    await this.busy;
    try { await this.db.doc(this.path).delete(); } catch { /* it expires anyway */ }
  }
}

/** Host: make a session under a fresh code. */
export async function hostStart(db: SDb, nick: string, now = Date.now(), code = newCode()): Promise<{ code: string; writer: DocWriter<HostDoc> }> {
  const writer = new DocWriter<HostDoc>(db, hostPath(code), hostDoc({ nick, createdAt: now }));
  await writer.patch({});
  if (writer.failed) throw { code: writer.failed };
  return { code, writer };
}
/** Host: pick up a session this device started (after a reload). Null if it's gone or expired. */
export async function hostResume(db: SDb, code: string, dish: (id: string) => boolean, now = Date.now()): Promise<DocWriter<HostDoc> | null> {
  try {
    const s = await db.doc(hostPath(code)).get();
    const h = s.exists ? checkHost(s.data(), dish) : null;
    if (!h || h.stage === "ended" || expired(h, now)) return null;
    return new DocWriter<HostDoc>(db, hostPath(code), h);
  } catch { return null; }
}

export type JoinResult = { ok: true; host: HostDoc; writer: DocWriter<GuestDoc>; code: string } | { ok: false; why: "code" | "missing" | "expired" | "ended" | "error" };
/** Guest: join by code with a nickname. */
export async function guestJoin(db: SDb, typed: string, nick: string, dish: (id: string) => boolean, now = Date.now()): Promise<JoinResult> {
  const code = parseCode(typed);
  if (!code) return { ok: false, why: "code" };
  try {
    const s = await db.doc(hostPath(code)).get();
    const h = s.exists ? checkHost(s.data(), dish) : null;
    if (!h) return { ok: false, why: "missing" };
    if (h.stage === "ended") return { ok: false, why: "ended" };
    if (expired(h, now)) return { ok: false, why: "expired" };
    const writer = new DocWriter<GuestDoc>(db, guestPath(code), guestDoc({ nick, joinedAt: now }));
    await writer.patch({});
    if (writer.failed) return { ok: false, why: "error" };
    return { ok: true, host: h, writer, code };
  } catch { return { ok: false, why: "error" }; }
}

/** Watch the other side's document. `null` = not there (yet, or any more). */
export function watchHost(db: SDb, code: string, dish: (id: string) => boolean, next: (h: HostDoc | null) => void, error?: (code: string) => void): () => void {
  return db.doc(hostPath(code)).onSnapshot((s) => next(s.exists ? checkHost(s.data(), dish) : null), (e) => error?.(e.code));
}
export function watchGuest(db: SDb, code: string, dish: (id: string) => boolean, next: (g: GuestDoc | null) => void, error?: (code: string) => void): () => void {
  return db.doc(guestPath(code)).onSnapshot((s) => next(s.exists ? checkGuest(s.data(), dish) : null), (e) => error?.(e.code));
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
