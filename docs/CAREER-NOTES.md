# Career ladder — `@full-plate/sim-career`

The "start as an employee" mode from BRIEF "Starting levels: the career ladder" and ROUND3 Package 3. An AI owner runs
an ordinary sim-core `GameState`. The player is one of its `Staff` (id `"player"`) with a **track** and a **rung**. They
work shifts, get weekly reviews, build relationships, take offers, ask for raises and save. Eventually they open their
own place, which hands over to the normal owner game with their skills, a colleague and their savings carried over.

- Pure, deterministic and serialisable (`version: 1`). Randomness comes only from sim-core's `rng.ts` (xoshiro128**),
  seeded per draw from `hashSeed(career.seed, day, salt, …)`. The code never calls `Math.random` or `Date`.
- Money is integer pence. Wages are pence per hour. Shifts are 10 hours (sim-core `SHIFT_HOURS`).
- No sim-core, content or game files were edited. The career layer drives sim-core through its **public API**:
  `newGame`, `applyCommand`, `tick`, `candidates`, `suggestedOrder`, `weekdayOf` and the exported constants.
  The only exception is `rng.ts`, imported by path (see "sim-core asks").

```
pnpm --filter @full-plate/sim-career typecheck | test | build | demo | headless [--days 365 --seed 7 --seeds 1 --strategy balanced --weekend 1]
```

## The model in one screen

| Thing | How it works |
| --- | --- |
| **Tracks and rungs** (`LADDER`) | chef: commis £12.71 → chef de partie £13.60 → sous chef £15.75 → head chef £18.25/h. bar: bar back £12.71 → bartender £13.20 → bar manager £14.90 → general manager £17.50 (sim role becomes `manager`). waiter: waiter £12.71 → head waiter £13.75 → restaurant manager £16.25 (role `manager`). manager: manager £15.50 (+3% of weekly profit) → GM £18.50 (+5%) → partner (+10% equity share). A premium owner pays ×1.06. No rung, owner or raise ever pays below the NLW of £12.71/h. |
| **Promotion criteria** (visible) | Each rung above 0 has `{ stat, shiftsAtRung, reviewAvg (last 4), ownerMood, reputation? }`. **Round 4 re-pace:** chef de partie cooking 30 / 10 shifts / review 3.2 / owner 50; sous chef 46 / 36 / 3.4 / 55; head chef 62 / 70 / 3.7 / 60 / rep 40. Bartender and head waiter 12 shifts (later rungs 40–70); manager → GM 20, partner 60. The first rung is ~8–12 good hands-on shifts (about an hour of play); later rungs are longer. The **track stat** is skill for chefs, charm for waiters, and (skill + charm)/2 for bar and manager. `promotionChecklist(career)` returns every line with its current value, target and met flag. When every line is met, the owner promotes at the weekly review, or the player can `REQUEST_PROMOTION` straight away. |
| **AI owner** (`owner.ts`) | Re-implements sim-core's headless strategies, because `headless.ts` is not exported. Three personalities: **balanced**, **cheap** and **premium**. They differ in prices (×1 / ×0.92 / ×1.2), menu size and the dish skill ceiling, hiring (value / wage / skill), team size, the co-workers' rota (cheap owners roster 6 days, which tires and upsets them), stock (×1 / ×0.95 / ×1.15 `suggestedOrder`), paid training for the player (every 84 days / never / every 49), incident policy (cheap ignores the paid fixes), raise generosity, review weights and stress. Employers start "established": no loan, fit-out paid and £15k in hand (through a derived `ContentPack.balance` passed to `newGame`), then 14 warm-up days. |
| **Shifts** | Mon–Thu are contract shifts. Fri–Sun are optional (`TAKE_SHIFT`). The default plan is Mon–Thu plus Saturday. A declined contract shift costs owner mood. A weekend pick-up earns owner mood but costs 1.2 personal mood. Seven shifts a week is refused under the Working Time rules (48 hours, so at most six 10-hour shifts). The owner rosters the player from the plan every morning (`SET_ROTA`). |
| **Growth** | Per shift: `GROWTH_PER_SHIFT[rung] × owner.growthMult × (1.5 if your mentor was on) × (1 − stress/250) × (1 − stat/115)`. Speed also grows, plus a little of the off-track stat. Owner `TRAIN` days use sim-core's own training gain. `MENTOR_SESSION` gives a once-a-week boost. **Round 4, learning by doing:** a shift played hands-on adds `HANDS_ON_GROWTH` = 0.3 × stars + 0.04 × plates (plates capped at 15), × owner growthMult × (1 − stat/115) (`handsOnGrowth`). A ★★ 10-plate commis shift is ≈ +0.8 cooking against ≈ 0.12 for a watched one. Every worked evening emits `GREW { gain, handsOn, stat }` for the "+0.8 cooking skill tonight" chip. |
| **Stress and mood** | Stress eases toward `owner.baseStress + 0.5·fatigue + 1.2·max(0, covers per head − 15) + 0.4·max(0, 60 − ownerMood)`. Above 60 it eats into mood. Career mood takes sim-core's own mood change for the player's record, adds weekend and stress effects, and also moves with promotions, raises and poaching. Mood ≤ 15 means a burnout: the next 3 days are off (excused). The player's sim-core mood is floored at 30 so sim-core's quit roll can't remove them. |
| **Tronc** | All tips go to staff (Employment (Allocation of Tips) Act 2023). The player's share of `DayResult.tips` is weighted by points across everyone on shift: front of house 1 point, kitchen 0.7, plus seniority (rung points; 0.004 × skill for co-workers). |
| **Pay** | A weekly payslip on day 7 of each week. Gross = wages + tronc + bonus. PAYE uses 1257L, non-cumulative weekly (20% / 40%). Employee NI is 8% / 2%, and **tronc tips carry no NI**. Living costs are £300 a week (rent share, bills, food, travel outside London). `savings += saved`, which can be negative. |
| **Weekly review** (`review.ts`) | Built from this week's `DayResult`s on your shifts and your staff record. Rating maps the 4.0★/4.4★/4.8★ band to 3/4/5. Reliability comes from contract shifts kept plus weekend pick-ups. Growth is the stat gained. Business is walk-outs for staff and weekly profit for management. Incidents handled add up to +0.5 and incidents ignored take up to −0.5. Components are weighted by owner personality: premium cares about food, cheap about turning up and throughput. A week of pure no-shows scores on reliability alone. The reviewer is your mentor if you have one, otherwise the owner. It has 2–6 short notes. Owner mood +3 per point above 3, reputation +0.8 per point. |
| **Relationships** | Every co-worker gets a `Relationship` with a Staff snapshot. Bond grows on shared shifts: +0.35, plus traits (team_player +0.4 … grumpy −0.5), plus (rating − 3.5) × 0.3, plus noise. Leaving a job keeps colleagues as *former*, with their bond fading 2% a week. **Mentor**: a same-department co-worker ≥10 points ahead with bond ≥20 (the owner mentors managers). **Rival**: a same-department co-worker within 15 points who is competitive (ambitious, showstopper, perfectionist or grumpy) or has bond < 0. When you meet the criteria, a rival poaches the promotion with `p = clamp(0.45 × theirStat/yourStat − 0.15 × (reviewAvg − 4), 0.05, 0.6)`. That costs 8 mood and bond, and puts promotions on a 4-week cooldown. |
| **Offers** | A daily roll: `0.4% + reputation/5000` while employed (6–10 a year at mid reputation), 30% a day out of work, and guaranteed after 4 idle days. The offer comes from another district and owner. It is a rung up when reputation ≥ 35 and you're within 6 points of the next rung's stat. Otherwise it's the same rung at +3–7% pay. It lasts 7 days. `ACCEPT_OFFER` builds a **new employer GameState** with `newEmployer` (new seed, owner personality and district) and carries over skills, savings, reputation and former colleagues. |
| **Raise** | `ASK_FOR_RAISE`: chance = `owner.raiseChance × ownerMood/60 × reviewAvg/3.5`, capped at 90%. The raise is +3/5/6% (cheap/balanced/premium), capped at 110% of the rung wage. It has a 4-week cooldown. A refusal costs mood. |
| **Fired / closed** | Fired at a review when owner mood < 30 and the last two reviews are both < 2.5. If the employer's sim-core game ends (`gameover`), the restaurant closes. Either way you're out of work, offers flood in, and living costs still come off savings. |
| **Opening your own** | `openingBudget`: fit-out (`balance.fitOutCost`, £30k) + deposit (district rent × months) + a £12k reserve. The bank lends 3× savings, capped at `balance.loanPrincipal` (£40k). `canOpenOwn` = the rung allows it (chef ≥ sous chef, bar ≥ bar manager, waiter ≥ head waiter, manager any) **and** savings + loan cover the budget in the cheapest district. In practice that means about £12.2k saved. |

## Public API

```ts
newCareer(content, { seed, track, strategy?, districtId?, difficulty?, playerName?, restaurantName?, ownerName? }): CareerGame   // { career, state }
beginCareerDay(content, game): { game, ownerCommands: Command[], playerWorks, trained }       // planning: sync player, owner plans
stepCareerDay(content, career, state, result: DayResult, handsOn?: { stars, points, meanQuality, plates? }): { career, events: CareerEvent[], nextOwnerCommands: Command[] }  // evening
finishCareerDay(content, game, nextOwnerCommands): CareerGame                                 // applies stock + END_DAY/RESOLVE_EVENT
advanceCareerDay(content, game, policy?, handsOn?): { game, events }                          // all of the above (headless/fast-forward)
applyCareerCommand(content, game, cmd: CareerCommand): { game, events, rejected? }
  // TAKE_SHIFT {weekday,take} | REQUEST_PROMOTION | ACCEPT_OFFER {offerId} | DECLINE_OFFER | ASK_FOR_RAISE | MENTOR_SESSION
  // | OPEN_OWN_PLACE {districtId?, restaurantName?, difficulty?}
promotionChecklist(career): PromotionChecklist; openingBudget(content, career, districtId?); canOpenOwn(content, career)
handsOnGrowth(career, handsOn) · shiftGrowth(career, mentorOn) · rungFloorStat(track, rung)                        // round 4
handoverToOwner(content, career, employerState?, opts?): { state: GameState, perks: string[], summary: HandoverSummary, ownerPerks }
applyWithPerks(content, state, ownerPerks, cmd): StepResult & { perks }                     // the owner game after handover
ownerIncidentResponses(content, strategy, state): Command[]                                    // during the employee's service
serializeCareer / deserializeCareer, serializeCareerGame / deserializeCareerGame             // version 1, stable key order
```

`CareerState` follows the ROUND3 sketch: `version, role, rung, playerStaffId, savings, wage, reputation, relationships,
mentor, weeklyReview, offers, shiftsWorked, promotionsEarned, canOpenOwn, owner { name, strategy, mood }`. It also has
`track`, `stats`, `mood`, `stress`, `fatigue`, `shiftPlan`, `payslips`, `week` (the running tally the review reads),
`jobs`, `employer`, `cooldowns`, `lifetime`, `log` and `handover`.

## How the game mounts it

### Title screen → start picker
Replace "New game" with a **start picker** of five cards: Apprentice chef, Bar person, Waiter, Restaurant manager and
Owner. These are the brief's table; `demo/App.tsx` has the four employee cards and copy. Owner goes to today's
`NewGame` screen. An employee start asks for a name and, optionally, a first-employer personality. The default is
"balanced"; "cheap" is the hard mode and "premium" the fast-learning mode. Then call
`newCareer(content, { seed, track, strategy, playerName, difficulty })`. Keep the `CareerGame` in the reducer beside
(not instead of) the sim `GameState`. The reducer's `game` is `careerGame.state`, so the existing screens keep working.
Autosave `serializeCareerGame(careerGame)` under a separate key ("career"), and add "Continue career" to the title screen.

### Planning (morning) when you're an employee
The owner plans; the player doesn't. Hide the Menu, Staff, Stock and Restaurant tabs (show them read-only under "The
restaurant", so a curious player can see the owner's choices) and show a **My shift** panel instead:

- Today: on shift or not, your station or role, and who's working with you (mentor and rival badged).
- **This week's shifts**: 7 toggles (`TAKE_SHIFT`). Mon–Thu are labelled "contract" and Fri–Sun "optional · costs a
  little mood, pleases the owner".
- **Offers** inbox (`ACCEPT_OFFER`, `DECLINE_OFFER`), with the pitch and the owner personality ("Premium: high
  standards, faster growth").
- Buttons: "Ask for a promotion" (enabled when the checklist is ready), "Ask for a raise" (shows the cooldown), and
  "Hour with your mentor" (`MENTOR_SESSION`).
- The **promotion checklist** card (`promotionChecklist`) and the **savings bar** (`openingBudget`), with "Open my own
  place" once `canOpenOwn`.

"Start my shift" calls `beginCareerDay(content, careerGame)`, then `START_SERVICE` on its `game.state`. The owner's
`ownerCommands` can be shown as a ticker line ("Pat changed the rota", "Pat hired Sam (chef)").

### Service when you're an employee — you watch your own shift
Same `Service` screen and canvas, with these changes:

- **Highlight the player** on the canvas: the staff member with id `"player"` gets an outline and a "You" label. A
  chef is at the pass, a waiter moves between tables, the bar sits behind the bar. Speed controls stay.
- **Incidents** belong to the owner. On each tick, apply `ownerIncidentResponses(content, strategy, state)` (what
  `runService` does) and show the outcome in the ticker as "Pat: remake it". Comp and 86 are owner actions, so hide them.
- If the player is off today (or on a training course), run the service at 4× with a banner: "Day off — the team ran
  it without you".
- **Later: the hands-on package** (Package 4) mounts here on the apprentice, bar and waiter rungs. "Play my shift"
  opens the hands-on scene for the player's role instead of watching. Its `HandsOnResult`s feed sim-core through the
  lead's proposed `PLAYER_COOKED` / `PLAYER_SERVED` commands. The career layer needs nothing new: it reads the
  resulting `DayResult` and the player's sim-core record as today. One small addition is worth making when hands-on
  lands: a review note and bonus for "your plates averaged 82" (take `HandsOnSession.score` into `stepCareerDay` as an
  optional argument).

### Evening when you're an employee
Run `stepCareerDay(content, career, state, state.history.at(-1)!)` when service ends (the `SERVICE_ENDED` event
carries the same `DayResult`). Show `events` and `career.log`. The Evening screen then shows the **employee's**
evening, not the owner's P&L:

1. **Your shift**: hours × wage, your tronc share (`troncShare` is inside stepCareerDay; read the day's money from
   `career.week`), covers on your shift, the day's average rating, incidents you saw sorted, stress and fatigue meters,
   and growth today (a "+0.15 cooking skill" chip).
2. **The team**: bond changes with co-workers you shared a shift with, plus mentor and rival callouts.
3. **The restaurant**: a cut-down owner P&L (covers, revenue, profit) as "how the place did". Manager rungs see the
   full P&L, because their reviews and bonus depend on it.
4. On review days (every 7th career day): a **review card** (`REVIEW` event: stars, reviewer, notes, the four
   component bars, as in the demo) and a **payslip** (`PAYSLIP`: wages, tronc, bonus, tax, NI, living costs and the
   change in savings). On a promotion day, a full-screen "Promoted to sous chef!" moment.

"Next day" applies `finishCareerDay(content, careerGame, nextOwnerCommands)`. The owner orders stock and ends the day,
or answers the morning event. Event cards are the owner's problem, so show them as a one-line "Pat dealt with: a
burst pipe".

### Out of work
When `career.employer.status !== "employed"` (fired or closed), skip service. Call
`stepCareerDay(content, career, state, lastResult)` once per day; it only rolls offers and charges living costs. Show
a "Job hunting" screen with the offers inbox and the savings bar. `advanceCareerDay` does this for you.

## The handover flow

1. The player clicks **Open my own place** (enabled when `career.canOpenOwn`). Show the **opening budget**
   (`openingBudget` for each district: fit-out, deposit, reserve, loan, savings needed) and a perks preview. The
   preview is `handoverToOwner(content, career, state)`, which is pure, so it can run on every render, as the demo does.
2. The player picks a district and a name, then sends `OPEN_OWN_PLACE`. That builds the new game with sim-core
   `newGame`. A derived content pack carries `startingCash = savings` and `loanPrincipal = loan`. Everything else is
   standard: rent deposit, fit-out, tables and goals.
3. The perks are applied (below), and `career.handover` and `career.ownerPerks` are set. The career is over.
4. The game swaps the reducer's `game` to the new `state` and goes to the normal owner Planning screen. A handover
   summary modal lists `summary.perks`. Keep `career` in the save for the history (the career timeline and old
   colleagues). For HIRE, route owner commands through `applyWithPerks(content, state, career.ownerPerks, cmd)` and
   store the returned `perks`.

### Perks and how they reach sim-core
| Perk | Who | Mechanism | Via |
| --- | --- | --- | --- |
| Savings + loan | all | `newGame` with a derived `ContentPack` (`startingCash`, `loanPrincipal`) | command |
| Old head chef joins on day 1 | chef (the colleague with `wasHeadChef`, bond ≥ 10) | their last Staff record is appended to `state.staff` at a 5–15% wage discount (by bond), floored at NLW, with no recruitment fee and Mon–Tue off | state |
| A friend joins | other tracks (best bond ≥ 10, not a porter) | same as above | state |
| Better drinks list | bar | the 3 highest-margin drinks are added with `ADD_MENU_ITEM` at +10% price | command |
| Cheaper hiring | manager (and waiter/bar who reached management) | `applyWithPerks` refunds 50% of `RECRUITMENT_FEE` on the next 3 successful `HIRE`s | wrapper |
| Regulars follow you | waiter | `footfallMods.push({ mult: 1.08, daysRemaining: 42 })` | state |
| People know your name | all | popularity += 0.1 × reputation, prestige += 0.06 × reputation | state |
| Your own skills | all | **needs a sim-core hook**: when nobody of a role is rostered, the owner covers with the fixed `OWNER` constant (skill 40). A former head chef should cover the kitchen at their skill. | needs_hook |

## Round 4: pacing the ladder for a child

- **First promotion in about an hour.** With ★★ 10-plate hands-on shifts (`advanceCareerDay(…, policy, handsOn)`),
  the apprentice is promoted to chef de partie at **shift 11, career day 16** on seeds 1–3 (`test/pacing.test.ts`).
  Watching only, nobody is promoted inside 40 days; headless (no hands-on) reaches chef de partie on day 30–73.
- `stepCareerDay`'s `handsOn` score now carries `plates` (the game passes the summary's plates, or served for a
  waiter). `advanceCareerDay` takes the same score as an optional 4th argument for headless runs; it only counts on
  days the player works.
- **My shift**: the checklist is a progress card ("2 of 4 ticked", a meter per line, the skill line measured from
  this rung's starting stat, "play your shifts hands-on to learn faster"), today's station ("Your station: Desserts ·
  Burgers"), and "Ask for a promotion" has a tooltip naming what is still to do (the R3 P3).
- **Evening score card** (`ShiftScoreCard` in CareerEvening): big stars, "Great shift, Robin!", three one-line notes
  from handson `shiftNotes`, and the week's progress toward the next rung (ticks, shifts n/10, tonight's growth chip,
  days to the review). See HANDSON-NOTES "Round 4".
- UK anchors unchanged: every rung and raise ≥ NLW £12.71/h; tronc shared by points, no NI on tronc.

## Headless: one year from each start (seed 7, first employer balanced, 1 weekend shift a week, default policy)

**Round 4 (re-paced ladder, no hands-on play):** chef: chef de partie day 30, sous day 161, head chef day 261 (then a
premium head-chef move), can open from day 230, £23.6k saved. Bar: bartender day 19, bar manager day 140, GM offer day
218. Waiter: head waiter day 68, restaurant-manager offer day 140. Manager: GM day 45, partner day 182. Seeds 1–3: chef
de partie day 45–73, sous ~day 176, head chef day 276–287. The table below is the round-3 tuning, kept for comparison.

`pnpm --filter @full-plate/sim-career headless` (~1 s per year per start).

| Start | Rung after a year | Path | Savings | Can open from | Relationships of note | Handover perks |
| --- | --- | --- | --- | --- | --- | --- |
| Apprentice chef | **Head chef** £21.29/h (premium) | CDP day 93, sous day 206, head-chef offer day 273 | £22,607 (wages £42.0k + tronc £6.3k − tax £7.8k − NI £2.3k − living £15.6k) | day 237 | old head chef Orla Gallagher +75; current head chef Ivan Hall is mentor +63; 34 mentor sessions | Orla joins day 1 at 13% off (£16.12/h); popularity +5.8; prestige +3.5 |
| Bar person | **General manager** £19.25/h | bartender day 58, offer at premium day 91, bar manager day 174, GM offer day 218 | £23,867 | day 223 | server Shreya Williams +50 | Shreya joins at 10% off; espresso martini, good red, G&T at +10%; hires £75 not £150 |
| Waiter | **Restaurant manager** £18.95/h (premium) | head waiter day 72, RM offer day 140 | £26,462 (tronc £10.4k, the most of any start) | day 188 | Carys MacLeod +100, Rory Ahmed +88 | Carys joins at 15% off; regulars +8% for 42 days; cheaper hiring |
| Manager | **Partner (equity)** £20.35/h (cheap owner) | GM day 86, partner offer day 181 | £27,694 | day 160 | mostly former colleagues (+20–29); owner as mentor for 42 sessions | Marcus Hussain joins at 8% off; cheaper hiring |

Shape across seeds 1–3 (`--seeds 3 --seed 1`): the chef reaches sous chef in about 6–7 months and head chef in 9–12
(one seed was still sous at a cheap owner). Bar reaches GM in 8 months (or bar manager after a sideways move). The
waiter reaches restaurant manager in 5–8 months. The manager reaches GM in 1–3 months via promotion or offer and
rarely makes partner within a year: the 3.7 review and 50 reputation bars are hard at a cheap owner. Everyone can open
somewhere between month 5 (manager) and month 8–12 (chef/bar). That matches the brief's ordering (manager shortest,
apprentice longest), compressed to one in-game year.

Other measured behaviour (6 seeds × 365 days with the default policy): chef starts have a rival about 92 days a year
and a mentor about 116; one promotion in 9 was poached. Bar starts have a rival about 72 days and a mentor about 47.
Waiters rarely get a rival (9 days a year). Managers never do: no rival role exists, but the owner mentors them about
310 days a year. Staying at the first employer for 180 days (12 runs per personality, 4 tracks × 3 seeds), 1 balanced,
0 cheap and 1 premium restaurant closed under the player; both closures were in the business park, where the
starter menu has little appeal. A cheap owner is visibly worse to work for. A commis takes home £16 of tronc a shift
there, against £25 at balanced and £23 at premium. Skill growth is slower too: cooking skill reaches 31 by day 180
(still a commis), against 49 at balanced and 58 at premium, where the commis is a chef de partie by then. Cheap owners
also roster co-workers 6 days a week, so the team is moodier and less stable.

## Open questions
1. **Length.** The brief says 4–6 hours to ownership for the apprentice. Round 4 re-paced it for hands-on play (a
   day is ~5 minutes with the shift): the first promotion is ~10 good shifts, and growth now comes mostly from
   playing (`HANDS_ON_GROWTH`), so a child who plays reaches sous chef (and can open) far sooner than one who skips.
   Sous chef → head chef (36 → 70 shifts) is still ~3–4 hours of play; worth a playtest.
2. **Offers are generous.** Auto-play leaves at the first rung-up offer, which is how most runs climb past the second
   rung. A real player may want "counter-offer" (the current owner matches to keep you). That needs no sim-core change.
3. **Manager start: should managers make the owner's decisions?** Today the AI owner still runs the restaurant and a
   manager's review weights profit. The brief's "rotas, hiring, stock … set by an absent owner" suggests the manager
   start should *issue* the planning commands within a budget, with the owner reviewing the P&L. That is a career
   policy layer on top of the same commands, and worth a design decision before integration.
4. **The player can't be sent home.** sim-core's quit roll is floored by keeping the player's sim mood ≥ 30, and
   `FIRE` is never issued for the player. A real "you're sacked mid-week" moment comes from the career layer only.
5. **Tronc at the owner's restaurant.** sim-core puts tips into `DayResult.tips` and moves FOH mood with them, but the
   pot itself is not paid out to staff, because it isn't revenue. Under the 2023 Act the owner shouldn't keep it, and
   sim-core doesn't. The career layer shares the whole pot by points, but only the player's share is tracked.
6. **Former colleagues as candidates.** Hiring old colleagues later in the owner game (not only on day 1) would need
   either a "known candidates" list in the owner UI, which works as a state edit like the day-1 perk, or a sim-core
   `HIRE_STAFF { staff }` command.

## sim-core asks (none blocking)
- **Export `./rng`** from sim-core's package.json (`"./rng": "./src/rng.ts"`) so the career layer can drop its
  path import (`src/rng.ts` re-exports `../../sim-core/src/rng`).
- **Owner cover stats hook**: `GameState.ownerStats?: { skill; speed; charm }` read by `ownerStats()` in place of the
  `OWNER` constant. This turns the "your own skills" perk from `needs_hook` into a state edit.
- **Per-game recruitment fee** (`GameState.recruitmentFee?`). This would replace the `applyWithPerks` rebate wrapper.
- **Optional `HIRE_STAFF { staff: Staff }`** for bringing a known person in (the colleague perk, poaching from rivals
  in the Empire). The career layer appends Staff directly today, which is valid state but bypasses the command log.
- Export the headless `Strategy` helpers (`setUpMenu`, `staffing`, `rotas`, `restock`) if a single scripted owner is
  wanted. The career package re-implements them on the public API with personality knobs (`src/owner.ts`).
