import {
  TokensMessage,
  TokensResponse,
  ToggleHighlightsContentMessage,
  ToggleI1SentenceModeContentMessage,
  HighlightStyle,
  GradientColors,
  IgnoredWordsSettings,
} from "./types";
import {
  initializeFrequencyDB,
  getFrequencyRank,
  getColorForFrequency,
  getSingleColor,
  applyHighlightStyle,
  loadSettings,
  generateFrequencyCSS,
} from "./frequency-db";
import {
  getIgnoredWordsSettings,
  getIgnoredWords,
  addIgnoredWord,
  setupIgnoredWords,
  checkAnkiConnect,
} from "./anki-connect";
import { segmentJapanese, TokenSegment } from "./kuromoji-tokenizer";
import { StatsPanel } from "./stats-panel";
import { StatsManager } from "./stats-manager";

const CLS = "seer-word-unknown";

// Kuromoji tokenizer is now used instead of Intl.Segmenter
// The segmentJapanese function provides the tokenization functionality

// Settings and frequency data
let settings = {
  colorIntensity: 0.7,
  showStats: true,
  highlightStyle: "underline" as HighlightStyle,
  useFrequencyColors: true,
  singleColor: "#ff6b6b",
  showFrequencyOnHover: false,
  preserveTextColor: false,
};

// Highlight state
let highlightsEnabled = true;

// i+1 sentence mode state
let i1SentenceMode = false;

// Ignored words state
let ignoredWords = new Set<string>();
let ignoredWordsSettings: IgnoredWordsSettings = {
  deckName: "SeerIgnored",
  noteType: "Seer",
  fieldName: "Word",
  enabled: false,
};

// Frequency cache for current page words
const pageFrequencyCache = new Map<string, number | null>();

// New stats system
let statsPanel: StatsPanel | null = null;
let statsManager: StatsManager | null = null;

// Kuromoji tokenizer initialization happens automatically when first used
console.log("✅ Kuromoji tokenizer will be initialized on first use");

// Initialize frequency database and settings
async function initializeExtension(): Promise<void> {
  try {
    console.log("🚀 Initializing frequency database...");
    await initializeFrequencyDB();

    console.log("⚙️ Loading settings...");
    settings = await loadSettings();

    // Load highlight state from storage
    const result = await chrome.storage.sync.get({
      highlightsEnabled: true,
      i1SentenceMode: false,
    });
    highlightsEnabled = result.highlightsEnabled;
    i1SentenceMode = result.i1SentenceMode;

    // Load ignored words settings and data
    console.log("📝 Loading ignored words...");
    ignoredWordsSettings = await getIgnoredWordsSettings();

    if (ignoredWordsSettings.enabled) {
      try {
        // Check if AnkiConnect is available
        const ankiAvailable = await checkAnkiConnect();
        if (ankiAvailable) {
          // Setup deck and note type if needed
          await setupIgnoredWords(ignoredWordsSettings);
          // Load ignored words
          ignoredWords = await getIgnoredWords(ignoredWordsSettings);
          console.log(
            `✅ Loaded ${ignoredWords.size} ignored words from deck "${ignoredWordsSettings.deckName}"`
          );
          console.log(
            `📝 Sample ignored words:`,
            Array.from(ignoredWords).slice(0, 5)
          );
        } else {
          console.warn("⚠️ AnkiConnect not available, ignored words disabled");
          ignoredWordsSettings.enabled = false;
        }
      } catch (error) {
        console.warn("⚠️ Failed to load ignored words:", error);
        ignoredWordsSettings.enabled = false;
      }
    }

    console.log("✅ Extension initialization complete");
    console.log(`🎨 Highlights ${highlightsEnabled ? "enabled" : "disabled"}`);
    console.log(
      `🔤 i+1 Sentence Mode ${i1SentenceMode ? "enabled" : "disabled"}`
    );
    console.log(
      `📝 Ignored words ${
        ignoredWordsSettings.enabled ? "enabled" : "disabled"
      }`
    );
  } catch (error) {
    console.warn("⚠️ Extension initialization failed, using defaults:", error);
  }
}

// Function to remove all highlights from the page
function removeAllHighlights(): void {
  console.log("🧹 Removing all highlights...");

  const highlightedElements = document.querySelectorAll(`.${CLS}`);
  let removedCount = 0;

  highlightedElements.forEach((element) => {
    const parent = element.parentNode;
    if (parent) {
      // Replace the span with its text content
      const textNode = document.createTextNode(element.textContent || "");
      parent.replaceChild(textNode, element);
      removedCount++;
    }
  });

  // Normalize text nodes to merge adjacent ones
  normalizeTextNodes(document.body);

  console.log(`✅ Removed ${removedCount} highlights`);
}

// Function to normalize text nodes (merge adjacent text nodes)
function normalizeTextNodes(node: Node): void {
  if (node.nodeType === Node.ELEMENT_NODE) {
    // Process child nodes
    const children = Array.from(node.childNodes);
    children.forEach((child) => normalizeTextNodes(child));

    // Merge adjacent text nodes
    let i = 0;
    while (i < node.childNodes.length - 1) {
      const current = node.childNodes[i];
      const next = node.childNodes[i + 1];

      if (
        current.nodeType === Node.TEXT_NODE &&
        next.nodeType === Node.TEXT_NODE
      ) {
        current.textContent =
          (current.textContent || "") + (next.textContent || "");
        node.removeChild(next);
      } else {
        i++;
      }
    }
  }
}

// Function to restore highlights using the last known unknown words
function restoreHighlights(): void {
  console.log("🎨 Restoring highlights by performing fresh scan...");
  scan().catch((error) => console.error("❌ Error during scan:", error));
}

// Function to segment text into sentences
function segmentIntoSentences(text: string): string[] {
  // Split by sentence-ending punctuation, keeping the punctuation
  const sentences = text
    .split(/([。！？\.!?]+)/)
    .filter((s) => s.trim().length > 0);

  // Recombine sentences with their punctuation
  const result: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) {
    const sentence = sentences[i];
    const punctuation = sentences[i + 1] || "";
    if (sentence.trim()) {
      result.push((sentence + punctuation).trim());
    }
  }

  return result;
}

// Interface for sentence extraction
interface ExtractedSentence {
  text: string;
  elements: Element[];
  textNodes: Text[];
  startOffset: number;
  endOffset: number;
}

// Function to extract complete sentences from DOM elements
function extractSentencesFromElement(element: Element): ExtractedSentence[] {
  const sentences: ExtractedSentence[] = [];

  // Get all text content from the element
  const fullText = element.textContent || "";
  if (!fullText.trim()) return sentences;

  // Split into sentences
  const sentenceTexts = segmentIntoSentences(fullText);
  if (sentenceTexts.length === 0) return sentences;

  // For each sentence, find the corresponding DOM nodes
  let currentOffset = 0;

  for (const sentenceText of sentenceTexts) {
    const startOffset = fullText.indexOf(sentenceText, currentOffset);
    if (startOffset === -1) continue;

    const endOffset = startOffset + sentenceText.length;

    // Find all text nodes and elements that contribute to this sentence
    const sentenceNodes = findNodesForTextRange(
      element,
      startOffset,
      endOffset
    );

    if (sentenceNodes.textNodes.length > 0) {
      sentences.push({
        text: sentenceText,
        elements: sentenceNodes.elements,
        textNodes: sentenceNodes.textNodes,
        startOffset,
        endOffset,
      });
    }

    currentOffset = endOffset;
  }

  return sentences;
}

// Helper function to find DOM nodes for a specific text range
function findNodesForTextRange(
  element: Element,
  startOffset: number,
  endOffset: number
): {
  elements: Element[];
  textNodes: Text[];
} {
  const result = {
    elements: [] as Element[],
    textNodes: [] as Text[],
  };

  let currentOffset = 0;

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;

      const tagName = parent.tagName.toLowerCase();
      if (tagName === "script" || tagName === "style") {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const text = textNode.data;
    const nodeStart = currentOffset;
    const nodeEnd = currentOffset + text.length;

    // Check if this text node overlaps with our target range
    if (nodeEnd > startOffset && nodeStart < endOffset) {
      result.textNodes.push(textNode);

      // Add the parent element if not already included
      const parentElement = textNode.parentElement;
      if (parentElement && !result.elements.includes(parentElement)) {
        result.elements.push(parentElement);
      }
    }

    currentOffset = nodeEnd;
  }

  return result;
}

// Function to toggle highlights on/off
function toggleHighlights(enabled: boolean): void {
  highlightsEnabled = enabled;

  if (enabled) {
    console.log("🎨 Enabling highlights...");
    restoreHighlights();
  } else {
    console.log("🚫 Disabling highlights...");
    removeAllHighlights();
  }

  // Update stats panel visibility if needed
  if (statsPanel) {
    statsPanel.setVisible(settings.showStats && enabled);
  }
}

// Function to toggle i+1 sentence mode
function toggleI1SentenceMode(enabled: boolean): void {
  i1SentenceMode = enabled;

  if (enabled) {
    console.log("🔤 Enabling i+1 sentence mode...");
    // Remove all existing highlights first
    removeAllHighlights();
    // Perform fresh scan in i+1 mode
    scan().catch((error) => console.error("❌ Error during i+1 scan:", error));
  } else {
    console.log("🚫 Disabling i+1 sentence mode...");
    // Remove all highlights and restore normal mode if highlights are enabled
    removeAllHighlights();
    if (highlightsEnabled) {
      restoreHighlights();
    }
  }
}

// Dynamic CSS for gradient highlighting
const style = document.createElement("style");

function injectCSS(): void {
  // Inject the main CSS file
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("styles/main.css");
  document.head.appendChild(link);
}

function updateCSSVariables(): void {
  // Update CSS custom properties based on current settings
  const root = document.documentElement;

  // Update highlight intensity
  root.style.setProperty(
    "--highlight-intensity",
    settings.colorIntensity.toString()
  );

  // Update single color settings
  root.style.setProperty("--single-highlight-color", settings.singleColor);
  root.style.setProperty(
    "--single-highlight-bg-color",
    `${settings.singleColor}4D`
  ); // 30% opacity
}

// Initialize CSS
injectCSS();
updateCSSVariables();

// Initialize new stats system
function initializeStatsSystem(): void {
  if (statsPanel || statsManager) return;

  // Create stats manager
  statsManager = new StatsManager();

  // Create stats panel
  statsPanel = new StatsPanel();

  // Connect them
  statsManager.onStatsUpdate((stats) => {
    if (statsPanel) {
      statsPanel.updateStats(stats);
    }
  });

  // Show/hide based on settings
  if (statsPanel) {
    statsPanel.setVisible(settings.showStats && highlightsEnabled);
  }
}

function destroyStatsSystem(): void {
  if (statsPanel) {
    statsPanel.destroy();
    statsPanel = null;
  }
  if (statsManager) {
    statsManager.destroy();
    statsManager = null;
  }
}

// Function to re-apply highlighting with new settings
async function reapplyHighlighting(): Promise<void> {
  if (!highlightsEnabled) return;

  console.log("🎨 Re-applying highlighting with new settings...");

  const highlightedWords = document.querySelectorAll(`.${CLS}`);

  // Use Promise.all to handle all async operations properly
  const promises = Array.from(highlightedWords).map(async (element) => {
    const word = element.textContent?.trim();
    if (word) {
      await applyFrequencyColoring(element as HTMLElement, word);
    }
  });

  await Promise.all(promises);
  console.log(`✅ Re-applied highlighting to ${highlightedWords.length} words`);
}

// Flag to prevent scanning during our own DOM modifications
let isModifyingDOM = false;

// Sentence-aware scanning for i+1 mode
async function scanSentences(root: Node = document.body): Promise<void> {
  if (isModifyingDOM) return;

  console.log("🔤 Starting sentence-aware scan for i+1 mode...");

  const allTokens = new Set<string>();
  const sentenceData: Array<{
    sentence: ExtractedSentence;
    tokens: string[];
    unknownTokens: string[];
  }> = [];

  // Find all block-level elements that likely contain complete sentences
  const blockElements = (root as Element).querySelectorAll(
    "p, div, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, article, section, aside, main, header, footer, nav"
  );

  // Also include the root if it's an element
  const elementsToProcess =
    root.nodeType === Node.ELEMENT_NODE
      ? [root as Element, ...Array.from(blockElements)]
      : Array.from(blockElements);

  for (const element of elementsToProcess) {
    // Skip if this element is inside another element we're already processing
    const isNested = elementsToProcess.some(
      (other) => other !== element && other.contains(element)
    );
    if (isNested) continue;

    // Extract sentences from this element
    const sentences = extractSentencesFromElement(element);

    for (const sentence of sentences) {
      try {
        // Tokenize the complete sentence
        const segments = await segmentJapanese(sentence.text);
        const tokens: string[] = [];

        for (const segment of segments) {
          if (segment.isWordLike) {
            const token = segment.segment.trim();
            if (
              token.length > 0 &&
              /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(token)
            ) {
              tokens.push(token);
              allTokens.add(token);
            }
          }
        }

        if (tokens.length > 0) {
          sentenceData.push({
            sentence,
            tokens,
            unknownTokens: [], // Will be filled after we get response from background
          });

          console.log(
            `📝 Sentence: "${sentence.text.substring(0, 50)}..." -> ${
              tokens.length
            } tokens`
          );
        }
      } catch (error) {
        console.warn("❌ Error tokenizing sentence:", error);
      }
    }
  }

  console.log(
    `📊 Sentence scan complete: ${sentenceData.length} sentences, ${allTokens.size} unique tokens`
  );

  if (allTokens.size === 0) {
    console.log("⚠️ No Japanese tokens found in sentences");
    return;
  }

  // Send tokens to background script
  const message: TokensMessage = {
    type: "TOKENS",
    tokens: Array.from(allTokens),
  };

  chrome.runtime.sendMessage(message, async (response: TokensResponse) => {
    if (chrome.runtime.lastError) {
      console.error("❌ Error sending message:", chrome.runtime.lastError);
      return;
    }

    if (response && response.unknown) {
      const unknownSet = new Set(
        response.unknown.filter((word) => !ignoredWords.has(word))
      );

      console.log(`📥 Received ${response.unknown.length} unknown words`);

      // Analyze each sentence for i+1 status
      let i1SentenceCount = 0;
      let totalHighlightedWords = 0;

      for (const data of sentenceData) {
        // Count unknown words in this sentence
        data.unknownTokens = data.tokens.filter((token) =>
          unknownSet.has(token)
        );

        // Only process i+1 sentences (exactly 1 unknown word)
        if (data.unknownTokens.length === 1) {
          i1SentenceCount++;
          const unknownWord = data.unknownTokens[0];

          console.log(
            `🎯 i+1 sentence found: "${data.sentence.text.substring(
              0,
              50
            )}..." with unknown word: "${unknownWord}"`
          );

          // Highlight the unknown word in this sentence
          const highlighted = await highlightWordInSentence(
            data.sentence,
            unknownWord
          );
          totalHighlightedWords += highlighted;
        }
      }

      console.log(
        `✨ Found ${i1SentenceCount} i+1 sentences, highlighted ${totalHighlightedWords} words`
      );

      // Update stats via manager
      if (statsManager) {
        const unknownWords = new Set(
          response.unknown.filter((word) => !ignoredWords.has(word))
        );
        await statsManager.updateStats(allTokens, unknownWords, ignoredWords);
      }
    }
  });
}

// Function to highlight a specific word within a sentence's DOM nodes
async function highlightWordInSentence(
  sentence: ExtractedSentence,
  targetWord: string
): Promise<number> {
  let highlightedCount = 0;

  try {
    // Set flag to prevent observer from triggering during our changes
    isModifyingDOM = true;

    // Process each text node in the sentence
    for (const textNode of sentence.textNodes) {
      const text = textNode.data;
      if (!text.trim()) continue;

      // Tokenize this text node
      const segments = await segmentJapanese(text);
      let hasTargetWord = false;

      // Check if this text node contains our target word
      for (const segment of segments) {
        if (segment.isWordLike && segment.segment.trim() === targetWord) {
          hasTargetWord = true;
          break;
        }
      }

      if (!hasTargetWord) continue;

      // Create document fragment to replace the text node
      const fragment = document.createDocumentFragment();

      for (const segment of segments) {
        if (segment.isWordLike && segment.segment.trim() === targetWord) {
          // Create rainbow-highlighted span for the target word
          const span = document.createElement("span");
          span.className = CLS;

          // Check for vertical text mode and add class if needed
          if (
            textNode.parentElement &&
            isVerticalTextCached(textNode.parentElement)
          ) {
            span.classList.add("seer-vertical-text");
          }

          span.textContent = segment.segment;

          // Apply rainbow styling for i+1 words
          span.style.textDecoration = "none";
          span.style.borderBottom = "3px solid transparent";
          span.style.backgroundImage =
            "linear-gradient(90deg, #ff0000, #ff8000, #ffff00, #80ff00, #00ff00, #00ff80, #00ffff, #0080ff, #0000ff, #8000ff, #ff00ff, #ff0080)";
          span.style.backgroundSize = "200% 3px";
          span.style.backgroundRepeat = "no-repeat";
          span.style.backgroundPosition = "0 100%";
          span.style.animation = "rainbow-shift 3s linear infinite";

          // Add click handler for ignoring words
          span.addEventListener("click", async (event) => {
            if (event.altKey) {
              event.preventDefault();
              event.stopPropagation();

              const word = span.textContent?.trim();
              if (word && ignoredWordsSettings.enabled) {
                try {
                  const success = await addIgnoredWord(
                    word,
                    ignoredWordsSettings
                  );
                  if (success) {
                    ignoredWords.add(word);
                    removeWordHighlights(word);
                    showIgnoreNotification(word, true);
                    updateStatsAfterIgnore();
                  } else {
                    showIgnoreNotification(word, false);
                  }
                } catch (error) {
                  console.warn(`Failed to ignore word "${word}":`, error);
                  showIgnoreNotification(word, false);
                }
              }
            }
          });

          fragment.appendChild(span);
          highlightedCount++;
        } else {
          // Keep as regular text
          fragment.appendChild(document.createTextNode(segment.segment));
        }
      }

      // Replace the original text node with the fragment
      const parent = textNode.parentNode;
      if (parent) {
        parent.replaceChild(fragment, textNode);
      }
    }

    // Clear flag after DOM modifications are complete
    setTimeout(() => {
      isModifyingDOM = false;
    }, 100);
  } catch (error) {
    console.warn("❌ Error highlighting word in sentence:", error);
    isModifyingDOM = false;
  }

  return highlightedCount;
}

async function scan(root: Node = document.body): Promise<void> {
  if (isModifyingDOM || (!highlightsEnabled && !i1SentenceMode)) return;

  // Use sentence-aware scanning for i+1 mode
  if (i1SentenceMode) {
    return scanSentences(root);
  }

  console.log("🔍 Starting Japanese token scan...");

  const tokens = new Set<string>();
  const textNodes: Text[] = [];

  // Create tree walker to find all text nodes
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      // Skip script, style, and already processed nodes
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;

      const tagName = parent.tagName.toLowerCase();
      if (tagName === "script" || tagName === "style") {
        return NodeFilter.FILTER_REJECT;
      }

      if (parent.closest(`.${CLS}`) || parent.closest(".seer-stats")) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  // Collect text nodes and extract tokens
  let node: Node | null;
  let processedTextNodes = 0;

  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    const text = textNode.data;

    if (text.trim().length === 0) continue;

    textNodes.push(textNode);
    processedTextNodes++;

    // Segment the text and collect tokens using Kuromoji
    try {
      const segments = await segmentJapanese(text);
      let segmentCount = 0;

      for (const segment of segments) {
        if (segment.isWordLike) {
          const token = segment.segment.trim();
          if (
            token.length > 0 &&
            /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(token)
          ) {
            tokens.add(token);
            segmentCount++;
          }
        }
      }

      if (segmentCount > 0) {
        console.log(
          `📝 Text node "${text.substring(
            0,
            50
          )}..." -> ${segmentCount} Japanese tokens`
        );
      }
    } catch (error) {
      console.warn("❌ Error segmenting text:", error);
    }
  }

  console.log(
    `📊 Scan complete: ${processedTextNodes} text nodes, ${tokens.size} unique Japanese tokens`
  );
  console.log(`🔤 Sample tokens:`, Array.from(tokens).slice(0, 20));

  if (tokens.size === 0) {
    console.log("⚠️ No Japanese tokens found");
    return;
  }

  // Send tokens to background script
  const message: TokensMessage = { type: "TOKENS", tokens: Array.from(tokens) };

  console.log("📤 Sending tokens to background script...");

  chrome.runtime.sendMessage(message, async (response: TokensResponse) => {
    if (chrome.runtime.lastError) {
      console.error("❌ Error sending message:", chrome.runtime.lastError);
      return;
    }

    if (response && response.unknown) {
      // Filter out ignored words from unknown words
      const filteredUnknown = response.unknown.filter(
        (word) => !ignoredWords.has(word)
      );
      const unknownSet = new Set(filteredUnknown);

      console.log(
        `📥 Received response: ${response.unknown.length} unknown words out of ${tokens.size} total`
      );
      if (ignoredWords.size > 0) {
        console.log(
          `📝 Filtered out ${
            response.unknown.length - filteredUnknown.length
          } ignored words (local ignored set has ${ignoredWords.size} words)`
        );
        if (response.unknown.length - filteredUnknown.length > 0) {
          const ignoredInThisBatch = response.unknown.filter((word) =>
            ignoredWords.has(word)
          );
          console.log(`📝 Ignored words in this batch:`, ignoredInThisBatch);
        }
      }
      console.log(
        `❓ Sample unknown words after filtering:`,
        filteredUnknown.slice(0, 10)
      );

      // Update stats via manager
      if (statsManager) {
        const unknownWords = new Set(filteredUnknown);
        await statsManager.updateStats(tokens, unknownWords, ignoredWords);
      }

      console.log(
        `📈 Stats: ${tokens.size - response.unknown.length} known, ${
          filteredUnknown.length
        } unknown (${Math.round(
          ((tokens.size - response.unknown.length) / tokens.size) * 100
        )}% knowledge)`
      );

      // Apply highlights based on current mode
      if (highlightsEnabled || i1SentenceMode) {
        // Set flag to prevent observer from triggering during our changes
        isModifyingDOM = true;

        if (i1SentenceMode) {
          console.log("🔤 Starting i+1 sentence highlighting...");

          // Process each text node for i+1 sentences
          let highlightedWords = 0;
          for (const textNode of textNodes) {
            const highlighted = await wrapI1Sentences(textNode, unknownSet);
            highlightedWords += highlighted;
          }

          console.log(`✨ Highlighted ${highlightedWords} i+1 words`);
        } else {
          console.log("🎨 Starting to highlight unknown words...");

          // Process each text node normally
          let highlightedWords = 0;
          for (const textNode of textNodes) {
            const highlighted = await wrapUnknown(textNode, unknownSet);
            highlightedWords += highlighted;
          }

          console.log(`✨ Highlighted ${highlightedWords} word instances`);
        }

        // Clear flag after DOM modifications are complete
        setTimeout(() => {
          isModifyingDOM = false;
        }, 100);
      }

      // Stats are automatically updated via the manager
    } else {
      console.error("❌ Invalid response from background script:", response);
    }
  });
}

// Function to wrap unknown words in i+1 sentences
async function wrapI1Sentences(
  textNode: Text,
  unknownWords: Set<string>
): Promise<number> {
  const text = textNode.data;
  const parent = textNode.parentNode;

  if (!parent) return 0;

  try {
    // Segment text into sentences
    const sentences = segmentIntoSentences(text);

    if (sentences.length === 0) return 0;

    const fragment = document.createDocumentFragment();
    let highlightedCount = 0;

    for (const sentence of sentences) {
      // Tokenize the sentence to count unknown words
      const segments = await segmentJapanese(sentence);
      const unknownWordsInSentence: string[] = [];

      for (const segment of segments) {
        if (segment.isWordLike && unknownWords.has(segment.segment.trim())) {
          unknownWordsInSentence.push(segment.segment.trim());
        }
      }

      // Only highlight if this is an i+1 sentence (exactly 1 unknown word)
      if (unknownWordsInSentence.length === 1) {
        const unknownWord = unknownWordsInSentence[0];

        // Process segments and highlight the unknown word
        for (const segment of segments) {
          if (segment.isWordLike && segment.segment.trim() === unknownWord) {
            // Wrap unknown word in span with rainbow styling
            const span = document.createElement("span");
            span.className = CLS;

            // Check for vertical text mode and add class if needed
            if (
              textNode.parentElement &&
              isVerticalTextCached(textNode.parentElement)
            ) {
              span.classList.add("seer-vertical-text");
            }

            span.textContent = segment.segment;

            // Apply rainbow styling for i+1 words
            span.style.textDecoration = "none";
            span.style.borderBottom = "3px solid transparent";
            span.style.backgroundImage =
              "linear-gradient(90deg, #ff0000, #ff8000, #ffff00, #80ff00, #00ff00, #00ff80, #00ffff, #0080ff, #0000ff, #8000ff, #ff00ff, #ff0080)";
            span.style.backgroundSize = "200% 3px";
            span.style.backgroundRepeat = "no-repeat";
            span.style.backgroundPosition = "0 100%";
            span.style.animation = "rainbow-shift 3s linear infinite";

            // Add click handler for ignoring words
            span.addEventListener("click", async (event) => {
              if (event.altKey) {
                event.preventDefault();
                event.stopPropagation();

                const word = span.textContent?.trim();
                if (word && ignoredWordsSettings.enabled) {
                  try {
                    const success = await addIgnoredWord(
                      word,
                      ignoredWordsSettings
                    );
                    if (success) {
                      // Add to local ignored words set
                      ignoredWords.add(word);

                      // Remove this highlight and any other instances of the same word
                      removeWordHighlights(word);

                      // Show feedback
                      showIgnoreNotification(word, true);

                      // Update stats
                      updateStatsAfterIgnore();
                    } else {
                      showIgnoreNotification(word, false);
                    }
                  } catch (error) {
                    console.warn(`Failed to ignore word "${word}":`, error);
                    showIgnoreNotification(word, false);
                  }
                }
              }
            });

            fragment.appendChild(span);
            highlightedCount++;
          } else {
            // Keep as text
            fragment.appendChild(document.createTextNode(segment.segment));
          }
        }
      } else {
        // Not an i+1 sentence, keep as plain text
        fragment.appendChild(document.createTextNode(sentence));
      }
    }

    // Replace the original text node
    parent.replaceChild(fragment, textNode);
    return highlightedCount;
  } catch (error) {
    console.warn("❌ Error wrapping i+1 sentences:", error);
    return 0;
  }
}

async function wrapUnknown(
  textNode: Text,
  unknownWords: Set<string>
): Promise<number> {
  const text = textNode.data;
  const parent = textNode.parentNode;

  if (!parent) return 0;

  try {
    const segments = await segmentJapanese(text);

    if (segments.length === 0) return 0;

    const fragment = document.createDocumentFragment();
    let highlightedCount = 0;

    for (const segment of segments) {
      if (segment.isWordLike && unknownWords.has(segment.segment.trim())) {
        // Wrap unknown word in span with frequency-based styling
        const span = document.createElement("span");
        span.className = CLS;

        // Check for vertical text mode and add class if needed
        if (
          textNode.parentElement &&
          isVerticalTextCached(textNode.parentElement)
        ) {
          span.classList.add("seer-vertical-text");
        }

        span.textContent = segment.segment;

        // Apply frequency-based coloring
        applyFrequencyColoring(span, segment.segment.trim());

        // Add click handler for ignoring words
        span.addEventListener("click", async (event) => {
          if (event.altKey) {
            event.preventDefault();
            event.stopPropagation();

            const word = span.textContent?.trim();
            if (word && ignoredWordsSettings.enabled) {
              try {
                const success = await addIgnoredWord(
                  word,
                  ignoredWordsSettings
                );
                if (success) {
                  // Add to local ignored words set
                  ignoredWords.add(word);

                  // Remove this highlight and any other instances of the same word
                  removeWordHighlights(word);

                  // Show feedback
                  showIgnoreNotification(word, true);

                  // Update stats
                  updateStatsAfterIgnore();
                } else {
                  showIgnoreNotification(word, false);
                }
              } catch (error) {
                console.warn(`Failed to ignore word "${word}":`, error);
                showIgnoreNotification(word, false);
              }
            }
          }
        });

        fragment.appendChild(span);
        highlightedCount++;
      } else {
        // Keep as text
        fragment.appendChild(document.createTextNode(segment.segment));
      }
    }

    // Replace the original text node
    parent.replaceChild(fragment, textNode);
    return highlightedCount;
  } catch (error) {
    console.warn("❌ Error wrapping unknown words:", error);
    return 0;
  }
}

// Remove highlights for a specific word
function removeWordHighlights(word: string): void {
  const highlightedElements = document.querySelectorAll(`.${CLS}`);
  let removedCount = 0;

  highlightedElements.forEach((element) => {
    if (element.textContent?.trim() === word) {
      const parent = element.parentNode;
      if (parent) {
        // Replace the span with its text content
        const textNode = document.createTextNode(element.textContent || "");
        parent.replaceChild(textNode, element);
        removedCount++;
      }
    }
  });

  // Normalize text nodes to merge adjacent ones
  if (removedCount > 0) {
    normalizeTextNodes(document.body);
    console.log(`✅ Removed ${removedCount} highlights for word "${word}"`);
  }
}

// Show notification when a word is ignored
function showIgnoreNotification(word: string, success: boolean): void {
  const notification = document.createElement("div");
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${success ? "#4caf50" : "#f44336"};
    color: white;
    padding: 12px 20px;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 500;
    z-index: 10002;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    transition: all 0.3s ease;
    opacity: 0;
    transform: translateX(100%);
  `;

  notification.textContent = success
    ? `✅ "${word}" ignored`
    : `❌ Failed to ignore "${word}"`;

  document.body.appendChild(notification);

  // Animate in
  requestAnimationFrame(() => {
    notification.style.opacity = "1";
    notification.style.transform = "translateX(0)";
  });

  // Remove after 3 seconds
  setTimeout(() => {
    notification.style.opacity = "0";
    notification.style.transform = "translateX(100%)";
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }, 3000);
}

// Update stats after ignoring a word
function updateStatsAfterIgnore(): void {
  if (statsManager) {
    statsManager.recalculateStats();
  }
}

// Apply frequency-based coloring to a word element
async function applyFrequencyColoring(
  element: HTMLElement,
  word: string
): Promise<void> {
  try {
    // Check cache first
    let frequency = pageFrequencyCache.get(word);

    if (frequency === undefined) {
      // Look up frequency (this is cached in frequency-db)
      frequency = await getFrequencyRank(word);
      pageFrequencyCache.set(word, frequency);
    }

    // Get colors based on frequency and settings
    const colors = settings.useFrequencyColors
      ? getColorForFrequency(frequency, settings.colorIntensity)
      : getSingleColor(settings.singleColor, settings.colorIntensity);

    // If colors is null (frequency > 50k), don't highlight
    if (colors === null) {
      // Remove any existing highlighting
      element.classList.remove(CLS);
      element.style.backgroundColor = "";
      element.style.color = "";
      element.style.textDecoration = "";
      element.style.textDecorationColor = "";
      element.style.textDecorationThickness = "";
      element.style.textDecorationStyle = "";
      element.style.textShadow = "";
      element.removeAttribute("data-frequency");
      element.style.removeProperty("--frequency-content");
      return;
    }

    // Apply the selected highlight style
    applyHighlightStyle(
      element,
      colors,
      settings.highlightStyle,
      settings.useFrequencyColors,
      frequency,
      settings.showFrequencyOnHover,
      settings.preserveTextColor
    );
  } catch (error) {
    console.warn(`❌ Error applying frequency coloring for "${word}":`, error);
    // Fallback to yellow highlighting
    element.style.backgroundColor = "rgba(255, 255, 0, 0.3)";
  }
}

// Handle extension context invalidation
let extensionContextValid = true;

function checkExtensionContext(): boolean {
  try {
    chrome.runtime.getURL("");
    return true;
  } catch (error) {
    if (!extensionContextValid) return false; // Already logged

    console.warn("Extension context invalidated. Please reload the page.");
    extensionContextValid = false;

    // Update UI to show context lost
    const statusEl = document.querySelector("#status");
    if (statusEl) {
      statusEl.textContent = "Extension reloaded - refresh page";
      statusEl.className = "unknown-value";
    }

    return false;
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "TOGGLE_HIGHLIGHTS_CONTENT") {
    const toggleMsg = message as ToggleHighlightsContentMessage;
    console.log(`🎛️ Received toggle highlights message: ${toggleMsg.enabled}`);
    toggleHighlights(toggleMsg.enabled);
  }

  if (message.type === "TOGGLE_I1_SENTENCE_MODE_CONTENT") {
    const toggleMsg = message as ToggleI1SentenceModeContentMessage;
    console.log(
      `🔤 Received toggle i+1 sentence mode message: ${toggleMsg.enabled}`
    );
    toggleI1SentenceMode(toggleMsg.enabled);
  }

  if (message.type === "RELOAD_SETTINGS") {
    console.log("⚙️ Received reload settings message");
    loadSettings()
      .then(async (newSettings) => {
        const oldSettings = { ...settings };
        settings = newSettings;
        console.log("✅ Settings reloaded from popup:", settings);

        // Re-apply highlighting if preserve text color setting changed
        if (
          highlightsEnabled &&
          oldSettings.preserveTextColor !== settings.preserveTextColor
        ) {
          console.log(
            "🎨 Preserve text color setting changed, re-applying highlighting..."
          );
          await reapplyHighlighting();
        }
      })
      .catch((error) => {
        console.warn("❌ Failed to reload settings from popup:", error);
      });
  }
});

// Initialize immediately based on document state
async function startExtension(): Promise<void> {
  console.log("🚀 Initializing Seer...");

  // Initialize frequency database and settings first
  await initializeExtension();

  // Initialize stats system (respects showStats setting and highlight state)
  initializeStatsSystem();

  // Only start scanning if highlights are enabled or i+1 mode is enabled
  if (highlightsEnabled || i1SentenceMode) {
    scan().catch((error) =>
      console.error("❌ Error during initial scan:", error)
    );
  } else {
    console.log("🚫 Highlights and i+1 mode disabled, skipping initial scan");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    startExtension();
  });
} else {
  // Document is already loaded
  startExtension();
}

// Listen for settings changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "sync") {
    console.log("⚙️ Settings changed, reloading...");

    // Handle highlight enabled state change
    if (changes.highlightsEnabled) {
      const newEnabled = changes.highlightsEnabled.newValue;
      console.log(`🎛️ Highlights enabled changed to: ${newEnabled}`);
      toggleHighlights(newEnabled);
    }

    // Handle ignored words settings changes
    if (
      changes.ignoredWordsEnabled ||
      changes.ignoredDeckName ||
      changes.ignoredNoteType ||
      changes.ignoredFieldName
    ) {
      console.log("📝 Ignored words settings changed, reloading...");
      getIgnoredWordsSettings()
        .then(async (newIgnoredSettings: IgnoredWordsSettings) => {
          const oldEnabled = ignoredWordsSettings.enabled;
          ignoredWordsSettings = newIgnoredSettings;

          if (ignoredWordsSettings.enabled && !oldEnabled) {
            // Ignored words just got enabled
            try {
              const ankiAvailable = await checkAnkiConnect();
              if (ankiAvailable) {
                await setupIgnoredWords(ignoredWordsSettings);
                ignoredWords = await getIgnoredWords(ignoredWordsSettings);
                console.log(
                  `✅ Loaded ${ignoredWords.size} ignored words after enabling`
                );
                // Re-scan to apply new ignored words
                if (highlightsEnabled) {
                  scan().catch((error) =>
                    console.error("❌ Error during scan:", error)
                  );
                }
              } else {
                console.warn(
                  "⚠️ AnkiConnect not available, ignored words disabled"
                );
                ignoredWordsSettings.enabled = false;
              }
            } catch (error) {
              console.warn("⚠️ Failed to setup ignored words:", error);
              ignoredWordsSettings.enabled = false;
            }
          } else if (!ignoredWordsSettings.enabled && oldEnabled) {
            // Ignored words just got disabled
            ignoredWords.clear();
            console.log("📝 Ignored words disabled, cleared local cache");
            // Re-scan to show previously ignored words
            if (highlightsEnabled) {
              scan().catch((error) =>
                console.error("❌ Error during scan:", error)
              );
            }
          } else if (ignoredWordsSettings.enabled) {
            // Settings changed but still enabled, reload ignored words
            try {
              const ankiAvailable = await checkAnkiConnect();
              if (ankiAvailable) {
                ignoredWords = await getIgnoredWords(ignoredWordsSettings);
                console.log(
                  `✅ Reloaded ${ignoredWords.size} ignored words after settings change`
                );
                // Re-scan to apply updated ignored words
                if (highlightsEnabled) {
                  scan().catch((error) =>
                    console.error("❌ Error during scan:", error)
                  );
                }
              }
            } catch (error) {
              console.warn("⚠️ Failed to reload ignored words:", error);
            }
          }
        })
        .catch((error: any) => {
          console.warn("❌ Failed to reload ignored words settings:", error);
        });
    }

    loadSettings()
      .then(async (newSettings) => {
        const oldSettings = { ...settings };
        settings = newSettings;
        console.log("✅ Settings reloaded:", settings);

        // Update stats panel visibility
        if (statsPanel) {
          if (settings.showStats && highlightsEnabled) {
            statsPanel.show();
          } else {
            statsPanel.hide();
          }
        }

        // Update CSS if color intensity changed
        if (oldSettings.colorIntensity !== settings.colorIntensity) {
          updateCSSVariables();
        }

        // Re-apply highlighting if color-related settings changed and highlights are enabled
        if (
          highlightsEnabled &&
          (oldSettings.colorIntensity !== settings.colorIntensity ||
            oldSettings.highlightStyle !== settings.highlightStyle ||
            oldSettings.useFrequencyColors !== settings.useFrequencyColors ||
            oldSettings.singleColor !== settings.singleColor ||
            oldSettings.showFrequencyOnHover !==
              settings.showFrequencyOnHover ||
            oldSettings.preserveTextColor !== settings.preserveTextColor)
        ) {
          console.log("🎨 Color settings changed, re-applying highlighting...");
          await reapplyHighlighting();
        }
      })
      .catch((error) => {
        console.warn("❌ Failed to reload settings:", error);
      });
  }
});

// MutationObserver with better filtering to prevent self-triggering
const observer = new MutationObserver((mutations) => {
  // Check if extension context is still valid
  if (!checkExtensionContext()) return;

  // Don't scan if we're currently modifying the DOM or both highlights and i+1 mode are disabled
  if (isModifyingDOM || (!highlightsEnabled && !i1SentenceMode)) return;

  let shouldScan = false;

  for (const mutation of mutations) {
    if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
      for (const node of Array.from(mutation.addedNodes)) {
        // Skip our own elements
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          if (
            element.classList?.contains(CLS) ||
            element.classList?.contains("seer-stats") ||
            element.closest(".seer-stats")
          ) {
            continue;
          }
        }

        if (
          node.nodeType === Node.ELEMENT_NODE ||
          node.nodeType === Node.TEXT_NODE
        ) {
          // Check if the added content contains Japanese text
          const textContent = node.textContent || "";
          if (/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(textContent)) {
            shouldScan = true;
            break;
          }
        }
      }
      if (shouldScan) break;
    }
  }

  if (shouldScan) {
    console.log("Detected new Japanese content, rescanning...");
    scan().catch((error) => console.error("❌ Error during scan:", error));
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

// Add keyboard shortcut for toggling stats
document.addEventListener("keydown", (event) => {
  // Ctrl/Cmd + Shift + S to toggle stats
  if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === "S") {
    event.preventDefault();
    if (settings.showStats && statsPanel && highlightsEnabled) {
      statsPanel.toggle();
    }
  }
});

// Utility function to detect vertical text mode
function isVerticalText(element: Element): boolean {
  let current: Element | null = element;
  while (current && current !== document.body) {
    const style = getComputedStyle(current);
    const writingMode = style.writingMode;
    if (writingMode === "vertical-rl" || writingMode === "vertical-lr") {
      return true;
    }
    current = current.parentElement;
  }
  return false;
}

// Cache for vertical text detection to avoid repeated computations
const verticalTextCache = new WeakMap<Element, boolean>();

function isVerticalTextCached(element: Element): boolean {
  if (verticalTextCache.has(element)) {
    return verticalTextCache.get(element)!;
  }

  const isVertical = isVerticalText(element);
  verticalTextCache.set(element, isVertical);
  return isVertical;
}
