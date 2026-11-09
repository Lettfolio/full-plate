# Round 7 UX audit

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
| C18 | P3 | At 1024 the header wraps the district onto a second line. | Open (readable; a shorter date format would fix it). |
| C19 | P3 | Empire KPI row: six caps cards with long sub-lines. | Open (the side tabs now carry the heroes; the row could drop to four). |
| C20 | P3 | Ownership colours (tomato / amber / plum) are colour-only on the map and bars. | Open (the legend and aria-labels name them). |
| C21 | P3 | The owner start asks difficulty twice (picker, then lease). | Open (preselected, so harmless). |
| C22 | P3 | 1024 px: the menu matrix's SVG labels render at 12.4 px; the planning heading squeezes with five tabs. | Handed to B (Planning). Tabs are narrower at ≤ 1180 px; with Bigger text they drop their icons and the Menu tab's columns may shrink. |

**Counts:** 5 P1 (all fixed), 9 P2 (all fixed), 8 P3 (3 fixed, 1 accepted, 4 open, of which one handed to B).

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
