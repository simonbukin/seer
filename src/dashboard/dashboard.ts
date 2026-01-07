/**
 * Seer Dashboard Main Script
 *
 * External dashboard for global analytics that works with Yomitan and other extensions.
 */

// Import CSS directly (Vite handles bundling)
import '../shared/components/seer-components.css';
import './dashboard.css';

import { bridge } from './bridge';
import type { TopWord, I1Sentence } from './bridge';
import {
  renderWordItem,
  attachWordItemListeners,
  renderSentenceItem,
  attachSentenceItemListeners,
  getRelativeTime,
  escapeHtml,
} from '@shared/components';
import { initializeTheme, applyTheme } from '@shared/theme';

// DOM Elements
const extensionStatusEl = document.getElementById('extension-status')!;
const noExtensionEl = document.getElementById('no-extension')!;
const mainContentEl = document.getElementById('main-content')!;
const versionInfoEl = document.getElementById('version-info')!;
const retryBtn = document.getElementById('retry-connection')!;
const syncBtn = document.getElementById('sync-btn')!;

// Tab elements
const tabButtons = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

// Vocabulary tab elements
const vocabSearchEl = document.getElementById('vocab-search') as HTMLInputElement;
const vocabStatusFilterEl = document.getElementById('vocab-status-filter') as HTMLSelectElement;
const vocabMatureCountEl = document.getElementById('vocab-mature-count')!;
const vocabYoungCountEl = document.getElementById('vocab-young-count')!;
const vocabLearningCountEl = document.getElementById('vocab-learning-count')!;
const vocabNewCountEl = document.getElementById('vocab-new-count')!;
const vocabIgnoredCountEl = document.getElementById('vocab-ignored-count')!;
const vocabListEl = document.getElementById('vocab-list')!;

// Encounters tab elements
const encountersTimeFilterEl = document.getElementById('encounters-time-filter') as HTMLSelectElement;
const encountersSortEl = document.getElementById('encounters-sort') as HTMLSelectElement;
const encountersMinEl = document.getElementById('encounters-min') as HTMLSelectElement;
const encountersStatusFilterEl = document.getElementById('encounters-status-filter') as HTMLSelectElement;
const encountersTotalEl = document.getElementById('encounters-total')!;
const encountersUnknownEl = document.getElementById('encounters-unknown')!;
const encountersListEl = document.getElementById('encounters-list')!;
const wordDetailPanelEl = document.getElementById('word-detail-panel')!;
const detailWordEl = document.getElementById('detail-word')!;
const detailContentEl = document.getElementById('detail-content')!;
const closeDetailBtn = document.getElementById('close-detail')!;

// i+1 Mining tab elements
const i1UnknownFilterEl = document.getElementById('i1-unknown-filter') as HTMLSelectElement;
const i1TimeFilterEl = document.getElementById('i1-time-filter') as HTMLSelectElement;
const i1RefreshBtn = document.getElementById('i1-refresh')!;
const i1TotalEl = document.getElementById('i1-total')!;
const i1UniqueWordsEl = document.getElementById('i1-unique-words')!;
const i1AvgEl = document.getElementById('i1-avg')!;
const i1HighValueWordsEl = document.getElementById('i1-high-value-words')!;
const i1SentencesEl = document.getElementById('i1-sentences')!;
const i1LoadMoreBtn = document.getElementById('i1-load-more')!;

// Sentences tab elements
const sentencesSearchEl = document.getElementById('sentences-search') as HTMLInputElement;
const sentencesSourceFilterEl = document.getElementById('sentences-source-filter') as HTMLSelectElement;
const sentencesUnknownFilterEl = document.getElementById('sentences-unknown-filter') as HTMLSelectElement;
const sentencesSortEl = document.getElementById('sentences-sort') as HTMLSelectElement;
const sentencesTimeFilterEl = document.getElementById('sentences-time-filter') as HTMLSelectElement;
const sentencesTotalEl = document.getElementById('sentences-total')!;
const sentencesShowingEl = document.getElementById('sentences-showing')!;
const sentencesListEl = document.getElementById('sentences-list')!;
const sentencesLoadMoreBtn = document.getElementById('sentences-load-more')!;

// Sites tab elements
const sitesSortEl = document.getElementById('sites-sort') as HTMLSelectElement;
const sitesListEl = document.getElementById('sites-list')!;

// Library tab elements
const librarySearchEl = document.getElementById('library-search') as HTMLInputElement;
const libraryImportBtn = document.getElementById('library-import-btn')!;
const libraryImportFilesEl = document.getElementById('library-import-files') as HTMLInputElement;
const libraryRecalcBtn = document.getElementById('library-recalc-btn')!;
const libraryClearBtn = document.getElementById('library-clear-btn')!;
const librarySourcesEl = document.getElementById('library-sources')!;
const librarySentencesEl = document.getElementById('library-sentences')!;
const libraryAvgCompEl = document.getElementById('library-avg-comp')!;
const libraryReadyEl = document.getElementById('library-ready')!;
const libraryImportStatusEl = document.getElementById('library-import-status')!;
const libraryImportTextEl = document.getElementById('library-import-text')!;
const libraryImportProgressEl = document.getElementById('library-import-progress')!;
const libraryImportBarEl = document.getElementById('library-import-bar') as HTMLProgressElement;
const libraryListEl = document.getElementById('library-list')!;
const libraryI1SentencesEl = document.getElementById('library-i1-sentences')!;
const libraryI1LoadMoreBtn = document.getElementById('library-i1-load-more')!;
const librarySearchResultsEl = document.getElementById('library-search-results')!;
const librarySearchListEl = document.getElementById('library-search-list')!;
const librarySearchLoadMoreBtn = document.getElementById('library-search-load-more')!;

// State
let vocabData: { known: string[]; ignored: string[] } | null = null;
let i1Offset = 0;
let sentencesOffset = 0;
let libraryI1Offset = 0;
let librarySearchOffset = 0;
let librarySearchQuery = '';
const I1_PAGE_SIZE = 20;
const SENTENCES_PAGE_SIZE = 50;
const LIBRARY_I1_PAGE_SIZE = 30;

// Initialize
async function init() {
  // Handle theme - check system preference and listen for changes
  const applySystemTheme = () => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  };

  applySystemTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySystemTheme);

  // Set up tab switching
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')!));
  });

  // Set up detail panel close
  closeDetailBtn.addEventListener('click', () => {
    wordDetailPanelEl.classList.add('hidden');
  });

  // Set up retry button
  retryBtn.addEventListener('click', connectToExtension);

  // Set up sync button
  syncBtn.addEventListener('click', handleSync);

  // Set up filter listeners
  vocabSearchEl.addEventListener('input', debounce(loadVocabulary, 300));
  vocabStatusFilterEl.addEventListener('change', loadVocabulary);

  encountersTimeFilterEl.addEventListener('change', loadEncounters);
  encountersSortEl.addEventListener('change', loadEncounters);
  encountersMinEl.addEventListener('change', loadEncounters);
  encountersStatusFilterEl.addEventListener('change', loadEncounters);

  i1UnknownFilterEl.addEventListener('change', loadI1Mining);
  i1TimeFilterEl.addEventListener('change', loadI1Mining);
  i1RefreshBtn.addEventListener('click', loadI1Mining);
  i1LoadMoreBtn.addEventListener('click', loadMoreI1Sentences);

  sentencesSearchEl.addEventListener('input', debounce(loadSentences, 300));
  sentencesSourceFilterEl.addEventListener('change', loadSentences);
  sentencesUnknownFilterEl.addEventListener('change', loadSentences);
  sentencesSortEl.addEventListener('change', loadSentences);
  sentencesTimeFilterEl.addEventListener('change', loadSentences);
  sentencesLoadMoreBtn.addEventListener('click', loadMoreSentences);

  sitesSortEl.addEventListener('change', loadSites);

  // Library tab listeners
  librarySearchEl.addEventListener('input', debounce(handleLibrarySearch, 300));
  libraryImportBtn.addEventListener('click', () => libraryImportFilesEl.click());
  libraryImportFilesEl.addEventListener('change', handleLibraryImport);
  libraryRecalcBtn.addEventListener('click', handleLibraryRecalc);
  libraryClearBtn.addEventListener('click', handleLibraryClear);
  libraryI1LoadMoreBtn.addEventListener('click', loadMoreLibraryI1);
  librarySearchLoadMoreBtn.addEventListener('click', loadMoreLibrarySearch);

  // Try to connect
  await connectToExtension();
}

// Connect to extension
async function connectToExtension() {
  extensionStatusEl.className = 'status-indicator';
  extensionStatusEl.querySelector('.status-text')!.textContent = 'Connecting...';

  try {
    await bridge.waitForReady();

    // Connected!
    extensionStatusEl.className = 'status-indicator connected';
    extensionStatusEl.querySelector('.status-text')!.textContent = 'Connected';
    versionInfoEl.textContent = `Extension v${bridge.version}`;

    noExtensionEl.classList.add('hidden');
    mainContentEl.classList.remove('hidden');

    // Load initial data for active tab
    await loadActiveTab();
  } catch (e) {
    // Not connected
    extensionStatusEl.className = 'status-indicator error';
    extensionStatusEl.querySelector('.status-text')!.textContent = 'Not connected';
    versionInfoEl.textContent = 'Extension not connected';

    noExtensionEl.classList.remove('hidden');
    mainContentEl.classList.add('hidden');
  }
}

// Switch tabs
function switchTab(tabId: string) {
  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });

  tabContents.forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabId}`);
  });

  // Load data for the new tab
  loadActiveTab();
}

// Navigate to Sentences tab with a word filter
function navigateToSentencesWithWord(word: string) {
  sentencesSearchEl.value = word;
  switchTab('sentences');
}

// Load data for active tab
async function loadActiveTab() {
  const activeTab = document.querySelector('.tab.active')?.getAttribute('data-tab');

  switch (activeTab) {
    case 'vocabulary':
      await loadVocabulary();
      break;
    case 'encounters':
      await loadEncounters();
      break;
    case 'sentences':
      await loadSentences();
      break;
    case 'i1-mining':
      await loadI1Mining();
      break;
    case 'sites':
      await loadSites();
      break;
    case 'library':
      await loadLibrary();
      break;
  }
}

// Handle sync
async function handleSync() {
  syncBtn.textContent = 'Syncing...';
  (syncBtn as HTMLButtonElement).disabled = true;

  try {
    await bridge.syncVocabulary();
    syncBtn.textContent = '✓ Synced';
    await loadActiveTab();
  } catch (e) {
    syncBtn.textContent = '✗ Failed';
  } finally {
    setTimeout(() => {
      syncBtn.textContent = 'Sync';
      (syncBtn as HTMLButtonElement).disabled = false;
    }, 2000);
  }
}

// ============================================
// Vocabulary Tab
// ============================================

async function loadVocabulary() {
  vocabListEl.innerHTML = '<div class="seer-list-loading">Loading vocabulary...</div>';

  try {
    const data = await bridge.getVocabulary();
    vocabData = { known: data.known, ignored: data.ignored };

    // Calculate knowledge level counts
    const levelCounts = { mature: 0, young: 0, learning: 0, new: 0 };
    for (const [, knowledge] of data.knowledgeLevels || []) {
      levelCounts[knowledge.level]++;
    }

    // Update stats
    vocabMatureCountEl.textContent = levelCounts.mature.toLocaleString();
    vocabYoungCountEl.textContent = levelCounts.young.toLocaleString();
    vocabLearningCountEl.textContent = levelCounts.learning.toLocaleString();
    vocabNewCountEl.textContent = levelCounts.new.toLocaleString();
    vocabIgnoredCountEl.textContent = data.ignored.length.toLocaleString();

    // Filter and display
    const searchQuery = vocabSearchEl.value.toLowerCase();
    const statusFilter = vocabStatusFilterEl.value;

    // Build word list based on filter
    let words: Array<{ word: string; status: 'known' | 'ignored' }> = [];

    if (statusFilter === 'all' || statusFilter === 'known') {
      words.push(...data.known.map(w => ({ word: w, status: 'known' as const })));
    }
    if (statusFilter === 'all' || statusFilter === 'ignored') {
      words.push(...data.ignored.map(w => ({ word: w, status: 'ignored' as const })));
    }

    // Search filter
    if (searchQuery) {
      words = words.filter(w => w.word.includes(searchQuery));
    }

    // Sort alphabetically
    words.sort((a, b) => a.word.localeCompare(b.word, 'ja'));

    // Limit display
    const displayWords = words.slice(0, 500);

    if (displayWords.length === 0) {
      vocabListEl.innerHTML = '<div class="seer-list-empty">No words match filters</div>';
      return;
    }

    // Render
    vocabListEl.innerHTML = displayWords.map(w =>
      renderWordItem({
        word: w.word,
        count: 0,
        status: w.status,
        showActions: false, // Vocab tab doesn't need actions (already known/ignored)
      })
    ).join('');

    // Attach click handlers for navigation to sentences
    attachWordItemListeners(vocabListEl, {
      onClick: (word) => navigateToSentencesWithWord(word),
    });

  } catch (e) {
    vocabListEl.innerHTML = '<div class="seer-list-empty">Failed to load vocabulary</div>';
    console.error('[Dashboard] Failed to load vocabulary:', e);
  }
}

// ============================================
// Encounters Tab
// ============================================

async function loadEncounters() {
  encountersListEl.innerHTML = '<div class="seer-list-loading">Loading encounters...</div>';

  try {
    const result = await bridge.getEncounterStats({
      timeRange: encountersTimeFilterEl.value as 'all' | 'today' | 'week' | 'month',
      sortBy: encountersSortEl.value as 'count' | 'recent' | 'frequency' | 'alpha',
      minEncounters: parseInt(encountersMinEl.value, 10),
      limit: 300,
    });

    // Debug: log the result structure
    console.log('[Dashboard] getEncounterStats result:', result);

    // Defensive check for malformed response
    if (!result || typeof result !== 'object') {
      throw new Error('Invalid response from getEncounterStats');
    }

    const words = result.words ?? [];

    // Apply status filter
    const statusFilter = encountersStatusFilterEl.value;
    const filteredWords = statusFilter === 'all'
      ? words
      : words.filter(w => w.status === statusFilter);

    // Update stats (show filtered counts)
    encountersTotalEl.textContent = filteredWords.length.toLocaleString();
    const unknownCount = filteredWords.filter(w => w.status === 'unknown').length;
    encountersUnknownEl.textContent = unknownCount.toLocaleString();

    if (filteredWords.length === 0) {
      encountersListEl.innerHTML = '<div class="seer-list-empty">No encounters found</div>';
      return;
    }

    // Render word list
    encountersListEl.innerHTML = filteredWords.map(w =>
      renderWordItem({
        word: w.baseForm,
        surface: w.surface !== w.baseForm ? w.surface : undefined,
        count: w.count,
        frequency: w.frequency,
        status: w.status,
        pages: w.pages.length,
        lastSeen: w.lastSeen,
        showActions: true,
      })
    ).join('');

    // Attach handlers
    attachWordItemListeners(encountersListEl, {
      onMarkKnown: async (word) => {
        await bridge.addKnownWord(word);
        await loadEncounters();
      },
      onIgnore: async (word) => {
        await bridge.addIgnoredWord(word);
        await loadEncounters();
      },
      onClick: (word) => {
        navigateToSentencesWithWord(word);
      },
    });

  } catch (e) {
    encountersListEl.innerHTML = '<div class="seer-list-empty">Failed to load encounters</div>';
    console.error('[Dashboard] Failed to load encounters:', e);
  }
}

async function showWordDetail(word: string, wordData: TopWord) {
  detailWordEl.textContent = word;
  wordDetailPanelEl.classList.remove('hidden');

  detailContentEl.innerHTML = '<div class="seer-list-loading">Loading...</div>';

  try {
    const encounters = await bridge.getWordEncounters(word);

    detailContentEl.innerHTML = `
      <div class="detail-stats">
        <div class="stat-row">
          <span class="stat-label">Encounters</span>
          <span class="stat-value">${wordData.count}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Pages</span>
          <span class="stat-value">${wordData.pages.length}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Frequency Rank</span>
          <span class="stat-value">${wordData.frequency?.toLocaleString() || '—'}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Last Seen</span>
          <span class="stat-value">${getRelativeTime(wordData.lastSeen)}</span>
        </div>
      </div>

      <h4>Recent Encounters</h4>
      <div class="encounter-list">
        ${encounters.slice(0, 10).map(e => `
          <div class="encounter-item">
            <div class="encounter-time">${getRelativeTime(e.timestamp)}</div>
            ${e.sentence ? `<div class="encounter-sentence">${escapeHtml(e.sentence)}</div>` : ''}
            <a class="encounter-url" href="${escapeHtml(e.url)}" target="_blank">${escapeHtml(new URL(e.url).hostname)}</a>
          </div>
        `).join('')}
      </div>
    `;
  } catch (e) {
    detailContentEl.innerHTML = '<div class="seer-list-empty">Failed to load details</div>';
    console.error('[Dashboard] Failed to load word detail:', e);
  }
}

// ============================================
// i+1 Mining Tab
// ============================================

async function loadI1Mining() {
  i1Offset = 0;
  i1HighValueWordsEl.innerHTML = '<div class="seer-list-loading">Loading...</div>';
  i1SentencesEl.innerHTML = '<div class="seer-list-loading">Loading...</div>';

  try {
    // Load summary
    const summary = await bridge.getI1Summary();
    i1TotalEl.textContent = summary.totalI1Sentences.toLocaleString();
    i1UniqueWordsEl.textContent = summary.uniqueI1Words.toLocaleString();
    i1AvgEl.textContent = summary.avgI1SentencesPerWord.toFixed(1);

    // Load high-value words
    const highValueWords = await bridge.getI1HighValueWords(20);

    if (highValueWords.length === 0) {
      i1HighValueWordsEl.innerHTML = '<div class="seer-list-empty">No high-value words found</div>';
    } else {
      i1HighValueWordsEl.innerHTML = highValueWords.map(w =>
        renderWordItem({
          word: w.word,
          count: w.i1SentenceCount,
          status: 'unknown',
          compact: true,
          showActions: true,
        })
      ).join('');

      attachWordItemListeners(i1HighValueWordsEl, {
        onMarkKnown: async (word) => {
          const scrollPos = saveI1ScrollPositions();
          await bridge.addKnownWord(word);
          await loadI1Mining();
          restoreI1ScrollPositions(scrollPos);
        },
        onIgnore: async (word) => {
          const scrollPos = saveI1ScrollPositions();
          await bridge.addIgnoredWord(word);
          await loadI1Mining();
          restoreI1ScrollPositions(scrollPos);
        },
        onClick: (word) => navigateToSentencesWithWord(word),
      });
    }

    // Load sentences
    await loadI1Sentences();

  } catch (e) {
    i1HighValueWordsEl.innerHTML = '<div class="seer-list-empty">Failed to load</div>';
    i1SentencesEl.innerHTML = '<div class="seer-list-empty">Failed to load</div>';
    console.error('[Dashboard] Failed to load i+1 mining:', e);
  }
}

async function loadI1Sentences() {
  try {
    const unknownCount = parseInt(i1UnknownFilterEl.value, 10) as 1 | 2 | 3;
    const sentences = await bridge.getAllI1Sentences({
      limit: I1_PAGE_SIZE,
      unknownCount,
    });

    if (sentences.length === 0) {
      i1SentencesEl.innerHTML = '<div class="seer-list-empty">No sentences found</div>';
      i1LoadMoreBtn.classList.add('hidden');
      return;
    }

    i1SentencesEl.innerHTML = sentences.map(s =>
      renderSentenceItem({
        text: s.text,
        targetWord: s.targetWord,
        url: s.url,
        timestamp: s.timestamp,
        showCopy: true,
        showActions: true,
        clickable: true,
      })
    ).join('');

    attachSentenceItemListeners(i1SentencesEl, {
      onClick: (url) => {
        window.open(url, '_blank');
      },
      onMarkKnown: async (word) => {
        const scrollPos = saveI1ScrollPositions();
        await bridge.addKnownWord(word);
        await loadI1Mining();
        restoreI1ScrollPositions(scrollPos);
      },
      onIgnore: async (word) => {
        const scrollPos = saveI1ScrollPositions();
        await bridge.addIgnoredWord(word);
        await loadI1Mining();
        restoreI1ScrollPositions(scrollPos);
      },
    });

    i1LoadMoreBtn.classList.toggle('hidden', sentences.length < I1_PAGE_SIZE);

  } catch (e) {
    i1SentencesEl.innerHTML = '<div class="seer-list-empty">Failed to load sentences</div>';
    console.error('[Dashboard] Failed to load i+1 sentences:', e);
  }
}

async function loadMoreI1Sentences() {
  i1Offset += I1_PAGE_SIZE;
  // TODO: Implement offset in bridge.getAllI1Sentences
  // For now, this is a placeholder
  console.log('[Dashboard] Load more i+1 sentences, offset:', i1Offset);
}

// ============================================
// Sentences Tab
// ============================================

async function loadSentences() {
  sentencesOffset = 0;
  sentencesListEl.innerHTML = '<div class="seer-list-loading">Loading sentences...</div>';

  try {
    const unknownFilter = parseInt(sentencesUnknownFilterEl.value, 10);
    const sourceFilter = sentencesSourceFilterEl.value as 'encountered' | 'library' | 'all';
    const sortBy = sentencesSortEl.value as 'recent' | 'shortest' | 'longest';

    const result = await bridge.getAllSentences({
      source: sourceFilter,
      timeRange: sentencesTimeFilterEl.value as 'all' | 'today' | 'week' | 'month',
      unknownCount: unknownFilter > 0 ? unknownFilter : undefined,
      sortBy,
      search: sentencesSearchEl.value || undefined,
      limit: SENTENCES_PAGE_SIZE,
      offset: 0,
    });

    // Update stats
    sentencesTotalEl.textContent = result.total.toLocaleString();
    sentencesShowingEl.textContent = result.sentences.length.toLocaleString();

    if (result.sentences.length === 0) {
      sentencesListEl.innerHTML = '<div class="seer-list-empty">No sentences found</div>';
      sentencesLoadMoreBtn.classList.add('hidden');
      return;
    }

    renderSentencesList(result.sentences, false);
    sentencesLoadMoreBtn.classList.toggle('hidden', !result.hasMore);

  } catch (e) {
    sentencesListEl.innerHTML = '<div class="seer-list-empty">Failed to load sentences</div>';
    console.error('[Dashboard] Failed to load sentences:', e);
  }
}

async function loadMoreSentences() {
  sentencesOffset += SENTENCES_PAGE_SIZE;
  sentencesLoadMoreBtn.textContent = 'Loading...';
  (sentencesLoadMoreBtn as HTMLButtonElement).disabled = true;

  try {
    const unknownFilter = parseInt(sentencesUnknownFilterEl.value, 10);
    const sourceFilter = sentencesSourceFilterEl.value as 'encountered' | 'library' | 'all';
    const sortBy = sentencesSortEl.value as 'recent' | 'shortest' | 'longest';

    const result = await bridge.getAllSentences({
      source: sourceFilter,
      timeRange: sentencesTimeFilterEl.value as 'all' | 'today' | 'week' | 'month',
      unknownCount: unknownFilter > 0 ? unknownFilter : undefined,
      sortBy,
      search: sentencesSearchEl.value || undefined,
      limit: SENTENCES_PAGE_SIZE,
      offset: sentencesOffset,
    });

    // Update showing count
    const currentShowing = parseInt(sentencesShowingEl.textContent || '0', 10);
    sentencesShowingEl.textContent = (currentShowing + result.sentences.length).toLocaleString();

    renderSentencesList(result.sentences, true);
    sentencesLoadMoreBtn.classList.toggle('hidden', !result.hasMore);

  } catch (e) {
    console.error('[Dashboard] Failed to load more sentences:', e);
  } finally {
    sentencesLoadMoreBtn.textContent = 'Load More';
    (sentencesLoadMoreBtn as HTMLButtonElement).disabled = false;
  }
}

function renderSentencesList(sentences: Array<{
  text: string;
  unknownWords: string[];
  url: string;
  pageTitle: string;
  timestamp: number;
  source?: 'encountered' | 'library';
  sourceId?: string;
}>, append: boolean) {
  const html = sentences.map(s => {
    // Highlight unknown words in the sentence
    let highlightedText = escapeHtml(s.text);
    for (const word of s.unknownWords) {
      const escaped = escapeHtml(word);
      highlightedText = highlightedText.replace(
        new RegExp(escaped, 'g'),
        `<mark>${escaped}</mark>`
      );
    }

    // Render source info based on type
    const isLibrary = s.source === 'library';
    let sourceHtml: string;
    if (isLibrary) {
      // For library sentences, show the source title with a library badge
      sourceHtml = `<span class="seer-sentence-source library-source" title="${escapeHtml(s.pageTitle)}">📚 ${escapeHtml(s.pageTitle)}</span>`;
    } else {
      // For encountered sentences, show the URL hostname with link
      let hostname = 'Unknown';
      try {
        hostname = new URL(s.url).hostname;
      } catch { /* ignore invalid URLs */ }
      sourceHtml = `<a class="seer-sentence-source" href="${escapeHtml(s.url)}" target="_blank" title="${escapeHtml(s.pageTitle)}">${escapeHtml(hostname)}</a>`;
    }

    // Only show timestamp for encountered sentences (library doesn't have meaningful timestamps)
    const timeHtml = !isLibrary && s.timestamp > 0
      ? `<span class="seer-sentence-time">${getRelativeTime(s.timestamp)}</span>`
      : '';

    return `
      <div class="seer-sentence-item ${isLibrary ? 'library-sentence' : 'clickable'}" ${!isLibrary ? `data-url="${escapeHtml(s.url)}"` : ''}>
        <div class="seer-sentence-text">${highlightedText}</div>
        <div class="seer-sentence-meta">
          <span class="seer-sentence-target">${s.unknownWords.length} unknown</span>
          ${sourceHtml}
          ${timeHtml}
          <button class="seer-sentence-copy" title="Copy sentence">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  if (append) {
    sentencesListEl.insertAdjacentHTML('beforeend', html);
  } else {
    sentencesListEl.innerHTML = html;
  }

  // Attach click handlers for copy buttons
  const newItems = append
    ? sentencesListEl.querySelectorAll('.seer-sentence-item:nth-last-child(-n+' + sentences.length + ')')
    : sentencesListEl.querySelectorAll('.seer-sentence-item');

  newItems.forEach((item, idx) => {
    const copyBtn = item.querySelector('.seer-sentence-copy');
    const sentence = sentences[idx];

    copyBtn?.addEventListener('click', async (e) => {
      e.stopPropagation();
      await navigator.clipboard.writeText(sentence.text);
      copyBtn.classList.add('copied');
      setTimeout(() => copyBtn.classList.remove('copied'), 1500);
    });

    // Click to open URL
    item.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.seer-sentence-copy, .seer-sentence-source')) return;
      window.open(sentence.url, '_blank');
    });
  });
}

// ============================================
// Sites Tab
// ============================================

async function loadSites() {
  sitesListEl.innerHTML = '<div class="seer-list-loading">Loading sites...</div>';

  try {
    const sites = await bridge.getSiteStats({
      sortBy: sitesSortEl.value as 'recent' | 'time' | 'comprehension',
      limit: 100,
    });

    if (sites.length === 0) {
      sitesListEl.innerHTML = '<div class="seer-list-empty">No site data found</div>';
      return;
    }

    sitesListEl.innerHTML = sites.map(s => `
      <div class="site-item">
        <div class="site-url">
          <a href="${escapeHtml(s.url)}" target="_blank">${escapeHtml(s.hostname)}</a>
        </div>
        <div class="site-stat">
          <div class="value">${s.comprehensionPercent.toFixed(0)}%</div>
          <div class="label">comprehension</div>
        </div>
        <div class="site-stat">
          <div class="value">${formatTime(s.totalTimeMs)}</div>
          <div class="label">time spent</div>
        </div>
        <div class="site-stat">
          <div class="value">${s.visitCount}</div>
          <div class="label">visits</div>
        </div>
      </div>
    `).join('');

  } catch (e) {
    sitesListEl.innerHTML = '<div class="seer-list-empty">Failed to load sites</div>';
    console.error('[Dashboard] Failed to load sites:', e);
  }
}

// ============================================
// Library Tab
// ============================================

async function loadLibrary() {
  libraryListEl.innerHTML = '<div class="seer-list-loading">Loading library...</div>';
  libraryI1SentencesEl.innerHTML = '<div class="seer-list-loading">Loading i+1 sentences...</div>';
  libraryI1Offset = 0;

  try {
    // Load stats
    const stats = await bridge.getLibraryStats();
    librarySourcesEl.textContent = stats.totalSources.toLocaleString();
    librarySentencesEl.textContent = stats.totalSentences.toLocaleString();
    libraryAvgCompEl.textContent = stats.avgComprehension ? `${stats.avgComprehension}%` : '--';
    libraryReadyEl.textContent = stats.readySources.toLocaleString();

    // Load sources
    const sources = await bridge.getLibrarySources({ limit: 100 });

    if (sources.length === 0) {
      libraryListEl.innerHTML = `
        <div class="seer-list-empty">
          <p>No content in library yet.</p>
          <p>Click "Import JSON" to add content.</p>
        </div>
      `;
      libraryI1SentencesEl.innerHTML = '<div class="seer-list-empty">Import content first</div>';
      libraryI1LoadMoreBtn.classList.add('hidden');
      return;
    }

    // Render source list (compact)
    libraryListEl.innerHTML = sources.map(s => `
      <div class="library-item" data-id="${escapeHtml(s.id)}">
        <div class="library-header">
          <span class="library-title">${escapeHtml(s.title)}</span>
          <span class="library-type">${escapeHtml(s.sourceType)}</span>
        </div>
        <div class="library-stats">
          <div class="library-comp">
            <div class="comp-bar" style="width: ${s.comprehensionPercent ?? 0}%"></div>
            <span class="comp-text">${s.comprehensionPercent ?? '--'}%</span>
          </div>
          <span class="library-stat">${s.i1SentenceCount ?? '--'} i+1</span>
        </div>
      </div>
    `).join('');

    // Load i+1 sentences
    await loadLibraryI1Sentences();

  } catch (e) {
    libraryListEl.innerHTML = '<div class="seer-list-empty">Failed to load library</div>';
    libraryI1SentencesEl.innerHTML = '<div class="seer-list-empty">Failed to load</div>';
    console.error('[Dashboard] Failed to load library:', e);
  }
}

async function loadLibraryI1Sentences() {
  try {
    const result = await bridge.getLibraryI1Sentences({
      limit: LIBRARY_I1_PAGE_SIZE,
      offset: libraryI1Offset
    });

    if (result.length === 0 && libraryI1Offset === 0) {
      libraryI1SentencesEl.innerHTML = '<div class="seer-list-empty">No i+1 sentences found. Try recalculating after syncing vocabulary.</div>';
      libraryI1LoadMoreBtn.classList.add('hidden');
      return;
    }

    const html = result.map(item => `
      <div class="seer-sentence-item library-sentence">
        <div class="seer-sentence-text">${escapeHtml(item.sentence.text).replace(
          new RegExp(escapeHtml(item.unknownWord), 'g'),
          `<mark>${escapeHtml(item.unknownWord)}</mark>`
        )}</div>
        <div class="seer-sentence-meta">
          <span class="seer-sentence-target">${escapeHtml(item.unknownWord)}</span>
          <span class="seer-sentence-source">${escapeHtml(item.sourceTitle)}</span>
          <button class="seer-sentence-copy" title="Copy sentence">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
      </div>
    `).join('');

    if (libraryI1Offset === 0) {
      libraryI1SentencesEl.innerHTML = html;
    } else {
      libraryI1SentencesEl.insertAdjacentHTML('beforeend', html);
    }

    // Attach copy handlers
    const items = libraryI1SentencesEl.querySelectorAll('.seer-sentence-item');
    items.forEach((item, idx) => {
      const copyBtn = item.querySelector('.seer-sentence-copy');
      const actualIdx = libraryI1Offset === 0 ? idx : libraryI1Offset + idx - LIBRARY_I1_PAGE_SIZE;
      if (actualIdx < result.length) {
        copyBtn?.addEventListener('click', async (e) => {
          e.stopPropagation();
          await navigator.clipboard.writeText(result[idx % LIBRARY_I1_PAGE_SIZE].sentence.text);
          copyBtn.classList.add('copied');
          setTimeout(() => copyBtn.classList.remove('copied'), 1500);
        });
      }
    });

    libraryI1LoadMoreBtn.classList.toggle('hidden', result.length < LIBRARY_I1_PAGE_SIZE);

  } catch (e) {
    console.error('[Dashboard] Failed to load library i+1 sentences:', e);
  }
}

async function loadMoreLibraryI1() {
  libraryI1Offset += LIBRARY_I1_PAGE_SIZE;
  libraryI1LoadMoreBtn.textContent = 'Loading...';
  (libraryI1LoadMoreBtn as HTMLButtonElement).disabled = true;

  await loadLibraryI1Sentences();

  libraryI1LoadMoreBtn.textContent = 'Load More';
  (libraryI1LoadMoreBtn as HTMLButtonElement).disabled = false;
}

async function handleLibrarySearch() {
  const query = librarySearchEl.value.trim();

  if (query.length < 2) {
    librarySearchResultsEl.classList.add('hidden');
    return;
  }

  librarySearchQuery = query;
  librarySearchOffset = 0;
  librarySearchResultsEl.classList.remove('hidden');
  librarySearchListEl.innerHTML = '<div class="seer-list-loading">Searching...</div>';

  await loadLibrarySearchResults();
}

async function loadLibrarySearchResults() {
  try {
    const result = await bridge.searchLibrarySentences({
      query: librarySearchQuery,
      limit: SENTENCES_PAGE_SIZE,
      offset: librarySearchOffset
    });

    if (result.sentences.length === 0 && librarySearchOffset === 0) {
      librarySearchListEl.innerHTML = '<div class="seer-list-empty">No sentences found</div>';
      librarySearchLoadMoreBtn.classList.add('hidden');
      return;
    }

    const html = result.sentences.map(s => `
      <div class="seer-sentence-item library-sentence">
        <div class="seer-sentence-text">${escapeHtml(s.text).replace(
          new RegExp(escapeHtml(librarySearchQuery), 'g'),
          `<mark>${escapeHtml(librarySearchQuery)}</mark>`
        )}</div>
        <div class="seer-sentence-meta">
          <span class="seer-sentence-source">${escapeHtml(s.sourceTitle)}</span>
          <span class="seer-sentence-type">${escapeHtml(s.sourceType)}</span>
          <button class="seer-sentence-copy" title="Copy sentence">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
      </div>
    `).join('');

    if (librarySearchOffset === 0) {
      librarySearchListEl.innerHTML = `<div class="search-count">${result.total.toLocaleString()} results</div>` + html;
    } else {
      librarySearchListEl.insertAdjacentHTML('beforeend', html);
    }

    librarySearchLoadMoreBtn.classList.toggle('hidden', !result.hasMore);

  } catch (e) {
    librarySearchListEl.innerHTML = '<div class="seer-list-empty">Search failed</div>';
    console.error('[Dashboard] Failed to search library:', e);
  }
}

async function loadMoreLibrarySearch() {
  librarySearchOffset += SENTENCES_PAGE_SIZE;
  librarySearchLoadMoreBtn.textContent = 'Loading...';
  (librarySearchLoadMoreBtn as HTMLButtonElement).disabled = true;

  await loadLibrarySearchResults();

  librarySearchLoadMoreBtn.textContent = 'Load More';
  (librarySearchLoadMoreBtn as HTMLButtonElement).disabled = false;
}

async function handleLibraryImport() {
  const files = libraryImportFilesEl.files;
  if (!files || files.length === 0) return;

  libraryImportStatusEl.classList.remove('hidden');
  libraryImportTextEl.textContent = `Importing ${files.length} file(s)...`;
  libraryImportProgressEl.textContent = '0%';
  libraryImportBarEl.value = 0;

  let totalImported = 0;
  let totalSkipped = 0;
  let totalSentences = 0;

  const BATCH_SIZE = 10; // Import 10 anime at a time to avoid timeout

  for (let fileIdx = 0; fileIdx < files.length; fileIdx++) {
    const file = files[fileIdx];

    try {
      const text = await file.text();
      const entries = JSON.parse(text);

      // Process in batches
      for (let batchStart = 0; batchStart < entries.length; batchStart += BATCH_SIZE) {
        const batch = entries.slice(batchStart, batchStart + BATCH_SIZE);
        const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(entries.length / BATCH_SIZE);

        libraryImportTextEl.textContent = `${file.name}: batch ${batchNum}/${totalBatches}`;

        const result = await bridge.bulkImportLibrary(batch);

        if (result.success) {
          totalImported += result.imported || 0;
          totalSkipped += result.skipped || 0;
          totalSentences += result.totalSentences || 0;
        }

        // Update progress within file
        const fileProgress = (batchStart + batch.length) / entries.length;
        const overallProgress = (fileIdx + fileProgress) / files.length;
        const pct = Math.round(overallProgress * 100);
        libraryImportProgressEl.textContent = `${pct}%`;
        libraryImportBarEl.value = pct;

        // Small delay to let UI update
        await new Promise(r => setTimeout(r, 10));
      }
    } catch (e) {
      console.error(`[Dashboard] Failed to import ${file.name}:`, e);
      libraryImportTextEl.textContent = `Error: ${file.name} - ${e}`;
    }
  }

  libraryImportTextEl.textContent = `Done! Imported ${totalImported} sources (${totalSkipped} skipped), ${totalSentences.toLocaleString()} sentences`;

  // Clear file input
  libraryImportFilesEl.value = '';

  // Reload library after short delay
  setTimeout(async () => {
    libraryImportStatusEl.classList.add('hidden');
    await loadLibrary();
  }, 2000);
}

async function handleLibraryRecalc() {
  libraryRecalcBtn.textContent = 'Recalculating...';
  (libraryRecalcBtn as HTMLButtonElement).disabled = true;

  try {
    const result = await bridge.recalculateLibrary();
    libraryRecalcBtn.textContent = `✓ Updated ${result.updated}`;
    await loadLibrary();
  } catch (e) {
    libraryRecalcBtn.textContent = '✗ Failed';
    console.error('[Dashboard] Failed to recalculate library:', e);
  } finally {
    setTimeout(() => {
      libraryRecalcBtn.textContent = 'Recalculate All';
      (libraryRecalcBtn as HTMLButtonElement).disabled = false;
    }, 2000);
  }
}

async function handleLibraryClear() {
  if (!confirm('Clear entire library? This cannot be undone.')) return;

  try {
    await bridge.clearLibrary();
    await loadLibrary();
  } catch (e) {
    console.error('[Dashboard] Failed to clear library:', e);
  }
}

// ============================================
// Utilities
// ============================================

interface ScrollPositions {
  words: number;
  sentences: number;
  page: number;
}

function saveI1ScrollPositions(): ScrollPositions {
  return {
    words: i1HighValueWordsEl.scrollTop,
    sentences: i1SentencesEl.scrollTop,
    page: window.scrollY,
  };
}

function restoreI1ScrollPositions(pos: ScrollPositions) {
  // Use requestAnimationFrame to ensure DOM has updated
  requestAnimationFrame(() => {
    i1HighValueWordsEl.scrollTop = pos.words;
    i1SentencesEl.scrollTop = pos.sentences;
    window.scrollTo(0, pos.page);
  });
}

function formatTime(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
}

function debounce<T extends (...args: unknown[]) => unknown>(fn: T, delay: number): T {
  let timeout: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  }) as T;
}

// Start
init();
