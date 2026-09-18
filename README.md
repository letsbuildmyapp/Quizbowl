# Quiz Bowl

A web app for solo practice and async classroom quizzes, built on React + Firebase (Hosting, Cloud Functions, Firestore, Auth, Realtime Database).

## Project layout

```
quiz-bowl/
  web/                 React (Vite) frontend
  functions/           Cloud Functions (Node 20)
  firebase.json        Hosting + Functions + Firestore + RTDB + Emulators config
  firestore.rules      Firestore security rules
  firestore.indexes.json
  database.rules.json  Realtime Database rules
  .firebaserc          Firebase project alias (edit "default" to match your project)
```

## Prerequisites

- Node.js 20+ (repo is on Node 24 during development; functions target the Node 20 runtime)
- npm 10+
- A Firebase project (create one at https://console.firebase.google.com)
- Firebase CLI: `npm install -g firebase-tools`

## First-time setup

1. **Install dependencies**

   ```bash
   cd web && npm install
   cd ../functions && npm install
   ```

2. **Point the repo at your Firebase project**

   Edit `.firebaserc` and replace `your-firebase-project-id` with your actual project ID.

3. **Configure the web app**

   Copy `web/.env.example` to `web/.env.local` and fill in the values from
   Firebase Console → Project settings → General → Your apps → Web app.

4. **Enable Firebase services** in the console:
   - Authentication → Sign-in method: enable Google + Email/Password
   - Firestore Database → Create database
   - Realtime Database → Create database
   - Hosting → Get started (no need to deploy yet)

5. **Log in to the Firebase CLI**

   ```bash
   firebase login
   ```

## Development

### Run the frontend

```bash
cd web
npm run dev
```

Opens at http://localhost:5173.

### Run against the emulator suite (recommended)

```bash
firebase emulators:start
```

This boots Auth, Firestore, RTDB, Functions, and the Emulator UI (http://localhost:4000).
Set `VITE_USE_EMULATORS=1` in `web/.env.local` so the frontend talks to the emulators instead of the live project.

### Cloud Functions locally

`firebase emulators:start` already runs functions. To iterate on functions alone:

```bash
cd functions
npm run serve
```

## Deploy

```bash
# Build the frontend
cd web && npm run build && cd ..

# Deploy everything
firebase deploy
```

Or deploy pieces individually:

```bash
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only database
```

## Data model (Firestore)

- `users/{uid}` — `{ displayName, email, role: 'student'|'teacher', createdAt }`. New users default to `student`; promote to `teacher` in the Firebase Console to author quizzes.
- `questionBank/{id}` — `{ text, answer, category, difficulty, tags[] }`. Readable by any signed-in user, writable by teachers.
- `practiceSessions/{id}` — solo practice stats owned by the user.
- `quizzes/{id}` — `{ title, ownerUid, questionIds[], published, createdAt, attemptCount }`.
- `quizzes/{id}/attempts/{id}` — student attempts, graded server-side by the `gradeAttempt` callable.

## Cloud Functions

- `gradeAttempt` (callable) — server-side scoring so answers aren't exposed to the client.
- `onAttemptCreated` (Firestore trigger) — increments the quiz's `attemptCount`.
- `api` (HTTPS/Express) — mounted at `/api/**` via Hosting rewrites, includes `/api/health` and `/api/questions/random`.
