import type { SeerConfig } from './types';
import { DEFAULT_HIGHLIGHT_CONFIG } from './highlight-defaults';

export const DEFAULT_CONFIG: SeerConfig = {
  ankiConnectUrl: 'http://127.0.0.1:8765',
  ankiConnectApiKey: '',
  knownSources: [
    { deckName: 'Japanese', fieldName: 'Expression' }
  ],
  ignoredSource: {
    deckName: 'Seer::Ignored',
    fieldName: 'Word'
  },
  knownSource: {
    deckName: 'Seer::Known',
    fieldName: 'Word'
  },
  syncIntervalMinutes: 30,
  highlightConfig: DEFAULT_HIGHLIGHT_CONFIG,
  showStatsPanel: true,
  enabled: true,
  debugMode: false,
  ignoreList: {
    domains: [],
    urls: []
  },
  mokuroMode: false,
  deduplication: {
    enabled: true,
    timeWindowHours: 4  // Skip duplicates within 4 hours
  },
  theme: 'auto',  // Default to system preference
  highlightsVisible: true  // Master toggle - highlights visible by default
};

export const STORAGE_KEYS = {
  config: 'seer-config',
  vocabulary: 'seer-vocabulary',
  lastSync: 'seer-last-sync'
} as const;

// Anki safety constants
export const SEER_DECK_PREFIX = 'Seer::';
export const SEER_IGNORED_MODEL_NAME = 'Seer Ignored Word';
export const SEER_KNOWN_MODEL_NAME = 'Seer Known Word';

// Encounter tracking constants
export const ENCOUNTER_BUFFER_SIZE = 100;      // Flush after this many encounters
export const ENCOUNTER_FLUSH_DELAY_MS = 2000;  // Flush after this much inactivity

// Content script constants
export const MESSAGE_TIMEOUT_MS = 10_000;      // Timeout for chrome.runtime.sendMessage

// Popup constants
export const POPUP_RETRY_COUNT = 3;            // Retries for loading page stats
export const POPUP_RETRY_DELAY_MS = 500;       // Delay between retries

// Page time tracking constants
export const PAGE_TIME_FLUSH_INTERVAL_MS = 30_000;  // Flush time every 30 seconds
export const PAGE_TIME_MIN_THRESHOLD_MS = 5_000;    // Default minimum time for filtering (5s)

/**
 * Check if a URL is in the ignore list.
 * Used by background services to filter out ignored pages from stats.
 */
export function isUrlIgnored(url: string, ignoreList: { domains: string[]; urls: string[] }): boolean {
  if (!ignoreList) return false;

  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname;

    // Check domain ignore (includes subdomains)
    for (const ignoredDomain of ignoreList.domains) {
      if (domain === ignoredDomain || domain.endsWith('.' + ignoredDomain)) {
        return true;
      }
    }

    // Check URL ignore (prefix match)
    for (const ignoredUrl of ignoreList.urls) {
      if (url === ignoredUrl || url.startsWith(ignoredUrl)) {
        return true;
      }
    }
  } catch {
    // Invalid URL, don't ignore
  }

  return false;
}
