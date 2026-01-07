/**
 * Shared utility functions for Seer extension
 */

import type { VocabData, VocabDataSerialized } from './types';

/**
 * Deserialize vocabulary data from storage format to runtime format.
 * Converts arrays back to Sets for efficient lookups.
 */
export function deserializeVocab(serialized: VocabDataSerialized): VocabData {
  return {
    known: new Set(serialized.known),
    ignored: new Set(serialized.ignored),
    lastSync: serialized.lastSync,
    totalCards: serialized.totalCards,
  };
}

/**
 * Serialize vocabulary data for storage.
 * Converts Sets to arrays for JSON serialization.
 */
export function serializeVocab(vocab: VocabData): VocabDataSerialized {
  return {
    known: Array.from(vocab.known),
    ignored: Array.from(vocab.ignored),
    lastSync: vocab.lastSync,
    totalCards: vocab.totalCards,
  };
}

/**
 * Get a required DOM element by ID with proper error handling.
 * Throws a descriptive error if the element is not found.
 */
export function getRequiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Required element #${id} not found in DOM`);
  }
  return element as T;
}

/**
 * Get a required DOM element by ID, returning null if not found.
 * Use this when element absence is expected in some contexts.
 */
export function getOptionalElement<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/**
 * Escape HTML entities to prevent XSS attacks.
 * Use this when inserting user content into innerHTML.
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Validate and sanitize URLs - only allow http/https protocols.
 * Returns null for invalid or non-http(s) URLs.
 */
export function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Escape deck names for use in Anki query strings.
 * Escapes double quotes and backslashes to prevent injection.
 */
export function escapeAnkiDeckName(deckName: string): string {
  return deckName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Format a number for display (e.g., 1000 -> "1K", 1000000 -> "1M")
 */
export function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}

/**
 * Get a relative time string from a timestamp (e.g., "5m ago", "2d ago")
 */
export function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(timestamp).toLocaleDateString();
}

/**
 * Debounce a function - delays execution until after wait milliseconds
 * have elapsed since the last time the debounced function was invoked.
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  waitMs: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, waitMs);
  };
}

/**
 * Throttle a function - limits execution to at most once per wait milliseconds.
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  waitMs: number
): (...args: Parameters<T>) => void {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = waitMs - (now - lastCall);

    if (remaining <= 0) {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      lastCall = now;
      fn(...args);
    } else if (timeoutId === null) {
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        timeoutId = null;
        fn(...args);
      }, remaining);
    }
  };
}

/**
 * Sleep for a given number of milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Chunk an array into smaller arrays of the specified size.
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
