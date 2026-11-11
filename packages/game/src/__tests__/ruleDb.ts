/**
 * Round 14 (B): an in-memory db with db.d.ts's shape that ENFORCES the artifact's access rules (scripts/lib/dbRules.ts,
 * the same engine the Playwright mock uses). One store, many viewers: `db.as("u_mallory")` is the same data seen and
 * written by another viewer, `db.as("u_viv", "view")` by a Viewer. Reads below the level see nothing; writes reject
 * `{ code: "invalid_argument" }`, as the platform does. Snapshots fire on a microtask after any change.
 */
import type { SCol, SDb, SDocRef, SDocSnap, SQuery } from "../state/share";
import { createRuleStore, DB_RULES, type Level, type Op, type Reply, type Rule, type Where } from "../../scripts/lib/dbRules";

type Store = ReturnType<typeof createRuleStore>;

export class RuleDb implements SDb {
  writes = 0;
  private constructor(readonly core: Store, private subs: Set<() => void>, readonly uid: string, readonly level: Level) {}
  static create(uid = "u_a", level: Level = "interact", rules: readonly Rule[] = DB_RULES): RuleDb { return new RuleDb(createRuleStore(rules), new Set(), uid, level); }
  /** The same store as another viewer. */
  as(uid: string, level: Level = "interact"): RuleDb { return new RuleDb(this.core, this.subs, uid, level); }
  get docs(): Map<string, Record<string, unknown>> { return this.core.docs; }
  /** Every path that exists (any viewer). */
  paths(prefix = ""): string[] { return [...this.core.docs.keys()].filter((p) => p.startsWith(prefix)).sort(); }
  private call(m: Op): Reply { return this.core.call({ uid: this.uid, level: this.level }, m); }
  private ping() { for (const s of [...this.subs]) s(); }
  private snap(path: string, r: Reply): SDocSnap {
    const d = "exists" in r && r.exists ? r.data : undefined;
    return { id: path.split("/").at(-1)!, exists: !!d, data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined) };
  }
  doc(path: string): SDocRef {
    if (path.split("/").length % 2 !== 0) throw new TypeError(`document path parity: ${path}`);
    const write = async (m: Op) => { const r = this.call(m); if ("error" in r) throw r.error; this.writes++; this.ping(); };
    return {
      get: async () => this.snap(path, this.call({ op: "get", path })),
      set: (data) => write({ op: "set", path, data }),
      delete: () => write({ op: "delete", path }),
      onSnapshot: (next, error) => {
        let last = "";
        const f = () => {
          const r = this.call({ op: "get", path });
          if ("error" in r) { error?.(r.error); return; }
          const s = this.snap(path, r);
          const k = JSON.stringify([s.exists, s.data()]);
          if (k !== last) { last = k; next(s); }
        };
        this.subs.add(f); queueMicrotask(f);
        return () => { this.subs.delete(f); };
      },
    };
  }
  private query(path: string, q: { order?: string; dir?: "asc" | "desc"; limit?: number; where: Where[] }): SQuery {
    const list = () => {
      const r = this.call({ op: "list", path, ...q });
      if ("error" in r) throw r.error;
      return "docs" in r ? r.docs.map((d) => this.snap(`${path}/${d.id}`, { exists: true, data: d.data })) : [];
    };
    return {
      where: (field, op, value) => this.query(path, { ...q, where: [...q.where, { field, op, value }] }),
      orderBy: (f, d = "asc") => this.query(path, { ...q, order: f, dir: d }),
      limit: (n) => this.query(path, { ...q, limit: n }),
      get: async () => ({ docs: list() }),
      onSnapshot: (next, error) => {
        let last = "";
        const f = () => {
          try {
            const docs = list();
            const k = JSON.stringify(docs.map((d) => [d.id, d.data()]));
            if (k !== last) { last = k; next({ docs }); }
          } catch (e) { error?.(e as { code: string }); }
        };
        this.subs.add(f); queueMicrotask(f);
        return () => { this.subs.delete(f); };
      },
    };
  }
  collection(path: string): SCol {
    if (path.split("/").length % 2 !== 1) throw new TypeError(`collection path parity: ${path}`);
    return { ...this.query(path, { where: [] }), doc: (id: string) => this.doc(`${path}/${id}`) };
  }
}

export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
