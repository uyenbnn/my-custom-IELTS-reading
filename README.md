# IELTS Reading Workspace

Static frontend app (HTML/CSS/JS) with Firebase backend integration:
- Cloud Firestore for primary storage
- Realtime Database for mirror writes
- Firebase Hosting for deployment

## 1. Prerequisites

Install these first:
- Node.js 18+ (includes npm)
- Firebase CLI

```bash
npm install -g firebase-tools
```

If you prefer not to install globally, use `npx firebase-tools` in commands below.

## 2. Install Project Dependency

From project root:

```bash
npm install
```

This installs the Firebase JavaScript SDK listed in package.json.

## 3. Create Firebase Project

1. Go to Firebase Console and create/select a project.
2. Add a Web App in Project settings.
3. Copy the web config values (`apiKey`, `projectId`, etc.).

## 4. Configure Runtime Firebase Keys

This project supports a runtime config object on `window.FIREBASE_CONFIG`.

Recommended setup:
1. Copy `firebase-config.example.js` to `firebase-config.js`.
2. Fill the values from Firebase Console.

`firebase-config.js` template fields:
- `apiKey`
- `authDomain`
- `projectId`
- `databaseURL`
- `storageBucket`
- `messagingSenderId`
- `appId`
- `measurementId`

Important:
- `.gitignore` excludes `firebase-config.js` to avoid committing local secrets by default.
- Current `index.html` also contains an inline `window.FIREBASE_CONFIG` block. Keep only one source of truth in real usage.

## 5. Enable Firebase Products

### 5.1 Cloud Firestore

1. In Firebase Console, create Firestore database.
2. Use database name `(default)` (required by app).
3. The app writes to:
   - `contentSets/latest`
   - `contentSets/{autoDocId}` for uploaded test history

If `(default)` Firestore is missing, uploads/read will fail.

### 5.2 Realtime Database

1. Create Realtime Database in your project.
2. Ensure `databaseURL` in config matches your DB URL.
3. App mirrors successful Firestore writes to:
   - `contentSets/latest`
   - `contentSets/tests/{testId}`

## 6. Firebase CLI Project Binding

Login and bind local folder to your Firebase project:

```bash
firebase login
firebase use --add
```

This updates `.firebaserc` with your default project id.

Current repository already has:
- `.firebaserc`
- `firebase.json`
- `firestore.rules`
- `firestore.indexes.json`
- `database.rules.json`

## 7. Deploy Rules and Hosting

From project root:

```bash
firebase deploy --only firestore:rules,firestore:indexes,database,hosting
```

You can also deploy separately:

```bash
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only database
firebase deploy --only hosting
```

## 8. Run Locally (Required for fetch)

Because the app fetches local markdown files (`passage.md`, `questions.md`), run via HTTP server (not `file://`).

Option A:

```bash
firebase emulators:start
```

Option B:

```bash
npx serve .
```

Then open the local URL shown in terminal.

## 9. Data and Upload Flow

At startup, app load priority is:
1. Firestore (`contentSets/latest`)
2. localStorage cache (`uploadedContentCache`)
3. Local default files (`passage.md`, `questions.md`)

Upload flow:
1. Validate text payload
2. Save a new test document in Firestore `contentSets/{id}`
3. Update Firestore `contentSets/latest`
4. Mirror to Realtime Database paths (if SDK/database available)

## 10. Common Firebase Errors and Fixes

### Error: Firestore database `(default)` does not exist
Create Firestore in Firebase Console with default database.

### Error: permission denied
Deploy/update `firestore.rules` and `database.rules.json`.

### Error: cannot reach Firestore
Check internet, Firebase config values, and project id binding (`firebase use`).

## 11. Security Notes

- Do not commit sensitive local config if you use private keys/files.
- Move away from open write rules for production.
- Add Firebase Auth and restrict writes with `request.auth != null` when ready.

## 12. Useful Commands

```bash
npm install
firebase login
firebase use --add
firebase deploy --only firestore:rules,firestore:indexes,database,hosting
firebase emulators:start
```
