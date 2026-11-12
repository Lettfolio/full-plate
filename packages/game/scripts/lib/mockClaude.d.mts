/** Round 14 (B): types for the parts of mockClaude.mjs the vitest suite imports (the rest is Playwright-only). */
import type { Level, Rule } from "./dbRules";
interface AsDb {
  get(path: string): Promise<{ exists: boolean; data?: Record<string, unknown> }>;
  set(path: string, data: Record<string, unknown>): Promise<unknown>;
  update(path: string, data: Record<string, unknown>): Promise<unknown>;
  delete(path: string): Promise<unknown>;
  list(path: string, q?: { where?: { field: string; op: string; value: unknown }[]; order?: string; dir?: "asc" | "desc"; limit?: number }): Promise<{ docs: { id: string; data: Record<string, unknown> }[] }>;
}
export function createMockStore(o?: { latencyMs?: number; rules?: Rule[] | null; levels?: Record<string, Level> }): {
  docs: Map<string, Record<string, unknown>>;
  stats: Record<string, number>;
  rules: readonly Rule[];
  levels: Record<string, Level>;
  call(uid: string, msg: unknown, level?: Level): Promise<unknown>;
  as(uid: string, level?: Level): AsDb;
};
export function createMockRoom(o?: Record<string, unknown>): unknown;
export function installMockClaude(context: unknown, store: unknown, o?: { uid: string; pollMs?: number; room?: unknown; level?: Level }): Promise<void>;
