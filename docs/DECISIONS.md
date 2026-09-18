# Decision log

What was decided while building QuizQuest from the scoping document and the concept deck, why, and what still needs Morgan and Meridian's input.

## Architecture

| # | Decision | Why |
|---|---|---|
| 1 | Kept the repo's React + Vite + Firebase stack instead of the doc's suggested Next.js + Supabase. | The doc says to use its stack "unless the repository already specifies otherwise", and this repo was already a Firebase scaffold with a project attached. Firestore rules play the role of Postgres row level security. |
| 2 | JavaScript with JSDoc, not TypeScript. | Matches the existing scaffold. The engine is small, pure and heavily tested. |
| 3 | All privileged work runs in Firestore triggers ("request documents"), no callable or HTTP functions. | The Google Cloud org that owns this project forbids `allUsers` invokers, which callables and Hosting rewrites need. Triggers run under a service account, so they work without weakening that policy. Cost: each action has roughly 0.3 to 1.5 seconds of extra latency. |
| 4 | Buzz order uses the database's own write timestamp (`request.time`, enforced by rules), not the client clock. | Fair, unforgeable ordering even with trigger latency. A computer buzz only commits once it is 700 ms in the past, so a student buzz still in flight wins the race if it really happened first. |
| 5 | The student's device (or the host's, in live battles) sends a heartbeat every 0.8 s during play; the server advances scheduled events (clue reveals, computer buzzes, timeouts) on each heartbeat. | Firestore triggers can't run timers. The heartbeat carries no information; the server decides everything. |
| 6 | Clue reveal times are stamped when the server writes them, and the computer's reaction delay counts from that stamp. | The computer never reacts to a clue before a student could see it. |
| 7 | Students sign in with class code + alias + 4-digit PIN on an anonymous Firebase account, which gets student claims after the server checks the PIN. Lockout after 5 wrong PINs for 10 minutes. | No child email or password. Teachers control aliases. Works on shared school devices. |
| 8 | Parents sign in with an email link and link to a child with a teacher-issued family code. | Matches the doc (magic link, approved linkage). |
| 9 | One Firebase project for now; emulators for local dev and tests. | The doc asks for dev/test/prod environments. Add projects when the pilot starts (see README). |
| 10 | Upgraded the Firebase web SDK to 12.19. | 11.x hit an internal assertion when claims changed while listeners were open. |

## Product choices made without asking (reasonable defaults, easy to change)

- **Categories and worlds.** 7 categories (Science, Space, Geography, History, Literature, Mythology, Fine Arts) mapped to 7 worlds. The 5 worlds from the deck map (Science Lab, Space Station, Geography Galaxy, History Kingdom, Literature Forest) plus Myth Mountain and Harmony Harbor for the two categories the map doesn't show. All in `functions/shared/catalog.json`.
- **Unlocks.** Each world earns up to 3 stars (5, 15, 30 correct answers in its category). Worlds unlock by total stars. Assignments can use any category regardless of locks.
- **Levels.** XP to reach level n = 40 × n × (n−1). Titles: Rookie (1), Scout (3), Adventurer (5), Explorer (8), Trailblazer (12), Champion (16), Legend (20). The deck's "Level 8, Explorer, 2,450 XP" matches.
- **Scoring defaults.** Tossup 10, power 15 (buzzing on the first two clues), negs off by default for kids (teachers can turn on −5), bonus parts 10 each, 5 s answer window, 10 s per bonus part. Practice has no negs and an untimed option.
- **Opponents.** Rookie Robot, Questy the Owl, Category Captain, Quiz Master, plus an adaptive "Best-Fit Rival" (7-step ladder, moves one step at a time on a 10 to 20 match window, aims for a 45 to 60% student win rate, stays inside the teacher's range). The doc's parameters are used as written. Reaction floors (600 ms advanced up to 1800 ms beginner) are editable by platform admins only.
- **Today's Quest.** 5 questions against the Best-Fit Rival in the student's weakest or newest-world category. Completing it counts toward the daily streak.
- **Answer checking.** Exact normalized match or accepted alternates count. Small typos are forgiven (1 for 5 to 8 letters, 2 for 9 or more). Anything further off but plausible is scored wrong and sent to the teacher's Answer Reviews queue. Accepting it restores the points and XP and suggests the alternate to content admins.
- **Leaderboards.** Weekly, classroom only, XP-based, pseudonymous. Teachers pick individual ranks, team totals only, or off. Students can opt out.
- **Consent.** School-level setting: "the school authorizes" (default, typical for classroom use) or "a parent must approve before the student can play".
- **Retention.** Event-level game data (session docs and their event logs) is deleted after the school's retention period (default 365 days). Per-match summaries stay as the aggregate record.
- **Voice answers.** Built but off by default. Teachers can enable them per class, with a notice that the browser's speech recognition may process audio outside QuizQuest. Transcripts are shown for correction before submitting and audio is never stored. The doc recommended deferring voice. It's built and off, so the decision stays open (see below).
- **Weekly family email.** Written to the `mail` collection in the Trigger Email extension format. Nothing is sent until that extension and a mail provider are set up. The in-app weekly summary works today.
- **Seed content.** 84 original tossups and 21 bonuses written for this project (grades 4 to 8, 12 per category), clearly labeled synthetic. No copyrighted packet content.

## Phase 2/3 items built now (the request was to build every feature)

- **Live Team Battle.** Teacher hosts from a projector-friendly screen; students join from their home screen; team lockout after a wrong answer; bonuses go to the team that earned them.
- **School Challenge.** Time-boxed contests between classrooms, joinable by invite code (across schools only when both schools allow it). Standings show class and school names only.

## Needs Morgan and Meridian's input

1. **Firebase billing.** Cloud Functions need the Blaze (pay-as-you-go) plan. Nothing can deploy until billing is on. Expected pilot cost is small, but it needs a card on file.
2. **Primary grade band.** Built for grades 4 to 8 with difficulty and grade-band tags. Confirm, or narrow it.
3. **First categories.** The doc suggested science, geography, U.S. history, literature, mythology. The deck adds space and fine arts. All 7 are in. Keep them all?
4. **Opponent names.** Built with the doc's names plus "Best-Fit Rival" (a fox) for the adaptive one. Meridian may want to rename or redraw them.
5. **Voice answers.** Keep them teacher-optional as built, or remove them until privacy review?
6. **Consent default.** "School authorizes" is the default. A school that wants parent consent flips one setting. Which should a new school start with?
7. **Question source for the pilot.** Keep the synthetic set, write more, or license a real set (import is ready at Admin > Content > Import)?
8. **Legal review.** COPPA/FERPA language on the privacy page is written plainly but isn't legal advice. Get counsel to review before a real school pilot.
9. **Email provider** for the weekly family summary, if wanted.

## Known limits and follow-ups

- Trigger latency (roughly 0.3 to 1.5 s) makes clue reveals and opponent buzzes a little less snappy than a callable backend would. If the org policy can get a project-level exception for `allUsers` on this one project, the engine can move behind a callable function with no rule changes.
- A student's device must stay on the match page for the heartbeat. Switching tabs pauses solo play. A stalled client is treated as a pause, and after 30 minutes the match ends.
- Firestore charges per heartbeat write (about 1 per second per active match). That's fine for a pilot. For larger scale, move the heartbeat to Cloud Tasks or a callable.

---

# v2 change spec (QuizBot, rewards, island map, Westside Warriors)

## Gap analysis against v1

| v2 area | v1 had | Added |
|---|---|---|
| School theme | Nothing | `schools/{id}.theme` + `rewardCatalog`, `schoolThemes` projection, `westside-warriors` preset, Team HQ, school quests with a Warrior Flame progress visual |
| Interactive map | Static map image + world cards | Island map (`/art/island-map.webp`, the provided artwork) with focusable entrances, stars, chests, paths, lock explanations and a list alternative |
| QuizBot Garage | Emoji avatar | Code-drawn SVG QuizBot with 8 slots, about 60 cosmetics, preview, equip, presets, school gear |
| Reward economy | XP, badges, cards | Configurable XP rules, Quest Stars, Crafting Stars, rarity tiers, chests, grants with idempotency keys, duplicate conversion, teacher awards |
| Reward Vault | Results page listed rewards | Reveal flow per rarity with Skip, recovery of unrevealed grants |
| Quiz Hall | Nothing | Private showcase, teacher-controlled peer cards |
| Buzzer | CSS circle | Crystal-dome buzzer with ready/pressed/accepted/late states |
| Motion | Basic transitions | Motion system with reduced-motion variants and teacher "calm" mode |

## Decisions (defaults from the spec's section 14 unless noted)

| # | Decision | Why |
|---|---|---|
| 11 | QuizBot and all cosmetics are drawn in code (SVG), not cut from the reference images. | The references are single composed renders on dark backgrounds; they can't layer per slot. SVG layers cleanly, recolors to any school theme, never sits in a dark box, and respects reduced motion. The references set the style. |
| 12 | The provided island artwork is the map. | It already has theme-park entrances. Interactive objects are positioned over it in `rewards.json` (percent coordinates). Myth Mountain and Harmony Harbor aren't painted on it, so they appear as small floating islands at the edges. |
| 13 | Slots: paint (3 starter colors), face (2 starter panels), headgear, back, held buzzer, companion, effect, emote. No school gear is granted automatically. | Spec section 14 defaults. |
| 14 | School gear comes from the school's weekly quest (school chest) or a teacher award. | Spec default. |
| 15 | Chest contents are resolved when the grant is created, not when it's opened. | The item exists before the reveal, so skipping or disconnecting never loses it. |
| 16 | Random chests pick from the published pool with a seeded, rarity-weighted draw and never give an owned item. If everything is owned, the chest converts to Crafting Stars. Teachers can turn randomness off (then the highest-rarity unowned item is chosen). | Spec rules on transparency, duplicate protection and teacher control. |
| 17 | Crafting Stars buy a specific chosen item (Common 10, Rare 25, Epic 60, Legendary 150). Mythic and school gear can't be crafted. | No random purchases; school gear stays tied to school participation. |
| 18 | World unlocks became quest-based ("Complete 3 Science Lab quests"). A completed match counts as a quest for its category's world. Mastery = 3 stars + 75% accuracy over at least 20 answers + 5 quests, and grants a one-time Legendary Vault. | Spec 3.3 and 5.4. |
| 19 | XP moved to `rewards.json` `xpRules` (attempt 2, correct 8, power +5, early +3, bonus part 4, quest complete 10, beat the computer 15, Today's Quest 20, first assignment completion 25). | "Configurable rules, not constants." |
| 20 | Equip, craft, claim and award are request documents fulfilled by triggers (same pattern as v1). Preview is client-only. | Server-authoritative ownership without callables. |
| 21 | Quiz Hall peer view is off by default; teachers pick which fields classmates see; students opt in per student. | Spec default. |
| 22 | The demo school is "Westside Elementary" on the Westside Warriors theme. Nothing Westside-specific is in code. | Spec 2 brand boundary. The W shield is original art, not an official mark. |

## Needs Morgan and Meridian's input (v2)

1. **Official Westside marks.** The W crest is generated from the theme (letter + colors). If the school has an approved logo, it can replace it after they sign off.
2. **XP tuning.** The spec's XP numbers are placeholders. Levels come about 20% faster than in v1. Watch the pilot and adjust `xpRules`.
3. **Warrior Weekly Quest target.** The seed uses 100 correct answers per week for the school. Set it to fit the real team's size.
