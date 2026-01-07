import { db, ComprehensionSnapshot, Page } from '../shared/db';
import { PAGE_TIME_MIN_THRESHOLD_MS, isUrlIgnored } from '../shared/config';
import type { IgnoreList, KnowledgeLevelBreakdown, WordKnowledge, DifficultyLabel } from '../shared/types';
import { logger } from '../shared/logger';

/**
 * Comprehension Service
 *
 * Manages page-level comprehension snapshots for tracking reading progress over time.
 * Snapshots are created when leaving a page and periodically recalculated.
 */

export interface PageImprovement {
  urlHash: number;
  url: string;
  title: string;
  firstComprehension: number;
  latestComprehension: number;
  improvementPercent: number;
  firstSnapshotDate: number;
  latestSnapshotDate: number;
  totalTimeSpentMs: number;
  visits: number;
  // Static page stats (if available)
  difficultyLabel?: DifficultyLabel;
  averageDifficulty?: number;
  characterCount?: number;
  uniqueWordCount?: number;
  uniqueKanjiCount?: number;
}

export interface ImprovedPagesOptions {
  minImprovement?: number;      // Default: 5%
  dateRangeStart?: number;
  dateRangeEnd?: number;
  minTimeSpent?: number;        // Default: PAGE_TIME_MIN_THRESHOLD_MS
  limit?: number;               // Default: 50
  sortBy?: 'improvement' | 'recent' | 'timeSpent';
  ignoreList?: IgnoreList;      // Filter out ignored URLs
}

export interface RecalculationResult {
  pagesRecalculated: number;
  snapshotsCreated: number;
  timestamp: number;
}

/**
 * Calculate comprehension for a specific page
 */
async function calculatePageComprehension(
  urlHash: number,
  knownWords: Set<string>,
  knowledgeLevels?: Map<string, WordKnowledge>
): Promise<{
  comprehensionPercent: number;
  unknownWords: string[];
  totalWords: number;
  knownCount: number;
  knowledgeBreakdown?: KnowledgeLevelBreakdown;
}> {
  const encounters = await db.encounters
    .where('urlHash')
    .equals(urlHash)
    .toArray();

  if (encounters.length === 0) {
    return { comprehensionPercent: 0, unknownWords: [], totalWords: 0, knownCount: 0 };
  }

  // Count known vs unknown using unique words
  const uniqueWords = new Map<string, number>();
  for (const e of encounters) {
    uniqueWords.set(e.word, (uniqueWords.get(e.word) || 0) + 1);
  }

  let knownCount = 0;
  const unknownSet = new Set<string>();

  // Knowledge level counts
  let matureCount = 0;
  let youngCount = 0;
  let learningCount = 0;
  let newCount = 0;
  let trueUnknownCount = 0;

  for (const [word] of uniqueWords) {
    if (knownWords.has(word)) {
      knownCount++;

      // Get knowledge level if available
      if (knowledgeLevels) {
        const knowledge = knowledgeLevels.get(word);
        if (knowledge) {
          switch (knowledge.level) {
            case 'mature': matureCount++; break;
            case 'young': youngCount++; break;
            case 'learning': learningCount++; break;
            case 'new': newCount++; break;
          }
        } else {
          // In known set but no knowledge level - count as mature (assume legacy)
          matureCount++;
        }
      }
    } else {
      unknownSet.add(word);
      // Check if it's "new" in Anki (not reviewed) vs truly unknown
      if (knowledgeLevels) {
        const knowledge = knowledgeLevels.get(word);
        if (knowledge && knowledge.level === 'new') {
          newCount++;
        } else {
          trueUnknownCount++;
        }
      } else {
        trueUnknownCount++;
      }
    }
  }

  const totalUniqueWords = uniqueWords.size;
  const comprehensionPercent = totalUniqueWords > 0
    ? Math.round((knownCount / totalUniqueWords) * 100)
    : 0;

  // Calculate breakdown percentages
  let knowledgeBreakdown: KnowledgeLevelBreakdown | undefined;
  if (knowledgeLevels && totalUniqueWords > 0) {
    knowledgeBreakdown = {
      mature: Math.round((matureCount / totalUniqueWords) * 100),
      young: Math.round((youngCount / totalUniqueWords) * 100),
      learning: Math.round((learningCount / totalUniqueWords) * 100),
      new: Math.round((newCount / totalUniqueWords) * 100),
      unknown: Math.round((trueUnknownCount / totalUniqueWords) * 100)
    };
  }

  return {
    comprehensionPercent,
    unknownWords: Array.from(unknownSet),
    totalWords: totalUniqueWords,
    knownCount,
    knowledgeBreakdown
  };
}

/**
 * Create a comprehension snapshot for a page
 */
export async function createComprehensionSnapshot(
  urlHash: number,
  knownWords: Set<string>,
  source: 'visit' | 'recalc' = 'visit',
  knowledgeLevels?: Map<string, WordKnowledge>
): Promise<ComprehensionSnapshot | null> {
  try {
    const stats = await calculatePageComprehension(urlHash, knownWords, knowledgeLevels);

    // Don't create snapshot if no words on page
    if (stats.totalWords === 0) {
      return null;
    }

    const snapshot: ComprehensionSnapshot = {
      urlHash,
      timestamp: Date.now(),
      comprehensionPercent: stats.comprehensionPercent,
      unknownWords: stats.unknownWords,
      totalWords: stats.totalWords,
      knownCount: stats.knownCount,
      source,
      knowledgeBreakdown: stats.knowledgeBreakdown
    };

    const id = await db.comprehensionSnapshots.add(snapshot);
    snapshot.id = id;

    logger.stats.debug(`Created snapshot for ${urlHash}: ${stats.comprehensionPercent}% (${source})`);

    return snapshot;
  } catch (error) {
    logger.stats.error('Failed to create comprehension snapshot:', error);
    return null;
  }
}

/**
 * Get pages that have improved in comprehension
 */
export async function getImprovedPages(
  options: ImprovedPagesOptions = {}
): Promise<PageImprovement[]> {
  const {
    minImprovement = 5,
    dateRangeStart = 0,
    dateRangeEnd = Date.now(),
    minTimeSpent = PAGE_TIME_MIN_THRESHOLD_MS,
    limit = 50,
    sortBy = 'improvement',
    ignoreList
  } = options;

  // Get all valid pages (with sufficient time)
  let pages = await db.pages
    .where('totalTimeMs')
    .aboveOrEqual(minTimeSpent)
    .toArray();

  // Filter out ignored URLs
  if (ignoreList && (ignoreList.domains.length > 0 || ignoreList.urls.length > 0)) {
    pages = pages.filter(p => !isUrlIgnored(p.url, ignoreList));
  }

  const improvements: PageImprovement[] = [];

  // For each page, get first and latest snapshots
  for (const page of pages) {
    const snapshots = await db.comprehensionSnapshots
      .where('urlHash')
      .equals(page.urlHash)
      .sortBy('timestamp');

    if (snapshots.length === 0) continue; // Need at least 1 snapshot

    const first = snapshots[0];
    const latest = snapshots[snapshots.length - 1];

    // Apply date range filter
    if (first.timestamp < dateRangeStart || first.timestamp > dateRangeEnd) continue;

    const improvement = snapshots.length >= 2
      ? latest.comprehensionPercent - first.comprehensionPercent
      : 0; // Single snapshot = no improvement measurable yet

    if (improvement >= minImprovement) {
      improvements.push({
        urlHash: page.urlHash,
        url: page.url,
        title: page.title,
        firstComprehension: first.comprehensionPercent,
        latestComprehension: latest.comprehensionPercent,
        improvementPercent: improvement,
        firstSnapshotDate: first.timestamp,
        latestSnapshotDate: latest.timestamp,
        totalTimeSpentMs: page.totalTimeMs,
        visits: page.visits,
        // Static page stats (if available)
        difficultyLabel: page.difficultyLabel,
        averageDifficulty: page.averageDifficulty,
        characterCount: page.characterCount,
        uniqueWordCount: page.uniqueWordCount,
        uniqueKanjiCount: page.uniqueKanjiCount
      });
    }
  }

  // Sort by requested criterion
  switch (sortBy) {
    case 'improvement':
      improvements.sort((a, b) => b.improvementPercent - a.improvementPercent);
      break;
    case 'recent':
      improvements.sort((a, b) => b.latestSnapshotDate - a.latestSnapshotDate);
      break;
    case 'timeSpent':
      improvements.sort((a, b) => b.totalTimeSpentMs - a.totalTimeSpentMs);
      break;
  }

  return improvements.slice(0, limit);
}

/**
 * Recalculate comprehension for all pages
 */
export async function recalculateAllPages(
  knownWords: Set<string>,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList,
  knowledgeLevels?: Map<string, WordKnowledge>
): Promise<RecalculationResult> {
  let pages = await db.pages
    .where('totalTimeMs')
    .aboveOrEqual(minTimeMs)
    .toArray();

  // Filter out ignored URLs
  if (ignoreList && (ignoreList.domains.length > 0 || ignoreList.urls.length > 0)) {
    pages = pages.filter(p => !isUrlIgnored(p.url, ignoreList));
  }

  let snapshotsCreated = 0;

  for (const page of pages) {
    const snapshot = await createComprehensionSnapshot(page.urlHash, knownWords, 'recalc', knowledgeLevels);
    if (snapshot) {
      snapshotsCreated++;
    }
  }

  logger.stats.info(`Recalculated ${pages.length} pages, created ${snapshotsCreated} snapshots`);

  return {
    pagesRecalculated: pages.length,
    snapshotsCreated,
    timestamp: Date.now()
  };
}

/**
 * Get comprehension history for a specific page
 */
export async function getPageComprehensionHistory(
  urlHash: number
): Promise<ComprehensionSnapshot[]> {
  return db.comprehensionSnapshots
    .where('urlHash')
    .equals(urlHash)
    .sortBy('timestamp');
}

/**
 * Get all pages with their current comprehension (for browsing)
 */
export async function getAllPagesWithComprehension(
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  limit: number = 100,
  ignoreList?: IgnoreList
): Promise<Array<{
  page: Page;
  latestSnapshot: ComprehensionSnapshot | null;
  snapshotCount: number;
}>> {
  let pages = await db.pages
    .where('totalTimeMs')
    .aboveOrEqual(minTimeMs)
    .reverse()
    .sortBy('lastSeen');

  // Filter out ignored URLs
  if (ignoreList && (ignoreList.domains.length > 0 || ignoreList.urls.length > 0)) {
    pages = pages.filter(p => !isUrlIgnored(p.url, ignoreList));
  }

  const limitedPages = pages.slice(0, limit);

  const results = await Promise.all(
    limitedPages.map(async (page) => {
      const snapshots = await db.comprehensionSnapshots
        .where('urlHash')
        .equals(page.urlHash)
        .reverse()
        .sortBy('timestamp');

      return {
        page,
        latestSnapshot: snapshots.length > 0 ? snapshots[0] : null,
        snapshotCount: snapshots.length
      };
    })
  );

  return results;
}

/**
 * Get summary statistics for comprehension tracking
 */
export async function getComprehensionSummary(ignoreList?: IgnoreList): Promise<{
  totalSnapshots: number;
  pagesWithSnapshots: number;
  averageImprovement: number;
  pagesImproved: number;
}> {
  const allSnapshots = await db.comprehensionSnapshots.toArray();

  // Get valid page hashes (excluding ignored URLs)
  let validUrlHashes: Set<number> | null = null;
  if (ignoreList && (ignoreList.domains.length > 0 || ignoreList.urls.length > 0)) {
    const pages = await db.pages.toArray();
    const validPages = pages.filter(p => !isUrlIgnored(p.url, ignoreList));
    validUrlHashes = new Set(validPages.map(p => p.urlHash));
  }

  // Group by urlHash, filtering ignored URLs
  const byUrl = new Map<number, ComprehensionSnapshot[]>();
  for (const s of allSnapshots) {
    // Skip if URL is ignored
    if (validUrlHashes && !validUrlHashes.has(s.urlHash)) continue;

    const existing = byUrl.get(s.urlHash) || [];
    existing.push(s);
    byUrl.set(s.urlHash, existing);
  }

  let totalImprovement = 0;
  let pagesImproved = 0;
  let totalFilteredSnapshots = 0;

  for (const [, snapshots] of byUrl) {
    totalFilteredSnapshots += snapshots.length;

    if (snapshots.length >= 2) {
      snapshots.sort((a, b) => a.timestamp - b.timestamp);
      const first = snapshots[0];
      const latest = snapshots[snapshots.length - 1];
      const improvement = latest.comprehensionPercent - first.comprehensionPercent;

      if (improvement > 0) {
        totalImprovement += improvement;
        pagesImproved++;
      }
    }
  }

  return {
    totalSnapshots: totalFilteredSnapshots,
    pagesWithSnapshots: byUrl.size,
    averageImprovement: pagesImproved > 0 ? Math.round(totalImprovement / pagesImproved) : 0,
    pagesImproved
  };
}
