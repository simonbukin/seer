import { walkTextNodes, walkMokuroTextNodes, isMokuroPage } from './dom-walker';
import { getAllForms, JAPANESE_CHAR_REGEX, isJapaneseWord } from '../shared/normalization';
import { getFrequency, getFrequencyBand } from '../shared/frequency';
import type { VocabDataSerialized, TokenResult, ProcessedToken, PageStats, SeerConfig, HighlightLayerConfig, WordKnowledge, KnowledgeLevel, KnowledgeLevelBreakdown, VirtualPageStats } from '../shared/types';
import { runVirtualAnalysis, cancelVirtualAnalysis } from './virtual-analyzer';
import type { LayerId } from '../shared/highlight-defaults';
import { findWords, checkWordStatus, initWordFinder, type MatchedWord } from './word-finder';
import { WordActionHandler } from './word-actions';
import { recordEncounter, recordSentence, flushEncounters, initEncounterTracking } from './encounter-tracker';
import { initContentTracking, destroyContentTracking } from './content-tracker';
import { pageTimeTracker } from './page-time-tracker';
import { layerManager } from './layer-manager';
import { clearAllWordRanges } from './highlighter';
import { injectSpeculationRules, isSpeculationSupported } from './speculation';
import { logger } from '../shared/logger';
import { MESSAGE_TIMEOUT_MS } from '../shared/config';
import { isVerticalWritingMode, isTextNodeVertical } from './writing-mode-utils';
import { fnv1a } from '../shared/hash';

let vocab: { known: Set<string>; ignored: Set<string>; knowledgeLevels: Map<string, WordKnowledge> } | null = null;
let layerManagerInitialized = false;
let isProcessing = false;
let wordFinderInitialized = false;
let intersectionObserver: IntersectionObserver | null = null;
let processedTextNodes = new WeakSet<Text>();
let ignoreNextMutation = false;
let mutationObserver: MutationObserver | null = null;
let currentPageStats: PageStats | null = null; // For popup requests
let wordActionHandler: WordActionHandler | null = null; // For cleanup on unload
let mokuroModeEnabled = false; // Force Mokuro OCR text extraction
let virtualAnalysisInProgress = false; // Virtual analysis state

// Running stats accumulator for lazy-loaded content
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
}
let accumulatedStats: AccumulatedStats | null = null;

// Throttle for live stats broadcasts to popup
let lastStatsBroadcast = 0;
const STATS_BROADCAST_THROTTLE_MS = 500;

// In-memory ignored words (session-scoped)
const ignoredWords = new Set<string>();

// Send message to background with timeout to prevent hanging
async function sendMessage<T>(
  message: { type: string; [key: string]: unknown },
  timeoutMs: number = MESSAGE_TIMEOUT_MS
): Promise<T> {
  return Promise.race([
    new Promise<T>((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Message timeout after ${timeoutMs}ms for type: ${message.type}`)),
        timeoutMs
      )
    ),
  ]);
}

// Load vocabulary from background
async function loadVocabulary(): Promise<void> {
  logger.content.debug('Loading vocabulary from background...');
  const data = await sendMessage<VocabDataSerialized>({ type: 'getVocabulary' });
  vocab = {
    known: new Set(data.known),
    ignored: new Set(data.ignored),
    knowledgeLevels: new Map(data.knowledgeLevels || [])
  };
  logger.content.info(`Vocabulary loaded: ${vocab.known.size} known, ${vocab.ignored.size} ignored, ${vocab.knowledgeLevels.size} with knowledge levels`);
}

// Check if word is known (delegates to word-finder module)
function checkWord(baseForm: string, surface: string): 'known' | 'unknown' | 'ignored' {
  if (!vocab) return 'unknown';
  return checkWordStatus(baseForm, surface, vocab.known, vocab.ignored, ignoredWords);
}

// Get knowledge level for a word (if it exists in Anki)
function getWordKnowledgeLevel(baseForm: string, surface: string): KnowledgeLevel | undefined {
  if (!vocab) return undefined;

  // Check base form first, then surface form
  const knowledge = vocab.knowledgeLevels.get(baseForm) ||
                    vocab.knowledgeLevels.get(surface);

  return knowledge?.level;
}

// Sentence boundary pattern
const SENTENCE_ENDERS = /[。！？]/;

// Extract sentence context around a token
function extractSentence(textNode: Text, token: TokenResult): string {
  const fullText = textNode.textContent || '';

  // Find the start of the current sentence
  let sentenceStart = 0;
  for (let i = token.start - 1; i >= 0; i--) {
    if (SENTENCE_ENDERS.test(fullText[i])) {
      sentenceStart = i + 1;
      break;
    }
  }

  // Find the end of the current sentence
  let sentenceEnd = fullText.length;
  for (let i = token.end; i < fullText.length; i++) {
    if (SENTENCE_ENDERS.test(fullText[i])) {
      sentenceEnd = i + 1;
      break;
    }
  }

  return fullText.slice(sentenceStart, sentenceEnd).trim();
}

// Group tokens by their containing sentence
interface SentenceGroup {
  sentence: string;
  tokens: ProcessedToken[];
  unknownWords: string[];
}

function groupTokensBySentence(textNode: Text, tokens: ProcessedToken[]): SentenceGroup[] {
  const fullText = textNode.textContent || '';
  const sentenceMap = new Map<string, SentenceGroup>();

  for (const token of tokens) {
    // Skip non-Japanese words for sentence grouping
    if (!isJapaneseWord(token.surface)) continue;

    const sentence = extractSentence(textNode, token);
    if (!sentence) continue;

    let group = sentenceMap.get(sentence);
    if (!group) {
      group = { sentence, tokens: [], unknownWords: [] };
      sentenceMap.set(sentence, group);
    }

    group.tokens.push(token);

    // Track unknown words in this sentence (only valid Japanese words)
    if (token.status === 'unknown' && isJapaneseWord(token.surface)) {
      // Avoid duplicates within the same sentence
      if (!group.unknownWords.includes(token.baseForm)) {
        group.unknownWords.push(token.baseForm);
      }
    }
  }

  return Array.from(sentenceMap.values());
}

// Yield to main thread for better performance
function yieldToMain(): Promise<void> {
  return new Promise(resolve => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => resolve(), { timeout: 100 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

// Initialize word finder (Yomitan-style deinflection)
async function ensureWordFinderReady(): Promise<void> {
  if (wordFinderInitialized) return;
  await initWordFinder();
  wordFinderInitialized = true;
}

// Check if element is currently in viewport (strict check)
// Handles both horizontal and vertical writing modes
function isInViewport(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

  // Element must have at least some visible area in current viewport
  const hasVisibleArea = (
    rect.top < viewportHeight &&
    rect.bottom > 0 &&
    rect.left < viewportWidth &&
    rect.right > 0
  );

  return hasVisibleArea;
}

// Check if a text node is in the initial viewport (more accurate)
// Handles both horizontal and vertical writing modes
function isTextNodeInViewport(textNode: Text): boolean {
  const parent = textNode.parentElement;
  if (!parent) return false;

  const range = document.createRange();
  range.selectNode(textNode);
  const rect = range.getBoundingClientRect();
  range.detach();

  const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

  // Check if text is in vertical writing mode
  const isVertical = isTextNodeVertical(textNode);

  if (isVertical) {
    // Vertical text (tategaki): columns flow right-to-left, content scrolls horizontally
    // Check horizontal visibility with 1.5x viewport width buffer
    return rect.left < viewportWidth * 1.5 && rect.right > -100;
  } else {
    // Horizontal text: original logic
    // Check vertical visibility with 1.5x viewport height buffer
    return rect.top < viewportHeight * 1.5 && rect.bottom > -100;
  }
}

// Process a single text node using Yomitan-style word finding
async function processTextNode(textNode: Text): Promise<ProcessedToken[]> {
  // Skip if already processed
  if (processedTextNodes.has(textNode)) return [];

  const text = textNode.textContent || '';
  if (!text.trim()) return [];

  processedTextNodes.add(textNode);

  logger.content.debug(`Finding words in: "${text.substring(0, 50)}..."`);

  // Ensure word finder is ready
  await ensureWordFinderReady();

  // Find words using Yomitan-style substring scanning with deinflection
  const matchedWords = findWords(text);

  logger.content.debug(`Found ${matchedWords.length} words`);

  // Convert to ProcessedToken format
  const processed: ProcessedToken[] = matchedWords.map(word => ({
    surface: word.surface,
    baseForm: word.baseForm,
    start: word.start,
    end: word.end,
    inflectionTrace: word.inflectionTrace,
    status: checkWord(word.baseForm, word.surface),
    frequency: getFrequency(word.baseForm) || getFrequency(word.surface),
    knowledgeLevel: getWordKnowledgeLevel(word.baseForm, word.surface)
  }));

  const unknownCount = processed.filter(t => t.status === 'unknown').length;
  logger.content.debug(`Processed: ${unknownCount} unknown, ${processed.length - unknownCount} known/ignored`);

  return processed;
}

// Initialize or reset accumulated stats
function initAccumulatedStats(): void {
  accumulatedStats = {
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
    countedKnowledgeWords: new Set()
  };
}

// Update accumulated stats with new tokens
function updateAccumulatedStats(tokens: ProcessedToken[]): void {
  if (!accumulatedStats || !vocab) return;

  for (const token of tokens) {
    // Skip non-Japanese words (word-finder already filters most non-words)
    if (!isJapaneseWord(token.surface)) continue;

    accumulatedStats.totalTokens++;

    if (token.status === 'known') {
      accumulatedStats.knownTokens++;
    } else if (token.status === 'ignored') {
      accumulatedStats.ignoredTokens++;
    } else {
      accumulatedStats.unknownTokens++;
      const word = token.baseForm;
      accumulatedStats.unknownCounts.set(word, (accumulatedStats.unknownCounts.get(word) || 0) + 1);
    }

    // Track knowledge level per unique word
    if (!accumulatedStats.countedKnowledgeWords.has(token.baseForm)) {
      accumulatedStats.countedKnowledgeWords.add(token.baseForm);
      if (token.knowledgeLevel) {
        switch (token.knowledgeLevel) {
          case 'mature': accumulatedStats.matureCount++; break;
          case 'young': accumulatedStats.youngCount++; break;
          case 'learning': accumulatedStats.learningCount++; break;
          case 'new': accumulatedStats.newCount++; break;
        }
      } else if (token.status === 'known') {
        accumulatedStats.matureCount++;
      } else if (token.status === 'unknown') {
        const knowledge = vocab.knowledgeLevels.get(token.baseForm);
        if (knowledge && knowledge.level === 'new') {
          accumulatedStats.newCount++;
        } else {
          accumulatedStats.trueUnknownCount++;
        }
      }
    }

    // Track frequency data
    if (token.frequency !== undefined) {
      accumulatedStats.frequencies.push(token.frequency);
      const band = getFrequencyBand(token.frequency);
      accumulatedStats.bandCounts[band]++;
    } else {
      accumulatedStats.bandCounts[4]++;
    }
  }

  // Recalculate page stats after updating
  recalculateCurrentPageStats();
}

// Recalculate current page stats from accumulated data
function recalculateCurrentPageStats(): void {
  if (!accumulatedStats) return;

  const countedTokens = accumulatedStats.knownTokens + accumulatedStats.unknownTokens;
  const comprehensionPercent = countedTokens > 0
    ? Math.round((accumulatedStats.knownTokens / countedTokens) * 100)
    : 0;

  // Calculate average frequency
  let averageFrequency = 0;
  if (accumulatedStats.frequencies.length > 0) {
    const sum = accumulatedStats.frequencies.reduce((a, b) => a + b, 0);
    averageFrequency = Math.round(sum / accumulatedStats.frequencies.length);
  }

  // Calculate frequency band percentages
  const totalWithFreq = accumulatedStats.bandCounts.reduce((a, b) => a + b, 0);
  let veryCommonPercent = 0, commonPercent = 0, mediumPercent = 0, uncommonPercent = 0, rarePercent = 0;
  if (totalWithFreq > 0) {
    veryCommonPercent = Math.round((accumulatedStats.bandCounts[0] / totalWithFreq) * 100);
    commonPercent = Math.round((accumulatedStats.bandCounts[1] / totalWithFreq) * 100);
    mediumPercent = Math.round((accumulatedStats.bandCounts[2] / totalWithFreq) * 100);
    uncommonPercent = Math.round((accumulatedStats.bandCounts[3] / totalWithFreq) * 100);
    rarePercent = Math.round((accumulatedStats.bandCounts[4] / totalWithFreq) * 100);
  }

  // Top unknown words
  const topUnknown = Array.from(accumulatedStats.unknownCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([word, count]) => ({ word, count }));

  // Knowledge breakdown
  const totalUniqueWords = accumulatedStats.countedKnowledgeWords.size;
  let knowledgeBreakdown: KnowledgeLevelBreakdown | undefined;
  if (totalUniqueWords > 0) {
    knowledgeBreakdown = {
      mature: Math.round((accumulatedStats.matureCount / totalUniqueWords) * 100),
      young: Math.round((accumulatedStats.youngCount / totalUniqueWords) * 100),
      learning: Math.round((accumulatedStats.learningCount / totalUniqueWords) * 100),
      new: Math.round((accumulatedStats.newCount / totalUniqueWords) * 100),
      unknown: Math.round((accumulatedStats.trueUnknownCount / totalUniqueWords) * 100)
    };
  }

  currentPageStats = {
    url: location.href,
    totalTokens: accumulatedStats.totalTokens,
    knownTokens: accumulatedStats.knownTokens,
    unknownTokens: accumulatedStats.unknownTokens,
    ignoredTokens: accumulatedStats.ignoredTokens,
    comprehensionPercent,
    topUnknown,
    averageFrequency,
    veryCommonPercent,
    commonPercent,
    mediumPercent,
    uncommonPercent,
    rarePercent,
    knowledgeBreakdown
  };

  // Broadcast stats update to popup (throttled to avoid spam)
  const now = Date.now();
  if (now - lastStatsBroadcast > STATS_BROADCAST_THROTTLE_MS) {
    lastStatsBroadcast = now;
    chrome.runtime.sendMessage({ type: 'statsUpdated', stats: currentPageStats }).catch(() => {
      // Popup might not be open, that's fine
    });
  }
}

// Process entire page
async function processPage(clearExisting = false): Promise<PageStats> {
  if (isProcessing) {
    return { url: location.href, totalTokens: 0, knownTokens: 0, unknownTokens: 0, ignoredTokens: 0, comprehensionPercent: 0, topUnknown: [] };
  }

  isProcessing = true;

  try {
    // Clear existing highlights if requested (e.g., vocabulary changed)
    if (clearExisting) {
      logger.content.info('Clearing highlights and reprocessing page...');
      layerManager.clearAll();
      clearAllWordRanges(); // Clear reverse index for surgical removal
      processedTextNodes = new WeakSet<Text>(); // Reset to allow reprocessing
      accumulatedStats = null; // Reset stats accumulator
    }

    // Initialize stats accumulator if needed
    if (!accumulatedStats) {
      initAccumulatedStats();
    }

    // Load vocabulary
    await loadVocabulary();

    // Process text nodes
    logger.content.debug('Walking DOM to find Japanese text nodes...');
    const textNodes = Array.from(walkTextNodes());

    // Also check for Mokuro manga reader content (hidden text overlays)
    // Use manual mokuroMode or auto-detect based on page content
    const useMokuro = mokuroModeEnabled || isMokuroPage();
    const mokuroNodes = useMokuro ? Array.from(walkMokuroTextNodes()) : [];
    if (mokuroNodes.length > 0) {
      logger.content.debug(`Found ${mokuroNodes.length} Mokuro text nodes`);
      // Add Mokuro nodes that aren't already in textNodes
      for (const node of mokuroNodes) {
        if (!textNodes.includes(node)) {
          textNodes.push(node);
        }
      }
    }

    logger.content.debug(`Found ${textNodes.length} text nodes with Japanese content`);

    if (textNodes.length === 0) {
      logger.content.debug('No Japanese text found on this page');
      return currentPageStats || { url: location.href, totalTokens: 0, knownTokens: 0, unknownTokens: 0, ignoredTokens: 0, comprehensionPercent: 0, topUnknown: [] };
    }

    // Separate visible and non-visible text nodes for lazy loading
    const visibleNodes: Text[] = [];
    const invisibleNodes: Text[] = [];

    for (const textNode of textNodes) {
      if (isTextNodeInViewport(textNode)) {
        visibleNodes.push(textNode);
      } else {
        invisibleNodes.push(textNode);
      }
    }

    logger.content.debug(`Processing ${visibleNodes.length} visible nodes immediately, ${invisibleNodes.length} lazily`);

    // Set up IntersectionObserver for invisible nodes
    if (invisibleNodes.length > 0 && !intersectionObserver) {
      const elementsToObserve = new Set<Element>();
      for (const node of invisibleNodes) {
        if (node.parentElement && !isInViewport(node.parentElement)) {
          elementsToObserve.add(node.parentElement);
        }
      }

      if (elementsToObserve.size > 0) {
        intersectionObserver = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              // Process all text nodes in this element
              const walker = document.createTreeWalker(
                entry.target,
                NodeFilter.SHOW_TEXT,
                null
              );

              const nodesToProcess: Text[] = [];
              let node;
              while ((node = walker.nextNode())) {
                if (node.textContent && JAPANESE_CHAR_REGEX.test(node.textContent)) {
                  nodesToProcess.push(node as Text);
                }
              }

              // Process these nodes using requestIdleCallback to avoid blocking UI
              const processNode = async (textNode: Text) => {
                if (processedTextNodes.has(textNode)) return;
                try {
                  const tokens = await processTextNode(textNode);

                  // Group tokens by sentence for i+1 detection
                  const sentenceGroups = groupTokensBySentence(textNode, tokens);

                  // Record encounters and sentences (same as visible nodes)
                  for (const group of sentenceGroups) {
                    const unknownCount = group.unknownWords.length;

                    for (const token of group.tokens) {
                      if (isJapaneseWord(token.surface)) {
                        recordEncounter(
                          token.baseForm,
                          token.surface,
                          group.sentence,
                          token.frequency ?? 999999
                        );
                      }
                    }

                    // Record sentence for i+1 (min 10 chars excluding unknown words)
                    const unknownChars = group.unknownWords.reduce((sum, w) => sum + w.length, 0);
                    if (unknownCount >= 1 && unknownCount <= 3 && group.sentence.length - unknownChars >= 10) {
                      recordSentence(group.sentence, group.unknownWords);
                    }
                  }

                  // Assign each token to all applicable layers (with animation for scroll-into-view)
                  for (const token of tokens) {
                    try {
                      layerManager.assignToken(token, textNode, token.start, token.end, true);
                    } catch (e) {
                      // Range creation can fail, that's ok
                    }
                  }

                  // Update accumulated stats for lazy-loaded content
                  updateAccumulatedStats(tokens);
                } catch (e) {
                  logger.content.error('Failed to process lazy-loaded text node:', e);
                }
              };

              // Process nodes in idle time to avoid blocking scrolling
              let nodeIndex = 0;
              const processNextBatch = (deadline: IdleDeadline) => {
                while (nodeIndex < nodesToProcess.length && deadline.timeRemaining() > 0) {
                  processNode(nodesToProcess[nodeIndex]);
                  nodeIndex++;
                }
                if (nodeIndex < nodesToProcess.length) {
                  requestIdleCallback(processNextBatch, { timeout: 100 });
                }
              };

              if ('requestIdleCallback' in window) {
                requestIdleCallback(processNextBatch, { timeout: 100 });
              } else {
                // Fallback for browsers without requestIdleCallback
                nodesToProcess.forEach(node => processNode(node));
              }

              // Unobserve after processing
              intersectionObserver?.unobserve(entry.target);
            }
          }
        }, {
          rootMargin: '200px' // Symmetric margin for both horizontal (vertical text) and vertical scrolling
        });

        for (const element of elementsToObserve) {
          intersectionObserver.observe(element);
        }
      }
    }

    // Process visible nodes immediately
    let processedNodes = 0;
    for (const textNode of visibleNodes) {
      try {
        const tokens = await processTextNode(textNode);

        // Group tokens by sentence for i+1 detection
        const sentenceGroups = groupTokensBySentence(textNode, tokens);

        // Update accumulated stats (this also updates currentPageStats)
        updateAccumulatedStats(tokens);

        // Record ALL words with sentence context
        // Page time filtering happens at query time, not record time
        for (const group of sentenceGroups) {
          const unknownCount = group.unknownWords.length;

          // Record each valid Japanese word in the sentence
          for (const token of group.tokens) {
            if (isJapaneseWord(token.surface)) {
              recordEncounter(
                token.baseForm,
                token.surface,
                group.sentence,
                token.frequency ?? 999999 // Default to very rare if no frequency
              );
            }
          }

          // Record sentence for i+1 detection (min 10 chars excluding unknown words)
          const unknownChars = group.unknownWords.reduce((sum, w) => sum + w.length, 0);
          if (unknownCount >= 1 && unknownCount <= 3 && group.sentence.length - unknownChars >= 10) {
            recordSentence(group.sentence, group.unknownWords);
          }
        }

        // Assign each token to all applicable highlight layers (with animation for initial load)
        for (const token of tokens) {
          try {
            layerManager.assignToken(token, textNode, token.start, token.end, true);
          } catch (e) {
            // Range creation can fail for certain nodes, that's ok
          }
        }

        const unknownCount = tokens.filter(t => t.status === 'unknown').length;
        if (unknownCount > 0) {
          logger.content.debug(`Added ${unknownCount} unknown words to highlight layers in node ${processedNodes + 1}`);
        }

        processedNodes++;

        // Yield to main thread occasionally
        if (accumulatedStats && accumulatedStats.totalTokens % 500 === 0) {
          await yieldToMain();
        }
      } catch (e) {
        logger.content.error('Failed to process text node:', e);
      }
    }

    logger.content.debug(`Processed ${processedNodes} text nodes`);

    // Stats are already calculated by updateAccumulatedStats -> recalculateCurrentPageStats
    // Just report to background
    if (currentPageStats) {
      await sendMessage({ type: 'reportStats', stats: currentPageStats });
    }

    return currentPageStats || { url: location.href, totalTokens: 0, knownTokens: 0, unknownTokens: 0, ignoredTokens: 0, comprehensionPercent: 0, topUnknown: [] };
  } finally {
    isProcessing = false;
  }
}

// Initialize
async function init() {
  // Check if enabled and get config
  const config = await sendMessage<SeerConfig>({ type: 'getConfig' });
  if (!config.enabled) {
    logger.content.info('Seer is disabled');
    return;
  }

  // Load mokuro mode from config
  mokuroModeEnabled = config.mokuroMode || false;

  // Check if this page/domain is ignored
  const ignoreCheck = await sendMessage<{ ignored: boolean; reason?: 'domain' | 'url' }>({
    type: 'isPageIgnored',
    url: location.href
  });
  if (ignoreCheck.ignored) {
    logger.content.info(`Page ignored (${ignoreCheck.reason}): ${location.href}`);
    return;
  }

  logger.content.info('Processing page...');

  // Initialize layer manager with highlight config
  if (!layerManagerInitialized) {
    layerManager.initialize(config.highlightConfig);
    layerManagerInitialized = true;
  }

  // Apply master toggle visibility setting from config
  if (config.highlightsVisible === false) {
    const styleId = 'seer-highlight-visibility';
    if (!document.getElementById(styleId)) {
      const styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.textContent = `
        ::highlight(seer-freq-very-common),
        ::highlight(seer-freq-common),
        ::highlight(seer-freq-medium),
        ::highlight(seer-freq-uncommon),
        ::highlight(seer-freq-rare),
        ::highlight(seer-status-unknown),
        ::highlight(seer-status-known),
        ::highlight(seer-status-ignored),
        ::highlight(seer-knowledge-new),
        ::highlight(seer-knowledge-learning),
        ::highlight(seer-knowledge-young),
        ::highlight(seer-knowledge-mature) {
          background-color: transparent !important;
          text-decoration: none !important;
          color: inherit !important;
        }
      `;
      (document.head || document.documentElement).appendChild(styleEl);
    }
  }

  // Start page time tracking (for filtering encounters by reading time)
  pageTimeTracker.start();

  // Initialize encounter tracking with visibility change handler
  initEncounterTracking();

  // Initialize content tracking for SPA support
  initContentTracking();

  const stats = await processPage();
  logger.content.info(`${stats.comprehensionPercent}% comprehension (${stats.knownTokens}/${stats.totalTokens} tokens)`);

  // Inject speculation rules for Japanese links (if supported)
  if (isSpeculationSupported()) {
    injectSpeculationRules();
  }

  // Initialize word action handler (click to ignore/mark known words)
  // Uses instant surgical removal instead of full page rescan
  wordActionHandler = new WordActionHandler(
    // onIgnore callback (Shift+I)
    (baseForm) => {
      // 1. Instant: Add all normalized forms to in-memory ignored set
      const forms = getAllForms(baseForm);
      for (const form of forms) {
        ignoredWords.add(form);
      }

      // 2. Instant: Surgically remove highlights for all forms of this word
      let totalRemoved = 0;
      for (const form of forms) {
        totalRemoved += layerManager.removeWordHighlights(form);
      }
      logger.content.debug(`Removed ${totalRemoved} highlights for ignored word: ${baseForm}`);

      // 3. Instant: Update stats (decrement unknown, increment ignored)
      if (accumulatedStats) {
        const count = accumulatedStats.unknownCounts.get(baseForm) || 0;
        if (count > 0) {
          accumulatedStats.unknownTokens -= count;
          accumulatedStats.ignoredTokens += count;
          accumulatedStats.unknownCounts.delete(baseForm);
          recalculateCurrentPageStats();
        }
      }

      // 4. Background: Sync to Anki (fire and forget - don't block UI)
      sendMessage<{ success: boolean; error?: string }>({
        type: 'addIgnoredWord',
        word: baseForm
      }).catch((e) => {
        logger.content.warn('Could not add to Anki (Anki may not be running):', e);
      });
    },
    // onMarkKnown callback (Shift+K)
    (baseForm) => {
      // 1. Instant: Add all normalized forms to in-memory known set
      const forms = getAllForms(baseForm);
      for (const form of forms) {
        if (vocab) vocab.known.add(form);
      }

      // 2. Instant: Surgically remove highlights for all forms of this word
      // (word is now known, so it shouldn't be highlighted as unknown)
      let totalRemoved = 0;
      for (const form of forms) {
        totalRemoved += layerManager.removeWordHighlights(form);
      }
      logger.content.debug(`Removed ${totalRemoved} highlights for known word: ${baseForm}`);

      // 3. Instant: Update stats (decrement unknown, increment known)
      if (accumulatedStats) {
        const count = accumulatedStats.unknownCounts.get(baseForm) || 0;
        if (count > 0) {
          accumulatedStats.unknownTokens -= count;
          accumulatedStats.knownTokens += count;
          accumulatedStats.unknownCounts.delete(baseForm);
          recalculateCurrentPageStats();
        }
      }

      // 4. Background: Sync to Anki (fire and forget - don't block UI)
      sendMessage<{ success: boolean; error?: string }>({
        type: 'addKnownWord',
        word: baseForm
      }).catch((e) => {
        logger.content.warn('Could not add to Anki (Anki may not be running):', e);
      });
    }
  );

  // Watch for DOM changes (for SPAs and Mokuro)
  // Use manual mokuroMode or auto-detect
  const useMokuro = mokuroModeEnabled || isMokuroPage();

  mutationObserver = new MutationObserver((mutations) => {
    // Ignore our own highlighting changes
    if (ignoreNextMutation) {
      ignoreNextMutation = false;
      return;
    }

    // Check if mutations contain actual new content (not just our highlights)
    let hasNewContent = false;
    let hasMokuroContent = false;

    for (const mutation of mutations) {
      // Check for Mokuro-specific changes (text content changes in OCR containers)
      if (mutation.type === 'characterData') {
        // Check if this text change is inside a Mokuro OCR container
        const parent = mutation.target.parentElement;
        if (parent?.closest('.textBox') || parent?.closest('.ocrtext')) {
          hasMokuroContent = true;
          break;
        }
      }

      // Skip if mutation is adding/removing our own highlight elements
      if (mutation.type === 'childList') {
        for (const node of mutation.addedNodes) {
          // Skip if it's a style element or our own span highlights
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            if (element.id === 'seer-highlight-styles' || element.classList?.contains('seer-unknown')) {
              continue;
            }

            // Check if this is a Mokuro OCR container or contains them
            if (element.classList?.contains('textBox') || element.querySelector?.('.textBox') ||
                element.classList?.contains('ocrtext') || element.querySelector?.('.ocrtext')) {
              hasMokuroContent = true;
            }
          }
          hasNewContent = true;
        }

        // Also check if we're adding content inside an OCR container
        if (mutation.target instanceof Element &&
            (mutation.target.closest('.textBox') || mutation.target.closest('.ocrtext'))) {
          hasMokuroContent = true;
        }
      }

      if (hasNewContent || hasMokuroContent) break;
    }

    if (!hasNewContent && !hasMokuroContent) return;

    // Debounce - only process if there's actual new content
    clearTimeout((mutationObserver as any).timeout);
    (mutationObserver as any).timeout = setTimeout(() => {
      if (hasMokuroContent) {
        logger.content.debug('Detected Mokuro content change, processing...');
      } else {
        logger.content.debug('Detected new content, processing...');
      }
      processPage();
    }, 1000);
  });

  // For Mokuro pages, also observe characterData changes to catch text updates
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: useMokuro, // Only observe characterData on Mokuro pages
    characterDataOldValue: false
  });
}

// Cleanup resources before page unload
window.addEventListener('beforeunload', () => {
  // Stop page time tracker (flushes accumulated time)
  pageTimeTracker.stop();

  // Flush pending word encounters
  flushEncounters();

  // Cleanup content tracking
  destroyContentTracking();

  // Cleanup observers to prevent memory leaks
  mutationObserver?.disconnect();
  mutationObserver = null;

  intersectionObserver?.disconnect();
  intersectionObserver = null;

  // Cleanup word action handler
  wordActionHandler?.destroy();
  wordActionHandler = null;
});

// Show toast notification (for keyboard shortcuts feedback)
function showToast(text: string, duration = 2000, isError = false) {
  const existing = document.querySelector('.seer-toast');
  existing?.remove();

  const toast = document.createElement('div');
  toast.className = `seer-toast ${isError ? 'seer-toast-error' : ''}`;
  toast.textContent = text;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), duration);
}

// Scroll to and highlight a specific sentence in the page
function scrollToSentence(sentence: string): boolean {
  if (!sentence) return false;

  // Normalize the sentence for matching
  const normalizedSentence = sentence.trim();

  // Create a TreeWalker to find text nodes
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        // Skip hidden elements
        const el = node.parentElement;
        if (!el) return NodeFilter.FILTER_SKIP;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') {
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  // Helper to apply sparkle effect
  const applySparkle = (el: HTMLElement) => {
    // Scroll into view
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Add sparkle class for animation
    el.classList.add('seer-sparkle-highlight');

    // Remove class after animation completes
    setTimeout(() => {
      el.classList.remove('seer-sparkle-highlight');
    }, 2500);

    logger.content.info(`Scrolled to sentence with sparkle effect`);
  };

  // Search for the sentence
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent || '';
    if (text.includes(normalizedSentence)) {
      // Found it! Scroll to it and highlight
      const el = node.parentElement;
      if (el) {
        applySparkle(el);
        return true;
      }
    }
  }

  // Try substring matching if exact match failed
  const words = normalizedSentence.split(/\s+/).slice(0, 5).join('');
  if (words.length > 10) {
    const walker2 = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while ((node = walker2.nextNode() as Text | null)) {
      const text = (node.textContent || '').replace(/\s+/g, '');
      if (text.includes(words)) {
        const el = node.parentElement;
        if (el) {
          applySparkle(el);
          return true;
        }
      }
    }
  }

  logger.content.info(`Could not find sentence: "${normalizedSentence.slice(0, 50)}..."`);
  return false;
}

// Listen for messages from popup/options
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'showToast') {
    showToast(message.text, message.duration || 2000, message.isError || false);
    sendResponse({ success: true });
  } else if (message.type === 'setHighlightingEnabled') {
    // Just toggle CSS visibility - don't stop processing
    const styleId = 'seer-highlight-visibility';
    let styleEl = document.getElementById(styleId);

    if (message.enabled) {
      // Show highlights: remove the hiding style
      styleEl?.remove();
    } else {
      // Hide highlights: inject CSS that hides all highlight layers
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = `
          ::highlight(seer-freq-very-common),
          ::highlight(seer-freq-common),
          ::highlight(seer-freq-medium),
          ::highlight(seer-freq-uncommon),
          ::highlight(seer-freq-rare),
          ::highlight(seer-status-unknown),
          ::highlight(seer-status-known),
          ::highlight(seer-status-ignored),
          ::highlight(seer-knowledge-new),
          ::highlight(seer-knowledge-learning),
          ::highlight(seer-knowledge-young),
          ::highlight(seer-knowledge-mature) {
            background-color: transparent !important;
            text-decoration: none !important;
            color: inherit !important;
          }
        `;
        (document.head || document.documentElement).appendChild(styleEl);
      }
    }
    // Show toast feedback
    showToast(`Highlights ${message.enabled ? 'visible' : 'hidden'}`, 1500);
    sendResponse({ success: true });
  } else if (message.type === 'toggleLayer') {
    layerManager.toggleLayer(message.layerId as LayerId, message.enabled);
    sendResponse({ success: true });
  } else if (message.type === 'updateLayerStyle') {
    layerManager.updateLayerConfig(message.layerId as LayerId, message.config);
    sendResponse({ success: true });
  } else if (message.type === 'updateHighlightConfig') {
    layerManager.updateConfig(message.config);
    sendResponse({ success: true });
  } else if (message.type === 'getPageStats') {
    sendResponse(currentPageStats);
  } else if (message.type === 'getHighlightConfig') {
    sendResponse(layerManager.getConfig());
  } else if (message.type === 'scrollToSentence') {
    // Find and scroll to a sentence in the page
    scrollToSentence(message.sentence);
    sendResponse({ success: true });
  } else if (message.type === 'setMokuroMode') {
    // Update local state and trigger rescan
    mokuroModeEnabled = message.enabled;
    logger.content.info(`Mokuro mode ${message.enabled ? 'enabled' : 'disabled'}, rescanning page...`);

    // Need to reinitialize the MutationObserver with new characterData setting
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: mokuroModeEnabled || isMokuroPage(),
        characterDataOldValue: false
      });
    }

    // Clear and reprocess the page
    processPage(true).then(() => {
      sendResponse({ success: true });
    });
    return true; // Keep channel open for async response
  } else if (message.type === 'triggerVirtualAnalysis') {
    // Run virtual analysis on entire page (no encounter recording)
    if (!vocab) {
      sendResponse({ success: false, error: 'Vocabulary not loaded' });
      return true;
    }

    if (virtualAnalysisInProgress) {
      sendResponse({ success: false, error: 'Analysis already in progress' });
      return true;
    }

    virtualAnalysisInProgress = true;

    runVirtualAnalysis(vocab, (stats: VirtualPageStats) => {
      // Broadcast progress updates to sidepanel
      chrome.runtime.sendMessage({ type: 'virtualStatsUpdated', stats }).catch(() => {
        // Sidepanel might not be open
      });
    }).then((finalStats) => {
      virtualAnalysisInProgress = false;

      // Store static page stats (only if page has been tracked and stats not already stored)
      if (finalStats.isComplete && finalStats.characterCount !== undefined) {
        const urlHash = fnv1a(location.href);
        chrome.runtime.sendMessage({
          type: 'storePageStats',
          urlHash,
          stats: {
            characterCount: finalStats.characterCount,
            uniqueWordCount: finalStats.uniqueWordCount,
            uniqueKanjiCount: finalStats.uniqueKanjiCount,
            averageDifficulty: finalStats.averageDifficulty,
            difficultyLabel: finalStats.difficultyLabel
          }
        }).catch(() => {
          // Service worker might not be ready
        });
      }

      sendResponse({ success: true, stats: finalStats });
    }).catch((error) => {
      virtualAnalysisInProgress = false;
      sendResponse({ success: false, error: error.message });
    });

    return true; // Keep channel open for async response
  } else if (message.type === 'cancelVirtualAnalysis') {
    cancelVirtualAnalysis();
    virtualAnalysisInProgress = false;
    sendResponse({ success: true });
  }
  return true;
});

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
