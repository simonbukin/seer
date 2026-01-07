import { db, Sentence } from '../shared/db';
import { PAGE_TIME_MIN_THRESHOLD_MS, isUrlIgnored } from '../shared/config';
import type { IgnoreList } from '../shared/types';
import { logger } from '../shared/logger';

/**
 * i+1 Service
 *
 * Provides i+1 sentence detection for optimal vocabulary learning.
 * An i+1 sentence has exactly one unknown word - ideal for acquisition
 * because context clues help understanding.
 */

export interface I1Sentence {
  text: string;
  targetWord: string;
  url: string;
  timestamp: number;
}

export interface I1WordStats {
  word: string;
  i1SentenceCount: number;
  recentSentence?: string;
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
 * Get all perfect i+1 sentences (exactly 1 unknown word)
 */
export async function getAllI1Sentences(
  limit: number = 100,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<I1Sentence[]> {
  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  const sentences = await db.sentences
    .where('unknownCount')
    .equals(1)
    .reverse()
    .sortBy('timestamp');

  // Filter to valid pages and transform
  const validSentences = sentences
    .filter(s => validHashes.has(s.urlHash))
    .slice(0, limit)
    .map(s => ({
      text: s.text,
      targetWord: s.unknownWords[0],
      url: s.url,
      timestamp: s.timestamp
    }));

  return validSentences;
}

/**
 * Get i+1 sentences for a specific word
 */
export async function getI1SentencesForWord(
  targetWord: string,
  limit: number = 10,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<I1Sentence[]> {
  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  const sentences = await db.sentences
    .where('unknownCount')
    .equals(1)
    .filter(s => s.unknownWords[0] === targetWord && validHashes.has(s.urlHash))
    .limit(limit)
    .toArray();

  return sentences.map(s => ({
    text: s.text,
    targetWord: s.unknownWords[0],
    url: s.url,
    timestamp: s.timestamp
  }));
}

/**
 * Get near-i+1 sentences (2-3 unknown words)
 * Useful for finding sentences that could become i+1 after learning one word
 */
export async function getNearI1Sentences(
  limit: number = 100,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<Sentence[]> {
  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  const sentences = await db.sentences
    .where('unknownCount')
    .between(2, 3, true, true)
    .reverse()
    .sortBy('timestamp');

  return sentences
    .filter(s => validHashes.has(s.urlHash))
    .slice(0, limit);
}

/**
 * Get words that appear in the most i+1 sentences
 * These are high-value words to learn as they unlock many sentences
 */
export async function getI1HighValueWords(
  limit: number = 50,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<I1WordStats[]> {
  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  const i1Sentences = await db.sentences
    .where('unknownCount')
    .equals(1)
    .toArray();

  // Filter to valid pages
  const validSentences = i1Sentences.filter(s => validHashes.has(s.urlHash));

  // Count by word and track most recent sentence
  const wordData = new Map<string, { count: number; recentSentence: string; recentTime: number }>();

  for (const s of validSentences) {
    const word = s.unknownWords[0];
    const existing = wordData.get(word);

    if (existing) {
      existing.count++;
      if (s.timestamp > existing.recentTime) {
        existing.recentSentence = s.text;
        existing.recentTime = s.timestamp;
      }
    } else {
      wordData.set(word, {
        count: 1,
        recentSentence: s.text,
        recentTime: s.timestamp
      });
    }
  }

  // Sort by count and return top N
  return Array.from(wordData.entries())
    .map(([word, data]) => ({
      word,
      i1SentenceCount: data.count,
      recentSentence: data.recentSentence
    }))
    .sort((a, b) => b.i1SentenceCount - a.i1SentenceCount)
    .slice(0, limit);
}

/**
 * Get i+1 potential score for a word
 * Higher score = more i+1 sentences this word appears in
 */
export async function getI1Potential(
  word: string,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<number> {
  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  const count = await db.sentences
    .where('unknownCount')
    .equals(1)
    .filter(s => s.unknownWords[0] === word && validHashes.has(s.urlHash))
    .count();

  return count;
}

/**
 * Get words that would unlock the most sentences if learned
 * Considers both i+1 and near-i+1 sentences
 */
export async function getUnlockPotentialWords(
  limit: number = 50,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<Array<{
  word: string;
  i1Count: number;
  wouldUnlockCount: number;
  totalPotential: number;
}>> {
  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  // Get all sentences with 1-3 unknowns
  const sentences = await db.sentences
    .where('unknownCount')
    .between(1, 3, true, true)
    .toArray();

  const validSentences = sentences.filter(s => validHashes.has(s.urlHash));

  // Count potential unlocks per word
  const wordPotential = new Map<string, { i1Count: number; wouldUnlock: number }>();

  for (const s of validSentences) {
    for (const word of s.unknownWords) {
      const existing = wordPotential.get(word) || { i1Count: 0, wouldUnlock: 0 };

      if (s.unknownCount === 1) {
        existing.i1Count++;
      } else if (s.unknownCount === 2) {
        // Learning this word would make the sentence i+1
        existing.wouldUnlock++;
      }

      wordPotential.set(word, existing);
    }
  }

  // Calculate total potential and sort
  return Array.from(wordPotential.entries())
    .map(([word, data]) => ({
      word,
      i1Count: data.i1Count,
      wouldUnlockCount: data.wouldUnlock,
      totalPotential: data.i1Count * 2 + data.wouldUnlock // Weight i+1 higher
    }))
    .sort((a, b) => b.totalPotential - a.totalPotential)
    .slice(0, limit);
}

/**
 * Get the best i+1 sentence for a word (for Anki card creation)
 * Prefers shorter sentences with good context
 */
export async function getBestI1Sentence(
  targetWord: string,
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<I1Sentence | null> {
  const sentences = await getI1SentencesForWord(targetWord, 50, minTimeMs, ignoreList);

  if (sentences.length === 0) return null;

  // Score sentences by quality
  const scored = sentences.map(s => {
    let score = 0;

    // Prefer medium-length sentences (not too short, not too long)
    const length = s.text.length;
    if (length >= 20 && length <= 80) {
      score += 10;
    } else if (length >= 10 && length <= 120) {
      score += 5;
    }

    // Prefer sentences with proper punctuation
    if (/[。！？]$/.test(s.text)) {
      score += 5;
    }

    // Prefer more recent sentences
    const ageInDays = (Date.now() - s.timestamp) / (1000 * 60 * 60 * 24);
    if (ageInDays < 7) {
      score += 3;
    } else if (ageInDays < 30) {
      score += 1;
    }

    return { sentence: s, score };
  });

  // Return best scored sentence
  scored.sort((a, b) => b.score - a.score);
  return scored[0].sentence;
}

/**
 * Get i+1 statistics summary
 */
export async function getI1Summary(
  minTimeMs: number = PAGE_TIME_MIN_THRESHOLD_MS,
  ignoreList?: IgnoreList
): Promise<{
  totalI1Sentences: number;
  totalNearI1Sentences: number;
  uniqueI1Words: number;
  avgI1SentencesPerWord: number;
}> {
  const validHashes = await getValidPageHashes(minTimeMs, ignoreList);

  const allSentences = await db.sentences
    .where('unknownCount')
    .between(1, 3, true, true)
    .toArray();

  const validSentences = allSentences.filter(s => validHashes.has(s.urlHash));

  const i1Sentences = validSentences.filter(s => s.unknownCount === 1);
  const nearI1Sentences = validSentences.filter(s => s.unknownCount >= 2);

  const uniqueWords = new Set(i1Sentences.map(s => s.unknownWords[0]));

  return {
    totalI1Sentences: i1Sentences.length,
    totalNearI1Sentences: nearI1Sentences.length,
    uniqueI1Words: uniqueWords.size,
    avgI1SentencesPerWord: uniqueWords.size > 0
      ? Math.round((i1Sentences.length / uniqueWords.size) * 10) / 10
      : 0
  };
}
