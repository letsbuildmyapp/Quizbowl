# QuizQuest data model and server contract

Firestore is the system of record. Realtime Database is only used for presence.
All timestamps are **epoch milliseconds (numbers)** unless the field ends in `At`
and is written with `serverTimestamp()` by a client (noted below as `ts`).

## Why "request documents" instead of callable functions

The Firebase project lives in a Google Cloud org whose policy forbids `allUsers`
IAM bindings, so callable/HTTP functions can't be reached from browsers. Every
privileged action is therefore a **request document** the client is allowed to
create (security rules validate the shape and the caller), and a **Firestore
trigger** does the privileged work and writes the result back. Clients listen
for the result.

Pattern used by `web/src/lib/requests.js`:

```js
const id = await submitRequest('studentLogins', payload)   // creates the doc
const result = await waitForResult('studentLogins', id)   // resolves when status != 'pending'
```

Every request doc has `{ status: 'pending'|'done'|'error', error?: string, result?: any, createdAt: ts, uid }`.

## Roles (Firebase Auth custom claims)

| claim | meaning |
|---|---|
| `role: 'student'` + `studentId`, `classroomId`, `schoolId` | a device signed in (anonymous auth) as a teacher-managed student profile |
| `role: 'teacher'` + `schoolId`, `schoolAdmin?: true` | approved teacher; school admins can approve teachers and edit school settings |
| `role: 'teacher_pending'` + `schoolId` | teacher waiting for school admin approval |
| `role: 'parent'` + `students: [studentId]` | guardian linked to one or more students |
| `contentAdmin: true` | can create/review/publish questions (any role may also carry this) |
| `platformAdmin: true` | sees all schools, audit log, privacy queue, analytics |

After any claims change the server bumps `users/{uid}.claimsVersion`; the client
listens to its own user doc and calls `getIdToken(true)` when that number changes.

## Collections

### Identity and structure
- `users/{uid}`: `{ role, displayName, email, schoolId?, claimsVersion, prefs: { weeklyEmail, notifications }, createdAt }` (teachers, parents, admins; students are anonymous devices and have a minimal doc with only `claimsVersion`).
- `schools/{schoolId}`: `{ name, adminUids: [], teacherJoinCode, settings: { consentMode: 'school'|'parent', retentionDays, timezone, allowCrossSchoolChallenges }, createdAt }`
- `schools/{schoolId}/teachers/{uid}`: `{ displayName, email, status: 'pending'|'approved'|'suspended', isAdmin, requestedAt }`
- `classrooms/{classroomId}`: `{ schoolId, teacherUid, name, grade, joinCode, joinCodeExpiresAt, settings, dismissedSuggestions: [], createdAt }`
  - `settings`: `{ leaderboard: 'class'|'teams'|'off', opponentMinTier: 0..3, opponentMaxTier: 0..3, rules: {matchLength, readingSpeed, tossupPoints, powerEnabled, powerPoints, negEnabled, negPoints, answerWindowMs, bonusesEnabled}, accessibility: { readingSpeed, readAloud, reducedMotion, largeText }, voiceAnswers: false }`
- `classCodes/{CODE}`: server-maintained `{ classroomId, className, expiresAt, roster: [{ id, displayName, avatar }] }`. Anyone signed in (anonymously) may `get` a code they know; nobody may `list`.
- `teams/{teamId}`: `{ classroomId, name, emoji, color }`
- `students/{studentId}`: teacher-managed profile. Written by teacher (profile fields) and server (progress fields).
  - teacher fields: `{ classroomId, schoolId, teacherUid, displayName, avatar, teamId, active }`
  - student-editable fields: `{ settings: { readAloud, sound, reducedMotion, readingSpeed, largeText }, leaderboardOptOut, nicknameRequest: { name, status: 'pending'|'approved'|'rejected' } | null, avatar }`
  - server fields: `{ xp, level, title, streak: {current,best,lastDay}, stats: {seen, answered, correct, powers, early, bonusParts, bonusCorrect, sessions, versusPlayed, versusWon, clueFractionSum, categories: { [cat]: {seen, answered, correct} } }, cards: { [topic]: {count, category, firstAt} }, badges: [], worldStars: {}, totalStars, unlockedWorlds: [], recentVersus: [bool], beatenPersonas: [], adaptiveLevel, personalBests: { score_attack: {points, accuracy, streak, earlyBuzz} }, teamContribution, reviewDeckCount, dailyQuestDay, latestUnlock, lastPlayedAt, consent: 'school'|'granted'|'pending'|'revoked' }`
  - `students/{id}/private/credentials`: `{ pin }` (teacher-only; 4 digits)
  - `students/{id}/reviewDeck/{questionId}`: `{ questionId, category, subcategory, clues: [], canonicalAnswer, acceptedAnswers, explanation, savedAt }` (student writes)
- `parentInvites/{CODE}`: `{ studentId, classroomId, teacherUid, expiresAt, usedBy: null }` (teacher creates)
- `guardianLinks/{parentUid}_{studentId}`: `{ parentUid, studentId, classroomId, createdAt, status: 'active'|'revoked' }` (server)
- `consents/{studentId}`: `{ status: 'granted'|'revoked', parentUid, version, at }` (server, from a parent request)

### Request collections (client creates, trigger fulfils)
- `studentLogins/{uid}`: `{ code, studentId, pin }` -> claims set; result `{ studentId, classroomId }`
- `joinRequests/{uid}`: `{ code, name, pin }` -> self-join: creates the student (`joinedWithCode: true`), stores the PIN, sets claims; result `{ studentId, classroomId, displayName }`
- `teacherRequests/{uid}`: `{ displayName, schoolName? , schoolJoinCode? }` -> creates school or pending membership
- `parentRequests/{id}`: `{ uid, type: 'link', code }` | `{ type: 'consent', studentId, grant: bool }`
- `sessionRequests/{id}`: `{ uid, studentId, mode, options }` -> creates `sessions/{id}` with the same id (see below)
- `privacyRequests/{id}`: `{ uid, requesterRole, studentId, type: 'access'|'export'|'correction'|'deletion', details }` -> status `pending` (needs approval for deletion) / `approved` / `done` / `rejected`; export writes `result.export` JSON
- `adminActions/{id}`: `{ uid, action, ... }` for claims-changing admin operations (approve teacher, grant content admin, suspend user)
- `answerReviews/{id}`: server creates for "close" answers; teacher sets `decision: 'accept'|'reject'`, trigger applies points/XP
- `contentImports/{id}`: `{ uid, setId, format: 'json', payload }` -> writes draft questions

### Game
- `sessionRequests/{id}` options:
  - `mode`: `'practice' | 'score_attack' | 'versus' | 'daily' | 'review' | 'live_battle'`
  - `options`: `{ category?, difficulty?, count?, readingSpeed?, personaId?, specialty?, assignmentId?, setId?, rematchOf? }`
  - live battle (teacher): `{ uid, mode: 'live_battle', options: { classroomId, teamA, teamB, count, category? } }`
- `sessions/{id}`: **public** state, see `functions/engine/session.js` `createSession` for the shape. Readable by participants (`participantIds` contains the caller's `studentId`), the classroom teacher, and linked parents? No: parents read `sessionSummaries` only.
- `sessionSecrets/{id}`: plan, seed, full questions (answers). **No client access.**
- `sessions/{id}/commands/{commandId}`: `{ type, payload, at: request.time, uid, actorId }`. `commandId` is a client-generated idempotency key. Types: `start, sync, reveal, buzz, answer, skip, advance, pause, resume, review, terminate`. The trigger writes back `{ processed: true, error?: {code, message} }`.
- `sessions/{id}/events/{seq}`: append-only game events (question shown, clue revealed, buzz, answer, review, reward). Readable by the classroom teacher.
- `sessionSummaries/{sessionId}_{studentId}`: written once at completion: `{ sessionId, studentId, classroomId, schoolId, teamId, mode, opponent: {personaId, name, tier, adaptiveLevel} | null, won, tie, points, opponentPoints, seen, answered, correct, powers, early, negs, bonusParts, bonusCorrect, byCategory, topics, xpEarned, xpBreakdown, newBadges, newCards, unlockedWorlds, leveledUp, recommendation, missed, dayKey, weekKey, completedAt, assignmentId, eventsCount }`

### Teacher tools
- `assignments/{id}`: `{ classroomId, teacherUid, title, mode: 'practice'|'score_attack'|'versus', category|null, setId|null, difficulty|null, count, personaId|null, dueAt, targets: { type: 'class'|'team'|'students', ids: [] }, createdAt, archived }`
- `assignments/{id}/progress/{studentId}`: server `{ completed, sessions, bestPoints, bestAccuracy, completedAt }`
- `teamQuests/{id}`: `{ classroomId, teamId|null, title, category|null, metric: 'correct'|'answered', target, startsAt, endsAt, progress, contributions: {studentId: n}, names: {studentId: alias}, completedAt, createdBy }` (teacher creates, server updates progress)
- `leaderboards/{classroomId}_{weekKey}`: server `{ classroomId, weekKey, entries: [{studentId, displayName, avatar, teamId, xp, correct}], updatedAt }` (students may read only when classroom `settings.leaderboard == 'class'`; opted-out students are excluded)
- `teamboards/{classroomId}_{weekKey}`: server `{ teams: [{teamId, name, emoji, xp, correct}] }` (readable when leaderboard is 'class' or 'teams')
- `challenges/{id}`: School Challenge `{ name, hostSchoolId, schoolIds, classroomIds, startsAt, endsAt, categories, metric, inviteCode, standings: { [classroomId]: {className, schoolName, points, correct} }, createdBy }`
- `notifications/{id}`: `{ toUid?: string, toStudentId?: string, kind, title, body, link, read, createdAt }`

### Content
- `questionSets/{id}`: `{ name, sourceOwner, license, rightsNote, usageWindowEnd|null, createdBy, createdAt }`
- `questions/{id}`: `{ type: 'tossup'|'bonus', status: 'draft'|'review'|'approved'|'published'|'retired', setId, category, subcategory, gradeBand, difficulty, promptLeadin, clues: [{text, clueIndex, difficultyWeight}], powerClueIndex, canonicalAnswer, acceptedAnswers, rejectedAnswers, approvedDistractors, explanation, pronunciationNotes, parts (bonus), sourceOwner, license, usageWindowEnd, createdBy, reviewedBy, version, createdAt, updatedAt }`. Content admins only. The game server only draws `status == 'published'` questions whose rights metadata is present and whose usage window has not ended.
- `questions/{id}/history/{version}`: snapshot per change (server)
- `contentStats/summary`: server `{ published: { [category]: { tossups, bonuses, byDifficulty: {1,2,3} } }, sets: [{id, name, count}] }` so teachers can build assignments without reading question content.
- `contentFlags/{id}`: `{ questionId, reason, note, uid, role, status: 'open'|'resolved', createdAt }`

### Operations
- `auditEvents/{id}`: `{ at, actorUid, actorRole, action, target, details }` (server only writes; platform admin and school admin (own school) read)
- `metrics/{weekKey}`: privacy-safe counters (no ids): `{ activeStudents, sessions, questions, versusByTier: {tier: {played, studentWins}}, rematches, assignmentsCreated, reportViews, privacyRequests, contentFlags, deniedAccess }`
- `pilotRequests/{id}`: landing page "request a pilot" form
- `feedback/{id}`: in-app teacher feedback
- `config/opponents`: `{ reactionFloorMs: {0,1,2,3} }` (platform admin only)
- `mail/{id}`: outbound email in Firebase "Trigger Email" extension format (weekly parent summary). Nothing is sent until that extension is installed.

## Presence (Realtime Database)
- `presence/{uid}`: `{ online, studentId?, classroomId?, sessionId?, lastSeen }` written by the client with `onDisconnect`.

## v2: QuizBot, rewards, island map, school theme, Quiz Hall

All reward/cosmetic configuration lives in `functions/shared/rewards.json` (import in web as `@shared/rewards.json`): rarities, slots, cosmetics, chests, `xpRules`, `grantRules`, `worldUnlocks`, `worldRules`, `map` (entrances/stars/chests/paths with % positions over `/art/island-map.webp`), `themes`, `defaultClassRewards`. Pure logic: `functions/engine/rewards.js` (unlock rules, world states, chest contents, grants, loadout validation). Cosmetics never change scoring, clue timing, XP, or opponent difficulty.

### Student doc additions (server-written unless noted)
- `inventory: { [itemId]: { earnedAt, source, grantId, isNew, duplicates } }` (starter items are implicitly owned)
- `loadout: { paint, face, headgear, back, held, companion, effect, emote }` (null = starter loadout `rewards.starterLoadout`)
- `presets: { [name]: loadout }` (max 3)
- `craftingStars`, `questStars`, `claimedMap: [objectId]`, `worldQuests: { [worldId]: n }`, `masteredWorlds: []`, `lastWorld`
- `hall` (**student-writable**): `{ visibility: 'private'|'class', featuredBadge, featuredItems: [≤6 itemIds], hidden: [ids], showStreak, showTeamRank, featuredPreset, layout }`. Private by default.

### Subcollections
- `students/{id}/grants/{idempotencyKey}`: `{ id, type: 'item'|'chest', chestId, itemId|null, rarity, chestRarity, craftingStars, duplicate, source: {rule, sessionId?, objectId?}, createdAt, acknowledgedAt|null, skipped?, revealType? }`. Created server-side in the same transaction that updates inventory, so it exists before any reveal. The student acknowledges with `updateDoc(ref, { acknowledgedAt: serverTimestamp(), skipped: bool, revealType })` (only those fields). Unacknowledged grants = "Vault" items waiting to be revealed (recoverable after skip/disconnect).
- `students/{id}/events/*`: activity log (`REWARD_GRANTED`, `REWARD_REVEALED`, `CHEST_OPENED`, `STAR_COLLECTED`, `COSMETIC_EQUIPPED`, `QUIZ_HALL_UPDATED`), readable by the student and teacher.

### Request collections (client creates, trigger fulfils; use `request()` from `lib/requests.js`)
- `mapClaims/{studentId}_{objectId}`: `{ objectId }` → result `{ type: 'star'|'chest', grantId, questStars }` or `{ alreadyClaimed: true }`. **Doc id must be `${studentId}_${objectId}`** (pass it as `opts.id`).
- `loadoutRequests`: `{ action: 'equip'|'savePreset'|'applyPreset'|'deletePreset', loadout?, name? }` → `{ loadout, presets }`
- `craftRequests`: `{ itemId }` → `{ grantId, itemId }` (costs `rarity.craftCost` Crafting Stars; only chest items; never random)
- `awardRequests` (teacher): `{ studentId, itemId, note }` → school gear with `unlock.type === 'teacher_award'`
- `rulePreviews` (admin): `{ scenario: { levelFrom, levelTo, streakFrom, streakTo, masteredWorld, firstWin, randomChests } }` → `{ grants: [] }` without granting anything
- analytics: `analyticsEvents` types `map_select`, `cosmetic_preview`, `motion_pref` (counters only)

### School theme (organization data, not code branches)
- `schools/{id}.theme`: `{ presetId: 'quizquest'|'westside-warriors', ...overrides (displayName, mascotName, crestLetter, primaryColor, secondaryColor, accentColor, teamHubLabel, weeklyQuestLabel, progressVisual: 'flame'|'star', progressLabel, modeLabel, seasonLabel) }` (school admin writes)
- `schools/{id}.rewardCatalog`: `{ approved: [schoolItemIds] } | null` (null = all school items approved)
- `schoolThemes/{schoolId}`: server projection of the resolved theme + `schoolName` + `rewardCatalog`; readable by anyone whose claims have that `schoolId` (students included). Use this on student screens.
- `schoolQuests/{id}`: `{ schoolId, title, description, category|null, metric: 'correct'|'answered', target, startsAt, endsAt, progress, contributions: {studentId: n}, completedAt, createdBy }` (teachers of the school create; server updates progress; on completion every contributor gets a `chest-school` grant)

### Class reward settings
- `classrooms/{id}.settings.rewards`: `{ randomChests, showStreaks, celebrations: 'standard'|'calm', hallPeerView, hallPeerFields: ['loadout','level','featuredBadge','featuredItems','worldsMastered'] }` (defaults in `rewards.defaultClassRewards`)

### Quiz Hall peer cards
- `hallCards/{studentId}`: server projection with only teacher-approved fields, present only when the class allows peer view AND the student set `hall.visibility = 'class'`. Readable by classmates, the teacher, and linked parents.

### Session summary additions
- `sessionSummaries/*`: `grants: [{ id, type, chestId, itemId, rarity, craftingStars, duplicate }]`, `questWorld`.
