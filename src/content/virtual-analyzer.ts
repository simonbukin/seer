/**
 * Virtual Page Analyzer - Full page scanning without encounter recording
 *
 * Scans entire page content (not just viewport) to calculate comprehension stats
 * without recording encounters. Useful for quickly assessing content difficulty.
 */

import { walkTextNodes, walkMokuroTextNodes, isMokuroPage } from './dom-walker';
import { findWords, checkWordStatus } from './word-finder';
import { getFrequency, getFrequencyBand } from '../shared/frequency';
import { isJapaneseWord, getAllForms } from '../shared/normalization';
import type { VirtualPageStats, WordKnowledge, KnowledgeLevel, KnowledgeLevelBreakdown, DifficultyLabel, VirtualI1Sentence } from '../shared/types';
import { logger } from '../shared/logger';

// Chunk size for processing (number of text nodes per idle callback)
const SCAN_CHUNK_SIZE = 30;

// Maximum scan time before forcing completion (30 seconds)
const MAX_SCAN_TIME_MS = 30000;

// Current scan state (for cancellation)
let currentScanAbortController: AbortController | null = null;

// Regex for extracting kanji characters (CJK Unified Ideographs)
const KANJI_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/g;

// Regex for Japanese characters (hiragana, katakana, kanji) - excludes punctuation/spaces
const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/g;

// Sentence enders for Japanese text
const SENTENCE_ENDERS = /[。！？\n]/;

export interface VirtualAnalyzerVocab {
  known: Set<string>;
  ignored: Set<string>;
  knowledgeLevels: Map<string, WordKnowledge>;
}

interface VirtualAccumulatedStats {
  totalTokens: number;
  knownTokens: number;
  unknownTokens: number;
  ignoredTokens: number;
  unknownCounts: Map<string, number>;
  frequencies: number[];
  bandCounts: number[];
  matureCount: number;
  youngCount: number;
  learningCount: number;
  newCount: number;
  trueUnknownCount: number;
  countedKnowledgeWords: Set<string>;
  // New text metrics
  totalCharacters: number;             // Japanese chars only
  wordOccurrences: Map<string, number>; // word -> count (for hapax calculation)
  // Kanji metrics
  kanjiOccurrences: Map<string, number>; // kanji char -> count
  // Sentence metrics
  sentenceCount: number;
  tokensInCurrentSentence: number;
  unknownsInCurrentSentence: number;   // Track unknowns per sentence for i+1
  sentenceLengths: number[];
  i1SentenceCount: number;             // Sentences with exactly 1 unknown
  // i+1 sentence collection
  currentSentenceChunks: string[];     // Text chunks building current sentence
  currentSentenceUnknown: string | null; // Unknown word in current sentence (null if 0 or >1)
  i1Sentences: VirtualI1Sentence[];    // Collected i+1 sentences (max 50)
  // Section-based difficulty tracking (20 sections = 5% each)
  sectionFrequencies: number[][];
}

function initVirtualStats(): VirtualAccumulatedStats {
  return {
    totalTokens: 0,
    knownTokens: 0,
    unknownTokens: 0,
    ignoredTokens: 0,
    unknownCounts: new Map(),
    frequencies: [],
    bandCounts: [0, 0, 0, 0, 0],
    matureCount: 0,
    youngCount: 0,
    learningCount: 0,
    newCount: 0,
    trueUnknownCount: 0,
    countedKnowledgeWords: new Set(),
    // New metrics
    totalCharacters: 0,
    wordOccurrences: new Map(),
    kanjiOccurrences: new Map(),
    sentenceCount: 0,
    tokensInCurrentSentence: 0,
    unknownsInCurrentSentence: 0,
    sentenceLengths: [],
    i1SentenceCount: 0,
    // i+1 sentence collection
    currentSentenceChunks: [],
    currentSentenceUnknown: null,
    i1Sentences: [],
    // 20 sections for difficulty tracking (5% each)
    sectionFrequencies: Array.from({ length: 20 }, () => [])
  };
}

function getWordKnowledgeLevel(
  baseForm: string,
  surface: string,
  knowledgeLevels: Map<string, WordKnowledge>
): KnowledgeLevel | undefined {
  const forms = getAllForms(baseForm);
  forms.push(...getAllForms(surface));

  for (const form of forms) {
    const knowledge = knowledgeLevels.get(form);
    if (knowledge) return knowledge.level;
  }
  return undefined;
}

/**
 * Calculate composite difficulty score using research-backed formula.
 * Based on academic research showing word frequency is the primary predictor (R² = 0.41).
 *
 * Formula weights:
 * - 60% frequency-based (log scale from JPDB ranks)
 * - 25% comprehension-based (100 - comprehension%)
 * - 15% sentence length (normalized to 25 tokens max)
 */
function calculateDifficultyMetrics(
  frequencies: number[],
  comprehensionPercent: number,
  avgSentenceLength: number
): {
  minDifficulty: number;
  medianDifficulty: number;
  averageDifficulty: number;
  peakDifficulty: number;
  label: DifficultyLabel;
} {
  // Normalize frequency to 0-100 scale using log scale
  // JPDB rank 1 → 0, rank 50000 → 100
  const normalizeFreq = (freq: number): number => {
    if (freq <= 0) return 50; // Unknown frequency treated as medium difficulty
    return Math.min(100, (Math.log10(freq) / Math.log10(50000)) * 100);
  };

  // Calculate average frequency difficulty
  const avgFreq = frequencies.length > 0
    ? frequencies.reduce((a, b) => a + b, 0) / frequencies.length
    : 25000; // Default to medium if no frequencies
  const freqDifficulty = normalizeFreq(avgFreq);

  // Sort frequencies for percentile calculations
  const sorted = [...frequencies].sort((a, b) => a - b);

  // Calculate difficulty at various percentiles
  const p10Index = Math.floor(sorted.length * 0.1);
  const p50Index = Math.floor(sorted.length * 0.5);
  const p90Index = Math.floor(sorted.length * 0.9);

  const minFreq = sorted[p10Index] || avgFreq;  // 10th percentile (easiest words)
  const medianFreq = sorted[p50Index] || avgFreq;
  const peakFreq = sorted[p90Index] || avgFreq;

  const minDifficulty = Math.round(normalizeFreq(minFreq));
  const medianDifficulty = Math.round(normalizeFreq(medianFreq));
  const peakDifficulty = Math.round(normalizeFreq(peakFreq));

  // Comprehension difficulty (inverted - higher comprehension = lower difficulty)
  const personalDifficulty = 100 - comprehensionPercent;

  // Sentence complexity (normalized to 25 tokens as max reasonable length)
  const sentenceDifficulty = Math.min(100, (avgSentenceLength / 25) * 100);

  // Weighted composite score (research-backed weights)
  const averageDifficulty = Math.round(
    freqDifficulty * 0.60 +
    personalDifficulty * 0.25 +
    sentenceDifficulty * 0.15
  );

  // Determine label based on score
  let label: DifficultyLabel;
  if (averageDifficulty <= 25) label = 'Easy';
  else if (averageDifficulty <= 50) label = 'Moderate';
  else if (averageDifficulty <= 75) label = 'Hard';
  else label = 'Very Hard';

  return { minDifficulty, medianDifficulty, averageDifficulty, peakDifficulty, label };
}

function calculateVirtualPageStats(
  accumulated: VirtualAccumulatedStats,
  scannedNodes: number,
  totalNodes: number,
  isComplete: boolean
): VirtualPageStats {
  const countedTokens = accumulated.knownTokens + accumulated.unknownTokens;
  const comprehensionPercent = countedTokens > 0
    ? Math.round((accumulated.knownTokens / countedTokens) * 100)
    : 0;

  // Calculate frequency band percentages
  const totalWithFreq = accumulated.bandCounts.reduce((a, b) => a + b, 0);
  let veryCommonPercent = 0, commonPercent = 0, mediumPercent = 0, uncommonPercent = 0, rarePercent = 0;
  if (totalWithFreq > 0) {
    veryCommonPercent = Math.round((accumulated.bandCounts[0] / totalWithFreq) * 100);
    commonPercent = Math.round((accumulated.bandCounts[1] / totalWithFreq) * 100);
    mediumPercent = Math.round((accumulated.bandCounts[2] / totalWithFreq) * 100);
    uncommonPercent = Math.round((accumulated.bandCounts[3] / totalWithFreq) * 100);
    rarePercent = Math.round((accumulated.bandCounts[4] / totalWithFreq) * 100);
  }

  // Top unknown words
  const topUnknown = Array.from(accumulated.unknownCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));

  // Knowledge breakdown
  const totalUniqueWords = accumulated.countedKnowledgeWords.size;
  let knowledgeBreakdown: KnowledgeLevelBreakdown | undefined;
  if (totalUniqueWords > 0) {
    knowledgeBreakdown = {
      mature: Math.round((accumulated.matureCount / totalUniqueWords) * 100),
      young: Math.round((accumulated.youngCount / totalUniqueWords) * 100),
      learning: Math.round((accumulated.learningCount / totalUniqueWords) * 100),
      new: Math.round((accumulated.newCount / totalUniqueWords) * 100),
      unknown: Math.round((accumulated.trueUnknownCount / totalUniqueWords) * 100)
    };
  }

  // === NEW METRICS ===

  // Text metrics
  const uniqueWordCount = accumulated.wordOccurrences.size;
  const hapaxCount = Array.from(accumulated.wordOccurrences.values())
    .filter(count => count === 1).length;
  const hapaxPercent = uniqueWordCount > 0
    ? Math.round((hapaxCount / uniqueWordCount) * 100)
    : 0;

  // Kanji metrics
  const totalKanjiCount = Array.from(accumulated.kanjiOccurrences.values())
    .reduce((sum, count) => sum + count, 0);
  const uniqueKanjiCount = accumulated.kanjiOccurrences.size;
  const kanjiHapaxCount = Array.from(accumulated.kanjiOccurrences.values())
    .filter(count => count === 1).length;

  // Sentence metrics - finalize any pending sentence
  const allSentenceLengths = [...accumulated.sentenceLengths];
  if (accumulated.tokensInCurrentSentence > 0) {
    allSentenceLengths.push(accumulated.tokensInCurrentSentence);
  }
  const sentenceCount = allSentenceLengths.length;
  const avgSentenceLength = sentenceCount > 0
    ? Math.round((allSentenceLengths.reduce((a, b) => a + b, 0) / sentenceCount) * 10) / 10
    : 0;

  // Calculate sentence stats (median, min, max)
  let medianSentenceLength = 0;
  let minSentenceLength = 0;
  let maxSentenceLength = 0;
  if (allSentenceLengths.length > 0) {
    const sortedLengths = [...allSentenceLengths].sort((a, b) => a - b);
    const midIndex = Math.floor(sortedLengths.length / 2);
    medianSentenceLength = sortedLengths.length % 2 === 0
      ? Math.round((sortedLengths[midIndex - 1] + sortedLengths[midIndex]) / 2 * 10) / 10
      : sortedLengths[midIndex];
    minSentenceLength = sortedLengths[0];
    maxSentenceLength = sortedLengths[sortedLengths.length - 1];
  }

  // Difficulty metrics (research-backed formula)
  const difficultyMetrics = calculateDifficultyMetrics(
    accumulated.frequencies,
    comprehensionPercent,
    avgSentenceLength
  );

  // Calculate difficulty per section (normalize frequency to difficulty score)
  const normalizeFreq = (freq: number): number => {
    if (freq <= 0) return 50;
    return Math.min(100, (Math.log10(freq) / Math.log10(50000)) * 100);
  };

  const difficultyPerSection = accumulated.sectionFrequencies.map(freqs => {
    if (freqs.length === 0) return 0;
    const avgFreq = freqs.reduce((a, b) => a + b, 0) / freqs.length;
    return Math.round(normalizeFreq(avgFreq));
  });

  return {
    url: location.href,
    totalTokens: accumulated.totalTokens,
    knownTokens: accumulated.knownTokens,
    unknownTokens: accumulated.unknownTokens,
    ignoredTokens: accumulated.ignoredTokens,
    comprehensionPercent,
    topUnknown,
    knowledgeBreakdown,
    veryCommonPercent,
    commonPercent,
    mediumPercent,
    uncommonPercent,
    rarePercent,
    isComplete,
    scannedNodes,
    totalNodes,
    // Text metrics
    characterCount: accumulated.totalCharacters,
    wordCount: accumulated.totalTokens,
    uniqueWordCount,
    hapaxCount,
    hapaxPercent,
    // Kanji metrics
    totalKanjiCount,
    uniqueKanjiCount,
    kanjiHapaxCount,
    // Difficulty metrics
    minDifficulty: difficultyMetrics.minDifficulty,
    medianDifficulty: difficultyMetrics.medianDifficulty,
    averageDifficulty: difficultyMetrics.averageDifficulty,
    peakDifficulty: difficultyMetrics.peakDifficulty,
    difficultyLabel: difficultyMetrics.label,
    difficultyPerSection,
    // Sentence metrics
    sentenceCount,
    i1SentenceCount: accumulated.i1SentenceCount,
    avgSentenceLength,
    medianSentenceLength,
    minSentenceLength,
    maxSentenceLength,
    // i+1 sentence list for display
    i1Sentences: accumulated.i1Sentences
  };
}

/**
 * Run virtual analysis on the entire page.
 * Scans all text nodes and calculates comprehension stats without recording encounters.
 */
export async function runVirtualAnalysis(
  vocab: VirtualAnalyzerVocab,
  onProgress: (stats: VirtualPageStats) => void
): Promise<VirtualPageStats> {
  // Cancel any existing scan
  cancelVirtualAnalysis();

  const abortController = new AbortController();
  currentScanAbortController = abortController;

  logger.content.info('Starting virtual page analysis...');
  const startTime = Date.now();

  // Collect all text nodes upfront
  const textNodes: Text[] = [];
  const useMokuro = isMokuroPage();
  const walker = useMokuro ? walkMokuroTextNodes() : walkTextNodes();

  for (const node of walker) {
    textNodes.push(node);
  }

  const totalNodes = textNodes.length;
  logger.content.debug(`Found ${totalNodes} text nodes to analyze`);

  if (totalNodes === 0) {
    const emptyStats = calculateVirtualPageStats(initVirtualStats(), 0, 0, true);
    return emptyStats;
  }

  const accumulated = initVirtualStats();
  let scannedNodes = 0;
  const emptyIgnored = new Set<string>(); // No session-ignored for virtual analysis

  return new Promise((resolve) => {
    function processChunk(deadline: IdleDeadline) {
      // Check for cancellation
      if (abortController.signal.aborted) {
        logger.content.info('Virtual analysis cancelled');
        const cancelledStats = calculateVirtualPageStats(accumulated, scannedNodes, totalNodes, false);
        resolve(cancelledStats);
        return;
      }

      // Check for timeout
      if (Date.now() - startTime > MAX_SCAN_TIME_MS) {
        logger.content.warn('Virtual analysis timed out');
        const timedOutStats = calculateVirtualPageStats(accumulated, scannedNodes, totalNodes, true);
        resolve(timedOutStats);
        return;
      }

      // Process nodes while we have time
      while (scannedNodes < totalNodes && deadline.timeRemaining() > 0) {
        const textNode = textNodes[scannedNodes];
        const text = textNode.textContent || '';

        // Count Japanese characters (hiragana, katakana, kanji)
        const japaneseChars = text.match(JAPANESE_CHAR_REGEX);
        if (japaneseChars) {
          accumulated.totalCharacters += japaneseChars.length;
        }

        // Extract and count kanji characters
        const kanjiChars = text.match(KANJI_REGEX);
        if (kanjiChars) {
          for (const kanji of kanjiChars) {
            accumulated.kanjiOccurrences.set(
              kanji,
              (accumulated.kanjiOccurrences.get(kanji) || 0) + 1
            );
          }
        }

        // Accumulate text for sentence collection
        accumulated.currentSentenceChunks.push(text);

        // Find words in this text node FIRST (before sentence boundary check)
        // This ensures currentSentenceUnknown is set correctly before we finalize a sentence
        const matchedWords = findWords(text);

        for (const match of matchedWords) {
          // Check word status
          const status = checkWordStatus(
            match.baseForm,
            match.surface,
            vocab.known,
            vocab.ignored,
            emptyIgnored
          );

          // Get frequency and knowledge level
          const frequency = getFrequency(match.baseForm);
          const knowledgeLevel = status === 'known'
            ? getWordKnowledgeLevel(match.baseForm, match.surface, vocab.knowledgeLevels)
            : undefined;

          // Skip non-Japanese words
          if (!isJapaneseWord(match.surface)) continue;

          // Update accumulated stats
          accumulated.totalTokens++;
          accumulated.tokensInCurrentSentence++; // Track sentence length

          // Track word occurrences for hapax calculation
          accumulated.wordOccurrences.set(
            match.baseForm,
            (accumulated.wordOccurrences.get(match.baseForm) || 0) + 1
          );

          if (status === 'known') {
            accumulated.knownTokens++;
          } else if (status === 'ignored') {
            accumulated.ignoredTokens++;
          } else {
            accumulated.unknownTokens++;
            accumulated.unknownsInCurrentSentence++; // Track for i+1 calculation
            // Track the unknown word for i+1 sentence collection
            if (accumulated.unknownsInCurrentSentence === 1) {
              accumulated.currentSentenceUnknown = match.baseForm;
            } else {
              // More than 1 unknown - invalidate (not i+1)
              accumulated.currentSentenceUnknown = null;
            }
            accumulated.unknownCounts.set(
              match.baseForm,
              (accumulated.unknownCounts.get(match.baseForm) || 0) + 1
            );
          }

          // Track knowledge level per unique word
          if (!accumulated.countedKnowledgeWords.has(match.baseForm)) {
            accumulated.countedKnowledgeWords.add(match.baseForm);
            if (knowledgeLevel) {
              switch (knowledgeLevel) {
                case 'mature': accumulated.matureCount++; break;
                case 'young': accumulated.youngCount++; break;
                case 'learning': accumulated.learningCount++; break;
                case 'new': accumulated.newCount++; break;
              }
            } else if (status === 'known') {
              accumulated.matureCount++;
            } else if (status === 'unknown') {
              const knowledge = vocab.knowledgeLevels.get(match.baseForm);
              if (knowledge && knowledge.level === 'new') {
                accumulated.newCount++;
              } else {
                accumulated.trueUnknownCount++;
              }
            }
          }

          // Track frequency data
          if (frequency !== undefined) {
            accumulated.frequencies.push(frequency);
            const band = getFrequencyBand(frequency);
            accumulated.bandCounts[band]++;

            // Track frequency per 5% section (20 sections total)
            const sectionIndex = Math.min(19, Math.floor((scannedNodes / totalNodes) * 20));
            accumulated.sectionFrequencies[sectionIndex].push(frequency);
          } else {
            accumulated.bandCounts[4]++;
          }
        }

        // NOW check for sentence boundaries (after words are processed)
        // This ensures currentSentenceUnknown contains the correct word from this text node
        if (SENTENCE_ENDERS.test(text)) {
          // Finalize current sentence if we have tokens
          if (accumulated.tokensInCurrentSentence > 0) {
            accumulated.sentenceLengths.push(accumulated.tokensInCurrentSentence);
            accumulated.sentenceCount++;
            // Check if this was an i+1 sentence (exactly 1 unknown)
            if (accumulated.unknownsInCurrentSentence === 1 && accumulated.currentSentenceUnknown) {
              accumulated.i1SentenceCount++;
              // Save the sentence if we haven't collected too many
              if (accumulated.i1Sentences.length < 50) {
                const sentenceText = accumulated.currentSentenceChunks.join('').trim();
                // Extract sentence up to and including the ender
                const enderMatch = sentenceText.match(/^(.*?[。！？])/);
                const cleanSentence = enderMatch ? enderMatch[1] : sentenceText;
                // Only save if sentence is reasonably long (at least 10 chars)
                if (cleanSentence.length >= 10) {
                  accumulated.i1Sentences.push({
                    text: cleanSentence,
                    unknownWord: accumulated.currentSentenceUnknown
                  });
                }
              }
            } else if (accumulated.unknownsInCurrentSentence === 1) {
              // Had exactly 1 unknown but didn't track it - just count
              accumulated.i1SentenceCount++;
            }
            // Reset for next sentence
            accumulated.tokensInCurrentSentence = 0;
            accumulated.unknownsInCurrentSentence = 0;
            accumulated.currentSentenceChunks = [];
            accumulated.currentSentenceUnknown = null;
          }
        }

        scannedNodes++;
      }

      // Report progress
      const progressStats = calculateVirtualPageStats(accumulated, scannedNodes, totalNodes, false);
      onProgress(progressStats);

      // Check if complete
      if (scannedNodes >= totalNodes) {
        logger.content.info(
          `Virtual analysis complete: ${accumulated.totalTokens} tokens, ` +
          `${progressStats.comprehensionPercent}% comprehension`
        );
        const finalStats = calculateVirtualPageStats(accumulated, scannedNodes, totalNodes, true);
        resolve(finalStats);
        return;
      }

      // Schedule next chunk
      requestIdleCallback(processChunk);
    }

    // Start processing
    requestIdleCallback(processChunk);
  });
}

/**
 * Cancel any ongoing virtual analysis.
 */
export function cancelVirtualAnalysis(): void {
  if (currentScanAbortController) {
    currentScanAbortController.abort();
    currentScanAbortController = null;
  }
}
