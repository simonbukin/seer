import { fnv1a } from '../shared/hash';
import { ENCOUNTER_BUFFER_SIZE, ENCOUNTER_FLUSH_DELAY_MS } from '../shared/config';

/**
 * Encounter Tracker
 *
 * Records word encounters via message passing to the service worker.
 * Content scripts CANNOT access the extension's IndexedDB directly.
 */

interface PendingEncounter {
  word: string;           // Base/dictionary form
  surface: string;        // Actual form seen
  sentence: string;       // Context sentence (max 300 chars)
  url: string;            // Full URL
  urlHash: number;        // FNV-1a hash of URL
  pageTitle: string;      // Page title
  contentId?: string;     // SPA content identifier (optional)
  timestamp: number;      // When seen
  frequency: number;      // JPDB rank
}

// Content ID getter (set by content-tracker to avoid circular dependency)
let contentIdGetter: (() => string | null) | null = null;

/**
 * Set the content ID getter function (called by content-tracker)
 */
export function setContentIdGetter(getter: () => string | null): void {
  contentIdGetter = getter;
}

interface PendingSentence {
  hash: number;            // Primary key - hash of sentence text
  text: string;            // The sentence
  url: string;             // Where found
  urlHash: number;         // For joining with pages
  unknownWords: string[];  // List of unknown words
  unknownCount: number;    // How many unknowns (1 = i+1)
  timestamp: number;       // When first seen
}

// Buffers
let encounterBuffer: PendingEncounter[] = [];
let sentenceBuffer: Map<number, PendingSentence> = new Map();
let flushTimeout: number | null = null;
let isFlushing = false;

// Session deduplication: track word:urlHash:sentenceHash combinations seen this session
// Prevents duplicates from page refreshes, MutationObserver re-triggers, back-forward nav
let sessionEncounters = new Set<string>();

/**
 * Record a word encounter
 */
export function recordEncounter(
  word: string,
  surface: string,
  sentence: string,
  frequency: number
): void {
  const url = location.href;
  const urlHash = fnv1a(url);
  const sentenceHash = fnv1a(sentence);
  const contentId = contentIdGetter ? contentIdGetter() : null;

  // Session deduplication: skip if we've already recorded this word in this sentence on this URL/content
  const dedupKey = `${word}:${urlHash}:${contentId || ''}:${sentenceHash}`;
  if (sessionEncounters.has(dedupKey)) {
    return;
  }
  sessionEncounters.add(dedupKey);

  encounterBuffer.push({
    word,
    surface,
    sentence: sentence.slice(0, 300),
    url,
    urlHash,
    pageTitle: document.title || url,
    contentId: contentId || undefined,
    timestamp: Date.now(),
    frequency
  });

  // Log every 100 encounters buffered
  if (encounterBuffer.length % 100 === 0) {
    console.log(`[Seer] Buffered ${encounterBuffer.length} encounters`);
  }

  scheduleFlush();
}

/**
 * Record a sentence for i+1 detection
 */
export function recordSentence(
  sentence: string,
  unknownWords: string[]
): void {
  const hash = fnv1a(sentence);
  if (sentenceBuffer.has(hash)) return;

  const url = location.href;
  sentenceBuffer.set(hash, {
    hash,
    text: sentence.slice(0, 300),
    url,
    urlHash: fnv1a(url),
    unknownWords,
    unknownCount: unknownWords.length,
    timestamp: Date.now()
  });

  scheduleFlush();
}

/**
 * Schedule flush with debouncing
 */
function scheduleFlush(): void {
  if (flushTimeout) clearTimeout(flushTimeout);

  if (encounterBuffer.length >= ENCOUNTER_BUFFER_SIZE) {
    flushEncounters();
  } else {
    flushTimeout = window.setTimeout(flushEncounters, ENCOUNTER_FLUSH_DELAY_MS);
  }
}

/**
 * Flush to service worker
 */
export async function flushEncounters(): Promise<void> {
  if (encounterBuffer.length === 0 && sentenceBuffer.size === 0) return;
  if (isFlushing) return;

  isFlushing = true;

  const encountersToFlush = encounterBuffer;
  const sentencesToFlush = Array.from(sentenceBuffer.values());
  encounterBuffer = [];
  sentenceBuffer = new Map();
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }

  console.log(`[Seer] Flushing ${encountersToFlush.length} encounters, ${sentencesToFlush.length} sentences...`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'storeEncounters',
      encounters: encountersToFlush,
      sentences: sentencesToFlush
    });

    if (response?.success) {
      console.log(`[Seer] ✓ Stored ${encountersToFlush.length} encounters`);
    } else {
      console.error(`[Seer] ✗ Failed to store:`, response?.error);
      // Re-add to buffer for retry
      encounterBuffer = [...encountersToFlush, ...encounterBuffer];
      for (const s of sentencesToFlush) {
        if (!sentenceBuffer.has(s.hash)) {
          sentenceBuffer.set(s.hash, s);
        }
      }
    }
  } catch (error) {
    // Silently ignore "Extension context invalidated" - expected when extension reloads
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('Extension context invalidated')) {
      // Don't re-add to buffer - the extension is dead anyway
    } else {
      console.error(`[Seer] ✗ Message send failed:`, error);
      // Re-add to buffer for retry
      encounterBuffer = [...encountersToFlush, ...encounterBuffer];
      for (const s of sentencesToFlush) {
        if (!sentenceBuffer.has(s.hash)) {
          sentenceBuffer.set(s.hash, s);
        }
      }
    }
  } finally {
    isFlushing = false;
  }
}

/**
 * Get buffer sizes for debugging
 */
export function getBufferSizes(): { encounters: number; sentences: number } {
  return {
    encounters: encounterBuffer.length,
    sentences: sentenceBuffer.size
  };
}

/**
 * Initialize - flush on visibility change
 */
export function initEncounterTracking(): void {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      console.log('[Seer] Tab hidden, flushing encounters...');
      flushEncounters();
    }
  });
  console.log('[Seer] Encounter tracking initialized');
}

/**
 * Clear buffers (for testing)
 */
export function clearBuffers(): void {
  encounterBuffer = [];
  sentenceBuffer = new Map();
  sessionEncounters.clear();
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }
}

/**
 * Reset session deduplication (call on URL change for SPA support)
 */
export function resetSession(): void {
  sessionEncounters.clear();
  encounterBuffer = [];
  sentenceBuffer = new Map();
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }
}
