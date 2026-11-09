# Round 7 UX audit

## A. Career and hands-on

Surface: the career start (StartPicker for an employee start), My shift, the watch view's hands-on entry, the hands-on
shift (HandsOnShift + the handson canvas/HUD), the career evening and its score card, the handover modal.

**Method.** The built dist under `vite preview` (private port), Chromium via Playwright, apprentice chef, cosy,
`?autopilot=0.55,0.5` for the shift (a half-speed "child" bot), at **1280×800** and **1024×768 with touch emulation**
(iPad landscape, the likely device). Script: scratchpad `shots/r7/a/career.cjs`; shots in `shots/r7/a/before/`. Every
screen is probed in the page for interactive elements under 44×44 px, DOM text under 13 px and text contrast under
4.5:1 (3:1 for large text) against the nearest opaque background; canvas text is covered by the round-5 type audit.
0 page errors, 0 console errors.

Probe totals before (per screen, 1280 / 1024-touch): start picker 1 / 0 small targets; My shift 12 / 12 small and 2
low-contrast (the two disabled buttons, 2.68:1); watch 12 / 12 small; hands-on 3 / 3 small; evening 2 / 2 small. No
DOM text below 13 px anywhere.

### Screen by screen

**Start picker (career start).** First sight: five big start cards, clear. To act she reads a card, then scrolls past
difficulty and district to "Your name" and "Your first boss"; at 1024×768 the start button is ~1,400 px down with
nothing sticky. "← Back" is 34 px tall.

**My shift.** First sight: the green "You're on today" callout, which is a 30-word sentence that explains slip colours
before she has seen a slip. To act: "Start my shift →" sits at the bottom of a long page (fine, it's the openbar).
The three career buttons (promotion, raise, mentor) are 34 px tall; the weekday toggles 40 px tall. Disabled
"Ask for a promotion" and "Hour with your mentor" say *why* only in a `title` tooltip, which a tablet never shows, and
read at 2.68:1.

**Watch your shift** (Service.tsx, agent B's file). The hands-on entry "Play my shift (hands-on)" is a 34 px small
button beside "Skip to end of shift"; the staff strip offers "Break" (28 px) on the read-only career view. Logged for B.

**Hands-on shift.** First sight: a full restaurant with a ticking clock; on the very first shift nothing explains the
loop (slip → your station → the pass) as a whole — a bottom banner and a gold arrow carry it one step at a time while
the sim runs. On a tablet there is **no way to play**: input is keyboard and gamepad only, the bar says
"WASD walk · E use · Q cancel · gamepad works too", and tapping the canvas does nothing. At 1024×768 the HTML bar wraps
to three rows (the kicker breaks over two lines, the key hints wrap, Skip drops to its own row), so the world shrinks
to 23 px tiles. Clock and points appear twice (HTML bar and canvas HUD). Her station is named only in the rail tag
("COMMIS STATION Sides · Desserts"); nothing on the floor says which fryer/oven/board is hers. Slip waiting time is a
4 px colour strip; table patience is a thin arc under a translucent halo, while the "7/8" number bubble is the
loudest mark on a table. The sous chef's name tag sits on the "PASS" label when he is at the pass; he and the floor
colleagues are drawn through the player; his walk is a replay that reaches the rail after the slip has gone; the
"Covered by the sous chef" toast rises through the heads at the pass. Pause and Skip are 34 px tall.

**Career evening + score card.** First sight: big animated stars and "Good shift, Mia!" — good. But the card is a
narrow left column; "what to try next" is the smallest, faintest text on it ("Coach's tip:", 14 px muted, last line,
below the fold at 1024×768), and the coaching copy says "tap E"/"Hold E" even on a tablet. The page heading
"Shift done." repeats the card's headline. The shift stats are one dense " · " line under "Your shift".

**Lazy chunks.** MyShift, CareerEvening and HandsOnShift (84 kB) are `React.lazy` with a bare "Loading…" line; a
blank flash between screens on a slow tablet.

**Handover modal.** Code-read (needs a saved-up career): one big "Let's open →" button, perks list, consistent with
the other modals. No findings.

### Findings

| # | Sev | Where | Finding |
|---|---|---|---|
| A1 | **P1** | Hands-on | No touch input: on an iPad she cannot walk, cook or serve (keyboard/gamepad only; canvas taps do nothing). |
| A2 | **P1** | Hands-on | No first-shift onboarding: the slip → station → pass loop is never shown whole, and the clock runs while she works it out. |
| A3 | P2 | Hands-on, 1024×768 | HTML shift bar wraps to three rows; world drops to 23 px tiles; clock and points are shown twice; key hints shown on touch. |
| A4 | P2 | Hands-on | "Your station" not marked on the floor (only the rail tag and a sentence on My shift). |
| A5 | P2 | Hands-on | Waiting reads only from numbers/thin strips: 4 px slip strip, thin patience arc, "7/8" bubble the loudest mark. |
| A6 | P2 | Hands-on / tablet | Canvas tiles are 23–33 px: stations and slips are below a 44 px touch target. |
| A7 | P2 | Score card | Stars are the hero but "what to try next" is the smallest text, last, below the fold at 1024×768; no sentence ties advice to the night's numbers; h1 repeats the headline. |
| A8 | P2 | Score card, canvas hints | Coaching and canvas prompts say "E"/"Hold E" on a tablet. |
| A9 | P2 | My shift | Disabled promotion/mentor reasons only in `title` tooltips (invisible on touch), 2.68:1. |
| A10 | P2 | My shift, hands-on, start picker | Tap targets under 44 px: promotion/raise/mentor 34 px, weekdays 40 px, Pause/Skip 34 px, Back 34 px. |
| A11 | P2 | Watch (B's Service.tsx) | "Play my shift" is a 34 px small button; "Break" (28 px) on the read-only career view. *Handed to B.* |
| A12 | P3 | Hands-on | Sous chef's name tag over the "PASS" label (R6). |
| A13 | P3 | Hands-on | Sous walk is a replay: he reaches the rail after the slip left (R6). |
| A14 | P3 | Hands-on | NPCs drawn through the player (R6). |
| A15 | P3 | Hands-on | "Covered by the sous chef" toast rises through the heads at the pass. |
| A16 | P3 | Lazy chunks | Bare "Loading…" text fallback; blank flash between career screens. |
| A17 | P3 | Start picker | Career start button ~1,400 px down at 1024×768, not sticky. |
| A18 | P3 | Evening | Shift stats as one dense " · " line; "bond -1" jargon in the team card. |
| A19 | P3 | My shift | "You're on today" explains slip colours in 30 words before she has seen a slip (the onboarding should carry it). |

Counts: **P1 2 · P2 9 (one handed to B) · P3 8.** Header items (Save & quit 34 px, Settings 32 px) are C's StatusBar and
are not counted here.
