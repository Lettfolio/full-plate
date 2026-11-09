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

### Status after the fixes (round 7, A)

| # | State |
|---|---|
| A1 | Fixed: tap to walk, press to use, USE/Drop buttons; a touch-only playthrough grabs, chops and cooks (`touchplay.cjs`). |
| A2 | Fixed: three-step onboarding, once per save and role, Skip, replay from **?**. |
| A3 | Fixed: one-row bar at 1024 px; 32 px tiles (were 23). |
| A4, A5 | Fixed: Yours outline/tab; mood faces, thicker ring, slip wait bars. |
| A6 | Fixed: hit targets padded to ≥ 44 px. |
| A7, A8 | Fixed: score card spans the evening, "Next shift, try this" hero with a sentence from the night's numbers; USE wording on touch. |
| A9, A10 | Fixed: reasons as text; 44 px controls (header Settings is C's). |
| A11 | Fixed in the review (`0f0f195`, `fdecf73`): no Break buttons on the read-only watch view (`StaffStrip readOnly`), "Play my shift" a 52 px primary. |
| A12–A16, A18, A19 | Fixed. |
| A17 | Fixed in the review (`2733d51`): the start button is pinned bottom-right in an action dock with the choices summed up (≤ 768 px from the top at 1024×768, both text sizes). |

## B. Owner daily loop

Surface: Planning (Menu, Staff, Stock, Restaurant tabs, notices, goals, the open bar), Service (canvas, HUD, incidents,
speed, ticker, manager's actions), Evening (tip, restock, takings, KPIs, dish picks, incidents, reviews, team), the
morning post (EventModal) and GameOver.

**Method.** The built dist under `vite preview --port 4791` (private), Chromium via Playwright at **1280×800** and
**1024×768** (iPad landscape). Saves: round 6's tip evenings (`shots/r6/c/saves/{rota,dog}.json`,
`shots/r6/review/saves/overstock-order.json`; hard, days 21–154) and the audit generator's `owner-planning` /
`gameover`. From the rota evening: Next day → each planning tab → Open for service → 10 s at 1× → 4× → pause → the
evening after. Script `shots/r7/b/shoot.cjs`; shots in `shots/r7/b/before/` (`report.json` holds every offender). In-page
probe: interactive elements under 44 px in either dimension, DOM text under 13 px, text contrast under 4.5:1 against
the nearest opaque background. 0 page errors.

Probe totals before (1280 / 1024): text < 13 px **0** everywhere (round 5 holds). Targets < 44 px: Menu 22 / 12,
Staff 16 / 15, Stock 9 / 8, Restaurant 8 / 8, first-day Menu 30 / 20, Service 12 / 12, Evening 6–7, GameOver 3.
Contrast < 4.5:1: Restaurant tab 6 (the white table numbers on tan, **2.53:1**), the matrix legend dots 2.1–3.5:1
(decorative glyphs).

### Screen by screen

**Planning, every tab.** First sight: the status bar, then "MORNING / Get ready for Thu", the tabs, then up to three
notices (stock warning, worn-out owner, short delivery) that are full-width and 80–130 px each, then the goals column
and the tab. **The one button that moves the day on, "Open for service →", is below the fold on every tab at both
sizes**: at 1280×800 with two notices it starts ~1,450 px down on Menu. A child must know to scroll to the bottom of a
recipe book to find it. The status-bar strip carries day and cash, but nothing on the page says where this screen sits
in the day (the eyebrow "MORNING" is the only hint; Evening uses "EVENING · DAY 22 · …" in the same caps style and puts
its primary button top-right instead).

**Menu.** First sight: the menu-engineering matrix, a 2×2 with four quadrant names (Puzzles, Stars, Dogs,
Plough-horses) and dots. To act (change a price, rest a dish, add one) she has to look past it to the list on the
right. The matrix is a good expert tool and a poor first screen for a 10-year-old. Each dish row has five targets; the
price stepper buttons are 30×30, "Rest" 59×34 and the ✕ that **removes the dish** (no undo, no confirm) is 32×32 and
8 px from "Rest".

**Staff.** First sight: big person cards with four bars each. To act on the rota she taps 69×30 day toggles. The
"Who's on each day" grid below the cards is a table of 1s and 2s with a red 0; nothing says a **2 means two people
doing one job** — the doubled-up shift the round-5 diagnosis found is what loses hard mode (typical/hard 0%,
learner-rota 33%). Today the only place that says so is the evening tip, and only after a losing fortnight.

**Stock.** First sight: a callout and a seven-column table with caps headers. **Raw floats**: on hand "23.56",
"16.508", and "▲ ~31 needed, short 7.440000000000001" (stock is fractional after service; the cells print it as is).
"Needed for menu" is the sim forecast, but the sentence a child needs — *you'll need about 31, you have 23* — has to
be assembled from two columns. Stepper buttons 30×30.

**Restaurant.** Table chips are white numerals on tan (#c99a63), **2.53:1**.

**Service.** First sight: the canvas (good: people walk, tables ring, "Hmph!" and a storm cloud when a party walks
out). The HUD: the clock card, then four caps counters (GUESTS, REVENUE, WALKOUTS, RATING) at 22 px with no trend or
icon, and the queue is only in the ticker header ("15 queueing · 4 tables in", 14 px). A walk-out bumps a number with
no flash. Speed is "❚❚ 1× 2× 4×" in a pill group that reads like a filter toggle, not a play control. Break buttons
62×28, Jump-in buttons 34 tall, the goals bar 27 tall. When an incident card arrives it pushes the clock and speed
controls down; at 1024×768 the counters fall below the fold. The 4× incident toast sits bottom-centre over the queue on
the pavement (Toast is shell, agent C).

**Evening.** First sight: "A tough night." and the tip card (good: tip first, Why?, one-tap action all work). **What
she doesn't see is the money**: tonight's profit or loss is the last row of an accountant's table (VAT, bills & card
fees, prep trimmings, % of revenue) in the lower-left, ~900 px down. No comparison with yesterday or the week, so
"tough" has no size. Four caps KPI tiles; "Next day →" top-right (Planning's is bottom-right). Hire → and Restock are 34
and 43 px tall.

**Morning post (EventModal).** Fine: big choice buttons (≥ 60 px), effect chips coloured up/down. Chips have colour
only (no ▲/▼), "footfall" is used bare.

**GameOver.** First sight: a key, "X has closed its doors", the bank's rule ("Cash stayed below the bank's limit for N
days"). Nothing says *why* the cash went: no look at what she spent it on. Buttons "Try again (same seed)" / "New seed"
use a developer word. There is no "last Monday" save to go back to (the save is deleted at game over and there is no
per-week snapshot).

### Findings

| Sev | Where | Finding |
|---|---|---|
| **P1** | Planning | "Open for service" below the fold on every tab at 1280×800 and 1024×768; no fixed place for the day's one primary button. |
| **P1** | Evening | Tonight's profit/loss is not visible without scrolling; it lives in the last row of a table of tax and bills. No week context. |
| **P1** | Stock | Raw floats in On hand and Needed ("16.508", "short 7.440000000000001"). |
| **P1** | Staff | Doubled-up shifts (the hard-mode killer) are invisible on the Staff tab; the coverage grid's "2" has no meaning attached. |
| P2 | Planning/Evening/Service | The three beats don't read as one day: different headers, primary button top-right on Evening and bottom-right on Planning, no "where am I in the day". |
| P2 | Menu | The matrix is the first thing on the tab; a plain "today's menu" list should lead, the matrix should be an opt-in expert view. |
| P2 | Menu | The ✕ that removes a dish (no undo) is 32 px and 8 px from "Rest". |
| P2 | Stock | No one-line forecast per ingredient; need vs have has to be read across two columns. |
| P2 | Service | Live counters are small caps labels without icons or trend; the queue is buried in the ticker header; a walk-out doesn't flash. |
| P2 | Service | Speed controls look like a filter toggle; no play/fast-forward metaphor. |
| P2 | All | Tap targets < 44 px: buttons 34, small buttons 26–28 (Show me, Break), steppers 30, rota days 30, ✕ 32. |
| P2 | Restaurant | Table numbers 2.53:1 contrast. |
| P2 | GameOver | The cause is the bank's rule, not what went wrong; "seed" wording. |
| P2 | Micro-feedback | Ghost buttons have no pressed state; money changes jump with no motion; nothing marks which control just did something. |
| P3 | Evening | Four caps KPI tiles; "% of revenue" percentages; Hire → / Buy a table → 34 px. |
| P3 | EventModal | Effect chips colour-only (no ▲/▼); "footfall" bare. |
| P3 | Service | 4× incident toast covers the queue at bottom-centre (shell; agent C). |
| P3 | Goals sidebar | Hint text wraps to ~90 px beside the reward chip at 1280 (6-line hints). |
| P3 | Menu | Matrix legend dots 2.1–3.5:1 (decorative glyphs; labels carry the meaning). |
| P3 | Planning | Inline glossary words (`<Term inline>`) are 17 px tall targets (inline text: exempt, noted). |

**Counts:** 4 P1, 10 P2, 6 P3.

**After (round 7 B, see UI-NOTES "Round 7 — B"):** all 4 P1 and the 10 P2 fixed in this surface, plus the EventModal
and goals-sidebar P3s. Open: toast anchoring and the shell's 34/32 px buttons (agent C), inline glossary targets
(exempt), "last Monday" retry (no weekly save exists). Shots `shots/r7/b/after/`.

**Status after the review (REVIEW.md "Round 7"):** toast anchoring fixed (`738142a`: during service the toast sits on
the floor's top edge, never over the queue or the speed deck; elsewhere bottom-centre above the dock, no overlap at
1280/1024 × normal/Bigger). The shell's buttons are ≥ 44 px (Settings 44, Save & quit moved into the sheet). The
1024 px matrix labels (C22) are fixed by a one-column Menu at ≤ 1180 px (smallest label 17.9 px). Still open: the
"last Monday" retry; inline glossary words (exempt); matrix legend dots (decorative).

## C. Shell, onboarding, Stars and Empire

Surface: TitleScreen, StartPicker, NewGame, the header (StatusBar + Settings), Tabs, Toast, HelpPopover, Term, the fork
card, the guide-day envelope, the Stars tab, the Empire tab (map, KPI row, My shops / The brand / Money) and its board
meeting card, and the WinScreen.

**Method.** The built dist served on a private port, Chromium via Playwright at **1280×800** and **1024×768** (iPad
landscape). Saves: the type-audit saves (`owner-planning`, `fork-evening`, `stars`, `empire`, `empire-board`, `win`),
plus `stars-nights` (the `stars` save with a 60-night window and guide day 54 days off, so the strip and inspection
season show). Flow: fresh title → title with a save → New game → start picker → career start → lease → first day →
settings → fork → Stars → Empire (3 tabs, year-1 and year-4) → board card → win. Each screen is probed in the page for
interactive elements under 44×44 px, DOM/SVG text under 13 px, text contrast under 4.5:1 (3:1 large) against the
nearest opaque background, and horizontal overflow of the page *and* of the scrolling `.screen`. Script: scratchpad
`r7c/shots.mjs`; shots and `metrics.json` in `shots/r7/c/before/` and `after/` (plus `after-large/` with Bigger text).
0 page errors before and after.

Probe totals over 17 screens × 2 sizes: **before** 1,057 targets under 44 px (362 in the year-4 Empire's site list), 6 low-contrast runs,
6 sub-13 px runs (all at 1024 in the Planning menu matrix, agent B's), 40–137 px of sideways scroll on 8 screens;
**after** (20 screens × 2) 460 targets, of which on this surface only the Empire/Stars ± steppers (37 px wide, fixed
in the last pass to 44); the rest are B's Planning/Evening controls below the header. 0 overflow; the same 1024-only
matrix labels.

### Screen by screen (before)

**Title.** First sight: a plate logo, "Full Plate", a tagline, a red Continue. The save sits underneath as small grey
text, detached from its button. "New game" is a plain 43 px pill and replaces the save without asking once the new
game starts. Nothing anywhere says what the game is *for*: the two endings are first described on the fork card a
year into play. Visually it is pleasant but generic (two pale circles on cream).

**Start picker ("Start as…").** Five cards, good. To choose she must read lines written for adults: "Commis…
stations, timing", "Bar back to general manager", "the tronc". The road length is caps-locked grey text. Difficulty is
three radio rows that look like a form; nothing marks Cosy as the kind one. "← Back" 34 px.

**Lease (NewGame).** Rich and readable. Difficulty asked a second time (preselected). Seed refresh 32×32.

**First day / the shell.** The header reads as a dashboard: CASH, popularity/prestige bars, LOAN LEFT in caps, a
`cosy` pill, "Save & quit" and a 32 px ⚙ with two options. No trend on the cash. Tabs are words only; the active tab
is a thin underline. At 1024 the district name wraps and the loan line runs to the edge. Save, load and new game live
in three places (header, title, game over) and there is no text-size or sound setting.

**Settings.** A 340 px popover: one checkbox (18 px box) and three 32 px speed chips.

**Fork.** Two well-written halves with emoji pairs; the win conditions are the third bullet each. Nothing to open for
"what does winning look like?".

**Stars tab.** First sight: five equal guide cards, four of them "—". The countdown to guide day is a 14 px line in
the first card; "What's holding you back" is the first card below the row, next to Test kitchen. Steadiness is a bar
with no history, so "every night counts" has nothing to point at. The empty star glyphs are 1.1:1 (decorative, the
row has an aria-label). The "Also worth a look" summary is 20 px tall.

**Empire tab.** Six KPI cards in caps with long sub-lines. The side panel's My shops lists **every** shop: on the
year-4 save that is 72 site cards and a 15,700 px page (182 small targets). None of the three side tabs has a hero
number or anything chart-like apart from the recognition bars. Franchise verdicts are coloured 14 px text. City pins
are 34–55 px wide targets. Hidden `<Term>` tooltips (visibility:hidden, max-content) widen the page by 40–137 px on
Planning and the Empire: a sideways scrollbar inside the screen.

**Board meeting card.** Well-written, but it looks like a form: the money list, the worry and the question all have
the same weight, the options are flat recipe-book cards, and the board's tip is a grey line under them. "Skip this one"
34 px.

**Win screen.** A plain card: icon, caps kicker, title, six KPI tiles (left-aligned values under centred labels). No
celebration, no sense of the road travelled, nothing to keep. Two buttons.

### Findings

| # | Sev | Finding | State |
|---|---|---|---|
| C1 | **P1** | The two endings are explained nowhere before the fork (title, start, help). | Fixed: "How do I win?" on the title and the fork — two pictures, three lines each. |
| C2 | **P1** | Empire › My shops lists every shop (72 cards, 15,700 px page on the year-4 save). | Fixed: the picked city's shops, the one you run first, five at a time with "Show all N". |
| C3 | **P1** | Stars: the countdown is a 14 px line; steadiness has no history; the hero row is mostly "—". | Fixed: the countdown + year strip (inspection season, today) and "What's holding you back" are the hero; the last 60 nights as a strip; other guides below. |
| C4 | **P1** | Shell/start/path tap targets under 44 px (⚙ 32, Back 34, seed 32, toast ✕ 32, Skip 34, steppers 37, map pins, summary 20). | Fixed on this surface (`--tap`, `.btn--tap`, `.iconbtn--tap`, pin hit circles). |
| C5 | **P1** | Hidden Term tooltips add 40–137 px of sideways scroll on Planning and the Empire. | Fixed: `display:none` until hover/focus; right-anchored in the Empire side panel and header. |
| C6 | P2 | Title: the save is detached grey text; New game replaces it without asking; generic art. | Fixed: original SVG shopfront; Continue is a big card carrying the save; New game asks first. |
| C7 | P2 | Start picker copy uses trade words; road length in caps; difficulty reads as a form. | Fixed: plain lines, "what you play", a 3-pip road meter, three big difficulty toggles (🧸 / 🙂 / 🌶️), "Who do you want to be?". |
| C8 | P2 | Header is a dashboard: no cash trend, Save & quit and ⚙ apart, no text size or sound. | Fixed: day chip, cash with ▲/▼ yesterday, one Settings button → sheet (text size, sound, speed, pause, save-and-quit, new game with confirm). |
| C9 | P2 | Tabs are words only; the active tab is a thin line. | Fixed: icon + word on every tab, a stronger active state, 48 px tall. |
| C10 | P2 | Empire side tabs have no hero number or chart. | Fixed: My shops (shops open + bars by city, tap to pick), The brand (regions that know you vs the win line + meals line), Money (HQ's 30 days + a bar per month from the minutes). |
| C11 | P2 | The board card reads as a form. | Fixed: a dated banner, a bar under each money line, the decision in its own amber box with a bigger question, option cards with "💡 The board's pick". |
| C12 | P2 | Franchise verdicts are coloured text. | Fixed: coloured badges with 👍 / 😐 / 👎. |
| C13 | P2 | Win screen is a plain stats card. | Fixed: confetti (reduced-motion off), the final figure, the journey (opened, the fork, first franchise / 100th shop / first star / three stars, the ending), Save a picture (canvas PNG). |
| C14 | P2 | No sound and no way to turn it on or off. | Fixed: tiny Web Audio blips (good toast, fork, envelope, win), Settings › Sound. |
| C15 | P3 | Empty star glyphs 1.1–1.3:1. | Accepted: decorative, the count is in the aria-label and the filled stars carry it. |
| C16 | P3 | Guide-day table squeezes five scores into one cell. | Fixed: a column per criterion. |
| C17 | P3 | Fork card uses emoji pairs; toast ✕ 32 px. | Fixed: the explainer's pictures; toast badge + 44 px close. |
| C18 | P3 | At 1024 the header wraps the district onto a second line. | Fixed in the review (`2733d51`): the district wraps as a whole name, never mid-name. |
| C19 | P3 | Empire KPI row: six caps cards with long sub-lines. | Open (the side tabs now carry the heroes; the row could drop to four). |
| C20 | P3 | Ownership colours (tomato / amber / plum) are colour-only on the map and bars. | Open (the legend and aria-labels name them). |
| C21 | P3 | The owner start asks difficulty twice (picker, then lease). | Fixed in the review (`2733d51`): the lease shows the picked difficulty with a Change button. |
| C22 | P3 | 1024 px: the menu matrix's SVG labels render at 12.4 px; the planning heading squeezes with five tabs. | Fixed in the review: the Menu is one column at ≤ 1180 px (labels ≥ 17.9 px; C's large-text `.menu-layout` rule removed, `2733d51`); the day strip has its own row above the tabs at every width (`924b338`). |

**Counts:** 5 P1 (all fixed), 9 P2 (all fixed), 8 P3 (5 fixed, 3 of them in the review; 1 accepted; 2 open: C19, C20).

### The shell as a whole

- **Identity.** Before: a warm palette but a dashboard's grammar (caps labels, KPI tiles, a form-like start). After: one
  motif carried through — the shop awning (a red-and-cream stripe on the title, the header, the win screen) and the
  shopfront on the title — with Fredoka for every hero number. Dashboard tiles remain in the Empire KPI row (C19).
- **Navigation.** Tabs now have a picture and a word each and a clear "you are here". Every game-level action (text
  size, sound, speed, pause, save and go to the title, start again) is in one Settings sheet behind one labelled
  button; quitting mid-service is explained instead of hidden.
- **Save / load / new game.** Saving is automatic (said in the sheet); loading is Continue on the title (the save is in
  the button); a new game asks first from both the title and the sheet.
- **The two endings** are explained on the title ("How do I win?") and again from the fork, in pictures and three
  lines each.
