/**
 * Round 12 (G): hands a freshly made host writer from the Friends card to the co-op dock (both lazy chunks), so the
 * dock doesn't read back the document it was just given.
 */
import type { DocWriter } from "./session";
import type { HostDoc } from "./protocol";

export const pendingWriter = new Map<string, DocWriter<HostDoc>>();
