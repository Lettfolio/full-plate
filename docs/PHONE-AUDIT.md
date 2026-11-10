# Full Plate on a phone — audit (Round 12, builder D)

Question: does the game work on a phone? Short answer after this round: **yes for everything except the hands-on
kitchen upright and four things that need code rather than CSS** (listed at the end with estimates).

How it was measured: the layout probe (`pnpm --filter @full-plate/game probe`) now also runs two phone viewports,
Playwright's iPhone flags at the iPhone 14's full screen: **390×844 upright** and **844×390 sideways** (`isMobile`,
`hasTouch`, 3× scale, Mobile Safari user agent; `scripts/lib/harness.mjs parseViewports/contextFor`, an `m` suffix in
`FP_PROBE_VIEWPORTS`). Same walk as the tablet/desktop runs (every screen), Normal and Bigger text. Screenshots and contact
sheets: `scratchpad/shots/r12/D/` (`00-contact-probe-390x844-normal.png`, `00-contact-probe-844x390-normal.png`: every
probed screen; `00-contact-portrait/landscape.png`: the playtest).

## Before (master `496776e`, Normal text)

The R11-D tablet layout (≤ 1023 px) already did a lot of the work: nothing was broken sideways, the header wrapped, the
service floor stacked over its panel. On a phone it still fell over in these places:

| Screen | 390×844 upright | 844×390 sideways |
| --- | --- | --- |
| Title, Your games, slot dialogs | 4 texts < 13 px (the shopfront's chalkboard and door sign, scaled down) | fine |
| Start picker | five role cards squeezed into one row (11-letter columns); **the "Choose a name" button could not be pressed** (the options grid lay over it) — the walk stopped here, so the lease screen was never reached | fine |
| Lease screen | districts 40 px wide (one letter a line) | fine |
| Planning, every tab | the tab row showed one tab and a half; the header ate 180 px; Popularity/Prestige's numbers printed over the loan figure | header 2 rows of a 390 px screen |
| Menu | 11 controls < 44 px (price steppers squeezed to 32 px) | fine |
| Menu matrix | 7 texts < 13 px (the chart's labels) | fine |
| Staff | sideways scroll 7 px (the staff room card) | fine |
| Stock | sideways scroll 99 px (the larder table, the Place order row) | fine |
| Restaurant | sideways scroll 105 px (the floor plan's side column) | fine |
| Settings, save mark | sheet fine, but the dock and hints sat over it | the dock over the sheet |
| Service | canvas: 17–20 labels < 13 px | floor squashed under a 2-row header; **walk stopped** (Speed 4× under the dock) |
| Evening, fork card | fine (one column since R11-D) | fine |
| Game over | card 425 px on a 390 screen | fine |
| Empire (all panels), board minutes, maps | sideways scroll 50–54 px (six stat tiles); city map 249 px | fine |
| Career: my shift | two columns, 641 px wide; **walk stopped** before the hands-on shift | fine |
| Hands-on shift | not reached | kitchen letterboxed into ~150 px under the header and the shift bar |

Totals (before): 390×844 reached 32 of 39 screens, 9 with sideways scroll, 35 texts < 13 px, 61 canvas labels < 13 px,
45 covered controls. 844×390 reached 34 screens, 0 sideways scroll, 0 small text.

## What changed (all CSS except one small card)

`packages/game/src/phone.css`, loaded always, every rule behind one of two queries (`lib/layout.ts PHONE_QUERY`
`(max-width: 480px)` and `PHONE_LANDSCAPE_QUERY` `(max-height: 500px) and (orientation: landscape)`), every selector
prefixed `html ` so a lazy chunk's CSS can't override it by load order. A test fails if a rule escapes the two blocks.

- **Upright**: the page scrolls as one (the header scrolls away; service keeps its fixed frame); a compact header
  (name + buttons, date, cash | loan, the two bars on one row); **planning tabs are a bottom tab bar** (icon over word,
  badge on the icon) with the dock (hints + Open for service) sitting on it; one column for the start picker (role
  cards as icon + text rows), lease, districts, staff room, floor plan, career shift, KPI rows; seven 44 px day buttons
  fit the staff card; steppers keep 44 px; button rows wrap; the larder table scrolls inside its own box; the city
  board wraps two districts a row; Empire stat tiles two a row; dialogs are bottom sheets and Settings / wide dialogs
  full screen, above the dock and the tab bar; the shopfront's two small chalk words are hidden (the art stays).
- **Sideways**: the header goes back to one row; service puts the floor and its panel side by side at full height;
  the dock is one row; the hands-on kitchen gets the header's height (its own bar keeps Pause and Skip).
- **Hands-on upright**: `components/RotateCard.tsx` — "Turn your phone sideways", an `aria-modal` dialog mounted by
  App during a hands-on shift on an upright phone. HandsOnShift already holds the shift while any `aria-modal` is
  open (`lib/modal.ts`), so the clock stops until the phone turns; "Play it upright anyway" lets her carry on.
- `theme.css` loses `body { min-width: 1024px }` (it only ever applied below 1024, where R11-D already reset it).

## After

Probe totals (now in `scripts/probe-baseline.json`; the tablet/desktop rows are unchanged):

| run | screens | targets < 44 (all glossary words) | text < 13 | canvas text < 13 | contrast | sideways scroll | covered | under the dock | tips widen page | errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 390×844 Normal | 32 → **40** | 364 (323) → 333 (330) | 35 → **7** | 61 → 89 | 2 → 4 | 9 screens → **0** | 45 → 7 | 11 → 29 | 7 → **0** | 0 |
| 844×390 Normal | 34 → **39** | 381 → 394 (394) | 0 | 0 → 59 | 3 → 5 | 0 | 15 → **0** | 16 → 5 | 0 | 0 |
| 390×844 Bigger | — → 40 | 329 (326) | 7 | 89 | 4 | 0 | 0 | 26 | 0 | 0 |
| 844×390 Bigger | — → 39 | 393 (393) | 0 | 61 | 5 (+2 live) | 0 | 0 | 4 | 0 | 0 |

How to read the rises: **screens** — every step of the walk now completes (40 upright: the extra one is the turn-sideways
card), so more screens are counted; **canvas text** — the walk now reaches the hands-on shift and both service frames
on a phone (see "Not fixable"); **contrast** — the same star/dot glyphs the desktop runs count (4), plus the Stars
tab's "inspectors about" line sideways; **under the dock** — controls behind the sticky dock / bottom tab bar at the
probe's scroll position, reachable by scrolling (focus and scroll-into-view now stop above them:
`scroll-padding-bottom`). The 7 small texts upright are the menu matrix's labels; the 2–3 non-word targets upright are
two disabled steppers and one rota day half under its check mark on the career shift card.

Per screen, upright 390×844: **no sideways scroll on any of the 40 screens** (Normal and Bigger), all tips stay on
screen (they show as a card along the bottom), every non-term control ≥ 44 px except the two disabled steppers.

Playtest (built dist, iPhone 14 descriptor, taps): title → New game → start picker → Choose a name → lease (name,
Sign the lease) → each planning tab → Settings → six dishes → Open for service → Skip to evening → Next day → day 2;
then sideways: planning, service, Jump in "On the floor", the how-to, the shift; turned upright mid-shift the card came
up and the clock held (13:00 → 13:00 over 3 s), turned back it ran on (13:10). 0 page errors, 0 sideways scroll on
every screen checked. Shots `scratchpad/shots/r12/D/01…19`.

## Not fixable in CSS — the owner's call

| Thing | What's wrong on a phone | What it would take | Estimate |
| --- | --- | --- | --- |
| **Canvas density** (service floor, decorate preview) | At 390 wide the floor is drawn at ~0.4× its 1024 size: table numbers, "No chef: you're cooking!" and the shopfront sign fall under 13 px (CANVAS_UPRIGHT labels); sideways it's fine | A phone camera in `canvas/RestaurantView`: draw the room bigger and let it pan (or drop the street strip and enlarge labels below a width). Canvas is A's area | 1–2 days |
| **Menu matrix** | The chart's axis words and dish names scale below 13 px upright (7 texts) | A phone variant: the four quadrants as lists, or a fixed-size chart that scrolls | ½ day |
| **World / city map** | Works and doesn't scroll sideways now, but it's small, and there's no pinch or drag — only the zoom buttons | Touch pan + pinch on the map SVG | 1 day |
| **Hands-on shift controls** | Upright: unplayable by design (the card). Sideways: playable, but the kitchen is letterboxed to about 450×200 px and the USE/Drop pads cover its right edge | A phone layout in the handson renderer (bigger tiles, a camera that follows the cook, pads in the side margins). Render only, no sim change | 2–3 days |
| Service panel collapse | The brief wanted the panel below the floor collapsible; that needs a toggle button in Service.tsx (A's file, and D may only add class names) | A `<details>`-style toggle | 1 hour |
| Header "⋯" sheet | Done as a compact, scroll-away header instead; a real "⋯" sheet needs a button in StatusBar | A button + sheet | 2 hours |
| Glossary words as targets | Still ~70 inline terms under 44 px on day-1 Menu (R11.11 item 1, same on every width) | A taller invisible hit area | ½ day |
