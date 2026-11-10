# Restaurant Manager Game — Design & Technical Brief

Nov 8, 2026 · @Daniel Potts

## Vision & pitch

**Working title: Full Plate.** A restaurant management sim where every player opens the same scruffy first restaurant, and the game slowly reveals that there are two ways to "win" — and that they pull in opposite directions.

**One-line pitch:** *Two billion served, or two Michelin stars. You can't have both.*

The player starts with a single leased unit, a tiny menu, two staff and a bank loan. Around year two the game asks a real question: do you want to be **everywhere**, or do you want to be **the best**? From that point the two paths diverge in mechanics, pacing and feel:

|  | Path A — The Empire | Path B — The Stars |
| --- | --- | --- |
| Fantasy | Build the next McDonald's | Build the next Noma or The Fat Duck |
| Scale | 1 → 10,000+ locations across 40 countries | 1 → a hand-picked group of 2–6 restaurants |
| Core verb | Replicate and systemise | Refine and obsess |
| What you optimise | Unit economics, throughput, brand recall, real estate | Critic scores, sourcing, staff brilliance, consistency |
| Pace | Snowballs; late game is a map and a spreadsheet | Stays intimate; late game is one service at a time |
| Antagonists | Rival chains, franchisee revolts, scandals, saturation | Inspectors, burnout, a head chef who leaves to open their own place |
| Win condition | Serve a billion meals / brand recognised in every region | Hold three stars across the group for five consecutive years |

The two paths share the first act, the staff system, menu engineering and the reputation engine, so the game is one game, not two bolted together. A run is 10–20 hours; players who finish one path immediately want to try the other.

**Audience.** Primary: management-sim players aged roughly 12+ on PC (Steam), with a Switch port in mind. The brief originated with a daughter (she is 14) who wants a restaurant/chef game, so the target is 12+ / teen: the tone is warm, dry and non-violent, never babyish, with a cosy early game for anyone who wants it. Real trade words are used and explained on tap (Round 11b). Depth arrives gradually; the first hour should feel like *Good Pizza, Great Pizza*, the tenth like *Two Point Hospital*, and the twentieth like running a real business.

**Design pillars**

1. **Restaurants are made of people.** Staff have names, moods, skills and ambitions; losing a good chef hurts.
2. **The customer is always visible.** Every queue, every empty table, every plate sent back is something you can watch.
3. **Ambition has a cost.** Growing fast makes food worse; chasing perfection makes money worse. The game never hides this trade-off.
4. **Real-world truth, cartoon surface.** Numbers borrow from real restaurant economics; the look stays friendly and legible.

## Market & competitors

**The gap is clear: no restaurant game lets you franchise, and no restaurant game treats critics as a strategy layer.** Cooking games are crowded (Overcooked passed 100M players across the series; Cooking Simulator 4M+ copies), and cosy restaurant life-sims are growing, but the "run a food business at scale" fantasy and the "earn and keep a star" fantasy are both open. [Chef Life](https://www.gamedeveloper.com/press-release/get-cooking-chef-life-a-restaurant-simulator-arrives-on-consoles-and-pc-in-autumn-2022-in-collaboration-with-the-michelin-guide) holds an official Michelin licence yet players call its business side light and its late game repetitive — the Michelin fantasy has been claimed but not delivered.

| Title | Platform, price | Signal | Praised | Complaints | Audience |
| --- | --- | --- | --- | --- | --- |
| [PlateUp!](https://www.gamedeveloper.com/press-release/plateup-reaches-1-5-million-steam-copies-sold) (2022) | PC, consoles, Game Pass; $19.99 | 1.5M Steam copies by Feb 2024; 96% of 12.7K reviews | Roguelite runs, automation, 4-player co-op | Long runs | All ages, streamers |
| Overcooked 2 (2018) | Everywhere; $24.99 | 93% of 14.7K reviews; series 100M+ players | Chaotic couch co-op | Stressful | Family party game |
| [Chef Life](https://datahumble.com/chef-life-a-restaurant-simulator-1122340) (2023) | PC, consoles; $39.99 list, often $6 | 84% of 2.9K reviews; Michelin licence | Realistic cooking, plating | Grindy late game, light management | Teens and adults |
| [Recipe for Disaster](https://gameinformer.com/review/recipe-for-disaster/an-appetizing-restaurant-management-sim) (2022) | PC; $14.99 | Mixed, 69% of 592 reviews | Staff traits, emergent stories, recipe editor | UI overload, idle staff AI | Adults |
| Chef: A Restaurant Tycoon (2020) | PC; $19.99 | 72% of 1.4K reviews | Recipe editor, skill trees | Runs thin | All ages |
| [Tavern Keeper](https://store.steampowered.com/app/436780/Tavern_Keeper) (EA Nov 2025) | PC; $29.99 | 94% of 3K reviews; 11 years, 6 rebuilds | Interacting systems, storybook events | Early Access scope | Cosy with depth |
| [Cook Serve Forever](https://felixonline.co.uk/articles/the-story-of-cook-serve-forevers-launch/) (2025) | PC, consoles; $29.99 | 69% of 336 reviews; developer called it a failure | Story, 400 recipes | Too easy; betrayed the brand | Cautionary tale |
| [Cooking Simulator 2](https://store.steampowered.com/app/2455360/) (Mar 2026) | PC; $24.99 | Mixed, 49% of 855 reviews | Co-op | Rough launch | Teens and adults |
| Good Pizza, Great Pizza (mobile) | Free, Apple Arcade | 300M+ downloads, 1M daily players | Funny customers, gentle pace | Slow premium currency | Children and preteens |
| [Roblox Restaurant Tycoon 2](https://rotrends.com/game/1214576306) | Roblox, free | 1.7B visits | Build, decorate, watch money grow | Pay-to-progress | The core under-13 audience |
| [Big Ambitions](https://newsletter.gamediscover.co/p/deep-dive-how-big-ambitions-hit-it) (1.0 2026) | PC; $25.99 | 93K wishlists at launch; 163K units in 20 days | Property choice, hiring managers to automate | — | The template for the Empire path |
| Restaurant Empire II (2009) | PC; $19.99 | 80% of 335 reviews | 600 recipes, 4 cities, buying rivals | Dated | The classic empire reference |

**Gaps this game fills**

1. **Franchising and multi-site management** — nobody models franchise partners, brand consistency, menu standardisation, entering countries or area managers. Roblox and idle games treat it as passive income only.
2. **Critics with teeth** — no anonymous inspectors on unknown nights, no consistency across visits, no losing a star, no head chef with a reputation of their own.
3. **Supply chain tied to the path** — central kitchen and distribution for the chain versus rare, seasonal, specialist suppliers for fine dining.
4. **Staff careers** — following a commis to their own star, or a crew member to franchisee; rivals poaching your people.
5. **Property strategy** — Big Ambitions proved players love choosing a building; no restaurant game makes drive-thru plot vs townhouse central.
6. **A mid-game fork** — late-game repetition is the most common complaint across the genre; a fork with two win conditions is built-in novelty.

**Market signals that shape the plan**

- Management sims are healthy but hit-or-miss: [Supermarket Simulator](https://datahumble.com/supermarket-simulator-2670630) made about $27M on Steam in 2024, while most of the 38 "Simulator" titles launched in August 2025 grossed under $70K. A distinctive theme and a streamable loop separate the two.
- "Cosy" rose from 0.4% to 3.1% of Steam games grossing over $100K between 2022 and 2025 ([PC Gamer](https://www.pcgamer.com/games/life-sim/the-cozy-game-boom-is-the-clearest-trend-on-steam-over-five-years-of-data)); the winners pair cosy with depth (Tavern Keeper, Two Point Museum).
- Co-op multiplies sales (Overcooked, PlateUp!), but only on top of solid fundamentals.
- PC price norm is $15–30; Switch matters for families (Stardew sold 7.9M of 41M copies there). Mobile has the scale but is almost entirely free-to-play, which conflicts with a family-safe design.
- Streamers, not press, sell this genre; Big Ambitions pitched about 1,000 creators and a French cascade drove its launch.

**What works for younger players** — visible physical progress (buildings and kit appearing, a map filling with pins), memorable customers and a mascot, decorating and self-expression (uniforms, logo, theme), a parent-and-child co-op option, no harsh failure on the easiest setting, pausable timers, and sessions of about 20 minutes. The Empire path suits a child's "make it bigger everywhere" instinct; the Stars path suits a perfectionist's craft. One **Cosy** difficulty softens both.

## Core loop & the shared first act

The game runs in **days**, each day a single service the player can watch at 1x, 2x or 4x, book-ended by a morning planning phase and an evening results screen. One in-game week is roughly 10–15 real minutes early on and compresses as the player delegates.

**The daily loop**

1. **Morning — plan.** Set today's menu and prices, confirm the rota, approve deliveries, read yesterday's reviews and any mail (inspector letters, landlord notices, supplier offers).
2. **Service — watch and nudge.** Customers arrive by footfall and reputation, queue, order, eat, tip and leave a rating. The player can intervene (comp a table, send a chef to help front-of-house, 86 a dish that's running out) but cannot play the kitchen directly — this is a manager, not a cook.
3. **Evening — learn.** A one-screen P&L (covers, average spend, food cost %, labour %, waste), the day's best and worst dish, staff mood changes, and a reputation delta broken down by source (walk-ins, online reviews, critics, word of mouth).
4. **Weekly — decide.** Payroll, rent, loan repayment, hiring, menu redesign, a small upgrade. This is where the ambition choice lives once it unlocks.

**The first act (years 1–2, \~3–4 hours).** Everyone plays the same opening regardless of eventual path:

- Choose a city district (student quarter, high street, business park, seaside) — footfall, rent and customer tastes differ.
- Sign a lease, fit out a small unit, take a bank loan with a fixed repayment schedule that creates early pressure.
- Build a menu of 6–10 dishes from a recipe library. Each dish has ingredient cost, prep time, skill requirement and appeal per customer type. **Menu engineering** (stars, puzzles, plough-horses, dogs) is the first real strategic system.
- Hire a cook and a server from a small candidate pool; staff have 3–4 visible traits and hidden potential that reveals over time.
- Survive the first winter: a slow month that teaches cash-flow management.
- Earn a first review from the local paper. Reputation now has two tracks — **popularity** (volume) and **prestige** (quality) — and the player starts to see them pull apart.

**The fork (end of year 2).** A story beat: a regional franchise consultant and a visiting critic both show interest in the same week. The player picks a path through what they *do* over the next few months, not a menu toggle — opening a second identical unit leans Empire; hiring a stagiaire from a starred kitchen leans Stars. The game confirms the path around year 3 and unlocks that path's systems. Hybrid play remains possible but suboptimal, which is the point.

## Path A — The Empire

**The Empire path is about building a formula, owning the land, and keeping hundreds of franchisees happy.** Its mechanics come straight from how McDonald's actually scaled: a cut-down menu on an assembly-line kitchen (the Speedee system, 1948), franchising from 1955, and — the part most people don't know — [Harry Sonneborn's real-estate engine](https://en.wikipedia.org/wiki/Harry_J._Sonneborn), where McDonald's controlled the land and sublet it to franchisees at a markup or a share of sales, whichever was higher. By 2015 property was about 99% of its assets. The game's late Empire is a landlord as much as a restaurateur.

**Systems unlocked on this path**

1. **The formula.** Lock a standard menu, kitchen layout and service script. Standardisation score rises with a training academy (McDonald's opened Hamburger University in 1961), drive-thru (now about 70% of US sales), and app ordering. Every new site inherits the formula; every deviation costs consistency.
2. **Ownership slider per region.** Company-owned (Chipotle: 100% owned, restaurant margin 26.7% in 2024, per [Chipotle's results](https://ir.chipotle.com/2025-02-04-CHIPOTLE-ANNOUNCES-FOURTH-QUARTER-AND-FULL-YEAR-2024-RESULTS)) means control and capital; franchised (McDonald's: about 95% franchised) means fast growth and less control; licensed (Starbucks in airports and campuses) and joint venture (Pret in the US) sit between.
3. **Franchise contract builder.** Fee (McDonald's: $45k for 20 years), royalty (4–5% McDonald's, 8% Subway), ad fund (4–4.5%), rent as a share of sales. Higher take per store means more money and fewer, angrier applicants ([terms](https://www.franchisechatter.com/2026/10/11/mcdonalds-franchise-review-2026-costs-fees-news-average-revenues-and-or-profits/)).
4. **Landlord mode.** Buy plots and lease them to your own franchisees. Debt is fixed; rent grows with sales, so the margin widens for years. The real end-game profit engine.
5. **Supplier handshakes.** Long-term exclusive suppliers (Simplot's fries deal with Kroc, 1967) cut costs but create single points of failure — McDonald's pulled Quarter Pounders from a fifth of US stores in the 2024 onion E. coli outbreak.
6. **Saturation curve.** Each new store in a city trims the sales of nearby stores. [Subway](https://abasto.com/en/news/subway-closures-hit-700-u-s-locations-in-one-year/) is the warning: 27,000 US stores at its 2015 peak, about 18,800 by 2026, average sales around $500k versus $1.4m at Jersey Mike's. Below a threshold, franchisees fail.
7. **Franchisee mood.** Discounting ($5 footlong petitions), forced remodels ($160k–$750k each in McDonald's 2018 dispute) and royalty rises lower it. Too low, and owners form an association that can block your decisions.
8. **Country entry puzzle.** Each country has dietary rules (no beef or pork in India; kosher in Israel), local champions (Jollibee in the Philippines), and a chance to invent a tradition (KFC became Japan's Christmas dinner). Geopolitics can force an exit: McDonald's sold 850 Russian stores in 2022.
9. **Product launch gamble.** A big campaign on a new item can flop if it fights the brand (Arch Deluxe, $200–300m); a franchisee's invention can outlive you (Filet-O-Fish beat Kroc's Hula Burger).
10. **The In-N-Out alternative.** No franchising, nothing frozen, every store within about 500 miles of a commissary. Slow, high-quality, cult brand — a legitimate way to play the Empire path small.

**Unit economics the sim uses.** Quick-service benchmark: food and packaging about 30% of sales, labour about 25%, occupancy about 5%, restaurant margin about 25%. A franchisee then pays rent, royalty and ad fund out of that, so the owner's cut and the franchisee's survival pull directly against each other — the central tension of the path.

**Risk events.** Food-safety scandal (Chipotle 2015: same-store sales −22%, four years to recover; Jack in the Box 1993: deaths, three years to profit), franchisee bankruptcies (three Burger King operators in 2023), overexpansion into a recession (Sonneborn resigned over exactly this in 1967).

**Win condition.** A billion meals served, or your brand present and profitable in every region of the map — with the company still solvent and franchisee mood above revolt.

## Path B — The Stars

**The Stars path is about one person's standards under scrutiny, and growth itself is the danger.** Stars depend on a head chef's personal judgement and on consistency across every service, and neither copies to new sites. The real pattern across the case studies is the same: one starred flagship, a handful of satellites that make the money, a test kitchen, and a cap on size — Gordon Ramsay's rapid expansion into hotels across four continents produced £8m of losses and an insolvency warning by 2009, while [Clare Smyth](https://en.wikipedia.org/wiki/Clare_Smyth) left his kitchen, opened Core in 2017, reached three stars in 2021 and has added just two more sites since.

**Systems unlocked on this path**

1. **Hidden inspectors.** Michelin inspectors book under false names, pay in full and eat out about 300 times a year; several visits by different inspectors precede any decision, and every restaurant is reassessed from scratch annually ([Michelin Guide 101](https://guide.michelin.com/en/article/features/the-michelin-guide-101)). In the game, inspectors are ordinary-looking customers on unknown nights; the score is on five criteria — ingredients, harmony of flavours, technique, the chef's personality in the food, and consistency — and the consistency score covers every service of the year, not just the good ones. Results arrive once a year on "guide day".
2. **The annual reset and the Fat Duck rule.** Stars are re-earned each year. Closing for a refit means no assessment and the stars lapse — [The Fat Duck](https://en.wikipedia.org/wiki/The_Fat_Duck) lost all three in 2016 for exactly this reason and won them back in 2017.
3. **Several prestige tracks at once.** Michelin stars (0–3); a World's 50 Best ranking voted by 1,100+ anonymous judges, where reaching No. 1 moves you to a hall of fame and out of the running (so you can only win once); Gault&Millau points out of 20 (never 20); a Good Food Guide tier; and a local newspaper critic whose review can double bookings overnight.
4. **The star bump.** A first star brings +20–30% demand (sometimes double), better job applicants and landlords offering sites. Losing one hurts less than players expect — which is itself a lesson the game can teach.
5. **Thin-margin finances.** Labour dominates: Midsummer House has had 35 staff serving 42 guests; the three-star [Waterside Inn](https://www.restaurantonline.co.uk/Article/2024/07/12/rising-costs-cause-profits-at-the-waterside-inn-to-sink/) turned over about £9m yet swung from an £814k profit to a £181k loss in 2023 on staff costs. Food runs 30%+, overall margin is roughly break-even to 5%, and wine (2–4x markup, graduated so cheap bottles carry more) and private events keep the lights on. El Bulli lost money from 2000 and survived on books and lectures.
6. **Ticketing.** Unlockable Tock-style prepaid seats with time-based pricing (premium Saturday, discounted Tuesday). No-shows fall and cash up front buys better produce from suppliers — the Alinea and Next model.
7. **Chef stress meter.** Rises with each star and each inspection season. At the top: hand back the stars (Marco Pierre White in 1999, Sébastien Bras in 2017), relaunch the concept (Eleven Madison Park going plant-based in 2021, Noma closing regular service in 2024), or burn out. Burnout, or a staff-treatment scandal like the 2026 Noma allegations, can collapse reputation in a season.
8. **The stagiaire dilemma.** Unpaid interns are cheap skilled labour with a growing reputation risk; paying them cost Noma about $50–70k a month. The player chooses, and the choice ages.
9. **The group cap and the Smyth arc.** Each new site lowers flagship consistency unless a trained head chef runs it. Your best head chef will eventually want to open their own place — you can back them (a friendly satellite and a loyalty bonus) or lose them to a rival who now competes for the same stars.
10. **Satellites.** A bar, a bistro, a rotating-theme ticketed room (Next). They earn cash and keep talent busy but never earn stars themselves. The Alinea Group is the template: a 64-seat flagship surrounded by The Aviary, The Office and Roister.
11. **Test kitchen and seasons.** A research tree where dishes developed in the lab raise personality and technique; a seasonal produce calendar limits which menus are possible; sourcing relationships with named farms and foragers (Noma) are built over years and lost in a season.
12. **Risk events.** A norovirus outbreak (Fat Duck 2009: about 400 ill, two weeks closed; Noma 2013: 63 ill) is a closure and a reputation crisis, not a sales dip — the same event lands completely differently on the two paths.

**Win conditions.** Hold three stars across the group for five consecutive years while solvent — or take **the El Bulli ending**: close at your peak and become a foundation. Both count. The second is there to tell players that stopping can be winning.

## Systems & real-world economics

**Every number in the sim starts from a real UK figure, then gets tuned for fun.** The shared systems below run on both paths and on every rung of the career ladder; the path-specific layers above sit on top of them.

| System | Real-world anchor | How it plays |
| --- | --- | --- |
| Opening costs | Kitchen fit-out £30–150k; furniture and decor £15–35k; opening stock £2–5k; rent deposit 3–6 months; rent £2–5k/month outside London, £12k+ inside ([startup costs](https://zemplerbank.com/resources/food-and-drink/restaurant-startup-costs-uk/)) | An opening-budget screen; advisers say hold 3–6 months of running costs — drop below that and a cash-crunch warning appears |
| Licensing | Food business registration is free but must be done 28 days before trading; an alcohol premises licence costs £100–£1,905 by rateable value | A 28-day countdown before opening day; alcohol is a separate task with its own payoff (see wine) |
| Wages and tips | National Living Wage £12.71/hr for over-21s from April 2026, plus employer NI and pension; since Oct 2024 all tips must go to staff with a written policy ([tipping rules](https://www.mondaq.com/uk/employee-benefits-compensation/1510816/new-rules-on-tips-gratuities-and-service-charges-from-1-october-2024)) | Payroll is the biggest lever on both paths; the tip pool is a morale system, and an unfair split lowers it |
| Menu engineering | The Kasavana–Smith matrix: Stars (popular, profitable), Plough-horses (popular, thin), Puzzles (profitable, unpopular), Dogs (neither) | Each dish lands in a quadrant with its own actions — feature, re-cost or shrink, rename and reposition, cut after about four weeks |
| Covers and turns | RevPASH: seat occupancy × average spend ÷ dining hours. 60% full at £85 a head beats 85% full at £55 | A dial between table-turn speed and spend per head; the Empire path pushes one way, the Stars path the other |
| Waste | UK hospitality: 45% in prep, 34% left on plates, 21% spoilage; about 75% avoidable; roughly 1 in 6 meals wasted ([WRAP](https://www.wrap.ngo/resources/report/overview-waste-hospitality-and-food-service-sector)) | Three waste sources, each with a fix — training, portion size, ordering — and a visible bin |
| Failure | About 17–30% of independents close in year one, around 30% by year three, half by year five | Normal difficulty makes year one survivable with care, not guaranteed; Cosy difficulty removes bankruptcy |
| Staff | Kitchen brigade (head, sous, chefs de partie, commis, porter) and front of house (GM, maître d', servers, runners, bar or sommelier) | Named people with 3–4 visible traits, hidden potential, mood, ambition and a career of their own |
| Reputation | Word of mouth built Five Guys with almost no advertising; a critic or a star can double bookings | Two tracks, popularity and prestige, fed by walk-ins, online reviews, critics and word of mouth, each visible on the evening screen |

**Economy model.** Customers arrive by segment (students, families, business, foodies, tourists), each weighting price, quality and speed differently, and pick between restaurants in range. Prices, rents and wages drift with a simple inflation curve so a ten-year save still feels alive. Loans have fixed repayment schedules that bite in slow months; the first winter is the tutorial for cash flow.

**Events and risks** are drawn from a weighted deck that depends on path, size and recent choices: a supplier failing, a landlord raising rent at lease renewal, a food-safety incident, a rival opening across the road, a staff walkout (the one that launched Ramsay's own restaurant in 1998), a viral review, a recession. The same card lands differently on the two paths, which is how the game keeps teaching the difference between them.

## Starting levels: the career ladder

**The player chooses where on the ladder to begin, and every rung is a different game until they own the place.** Lower starts are longer, more hands-on and more forgiving financially; higher starts skip the apprenticeship and go straight to the money. A player who starts as an apprentice and ends up owning a global chain has played the whole arc.

| Start | You are | What you actually do | How you progress | Typical length to ownership |
| --- | --- | --- | --- | --- |
| **Apprentice chef** | Commis in someone else's kitchen on minimum wage | Prep, stations, timing, mise en place; learn recipes by cooking them; survive service pressure | Promotions to chef de partie → sous chef → head chef as skill and reliability grow; a head chef can be backed to open their own place | 4–6 hours |
| **Bar person** | Behind the bar of a pub or cocktail bar | Drinks orders, stock, regulars, upselling, late shifts; wine and spirits knowledge becomes a lifelong asset | Bar manager → general manager; the drinks margin knowledge is a real edge on both later paths | 3–5 hours |
| **Waiter / front of house** | Serving tables | Reading tables, timing courses with the kitchen, complaints, tips, remembering regulars | Head waiter → restaurant manager; builds the service and hospitality stats the Stars path depends on | 3–5 hours |
| **Restaurant manager** | Running someone else's restaurant for a salary and a bonus | Rotas, hiring, stock, P&L targets set by an absent owner; you can be fired | Hit targets to earn a share, or leave and raise money to open your own | 1–2 hours |
| **Owner** | The current brief's default start | Lease, loan, menu, hiring from day one | Straight into the shared first act | 0 |

**Why the ladder matters for the design**

- Each rung teaches one system from the inside before the player has to manage it from above. Someone who has cooked a service understands why their head chef is angry about a 12-dish menu change.
- Rungs give the hands-on player — and a younger player — a game that is about *doing* rather than spreadsheets. The apprentice start is the natural home for the chef fantasy.
- Wages, tips, hours and promotion rules on the ladder use real UK hospitality figures (minimum wage, tronc, split shifts), so the economics section applies here too.
- Carry-over: skills and relationships earned on the ladder persist. A former apprentice who becomes an owner can call their old head chef; a former bar person opens with a better wine list.

**Hands-on mode: first person, Roblox-style**

The ladder's lower rungs are played in **third or first person as a character you walk around** — the Roblox *Restaurant Tycoon* / *My Restaurant!* feel rather than a cockpit of menus. You stand at a station, carry plates to tables, pour at the bar, and the pressure of a real service is felt with your feet and hands, not read off a dashboard. Management at the top of the ladder is the same world seen from the office: you can always walk back onto the floor.

- **Why this fits the audience.** Under-13s already play restaurant tycoons this way — Restaurant Tycoon 2 has 1.7B Roblox visits, and about 80% of Roblox sessions are on mobile. A walkable, decoratable restaurant with a visible character is what they recognise as "a restaurant game".
- **One world, two cameras.** The same restaurant interior serves the hands-on layer (character camera, interact verbs) and the management layer (pulled-back isometric or free camera, overlays). No separate levels or art.
- **Interactions are discrete verbs:** grab, chop, cook, plate, carry, serve, clear, pour, take payment. Each is a short timing or sequence action, readable in two seconds, with a realistic rather than slapstick feel. Fail states are soft: a dropped plate costs money and mood, never a game over.
- **Realism where it teaches.** Prep lists, station layout, order tickets, table numbers, the pass, clearing and resetting, closing down — the real rhythm of a shift, simplified but recognisable. A player who has done a hands-on service understands the staff they later manage.
- **Social hook (later).** Visiting a friend's restaurant, or a parent-and-child shift with one managing and one on the floor, is the co-op that this genre rewards — scoped as a post-launch addition, not a launch feature.
- **Engine impact:** a character controller and interactable kitchen are standard in both Godot and Unity; this does not change the Technical plan's recommendation. It does add a character art and animation budget (about £5–15k with asset packs plus a contract animator for the hero moves).

## Technical plan (CTO view)

**Recommendation: Godot 4.6 with C#, and a simulation core written as a plain .NET class library with no engine references.** Unity 6 is the fallback; because the sim is engine-agnostic C#, switching would mean rewriting only the presentation layer. A pure web stack (TypeScript + React + PixiJS in Electron) is the fastest path for a web developer but effectively rules out Switch, so it is only right if the game is PC-only forever.

| Engine | Fit for a data-heavy sim | UI tooling | Console / mobile | Licence (2026) | Fit for a TypeScript developer |
| --- | --- | --- | --- | --- | --- |
| **Godot 4.6 (C#)** | Good — plain C# classes, .NET fast enough for thousands of entities | Solid controls and themes; data grids and charts are custom work | Switch/PS5/Xbox via [W4 Consoles](https://www.w4games.com/w4consoles) at $800 per platform per year under $300k revenue; native Android/iOS; no C# web export yet | Free (MIT), no revenue cap | Good — C# feels like typed TypeScript; AI assistants strong on C# |
| **Unity 6** | Excellent; Burst/Jobs available if needed | UI Toolkit (CSS-like) plus a large asset store | Best in class everywhere | Personal free under $200k; Pro $2,310/seat/yr; runtime fee cancelled Sept 2024 ([Unity](https://unity.com/pricing-updates)) | Moderate — heavier editor |
| **Web: PixiJS/Phaser + React** | Excellent for UI; sim runs in a Web Worker | Best — the founder's home turf | Steam via Electron with unofficial Steamworks bindings; consoles impractical | Free | Minimal learning curve; strongest AI-assistant support |
| **Unreal 5** | Overkill for spreadsheet-like logic | Heavy | Excellent | 5% royalty over $1M | Steep |
| **Bevy (Rust)** | Excellent ECS | No editor, UI unsettled | Limited | Free | Steep |

Godot's momentum is real — [1,229 Godot games shipped on Steam in 2025](https://wnhub.io/news/analytics/item-50801), and Slay the Spire 2 passed 3M sales on it — but one thing must be confirmed in the first week: **whether W4's console exports support Godot .NET projects.** If not, the choice is between statically typed GDScript on Godot and C# on Unity.

**Architecture principles**

- **Deterministic, tick-based sim, separate from rendering.** The economy ticks once per in-game hour; only the restaurant on screen ticks finely (about once a second). Speed controls change ticks per real second; rendering interpolates. The sim never reads engine time, uses seeded RNG per system, and stores money as integer pence — so any bug reproduces from a save plus a seed.
- **Two-level simulation is the design that makes the Empire path possible.** The viewed restaurant (and every Stars-path restaurant) is simulated agent by agent: customers, queues, stations, dish quality. Every other franchise site runs a closed-form model per tick — covers as a function of footfall, price, brand and competition; margin from food cost, labour and rent — with noise. A headless runner calibrates the aggregate model against the agent model so promoting a site to "viewed" never changes its numbers. Thousands of aggregate sites are trivial for .NET; thousands of agent sims would not be.
- **Data-oriented OOP, not full ECS.** Arrays of plain records with systems run in a fixed order (Demand → Service → Supply → Staff → Finance → Reputation → Competitors → Events → Stats). ECS frameworks add complexity the entity count doesn't justify.
- **Everything that balances lives in data.** Recipes, ingredients, cities, rents, wage curves, critic weights and tech trees are CSV/JSON authored in a spreadsheet and exported by CI. Balance changes need no code, and mod support is a data-overlay folder first, scripted hooks later.
- **Save/load with a schema version and migrations from day one.** Early Access saves must survive every update; golden-save regression tests run in CI.
- **Customer AI is segment-based.** Students, families, business, foodies and tourists each weight price, quality and speed differently and pick a restaurant by softmax over the options in range. Competitors are utility-AI firms with archetypes (budget chain, premium casual, celebrity chef). The Michelin inspector is a hidden model scoring consistency across repeated visits, ingredient tier, technique and service, revealed partly through reviews.
- **Cities are hand-authored templates with procedural variation,** not procedural streets. A stylised world map of city nodes is enough for the endgame.

**Tooling.** Synty All Access (about $30/month) and Kenney CC0 packs for base art, with a freelance artist (£5–25k) adding a distinctive hero layer so it isn't an asset flip. GodotSteam for achievements, cloud saves and Workshop. GameAnalytics or a self-built PostHog/Supabase event pipeline. GitHub Actions for headless exports, xUnit tests, balance runs and pushes to Steam beta branches. Steam's January 2026 rules require disclosure only for AI-generated content players consume, not for AI coding assistants ([PC Gamer](https://www.pcgamer.com/software/ai/steam-updates-ai-disclosure-form-to-specify-that-its-focused-on-ai-generated-content-that-is-consumed-by-players-not-efficiency-tools-used-behind-the-scenes/)).

**Where AI coding assistants help most:** the pure C# sim, its tests, the headless balancing tools and the data pipeline. **Where they help least:** scene, node and editor wiring, and game feel. Keep the architecture boundary strict so agent-written code stays testable. Expect 40–60% of total development time to go on UI either way.

## Production plan

**Plan for 24–36 months to 1.0 as a solo founder with a contract artist, Early Access at month 15–20, and roughly £35–95k of cash before console ports.** The single most important scoping decision: **ship the shared first act plus the Empire path first, and bring the Stars path in as a major Early Access update.** Two complete paths at launch is the biggest risk in this brief; the Empire path is also the more streamable pitch, and streamers sell this genre.

| Phase | Duration | What gets built | Exit criteria | Cash (estimate) |
| --- | --- | --- | --- | --- |
| 0. Engine spike | 3–4 weeks | The same tiny loop (customer → order → cook → pay → P&L) in Godot C# and optionally the web stack; confirm W4 .NET console support | Engine decided; Sim.Core skeleton with tests | £0–500 |
| 1. Prototype | 3–4 months | One agent-simulated restaurant, menu pricing, staff, a 3-district city, then 2nd–10th locations on the aggregate model; greybox art | 5–10 outside testers choose to play a second session; headless runner works | £1–3k |
| 2. Vertical slice | 4–6 months | Final art direction for one restaurant type and one city, UI kit, versioned save/load, competitor AI v1, the fork; Steam page, capsule, trailer | A polished 30–45 minutes; Steam page live; 2–5k wishlists | £8–20k |
| 3. Pre-EA | 5–8 months | 3 cities, world map, menu and tech trees, 10–15 hours of progression, public demo, smaller festivals, influencer outreach, Next Fest just before launch | 7k+ wishlists; stable demo | £10–25k |
| 4. Early Access | 9–15 months | Updates every 6–10 weeks: Stars path, regional managers, franchisee AI, events, data-overlay modding and Workshop, Steam Deck verification | 85%+ positive; roadmap complete | £10–30k |
| 5. 1.0 and ports | 3–6 months | Polish, balance, achievements, localisation, launch beat; then Switch via W4 and a porting partner | Steam 1.0; console ports after | £5–15k, then £15–60k per console |

Budgets exclude founder salary and are estimates, not sourced figures. A team of 3–4 could cut calendar time to 18–24 months but would push total cost to £250–600k.

**Benchmarks that set expectations**

- [Big Ambitions](https://newsletter.gamediscover.co/p/deep-dive-how-big-ambitions-hit-it) (Unity, 4 people at EA) spent about 3.5 years in Early Access, entered with roughly 93k wishlists, sold 163k units in 20 days and saw concurrent players jump about 8x at 1.0. Influencer outreach beat press.
- [Supermarket Simulator](https://wnhub.io/news/stores-and-publishing/item-43033) (solo developer, $12.99) peaked near 38k concurrent players: a simple, tactile shop loop sells.
- [PlateUp!](https://www.yogscast.games/news/toptipsforsolodevs) (solo, Unity) passed 2M copies; its developer's lesson was to avoid content that snowballs maintenance.
- [Rise of Industry](https://gameworldobserver.com/2025/08/19/it-was-a-bad-publishing-contract-the-creators-of-rise-of-industry-earned-almost-nothing-from-the-game-despite-its-revenue-in-the-millions) grossed millions and still left its studio in debt through a bad publishing contract. If a publisher appears: cap recoup, keep the IP, get marketing commitments in writing.
- [Steam Next Fest data](https://howtomarketagame.com/2025/03/26/archive-january-2026-benchmarks-how-many-wishlists-can-i-get-from-steam-next-fest/): games entering with 1–10k wishlists gained a median of about 1.5k; under about 2k there is little lift. Release the demo months earlier and treat Next Fest as the final showcase, not the debut.

**Team shape.** Founder as designer/CTO/programmer; a contract artist for art direction and the hero layer; a contract composer for one theme; a part-time community/marketing hire from Phase 3. If a second full-time person joins, make it a gameplay programmer who owns UI and game feel — the two areas where the founder's web background and AI assistants help least.

## Risks, open questions & next steps

**The biggest risk is that this brief describes three games: a hands-on first-person job sim, a franchise empire builder and a fine-dining prestige sim.** Each is a real product on its own. The plan handles that by sharing one world and one sim core and by shipping in order — first act plus Empire, then the ladder's hands-on rungs, then Stars — but the order should be argued over before the engine spike, not after.

| Risk | Mitigation |
| --- | --- |
| Scope: three games in one | Ship Empire first; Stars as a major Early Access update; co-op post-launch. Keep a public "not now" list |
| Who is it for? A daughter who wants a chef game and an adult who wants a tycoon are different buyers | Career ladder plus a Cosy difficulty serve the first; the fork and real economics serve the second. Playtest both separately from the prototype onward |
| Management sims only get fun late (Tavern Keeper took 11 years) | Prototype the hands-on service loop first; if greyboxes aren't fun, spreadsheets won't save it |
| UI eats 40–60% of the work | Build a UI kit at the vertical slice; design for controller and Steam Deck from the start |
| Late-game performance with thousands of sites | Two-level simulation; profile with 5,000 aggregate sites from the slice onward |
| Licensing | Real brand names (McDonald's, Michelin) appear in this brief as research only — the game uses invented brands and an invented guide |
| A publisher deal that costs the studio its upside | Cap recoup, keep the IP, get marketing in writing |

**Open questions**

- Does W4 Consoles support Godot .NET projects? Decides C# on Godot vs C# on Unity in week one.
- Is Switch a firm target or a nice-to-have? Decides how much controller-first UI work the slice needs.
- Which start does the daughter actually want to play first — apprentice chef, or owner? Worth asking her, and worth building her answer first.
- Art direction: stylised low-poly 3D (Synty-adjacent, Roblox-adjacent) or 2D? The hands-on layer pushes toward 3D.
- Working title and brand: "Full Plate" is a placeholder.

**Next steps**

- [ ] Decide the shipping order (Empire first, or ladder first) and freeze the vertical-slice scope
- [ ] Run the 3–4 week engine spike: the same tiny service loop in Godot C# and, optionally, the web stack; confirm W4 .NET support
- [ ] Write the Sim.Core data schema (restaurant, dish, staff, customer segment, site, contract) and the first balance tables as spreadsheets
- [ ] Paper-prototype the menu matrix and the daily P&L screen with two or three target players, including the youngest
- [ ] Draft the first-person interaction verb list and test it with Kenney greybox assets

## Sources

Research gathered 8 November 2026 by three Opus research agents (market, real-world economics, technology). Linked inline above; principal pages opened:

- Market: [PlateUp! 1.5M copies](https://www.gamedeveloper.com/press-release/plateup-reaches-1-5-million-steam-copies-sold) · [Overcooked 100M players](https://www.gamedeveloper.com/press-release/the-onion-king-invites-you-to-join-his-jubilee-as-overcooked-marks-10-years-of-culinary-chaos-and-100-million-players-) · [Cook Serve Forever post-mortem](https://felixonline.co.uk/articles/the-story-of-cook-serve-forevers-launch/) · [Chef Life and Michelin](https://www.gamedeveloper.com/press-release/get-cooking-chef-life-a-restaurant-simulator-arrives-on-consoles-and-pc-in-autumn-2022-in-collaboration-with-the-michelin-guide) · [Tavern Keeper's 11 years](https://www.gamesradar.com/games/simulation/after-11-grueling-years-and-6-different-versions-of-the-game-management-sim-devs-decide-theyve-finally-made-something-that-doesnt-suck-tavern-keeper-wasnt-fun-for-ages) · [Big Ambitions deep dive](https://newsletter.gamediscover.co/p/deep-dive-how-big-ambitions-hit-it) · [Cosy boom on Steam](https://www.pcgamer.com/games/life-sim/the-cozy-game-boom-is-the-clearest-trend-on-steam-over-five-years-of-data) · [Roblox Restaurant Tycoon 2](https://rotrends.com/game/1214576306) · [Roblox as a platform 2025](https://gamedevreports.substack.com/p/newzoo-roblox-as-a-platform-in-2025) · [Designing management sims](https://www.gamedeveloper.com/design/what-developers-need-to-know-about-making-a-management-simulator)
- Economics: [McDonald's franchise terms 2026](https://www.franchisechatter.com/2026/10/11/mcdonalds-franchise-review-2026-costs-fees-news-average-revenues-and-or-profits/) · [Harry Sonneborn](https://en.wikipedia.org/wiki/Harry_J._Sonneborn) · [McDonald's as real estate](https://www.fool.com/investing/general/2016/03/06/mcdonalds-corporation-a-real-estate-empire-finance.aspx) · [Chipotle 2024 results](https://ir.chipotle.com/2025-02-04-CHIPOTLE-ANNOUNCES-FOURTH-QUARTER-AND-FULL-YEAR-2024-RESULTS) · [Subway closures](https://abasto.com/en/news/subway-closures-hit-700-u-s-locations-in-one-year/) · [McDonald's franchisee remodel dispute](https://www.nrn.com/restaurant-franchising/tension-escalates-between-mcdonald-s-and-franchisees-over-remodels) · [Arch Deluxe](https://www.thedailymeal.com/1166345/the-200-million-failure-of-mcdonalds-arch-deluxe) · [Michelin Guide 101](https://guide.michelin.com/en/article/features/the-michelin-guide-101) · [How inspectors decide](https://www.khaleejtimes.com/how-michelin-inspectors-make-decisions) · [World's 50 Best voting](https://www.the50.com/restaurants/best-in-the-world/voting/the-voting-system) · [Waterside Inn accounts](https://www.restaurantonline.co.uk/Article/2024/07/12/rising-costs-cause-profits-at-the-waterside-inn-to-sink/) · [Fine-dining costs](https://www.thestaffcanteen.com/Editorials-and-Advertorials/daniel-clifford-michael-smith-why-does-it-cost-so-much-to-eat-at-a-michelin-starred-restaurant) · [Tock ticketing](https://medium.com/backchannel/buying-tickets-to-restaurants-114e5b9c768f) · [Noma](<https://en.wikipedia.org/wiki/Noma_(restaurant)>) · [El Bulli](https://en.wikipedia.org/wiki/El_Bulli) · [The Fat Duck](https://en.wikipedia.org/wiki/The_Fat_Duck) · [Clare Smyth](https://en.wikipedia.org/wiki/Clare_Smyth) · [Ramsay group restructuring](https://thecaterer.com/news/foodservice/chris-hutcheson-resigns-from-gordon-ramsay-holdings) · [UK restaurant startup costs](https://zemplerbank.com/resources/food-and-drink/restaurant-startup-costs-uk/) · [UK tipping rules 2024](https://www.mondaq.com/uk/employee-benefits-compensation/1510816/new-rules-on-tips-gratuities-and-service-charges-from-1-october-2024) · [Menu engineering matrix](https://www.loadedhub.com/resources/menu-engineering-matrix-restaurant) · [RevPASH](https://sevenrooms.com/blog/restaurant-revpash/) · [WRAP hospitality waste](https://www.wrap.ngo/resources/report/overview-waste-hospitality-and-food-service-sector) · [Restaurant failure rates](https://oysterlink.com/spotlight/restaurant-success-failure-statistics)
- Technology: [Unity pricing](https://unity.com/pricing-updates) · [Unity runtime fee cancelled](https://unity.com/blog/unity-is-canceling-the-runtime-fee) · [W4 Consoles](https://www.w4games.com/w4consoles) · [Godot 4.6](https://gamefromscratch.com/godot-4-6-released/) · [Godot games on Steam 2025](https://wnhub.io/news/analytics/item-50801) · [GodotSteam](https://godotsteam.com/getting_started/introduction/) · [Unreal royalty](https://pcgamer.com/unreal-engine-games-no-longer-owe-royalties-on-their-first-dollar1m-in-revenue) · [Phaser + Electron on Steam](https://phaser.io/news/2026/04/desktop-heroes-phaser-electron-steam) · [PlateUp! solo-dev lessons](https://www.yogscast.games/news/toptipsforsolodevs) · [Supermarket Simulator launch](https://wnhub.io/news/stores-and-publishing/item-43033) · [Rise of Industry publishing deal](https://gameworldobserver.com/2025/08/19/it-was-a-bad-publishing-contract-the-creators-of-rise-of-industry-earned-almost-nothing-from-the-game-despite-its-revenue-in-the-millions) · [Next Fest wishlist benchmarks](https://howtomarketagame.com/2025/03/26/archive-january-2026-benchmarks-how-many-wishlists-can-i-get-from-steam-next-fest/) · [Steam AI disclosure 2026](https://www.pcgamer.com/software/ai/steam-updates-ai-disclosure-form-to-specify-that-its-focused-on-ai-generated-content-that-is-consumed-by-players-not-efficiency-tools-used-behind-the-scenes/) · [Synty All Access](https://syntystore.com/products/all-access-pass)

Budgets and durations in the Production plan are estimates, not sourced figures. Third-party sales estimates (Datahumble) can be well off; developer-published numbers are used wherever available.
