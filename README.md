# QuizQuest

A kid-first quiz bowl learning platform. Students hear clues one at a time, buzz, answer, earn XP, unlock worlds, and help their team. Teachers run classrooms, assignments, live team battles, and reports. Families see a weekly summary and manage consent. A passion project by Meridian.

Stack: React 18 + Vite (web), Cloud Functions for Firebase (Node 20), Firestore, Firebase Auth, Realtime Database (presence), Firebase Hosting.

- Product scope: `QuizQuest_Technical_Scoping_Document` and the concept deck
- Data contract: [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)
- Decisions, assumptions, open questions: [`docs/DECISIONS.md`](docs/DECISIONS.md)

## How it works (short version)

- **Server-authoritative game engine.** `functions/engine/` is a pure, deterministic state machine (clue timing, buzz resolution, scoring, bonuses, rebounds, pauses) plus the computer opponent simulation. The browser never sees answers or the computer's plan before a question ends.
- **No callable functions.** The Google Cloud org this project lives in blocks public invokers, so every privileged action is a *request document* the client writes and a Firestore trigger fulfils. Game moves are `sessions/{id}/commands/*` docs stamped with the database's server time, so buzz order can't be forged.
- **Fair computer opponents.** Each opponent's buzz point, reaction delay and correctness are precomputed from question metadata and a seeded random stream before the question starts. The same seed replays the same match.
- **Privacy first.** Teacher-managed nicknames, classroom-only leaderboards (or team totals, or off), no chat, no public profiles, no ads, no purchases. Parents see only their linked child.

## Project layout

```
functions/
  engine/        pure game engine: session state machine, opponents, answers, rewards
  shared/        catalog.json (categories, worlds, personas, badges, rules) shared with the web app
  src/           Firestore triggers: identity, roster, game, content, reporting, privacy
  seed/          questions.json: original synthetic starter set (84 tossups, 21 bonuses)
  test/          engine unit tests + integration tests against the emulators
web/
  src/pages/     public, student, teacher, parent, admin screens
  src/components ui kit, game parts, app shell
  src/hooks      auth (claims), live session client, Firestore hooks
scripts/seed.js  seeds content and a demo school into the emulators (or content into prod)
firestore.rules  security rules (role + classroom scoped, server-only writes for scores)
```

## Prerequisites

- Node 20+ (22 works locally), npm 10+
- Firebase CLI: `npm install -g firebase-tools`
- Java 21 for the emulators. On this Mac: `export JAVA_HOME=/opt/homebrew/opt/openjdk@21 PATH=$JAVA_HOME/bin:$PATH`

## Local development

```bash
# 1. install
cd functions && npm install && cd ../web && npm install && cd ..

# 2. start the emulators (Auth, Firestore, Functions, Realtime Database, UI at :4000)
firebase emulators:start --only auth,firestore,functions,database

# 3. in another terminal: seed content + a demo school (safe to rerun; --reset wipes emulator data first)
node scripts/seed.js --reset --emulator

# 4. run the web app (web/.env.local already points at the emulators)
cd web && npm run dev    # http://localhost:5173
```

Demo logins after seeding:

| Who | How |
|---|---|
| Student | Student sign in, class code `QUEST1`, pick a name. PINs: Meridian 1111, Emma 2222, Liam 3333, Noah 4444, Ava 5555, Leo 6666 |
| Teacher (school admin) | `teacher@quizquest.test` / `quizquest123` |
| Content + platform admin | `admin@quizquest.test` / `quizquest123` (sign in on the teacher page) |
| Family | Families sign in with an email link (the Auth emulator prints it at http://127.0.0.1:4000/auth), then enter family code `FAMILY01` |
| Second teacher | Create an account, choose "Join my school", code `MAPLE2026`, then approve them as the school admin |

## Tests

```bash
cd functions
npm test                      # engine unit tests: scoring, state machine, opponent fairness bounds, replay from seed
npm run test:integration      # needs the emulators running + seeded: rules, auth, full matches, live battle, privacy, content
npm run test:demo-flow        # plays as the seeded demo students (run right after a fresh --reset seed)
```

## Resetting data

- Emulators: `node scripts/seed.js --reset --emulator` wipes Firestore + Auth in the emulator and reseeds.
- Production: there is deliberately no bulk reset script. Delete a single student's data through the privacy workflow (Family or Teacher > Privacy request > school admin approves), which is audited.

## Deploying

Needs the Firebase project on the **Blaze** plan (Cloud Functions requirement). Then:

```bash
firebase use quizbowl-d984f
# web config: copy the web app config into web/.env.production (see web/.env.example) with VITE_USE_EMULATORS=0
cd web && npm run build && cd ..
firebase deploy --only firestore:rules,firestore:indexes,database,functions,hosting

# content + first admin (uses your gcloud application-default credentials)
node scripts/seed.js --content
node scripts/seed.js --grant-admin you@example.com   # after that account has signed in once
```

One-time console setup:
- Authentication > Sign-in method: enable Email/Password, Email link (passwordless), Google, and Anonymous (student devices sign in anonymously, then get student claims after the PIN check).
- Grant the functions' runtime service account (`<project-number>-compute@developer.gserviceaccount.com`) the **Firebase Authentication Admin** role, or setting claims fails with `insufficient-permission`.
- Optional: install the "Trigger Email" extension to deliver the weekly family summary email (`mail` collection). Without it, families still get the in-app summary.

## Environments

The scoping doc asks for dev, test and production environments. Today there's one Firebase project (`quizbowl-d984f`) plus the local emulators. Add `quizquest-dev` / `quizquest-staging` projects and aliases in `.firebaserc` when the pilot starts.
