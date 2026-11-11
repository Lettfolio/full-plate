/**
 * Round 12 (G): the only co-op code in the main chunk — "is this device hosting a co-op day?", so App knows to load
 * the host's panel. The flag itself (code, nickname, expiry) lives in hostFlag.ts, a lazy chunk, which fires
 * `fp-coop` whenever it changes.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import type { HandsOnRemote } from "../../screens/HandsOnShift";

/** The friends chunk (Visit a friend, the host's panel, the Friends card): one import site, one preload list. */
export const loadFriends = () => import("../../screens/VisitFriend");
export const HOST_KEY = "full-plate:coop-host:v1";
const on = (): boolean => { try { return !!localStorage.getItem(HOST_KEY); } catch { return false; } };
export function useHostOn(): boolean {
  const [v, set] = useState(on);
  useEffect(() => { const f = () => set(on()); addEventListener("fp-coop", f); return () => removeEventListener("fp-coop", f); }, []);
  return v;
}

// ── Round 13 (F): the live co-op shift's two hooks into App (everything else is in the lazy CoopLive chunk) ──

let remote: HandsOnRemote | null = null;
const remoteSubs = new Set<() => void>();
/** The host's live partner for App's HandsOnShift (set by CoopLive while a live shift is on). */
export function setCoopRemote(r: HandsOnRemote | null): void { if (r === remote) return; remote = r; for (const f of remoteSubs) f(); }
export const useCoopRemote = (): HandsOnRemote | null => useSyncExternalStore((f) => { remoteSubs.add(f); return () => remoteSubs.delete(f); }, () => remote);

/**
 * The host's action log while a live shift is on: the state before the first action, and every action the app
 * reducer saw, in order, once each (StrictMode calls reducers twice with the same action object). The shift is a pure
 * function of the two: CoopLive replays it at closing time and compares the game byte for byte.
 */
export interface CoopRec { start: unknown; actions: object[]; seen: WeakSet<object> }
export const coopTap: { rec: CoopRec | null } = { rec: null };
export function tapReducer<S, A extends object>(r: (s: S, a: A) => S): (s: S, a: A) => S {
  return (s, a) => {
    const t = coopTap.rec;
    if (t && !t.seen.has(a)) { if (!t.actions.length) t.start = s; t.seen.add(a); t.actions.push(a); }
    return r(s, a);
  };
}
