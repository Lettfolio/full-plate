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
in as commands at the host's current tick. Not built.

## Data layout (all under the artifact's db)

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
