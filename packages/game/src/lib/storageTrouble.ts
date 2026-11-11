/** Round 14 (C, red-team U15): is keeping games on this device in trouble? (components/StorageNotice.tsx says so.) */
import { deviceStorage, storageFull } from "./storage";
import type { StoreStatus } from "../state/saveStore";

export type StorageTrouble = "blocked" | "full";

/** What's wrong with keeping games on this device, if anything the player needs to hear about. */
export function storageTrouble(status: StoreStatus): StorageTrouble | null {
  if (status.cloud === "on" || status.cloud === "waiting") return null; // the account keeps them (or may: wait)
  if (!status.local) return deviceStorage() ? "full" : "blocked";
  return storageFull() ? "full" : null;
}
