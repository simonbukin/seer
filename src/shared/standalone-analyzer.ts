/**
 * Standalone Text Analyzer - Text analysis without DOM dependency
 *
 * Adapted from virtual-analyzer.ts for use in options page offline analysis.
 * Analyzes plain text and calculates comprehension stats.
 */

import { findWords, checkWordStatus } from '../content/word-finder';
import { getFrequency, getFrequencyBand } from './frequency';
import { isJapaneseWord, getAllForms } from './normalization';
import type { VirtualPageStats, WordKnowledge, KnowledgeLevel, KnowledgeLevelBreakdown, DifficultyLabel, VirtualI1Sentence } from './types';

// Chunk size for processing (characters per iteration)
const CHUNK_SIZE = 5000;

// Regex for extracting kanji characters
const KANJI_REGEX = /[\u4E00-\u9FFF\u3400-\u4DBF]/g;

// Regex for Japanese characters (hiragana, katakana, kanji)
const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/g;

// Sentence enders for Japanese text (global to find all matches)
const SENTENCE_ENDERS = /[。！？\n]/g;

export interface StandaloneAnalyzerVocab {
  known: Set<string>;
  ignored: Set<string>;
  knowledgeLevels: Map<string, WordKnowledge>;
}

export interface AnalysisProgress {
  processedChars: number;
  totalChars: number;
  isComplete: boolean;
  stats: VirtualPageStats;
}

interface AccumulatedStats {
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
  totalCharacters: number;
  wordOccurrences: Map<string, number>;
  kanjiOccurrences: Map<string, number>;
  sentenceCount: number;
  tokensInCurrentSentence: number;
  unknownsInCurrentSentence: number;
  sentenceLengths: number[];
  i1SentenceCount: number;
  currentSentenceChunks: string[];
  currentSentenceUnknown: string | null;
  i1Sentences: VirtualI1Sentence[];
  sectionFrequencies: number[][];
}

function initStats(): AccumulatedStats {
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
    totalCharacters: 0,
    wordOccurrences: new Map(),
    kanjiOccurrences: new Map(),
    sentenceCount: 0,
    tokensInCurrentSentence: 0,
    unknownsInCurrentSentence: 0,
    sentenceLengths: [],
    i1SentenceCount: 0,
    currentSentenceChunks: [],
    currentSentenceUnknown: null,
    i1Sentences: [],
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
  const normalizeFreq = (freq: number): number => {
    if (freq <= 0) return 50;
    return Math.min(100, (Math.log10(freq) / Math.log10(50000)) * 100);
  };

  const avgFreq = frequencies.length > 0
    ? frequencies.reduce((a, b) => a + b, 0) / frequencies.length
    : 25000;
  const freqDifficulty = normalizeFreq(avgFreq);

  const sorted = [...frequencies].sort((a, b) => a - b);
  const p10Index = Math.floor(sorted.length * 0.1);
  const p50Index = Math.floor(sorted.length * 0.5);
  const p90Index = Math.floor(sorted.length * 0.9);

  const minFreq = sorted[p10Index] || avgFreq;
  const medianFreq = sorted[p50Index] || avgFreq;
  const peakFreq = sorted[p90Index] || avgFreq;

  const minDifficulty = Math.round(normalizeFreq(minFreq));
  const medianDifficulty = Math.round(normalizeFreq(medianFreq));
  const peakDifficulty = Math.round(normalizeFreq(peakFreq));

  const personalDifficulty = 100 - comprehensionPercent;
  const sentenceDifficulty = Math.min(100, (avgSentenceLength / 25) * 100);

  const averageDifficulty = Math.round(
    freqDifficulty * 0.60 +
    personalDifficulty * 0.25 +
    sentenceDifficulty * 0.15
  );

  let label: DifficultyLabel;
  if (averageDifficulty <= 25) label = 'Easy';
  else if (averageDifficulty <= 50) label = 'Moderate';
  else if (averageDifficulty <= 75) label = 'Hard';
  else label = 'Very Hard';

  return { minDifficulty, medianDifficulty, averageDifficulty, peakDifficulty, label };
}

function calculatePageStats(
  accumulated: AccumulatedStats,
  processedChars: number,
  totalChars: number,
  isComplete: boolean
): VirtualPageStats {
  const countedTokens = accumulated.knownTokens + accumulated.unknownTokens;
  const comprehensionPercent = countedTokens > 0
    ? Math.round((accumulated.knownTokens / countedTokens) * 100)
    : 0;

  const totalWithFreq = accumulated.bandCounts.reduce((a, b) => a + b, 0);
  let veryCommonPercent = 0, commonPercent = 0, mediumPercent = 0, uncommonPercent = 0, rarePercent = 0;
  if (totalWithFreq > 0) {
    veryCommonPercent = Math.round((accumulated.bandCounts[0] / totalWithFreq) * 100);
    commonPercent = Math.round((accumulated.bandCounts[1] / totalWithFreq) * 100);
    mediumPercent = Math.round((accumulated.bandCounts[2] / totalWithFreq) * 100);
    uncommonPercent = Math.round((accumulated.bandCounts[3] / totalWithFreq) * 100);
    rarePercent = Math.round((accumulated.bandCounts[4] / totalWithFreq) * 100);
  }

  const topUnknown = Array.from(accumulated.unknownCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));

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

  const uniqueWordCount = accumulated.wordOccurrences.size;
  const hapaxCount = Array.from(accumulated.wordOccurrences.values())
    .filter(count => count === 1).length;
  const hapaxPercent = uniqueWordCount > 0
    ? Math.round((hapaxCount / uniqueWordCount) * 100)
    : 0;

  const totalKanjiCount = Array.from(accumulated.kanjiOccurrences.values())
    .reduce((sum, count) => sum + count, 0);
  const uniqueKanjiCount = accumulated.kanjiOccurrences.size;
  const kanjiHapaxCount = Array.from(accumulated.kanjiOccurrences.values())
    .filter(count => count === 1).length;

  const allSentenceLengths = [...accumulated.sentenceLengths];
  if (accumulated.tokensInCurrentSentence > 0) {
    allSentenceLengths.push(accumulated.tokensInCurrentSentence);
  }
  const sentenceCount = allSentenceLengths.length;
  const avgSentenceLength = sentenceCount > 0
    ? Math.round((allSentenceLengths.reduce((a, b) => a + b, 0) / sentenceCount) * 10) / 10
    : 0;

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

  const difficultyMetrics = calculateDifficultyMetrics(
    accumulated.frequencies,
    comprehensionPercent,
    avgSentenceLength
  );

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
    url: 'offline-analysis',
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
    scannedNodes: processedChars,
    totalNodes: totalChars,
    characterCount: accumulated.totalCharacters,
    wordCount: accumulated.totalTokens,
    uniqueWordCount,
    hapaxCount,
    hapaxPercent,
    totalKanjiCount,
    uniqueKanjiCount,
    kanjiHapaxCount,
    minDifficulty: difficultyMetrics.minDifficulty,
    medianDifficulty: difficultyMetrics.medianDifficulty,
    averageDifficulty: difficultyMetrics.averageDifficulty,
    peakDifficulty: difficultyMetrics.peakDifficulty,
    difficultyLabel: difficultyMetrics.label,
    difficultyPerSection,
    sentenceCount,
    i1SentenceCount: accumulated.i1SentenceCount,
    avgSentenceLength,
    medianSentenceLength,
    minSentenceLength,
    maxSentenceLength,
    i1Sentences: accumulated.i1Sentences
  };
}

/**
 * Process a chunk of text and update accumulated stats
 */
function processTextChunk(
  text: string,
  vocab: StandaloneAnalyzerVocab,
  accumulated: AccumulatedStats,
  processedChars: number,
  totalChars: number
): void {
  const emptyIgnored = new Set<string>();

  // Count Japanese characters
  const japaneseChars = text.match(JAPANESE_CHAR_REGEX);
  if (japaneseChars) {
    accumulated.totalCharacters += japaneseChars.length;
  }

  // Extract and count kanji
  const kanjiChars = text.match(KANJI_REGEX);
  if (kanjiChars) {
    for (const kanji of kanjiChars) {
      accumulated.kanjiOccurrences.set(
        kanji,
        (accumulated.kanjiOccurrences.get(kanji) || 0) + 1
      );
    }
  }

  // Split text into sentences first, then process each
  // This ensures we count sentences correctly within chunks
  const sentences = text.split(SENTENCE_ENDERS).filter(s => s.trim().length > 0);

  // If no sentence boundaries found, treat whole chunk as continuation of current sentence
  if (sentences.length === 0) {
    accumulated.currentSentenceChunks.push(text);
    processWordsInSegment(text, vocab, accumulated, processedChars, totalChars);
    return;
  }

  // Process each sentence segment
  for (let i = 0; i < sentences.length; i++) {
    const sentenceText = sentences[i];
    const isLastSegment = i === sentences.length - 1;
    const originalHasSentenceEnder = i < sentences.length - 1 || SENTENCE_ENDERS.test(text.slice(-5));

    // Add to current sentence chunks
    accumulated.currentSentenceChunks.push(sentenceText);

    // Process words in this sentence segment
    processWordsInSegment(sentenceText, vocab, accumulated, processedChars, totalChars);

    // If this segment originally ended with a sentence ender (not just a split artifact)
    // OR if there are more sentences to come, finalize this sentence
    if (!isLastSegment || originalHasSentenceEnder) {
      // Finalize current sentence
      if (accumulated.tokensInCurrentSentence > 0) {
        accumulated.sentenceLengths.push(accumulated.tokensInCurrentSentence);
        accumulated.sentenceCount++;

        // Check for i+1 sentence
        if (accumulated.unknownsInCurrentSentence === 1 && accumulated.currentSentenceUnknown) {
          accumulated.i1SentenceCount++;

          // Collect i+1 sentence if we have room
          if (accumulated.i1Sentences.length < 50) {
            const fullSentenceText = accumulated.currentSentenceChunks.join('').trim();
            if (fullSentenceText.length >= 5 && fullSentenceText.length <= 200) {
              accumulated.i1Sentences.push({
                text: fullSentenceText,
                unknownWord: accumulated.currentSentenceUnknown
              });
            }
          }
        }
      }

      // Reset sentence tracking
      accumulated.tokensInCurrentSentence = 0;
      accumulated.unknownsInCurrentSentence = 0;
      accumulated.currentSentenceChunks = [];
      accumulated.currentSentenceUnknown = null;
    }
  }
}

/**
 * Process words in a text segment and update accumulated stats
 */
function processWordsInSegment(
  text: string,
  vocab: StandaloneAnalyzerVocab,
  accumulated: AccumulatedStats,
  processedChars: number,
  totalChars: number
): void {
  const emptyIgnored = new Set<string>();

  // Find words
  const matchedWords = findWords(text);

  for (const match of matchedWords) {
    const status = checkWordStatus(
      match.baseForm,
      match.surface,
      vocab.known,
      vocab.ignored,
      emptyIgnored
    );

    const frequency = getFrequency(match.baseForm);
    const knowledgeLevel = status === 'known'
      ? getWordKnowledgeLevel(match.baseForm, match.surface, vocab.knowledgeLevels)
      : undefined;

    if (!isJapaneseWord(match.surface)) continue;

    accumulated.totalTokens++;
    accumulated.tokensInCurrentSentence++;

    accumulated.wordOccurrences.set(
      match.baseForm,
      (accumulated.wordOccurrences.get(match.baseForm) || 0) + 1
    );

    // Track section frequencies (20 sections)
    const sectionIndex = Math.min(
      19,
      Math.floor((processedChars / totalChars) * 20)
    );
    if (frequency) {
      accumulated.sectionFrequencies[sectionIndex].push(frequency);
    }

    if (frequency) {
      accumulated.frequencies.push(frequency);
      const band = getFrequencyBand(frequency);
      accumulated.bandCounts[band]++;
    }

    switch (status) {
      case 'known':
        accumulated.knownTokens++;
        if (!accumulated.countedKnowledgeWords.has(match.baseForm)) {
          accumulated.countedKnowledgeWords.add(match.baseForm);
          if (knowledgeLevel) {
            switch (knowledgeLevel) {
              case 'mature': accumulated.matureCount++; break;
              case 'young': accumulated.youngCount++; break;
              case 'learning': accumulated.learningCount++; break;
              case 'new': accumulated.newCount++; break;
            }
          }
        }
        break;
      case 'unknown':
        accumulated.unknownTokens++;
        accumulated.unknownCounts.set(
          match.baseForm,
          (accumulated.unknownCounts.get(match.baseForm) || 0) + 1
        );
        accumulated.unknownsInCurrentSentence++;

        // Track unknown word for i+1
        if (accumulated.unknownsInCurrentSentence === 1) {
          accumulated.currentSentenceUnknown = match.baseForm;
        } else {
          accumulated.currentSentenceUnknown = null;
        }

        if (!accumulated.countedKnowledgeWords.has(match.baseForm)) {
          accumulated.countedKnowledgeWords.add(match.baseForm);
          accumulated.trueUnknownCount++;
        }
        break;
      case 'ignored':
        accumulated.ignoredTokens++;
        break;
    }
  }
}

/**
 * Analyze text content and return comprehension statistics.
 * Processes in chunks using setTimeout to avoid blocking the UI.
 */
export async function analyzeText(
  text: string,
  vocab: StandaloneAnalyzerVocab,
  onProgress?: (progress: AnalysisProgress) => void
): Promise<VirtualPageStats> {
  const accumulated = initStats();
  const totalChars = text.length;
  let processedChars = 0;

  return new Promise((resolve) => {
    function processNextChunk() {
      const chunkEnd = Math.min(processedChars + CHUNK_SIZE, totalChars);
      const chunk = text.slice(processedChars, chunkEnd);

      processTextChunk(chunk, vocab, accumulated, processedChars, totalChars);

      processedChars = chunkEnd;

      const currentStats = calculatePageStats(accumulated, processedChars, totalChars, processedChars >= totalChars);

      if (onProgress) {
        onProgress({
          processedChars,
          totalChars,
          isComplete: processedChars >= totalChars,
          stats: currentStats
        });
      }

      if (processedChars < totalChars) {
        setTimeout(processNextChunk, 0);
      } else {
        resolve(currentStats);
      }
    }

    processNextChunk();
  });
}
