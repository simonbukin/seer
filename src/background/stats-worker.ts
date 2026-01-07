import { db, Encounter } from '../shared/db';
import { PAGE_TIME_MIN_THRESHOLD_MS, isUrlIgnored } from '../shared/config';
import type { IgnoreList, KnowledgeLevelBreakdown, WordKnowledge } from '../shared/types';
import { logger } from '../shared/logger';

/**
 * Stats Worker v2
 *
 * Computes word statistics on-the-fly from encounter data.
 * No caching - always fresh data that reflects current known words.
 */

export interface WordStats {
  baseForm: string;
  totalEncounters: number;
  uniquePages: number;
  firstSeen: number;
  lastSeen: number;
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

  // Filter out ignored URLs
  if (ignoreList && (ignoreList.domains.length > 0 || ignoreList.urls.length > 0)) {
    validPages = validPages.filter(p => !isUrlIgnored(p.url, ignoreList));
  }

  return new Set(validPages.map(p => p.urlHash));
}

/**
 * Compute aggregate statistics for a word
 * Derives from encounters with page-time filtering
 *
 * @param word - Dictionary form of the word
 * @param minTimeMs - Minimum page time threshold
 * @param ignoreList - URLs/domains to exclude from stats
 * @returns Aggregate stats or null if no encounters found
 */
export async function computeWordStats(
  word: string,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<WordStats | null> {
  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  // Get encounters for this word
  const encounters = await db.encounters
    .where('word')
    .equals(word)
    .toArray();

  // Filter to valid pages
  const validEncounters = encounters.filter(e => validHashes.has(e.urlHash));

  if (validEncounters.length === 0) return null;

  // Calculate stats
  const uniqueUrls = new Set(validEncounters.map(e => e.urlHash));
  const timestamps = validEncounters.map(e => e.timestamp);

  // Count i+1 sentences
  const i1Count = await db.sentences
    .where('unknownCount')
    .equals(1)
    .filter(s => s.unknownWords[0] === word && validHashes.has(s.urlHash))
    .count();

  return {
    baseForm: word,  // Keep as baseForm for API compatibility
    totalEncounters: validEncounters.length,
    uniquePages: uniqueUrls.size,
    firstSeen: Math.min(...timestamps),
    lastSeen: Math.max(...timestamps),
    i1SentenceCount: i1Count
  };
}

/**
 * Get all unknown words with their statistics
 * Used for priority ranking and analytics
 *
 * @param knownWords - Set of known word base forms (to filter out)
 * @param minTimeMs - Minimum page time threshold
 * @param ignoreList - URLs/domains to exclude from stats
 * @returns Array of all word stats, sorted by total encounters (descending)
 */
export async function getAllUnknownWordsWithStats(
  knownWords?: Set<string>,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<WordStats[]> {
  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  // Get all encounters
  const allEncounters = await db.encounters.toArray();

  // Filter to valid pages and optionally filter out known words
  const validEncounters = allEncounters.filter(e => {
    if (!validHashes.has(e.urlHash)) return false;
    if (knownWords && knownWords.has(e.word)) return false;
    return true;
  });

  // Group by word
  const wordGroups = new Map<string, Encounter[]>();
  for (const e of validEncounters) {
    const existing = wordGroups.get(e.word) || [];
    existing.push(e);
    wordGroups.set(e.word, existing);
  }

  // Pre-fetch i+1 counts for all words
  const i1Sentences = await db.sentences
    .where('unknownCount')
    .equals(1)
    .toArray();

  const validI1 = i1Sentences.filter(s => validHashes.has(s.urlHash));
  const i1Counts = new Map<string, number>();
  for (const s of validI1) {
    const word = s.unknownWords[0];
    i1Counts.set(word, (i1Counts.get(word) || 0) + 1);
  }

  // Build stats for each word
  const stats: WordStats[] = [];

  for (const [word, encounters] of wordGroups) {
    const uniqueUrls = new Set(encounters.map(e => e.urlHash));
    const timestamps = encounters.map(e => e.timestamp);

    stats.push({
      baseForm: word,  // Keep as baseForm for API compatibility
      totalEncounters: encounters.length,
      uniquePages: uniqueUrls.size,
      firstSeen: Math.min(...timestamps),
      lastSeen: Math.max(...timestamps),
      i1SentenceCount: i1Counts.get(word) || 0
    });
  }

  // Sort by encounter count descending
  stats.sort((a, b) => b.totalEncounters - a.totalEncounters);

  return stats;
}

/**
 * Get stats for specific words only
 * More efficient than getAllUnknownWordsWithStats when you only need a few words
 */
export async function getStatsForWords(
  words: string[],
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<Map<string, WordStats>> {
  const result = new Map<string, WordStats>();

  const statsPromises = words.map(async (word) => {
    const stats = await computeWordStats(word, minTimeMs, ignoreList);
    if (stats) {
      result.set(word, stats);
    }
  });

  await Promise.all(statsPromises);
  return result;
}

/**
 * Get summary statistics for all encounters
 */
export async function getOverallStats(
  knownWords: Set<string>,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList,
  knowledgeLevels?: Map<string, WordKnowledge>
): Promise<{
  totalEncounters: number;
  uniqueWords: number;
  uniquePages: number;
  knownEncounters: number;
  unknownEncounters: number;
  comprehensionPercent: number;
  knowledgeBreakdown?: KnowledgeLevelBreakdown;
}> {
  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  const allEncounters = await db.encounters.toArray();
  const validEncounters = allEncounters.filter(e => validHashes.has(e.urlHash));

  const uniqueWords = new Set<string>();
  const uniquePages = new Set<number>();
  let knownCount = 0;
  let unknownCount = 0;

  // Knowledge level counts (by unique word)
  let matureCount = 0;
  let youngCount = 0;
  let learningCount = 0;
  let newCount = 0;
  let trueUnknownCount = 0;

  // Track which words we've already counted for knowledge breakdown
  const countedWords = new Set<string>();

  for (const e of validEncounters) {
    uniqueWords.add(e.word);
    uniquePages.add(e.urlHash);

    if (knownWords.has(e.word)) {
      knownCount++;
    } else {
      unknownCount++;
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
        // In known set but no knowledge level - count as mature (assume legacy)
        matureCount++;
      } else {
        trueUnknownCount++;
      }
    }
  }

  const total = knownCount + unknownCount;
  const comprehensionPercent = total > 0
    ? Math.round((knownCount / total) * 100)
    : 0;

  // Calculate breakdown percentages
  let knowledgeBreakdown: KnowledgeLevelBreakdown | undefined;
  const totalUniqueWords = uniqueWords.size;
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
    totalEncounters: validEncounters.length,
    uniqueWords: uniqueWords.size,
    uniquePages: uniquePages.size,
    knownEncounters: knownCount,
    unknownEncounters: unknownCount,
    comprehensionPercent,
    knowledgeBreakdown
  };
}
