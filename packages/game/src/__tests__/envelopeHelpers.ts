import { serialize } from "@full-plate/sim-empire";
import type { PathMeta } from "../state/paths";
/** The empire's own serialised form (the envelope already includes it; this pins its RNG and day too). */
export const serializeEmpire = (meta: PathMeta): string => (meta.empire ? serialize(meta.empire) : "");
