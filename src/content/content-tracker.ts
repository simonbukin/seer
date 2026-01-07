import { fnv1a } from '../shared/hash';
import { flushEncounters, resetSession, setContentIdGetter } from './encounter-tracker';

/**
 * Content Tracker for SPA Support
 *
 * Detects content changes in SPAs via:
 * 1. webNavigation.onHistoryStateUpdated (via service worker messages)
 * 2. document.title changes (MutationObserver)
 * 3. Manual labeling (user override)
 *
 * When content changes, we:
 * - Flush pending encounters with the old contentId
 * - Reset session deduplication
 * - Update the current contentId
 * - Notify the service worker
 */

// Title change debounce delay (ms)
const TITLE_DEBOUNCE_MS = 500;

// Heuristics for title changes to ignore
const IGNORE_TITLE_PATTERNS = [
  /^loading/i,
  /^\(\d+\)/,           // Notification counts like "(3) Page"
  /^•\s*/,              // Bullet prefix
  /^\[\d+\]\s*/,        // [3] prefix
];

interface ContentState {
  urlHash: number;
  contentId: string | null;
  label: string | null;
  source: 'url' | 'history' | 'title' | 'manual';
  lastTitle: string;
  lastUrl: string;
}

let state: ContentState = {
  urlHash: 0,
  contentId: null,
  label: null,
  source: 'url',
  lastTitle: '',
  lastUrl: ''
};

let titleObserver: MutationObserver | null = null;
let titleDebounceTimeout: number | null = null;
let manualLabel: string | null = null;

/**
 * Generate a content ID from a label string
 */
function generateContentId(label: string): string {
  const hash = fnv1a(label);
  return hash.toString(16).padStart(8, '0');
}

/**
 * Check if title change should be ignored (false positive)
 */
function shouldIgnoreTitleChange(oldTitle: string, newTitle: string): boolean {
  // Ignore empty titles
  if (!newTitle || newTitle.length < 2) return true;

  // Ignore if only whitespace changed
  if (oldTitle.trim() === newTitle.trim()) return true;

  // Ignore patterns that indicate transient states
  for (const pattern of IGNORE_TITLE_PATTERNS) {
    if (pattern.test(newTitle) && !pattern.test(oldTitle)) return true;
    // Also ignore if removing these patterns is the only change
    const cleanOld = oldTitle.replace(pattern, '').trim();
    const cleanNew = newTitle.replace(pattern, '').trim();
    if (cleanOld === cleanNew) return true;
  }

  // Ignore very minor changes (< 3 chars different)
  const minLen = Math.min(oldTitle.length, newTitle.length);
  let diffCount = Math.abs(oldTitle.length - newTitle.length);
  for (let i = 0; i < minLen && diffCount < 3; i++) {
    if (oldTitle[i] !== newTitle[i]) diffCount++;
  }
  if (diffCount < 3) return true;

  return false;
}

/**
 * Handle a content change (from any source)
 */
async function handleContentChange(
  newLabel: string,
  source: 'history' | 'title' | 'manual'
): Promise<void> {
  const newContentId = generateContentId(newLabel);

  // Skip if contentId hasn't actually changed
  if (newContentId === state.contentId) return;

  console.log(`[Seer] Content change detected (${source}): "${newLabel}" -> ${newContentId}`);

  // Flush pending encounters with old contentId
  await flushEncounters();

  // Reset session deduplication
  resetSession();

  // Update state
  state.contentId = newContentId;
  state.label = newLabel;
  state.source = source;

  // Notify service worker
  try {
    await chrome.runtime.sendMessage({
      type: 'contentChanged',
      urlHash: state.urlHash,
      contentId: newContentId,
      label: newLabel,
      source
    });
  } catch (error) {
    // Ignore extension context invalidated errors
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes('Extension context invalidated')) {
      console.error('[Seer] Failed to notify content change:', error);
    }
  }
}

/**
 * Handle title change (debounced)
 */
function handleTitleChange(): void {
  // If manual label is set, ignore title changes
  if (manualLabel) return;

  const newTitle = document.title;

  // Skip if title hasn't changed
  if (newTitle === state.lastTitle) return;

  // Check if this is a false positive
  if (shouldIgnoreTitleChange(state.lastTitle, newTitle)) {
    state.lastTitle = newTitle;
    return;
  }

  // Debounce to avoid rapid changes
  if (titleDebounceTimeout) {
    clearTimeout(titleDebounceTimeout);
  }

  titleDebounceTimeout = window.setTimeout(() => {
    titleDebounceTimeout = null;

    // Re-check in case it changed back
    if (document.title === state.lastTitle) return;

    state.lastTitle = document.title;
    handleContentChange(document.title, 'title');
  }, TITLE_DEBOUNCE_MS);
}

/**
 * Handle SPA navigation (from service worker)
 */
function handleSpaNavigation(newUrl: string): void {
  // If manual label is set, flush but don't change label
  if (manualLabel) {
    flushEncounters();
    resetSession();
    return;
  }

  // Skip if URL hasn't actually changed
  if (newUrl === state.lastUrl) return;

  state.lastUrl = newUrl;
  state.urlHash = fnv1a(newUrl);

  // Use the path as the label (more useful than full URL)
  try {
    const url = new URL(newUrl);
    const label = url.pathname + url.search + url.hash || '/';
    handleContentChange(label, 'history');
  } catch {
    handleContentChange(newUrl, 'history');
  }
}

/**
 * Set a manual content label (user override)
 */
export function setManualLabel(label: string): void {
  manualLabel = label;
  handleContentChange(label, 'manual');
}

/**
 * Clear manual label and revert to auto-detection
 */
export function clearManualLabel(): void {
  manualLabel = null;
  // Trigger title-based detection
  state.lastTitle = '';
  handleTitleChange();
}

/**
 * Get current content state
 */
export function getCurrentContentId(): string | null {
  return state.contentId;
}

export function getCurrentLabel(): string | null {
  return state.label;
}

export function getContentState(): {
  contentId: string | null;
  label: string | null;
  source: string;
} {
  return {
    contentId: state.contentId,
    label: state.label,
    source: state.source
  };
}

/**
 * Initialize content tracking
 */
export function initContentTracking(): void {
  // Register content ID getter with encounter tracker
  setContentIdGetter(getCurrentContentId);

  // Initialize state
  state = {
    urlHash: fnv1a(location.href),
    contentId: null,
    label: null,
    source: 'url',
    lastTitle: document.title,
    lastUrl: location.href
  };

  // Watch for title changes
  const titleEl = document.querySelector('head > title');
  if (titleEl) {
    titleObserver = new MutationObserver(handleTitleChange);
    titleObserver.observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  // Also watch for title element being added (some SPAs create it dynamically)
  const headObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLTitleElement) {
          if (titleObserver) titleObserver.disconnect();
          titleObserver = new MutationObserver(handleTitleChange);
          titleObserver.observe(node, {
            childList: true,
            characterData: true,
            subtree: true
          });
        }
      }
    }
  });
  headObserver.observe(document.head, { childList: true });

  // Listen for SPA navigation messages from service worker
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'spaNavigation') {
      handleSpaNavigation(message.url);
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'setContentLabel') {
      setManualLabel(message.label);
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'clearContentLabel') {
      clearManualLabel();
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'getContentState') {
      sendResponse(getContentState());
      return true;
    }

    return false;
  });

  console.log('[Seer] Content tracking initialized');
}

/**
 * Cleanup
 */
export function destroyContentTracking(): void {
  if (titleObserver) {
    titleObserver.disconnect();
    titleObserver = null;
  }
  if (titleDebounceTimeout) {
    clearTimeout(titleDebounceTimeout);
    titleDebounceTimeout = null;
  }
}
