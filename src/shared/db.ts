import Dexie, { Table } from 'dexie';
import type { KnowledgeLevelBreakdown, DifficultyLabel, LibrarySource, LibrarySentence } from './types';

/**
 * Encounter - every word seen on every page
 */
export interface Encounter {
  id?: number;             // Auto-increment primary key

  // Word
  word: string;            // Base/dictionary form
  surface: string;         // Actual form seen (conjugated)

  // Context
  sentence: string;        // Surrounding sentence (max 300 chars)

  // Source - FULL URL
  url: string;             // Complete URL
  urlHash: number;         // FNV-1a hash for fast lookups
  pageTitle: string;       // Human-readable title

  // SPA content tracking
  contentId?: string;      // FNV-1a hash of content label (for SPAs)

  // Time
  timestamp: number;       // When seen

  // Metadata
  frequency: number;       // JPDB rank (lower = more common)
}

/**
 * Page - time tracking per URL
 */
export interface Page {
  urlHash: number;         // Primary key - FNV-1a hash of FULL URL
  url: string;             // Complete URL
  title: string;           // Page title

  firstSeen: number;       // First visit timestamp
  lastSeen: number;        // Most recent visit
  totalTimeMs: number;     // Cumulative time spent
  visits: number;          // Number of visits

  // Static page stats (set once on first full scan, don't change)
  characterCount?: number;       // Japanese characters on page
  uniqueWordCount?: number;      // Unique words
  uniqueKanjiCount?: number;     // Unique kanji characters
  averageDifficulty?: number;    // Composite difficulty score 0-100
  difficultyLabel?: DifficultyLabel;  // Easy/Moderate/Hard/Very Hard
}

/**
 * Sentence - for i+1 mining
 */
export interface Sentence {
  hash: number;            // Primary key - hash of sentence text
  text: string;            // The sentence
  url: string;             // Where found
  urlHash: number;         // For joining with pages
  unknownWords: string[];  // List of unknown words in sentence
  unknownCount: number;    // How many unknowns (1 = perfect i+1)
  timestamp: number;       // When first seen
}

/**
 * ComprehensionSnapshot - page-level comprehension at a point in time
 */
export interface ComprehensionSnapshot {
  id?: number;                                  // Auto-increment PK
  urlHash: number;                              // Foreign key to pages table
  timestamp: number;                            // When snapshot was taken
  comprehensionPercent: number;                 // 0-100
  unknownWords: string[];                       // Unknown words at snapshot time
  totalWords: number;                           // Total unique words on page
  knownCount: number;                           // Known word count
  source: 'visit' | 'recalc';                   // Origin of snapshot
  knowledgeBreakdown?: KnowledgeLevelBreakdown; // Optional breakdown by knowledge level
}

/**
 * ContentLabel - tracks distinct content within SPAs
 * When a SPA changes content (via pushState or title change),
 * we create a label to group encounters by content rather than just URL
 */
export interface ContentLabel {
  id?: number;                        // Auto-increment PK
  urlHash: number;                    // Base page URL hash (links to pages table)
  contentId: string;                  // Unique content identifier (hash of label)
  label: string;                      // Human-readable label (from title or manual)
  source: 'history' | 'title' | 'manual';  // How this label was detected
  firstSeen: number;                  // When first encountered
  lastSeen: number;                   // Most recent encounter
}

/**
 * Seer IndexedDB Database v4
 * v2: Added [word+urlHash] composite index for deduplication queries
 * v3: Added contentLabels table and contentId index for SPA tracking
 * v4: Added librarySources and librarySentences tables for content library
 */
export class SeerDB extends Dexie {
  encounters!: Table<Encounter, number>;
  pages!: Table<Page, number>;
  sentences!: Table<Sentence, number>;
  comprehensionSnapshots!: Table<ComprehensionSnapshot, number>;
  contentLabels!: Table<ContentLabel, number>;
  librarySources!: Table<LibrarySource, string>;
  librarySentences!: Table<LibrarySentence, number>;

  constructor() {
    super('SeerDB');

    this.version(4).stores({
      encounters: '++id, word, timestamp, urlHash, [word+timestamp], [word+urlHash], contentId',
      pages: 'urlHash, totalTimeMs, lastSeen',
      sentences: 'hash, unknownCount, urlHash',
      comprehensionSnapshots: '++id, urlHash, timestamp, comprehensionPercent, source',
      contentLabels: '++id, urlHash, contentId, [urlHash+contentId]',
      // Content Library tables
      librarySources: 'id, sourceType, status, comprehensionPercent, addedAt',
      librarySentences: '++id, sourceId'
    });
  }

  /**
   * Clear all data - for testing
   */
  async clearAll(): Promise<void> {
    await this.encounters.clear();
    await this.pages.clear();
    await this.sentences.clear();
    await this.comprehensionSnapshots.clear();
    await this.contentLabels.clear();
    await this.librarySources.clear();
    await this.librarySentences.clear();
    console.log('[SeerDB] All data cleared');
  }

  /**
   * Clear only library data
   */
  async clearLibrary(): Promise<void> {
    await this.librarySources.clear();
    await this.librarySentences.clear();
    console.log('[SeerDB] Library data cleared');
  }
}

export const db = new SeerDB();
