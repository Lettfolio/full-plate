# Full Plate — saves (round 9; hardened in round 11)

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
| `saveCheck.ts` | lazy (`saveCheck` chunk, with saveCore) | Round 11: `validateLoaded` / `checkedDecode` (every save type's schema), the account header's schema `checkHeader`. |

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
(FNV-1a of the raw envelope), bank, appVersion, hw?, backupOf? }` (round 11: `hw` = the chunk high-water mark when it
is above `chunkCount`; `backupOf` = the slot a "Backup of …" backs up). `updatedAt` is wall-clock UI metadata ("played 2 days ago") and the
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

Header (always fetched fresh, schema-checked) → if its hash equals the device copy, play the device copy; else fetch
`chunkCount` chunks of its bank two at a time, join, check `packedLength`, unpack, check the hash (a mismatch =
overwritten mid-read: try once more), then `checkedDecode`.

### Deleting

Header first (so it stops listing), then the chunks of both banks.

### Failures

`unavailable` → one retry after 0.4–1.2 s; still failing → the slot is *stalled* (the mark says "This device only") and
goes up with the next save. Round 11: `invalid_argument` on a slot's write (and a game packing to more than `MAX_PACKED`)
*blocks that slot only*: its card says "Can't go to your account (too big), kept on this device", its mark explains,
and it is not retried until the game changes — every other slot keeps syncing. `revoked`, `not_granted`, `capability_*`,
`transform_error` → the account is off for this visit (no retry loops); `quota_exceeded` → off with "no room for more
saves". A header write that failed (it may have landed) makes the next push re-read the header before it picks a bank. A refused first read (the
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

## Round 11 — A: loading, saving and account hygiene (red-team S1–S6, S10–S12, G9–G14)

**One schema per save type.** `@full-plate/sim-core/schema` is a ~100-line checker (`obj`, `arr`, `rec`, `num`, `int`,
`str`, `name`, `oneOf`, `opt`, `json`); each package exports its state's schema from a `./validate` subpath
(`validateGameState`, `validateEmpireState`, `validateStarsState`, `validateCareerState`), and `state/saveCheck.ts` adds
the envelope's PathMeta (parked Empire sites are checked as GameStates). Every field is type-checked; numbers must be
finite and in range (money ±£100bn, 0–100 stats, days ≤ 1e6); lists are capped (staff ≤ `MAX_STAFF`, history ≤
`HISTORY_MAX` = 400, log ≤ 5 × `LOG_MAX`, …); enums are checked; names lose bidi / zero-width / control characters and are
cut to 40 (Empire site/brand names 80); other strings are refused past their cap (ids 80, text 4,000); unknown top-level
keys are dropped and unknown nested keys are kept only as sanitised JSON; `__proto__` keys are dropped. Key order is
kept, so a real save comes back byte-identical. A failing save is refused with "That save file is damaged."

Applied at: save-file import (`decodeSaveFile`), the account copy and the device cache (`load`), backups, and parked
sites. `pickSummary` / the index reader coerce every summary field (an object name becomes text before any screen sees
it); `takeDocs` drops headers that fail `checkHeader` (and such a slot's device copy is pushed back over it rather than
being taken for "deleted elsewhere"). **Import re-serialises**: the slot keeps `encodeSave(loaded)`, never the file text.

**Size caps.** Files over 5 MB are refused before they are read (the picker checks `File.size`); base64 is length-checked
before `atob`; the gzip pipe stops at 8 MiB (`MAX_UNPACKED`, the stream is cancelled) — the device's and account's own
copies may inflate to 96 MiB (old Empire saves with many parked sites); a slot packs to at most `MAX_PACKED` (1,000,000
characters ≈ 6 chunks) on the account; a header's `chunkCount` must equal ⌈packedLength / 180,000⌉ and be ≤ 8.

**Accounts on a shared browser.** Each index entry records `owner` (a hash of the account id: `o` + FNV-1a). On connect,
untied games are claimed by the account (except a game an older build synced with some account that isn't this one: it
stays untied and untouched); another account's games are hidden, never pushed and never deleted. `full-plate:owner:v1`
holds the device's last account hash so the first paint already hides them. When the account differs from the last one,
the cached settings and onboarding flags are replaced by this account's (`PrefsBridge.forget`), not merged.

**Storage hygiene.** At most two backups per game (`backupOf`); the chunk high-water mark (`hw`, in the index before the
chunks are written and in the header) makes pushes and deletes clean every chunk ever written; the account's `prefs`
keeps the newest 50 onboarding flags.

**Autosave can't throw.** `save()` catches a failing `encodeSave` (e.g. a NaN from a junk Empire command): the header mark
says "Couldn't save" until a save works again.

**Error page.** `components/CrashGuard.tsx` wraps `<App/>` in main.tsx: "Oops! Something went wrong." with Back to title
and, for the game being opened or played (App calls `noteSlot`), Delete this game; if the title itself crashed, every
saved game is listed (names via `safeName`) with its own Delete.

**Sims.** Every dispatcher refuses non-own command types (`Object.hasOwn` / a `default:`); Empire and Stars refuse
non-finite arguments (SET_CONTRACT, SET_FORMULA, SET_INSPECTIONS, FEE_HOLIDAY, SET_SUPPLY_MARKUP, LAUNCH_*,
TRANSFER_FROM_FOCUSED, SET_STAGIAIRE_POLICY, CLOSE_FOR_REFIT), unknown satellite kinds / ownership / land / tech / fit;
BACK_HEAD_CHEF respects `MAX_SATELLITES`; HIRE refuses an id already on the staff; LAUNCH_CAMPAIGN needs £500 and each
brand campaign already running in the same place halves the next one's lift; moving money from the till must be finite
and ≤ the till; the reducer's `fork` works once, from day 365, in an owner game (or a career that became the player's
own place), never on top of an Empire or Stars, and snooze needs the card showing; SET_OWNER_PROFILE can't come from a
screen (only the career handover sets it).

**Widened for real saves.** None needed: the 17-file corpus (rounds 6–7), generated owner (60 days and mid-service),
Empire, Stars and career saves, 14,000 states from the red-team reducer fuzzer (every save type) and 30,000 sim-core
fuzzer steps all pass and come back byte-identical. The bounds were set wide from the start: 0–100 stats allow −1…101;
`rota` may be shorter than 7; a past day's `reviews` is optional; party sizes 0–100. The one refusal the fuzzers found
was a sim bug (SET_ROTA accepted `Array(7)` — holes pass `every()` — and saved `null`s); SET_ROTA now refuses it.
CANCEL_ORDER rounds a partial refund down (order 2, cancel 1 no longer beats buying 1 by a penny).

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
