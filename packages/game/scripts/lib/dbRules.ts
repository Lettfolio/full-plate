/**
 * Round 14 (B): the `db` access rules the game's artifact is published with, and an in-memory store that ENFORCES them
 * the way db.d.ts (contract 0.2.96) describes — for the Playwright mock (mockClaude.mjs imports this file; Node strips
 * the types) and for the vitest stores (src/__tests__/ruleDb.ts). Nothing in the app imports it.
 *
 * Levels, lowest first: view < interact < admin < owner; `self` is a level nobody holds (it only appears on the prefix
 * rule of a `{self}` rule). A rule applies to its path and everything below; a deeper rule overrides a shallower one
 * for the levels it sets; the root defaults to read "view", write "interact". A path `X/{self}` names each viewer's own
 * subtree `X/<their id>`: on someone else's subtree only the rule at `X` applies (with none, it is private), on their
 * own whichever of the two gives them more. `data/users/{self}` is always there (declared or not). A read below the
 * level sees a missing document; a write rejects `invalid_argument`.
 */

export type Level = "view" | "interact" | "admin" | "owner";
export type RuleLevel = Level | "self";
export interface Rule { path: string; read?: RuleLevel; write?: RuleLevel }

/**
 * THE declaration (docs/COOP-NOTES.md "Round 14 — B" quotes it; a test checks the two match). Everything the game
 * shares lives under three per-player prefixes, each written only by the player whose id is the second segment:
 *   fps/<uid>                      the player's "I share" marker; fps/<uid>/s<hash(code)>/snap one snapshot per share
 *   fpr/<uid>                      the player's own reviews of other people's shares (one entry per share)
 *   fpc/<uid>                      the player's co-op marker; fpc/<uid>/c<hash(code)>/host | guest one side of a session
 * The root is raised to admin so a Contributor cannot fill the database with documents anywhere else.
 */
export const DB_RULES: Rule[] = [
  { path: "", read: "view", write: "admin" },
  { path: "data/users/{self}", write: "interact" },
  { path: "fps", read: "view", write: "self" },
  { path: "fps/{self}", read: "view", write: "interact" },
  { path: "fpr", read: "view", write: "self" },
  { path: "fpr/{self}", read: "view", write: "interact" },
  { path: "fpc", read: "view", write: "self" },
  { path: "fpc/{self}", read: "view", write: "interact" },
];

/** The whole `capabilities` object the publisher passes (room topics as Round 13 declared them). */
export const CAPABILITIES = {
  db: { rules: DB_RULES },
  user: {},
  downloads: {},
  room: { topics: { "fp-in": "interact", "fp-st": "interact", "fp-emo": "interact" } },
};

const RANK: Record<Level, number> = { view: 0, interact: 1, admin: 2, owner: 3 };
const LEVELS: readonly string[] = ["view", "interact", "admin", "owner", "self"];
const rank = (l: RuleLevel): number => (l === "self" ? 4 : RANK[l]);
const SEG = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const segsOf = (p: string): string[] => (p === "" ? [] : p.split("/"));

/** What the platform would reject at publish (db.d.ts's rules on declarations). [] = fine. */
export function checkRules(rules: readonly Rule[]): string[] {
  const out: string[] = [];
  if (rules.length > 64) out.push("more than 64 rules");
  const selfPrefixes = new Set(rules.filter((r) => r.path.endsWith("/{self}")).map((r) => r.path.slice(0, -"/{self}".length)));
  for (const r of rules) {
    const s = segsOf(r.path);
    if (s.some((x, i) => (x === "{self}" ? i !== s.length - 1 : !SEG.test(x) || x === "." || x === ".."))) out.push(`${r.path}: bad path`);
    for (const l of [r.read, r.write]) if (l !== undefined && !LEVELS.includes(l)) out.push(`${r.path}: unknown level ${l}`);
    if (r.read && r.write && rank(r.write) < rank(r.read)) out.push(`${r.path}: write below read`);
    if (r.read === "self" && r.write !== "self") out.push(`${r.path}: read "self" needs write "self"`);
    const usesSelf = r.read === "self" || r.write === "self";
    if (usesSelf && !selfPrefixes.has(r.path)) out.push(`${r.path}: "self" only on the prefix of a {self} rule`);
    if (selfPrefixes.has(r.path) && (!r.read || !r.write)) out.push(`${r.path}: a {self} prefix rule must set read and write`);
  }
  return out;
}

/** The minimum level `uid` needs to read / write `path` under `rules` ("self" = nobody may). */
export function required(rules: readonly Rule[], path: string, uid: string | null): { read: RuleLevel; write: RuleLevel } {
  const s = segsOf(path);
  const all = rules.some((r) => r.path === "data/users/{self}") ? rules : [...rules, { path: "data/users/{self}" }];
  const plain = all.filter((r) => !r.path.endsWith("/{self}")).map((r) => ({ r, s: segsOf(r.path) })).filter((x) => x.s.length <= s.length && x.s.every((v, i) => v === s[i]));
  plain.sort((a, b) => a.s.length - b.s.length);
  let cur: { read: RuleLevel; write: RuleLevel } = { read: "view", write: "interact" };
  const at = new Map<number, { read: RuleLevel; write: RuleLevel }>(); // levels in force at each depth (for {self} prefixes)
  const selfRules = all.filter((r) => r.path.endsWith("/{self}")).map((r) => ({ r, pre: segsOf(r.path.slice(0, -"/{self}".length)) }))
    .filter((x) => x.pre.length < s.length && x.pre.every((v, i) => v === s[i]));
  for (let d = 0; d <= s.length; d++) {
    for (const x of plain) if (x.s.length === d) cur = { read: x.r.read ?? cur.read, write: x.r.write ?? cur.write };
    at.set(d, cur);
    for (const x of selfRules) {
      if (x.pre.length !== d) continue;
      const hasPrefixRule = all.some((r) => r.path === x.pre.join("/"));
      if (s[d] === uid) {
        const mine = { read: x.r.read ?? cur.read, write: x.r.write ?? cur.write };
        const pre = hasPrefixRule ? cur : { read: "self" as RuleLevel, write: "self" as RuleLevel };
        cur = { read: rank(mine.read) <= rank(pre.read) ? mine.read : pre.read, write: rank(mine.write) <= rank(pre.write) ? mine.write : pre.write };
      } else if (!hasPrefixRule) cur = { read: "self", write: "self" };
    }
  }
  return cur;
}

/** May a viewer at `level` meet `need`? */
export const meets = (level: Level, need: RuleLevel): boolean => need !== "self" && RANK[level] >= RANK[need];

// ── the store ──
export type Body = Record<string, unknown>;
export type WhereOp = "==" | "!=" | "<" | "<=" | ">" | ">=" | "in" | "not-in" | "array-contains";
export interface Where { field: string; op: WhereOp; value: unknown }
export type Op =
  | { op: "get"; path: string }
  | { op: "set" | "update"; path: string; data: unknown }
  | { op: "delete"; path: string }
  | { op: "list"; path: string; order?: string; dir?: "asc" | "desc"; limit?: number; where?: Where[] };
export type Reply = { exists: boolean; data?: Body } | { ok: true } | { docs: { id: string; data: Body }[] } | { error: { code: string; message: string } };
export interface Who { uid: string | null; level: Level }

const MAX_DOC = 256 * 1024;
const fail = (code: string, message: string): Reply => ({ error: { code, message } });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function cmp(x: unknown, y: unknown): number { return x === y ? 0 : (x as number) < (y as number) ? -1 : 1; }
function test(d: Body, w: Where): boolean {
  const v = d[w.field];
  switch (w.op) {
    case "==": return JSON.stringify(v) === JSON.stringify(w.value);
    case "!=": return v !== undefined && JSON.stringify(v) !== JSON.stringify(w.value);
    case "<": return v !== undefined && cmp(v, w.value) < 0;
    case "<=": return v !== undefined && cmp(v, w.value) <= 0;
    case ">": return v !== undefined && cmp(v, w.value) > 0;
    case ">=": return v !== undefined && cmp(v, w.value) >= 0;
    case "in": return Array.isArray(w.value) && w.value.some((x) => JSON.stringify(x) === JSON.stringify(v));
    case "not-in": return v !== undefined && Array.isArray(w.value) && !w.value.some((x) => JSON.stringify(x) === JSON.stringify(v));
    case "array-contains": return Array.isArray(v) && v.some((x) => JSON.stringify(x) === JSON.stringify(w.value));
    default: return false;
  }
}
function checkPath(path: string, parity: 0 | 1): string | null {
  const s = segsOf(path);
  if (!s.length || s.length > 16 || path.length > 1000) return "path length";
  if (s.length % 2 !== parity) return parity === 0 ? "a document path needs an even number of segments" : "a collection path needs an odd number of segments";
  return s.every((x) => SEG.test(x) && x !== "." && x !== "..") ? null : "path grammar";
}

/** One db with rules: `call(who, op)` answers as the platform would for that viewer. `stats.refused` counts refusals. */
export function createRuleStore(rules: readonly Rule[] = DB_RULES) {
  const docs = new Map<string, Body>();
  const stats = { get: 0, set: 0, update: 0, delete: 0, list: 0, refused: 0 };
  const canRead = (w: Who, p: string) => meets(w.level, required(rules, p, w.uid).read);
  const canWrite = (w: Who, p: string) => meets(w.level, required(rules, p, w.uid).write);
  function call(who: Who, m: Op): Reply {
    switch (m.op) {
      case "get": {
        stats.get++;
        const bad = checkPath(m.path, 0);
        if (bad) return fail("invalid_argument", bad);
        return canRead(who, m.path) && docs.has(m.path) ? { exists: true, data: clone(docs.get(m.path)!) } : { exists: false };
      }
      case "set": case "update": case "delete": {
        stats[m.op]++;
        const bad = checkPath(m.path, 0);
        if (bad) return fail("invalid_argument", bad);
        if (!canWrite(who, m.path)) { stats.refused++; return fail("invalid_argument", "below the write level for this path"); }
        if (m.op === "delete") { docs.delete(m.path); return { ok: true }; }
        const data = m.data;
        if (!data || typeof data !== "object" || Array.isArray(data)) return fail("invalid_argument", "body must be an object");
        if (JSON.stringify(data).length > MAX_DOC) return fail("invalid_argument", "document over 256 KiB");
        if (m.op === "update" && !docs.has(m.path)) return fail("invalid_argument", "update needs the document to exist");
        docs.set(m.path, clone(m.op === "update" ? { ...docs.get(m.path), ...(data as Body) } : (data as Body)));
        return { ok: true };
      }
      case "list": {
        stats.list++;
        const bad = checkPath(m.path, 1);
        if (bad) return fail("invalid_argument", bad);
        if ((m.where?.length ?? 0) > 10) return fail("invalid_argument", "too many filters");
        if (m.limit !== undefined && !(m.limit >= 1 && m.limit <= 1000)) return fail("invalid_argument", "limit 1-1000");
        const depth = segsOf(m.path).length + 1;
        let rows = [...docs.keys()].filter((p) => p.startsWith(m.path + "/") && segsOf(p).length === depth && canRead(who, p))
          .map((p) => ({ id: p.split("/").at(-1)!, data: clone(docs.get(p)!) }))
          .filter((r) => (m.where ?? []).every((w) => test(r.data, w)));
        rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        if (m.order) {
          const f = m.order;
          rows.sort((a, b) => { const x = a.data[f], y = b.data[f]; if (x === y) return 0; if (x === undefined) return 1; if (y === undefined) return -1; return cmp(x, y) * (m.dir === "desc" ? -1 : 1); });
        }
        if (m.limit) rows = rows.slice(0, m.limit);
        return { docs: rows };
      }
      default: return fail("invalid_argument", "unknown op");
    }
  }
  return { docs, stats, rules, call, canRead, canWrite };
}
export type RuleStore = ReturnType<typeof createRuleStore>;
