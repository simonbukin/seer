import { db, Encounter, Page, Sentence, ComprehensionSnapshot } from '../shared/db';
import { PAGE_TIME_MIN_THRESHOLD_MS, isUrlIgnored } from '../shared/config';
import type { IgnoreList, KnowledgeLevelBreakdown, WordKnowledge, LibrarySentence, LibrarySource } from '../shared/types';
import { logger } from '../shared/logger';

/**
 * Query Service
 *
 * Provides on-the-fly analytics from the encounter database.
 * All queries support page-time filtering to exclude quick navigations.
 */

export interface TimeRange {
  start: number;
  end: number;
}

export interface EncounterStats {
  totalEncounters: number;
  uniqueWords: number;
  uniquePages: number;
  encounters: Encounter[];
}

export interface ComprehensionStats extends EncounterStats {
  knownCount: number;
  unknownCount: number;
  comprehensionPercent: number;
  topUnknown: { word: string; count: number }[];
  knowledgeBreakdown?: KnowledgeLevelBreakdown;
}

export interface WordHistory {
  word: string;
  totalEncounters: number;
  firstSeen: number;
  lastSeen: number;
  sources: { url: string; title: string; count: number }[];
  i1SentenceCount: number;
}

/**
 * Get valid page hashes (pages with sufficient reading time, excluding ignored URLs)
 */
async function getValidPageHashes(
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<Set<number>> {
  let validPages = await db.pages
    .where('totalTimeMs')
    .aboveOrEqual(minTimeMs)
    .toArray();

  // Filter out ignored URLs if ignoreList is provided
  if (ignoreList && (ignoreList.domains.length > 0 || ignoreList.urls.length > 0)) {
    validPages = validPages.filter(p => !isUrlIgnored(p.url, ignoreList));
  }

  return new Set(validPages.map(p => p.urlHash));
}

/**
 * Get encounters with page-time filtering
 */
export async function getEncountersWithMinTime(
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  timeRange?: TimeRange,
  ignoreList?: IgnoreList
): Promise<Encounter[]> {
  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  let query = db.encounters.orderBy('timestamp');

  if (timeRange) {
    query = db.encounters
      .where('timestamp')
      .between(timeRange.start, timeRange.end);
  }

  const allEncounters = await query.toArray();

  // Filter to only valid pages
  return allEncounters.filter(e => validHashes.has(e.urlHash));
}

/**
 * Get stats for a time range (today, week, month, etc.)
 */
export async function getStatsForRange(
  timeRange: TimeRange,
  knownWords: Set<string>,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList,
  knowledgeLevels?: Map<string, WordKnowledge>
): Promise<ComprehensionStats> {
  const encounters = await getEncountersWithMinTime(minTimeMs, timeRange, ignoreList);

  const uniqueWordSet = new Set<string>();
  const uniquePageSet = new Set<number>();
  const unknownCounts = new Map<string, number>();

  let knownCount = 0;
  let unknownCount = 0;

  // Knowledge level counts (by unique word)
  let matureCount = 0;
  let youngCount = 0;
  let learningCount = 0;
  let newCount = 0;
  let trueUnknownCount = 0;
  const countedWords = new Set<string>();

  for (const e of encounters) {
    uniqueWordSet.add(e.word);
    uniquePageSet.add(e.urlHash);

    if (knownWords.has(e.word)) {
      knownCount++;
    } else {
      unknownCount++;
      unknownCounts.set(e.word, (unknownCounts.get(e.word) || 0) + 1);
    }

    // Count knowledge levels per unique word
    if (!countedWords.has(e.word) && knowledgeLevels) {
      countedWords.add(e.word);
      const knowledge = knowledgeLevels.get(e.word);
      if (knowledge) {
        switch (knowledge.level) {
          case 'mature': matureCount++; break;
          case 'young': youngCount++; break;
          case 'learning': learningCount++; break;
          case 'new': newCount++; break;
        }
      } else if (knownWords.has(e.word)) {
        matureCount++;
      } else {
        trueUnknownCount++;
      }
    }
  }

  const totalCounted = knownCount + unknownCount;
  const comprehensionPercent = totalCounted > 0
    ? Math.round((knownCount / totalCounted) * 100)
    : 0;

  const topUnknown = Array.from(unknownCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));

  // Calculate breakdown percentages
  let knowledgeBreakdown: KnowledgeLevelBreakdown | undefined;
  const totalUniqueWords = uniqueWordSet.size;
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
    totalEncounters: encounters.length,
    uniqueWords: uniqueWordSet.size,
    uniquePages: uniquePageSet.size,
    encounters,
    knownCount,
    unknownCount,
    comprehensionPercent,
    topUnknown,
    knowledgeBreakdown
  };
}

/**
 * Get today's stats
 */
export async function getTodayStats(
  knownWords: Set<string>,
  minTimeMs?: number,
  ignoreList?: IgnoreList
): Promise<ComprehensionStats> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return getStatsForRange(
    { start: today.getTime(), end: Date.now() },
    knownWords,
    minTimeMs,
    ignoreList
  );
}

/**
 * Get this week's stats
 */
export async function getWeekStats(
  knownWords: Set<string>,
  minTimeMs?: number,
  ignoreList?: IgnoreList
): Promise<ComprehensionStats> {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  weekAgo.setHours(0, 0, 0, 0);

  return getStatsForRange(
    { start: weekAgo.getTime(), end: Date.now() },
    knownWords,
    minTimeMs,
    ignoreList
  );
}

/**
 * Get this month's stats
 */
export async function getMonthStats(
  knownWords: Set<string>,
  minTimeMs?: number,
  ignoreList?: IgnoreList
): Promise<ComprehensionStats> {
  const monthAgo = new Date();
  monthAgo.setMonth(monthAgo.getMonth() - 1);
  monthAgo.setHours(0, 0, 0, 0);

  return getStatsForRange(
    { start: monthAgo.getTime(), end: Date.now() },
    knownWords,
    minTimeMs,
    ignoreList
  );
}

/**
 * Get all-time stats
 */
export async function getAllTimeStats(
  knownWords: Set<string>,
  minTimeMs?: number,
  ignoreList?: IgnoreList
): Promise<ComprehensionStats> {
  return getStatsForRange(
    { start: 0, end: Date.now() },
    knownWords,
    minTimeMs,
    ignoreList
  );
}

/**
 * Get comprehension stats for a specific URL
 */
export async function getComprehensionByUrl(
  url: string,
  urlHash: number,
  knownWords: Set<string>
): Promise<{
  url: string;
  title: string;
  totalWords: number;
  knownWords: number;
  comprehensionPercent: number;
  unknownList: string[];
  timeSpentMs: number;
}> {
  const encounters = await db.encounters
    .where('urlHash')
    .equals(urlHash)
    .toArray();

  const page = await db.pages.get(urlHash);

  let knownCount = 0;
  const unknownSet = new Set<string>();
  let title = url;

  for (const e of encounters) {
    if (!title || title === url) {
      title = e.pageTitle;
    }

    if (knownWords.has(e.word)) {
      knownCount++;
    } else {
      unknownSet.add(e.word);
    }
  }

  const totalWords = encounters.length;
  const comprehensionPercent = totalWords > 0
    ? Math.round((knownCount / totalWords) * 100)
    : 0;

  return {
    url,
    title,
    totalWords,
    knownWords: knownCount,
    comprehensionPercent,
    unknownList: Array.from(unknownSet),
    timeSpentMs: page?.totalTimeMs || 0
  };
}

/**
 * Get detailed history for a specific word
 */
export async function getWordHistory(
  word: string,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<WordHistory> {
  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  // Get all encounters of this word
  const encounters = await db.encounters
    .where('word')
    .equals(word)
    .toArray();

  // Filter to valid pages
  const validEncounters = encounters.filter(e => validHashes.has(e.urlHash));

  if (validEncounters.length === 0) {
    return {
      word,
      totalEncounters: 0,
      firstSeen: 0,
      lastSeen: 0,
      sources: [],
      i1SentenceCount: 0
    };
  }

  // Aggregate by source
  const sourceMap = new Map<number, { url: string; title: string; count: number }>();
  let firstSeen = Infinity;
  let lastSeen = 0;

  for (const e of validEncounters) {
    if (e.timestamp < firstSeen) firstSeen = e.timestamp;
    if (e.timestamp > lastSeen) lastSeen = e.timestamp;

    const existing = sourceMap.get(e.urlHash);
    if (existing) {
      existing.count++;
    } else {
      sourceMap.set(e.urlHash, {
        url: e.url,
        title: e.pageTitle,
        count: 1
      });
    }
  }

  // Count i+1 sentences containing this word
  const i1Sentences = await db.sentences
    .where('unknownCount')
    .equals(1)
    .filter(s => s.unknownWords[0] === word)
    .count();

  return {
    word,
    totalEncounters: validEncounters.length,
    firstSeen,
    lastSeen,
    sources: Array.from(sourceMap.values()).sort((a, b) => b.count - a.count),
    i1SentenceCount: i1Sentences
  };
}

/**
 * Get encounter count for a word
 */
export async function getEncounterCount(
  word: string,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<number> {
  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  const encounters = await db.encounters
    .where('word')
    .equals(word)
    .toArray();

  return encounters.filter(e => validHashes.has(e.urlHash)).length;
}

/**
 * Get first encounter timestamp for a word
 */
export async function getFirstEncounter(word: string): Promise<number | null> {
  const encounter = await db.encounters
    .where('[word+timestamp]')
    .between([word, 0], [word, Date.now()])
    .first();

  return encounter?.timestamp || null;
}

/**
 * Get recent pages with stats
 */
export async function getRecentPages(
  limit: number = 20,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<Array<{
  url: string;
  title: string;
  lastSeen: number;
  totalTimeMs: number;
  wordCount: number;
}>> {
  let allPages = await db.pages
    .where('totalTimeMs')
    .aboveOrEqual(minTimeMs)
    .reverse()
    .sortBy('lastSeen');

  // Filter out ignored URLs
  if (ignoreList && (ignoreList.domains.length > 0 || ignoreList.urls.length > 0)) {
    allPages = allPages.filter(p => !isUrlIgnored(p.url, ignoreList));
  }

  const recentPages = allPages.slice(0, limit);

  // Get word counts for each page
  const results = await Promise.all(
    recentPages.map(async (page) => {
      const wordCount = await db.encounters
        .where('urlHash')
        .equals(page.urlHash)
        .count();

      return {
        url: page.url,
        title: page.title,
        lastSeen: page.lastSeen,
        totalTimeMs: page.totalTimeMs,
        wordCount
      };
    })
  );

  return results;
}

/**
 * Get site statistics for the dashboard
 */
export async function getSiteStats(
  sortBy: 'recent' | 'time' | 'comprehension' = 'recent',
  limit: number = 100,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<Array<{
  url: string;
  urlHash: number;
  hostname: string;
  comprehensionPercent: number;
  totalTimeMs: number;
  visitCount: number;
  lastVisit: number;
}>> {
  let allPages = await db.pages
    .where('totalTimeMs')
    .aboveOrEqual(minTimeMs)
    .toArray();

  // Filter out ignored URLs
  if (ignoreList && (ignoreList.domains.length > 0 || ignoreList.urls.length > 0)) {
    allPages = allPages.filter(p => !isUrlIgnored(p.url, ignoreList));
  }

  // Get comprehension snapshots for pages
  const results = await Promise.all(
    allPages.map(async (page) => {
      // Get latest snapshot for comprehension
      const snapshots = await db.comprehensionSnapshots
        .where('urlHash')
        .equals(page.urlHash)
        .reverse()
        .sortBy('timestamp');

      const latestSnapshot = snapshots[0];

      let hostname = '';
      try {
        hostname = new URL(page.url).hostname;
      } catch {
        hostname = page.url;
      }

      return {
        url: page.url,
        urlHash: page.urlHash,
        hostname,
        comprehensionPercent: latestSnapshot?.comprehensionPercent ?? 0,
        totalTimeMs: page.totalTimeMs,
        visitCount: 1, // TODO: Track visit count
        lastVisit: page.lastSeen,
      };
    })
  );

  // Sort
  if (sortBy === 'recent') {
    results.sort((a, b) => b.lastVisit - a.lastVisit);
  } else if (sortBy === 'time') {
    results.sort((a, b) => b.totalTimeMs - a.totalTimeMs);
  } else if (sortBy === 'comprehension') {
    results.sort((a, b) => b.comprehensionPercent - a.comprehensionPercent);
  }

  return results.slice(0, limit);
}

/**
 * Get encounter details for a specific word
 */
export async function getWordEncounters(
  word: string,
  limit: number = 50,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<Array<{
  timestamp: number;
  url: string;
  sentence?: string;
}>> {
  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  // Get all encounters for this word
  let encounters = await db.encounters
    .where('word')
    .equals(word)
    .toArray();

  // Filter to valid pages
  encounters = encounters.filter(e => validHashes.has(e.urlHash));

  // Sort by timestamp (newest first)
  encounters.sort((a, b) => b.timestamp - a.timestamp);

  // Get page URLs
  const urlMap = new Map<number, string>();
  const pageHashes = [...new Set(encounters.map(e => e.urlHash))];
  const pages = await db.pages.where('urlHash').anyOf(pageHashes).toArray();
  pages.forEach(p => urlMap.set(p.urlHash, p.url));

  // Map to result format
  return encounters.slice(0, limit).map(e => ({
    timestamp: e.timestamp,
    url: urlMap.get(e.urlHash) || '',
    sentence: e.sentence,
  }));
}

/**
 * Export all encounters as JSON
 */
export async function exportEncounters(
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<{
  encounters: Encounter[];
  pages: Page[];
  sentences: Sentence[];
  exportedAt: number;
}> {
  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  const allEncounters = await db.encounters.toArray();
  const validEncounters = allEncounters.filter(e => validHashes.has(e.urlHash));

  let pages = await db.pages
    .where('totalTimeMs')
    .aboveOrEqual(minTimeMs)
    .toArray();

  // Filter out ignored URLs
  if (ignoreList && (ignoreList.domains.length > 0 || ignoreList.urls.length > 0)) {
    pages = pages.filter(p => !isUrlIgnored(p.url, ignoreList));
  }

  const sentences = await db.sentences.toArray();
  const validSentences = sentences.filter(s => validHashes.has(s.urlHash));

  return {
    encounters: validEncounters,
    pages,
    sentences: validSentences,
    exportedAt: Date.now()
  };
}

/**
 * Clear old data (older than X days)
 */
export async function clearOldData(daysOld: number = 90): Promise<{
  encountersDeleted: number;
  pagesDeleted: number;
  sentencesDeleted: number;
}> {
  const cutoff = Date.now() - (daysOld * 24 * 60 * 60 * 1000);

  // Delete encounters from old pages
  const encountersDeleted = await db.encounters
    .where('timestamp')
    .below(cutoff)
    .delete();

  // Delete old pages
  const pagesDeleted = await db.pages
    .where('lastSeen')
    .below(cutoff)
    .delete();

  // Delete old sentences
  const sentencesDeleted = await db.sentences
    .where('timestamp')
    .below(cutoff)
    .delete();

  logger.stats.info(`Cleared old data: ${encountersDeleted} encounters, ${pagesDeleted} pages, ${sentencesDeleted} sentences`);

  return {
    encountersDeleted,
    pagesDeleted,
    sentencesDeleted
  };
}

/**
 * Search encounters by sentence content
 * Client-side filtering since IndexedDB has no full-text search
 */
export async function searchEncountersBySentence(
  query: string,
  timeRange: TimeRange,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList,
  offset: number = 0,
  limit: number = 50
): Promise<{ encounters: Encounter[]; total: number; hasMore: boolean }> {
  if (!query || query.length < 1) {
    return { encounters: [], total: 0, hasMore: false };
  }

  const queryLower = query.toLowerCase();
  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  // Get encounters with time filter if applicable
  let allEncounters: Encounter[];
  if (timeRange.start === 0 && timeRange.end >= Date.now()) {
    allEncounters = await db.encounters.toArray();
  } else {
    allEncounters = await db.encounters
      .where('timestamp')
      .between(timeRange.start, timeRange.end)
      .toArray();
  }

  // Filter by valid pages and sentence content
  const matches = allEncounters.filter(e =>
    validHashes.has(e.urlHash) &&
    e.sentence &&
    e.sentence.toLowerCase().includes(queryLower)
  );

  // Sort by timestamp descending (newest first)
  matches.sort((a, b) => b.timestamp - a.timestamp);

  const total = matches.length;
  const paginated = matches.slice(offset, offset + limit);
  const hasMore = offset + limit < total;

  return { encounters: paginated, total, hasMore };
}

/**
 * Debug function to get raw database counts (no filtering)
 * Used to diagnose data storage issues
 */
export async function getDebugCounts(): Promise<{
  rawEncounterCount: number;
  rawPageCount: number;
  rawSentenceCount: number;
  validPageCount: number;
  filteredEncounterCount: number;
  sampleEncounters: Encounter[];
  samplePages: Page[];
}> {
  const rawEncounterCount = await db.encounters.count();
  const rawPageCount = await db.pages.count();
  const rawSentenceCount = await db.sentences.count();

  // Get valid pages (with enough time)
  const validPageCount = await db.pages
    .where('totalTimeMs')
    .aboveOrEqual(PAGE_TIME_MIN_THRESHOLD_MS)
    .count();

  // Get sample encounters
  const sampleEncounters = await db.encounters.limit(5).toArray();

  // Get sample pages
  const samplePages = await db.pages.limit(5).toArray();

  // Get filtered count
  const validHashes = await getValidPageHashes();
  const allEncounters = await db.encounters.toArray();
  const filteredEncounterCount = allEncounters.filter(e => validHashes.has(e.urlHash)).length;

  return {
    rawEncounterCount,
    rawPageCount,
    rawSentenceCount,
    validPageCount,
    filteredEncounterCount,
    sampleEncounters,
    samplePages
  };
}

/**
 * Estimate storage size for each table
 * Uses sampling to estimate average record size
 */
export async function getDatabaseSizes(): Promise<{
  encounters: { count: number; estimatedBytes: number };
  pages: { count: number; estimatedBytes: number };
  sentences: { count: number; estimatedBytes: number };
  comprehensionSnapshots: { count: number; estimatedBytes: number };
  totalBytes: number;
  formattedTotal: string;
}> {
  // Get counts
  const encounterCount = await db.encounters.count();
  const pageCount = await db.pages.count();
  const sentenceCount = await db.sentences.count();
  const snapshotCount = await db.comprehensionSnapshots.count();

  // Sample records to estimate size
  const sampleEncounters = await db.encounters.limit(100).toArray();
  const samplePages = await db.pages.limit(100).toArray();
  const sampleSentences = await db.sentences.limit(100).toArray();
  const sampleSnapshots = await db.comprehensionSnapshots.limit(100).toArray();

  // Estimate average size per record (rough JSON stringify size)
  const avgEncounterSize = sampleEncounters.length > 0
    ? sampleEncounters.reduce((sum, e) => sum + JSON.stringify(e).length, 0) / sampleEncounters.length
    : 200; // default estimate

  const avgPageSize = samplePages.length > 0
    ? samplePages.reduce((sum, p) => sum + JSON.stringify(p).length, 0) / samplePages.length
    : 150;

  const avgSentenceSize = sampleSentences.length > 0
    ? sampleSentences.reduce((sum, s) => sum + JSON.stringify(s).length, 0) / sampleSentences.length
    : 300;

  const avgSnapshotSize = sampleSnapshots.length > 0
    ? sampleSnapshots.reduce((sum, s) => sum + JSON.stringify(s).length, 0) / sampleSnapshots.length
    : 250;

  // Calculate estimated sizes
  const encounterBytes = Math.round(encounterCount * avgEncounterSize);
  const pageBytes = Math.round(pageCount * avgPageSize);
  const sentenceBytes = Math.round(sentenceCount * avgSentenceSize);
  const snapshotBytes = Math.round(snapshotCount * avgSnapshotSize);
  const totalBytes = encounterBytes + pageBytes + sentenceBytes + snapshotBytes;

  // Format total size
  let formattedTotal: string;
  if (totalBytes >= 1024 * 1024 * 1024) {
    formattedTotal = `${(totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  } else if (totalBytes >= 1024 * 1024) {
    formattedTotal = `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`;
  } else if (totalBytes >= 1024) {
    formattedTotal = `${(totalBytes / 1024).toFixed(2)} KB`;
  } else {
    formattedTotal = `${totalBytes} bytes`;
  }

  return {
    encounters: { count: encounterCount, estimatedBytes: encounterBytes },
    pages: { count: pageCount, estimatedBytes: pageBytes },
    sentences: { count: sentenceCount, estimatedBytes: sentenceBytes },
    comprehensionSnapshots: { count: snapshotCount, estimatedBytes: snapshotBytes },
    totalBytes,
    formattedTotal
  };
}

/**
 * Get top encountered words for dashboard
 * Returns aggregated word data with sorting and filtering
 */
export interface TopWordResult {
  baseForm: string;
  surface: string;
  count: number;
  pages: string[];
  frequency?: number;
  lastSeen: number;
  status: 'known' | 'unknown' | 'ignored';
}

export async function getTopEncounteredWords(
  knownWords: Set<string>,
  ignoredWords: Set<string>,
  frequencyMap: Map<string, number>,
  opts: {
    timeRange?: 'all' | 'today' | 'week' | 'month';
    sortBy?: 'count' | 'recent' | 'frequency' | 'alpha';
    minEncounters?: number;
    limit?: number;
    minTimeMs?: number;
    ignoreList?: IgnoreList;
  } = {}
): Promise<{ words: TopWordResult[]; total: number }> {
  const {
    timeRange = 'all',
    sortBy = 'count',
    minEncounters = 1,
    limit = 300,
    minTimeMs = PAGE_TIME_MIN_THRESHOLD_MS,
    ignoreList,
  } = opts;

  // Build time range
  const now = Date.now();
  let timeStart = 0;
  if (timeRange === 'today') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    timeStart = today.getTime();
  } else if (timeRange === 'week') {
    timeStart = now - 7 * 24 * 60 * 60 * 1000;
  } else if (timeRange === 'month') {
    timeStart = now - 30 * 24 * 60 * 60 * 1000;
  }

  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  // Get encounters
  let encounters: Encounter[];
  if (timeStart === 0) {
    encounters = await db.encounters.toArray();
  } else {
    encounters = await db.encounters
      .where('timestamp')
      .aboveOrEqual(timeStart)
      .toArray();
  }

  // Filter to valid pages
  encounters = encounters.filter(e => validHashes.has(e.urlHash));

  // Aggregate by word
  const wordMap = new Map<string, {
    baseForm: string;
    surface: string;
    count: number;
    pageUrls: Set<string>;
    lastSeen: number;
  }>();

  for (const e of encounters) {
    const existing = wordMap.get(e.word);
    if (existing) {
      existing.count++;
      existing.pageUrls.add(e.url);
      if (e.timestamp > existing.lastSeen) {
        existing.lastSeen = e.timestamp;
        if (e.surface) existing.surface = e.surface;
      }
    } else {
      wordMap.set(e.word, {
        baseForm: e.word,
        surface: e.surface || e.word,
        count: 1,
        pageUrls: new Set([e.url]),
        lastSeen: e.timestamp,
      });
    }
  }

  // Convert to array and filter by min encounters
  let words: TopWordResult[] = Array.from(wordMap.values())
    .filter(w => w.count >= minEncounters)
    .map(w => ({
      baseForm: w.baseForm,
      surface: w.surface,
      count: w.count,
      pages: Array.from(w.pageUrls),
      frequency: frequencyMap.get(w.baseForm),
      lastSeen: w.lastSeen,
      status: knownWords.has(w.baseForm)
        ? 'known' as const
        : ignoredWords.has(w.baseForm)
          ? 'ignored' as const
          : 'unknown' as const,
    }));

  const total = words.length;

  // Sort
  if (sortBy === 'count') {
    words.sort((a, b) => b.count - a.count);
  } else if (sortBy === 'recent') {
    words.sort((a, b) => b.lastSeen - a.lastSeen);
  } else if (sortBy === 'frequency') {
    words.sort((a, b) => (a.frequency || 999999) - (b.frequency || 999999));
  } else if (sortBy === 'alpha') {
    words.sort((a, b) => a.baseForm.localeCompare(b.baseForm, 'ja'));
  }

  // Apply limit
  words = words.slice(0, limit);

  return { words, total };
}

// Unified sentence type for dashboard
interface UnifiedSentence {
  text: string;
  unknownWords: string[];
  url: string;
  pageTitle: string;
  timestamp: number;
  source: 'encountered' | 'library';
  sourceId?: string;
}

/**
 * Get all sentences with filtering for dashboard
 * Supports both encountered sentences and library sentences
 */
export async function getAllSentencesFiltered(
  knownWords: Set<string>,
  opts: {
    source?: 'encountered' | 'library' | 'all';
    timeRange?: 'all' | 'today' | 'week' | 'month';
    unknownCount?: number; // 0 = all, 1 = i+1, 2 = i+2, etc.
    sortBy?: 'recent' | 'shortest' | 'longest';
    search?: string;
    limit?: number;
    offset?: number;
    minTimeMs?: number;
    ignoreList?: IgnoreList;
  } = {}
): Promise<{
  sentences: Array<UnifiedSentence>;
  total: number;
  hasMore: boolean;
}> {
  const {
    source = 'encountered',
    timeRange = 'all',
    unknownCount,
    sortBy = 'recent',
    search,
    limit = 50,
    offset = 0,
    minTimeMs = PAGE_TIME_MIN_THRESHOLD_MS,
    ignoreList,
  } = opts;

  // Build time range (only applies to encountered sentences)
  const now = Date.now();
  let timeStart = 0;
  if (timeRange === 'today') {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    timeStart = today.getTime();
  } else if (timeRange === 'week') {
    timeStart = now - 7 * 24 * 60 * 60 * 1000;
  } else if (timeRange === 'month') {
    timeStart = now - 30 * 24 * 60 * 60 * 1000;
  }

  const results: UnifiedSentence[] = [];

  // Get encountered sentences if requested
  if (source === 'encountered' || source === 'all') {
    const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

    let encSentences: Sentence[];
    if (unknownCount !== undefined && unknownCount > 0) {
      encSentences = await db.sentences
        .where('unknownCount')
        .equals(unknownCount)
        .toArray();
    } else {
      encSentences = await db.sentences.toArray();
    }

    // Filter by valid pages and time range
    encSentences = encSentences.filter(s => {
      if (!validHashes.has(s.urlHash)) return false;
      if (timeStart > 0 && s.timestamp < timeStart) return false;
      return true;
    });

    // Re-filter unknowns based on current known words
    if (unknownCount !== undefined && unknownCount > 0) {
      encSentences = encSentences.filter(s => {
        const currentUnknown = s.unknownWords.filter(w => !knownWords.has(w));
        return currentUnknown.length === unknownCount;
      });
    }

    // Apply search filter
    if (search && search.length > 0) {
      encSentences = encSentences.filter(s =>
        s.text.includes(search) ||
        s.unknownWords.some(w => w.includes(search))
      );
    }

    // Convert to unified format
    for (const s of encSentences) {
      results.push({
        text: s.text,
        unknownWords: s.unknownWords.filter(w => !knownWords.has(w)),
        url: s.url,
        pageTitle: s.pageTitle,
        timestamp: s.timestamp,
        source: 'encountered',
      });
    }
  }

  // Get library sentences if requested
  if (source === 'library' || source === 'all') {
    // Cache source info for performance
    const sourceCache = new Map<string, LibrarySource>();
    const sources = await db.librarySources.toArray();
    for (const src of sources) {
      sourceCache.set(src.id, src);
    }

    // Query library sentences - for large libraries, we need to be smart
    // Filter in chunks to avoid loading millions of sentences
    const libSentences = await db.librarySentences.toArray();

    for (const s of libSentences) {
      // Compute unknown words from pre-extracted words array
      const unknown = s.words.filter(w => !knownWords.has(w));

      // Filter by unknownCount
      if (unknownCount !== undefined && unknownCount > 0) {
        if (unknown.length !== unknownCount) continue;
      }

      // Apply search filter
      if (search && search.length > 0) {
        if (!s.text.includes(search) && !unknown.some(w => w.includes(search))) {
          continue;
        }
      }

      const srcInfo = sourceCache.get(s.sourceId);

      results.push({
        text: s.text,
        unknownWords: unknown,
        url: srcInfo?.sourceRef || s.sourceId,
        pageTitle: srcInfo?.title || 'Library',
        timestamp: srcInfo?.addedAt || 0,
        source: 'library',
        sourceId: s.sourceId,
      });
    }
  }

  // Sort results
  if (sortBy === 'recent') {
    results.sort((a, b) => b.timestamp - a.timestamp);
  } else if (sortBy === 'shortest') {
    results.sort((a, b) => a.text.length - b.text.length);
  } else if (sortBy === 'longest') {
    results.sort((a, b) => b.text.length - a.text.length);
  }

  const total = results.length;
  const hasMore = offset + limit < total;

  // Apply pagination
  const paginated = results.slice(offset, offset + limit);

  return {
    sentences: paginated,
    total,
    hasMore,
  };
}
