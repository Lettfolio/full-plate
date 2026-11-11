/**
 * Round 12 (G): "is this device hosting a co-op day, and under which code?" Kept in localStorage so a reload carries
 * on; it ends itself after the session's two hours. Changes fire `fp-coop` for the main chunk's `useHostOn` (flag.ts).
 */
import { useSyncExternalStore } from "react";
import { HOST_KEY as KEY } from "./flag";
import { prefsStorage } from "../storage";

export interface HostFlag { code: string; nick: string; expiresAt: number; game: string }
const subs = new Set<() => void>();
let cur: HostFlag | null | undefined;

function read(): HostFlag | null {
  try {
    const o = JSON.parse(prefsStorage().getItem(KEY) ?? "null") as HostFlag | null;
    return o && typeof o.code === "string" && typeof o.expiresAt === "number" && o.expiresAt > Date.now() ? o : null;
  } catch { return null; }
}
export const getHostFlag = (): HostFlag | null => (cur === undefined ? (cur = read()) : cur && cur.expiresAt <= Date.now() ? (cur = null) : cur);
export function setHostFlag(f: HostFlag | null): void {
  cur = f;
  try { if (f) prefsStorage().setItem(KEY, JSON.stringify(f)); else prefsStorage().removeItem(KEY); } catch { /* memory only */ }
  for (const s of subs) s();
  try { dispatchEvent(new Event("fp-coop")); } catch { /* no window (tests) */ }
}
export const useHostFlag = (): HostFlag | null => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, getHostFlag);
