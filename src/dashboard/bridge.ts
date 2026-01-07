/**
 * Seer Dashboard Bridge
 *
 * Client-side class for communicating with the Seer extension from the dashboard page.
 * Uses window.postMessage to communicate with the bridge content script.
 */

import type { VocabDataSerialized, SeerConfig } from '@shared/types';

const DASHBOARD_SOURCE = 'seer-dashboard';
const EXTENSION_SOURCE = 'seer-extension';
const REQUEST_TIMEOUT_MS = 30000;

export interface ExtensionInfo {
  ready: boolean;
  version: string | null;
}

export interface FilterOpts {
  minTimeMs?: number;
  limit?: number;
  offset?: number;
  timeRange?: 'today' | 'week' | 'month' | 'all';
  status?: 'all' | 'known' | 'unknown' | 'ignored';
  sortBy?: 'count' | 'recent' | 'frequency' | 'alpha';
  minEncounters?: number;
  unknownCount?: number;
  search?: string;
  [key: string]: unknown; // Index signature for compatibility
}

export interface TopWord {
  baseForm: string;
  surface: string;
  count: number;
  pages: string[];
  frequency?: number;
  lastSeen: number;
  status: 'known' | 'unknown' | 'ignored';
}

export interface I1Sentence {
  text: string;
  targetWord: string;
  url: string;
  timestamp: number;
}

export interface I1Summary {
  totalI1Sentences: number;
  totalNearI1Sentences: number;
  uniqueI1Words: number;
  avgI1SentencesPerWord: number;
}

export interface SiteStats {
  url: string;
  urlHash: number;
  hostname: string;
  comprehensionPercent: number;
  totalTimeMs: number;
  visitCount: number;
  lastVisit: number;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

class SeerBridge {
  private pending = new Map<string, PendingRequest>();
  private _ready = false;
  private _version: string | null = null;
  private readyPromise: Promise<void>;
  private readyResolve: (() => void) | null = null;

  constructor() {
    // Set up ready promise
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    // Listen for messages from the extension
    window.addEventListener('message', this.handleMessage.bind(this));

    // Request extension status
    this.requestReady();
  }

  private requestReady() {
    // The content script will signal ready on load
    // We can also request it by sending a ping
    window.postMessage({
      source: DASHBOARD_SOURCE,
      type: 'ping',
      requestId: 'ping-' + Date.now(),
    }, '*');
  }

  private handleMessage(event: MessageEvent) {
    // Only accept messages from this window
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== EXTENSION_SOURCE) return;

    // Handle ready signal
    if (data.type === 'ready') {
      this._ready = true;
      this._version = data.version || null;
      this.readyResolve?.();
      console.log('[Seer Dashboard] Extension connected, version:', this._version);
      return;
    }

    // Handle response to a request
    const { requestId, response, error } = data;
    if (!requestId) return;

    const pending = this.pending.get(requestId);
    if (!pending) return;

    // Clear timeout and remove from pending
    clearTimeout(pending.timeout);
    this.pending.delete(requestId);

    // Resolve or reject
    if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(response);
    }
  }

  /**
   * Check if the extension is connected
   */
  get ready(): boolean {
    return this._ready;
  }

  /**
   * Get extension version
   */
  get version(): string | null {
    return this._version;
  }

  /**
   * Get extension info
   */
  get info(): ExtensionInfo {
    return {
      ready: this._ready,
      version: this._version,
    };
  }

  /**
   * Wait for the extension to be ready
   */
  async waitForReady(): Promise<void> {
    if (this._ready) return;

    // Wait with timeout
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Extension not detected')), 5000);
    });

    return Promise.race([this.readyPromise, timeout]);
  }

  /**
   * Send a message to the extension and wait for response
   */
  private async send<T>(type: string, payload?: Record<string, unknown>): Promise<T> {
    if (!this._ready) {
      await this.waitForReady();
    }

    const requestId = crypto.randomUUID();

    return new Promise((resolve, reject) => {
      // Set up timeout
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Request timeout: ${type}`));
      }, REQUEST_TIMEOUT_MS);

      // Store pending request
      this.pending.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      // Send message
      window.postMessage({
        source: DASHBOARD_SOURCE,
        type,
        payload: payload || {},
        requestId,
      }, '*');
    });
  }

  // ============================================
  // API Methods
  // ============================================

  /**
   * Get extension configuration
   */
  async getConfig(): Promise<SeerConfig> {
    return this.send<SeerConfig>('getConfig');
  }

  /**
   * Get vocabulary data
   */
  async getVocabulary(): Promise<VocabDataSerialized> {
    return this.send<VocabDataSerialized>('getVocabulary');
  }

  /**
   * Sync vocabulary with Anki
   */
  async syncVocabulary(): Promise<{ success: boolean; error?: string }> {
    return this.send('syncVocabulary');
  }

  /**
   * Get encounter stats (top words)
   */
  async getEncounterStats(opts: FilterOpts = {}): Promise<{
    words: TopWord[];
    total: number;
  }> {
    return this.send('getEncounterStats', opts);
  }

  /**
   * Get all i+1 sentences
   */
  async getAllI1Sentences(opts: {
    limit?: number;
    minTimeMs?: number;
    unknownCount?: 1 | 2 | 3;
  } = {}): Promise<I1Sentence[]> {
    return this.send('getAllI1Sentences', opts);
  }

  /**
   * Get i+1 summary stats
   */
  async getI1Summary(minTimeMs = 5000): Promise<I1Summary> {
    return this.send('getI1Summary', { minTimeMs });
  }

  /**
   * Get high-value words for i+1
   */
  async getI1HighValueWords(limit = 20, minTimeMs = 5000): Promise<Array<{
    word: string;
    i1SentenceCount: number;
    recentSentence?: string;
  }>> {
    return this.send('getI1HighValueWords', { limit, minTimeMs });
  }

  /**
   * Get site statistics
   */
  async getSiteStats(opts: FilterOpts = {}): Promise<SiteStats[]> {
    return this.send('getSiteStats', opts);
  }

  /**
   * Mark a word as known
   */
  async addKnownWord(word: string): Promise<{ success: boolean; noteId?: number; error?: string }> {
    return this.send('addKnownWord', { word });
  }

  /**
   * Add a word to ignored list
   */
  async addIgnoredWord(word: string): Promise<{ success: boolean; noteId?: number; error?: string }> {
    return this.send('addIgnoredWord', { word });
  }

  /**
   * Get raw encounters for a word
   */
  async getWordEncounters(word: string): Promise<Array<{
    timestamp: number;
    url: string;
    sentence?: string;
  }>> {
    return this.send('getWordEncounters', { word });
  }

  /**
   * Get all sentences with filtering
   */
  async getAllSentences(opts: {
    source?: 'encountered' | 'library' | 'all';
    timeRange?: 'all' | 'today' | 'week' | 'month';
    unknownCount?: number;
    sortBy?: 'recent' | 'shortest' | 'longest';
    search?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{
    sentences: Array<{
      text: string;
      unknownWords: string[];
      url: string;
      pageTitle: string;
      timestamp: number;
      source: 'encountered' | 'library';
      sourceId?: string;
    }>;
    total: number;
    hasMore: boolean;
  }> {
    return this.send('getAllSentences', opts);
  }

  // ============================================
  // Library API
  // ============================================

  /**
   * Get library statistics
   */
  async getLibraryStats(): Promise<{
    totalSources: number;
    totalSentences: number;
    totalWords: number;
    avgComprehension: number;
    readySources: number;
  }> {
    return this.send('getLibraryStats');
  }

  /**
   * Get library sources
   */
  async getLibrarySources(opts: { limit?: number; offset?: number } = {}): Promise<Array<{
    id: string;
    title: string;
    sourceType: string;
    sentenceCount: number;
    comprehensionPercent?: number;
    i1SentenceCount?: number;
    difficultyLabel?: string;
    topUnknownWords?: string[];
  }>> {
    return this.send('getLibrarySources', { opts });
  }

  /**
   * Bulk import library entries from JSON
   */
  async bulkImportLibrary(entries: Array<{
    id: string;
    title: string;
    sourceType: string;
    sourceRef?: string;
    sentences: Array<{ text: string; words: string[] }>;
  }>): Promise<{
    success: boolean;
    imported?: number;
    skipped?: number;
    totalSentences?: number;
    error?: string;
  }> {
    return this.send('bulkImportLibrary', { entries });
  }

  /**
   * Recalculate all library sources
   */
  async recalculateLibrary(): Promise<{ updated: number }> {
    return this.send('recalculateLibrary');
  }

  /**
   * Clear entire library
   */
  async clearLibrary(): Promise<{ success: boolean }> {
    return this.send('clearLibrary');
  }

  /**
   * Search library sentences
   */
  async searchLibrarySentences(opts: {
    query: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    sentences: Array<{
      text: string;
      words: string[];
      sourceId: string;
      sourceTitle: string;
      sourceType: string;
    }>;
    total: number;
    hasMore: boolean;
  }> {
    return this.send('searchLibrarySentences', opts);
  }

  /**
   * Get i+1 sentences from library
   */
  async getLibraryI1Sentences(opts: {
    sourceId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<Array<{
    sentence: { text: string; words: string[] };
    unknownWord: string;
    sourceTitle: string;
  }>> {
    return this.send('getLibraryI1Sentences', opts);
  }
}

// Export singleton instance
export const bridge = new SeerBridge();
