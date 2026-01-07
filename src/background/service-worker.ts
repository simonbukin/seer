import { AnkiClient } from '../shared/anki-client';
import { DEFAULT_CONFIG, STORAGE_KEYS } from '../shared/config';
import { extractWordFromAnkiField, getAllForms } from '../shared/normalization';
import { fnv1a } from '../shared/hash';
import type { SeerConfig, VocabData, VocabDataSerialized, PageStats, HighlightConfig, HighlightLayerConfig, KnowledgeLevel, WordKnowledge, StoryPromptConfig } from '../shared/types';
import { buildPriorityQueue, getUnlockWords, getHighI1PotentialWords } from './priority-ranking';
import { getStatsForRange, getRecentPages, exportEncounters, clearOldData, getDebugCounts, getDatabaseSizes, searchEncountersBySentence, getSiteStats, getWordEncounters, getTopEncounteredWords, getAllSentencesFiltered } from './query-service';
import { getI1Summary, getI1HighValueWords, getAllI1Sentences } from './i1-service';
import {
  createComprehensionSnapshot,
  getImprovedPages,
  recalculateAllPages,
  getPageComprehensionHistory,
  getComprehensionSummary
} from './comprehension-service';
import { logger } from '../shared/logger';
import { db, Encounter, Sentence, Page, ComprehensionSnapshot } from '../shared/db';
import type { SeerBackupV1, BackupValidationResult, ImportOptions, ImportResult, ExportResult } from '../shared/backup-types';
import { isSeerBackupV1 } from '../shared/backup-types';
import { getGrammarPoints, searchGrammarPoints, getKnownGrammarIds, setKnownGrammarIds, addKnownGrammar, removeKnownGrammar } from './grammar-service';
import { generateStoryPrompt, DEFAULT_PROMPT_CONFIG, getPromptTemplates, savePromptTemplate, deletePromptTemplate, setActiveTemplate } from './prompt-service';
import type { PromptTemplate } from '../shared/types';
import {
  importContent,
  analyzeSource,
  recalculateAllSources,
  getLibrarySources,
  getLibrarySource,
  getI1Sentences,
  getLibraryStats,
  updateLibrarySource,
  deleteLibrarySource,
  bulkImportSentences,
  searchLibrarySentences
} from './library-service';

/**
 * Escape deck names for use in Anki query strings.
 * Anki queries use double quotes for deck names, so we need to escape
 * any double quotes in the deck name to prevent injection attacks.
 */
function escapeAnkiDeckName(deckName: string): string {
  // Escape double quotes and backslashes for Anki query syntax
  return deckName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Determine knowledge level based on Anki card properties.
 * @param type Card type: 0=new, 1=learning, 2=review, 3=relearning
 * @param interval Days until next review (negative for learning cards)
 * @param reps Total number of reviews
 */
function determineKnowledgeLevel(type: number, interval: number, reps: number): KnowledgeLevel {
  // Card has never been reviewed
  if (reps === 0) {
    return 'new';
  }

  // Card is in learning or relearning phase
  if (type === 1 || type === 3) {
    return 'learning';
  }

  // Card is a review card - check interval for maturity
  // Anki considers cards "mature" at 21+ days interval
  if (interval >= 21) {
    return 'mature';
  }

  return 'young';
}

// In-memory cache
let vocabCache: VocabData | null = null;
let configCache: SeerConfig | null = null;
const pageStats = new Map<number, PageStats>();

// Tokenization is now handled in content script, no offscreen document needed

// Broadcast message to all tabs (for config changes)
async function broadcastToTabs(message: Record<string, unknown>): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab might not have content script, that's fine
        });
      }
    }
  } catch (e) {
    logger.background.error('Failed to broadcast to tabs:', e);
  }
}

// Get config from storage or use defaults
async function getConfig(): Promise<SeerConfig> {
  if (configCache) return configCache;

  const result = await chrome.storage.local.get(STORAGE_KEYS.config);
  configCache = { ...DEFAULT_CONFIG, ...result[STORAGE_KEYS.config] };
  return configCache;
}

// Save config
async function setConfig(partial: Partial<SeerConfig>): Promise<void> {
  const current = await getConfig();
  configCache = { ...current, ...partial };
  await chrome.storage.local.set({ [STORAGE_KEYS.config]: configCache });
}

// Fetch vocabulary from Anki
async function syncVocabulary(): Promise<VocabData> {
  const config = await getConfig();
  const client = new AnkiClient(config.ankiConnectUrl, config.ankiConnectApiKey);

  // Check connection first
  const connection = await client.checkConnection();
  if (!connection.connected) {
    throw new Error(`Cannot connect to Anki: ${connection.error}`);
  }

  const known = new Set<string>();
  const ignored = new Set<string>();
  const knowledgeLevels = new Map<string, WordKnowledge>();
  let totalCards = 0;

  // Track word sources separately for counts
  const miningDeckWords = new Set<string>();
  const markedKnownWords = new Set<string>();
  const ignoredWords = new Set<string>();

  // Fetch known words from configured decks
  for (const source of config.knownSources) {
    const cardIds = await client.findCards(`deck:"${escapeAnkiDeckName(source.deckName)}"`);
    totalCards += cardIds.length;

    // Batch fetch card info
    const BATCH_SIZE = 100;
    for (let i = 0; i < cardIds.length; i += BATCH_SIZE) {
      const batch = cardIds.slice(i, i + BATCH_SIZE);
      const cardsInfo = await client.getCardsInfo(batch);

      for (const card of cardsInfo) {
        const fieldValue = card.fields[source.fieldName]?.value;
        if (fieldValue) {
          const word = extractWordFromAnkiField(fieldValue);

          // Check if card is suspended (queue=-1)
          const isSuspended = card.queue === -1;

          // Calculate knowledge level from card properties
          const level = determineKnowledgeLevel(card.type, card.interval, card.reps);

          // Only consider cards as "known" if:
          // - They've been reviewed at least once (level !== 'new')
          // - They are not suspended
          if (level !== 'new' && !isSuspended) {
            for (const form of getAllForms(word)) {
              known.add(form);
            }
          }

          // Track source for unique word count
          miningDeckWords.add(word);

          // Store knowledge level for the base word (not all forms)
          // Use the best knowledge level if word appears in multiple cards
          // (but prefer non-suspended over suspended)
          const existing = knowledgeLevels.get(word);
          const shouldUpdate = !existing ||
            (!isSuspended && existing.suspended) ||  // Prefer non-suspended
            (!existing.suspended === !isSuspended && getKnowledgePriority(level) > getKnowledgePriority(existing.level));

          if (shouldUpdate) {
            knowledgeLevels.set(word, {
              word,
              level,
              interval: card.interval,
              reps: card.reps,
              lapses: card.lapses,
              suspended: isSuspended
            });
          }
        }
      }
    }
  }

  // Fetch ignored words
  const ignoredSource = config.ignoredSource;
  try {
    const ignoredCardIds = await client.findCards(`deck:"${escapeAnkiDeckName(ignoredSource.deckName)}"`);

    const BATCH_SIZE = 100;
    for (let i = 0; i < ignoredCardIds.length; i += BATCH_SIZE) {
      const batch = ignoredCardIds.slice(i, i + BATCH_SIZE);
      const cardsInfo = await client.getCardsInfo(batch);

      for (const card of cardsInfo) {
        const fieldValue = card.fields[ignoredSource.fieldName]?.value;
        if (fieldValue) {
          const word = extractWordFromAnkiField(fieldValue);
          ignoredWords.add(word);  // Track source
          for (const form of getAllForms(word)) {
            ignored.add(form);
          }
        }
      }
    }
  } catch (e) {
    // Ignored deck might not exist yet, that's fine
    logger.sync.debug('Ignored deck not found, continuing without it');
  }

  // Fetch manually marked known words (Shift+K deck)
  const knownSource = config.knownSource;
  try {
    const knownCardIds = await client.findCards(`deck:"${escapeAnkiDeckName(knownSource.deckName)}"`);

    const BATCH_SIZE = 100;
    for (let i = 0; i < knownCardIds.length; i += BATCH_SIZE) {
      const batch = knownCardIds.slice(i, i + BATCH_SIZE);
      const cardsInfo = await client.getCardsInfo(batch);

      for (const card of cardsInfo) {
        const fieldValue = card.fields[knownSource.fieldName]?.value;
        if (fieldValue) {
          const word = extractWordFromAnkiField(fieldValue);
          markedKnownWords.add(word);  // Track source
          for (const form of getAllForms(word)) {
            known.add(form);
          }
        }
      }
    }
  } catch (e) {
    // Known deck might not exist yet, that's fine
    logger.sync.debug('Known deck not found, continuing without it');
  }

  vocabCache = {
    known,
    ignored,
    knowledgeLevels,
    lastSync: Date.now(),
    totalCards,
    sourceCounts: {
      miningDecks: miningDeckWords.size,
      markedKnown: markedKnownWords.size,
      ignored: ignoredWords.size
    }
  };

  // Persist to storage (serialized)
  const serialized: VocabDataSerialized = {
    known: Array.from(known),
    ignored: Array.from(ignored),
    knowledgeLevels: Array.from(knowledgeLevels.entries()),
    lastSync: vocabCache.lastSync,
    totalCards,
    sourceCounts: vocabCache.sourceCounts
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.vocabulary]: serialized });

  return vocabCache;
}

// Priority for knowledge levels (higher = better known)
function getKnowledgePriority(level: KnowledgeLevel): number {
  switch (level) {
    case 'new': return 0;
    case 'learning': return 1;
    case 'young': return 2;
    case 'mature': return 3;
  }
}

// Get vocabulary (from cache or storage)
async function getVocabulary(): Promise<VocabData> {
  if (vocabCache) return vocabCache;

  // Try to load from storage
  const result = await chrome.storage.local.get(STORAGE_KEYS.vocabulary);
  const stored = result[STORAGE_KEYS.vocabulary] as VocabDataSerialized | undefined;

  if (stored) {
    vocabCache = {
      known: new Set(stored.known),
      ignored: new Set(stored.ignored),
      knowledgeLevels: new Map(stored.knowledgeLevels || []),
      lastSync: stored.lastSync,
      totalCards: stored.totalCards
    };
    return vocabCache;
  }

  // No cached data, return empty
  return {
    known: new Set(),
    ignored: new Set(),
    knowledgeLevels: new Map(),
    lastSync: 0,
    totalCards: 0
  };
}

// ============================================
// BACKUP & RESTORE
// ============================================

/**
 * Generate SHA-256 checksum for data integrity verification
 */
async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a complete backup of all Seer data
 */
async function createBackup(): Promise<SeerBackupV1> {
  // Export all IndexedDB tables
  const encounters = await db.encounters.toArray();
  const pages = await db.pages.toArray();
  const sentences = await db.sentences.toArray();
  const comprehensionSnapshots = await db.comprehensionSnapshots.toArray();

  // Export chrome.storage.local
  const storageData = await chrome.storage.local.get([
    STORAGE_KEYS.config,
    STORAGE_KEYS.vocabulary
  ]);

  const config = storageData[STORAGE_KEYS.config] || DEFAULT_CONFIG;
  const vocabulary = storageData[STORAGE_KEYS.vocabulary] || {
    known: [],
    ignored: [],
    knowledgeLevels: [],
    lastSync: 0,
    totalCards: 0
  };

  // Generate checksums for integrity
  const checksums = {
    encounters: await sha256(JSON.stringify(encounters)),
    pages: await sha256(JSON.stringify(pages)),
    sentences: await sha256(JSON.stringify(sentences)),
    comprehensionSnapshots: await sha256(JSON.stringify(comprehensionSnapshots)),
    config: await sha256(JSON.stringify(config)),
    vocabulary: await sha256(JSON.stringify(vocabulary))
  };

  // Get extension version from manifest
  const manifest = chrome.runtime.getManifest();

  return {
    version: 1,
    exportedAt: Date.now(),
    seerVersion: manifest.version,
    indexedDB: {
      encounters,
      pages,
      sentences,
      comprehensionSnapshots
    },
    storage: {
      config,
      vocabulary
    },
    checksums
  };
}

/**
 * Validate backup file structure and integrity
 */
async function validateBackup(data: unknown): Promise<BackupValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nullStats = { encounters: 0, pages: 0, sentences: 0, comprehensionSnapshots: 0, configFields: 0, vocabWords: 0 };

  // Basic type validation
  if (!isSeerBackupV1(data)) {
    return { valid: false, errors: ['Invalid backup format'], warnings: [], stats: nullStats, checksumsPassed: false };
  }

  const backup = data;

  // Validate arrays
  const idb = backup.indexedDB;
  if (!Array.isArray(idb.encounters)) errors.push('encounters must be an array');
  if (!Array.isArray(idb.pages)) errors.push('pages must be an array');
  if (!Array.isArray(idb.sentences)) errors.push('sentences must be an array');
  if (!Array.isArray(idb.comprehensionSnapshots)) errors.push('comprehensionSnapshots must be an array');

  if (errors.length > 0) {
    return { valid: false, errors, warnings, stats: nullStats, checksumsPassed: false };
  }

  // Verify checksums if present
  let checksumsPassed = true;
  if (backup.checksums) {
    const cs = backup.checksums;
    if (cs.encounters) {
      const computed = await sha256(JSON.stringify(idb.encounters));
      if (computed !== cs.encounters) {
        errors.push('Encounters checksum mismatch - data may be corrupted');
        checksumsPassed = false;
      }
    }
    if (cs.pages) {
      const computed = await sha256(JSON.stringify(idb.pages));
      if (computed !== cs.pages) {
        errors.push('Pages checksum mismatch - data may be corrupted');
        checksumsPassed = false;
      }
    }
    if (cs.sentences) {
      const computed = await sha256(JSON.stringify(idb.sentences));
      if (computed !== cs.sentences) {
        errors.push('Sentences checksum mismatch - data may be corrupted');
        checksumsPassed = false;
      }
    }
    if (cs.comprehensionSnapshots) {
      const computed = await sha256(JSON.stringify(idb.comprehensionSnapshots));
      if (computed !== cs.comprehensionSnapshots) {
        errors.push('ComprehensionSnapshots checksum mismatch - data may be corrupted');
        checksumsPassed = false;
      }
    }
  } else {
    warnings.push('No checksums in backup - integrity cannot be verified');
  }

  const stats = {
    encounters: idb.encounters.length,
    pages: idb.pages.length,
    sentences: idb.sentences.length,
    comprehensionSnapshots: idb.comprehensionSnapshots.length,
    configFields: Object.keys(backup.storage.config || {}).length,
    vocabWords: backup.storage.vocabulary?.known?.length || 0
  };

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats,
    checksumsPassed
  };
}

/**
 * Import backup data with conflict resolution
 */
async function importBackup(backup: SeerBackupV1, options: ImportOptions): Promise<ImportResult> {
  const imported = { encounters: 0, pages: 0, sentences: 0, comprehensionSnapshots: 0 };
  const skipped = { encounters: 0, pages: 0, sentences: 0, comprehensionSnapshots: 0 };

  try {
    await db.transaction('rw', [db.encounters, db.pages, db.sentences, db.comprehensionSnapshots], async () => {
      if (options.clearExisting) {
        await db.encounters.clear();
        await db.pages.clear();
        await db.sentences.clear();
        await db.comprehensionSnapshots.clear();
      }

      // Import encounters
      for (const encounter of backup.indexedDB.encounters) {
        const { id, ...data } = encounter; // Remove id to let IndexedDB assign new one

        if (options.conflictStrategy === 'skip') {
          // Check for duplicate (same word, same urlHash, similar timestamp)
          const existing = await db.encounters
            .where('[word+timestamp]')
            .between([data.word, data.timestamp - 1000], [data.word, data.timestamp + 1000])
            .first();

          if (existing) {
            skipped.encounters++;
            continue;
          }
        }

        await db.encounters.add(data as Encounter);
        imported.encounters++;
      }

      // Import pages
      for (const page of backup.indexedDB.pages) {
        if (options.conflictStrategy === 'skip') {
          const existing = await db.pages.get(page.urlHash);
          if (existing) {
            skipped.pages++;
            continue;
          }
        }

        if (options.conflictStrategy === 'merge') {
          const existing = await db.pages.get(page.urlHash);
          if (existing) {
            await db.pages.put({
              ...page,
              totalTimeMs: existing.totalTimeMs + page.totalTimeMs,
              firstSeen: Math.min(existing.firstSeen, page.firstSeen),
              lastSeen: Math.max(existing.lastSeen, page.lastSeen),
              visits: existing.visits + page.visits
            });
            imported.pages++;
            continue;
          }
        }

        await db.pages.put(page);
        imported.pages++;
      }

      // Import sentences
      for (const sentence of backup.indexedDB.sentences) {
        if (options.conflictStrategy === 'skip') {
          const existing = await db.sentences.get(sentence.hash);
          if (existing) {
            skipped.sentences++;
            continue;
          }
        }

        await db.sentences.put(sentence);
        imported.sentences++;
      }

      // Import comprehension snapshots
      for (const snapshot of backup.indexedDB.comprehensionSnapshots) {
        const { id, ...data } = snapshot;

        if (options.conflictStrategy === 'skip') {
          const existing = await db.comprehensionSnapshots
            .where(['urlHash', 'timestamp'])
            .equals([data.urlHash, data.timestamp])
            .first();

          if (existing) {
            skipped.comprehensionSnapshots++;
            continue;
          }
        }

        await db.comprehensionSnapshots.add(data as ComprehensionSnapshot);
        imported.comprehensionSnapshots++;
      }
    });

    // Import storage (always replaces)
    await chrome.storage.local.set({
      [STORAGE_KEYS.config]: backup.storage.config,
      [STORAGE_KEYS.vocabulary]: backup.storage.vocabulary
    });

    // Clear caches to force reload
    vocabCache = null;
    configCache = null;

    return { success: true, imported, skipped };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      imported,
      skipped
    };
  }
}

/**
 * Compress data using gzip
 */
async function compressData(jsonString: string): Promise<string> {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(jsonString));
      controller.close();
    }
  });

  const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
  const chunks: Uint8Array[] = [];
  const reader = compressedStream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Combine chunks and convert to base64
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  // Convert to base64
  let binary = '';
  for (let i = 0; i < combined.length; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  return btoa(binary);
}

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handleAsync = async () => {
    switch (message.type) {

      case 'getVocabulary':
        const vocab = await getVocabulary();
        return {
          known: Array.from(vocab.known),
          ignored: Array.from(vocab.ignored),
          knowledgeLevels: Array.from(vocab.knowledgeLevels.entries()),
          lastSync: vocab.lastSync,
          totalCards: vocab.totalCards,
          sourceCounts: vocab.sourceCounts
        } as VocabDataSerialized;

      case 'syncVocabulary':
        try {
          await syncVocabulary();
          return { success: true };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : String(e) };
        }

      case 'getConfig':
        return getConfig();

      case 'setConfig':
        // Check if highlightsVisible is being changed
        if ('highlightsVisible' in message.config) {
          const oldConfig = await getConfig();
          const wasVisible = oldConfig.highlightsVisible !== false;
          const willBeVisible = message.config.highlightsVisible !== false;

          await setConfig(message.config);

          // Broadcast visibility change to all tabs if it changed
          if (wasVisible !== willBeVisible) {
            broadcastToTabs({
              type: 'setHighlightingEnabled',
              enabled: willBeVisible
            });
          }
        } else {
          await setConfig(message.config);
        }
        return { success: true };

      case 'reportStats':
        if (sender.tab?.id) {
          pageStats.set(sender.tab.id, message.stats);
        }
        return { success: true };

      case 'statsUpdated':
        // Intercept stats updates from content scripts, cache them, and rebroadcast with tabId
        if (sender.tab?.id && message.stats) {
          pageStats.set(sender.tab.id, message.stats);
          // Broadcast to extension pages (popup, sidepanel) with tabId
          chrome.runtime.sendMessage({
            type: 'statsUpdated',
            stats: message.stats,
            tabId: sender.tab.id,
            url: sender.tab.url
          }).catch(() => {
            // No listeners, that's fine
          });
        }
        return { success: true };

      case 'virtualStatsUpdated':
        // Relay virtual analysis stats to sidepanel with tabId
        if (sender.tab?.id && message.stats) {
          chrome.runtime.sendMessage({
            type: 'virtualStatsUpdated',
            stats: message.stats,
            tabId: sender.tab.id,
            url: sender.tab.url
          }).catch(() => {
            // No listeners, that's fine
          });
        }
        return { success: true };

      case 'storePageStats': {
        // Store static page stats (only if not already stored)
        const { urlHash, stats: pageStatsData } = message as {
          urlHash: number;
          stats: {
            characterCount: number;
            uniqueWordCount: number;
            uniqueKanjiCount: number;
            averageDifficulty: number;
            difficultyLabel: string;
          };
        };
        try {
          const existing = await db.pages.get(urlHash);
          if (existing && existing.characterCount === undefined) {
            // Page exists but doesn't have stats yet - update it
            await db.pages.update(urlHash, {
              characterCount: pageStatsData.characterCount,
              uniqueWordCount: pageStatsData.uniqueWordCount,
              uniqueKanjiCount: pageStatsData.uniqueKanjiCount,
              averageDifficulty: pageStatsData.averageDifficulty,
              difficultyLabel: pageStatsData.difficultyLabel
            });
            console.log('[Seer SW] ✓ Stored page stats for existing page');
          }
          return { success: true };
        } catch (error) {
          console.error('[Seer SW] ✗ Failed to store page stats:', error);
          return { success: false, error: String(error) };
        }
      }

      case 'getStats':
        return pageStats.get(message.tabId) || null;

      case 'getCachedStats':
        // Get cached stats for a specific tab
        return {
          stats: pageStats.get(message.tabId) || null,
          cached: pageStats.has(message.tabId)
        };

      case 'getPriorityQueue': {
        const vocabulary = await getVocabulary();
        const config = await getConfig();
        const limit = message.limit || 50;
        return await buildPriorityQueue(vocabulary.known, limit, config.ignoreList);
      }

      case 'getUnlockWords': {
        const vocabulary = await getVocabulary();
        return await getUnlockWords(message.url, message.targetComprehension || 85, vocabulary.known);
      }

      case 'getAnkiDecks':
        try {
          const config = await getConfig();
          const client = new AnkiClient(config.ankiConnectUrl, config.ankiConnectApiKey);
          return { decks: await client.getDeckNames() };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }

      case 'getAnkiModels':
        try {
          const config = await getConfig();
          const client = new AnkiClient(config.ankiConnectUrl, config.ankiConnectApiKey);
          return { models: await client.getModelNames() };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }

      case 'getAnkiFields':
        try {
          const config = await getConfig();
          const client = new AnkiClient(config.ankiConnectUrl, config.ankiConnectApiKey);
          if (message.modelName) {
            return { fields: await client.getModelFieldNames(message.modelName) };
          } else if (message.deckName) {
            return { fields: await client.getFieldsForDeck(message.deckName) };
          }
          return { error: 'Either modelName or deckName required' };
        } catch (e) {
          return { error: e instanceof Error ? e.message : String(e) };
        }

      case 'addIgnoredWord':
        try {
          const config = await getConfig();
          const client = new AnkiClient(
            config.ankiConnectUrl,
            config.ankiConnectApiKey,
            [config.ignoredSource.deckName, config.knownSource.deckName]  // Allow writes to both decks
          );
          const noteId = await client.addIgnoredWord(
            config.ignoredSource.deckName,
            'Seer Ignored Word',
            message.word
          );
          // Refresh vocabulary cache
          vocabCache = null;
          await syncVocabulary();
          return { success: true, noteId };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : String(e) };
        }

      case 'addKnownWord':
        try {
          const config = await getConfig();
          const client = new AnkiClient(
            config.ankiConnectUrl,
            config.ankiConnectApiKey,
            [config.ignoredSource.deckName, config.knownSource.deckName]  // Allow writes to both decks
          );
          const noteId = await client.addKnownWord(
            config.knownSource.deckName,
            'Seer Known Word',
            message.word
          );
          // Refresh vocabulary cache
          vocabCache = null;
          await syncVocabulary();
          return { success: true, noteId };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : String(e) };
        }

      case 'getVocabGrowthData':
        try {
          const config = await getConfig();
          const client = new AnkiClient(config.ankiConnectUrl, config.ankiConnectApiKey);

          // Build query for all known word source decks
          const queries = config.knownSources.map(s => `deck:"${s.deckName}"`);
          const query = queries.join(' OR ');

          // Find all cards in the configured decks
          const cardIds = await client.findCards(query);
          if (cardIds.length === 0) {
            return { success: true, data: [], totalCards: 0 };
          }

          // Card IDs in Anki ARE millisecond timestamps of when the card was created
          // This is more accurate than modTime which tracks last modification
          const creationTimes = cardIds.map(id => ({ cardId: id, created: id }));

          // Sort by creation time
          creationTimes.sort((a, b) => a.created - b.created);

          const buckets = new Map<string, number>();
          let cumulative = 0;
          for (const { created } of creationTimes) {
            // Card ID is milliseconds since epoch
            const date = new Date(created).toISOString().split('T')[0];
            cumulative++;
            buckets.set(date, cumulative);
          }

          return {
            success: true,
            data: Array.from(buckets.entries()),
            totalCards: cardIds.length
          };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : String(e) };
        }

      case 'toggleLayer': {
        const config = await getConfig();
        const layerId = message.layerId as string;
        if (config.highlightConfig.layers[layerId]) {
          config.highlightConfig.layers[layerId].enabled = message.enabled;
          await setConfig({ highlightConfig: config.highlightConfig });
          // Broadcast to all tabs
          broadcastToTabs({ type: 'toggleLayer', layerId, enabled: message.enabled });
        }
        return { success: true };
      }

      case 'updateLayerStyle': {
        const config = await getConfig();
        const layerId = message.layerId as string;
        if (config.highlightConfig.layers[layerId]) {
          Object.assign(config.highlightConfig.layers[layerId], message.config);
          await setConfig({ highlightConfig: config.highlightConfig });
          // Broadcast to all tabs
          broadcastToTabs({ type: 'updateLayerStyle', layerId, config: message.config });
        }
        return { success: true };
      }

      case 'getHighlightConfig': {
        const config = await getConfig();
        return config.highlightConfig;
      }

      // DoJG Story Prompt handlers
      case 'generateStoryPrompt': {
        try {
          const vocabulary = await getVocabulary();
          const seerConfig = await getConfig();
          const promptConfig: StoryPromptConfig = {
            ...DEFAULT_PROMPT_CONFIG,
            ...message.config,
          };

          // Fetch cards failed today from Anki if enabled
          let failedTodayWords: string[] = [];
          if (promptConfig.includeRecentlyWrong) {
            try {
              const client = new AnkiClient(seerConfig.ankiConnectUrl, seerConfig.ankiConnectApiKey);
              const deckNames = seerConfig.knownSources.map(s => s.deckName);
              const failedCardIds = await client.getCardsFailedRecently(promptConfig.recentlyWrongDays || 1, deckNames);

              if (failedCardIds.length > 0) {
                const cardsInfo = await client.getCardsInfo(failedCardIds);
                // Extract words from the configured field for each deck
                for (const card of cardsInfo) {
                  const source = seerConfig.knownSources.find(s => s.deckName === card.deckName);
                  const fieldName = source?.fieldName || Object.keys(card.fields)[0];
                  const fieldValue = card.fields[fieldName]?.value;
                  if (fieldValue) {
                    // Strip HTML and extract word
                    const word = fieldValue.replace(/<[^>]*>/g, '').trim().split(/\s+/)[0];
                    if (word && !failedTodayWords.includes(word)) {
                      failedTodayWords.push(word);
                    }
                  }
                }
              }
            } catch (e) {
              console.warn('[Seer] Failed to fetch failed cards from Anki:', e);
              // Continue without failed cards
            }
          }

          return await generateStoryPrompt(vocabulary, promptConfig, failedTodayWords);
        } catch (e) {
          console.error('[Seer] generateStoryPrompt error:', e);
          return {
            prompt: `Error generating prompt: ${e instanceof Error ? e.message : String(e)}`,
            wordCount: 0,
            grammarCount: 0,
            lapsedWords: [],
            unknownWords: [],
            grammar: [],
          };
        }
      }

      case 'getDoJGGrammarList': {
        const level = message.level;
        return getGrammarPoints(level ? [level] : undefined);
      }

      case 'searchDoJGGrammar': {
        const query = message.query as string;
        const limit = (message.limit as number) || 20;
        return searchGrammarPoints(query, limit);
      }

      case 'getKnownGrammar': {
        return await getKnownGrammarIds();
      }

      case 'setKnownGrammar': {
        await setKnownGrammarIds(message.grammarIds as string[]);
        return { success: true };
      }

      case 'toggleKnownGrammar': {
        const grammarId = message.grammarId as string;
        const known = message.known as boolean;
        if (known) {
          await addKnownGrammar(grammarId);
        } else {
          await removeKnownGrammar(grammarId);
        }
        return { success: true };
      }

      case 'getPromptTemplates': {
        return await getPromptTemplates();
      }

      case 'savePromptTemplate': {
        await savePromptTemplate(message.template as PromptTemplate);
        return { success: true };
      }

      case 'deletePromptTemplate': {
        try {
          await deletePromptTemplate(message.templateId as string);
          return { success: true };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }

      case 'setActiveTemplate': {
        try {
          await setActiveTemplate(message.templateId as string);
          return { success: true };
        } catch (e) {
          return { success: false, error: (e as Error).message };
        }
      }

      // New v2 query handlers
      case 'getEncounterStats': {
        const vocabulary = await getVocabulary();
        const config = await getConfig();
        // Note: frequency module uses ?raw imports which don't work in service workers
        // Pass empty map - frequency data will be undefined but that's acceptable
        const emptyFrequencyMap = new Map<string, number>();
        return await getTopEncounteredWords(
          vocabulary.known,
          vocabulary.ignored,
          emptyFrequencyMap,
          {
            timeRange: message.timeRange || 'all',
            sortBy: message.sortBy || 'count',
            minEncounters: message.minEncounters || 1,
            limit: message.limit || 300,
            minTimeMs: config.minPageTimeMs,
            ignoreList: config.ignoreList,
          }
        );
      }

      case 'getAllSentences': {
        const vocabulary = await getVocabulary();
        const config = await getConfig();
        return await getAllSentencesFiltered(
          vocabulary.known,
          {
            source: message.source || 'encountered',
            timeRange: message.timeRange || 'all',
            unknownCount: message.unknownCount,
            sortBy: message.sortBy || 'recent',
            search: message.search,
            limit: message.limit || 50,
            offset: message.offset || 0,
            minTimeMs: config.minPageTimeMs,
            ignoreList: config.ignoreList,
          }
        );
      }

      case 'searchSentences': {
        const config = await getConfig();
        const query = message.query || '';
        const timeRangeKey = message.timeRange || 'all';
        const offset = message.offset || 0;
        const limit = message.limit || 50;

        // Build time range from key
        const now = Date.now();
        let timeRange = { start: 0, end: now };
        if (timeRangeKey === 'today') {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          timeRange.start = today.getTime();
        } else if (timeRangeKey === 'week') {
          timeRange.start = now - 7 * 24 * 60 * 60 * 1000;
        } else if (timeRangeKey === 'month') {
          timeRange.start = now - 30 * 24 * 60 * 60 * 1000;
        }

        return await searchEncountersBySentence(
          query,
          timeRange,
          config.minPageTimeMs || 5000,
          config.ignoreList,
          offset,
          limit
        );
      }

      case 'getI1Summary': {
        const config = await getConfig();
        const minTimeMs = message.minTimeMs;
        return await getI1Summary(minTimeMs, config.ignoreList);
      }

      case 'getI1HighValueWords': {
        const config = await getConfig();
        const limit = message.limit || 20;
        const minTimeMs = message.minTimeMs;
        return await getI1HighValueWords(limit, minTimeMs, config.ignoreList);
      }

      case 'getAllI1Sentences': {
        const config = await getConfig();
        const limit = message.limit || 50;
        const minTimeMs = message.minTimeMs;
        return await getAllI1Sentences(limit, minTimeMs, config.ignoreList);
      }

      case 'getHighI1PotentialWords': {
        const vocabulary = await getVocabulary();
        const config = await getConfig();
        const limit = message.limit || 20;
        const minTimeMs = message.minTimeMs;
        return await getHighI1PotentialWords(vocabulary.known, limit, minTimeMs, config.ignoreList);
      }

      case 'getRecentPages': {
        const config = await getConfig();
        const limit = message.limit || 20;
        const minTimeMs = message.minTimeMs;
        return await getRecentPages(limit, minTimeMs, config.ignoreList);
      }

      case 'getSiteStats': {
        const config = await getConfig();
        const sortBy = message.sortBy || 'recent';
        const limit = message.limit || 100;
        const minTimeMs = message.minTimeMs || 5000;
        return await getSiteStats(sortBy, limit, minTimeMs, config.ignoreList);
      }

      case 'getWordEncounters': {
        const config = await getConfig();
        const word = message.word;
        const limit = message.limit || 50;
        const minTimeMs = message.minTimeMs || 5000;
        return await getWordEncounters(word, limit, minTimeMs, config.ignoreList);
      }

      case 'exportEncounters': {
        const config = await getConfig();
        const minTimeMs = message.minTimeMs;
        return await exportEncounters(minTimeMs, config.ignoreList);
      }

      case 'clearOldData': {
        const daysOld = message.daysOld || 90;
        return await clearOldData(daysOld);
      }

      case 'getDebugCounts': {
        return await getDebugCounts();
      }

      case 'getDatabaseSizes': {
        return await getDatabaseSizes();
      }

      case 'storeEncounters': {
        console.log('[Seer SW] Received storeEncounters:', message.encounters?.length, 'encounters,', message.sentences?.length, 'sentences');

        const { encounters, sentences } = message as {
          encounters: Array<{
            word: string;
            surface: string;
            reading: string;
            sentence: string;
            url: string;
            urlHash: number;
            pageTitle: string;
            contentId?: string;
            timestamp: number;
            frequency: number;
          }>;
          sentences: Sentence[];
        };

        try {
          const config = await getConfig();
          const dedupConfig = config.deduplication || { enabled: true, timeWindowHours: 4 };

          await db.transaction('rw', [db.encounters, db.sentences], async () => {
            if (encounters && encounters.length > 0) {
              let encounterRecords: Omit<Encounter, 'id'>[] = encounters.map(e => ({
                word: e.word,
                surface: e.surface,
                sentence: e.sentence,
                url: e.url,
                urlHash: e.urlHash,
                pageTitle: e.pageTitle,
                contentId: e.contentId,
                timestamp: e.timestamp,
                frequency: e.frequency
              }));

              // Time-window deduplication: filter out encounters that already exist within the window
              // Uses word+urlHash+sentenceHash to allow new sentences while blocking duplicates
              if (dedupConfig.enabled && encounterRecords.length > 0) {
                const windowMs = dedupConfig.timeWindowHours * 60 * 60 * 1000;
                const minTimestamp = Math.min(...encounterRecords.map(e => e.timestamp)) - windowMs;

                // Get unique word+urlHash combinations from incoming batch
                const keysToCheck = new Map<string, { word: string; urlHash: number }>();
                for (const e of encounterRecords) {
                  const key = `${e.word}:${e.urlHash}`;
                  if (!keysToCheck.has(key)) {
                    keysToCheck.set(key, { word: e.word, urlHash: e.urlHash });
                  }
                }

                // Batch query for existing recent encounters and build a Set of word:urlHash:sentenceHash
                const existingSet = new Set<string>();
                for (const { word, urlHash } of keysToCheck.values()) {
                  const existingEncounters = await db.encounters
                    .where('[word+urlHash]')
                    .equals([word, urlHash])
                    .and(enc => enc.timestamp >= minTimestamp)
                    .toArray();

                  for (const enc of existingEncounters) {
                    // Create a unique key including the sentence content
                    const sentenceHash = fnv1a(enc.sentence);
                    existingSet.add(`${enc.word}:${enc.urlHash}:${sentenceHash}`);
                  }
                }

                // Filter out duplicates - only skip if same word+url+sentence exists
                const originalCount = encounterRecords.length;
                encounterRecords = encounterRecords.filter(e => {
                  const sentenceHash = fnv1a(e.sentence);
                  const key = `${e.word}:${e.urlHash}:${sentenceHash}`;
                  return !existingSet.has(key);
                });

                const skipped = originalCount - encounterRecords.length;
                if (skipped > 0) {
                  console.log(`[Seer SW] Dedup: skipped ${skipped}/${originalCount} duplicate encounters`);
                }
              }

              if (encounterRecords.length > 0) {
                await db.encounters.bulkAdd(encounterRecords);
                console.log('[Seer SW] ✓ Stored', encounterRecords.length, 'encounters to IndexedDB');
              }
            }

            if (sentences && sentences.length > 0) {
              await db.sentences.bulkPut(sentences);
              console.log('[Seer SW] ✓ Stored', sentences.length, 'sentences to IndexedDB');
            }
          });

          return { success: true };
        } catch (error) {
          console.error('[Seer SW] ✗ Failed to store encounters:', error);
          return { success: false, error: String(error) };
        }
      }

      case 'storePageTime': {
        console.log('[Seer SW] Received storePageTime:', message.pageVisit?.timeSpent, 'ms');

        const { pageVisit } = message as {
          pageVisit: {
            urlHash: number;
            url: string;
            pageTitle: string;
            timeSpent: number;
          };
        };

        try {
          const now = Date.now();
          const existing = await db.pages.get(pageVisit.urlHash);

          if (existing) {
            await db.pages.update(pageVisit.urlHash, {
              totalTimeMs: existing.totalTimeMs + pageVisit.timeSpent,
              lastSeen: now,
              visits: existing.visits + 1,
              title: pageVisit.pageTitle || existing.title
            });
            console.log('[Seer SW] ✓ Updated page time, total now:', existing.totalTimeMs + pageVisit.timeSpent, 'ms');
          } else {
            await db.pages.put({
              urlHash: pageVisit.urlHash,
              url: pageVisit.url,
              title: pageVisit.pageTitle,
              firstSeen: now,
              lastSeen: now,
              totalTimeMs: pageVisit.timeSpent,
              visits: 1
            });
            console.log('[Seer SW] ✓ Created new page record');
          }

          return { success: true };
        } catch (error) {
          console.error('[Seer SW] ✗ Failed to store page time:', error);
          return { success: false, error: String(error) };
        }
      }

      case 'clearDatabase': {
        try {
          await db.clearAll();
          return { success: true, message: 'Database cleared' };
        } catch (error) {
          console.error('[Seer SW] ✗ Failed to clear database:', error);
          return { success: false, error: String(error) };
        }
      }

      case 'contentChanged': {
        // Store or update content label for SPA tracking
        const { urlHash, contentId, label, source } = message as {
          urlHash: number;
          contentId: string;
          label: string;
          source: 'history' | 'title' | 'manual';
        };

        try {
          const now = Date.now();

          // Check if this content label already exists
          const existing = await db.contentLabels
            .where('[urlHash+contentId]')
            .equals([urlHash, contentId])
            .first();

          if (existing) {
            // Update lastSeen and potentially label
            await db.contentLabels.update(existing.id!, {
              lastSeen: now,
              label,
              source
            });
            console.log('[Seer SW] ✓ Updated content label:', label);
          } else {
            // Create new content label
            await db.contentLabels.add({
              urlHash,
              contentId,
              label,
              source,
              firstSeen: now,
              lastSeen: now
            });
            console.log('[Seer SW] ✓ Created new content label:', label);
          }

          return { success: true };
        } catch (error) {
          console.error('[Seer SW] ✗ Failed to store content label:', error);
          return { success: false, error: String(error) };
        }
      }

      // Comprehension snapshot handlers
      case 'createComprehensionSnapshot': {
        const vocabulary = await getVocabulary();
        const snapshot = await createComprehensionSnapshot(
          message.urlHash,
          vocabulary.known,
          'visit',
          vocabulary.knowledgeLevels
        );
        return { success: !!snapshot, snapshot };
      }

      case 'getImprovedPages': {
        const config = await getConfig();
        const options = { ...message.options, ignoreList: config.ignoreList };
        return await getImprovedPages(options);
      }

      case 'recalculateComprehension': {
        const vocabulary = await getVocabulary();
        const config = await getConfig();
        return await recalculateAllPages(vocabulary.known, message.minTimeMs, config.ignoreList, vocabulary.knowledgeLevels);
      }

      case 'getPageComprehensionHistory': {
        return await getPageComprehensionHistory(message.urlHash);
      }

      case 'getComprehensionSummary': {
        const config = await getConfig();
        return await getComprehensionSummary(config.ignoreList);
      }

      case 'addToIgnoreList': {
        const config = await getConfig();
        const ignoreType = message.ignoreType as 'domain' | 'url';
        const value = message.value as string;

        if (!config.ignoreList) {
          config.ignoreList = { domains: [], urls: [] };
        }

        if (ignoreType === 'domain') {
          if (!config.ignoreList.domains.includes(value)) {
            config.ignoreList.domains.push(value);
          }
        } else {
          if (!config.ignoreList.urls.includes(value)) {
            config.ignoreList.urls.push(value);
          }
        }

        await setConfig({ ignoreList: config.ignoreList });
        return { success: true };
      }

      case 'removeFromIgnoreList': {
        const config = await getConfig();
        const ignoreType = message.ignoreType as 'domain' | 'url';
        const value = message.value as string;

        if (!config.ignoreList) {
          return { success: true };
        }

        if (ignoreType === 'domain') {
          config.ignoreList.domains = config.ignoreList.domains.filter(d => d !== value);
        } else {
          config.ignoreList.urls = config.ignoreList.urls.filter(u => u !== value);
        }

        await setConfig({ ignoreList: config.ignoreList });
        return { success: true };
      }

      case 'isPageIgnored': {
        const config = await getConfig();
        const url = message.url as string;

        if (!config.ignoreList) {
          return { ignored: false };
        }

        try {
          const urlObj = new URL(url);
          const domain = urlObj.hostname;

          // Check domain ignore (includes subdomains)
          for (const ignoredDomain of config.ignoreList.domains) {
            if (domain === ignoredDomain || domain.endsWith('.' + ignoredDomain)) {
              return { ignored: true, reason: 'domain' as const };
            }
          }

          // Check URL ignore (prefix match)
          for (const ignoredUrl of config.ignoreList.urls) {
            if (url === ignoredUrl || url.startsWith(ignoredUrl)) {
              return { ignored: true, reason: 'url' as const };
            }
          }
        } catch (e) {
          // Invalid URL, don't ignore
        }

        return { ignored: false };
      }

      // ============================================
      // CONTENT LIBRARY
      // ============================================

      case 'importLibraryContent': {
        try {
          const source = await importContent({
            title: message.title,
            sourceType: message.sourceType,
            sourceRef: message.sourceRef,
            text: message.text
          });

          // Auto-analyze with current vocabulary
          const vocabulary = await getVocabulary();
          await analyzeSource(source.id, vocabulary);

          return { success: true, source };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      }

      case 'getLibrarySources': {
        return await getLibrarySources(message.opts || {});
      }

      case 'getLibrarySource': {
        return await getLibrarySource(message.sourceId);
      }

      case 'getLibraryI1Sentences': {
        const vocabulary = await getVocabulary();
        return await getI1Sentences({
          sourceId: message.sourceId,
          vocab: vocabulary,
          limit: message.limit || 50,
          offset: message.offset || 0
        });
      }

      case 'getLibraryStats': {
        return await getLibraryStats();
      }

      case 'searchLibrarySentences': {
        return await searchLibrarySentences({
          query: message.query,
          limit: message.limit || 50,
          offset: message.offset || 0
        });
      }

      case 'updateLibrarySource': {
        return await updateLibrarySource(message.sourceId, message.updates);
      }

      case 'deleteLibrarySource': {
        await deleteLibrarySource(message.sourceId);
        return { success: true };
      }

      case 'recalculateLibrary': {
        const vocabulary = await getVocabulary();
        return await recalculateAllSources(vocabulary);
      }

      case 'recalculateLibrarySource': {
        const vocabulary = await getVocabulary();
        const source = await analyzeSource(message.sourceId, vocabulary);
        return { success: !!source, source };
      }

      case 'bulkImportLibrary': {
        // For importing CLI-generated JSON files
        // Expects: { entries: Array<{ id, title, sourceType, sourceRef, sentences }> }
        // NOTE: Does NOT auto-recalculate - call recalculateLibrary separately after all imports
        try {
          const entries = message.entries as Array<{
            id: string;
            title: string;
            sourceType: string;
            sourceRef?: string;
            sentences: Array<{ text: string; words: string[] }>;
          }>;

          let imported = 0;
          let skipped = 0;
          let totalSentences = 0;

          for (const entry of entries) {
            const result = await bulkImportSentences({
              sourceId: entry.id,
              title: entry.title,
              sourceType: entry.sourceType as any,
              sourceRef: entry.sourceRef,
              sentences: entry.sentences
            });

            if (result) {
              imported++;
              totalSentences += entry.sentences.length;
            } else {
              skipped++;
            }
          }

          // Skip auto-recalc - too slow for batch imports
          // User can click "Recalculate All" when done

          return { success: true, imported, skipped, totalSentences };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      }

      case 'clearLibrary': {
        try {
          await db.clearLibrary();
          return { success: true };
        } catch (error) {
          return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
      }

      // Backup & Restore handlers
      case 'exportBackup': {
        try {
          const backup = await createBackup();
          const jsonString = JSON.stringify(backup, null, 2);
          const dateStr = new Date().toISOString().split('T')[0];

          if (message.compress) {
            const base64 = await compressData(jsonString);
            return {
              success: true,
              data: base64,
              compressed: true,
              filename: `seer-backup-${dateStr}.seer.gz`
            } as ExportResult;
          }

          return {
            success: true,
            data: jsonString,
            compressed: false,
            filename: `seer-backup-${dateStr}.seer`
          } as ExportResult;
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
          } as ExportResult;
        }
      }

      case 'validateBackup': {
        return await validateBackup(message.data);
      }

      case 'importBackup': {
        return await importBackup(message.backup, message.options);
      }

      default:
        return { error: 'Unknown message type' };
    }
  };

  handleAsync()
    .then(sendResponse)
    .catch(e => sendResponse({ error: e.message }));

  return true; // Keep channel open
});

// Auto-sync on startup
chrome.runtime.onInstalled.addListener(async () => {
  logger.background.info('Seer installed/updated');

  // Set up periodic sync alarm using config interval
  const config = await getConfig();
  chrome.alarms.create('vocab-sync', { periodInMinutes: config.syncIntervalMinutes });

  // Set up daily comprehension recalculation alarm
  chrome.alarms.create('comprehension-recalc', { periodInMinutes: 1440 }); // Daily

  // Try initial sync (non-blocking - extension works without Anki)
  try {
    await syncVocabulary();
    logger.sync.info('Vocabulary synced from Anki');
  } catch (e) {
    logger.sync.warn('Could not connect to Anki. Extension will work but all words will be marked as unknown.');
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'vocab-sync') {
    try {
      await syncVocabulary();
      logger.sync.debug('Vocabulary synced (automatic)');
    } catch (e) {
      logger.sync.debug('Automatic sync skipped (Anki not running)');
    }
  }

  if (alarm.name === 'comprehension-recalc') {
    try {
      const vocabulary = await getVocabulary();
      const config = await getConfig();
      const result = await recalculateAllPages(vocabulary.known, undefined, config.ignoreList, vocabulary.knowledgeLevels);
      logger.stats.info(`Daily comprehension recalc: ${result.pagesRecalculated} pages, ${result.snapshotsCreated} snapshots`);
    } catch (e) {
      logger.stats.error('Comprehension recalculation failed:', e);
    }
  }
});

// Note: Pre-analysis feature removed - speculation rules still work for prefetching
// but the analysis wasn't being used. Can be re-implemented with full tokenization later.

// Layer IDs by category for mode cycling
const LAYER_CATEGORIES = {
  frequency: ['freq-very-common', 'freq-common', 'freq-medium', 'freq-uncommon', 'freq-rare'],
  status: ['status-unknown', 'status-known', 'status-ignored'],
  knowledge: ['knowledge-new', 'knowledge-learning', 'knowledge-young', 'knowledge-mature']
} as const;

type HighlightMode = 'frequency' | 'status' | 'knowledge';
const HIGHLIGHT_MODES: HighlightMode[] = ['frequency', 'status', 'knowledge'];
const MODE_LABELS: Record<HighlightMode, string> = {
  frequency: 'Frequency',
  status: 'Status',
  knowledge: 'Knowledge'
};

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  logger.background.info(`Keyboard command received: ${command}`);

  switch (command) {
    case 'toggle-highlighting': {
      // Toggle visibility of highlights (not processing)
      const config = await getConfig();
      const newVisible = config.highlightsVisible !== false ? false : true;
      await setConfig({ highlightsVisible: newVisible });

      logger.background.info(`Toggling highlights: ${newVisible ? 'visible' : 'hidden'}`);

      // Broadcast the visibility change to all tabs
      broadcastToTabs({
        type: 'setHighlightingEnabled',
        enabled: newVisible
      });

      // Also show toast feedback
      broadcastToTabs({
        type: 'showToast',
        text: `Highlights ${newVisible ? 'visible' : 'hidden'}`
      });
      break;
    }

    case 'open-sidepanel': {
      // Open the side panel in the current window
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.windowId) {
        try {
          await chrome.sidePanel.open({ windowId: tab.windowId });
          broadcastToTabs({
            type: 'showToast',
            text: 'Side panel opened'
          });
        } catch (e) {
          logger.background.error('Failed to open side panel:', e);
        }
      }
      break;
    }

    case 'cycle-highlight-mode': {
      // Cycle through highlight modes: Frequency -> Status -> Knowledge -> Frequency
      const config = await getConfig();
      const highlightConfig = config.highlightConfig;

      // Determine current mode by checking which category has enabled layers
      let currentModeIndex = 0;
      for (let i = 0; i < HIGHLIGHT_MODES.length; i++) {
        const mode = HIGHLIGHT_MODES[i];
        const hasEnabled = LAYER_CATEGORIES[mode].some(id => highlightConfig.layers[id]?.enabled);
        if (hasEnabled) {
          currentModeIndex = i;
          break;
        }
      }

      // Cycle to next mode
      const nextModeIndex = (currentModeIndex + 1) % HIGHLIGHT_MODES.length;
      const nextMode = HIGHLIGHT_MODES[nextModeIndex];

      // Update all layer states: enable next mode's layers, disable others
      for (const [category, layerIds] of Object.entries(LAYER_CATEGORIES)) {
        const shouldEnable = category === nextMode;
        for (const layerId of layerIds) {
          if (highlightConfig.layers[layerId]) {
            highlightConfig.layers[layerId].enabled = shouldEnable;
          }
        }
      }

      // Save updated config
      await setConfig({ highlightConfig });

      // Broadcast layer changes to all tabs
      broadcastToTabs({
        type: 'updateHighlightConfig',
        config: highlightConfig
      });

      // Show feedback
      broadcastToTabs({
        type: 'showToast',
        text: `Mode: ${MODE_LABELS[nextMode]}`
      });

      logger.background.info(`Cycled to highlight mode: ${nextMode}`);
      break;
    }
  }
});

// SPA Navigation Detection
// Listen for history.pushState/replaceState in tabs and notify content scripts
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  // Only handle main frame navigations
  if (details.frameId !== 0) return;

  logger.background.info(`SPA navigation detected: ${details.url}`);

  // Notify the content script that the URL changed
  chrome.tabs.sendMessage(details.tabId, {
    type: 'spaNavigation',
    url: details.url
  }).catch(() => {
    // Content script might not be loaded, that's fine
  });
});
