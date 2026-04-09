function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineMarkdown(text) {
  let output = escapeHtml(text);

  output = output.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  output = output.replace(/\*(.+?)\*/g, '<em>$1</em>');
  output = output.replace(/`([^`]+)`/g, '<code>$1</code>');
  output = output.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  output = output.replace(/\[input\]/gi, '<input type="text" class="md-inline-input" aria-label="Answer input" />');

  return output;
}

function renderMarkdown(markdownText) {
  const lines = markdownText.replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let currentList = null;
  let paragraphLines = [];

  function flushParagraph() {
    if (paragraphLines.length === 0) {
      return;
    }
    const paragraph = paragraphLines.join(' ');
    html.push('<p>' + renderInlineMarkdown(paragraph) + '</p>');
    paragraphLines = [];
  }

  function closeList() {
    if (!currentList) {
      return;
    }
    html.push('</' + currentList + '>');
    currentList = null;
  }

  lines.forEach((rawLine) => {
    const line = rawLine.trim();

    if (line === '') {
      flushParagraph();
      closeList();
      return;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      closeList();
      const level = headingMatch[1].length;
      html.push('<h' + level + '>' + renderInlineMarkdown(headingMatch[2]) + '</h' + level + '>');
      return;
    }

    if (/^[A-H]$/.test(line)) {
      flushParagraph();
      closeList();
      html.push('<div class="section-label">' + line + '</div>');
      return;
    }

    if (/^---+$/.test(line) || /^\*\*\*+$/.test(line)) {
      flushParagraph();
      closeList();
      html.push('<hr>');
      return;
    }

    const unorderedMatch = line.match(/^[-*+]\s+(.+)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (currentList !== 'ul') {
        closeList();
        currentList = 'ul';
        html.push('<ul>');
      }
      html.push('<li>' + renderInlineMarkdown(unorderedMatch[1]) + '</li>');
      return;
    }

    const orderedMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (currentList !== 'ol') {
        closeList();
        currentList = 'ol';
        html.push('<ol>');
      }
      html.push('<li>' + renderInlineMarkdown(orderedMatch[2]) + '</li>');
      return;
    }

    const quoteMatch = line.match(/^>\s+(.+)$/);
    if (quoteMatch) {
      flushParagraph();
      closeList();
      html.push('<blockquote>' + renderInlineMarkdown(quoteMatch[1]) + '</blockquote>');
      return;
    }

    closeList();
    paragraphLines.push(line);
  });

  flushParagraph();
  closeList();
  return html.join('');
}

const CONTENT_DOC_PATH = 'contentSets/latest';
const CONTENT_CACHE_KEY = 'uploadedContentCache';
const MAX_TEXT_SIZE = 250000;
const TEST_COLLECTION = 'contentSets';
let firestoreDb = null;
let realtimeDb = null;
let activeUploadedTestId = '';

function getFirestoreErrorMessage(error, actionLabel) {
  const fallback = (actionLabel || 'Firestore operation') + ' failed.';
  if (!error) {
    return fallback;
  }

  const code = String(error.code || '').toLowerCase();
  const message = String(error.message || '');
  const normalized = message.toLowerCase();

  if (normalized.includes('database (default) does not exist')) {
    return 'Cloud Firestore is not initialized for this project. Create Firestore database "(default)" in Firebase Console, then try again.';
  }

  if (code.includes('permission-denied') || normalized.includes('permission denied')) {
    return 'Firestore rejected this write due to rules. Update Firestore rules to allow this app to write.';
  }

  if (code.includes('unavailable') || normalized.includes('network') || normalized.includes('offline')) {
    return 'Cannot reach Firestore right now. Check internet connection and try again.';
  }

  return fallback + (message ? ' ' + message : '');
}

function setUploadControlsEnabled(enabled) {
  const controlIds = ['uploadFilesBtn', 'uploadPasteBtn', 'refreshTestsBtn'];
  controlIds.forEach((id) => {
    const control = document.getElementById(id);
    if (control) {
      control.disabled = !enabled;
      control.title = enabled ? '' : 'Upload disabled until Firestore is available.';
    }
  });
}

async function verifyFirestoreDatabase() {
  if (!firestoreDb) {
    return { ready: false, reason: 'Firebase is not configured.' };
  }

  try {
    await firestoreDb.doc(CONTENT_DOC_PATH).get();
    return { ready: true, reason: '' };
  } catch (error) {
    return {
      ready: false,
      reason: getFirestoreErrorMessage(error, 'Firestore check')
    };
  }
}

function isFirebaseConfigValid(config) {
  if (!config || typeof config !== 'object') {
    return false;
  }
  return !!config.apiKey && !!config.projectId && config.apiKey !== 'YOUR_API_KEY';
}

function initFirebase() {
  if (typeof window.firebase === 'undefined') {
    return { ready: false, reason: 'Firebase SDK not loaded.' };
  }

  const config = window.FIREBASE_CONFIG;

  try {
    if (window.firebase.apps.length === 0 && isFirebaseConfigValid(config)) {
      window.firebase.initializeApp(config);
    }

    if (window.firebase.apps.length === 0) {
      return { ready: false, reason: 'Firebase config is missing. Update firebase-config.js or use Firebase Hosting init.' };
    }

    firestoreDb = window.firebase.firestore();
    if (typeof window.firebase.database === 'function') {
      realtimeDb = window.firebase.database();
    }
    return { ready: true, reason: '' };
  } catch (error) {
    return { ready: false, reason: 'Firebase init failed. Check config values and network access.' };
  }
}

async function mirrorToRealtimeDatabase(testId, title, payload, nowMs) {
  if (!realtimeDb) {
    return;
  }

  const data = {
    title: title,
    testId: testId,
    passage: payload.passage,
    questions: payload.questions,
    sourceType: payload.sourceType,
    updatedAtMs: nowMs
  };

  await Promise.all([
    realtimeDb.ref('contentSets/latest').set(data),
    realtimeDb.ref('contentSets/tests/' + testId).set(data)
  ]);
}

function setStatus(message) {
  const status = document.getElementById('statusMsg');
  if (status) {
    status.textContent = message;
  }
}

function normalizePayload(passageText, questionsText, sourceType) {
  return {
    passage: String(passageText || '').replace(/\r\n/g, '\n').trim(),
    questions: String(questionsText || '').replace(/\r\n/g, '\n').trim(),
    sourceType: sourceType || 'unknown'
  };
}

function validatePayload(payload) {
  if (!payload.passage || !payload.questions) {
    return 'Passage and questions are both required.';
  }
  if (payload.passage.length > MAX_TEXT_SIZE || payload.questions.length > MAX_TEXT_SIZE) {
    return 'Content is too large. Keep each field under 250,000 characters.';
  }
  return '';
}

function extractTestTitle(payload) {
  const headingMatch = payload.passage.match(/^#{1,3}\s+(.+)$/m);
  if (headingMatch && headingMatch[1]) {
    return headingMatch[1].trim().slice(0, 80);
  }
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());
  return 'Uploaded Test ' + stamp;
}

function formatTimeLabel(epochMs) {
  if (!epochMs) {
    return 'Unknown time';
  }
  const date = new Date(epochMs);
  return date.toLocaleString();
}

function renderUploadedTestsList(items) {
  const list = document.getElementById('testsList');
  if (!list) {
    return;
  }

  list.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'tests-empty';
    empty.textContent = 'No uploaded tests yet.';
    list.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'test-item' + (item.id === activeUploadedTestId ? ' active' : '');
    button.dataset.testId = item.id;

    const title = document.createElement('p');
    title.className = 'test-item-title';
    title.textContent = item.title || 'Untitled upload';

    const meta = document.createElement('p');
    meta.className = 'test-item-meta';
    meta.textContent = (item.sourceType || 'upload') + ' | ' + formatTimeLabel(item.updatedAtMs);

    button.appendChild(title);
    button.appendChild(meta);
    list.appendChild(button);
  });
}

async function refreshUploadedTests(selectId) {
  if (!firestoreDb) {
    renderUploadedTestsList([]);
    return;
  }

  try {
    const snapshot = await firestoreDb.collection(TEST_COLLECTION).orderBy('updatedAtMs', 'desc').get();
    const items = snapshot.docs
      .filter((doc) => doc.id !== 'latest')
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title || 'Untitled upload',
          sourceType: data.sourceType || 'upload',
          updatedAtMs: data.updatedAtMs || 0,
          passage: data.passage,
          questions: data.questions
        };
      })
      .filter((item) => item.passage && item.questions);

    if (selectId) {
      activeUploadedTestId = selectId;
    } else if (!items.some((item) => item.id === activeUploadedTestId)) {
      activeUploadedTestId = items.length ? items[0].id : '';
    }

    renderUploadedTestsList(items);
  } catch (error) {
    setStatus(getFirestoreErrorMessage(error, 'Could not refresh uploaded tests list'));
  }
}

async function loadTestById(testId) {
  if (!firestoreDb || !testId) {
    return;
  }

  try {
    const doc = await firestoreDb.collection(TEST_COLLECTION).doc(testId).get();
    if (!doc.exists) {
      setStatus('Selected test is no longer available.');
      return;
    }
    const data = doc.data();
    if (!data || !data.passage || !data.questions) {
      setStatus('Selected test is missing required fields.');
      return;
    }

    const payload = normalizePayload(data.passage, data.questions, data.sourceType || 'uploaded-test');
    activeUploadedTestId = testId;
    renderContent(payload, 'Loaded test: ' + (data.title || 'Untitled upload'));
    saveToLocalCache(payload);
    await refreshUploadedTests(testId);
  } catch (error) {
    setStatus(getFirestoreErrorMessage(error, 'Could not load selected test'));
  }
}

function renderContent(payload, sourceLabel) {
  const passageEl = document.getElementById('passageContent');
  const questionsEl = document.getElementById('questionsContent');
  passageEl.innerHTML = renderMarkdown(payload.passage);
  questionsEl.innerHTML = renderMarkdown(payload.questions);
  setStatus(sourceLabel);
}

function saveToLocalCache(payload) {
  const cachePayload = {
    passage: payload.passage,
    questions: payload.questions,
    updatedAt: Date.now()
  };
  localStorage.setItem(CONTENT_CACHE_KEY, JSON.stringify(cachePayload));
}

function loadFromLocalCache() {
  const raw = localStorage.getItem(CONTENT_CACHE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.passage && parsed.questions) {
      return {
        passage: parsed.passage,
        questions: parsed.questions,
        sourceType: 'local-cache'
      };
    }
  } catch (error) {
    return null;
  }
  return null;
}

async function loadFromDefaultFiles() {
  const [passageRes, questionsRes] = await Promise.all([
    fetch('passage.md'),
    fetch('questions.md')
  ]);

  if (!passageRes.ok || !questionsRes.ok) {
    throw new Error('Could not load one or more text files.');
  }

  const [passageText, questionsText] = await Promise.all([
    passageRes.text(),
    questionsRes.text()
  ]);

  return normalizePayload(passageText, questionsText, 'default-files');
}

async function loadFromFirestore() {
  if (!firestoreDb) {
    return null;
  }

  try {
    const doc = await firestoreDb.doc(CONTENT_DOC_PATH).get();
    if (!doc.exists) {
      return null;
    }
    const data = doc.data();
    if (!data || !data.passage || !data.questions) {
      return null;
    }
    const payload = normalizePayload(data.passage, data.questions, 'firestore');
    payload.testId = data.testId || '';
    return payload;
  } catch (error) {
    setStatus(getFirestoreErrorMessage(error, 'Could not load cloud content'));
    return null;
  }
}

async function saveToFirestore(payload) {
  if (!firestoreDb) {
    throw new Error('Firebase is not configured yet.');
  }

  const nowMs = Date.now();
  const title = extractTestTitle(payload);
  const testRef = firestoreDb.collection(TEST_COLLECTION).doc();

  await testRef.set({
    title: title,
    passage: payload.passage,
    questions: payload.questions,
    sourceType: payload.sourceType,
    createdAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    createdAtMs: nowMs,
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: nowMs
  });

  await firestoreDb.doc(CONTENT_DOC_PATH).set({
    title: title,
    testId: testRef.id,
    passage: payload.passage,
    questions: payload.questions,
    sourceType: payload.sourceType,
    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: nowMs
  }, { merge: true });

  try {
    await mirrorToRealtimeDatabase(testRef.id, title, payload, nowMs);
  } catch (error) {
    setStatus('Saved to Firestore, but failed to mirror to Realtime Database. Check Realtime Database rules.');
  }

  return {
    id: testRef.id,
    title: title
  };
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsText(file);
  });
}

function isTextFile(file) {
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith('.md') || lowerName.endsWith('.txt');
}

function clearUploadInputs() {
  const passageFileInput = document.getElementById('passageFileInput');
  const questionsFileInput = document.getElementById('questionsFileInput');
  const passagePasteInput = document.getElementById('passagePasteInput');
  const questionsPasteInput = document.getElementById('questionsPasteInput');

  if (passageFileInput) {
    passageFileInput.value = '';
  }
  if (questionsFileInput) {
    questionsFileInput.value = '';
  }
  if (passagePasteInput) {
    passagePasteInput.value = '';
  }
  if (questionsPasteInput) {
    questionsPasteInput.value = '';
  }
}

async function uploadAndRender(payload, successLabel) {
  const validationMessage = validatePayload(payload);
  if (validationMessage) {
    setStatus(validationMessage);
    return;
  }

  try {
    setStatus('Uploading to Firestore...');
    const result = await saveToFirestore(payload);
    saveToLocalCache(payload);
    renderContent(payload, successLabel);
    activeUploadedTestId = result.id;
    await refreshUploadedTests(result.id);
    clearUploadInputs();
  } catch (error) {
    setStatus(getFirestoreErrorMessage(error, 'Upload failed'));
  }
}

function initUploadControls() {
  const uploadFilesBtn = document.getElementById('uploadFilesBtn');
  const uploadPasteBtn = document.getElementById('uploadPasteBtn');
  const loadDefaultBtn = document.getElementById('loadDefaultBtn');
  const passageFileInput = document.getElementById('passageFileInput');
  const questionsFileInput = document.getElementById('questionsFileInput');
  const passagePasteInput = document.getElementById('passagePasteInput');
  const questionsPasteInput = document.getElementById('questionsPasteInput');
  const refreshTestsBtn = document.getElementById('refreshTestsBtn');
  const testsList = document.getElementById('testsList');

  if (!uploadFilesBtn || !uploadPasteBtn || !loadDefaultBtn) {
    return;
  }

  if (refreshTestsBtn) {
    refreshTestsBtn.addEventListener('click', async () => {
      await refreshUploadedTests(activeUploadedTestId);
    });
  }

  if (testsList) {
    testsList.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const item = target.closest('.test-item');
      if (!item) {
        return;
      }
      const testId = item.getAttribute('data-test-id') || '';
      await loadTestById(testId);
    });
  }

  uploadFilesBtn.addEventListener('click', async () => {
    const passageFile = passageFileInput && passageFileInput.files ? passageFileInput.files[0] : null;
    const questionsFile = questionsFileInput && questionsFileInput.files ? questionsFileInput.files[0] : null;

    if (!passageFile || !questionsFile) {
      setStatus('Select both passage and questions files first.');
      return;
    }

    if (!isTextFile(passageFile) || !isTextFile(questionsFile)) {
      setStatus('Only .md or .txt files are supported.');
      return;
    }

    try {
      const [passageText, questionsText] = await Promise.all([
        readTextFile(passageFile),
        readTextFile(questionsFile)
      ]);
      const payload = normalizePayload(passageText, questionsText, 'file-upload');
      await uploadAndRender(payload, 'Uploaded and loaded from Firestore (file mode).');
    } catch (error) {
      setStatus('Failed to read selected files.');
    }
  });

  uploadPasteBtn.addEventListener('click', async () => {
    const payload = normalizePayload(
      passagePasteInput ? passagePasteInput.value : '',
      questionsPasteInput ? questionsPasteInput.value : '',
      'paste-upload'
    );
    await uploadAndRender(payload, 'Uploaded and loaded from Firestore (paste mode).');
  });

  loadDefaultBtn.addEventListener('click', async () => {
    try {
      const payload = await loadFromDefaultFiles();
      renderContent(payload, 'Loaded from local default files.');
      saveToLocalCache(payload);
    } catch (error) {
      setStatus('Could not reload default files. Run from a local server.');
    }
  });
}

async function loadContent() {
  const passageEl = document.getElementById('passageContent');
  const questionsEl = document.getElementById('questionsContent');

  try {
    const remotePayload = await loadFromFirestore();
    if (remotePayload) {
      activeUploadedTestId = remotePayload.testId || '';
      renderContent(remotePayload, 'Loaded latest cloud content from Firestore.');
      saveToLocalCache(remotePayload);
      await refreshUploadedTests(activeUploadedTestId);
      return;
    }

    const cachePayload = loadFromLocalCache();
    if (cachePayload) {
      renderContent(cachePayload, 'Loaded from local cache.');
      await refreshUploadedTests();
      return;
    }

    const defaultPayload = await loadFromDefaultFiles();
    renderContent(defaultPayload, 'Loaded from passage.md and questions.md');
    await refreshUploadedTests();
  } catch (error) {
    passageEl.textContent = 'Failed to load content.';
    questionsEl.textContent = 'Unable to load any content source.';
    setStatus('Tip: run this from a local server (not file://) and configure firebase-config.js for cloud data.');
  }
}

function initTimer() {
  const timerDisplay = document.getElementById('timerDisplay');
  const startTimerBtn = document.getElementById('startTimerBtn');
  const stopTimerBtn = document.getElementById('stopTimerBtn');

  if (!timerDisplay || !startTimerBtn || !stopTimerBtn) {
    return;
  }

  let elapsedSeconds = 0;
  let timerId = null;

  function formatTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
      return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
    }
    return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  }

  startTimerBtn.addEventListener('click', () => {
    if (timerId !== null) {
      return;
    }

    startTimerBtn.disabled = true;
    startTimerBtn.textContent = 'Running';
    stopTimerBtn.disabled = false;

    timerId = window.setInterval(() => {
      elapsedSeconds += 1;
      timerDisplay.textContent = formatTime(elapsedSeconds);
    }, 1000);
  });

  stopTimerBtn.addEventListener('click', () => {
    if (timerId === null) {
      return;
    }

    window.clearInterval(timerId);
    timerId = null;
    startTimerBtn.disabled = false;
    startTimerBtn.textContent = 'Start timer';
    stopTimerBtn.disabled = true;
  });
}

function initColumnResize() {
  const container = document.querySelector('.container');
  const resizer = document.getElementById('columnResizer');
  const minLeftWidth = 280;
  const minRightWidth = 240;
  let isResizing = false;

  if (!container || !resizer) {
    return;
  }

  const savedWidth = localStorage.getItem('leftColumnWidthPx');
  if (savedWidth) {
    document.documentElement.style.setProperty('--left-col', savedWidth + 'px');
  }

  function updateWidth(clientX) {
    const rect = container.getBoundingClientRect();
    const resizerWidth = resizer.getBoundingClientRect().width;
    const maxLeft = Math.max(minLeftWidth, rect.width - minRightWidth - resizerWidth - 10);
    const nextLeft = Math.min(Math.max(clientX - rect.left, minLeftWidth), maxLeft);
    document.documentElement.style.setProperty('--left-col', nextLeft + 'px');
    localStorage.setItem('leftColumnWidthPx', String(Math.round(nextLeft)));
  }

  function onPointerMove(event) {
    if (!isResizing) {
      return;
    }
    updateWidth(event.clientX);
  }

  function stopResize() {
    isResizing = false;
    document.body.style.cursor = '';
  }

  resizer.addEventListener('pointerdown', (event) => {
    if (window.matchMedia('(max-width: 720px)').matches) {
      return;
    }
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    resizer.setPointerCapture(event.pointerId);
  });

  resizer.addEventListener('pointermove', onPointerMove);
  resizer.addEventListener('pointerup', stopResize);
  resizer.addEventListener('pointercancel', stopResize);
  window.addEventListener('resize', () => {
    if (window.matchMedia('(max-width: 720px)').matches) {
      document.documentElement.style.setProperty('--left-col', '58%');
    }
  });
}

function initHighlightTools() {
  const tools = document.getElementById('selectionTools');
  const highlightBtn = document.getElementById('highlightBtn');
  const clearSelectedBtn = document.getElementById('clearSelectedBtn');
  const clearBtn = document.getElementById('clearHighlightBtn');
  const swatches = Array.from(document.querySelectorAll('.swatch'));
  const leftPane = document.querySelector('.left');
  const rightPane = document.querySelector('.right');
  let selectedHighlightNode = null;
  let currentHighlightColor = '#fff59a';

  function hideTools() {
    tools.style.display = 'none';
    tools.setAttribute('aria-hidden', 'true');
    clearSelectedBtn.style.display = 'none';
    selectedHighlightNode = null;
  }

  function isSelectionInsidePane(range) {
    const node = range.commonAncestorContainer;
    return leftPane.contains(node) || rightPane.contains(node);
  }

  function isSelectionInsideSectionLabel(range) {
    const commonEl = range.commonAncestorContainer.nodeType === 1
      ? range.commonAncestorContainer
      : range.commonAncestorContainer.parentElement;

    if (commonEl && commonEl.closest('.section-label')) {
      return true;
    }

    if (range.startContainer.nodeType === 1) {
      const startEl = range.startContainer;
      if (startEl.closest && startEl.closest('.section-label')) {
        return true;
      }
    } else if (range.startContainer.parentElement && range.startContainer.parentElement.closest('.section-label')) {
      return true;
    }

    if (range.endContainer.nodeType === 1) {
      const endEl = range.endContainer;
      if (endEl.closest && endEl.closest('.section-label')) {
        return true;
      }
    } else if (range.endContainer.parentElement && range.endContainer.parentElement.closest('.section-label')) {
      return true;
    }

    return false;
  }

  function unwrapHighlight(node) {
    if (!node || !node.parentNode) {
      return;
    }
    const parent = node.parentNode;
    while (node.firstChild) {
      parent.insertBefore(node.firstChild, node);
    }
    parent.removeChild(node);
  }

  function getSelectedHighlight(range) {
    const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    const endEl = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
    const commonEl = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;

    const startHighlight = startEl ? startEl.closest('.highlight') : null;
    const endHighlight = endEl ? endEl.closest('.highlight') : null;
    const commonHighlight = commonEl ? commonEl.closest('.highlight') : null;

    if (startHighlight && startHighlight === endHighlight) {
      return startHighlight;
    }
    return commonHighlight;
  }

  function setActiveSwatch(colorValue) {
    swatches.forEach((swatch) => {
      swatch.classList.toggle('active', swatch.dataset.value === colorValue);
    });
  }

  function updateToolsPosition() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideTools();
      return;
    }

    const range = selection.getRangeAt(0);
    if (!isSelectionInsidePane(range)) {
      hideTools();
      return;
    }
    if (isSelectionInsideSectionLabel(range)) {
      hideTools();
      return;
    }

    const rect = range.getBoundingClientRect();
    const toolbarWidth = tools.offsetWidth || 260;
    const viewportPadding = 8;
    const top = Math.max(viewportPadding, rect.top - 44);
    const preferredLeft = rect.left + (rect.width / 2) - (toolbarWidth / 2);
    const maxLeft = Math.max(viewportPadding, window.innerWidth - toolbarWidth - viewportPadding);
    const left = Math.min(Math.max(preferredLeft, viewportPadding), maxLeft);

    tools.style.top = top + 'px';
    tools.style.left = left + 'px';
    tools.style.display = 'flex';
    tools.setAttribute('aria-hidden', 'false');

    selectedHighlightNode = getSelectedHighlight(range);
    clearSelectedBtn.style.display = selectedHighlightNode ? 'inline-block' : 'none';
  }

  highlightBtn.addEventListener('click', () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      hideTools();
      return;
    }

    const range = selection.getRangeAt(0);
    if (!isSelectionInsidePane(range)) {
      hideTools();
      return;
    }
    if (isSelectionInsideSectionLabel(range)) {
      hideTools();
      return;
    }

    const wrapper = document.createElement('span');
    wrapper.className = 'highlight';
    wrapper.style.backgroundColor = currentHighlightColor;

    try {
      range.surroundContents(wrapper);
    } catch (error) {
      const fragment = range.extractContents();
      wrapper.appendChild(fragment);
      range.insertNode(wrapper);
    }

    selection.removeAllRanges();
    hideTools();
  });

  clearSelectedBtn.addEventListener('click', () => {
    if (selectedHighlightNode) {
      unwrapHighlight(selectedHighlightNode);
    }
    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }
    hideTools();
  });

  clearBtn.addEventListener('click', () => {
    document.querySelectorAll('.highlight').forEach((node) => {
      unwrapHighlight(node);
    });
    hideTools();
  });

  swatches.forEach((swatch) => {
    swatch.addEventListener('click', () => {
      currentHighlightColor = swatch.dataset.value || '#fff59a';
      setActiveSwatch(currentHighlightColor);
    });
  });

  document.addEventListener('mouseup', updateToolsPosition);
  document.addEventListener('keyup', updateToolsPosition);
  document.addEventListener('mousedown', (event) => {
    if (!tools.contains(event.target)) {
      setTimeout(updateToolsPosition, 0);
    }
  });
  window.addEventListener('resize', hideTools);
}

async function bootstrap() {
  initTimer();
  initColumnResize();
  initHighlightTools();
  initUploadControls();

  const firebaseState = initFirebase();
  if (firebaseState.ready) {
    setStatus('Firebase connected. Checking Firestore...');
    const firestoreState = await verifyFirestoreDatabase();
    setUploadControlsEnabled(firestoreState.ready);
    if (!firestoreState.ready) {
      setStatus(firestoreState.reason + ' Loading local content...');
    } else {
      setStatus('Firebase connected. Loading cloud content...');
    }
  } else {
    setUploadControlsEnabled(false);
    setStatus(firebaseState.reason + ' Loading local content...');
  }

  await loadContent();
}

bootstrap();
