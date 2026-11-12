# Co-op and visiting — design notes (Round 12, G)

Social play with no chat and no strangers. Two features, both invite-only by a code, both over the artifact runtime's
`db` capability (the same one the saves use). No server, no third-party service, no network call outside the runtime.
On GitHub Pages (no `window.claude`) and when signed out, every entry point says so in one line.

## What shipped

1. **Visit a friend's restaurant.** The owner shares a read-only snapshot under a code; a friend types it, walks
   round the room (the real floor renderer, empty-room preview), reads the menu, team, reviews and this week's
   numbers, and leaves 1–5 stars plus up to three compliments from a fixed list of eight. The owner sees them under
   **Visitors**.
2. **The co-op day — turn-based**, not a real-time shared shift (why: below). The host invites; the guest plans
   tonight (dishes on/off, prices, who works tonight) and sends it; the host looks at the list of changes and taps
   **Use it** or **Not this time**; the host runs service; both see the evening. Six emotes either way, no text.

## Why not the real-time shared shift

The brief's target was a hands-on shift where the guest serves while the host cooks, the host's sim authoritative and
the guest's actions entering as commands at the tick the host receives them. Over this runtime that needs a round
trip well under ~500 ms, steadily, for the length of a shift. What the platform promises (db.d.ts, contract 0.2.96):

- **Delivery** "rides a realtime stream when available and falls back to periodic refresh (about 30 s foreground)".
  The fallback alone rules out a shared shift: one guest action could land 30 s late, i.e. ~15 sim ticks at 1× and
  60 at 4×.
- **Writes**: "ONE WRITE AT A TIME per document … never from … a timer that rewrites unchanged or clock-derived
  values", a per-viewer call-rate budget (`resource_exhausted`), last-writer-wins, no transactions. A hands-on shift
  makes several actions a second and the host would have to publish tick state several times a second.
- No ordering or delivery guarantee between two documents' listeners, so "the tick the host receives it" is only as
  good as the slowest of two subscriptions.

Measured round trip (host writes a ping into its document → the guest's listener sees it → the guest writes a pong →
the host's listener sees that), by the panel itself (`RttMeter`, three pings when a guest joins; shown as "link N ms"
in the host's panel and kept in `window.__fpCoopRtt`):

| Where | Round trip (3 pings) | Notes |
| --- | --- | --- |
| Playwright, two contexts, mock runtime (`scripts/lib/mockClaude.mjs`): 30 ms per db call, 120 ms snapshot poll | 154 / 156 / 307 ms (median 156); a second run on a busier machine 380 / 167 / 435 ms (median 380) | the mock's floor: 2 writes + 2 polls ≈ 4 × 30 ms + up to 2 × 120 ms; says nothing about claude.ai |
| claude.ai artifact | **not measured in this round** | no artifact session was available to the builder; the panel shows the number the first time two people use it |

The real number could not be taken from inside the build sandbox, so the decision rests on the documented 30 s
fallback and the write budget: even a good realtime stream can't be relied on for a shift, and a shift that stalls for
30 s is worse than none. The turn-based day needs one write per decision and tolerates a 30 s delivery.

If the realtime path turns out fast in practice (the panel's "link N ms" will say), the next step is the `room`
capability (the runtime's live presence/event channel: "messages can drop", event topics need Contributor via
`{room: {topics: {act: "interact"}}}`), not the db: guest actions as room events, the host's tick snapshot as room
presence, and the db only for the invite. `HandsOnShift` would take an optional `remote` prop that feeds those actions
in as commands at the host's current tick. Not built in Round 12; built in Round 13 (below).

## Data layout (all under the artifact's db)

> **Superseded by "Round 14 — B" at the end of this file.** The R12 paths below had no owner the platform enforced
> (S14-2): they are no longer read or written. Kept as the record of what shipped in Rounds 12–13.

| Path | Written by | Body |
| --- | --- | --- |
| `fp-share/<CODE>/v/snap` | the owner | `ShareSnapshot` + `owner` (a hash of the owner's id) |
| `fp-share/<CODE>/reviews/<visitorHash>-<yyyymmdd>` | a visitor | `{kind:"fp-review", stars, picks[], nick, date, at}` |
| `fp-coop/<CODE>/side/host` | the host | `HostDoc`: nick, createdAt/expiresAt, stage, board, evening, answer, emote, ping |
| `fp-coop/<CODE>/side/guest` | the guest | `GuestDoc`: nick, joinedAt, plan, emote, pong, ended |
| `data/users/<uid>/r12/g/social` | me (private) | which code each of my games is shared under; which shares I reviewed on which day |

- **No discovery.** The parents `fp-share/<CODE>` and `fp-coop/<CODE>` are never written, so a query on `fp-share` or
  `fp-coop` returns nothing; only a code opens anything. (This leans on the Firestore-style nesting db.d.ts describes;
  if a platform version ever listed nested paths, codes would become listable to people who can open the artifact —
  still only the owner's invitees, but worth re-checking.)
- **Codes**: 10 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 letters, no 0/O/1/I/L) by
  `crypto.getRandomValues` with rejection sampling: 31^10 ≈ 8.2 × 10^14 ≥ 36^8 ≈ 2.8 × 10^12. Shown as `ABCDE-FGHJK`;
  typing ignores case, spaces and dashes.
- **One writer per document** (the db is last-writer-wins): the host never writes the guest's document or vice versa.
  `DocWriter` keeps one write in flight per document and coalesces a burst into the newest body.
- **Expiry**: a host document carries `expiresAt = createdAt + 2 h`; both sides treat an expired session as over; the
  host's local flag expires with it. "End" writes `stage: "ended"` (host) or `ended: true` (guest).
- **Who can write**: with the default rules (`write: "interact"`) a friend needs Contributor access on the artifact to
  leave a review or join a co-op day; a view-only friend can still visit (the screens say "ask for Contributor access"
  when a write is refused). The game's artifact declares `db` and `user` already; nothing new is needed. A stricter
  rule set (e.g. `{path: "fp-share", read: "view", write: "interact"}`) changes nothing for the game.

## Safety

- Nothing a visitor or guest sends is shown as free text. Reviews are a star count, compliment ids from the fixed list
  and a nickname; emotes are ids from a fixed list of six; a plan is dish ids, prices and staff ids, all filtered
  against the host's own game before they become commands.
- Nicknames: letters, digits and single spaces only (Unicode letters, so "Zoë" works), ≤ 16, after the same unsafe-
  character strip as restaurant names (`cleanName`). There is no word filter (the game has none for restaurant names
  either); codes are only given to friends.
- A snapshot from someone else is coerced field by field (`checkSnapshot`): unknown dish, decor and district ids are
  dropped; names are stripped and cut; lists capped (24 tables, 40 dishes, 40 staff, 8 reviews, 7 nights); numbers
  clamped. Review text in a snapshot is the sim's own words, but it travels in the owner's document, so it is cut to 160
  characters and rendered as text (React escapes it), never HTML.
- The snapshot holds only what the visit draws: name, street, difficulty, day, tables, decor, popularity/prestige,
  menu (dish, price, on/off), staff (name, role, skill), the last reviews and the last seven nights' covers, walkouts,
  takings, profit and rating. No cash, loan, stock, orders, wages, RNG, seed, saves, prefs or account ids.
- Rate limits are client-side, as the brief asks: one review per visitor per share per day (private record + the
  document id carries the date), the newest 50 reviews kept (the owner's Friends card prunes the rest), one emote per
  1.5 s per side.

## Determinism

The sim is untouched. A guest's plan reaches the host's game only through `send()` — the same `command` action the
host's own taps dispatch — as `SET_MENU_ITEM` / `SET_ROTA`, which the sim validates as usual; the round12 test applies
the same plan twice from the same state and gets byte-identical games. Nothing co-op lives in `GameState` or the save:
the host flag is localStorage, the share registry is the private db document plus localStorage.

## Round 13 (F): the live shift, over the `room` capability

Round 12 ruled out a shared shift over the **db** (30 s fallback delivery, a write budget). Round 13 builds it over
the **room** capability (room.d.ts, contract 0.2.96): the live channel for whoever has the page open right now —
events on topics, per-viewer presence, named sub-rooms; nothing stored, messages can drop. The turn-based day stays,
unchanged, as the fallback and as the late-joiner/lobby record.

### What it does

The host arms tonight in the co-op panel ("I cook, Sam serves" / "I serve, Sam cooks" → **Go live tonight**). When
the doors open the host is put on their station (the owner's ordinary hands-on "Jump in") and the guest's page opens
the same service in the other role. Both see each other walk about (the game's own sprite, a name tag, smoothed),
the round trip ("link N ms"), the six emotes, and one line when something is up (the guest went quiet, the link is
slow). At closing time the guest sees their own numbers and goes back to the turn-based screen, whose evening card
shows the restaurant's night.

### Design: host-authoritative

- **The host's game is the only game.** The host runs the real sim and their own hands-on session in App's
  `HandsOnShift`. The guest runs a hands-on session of their own (walking, verbs, timing are all local, so their own
  taps answer at once) against a throwaway `GameState` rebuilt from the host's snapshots (`skeletonOf`/`viewOf`: a
  fresh `newGame` with the host's tables, menu, team, customers and tickets laid over it — the same trick as Round 12's
  visit).
- **Only results travel guest → host** (`fp-in`, `{k:"act", p:[[seq, results[]], …]}`): a plate served, a table
  cleared, a bill taken, plates dropped (server); a ticket claimed, a plate cooked, a dropped plate (chef). The host
  checks each one (`checkResult`): shape, ranges (quality 0–100, speed 0–1, drop cost ≤ £50, ≤ 3 ticket ids), and the
  **guest's role only** — another role's verb, `RAIL_RESIZED`, a command, anything else is dropped. What passes goes
  through the game's own `handsOnResults` action at the host's current tick, i.e. as the same PLAYER_* commands the
  host's own taps make; the sim still refuses a stale one (a plate an AI server already carried), harmlessly.
- **Exactly once, over a lossy channel.** The guest keeps every batch until the host's snapshot acknowledges its seq
  (`a`), re-sending the whole unacknowledged list every 250 ms (new input goes at once, ≥ 80 ms apart). The host applies
  only `ack + 1`, in order, so duplicates and reordered copies change nothing. The guest's session hides what it has
  done until the snapshot catches up (its own `served`/`cleared`/`paid` marks — the handson package's existing
  "a tick behind" handling), which is the optimistic local echo.
- **Absolute state host → guest** (`fp-st`): `{k:"base"}` (tables, menu, team, roles: what doesn't change during a
  service) every 2 s and at once when a guest says hello or reports a stale base; `{k:"st"}` (clock tick, tables'
  dirt and occupancy, customers, tickets, the sim's hands-on role, the ack, the host's measured round trip) at most
  10 a second on change and at least 5 a second regardless. A dropped one is replaced by the next; an older one that
  arrives late (lower seq) is ignored. Ids and dishes are coded as indexes into the base; a crowded floor trims queues
  first, then leavers, then the oldest tickets, to stay under 3.8 KB (room.d.ts: 4 KiB per message).
- **Where you are** goes in room **presence** (`{fp:{x,y,f,c,r}}`, ≤ 10 Hz, only on change): high-rate state belongs
  there (room.d.ts), and it is display only — never authority. Each side draws only its pinned partner's.
- **Which role the sim backs off.** `GameState.handsOn` holds ONE human role, and the sim is untouched, so co-op sets
  it to `server` whenever a human serves (the host serving, or the guest serving and here): plates then wait at the
  pass for the human server, and the AI servers carry them after `HANDS_ON.passHoldTicks` (the normal fallback). The
  human chef cooks alongside the AI cooks without a reserved rail (claims via PLAYER_CLAIMED work with any hands-on
  role). A guest server quiet for **3 s** is "away": the host sends `SET_HANDS_ON` with the host's own role (so a host
  chef gets their reserved tickets back and plates go straight out), and back to `server` when the guest returns.
  A guest chef who goes quiet needs nothing: their claims time out (`claimTimeoutTicks`) and the AI cooks take over.
  Reserving both a chef's rail and a server's pass at once would need a sim change (two hands-on roles); not done.
- **Determinism.** The host's game stays a pure function of the state when the doors opened and the ordered list of
  app actions the reducer saw (the host's ticks and results, the guest's applied batches, the role switches). App's
  reducer is wrapped (`tapReducer`, lib/coop/flag.ts) to log them while a live shift is on (each action object once —
  StrictMode calls reducers twice); at closing time `HostLive` replays the log through `appReducer` and compares the
  game JSON byte for byte (`window.__fpCoopReplay`). `round13.live.test.ts` does the same for whole bot shifts at 0 ms,
  150 ms + 20% loss, 400 ms + 20% loss, a quiet guest, and guest-as-chef.

### Safety

- **A room per session**: `fp-` + SHA-256(code, nonce) (`roomName`). The nonce (24 × [a-z0-9], ≈124 bits, crypto RNG)
  is made when the host arms the night and lives only in the host's db document, so only someone with the code can
  read it; an old code never opens a new night's room. The lobby room (everyone viewing the artifact) is never used.
- **Every message carries a tag**: SHA-256(nonce, sender's `peer`) (`tagOf`). `peer` is stamped by the platform and
  can't be forged, so a stranger in the room — who could only be there by guessing a 28-hex name — can't speak for the
  host or the guest, and can't replay their messages from their own peer. Messages from agents, our own echoes,
  and untagged or mis-tagged data are dropped (counted in `refused`).
- **Pinning**: the host pins the first genuine guest peer (and its `by` when the platform vouches for one); another
  peer can take that place only with the same `by`, or after the pinned one has been quiet 3 s (a reload is a new
  peer). The guest pins the host the same way. Presence is read only from the pinned partner.
- **Rate limits**: host side 15 `fp-in` messages a second (burst 30), 16 results a batch, 20 batches pending; emotes
  ignored faster than one a second from the partner (and the bar sends one per 1.5 s).
- **No owner commands from the guest, ever**: the guest sends results, never commands; the host turns only the
  role's own result kinds into commands.
- **No free text**: emotes are ids from the fixed six; names on screen are the db nicknames (Round 12's filter) and
  the base's restaurant/staff names pass `cleanLabel`. Everything heard is coerced like a save (`decodeBase`,
  `decodeFloor`, `checkSpot`: ids by pattern, indexes in range or the row is dropped, numbers clamped, lists capped).

### The capability declaration (Round 13 — superseded by "Round 14 — B" below, which adds the `db` rules)

```js
capabilities: {
  db: {},
  user: {},
  downloads: {},
  room: { topics: { "fp-in": "interact", "fp-st": "interact", "fp-emo": "interact" } },
}
```

`db`/`user`/`downloads` are as SAVES.md has them (no rules beyond the defaults). `room` opens exactly the three topics
the game sends on (`ROOM_DECLARATION` in realtime.ts) to the interact level; the host sends `fp-st`, so the host needs
it too, not only the guest. Nothing is sent on the lobby room; named rooms need no declaration.

| Access level (share menu) | Saves | Visit a friend | Reviews, co-op day (db writes) | Live shift (room topics) |
| --- | --- | --- | --- | --- |
| Viewer / Commenter | this device only | yes (read) | no ("ask for Contributor access") | no: `emit` is `not_permitted`; the guest screen says "Live play needs Contributor access", the host's panel the same; presence alone carries nothing that matters |
| Contributor (`interact`) | account | yes | yes | yes, as host or guest |
| Editor (`admin`) / Owner | account | yes | yes | yes |

A Viewer could still join a named room by name and set presence or listen — but would need the code to read the
nonce, and everything they could send there is dropped by the tag check anyway.

### Fallbacks

- `claude.use("room")` is null (GitHub Pages, signed out, published without `room`, an older platform), a join fails,
  or the guest's page can't (its document lacks `rt: true`): no live offer; the Round 12 turn-based day, unchanged.
  The host's panel says "Sam's page can't do live play"; the guest's screen says "this page can't join live play".
- The guest can always tap **Play the turn-based day instead** before the doors open.
- **Slow link**: the round trip is measured live (host's snapshot time echoed in the guest's 2 Hz heartbeat, minus the
  time the guest held it; median of the last 8) and shown as "link N ms" on both sides. Above **400 ms for 8 s**, the
  host gets "The link is slow (N ms)…" with **Finish on my own** (ends live: the AI covers the guest's role; the guest
  sees why and goes back to the turn-based day); the guest sees the same warning.
- The host taps **Back to the office**: after 1.5 s off the canvas the live shift ends (the guest would otherwise be
  playing a dining room running at office speed). **Skip to close** ends it at closing time, as normal.
- Lost host (nothing for 5 s): the guest sees "Lost touch…" and a button back to the co-op day.

### Measured (mock runtime, two Playwright contexts on a shared, heavily loaded build machine)

See UI-NOTES "Round 13 — F" for the table. The mock (`scripts/lib/mockClaude.mjs` `createMockRoom`) adds latency per
message, jitter (so messages reorder), loss (your own echo is never lost) and enforces topic rights and the 4 KiB
limit; it rides on Playwright bindings (page → Node → page), which add their own few-to-tens of ms, more when the
machine is busy.

### Only a real claude.ai session can confirm

- The real round trip and loss rate, and how they hold over a 3-minute shift on home Wi-Fi.
- That named rooms are offered to these viewers (`join` may answer `not_permitted` on some platforms; the game then
  falls back) and that two friends in **different organizations** are admitted to the same room (room.d.ts: guests
  "where the platform admits them").
- The emit budget in practice (the game stays near 20 a second per side: snapshots ≤ 10, presence ≤ 10, heartbeats 2).
- That the declaration above is accepted as written (topic grammar `^[a-z][a-z0-9_.-]{0,47}$`, three of the 16).

## Round 14 — B: one writer per shared document, enforced by the rules (S14-2, S14-11)

The second red team showed that with the default rules (any Contributor writes any shared document) a friend with a
code could rewrite or delete a share, forge or overwrite reviews, rewrite the co-op host's live nonce, or write a plan
as the guest. The fix is in where documents live, so that the platform — not the page — decides who writes them.

### Where everything lives now

Every shared document sits under the platform id of the ONLY person who may write it, at a `{self}` path:

| path | written by | holds |
| --- | --- | --- |
| `fps/<uid>` | `<uid>` | "I share" marker, `{kind: "fp-pub", v: 2}` (nothing else) |
| `fps/<uid>/s<hash>/snap` | `<uid>` | one snapshot per shared game (`<hash>` = SHA-256 of the code, 32 hex) |
| `fpr/<uid>` | `<uid>` | `<uid>`'s own reviews of other people's shares: `r: {<key>: {stars, picks, nick, date}}`, `k: [<key>…]`; one entry per share, newest 30 kept; `<key>` = 8,192 rounds of SHA-256 over the code |
| `fpc/<uid>` | `<uid>` | co-op marker; a guest's lists `j`, the slow join keys of sessions it joined |
| `fpc/<uid>/c<hash>/host` | the host | `HostDoc`, plus `guest`: the one guest id the host let in |
| `fpc/<uid>/c<hash>/guest` | the guest | `GuestDoc` |
| `data/users/<uid>/r12/g/social` | `<uid>` (private) | my shares by game, my co-op sessions (for clean-up) |

**The author comes from the path.** `openShare` reports `ownerId` and `mine` from the path the snapshot was found at;
a review's `id` is the path segment of the visitor's document; a co-op partner's id (`JoinResult.partnerId`, the second
argument of `watchGuest`'s callback, and `partnerOf(code)` in `lib/coop/session.ts`) is the path segment of the
document they wrote. No document carries an id field that is believed. The Round 12 owner hash is gone (S14-11): two
shares of one player share only the id in their paths, which the rules need.

**A code is still all a visitor needs.** A code is 8 random letters plus 2 check letters computed from the random part
and the owner's id (`codeCheck`). The visitor lists the markers under `fps` (or `fpc` for a co-op day), keeps the ids
whose check letters fit, and reads `…/s<hash(code)>/snap` under each. Only the owner can have written there. Someone
else who has the code can write a look-alike under their own id, but it is found only if the check letters fit their
id too (1 in 961 per account); if two ever fit, the code opens nothing and says "ask for a new code" rather than
showing either.

**Enumeration stays impractical.** Listing the markers gives ids, not codes. From an id, reaching a snapshot needs the
code's 8 random letters: 31^8 ≈ 8.5 × 10^11 guesses per player, each a db call (the per-viewer call rate applies). The
review and join keys in `fpr`/`fpc` are readable, so they are slow hashes (8,192 rounds, ≈ 60 ms in a browser):
cracking one offline costs 31^8 × 8,192 × (number of players) hashes, years of a GPU for a pretend restaurant's
snapshot and one star rating. The old shared paths are not read any more.

**Reviews.** Each visitor writes one entry per share in their own document; nobody else can write or delete it. The
owner's list is a query on `fpr` for documents listing the share's key: one review per visitor, dates in the future
read as today, newest first, at most 50 — pruned by count on read, never by deleting, and never by a client-supplied
time. **Hide** on the owner's Visitors list hides that visitor on this device (localStorage), nothing else. Nicknames
are still the visitor's choice (Mallory can call herself "Carol"), but she cannot touch Carol's review.

**Snapshot review lines** are shown only if they are the game's own words: `lib/visit.ts gameLine` rebuilds them from
the review templates (this rating or "rough"; `{dish}`, `{restaurant}` and `{segment}` filled as the sim fills them).
An owner's own prose is dropped on read.

**The co-op lobby.** The guest finds the host's document from the code (check letters). The host finds would-be
guests by the join key in their markers and pins the first whose guest document is there into its own document
(`guest`); from then on it reads only that guest's document, and a later `guestJoin` answers `"taken"`. A guest who
sees the host pin someone else treats the session as over. Nobody can rewrite the other side's nonce, role or plan.
(Who gets to be first is still first-come: S14-3's live-room pin is Builder A's.)

### Lifecycle

| event | what goes |
| --- | --- |
| Stop sharing | the snapshot; the `fps` marker with the last share |
| Delete a game (Your games › Delete) | its share and its co-op day (`lib/socialLife.ts`; the slot is read with `peek`, which writes nothing, before it is deleted) |
| A game is lost (game over, not a career evening) | the same (App's effect on `gameover`) |
| End the co-op day (host) / Leave (guest) | that side's document (after writing "ended"), the guest's join key, the marker when nothing is open |
| A session's two hours pass | its documents are swept by their own writer next time they open Friends or Visit a friend (`sweepCoop`); readers treat it as over meanwhile |

Visitors' reviews of a stopped share stay in the visitors' documents (only they can write them): they point at a code
that opens nothing, and each visitor's list keeps only its newest 30. The owner can't delete them; under `write:
"self"` nor can the artifact's owner, short of publishing looser rules.

**Budget** (25,000 documents per artifact): per player at most 1 share marker + 12 snapshots (`MAX_SHARES`; the 13th is
refused "the shared space is full") + 1 reviews document + 1 co-op marker + 1 live host document (+ 1 guest document
when joined elsewhere) = **17**, so the worst case is about 1,470 players who never clean up; one document is ≤ 30 kB
(a snapshot is under 20 kB, a reviews document under 3 kB). The root is raised to `admin`, so a Contributor can't
create documents anywhere else (before, any path was writable).

**Migration.** The published artifact's db holds no `fp-share/…` or `fp-coop/…` documents (checked before this round),
so nothing is moved; the old paths are simply not read. A device whose private record still lists an R12 code gets a
new code on its next share (`share` replaces any code whose check letters don't fit the owner).

### The capability declaration (the publisher must pass this)

`scripts/lib/dbRules.ts` holds it (`CAPABILITIES`); a test checks this block matches it character for character:

```json
{
  "db": {
    "rules": [
      {
        "path": "",
        "read": "view",
        "write": "admin"
      },
      {
        "path": "data/users/{self}",
        "write": "interact"
      },
      {
        "path": "fps",
        "read": "view",
        "write": "self"
      },
      {
        "path": "fps/{self}",
        "read": "view",
        "write": "interact"
      },
      {
        "path": "fpr",
        "read": "view",
        "write": "self"
      },
      {
        "path": "fpr/{self}",
        "read": "view",
        "write": "interact"
      },
      {
        "path": "fpc",
        "read": "view",
        "write": "self"
      },
      {
        "path": "fpc/{self}",
        "read": "view",
        "write": "interact"
      }
    ]
  },
  "user": {},
  "downloads": true,
  "room": {
    "topics": {
      "fp-in": "interact",
      "fp-st": "interact",
      "fp-emo": "interact"
    }
  }
}
```

| path | Viewer / Commenter (`view`) | Contributor (`interact`) | Editor / granted Owner (`admin`) | the artifact's owner (`owner`) |
| --- | --- | --- | --- | --- |
| `fps/<own id>/…`, `fpr/<own id>`, `fpc/<own id>/…` | read | read, write | read, write | read, write |
| `fps/<other>/…`, `fpr/<other>`, `fpc/<other>/…` | read | read | read | read |
| `data/users/<own id>/…` (saves, the private record) | read (writes refused: "This device only") | read, write | read, write | read, write |
| `data/users/<other>/…` | — | — | — | — |
| anything else (old `fp-share/…` included) | read | read | read, write | read, write |

So: a Viewer can visit but can't review, share or join; a Contributor does everything for themselves and nothing to
anyone else's documents; Editors and the owner can write the unused rest of the db but, like everyone, never another
player's share, review or co-op side (`self` is a level nobody holds). The `room` topics are as Round 13 declared them.

### Review of the declaration (Round 14 review, against contract 0.2.96's db.d.ts, room.d.ts, downloads.d.ts, user.d.ts)

Line by line: `{path: "", read: "view", write: "admin"}` is db.d.ts's own root example (path `""` is the root);
`{path: "data/users/{self}", write: "interact"}` MUST be listed — with the root raised to `admin` it is what lets a
Contributor keep writing their own saves (db.d.ts: "locking the root alone … also stops everyone below admin writing
their own subtree"); it adds no reader (no rule at `data/users`, so siblings stay private, the owner included). Each
`fps|fpr|fpc` prefix rule sets BOTH read and write and is the only place `self` appears (allowed: a prefix of a
declared `{self}` rule), and each `{self}` rule states both levels, as db.d.ts's sign-off sheet does. 8 rules (≤ 64).
`room.topics` uses the db level words, three exact topics (≤ 16). `user: {}` gives `id()` (no profile scope needed:
only ids are stored). **`downloads` is declared `true`** (the capability's own wording; B had `{}`). The one doubtful
part is a choice, not validity: `write: "self"` means nobody — the owner included — can remove junk a Contributor
writes inside their own subtree (see RED-TEAM-2 "After Round 14"). The conservative alternative, which keeps "only the
author or the artifact's owner writes here", is `write: "owner"` on the three prefix rules (db.d.ts's "votes" pattern);
it lets the owner tidy up with Claude's data tool, and nothing in the game's own code writes another player's path.

### Tests and the mock

`scripts/lib/dbRules.ts` is the rules engine (levels, inheritance, `{self}`, the "whichever gives more" rule on one's own
subtree, `data/users/{self}` always present, declaration checks). The Playwright mock (`mockClaude.mjs`
`createMockStore`) and the vitest double (`src/__tests__/ruleDb.ts`) both enforce it; `installMockClaude(ctx, store,
{uid, level})` and `store.as(uid, level)` act as anyone at any level. `round14.ownership.test.tsx` replays each S14-2
attack as a Contributor and checks it is refused. `scripts/playtest-friends.mjs` adds an attacker context that tries
them against the built game.

