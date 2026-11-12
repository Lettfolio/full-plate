# Full Plate — second red-team review (master 286eec2, 11 Nov 2026)

Three adversarial reviewers attacked what Rounds 12 and 13 added: security and data integrity (S14-n), game integrity and fairness (G-n), and the first hour as a 14-year-old on a phone and a tablet (U-n). Every finding below was reproduced by its reviewer; the scripts and tests are kept in the session scratchpad under `r14/redteam/{sec,game,ux}/`. Nothing was fixed during the review. Severity key as in `RED-TEAM.md`. Totals: **Critical 0 · High 5 (4 distinct) · Medium 11 · Low 13 · Note 14**.

The "Status (R14)" column is filled in by the Round 14 fix pass.

## Consolidated findings

| id | Sev | Area | Finding | Cause | Status (R14) |
|---|---|---|---|---|---|
| S14-1 / G1 | High | Live co-op | A pinned guest drains the host's cash without limit with fabricated `DROPPED` results (up to £50 each, no ticket needed, 20 batches × 16 per message): £6,370 → −£489,630 in 2 s, and the save keeps it. A message carrying every ticket id also sends all tickets back to the rail at quality 0. | `lib/coop/realtime.ts` checkResult/applyActs; `sim-core/commands.ts` `playerDropped` trusts cost | **closed** (A): the host prices and caps a guest's drops from its own game, counts results not messages, refuses empty drops; sim clamps PLAYER_DROPPED cost and plates. `round14.coop.test.ts` S14-1/G5; the reviewer's drain re-run moves £0. Residual by design: up to the night's cap (max £15, ½ of fired food cost; £30.70 in the test) then the guest is benched — reload doesn't reset it (review attack) |
| U2 / S14-4 | High | Robustness, data loss | A lazy chunk that fails to load (offline, a 404) shows "This game couldn't be opened. It may be damaged." with a one-tap **Delete this game** and no confirm; a healthy save was deleted in the run. A whole day played offline ends on that page. | `CrashGuard.tsx` is the only boundary; no retry on lazy imports | **closed** (C): `lazyRetry` on every lazy import, a `ChunkBack` panel per lazy part, Delete asks first and offers the raw save, prefetch on idle, stale-build detection. `round14.c.test.tsx`; `crash-chunk.mjs` re-run: no crash page, save intact; a day finished offline; a simulated redeploy offers Reload |
| U1 | High | Phone | Every screen and tab change keeps the previous scroll position (day 1 opens 1,696 px down; Staff opens at its bottom). | no scroll reset; phone.css makes the page scroll as one | **closed** (E): every arrival at the top, per-tab scroll memory. `round14.e.test.tsx`; `u-scroll-all` all 0; probe `notAtTop` 0 on all ten runs |
| U3 | High | Phone | The price stepper is clipped (65 of 152 px at 390; 4 px at 320) while the Goals panel is up: price and + invisible. | `.planning__body--goals .dish` grid + `.stepper{overflow:hidden}` | **closed** (E): stepper on its own row. `u-stepper` 290/286 px at 390 and 220/216 px at 320; probe `clipped` 0 on all ten runs |
| S14-2 | Medium | Shares, co-op lobby | Shared documents have no owner: a Contributor with a code can rewrite or delete a share, forge/overwrite reviews (and push real ones out via `at`), rewrite the co-op host document's live nonce, or write a plan as the guest. | default db rules; `state/share.ts`, `lib/coop/session.ts` | **closed in the rules engine and mock** (B): one writer per document under `fps|fpr|fpc/{self}`, root write `admin`. `round14.ownership.test.tsx`, `playtest-friends.mjs` attacker (10 refusals). Partly, what remains: enforcement on the real platform is unproven (no two-account claude.ai test); under `write: "self"` nobody, the owner included, can delete junk a Contributor writes in their own subtree (document budget, a 256 KiB marker that slows every visitor's listing) |
| S14-3 | Medium | Live co-op | Anyone with the co-op code can take the guest's or host's place (first tagged "hi"/`base` is pinned for good); the rate-limit bucket is spent before the pin check, so a flood starves the real guest. | `realtime.ts` pin and bucket order | **closed in live use** (A × B, wired in the review): the lobby's path-derived ids name the partner and only that account is pinned; pin before budget, one bucket per peer. `round14.coop.test.ts` S14-3, `round14.review.test.ts` (third account refused while the guest is present). Residual: with no id from the lobby (`by` null) the engine falls back to first-tagged — unproven whether the platform ever gives null here |
| G3 | Medium | Live co-op | A guest who reloads mid-shift loses their first results (host keeps the old ack count). | `realtime.ts` ack per pin | **closed** (A): per-page session ids, acks per session. `round14.coop.test.ts` G3; the reviewer's reload test passes |
| G2 | Medium | Challenge | 24 of 60 daily restaurants carry path-only dishes (`fd_`/`ff_`); on three dates "every price at £200" beats the best honest script; four Business Park dates had no goal-meeting play found. | `lib/challenge.ts` builds from the full pack | **closed** (D): starter-library pack only; re-derived targets. `round14.challengeFair.*` (90 dates × 6 templates); the reviewer's 60-date sweeps pass |
| U8 | Medium | Challenge | "Inspector due" (11 Nov) is won with five Skips. | scenario set-up | **closed** (D): five Skips miss every date with a "what went wrong" line. `round14.challengeFair.*`; `u-challenge` re-run on 12 Nov: missed, 269/450 |
| G4 | Medium | Regulars | VIP orders never lapse and can name off-menu dishes; three stalled orders block the other seven regulars (3–4 of 10 ever join in 1,000-day games). | `lib/regulars.ts` | **closed** (F): orders from her menu, lapse after three misses. `round14f.regulars.test.ts` (1,000-day games, three strategies) |
| U4 | Medium | Phone | Jump in is hidden at the sheet's peek and below the fold at half; the dock's "you'll cook yourself" misleads when she is watching. | `Service.tsx` sheet | **closed** (E): "Cook it yourself" chip at the peek; dock says what will happen. `round14.e.test.tsx`; `p13-sheet` peek shot |
| U5 | Medium | First hour | A day with every dish out of stock opens without a stop (0 guests, −£518) and the evening gives no reason. | `Planning.tsx`, `Evening.tsx` | **closed** (F): Open asks first; the evening names the cause; the next morning's gossip says the larder was empty (review). `round14f.nofood.test.tsx`; `p10-days` RESTOCK=0 stops before opening |
| U6 | Medium | Co-op day | A friend who closed the tab is never noticed; on a phone the panel covers **Open for service** and the folded pill covers the sheet's urgent line. | `CoopShiftDock.tsx` | **closed** (A): "seems to have gone" after 45 s, panel folded on phones, nothing covered (elementFromPoint). `round14.coopday.test.tsx`, `playtest-coop-r14.mjs` parts 2–3 |
| U7 | Medium | New game | "Where will you open?" asked twice; the name box is at y 2008 on a phone. | `NewGame.tsx` | **closed** (E): one flow, name first, street asked once. `round14.e.test.tsx`; `p2-newgame` (no street on the picker), review phone run |
| S14-5 | Low | Co-op day | "Use it" applies every change in a plan but lists only eight. | `CoopShiftDock.tsx` | **closed** (A): every change listed (folded at 8 with Show all), big moves first and flagged, only what was shown applied. `round14.coopday.test.tsx` |
| S14-6 | Low | Challenge | Score codes carry no secret (any score can be encoded); the UI states "They win by N" as fact. | `lib/challenge.ts` | **partly** (D): the compare says "Their code says …", codes above the ceiling are refused, a scenario fingerprint catches different builds. Still no secret in a code (any score under the ceiling can be typed): accepted, the UI no longer states a win as fact. `round14.challenge.test.tsx` |
| S14-7 | Low | Storage | With storage nearly full the migration moves the index but not the saves. | `lib/storage.ts` | **closed** (C): saves move before the index, each copy verified, storage-full keeps the old place. `round14.c.test.tsx`; the reviewer's near-full re-run no longer strands the slot |
| G5 | Low | Live co-op | Guest `PLATE_COOKED` quality isn't held to the dish's ceiling. | `realtime.ts` | **closed** (A): quality held to the dish ceiling (host and sim). `round14.coop.test.ts` G5 |
| G6 | Low | Challenge | Degenerate play outranks honest play (never restock on Inspector; the starter loan counts as profit on Rescue). | scoring | **closed** (D): Rescue on summed daily profit without loans; degenerate scripts score below honest play. `round14.challengeFair.*`, `zz-rt14-rescue` re-run |
| G7 | Low | Challenge | Rush and Festival promise extra guests the scenario never sends. | `challenge.ts` setUp | **closed** (D): Rush/Festival send more guests through an existing footfall modifier. `round14.challengeEngine.test.ts` |
| U9 | Low | Evening | "Tonight you lost £40" while cash rose £207; nothing explains profit vs cash. | `Evening.tsx` | **closed** (F): one tap on profit explains it with her numbers. `round14f.money.test.tsx` |
| U10 | Low | Text | Repeated review lines in one evening; drink templates misfire ("The Cola or lemonade was very... beige."). | review templates | **closed** (F): no review line twice in an evening; 22 templates reworded. `round14f.reviews.test.ts` |
| U11 | Low | Toasts | Goal toast: five lines mid-screen on a phone, a third of the floor sideways, clipped at 200 % zoom. | toast region | **closed** (E): toasts ≤ 2 lines, anchored off the floor and the primary button. `round14.e.test.tsx` |
| U12 | Low | Small screens | 320 px: page 336 wide; 200 % zoom and sideways phone hide Skip to evening. | phone.css | **closed** (E): 320 px has no sideways scroll, tabs fit, Skip visible sideways and at 200 %. `u-320`, `p15-sweep` (844×390, 640×400, 320). Note: at 320 the dock's hint strip scrolls sideways and cuts a long hint mid-word (Round 13 design, swipeable) |
| U13 | Low | Bank | The first-wage loan card vanishes silently once the gap passes £5,000; game over never says she had no staff. | `bank.ts`, `BankCards.tsx` | **closed** (F): the loan card says why it goes; game over names no staff / no stock / rent. `round14f.money.test.tsx` |
| U14 | Low | Chapters | 2 of 5 stars for a −£5,798 month; "trim the rota" to a player with no staff. | `ChapterCard.tsx` | **closed** (F): stars and advice match the month. `round14f.money.test.tsx` |
| U15 | Low | Storage | With storage blocked the only phone sign is "Not saved" inside ⋯. | `StatusBar.tsx` | **closed** (C): a dismissible notice on planning and the title. `round14.c.test.tsx` |
| S14-8 | Note | Pages CSP | `'self'` covers every repo on `<owner>.github.io` (no sink found). | custom domain | **open** (owner): needs a custom domain; no sink found |
| S14-9 | Note | Storage | Another page on the origin can also write: e.g. turn on `?autopilot`/`?perf` via the dev key, or replace saves. | gate dev switches on dev builds | **closed** (C; extended in the review to the co-op telemetry and replay recorder): switches only in dev/playtest builds; the plain and Pages dists carry none. `round14.c.test.tsx`, `round14.review.test.ts` |
| S14-10 | Note | Saves | A crafted save can put non-live (deleted) recipes on the menu. | `saveCheck.ts` | **closed** (C): a non-live recipe on the menu is dropped on load with a note. `round14.c.test.tsx` |
| S14-11 | Note | Privacy | Every share carries the same owner hash, so one account's shares can be linked. | `share.ts` | **closed** (B): no owner field; paths only. `round14.ownership.test.tsx` S14-11 |
| S14-12 | Note | CI | A Dependabot PR was merged on GitHub with no required review; every push to master deploys. | repository settings (owner) | **open** (owner): branch protection / required review on GitHub |
| G8–G11 | Note | Various | Invented recipes ignore what makes culinary sense; a recipe's description ignores a later "Hide alcoholic drinks"; the rival is a pushover (57/57 weeks for a good player); Stars from a Quick-year fork reaches a dynasty later (4/10 vs 7/10 by year 10). | — | G9 **closed** (F, `round14f.reviews`), G10 **closed** (F, `round14f.rival.test.ts`); G8 and G11 **open** (notes, no owner this round) |
| U16–U20 | Note | Polish | Lease money vs day-1 cash unexplained; rotate and how-to cards stack; no Web Share on the postcard and an empty room in the picture; system dark mode ignored; game-over "1.9 ★" spills, every starter shows 🥗, "Your cookbook" vs "Recipe book", two restock wordings. | — | U16 **closed** (F, LeaseMoney), U17 **closed** (E; review phone run: turn card alone, then the how-to), U18 **closed** (E), U20 **closed** (E; one restock wording applied by the review to F's confirm, Today card and the challenge advice); U19 dark mode **open** |

**Discoverability on a phone** (from a fresh day-1 planning screen): Invent a dish 1.9 screens down, brand kit 3.1, rival 3.2, regulars 3.8, Friends 3.9, live co-op 3.9, today's challenge four taps via Settings → Save & quit, hands-on shift four taps; nothing on screen points to most of them. **Feel**: clear within 60 seconds; first fun about day 4; repetitive from about day 6 on a phone (four taps a day, no decisions).

## Unproven (suspected, not reproduced)
- Shares and co-op documents outlive a deleted or lost game (no caller removes them).
- `by` may be null for Contributors from another organisation; the real emit budget is unknown.
- Cross-engine determinism: sim-core uses `Math.log/cos/sqrt/exp/pow`, which engines need not round identically, so Safari and Chrome could build a different "same for everyone" challenge. No WebKit was available.
- Real iOS Safari behaviour (pinch vs page zoom, safe areas without `viewport-fit=cover`, where a download lands).
- A partner vanishing in the live shift on a real `room`; the other five challenge templates with zero input; how the music feels over an hour; a 2-hour memory soak.

## What held up (tried and failed to break)
SHA-256 against NIST vectors; message tags checked on every topic; 20,000 fuzzed live messages and 300 hostile snapshots with no throw; share reads re-validated, no DOM sinks; 480 targeted mutations of the new save fields (411 refused, 69 harmless); storage migration under interruption and two tabs; `ui-checks.yml` least privilege; all seven balance rows exact at 200 seeds; all 34 corpus saves played 30 days with no invariant break and byte-identical round trips; 34,692 invented recipes with no money printer and none above the best shipped dish's appeal; Quick year still winnable both ways; regulars' memo stays under 1 kB at day 1,200; brand contrast never below 4.5:1 across 200,000 colours; going bust on Normal is clear and fair; no sideways scroll at 390, 844, 1024 or 640; the upright hands-on shift works for a first-timer.

## Recommended order of work
1. S14-1/G1 and U2/S14-4 (money and data loss). 2. U1, U3 (a phone player can't see the price or the top of any screen). 3. S14-2, S14-3, G3 (ownership and identity in shared play). 4. G2, U8, G6, G7 (the daily challenge must be fair and must need play). 5. G4, U4, U5, U6, U7 (things she'd miss or trip on). 6. Lows and notes; discoverability.

## After Round 14 (review of the six fix branches, 12 Nov 2026)

Every reproduction above was re-run against the merged build (REVIEW.md R14.9 has the table). The status column says
what holds. The reviewer then attacked the fixes themselves:

- **Live co-op.** Results just under the cap: one guest can cost at most the night's cap (the higher of £15 and half
  the food cost fired so far: £30.70 in the test), then they are benched. Reloading (a new peer and page session) or
  waiting a minute doesn't reset the bench or the ledger. An evicted page session replayed later costs nothing twice.
  A benched guest's emotes change nothing. Another account can't speak for a benched guest. A third account holding
  the code can't take the pin while the admitted guest is present, because the lobby's path-derived ids are now wired
  into the live pin (S14-3 was open in real use until then: the two screens passed `null`). All of these held.
- **Shared documents.** A Contributor writing `fps/<other>/…`, `fpr/<other>`, `fpc/<other>/…`, `data/users/<other>`,
  root paths or old `fp-share/…` paths is refused. A Viewer writes nothing, not even under their own id. Stuffing one's
  own review document with 5,000 keys doesn't push a real reviewer out (each document is one row). A join-key list
  stuffed with guesses doesn't get a third account into a pinned session. Check letters fit a second id about 1 time in
  870 (23 in 20,000): such a code opens nothing ("ask for a new code") rather than the wrong share. **New, Low:** no
  rule caps size or count inside one's own subtree, so a hostile Contributor can fill the artifact's document budget or
  make their `fps/<id>` marker 256 KiB, which every visitor then downloads when a code is looked up (the marker list is
  read in full). Under `write: "self"` nobody, the owner included, can remove it without publishing looser rules or
  deleting the artifact. The family-sized audience makes this unlikely. The fix would be a dedicated index document per
  code, or `write: "owner"` on the three prefixes so the owner can tidy up (see COOP-NOTES).
- **Challenge.** D's own list (every price at the cap, never restock, fire everyone, shut five days, take the loan),
  closing only bad days, five Skips, and invented dishes all score below honest play or miss (`round14.challengeFair.*`
  and the red team's sweeps, re-run). A code from another build or date shows "different versions" (fingerprint). A code
  is still not a proof: S14-6 stays "partly" by design.
- **Saves.** Delete on the damaged-game page needs two taps on two different screens; the confirm's buttons were
  ordered so a double tap on "Delete this game…" could land on "Delete <name>" (both second in their row): the review
  moved Delete last ("Keep it" is second now; test). The page re-renders, so a held Enter doesn't carry over. Storage full during migration keeps the old place authoritative. A save naming parked or deleted
  recipes on the menu is repaired on load. The CrashGuard delete now also clears the game's share and co-op day after
  the confirm, never before.
- **Phone.** 320 × 568, 844 × 390 and 640 × 400 (200 %): no sideways scroll, steppers whole, tabs reachable (the phone
  tab bar is fixed), the Today and Try cards stack above the tabs and the menu starts about two screens down on Day 5
  with both up. At 320 the dock's hint strip scrolls sideways and cuts a long hint mid-word (Low, Round 13 design).

### Unproven (updated)
- The `db` rules and `room` on the real platform: no two-account claude.ai test of the rules, of live co-op, or of
  whether `Sender.by` can be null for an admitted Contributor (then the live pin falls back to "first tagged").
- Real iOS Safari (pinch vs page zoom, safe areas with `viewport-fit=cover`, the share sheet with a PNG, where a
  download lands). No WebKit here.
- Cross-engine determinism of the challenge: D's perturbation test shows the built state can change if the last bit of
  `Math.log/cos/sqrt/exp/pow` differs; the fingerprint turns that into "different versions" rather than a false
  comparison, but Safari vs Chrome is untested.
- Share and co-op codes are capabilities: anyone who sees one can visit or join; secrecy rests on the family.
- How the music feels over an hour; a 2-hour memory soak; system dark mode (U19, open).
