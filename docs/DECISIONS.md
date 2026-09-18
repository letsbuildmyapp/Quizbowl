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
