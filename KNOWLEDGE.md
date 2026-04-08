# IELTS Project Upload/Storage Research

## Project Profile
- **Type**: Pure static HTML/CSS/JS (no backend)
- **Build Tooling**: NONE (no package.json, webpack, vite)
- **Current Hosting**: Static files, requires HTTP server (not file://)
- **Data Format**: Markdown files (passage.md, questions.md, answer.md)
- **Data Size**: ~5KB total (3KB passage + 1.5KB questions + 100B answers)

## Browser APIs Currently Used
- fetch() - load markdown files
- localStorage - persist column resize state
- DOM APIs - element manipulation
- Selection API - text selection & highlighting
- Pointer Events API - drag-to-resize
- String manipulation & regex for markdown parsing
- matchMedia - responsive design

## Upload Options Analysis

### Option 1: FileReader API (Local-Only)
- **Setup**: Zero
- **Cost**: $0
- **Persistence**: Session only, unless stored in IndexedDB/localStorage
- **Sync**: None
- **Use Case**: Immediate enhancement, testing

### Option 2: Firestore-Only Text Storage
- **Setup**: Firebase + Auth, Firestore rules
- **Cost**: Free tier (50K reads/day, 20K writes/day)
- **Limit**: 1MB per document (ample for passages)
- **Sync**: Real-time listeners available
- **Best For**: Persistent, simple, real-time

### Option 3: Firebase Storage + Firestore Metadata
- **Setup**: Storage + Auth + Firestore
- **Cost**: Free tier (5GB storage, 50K reads/day)
- **Limit**: Storage scales; metadata queries on Firestore
- **Sync**: Manual polling or Cloud Functions
- **Best For**: Large files, media handling

## Free Tier Blockers
- Firestore: Auth required (no anonymous writes by default)
- Document limit: 1MB (not a blocker for text)
- Read/write: 50K reads/day, 20K writes/day (plenty for this use case)
- With current 5KB per item, quota supports ~400 passages/day

## Safest Path (Recommended)
1. Phase 1: FileReader + localStorage (0 setup)
2. Phase 2: Add Firebase Auth (Google Sign-In)
3. Phase 3: Firestore collection "content" with {id, title, passage, questions, answers, createdAt}
4. Phase 4: Service Worker for offline (no quota costs)
5. Later: Storage if handling binary files

## Implemented (April 8, 2026)
- Added Firestore integration in app bootstrap with fallback strategy:
	1. Firestore `contentSets/latest`
	2. localStorage cache (`uploadedContentCache`)
	3. bundled files (`passage.md` and `questions.md`)
- Added upload UI for two-file mode (`.md`/`.txt`) and paste fallback mode.
- Added "Load default files" control to quickly return to bundled passage/questions.
- Added local cache write on successful cloud load/upload for resilience.

## Firestore Document Shape
```json
{
	"passage": "...markdown...",
	"questions": "...markdown...",
	"sourceType": "file-upload | paste-upload | default-files",
	"updatedAt": "serverTimestamp",
	"updatedAtMs": 1712530000000
}
```

## Temporary No-Auth Rules (MVP)
Use these in Firestore Rules for early testing without sign-in. This is intentionally temporary and should be replaced with authenticated rules.

```txt
rules_version = '2';
service cloud.firestore {
	match /databases/{database}/documents {
		match /contentSets/{docId} {
			allow read: if true;
			allow create, update: if
				request.resource.data.keys().hasOnly(['title', 'testId', 'passage', 'questions', 'sourceType', 'createdAt', 'createdAtMs', 'updatedAt', 'updatedAtMs']) &&
				request.resource.data.title is string &&
				request.resource.data.passage is string &&
				request.resource.data.questions is string &&
				request.resource.data.sourceType is string &&
				request.resource.data.passage.size() > 0 &&
				request.resource.data.questions.size() > 0 &&
				request.resource.data.title.size() > 0 &&
				request.resource.data.title.size() <= 120 &&
				request.resource.data.passage.size() <= 250000 &&
				request.resource.data.questions.size() <= 250000;
			allow delete: if false;
		}
	}
}
```

## Setup Checklist
1. Create Firebase project (Spark/free).
2. Enable Firestore in production or test mode.
3. Copy web app config values into `firebase-config.js`.
4. Apply Firestore rules above.
5. Run local static server, then test upload and refresh.

## Next Security Upgrade
- Add Firebase Auth (Google or anonymous) and restrict writes by `request.auth != null`.
