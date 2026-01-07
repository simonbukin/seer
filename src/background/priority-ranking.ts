import { db } from '../shared/db';
import { fnv1a } from '../shared/hash';
import { getFrequency } from '../shared/frequency';
import { PAGE_TIME_MIN_THRESHOLD_MS } from '../shared/config';
import type { IgnoreList } from '../shared/types';
import { getAllUnknownWordsWithStats, WordStats } from './stats-worker';

/**
 * Priority Ranking v2: "What Should I Learn Next?"
 *
 * Scores words by:
 * - Global frequency (JPDB)
 * - Personal encounter rate
 * - Pages blocked (comprehension unlock)
 * - Recency
 * - Familiarity (shared kanji with known words)
 * - i+1 potential (sentences that would become comprehensible)
 */

export interface PriorityScore {
  word: string;
  score: number;
  breakdown: {
    frequency: number;
    personal: number;
    blocking: number;
    recency: number;
    familiarity: number;
    i1Potential: number;
  };
}

/**
 * Calculate priority score for a word
 */
export async function calculatePriority(
  word: string,
  stats: WordStats,
  knownWords: Set<string>
): Promise<PriorityScore> {
  const globalFreq = getFrequency(word) || 50000;
  const blockedPages = await getPagesWithWord(word);

  const breakdown = {
    // Frequency: log scale (higher rank number = lower priority)
    // Lower frequency rank = more common = higher score
    frequency: Math.max(0, 5 - Math.log10(globalFreq + 1)) * 10,

    // Personal: how often YOU encounter it
    personal: Math.min(stats.totalEncounters * 2, 30),

    // Blocking: number of pages this word appears in
    blocking: Math.min(blockedPages.length * 5, 25),

    // Recency: seen in last 24h = bonus
    recency: (Date.now() - stats.lastSeen < 86_400_000) ? 10 : 0,

    // Familiarity: share kanji with known words
    familiarity: await calculateFamiliarityBonus(word, knownWords),

    // i+1 Potential: sentences that would become comprehensible
    // Higher score = more sentences unlocked by learning this word
    i1Potential: Math.min(stats.i1SentenceCount * 5, 25)
  };

  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);

  return { word, score, breakdown };
}

/**
 * Get all pages containing a word
 */
async function getPagesWithWord(word: string): Promise<string[]> {
  const encounters = await db.encounters
    .where('word')
    .equals(word)
    .toArray();

  const uniqueUrls = new Set(encounters.map(e => e.url));
  return Array.from(uniqueUrls);
}

/**
 * Bonus for sharing kanji with known words
 * If you know other words with the same kanji, learning this is easier
 */
async function calculateFamiliarityBonus(
  word: string,
  knownWords: Set<string>
): Promise<number> {
  const kanji = word.match(/[\u4e00-\u9faf]/g) || [];
  if (kanji.length === 0) return 0;

  let bonus = 0;
  const uniqueKanji = new Set(kanji);

  for (const char of uniqueKanji) {
    const relatedKnown = Array.from(knownWords).filter(w => w.includes(char)).length;
    if (relatedKnown > 0) bonus += 3;
  }

  return Math.min(bonus, 15); // Cap at 15 points
}

/**
 * Build priority queue of top N words to learn
 */
export async function buildPriorityQueue(
  knownWords: Set<string>,
  limit: number = 50,
  ignoreList?: IgnoreList
): Promise<PriorityScore[]> {
  // Get stats for unknown words only
  const allStats = await getAllUnknownWordsWithStats(knownWords, undefined, ignoreList);

  // Calculate scores for all words
  const scoredPromises = allStats.map(stats =>
    calculatePriority(stats.baseForm, stats, knownWords)
  );

  const scored = await Promise.all(scoredPromises);

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit);
}

/**
 * "Learn to Unlock" Feature
 * Find words that would boost comprehension for a specific page
 */
export async function getUnlockWords(
  pageUrl: string,
  targetComprehension: number = 85,
  knownWords: Set<string>
): Promise<{ word: string; gain: number; i1Potential: number }[]> {
  // Get all encounters from this page
  const urlHash = fnv1a(pageUrl);
  const encounters = await db.encounters
    .where('urlHash')
    .equals(urlHash)
    .toArray();

  if (encounters.length === 0) return [];

  const totalWords = encounters.length;
  const knownCount = encounters.filter(e => knownWords.has(e.word)).length;
  const currentComprehension = (knownCount / totalWords) * 100;

  if (currentComprehension >= targetComprehension) {
    return []; // Already above target
  }

  // Count unknown word frequencies on this page
  const unknownFreq = new Map<string, number>();
  for (const e of encounters) {
    if (!knownWords.has(e.word)) {
      unknownFreq.set(e.word, (unknownFreq.get(e.word) || 0) + 1);
    }
  }

  // Get i+1 potential for each unknown word
  const i1Sentences = await db.sentences
    .where('unknownCount')
    .equals(1)
    .toArray();

  const i1Counts = new Map<string, number>();
  for (const s of i1Sentences) {
    const word = s.unknownWords[0];
    i1Counts.set(word, (i1Counts.get(word) || 0) + 1);
  }

  // Sort by impact (occurrences on page) with i+1 as tiebreaker
  const sorted = Array.from(unknownFreq.entries())
    .map(([word, count]) => ({
      word,
      gain: (count / totalWords) * 100,
      i1Potential: i1Counts.get(word) || 0
    }))
    .sort((a, b) => {
      // Primary: gain
      if (b.gain !== a.gain) return b.gain - a.gain;
      // Secondary: i+1 potential
      return b.i1Potential - a.i1Potential;
    });

  // Return words needed to hit target
  let cumulative = currentComprehension;
  const needed: typeof sorted = [];

  for (const item of sorted) {
    if (cumulative >= targetComprehension) break;
    needed.push(item);
    cumulative += item.gain;
  }

  return needed;
}

/**
 * Get words with highest i+1 potential
 * These words, if learned, would unlock the most comprehensible sentences
 */
export async function getHighI1PotentialWords(
  knownWords: Set<string>,
  limit: number = 20,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<Array<{ word: string; i1Count: number; encounterCount: number }>> {
  const allStats = await getAllUnknownWordsWithStats(knownWords, minTimeMs, ignoreList);

  // Filter to words with i+1 sentences and sort by i+1 count
  return allStats
    .filter(s => s.i1SentenceCount > 0)
    .map(s => ({
      word: s.baseForm,
      i1Count: s.i1SentenceCount,
      encounterCount: s.totalEncounters
    }))
    .sort((a, b) => b.i1Count - a.i1Count)
    .slice(0, limit);
}
