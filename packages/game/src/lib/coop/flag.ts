/**
 * Round 12 (G): the only co-op code in the main chunk — "is this device hosting a co-op day?", so App knows to load
 * the host's panel. The flag itself (code, nickname, expiry) lives in hostFlag.ts, a lazy chunk, which fires
 * `fp-coop` whenever it changes.
 */
import { useEffect, useState } from "react";
import { prefsStorage } from "../storage";

/** The friends chunk (Visit a friend, the host's panel, the Friends card): one import site, one preload list. */
export const loadFriends = () => import("../../screens/VisitFriend");
export const HOST_KEY = "full-plate:coop-host:v1";
const on = (): boolean => { try { return !!prefsStorage().getItem(HOST_KEY); } catch { return false; } };
export function useHostOn(): boolean {
  const [v, set] = useState(on);
  useEffect(() => { const f = () => set(on()); addEventListener("fp-coop", f); return () => removeEventListener("fp-coop", f); }, []);
  return v;
}
