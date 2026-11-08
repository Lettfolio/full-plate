/**
 * TYPECHECK-ONLY fallback for "@full-plate/content" while packages/content/src/index.ts does
 * not exist yet (see tsconfig.json `paths`; the real index is tried first). ARCHITECTURE.md:
 * content "exports `content: ContentPack`". Never imported at runtime.
 */
import type { ContentPack } from "../../../sim-core/src/types";
export declare const content: ContentPack;
