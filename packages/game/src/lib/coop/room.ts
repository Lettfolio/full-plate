/**
 * Round 13 (F): the `room` capability (room.d.ts) as the live co-op shift uses it — `claude.use("room")` once, a named
 * room per session, and our own peer label (the stamp the session tags bind to). `null` everywhere it isn't there:
 * GitHub Pages, signed out, an artifact published without `room`, an older platform. Then the turn-based day it is.
 */
import { runtime } from "../../state/saveStore";
import type { RoomMsg } from "./realtime";

export interface RoomPeer extends Omit<RoomMsg, "topic" | "data"> { presence: Readonly<Record<string, unknown>>; updatedAt: number }
type OnError = (e: { code: string; message?: string }) => void;
/** The NamedRoom calls the game uses (room.d.ts). */
export interface NamedRoomLike {
  readonly name: string;
  emit(topic: string, data?: unknown): Promise<void>;
  on(topic: string, handler: (msg: RoomMsg) => void, onError?: OnError): () => void;
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): readonly RoomPeer[];
  onPeers(handler: (change: { peers: readonly RoomPeer[]; joined: readonly RoomPeer[]; left: readonly RoomPeer[] }) => void, onError?: OnError): () => void;
  connected(): boolean;
  onConnection(handler: (connected: boolean) => void, onError?: OnError): () => void;
  leave(): Promise<void>;
}
export interface RoomNs { join(name: string): Promise<NamedRoomLike> }

let cached: Promise<RoomNs | null> | null = null;
let override: (() => Promise<RoomNs | null>) | null = null;
/** Tests: swap how the room is reached (null = the real runtime). */
export function setRoomForTests(fn: (() => Promise<RoomNs | null>) | null): void { override = fn; cached = null; }

/** The room namespace, or null when this view can't connect (design for absence, room.d.ts). Memoised. */
export function getRoom(): Promise<RoomNs | null> {
  if (override) return override();
  return (cached ??= (async () => {
    const c = runtime();
    if (!c) return null;
    try {
      const r = (await c.use("room")) as RoomNs | null;
      return r && typeof r.join === "function" ? r : null;
    } catch { return null; }
  })());
}

export type Joined = { room: NamedRoomLike; me: string } | { error: string };
/**
 * Join the session's named room and learn our own peer label (from peers(): the entry marked sameTab). The first
 * onPeers delivery can be partial (room.d.ts), so this waits up to `waitMs` for it.
 */
export async function joinLive(ns: RoomNs, name: string, waitMs = 5000): Promise<Joined> {
  let room: NamedRoomLike;
  try { room = await ns.join(name); } catch (e) { return { error: typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : "upstream_error" }; }
  const mine = () => room.peers().find((p) => p.sameTab)?.peer ?? null;
  const now = mine();
  if (now) return { room, me: now };
  return await new Promise<Joined>((resolve) => {
    let done = false;
    const finish = (j: Joined) => { if (done) return; done = true; clearTimeout(t); stop(); resolve(j); };
    const stop = room.onPeers(() => { const m = mine(); if (m) finish({ room, me: m }); }, (e) => finish({ error: e.code }));
    const t = setTimeout(() => { const m = mine(); finish(m ? { room, me: m } : { error: "upstream_error" }); }, waitMs);
  });
}
