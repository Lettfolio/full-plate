# Full Plate — saves (round 9)

The owner's ask: "I need to be able to save games so it doesn't have to start new each time." Up to round 8 the game
autosaved one owner game and one career game to `localStorage`. Inside the Claude app the game runs in a sandboxed
iframe where `localStorage` is often blocked (the save silently failed) or cleared between visits, and it never
followed the player to another device. Round 9 keeps the same autosave cadence but writes to **save slots** in three
layers behind one store.

## Layers

| Layer | Where | When it works | Notes |
| --- | --- | --- | --- |
| 1. Account | the artifact runtime's `db` capability, the viewer's private `data/users/<id>/` collection | inside claude.ai, signed in, page served with `capabilities: {db: {}, user: {}}`, viewer at Contributor or above | gzip + base64, chunked, header last. Follows the player to any device. |
| 2. Device cache | `localStorage` | wherever storage is allowed | the same packed blob, unchunked; a reload while offline still continues |
| 3. Save file | a download / a file input | everywhere | `fullplate-<name>-day<N>.fpsave.json`; also moves a game between accounts by hand |

With none of them (storage blocked, no account) the store keeps the slots in memory for the visit, and every place
that talks about saving says **Not saved** (the header mark, the title's note, Save & quit), with Save to a file one tap away.

## Code map (packages/game/src/state)

| File | Chunk | What |
| --- | --- | --- |
| `saveStore.ts` | main | Types, constants, legacy migration, and `getSaveStore()`: a facade that lists slots from the local index at first paint while the real store loads (as a chunk, at once); every call waits for it. |
| `saveCore.ts` | lazy (loaded at start) | `createSaveStore(deps)`: slots, device copy, memory fallback, autosave, flush, load, status. A closure, so the minifier shortens its names. |
| `saveCloud.ts` | lazy (on `connect()`) | The account: connect, reconcile, push (chunked), fetch, the conflict rule, backups, prefs, live header updates. |
| `saveCodec.ts` | lazy (first save) | gzip (`CompressionStream`) / base64 packing. |
| `saveFiles.ts` | lazy (on use) | Rename, delete, save files (export / import / offer via the `downloads` capability or `<a download>`). |
| `useSaves.ts` | main | `useSaves()` (slots + status via `useSyncExternalStore`), `useSlotAutosave()`, the header mark's state. |
| `save.ts` | main | Unchanged envelope (`encodeSave` / `decodeSave`); `decodeSave` also reads an uncompressed save file. |

Settings and the hands-on onboarding flags ride along (`lib/prefsSync.ts`, `lib/onboardFlags.ts`): localStorage stays
their cache; the account holds one `prefs` document.

`deps` make every layer swappable for tests: `storage` (`null` = none), `cloud` (a function resolving `{db, uid}` or
`{off: reason}`), `now`, `debounceMs`, `compress`, `newId`, `retryMs`.

## Account document layout

All paths are inside the viewer's own collection `data/users/<uid>` (`uid` = `await (await claude.use("user")).id()`).
`data/users/<uid>` has 3 segments, so it is a collection; everything below keeps the db's even/odd path parity.

```
data/users/<uid>/save-<slotId>                      header  (one per slot)
data/users/<uid>/save-<slotId>/chunks/<bank>-<n>    chunk   { slotId, bank: "a"|"b", n, data }  (data ≤ 180,000 chars)
data/users/<uid>/prefs                              { kind: "prefs", settings: {…4 settings}, onboard: string[] }
```

Header (`CloudHeader`): `{ kind: "save", slotId, name, mode, restaurantName, day, cash, path (owner|career|empire|stars),
difficulty, updatedAt, chunkCount, encoding ("gzip-b64"|"b64"), bytes (raw envelope length), packedLength, hash
(FNV-1a of the raw envelope), bank, appVersion }`. `updatedAt` is wall-clock UI metadata ("played 2 days ago") and the
conflict tiebreak — it never reaches the sim.

No access rules beyond the defaults are needed: `data/users/{self}` is private to each viewer (even from the artifact's
owner). Its default write level is `interact`, so a player must open the artifact as its owner or be shared it as
**Contributor** or above; a Viewer/Commenter's first write is refused and the store falls back to the device (the mark
says "This device only"). The publisher declares `capabilities: {db: {}, user: {}, downloads: {}}` (`downloads` for
Save to a file inside claude.ai; without it the `<a download>` fallback is used).

### Writing (push)

1. Pack: `CompressionStream("gzip")` → base64 (fallback: base64 of the UTF-8). A year-4 Empire save (299 kB of JSON) packs
   to 54 kB; the biggest save in the R6–R7 corpus (602 kB) to an 85 kB document — one chunk each. A chunk holds
   ≤ 180,000 characters, so a document stays well under the 256 KiB cap however big the game grows.
2. Write the chunks of the **other bank** (`b-0…` if the header says `a`), one at a time.
3. Write the header last. Until it lands, the old header still points at the old, complete bank — a half-written save
   is never listed, and a crash leaves at most one bank of orphans, overwritten by the next push.
4. Delete the old bank's chunks.

Cloud writes are trailing-debounced (3 s after the last autosave) and skipped when the packed save's hash and name match
the header. Local writes are not debounced. Writes to one slot are serialised (one write at a time per document).

### Reading (load)

Header (always fetched fresh) → if its hash equals the device copy, play the device copy; else fetch `chunkCount` chunks
of its bank, join, check `packedLength`, unpack, check the hash (a mismatch = overwritten mid-read: try once more).

### Deleting

Header first (so it stops listing), then the chunks of both banks.

### Failures

`unavailable` → one retry after 0.4–1.2 s; still failing → the slot is *stalled* (the mark says "This device only") and
goes up with the next save. `invalid_argument`, `revoked`, `not_granted`, `capability_*`, `transform_error` → the account
is off for this visit (no retry loops); `quota_exceeded` → off with "no room for more saves". A refused first read (the
consent prompt declined) → off, reason `refused`. `user.id()` null → off, reason `signed-out` ("sign in to keep it
everywhere").

## When the account is reached

`connect()` runs after the title screen has painted (App: `requestAnimationFrame` → `setTimeout`), because the first db
call may show a consent prompt. Outside claude.ai (`window.claude` undefined) it doesn't even load the cloud chunk.
Continue waits for a slow account for at most 4 s, then plays the device copy (a later push settles any difference).

## The conflict rule

Each slot remembers the hash both sides last agreed on (`syncedHash`, kept in the local index).

| Device copy | Account copy | On Continue |
| --- | --- | --- |
| same game | same game | device copy |
| unchanged since agreed | changed | account copy (played on another device); the device cache is refreshed |
| changed | unchanged since agreed | device copy (played offline); pushed at once |
| changed | changed | ask: "Which one shall we play?" (newer pre-selected); **the other is kept** as "Backup of <name>" |
| only one exists | | that one |

A backup takes a free slot, or a seventh one when all six are full: a save is never lost silently. The same rule guards
pushes: if the header a push is about to overwrite moved on since the two last agreed (another device played while
this one was offline and the player kept going here), the account's copy is first kept as a backup.

On connect the store reconciles: device-only slots and offline progress are pushed; a slot that was synced, is
unchanged here and has gone from the account was deleted on another device, so it goes here too. Live header updates
(`onSnapshot` on the collection) keep the picker and the push guard current.

## Slots and migration

Up to 6 slots, named by default after the restaurant (a career: "<player>'s career"); renamed in Your games. The local
index (`full-plate:slots:v1`) holds each slot's summary, hash and `syncedHash`; each slot's packed blob is
`full-plate:slot:v1:<slotId>` = `<encoding>:<data>`.

First load with no index: the round 1–8 saves (`full-plate:save:v1` owner, `full-plate:career:v1` career) are imported
as slots 1 and 2 (owner most recent, so Continue plays it), unless the owner run had ended. The old keys are left
untouched; `full-plate:slots-migrated:v1` stops a second import. Unreadable legacy saves are skipped.

## Save files

```json
{ "magic": "full-plate-save-file", "v": 1, "name": "…", "restaurantName": "…", "day": 20, "path": "owner",
  "savedAt": "…", "encoding": "gzip-b64", "data": "<base64>" }
```

`encoding: "json"` (the envelope as a string) where the browser has no CompressionStream. Load a save file accepts this,
an old raw envelope (what localStorage held before round 9 — e.g. the reviewers' corpus) or a bare round 1–2 GameState.
The extension is `.fpsave.json` because the `downloads` capability only allows listed extensions (`.fpsave` is not
one). Inside claude.ai the viewer confirms the download; elsewhere it is an `<a download>` link.

## Testing without claude.ai

- **Unit (vitest, jsdom):** `round9.saves.test.tsx` builds stores with `createSaveStore({ storage: FakeStorage, cloud: async
  () => ({ db: FakeDb, uid }) })`. `FakeDb` implements the subset used (collection / doc / get / set / update / delete /
  onSnapshot) with the db's path parity and 256 KiB cap and logs writes in order. Two stores on one `FakeDb` are two
  devices. Node has CompressionStream, so the gzip path runs too (`it.runIf(hasCompression())`).
- **Browser (Playwright on the built dist):** `scratchpad/r9/play.mjs` injects a fake `window.claude` (only `use`,
  resolving after 80 ms) via `addInitScript`; its db/user/downloads call into Node through `exposeFunction`, so the
  account survives reloads and is shared across browser contexts ("devices"). Toggle `served` (use() → null), `uid`
  (null = signed out) or `up` (every call `unavailable`). Run it with no init script for "outside claude.ai", and with
  an init script that makes `window.localStorage` throw for "storage blocked".
- **Type audit:** `node packages/game/scripts/type-audit.mjs` covers Your games, rename, delete, New game's slot choice and
  the save mark sheet.
