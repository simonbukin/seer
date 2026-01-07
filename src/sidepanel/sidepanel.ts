import { Chart, registerables } from 'chart.js';
import tippy from 'tippy.js';
import 'tippy.js/dist/tippy.css';
import type { PageStats, SeerConfig, VirtualPageStats } from '../shared/types';
import { POPUP_RETRY_COUNT, POPUP_RETRY_DELAY_MS } from '../shared/config';
import { initializeTheme } from '../shared/theme';
import {
  renderWordItem,
  attachWordItemListeners,
  renderSentenceItem,
  attachSentenceItemListeners,
  escapeHtml,
} from '../shared/components';

// Register Chart.js components
Chart.register(...registerables);

// Chart instances
let frequencyChart: Chart | null = null;
let knowledgeChart: Chart | null = null;
let virtualFrequencyChart: Chart | null = null;

// DOM elements
const pageUrlEl = document.getElementById('page-url')!;
const comprehensionPercentEl = document.getElementById('comprehension-percent')!;
const knownCountEl = document.getElementById('known-count')!;
const totalCountEl = document.getElementById('total-count')!;
const unknownWordsListEl = document.getElementById('unknown-words-list')!;
const i1SentencesListEl = document.getElementById('i1-sentences-list')!;
const syncBtn = document.getElementById('sync-btn')!;
const optionsBtn = document.getElementById('options-btn')!;

// Virtual analysis elements
const virtualContentEl = document.getElementById('virtual-content')!;
const virtualProgressEl = document.getElementById('virtual-progress')!;
const virtualResultsEl = document.getElementById('virtual-results')!;
const virtualProgressBar = document.getElementById('virtual-progress-bar') as HTMLProgressElement;
const virtualProgressText = document.getElementById('virtual-progress-text')!;
const virtualComprehensionEl = document.getElementById('virtual-comprehension-percent')!;
const virtualKnownCountEl = document.getElementById('virtual-known-count')!;
const virtualTotalCountEl = document.getElementById('virtual-total-count')!;
const virtualUnknownWordsEl = document.getElementById('virtual-unknown-words')!;
const scanFullPageBtn = document.getElementById('scan-full-page-btn')!;
const rescanBtn = document.getElementById('rescan-btn')!;

// Detailed stats elements
const virtualCharCountEl = document.getElementById('virtual-char-count')!;
const virtualWordCountEl = document.getElementById('virtual-word-count')!;
const virtualUniqueWordsEl = document.getElementById('virtual-unique-words')!;
const virtualHapaxEl = document.getElementById('virtual-hapax')!;
const virtualTotalKanjiEl = document.getElementById('virtual-total-kanji')!;
const virtualUniqueKanjiEl = document.getElementById('virtual-unique-kanji')!;
const virtualKanjiHapaxEl = document.getElementById('virtual-kanji-hapax')!;
const virtualDifficultyLabelEl = document.getElementById('virtual-difficulty-label')!;
const virtualMinDifficultyEl = document.getElementById('virtual-min-difficulty')!;
const virtualMedianDifficultyEl = document.getElementById('virtual-median-difficulty')!;
const virtualAvgDifficultyEl = document.getElementById('virtual-avg-difficulty')!;
const virtualPeakDifficultyEl = document.getElementById('virtual-peak-difficulty')!;
const virtualSentenceCountEl = document.getElementById('virtual-sentence-count')!;
const virtualI1CountEl = document.getElementById('virtual-i1-count')!;
const virtualI1Wrap = document.getElementById('virtual-i1-wrap')!;
const virtualAvgSentenceLenEl = document.getElementById('virtual-avg-sentence-len')!;
const virtualMaxSentenceLenEl = document.getElementById('virtual-max-sentence-len')!;
// Wrapper elements for Tippy tooltips
const virtualUniqueWordsWrap = document.getElementById('virtual-unique-words-wrap')!;
const virtualHapaxWrap = document.getElementById('virtual-hapax-wrap')!;
const virtualUniqueKanjiWrap = document.getElementById('virtual-unique-kanji-wrap')!;
const virtualKanjiHapaxWrap = document.getElementById('virtual-kanji-hapax-wrap')!;
// Difficulty sparkline canvas
const difficultySparklineEl = document.getElementById('difficulty-sparkline') as HTMLCanvasElement;
// Virtual i+1 sentences elements
const virtualI1SentencesSectionEl = document.getElementById('virtual-i1-sentences-section')!;
const virtualI1BadgeEl = document.getElementById('virtual-i1-badge')!;
const virtualI1SentencesEl = document.getElementById('virtual-i1-sentences')!;

// Current tab ID and window ID
let currentTabId: number | null = null;
let currentWindowId: number | null = null;

// Local stats cache for instant tab switching
const localStatsCache = new Map<number, { stats: PageStats; url: string }>();

// Helper to safely get hostname from URL
function getHostname(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

// Check if URL is a non-content page (settings, chrome://, etc.)
function isNonContentPage(url: string | undefined): boolean {
  if (!url) return true;
  return url.startsWith('chrome://') ||
         url.startsWith('chrome-extension://') ||
         url.startsWith('about:') ||
         url.startsWith('edge://') ||
         url.startsWith('brave://');
}

// Update page URL display
function updatePageUrl(url: string | undefined) {
  const hostname = getHostname(url);
  pageUrlEl.textContent = hostname || 'No page';
}

// Initialize
async function init() {
  // Get current tab and window
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    currentTabId = tab.id;
    currentWindowId = tab.windowId;
    updatePageUrl(tab.url);

    // Close sidepanel if on a non-content page
    if (isNonContentPage(tab.url)) {
      showNoData();
    }
  }

  // Load initial data (try cache first for speed)
  await loadPageStats();

  // Set up event listeners
  syncBtn.addEventListener('click', handleSync);
  optionsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    // Close the sidepanel when opening options
    window.close();
  });

  // Virtual analysis buttons
  scanFullPageBtn.addEventListener('click', triggerVirtualAnalysis);
  rescanBtn.addEventListener('click', triggerVirtualAnalysis);

  // Listen for tab activation changes (switching tabs)
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    // Only respond to tabs in our window
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.windowId !== currentWindowId) return;

    currentTabId = activeInfo.tabId;
    updatePageUrl(tab.url);

    // Reset virtual analysis when switching tabs
    resetVirtualAnalysis();

    // Close sidepanel if navigating to settings/chrome pages
    if (isNonContentPage(tab.url)) {
      window.close();
      return;
    }

    // Try local cache first for instant update
    const cached = localStatsCache.get(activeInfo.tabId);
    if (cached) {
      updateStats(cached.stats);
      hasDisplayedStats = true;
    } else {
      hasDisplayedStats = false;
      showLoading();
    }

    // Then fetch fresh data (pass false since we already set hasDisplayedStats)
    await loadPageStats(POPUP_RETRY_COUNT, false);
  });

  // Listen for URL changes within a tab (navigation)
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // Only care about URL changes on our current tab
    if (tabId !== currentTabId) return;

    if (changeInfo.url) {
      // Close sidepanel if navigating to settings/chrome pages
      if (isNonContentPage(changeInfo.url)) {
        window.close();
        return;
      }

      updatePageUrl(changeInfo.url);
      // Clear cached stats for this tab since URL changed
      localStatsCache.delete(tabId);
      showLoading();
      // Reset virtual analysis on URL change
      resetVirtualAnalysis();
    }

    // When page finishes loading, refresh stats
    if (changeInfo.status === 'complete') {
      await loadPageStats();
    }
  });

  // Listen for stats updates relayed from service worker (includes tabId)
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'statsUpdated' && message.tabId === currentTabId) {
      // Cache it locally
      localStatsCache.set(message.tabId, { stats: message.stats, url: message.url || '' });
      updateStats(message.stats);
    } else if (message.type === 'virtualStatsUpdated' && message.tabId === currentTabId) {
      // Update virtual analysis progress/results
      updateVirtualStats(message.stats);
    } else if (message.type === 'setHighlightingEnabled' && !message.enabled) {
      // Close sidepanel when seer is disabled
      window.close();
    }
  });
}

// Trigger virtual analysis on the current page
async function triggerVirtualAnalysis() {
  if (!currentTabId) return;

  // Show progress UI
  virtualContentEl.style.display = 'none';
  virtualProgressEl.style.display = 'block';
  virtualResultsEl.style.display = 'none';
  virtualProgressBar.value = 0;
  virtualProgressText.textContent = 'Starting scan...';

  try {
    const response = await chrome.tabs.sendMessage(currentTabId, { type: 'triggerVirtualAnalysis' }) as {
      success: boolean;
      stats?: VirtualPageStats;
      error?: string;
    };

    if (response.success && response.stats) {
      updateVirtualStats(response.stats);
    } else {
      virtualProgressText.textContent = response.error || 'Failed to analyze';
      setTimeout(() => {
        resetVirtualAnalysis();
      }, 2000);
    }
  } catch (e) {
    console.error('[Seer Sidepanel] Virtual analysis failed:', e);
    virtualProgressText.textContent = 'Failed - content script not ready';
    setTimeout(() => {
      resetVirtualAnalysis();
    }, 2000);
  }
}

// Update virtual analysis stats display
function updateVirtualStats(stats: VirtualPageStats) {
  // Update progress bar
  const progress = stats.totalNodes > 0
    ? Math.round((stats.scannedNodes / stats.totalNodes) * 100)
    : 0;
  virtualProgressBar.value = progress;
  virtualProgressText.textContent = `Scanning... ${progress}%`;

  if (stats.isComplete) {
    // Show results
    virtualProgressEl.style.display = 'none';
    virtualResultsEl.style.display = 'block';

    // Update comprehension
    const percent = stats.comprehensionPercent;
    virtualComprehensionEl.textContent = `${percent.toFixed(0)}%`;
    virtualComprehensionEl.className = 'stat-value virtual ' + (percent >= 80 ? 'good' : percent >= 60 ? 'medium' : 'low');

    // Update word counts
    virtualKnownCountEl.textContent = stats.knownTokens.toLocaleString();
    virtualTotalCountEl.textContent = stats.totalTokens.toLocaleString();

    // Update detailed stats (grouped layout)
    virtualCharCountEl.textContent = stats.characterCount?.toLocaleString() ?? '--';

    // Words stats with Tippy tooltips
    const wordCount = stats.wordCount ?? 0;
    const uniqueWordCount = stats.uniqueWordCount ?? 0;
    const hapaxCount = stats.hapaxCount ?? 0;
    virtualWordCountEl.textContent = wordCount.toLocaleString();
    virtualUniqueWordsEl.textContent = uniqueWordCount.toLocaleString();
    virtualHapaxEl.textContent = hapaxCount.toLocaleString();

    // Create Tippy tooltips for word stats
    if (wordCount > 0) {
      const uniquePercent = Math.round((uniqueWordCount / wordCount) * 100);
      const hapaxPercent = uniqueWordCount > 0 ? Math.round((hapaxCount / uniqueWordCount) * 100) : 0;

      // Destroy existing tooltips before creating new ones
      virtualUniqueWordsWrap._tippy?.destroy();
      virtualHapaxWrap._tippy?.destroy();

      tippy(virtualUniqueWordsWrap, {
        content: `${uniquePercent}% of total words`,
        placement: 'top',
        arrow: true,
        delay: [200, 0]
      });
      tippy(virtualHapaxWrap, {
        content: `${hapaxPercent}% of unique words`,
        placement: 'top',
        arrow: true,
        delay: [200, 0]
      });
    }

    // Kanji stats with Tippy tooltips
    const totalKanji = stats.totalKanjiCount ?? 0;
    const uniqueKanji = stats.uniqueKanjiCount ?? 0;
    const kanjiHapax = stats.kanjiHapaxCount ?? 0;
    virtualTotalKanjiEl.textContent = totalKanji.toLocaleString();
    virtualUniqueKanjiEl.textContent = uniqueKanji.toLocaleString();
    virtualKanjiHapaxEl.textContent = kanjiHapax.toLocaleString();

    // Create Tippy tooltips for kanji stats
    if (totalKanji > 0) {
      const uniqueKanjiPercent = Math.round((uniqueKanji / totalKanji) * 100);
      const kanjiHapaxPercent = uniqueKanji > 0 ? Math.round((kanjiHapax / uniqueKanji) * 100) : 0;

      // Destroy existing tooltips before creating new ones
      virtualUniqueKanjiWrap._tippy?.destroy();
      virtualKanjiHapaxWrap._tippy?.destroy();

      tippy(virtualUniqueKanjiWrap, {
        content: `${uniqueKanjiPercent}% of total kanji`,
        placement: 'top',
        arrow: true,
        delay: [200, 0]
      });
      tippy(virtualKanjiHapaxWrap, {
        content: `${kanjiHapaxPercent}% of unique kanji`,
        placement: 'top',
        arrow: true,
        delay: [200, 0]
      });
    }

    // Difficulty stats
    if (stats.difficultyLabel) {
      virtualDifficultyLabelEl.textContent = stats.difficultyLabel;
      virtualDifficultyLabelEl.className = 'stat-badge ' +
        stats.difficultyLabel.toLowerCase().replace(' ', '-');
    } else {
      virtualDifficultyLabelEl.textContent = '--';
      virtualDifficultyLabelEl.className = 'stat-badge';
    }
    virtualMinDifficultyEl.textContent = stats.minDifficulty?.toString() ?? '--';
    virtualMedianDifficultyEl.textContent = stats.medianDifficulty?.toString() ?? '--';
    virtualAvgDifficultyEl.textContent = stats.averageDifficulty?.toString() ?? '--';
    virtualPeakDifficultyEl.textContent = stats.peakDifficulty?.toString() ?? '--';

    // Draw difficulty sparkline
    drawDifficultySparkline(stats);

    // Sentence stats
    const sentenceCount = stats.sentenceCount ?? 0;
    const i1Count = stats.i1SentenceCount ?? 0;
    virtualSentenceCountEl.textContent = sentenceCount.toLocaleString();
    virtualI1CountEl.textContent = i1Count.toLocaleString();
    virtualAvgSentenceLenEl.textContent = stats.avgSentenceLength?.toString() ?? '--';
    virtualMaxSentenceLenEl.textContent = stats.maxSentenceLength?.toString() ?? '--';

    // Tippy tooltip for i+1 showing percentage
    if (sentenceCount > 0) {
      const i1Percent = Math.round((i1Count / sentenceCount) * 100);
      virtualI1Wrap._tippy?.destroy();
      tippy(virtualI1Wrap, {
        content: `${i1Percent}% of sentences have exactly 1 unknown word`,
        placement: 'top',
        arrow: true,
        delay: [200, 0]
      });
    }

    // Update frequency chart
    updateVirtualFrequencyChart(stats);

    // Update unknown words list with shared components
    if (stats.topUnknown && stats.topUnknown.length > 0) {
      virtualUnknownWordsEl.innerHTML = stats.topUnknown.slice(0, 10).map(w =>
        renderWordItem({
          word: w.word,
          count: w.count,
          status: 'unknown',
          compact: true,
          showActions: true,
        })
      ).join('');

      // Attach action handlers
      attachWordItemListeners(virtualUnknownWordsEl, {
        onMarkKnown: async (word) => {
          await chrome.runtime.sendMessage({ type: 'addKnownWord', word });
          await loadPageStats();
        },
        onIgnore: async (word) => {
          await chrome.runtime.sendMessage({ type: 'addIgnoredWord', word });
          await loadPageStats();
        },
      });
    } else {
      virtualUnknownWordsEl.innerHTML = '<div class="no-data">No unknown words!</div>';
    }

    // Update virtual i+1 sentences list
    updateVirtualI1Sentences(stats);
  }
}

// Update virtual i+1 sentences list with shared components
function updateVirtualI1Sentences(stats: VirtualPageStats) {
  const sentences = stats.i1Sentences ?? [];

  // Update badge count
  virtualI1BadgeEl.textContent = sentences.length.toString();

  if (sentences.length === 0) {
    virtualI1SentencesEl.innerHTML = '<div class="no-data">No i+1 sentences found</div>';
    return;
  }

  // Get current tab URL for sentence items
  chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    const currentUrl = tab?.url || '';

    // Render sentences with shared component
    virtualI1SentencesEl.innerHTML = sentences.slice(0, 20).map(s =>
      renderSentenceItem({
        text: s.text,
        targetWord: s.unknownWord,
        url: currentUrl,
        compact: true,
        showCopy: true,
        showActions: true,
        clickable: true,
      })
    ).join('');

    // Attach event handlers - special handling for scroll-to-sentence
    attachSentenceItemListeners(virtualI1SentencesEl, {
      onClick: async (_url, sentence) => {
        if (!sentence || !currentTabId) return;
        try {
          await chrome.tabs.sendMessage(currentTabId, {
            type: 'scrollToSentence',
            sentence
          });
        } catch (e) {
          console.error('[Seer Sidepanel] Failed to scroll to sentence:', e);
        }
      },
      onMarkKnown: async (word) => {
        await chrome.runtime.sendMessage({ type: 'addKnownWord', word });
        await loadPageStats();
      },
      onIgnore: async (word) => {
        await chrome.runtime.sendMessage({ type: 'addIgnoredWord', word });
        await loadPageStats();
      },
    });
  });
}

// Draw difficulty sparkline (line chart showing difficulty per 5% section of text)
function drawDifficultySparkline(stats: VirtualPageStats) {
  if (!difficultySparklineEl) return;

  const ctx = difficultySparklineEl.getContext('2d');
  if (!ctx) return;

  // Get device pixel ratio for sharp rendering
  const dpr = window.devicePixelRatio || 1;
  const rect = difficultySparklineEl.getBoundingClientRect();

  // Set canvas size accounting for DPR
  difficultySparklineEl.width = rect.width * dpr;
  difficultySparklineEl.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const padding = 4;

  // Clear canvas
  ctx.clearRect(0, 0, width, height);

  // Get section difficulty data (20 points, 5% each)
  const data = stats.difficultyPerSection ?? [];

  // If no data or all zeros, show placeholder
  if (data.length === 0 || data.every(v => v === 0)) {
    ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--pico-muted-color').trim() || '#888';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Scan to see difficulty', width / 2, height / 2 + 3);
    return;
  }

  // Filter out zero values at the end (incomplete scan)
  let lastNonZero = data.length - 1;
  while (lastNonZero > 0 && data[lastNonZero] === 0) lastNonZero--;
  const activeData = data.slice(0, lastNonZero + 1);

  if (activeData.length < 2) return;

  // Calculate points
  const points: { x: number; y: number }[] = activeData.map((val, i) => ({
    x: padding + (i / (activeData.length - 1)) * (width - padding * 2),
    y: val
  }));

  // Map y values to canvas coordinates (0 at bottom, 100 at top)
  const mapY = (val: number) => height - padding - ((val / 100) * (height - padding * 2));

  // Draw gradient fill under line (vertical gradient based on difficulty)
  const fillGradient = ctx.createLinearGradient(0, mapY(100), 0, mapY(0));
  fillGradient.addColorStop(0, 'rgba(239, 68, 68, 0.25)');   // red at top (hard)
  fillGradient.addColorStop(0.5, 'rgba(250, 204, 21, 0.2)'); // yellow in middle
  fillGradient.addColorStop(1, 'rgba(34, 197, 94, 0.15)');   // green at bottom (easy)

  ctx.beginPath();
  ctx.moveTo(points[0].x, height - padding);
  points.forEach(p => ctx.lineTo(p.x, mapY(p.y)));
  ctx.lineTo(points[points.length - 1].x, height - padding);
  ctx.closePath();
  ctx.fillStyle = fillGradient;
  ctx.fill();

  // Draw line with color based on value
  ctx.beginPath();
  ctx.moveTo(points[0].x, mapY(points[0].y));

  // Use curve for smoother appearance
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpX = (prev.x + curr.x) / 2;
    ctx.quadraticCurveTo(prev.x, mapY(prev.y), cpX, mapY((prev.y + curr.y) / 2));
  }
  ctx.lineTo(points[points.length - 1].x, mapY(points[points.length - 1].y));

  // Color line based on average difficulty
  const avgDiff = stats.averageDifficulty ?? 50;
  let lineColor: string;
  if (avgDiff <= 25) lineColor = '#22c55e';
  else if (avgDiff <= 50) lineColor = '#eab308';
  else if (avgDiff <= 75) lineColor = '#f97316';
  else lineColor = '#ef4444';

  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Draw small axis labels (0%, 50%, 100% progress)
  ctx.fillStyle = getComputedStyle(document.documentElement)
    .getPropertyValue('--pico-muted-color').trim() || '#888';
  ctx.font = '8px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('0%', padding, height - 1);
  ctx.textAlign = 'right';
  ctx.fillText('100%', width - padding, height - 1);
}

// Update virtual frequency chart
function updateVirtualFrequencyChart(stats: VirtualPageStats) {
  const ctx = document.getElementById('virtual-frequency-chart') as HTMLCanvasElement;
  if (!ctx) return;

  const data = [
    stats.veryCommonPercent || 0,
    stats.commonPercent || 0,
    stats.mediumPercent || 0,
    stats.uncommonPercent || 0,
    stats.rarePercent || 0
  ];

  const labels = ['1K', '5K', '15K', '50K', 'Rare'];
  const colors = [
    'rgba(34, 197, 94, 0.8)',
    'rgba(59, 130, 246, 0.8)',
    'rgba(168, 85, 247, 0.8)',
    'rgba(249, 115, 22, 0.8)',
    'rgba(239, 68, 68, 0.8)'
  ];

  if (virtualFrequencyChart) {
    virtualFrequencyChart.data.datasets[0].data = data;
    virtualFrequencyChart.update();
  } else {
    virtualFrequencyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderWidth: 0,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.parsed.y.toFixed(1)}%`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: {
              callback: (value) => `${value}%`,
              font: { size: 9 }
            },
            grid: { display: false }
          },
          x: {
            ticks: { font: { size: 9 } },
            grid: { display: false }
          }
        }
      }
    });
  }
}

// Reset virtual analysis to initial state
function resetVirtualAnalysis() {
  virtualContentEl.style.display = 'block';
  virtualProgressEl.style.display = 'none';
  virtualResultsEl.style.display = 'none';
}

// Show loading state
function showLoading() {
  comprehensionPercentEl.textContent = '...';
  comprehensionPercentEl.className = 'stat-value';
  knownCountEl.textContent = '...';
  totalCountEl.textContent = '...';
}

// Track if we have displayed valid stats (to avoid overwriting with loading/nodata)
let hasDisplayedStats = false;

// Load page stats from current tab with retry logic
async function loadPageStats(retries = POPUP_RETRY_COUNT, isInitialCall = true) {
  if (!currentTabId) return;

  // Reset flag on initial call (new tab or page)
  if (isInitialCall) {
    hasDisplayedStats = false;
  }

  // First, try to get cached stats from service worker for instant display
  try {
    const cached = await chrome.runtime.sendMessage({
      type: 'getCachedStats',
      tabId: currentTabId
    }) as { stats: PageStats | null; cached: boolean };

    if (cached?.stats && cached.stats.totalTokens > 0) {
      updateStats(cached.stats);
      localStatsCache.set(currentTabId, { stats: cached.stats, url: '' });
      hasDisplayedStats = true;
    }
  } catch {
    // Service worker cache miss, continue to fetch fresh
  }

  // Then fetch fresh stats from content script
  try {
    const stats = await chrome.tabs.sendMessage(currentTabId, { type: 'getPageStats' }) as PageStats | null;
    if (stats && stats.totalTokens > 0) {
      updateStats(stats);
      localStatsCache.set(currentTabId, { stats, url: '' });
      hasDisplayedStats = true;
    } else if (retries > 0) {
      // Page might still be processing, retry after delay
      // Only show loading if we haven't displayed valid stats yet
      if (!hasDisplayedStats) {
        showLoading();
      }
      setTimeout(() => loadPageStats(retries - 1, false), POPUP_RETRY_DELAY_MS);
      return; // Don't load i+1 yet
    } else if (!hasDisplayedStats) {
      showNoData();
    }
  } catch (e) {
    console.log('[Seer Sidepanel] Could not get page stats:', e);
    if (retries > 0) {
      // Content script might not be ready, retry
      if (!hasDisplayedStats) {
        showLoading();
      }
      setTimeout(() => loadPageStats(retries - 1, false), POPUP_RETRY_DELAY_MS);
      return; // Don't load i+1 yet
    } else if (!hasDisplayedStats) {
      showNoData();
    }
  }

  // Load i+1 sentences
  await loadI1Sentences();
}

// Update the UI with stats
function updateStats(stats: PageStats) {
  // Comprehension
  const percent = stats.comprehensionPercent;
  comprehensionPercentEl.textContent = `${percent.toFixed(0)}%`;
  comprehensionPercentEl.className = 'stat-value ' + (percent >= 80 ? 'good' : percent >= 60 ? 'medium' : 'low');

  // Word counts
  knownCountEl.textContent = stats.knownTokens.toLocaleString();
  totalCountEl.textContent = stats.totalTokens.toLocaleString();

  // Frequency chart
  updateFrequencyChart(stats);

  // Knowledge level chart
  if (stats.knowledgeBreakdown) {
    updateKnowledgeChart(stats.knowledgeBreakdown);
  }

  // Unknown words list
  updateUnknownWordsList(stats.topUnknown);
}

// Update frequency distribution chart
function updateFrequencyChart(stats: PageStats) {
  const ctx = document.getElementById('frequency-chart') as HTMLCanvasElement;
  if (!ctx) return;

  const data = [
    stats.veryCommonPercent || 0,
    stats.commonPercent || 0,
    stats.mediumPercent || 0,
    stats.uncommonPercent || 0,
    stats.rarePercent || 0
  ];

  const labels = ['1K', '5K', '15K', '50K', 'Rare'];
  const colors = [
    'rgba(34, 197, 94, 0.8)',   // Green for common
    'rgba(59, 130, 246, 0.8)',  // Blue
    'rgba(168, 85, 247, 0.8)',  // Purple
    'rgba(249, 115, 22, 0.8)',  // Orange
    'rgba(239, 68, 68, 0.8)'    // Red for rare
  ];

  if (frequencyChart) {
    frequencyChart.data.datasets[0].data = data;
    frequencyChart.update();
  } else {
    frequencyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderWidth: 0,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => `${context.parsed.y.toFixed(1)}%`
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: {
              callback: (value) => `${value}%`,
              font: { size: 10 }
            },
            grid: { display: false }
          },
          x: {
            ticks: { font: { size: 10 } },
            grid: { display: false }
          }
        }
      }
    });
  }
}

// Update knowledge level chart
function updateKnowledgeChart(breakdown: { mature: number; young: number; learning: number; new: number; unknown: number }) {
  const ctx = document.getElementById('knowledge-chart') as HTMLCanvasElement;
  if (!ctx) return;

  const data = [breakdown.mature, breakdown.young, breakdown.learning, breakdown.new, breakdown.unknown];
  const labels = ['Mature', 'Young', 'Learning', 'New', 'Unknown'];
  const colors = [
    'rgba(34, 197, 94, 0.8)',   // Green - mature
    'rgba(59, 130, 246, 0.8)',  // Blue - young
    'rgba(249, 115, 22, 0.8)',  // Orange - learning
    'rgba(168, 85, 247, 0.8)',  // Purple - new
    'rgba(107, 114, 128, 0.8)'  // Gray - unknown
  ];

  if (knowledgeChart) {
    knowledgeChart.data.datasets[0].data = data;
    knowledgeChart.update();
  } else {
    knowledgeChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: colors,
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              boxWidth: 12,
              padding: 8,
              font: { size: 10 }
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => `${context.label}: ${(context.parsed as number).toFixed(1)}%`
            }
          }
        }
      }
    });
  }
}

// Update unknown words list with shared components and inline actions
function updateUnknownWordsList(words: Array<{ word: string; count: number }>) {
  if (!words || words.length === 0) {
    unknownWordsListEl.innerHTML = '<div class="no-data">No unknown words on this page!</div>';
    return;
  }

  unknownWordsListEl.innerHTML = words.slice(0, 15).map(w =>
    renderWordItem({
      word: w.word,
      count: w.count,
      status: 'unknown',
      compact: true,
      showActions: true,
    })
  ).join('');

  // Attach action handlers
  attachWordItemListeners(unknownWordsListEl, {
    onMarkKnown: async (word) => {
      await chrome.runtime.sendMessage({ type: 'addKnownWord', word });
      // Refresh stats after marking known
      await loadPageStats();
    },
    onIgnore: async (word) => {
      await chrome.runtime.sendMessage({ type: 'addIgnoredWord', word });
      // Refresh stats after ignoring
      await loadPageStats();
    },
  });
}

// Load i+1 sentences from the page with shared components
async function loadI1Sentences() {
  try {
    const config = await chrome.runtime.sendMessage({ type: 'getConfig' }) as SeerConfig;
    const sentences = await chrome.runtime.sendMessage({
      type: 'getAllI1Sentences',
      limit: 10,
      minTimeMs: 5000,
      ignoreList: config.ignoreList
    }) as Array<{ text: string; targetWord: string; url: string; timestamp: number }>;

    if (!sentences || sentences.length === 0) {
      i1SentencesListEl.innerHTML = '<div class="no-data">No i+1 sentences found yet</div>';
      return;
    }

    i1SentencesListEl.innerHTML = sentences.map(s =>
      renderSentenceItem({
        text: s.text,
        targetWord: s.targetWord,
        url: s.url,
        timestamp: s.timestamp,
        compact: true,
        showCopy: true,
        showActions: true,
        clickable: true,
      })
    ).join('');

    // Attach event handlers
    attachSentenceItemListeners(i1SentencesListEl, {
      onClick: (url) => {
        chrome.tabs.create({ url });
      },
      onMarkKnown: async (word) => {
        await chrome.runtime.sendMessage({ type: 'addKnownWord', word });
        await loadPageStats();
        await loadI1Sentences();
      },
      onIgnore: async (word) => {
        await chrome.runtime.sendMessage({ type: 'addIgnoredWord', word });
        await loadPageStats();
        await loadI1Sentences();
      },
    });
  } catch (e) {
    console.error('[Seer Sidepanel] Failed to load i+1 sentences:', e);
    i1SentencesListEl.innerHTML = '<div class="no-data">Could not load sentences</div>';
  }
}

// Handle sync button
async function handleSync() {
  syncBtn.textContent = 'Syncing...';
  (syncBtn as HTMLButtonElement).disabled = true;

  try {
    await chrome.runtime.sendMessage({ type: 'syncVocabulary' });
    syncBtn.innerHTML = '<span class="btn-icon">✓</span> Synced!';
    await loadPageStats();
  } catch (e) {
    syncBtn.innerHTML = '<span class="btn-icon">✗</span> Failed';
  } finally {
    setTimeout(() => {
      syncBtn.innerHTML = '<span class="btn-icon">🔄</span> Sync Vocabulary';
      (syncBtn as HTMLButtonElement).disabled = false;
    }, 2000);
  }
}

// Show no data state
function showNoData() {
  comprehensionPercentEl.textContent = '--';
  comprehensionPercentEl.className = 'stat-value';
  knownCountEl.textContent = '--';
  totalCountEl.textContent = '--';
  unknownWordsListEl.innerHTML = '<div class="no-data">No data for this page</div>';
}

// Start
initializeTheme();
init();
