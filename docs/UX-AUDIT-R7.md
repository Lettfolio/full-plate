# Round 7 UX audit

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
