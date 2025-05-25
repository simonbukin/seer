import { TokensMessage, TokensResponse } from "./types";
import {
  initializeFrequencyDB,
  getFrequencyRank,
  getColorForFrequency,
  loadSettings,
} from "./frequency-db";

// Type declarations for Intl.Segmenter
declare namespace Intl {
  interface Segmenter {
    segment(input: string): IterableIterator<{
      segment: string;
      index: number;
      input: string;
      isWordLike?: boolean;
    }>;
  }

  interface SegmenterConstructor {
    new (
      locales?: string | string[],
      options?: {
        granularity?: "grapheme" | "word" | "sentence";
        localeMatcher?: "lookup" | "best fit";
      }
    ): Segmenter;
  }

  const Segmenter: SegmenterConstructor;
}

const CLS = "anki-unknown";
let segmenter: Intl.Segmenter;

// Settings and frequency data
let settings = {
  colorIntensity: 0.7,
  showStats: true,
};

// Frequency cache for current page words
const pageFrequencyCache = new Map<string, number | null>();

// Stats tracking
interface Stats {
  totalTokens: number;
  unknownTokens: number;
  knownTokens: number;
  mostCommon: Map<string, number>;
  lastUpdate: Date;
}

let stats: Stats = {
  totalTokens: 0,
  unknownTokens: 0,
  knownTokens: 0,
  mostCommon: new Map(),
  lastUpdate: new Date(),
};

// Initialize segmenter
try {
  segmenter = new Intl.Segmenter("ja", { granularity: "word" });
  console.log("✅ Japanese segmenter initialized");
} catch (error) {
  console.warn(
    "❌ Intl.Segmenter not available, extension may not work properly"
  );
}

// Initialize frequency database and settings
async function initializeExtension(): Promise<void> {
  try {
    console.log("🚀 Initializing frequency database...");
    await initializeFrequencyDB();

    console.log("⚙️ Loading settings...");
    settings = await loadSettings();

    console.log("✅ Extension initialization complete");
  } catch (error) {
    console.warn("⚠️ Extension initialization failed, using defaults:", error);
  }
}

// Dynamic CSS for gradient highlighting
const style = document.createElement("style");
style.textContent = `
  .${CLS} {
    border-radius: 2px !important;
    padding: 1px 2px !important;
    margin: 0 1px !important;
    cursor: pointer !important;
    transition: all 0.2s ease !important;
    font-weight: 500 !important;
    position: relative;
  }
  
  .${CLS}:hover {
    transform: scale(1.05) !important;
    box-shadow: 0 2px 4px rgba(0,0,0,0.2) !important;
    filter: brightness(1.1) !important;
  }

  .anki-stats {
    position: fixed;
    top: 10px;
    left: 10px;
    background: rgba(0, 0, 0, 0.85);
    color: white;
    padding: 12px;
    border-radius: 8px;
    font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    font-size: 11px;
    line-height: 1.4;
    z-index: 9999;
    min-width: 200px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    transition: all 0.3s ease;
  }
  
  .anki-stats.collapsed {
    transform: translateX(-200px);
  }
  
  .anki-stats .title {
    font-weight: bold;
    margin-bottom: 8px;
    color: #ffeb3b;
    border-bottom: 1px solid #333;
    padding-bottom: 4px;
  }
  
  .anki-stats .stat-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 2px;
  }
  
  .anki-stats .stat-label {
    color: #ccc;
  }
  
  .anki-stats .stat-value {
    color: #4caf50;
    font-weight: bold;
  }
  
  .anki-stats .unknown-value {
    color: #ff5722;
  }
  
  .anki-stats .toggle {
    position: absolute;
    right: -20px;
    top: 50%;
    transform: translateY(-50%);
    width: 20px;
    height: 40px;
    background: rgba(0, 0, 0, 0.85);
    border-radius: 0 8px 8px 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: 12px;
  }
`;
document.head.appendChild(style);

// Create stats overlay
let statsOverlay: HTMLElement | null = null;

function createStatsOverlay(): void {
  if (statsOverlay) return;

  statsOverlay = document.createElement("div");
  statsOverlay.className = "anki-stats";

  statsOverlay.innerHTML = `
    <div class="title">🗾 Anki Highlighter</div>
    <div class="stat-row">
      <span class="stat-label">Total tokens:</span>
      <span class="stat-value" id="total-tokens">0</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Known:</span>
      <span class="stat-value" id="known-tokens">0</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Unknown:</span>
      <span class="stat-value unknown-value" id="unknown-tokens">0</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Knowledge:</span>
      <span class="stat-value" id="knowledge-percent">0%</span>
    </div>
    <div class="stat-row">
      <span class="stat-label">Status:</span>
      <span class="anki-loading" id="status">Loading data...</span>
    </div>
    <div class="toggle">◀</div>
  `;

  document.body.appendChild(statsOverlay);

  // Add toggle functionality
  const toggle = statsOverlay.querySelector(".toggle")!;
  toggle.addEventListener("click", () => {
    statsOverlay!.classList.toggle("collapsed");
    toggle.textContent = statsOverlay!.classList.contains("collapsed")
      ? "▶"
      : "◀";
  });
}

function updateStatsOverlay(): void {
  if (!statsOverlay) return;

  const totalTokensEl = statsOverlay.querySelector("#total-tokens")!;
  const knownTokensEl = statsOverlay.querySelector("#known-tokens")!;
  const unknownTokensEl = statsOverlay.querySelector("#unknown-tokens")!;
  const knowledgePercentEl = statsOverlay.querySelector("#knowledge-percent")!;
  const statusEl = statsOverlay.querySelector("#status")!;

  totalTokensEl.textContent = stats.totalTokens.toString();
  knownTokensEl.textContent = stats.knownTokens.toString();
  unknownTokensEl.textContent = stats.unknownTokens.toString();

  const knowledgePercent =
    stats.totalTokens > 0
      ? Math.round((stats.knownTokens / stats.totalTokens) * 100)
      : 0;
  knowledgePercentEl.textContent = `${knowledgePercent}%`;

  // Update status
  statusEl.textContent = `Updated ${stats.lastUpdate.toLocaleTimeString()}`;
  statusEl.className = "stat-value";
}

// Flag to prevent scanning during our own DOM modifications
let isModifyingDOM = false;

function scan(root: Node = document.body): void {
  if (!segmenter || isModifyingDOM) return;

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

      if (parent.closest(`.${CLS}`) || parent.closest(".anki-stats")) {
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

    // Segment the text and collect tokens
    try {
      const segments = segmenter.segment(text);
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
    createStatsOverlay();
    updateStatsOverlay();
    return;
  }

  // Send tokens to background script
  const message: TokensMessage = { type: "TOKENS", tokens: Array.from(tokens) };

  console.log("📤 Sending tokens to background script...");

  chrome.runtime.sendMessage(message, (response: TokensResponse) => {
    if (chrome.runtime.lastError) {
      console.error("❌ Error sending message:", chrome.runtime.lastError);
      return;
    }

    if (response && response.unknown) {
      const unknownSet = new Set(response.unknown);

      console.log(
        `📥 Received response: ${response.unknown.length} unknown words out of ${tokens.size} total`
      );
      console.log(`❓ Sample unknown words:`, response.unknown.slice(0, 10));

      // Update stats for current page
      stats.totalTokens = tokens.size;
      stats.unknownTokens = response.unknown.length;
      stats.knownTokens = tokens.size - response.unknown.length;
      stats.lastUpdate = new Date();

      console.log(
        `📈 Stats: ${stats.knownTokens} known, ${
          stats.unknownTokens
        } unknown (${Math.round(
          (stats.knownTokens / stats.totalTokens) * 100
        )}% knowledge)`
      );

      // Set flag to prevent observer from triggering during our changes
      isModifyingDOM = true;

      console.log("🎨 Starting to highlight unknown words...");

      // Process each text node
      let highlightedWords = 0;
      textNodes.forEach((textNode) => {
        const highlighted = wrapUnknown(textNode, unknownSet);
        highlightedWords += highlighted;
      });

      console.log(`✨ Highlighted ${highlightedWords} word instances`);

      // Clear flag after DOM modifications are complete
      setTimeout(() => {
        isModifyingDOM = false;
      }, 100);

      // Update UI
      createStatsOverlay();
      updateStatsOverlay();
    } else {
      console.error("❌ Invalid response from background script:", response);
    }
  });
}

function wrapUnknown(textNode: Text, unknownWords: Set<string>): number {
  if (!segmenter) return 0;

  const text = textNode.data;
  const parent = textNode.parentNode;

  if (!parent) return 0;

  try {
    const segments = Array.from(segmenter.segment(text));

    if (segments.length <= 1) return 0;

    const fragment = document.createDocumentFragment();
    let highlightedCount = 0;

    for (const segment of segments) {
      if (segment.isWordLike && unknownWords.has(segment.segment.trim())) {
        // Wrap unknown word in span with frequency-based styling
        const span = document.createElement("span");
        span.className = CLS;
        span.textContent = segment.segment;

        // Apply frequency-based coloring
        applyFrequencyColoring(span, segment.segment.trim());

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

    // Get colors based on frequency
    const colors = getColorForFrequency(frequency, settings.colorIntensity);

    // Apply styling
    element.style.color = colors.color;
    element.style.backgroundColor = colors.bgColor;
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

// Initialize immediately based on document state
async function startExtension(): Promise<void> {
  console.log("🚀 Initializing Anki Highlighter...");

  // Initialize frequency database and settings first
  await initializeExtension();

  // Then start scanning
  scan();
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
    loadSettings()
      .then((newSettings) => {
        settings = newSettings;
        console.log("✅ Settings reloaded:", settings);

        // Re-apply coloring to existing highlighted words
        const highlightedWords = document.querySelectorAll(`.${CLS}`);
        highlightedWords.forEach((element) => {
          const word = element.textContent?.trim();
          if (word) {
            applyFrequencyColoring(element as HTMLElement, word);
          }
        });
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

  // Don't scan if we're currently modifying the DOM
  if (isModifyingDOM) return;

  let shouldScan = false;

  for (const mutation of mutations) {
    if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
      for (const node of Array.from(mutation.addedNodes)) {
        // Skip our own elements
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as Element;
          if (
            element.classList?.contains(CLS) ||
            element.classList?.contains("anki-stats") ||
            element.closest(".anki-stats")
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
    scan();
  }
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});
