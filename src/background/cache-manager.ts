/**
 * Cache Manager for Seer Extension
 *
 * Provides centralized cache management with:
 * - TTL (time-to-live) support
 * - Automatic invalidation
 * - Mutex for sync operations
 * - Version tracking
 */

import { logger } from '../shared/logger';
import type { VocabData, SeerConfig, PageStats } from '../shared/types';
import { STORAGE_KEYS, DEFAULT_CONFIG } from '../shared/config';
import { deserializeVocab, serializeVocab } from '../shared/utils';

/**
 * Simple mutex for preventing concurrent sync operations
 */
class SimpleMutex {
  private locked = false;
  private queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return;
    }

    return new Promise(resolve => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    } else {
      this.locked = false;
    }
  }
}

/**
 * Cache entry with metadata
 */
interface CacheEntry<T> {
  data: T;
  timestamp: number;
  version: number;
}

/**
 * Cache configuration
 */
interface CacheConfig {
  /** TTL in milliseconds (0 = no expiration) */
  ttl: number;
}

const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes

class CacheManager {
  private vocabCache: CacheEntry<VocabData> | null = null;
  private configCache: CacheEntry<SeerConfig> | null = null;
  private pageStats: Map<number, PageStats> = new Map();
  private syncMutex = new SimpleMutex();
  private cacheVersion = 0;

  private config: CacheConfig = {
    ttl: DEFAULT_TTL,
  };

  /**
   * Configure cache settings
   */
  configure(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Check if a cache entry is still valid
   */
  private isValid<T>(entry: CacheEntry<T> | null): entry is CacheEntry<T> {
    if (!entry) return false;
    if (this.config.ttl === 0) return true;
    return Date.now() - entry.timestamp < this.config.ttl;
  }

  // ============ Config Cache ============

  /**
   * Get config from cache or storage
   */
  async getConfig(): Promise<SeerConfig> {
    if (this.isValid(this.configCache)) {
      return this.configCache.data;
    }

    const result = await chrome.storage.local.get(STORAGE_KEYS.config);
    const config = { ...DEFAULT_CONFIG, ...result[STORAGE_KEYS.config] };

    this.configCache = {
      data: config,
      timestamp: Date.now(),
      version: this.cacheVersion,
    };

    return config;
  }

  /**
   * Update config in cache and storage
   */
  async setConfig(partial: Partial<SeerConfig>): Promise<void> {
    const current = await this.getConfig();
    const updated = { ...current, ...partial };

    await chrome.storage.local.set({ [STORAGE_KEYS.config]: updated });

    this.configCache = {
      data: updated,
      timestamp: Date.now(),
      version: ++this.cacheVersion,
    };

    logger.background.debug('Config updated', { version: this.cacheVersion });
  }

  // ============ Vocabulary Cache ============

  /**
   * Get vocabulary from cache or storage
   */
  async getVocabulary(): Promise<VocabData> {
    if (this.isValid(this.vocabCache)) {
      return this.vocabCache.data;
    }

    const result = await chrome.storage.local.get(STORAGE_KEYS.vocabulary);
    const stored = result[STORAGE_KEYS.vocabulary];

    if (stored) {
      const vocab = deserializeVocab(stored);
      this.vocabCache = {
        data: vocab,
        timestamp: Date.now(),
        version: this.cacheVersion,
      };
      return vocab;
    }

    // Return empty vocab if nothing stored
    return {
      known: new Set(),
      ignored: new Set(),
      lastSync: 0,
      totalCards: 0,
    };
  }

  /**
   * Update vocabulary in cache and storage
   */
  async setVocabulary(vocab: VocabData): Promise<void> {
    const serialized = serializeVocab(vocab);
    await chrome.storage.local.set({ [STORAGE_KEYS.vocabulary]: serialized });

    this.vocabCache = {
      data: vocab,
      timestamp: Date.now(),
      version: ++this.cacheVersion,
    };

    logger.background.debug('Vocabulary cache updated', {
      known: vocab.known.size,
      ignored: vocab.ignored.size,
    });
  }

  /**
   * Invalidate vocabulary cache (force next read from storage)
   */
  invalidateVocabulary(): void {
    this.vocabCache = null;
    logger.background.debug('Vocabulary cache invalidated');
  }

  // ============ Page Stats ============

  /**
   * Get page stats for a tab
   */
  getPageStats(tabId: number): PageStats | null {
    return this.pageStats.get(tabId) || null;
  }

  /**
   * Set page stats for a tab
   */
  setPageStats(tabId: number, stats: PageStats): void {
    this.pageStats.set(tabId, stats);
  }

  /**
   * Remove page stats for a tab (e.g., when tab closes)
   */
  removePageStats(tabId: number): void {
    this.pageStats.delete(tabId);
  }

  /**
   * Clear all page stats
   */
  clearPageStats(): void {
    this.pageStats.clear();
  }

  // ============ Sync Operations ============

  /**
   * Acquire sync mutex to prevent concurrent syncs
   */
  async acquireSyncLock(): Promise<void> {
    await this.syncMutex.acquire();
  }

  /**
   * Release sync mutex
   */
  releaseSyncLock(): void {
    this.syncMutex.release();
  }

  /**
   * Run an operation with sync lock
   */
  async withSyncLock<T>(operation: () => Promise<T>): Promise<T> {
    await this.syncMutex.acquire();
    try {
      return await operation();
    } finally {
      this.syncMutex.release();
    }
  }

  // ============ Cache Management ============

  /**
   * Invalidate all caches
   */
  invalidateAll(): void {
    this.vocabCache = null;
    this.configCache = null;
    this.pageStats.clear();
    this.cacheVersion++;
    logger.background.info('All caches invalidated');
  }

  /**
   * Get cache statistics for debugging
   */
  getStats(): {
    vocabCached: boolean;
    configCached: boolean;
    pageStatsCount: number;
    cacheVersion: number;
  } {
    return {
      vocabCached: this.vocabCache !== null,
      configCached: this.configCache !== null,
      pageStatsCount: this.pageStats.size,
      cacheVersion: this.cacheVersion,
    };
  }
}

// Export singleton instance
export const cacheManager = new CacheManager();

// Also export class for testing
export { CacheManager };
