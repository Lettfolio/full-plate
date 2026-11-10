/**
 * Round 12 (G): a stand-in for the claude.ai artifact runtime (`window.claude.use("db" | "user")`) for Playwright, with
 * ONE in-memory db shared by every browser context that installs it — so two players (two contexts) can share, visit
 * and run a co-op day against a built dist, as they would inside one artifact.
 *
 *   import { createMockStore, installMockClaude } from "./lib/mockClaude.mjs";
 *   const store = createMockStore({ latencyMs: 40 });
 *   await installMockClaude(ctxA, store, { uid: "u_alice" });
 *   await installMockClaude(ctxB, store, { uid: "u_bob" });
 *
 * Mirrors the parts of db.d.ts the game uses: `doc(path)` / `collection(path)` with the even/odd path parity (a
 * TypeError otherwise), get / set / update / delete, ordered + limited queries, onSnapshot on documents and queries,
 * `data/users/<id>/` private per viewer (others' read as missing, writes reject `invalid_argument`), 256 KiB bodies.
 * Listing a collection returns its direct documents only, so `fp-share` (whose `fp-share/<CODE>` parents are never
 * written) lists nothing. Snapshots are delivered by polling the Node-side store every `pollMs` (db.d.ts allows a
 * periodic refresh), and each call waits `latencyMs` on the Node side, so the co-op round trip has a realistic floor.
 * `store.stats` counts calls; `store.docs` is the data.
 */

const MAX_DOC = 256 * 1024;

export function createMockStore({ latencyMs = 0 } = {}) {
  const docs = new Map();
  const stats = { get: 0, set: 0, update: 0, delete: 0, list: 0 };
  const priv = (path, uid) => { const m = /^data\/users\/([^/]+)\//.exec(path); return m && m[1] !== uid; };
  const fail = (code, message) => ({ error: { code, message } });
  async function call(uid, { op, path, data, order, dir, limit }) {
    if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
    switch (op) {
      case "get": stats.get++; return priv(path, uid) || !docs.has(path) ? { exists: false } : { exists: true, data: docs.get(path) };
      case "set":
      case "update": {
        stats[op]++;
        if (priv(path, uid)) return fail("invalid_argument", "not your subtree");
        if (!data || typeof data !== "object" || Array.isArray(data)) return fail("invalid_argument", "body must be an object");
        if (JSON.stringify(data).length > MAX_DOC) return fail("invalid_argument", "document over 256 KiB");
        if (op === "update" && !docs.has(path)) return fail("invalid_argument", "update needs the document to exist");
        docs.set(path, JSON.parse(JSON.stringify(op === "update" ? { ...docs.get(path), ...data } : data)));
        return { ok: true };
      }
      case "delete": stats.delete++; if (priv(path, uid)) return fail("invalid_argument", "not your subtree"); docs.delete(path); return { ok: true };
      case "list": {
        stats.list++;
        const depth = path.split("/").length + 1;
        let rows = [...docs.keys()].filter((p) => p.startsWith(path + "/") && p.split("/").length === depth && !priv(p, uid))
          .map((p) => ({ id: p.split("/").at(-1), data: docs.get(p) }));
        rows.sort((a, b) => (a.id < b.id ? -1 : 1));
        if (order) {
          const v = (r) => r.data[order];
          rows.sort((a, b) => { const x = v(a), y = v(b); if (x === y) return 0; if (x === undefined) return 1; if (y === undefined) return -1; return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1); });
        }
        if (limit) rows = rows.slice(0, limit);
        return { docs: rows };
      }
      default: return fail("invalid_argument", `unknown op ${op}`);
    }
  }
  return { docs, stats, call };
}

/** The page side: builds `window.claude` over the `__fpMockDb` binding. Serialised into the page (no closures). */
function pageScript({ uid, pollMs }) {
  const rpc = (msg) => window.__fpMockDb(msg).then((r) => { if (r && r.error) throw r.error; return r; });
  const segs = (p) => p.split("/").filter(Boolean).length;
  const freeze = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const docSnap = (path, r) => ({ id: path.split("/").at(-1), exists: !!r.exists, data: () => freeze(r.data), metadata: { fromCache: false, hasPendingWrites: false } });
  const poll = (read, next, error) => {
    let last = null, stopped = false;
    const run = async () => {
      if (stopped) return;
      try { const v = await read(); const k = JSON.stringify(v.key); if (k !== last) { last = k; next(v.snap); } }
      catch (e) { stopped = true; error && error(e); return; }
      if (!stopped) setTimeout(run, pollMs);
    };
    setTimeout(run, 0);
    return () => { stopped = true; };
  };
  function query(path, order, dir, limit) {
    const get = async () => {
      const r = await rpc({ op: "list", path, order, dir, limit });
      const docsOut = r.docs.map((d) => docSnap(`${path}/${d.id}`, { exists: true, data: d.data }));
      return { docs: docsOut, size: docsOut.length, empty: !docsOut.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
    };
    return {
      orderBy: (f, d = "asc") => query(path, f, d, limit),
      limit: (n) => query(path, order, dir, n),
      where: () => { throw new TypeError("mockClaude: where() is not mocked"); },
      get,
      onSnapshot: (next, error) => poll(async () => { const s = await get(); return { key: s.docs.map((d) => [d.id, d.data()]), snap: s }; }, next, error),
    };
  }
  function collection(path) {
    if (segs(path) % 2 !== 1) throw new TypeError(`collection path needs an odd number of segments: ${path}`);
    return { ...query(path), path, doc: (id) => doc(`${path}/${id ?? Math.random().toString(36).slice(2, 12)}`), add: async (data) => { const d = doc(`${path}/${Math.random().toString(36).slice(2, 12)}`); await d.set(data); return d; } };
  }
  function doc(path) {
    if (segs(path) % 2 !== 0) throw new TypeError(`document path needs an even number of segments: ${path}`);
    const get = async () => docSnap(path, await rpc({ op: "get", path }));
    return {
      id: path.split("/").at(-1), path, get,
      set: async (data) => { await rpc({ op: "set", path, data }); },
      update: async (data) => { await rpc({ op: "update", path, data }); },
      delete: async () => { await rpc({ op: "delete", path }); },
      acquire: async () => ({ acquired: true }),
      onSnapshot: (next, error) => poll(async () => { const s = await get(); return { key: [s.exists, s.data()], snap: s }; }, next, error),
      collection: (sub) => collection(`${path}/${sub}`),
    };
  }
  const db = Object.freeze({ doc, collection });
  const user = Object.freeze({
    id: async () => uid, me: async () => ({ id: uid }), isOwner: () => uid === "u_owner", canEdit: () => true, can: () => true, profiles: async () => ({}),
  });
  window.claude = Object.freeze({ use: async (name) => { await new Promise((r) => setTimeout(r, 5)); return name === "db" ? db : name === "user" ? user : null; } });
}

/** Give a browser context the mock runtime as viewer `uid`. */
export async function installMockClaude(context, store, { uid, pollMs = 120 } = {}) {
  await context.exposeBinding("__fpMockDb", (_src, msg) => store.call(uid, msg));
  await context.addInitScript(pageScript, { uid, pollMs });
}
