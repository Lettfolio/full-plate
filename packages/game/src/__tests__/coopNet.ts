/**
 * Round 13 (F): a deterministic stand-in for the `room` capability in unit tests — a virtual clock, per-message
 * latency with jitter (so messages reorder), random loss, and room.d.ts's stamps (peer, by, isMe, sameTab, kind).
 */
import type { RoomMsg } from "../lib/coop/realtime";

export interface NetOpts { latencyMs?: number; jitterMs?: number; loss?: number; seed?: number }
interface Pending { at: number; n: number; to: string; msg: RoomMsg }

export class FakeRoom {
  now = 0;
  private q: Pending[] = [];
  private n = 0;
  private rng: () => number;
  private members = new Map<string, { by: string | null; hear: (m: RoomMsg) => void }>();
  presence = new Map<string, Record<string, unknown>>();
  sent = 0;
  dropped = 0;
  constructor(public opts: NetOpts = {}) {
    let s = (opts.seed ?? 7) >>> 0;
    this.rng = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  join(peer: string, by: string | null, hear: (m: RoomMsg) => void) { this.members.set(peer, { by, hear }); }
  leave(peer: string) { this.members.delete(peer); }
  emitter(peer: string) {
    return (topic: string, data: unknown) => {
      this.sent++;
      const from = this.members.get(peer);
      for (const [to] of this.members) {
        const self = to === peer;
        if (!self && this.rng() < (this.opts.loss ?? 0)) { this.dropped++; continue; }
        const lat = self ? 0 : (this.opts.latencyMs ?? 0) + this.rng() * (this.opts.jitterMs ?? 0);
        this.q.push({ at: this.now + lat, n: this.n++, to, msg: { peer, by: from?.by ?? null, isMe: self, sameTab: self, kind: "viewer", topic, data: JSON.parse(JSON.stringify(data)) } });
      }
    };
  }
  /** Moves the clock to `t`, delivering everything due on the way (in arrival order). */
  advance(t: number) {
    for (;;) {
      let best = -1;
      for (let i = 0; i < this.q.length; i++) if (this.q[i]!.at <= t && (best < 0 || this.q[i]!.at < this.q[best]!.at || (this.q[i]!.at === this.q[best]!.at && this.q[i]!.n < this.q[best]!.n))) best = i;
      if (best < 0) break;
      const p = this.q.splice(best, 1)[0]!;
      this.now = Math.max(this.now, p.at);
      this.members.get(p.to)?.hear(p.msg);
    }
    this.now = t;
  }
}
