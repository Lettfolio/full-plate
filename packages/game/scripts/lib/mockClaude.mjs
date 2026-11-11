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
 *
 * Round 13 (F): `room` too (room.d.ts) — the lobby's stubs and named rooms with emit / on / presence / peers / onPeers /
 * connected / onConnection / leave, platform stamps (`peer` per page load, `by` = the viewer's uid, isMe / sameTab /
 * kind), topic send rights (a topic not opened in `topics` is admin-only; `levels[uid]` is "view" | "interact" |
 * "admin", default "interact"), the 4 KiB data limit, and a network you can tune while it runs: `room.opts.latencyMs`
 * (one way), `jitterMs` (random extra per message, so messages REORDER), `loss` (0..1, per message per recipient;
 * your own echo is never lost). Presence is coalesced and delayed but never lost (the platform re-asserts it).
 *   const room = createMockRoom({ latencyMs: 150, jitterMs: 60, loss: 0.2, topics: { "fp-in": "interact" } });
 *   await installMockClaude(ctx, store, { uid: "u_alice", room });     // room: false → claude.use("room") is null
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

/** Round 13 (F): one room service shared by every context that installs it. */
export function createMockRoom({ latencyMs = 0, jitterMs = 0, loss = 0, topics = {}, levels = {}, seed = 1 } = {}) {
  const opts = { latencyMs, jitterMs, loss };
  const members = new Map(); // peer -> { uid, frame, rooms: Map<room, presence> }
  const stats = { emits: 0, delivered: 0, dropped: 0, refused: 0, presence: 0, bytes: 0, topics: {} };
  let n = 0;
  let s = seed >>> 0;
  const rand = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const push = (peer, payload) => { const m = members.get(peer); if (m) m.frame.evaluate((x) => window.__fpRoomIn && window.__fpRoomIn(x), payload).catch(() => {}); };
  const later = (fn) => { const d = opts.latencyMs + rand() * opts.jitterMs; if (d <= 0) fn(); else setTimeout(fn, d); };
  const peersOf = (room) => [...members].filter(([, m]) => m.rooms.has(room)).map(([peer, m]) => ({ peer, by: m.uid, presence: m.rooms.get(room) }));
  const tellPeers = (room, except = null) => { const list = peersOf(room); for (const p of list) { if (p.peer === except) continue; later(() => push(p.peer, { kind: "peers", room, peers: peersOf(room) })); } };
  const level = (uid) => levels[uid] ?? "interact";
  const may = (uid, topic) => { const need = topics[topic] ?? "admin"; const have = level(uid); return have === "admin" || (need === "interact" && have === "interact"); };
  async function call(uid, src, msg) {
    switch (msg.op) {
      case "hello": { const peer = `p${(++n).toString(36)}${Math.floor(rand() * 1e9).toString(36)}`; members.set(peer, { uid, frame: src.frame, rooms: new Map() }); return { peer }; }
      case "join": { const m = members.get(msg.peer); if (!m) return { error: { code: "upstream_error", message: "no such page" } }; if (!m.rooms.has(msg.room)) m.rooms.set(msg.room, {}); push(msg.peer, { kind: "peers", room: msg.room, peers: peersOf(msg.room) }); tellPeers(msg.room, msg.peer); return { ok: true }; }
      case "leave": { const m = members.get(msg.peer); if (m && m.rooms.delete(msg.room)) tellPeers(msg.room); return { ok: true }; }
      case "emit": {
        const m = members.get(msg.peer);
        if (!m || !m.rooms.has(msg.room)) return { error: { code: "invalid_argument", message: "not in that room" } };
        if (!may(uid, msg.topic)) { stats.refused++; return { error: { code: "not_permitted", message: `may not send on ${msg.topic}` } }; }
        const size = Buffer.byteLength(JSON.stringify(msg.data ?? null));
        if (size > 4096) return { error: { code: "invalid_argument", message: "data over 4 KiB" } };
        stats.emits++; stats.bytes += size; stats.topics[msg.topic] = (stats.topics[msg.topic] ?? 0) + 1;
        for (const [peer, o] of members) {
          if (!o.rooms.has(msg.room)) continue;
          const out = { kind: "msg", room: msg.room, msg: { peer: msg.peer, by: uid, kind: "viewer", guest: false, topic: msg.topic, data: msg.data } };
          if (peer === msg.peer) { push(peer, out); continue; }
          if (rand() < opts.loss) { stats.dropped++; continue; }
          stats.delivered++;
          later(() => push(peer, out));
        }
        return { ok: true };
      }
      case "presence": {
        const m = members.get(msg.peer);
        if (!m || !m.rooms.has(msg.room)) return { error: { code: "invalid_argument", message: "not in that room" } };
        const cur = { ...m.rooms.get(msg.room) };
        for (const [k, v] of Object.entries(msg.patch)) { if (v === null) delete cur[k]; else cur[k] = v; }
        if (Buffer.byteLength(JSON.stringify(cur)) > 4096) return { error: { code: "invalid_argument", message: "presence over 4 KiB" } };
        m.rooms.set(msg.room, cur);
        stats.presence++;
        push(msg.peer, { kind: "peers", room: msg.room, peers: peersOf(msg.room) });
        tellPeers(msg.room, msg.peer);
        return { ok: true };
      }
      case "bye": { const m = members.get(msg.peer); if (m) { members.delete(msg.peer); for (const r of m.rooms.keys()) tellPeers(r); } return { ok: true }; }
      default: return { error: { code: "invalid_argument", message: `unknown op ${msg.op}` } };
    }
  }
  return { opts, stats, call, members };
}

/** The page side of the room: serialised into the page with the db's script. */
function roomPage() {
  const rpc = (msg) => window.__fpMockRoom(msg).then((r) => { if (r && r.error) throw r.error; return r; });
  let me = null;
  const hello = rpc({ op: "hello" }).then((r) => { me = r.peer; return r.peer; });
  addEventListener("pagehide", () => { if (me) rpc({ op: "bye", peer: me }).catch(() => {}); });
  const rooms = new Map();
  const TOPIC = /^[a-z][a-z0-9_.-]{0,47}$/;
  const NAME = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
  const freeze = (o) => Object.freeze(o);
  window.__fpRoomIn = (x) => {
    const r = rooms.get(x.room);
    if (!r) return;
    if (x.kind === "msg") {
      const m = freeze({ ...x.msg, isMe: x.msg.peer === me, sameTab: x.msg.peer === me, data: x.msg.data === undefined ? undefined : JSON.parse(JSON.stringify(x.msg.data)) });
      for (const h of [...(r.handlers.get(m.topic) ?? [])]) { try { h(m); } catch (e) { setTimeout(() => { throw e; }); } }
    } else if (x.kind === "peers") {
      const old = new Map(r.peers.map((p) => [p.peer, p]));
      const now = Date.now();
      const next = x.peers.map((p) => { const o = old.get(p.peer); const same = o && JSON.stringify(o.presence) === JSON.stringify(p.presence); return same ? o : freeze({ peer: p.peer, by: p.by, isMe: p.peer === me, sameTab: p.peer === me, kind: "viewer", guest: false, presence: freeze({ ...p.presence }), updatedAt: now }); });
      const ids = new Set(next.map((p) => p.peer));
      const change = { peers: freeze(next), joined: next.filter((p) => !old.has(p.peer)), left: r.peers.filter((p) => !ids.has(p.peer)), updated: next.filter((p) => old.has(p.peer) && old.get(p.peer) !== p) };
      r.peers = change.peers;
      for (const h of [...r.peerHandlers]) queueMicrotask(() => h(change));
    }
  };
  function named(name) {
    const r = { handlers: new Map(), peerHandlers: new Set(), peers: freeze([]), left: false };
    rooms.set(name, r);
    const guard = () => { if (r.left) throw { code: "invalid_argument", message: "left that room" }; };
    return freeze({
      name,
      emit: async (topic, data) => { guard(); if (!TOPIC.test(topic)) throw { code: "invalid_argument", message: "topic grammar" }; await rpc({ op: "emit", peer: me, room: name, topic, data }); },
      on: (topic, handler) => { let set = r.handlers.get(topic); if (!set) r.handlers.set(topic, (set = new Set())); const h = (m) => handler(m); set.add(h); return () => set.delete(h); },
      presence: async (patch) => { guard(); await rpc({ op: "presence", peer: me, room: name, patch }); },
      peers: () => r.peers,
      onPeers: (handler) => { const h = (c) => handler(c); r.peerHandlers.add(h); queueMicrotask(() => r.peerHandlers.has(h) && handler({ peers: r.peers, joined: r.peers, left: [], updated: [] })); return () => r.peerHandlers.delete(h); },
      connected: () => !r.left,
      onConnection: (handler) => { queueMicrotask(() => handler(!r.left)); return () => {}; },
      leave: async () => { if (r.left) return; r.left = true; rooms.delete(name); await rpc({ op: "leave", peer: me, room: name }).catch(() => {}); },
    });
  }
  const live = new Map();
  window.__fpMockRoomNs = freeze({
    join: async (name) => { if (!NAME.test(name)) throw { code: "invalid_argument", message: "room name grammar" }; await hello; if (live.has(name) && rooms.has(name)) return live.get(name); const nr = named(name); live.set(name, nr); await rpc({ op: "join", peer: me, room: name }); return nr; },
    emit: async () => {}, on: () => () => {}, presence: async () => {}, peers: () => [], onPeers: () => () => {}, connected: () => true, onConnection: () => () => {},
    canSendToClaudeSession: async () => "off",
  });
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
  const room = window.__fpMockRoomNs ?? null;
  window.claude = Object.freeze({ use: async (name) => { await new Promise((r) => setTimeout(r, 5)); return name === "db" ? db : name === "user" ? user : name === "room" ? room : null; } });
}

/** Give a browser context the mock runtime as viewer `uid` (with `room`, a createMockRoom(), the room capability). */
export async function installMockClaude(context, store, { uid, pollMs = 120, room = null } = {}) {
  await context.exposeBinding("__fpMockDb", (_src, msg) => store.call(uid, msg));
  if (room) { await context.exposeBinding("__fpMockRoom", (src, msg) => room.call(uid, src, msg)); await context.addInitScript(roomPage); }
  await context.addInitScript(pageScript, { uid, pollMs });
}
