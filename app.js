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

async function loadContent() {
  const passageEl = document.getElementById('passageContent');
  const questionsEl = document.getElementById('questionsContent');
  const status = document.getElementById('statusMsg');

  try {
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

    passageEl.innerHTML = renderMarkdown(passageText);
    questionsEl.innerHTML = renderMarkdown(questionsText);
    status.textContent = 'Loaded from passage.md and questions.md';
  } catch (error) {
    passageEl.textContent = 'Failed to load passage.md';
    questionsEl.textContent = 'Failed to load questions.md';
    status.textContent = 'Tip: run this from a local server (not file://) so fetch() can read text files.';
  }
}

function initTimer() {
  const timerDisplay = document.getElementById('timerDisplay');
  const startTimerBtn = document.getElementById('startTimerBtn');

  if (!timerDisplay || !startTimerBtn) {
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

    timerId = window.setInterval(() => {
      elapsedSeconds += 1;
      timerDisplay.textContent = formatTime(elapsedSeconds);
    }, 1000);
  });
}

function initColumnResize() {
  const container = document.querySelector('.container');
  const resizer = document.getElementById('columnResizer');
  const minPaneWidth = 280;
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
    const maxLeft = rect.width - minPaneWidth - resizerWidth;
    const nextLeft = Math.min(Math.max(clientX - rect.left, minPaneWidth), maxLeft);
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

    const rect = range.getBoundingClientRect();
    const top = Math.max(8, rect.top + window.scrollY - 44);
    const left = Math.max(8, rect.left + window.scrollX);

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

initTimer();
initColumnResize();
initHighlightTools();
loadContent();
